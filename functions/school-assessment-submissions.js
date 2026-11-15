"use strict";
/**
 * General school assessment submissions for non-repository academic work.
 * Text and link responses use immutable versions and the same reviewed-grade
 * lifecycle as Studio and GitHub evidence.
 */
const {FieldValue,Timestamp}=require("firebase-admin/firestore");
const {createHash}=require("node:crypto");
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");
const {rowKey,checkId}=require("./school-academics.js");
const {writeSchoolNotification}=require("./school-notifications.js");

function deny(code,message){throw new TenantAccessError(code,message)}
const hash=(...values)=>createHash("sha256").update(JSON.stringify(values)).digest("hex");
const GENERAL_SOURCES=new Set(["text","link"]);

function normalizePayload(source,input={}){
  if(source==="text"){
    const response=String(input.response||"").trim();
    if(!response)deny("invalid-argument","Enter your response before submitting.");
    if(response.length>50000)deny("invalid-argument","Written responses are limited to 50,000 characters.");
    return {response};
  }
  if(source==="link"){
    const raw=String(input.url||"").trim();
    let url;
    try{url=new URL(raw);}catch{deny("invalid-argument","Enter a valid submission link.");}
    if(url.protocol!=="https:")deny("invalid-argument","Submission links must use HTTPS.");
    if(url.username||url.password)deny("invalid-argument","Submission links cannot contain embedded credentials.");
    const note=String(input.note||"").trim();
    if(note.length>10000)deny("invalid-argument","Submission notes are limited to 10,000 characters.");
    return {url:url.href,note};
  }
  deny("invalid-argument","This assessment submission type is not supported by the general response service.");
}
function digestSubmission(source,payload){
  if(!GENERAL_SOURCES.has(source))throw Error("Unsupported general assessment source.");
  return createHash("sha256").update(JSON.stringify({source,payload})).digest("hex");
}
function extensionTimestamp(value){
  if(value===undefined||value===null||value==="")return null;
  if(typeof value!=="string"||!/(Z|[+-]\d\d:\d\d)$/.test(value))
    deny("invalid-argument","Revision extension must include an explicit timezone.");
  const millis=Date.parse(value);
  if(!Number.isFinite(millis)||millis<=Date.now()||millis>Date.now()+30*86400000)
    deny("invalid-argument","Choose a future revision deadline no more than 30 days from now.");
  return Timestamp.fromMillis(millis);
}

function createSchoolAssessmentSubmissionService({db}){
 return async request=>{
  const input=request.data||{},ctx=await getSchoolContext({db,request,schoolId:input.schoolId});
  const taskId=checkId(input.taskId,"Assessment task",128);
  const prefix="schools/"+ctx.schoolId+"/";
  const taskRef=db.doc(prefix+"assessments/"+taskId);
  const memberRef=db.doc(prefix+"memberships/"+ctx.uid);
  const schoolRef=db.doc("platform_schools/"+ctx.schoolId);
  const collection=db.collection(prefix+"assessment_submissions");
  const task=await taskRef.get();
  if(!task.exists||task.data().schoolId!==ctx.schoolId||task.data().status!=="deployed"||
     !GENERAL_SOURCES.has(task.data().submissionSource))
    deny("not-found","This general assessment is unavailable.");
  const taskData=task.data(),source=taskData.submissionSource,offeringId=taskData.offeringId;

  async function verifyMembership(tx,role){
    const [school,member]=await Promise.all([tx.get(schoolRef),tx.get(memberRef)]);
    if(!school.exists||!["active","pilot"].includes(school.data().state)||!member.exists||
       member.data().schoolId!==ctx.schoolId||member.data().status!=="active"||
       !Array.isArray(member.data().roles)||!member.data().roles.includes(role))
      deny("permission-denied","Your verified school permission changed. Refresh before continuing.");
    return member.data();
  }
  async function verifyStudentRead(){
    if(!ctx.roles.includes("student"))deny("permission-denied","Student submission access is required.");
    const member=await memberRef.get(),personId=member.data()?.personId;
    if(typeof personId!=="string")deny("failed-precondition","Link your verified school person record first.");
    checkId(personId,"Person ID",128);
    const [person,enrollment]=await Promise.all([
      db.doc(prefix+"people/"+personId).get(),
      db.doc(prefix+"enrollments/"+rowKey(personId,offeringId)).get()
    ]);
    if(!person.exists||person.data().schoolId!==ctx.schoolId||person.data().authUid!==ctx.uid||
       person.data().kind!=="student"||person.data().status!=="active"||
       !enrollment.exists||enrollment.data().schoolId!==ctx.schoolId||
       enrollment.data().personId!==personId||enrollment.data().offeringId!==offeringId||
       enrollment.data().status!=="active")
      deny("permission-denied","You are not actively enrolled in this course offering.");
    return {member:member.data(),personId};
  }

  const submissionId=hash(ctx.schoolId,taskId,ctx.uid);
  const submissionRef=collection.doc(submissionId);

  if(input.action==="my_status"){
    const {personId}=await verifyStudentRead();
    const current=await submissionRef.get();
    if(!current.exists)return {taskId,submitted:false,status:"not_submitted",version:0};
    const data=current.data();
    if(data.schoolId!==ctx.schoolId||data.taskId!==taskId||data.studentUid!==ctx.uid||
       data.personId!==personId||data.offeringId!==offeringId)
      deny("permission-denied","Stored submission belongs to a different school context.");
    return {taskId,submissionId,submitted:true,status:data.status,version:data.currentVersion,
      currentVersion:data.currentVersion,submissionSource:source,
      requestMessage:data.status==="reopened"?data.revisionRequestMessage||"":"",
      revisionDueAt:data.status==="reopened"?data.revisionDueAt?.toMillis?.()||null:null};
  }

  if(input.action==="submit"){
    if(taskData.published!==true)deny("not-found","This assessment is not published to students.");
    if(!ctx.roles.includes("student"))deny("permission-denied","Student submission access is required.");
    const payload=normalizePayload(source,input),digest=digestSubmission(source,payload);
    const auditRef=db.collection(prefix+"submission_audit").doc();
    let receipt;
    await db.runTransaction(async tx=>{
      const activeMember=await verifyMembership(tx,"student");
      const personId=activeMember.personId;
      if(typeof personId!=="string")deny("failed-precondition","Link your verified school person record first.");
      checkId(personId,"Person ID",128);
      const personRef=db.doc(prefix+"people/"+personId);
      const enrollmentRef=db.doc(prefix+"enrollments/"+rowKey(personId,offeringId));
      const [currentTask,person,enrollment,current]=await Promise.all([
        tx.get(taskRef),tx.get(personRef),tx.get(enrollmentRef),tx.get(submissionRef)
      ]);
      if(!currentTask.exists||currentTask.data().schoolId!==ctx.schoolId||
         currentTask.data().submissionSource!==source||currentTask.data().status!=="deployed"||
         currentTask.data().published!==true||currentTask.data().offeringId!==offeringId)
        deny("failed-precondition","The assessment changed. Refresh before submitting.");
      if(!person.exists||person.data().schoolId!==ctx.schoolId||person.data().authUid!==ctx.uid||
         person.data().kind!=="student"||person.data().status!=="active"||
         !enrollment.exists||enrollment.data().schoolId!==ctx.schoolId||
         enrollment.data().personId!==personId||enrollment.data().offeringId!==offeringId||
         enrollment.data().status!=="active")
        deny("permission-denied","Student identity or enrollment changed.");
      const assessment=currentTask.data(),nowMillis=Date.now(),lifecycle=assessment.lifecycle||"active",
        revisionOpen=current.exists&&current.data().status==="reopened";
      if(["archived","cancelled"].includes(lifecycle))
        deny("failed-precondition","This assessment is no longer accepting submissions.");
      if(lifecycle==="closed"&&!revisionOpen)
        deny("failed-precondition","This assessment is closed to new submissions.");
      const revisionDeadline=revisionOpen?current.data().revisionDueAt?.toMillis?.()||0:0;
      if(nowMillis<assessment.opensAt.toMillis()||
         (nowMillis>assessment.dueAt.toMillis()&&nowMillis>revisionDeadline))
        deny("failed-precondition","The assessment submission window is not open.");
      let version=1;
      if(current.exists){
        const prior=current.data();
        if(prior.schoolId!==ctx.schoolId||prior.taskId!==taskId||
           prior.studentUid!==ctx.uid||prior.offeringId!==offeringId)
          deny("permission-denied","Stored submission belongs to another context.");
        if(prior.status==="submitted"&&prior.submissionDigest===digest){
          receipt={submissionId,version:prior.currentVersion,status:"submitted",alreadyExisted:true};return;
        }
        if(prior.status!=="reopened")
          deny("failed-precondition","A response is already submitted. Your teacher must request a revision before changes.");
        version=prior.currentVersion+1;
      }
      const when=FieldValue.serverTimestamp();
      const immutable={schoolId:ctx.schoolId,taskId,offeringId,studentUid:ctx.uid,personId,
        submissionSource:source,payload,submissionDigest:digest,version,submittedAt:when};
      tx.create(submissionRef.collection("versions").doc(String(version)),immutable);
      if(current.exists){
        tx.update(submissionRef,{...immutable,status:"submitted",currentVersion:version,
          revisionRequestMessage:null,revisionDueAt:null,reviewedAt:null,reviewedByUid:null,updatedAt:when});
      }else{
        tx.create(submissionRef,{...immutable,status:"submitted",currentVersion:version,
          createdAt:when,updatedAt:when});
      }
      tx.create(auditRef,{schoolId:ctx.schoolId,taskId,submissionId,studentUid:ctx.uid,
        action:version===1?"assessment_response_submitted":"assessment_response_resubmitted",
        source,version,submissionDigest:digest,createdAt:when});
      receipt={submissionId,version,status:"submitted",alreadyExisted:false};
    });
    if(!receipt.alreadyExisted)await writeSchoolNotification({
      db,schoolId:ctx.schoolId,uid:taskData.reviewerUid||taskData.ownerUid,
      id:"assessment_submission_"+taskId+"_"+ctx.uid+"_"+receipt.version,
      title:receipt.version>1?"Assessment response resubmitted":"Assessment response submitted",
      body:(taskData.title||"Assessment")+" · a student response is ready for review.",
      type:"submission",sourceId:taskId,target:"school-gradebook.html"
    }).catch(()=>{});
    return receipt;
  }

  if(!ctx.roles.includes("teacher"))deny("permission-denied","Teacher review access is required.");
  const grantRef=db.doc(prefix+"staff_assignments/"+rowKey(ctx.uid,offeringId));
  async function teacherReadAuthority(){
    const [member,grant,currentTask]=await Promise.all([memberRef.get(),grantRef.get(),taskRef.get()]);
    if(!member.exists||member.data().status!=="active"||member.data().schoolId!==ctx.schoolId||
       !Array.isArray(member.data().roles)||!member.data().roles.includes("teacher")||
       !grant.exists||grant.data().schoolId!==ctx.schoolId||grant.data().teacherUid!==ctx.uid||
       grant.data().offeringId!==offeringId||grant.data().status!=="active"||
       !currentTask.exists||currentTask.data().schoolId!==ctx.schoolId||
       (currentTask.data().reviewerUid||currentTask.data().ownerUid)!==ctx.uid||
       currentTask.data().submissionSource!==source)
      deny("permission-denied","Only the currently responsible assigned teacher may review this response.");
  }
  async function teacherWriteAuthority(tx){
    await verifyMembership(tx,"teacher");
    const [grant,currentTask]=await Promise.all([tx.get(grantRef),tx.get(taskRef)]);
    if(!grant.exists||grant.data().schoolId!==ctx.schoolId||grant.data().teacherUid!==ctx.uid||
       grant.data().offeringId!==offeringId||grant.data().status!=="active"||
       !currentTask.exists||currentTask.data().schoolId!==ctx.schoolId||
       (currentTask.data().reviewerUid||currentTask.data().ownerUid)!==ctx.uid||
       currentTask.data().submissionSource!==source)
      deny("permission-denied","Teacher review scope changed.");
    return currentTask.data();
  }
  await teacherReadAuthority();

  if(input.action==="inbox"){
    const snap=await collection.where("taskId","==",taskId).limit(101).get();
    if(snap.size===101)deny("resource-exhausted","Submission inbox requires pagination.");
    const rows=snap.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&doc.data().offeringId===offeringId);
    const people=await Promise.all(rows.map(doc=>db.doc(prefix+"people/"+doc.data().personId).get()));
    return {taskId,submissions:rows.map((doc,index)=>({
      submissionId:doc.id,studentUid:doc.data().studentUid,personId:doc.data().personId,
      studentName:people[index].exists&&people[index].data().schoolId===ctx.schoolId?
        people[index].data().displayName:"Student",
      status:doc.data().status,version:doc.data().currentVersion,
      submissionSource:source,updatedAt:doc.data().updatedAt?.toMillis?.()||null
    }))};
  }

  const targetId=checkId(input.submissionId,"Submission ID",128);
  const targetRef=collection.doc(targetId);
  if(input.action==="inspect"){
    const record=await targetRef.get();
    if(!record.exists||record.data().schoolId!==ctx.schoolId||record.data().taskId!==taskId||
       record.data().offeringId!==offeringId||record.data().submissionSource!==source)
      deny("not-found","Submission unavailable.");
    const data=record.data(),version=await targetRef.collection("versions").doc(String(data.currentVersion)).get();
    if(!version.exists||version.data().schoolId!==ctx.schoolId||
       version.data().submissionDigest!==data.submissionDigest||
       digestSubmission(source,version.data().payload)!==data.submissionDigest)
      deny("failed-precondition","The immutable submission version could not be verified.");
    return {submissionId:targetId,studentUid:data.studentUid,personId:data.personId,
      status:data.status,version:data.currentVersion,submissionSource:source,payload:data.payload,
      submissionDigest:data.submissionDigest,reopenReason:data.revisionRequestMessage||"",
      revisionDueAt:data.revisionDueAt?.toMillis?.()||null};
  }

  if(input.action==="request_revision"){
    const reason=String(input.reason||"").trim();
    if(reason.length<12||reason.length>2000)
      deny("invalid-argument","Explain the requested revision in 12–2000 characters.");
    const extension=extensionTimestamp(input.extensionDueAt);
    if(Date.now()>taskData.dueAt.toMillis()&&!extension)
      deny("failed-precondition","The original deadline passed. Set an explicit revision extension.");
    const auditRef=db.collection(prefix+"submission_audit").doc();
    let revisionStudentUid=null;
    await db.runTransaction(async tx=>{
      await teacherWriteAuthority(tx);
      const record=await tx.get(targetRef);
      if(!record.exists||record.data().schoolId!==ctx.schoolId||
         record.data().taskId!==taskId||record.data().offeringId!==offeringId||
         !["submitted","reviewed"].includes(record.data().status))
        deny("failed-precondition","Only a submitted response can be reopened.");
      revisionStudentUid=record.data().studentUid;
      const gradeRef=db.doc(prefix+"student_grades/"+hash(taskId,revisionStudentUid));
      const grade=await tx.get(gradeRef);
      if(grade.exists&&grade.data().status==="published")
        deny("failed-precondition","Published grades require a grade correction workflow, not submission reopening.");
      const when=FieldValue.serverTimestamp();
      tx.update(targetRef,{status:"reopened",revisionRequestMessage:reason,
        revisionDueAt:extension,updatedAt:when});
      tx.create(auditRef,{schoolId:ctx.schoolId,taskId,submissionId:targetId,
        actorUid:ctx.uid,studentUid:revisionStudentUid,action:"assessment_response_revision_requested",
        version:record.data().currentVersion,reason,createdAt:when});
    });
    if(revisionStudentUid)await writeSchoolNotification({
      db,schoolId:ctx.schoolId,uid:revisionStudentUid,
      id:"assessment_revision_"+taskId+"_"+targetId,
      title:"Assessment revision requested",
      body:(taskData.title||"Assessment")+" · your teacher requested a revised response.",
      type:"submission",sourceId:taskId,target:"student-assessments.html"
    }).catch(()=>{});
    return {submissionId:targetId,status:"reopened"};
  }

  deny("invalid-argument","Unknown general assessment submission operation.");
 };
}

module.exports={createSchoolAssessmentSubmissionService,digestSubmission,normalizePayload};
