"use strict";
/** Creates an unapproved operator review artifact for a continuity restore plan. */
const {readFileSync,writeFileSync}=require("node:fs");
const {createHash}=require("node:crypto");
const {PLAN_SCHEMA,AUTO_CATEGORIES}=require("./school-continuity-restore-plan.js");

const APPROVAL_SCHEMA="adminerva-school-continuity-restore-approval-v1";
const sha=value=>createHash("sha256").update(value).digest("hex");
function arg(args,name){
 const value=args.find(item=>item.startsWith("--"+name+"="))?.slice(name.length+3);
 if(!value||!value.startsWith("/")||value.includes("\0"))
  throw Error("Provide --"+name+" as a restricted absolute path.");
 return value;
}
function createTemplate(plan,raw){
 if(!plan||plan.schema!==PLAN_SCHEMA||plan.readOnly!==true||plan.readyForApply!==false)
  throw Error("Use a current school continuity restore plan.");
 return {
  schema:APPROVAL_SCHEMA,schoolId:plan.schoolId,scope:"school_continuity_restore_only",
  planSha256:sha(raw),exportSha256:plan.exportSha256,
  approvedBy:"",approvedAt:"",
  acknowledgements:{
   sameSchoolRestoreReviewed:false,
   targetConflictsResolved:false,
   membershipsAndRolesRecoveredSeparately:false,
   noAutomaticMembershipOrRoleGrant:true,
   teacherPrivateResourcesRemainExcluded:true,
   studentSourceEvidenceRemainExcluded:true,
   publishedGradesOnlyReviewed:false,
   supportBinaryAndCommentsExcludedReviewed:false,
   backupsAndRollbackReviewed:false,
   noRestoreNotifications:true
  },
  categories:Object.fromEntries(AUTO_CATEGORIES.map(category=>[
   category,{decision:"pending",exclusionReason:"",
    records:plan.categories?.[category]?.records||0,
    ready:plan.categories?.[category]?.ready||0,
    identical:plan.categories?.[category]?.identical||0}
  ])),
  unresolvedBlockers:plan.blockers||[],
  membershipAccessRecords:plan.membershipRecords||[],
  accessRecoveryNotes:"",
  reviewNotes:"",
  warning:"UNAPPROVED TEMPLATE. Continuity restore is create-only and never restores memberships or grants school roles."
 };
}
function main(){
 const args=process.argv.slice(2),planPath=arg(args,"plan"),output=arg(args,"output"),
  raw=readFileSync(planPath),plan=JSON.parse(raw.toString("utf8")),
  template=createTemplate(plan,raw);
 writeFileSync(output,JSON.stringify(template,null,2)+"\n",{flag:"wx",mode:0o600});
 console.info(JSON.stringify({templateCreated:true,schoolId:plan.schoolId,
  categories:AUTO_CATEGORIES.length,blockers:template.unresolvedBlockers.length,
  membershipAccessRecords:template.membershipAccessRecords.length,approved:false}));
}
if(require.main===module)try{main();}catch(error){
 console.error("Continuity restore approval template failed:",error.message);process.exitCode=1;
}
module.exports={APPROVAL_SCHEMA,createTemplate};
