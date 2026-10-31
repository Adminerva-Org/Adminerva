"use strict";
/** Creates an unapproved review artifact for MCS reference folders and schedules. */
const {readFileSync,writeFileSync}=require("node:fs");
const {createHash}=require("node:crypto");
const {SCHEMA}=require("./mcs-canonical-planning-support-plan.js");
const {SCHOOL_ID}=require("./mcs-canonical-foundation-plan.js");

const APPROVAL_SCHEMA="adminerva-v4-mcs-canonical-planning-support-approval-v1";
const sha=value=>createHash("sha256").update(value).digest("hex");

function arg(args,name){
 const value=args.find(item=>item.startsWith("--"+name+"="))?.slice(name.length+3);
 if(!value||!value.startsWith("/")||value.includes("\0"))
  throw Error("Provide --"+name+" as a restricted absolute path.");
 return value;
}
function createTemplate(plan,raw){
 if(plan?.schema!==SCHEMA||plan.schoolId!==SCHOOL_ID||plan.readOnly!==true||
    plan.readyForApply!==false)
  throw Error("Use a current MCS planning-support plan.");
 return {
  schema:APPROVAL_SCHEMA,schoolId:SCHOOL_ID,scope:"canonical_planning_support_only",
  planSha256:sha(raw),approvedBy:"",approvedAt:"",
  acknowledgements:{
   referenceOwnershipReviewed:false,
   extractedTextOnlyReviewed:false,
   referenceIdContinuityReviewed:false,
   scheduleOwnershipReviewed:false,
   scheduleAssignmentPairsReviewed:false,
   scheduleRevisionHistoryReviewed:false,
   sharedLegacySourcesReviewed:false,
   noSharedDataReplication:true,
   noMigrationNotifications:true,
   backupsAndRollbackReviewed:false
  },
  referenceFolders:(plan.referenceFolders||[]).map(row=>({
   folderId:row.folderId,ownerUid:row.ownerUid,name:row.name,
   documentCount:row.documentCount,decision:"pending",exclusionReason:""
  })),
  schedules:(plan.schedules||[]).map(row=>({
   scheduleId:row.scheduleId,ownerUid:row.ownerUid,
   schoolYear:row.schoolYear,semester:row.semester,revision:row.revision,
   decision:"pending",exclusionReason:""
  })),
  unresolvedBlockers:plan.blockers||[],
  reviewItems:(plan.reviewItems||[]).map(item=>({...item,resolved:false,resolution:""})),
  sharedLegacySources:plan.sharedLegacySources||{},
  reviewNotes:"",
  warning:"UNAPPROVED TEMPLATE. Teacher-owned references and timetables remain private. Shared legacy data is not replicated automatically."
 };
}
function main(){
 const args=process.argv.slice(2),planPath=arg(args,"plan"),output=arg(args,"output");
 const raw=readFileSync(planPath),plan=JSON.parse(raw.toString("utf8"));
 const template=createTemplate(plan,raw);
 writeFileSync(output,JSON.stringify(template,null,2)+"\n",{flag:"wx",mode:0o600});
 console.info(JSON.stringify({
  templateCreated:true,schoolId:SCHOOL_ID,
  referenceFolders:template.referenceFolders.length,schedules:template.schedules.length,
  blockers:template.unresolvedBlockers.length,reviewItems:template.reviewItems.length,
  approved:false
 }));
}
if(require.main===module)try{main();}catch(error){
 console.error("Planning-support approval template failed:",error.message);
 process.exitCode=1;
}
module.exports={APPROVAL_SCHEMA,createTemplate};
