"use strict";
/**
 * Controlled MCS legacy-mirror apply engine.
 *
 * This does NOT create canonical V4 people, memberships, assessments, grades,
 * lessons, enrollments or permissions. It only copies reviewed school-candidate
 * V3 documents into schools/mcs-manila/legacy_roots/... as an immutable
 * compatibility mirror.
 *
 * Default execution is preflight-only. Writes require BOTH --apply and the
 * exact ADMINERVA_MCS_MIRROR_WRITE acknowledgement.
 */
const {initializeApp,getApps,applicationDefault}=require("firebase-admin/app");
const {getFirestore}=require("firebase-admin/firestore");
const {readFileSync,writeFileSync}=require("node:fs");
const {createHash}=require("node:crypto");
const {canonicalDigest,mapPath}=require("./mcs-migration-ledger.js");

const SCHOOL_ID="mcs-manila";
const WRITE_ACK="YES_I_APPROVE_MCS_LEGACY_MIRROR";
const APPROVAL_SCHEMA="adminerva-v4-mcs-mirror-approval-v1";

function sha256(value){return createHash("sha256").update(value).digest("hex");}
function requiredArg(args,name){
 const value=args.find(arg=>arg.startsWith("--"+name+"="))?.slice(name.length+3);
 if(!value||!value.startsWith("/")||value.includes("\0"))
  throw Error("Provide a restricted absolute --"+name+"=/secure/path.");
 return value;
}
function optionalInteger(args,name,fallback,{min=1,max=500}={}){
 const raw=args.find(arg=>arg.startsWith("--"+name+"="))?.slice(name.length+3);
 if(raw===undefined)return fallback;
 const value=Number(raw);
 if(!Number.isInteger(value)||value<min||value>max)throw Error("--"+name+" must be "+min+"-"+max+".");
 return value;
}
function loadJson(path,label){
 let raw;
 try{raw=readFileSync(path);}
 catch{throw Error(label+" file could not be read.");}
 let data;
 try{data=JSON.parse(raw.toString("utf8"));}
 catch{throw Error(label+" is not valid JSON.");}
 return {raw,data};
}
function validateLedger(ledger){
 if(!ledger||ledger.schema!=="adminerva-v4-mcs-dryrun-v1"||ledger.schoolId!==SCHOOL_ID)
  throw Error("Use a current MCS dry-run ledger.");
 if(ledger.readOnly!==true||ledger.authorizedToWrite!==false)
  throw Error("Ledger safety markers are missing.");
 if(ledger.truncated===true)throw Error("Ledger is truncated. Generate a complete inventory before approval.");
 if(!Array.isArray(ledger.entries)||!ledger.entries.length)throw Error("Ledger contains no migration entries.");
 if(Number(ledger.summary?.school_conflict||0)>0||
    Number(ledger.summary?.legacy_mirror_conflict||0)>0)
  throw Error("Ledger has unresolved school or destination checksum conflicts.");
 if(Array.isArray(ledger.unknownRoots)&&ledger.unknownRoots.length)
  throw Error("Ledger contains unclassified collection roots. Classify them before mirroring.");
 const eligible=ledger.entries.filter(entry=>entry.decision==="eligible_for_approved_mirror");
 const invalid=eligible.find(entry=>{
   if(entry.classification!=="school_candidate"||entry.migrationMode!=="legacy_mirror"||
      typeof entry.sourceDigest!=="string"||!/^[a-f0-9]{64}$/.test(entry.sourceDigest))return true;
   const mapped=mapPath(entry.sourcePath,SCHOOL_ID);
   return mapped.targetPath!==entry.targetPath||
     !entry.targetPath.startsWith("schools/"+SCHOOL_ID+"/legacy_roots/");
 });
 if(invalid)throw Error("Ledger contains an invalid or non-deterministic mirror entry.");
 return eligible;
}
function validateApproval(approval,ledgerRaw){
 if(!approval||approval.schema!==APPROVAL_SCHEMA||approval.schoolId!==SCHOOL_ID||
    approval.scope!=="legacy_mirror_only")
  throw Error("Approval file does not authorize the MCS legacy mirror.");
 const digest=sha256(ledgerRaw);
 if(approval.ledgerSha256!==digest)
  throw Error("Approval is for a different ledger file. Regenerate/review the approval.");
 if(typeof approval.approvedBy!=="string"||approval.approvedBy.trim().length<3||
    typeof approval.approvedAt!=="string"||!Number.isFinite(Date.parse(approval.approvedAt)))
  throw Error("Approval must identify the reviewer and approval timestamp.");
 const acknowledgements=approval.acknowledgements||{};
 for(const key of [
  "backupCaptured","conflictsReviewed","identityAndPlatformExcluded",
  "canonicalTransformsExcluded","triggerSideEffectsReviewed","rollbackRunbookReviewed"
 ]){
   if(acknowledgements[key]!==true)throw Error("Approval acknowledgement is missing: "+key);
 }
 return digest;
}
async function inspectEntry(db,entry){
 const [source,target]=await Promise.all([db.doc(entry.sourcePath).get(),db.doc(entry.targetPath).get()]);
 if(!source.exists)return {state:"source_missing",entry};
 const sourceDigest=canonicalDigest(source.data());
 if(sourceDigest!==entry.sourceDigest)return {state:"source_changed",entry,sourceDigest};
 if(target.exists){
   const targetDigest=canonicalDigest(target.data());
   return targetDigest===entry.sourceDigest?
     {state:"already_identical",entry}:{state:"target_conflict",entry,targetDigest};
 }
 return {state:"ready",entry};
}
async function preflight(db,eligible){
 const results=[];
 for(const entry of eligible)results.push(await inspectEntry(db,entry));
 const blockers=results.filter(result=>["source_missing","source_changed","target_conflict"].includes(result.state));
 return {results,blockers,ready:results.filter(result=>result.state==="ready"),
   identical:results.filter(result=>result.state==="already_identical")};
}
async function copyOne(db,entry){
 return db.runTransaction(async tx=>{
   const sourceRef=db.doc(entry.sourcePath),targetRef=db.doc(entry.targetPath);
   const [source,target]=await Promise.all([tx.get(sourceRef),tx.get(targetRef)]);
   if(!source.exists)throw Error("Source disappeared during apply.");
   const sourceDigest=canonicalDigest(source.data());
   if(sourceDigest!==entry.sourceDigest)throw Error("Source changed after approved preflight.");
   if(target.exists){
    const targetDigest=canonicalDigest(target.data());
    if(targetDigest!==entry.sourceDigest)throw Error("Destination conflict appeared during apply.");
    return "already_identical";
   }
   // create() is intentional: no overwrite path exists in this migration engine.
   tx.create(targetRef,source.data());
   return "copied";
 });
}
function receiptBase({ledgerSha256,eligible,preflightResult,mode,maxWrites}){
 const states={};
 for(const row of preflightResult.results)states[row.state]=(states[row.state]||0)+1;
 return {
  schema:"adminerva-v4-mcs-mirror-receipt-v1",schoolId:SCHOOL_ID,
  scope:"legacy_mirror_only",ledgerSha256,mode,maxWrites,
  generatedAt:new Date().toISOString(),eligible:eligible.length,preflight:states,
  copied:0,alreadyIdentical:preflightResult.identical.length,remainingReady:preflightResult.ready.length,
  complete:false,canonicalV4RecordsCreated:false,rolesGranted:false,sourceRecordsModified:false
 };
}
async function applyApprovedMirror(db,{eligible,ledgerSha256,maxWrites,apply}){
 const checked=await preflight(db,eligible);
 const receipt=receiptBase({ledgerSha256,eligible,preflightResult:checked,
   mode:apply?"apply":"preflight",maxWrites});
 if(checked.blockers.length){
   receipt.blocked=true;
   receipt.blockerCounts=checked.blockers.reduce((out,row)=>
     (out[row.state]=(out[row.state]||0)+1,out),{});
   return receipt;
 }
 if(!apply){
   receipt.blocked=false;receipt.complete=checked.ready.length===0;
   return receipt;
 }
 let copied=0,identical=receipt.alreadyIdentical,processedReady=0;
 for(const row of checked.ready){
   if(copied>=maxWrites)break;
   const result=await copyOne(db,row.entry);processedReady++;
   if(result==="copied")copied++;else identical++;
 }
 receipt.copied=copied;receipt.alreadyIdentical=identical;
 receipt.remainingReady=Math.max(0,checked.ready.length-processedReady);
 receipt.complete=receipt.remainingReady===0;
 receipt.blocked=false;
 return receipt;
}
async function main(){
 const args=process.argv.slice(2),apply=args.includes("--apply");
 const ledgerPath=requiredArg(args,"ledger"),approvalPath=requiredArg(args,"approval"),
   receiptPath=requiredArg(args,"receipt"),maxWrites=optionalInteger(args,"max-writes",250);
 if(process.env.ADMINERVA_PILOT_SCHOOL_ID&&process.env.ADMINERVA_PILOT_SCHOOL_ID!==SCHOOL_ID)
  throw Error("This apply engine is locked to the confirmed MCS pilot school.");
 if(apply&&process.env.ADMINERVA_MCS_MIRROR_WRITE!==WRITE_ACK)
  throw Error("Write mode requires the exact ADMINERVA_MCS_MIRROR_WRITE acknowledgement.");
 const ledgerFile=loadJson(ledgerPath,"Ledger"),approvalFile=loadJson(approvalPath,"Approval");
 const eligible=validateLedger(ledgerFile.data);
 const ledgerSha256=validateApproval(approvalFile.data,ledgerFile.raw);
 if(!getApps().length)initializeApp({credential:applicationDefault()});
 const receipt=await applyApprovedMirror(getFirestore(),{
   eligible,ledgerSha256,maxWrites,apply
 });
 writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+"\n",{flag:"wx",mode:0o600});
 console.info(JSON.stringify({
   mode:receipt.mode,schoolId:receipt.schoolId,eligible:receipt.eligible,
   copied:receipt.copied,alreadyIdentical:receipt.alreadyIdentical,
   remainingReady:receipt.remainingReady,blocked:receipt.blocked,complete:receipt.complete,
   receiptCreated:true
 }));
 if(receipt.blocked)process.exitCode=2;
}
if(require.main===module)main().catch(error=>{
 console.error("MCS legacy mirror apply failed:",error.code||error.message);
 process.exitCode=1;
});
module.exports={
 APPROVAL_SCHEMA,SCHOOL_ID,WRITE_ACK,validateLedger,validateApproval,
 inspectEntry,preflight,applyApprovedMirror,copyOne
};
