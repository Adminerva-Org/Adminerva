"use strict";
/** Unapproved review template for canonical MCS assessment blueprints/deployments. */
const {readFileSync,writeFileSync}=require("node:fs");
const {createHash}=require("node:crypto");
const {SCHEMA}=require("./mcs-canonical-assessment-plan.js");
const {SCHOOL_ID}=require("./mcs-canonical-foundation-plan.js");
const APPROVAL_SCHEMA="adminerva-v4-mcs-canonical-assessment-approval-v1";
const sha=value=>createHash("sha256").update(value).digest("hex");
function arg(args,name){
 const value=args.find(item=>item.startsWith("--"+name+"="))?.slice(name.length+3);
 if(!value||!value.startsWith("/")||value.includes("\0"))throw Error("Provide --"+name+" as a restricted absolute path.");
 return value;
}
function createTemplate(plan,raw){
 if(plan?.schema!==SCHEMA||plan.schoolId!==SCHOOL_ID||plan.readOnly!==true||plan.readyForApply!==false)
  throw Error("Use a current MCS canonical assessment plan.");
 return {
  schema:APPROVAL_SCHEMA,schoolId:SCHOOL_ID,scope:"canonical_assessments_only",
  planSha256:sha(raw),approvedBy:"",approvedAt:"",
  acknowledgements:{
   ownersReviewed:false,rubricsReviewed:false,offeringScopesReviewed:false,
   submissionModesReviewed:false,legacyNoDeadlineReviewed:false,
   historicalLinksReviewed:false,noDeploymentNotifications:true,
   backupsAndRollbackReviewed:false
  },
  blueprints:(plan.blueprints||[]).map(row=>({
   blueprintId:row.blueprintId,ownerUid:row.ownerUid,title:row.title,
   decision:"pending",exclusionReason:""
  })),
  tasks:(plan.tasks||[]).map(row=>({
   taskId:row.taskId,blueprintId:row.blueprintId,ownerUid:row.ownerUid,
   offeringId:row.offeringId,submissionSource:row.submissionSource,
   legacyNoDeadline:Boolean(row.legacyNoDeadline),
   decision:"pending",exclusionReason:""
  })),
  unresolvedBlockers:plan.blockers||[],
  reviewItems:(plan.reviewItems||[]).map(item=>({...item,resolved:false,resolution:""})),
  reviewNotes:"",
  warning:"UNAPPROVED TEMPLATE. Historical deployment migration is silent and cannot be used to send new-assignment notifications."
 };
}
function main(){
 const args=process.argv.slice(2),planPath=arg(args,"plan"),output=arg(args,"output");
 const raw=readFileSync(planPath),plan=JSON.parse(raw.toString("utf8")),template=createTemplate(plan,raw);
 writeFileSync(output,JSON.stringify(template,null,2)+"\n",{flag:"wx",mode:0o600});
 console.info(JSON.stringify({templateCreated:true,schoolId:SCHOOL_ID,
  blueprints:template.blueprints.length,tasks:template.tasks.length,
  blockers:template.unresolvedBlockers.length,approved:false}));
}
if(require.main===module)try{main();}catch(error){
 console.error("Assessment approval template failed:",error.message);process.exitCode=1;
}
module.exports={APPROVAL_SCHEMA,createTemplate};
