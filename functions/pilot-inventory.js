"use strict";
/**
 * Read-only Adminerva 4.0 pilot discovery; NEVER imports, updates or deletes data.
 * Run only with an approved Firebase project and authorized read credentials.
 * Output intentionally excludes document paths, names, email and other learner PII.
 * This is an inventory, NOT a provenance-approved migration ledger or backup.
 */
const {initializeApp,getApps,applicationDefault}=require("firebase-admin/app");
const {getFirestore,FieldPath}=require("firebase-admin/firestore");
const {writeFileSync}=require("node:fs");
const collections=[
  "students","staff_access","teachers","student_access","school_catalog",
  "assessments","assessment_private","assessment_evidence","studio_submissions",
  "student_grades","grade_revisions","student_submissions","commit_reclaims",
  "commit_claim_decisions","commit_claim_conflicts","student_code_projects",
  "student_playground_workspaces","playground_snapshots","staff_workspaces",
  "lesson_plans","presentations","reference_folders","practice_profiles",
  "practice_scores","student_practice_progress","activity_preferences",
  "activity_events","issues","notifications","notification_history",
  "school_ai_results","school_ai_usage","push_devices"
];
const excluded=new Set(["system_private","platform_schools","platform_users","platform_admins"]);
const cap=50000,pageSize=250;
async function inventory(db,{targetSchoolId="mcs-manila"}={}) {
  if(!/^[a-z][a-z0-9-]{1,63}$/.test(targetSchoolId))
    throw new Error("Invalid pilot school identifier.");
  const present=await db.listCollections();
  const presentNames=new Set(present.map(col=>col.id));
  const report={schema:"adminerva-v4-inventory-v1",targetSchoolId,
    generatedAt:new Date().toISOString(),readOnly:true,provenanceApproved:false,
    permittedForMigration:false,
    warnings:[
      "A schoolId field is only a candidate, never proof of institutional ownership.",
      "Nested revisions, file objects and external integrations are not inventoried here.",
      "Counts alone cannot authorize live migration or existing account membership."
    ],collections:{},unclassifiedCollections:[...presentNames].filter(name=>!collections.includes(name)&&!excluded.has(name)).sort()};
  for(const name of collections) {
    if(!presentNames.has(name)){report.collections[name]={present:false,count:0};continue;}
    const totals={present:true,count:0,explicitPilotCandidates:0,otherSchoolLabels:0,
      unattributed:0,hasOwnerOrCreator:0,truncated:false};
    let cursor=null;
    while(totals.count<cap){
      let query=db.collection(name).select("schoolId","ownerUid","creatorUid","authorUid")
        .orderBy(FieldPath.documentId()).limit(Math.min(pageSize,cap-totals.count));
      if(cursor)query=query.startAfter(cursor);
      const page=await query.get();
      if(page.empty)break;
      for(const doc of page.docs){
        const value=doc.data(),schoolId=value.schoolId;
        totals.count++;
        if(schoolId===targetSchoolId)totals.explicitPilotCandidates++;
        else if(typeof schoolId==="string"&&schoolId.trim())totals.otherSchoolLabels++;
        else totals.unattributed++;
        if(["ownerUid","creatorUid","authorUid"].some(key=>typeof value[key]==="string"&&value[key]))
          totals.hasOwnerOrCreator++;
      }
      cursor=page.docs.at(-1);
      if(page.size<pageSize)break;
    }
    if(totals.count===cap)totals.truncated=true;
    report.collections[name]=totals;
  }
  report.requiresOwnerReview=true;
  return report;
}
async function main(){
  const output=process.argv.find(arg=>arg.startsWith("--output="))?.slice(9)||"";
  if(!getApps().length)initializeApp({credential:applicationDefault()});
  const report=await inventory(getFirestore(),{
    targetSchoolId:process.env.ADMINERVA_PILOT_SCHOOL_ID||"mcs-manila"
  });
  const serialized=JSON.stringify(report,null,2)+"\n";
  if(output)writeFileSync(output,serialized,{flag:"wx",mode:0o600});
  else process.stdout.write(serialized);
}
if(require.main===module)main().catch(error=>{
  console.error("Read-only inventory failed:",error.code||error.message);
  process.exitCode=1;
});
module.exports={inventory};
