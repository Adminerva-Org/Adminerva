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
const {digestSubmission}=require("./school-assessment-submissions.js");
const {writeSchoolNotification}=require("./school-notifications.js");
const {studentRecordUidAllowed}=require("./student-account-history.js");
const hash=(...values)=>createHash("sha256").update(JSON.stringify(values)).digest("hex");
function deny(code,message){throw new TenantAccessError(code,message)}
const DRAFT_SOURCES=new Set(["teacher","internal_ai","external_ai"]);
function githubHasSubmission(data){
 return Boolean(data?.submittedAt)&&
   Array.isArray(data?.selectedCommitShas)&&
   data.selectedCommitShas.length>0&&
   ["submitted","approved","reviewed"].includes(data?.status);
}
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
function validatedBulkLinkReview(source,input){
 // A frozen HTTPS link proves that a URL was submitted, not what it shows.
 // Bulk AI scoring requires the teacher's per-student review of the actual link.
 const note=String(input?.artifactReviewNote||"").trim();
 if(source==="link"&&(input?.onlyIfUngraded===true||input?.expectedDraftRevision!==undefined)&&
    (input.externalArtifactVerified!==true||note.length<15||note.length>3000))
  deny("failed-precondition","Bulk grading of an external submission link requires individual teacher artifact verification and a 15–3000 character review note.");
 return note;
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
   const snap=await grades.where("personId","==",personId).limit(101).get();
   if(snap.size===101)deny("resource-exhausted","Published grade history requires pagination.");
   return {grades:snap.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&
      doc.data().status==="published"&&doc.data().personId===personId&&
      studentRecordUidAllowed(person.data(),ctx.uid,doc.data().studentUid))
     .map(doc=>({gradeId:doc.id,taskId:doc.data().taskId,
      total:doc.data().total,awarded:doc.data().awarded,
      criteria:Array.isArray(doc.data().criteria)?doc.data().criteria:[],feedback:doc.data().feedback,
      gradeSchema:doc.data().gradeSchema||"rubric_v1",
      evidenceType:doc.data().evidenceType||"studio",revision:doc.data().revision,
      publishedAt:doc.data().publishedAt?.toMillis?.()||null,
      lastCorrectedAt:doc.data().lastCorrectedAt?.toMillis?.()||null}))};
  }
  if(!ctx.roles.includes("teacher"))deny("permission-denied","Gradebook teacher access is required.");
  const taskId=checkId(input.taskId,"Task ID",128);
  const taskRef=db.doc(prefix+"assessments/"+taskId);
  const task=await taskRef.get();
  if(!task.exists||task.data().schoolId!==ctx.schoolId||
     (!ctx.platformOverride&&(task.data().reviewerUid||task.data().ownerUid)!==ctx.uid)||
     !["studio","github","text","link"].includes(task.data().submissionSource))
   deny("permission-denied","You are not the currently responsible teacher for this school assessment.");
  const source=task.data().submissionSource,offeringId=task.data().offeringId;
  if(input.action==="list_task_results"){
    const grantRef=db.doc(prefix+"staff_assignments/"+rowKey(ctx.uid,offeringId));
    if(!ctx.platformOverride){
      const [member,grant]=await Promise.all([memberRef.get(),grantRef.get()]);
      if(!member.exists||member.data().status!=="active"||member.data().schoolId!==ctx.schoolId||
         !Array.isArray(member.data().roles)||!member.data().roles.includes("teacher")||
         !grant.exists||grant.data().schoolId!==ctx.schoolId||grant.data().teacherUid!==ctx.uid||
         grant.data().offeringId!==offeringId||grant.data().status!=="active")
        deny("permission-denied","This assessment's result access is no longer assigned to you.");
    }
    const snap=await grades.where("taskId","==",taskId).limit(101).get();
    if(snap.size===101)deny("resource-exhausted","Assessment results require pagination.");
    const rows=snap.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&doc.data().offeringId===offeringId);
    const people=await Promise.all(rows.map(doc=>db.doc(prefix+"people/"+doc.data().personId).get()));
    return {taskId,results:rows.map((doc,index)=>{
      const data=doc.data(),person=people[index];
      return {
        gradeId:doc.id,studentUid:data.studentUid,personId:data.personId,
        studentName:person.exists&&person.data().schoolId===ctx.schoolId?person.data().displayName:"Student",
        status:data.status,awarded:data.awarded,total:data.total,pending:data.pending||0,
        reviewSuggested:data.status==="draft"&&(data.reviewSuggested===true||source==="github"||data.awarded===0),
        evidenceType:data.evidenceType||source,submissionVersion:data.submissionVersion,
        revision:data.revision||1,publishedAt:data.publishedAt?.toMillis?.()||null,
        updatedAt:data.updatedAt?.toMillis?.()||null
      };
    })};
  }
  if(input.action==="publish_task_drafts"){
   const grantRef=db.doc(prefix+"staff_assignments/"+rowKey(ctx.uid,offeringId));
   if(!ctx.platformOverride){
    const [member,grant]=await Promise.all([memberRef.get(),grantRef.get()]);
    if(!member.exists||member.data().status!=="active"||member.data().schoolId!==ctx.schoolId||
       !Array.isArray(member.data().roles)||!member.data().roles.includes("teacher")||
       !grant.exists||grant.data().schoolId!==ctx.schoolId||grant.data().teacherUid!==ctx.uid||
       grant.data().offeringId!==offeringId||grant.data().status!=="active")
      deny("permission-denied","This assessment's grading rights are no longer assigned to you.");
   }
   const snap=await grades.where("taskId","==",taskId).limit(201).get();
   if(snap.size===201)deny("resource-exhausted","Bulk publication requires pagination for this assessment.");
   const rows=snap.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&
     doc.data().offeringId===offeringId&&doc.data().status==="draft");
   const zeroSkipped=0;
   const candidates=rows;
   const collectionName=source==="studio"?"studio_submissions":
     source==="github"?"github_evidence":"assessment_submissions";
   const digestOf=data=>source==="studio"?data.contentDigest:
     source==="github"?data.evidenceDigest:data.submissionDigest;
   const frozenValid=snapshot=>{
    if(!snapshot.exists)return false;
    const data=snapshot.data();
    if(source==="studio")
      return data.contentDigest&&data.contentDigest===digestProject(data.files,data.artifacts||{});
    if(source==="github")
      return data.evidenceDigest&&data.evidenceDigest===
        digestEvidence(data.repository,data.selectedCommitShas||[],data.checkpointSha);
    return data.submissionDigest&&data.submissionDigest===digestSubmission(source,data.payload);
   };
   const taskTotal=Array.isArray(task.data().rubric)?
     task.data().rubric.reduce((sum,row)=>sum+Number(row.points||0),0):0;
   let published=0,failed=0;
   const failedGradeIds=[];
   for(const record of candidates){
    try{
     let studentUidForNotification=null;
     await db.runTransaction(async tx=>{
      const current=await tx.get(record.ref);
      if(!current.exists||current.data().status!=="draft")
       deny("failed-precondition","Draft changed before publication.");
      const grade=current.data();
      if(grade.schoolId!==ctx.schoolId||grade.taskId!==taskId||grade.offeringId!==offeringId||
         typeof grade.awarded!=="number"||!Number.isFinite(grade.awarded)||grade.awarded<0||grade.awarded>taskTotal||
         Number(grade.pending||0)!==0||Number(grade.total)!==taskTotal)
       deny("failed-precondition","Draft score is incomplete or no longer matches the published rubric.");
      const submissionRef=db.doc(prefix+collectionName+"/"+checkId(grade.submissionId,"Submission ID",128));
      const submission=await tx.get(submissionRef);
      if(!submission.exists||submission.data().schoolId!==ctx.schoolId||
         submission.data().taskId!==taskId||submission.data().studentUid!==grade.studentUid||
         submission.data().offeringId!==offeringId||
         !((source==="github"&&githubHasSubmission(submission.data()))||
           (source!=="github"&&["submitted","reviewed"].includes(submission.data().status)))||
         submission.data().currentVersion!==grade.submissionVersion||
         digestOf(submission.data())!==grade.submissionDigest)
       deny("failed-precondition","Draft no longer matches the current frozen student evidence.");
      const version=await tx.get(submissionRef.collection("versions").doc(String(grade.submissionVersion))),
        studentPerson=await tx.get(db.doc(prefix+"people/"+checkId(grade.personId,"Student person",128)));
      if(!version.exists||version.data().schoolId!==ctx.schoolId||
         version.data().taskId!==taskId||version.data().offeringId!==offeringId||
         version.data().studentUid!==grade.studentUid||version.data().personId!==grade.personId||
         version.data().version!==grade.submissionVersion||
         digestOf(version.data())!==grade.submissionDigest||!frozenValid(version))
       deny("failed-precondition","Frozen evidence validation failed.");
      if(!studentPerson.exists||studentPerson.data().schoolId!==ctx.schoolId||
         studentPerson.data().kind!=="student"||studentPerson.data().status!=="active"||
         typeof studentPerson.data().authUid!=="string")
       deny("failed-precondition","The student's current verified account is unavailable for grade publication.");
      studentUidForNotification=studentPerson.data().authUid;
      const now=FieldValue.serverTimestamp(),revision=(grade.revision||0)+1;
      tx.update(record.ref,{status:"published",publishedAt:now,publishedByUid:ctx.uid,
        revision,updatedAt:now});
      tx.update(submissionRef,{status:"reviewed",reviewedByUid:ctx.uid,
        reviewedVersion:grade.submissionVersion,updatedAt:now});
      tx.create(record.ref.collection("revisions").doc(String(revision)),{
        ...grade,status:"published",revision,publishedAt:now,publishedByUid:ctx.uid,
        action:"grade_bulk_published",createdAt:now
      });
      tx.create(db.collection(prefix+"grade_audit").doc(),{
        schoolId:ctx.schoolId,taskId,studentUid:grade.studentUid,actorUid:ctx.uid,
        action:"grade_bulk_published",revision,createdAt:now
      });
     });
     published++;
     if(studentUidForNotification)await writeSchoolNotification({
       db,schoolId:ctx.schoolId,uid:studentUidForNotification,
       id:"grade_published_"+taskId+"_"+record.id,
       title:"Grade published",
       body:(task.data().title||"Assessment")+" · your reviewed result is now available.",
       type:"grade",sourceId:taskId,target:"student-assessments.html"
     }).catch(()=>{});
    }catch(error){
     failed++;
     if(failedGradeIds.length<25)failedGradeIds.push(record.id);
    }
   }
   return {taskId,published,zeroSkipped,failed,failedGradeIds,
     remainingDrafts:Math.max(0,rows.length-published)};
  }

  const studentUid=checkId(input.studentUid,"Student UID",128);
  const gradeRef=grades.doc(hash(taskId,studentUid));
  const submissionCollection=source==="studio"?"studio_submissions":
    source==="github"?"github_evidence":"assessment_submissions";
  const submissionRef=db.doc(prefix+submissionCollection+"/"+
    hash(ctx.schoolId,taskId,studentUid));
  const evidenceDigest=data=>source==="studio"?data.contentDigest:
    source==="github"?data.evidenceDigest:data.submissionDigest;
  const gradeable=data=>source==="github"?
    githubHasSubmission(data):["submitted","reviewed"].includes(data.status);
  const verifyFrozen=snapshot=>{
    if(!snapshot.exists)return false;
    const data=snapshot.data();
    if(source==="studio")
      return data.contentDigest&&data.contentDigest===digestProject(data.files,data.artifacts||{});
    if(source==="github")
      return data.evidenceDigest&&data.evidenceDigest===
        digestEvidence(data.repository,data.selectedCommitShas||[],data.checkpointSha);
    return data.submissionDigest&&data.submissionDigest===digestSubmission(source,data.payload);
  };
  const verifyFrozenBinding=(snapshot,submission,version)=>{
    if(!snapshot.exists)return false;
    const data=snapshot.data();
    return data.schoolId===ctx.schoolId&&data.taskId===taskId&&
      data.offeringId===offeringId&&data.studentUid===studentUid&&
      data.personId===submission.personId&&data.version===version&&
      evidenceDigest(data)===evidenceDigest(submission)&&verifyFrozen(snapshot);
  };
  const grantRef=db.doc(prefix+"staff_assignments/"+rowKey(ctx.uid,offeringId));
  async function authorize(tx){
   const [school,member,grant,currentTask,submission]=await Promise.all([
    tx.get(schoolRef),tx.get(memberRef),tx.get(grantRef),tx.get(taskRef),tx.get(submissionRef)
   ]);
   const schoolInvalid=!school.exists||!["active","pilot"].includes(school.data().state);
   const teacherAuthorityInvalid=!ctx.platformOverride&&(
      !member.exists||member.data().status!=="active"||member.data().schoolId!==ctx.schoolId||
      !Array.isArray(member.data().roles)||!member.data().roles.includes("teacher")||
      !grant.exists||grant.data().status!=="active"||
      grant.data().teacherUid!==ctx.uid||grant.data().schoolId!==ctx.schoolId||
      grant.data().offeringId!==offeringId||
      (currentTask.exists&&(currentTask.data().reviewerUid||currentTask.data().ownerUid)!==ctx.uid)
   );
   const bindingInvalid=!currentTask.exists||currentTask.data().schoolId!==ctx.schoolId||
      !submission.exists||submission.data().schoolId!==ctx.schoolId||
      submission.data().taskId!==taskId||submission.data().studentUid!==studentUid||
      submission.data().offeringId!==offeringId;
   if(schoolInvalid||teacherAuthorityInvalid||bindingInvalid)
    deny("permission-denied","Review permission, assessment, or student submission is no longer valid.");
   return {task:currentTask.data(),submission:submission.data()};
  }
  if(input.action==="get_draft"){
   const grant=await grantRef.get();
   if(!ctx.platformOverride&&(!grant.exists||grant.data().status!=="active"||
      grant.data().schoolId!==ctx.schoolId||grant.data().teacherUid!==ctx.uid))
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
      reviewSuggested:grade.data().status==="draft"&&(grade.data().reviewSuggested===true||source==="github"||grade.data().awarded===0),
      draftSource:grade.data().draftSource||"teacher",
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
   const draftSource=DRAFT_SOURCES.has(String(input.draftSource||""))?String(input.draftSource):"teacher";
   const artifactReviewNote=validatedBulkLinkReview(source,input);
   const auditRef=db.collection(prefix+"grade_audit").doc();
   await db.runTransaction(async tx=>{
    const {task,submission}=await authorize(tx);
    const grade=await tx.get(gradeRef);
    if(grade.exists&&grade.data().gradeSchema==="legacy_scalar_v1")
     deny("failed-precondition","This imported historical grade has no saved rubric breakdown. Reconstruct the breakdown without changing its historical score before editing the draft.");
    if(input.expectedDraftRevision!==undefined&&(!Number.isInteger(input.expectedDraftRevision)||input.expectedDraftRevision<1||
       !grade.exists||grade.data().status!=="draft"||grade.data().revision!==input.expectedDraftRevision))
     deny("failed-precondition","The draft changed during re-evaluation. Reload before replacing it.");
    if(input.onlyIfUngraded===true&&grade.exists)
     deny("failed-precondition","This submission already has a saved grade. Bulk evaluation cannot replace an existing private or published grade.");
    if(grade.exists&&grade.data().status==="published")
     deny("failed-precondition","Published grades require a formal correction workflow.");
    if(!gradeable(submission))
     deny("failed-precondition",source==="github"?
       "Student-submitted GitHub commits are required before grading; a teacher-only discovery is not a submission.":
       source==="studio"?"Only the currently submitted Studio revision may be graded.":
       "Only the currently submitted assessment response may be graded.");
    if(submission.currentVersion!==submissionVersion)
     deny("failed-precondition","Student resubmitted. Refresh the frozen submission before grading.");
    const snapshot=await tx.get(submissionRef.collection("versions").doc(String(submissionVersion)));
    if(!verifyFrozenBinding(snapshot,submission,submissionVersion))
     deny("failed-precondition","The frozen assessment evidence changed, is missing, or belongs to another submission context.");
    const scores=validateScores(input.criteria,task.rubric);
    const revision=grade.exists?(grade.data().revision||0)+1:1;
    if(grade.exists&&grade.data().status!=="draft")
     deny("failed-precondition","Only an unpublished draft may be revised.");
    const now=FieldValue.serverTimestamp();
    const values={schoolId:ctx.schoolId,taskId,offeringId,
     personId:submission.personId,studentUid,reviewerUid:ctx.uid,
     evidenceType:source,submissionId:submissionRef.id,submissionVersion,submissionDigest:evidenceDigest(submission),
     gradeSchema:"rubric_v1",criteria:scores.criteria,awarded:scores.awarded,pending:scores.pending,total:scores.total,
     feedback,draftSource,status:"draft",revision,updatedAt:now,
     reviewSuggested:source==="github"||scores.pending>0||scores.awarded===0||input.reviewSuggested===true,
     ...(source==="link"&&(input.onlyIfUngraded===true||input.expectedDraftRevision!==undefined)?{
       linkedArtifactReviewedByUid:ctx.uid,linkedArtifactReviewNote:artifactReviewNote
     }:{})};
    if(grade.exists)tx.update(gradeRef,values);
    else tx.create(gradeRef,{...values,createdAt:now});
    tx.create(gradeRef.collection("revisions").doc(String(revision)),{
     ...values,createdAt:now,action:"teacher_draft_saved"
    });
    tx.create(auditRef,{schoolId:ctx.schoolId,taskId,studentUid,actorUid:ctx.uid,
     action:"grade_draft_saved",revision,createdAt:now,
     ...(source==="link"&&(input.onlyIfUngraded===true||input.expectedDraftRevision!==undefined)?{
       linkedArtifactReviewedByUid:ctx.uid,linkedArtifactReviewNote:artifactReviewNote
     }:{})});
   });
   return {taskId,studentUid,status:"draft"};
  }
  if(["convert_legacy_scalar","convert_legacy_published"].includes(input.action)){
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
    if(!grade.exists||!["draft","published"].includes(grade.data().status)||
       grade.data().gradeSchema!=="legacy_scalar_v1")
     deny("failed-precondition","Only an imported scalar grade can use historical rubric reconstruction.");
    const previous=grade.data(),published=previous.status==="published";
    if(previous.revision!==expectedRevision)
     deny("failed-precondition","This historical grade changed. Reload it before reconstructing the rubric.");
    if(previous.evidenceType!==source||previous.submissionVersion!==submission.currentVersion||
       previous.submissionDigest!==evidenceDigest(submission))
     deny("failed-precondition","The historical grade is no longer bound to the current frozen evidence.");
    if(published&&submission.status!=="reviewed")
     deny("failed-precondition","Published historical grades require the reviewed frozen evidence version.");
    if(!published&&!gradeable(submission))
     deny("failed-precondition","The frozen evidence is no longer in a gradeable state.");
    const snapshot=await tx.get(submissionRef.collection("versions").doc(String(previous.submissionVersion)));
    if(!verifyFrozenBinding(snapshot,submission,previous.submissionVersion))
     deny("failed-precondition","The frozen historical evidence could not be verified against its submission context.");
    const scores=validateScores(input.criteria,task.rubric);
    if(scores.pending>0)
     deny("failed-precondition","Historical rubric reconstruction cannot leave pending points.");
    if(Math.abs(scores.awarded-Number(previous.awarded))>0.000001||
       Math.abs(scores.total-Number(previous.total))>0.000001)
     deny("failed-precondition","Rubric reconstruction must preserve the exact historical score and maximum. Reconstruct first, then use a separate grade edit or correction if the score must change.");
    const now=FieldValue.serverTimestamp(),revision=previous.revision+1;
    const converted={gradeSchema:"rubric_v1",criteria:scores.criteria,pending:0,
      revision,updatedAt:now,legacyScalarConvertedAt:now,legacyScalarConvertedByUid:ctx.uid};
    tx.update(gradeRef,converted);
    tx.create(gradeRef.collection("revisions").doc(String(revision)),{
      ...previous,...converted,status:previous.status,
      action:"legacy_grade_breakdown_converted",
      conversionReason:reason,previousRevision:expectedRevision,createdAt:now
    });
    tx.create(auditRef,{schoolId:ctx.schoolId,taskId,studentUid,actorUid:ctx.uid,
      action:"legacy_grade_breakdown_converted",reason,previousRevision:expectedRevision,
      revision,status:previous.status,awarded:previous.awarded,total:previous.total,createdAt:now});
    result={taskId,studentUid,status:previous.status,revision,awarded:previous.awarded,
      total:previous.total,converted:true};
   });
   return result;
  }
  if(input.action==="correct_published"){
   const expectedRevision=input.expectedRevision;
   if(!Number.isInteger(expectedRevision)||expectedRevision<1)
    deny("invalid-argument","The currently published grade revision is required.");
   const reason=String(input.reason||"").trim();
   if(reason.length>2000)deny("invalid-argument","Correction note is too long.");
   const feedback=String(input.feedback||"").trim();
   if(feedback.length>5000)deny("invalid-argument","Teacher feedback is too long.");
   const auditRef=db.collection(prefix+"grade_audit").doc();
   let result,notificationUid=null;
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
    const snapshot=await tx.get(submissionRef.collection("versions").doc(String(previous.submissionVersion))),
      studentPerson=await tx.get(db.doc(prefix+"people/"+checkId(submission.personId,"Student person",128)));
    if(!verifyFrozenBinding(snapshot,submission,previous.submissionVersion))
     deny("failed-precondition","The frozen student evidence could not be verified against its submission context.");
    if(!studentPerson.exists||studentPerson.data().schoolId!==ctx.schoolId||
       studentPerson.data().kind!=="student"||studentPerson.data().status!=="active"||
       typeof studentPerson.data().authUid!=="string")
     deny("failed-precondition","The student's current verified account is unavailable for grade correction.");
    notificationUid=studentPerson.data().authUid;
    const scores=validateScores(input.criteria,task.rubric);
    if(scores.pending>0)
     deny("failed-precondition","Published-grade corrections cannot leave pending rubric points.");
    const now=FieldValue.serverTimestamp(),revision=previous.revision+1;
    const corrected={gradeSchema:"rubric_v1",criteria:scores.criteria,awarded:scores.awarded,pending:0,total:scores.total,
      feedback,revision,updatedAt:now,lastCorrectedAt:now,lastCorrectedByUid:ctx.uid};
    tx.update(gradeRef,corrected);
    tx.create(gradeRef.collection("revisions").doc(String(revision)),{
      ...previous,...corrected,status:"published",action:"grade_corrected",
      correctionReason:reason||null,previousRevision:expectedRevision,createdAt:now
    });
    tx.create(auditRef,{schoolId:ctx.schoolId,taskId,studentUid,actorUid:ctx.uid,
      action:"grade_corrected",reason:reason||null,previousRevision:expectedRevision,revision,createdAt:now});
    result={taskId,studentUid,status:"published",revision,
      awarded:scores.awarded,total:scores.total,corrected:true};
   });
   await writeSchoolNotification({
     db,schoolId:ctx.schoolId,uid:notificationUid,
     id:"grade_corrected_"+taskId+"_"+String(result.revision),
     title:"Published grade updated",
     body:(task.data().title||"Assessment")+" · your teacher recorded a reviewed grade correction.",
     type:"grade",sourceId:taskId,target:"student-assessments.html"
   }).catch(()=>{});
   return result;
  }
  if(input.action==="publish"){
   const auditRef=db.collection(prefix+"grade_audit").doc();
   let result,notificationUid=null;
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
    const snapshot=await tx.get(submissionRef.collection("versions").doc(String(data.submissionVersion))),
      studentPerson=await tx.get(db.doc(prefix+"people/"+checkId(submission.personId,"Student person",128)));
    if(!verifyFrozenBinding(snapshot,submission,data.submissionVersion))
     deny("failed-precondition","The frozen student evidence could not be verified against its submission context.");
    if(!studentPerson.exists||studentPerson.data().schoolId!==ctx.schoolId||
       studentPerson.data().kind!=="student"||studentPerson.data().status!=="active"||
       typeof studentPerson.data().authUid!=="string")
     deny("failed-precondition","The student's current verified account is unavailable for grade publication.");
    notificationUid=studentPerson.data().authUid;
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
     db,schoolId:ctx.schoolId,uid:notificationUid,
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
module.exports={createSchoolGradebookService,validateScores,validatedBulkLinkReview,githubHasSubmission};
