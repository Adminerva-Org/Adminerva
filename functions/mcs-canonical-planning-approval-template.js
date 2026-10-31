"use strict";
/** Creates an unapproved review template for canonical MCS planning resources. */
const {readFileSync,writeFileSync}=require("node:fs");
const {createHash}=require("node:crypto");
const {SCHEMA}=require("./mcs-canonical-planning-plan.js");
const {SCHOOL_ID}=require("./mcs-canonical-foundation-plan.js");
const APPROVAL_SCHEMA="adminerva-v4-mcs-canonical-planning-approval-v1";
const sha=value=>createHash("sha256").update(value).digest("hex");
function arg(args,name){
 const value=args.find(item=>item.startsWith("--"+name+"="))?.slice(name.length+3);
 if(!value||!value.startsWith("/")||value.includes("\0"))
  throw Error("Provide --"+name+" as a restricted absolute path.");
 return value;
}
function createTemplate(plan,raw){
 if(plan?.schema!==SCHEMA||plan.schoolId!==SCHOOL_ID||plan.readOnly!==true||plan.readyForApply!==false)
  throw Error("Use a current MCS canonical planning plan.");
 return {
  schema:APPROVAL_SCHEMA,schoolId:SCHOOL_ID,scope:"canonical_planning_only",
  planSha256:sha(raw),approvedBy:"",approvedAt:"",
  acknowledgements:{
   teacherOwnershipReviewed:false,
   privateDefaultReviewed:false,
   lessonContentReviewed:false,
   presentationContentReviewed:false,
   revisionHistoryReviewed:false,
   archivedStateReviewed:false,
   unresolvedProvenanceReviewed:false,
   noAutomaticSharing:true,
   backupsAndRollbackReviewed:false
  },
  resources:(plan.resources||[]).map(row=>({
   resourceId:row.resourceId,kind:row.kind,ownerUid:row.ownerUid,title:row.title,
   status:row.status,revision:row.revision,
   decision:"pending",exclusionReason:""
  })),
  unresolvedBlockers:plan.blockers||[],
  reviewItems:(plan.reviewItems||[]).map(item=>({...item,resolved:false,resolution:""})),
  reviewNotes:"",
  warning:"UNAPPROVED TEMPLATE. Migrated planning resources remain private; sharing is never inherited or inferred."
 };
}
function main(){
 const args=process.argv.slice(2),planPath=arg(args,"plan"),output=arg(args,"output");
 const raw=readFileSync(planPath),plan=JSON.parse(raw.toString("utf8"));
 const template=createTemplate(plan,raw);
 writeFileSync(output,JSON.stringify(template,null,2)+"\n",{flag:"wx",mode:0o600});
 console.info(JSON.stringify({templateCreated:true,schoolId:SCHOOL_ID,
  resources:template.resources.length,blockers:template.unresolvedBlockers.length,
  reviewItems:template.reviewItems.length,approved:false}));
}
if(require.main===module)try{main();}catch(error){
 console.error("Planning approval template failed:",error.message);process.exitCode=1;
}
module.exports={APPROVAL_SCHEMA,createTemplate};
