"use strict";
/**
 * Read-only reconciliation for the approved MCS legacy mirror.
 *
 * This verifies that every mirror-eligible record in an exact dry-run ledger
 * still has the approved source digest and an identical destination digest.
 * It never creates canonical V4 records, changes grades, grants roles, or writes Firestore.
 */
const {initializeApp,getApps,applicationDefault}=require("firebase-admin/app");
const {getFirestore}=require("firebase-admin/firestore");
const {readFileSync,writeFileSync}=require("node:fs");
const {createHash}=require("node:crypto");
const {canonicalDigest,mapPath}=require("./mcs-migration-ledger.js");
const {validateLedger,SCHOOL_ID}=require("./mcs-migration-apply.js");

function sha256(value){return createHash("sha256").update(value).digest("hex");}
function absoluteArg(args,name){
  const value=args.find(arg=>arg.startsWith("--"+name+"="))?.slice(name.length+3);
  if(!value||!value.startsWith("/")||value.includes("\0"))
    throw Error("Provide a restricted absolute --"+name+"=/secure/path.");
  return value;
}
function readJson(path,label){
  let raw;
  try{raw=readFileSync(path);}
  catch{throw Error(label+" file could not be read.");}
  let data;
  try{data=JSON.parse(raw.toString("utf8"));}
  catch{throw Error(label+" is not valid JSON.");}
  return {raw,data};
}
function summarize(states){
  return states.reduce((out,row)=>(out[row.state]=(out[row.state]||0)+1,out),{});
}
function classifyReconciliation({entry,sourceExists,sourceData,targetExists,targetData}){
  const mapped=mapPath(entry.sourcePath,SCHOOL_ID);
  if(mapped.targetPath!==entry.targetPath)return {state:"ledger_path_mismatch"};
  if(!sourceExists)return {state:"source_missing"};
  const sourceDigest=canonicalDigest(sourceData);
  if(sourceDigest!==entry.sourceDigest)return {state:"source_changed",sourceDigest};
  if(!targetExists)return {state:"target_missing"};
  const targetDigest=canonicalDigest(targetData);
  if(targetDigest!==entry.sourceDigest)return {state:"target_mismatch",targetDigest};
  return {state:"identical"};
}
async function reconcileLedger(db,ledger){
  const eligible=validateLedger(ledger);
  const rows=[];
  for(const entry of eligible){
    const [source,target]=await Promise.all([
      db.doc(entry.sourcePath).get(),
      db.doc(entry.targetPath).get()
    ]);
    const result=classifyReconciliation({
      entry,
      sourceExists:source.exists,sourceData:source.exists?source.data():null,
      targetExists:target.exists,targetData:target.exists?target.data():null
    });
    rows.push({
      sourcePath:entry.sourcePath,targetPath:entry.targetPath,
      approvedDigest:entry.sourceDigest,...result
    });
  }
  const summary=summarize(rows),complete=rows.length>0&&
    Number(summary.identical||0)===rows.length;
  return {eligible,rows,summary,complete};
}
async function main(){
  const args=process.argv.slice(2);
  const ledgerPath=absoluteArg(args,"ledger"),outputPath=absoluteArg(args,"output");
  if(process.env.ADMINERVA_PILOT_SCHOOL_ID&&process.env.ADMINERVA_PILOT_SCHOOL_ID!==SCHOOL_ID)
    throw Error("This reconciliation engine is locked to the confirmed MCS pilot school.");
  const ledgerFile=readJson(ledgerPath,"Ledger");
  const ledgerSha256=sha256(ledgerFile.raw);
  if(!getApps().length)initializeApp({credential:applicationDefault()});
  const checked=await reconcileLedger(getFirestore(),ledgerFile.data);
  const report={
    schema:"adminerva-v4-mcs-mirror-reconciliation-v1",
    schoolId:SCHOOL_ID,scope:"legacy_mirror_only",readOnly:true,
    ledgerSha256,generatedAt:new Date().toISOString(),
    eligible:checked.eligible.length,summary:checked.summary,
    complete:checked.complete,
    canonicalV4RecordsCreated:false,rolesGranted:false,sourceRecordsModified:false,
    blockers:checked.rows.filter(row=>row.state!=="identical"),
    warning:checked.complete?
      "Legacy mirror checksums reconcile. Canonical V4 transforms, identity mapping and cutover still require separate approval.":
      "Reconciliation is incomplete. Do not proceed to canonical V4 cutover."
  };
  writeFileSync(outputPath,JSON.stringify(report,null,2)+"\n",{flag:"wx",mode:0o600});
  console.info(JSON.stringify({
    reconciliationCreated:true,schoolId:SCHOOL_ID,eligible:report.eligible,
    complete:report.complete,summary:report.summary
  }));
  if(!report.complete)process.exitCode=2;
}
if(require.main===module)main().catch(error=>{
  console.error("MCS mirror reconciliation failed:",error.code||error.message);
  process.exitCode=1;
});
module.exports={classifyReconciliation,summarize,reconcileLedger};
