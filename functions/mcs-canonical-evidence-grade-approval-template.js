"use strict";
/**
 * Creates an UNAPPROVED review artifact for canonical MCS evidence/submission/
 * grade migration. Every proposed record must be explicitly approved/excluded.
 */
const {readFileSync,writeFileSync}=require("node:fs");
const {createHash}=require("node:crypto");
const {SCHEMA}=require("./mcs-canonical-evidence-grade-plan.js");
const {SCHOOL_ID}=require("./mcs-canonical-foundation-plan.js");

const APPROVAL_SCHEMA="adminerva-v4-mcs-canonical-evidence-grade-approval-v1";
const sha=value=>createHash("sha256").update(value).digest("hex");

function arg(args,name){
 const value=args.find(item=>item.startsWith("--"+name+"="))?.slice(name.length+3);
 if(!value||!value.startsWith("/")||value.includes("\0"))
  throw Error("Provide --"+name+" as a restricted absolute path.");
 return value;
}
function decisionRow(row,key){
 return {
  [key]:row[key],taskId:row.taskId,studentUid:row.studentUid,
  status:row.status,currentVersion:row.currentVersion,
  requiresRevisionExtension:Boolean(row.requiresRevisionExtension),
  revisionExtensionDueAt:"",
  decision:"pending",exclusionReason:""
 };
}
function gradeRow(row){
 return {
  gradeId:row.gradeId,taskId:row.taskId,studentUid:row.studentUid,
  status:row.status,gradeSchema:row.gradeSchema||"rubric_v1",
  awarded:row.awarded,total:row.total,
  decision:"pending",exclusionReason:""
 };
}
function createTemplate(plan,raw){
 if(plan?.schema!==SCHEMA||plan.schoolId!==SCHOOL_ID||plan.readOnly!==true||
    plan.readyForApply!==false)
  throw Error("Use a current MCS canonical evidence/grade plan.");
 return {
  schema:APPROVAL_SCHEMA,schoolId:SCHOOL_ID,
  scope:"canonical_evidence_grades_only",
  planSha256:sha(raw),approvedBy:"",approvedAt:"",
  acknowledgements:{
   githubFrozenSetsReviewed:false,
   studioSnapshotsReviewed:false,
   studentTaskEnrollmentReviewed:false,
   publicationStatesReviewed:false,
   historicalScalarGradesReviewed:false,
   evidenceAndGradeRevisionsReviewed:false,
   revisionExtensionsReviewed:false,
   noMigrationNotifications:true,
   backupsAndRollbackReviewed:false
  },
  githubEvidence:(plan.githubEvidence||[]).map(row=>decisionRow(row,"evidenceId")),
  studioSubmissions:(plan.studioSubmissions||[]).map(row=>decisionRow(row,"submissionId")),
  grades:(plan.grades||[]).map(gradeRow),
  unresolvedBlockers:plan.blockers||[],
  reviewItems:(plan.reviewItems||[]).map(item=>({...item,resolved:false,resolution:""})),
  reviewNotes:"",
  warning:"UNAPPROVED TEMPLATE. Historical evidence and grades remain untouched until every row has an explicit decision and all review items are resolved."
 };
}
function main(){
 const args=process.argv.slice(2),planPath=arg(args,"plan"),output=arg(args,"output");
 const raw=readFileSync(planPath),plan=JSON.parse(raw.toString("utf8"));
 const template=createTemplate(plan,raw);
 writeFileSync(output,JSON.stringify(template,null,2)+"\n",{flag:"wx",mode:0o600});
 console.info(JSON.stringify({
  templateCreated:true,schoolId:SCHOOL_ID,
  githubEvidence:template.githubEvidence.length,
  studioSubmissions:template.studioSubmissions.length,
  grades:template.grades.length,
  blockers:template.unresolvedBlockers.length,
  reviewItems:template.reviewItems.length,approved:false
 }));
}
if(require.main===module)try{main();}catch(error){
 console.error("Evidence/grade approval template failed:",error.message);
 process.exitCode=1;
}
module.exports={APPROVAL_SCHEMA,createTemplate};
