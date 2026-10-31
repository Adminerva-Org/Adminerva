"use strict";
/** Creates an unapproved review artifact for MCS student repository migration. */
const {readFileSync,writeFileSync}=require("node:fs");
const {createHash}=require("node:crypto");
const {SCHEMA}=require("./mcs-canonical-student-repositories-plan.js");
const {SCHOOL_ID}=require("./mcs-canonical-foundation-plan.js");

const APPROVAL_SCHEMA="adminerva-v4-mcs-canonical-student-repositories-approval-v1";
const sha=value=>createHash("sha256").update(value).digest("hex");
function arg(args,name){
 const value=args.find(item=>item.startsWith("--"+name+"="))?.slice(name.length+3);
 if(!value||!value.startsWith("/")||value.includes("\0"))
  throw Error("Provide --"+name+" as a restricted absolute path.");
 return value;
}
function createTemplate(plan,raw){
 if(!plan||plan.schema!==SCHEMA||plan.schoolId!==SCHOOL_ID||
    plan.readOnly!==true||plan.readyForApply!==false)
  throw Error("Use a current MCS student repository plan.");
 return {
  schema:APPROVAL_SCHEMA,schoolId:SCHOOL_ID,scope:"canonical_student_repositories_only",
  planSha256:sha(raw),approvedBy:"",approvedAt:"",
  acknowledgements:{
   repositoryUrlsReviewed:false,
   offeringMappingsReviewed:false,
   multiOfferingReplicationReviewed:false,
   legacyOauthTokensExcluded:true,
   noOauthCredentialMigration:true,
   activeStudentAccessReviewed:false,
   noMigrationNotifications:true,
   backupsAndRollbackReviewed:false
  },
  repositories:(plan.candidates||[]).map(row=>({
   configId:row.configId,studentUid:row.studentUid,personId:row.personId,
   offeringId:row.offeringId,repository:row.repository,
   githubUsername:row.githubUsername||"",
   legacyTokenPresent:Boolean(row.source?.legacyTokenPresent),
   decision:"pending",exclusionReason:""
  })),
  unresolvedBlockers:plan.blockers||[],
  reviewItems:(plan.reviewItems||[]).map(item=>({...item,resolved:false,resolution:""})),
  reviewNotes:"",
  warning:"UNAPPROVED TEMPLATE. Legacy GitHub OAuth tokens are never migrated. Approve repository-to-offering mappings only after review."
 };
}
function main(){
 const args=process.argv.slice(2),planPath=arg(args,"plan"),output=arg(args,"output"),
  raw=readFileSync(planPath),plan=JSON.parse(raw.toString("utf8")),
  template=createTemplate(plan,raw);
 writeFileSync(output,JSON.stringify(template,null,2)+"\n",{flag:"wx",mode:0o600});
 console.info(JSON.stringify({templateCreated:true,schoolId:SCHOOL_ID,
  repositories:template.repositories.length,blockers:template.unresolvedBlockers.length,
  reviewItems:template.reviewItems.length,approved:false,oauthTokensMigrated:false}));
}
if(require.main===module)try{main();}catch(error){
 console.error("Student repository approval template failed:",error.message);process.exitCode=1;
}
module.exports={APPROVAL_SCHEMA,createTemplate};
