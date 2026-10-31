"use strict";
/**
 * Student Studio assessment handoff with immutable server-frozen versions.
 * Independent of live 3.0 Studio/Gradebook until the tenant cutover.
 */
const {createHash}=require("node:crypto");
const {FieldValue,Timestamp}=require("firebase-admin/firestore");
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");
const {rowKey,checkId}=require("./school-academics.js");
const {digestFiles}=require("./school-studio-projects.js");
function deny(code,message){throw new TenantAccessError(code,message)}
const hash=(...values)=>createHash("sha256").update(JSON.stringify(values)).digest("hex");
function createSchoolStudioSubmissionService({db}){
 return async request=>{
  const input=request.data||{},ctx=await getSchoolContext({db,request,schoolId:input.schoolId});
  const taskId=checkId(input.taskId,"Assessment task",128);
  const prefix="schools/"+ctx.schoolId+"/";
  const taskRef=db.doc(prefix+"assessments/"+taskId);
  const schoolRef=db.doc("platform_schools/"+ctx.schoolId);
  const membershipRef=db.doc(prefix+"memberships/"+ctx.uid);
  const submissions=db.collection(prefix+"studio_submissions");
  async function verifySchool(tx,role){
   const [school,member]=await Promise.all([tx.get(schoolRef),tx.get(membershipRef)]);
   if(!school.exists||school.data().state!=="active"||!member.exists||
      member.data().status!=="active"||member.data().schoolId!==ctx.schoolId||
      !Array.isArray(member.data().roles)||!member.data().roles.includes(role))
    deny("permission-denied","School membership changed. Refresh access before continuing.");
   return member.data();
  }
  const task=await taskRef.get();
  if(!task.exists||task.data().schoolId!==ctx.schoolId||
     task.data().submissionSource!=="studio"||task.data().status!=="deployed")
   deny("not-found","This school's Studio assessment is unavailable.");
  const offeringId=task.data().offeringId;
  if(input.action==="submit"||input.action==="my_status"){
   if(!ctx.roles.includes("student"))deny("permission-denied","Student permission is required.");
   const membership=await membershipRef.get();
   const personId=membership.data()?.personId;
   if(typeof personId!=="string")deny("failed-precondition","Link your verified school person record before submitting.");
   checkId(personId,"Person ID",128);
   const personRef=db.doc(prefix+"people/"+personId);
   const enrollmentRef=db.doc(prefix+"enrollments/"+rowKey(personId,offeringId));
   const submissionId=hash(ctx.schoolId,taskId,ctx.uid);
   const submissionRef=submissions.doc(submissionId);
   if(input.action==="my_status"){
    const [person,enrollment,submission]=await Promise.all([
     personRef.get(),enrollmentRef.get(),submissionRef.get()
    ]);
    if(!person.exists||person.data().schoolId!==ctx.schoolId||
      person.data().authUid!==ctx.uid||person.data().kind!=="student"||
      !enrollment.exists||enrollment.data().schoolId!==ctx.schoolId||
      enrollment.data().personId!==personId||enrollment.data().offeringId!==offeringId)
     deny("permission-denied","You do not have a verified enrollment in this course.");
    return {taskId,submitted:submission.exists,
      status:submission.exists?submission.data().status:"not_submitted",
      version:submission.exists?submission.data().currentVersion:0,
      revisionRequested:submission.exists&&submission.data().status==="reopened",
      requestMessage:submission.exists&&submission.data().status==="reopened"?
       submission.data().revisionRequestMessage||"":"",
      revisionDueAt:submission.exists&&submission.data().status==="reopened"?
       submission.data().revisionDueAt?.toMillis?.()||null:null};
   }
   const projectId=checkId(input.projectId,"Studio project",128);
   const revision=input.projectRevision;
   if(!Number.isInteger(revision)||revision<1)
    deny("invalid-argument","Save the current project revision before submitting.");
   const projectRef=db.doc(prefix+"student_code_projects/"+ctx.uid+"/projects/"+projectId);
   const auditRef=db.collection(prefix+"submission_audit").doc();
   let receipt;
   await db.runTransaction(async tx=>{
    const [activeMember,person,enrollment,currentTask,project,submission]=await Promise.all([
     verifySchool(tx,"student"),tx.get(personRef),tx.get(enrollmentRef),
     tx.get(taskRef),tx.get(projectRef),tx.get(submissionRef)
    ]);
    if(activeMember.personId!==personId||!person.exists||person.data().authUid!==ctx.uid||
       person.data().schoolId!==ctx.schoolId||person.data().status!=="active"||
       person.data().kind!=="student"||!enrollment.exists||
       enrollment.data().schoolId!==ctx.schoolId||enrollment.data().personId!==personId||
       enrollment.data().offeringId!==offeringId||enrollment.data().status!=="active")
     deny("permission-denied","Student enrollment or identity changed.");
    const assessment=currentTask.data();
    if(!currentTask.exists||assessment.schoolId!==ctx.schoolId||
       assessment.submissionSource!=="studio"||assessment.status!=="deployed"||
       assessment.offeringId!==offeringId)
     deny("failed-precondition","The assigned Studio assessment is no longer available.");
    const now=Date.now();
    const revisionDeadline=submission.exists&&submission.data().status==="reopened"?
      submission.data().revisionDueAt?.toMillis?.()||0:0;
    if(now<assessment.opensAt.toMillis()||
       (now>assessment.dueAt.toMillis()&&now>revisionDeadline))
     deny("failed-precondition","The Studio submission deadline has passed. Ask your teacher for an explicit revision extension.");
    if(!project.exists||project.data().schoolId!==ctx.schoolId||
       project.data().ownerUid!==ctx.uid)
     deny("permission-denied","Choose one of your saved school Studio projects.");
    if(project.data().revision!==revision)
     deny("failed-precondition","Project changed. Save the latest revision before submitting.");
    const files=project.data().files;
    if(!Array.isArray(files)||project.data().contentDigest!==digestFiles(files))
     deny("failed-precondition","The saved project checksum could not be verified.");
    let version=1;
    if(submission.exists){
     const prior=submission.data();
     if(prior.schoolId!==ctx.schoolId||prior.studentUid!==ctx.uid||
        prior.taskId!==taskId||prior.offeringId!==offeringId)
      deny("permission-denied","The stored submission belongs to a different context.");
     if(prior.status==="submitted"&&prior.projectId===projectId&&
       prior.projectRevision===revision){
      receipt={submissionId,version:prior.currentVersion,status:"submitted",alreadyExisted:true};return;
     }
     if(prior.status!=="reopened")
      deny("failed-precondition","This assessment is already submitted. Your teacher must request a revision first.");
     version=prior.currentVersion+1;
    }
    const versionRef=submissionRef.collection("versions").doc(String(version));
    const frozenDigest=digestFiles(files),when=FieldValue.serverTimestamp();
    tx.create(versionRef,{schoolId:ctx.schoolId,taskId,studentUid:ctx.uid,personId,
      projectId,projectRevision:revision,files,contentDigest:frozenDigest,
      sourceLanguage:project.data().language,submittedAt:when,version});
    if(submission.exists){
     tx.update(submissionRef,{status:"submitted",currentVersion:version,
       projectId,projectRevision:revision,contentDigest:frozenDigest,
       revisionRequestMessage:null,revisionDueAt:null,updatedAt:when});
    }else{
     tx.create(submissionRef,{schoolId:ctx.schoolId,taskId,offeringId,studentUid:ctx.uid,
       personId,projectId,projectRevision:revision,contentDigest:frozenDigest,
       status:"submitted",currentVersion:version,createdAt:when,updatedAt:when});
    }
    tx.create(auditRef,{schoolId:ctx.schoolId,taskId,submissionId,studentUid:ctx.uid,
      action:version===1?"studio_submitted":"studio_resubmitted",version,createdAt:when});
    receipt={submissionId,version,status:"submitted",alreadyExisted:false};
   });
   return receipt;
  }
  if(!ctx.roles.includes("teacher"))
   deny("permission-denied","Teacher review access is required.");
  const assignmentRef=db.doc(prefix+"staff_assignments/"+rowKey(ctx.uid,offeringId));
  const isAuthorized=async tx=>{
   const member=await verifySchool(tx,"teacher");
   const [currentTask,grant]=await Promise.all([tx.get(taskRef),tx.get(assignmentRef)]);
   if(!currentTask.exists||currentTask.data().ownerUid!==ctx.uid||
      currentTask.data().schoolId!==ctx.schoolId||!grant.exists||
      grant.data().teacherUid!==ctx.uid||grant.data().offeringId!==offeringId||
      grant.data().schoolId!==ctx.schoolId||grant.data().status!=="active")
    deny("permission-denied","Only the assessment-owning authorized teacher may review this class task.");
   return member;
  };
  // Verify course rights for reads as well, not only in mutation transactions.
  const [grant,member]=await Promise.all([assignmentRef.get(),membershipRef.get()]);
  if(task.data().ownerUid!==ctx.uid||!grant.exists||
    grant.data().schoolId!==ctx.schoolId||grant.data().teacherUid!==ctx.uid||
    grant.data().offeringId!==offeringId||grant.data().status!=="active"||
    !member.exists||member.data().status!=="active")
   deny("permission-denied","This task's review is not assigned to you.");
  if(input.action==="inbox"){
   const snap=await submissions.where("taskId","==",taskId).limit(101).get();
   if(snap.size===101)deny("resource-exhausted","Submission inbox requires pagination.");
   return {taskId,submissions:snap.docs.filter(d=>
    d.data().schoolId===ctx.schoolId&&d.data().offeringId===offeringId)
    .map(d=>({submissionId:d.id,personId:d.data().personId,
      status:d.data().status,version:d.data().currentVersion,
      updatedAt:d.data().updatedAt?.toMillis?.()||null}))};
  }
  const submissionId=checkId(input.submissionId,"Submission ID",128);
  const submissionRef=submissions.doc(submissionId);
  if(input.action==="inspect"){
   const submission=await submissionRef.get();
   if(!submission.exists||submission.data().schoolId!==ctx.schoolId||
      submission.data().offeringId!==offeringId||submission.data().taskId!==taskId)
    deny("not-found","Submission unavailable.");
   const version=submission.data().currentVersion;
   const snapshot=await submissionRef.collection("versions").doc(String(version)).get();
   if(!snapshot.exists||snapshot.data().schoolId!==ctx.schoolId||
     snapshot.data().contentDigest!==digestFiles(snapshot.data().files))
    deny("failed-precondition","Frozen submission content is not verifiable.");
   return {submissionId,taskId,status:submission.data().status,version,
     files:snapshot.data().files,contentDigest:snapshot.data().contentDigest,
     language:snapshot.data().sourceLanguage};
  }
  if(input.action==="request_revision"){
   const reason=String(input.reason||"").trim();
   if(reason.length<12||reason.length>2000)
    deny("invalid-argument","Explain the requested revision in 12–2000 characters.");
   let extensionDueAt=null;
   if(input.extensionDueAt!==undefined&&input.extensionDueAt!==null&&input.extensionDueAt!==""){
    const raw=input.extensionDueAt;
    if(typeof raw!=="string"||!/(Z|[+-]\d\d:\d\d)$/.test(raw))
      deny("invalid-argument","Revision extension must include an explicit timezone.");
    const until=Date.parse(raw);
    if(!Number.isFinite(until)||until<=Date.now()||until>Date.now()+30*86400000)
      deny("invalid-argument","Choose a future revision deadline no more than 30 days from now.");
    extensionDueAt=Timestamp.fromMillis(until);
   }
   if(Date.now()>task.data().dueAt.toMillis()&&!extensionDueAt)
    deny("failed-precondition","The original deadline passed. Set an explicit revision extension before reopening.");
   const auditRef=db.collection(prefix+"submission_audit").doc();
   await db.runTransaction(async tx=>{
    await isAuthorized(tx);
    const submission=await tx.get(submissionRef);
    if(!submission.exists||submission.data().schoolId!==ctx.schoolId||
       submission.data().taskId!==taskId||submission.data().offeringId!==offeringId||
       !["submitted","reviewed"].includes(submission.data().status))
     deny("failed-precondition","Only a submitted, unpublished revision can be reopened.");
    // Grade publication is a separate guarded service; if a published grade
    // exists, this operation must fail closed and require formal correction.
    const gradeRef=db.doc(prefix+"student_grades/"+hash(taskId,submission.data().studentUid));
    const grade=await tx.get(gradeRef);
    if(grade.exists&&grade.data().publishedAt)
     deny("failed-precondition","Published grades cannot be reopened without the correction workflow.");
    const now=FieldValue.serverTimestamp();
    tx.update(submissionRef,{status:"reopened",revisionRequestMessage:reason,
      revisionDueAt:extensionDueAt,revisionRequestedByUid:ctx.uid,updatedAt:now});
    tx.create(auditRef,{schoolId:ctx.schoolId,taskId,submissionId,
      actorUid:ctx.uid,action:"studio_revision_requested",createdAt:now});
   });
   return {submissionId,status:"reopened"};
  }
  deny("invalid-argument","Unknown Studio submission operation.");
 };
}
module.exports={createSchoolStudioSubmissionService};
