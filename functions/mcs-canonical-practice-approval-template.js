"use strict";
/** Creates an unapproved review artifact for canonical MCS Practice migration. */
const {readFileSync,writeFileSync}=require("node:fs");
const {createHash}=require("node:crypto");
const {SCHEMA}=require("./mcs-canonical-practice-plan.js");
const {SCHOOL_ID}=require("./mcs-canonical-foundation-plan.js");

const APPROVAL_SCHEMA="adminerva-v4-mcs-canonical-practice-approval-v1";
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
  throw Error("Use a current MCS canonical Practice plan.");
 return {
  schema:APPROVAL_SCHEMA,schoolId:SCHOOL_ID,scope:"canonical_practice_only",
  planSha256:sha(raw),approvedBy:"",approvedAt:"",
  acknowledgements:{
   verifiedProgressReviewed:false,
   currentSeasonScoreReviewed:false,
   awardsAndMissionStateReconciled:false,
   courseProgressReconciled:false,
   activeClassRankingsReviewed:false,
   historicalSeasonArchiveReviewed:false,
   legacyPublicConsentResetReviewed:false,
   ephemeralLegacyDataRetentionReviewed:false,
   noMigrationNotifications:true,
   backupsAndRollbackReviewed:false
  },
  students:(plan.students||[]).map(row=>({
   uid:row.uid,personId:row.personId,
   verifiedProgressCourses:row.verifiedProgress?.length||0,
   currentSeason:Boolean(row.currentSeason),
   currentPoints:row.currentSeason?.score?.points||0,
   currentCompletedCount:row.currentSeason?.score?.completedCount||0,
   historicalSeason:row.historicalSeason?.season||null,
   decision:"pending",exclusionReason:""
  })),
  unresolvedBlockers:plan.blockers||[],
  reviewItems:(plan.reviewItems||[]).map(item=>({...item,resolved:false,resolution:""})),
  intentionallyLegacyOnly:plan.intentionallyLegacyOnly||[],
  reviewNotes:"",
  warning:"UNAPPROVED TEMPLATE. Migrated learners start opted out of the new school public leaderboard; legacy consent is provenance only."
 };
}
function main(){
 const args=process.argv.slice(2),planPath=arg(args,"plan"),output=arg(args,"output");
 const raw=readFileSync(planPath),plan=JSON.parse(raw.toString("utf8")),
  template=createTemplate(plan,raw);
 writeFileSync(output,JSON.stringify(template,null,2)+"\n",{flag:"wx",mode:0o600});
 console.info(JSON.stringify({templateCreated:true,schoolId:SCHOOL_ID,
  students:template.students.length,blockers:template.unresolvedBlockers.length,
  reviewItems:template.reviewItems.length,approved:false}));
}
if(require.main===module)try{main();}catch(error){
 console.error("Practice approval template failed:",error.message);process.exitCode=1;
}
module.exports={APPROVAL_SCHEMA,createTemplate};
