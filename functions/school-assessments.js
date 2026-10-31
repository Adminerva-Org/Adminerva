"use strict";
/**
 * V4 school-scoped assessment deployments and student assignment discovery.
 * Deployments freeze student-facing blueprint content and the assigned offering.
 * This does NOT write grades, approve evidence or accept Studio/GitHub submissions.
 */
const {createHash}=require("node:crypto");
const {Timestamp,FieldValue}=require("firebase-admin/firestore");
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");
const {rowKey,checkId}=require("./school-academics.js");
function deny(code,message){throw new TenantAccessError(code,message)}
function timestamp(value,label){
 if(typeof value!=="string"||!/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(value)||
   !/(Z|[+-]\d\d:\d\d)$/.test(value))deny("invalid-argument",label+" must include a timezone.");
 const millis=Date.parse(value);
 if(!Number.isFinite(millis))deny("invalid-argument",label+" is invalid.");
 return Timestamp.fromMillis(millis);
}
function createSchoolAssessmentService({db}){
 return async request=>{
  const input=request.data||{},ctx=await getSchoolContext({db,request,schoolId:input.schoolId});
  const prefix="schools/"+ctx.schoolId+"/";
  const schoolRef=db.doc("platform_schools/"+ctx.schoolId);
  const membershipRef=db.doc(prefix+"memberships/"+ctx.uid);
  const tasks=db.collection(prefix+"assessments");
  if(input.action==="deploy"){
   if(!ctx.roles.includes("teacher"))deny("permission-denied","An authorized teacher must deploy the assessment.");
   const blueprintId=checkId(input.blueprintId,"Blueprint ID",128);
   const offeringId=checkId(input.offeringId,"Course offering ID",330);
   const key=checkId(input.requestKey,"Request key",100);
   const source=input.submissionSource;
   if(!["studio","github"].includes(source))
    deny("invalid-argument","Choose Adminerva Studio or GitHub evidence.");
   const start=timestamp(input.opensAt,"Opening time");
   const end=timestamp(input.dueAt,"Deadline");
   if(end.toMillis()<=start.toMillis())
    deny("invalid-argument","The deadline must follow the opening time.");
   const taskId=createHash("sha256")
    .update(JSON.stringify([ctx.schoolId,ctx.uid,blueprintId,offeringId,key]))
    .digest("hex");
   const taskRef=tasks.doc(taskId);
   const offeringRef=db.doc(prefix+"course_offerings/"+offeringId);
   const grantRef=db.doc(prefix+"staff_assignments/"+rowKey(ctx.uid,offeringId));
   const blueprintRef=db.doc(prefix+"assessment_blueprints/"+blueprintId);
   const auditRef=db.collection(prefix+"assessment_audit").doc();
   let result=null;
   await db.runTransaction(async tx=>{
    const [school,membership,offering,grant,blueprint,existing]=await Promise.all([
     tx.get(schoolRef),tx.get(membershipRef),tx.get(offeringRef),tx.get(grantRef),
     tx.get(blueprintRef),tx.get(taskRef)
    ]);
    if(!school.exists||school.data().state!=="active"||!membership.exists||
       membership.data().status!=="active"||membership.data().schoolId!==ctx.schoolId||
       !Array.isArray(membership.data().roles)||!membership.data().roles.includes("teacher"))
      deny("permission-denied","Your school teaching access is no longer active.");
    if(!offering.exists||offering.data().schoolId!==ctx.schoolId||
       offering.data().status!=="active")
      deny("failed-precondition","Select an active school course offering.");
    if(!grant.exists||grant.data().schoolId!==ctx.schoolId||
       grant.data().teacherUid!==ctx.uid||grant.data().offeringId!==offeringId||
       grant.data().status!=="active")
      deny("permission-denied","You are not assigned to teach this course offering.");
    if(!blueprint.exists||blueprint.data().schoolId!==ctx.schoolId||
       blueprint.data().ownerUid!==ctx.uid||blueprint.data().status!=="draft")
      deny("permission-denied","Deploy only your own active assessment blueprint or independent copy.");
    const original=blueprint.data();
    if(existing.exists){
      const prior=existing.data();
      if(prior.schoolId===ctx.schoolId&&prior.ownerUid===ctx.uid&&
        prior.blueprintId===blueprintId&&prior.offeringId===offeringId&&
        prior.requestKey===key&&prior.submissionSource===source&&
        prior.opensAt.toMillis()===start.toMillis()&&prior.dueAt.toMillis()===end.toMillis())
       {result={taskId,status:"deployed",alreadyExisted:true};return;}
      deny("already-exists","This deployment request was already used with different details.");
    }
    // Only non-confidential blueprint fields; copy by value, never reference mutable
    // private answer keys or share grants in a student-visible deployment.
    const frozen={
     title:original.title,description:original.description||"",
     instructions:original.instructions||"",
     rubric:Array.isArray(original.rubric)?original.rubric:[],
     rubricMax:Array.isArray(original.rubric)?
       original.rubric.reduce((sum,row)=>sum+Number(row.points||0),0):0
    };
    if(!frozen.title||!frozen.rubric.length||frozen.rubricMax<=0||frozen.rubricMax>2000)
      deny("failed-precondition","The blueprint must have a valid title and rubric.");
    const now=FieldValue.serverTimestamp();
    tx.create(taskRef,{
     ...frozen,schoolId:ctx.schoolId,ownerUid:ctx.uid,
     blueprintId,blueprintRevision:original.contentRevision,
     offeringId,yearId:offering.data().yearId,termId:offering.data().termId,
     subjectId:offering.data().subjectId,sectionId:offering.data().sectionId,
     submissionSource:source,opensAt:start,dueAt:end,
     requestKey:key,status:"deployed",createdAt:now
    });
    tx.create(auditRef,{schoolId:ctx.schoolId,taskId,actorUid:ctx.uid,
     action:"assessment_deployed",offeringId,source,createdAt:now});
    result={taskId,status:"deployed",alreadyExisted:false};
   });
   return result;
  }
  if(input.action==="list_teacher"){
   if(!ctx.roles.includes("teacher"))deny("permission-denied","Teacher access is required.");
   const snap=await tasks.where("ownerUid","==",ctx.uid).limit(100).get();
   return {assessments:snap.docs.filter(doc=>doc.data().schoolId===ctx.schoolId)
    .map(doc=>({taskId:doc.id,title:doc.data().title,description:doc.data().description||"",
      instructions:doc.data().instructions||"",rubric:doc.data().rubric||[],
      rubricMax:doc.data().rubricMax||0,offeringId:doc.data().offeringId,
      yearId:doc.data().yearId,termId:doc.data().termId,
      subjectId:doc.data().subjectId,sectionId:doc.data().sectionId,
      opensAt:doc.data().opensAt?.toMillis(),dueAt:doc.data().dueAt?.toMillis(),
      submissionSource:doc.data().submissionSource,status:doc.data().status}))};
  }
  if(input.action==="list_student"){
   if(!ctx.roles.includes("student"))deny("permission-denied","Student access is required.");
   const member=await membershipRef.get();
   const personId=member.data()?.personId;
   if(!personId||member.data()?.status!=="active")
    deny("failed-precondition","Your verified school person record must be linked before assignments are available.");
   checkId(personId,"Student person ID",128);
   const person=await db.doc(prefix+"people/"+personId).get();
   if(!person.exists||person.data().schoolId!==ctx.schoolId||
     person.data().kind!=="student"||person.data().authUid!==ctx.uid)
    deny("permission-denied","Student identity and school membership do not match.");
   const enrollments=await db.collection(prefix+"enrollments")
     .where("personId","==",personId).limit(101).get();
   if(enrollments.size===101)deny("resource-exhausted","Your enrollment history needs pagination.");
   const offered=[...new Set(enrollments.docs.filter(doc=>
    doc.data().schoolId===ctx.schoolId&&doc.data().status==="active")
     .map(doc=>doc.data().offeringId))];
   const results=[];
   for(let offset=0;offset<offered.length;offset+=30) {
    const ids=offered.slice(offset,offset+30);
    if(!ids.length)continue;
    const snap=await tasks.where("offeringId","in",ids).limit(100).get();
    if(snap.size===100)deny("resource-exhausted","Too many assigned assessments. A paginated class view is required.");
    for(const doc of snap.docs){
     const task=doc.data();
     if(task.schoolId!==ctx.schoolId||task.status!=="deployed"||!offered.includes(task.offeringId))continue;
     const now=Date.now(),open=task.opensAt.toMillis(),due=task.dueAt.toMillis();
     results.push({taskId:doc.id,title:task.title,description:task.description||"",
      instructions:task.instructions||"",rubric:task.rubric||[],
      rubricMax:task.rubricMax,offeringId:task.offeringId,
      submissionSource:task.submissionSource,opensAt:open,dueAt:due,
      windowStatus:now<open?"upcoming":now>due?"closed":"open"});
    }
   }
   return {assignments:results.sort((a,b)=>a.dueAt-b.dueAt)};
  }
  deny("invalid-argument","Unknown school assessment operation.");
 };
}
module.exports={createSchoolAssessmentService,timestamp};
