"use strict";
/**
 * Controlled canonical MCS evidence/submission/grade migration.
 *
 * Default mode is preflight. Each evidence/submission candidate is created
 * atomically with all immutable versions. Grades are created atomically with
 * their imported revision and, when published, the linked evidence head is
 * transitioned to reviewed without sending notifications.
 */
const {initializeApp,getApps,applicationDefault}=require("firebase-admin/app");
const {getFirestore,FieldValue,Timestamp}=require("firebase-admin/firestore");
const {readFileSync,writeFileSync}=require("node:fs");
const {createHash}=require("node:crypto");
const {SCHEMA:PLAN_SCHEMA,v4Key}=require("./mcs-canonical-evidence-grade-plan.js");
const {APPROVAL_SCHEMA}=require("./mcs-canonical-evidence-grade-approval-template.js");
const {SCHOOL_ID}=require("./mcs-canonical-foundation-plan.js");
const {digestEvidence}=require("./school-github-evidence.js");
const {digestProject,validateFiles,validateArtifacts}=require("./school-studio-projects.js");
const {rowKey}=require("./school-academics.js");

const WRITE_ACK="YES_I_APPROVE_MCS_CANONICAL_EVIDENCE_GRADES";
const RECEIPT_SCHEMA="adminerva-v4-mcs-canonical-evidence-grade-receipt-v1";
const MAX_EXTENSION_MS=30*24*60*60*1000;
const sha=value=>createHash("sha256").update(value).digest("hex");

function arg(args,name){
 const value=args.find(item=>item.startsWith("--"+name+"="))?.slice(name.length+3);
 if(!value||!value.startsWith("/")||value.includes("\0"))
  throw Error("Provide --"+name+" as a restricted absolute path.");
 return value;
}
function load(path,label){
 const raw=readFileSync(path);let data;
 try{data=JSON.parse(raw.toString("utf8"));}catch{throw Error(label+" is not valid JSON.");}
 return {raw,data};
}
function intArg(args,name,fallback,min=1,max=100){
 const raw=args.find(item=>item.startsWith("--"+name+"="))?.slice(name.length+3);
 if(raw===undefined)return fallback;
 const value=Number(raw);
 if(!Number.isInteger(value)||value<min||value>max)
  throw Error("--"+name+" must be "+min+"-"+max+".");
 return value;
}
function timestamp(value){
 return Number.isFinite(value)&&value>0?Timestamp.fromMillis(value):null;
}
function validatePlan(plan){
 if(!plan||plan.schema!==PLAN_SCHEMA||plan.schoolId!==SCHOOL_ID||
    plan.readOnly!==true||plan.readyForApply!==false)
  throw Error("Use a current MCS canonical evidence/grade plan.");
 return plan;
}
function decided(planRows,reviewRows,key){
 const planned=new Map(planRows.map(row=>[row[key],row]));
 if(reviewRows.length!==planRows.length)
  throw Error("Approval record count differs from the bound evidence/grade plan.");
 const approved=[];
 for(const review of reviewRows){
  const row=planned.get(review[key]);
  if(!row)throw Error("Approval contains a record not present in the bound plan.");
  if(!["approve","exclude"].includes(review.decision))
   throw Error("Every evidence/grade record requires an explicit approve or exclude decision.");
  if(review.decision==="exclude"){
   const reason=String(review.exclusionReason||"").trim();
   if(reason.length<12||reason.length>1000)
    throw Error("Excluded evidence/grade records require a 12–1,000 character reason.");
   continue;
  }
  approved.push({...row,revisionExtensionDueAt:review.revisionExtensionDueAt||null});
 }
 return approved;
}
function validateExtension(row,now){
 if(!row.requiresRevisionExtension)return null;
 const raw=String(row.revisionExtensionDueAt||"").trim(),millis=Date.parse(raw);
 if(!raw||!Number.isFinite(millis))
  throw Error("Reopened historical evidence requires an explicit revision extension.");
 if(millis<=now||millis>now+MAX_EXTENSION_MS)
  throw Error("Migration revision extension must be in the future and no more than 30 days from apply time.");
 return millis;
}
function validateApproval(plan,raw,approval,{now=Date.now()}={}){
 if(!approval||approval.schema!==APPROVAL_SCHEMA||approval.schoolId!==SCHOOL_ID||
    approval.scope!=="canonical_evidence_grades_only")
  throw Error("Approval does not authorize canonical MCS evidence and grades.");
 const planSha256=sha(raw);
 if(approval.planSha256!==planSha256)
  throw Error("Approval belongs to a different evidence/grade plan.");
 if(typeof approval.approvedBy!=="string"||approval.approvedBy.trim().length<3||
    typeof approval.approvedAt!=="string"||!Number.isFinite(Date.parse(approval.approvedAt)))
  throw Error("Approval must identify the reviewer and timestamp.");
 for(const key of ["githubFrozenSetsReviewed","studioSnapshotsReviewed","studentTaskEnrollmentReviewed",
   "publicationStatesReviewed","historicalScalarGradesReviewed","evidenceAndGradeRevisionsReviewed",
   "revisionExtensionsReviewed","noMigrationNotifications","backupsAndRollbackReviewed"])
  if(approval.acknowledgements?.[key]!==true)
   throw Error("Missing approval acknowledgement: "+key);
 if((approval.unresolvedBlockers||[]).length)
  throw Error("Resolve every evidence/grade migration blocker before apply.");
 if((approval.reviewItems||[]).some(item=>item.resolved!==true))
  throw Error("Resolve every evidence/grade migration review item before apply.");

 const githubEvidence=decided(plan.githubEvidence||[],approval.githubEvidence||[],"evidenceId");
 const studioSubmissions=decided(plan.studioSubmissions||[],approval.studioSubmissions||[],"submissionId");
 const grades=decided(plan.grades||[],approval.grades||[],"gradeId");

 for(const row of [...githubEvidence,...studioSubmissions]){
  const extension=validateExtension(row,now);
  row.revisionExtensionDueAt=extension;
  if(!Array.isArray(row.versions)||!row.versions.length||row.versions.length>100)
   throw Error("Each migrated evidence record must contain 1–100 immutable versions.");
 }
 const evidenceKeys=new Set([
  ...githubEvidence.map(row=>"github|"+row.taskId+"|"+row.studentUid),
  ...studioSubmissions.map(row=>"studio|"+row.taskId+"|"+row.studentUid)
 ]);
 for(const grade of grades){
  if(!["rubric_v1","legacy_scalar_v1"].includes(grade.gradeSchema))
   throw Error("Unsupported imported grade schema.");
  if(!evidenceKeys.has(grade.evidenceType+"|"+grade.taskId+"|"+grade.studentUid))
   throw Error("An approved grade requires its exact evidence/submission candidate to be approved.");
  if(grade.gradeSchema==="legacy_scalar_v1"&&Array.isArray(grade.criteria)&&grade.criteria.length)
   throw Error("Historical scalar grades must not contain fabricated rubric criteria.");
  if(grade.gradeSchema==="rubric_v1"&&(!Array.isArray(grade.criteria)||!grade.criteria.length))
   throw Error("Rubric grades require their saved criterion breakdown.");
  if(!Number.isInteger(grade.revision)||grade.revision<1)
   throw Error("Imported grade revision is invalid.");
  if((grade.migration?.legacyRevisions||[]).length>100)
   throw Error("A migrated grade has more than 100 legacy revisions; review a paginated archival strategy first.");
 }
 return {planSha256,githubEvidence,studioSubmissions,grades,now};
}
function meta(approved,type,key){
 return {source:"mcs_legacy_v3",planSha256:approved.planSha256,type,key};
}
function same(data,approved,type,key){
 return data?.schoolId===SCHOOL_ID&&data?.migration?.planSha256===approved.planSha256&&
  data?.migration?.type===type&&data?.migration?.key===key;
}
function githubId(row){return v4Key(SCHOOL_ID,row.taskId,row.studentUid);}
function studioId(row){return v4Key(SCHOOL_ID,row.taskId,row.studentUid);}
function gradeId(row){return v4Key(row.taskId,row.studentUid);}

async function prerequisiteState(db,row,source){
 const prefix="schools/"+SCHOOL_ID+"/";
 const [school,task,member,person,enrollment]=await Promise.all([
  db.doc("platform_schools/"+SCHOOL_ID).get(),
  db.doc(prefix+"assessments/"+row.taskId).get(),
  db.doc(prefix+"memberships/"+row.studentUid).get(),
  db.doc(prefix+"people/"+row.personId).get(),
  db.doc(prefix+"enrollments/"+rowKey(row.personId,row.offeringId)).get()
 ]);
 if(!school.exists||!["draft","active"].includes(school.data().state))
  return "school_missing_or_unavailable";
 if(!task.exists||task.data().schoolId!==SCHOOL_ID||task.data().offeringId!==row.offeringId||
    task.data().submissionSource!==source)
  return "task_mismatch";
 if(!member.exists||member.data().schoolId!==SCHOOL_ID||
    !Array.isArray(member.data().roles)||!member.data().roles.includes("student"))
  return "student_membership_mismatch";
 if(!person.exists||person.data().schoolId!==SCHOOL_ID||person.data().kind!=="student"||
    person.data().authUid!==row.studentUid)
  return "student_person_mismatch";
 if(!enrollment.exists||enrollment.data().schoolId!==SCHOOL_ID||
    enrollment.data().personId!==row.personId||enrollment.data().offeringId!==row.offeringId||
    !["active","ended"].includes(enrollment.data().status))
  return "approved_enrollment_missing";
 return "ok";
}
function validateGithub(row){
 if(row.evidenceId!==githubId(row))throw Error("GitHub evidence runtime ID mismatch.");
 if(!Array.isArray(row.versions)||row.currentVersion!==row.versions.length)
  throw Error("GitHub evidence version sequence mismatch.");
 for(let index=0;index<row.versions.length;index++){
  const version=row.versions[index];
  if(version.version!==index+1)throw Error("GitHub evidence versions must be consecutive.");
  const digest=digestEvidence(version.repository,version.selectedCommitShas||[],version.checkpointSha);
  if(digest!==version.evidenceDigest)throw Error("GitHub immutable evidence digest mismatch.");
 }
 const current=row.versions.at(-1);
 if(current.evidenceDigest!==row.evidenceDigest||
    current.checkpointSha!==row.checkpointSha||
    JSON.stringify(current.selectedCommitShas)!==JSON.stringify(row.selectedCommitShas))
  throw Error("GitHub evidence head differs from its latest immutable version.");
 if(row.status==="approved"){
  if(!row.verification||row.verification.version!==row.currentVersion||
     row.verification.verifiedCheckpointSha!==row.checkpointSha||
     JSON.stringify(row.verification.verifiedCommitShas)!==JSON.stringify(row.selectedCommitShas))
   throw Error("Approved GitHub evidence verification does not match the frozen version.");
 }
}
function validateStudio(row){
 if(row.submissionId!==studioId(row))throw Error("Studio submission runtime ID mismatch.");
 if(!Array.isArray(row.versions)||row.currentVersion!==row.versions.length)
  throw Error("Studio submission version sequence mismatch.");
 for(let index=0;index<row.versions.length;index++){
  const version=row.versions[index];
  if(version.version!==index+1)throw Error("Studio versions must be consecutive.");
  validateFiles(version.files);validateArtifacts(version.artifacts||{});
  if(digestProject(version.files,version.artifacts||{})!==version.contentDigest)
   throw Error("Studio immutable content digest mismatch.");
 }
 if(row.versions.at(-1).contentDigest!==row.contentDigest)
  throw Error("Studio submission head differs from its latest immutable version.");
}
function validateGrade(row){
 if(row.gradeId!==gradeId(row))throw Error("Grade runtime ID mismatch.");
 if(!Number.isFinite(row.awarded)||!Number.isFinite(row.total)||row.awarded<0||row.total<=0||
    row.awarded>row.total+0.000001)
  throw Error("Imported grade total is invalid.");
 if(row.gradeSchema==="rubric_v1"){
  const awarded=row.criteria.reduce((sum,item)=>sum+Number(item.awardedPoints),0);
  const total=row.criteria.reduce((sum,item)=>sum+Number(item.maximum),0);
  const pending=row.criteria.reduce((sum,item)=>sum+Number(item.pendingPoints),0);
  if(!Number.isFinite(awarded)||!Number.isFinite(total)||!Number.isFinite(pending)||
     Math.abs(awarded-row.awarded)>0.000001||Math.abs(total-row.total)>0.000001||
     Math.abs(pending-row.pending)>0.000001)
   throw Error("Imported rubric grade totals do not reconcile.");
  if(row.status==="published"&&pending>0)
   throw Error("Published imported grade cannot contain pending rubric points.");
 }
}
async function inspect(db,approved){
 const rows=[];
 for(const row of approved.githubEvidence){
  let state;
  try{validateGithub(row);state=await prerequisiteState(db,row,"github");}
  catch(error){state="candidate_integrity_error";rows.push({kind:"github",key:row.evidenceId,
   targetPath:row.targetPath,state,message:error.message});continue;}
  if(state==="ok"){
   const current=await db.doc(row.targetPath).get();
   state=!current.exists?"ready":same(current.data(),approved,"github_evidence",row.evidenceId)?"already_applied":"target_conflict";
  }
  rows.push({kind:"github",key:row.evidenceId,targetPath:row.targetPath,state});
 }
 for(const row of approved.studioSubmissions){
  let state;
  try{validateStudio(row);state=await prerequisiteState(db,row,"studio");}
  catch(error){state="candidate_integrity_error";rows.push({kind:"studio",key:row.submissionId,
   targetPath:row.targetPath,state,message:error.message});continue;}
  if(state==="ok"){
   const current=await db.doc(row.targetPath).get();
   state=!current.exists?"ready":same(current.data(),approved,"studio_submission",row.submissionId)?"already_applied":"target_conflict";
  }
  rows.push({kind:"studio",key:row.submissionId,targetPath:row.targetPath,state});
 }
 for(const row of approved.grades){
  let state="ok";
  try{validateGrade(row);}
  catch(error){state="candidate_integrity_error";rows.push({kind:"grade",key:row.gradeId,
   targetPath:row.targetPath,state,message:error.message});continue;}
  const current=await db.doc(row.targetPath).get();
  state=!current.exists?"ready":same(current.data(),approved,"grade",row.gradeId)?"already_applied":"target_conflict";
  rows.push({kind:"grade",key:row.gradeId,targetPath:row.targetPath,state});
 }
 return rows;
}
async function createGithub(db,approved,row){
 validateGithub(row);
 const ref=db.doc(row.targetPath),prefix="schools/"+SCHOOL_ID+"/";
 return db.runTransaction(async tx=>{
  const [current,task,member,person,enrollment]=await Promise.all([
   tx.get(ref),tx.get(db.doc(prefix+"assessments/"+row.taskId)),
   tx.get(db.doc(prefix+"memberships/"+row.studentUid)),
   tx.get(db.doc(prefix+"people/"+row.personId)),
   tx.get(db.doc(prefix+"enrollments/"+rowKey(row.personId,row.offeringId)))
  ]);
  if(current.exists){
   if(same(current.data(),approved,"github_evidence",row.evidenceId))return "already_applied";
   throw Error("GitHub evidence target changed after preflight.");
  }
  if(!task.exists||task.data().schoolId!==SCHOOL_ID||task.data().offeringId!==row.offeringId||
     task.data().submissionSource!=="github")
   throw Error("GitHub task changed after approval.");
  if(!member.exists||!member.data().roles?.includes("student")||
     !person.exists||person.data().authUid!==row.studentUid||
     !enrollment.exists||!["active","ended"].includes(enrollment.data().status))
   throw Error("GitHub student identity or active enrollment changed after approval.");
  const importedAt=FieldValue.serverTimestamp(),extension=timestamp(row.revisionExtensionDueAt);
  for(const version of row.versions){
   tx.create(ref.collection("versions").doc(String(version.version)),{
    schoolId:SCHOOL_ID,taskId:row.taskId,offeringId:row.offeringId,
    studentUid:row.studentUid,personId:row.personId,
    repository:version.repository,selectedCommitShas:version.selectedCommitShas,
    checkpointSha:version.checkpointSha,evidenceDigest:version.evidenceDigest,
    version:version.version,submittedAt:timestamp(version.submittedAt),
    migration:{...meta(approved,"github_evidence_version",row.evidenceId+"_"+version.version),
     legacyRevision:version.migration?.legacyRevision||0,legacyStatus:version.migration?.legacyStatus||null}
   });
  }
  tx.create(ref,{schoolId:SCHOOL_ID,taskId:row.taskId,offeringId:row.offeringId,
   studentUid:row.studentUid,personId:row.personId,
   repository:row.repository,selectedCommitShas:row.selectedCommitShas,
   checkpointSha:row.checkpointSha,evidenceDigest:row.evidenceDigest,
   status:row.status,currentVersion:row.currentVersion,
   approvedByUid:row.approvedByUid||null,approvedAt:timestamp(row.approvedAt),
   verification:row.verification||null,
   reopenReason:row.status==="reopened"?(row.reopenReason||"Historical revision request migrated."):null,
   revisionDueAt:row.status==="reopened"?extension:null,
   createdAt:timestamp(row.versions[0]?.submittedAt),updatedAt:importedAt,
   migration:{...meta(approved,"github_evidence",row.evidenceId),
    sourcePath:row.migration?.sourcePath,legacyEvidenceId:row.migration?.legacyEvidenceId,
    legacyRevision:row.migration?.legacyRevision||0,
    verifiedContributionCommits:row.migration?.verifiedContributionCommits||[],
    contributionScope:row.migration?.contributionScope||"",
    legacyReviewedBy:row.migration?.legacyReviewedBy||null,
    originalStatus:row.migration?.originalStatus||row.status}
  });
  tx.create(db.collection(prefix+"submission_audit").doc(),{
   schoolId:SCHOOL_ID,taskId:row.taskId,evidenceId:row.evidenceId,
   studentUid:row.studentUid,actorUid:"migration",
   action:"mcs_github_evidence_migrated",version:row.currentVersion,
   evidenceDigest:row.evidenceDigest,notificationsSuppressed:true,
   planSha256:approved.planSha256,createdAt:importedAt});
  return "created";
 });
}
async function createStudio(db,approved,row){
 validateStudio(row);
 const ref=db.doc(row.targetPath),prefix="schools/"+SCHOOL_ID+"/";
 return db.runTransaction(async tx=>{
  const [current,task,member,person,enrollment]=await Promise.all([
   tx.get(ref),tx.get(db.doc(prefix+"assessments/"+row.taskId)),
   tx.get(db.doc(prefix+"memberships/"+row.studentUid)),
   tx.get(db.doc(prefix+"people/"+row.personId)),
   tx.get(db.doc(prefix+"enrollments/"+rowKey(row.personId,row.offeringId)))
  ]);
  if(current.exists){
   if(same(current.data(),approved,"studio_submission",row.submissionId))return "already_applied";
   throw Error("Studio submission target changed after preflight.");
  }
  if(!task.exists||task.data().schoolId!==SCHOOL_ID||task.data().offeringId!==row.offeringId||
     task.data().submissionSource!=="studio")
   throw Error("Studio task changed after approval.");
  if(!member.exists||!member.data().roles?.includes("student")||
     !person.exists||person.data().authUid!==row.studentUid||
     !enrollment.exists||!["active","ended"].includes(enrollment.data().status))
   throw Error("Studio student identity or active enrollment changed after approval.");
  const importedAt=FieldValue.serverTimestamp(),extension=timestamp(row.revisionExtensionDueAt);
  for(const version of row.versions){
   tx.create(ref.collection("versions").doc(String(version.version)),{
    schoolId:SCHOOL_ID,taskId:row.taskId,studentUid:row.studentUid,personId:row.personId,
    projectId:version.projectId||row.projectId,projectRevision:version.projectRevision||0,
    files:version.files,artifacts:version.artifacts||{},contentDigest:version.contentDigest,
    sourceLanguage:version.sourceLanguage||"text",submittedAt:timestamp(version.submittedAt),
    version:version.version,
    migration:{...meta(approved,"studio_submission_version",row.submissionId+"_"+version.version),
     legacySnapshotHash:version.migration?.legacySnapshotHash||null}
   });
  }
  tx.create(ref,{schoolId:SCHOOL_ID,taskId:row.taskId,offeringId:row.offeringId,
   studentUid:row.studentUid,personId:row.personId,
   projectId:row.projectId,projectRevision:row.projectRevision||0,
   contentDigest:row.contentDigest,status:row.status,currentVersion:row.currentVersion,
   revisionRequestMessage:row.status==="reopened"?(row.revisionRequestMessage||"Historical revision request migrated."):null,
   revisionDueAt:row.status==="reopened"?extension:null,
   reviewedByUid:row.status==="reviewed"?(row.reviewedByUid||null):null,
   reviewedVersion:row.status==="reviewed"?row.currentVersion:null,
   createdAt:timestamp(row.versions[0]?.submittedAt),updatedAt:importedAt,
   migration:{...meta(approved,"studio_submission",row.submissionId),
    sourcePath:row.migration?.sourcePath,legacySubmissionId:row.migration?.legacySubmissionId,
    originalStatus:row.migration?.originalStatus||row.status,
    legacyReviewedBy:row.migration?.legacyReviewedBy||null,
    legacyReviewNote:row.migration?.legacyReviewNote||""}
  });
  tx.create(db.collection(prefix+"submission_audit").doc(),{
   schoolId:SCHOOL_ID,taskId:row.taskId,submissionId:row.submissionId,
   studentUid:row.studentUid,actorUid:"migration",
   action:"mcs_studio_submission_migrated",version:row.currentVersion,
   contentDigest:row.contentDigest,notificationsSuppressed:true,
   planSha256:approved.planSha256,createdAt:importedAt});
  return "created";
 });
}
function legacyRevisionId(gradeId,row,index){
 return sha(JSON.stringify([gradeId,row.id||"",row.createdAt||0,index]));
}
async function createGrade(db,approved,row){
 validateGrade(row);
 const ref=db.doc(row.targetPath),prefix="schools/"+SCHOOL_ID+"/",
  evidencePath=row.evidenceType==="github"?
   prefix+"github_evidence/"+row.submissionId:prefix+"studio_submissions/"+row.submissionId;
 return db.runTransaction(async tx=>{
  const [current,task,submission,member,person,grant]=await Promise.all([
   tx.get(ref),tx.get(db.doc(prefix+"assessments/"+row.taskId)),
   tx.get(db.doc(evidencePath)),tx.get(db.doc(prefix+"memberships/"+row.studentUid)),
   tx.get(db.doc(prefix+"people/"+row.personId)),
   tx.get(db.doc(prefix+"staff_assignments/"+rowKey(row.reviewerUid,row.offeringId)))
  ]);
  if(current.exists){
   if(same(current.data(),approved,"grade",row.gradeId))return "already_applied";
   throw Error("Grade target changed after preflight.");
  }
  if(!task.exists||task.data().schoolId!==SCHOOL_ID||task.data().offeringId!==row.offeringId||
     task.data().submissionSource!==row.evidenceType)
   throw Error("Grade task changed after approval.");
  if(!submission.exists||submission.data().schoolId!==SCHOOL_ID||
     submission.data().taskId!==row.taskId||submission.data().studentUid!==row.studentUid||
     submission.data().currentVersion!==row.submissionVersion||
     (row.evidenceType==="github"?submission.data().evidenceDigest:submission.data().contentDigest)!==row.submissionDigest)
   throw Error("Grade frozen evidence binding changed after approval.");
  if(!member.exists||!member.data().roles?.includes("student")||
     !person.exists||person.data().authUid!==row.studentUid)
   throw Error("Grade student identity changed after approval.");
  if(!grant.exists||grant.data().schoolId!==SCHOOL_ID||grant.data().teacherUid!==row.reviewerUid||
     grant.data().offeringId!==row.offeringId||grant.data().status!=="active")
   throw Error("Historical grade reviewer is not an active teacher assigned to the offering.");
  if(task.data().ownerUid!==row.reviewerUid)
   throw Error("Historical grade reviewer is not the canonical assessment owner.");

  const importedAt=FieldValue.serverTimestamp(),publishedAt=timestamp(row.publishedAt);
  const values={schoolId:SCHOOL_ID,taskId:row.taskId,offeringId:row.offeringId,
   personId:row.personId,studentUid:row.studentUid,reviewerUid:row.reviewerUid,
   evidenceType:row.evidenceType,submissionId:row.submissionId,
   submissionVersion:row.submissionVersion,submissionDigest:row.submissionDigest,
   gradeSchema:row.gradeSchema,criteria:row.criteria||[],
   awarded:row.awarded,pending:row.pending||0,total:row.total,
   feedback:row.feedback||"",status:row.status,revision:row.revision,
   ...(row.status==="published"?{publishedAt,publishedByUid:row.reviewerUid}:{}),
   createdAt:importedAt,updatedAt:importedAt,
   migration:{...meta(approved,"grade",row.gradeId),
    sourcePath:row.migration?.sourcePath,legacyGradeId:row.migration?.legacyGradeId,
    legacyGradeSource:row.migration?.legacyGradeSource||"",
    compatibilityReason:row.migration?.compatibilityReason||null,
    legacyReviewedBy:row.migration?.legacyReviewedBy||null}
  };
  tx.create(ref,values);
  tx.create(ref.collection("revisions").doc(String(row.revision)),{
   ...values,action:"legacy_grade_imported",createdAt:importedAt
  });
  for(let index=0;index<(row.migration?.legacyRevisions||[]).length;index++){
   const legacy=row.migration.legacyRevisions[index],id=legacyRevisionId(row.gradeId,legacy,index);
   tx.create(ref.collection("legacy_revisions").doc(id),{
    schoolId:SCHOOL_ID,gradeId:row.gradeId,studentUid:row.studentUid,taskId:row.taskId,
    editorUid:legacy.editorUid||null,reason:legacy.reason||"",
    before:legacy.before||null,after:legacy.after||null,
    legacyCreatedAt:timestamp(legacy.createdAt),migrationImportedAt:importedAt,
    migration:meta(approved,"legacy_grade_revision",id)
   });
  }
  if(row.status==="published"){
   tx.update(db.doc(evidencePath),{
    status:"reviewed",reviewedByUid:row.reviewerUid,
    reviewedVersion:row.submissionVersion,updatedAt:importedAt
   });
  }
  tx.create(db.collection(prefix+"grade_audit").doc(),{
   schoolId:SCHOOL_ID,taskId:row.taskId,studentUid:row.studentUid,
   actorUid:"migration",action:"mcs_grade_migrated",status:row.status,
   gradeSchema:row.gradeSchema,revision:row.revision,
   notificationsSuppressed:true,planSha256:approved.planSha256,createdAt:importedAt});
  return "created";
 });
}
function units(approved){
 return [
  ...approved.githubEvidence.map(row=>({kind:"github",row})),
  ...approved.studioSubmissions.map(row=>({kind:"studio",row})),
  ...approved.grades.map(row=>({kind:"grade",row}))
 ];
}
async function applyEvidenceGrades(db,approved,{apply=false,maxUnits=30}={}){
 const inspected=await inspect(db,approved);
 const blockers=inspected.filter(row=>!["ready","already_applied"].includes(row.state));
 const work=units(approved);
 const receipt={schema:RECEIPT_SCHEMA,schoolId:SCHOOL_ID,
  scope:"canonical_evidence_grades_only",planSha256:approved.planSha256,
  mode:apply?"apply":"preflight",generatedAt:new Date().toISOString(),
  approvedGithubEvidence:approved.githubEvidence.length,
  approvedStudioSubmissions:approved.studioSubmissions.length,
  approvedGrades:approved.grades.length,
  blocked:!!blockers.length,blockers,created:0,alreadyApplied:0,
  processedUnits:0,remainingUnits:work.length,complete:false,
  notificationsSent:false};
 if(blockers.length||!apply)return receipt;
 let newWrites=0;
 for(const unit of work){
  if(newWrites>=maxUnits)break;
  const result=unit.kind==="github"?await createGithub(db,approved,unit.row):
   unit.kind==="studio"?await createStudio(db,approved,unit.row):
   await createGrade(db,approved,unit.row);
  receipt.processedUnits++;
  if(result==="created"){receipt.created++;newWrites++;}else receipt.alreadyApplied++;
 }
 receipt.remainingUnits=Math.max(0,work.length-receipt.processedUnits);
 receipt.complete=receipt.remainingUnits===0;
 return receipt;
}
async function main(){
 const args=process.argv.slice(2),apply=args.includes("--apply"),
  planPath=arg(args,"plan"),approvalPath=arg(args,"approval"),
  receiptPath=arg(args,"receipt"),maxUnits=intArg(args,"max-units",30);
 if(apply&&process.env.ADMINERVA_MCS_EVIDENCE_GRADE_WRITE!==WRITE_ACK)
  throw Error("Write mode requires the exact ADMINERVA_MCS_EVIDENCE_GRADE_WRITE acknowledgement.");
 const planFile=load(planPath,"Plan"),approvalFile=load(approvalPath,"Approval");
 const approved=validateApproval(validatePlan(planFile.data),planFile.raw,approvalFile.data);
 if(!getApps().length)initializeApp({credential:applicationDefault()});
 const receipt=await applyEvidenceGrades(getFirestore(),approved,{apply,maxUnits});
 writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+"\n",{flag:"wx",mode:0o600});
 console.info(JSON.stringify({
  mode:receipt.mode,blocked:receipt.blocked,created:receipt.created,
  alreadyApplied:receipt.alreadyApplied,remainingUnits:receipt.remainingUnits,
  complete:receipt.complete,notificationsSent:false
 }));
 if(receipt.blocked)process.exitCode=2;
}
if(require.main===module)main().catch(error=>{
 console.error("MCS canonical evidence/grade apply failed:",error.code||error.message);
 process.exitCode=1;
});
module.exports={WRITE_ACK,RECEIPT_SCHEMA,MAX_EXTENSION_MS,validatePlan,validateApproval,
 validateExtension,validateGithub,validateStudio,validateGrade,inspect,units,applyEvidenceGrades};
