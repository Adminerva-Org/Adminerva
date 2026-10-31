"use strict";
/**
 * Read-only MCS historical evidence/submission/grade migration planner.
 *
 * No Firestore writes. It preserves immutable evidence versions and grade
 * publication state only when student identity, enrollment, task scope,
 * checksums and grade/evidence binding all reconcile.
 */
const {initializeApp,getApps,applicationDefault}=require("firebase-admin/app");
const {getFirestore,FieldPath}=require("firebase-admin/firestore");
const {readFileSync,writeFileSync}=require("node:fs");
const {createHash}=require("node:crypto");
const {canonicalDigest}=require("./mcs-migration-ledger.js");
const {readMirrorRoot,SCHOOL_ID}=require("./mcs-canonical-foundation-plan.js");
const {validatePlan:validateFoundationPlan,validateApproval:validateFoundationApproval}=
 require("./mcs-canonical-foundation-apply.js");
const {validatePlan:validateAccessPlan,validateApproval:validateAccessApproval}=
 require("./mcs-canonical-academic-access-apply.js");
const {repository,digestEvidence}=require("./school-github-evidence.js");
const {validateFiles,validateArtifacts,digestProject}=require("./school-studio-projects.js");
const {validatePlan:validateAssessmentPlan,validateApproval:validateAssessmentApproval}=require("./mcs-canonical-assessment-apply.js");

const SCHEMA="adminerva-v4-mcs-canonical-evidence-grade-plan-v1";
const sha=value=>createHash("sha256").update(value).digest("hex");
const v4Key=(...parts)=>sha(JSON.stringify(parts));
function clean(value,max=5000){return typeof value==="string"?value.trim().slice(0,max):"";}
function timeMillis(value){
 if(!value)return null;
 if(typeof value.toMillis==="function")return value.toMillis();
 if(value instanceof Date)return value.getTime();
 if(typeof value==="string"){const parsed=Date.parse(value);return Number.isFinite(parsed)?parsed:null;}
 return null;
}
function validSha(value){return typeof value==="string"&&/^[a-f0-9]{40}$/.test(value.toLowerCase());}
function studentIdFromPath(path){
 const marker="/legacy_roots/students/documents/",index=String(path||"").indexOf(marker);
 if(index<0)return null;const tail=String(path).slice(index+marker.length);
 return tail&&!tail.includes("/")?tail:null;
}
function approvedStudentMap(foundationPlan,foundationPlanRaw,foundationApproval){
 const approved=validateFoundationApproval(
  validateFoundationPlan(foundationPlan),foundationPlanRaw,foundationApproval);
 const map=new Map();
 for(const member of approved.memberships.filter(row=>row.roles.includes("student"))){
  const person=approved.people.find(row=>row.uid===member.uid);
  if(!person)continue;
  for(const path of person.sourcePaths||[]){
   const legacyId=studentIdFromPath(path);if(!legacyId)continue;
   if(map.has(legacyId)&&map.get(legacyId).uid!==member.uid)
    throw Error("One legacy student ID maps to multiple approved accounts.");
   map.set(legacyId,{uid:member.uid,personId:person.personId,status:member.status});
  }
 }
 return map;
}
function exactTask(approvedAssessmentView,legacyAssessmentId,section,source){
 const candidates=(assessmentPlan.tasks||[]).filter(task=>
  task.sourceAssessmentId===legacyAssessmentId&&task.submissionSource===source&&
  (!section||task.migration?.legacySection===section));
 return candidates.length===1?candidates[0]:null;
}
function frozenSignature(repo,selected,checkpoint){
 return JSON.stringify([repo.fullName.toLowerCase(),[...selected].sort(),checkpoint]);
}
function normalizeGithubFrozen(state){
 const selected=Array.isArray(state?.selectedCommits)?[...new Set(state.selectedCommits.map(value=>String(value||"").toLowerCase()))]:[];
 const checkpoint=String(state?.checkpointSha||"").toLowerCase();
 if(!selected.length||selected.length>100||selected.some(value=>!validSha(value))||!validSha(checkpoint))
  return {ok:false,reason:"invalid_or_empty_commit_selection"};
 let repo;try{repo=repository(state.repository);}catch{return {ok:false,reason:"invalid_repository"};}
 return {ok:true,repository:repo,selectedCommitShas:selected.sort(),checkpointSha:checkpoint,
  evidenceDigest:digestEvidence(repo,selected,checkpoint)};
}
function revisionNumber(row){
 const numeric=Number(row.id);return Number.isInteger(numeric)&&numeric>=0?numeric:Number.MAX_SAFE_INTEGER;
}
function githubTimeline(revisions,head){
 const ordered=[...revisions].sort((a,b)=>revisionNumber(a)-revisionNumber(b)||
  (timeMillis(a.data?.createdAt)||0)-(timeMillis(b.data?.createdAt)||0));
 const states=[];
 if(ordered[0]?.data?.before)states.push(ordered[0].data.before);
 for(const row of ordered)if(row.data?.after)states.push(row.data.after);
 states.push(head);
 const versions=[];let previous=null;
 for(const state of states){
  const frozen=normalizeGithubFrozen(state);
  if(!frozen.ok)continue;
  const signature=frozenSignature(frozen.repository,frozen.selectedCommitShas,frozen.checkpointSha);
  if(signature===previous)continue;
  previous=signature;versions.push({version:versions.length+1,...frozen,
   submittedAt:timeMillis(state.submittedAt)||timeMillis(state.updatedAt)||null,
   legacyStatus:clean(state.status,40),legacyRevision:Number(state.revision)||0});
 }
 return versions;
}
function githubCandidate({row,revisions,task,student}){
 const head=row.data,status=clean(head.status,40);
 if(!["submitted","approved","reopened"].includes(status))
  return {ok:false,reason:"unsupported_github_lifecycle_status",status};
 const versions=githubTimeline(revisions,head);
 if(!versions.length)return {ok:false,reason:"github_frozen_version_missing"};
 const current=normalizeGithubFrozen(head);
 if(!current.ok)return {ok:false,reason:current.reason};
 const latest=versions.at(-1);
 if(latest.evidenceDigest!==current.evidenceDigest)
  return {ok:false,reason:"github_head_not_latest_frozen_version"};
 const verifiedSubset=Array.isArray(head.verifiedContributionCommits)?
  [...new Set(head.verifiedContributionCommits.map(value=>String(value||"").toLowerCase()))]:[];
 if(verifiedSubset.some(value=>!latest.selectedCommitShas.includes(value)))
  return {ok:false,reason:"legacy_verified_contribution_not_in_selection"};
 let verification=null;
 if(status==="approved"){
  const approvedCheckpoint=String(head.approvedCheckpointSha||"").toLowerCase();
  if(approvedCheckpoint!==latest.checkpointSha||!clean(head.reviewedBy,128))
   return {ok:false,reason:"legacy_github_approval_incomplete"};
  verification={teacherUid:task.ownerUid,note:clean(head.verificationNote,2000)||
    "Historical MCS evidence approval migrated under the canonical assessment owner.",
   verifiedCheckpointSha:latest.checkpointSha,verifiedCommitShas:[...latest.selectedCommitShas],
   version:latest.version};
 }
 const evidenceId=v4Key(SCHOOL_ID,task.taskId,student.uid);
 return {ok:true,evidenceId,targetPath:"schools/"+SCHOOL_ID+"/github_evidence/"+evidenceId,
  schoolId:SCHOOL_ID,taskId:task.taskId,offeringId:task.offeringId,
  studentUid:student.uid,personId:student.personId,status,currentVersion:latest.version,
  repository:latest.repository,selectedCommitShas:latest.selectedCommitShas,
  checkpointSha:latest.checkpointSha,evidenceDigest:latest.evidenceDigest,
  verification,approvedByUid:verification?.teacherUid||null,
  approvedAt:status==="approved"?(timeMillis(head.reviewedAt)||null):null,
  reopenReason:status==="reopened"?clean(head.reopenReason,2000):"",
  revisionDueAt:null,requiresRevisionExtension:status==="reopened"&&Number(task.dueAt)<Date.now(),
  versions:versions.map(version=>({schoolId:SCHOOL_ID,taskId:task.taskId,offeringId:task.offeringId,
   studentUid:student.uid,personId:student.personId,repository:version.repository,
   selectedCommitShas:version.selectedCommitShas,checkpointSha:version.checkpointSha,
   evidenceDigest:version.evidenceDigest,version:version.version,submittedAt:version.submittedAt,
   migration:{legacyRevision:version.legacyRevision,legacyStatus:version.legacyStatus}})),
  migration:{sourcePath:row.path,legacyEvidenceId:row.id,legacyRevision:Number(head.revision)||0,
   verifiedContributionCommits:verifiedSubset,contributionScope:clean(head.contributionScope,3000),
   legacyReviewedBy:clean(head.reviewedBy,128),originalStatus:status}};
}
function convertStudioSnapshot(version){
 const json=typeof version?.snapshotJson==="string"?version.snapshotJson:"";
 const expected=String(version?.snapshotHash||"").toLowerCase();
 if(!json||!/^[a-f0-9]{64}$/.test(expected)||sha(json)!==expected)
  return {ok:false,reason:"studio_snapshot_checksum_mismatch"};
 let parsed;try{parsed=JSON.parse(json);}catch{return {ok:false,reason:"studio_snapshot_json_invalid"};}
 if(parsed?.schemaVersion!==1||!parsed.files||typeof parsed.files!=="object"||Array.isArray(parsed.files)||
    !Array.isArray(parsed.fileOrder)||parsed.fileOrder.length!==Object.keys(parsed.files).length||
    !parsed.fileOrder.every(path=>Object.hasOwn(parsed.files,path)))
  return {ok:false,reason:"studio_snapshot_shape_invalid"};
 const files=Object.keys(parsed.files).sort().map(path=>({path,content:String(parsed.files[path]??"")}));
 const artifacts={database:parsed.database||{tables:{},history:[]},design:parsed.design||{},
  config:parsed.config||{},evidence:{events:[],runs:[]}};
 try{validateFiles(files);validateArtifacts(artifacts);}catch(error){
  return {ok:false,reason:"studio_snapshot_exceeds_v4_contract",message:error.message};
 }
 return {ok:true,files,artifacts,sourceLanguage:clean(parsed.lang,30)||"text",
  contentDigest:digestProject(files,artifacts),legacySnapshotHash:expected};
}
function studioCandidate({row,versions,task,student,now=Date.now()}){
 const head=row.data,status=clean(head.status,40);
 if(!["submitted","reviewed","revision_requested"].includes(status))
  return {ok:false,reason:"unsupported_studio_lifecycle_status",status};
 if(clean(head.ownerUid,128)&&head.ownerUid!==student.uid)
  return {ok:false,reason:"studio_owner_uid_identity_mismatch"};
 const ordered=[...versions].sort((a,b)=>(Number(a.data?.revision)||Number(a.id)||0)-
  (Number(b.data?.revision)||Number(b.id)||0));
 if(!ordered.length)return {ok:false,reason:"studio_immutable_versions_missing"};
 const converted=[];
 for(const versionRow of ordered){
  const convertedSnapshot=convertStudioSnapshot(versionRow.data);
  if(!convertedSnapshot.ok)return convertedSnapshot;
  const version=Number(versionRow.data.revision)||Number(versionRow.id);
  if(!Number.isInteger(version)||version<1)return {ok:false,reason:"studio_version_number_invalid"};
  converted.push({version,...convertedSnapshot,projectId:clean(versionRow.data.projectId,128),
   submittedAt:timeMillis(versionRow.data.submittedAt),
   projectRevision:Number.isInteger(versionRow.data.projectRevision)?versionRow.data.projectRevision:0});
 }
 for(let index=0;index<converted.length;index++)
  if(converted[index].version!==index+1)return {ok:false,reason:"studio_version_sequence_gap"};
 const current=converted.at(-1),headRevision=Number(head.revision)||0;
 if(headRevision!==current.version||String(head.snapshotHash||"").toLowerCase()!==current.legacySnapshotHash)
  return {ok:false,reason:"studio_head_version_mismatch"};
 const mappedStatus=status==="revision_requested"?"reopened":status;
 const requiresRevisionExtension=mappedStatus==="reopened"&&Number(task.dueAt)<now;
 const submissionId=v4Key(SCHOOL_ID,task.taskId,student.uid);
 return {ok:true,submissionId,targetPath:"schools/"+SCHOOL_ID+"/studio_submissions/"+submissionId,
  schoolId:SCHOOL_ID,taskId:task.taskId,offeringId:task.offeringId,
  studentUid:student.uid,personId:student.personId,projectId:clean(head.projectId,128)||current.projectId,
  projectRevision:current.projectRevision,contentDigest:current.contentDigest,status:mappedStatus,
  currentVersion:current.version,revisionRequestMessage:mappedStatus==="reopened"?clean(head.reviewNote||head.revisionRequestMessage,2000):null,
  revisionDueAt:null,requiresRevisionExtension,
  reviewedByUid:mappedStatus==="reviewed"?task.ownerUid:null,
  versions:converted.map(item=>({schoolId:SCHOOL_ID,taskId:task.taskId,studentUid:student.uid,
   personId:student.personId,projectId:item.projectId,projectRevision:item.projectRevision,
   files:item.files,artifacts:item.artifacts,contentDigest:item.contentDigest,
   sourceLanguage:item.sourceLanguage,submittedAt:item.submittedAt,version:item.version,
   migration:{legacySnapshotHash:item.legacySnapshotHash}})),
  migration:{sourcePath:row.path,legacySubmissionId:row.id,originalStatus:status,
   legacyReviewedBy:clean(head.reviewedBy,128),legacyReviewNote:clean(head.reviewNote,2000)}};
}
function normalizeCriterionArray(rows,rubric){
 if(!Array.isArray(rows)||rows.length!==rubric.length)return null;
 const output=[];
 for(let index=0;index<rubric.length;index++){
  const source=rows[index]||{},criterion=rubric[index],maximum=Number(criterion.points);
  const name=clean(source.name||source.criterion,160);
  const sourceMax=Number(source.maxScore??source.max??source.maximum??maximum);
  const rawScore=source.awardedPoints??source.score;
  const rawPending=source.pendingPoints??0;
  const awarded=rawScore===null?0:Number(rawScore),pending=Number(rawPending);
  if(name&&name.toLocaleLowerCase("en")!==String(criterion.name).toLocaleLowerCase("en"))return null;
  if(!Number.isFinite(sourceMax)||Math.abs(sourceMax-maximum)>0.001||
     !Number.isFinite(awarded)||awarded<0||!Number.isFinite(pending)||pending<0||
     awarded+pending>maximum+0.000001)return null;
  output.push({name:String(criterion.name),maximum,awardedPoints:awarded,pendingPoints:pending,
   comment:clean(source.comment||source.rationale||source.reviewAction,1000)});
 }
 return output;
}
function legacyGradeCriteria(grade,task){
 const rubric=task.rubric||[],score=Number(grade?.score),maxScore=Number(grade?.maxScore);
 if(!rubric.length||!Number.isFinite(score)||score<0)return {ok:false,reason:"grade_score_invalid"};
 const total=rubric.reduce((sum,row)=>sum+Number(row.points),0);
 if(Number.isFinite(maxScore)&&Math.abs(maxScore-total)>0.001)
  return {ok:false,reason:"grade_maximum_mismatch",legacyMax:maxScore,canonicalMax:total};
 const candidates=[
  grade?.evaluationDraft?.criteria,grade?.aiAssistance?.criterionScores,grade?.criteria,
  grade?.rawAiData?.breakdown,grade?.breakdown
 ];
 let criteria=null;
 for(const candidate of candidates){criteria=normalizeCriterionArray(candidate,rubric);if(criteria)break;}
 if(!criteria&&rubric.length===1&&score<=Number(rubric[0].points))
  criteria=[{name:String(rubric[0].name),maximum:Number(rubric[0].points),
   awardedPoints:score,pendingPoints:0,comment:""}];
 if(!criteria)return {ok:false,reason:"grade_criterion_breakdown_missing"};
 const awarded=criteria.reduce((sum,row)=>sum+row.awardedPoints,0),
  pending=criteria.reduce((sum,row)=>sum+row.pendingPoints,0);
 if(Math.abs(awarded-score)>0.001)
  return {ok:false,reason:"grade_criterion_total_stale",criterionAwarded:awarded,legacyScore:score};
 if(grade.published===true&&pending>0)return {ok:false,reason:"published_grade_has_pending_points"};
 return {ok:true,criteria,awarded,pending,total};
}
function gradeCandidate({row,task,student,github,studio,revisions}){
 const grade=row.data,scored=legacyGradeCriteria(grade,task);
 let scoreModel=scored,gradeSchema="rubric_v1";
 if(!scored.ok&&["grade_criterion_breakdown_missing","grade_criterion_total_stale"].includes(scored.reason)){
  const awarded=Number(grade.score),total=(task.rubric||[]).reduce((sum,item)=>sum+Number(item.points||0),0);
  const legacyMax=Number(grade.maxScore);
  if(!Number.isFinite(awarded)||awarded<0||awarded>total+0.000001||
     (Number.isFinite(legacyMax)&&Math.abs(legacyMax-total)>0.001))return scored;
  gradeSchema="legacy_scalar_v1";
  scoreModel={ok:true,criteria:[],awarded,pending:0,total,
   compatibilityReason:scored.reason};
 }else if(!scored.ok)return scored;
 const status=grade.published===true?"published":"draft";
 let evidenceType,submissionId,submissionVersion,submissionDigest;
 if(task.submissionSource==="github"){
  if(!github)return {ok:false,reason:"grade_github_evidence_missing"};
  if(grade.gradedSha!==github.checkpointSha||Number(grade.evidenceRevision)!==Number(github.migration.legacyRevision))
   return {ok:false,reason:"grade_github_evidence_binding_mismatch"};
  if(status==="published"&&github.status!=="approved")
   return {ok:false,reason:"published_grade_github_evidence_not_approved"};
  evidenceType="github";submissionId=github.evidenceId;
  submissionVersion=github.currentVersion;submissionDigest=github.evidenceDigest;
 }else{
  if(!studio)return {ok:false,reason:"grade_studio_submission_missing"};
  const legacyRevision=Number(grade.studioRevision);
  const version=studio.versions.find(item=>item.version===legacyRevision);
  if(!version||String(grade.studioSnapshotHash||"").toLowerCase()!==version.migration.legacySnapshotHash)
   return {ok:false,reason:"grade_studio_evidence_binding_mismatch"};
  if(clean(grade.reviewedBy,128)&&clean(studio.migration.legacyReviewedBy,128)&&
     clean(grade.reviewedBy,128)!==clean(studio.migration.legacyReviewedBy,128))
   return {ok:false,reason:"grade_studio_reviewer_mismatch"};
  if(status==="published"&&studio.status!=="reviewed")
   return {ok:false,reason:"published_grade_studio_submission_not_reviewed"};
  evidenceType="studio";submissionId=studio.submissionId;
  submissionVersion=version.version;submissionDigest=version.contentDigest;
 }
 const gradeId=v4Key(task.taskId,student.uid);
 return {ok:true,gradeId,targetPath:"schools/"+SCHOOL_ID+"/student_grades/"+gradeId,
  schoolId:SCHOOL_ID,taskId:task.taskId,offeringId:task.offeringId,
  personId:student.personId,studentUid:student.uid,reviewerUid:task.ownerUid,
  evidenceType,submissionId,submissionVersion,submissionDigest,
  gradeSchema,criteria:scoreModel.criteria,awarded:scoreModel.awarded,pending:scoreModel.pending,total:scoreModel.total,
  feedback:clean(grade.feedback,5000),status,revision:Math.max(1,Number(grade.gradeVersion)||1),
  publishedAt:status==="published"?(timeMillis(grade.publishedAt)||timeMillis(grade.updatedAt)||timeMillis(grade.gradedAt)):null,
  migration:{sourcePath:row.path,legacyGradeId:row.id,legacyGradeSource:clean(grade.gradeSource,80),
   compatibilityReason:scoreModel.compatibilityReason||null,
   legacyReviewedBy:clean(grade.reviewedBy,128)||null,
   legacyRevisions:revisions.map(item=>({id:item.id,reason:clean(item.data.reason,1000),
    editorUid:clean(item.data.editorUid,128),before:item.data.before||null,after:item.data.after||null,
    createdAt:timeMillis(item.data.createdAt)}))}};
}
async function readMirrorSubcollection(db,root,id,subcollection,max=2000){
 const collection=db.collection("schools/"+SCHOOL_ID+"/legacy_roots/"+root+"/documents/"+id+"/"+subcollection);
 const rows=[];let cursor=null;
 while(rows.length<max){
  let query=collection.orderBy(FieldPath.documentId()).limit(Math.min(200,max-rows.length));
  if(cursor)query=query.startAfter(cursor);
  const page=await query.get();
  for(const doc of page.docs)rows.push({id:doc.id,path:doc.ref.path,data:doc.data(),digest:canonicalDigest(doc.data())});
  if(page.size<200)return rows;cursor=page.docs.at(-1);
 }
 throw Error(root+"/"+id+"/"+subcollection+" exceeded the migration planner cap.");
}
async function buildEvidenceGradePlan(db,{foundationPlan,foundationPlanRaw,foundationApproval,
 academicAccessPlan,academicAccessPlanRaw,academicAccessApproval,
 assessmentPlan,assessmentPlanRaw,assessmentApproval}){
 const approvedAssessments=validateAssessmentApproval(
  validateAssessmentPlan(assessmentPlan),assessmentPlanRaw,assessmentApproval);
 const approvedAssessmentView={...assessmentPlan,tasks:approvedAssessments.tasks,
  blueprints:approvedAssessments.blueprints};
 const students=approvedStudentMap(foundationPlan,foundationPlanRaw,foundationApproval);
 const access=validateAccessApproval(validateAccessPlan(academicAccessPlan),academicAccessPlanRaw,academicAccessApproval);
 const enrolled=new Set(access.enrollments.filter(row=>row.status==="active").map(row=>row.personId+"|"+row.offeringId));
 const [githubRows,studioRows,gradeRows,gradeRevisionRows]=await Promise.all([
  readMirrorRoot(db,"assessment_evidence"),readMirrorRoot(db,"studio_submissions"),
  readMirrorRoot(db,"student_grades"),readMirrorRoot(db,"grade_revisions")
 ]);
 const githubEvidence=[],studioSubmissions=[],grades=[],blockers=[],reviewItems=[];
 const githubByKey=new Map(),studioByKey=new Map();
 for(const row of githubRows){
  const legacyStudentId=clean(row.data.studentId,128),student=students.get(legacyStudentId),
   task=exactTask(approvedAssessmentView,clean(row.data.assessmentId,128),clean(row.data.section,140),"github");
  if(!student){blockers.push({type:"github_student_identity_unmapped",sourcePath:row.path,legacyStudentId});continue;}
  if(!task){blockers.push({type:"github_task_mapping_unresolved",sourcePath:row.path});continue;}
  if(!enrolled.has(student.personId+"|"+task.offeringId)){
   blockers.push({type:"github_student_not_enrolled",sourcePath:row.path,personId:student.personId,offeringId:task.offeringId});continue;
  }
  const revisions=await readMirrorSubcollection(db,"assessment_evidence",row.id,"revisions");
  const candidate=githubCandidate({row,revisions,task,student});
  if(!candidate.ok){blockers.push({type:candidate.reason,sourcePath:row.path,status:candidate.status||null});continue;}
  if(candidate.requiresRevisionExtension)reviewItems.push({
   type:"github_reopened_extension_required",evidenceId:candidate.evidenceId,taskId:task.taskId,
   studentUid:student.uid,originalDueAt:task.dueAt,resolvedBy:"Set an explicit reviewed migration revisionExtensionDueAt."
  });
  githubEvidence.push(candidate);githubByKey.set(task.taskId+"|"+student.uid,candidate);
 }
 for(const row of studioRows){
  const legacyStudentId=clean(row.data.studentId,128),student=students.get(legacyStudentId),
   task=exactTask(approvedAssessmentView,clean(row.data.assessmentId,128),clean(row.data.section,140),"studio");
  if(!student){blockers.push({type:"studio_student_identity_unmapped",sourcePath:row.path,legacyStudentId});continue;}
  if(!task){blockers.push({type:"studio_task_mapping_unresolved",sourcePath:row.path});continue;}
  if(!enrolled.has(student.personId+"|"+task.offeringId)){
   blockers.push({type:"studio_student_not_enrolled",sourcePath:row.path,personId:student.personId,offeringId:task.offeringId});continue;
  }
  const versions=await readMirrorSubcollection(db,"studio_submissions",row.id,"versions");
  const candidate=studioCandidate({row,versions,task,student});
  if(!candidate.ok){blockers.push({type:candidate.reason,sourcePath:row.path,
    taskDueAt:candidate.taskDueAt||null,message:candidate.message||""});continue;}
  if(candidate.requiresRevisionExtension)reviewItems.push({
   type:"studio_reopened_extension_required",submissionId:candidate.submissionId,taskId:task.taskId,
   studentUid:student.uid,originalDueAt:task.dueAt,resolvedBy:"Set an explicit reviewed migration revisionExtensionDueAt."
  });
  studioSubmissions.push(candidate);studioByKey.set(task.taskId+"|"+student.uid,candidate);
 }
 for(const row of gradeRows){
  const legacyStudentId=clean(row.data.studentId,128),student=students.get(legacyStudentId);
  if(!student){blockers.push({type:"grade_student_identity_unmapped",sourcePath:row.path,legacyStudentId});continue;}
  const task=exactTask(approvedAssessmentView,clean(row.data.taskId,128),clean(row.data.section,140),
    row.data.gradeSource==="studio_teacher_review"?"studio":"github");
  if(!task){blockers.push({type:"grade_task_mapping_unresolved",sourcePath:row.path});continue;}
  if(!enrolled.has(student.personId+"|"+task.offeringId)){
   blockers.push({type:"grade_student_not_enrolled",sourcePath:row.path,personId:student.personId,offeringId:task.offeringId});continue;
  }
  const revisions=gradeRevisionRows.filter(item=>item.data.gradeId===row.id);
  const candidate=gradeCandidate({row,task,student,
   github:githubByKey.get(task.taskId+"|"+student.uid),
   studio:studioByKey.get(task.taskId+"|"+student.uid),revisions});
  if(!candidate.ok){
   blockers.push({type:candidate.reason,sourcePath:row.path,legacyGradeId:row.id,
    legacyScore:Number(row.data.score),taskId:task.taskId});continue;
  }
  if(candidate.gradeSchema==="legacy_scalar_v1")reviewItems.push({
   type:"historical_scalar_grade_preserved",legacyGradeId:row.id,taskId:task.taskId,
   studentUid:student.uid,awarded:candidate.awarded,total:candidate.total,
   resolution:"Preserve exact scalar score/feedback. Teacher may later reconstruct rubric allocation without changing the published score."
  });
  grades.push(candidate);
 }
 return {schema:SCHEMA,schoolId:SCHOOL_ID,readOnly:true,generatedAt:new Date().toISOString(),
  source:{foundationPlanSha256:sha(foundationPlanRaw),academicAccessPlanSha256:sha(academicAccessPlanRaw),
   assessmentPlanSha256:sha(assessmentPlanRaw)},
  githubEvidence,studioSubmissions,grades,blockers,reviewItems,readyForApply:false,
  summary:{githubEvidence:githubEvidence.length,studioSubmissions:studioSubmissions.length,
   grades:grades.length,blockers:blockers.length,reviewItems:reviewItems.length},
  nextRequiredReview:[
   "Do not auto-convert withdrawn or teacher-discovered checkpoint-only GitHub evidence into ordinary submitted evidence.",
   "Provide an explicit revision extension policy for historical Studio revision requests whose original deadline already passed.",
   "Multi-criterion scalar grades without a trustworthy saved breakdown use the read-only legacy_scalar_v1 representation; do not distribute points across rubric rows.",
   "Preserve grade publication state and revision history without firing student notifications during migration."
  ]};
}
function arg(args,name){
 const value=args.find(item=>item.startsWith("--"+name+"="))?.slice(name.length+3);
 if(!value||!value.startsWith("/")||value.includes("\0"))throw Error("Provide --"+name+" as a restricted absolute path.");
 return value;
}
function read(path){const raw=readFileSync(path),data=JSON.parse(raw.toString("utf8"));return {raw,data};}
async function main(){
 const args=process.argv.slice(2);
 const foundation=read(arg(args,"foundation-plan")),foundationApproval=read(arg(args,"foundation-approval")),
  access=read(arg(args,"academic-access-plan")),accessApproval=read(arg(args,"academic-access-approval")),
  assessment=read(arg(args,"assessment-plan")),assessmentApproval=read(arg(args,"assessment-approval")),
  output=arg(args,"output");
 if(!getApps().length)initializeApp({credential:applicationDefault()});
 const plan=await buildEvidenceGradePlan(getFirestore(),{
  foundationPlan:foundation.data,foundationPlanRaw:foundation.raw,foundationApproval:foundationApproval.data,
  academicAccessPlan:access.data,academicAccessPlanRaw:access.raw,academicAccessApproval:accessApproval.data,
  assessmentPlan:assessment.data,assessmentPlanRaw:assessment.raw,assessmentApproval:assessmentApproval.data
 });
 writeFileSync(output,JSON.stringify(plan,null,2)+"\n",{flag:"wx",mode:0o600});
 console.info(JSON.stringify({evidenceGradePlanCreated:true,schoolId:SCHOOL_ID,summary:plan.summary,readyForApply:false}));
}
if(require.main===module)main().catch(error=>{
 console.error("MCS evidence/grade planning failed:",error.code||error.message);process.exitCode=1;
});
module.exports={SCHEMA,v4Key,timeMillis,studentIdFromPath,approvedStudentMap,exactTask,
 normalizeGithubFrozen,githubTimeline,githubCandidate,convertStudioSnapshot,studioCandidate,
 normalizeCriterionArray,legacyGradeCriteria,gradeCandidate,readMirrorSubcollection,buildEvidenceGradePlan};
