"use strict";
/**
 * Read-only MCS assessment migration planner.
 *
 * Requires an approved canonical foundation mapping. Produces deterministic
 * assessment-blueprint and deployed-task candidates only when teacher ownership,
 * rubric points and course-offering scope can be preserved exactly.
 */
const {initializeApp,getApps,applicationDefault}=require("firebase-admin/app");
const {getFirestore}=require("firebase-admin/firestore");
const {readFileSync,writeFileSync}=require("node:fs");
const {createHash}=require("node:crypto");
const {canonicalDigest}=require("./mcs-migration-ledger.js");
const {readMirrorRoot,SCHOOL_ID}=require("./mcs-canonical-foundation-plan.js");
const {validatePlan,validateApproval}=require("./mcs-canonical-foundation-apply.js");

const SCHEMA="adminerva-v4-mcs-canonical-assessment-plan-v1";
function sha(value){return createHash("sha256").update(value).digest("hex");}
function clean(value,max=20000){return typeof value==="string"?value.trim().slice(0,max):"";}
function stableId(prefix,...parts){return prefix+"_"+sha(parts.join("\0")).slice(0,40);}
function millis(value){
 if(!value)return null;
 if(typeof value.toMillis==="function")return value.toMillis();
 if(typeof value==="string"){
  const parsed=Date.parse(value);return Number.isFinite(parsed)?parsed:null;
 }
 if(value instanceof Date)return value.getTime();
 return null;
}
function parseLegacyRubric(text,maxScore){
 const raw=clean(text,30000),max=Number(maxScore);
 if(!raw||!Number.isFinite(max)||max<=0)return {ok:false,reason:"missing_rubric_or_maximum"};
 const lines=raw.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
 if(!lines.length||lines.length>20)return {ok:false,reason:"rubric_line_count"};
 const rubric=[];
 for(const line of lines){
  const match=line.match(/^\d+[.)]\s*(.+?)\s+[—-]\s*(\d+(?:\.\d+)?)\s+points?\b(?:\s*:\s*.*)?$/i);
  if(!match)return {ok:false,reason:"unparseable_rubric_line",line};
  const name=clean(match[1],160),points=Number(match[2]);
  if(!name||!Number.isFinite(points)||points<=0||points>100)
   return {ok:false,reason:"invalid_rubric_points",line};
  rubric.push({name,points});
 }
 const total=Math.round(rubric.reduce((sum,row)=>sum+row.points,0)*100)/100;
 if(Math.abs(total-max)>0.001)return {ok:false,reason:"rubric_total_mismatch",total,maxScore:max};
 return {ok:true,rubric,total};
}
function legacySubmissionSource(data){
 if(Number(data?.schemaVersion)===3&&data?.submissionSource==="studio")return "studio";
 if(Number(data?.schemaVersion)===2&&data?.evidenceMode==="commit_selection")return "github";
 return null;
}
function labelMap(rows){
 const map=new Map();
 for(const row of rows||[]){
  if(row.approved!==true)continue;
  const key=clean(row.legacyLabel,140).toLocaleLowerCase("en");
  if(!key)continue;
  if(map.has(key)&&map.get(key)!==row.targetId)throw Error("One legacy academic label maps to multiple target IDs.");
  map.set(key,row.targetId);
 }
 return map;
}
function approvedAcademicMaps(approval){
 return {
  years:labelMap(approval.academic?.years),
  sections:labelMap(approval.academic?.sections),
  subjects:labelMap(approval.academic?.subjects),
  terms:labelMap(approval.academic?.terms)
 };
}
function offeringFor({assessment,deployment,approval,approved}){
 const maps=approvedAcademicMaps(approval);
 const sectionLabel=clean(deployment?.section||deployment?.sectionId,140),
  subjectLabel=clean(assessment?.subject||assessment?.subjectName,140),
  termLabel=clean(assessment?.quarter||assessment?.term||assessment?.academicTerm,140),
  yearLabel=clean(assessment?.schoolYear||assessment?.school_year||assessment?.academicYear,140);
 const sectionId=maps.sections.get(sectionLabel.toLocaleLowerCase("en"));
 const subjectId=maps.subjects.get(subjectLabel.toLocaleLowerCase("en"));
 if(!sectionId)return {ok:false,reason:"section_mapping_missing",sectionLabel};
 if(!subjectId)return {ok:false,reason:"subject_mapping_missing",subjectLabel};
 let candidates=approved.offerings.filter(row=>row.sectionId===sectionId&&row.subjectId===subjectId);
 const termId=termLabel?maps.terms.get(termLabel.toLocaleLowerCase("en")):null;
 const yearId=yearLabel?maps.years.get(yearLabel.toLocaleLowerCase("en")):null;
 if(termLabel&&!termId)return {ok:false,reason:"term_mapping_missing",termLabel};
 if(yearLabel&&!yearId)return {ok:false,reason:"year_mapping_missing",yearLabel};
 if(termId)candidates=candidates.filter(row=>row.termId===termId);
 if(yearId)candidates=candidates.filter(row=>row.yearId===yearId);
 if(candidates.length!==1)return {ok:false,reason:candidates.length?"offering_mapping_ambiguous":"offering_mapping_missing",
   sectionId,subjectId,termId,yearId,candidateOfferingIds:candidates.map(row=>row.offeringId)};
 return {ok:true,...candidates[0],sectionLabel,subjectLabel,termLabel,yearLabel};
}
function deploymentWindow(assessment,deployment){
 const section=clean(deployment?.section||deployment?.sectionId,140);
 const studio=assessment?.studioWindows?.[section];
 const studioOpen=millis(studio?.opensAt),studioDue=millis(studio?.closesAt);
 if(Number.isFinite(studioOpen)&&Number.isFinite(studioDue)&&studioDue>studioOpen)
  return {ok:true,opensAt:studioOpen,dueAt:studioDue,source:"studio_window",legacyNoDeadline:false};
 const open=millis(deployment?.postDate),due=millis(deployment?.deadline);
 if(deployment?.deadlineEnabled!==false&&Number.isFinite(open)&&Number.isFinite(due)&&due>=open)
  return {ok:true,opensAt:open,dueAt:due===open?due+1000:due,source:"deployment_iso",legacyNoDeadline:false};
 if(deployment?.deadlineEnabled===false||(!deployment?.postDate&&!deployment?.deadline)){
  return {ok:true,opensAt:0,dueAt:Date.parse("2100-01-01T00:00:00.000Z"),
   source:"legacy_no_deadline_sentinel",legacyNoDeadline:true};
 }
 return {ok:false,reason:"deployment_window_invalid"};
}
function buildAssessmentPlan({rows,foundationPlan,foundationPlanRaw,foundationApproval}){
 const approved=validateApproval(validatePlan(foundationPlan),foundationPlanRaw,foundationApproval);
 const teachers=new Map(approved.memberships.filter(member=>member.roles.includes("teacher"))
   .map(member=>[member.uid,member]));
 const privateById=new Map((rows.private||[]).map(row=>[row.id,row.data]));
 const blueprints=[],tasks=[],blockers=[],reviewItems=[];
 for(const row of rows.assessments||[]){
  const legacy={...row.data,...(privateById.get(row.id)||{})},ownerUid=clean(legacy.ownerUid,128);
  const owner=teachers.get(ownerUid),source=legacySubmissionSource(legacy);
  if(!owner){blockers.push({type:"assessment_owner_unmapped",assessmentId:row.id,ownerUid});continue;}
  const parsed=parseLegacyRubric(legacy.evalCriteria,legacy.maxScore);
  if(!parsed.ok){blockers.push({type:"assessment_rubric_requires_review",assessmentId:row.id,
    reason:parsed.reason,details:parsed});continue;}
  if(!source){
   blockers.push({type:"assessment_submission_schema_unsupported",assessmentId:row.id,
    schemaVersion:legacy.schemaVersion||1,submissionSource:legacy.submissionSource||"legacy_repository"});continue;
  }
  const blueprintId=stableId("mcsbp",row.id);
  const blueprint={
   blueprintId,targetPath:"schools/"+SCHOOL_ID+"/assessment_blueprints/"+blueprintId,
   sourceAssessmentId:row.id,ownerUid,title:clean(legacy.title,140)||"Untitled assessment",
   description:clean(legacy.description,2000),instructions:clean(legacy.taskContext,20000),
   rubric:parsed.rubric,visibility:"private",status:"draft",
   sourceDigest:row.digest,migration:{sourcePath:row.path,schemaVersion:Number(legacy.schemaVersion)||1}
  };
  blueprints.push(blueprint);
  const deployments=Array.isArray(legacy.deployments)?legacy.deployments:[];
  for(let index=0;index<deployments.length;index++){
   const deployment=deployments[index],offering=offeringFor({
    assessment:legacy,deployment,approval:foundationApproval,approved
   });
   if(!offering.ok){blockers.push({type:"assessment_deployment_scope_unmapped",assessmentId:row.id,
     deploymentIndex:index,section:deployment?.section||"",reason:offering.reason,details:offering});continue;}
   const window=deploymentWindow(legacy,deployment);
   if(!window.ok){blockers.push({type:"assessment_deployment_window_invalid",assessmentId:row.id,
     deploymentIndex:index,section:deployment?.section||""});continue;}
   const deploymentKey=clean(deployment?.id,100)||String(index)+"_"+offering.sectionId;
   const taskId=stableId("mcstask",row.id,deploymentKey,offering.offeringId);
   tasks.push({
    taskId,targetPath:"schools/"+SCHOOL_ID+"/assessments/"+taskId,
    sourceAssessmentId:row.id,sourceDeploymentId:clean(deployment?.id,100)||null,
    blueprintId,ownerUid,offeringId:offering.offeringId,
    yearId:offering.yearId,termId:offering.termId,subjectId:offering.subjectId,sectionId:offering.sectionId,
    title:blueprint.title,description:blueprint.description,instructions:blueprint.instructions,
    rubric:blueprint.rubric,rubricMax:parsed.total,submissionSource:source,
    opensAt:window.opensAt,dueAt:window.dueAt,status:"deployed",
    legacyNoDeadline:window.legacyNoDeadline,windowSource:window.source,
    migration:{sourcePath:row.path,deploymentIndex:index,legacySection:offering.sectionLabel}
   });
   if(window.legacyNoDeadline)reviewItems.push({type:"legacy_no_deadline_preserved",
     assessmentId:row.id,taskId,section:offering.sectionLabel,
     resolution:"Review during lifecycle migration; canonical task currently uses the historical indefinite-window sentinel."});
  }
 }
 const taskByLegacy=new Map();
 for(const task of tasks){
  const list=taskByLegacy.get(task.sourceAssessmentId)||[];list.push(task);taskByLegacy.set(task.sourceAssessmentId,list);
 }
 const evidenceRefs=(rows.githubEvidence||[]).map(row=>({
  sourcePath:row.path,legacyEvidenceId:row.id,assessmentId:clean(row.data.assessmentId,128),
  studentId:clean(row.data.studentId,128),status:clean(row.data.status,40),
  candidateTaskIds:(taskByLegacy.get(clean(row.data.assessmentId,128))||[])
   .filter(task=>!row.data.section||task.migration.legacySection===row.data.section).map(task=>task.taskId)
 }));
 const studioRefs=(rows.studioSubmissions||[]).map(row=>({
  sourcePath:row.path,legacySubmissionId:row.id,assessmentId:clean(row.data.assessmentId,128),
  studentId:clean(row.data.studentId,128),section:clean(row.data.section,140),
  revision:Number(row.data.revision)||0,status:clean(row.data.status,40),
  snapshotHash:clean(row.data.snapshotHash,128),
  candidateTaskIds:(taskByLegacy.get(clean(row.data.assessmentId,128))||[])
   .filter(task=>!row.data.section||task.migration.legacySection===row.data.section).map(task=>task.taskId)
 }));
 const gradeRefs=(rows.grades||[]).map(row=>({
  sourcePath:row.path,legacyGradeId:row.id,taskId:clean(row.data.taskId,128),
  studentId:clean(row.data.studentId,128),published:row.data.published===true,
  score:Number(row.data.score),maxScore:Number(row.data.maxScore),
  candidateTaskIds:(taskByLegacy.get(clean(row.data.taskId,128))||[])
   .filter(task=>!row.data.section||task.migration.legacySection===row.data.section).map(task=>task.taskId)
 }));
 for(const ref of [...evidenceRefs,...studioRefs,...gradeRefs])
  if(ref.candidateTaskIds.length!==1)blockers.push({type:"historical_record_task_mapping_ambiguous",
    sourcePath:ref.sourcePath,candidateTaskIds:ref.candidateTaskIds});
 return {
  schema:SCHEMA,schoolId:SCHOOL_ID,readOnly:true,generatedAt:new Date().toISOString(),
  foundationPlanSha256:sha(foundationPlanRaw),blueprints,tasks,
  historicalLinks:{githubEvidence:evidenceRefs,studioSubmissions:studioRefs,grades:gradeRefs},
  blockers,reviewItems,readyForApply:false,
  summary:{legacyAssessments:(rows.assessments||[]).length,blueprints:blueprints.length,tasks:tasks.length,
   githubEvidence:evidenceRefs.length,studioSubmissions:studioRefs.length,grades:gradeRefs.length,
   blockers:blockers.length,reviewItems:reviewItems.length},
  nextRequiredReview:[
   "Resolve every assessment owner, rubric and course-offering blocker.",
   "Map each historical GitHub evidence, Studio submission and grade to exactly one canonical task and approved student identity.",
   "Preserve evidence/submission revision subcollections before any published grade is created.",
   "Do not publish or unpublish a legacy grade during migration; publication state must be reproduced exactly."
  ]
 };
}
async function generateAssessmentPlan(db,inputs){
 const [assessments,priv,githubEvidence,studioSubmissions,grades]=await Promise.all([
  readMirrorRoot(db,"assessments"),readMirrorRoot(db,"assessment_private"),
  readMirrorRoot(db,"assessment_evidence"),readMirrorRoot(db,"studio_submissions"),
  readMirrorRoot(db,"student_grades")
 ]);
 return buildAssessmentPlan({rows:{assessments,private:priv,githubEvidence,studioSubmissions,grades},...inputs});
}
function arg(args,name){
 const value=args.find(item=>item.startsWith("--"+name+"="))?.slice(name.length+3);
 if(!value||!value.startsWith("/")||value.includes("\0"))throw Error("Provide --"+name+" as a restricted absolute path.");
 return value;
}
function read(path){const raw=readFileSync(path),data=JSON.parse(raw.toString("utf8"));return {raw,data};}
async function main(){
 const args=process.argv.slice(2),foundationPath=arg(args,"foundation-plan"),
  approvalPath=arg(args,"foundation-approval"),output=arg(args,"output");
 const foundation=read(foundationPath),approval=read(approvalPath);
 if(!getApps().length)initializeApp({credential:applicationDefault()});
 const plan=await generateAssessmentPlan(getFirestore(),{
  foundationPlan:foundation.data,foundationPlanRaw:foundation.raw,foundationApproval:approval.data
 });
 writeFileSync(output,JSON.stringify(plan,null,2)+"\n",{flag:"wx",mode:0o600});
 console.info(JSON.stringify({assessmentPlanCreated:true,schoolId:SCHOOL_ID,
  summary:plan.summary,readyForApply:false}));
}
if(require.main===module)main().catch(error=>{
 console.error("MCS assessment planning failed:",error.code||error.message);process.exitCode=1;
});
module.exports={SCHEMA,stableId,millis,parseLegacyRubric,legacySubmissionSource,
 approvedAcademicMaps,offeringFor,deploymentWindow,buildAssessmentPlan,generateAssessmentPlan};
