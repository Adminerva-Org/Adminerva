"use strict";
/**
 * School-scoped personalized Studio task assignment.
 * Variant pools belong to teacher-private blueprint storage. A deployment
 * freezes the exact variant ID set it may use; learners receive only prompts.
 */
const {createHash,randomBytes}=require("node:crypto");
const {Timestamp}=require("firebase-admin/firestore");
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");
const {rowKey,checkId}=require("./school-academics.js");
const {PERSONALIZATION_MODE}=require("./teacher-blueprints.js");
function deny(code,message){throw new TenantAccessError(code,message)}
const hash=(...values)=>createHash("sha256").update(JSON.stringify(values)).digest("hex");
const chooseIndex=max=>max>1?randomBytes(4).readUInt32BE(0)%max:0;
function cleanVariantId(value){
 const text=String(value||"");
 if(!/^[a-f0-9]{24}$/.test(text))deny("invalid-argument","Personalized variant ID is invalid.");
 return text;
}
function variantIds(task){
 const personalized=task.personalizedTask||{},ids=Array.isArray(personalized.variantIds)?personalized.variantIds:[];
 if(personalized.enabled!==true||personalized.mode!==PERSONALIZATION_MODE||
    typeof personalized.poolFingerprint!=="string"||!/^[a-f0-9]{64}$/.test(personalized.poolFingerprint)||
    !ids.length||ids.length>600||ids.some(id=>!/^[a-f0-9]{24}$/.test(id))||
    new Set(ids).size!==ids.length)
  deny("failed-precondition","This deployed personalized task has incomplete pool metadata.");
 return ids;
}
function createSchoolStudioAssessmentVariantService({db}){
 return async request=>{
  const input=request.data||{},ctx=await getSchoolContext({db,request,schoolId:input.schoolId});
  const taskId=checkId(input.taskId,"Assessment task",128),prefix="schools/"+ctx.schoolId+"/",
    taskRef=db.doc(prefix+"assessments/"+taskId),taskDoc=await taskRef.get();
  if(!taskDoc.exists||taskDoc.data().schoolId!==ctx.schoolId)
    deny("not-found","This school assessment is unavailable.");
  const task=taskDoc.data(),ids=variantIds(task);
  if(task.submissionSource!=="studio"||task.status!=="deployed")
    deny("failed-precondition","Personalized task assignment requires a deployed Studio assessment.");

  if(input.action==="stats"){
    if(!ctx.roles.includes("teacher"))
      deny("permission-denied","Teacher access is required.");
    const grant=await db.doc(prefix+"staff_assignments/"+rowKey(ctx.uid,task.offeringId)).get();
    if((task.reviewerUid||task.ownerUid)!==ctx.uid||!grant.exists||
       grant.data().schoolId!==ctx.schoolId||grant.data().teacherUid!==ctx.uid||
       grant.data().offeringId!==task.offeringId||grant.data().status!=="active")
      deny("permission-denied","Only the currently responsible teacher may inspect personalization usage.");
    const snap=await db.collection(prefix+"studio_variant_registry/"+taskId+"/keys").limit(601).get();
    if(snap.size>600)deny("resource-exhausted","Personalization usage exceeds the supported pool size.");
    return {taskId,poolSize:ids.length,assigned:snap.size,available:Math.max(0,ids.length-snap.size)};
  }

  if(input.action!=="assign")
    deny("invalid-argument","Unknown school personalization operation.");
  if(!ctx.roles.includes("student"))
    deny("permission-denied","Student permission is required.");

  const memberRef=db.doc(prefix+"memberships/"+ctx.uid),member=await memberRef.get(),
    personId=member.data()?.personId;
  if(!member.exists||member.data().status!=="active"||typeof personId!=="string")
    deny("failed-precondition","Link your active school student record before opening this task.");
  checkId(personId,"Student person ID",128);
  const personRef=db.doc(prefix+"people/"+personId),
    enrollmentRef=db.doc(prefix+"enrollments/"+rowKey(personId,task.offeringId)),
    [person,enrollment]=await Promise.all([personRef.get(),enrollmentRef.get()]);
  if(!person.exists||person.data().schoolId!==ctx.schoolId||person.data().status!=="active"||
     person.data().kind!=="student"||person.data().authUid!==ctx.uid||
     !enrollment.exists||enrollment.data().schoolId!==ctx.schoolId||
     enrollment.data().personId!==personId||enrollment.data().offeringId!==task.offeringId||
     enrollment.data().status!=="active")
    deny("permission-denied","You are not actively enrolled in this assessment's course.");

  const submissionId=hash(ctx.schoolId,taskId,ctx.uid),
    submissionRef=db.doc(prefix+"studio_submissions/"+submissionId),
    head=await submissionRef.get(),headData=head.exists?head.data():null;
  let attempt=1,readOnly=false;
  if(headData){
    const current=Number(headData.currentVersion)||1;
    if(headData.status==="reopened")attempt=current+1;
    else {attempt=current;readOnly=["submitted","reviewed"].includes(headData.status);}
  }
  if(attempt>30)deny("failed-precondition","The Studio revision limit was reached.");

  const lifecycle=task.lifecycle||"active",now=Date.now(),
    revisionOpen=head.exists&&headData.status==="reopened",
    revisionDeadline=revisionOpen?headData.revisionDueAt?.toMillis?.()||0:0;
  if(["archived","cancelled"].includes(lifecycle))
    deny("failed-precondition","This assessment is no longer available.");
  if(lifecycle==="closed"&&!revisionOpen)
    deny("failed-precondition","This assessment is closed to new submissions.");
  if(now<task.opensAt.toMillis()||(now>task.dueAt.toMillis()&&now>revisionDeadline))
    deny("failed-precondition","This personalized task cannot start outside its submission window.");

  const assignmentRef=db.doc(prefix+"studio_variant_assignments/"+submissionId+"/attempts/"+attempt),
    existing=await assignmentRef.get();
  if(existing.exists){
    const data=existing.data();
    if(data.schoolId!==ctx.schoolId||data.taskId!==taskId||data.studentUid!==ctx.uid||
       data.personId!==personId||data.attempt!==attempt||
       data.poolFingerprint!==task.personalizedTask.poolFingerprint||
       !ids.includes(data.variantId)||typeof data.prompt!=="string")
      deny("failed-precondition","The saved personalized assignment no longer matches this task.");
    return {personalized:true,taskId,attempt,variantId:data.variantId,prompt:data.prompt,
      createdAt:data.createdAt?.toMillis?.()||null,readOnly};
  }
  if(readOnly)
    deny("failed-precondition","The submitted revision has no recorded personalized task.");

  const poolRef=db.doc(prefix+"assessment_blueprint_private/"+task.blueprintId+
    "/pools/"+task.personalizedTask.poolFingerprint);
  let assigned=null;
  const start=chooseIndex(ids.length);
  for(let offset=0;offset<ids.length&&!assigned;offset++){
    const variantId=ids[(start+offset)%ids.length],
      reservationRef=db.doc(prefix+"studio_variant_registry/"+taskId+"/keys/"+variantId),
      variantRef=poolRef.collection("variants").doc(variantId);
    try{
      await db.runTransaction(async tx=>{
        const [latestTask,latestMember,latestPerson,latestEnrollment,latestHead,current,reservation,variant]=
          await Promise.all([
            tx.get(taskRef),tx.get(memberRef),tx.get(personRef),tx.get(enrollmentRef),
            tx.get(submissionRef),tx.get(assignmentRef),tx.get(reservationRef),tx.get(variantRef)
          ]);
        if(!latestTask.exists||latestTask.data().schoolId!==ctx.schoolId||
           latestTask.data().personalizedTask?.poolFingerprint!==task.personalizedTask.poolFingerprint||
           !variantIds(latestTask.data()).includes(variantId))
          deny("failed-precondition","The personalized deployment changed. Reload the assignment.");
        if(!latestMember.exists||latestMember.data().status!=="active"||
           latestMember.data().personId!==personId||!latestPerson.exists||
           latestPerson.data().authUid!==ctx.uid||latestPerson.data().status!=="active"||
           !latestEnrollment.exists||latestEnrollment.data().status!=="active"||
           latestEnrollment.data().offeringId!==task.offeringId)
          deny("permission-denied","Student enrollment changed while opening the task.");
        let currentAttempt=1;
        if(latestHead.exists){
          const data=latestHead.data(),version=Number(data.currentVersion)||1;
          currentAttempt=data.status==="reopened"?version+1:version;
        }
        if(currentAttempt!==attempt)
          deny("failed-precondition","Submission status changed. Reload before opening a new task.");
        if(current.exists){assigned=current.data();return;}
        if(reservation.exists){
          const collision=Error("VARIANT_RESERVED");collision.variantReserved=true;throw collision;
        }
        if(!variant.exists)deny("failed-precondition","A frozen personalized variant is missing.");
        const value=variant.data();
        if(value.schoolId!==ctx.schoolId||value.ownerUid!==task.ownerUid||
           value.blueprintId!==task.blueprintId||value.fingerprint!==task.personalizedTask.poolFingerprint||
           value.variantId!==variantId||typeof value.prompt!=="string"||value.prompt.trim().length<20)
          deny("failed-precondition","A frozen personalized variant is invalid.");
        const createdAt=Timestamp.fromMillis(now);
        assigned={schoolId:ctx.schoolId,taskId,offeringId:task.offeringId,
          studentUid:ctx.uid,personId,attempt,variantId,prompt:value.prompt,
          poolFingerprint:task.personalizedTask.poolFingerprint,createdAt};
        tx.create(assignmentRef,assigned);
        tx.create(reservationRef,{schoolId:ctx.schoolId,taskId,variantId,studentUid:ctx.uid,
          personId,attempt,poolFingerprint:task.personalizedTask.poolFingerprint,createdAt});
      });
    }catch(error){
      if(error?.variantReserved||String(error?.message||"").includes("VARIANT_RESERVED"))continue;
      throw error;
    }
  }
  if(!assigned)
    deny("resource-exhausted","All personalized variants for this deployed task are already assigned. Ask your teacher to deploy a larger pool.");
  return {personalized:true,taskId,attempt,variantId:assigned.variantId,prompt:assigned.prompt,
    createdAt:assigned.createdAt?.toMillis?.()||now,readOnly:false};
 };
}
module.exports={createSchoolStudioAssessmentVariantService};
