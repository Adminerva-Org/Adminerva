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
      criteria:doc.data().criteria,feedback:doc.data().feedback,
      publishedAt:doc.data().publishedAt?.toMillis?.()||null}))};
  }
  if(!ctx.roles.includes("teacher"))deny("permission-denied","Gradebook teacher access is required.");
  const taskId=checkId(input.taskId,"Task ID",128),
   studentUid=checkId(input.studentUid,"Student UID",128);
  const taskRef=db.doc(prefix+"assessments/"+taskId);
  const submissionRef=db.doc(prefix+"studio_submissions/"+hash(ctx.schoolId,taskId,studentUid));
  const gradeRef=grades.doc(hash(taskId,studentUid));
  const task=await taskRef.get();
  if(!task.exists||task.data().schoolId!==ctx.schoolId||
     task.data().ownerUid!==ctx.uid||task.data().submissionSource!=="studio")
   deny("permission-denied","You cannot grade an assessment you do not own in this school.");
  const offeringId=task.data().offeringId;
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
   return {taskId,studentUid,currentVersion:submission.data().currentVersion,
    grade:grade.exists&&grade.data().schoolId===ctx.schoolId?{
      status:grade.data().status,criteria:grade.data().criteria,
      awarded:grade.data().awarded,total:grade.data().total,
      pending:grade.data().pending,feedback:grade.data().feedback,
      version:grade.data().submissionVersion,revision:grade.data().revision
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
    if(submission.status!=="submitted"&&submission.status!=="reviewed")
     deny("failed-precondition","Only the currently submitted revision may be graded.");
    if(submission.currentVersion!==submissionVersion)
     deny("failed-precondition","Student resubmitted. Refresh the frozen submission before grading.");
    const snapshot=await tx.get(submissionRef.collection("versions").doc(String(submissionVersion)));
    if(!snapshot.exists||snapshot.data().contentDigest!==submission.contentDigest||
       snapshot.data().contentDigest!==digestProject(snapshot.data().files,snapshot.data().artifacts||{}))
     deny("failed-precondition","The frozen submission evidence changed or is missing.");
    const scores=validateScores(input.criteria,task.rubric);
    const revision=grade.exists?(grade.data().revision||0)+1:1;
    if(grade.exists&&grade.data().status!=="draft")
     deny("failed-precondition","Only an unpublished draft may be revised.");
    const now=FieldValue.serverTimestamp();
    const values={schoolId:ctx.schoolId,taskId,offeringId,
     personId:submission.personId,studentUid,reviewerUid:ctx.uid,
     submissionId:submissionRef.id,submissionVersion,submissionDigest:submission.contentDigest,
     criteria:scores.criteria,awarded:scores.awarded,pending:scores.pending,total:scores.total,
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
  if(input.action==="publish"){
   const auditRef=db.collection(prefix+"grade_audit").doc();
   let result;
   await db.runTransaction(async tx=>{
    const {task,submission}=await authorize(tx);
    const grade=await tx.get(gradeRef);
    if(!grade.exists||grade.data().status!=="draft")
     deny("failed-precondition","Save and review an unpublished grade draft before publication.");
    const data=grade.data();
    if(submission.status!=="submitted"&&submission.status!=="reviewed")
     deny("failed-precondition","Student evidence was reopened or withdrawn; refresh before publishing.");
    if(data.submissionVersion!==submission.currentVersion||
       data.submissionDigest!==submission.contentDigest||
       data.studentUid!==studentUid||data.taskId!==taskId)
     deny("failed-precondition","The grade draft is stale relative to the student's frozen submission.");
    if(data.pending>0)deny("failed-precondition","Resolve pending rubric points before publishing a final grade.");
    const snapshot=await tx.get(submissionRef.collection("versions").doc(String(data.submissionVersion)));
    if(!snapshot.exists||snapshot.data().contentDigest!==submission.contentDigest||
       snapshot.data().contentDigest!==digestProject(snapshot.data().files,snapshot.data().artifacts||{}))
     deny("failed-precondition","The frozen student submission could not be verified.");
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
   return result;
  }
  deny("invalid-argument","Unknown Gradebook operation.");
 };
}
module.exports={createSchoolGradebookService,validateScores};
