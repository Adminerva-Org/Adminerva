"use strict";
/**
 * Final MCS Adminerva 4.0 cutover package validator.
 *
 * Read-only. It binds the completed migration/reconciliation receipts to one
 * restricted operator artifact and re-runs live canonical cutover readiness.
 * It does not copy data, grant roles, change compatibility mode, deploy code,
 * publish release notes, or send notifications.
 */
const {initializeApp,getApps,applicationDefault}=require("firebase-admin/app");
const {getFirestore}=require("firebase-admin/firestore");
const {readFileSync,writeFileSync}=require("node:fs");
const {createHash}=require("node:crypto");
const {evaluateSchoolCutoverReadiness}=require("./school-cutover-readiness.js");

const SCHOOL_ID="mcs-manila";
const PACKAGE_SCHEMA="adminerva-v4-mcs-cutover-package-v1";
const sha=value=>createHash("sha256").update(value).digest("hex");

const ARTIFACTS=[
 ["mirrorReceipt","mirror-receipt","adminerva-v4-mcs-mirror-receipt-v1"],
 ["mirrorReconciliation","mirror-reconciliation","adminerva-v4-mcs-mirror-reconciliation-v1"],
 ["foundationReceipt","foundation-receipt","adminerva-v4-mcs-canonical-foundation-receipt-v1"],
 ["academicAccessReceipt","academic-access-receipt","adminerva-v4-mcs-canonical-academic-access-receipt-v1"],
 ["assessmentReceipt","assessment-receipt","adminerva-v4-mcs-canonical-assessment-receipt-v1"],
 ["evidenceGradeReceipt","evidence-grade-receipt","adminerva-v4-mcs-canonical-evidence-grade-receipt-v1"],
 ["planningReceipt","planning-receipt","adminerva-v4-mcs-canonical-planning-receipt-v1"],
 ["planningSupportReceipt","planning-support-receipt","adminerva-v4-mcs-canonical-planning-support-receipt-v1"],
 ["practiceReceipt","practice-receipt","adminerva-v4-mcs-canonical-practice-receipt-v1"]
];

function absoluteArg(args,name){
 const value=args.find(item=>item.startsWith("--"+name+"="))?.slice(name.length+3);
 if(!value||!value.startsWith("/")||value.includes("\0"))
  throw Error("Provide --"+name+" as a restricted absolute path.");
 return value;
}
function load(path,label){
 let raw;try{raw=readFileSync(path);}catch{throw Error(label+" file could not be read.");}
 let data;try{data=JSON.parse(raw.toString("utf8"));}catch{throw Error(label+" is not valid JSON.");}
 return {raw,data};
}
function validateCommon(name,data,schema){
 const blockers=[];
 if(!data||data.schema!==schema)blockers.push("schema_mismatch");
 if(data?.schoolId!==SCHOOL_ID)blockers.push("school_mismatch");
 if(name!=="mirrorReconciliation"&&data?.mode!=="apply")blockers.push("not_apply_receipt");
 if(data?.complete!==true)blockers.push("stage_incomplete");
 if(data?.blocked===true)blockers.push("stage_blocked");
 return blockers;
}
function validateArtifact(name,data,schema){
 const blockers=validateCommon(name,data,schema);
 if(name==="mirrorReceipt"){
  if(data.scope!=="legacy_mirror_only")blockers.push("mirror_scope_mismatch");
  if(data.canonicalV4RecordsCreated!==false||data.rolesGranted!==false||
     data.sourceRecordsModified!==false)blockers.push("mirror_safety_markers_invalid");
  if(Number(data.remainingReady||0)!==0)blockers.push("mirror_remaining_records");
 }
 if(name==="mirrorReconciliation"){
  if(data.scope!=="legacy_mirror_only"||data.readOnly!==true)blockers.push("reconciliation_scope_mismatch");
  if(Array.isArray(data.blockers)&&data.blockers.length)blockers.push("reconciliation_has_blockers");
  if(data.canonicalV4RecordsCreated!==false||data.rolesGranted!==false||
     data.sourceRecordsModified!==false)blockers.push("reconciliation_safety_markers_invalid");
 }
 if(["assessmentReceipt","evidenceGradeReceipt","planningReceipt",
     "planningSupportReceipt","practiceReceipt"].includes(name)&&data.notificationsSent!==false)
  blockers.push("migration_notifications_not_suppressed");
 if(name==="planningReceipt"&&data.resourcesShared!==false)
  blockers.push("planning_resources_were_shared");
 if(name==="planningSupportReceipt"&&data.sharedLegacyDataReplicated!==false)
  blockers.push("shared_legacy_resources_were_replicated");
 if(name==="practiceReceipt"&&Number(data.publicLeaderboardOptInsCreated||0)!==0)
  blockers.push("practice_public_optins_created");
 return blockers;
}
function artifactSetDigest(artifacts){
 return sha(JSON.stringify(Object.keys(artifacts).sort().map(name=>[
  name,artifacts[name].schema,artifacts[name].sha256
 ])));
}
async function buildCutoverPackage({db,files}){
 const artifacts={},blockers=[];
 for(const [name,,schema] of ARTIFACTS){
  const file=files[name],stageBlockers=validateArtifact(name,file.data,schema);
  artifacts[name]={
   schema:file.data?.schema||null,sha256:sha(file.raw),
   generatedAt:file.data?.generatedAt||null,complete:file.data?.complete===true,
   blockers:stageBlockers
  };
  for(const blocker of stageBlockers)blockers.push({stage:name,type:blocker});
 }
 const mirror=files.mirrorReceipt.data,reconciliation=files.mirrorReconciliation.data;
 if(mirror?.ledgerSha256!==reconciliation?.ledgerSha256)
  blockers.push({stage:"mirrorReconciliation",type:"ledger_digest_mismatch"});

 const readiness=await evaluateSchoolCutoverReadiness({db,schoolId:SCHOOL_ID});
 for(const item of readiness.blockers||[])
  blockers.push({stage:"liveReadiness",type:item.id,detail:item.detail});
 if(readiness.compatibilityMode!=="legacy_allowed")
  blockers.push({stage:"liveReadiness",type:"compatibility_mode_not_legacy_allowed",
   detail:"Cutover package must be generated before the compatibility switch."});

 const artifactSetSha256=artifactSetDigest(artifacts);
 return {
  schema:PACKAGE_SCHEMA,schoolId:SCHOOL_ID,readOnly:true,
  generatedAt:new Date().toISOString(),
  artifactSetSha256,artifacts,
  liveReadiness:{
   ready:readiness.ready,compatibilityMode:readiness.compatibilityMode,
   schoolState:readiness.schoolState,counts:readiness.counts,
   checkIds:(readiness.checks||[]).map(row=>({id:row.id,ok:row.ok}))
  },
  blockers,
  readyForCompatibilitySwitch:blockers.length===0,
  requiredFinalAction:[
   "Review this restricted package and the protected continuity backup.",
   "Use the platform-owner compatibility control only after the final rollback and route attestations are confirmed.",
   "Deploy backend/rules before frontend routing changes.",
   "Publish the single Adminerva 4.0 release only after successful production activation."
  ],
  safety:{
   writesPerformed:false,rolesGranted:false,compatibilityChanged:false,
   deploymentPerformed:false,releasePublished:false
  }
 };
}
async function main(){
 const args=process.argv.slice(2),files={};
 for(const [name,argName] of ARTIFACTS)files[name]=load(absoluteArg(args,argName),argName);
 const output=absoluteArg(args,"output");
 if(process.env.ADMINERVA_PILOT_SCHOOL_ID&&process.env.ADMINERVA_PILOT_SCHOOL_ID!==SCHOOL_ID)
  throw Error("This cutover package is locked to the confirmed MCS pilot school.");
 if(!getApps().length)initializeApp({credential:applicationDefault()});
 const result=await buildCutoverPackage({db:getFirestore(),files});
 writeFileSync(output,JSON.stringify(result,null,2)+"\n",{flag:"wx",mode:0o600});
 console.info(JSON.stringify({
  cutoverPackageCreated:true,schoolId:SCHOOL_ID,
  artifactSetSha256:result.artifactSetSha256,
  blockers:result.blockers.length,readyForCompatibilitySwitch:result.readyForCompatibilitySwitch
 }));
 if(!result.readyForCompatibilitySwitch)process.exitCode=2;
}
if(require.main===module)main().catch(error=>{
 console.error("MCS cutover package failed:",error.code||error.message);
 process.exitCode=1;
});
module.exports={SCHOOL_ID,PACKAGE_SCHEMA,ARTIFACTS,validateArtifact,artifactSetDigest,buildCutoverPackage};
