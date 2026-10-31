"use strict";
/**
 * V4 Studio Gradebook: reviewer-private drafts and explicit publication of a
 * frozen submission version. V2 GitHub grading remains in legacy system
 * until a separate verified evidence adapter is migrated.
 */
const {FieldValue}=require("firebase-admin/firestore");
const {createHash}=require("node:crypto");
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");
const {rowKey,checkId}=require("./school-academics.js");
const {digestProject}=require("./school-studio-projects.js");
const {digestEvidence}=require("./school-github-evidence.js");
const {writeSchoolNotification}=require("./school-notifications.js");
const hash=(...values)=>createHash("sha256").update(JSON.stringify(values)).digest("hex");
function deny(code,message){throw new TenantAccessError(code,message)}
function validateScores(criteria,rubric){
 if(!Array.isArray(rubric)||!rubric.length||!Array.isArray(criteria)||
    criteria.length!==rubric.length)
  deny("invalid-argument","Every published rubric criterion needs a score breakdown.");
 let awarded=0,pending=0;
 const cleaned=criteria.map((item,index)=>{
  const maximum=Number(rubric[index].points);
  const value=item?.awardedPoints,awaiting=item?.pendingPoints;
  if(!Number.isFinite(maximum)||maximum<=0||
     typeof value!=="number"||!Number.isFinite(value)||value<0||
     typeof awaiting!=="number"||!Number.isFinite(awaiting)||awaiting<0||
     value+awaiting>maximum+0.000001)
   deny("invalid-argument","Criterion "+(index+1)+" exceeds its available points or has invalid pending points.");
  const comment=String(item.comment||"").trim();
  if(comment.length>1000)deny("invalid-argument","Criterion feedback is too long.");
  awarded+=value;pending+=awaiting;
  return {name:String(rubric[index].name),maximum,awardedPoints:value,pendingPoints:awaiting,comment};
 });
 return {criteria:cleaned,awarded,total:rubric.reduce((s,r)=>s+Number(r.points),0),pending};
}
function createSchoolGradebookService({db}){
 return async request=>{
  const input=request.data||{},ctx=await getSchoolContext({db,request,schoolId:input.schoolId});
  const prefix="schools/"+ctx.schoolId+"/";
  const schoolRef=db.doc("platform_schools/"+ctx.schoolId);
  const memberRef=db.doc(prefix+"memberships/"+ctx.uid);
  const grades=db.collection(prefix+"student_grades");
  if(input.action==="my_published"){
   if(!ctx.roles.includes("student"))deny("permission-denied","Student grade access is required.");
   const member=await memberRef.get(),personId=member.data()?.personId;
   if(!personId||member.data().status!=="active")
    deny("failed-precondition","Link your school identity before loading academic results.");
   const person=await db.doc(prefix+"people/"+checkId(personId,"Person ID",128)).get();
   if(!person.exists||person.data().schoolId!==ctx.schoolId||
      person.data().authUid!==ctx.uid||person.data().kind!=="student")
    deny("permission-denied","Your school identity is not verified.");
   const snap=await grades.where("studentUid","==",ctx.uid).limit(101).get();
   if(snap.size===101)deny("resource-exhausted","Published grade history requires pagination.");
   return {grades:snap.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&
      doc.data().status==="published"&&doc.data().personId===personId)
     .map(doc=>({gradeId:doc.id,taskId:doc.data().taskId,
      total:doc.data().total,awarded:doc.data().awarded,
      criteria:Array.isArray(doc.data().criteria)?doc.data().criteria:[],feedback:doc.data().feedback,
      gradeSchema:doc.data().gradeSchema||"rubric_v1",
      evidenceType:doc.data().evidenceType||"studio",revision:doc.data().revision,
      publishedAt:doc.data().publishedAt?.toMillis?.()||null,
      lastCorrectedAt:doc.data().lastCorrectedAt?.toMillis?.()||null}))};
  }
  if(!ctx.roles.includes("teacher"))deny("permission-denied","Gradebook teacher access is required.");
  const taskId=checkId(input.taskId,"Task ID",128),
   studentUid=checkId(input.studentUid,"Student UID",128);
  const taskRef=db.doc(prefix+"assessments/"+taskId);
  const gradeRef=grades.doc(hash(taskId,studentUid));
  const task=await taskRef.get();
  if(!task.exists||task.data().schoolId!==ctx.schoolId||task.data().ownerUid!==ctx.uid||
     !["studio","github"].includes(task.data().submissionSource))
   deny("permission-denied","You cannot grade an assessment you do not own in this school.");
  const source=task.data().submissionSource;
  const submissionRef=db.doc(prefix+
    (source==="studio"?"studio_submissions/":"github_evidence/")+
    hash(ctx.schoolId,taskId,studentUid));
  const offeringId=task.data().offeringId;
  const evidenceDigest=data=>source==="studio"?data.contentDigest:data.evidenceDigest;
  const gradeable=data=>source==="studio"?
    ["submitted","reviewed"].includes(data.status):["approved","reviewed"].includes(data.status);
  const verifyFrozen=snapshot=>{
    if(!snapshot.exists)return false;
    const data=snapshot.data();
    if(source==="studio")
      return data.contentDigest&&data.contentDigest===digestProject(data.files,data.artifacts||{});
    return data.evidenceDigest&&data.evidenceDigest===
      digestEvidence(data.repository,data.selectedCommitShas||[],data.checkpointSha);
  };
  const grantRef=db.doc(prefix+"staff_assignments/"+rowKey(ctx.uid,offeringId));
  async function authorize(tx){
   const [school,member,grant,currentTask,submission]=await Promise.all([
    tx.get(schoolRef),tx.get(memberRef),tx.get(grantRef),tx.get(taskRef),tx.get(submissionRef)
   ]);
   if(!school.exists||school.data().state!=="active"||!member.exists||
      member.data().status!=="active"||member.data().schoolId!==ctx.schoolId||
      !Array.isArray(member.data().roles)||!member.data().roles.includes("teacher")||
      !grant.exists||grant.data().status!=="active"||
      grant.data().teacherUid!==ctx.uid||grant.data().schoolId!==ctx.schoolId||
      grant.data().offeringId!==offeringId||!currentTask.exists||
      currentTask.data().schoolId!==ctx.schoolId||currentTask.data().ownerUid!==ctx.uid||
      !submission.exists||submission.data().schoolId!==ctx.schoolId||
      submission.data().taskId!==taskId||submission.data().studentUid!==studentUid||
      submission.data().offeringId!==offeringId)
    deny("permission-denied","Review permission, assessment, or student submission is no longer valid.");
   return {task:currentTask.data(),submission:submission.data()};
  }
  if(input.action==="get_draft"){
   const grant=await grantRef.get();
   if(!grant.exists||grant.data().status!=="active"||
      grant.data().schoolId!==ctx.schoolId||grant.data().teacherUid!==ctx.uid)
    deny("permission-denied","This task's grading rights are not assigned to you.");
   const [submission,grade]=await Promise.all([submissionRef.get(),gradeRef.get()]);
   if(!submission.exists||submission.data().schoolId!==ctx.schoolId||
      submission.data().taskId!==taskId||submission.data().studentUid!==studentUid)
    deny("not-found","Student submission is unavailable.");
   return {taskId,studentUid,evidenceType:source,currentVersion:submission.data().currentVersion,
    grade:grade.exists&&grade.data().schoolId===ctx.schoolId?{
      status:grade.data().status,evidenceType:grade.data().evidenceType||source,
      gradeSchema:grade.data().gradeSchema||"rubric_v1",criteria:Array.isArray(grade.data().criteria)?grade.data().criteria:[],
      awarded:grade.data().awarded,total:grade.data().total,
      pending:grade.data().pending,feedback:grade.data().feedback,
      version:grade.data().submissionVersion,revision:grade.data().revision,
      publishedAt:grade.data().publishedAt?.toMillis?.()||null,
      lastCorrectedAt:grade.data().lastCorrectedAt?.toMillis?.()||null
    }:null};
  }
  if(input.action==="save_draft"){
   const submissionVersion=input.submissionVersion;
   if(!Number.isInteger(submissionVersion)||submissionVersion<1)
    deny("invalid-argument","Choose the current frozen submission version.");
   const feedback=String(input.feedback||"").trim();
   if(feedback.length>5000)deny("invalid-argument","Teacher feedback is too long.");
   const auditRef=db.collection(prefix+"grade_audit").doc();
   await db.runTransaction(async tx=>{
    const {task,submission}=await authorize(tx);
    const grade=await tx.get(gradeRef);
    if(grade.exists&&grade.data().status==="published")
     deny("failed-precondition","Published grades require a formal correction workflow.");
    if(!gradeable(submission))
     deny("failed-precondition",source==="github"?
       "Teacher-approved GitHub evidence is required before grading.":
       "Only the currently submitted Studio revision may be graded.");
    if(submission.currentVersion!==submissionVersion)
     deny("failed-precondition","Student resubmitted. Refresh the frozen submission before grading.");
    const snapshot=await tx.get(submissionRef.collection("versions").doc(String(submissionVersion)));
    if(!snapshot.exists||evidenceDigest(snapshot.data())!==evidenceDigest(submission)||!verifyFrozen(snapshot))
     deny("failed-precondition","The frozen assessment evidence changed or is missing.");
    const scores=validateScores(input.criteria,task.rubric);
    const revision=grade.exists?(grade.data().revision||0)+1:1;
    if(grade.exists&&grade.data().status!=="draft")
     deny("failed-precondition","Only an unpublished draft may be revised.");
    const now=FieldValue.serverTimestamp();
    const values={schoolId:ctx.schoolId,taskId,offeringId,
     personId:submission.personId,studentUid,reviewerUid:ctx.uid,
     evidenceType:source,submissionId:submissionRef.id,submissionVersion,submissionDigest:evidenceDigest(submission),
     gradeSchema:"rubric_v1",criteria:scores.criteria,awarded:scores.awarded,pending:scores.pending,total:scores.total,
     feedback,status:"draft",revision,updatedAt:now};
    if(grade.exists)tx.update(gradeRef,values);
    else tx.create(gradeRef,{...values,createdAt:now});
    tx.create(gradeRef.collection("revisions").doc(String(revision)),{
     ...values,createdAt:now,action:"teacher_draft_saved"
    });
    tx.create(auditRef,{schoolId:ctx.schoolId,taskId,studentUid,actorUid:ctx.uid,
     action:"grade_draft_saved",revision,createdAt:now});
   });
   return {taskId,studentUid,status:"draft"};
  }
  if(input.action==="convert_legacy_published"){
   const expectedRevision=input.expectedRevision;
   if(!Number.isInteger(expectedRevision)||expectedRevision<1)
    deny("invalid-argument","The imported grade revision is required.");
   const reason=String(input.reason||"").trim();
   if(reason.length<12||reason.length>2000)
    deny("invalid-argument","Explain the historical rubric reconstruction in 12–2,000 characters.");
   const auditRef=db.collection(prefix+"grade_audit").doc();
   let result;
   await db.runTransaction(async tx=>{
    const {task,submission}=await authorize(tx);
    const grade=await tx.get(gradeRef);
    if(!grade.exists||grade.data().status!=="published"||grade.data().gradeSchema!=="legacy_scalar_v1")
     deny("failed-precondition","Only a published imported scalar grade can use historical rubric reconstruction.");
    const previous=grade.data();
    if(previous.revision!==expectedRevision)
     deny("failed-precondition","This historical grade changed. Reload it before reconstructing the rubric.");
    if(previous.evidenceType!==source||previous.submissionVersion!==submission.currentVersion||
       previous.submissionDigest!==evidenceDigest(submission)||submission.status!=="reviewed")
     deny("failed-precondition","The historical grade is no longer bound to the current reviewed evidence.");
    const snapshot=await tx.get(submissionRef.collection("versions").doc(String(previous.submissionVersion)));
    if(!snapshot.exists||evidenceDigest(snapshot.data())!==evidenceDigest(submission)||!verifyFrozen(snapshot))
     deny("failed-precondition","The frozen historical evidence could not be verified.");
    const scores=validateScores(input.criteria,task.rubric);
    if(scores.pending>0)
     deny("failed-precondition","Historical rubric reconstruction cannot leave pending points.");
    if(Math.abs(scores.awarded-Number(previous.awarded))>0.000001||
       Math.abs(scores.total-Number(previous.total))>0.000001)
     deny("failed-precondition","Rubric reconstruction must preserve the exact historical score and maximum. Convert first, then use a separate correction if the published score must change.");
    const now=FieldValue.serverTimestamp(),revision=previous.revision+1;
    const converted={gradeSchema:"rubric_v1",criteria:scores.criteria,pending:0,
      revision,updatedAt:now,legacyScalarConvertedAt:now,legacyScalarConvertedByUid:ctx.uid};
    tx.update(gradeRef,converted);
    tx.create(gradeRef.collection("revisions").doc(String(revision)),{
      ...previous,...converted,status:"published",action:"legacy_grade_breakdown_converted",
      conversionReason:reason,previousRevision:expectedRevision,createdAt:now
    });
    tx.create(auditRef,{schoolId:ctx.schoolId,taskId,studentUid,actorUid:ctx.uid,
      action:"legacy_grade_breakdown_converted",reason,previousRevision:expectedRevision,
      revision,awarded:previous.awarded,total:previous.total,createdAt:now});
    result={taskId,studentUid,status:"published",revision,awarded:previous.awarded,
      total:previous.total,converted:true};
   });
   return result;
  }
  if(input.action==="correct_published"){
   const expectedRevision=input.expectedRevision;
   if(!Number.isInteger(expectedRevision)||expectedRevision<1)
    deny("invalid-argument","The currently published grade revision is required.");
   const reason=String(input.reason||"").trim();
   if(reason.length<12||reason.length>2000)
    deny("invalid-argument","Explain the published-grade correction in 12–2000 characters.");
   const feedback=String(input.feedback||"").trim();
   if(feedback.length>5000)deny("invalid-argument","Teacher feedback is too long.");
   const auditRef=db.collection(prefix+"grade_audit").doc();
   let result;
   await db.runTransaction(async tx=>{
    const {task,submission}=await authorize(tx);
    const grade=await tx.get(gradeRef);
    if(!grade.exists||grade.data().status!=="published")
     deny("failed-precondition","Only a published grade may use the correction workflow.");
    const previous=grade.data();
    if(previous.gradeSchema==="legacy_scalar_v1")
     deny("failed-precondition","This imported historical grade has no saved criterion breakdown. Convert its rubric breakdown without changing the historical total before using the correction workflow.");
    if(previous.revision!==expectedRevision)
     deny("failed-precondition","This published grade changed. Reload it before recording a correction.");
    if(previous.evidenceType!==source||previous.submissionVersion!==submission.currentVersion||
       previous.submissionDigest!==evidenceDigest(submission)||
       submission.status!=="reviewed")
     deny("failed-precondition","The published grade is no longer bound to the current reviewed submission.");
    const snapshot=await tx.get(submissionRef.collection("versions").doc(String(previous.submissionVersion)));
    if(!snapshot.exists||evidenceDigest(snapshot.data())!==evidenceDigest(submission)||!verifyFrozen(snapshot))
     deny("failed-precondition","The frozen student evidence could not be verified.");
    const scores=validateScores(input.criteria,task.rubric);
    if(scores.pending>0)
     deny("failed-precondition","Published-grade corrections cannot leave pending rubric points.");
    const now=FieldValue.serverTimestamp(),revision=previous.revision+1;
    const corrected={gradeSchema:"rubric_v1",criteria:scores.criteria,awarded:scores.awarded,pending:0,total:scores.total,
      feedback,revision,updatedAt:now,lastCorrectedAt:now,lastCorrectedByUid:ctx.uid};
    tx.update(gradeRef,corrected);
    tx.create(gradeRef.collection("revisions").doc(String(revision)),{
      ...previous,...corrected,status:"published",action:"grade_corrected",
      correctionReason:reason,previousRevision:expectedRevision,createdAt:now
    });
    tx.create(auditRef,{schoolId:ctx.schoolId,taskId,studentUid,actorUid:ctx.uid,
      action:"grade_corrected",reason,previousRevision:expectedRevision,revision,createdAt:now});
    result={taskId,studentUid,status:"published",revision,
      awarded:scores.awarded,total:scores.total,corrected:true};
   });
   await writeSchoolNotification({
     db,schoolId:ctx.schoolId,uid:studentUid,
     id:"grade_corrected_"+taskId+"_"+String(result.revision),
     title:"Published grade updated",
     body:(task.data().title||"Assessment")+" · your teacher recorded a reviewed grade correction.",
     type:"grade",sourceId:taskId,target:"student-assessments.html"
   }).catch(()=>{});
   return result;
  }
  if(input.action==="publish"){
   const auditRef=db.collection(prefix+"grade_audit").doc();
   let result;
   await db.runTransaction(async tx=>{
    const {task,submission}=await authorize(tx);
    const grade=await tx.get(gradeRef);
    if(!grade.exists||grade.data().status!=="draft")
     deny("failed-precondition","Save and review an unpublished grade draft before publication.");
    const data=grade.data();
    if(!gradeable(submission))
     deny("failed-precondition","Student evidence is no longer in an approved grading state; refresh before publishing.");
    if(data.evidenceType!==source||data.submissionVersion!==submission.currentVersion||
       data.submissionDigest!==evidenceDigest(submission)||
       data.studentUid!==studentUid||data.taskId!==taskId)
     deny("failed-precondition","The grade draft is stale relative to the student's frozen submission.");
    if(data.pending>0)deny("failed-precondition","Resolve pending rubric points before publishing a final grade.");
    const snapshot=await tx.get(submissionRef.collection("versions").doc(String(data.submissionVersion)));
    if(!snapshot.exists||evidenceDigest(snapshot.data())!==evidenceDigest(submission)||!verifyFrozen(snapshot))
     deny("failed-precondition","The frozen student evidence could not be verified.");
    const now=FieldValue.serverTimestamp(),revision=data.revision+1;
    tx.update(gradeRef,{status:"published",publishedAt:now,publishedByUid:ctx.uid,
      revision,updatedAt:now});
    tx.update(submissionRef,{status:"reviewed",reviewedByUid:ctx.uid,
      reviewedVersion:data.submissionVersion,updatedAt:now});
    tx.create(gradeRef.collection("revisions").doc(String(revision)),{
     ...data,status:"published",revision,publishedAt:now,publishedByUid:ctx.uid,
     action:"grade_published",createdAt:now
    });
    tx.create(auditRef,{schoolId:ctx.schoolId,taskId,studentUid,actorUid:ctx.uid,
      action:"grade_published",revision,createdAt:now});
    result={taskId,studentUid,status:"published",awarded:data.awarded,total:data.total};
   });
   await writeSchoolNotification({
     db,schoolId:ctx.schoolId,uid:studentUid,
     id:"grade_published_"+taskId+"_"+String(result.awarded)+"_"+String(result.total),
     title:"Grade published",
     body:(task.data().title||"Assessment")+" · your reviewed result is now available.",
     type:"grade",sourceId:taskId,target:"student-assessments.html"
   }).catch(()=>{});
   return result;
  }
  deny("invalid-argument","Unknown Gradebook operation.");
 };
}
module.exports={createSchoolGradebookService,validateScores};
