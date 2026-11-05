"use strict";
/**
 * Builds an UNAPPROVED MCS cutover operator packet bound to the exact
 * legacy-mirror ledger, mirror reconciliation report and identity report.
 * This is a local restricted artifact only; it does not modify Firebase.
 */
const {readFileSync,writeFileSync}=require("node:fs");
const {createHash}=require("node:crypto");
const {validateLedger,SCHOOL_ID}=require("./mcs-migration-apply.js");

const SCHEMA="adminerva-v4-mcs-cutover-operator-packet-v1";
const sha=value=>createHash("sha256").update(value).digest("hex");
function arg(args,name){
 const value=args.find(item=>item.startsWith("--"+name+"="))?.slice(name.length+3);
 if(!value||!value.startsWith("/")||value.includes("\0"))
  throw Error("Provide --"+name+" as a restricted absolute path.");
 return value;
}
function read(path,label){
 const raw=readFileSync(path);let data;
 try{data=JSON.parse(raw.toString("utf8"));}catch{throw Error(label+" is not valid JSON.");}
 return {raw,data};
}
function buildPacket({ledgerFile,reconciliationFile,identityFile}){
 const eligible=validateLedger(ledgerFile.data);
 const reconciliation=reconciliationFile.data,identity=identityFile.data,
  ledgerSha256=sha(ledgerFile.raw),reconciliationSha256=sha(reconciliationFile.raw),
  identitySha256=sha(identityFile.raw);
 if(!reconciliation||reconciliation.schema!=="adminerva-v4-mcs-mirror-reconciliation-v1"||
    reconciliation.schoolId!==SCHOOL_ID||reconciliation.readOnly!==true)
  throw Error("Use the current read-only MCS mirror reconciliation report.");
 if(reconciliation.ledgerSha256!==ledgerSha256)
  throw Error("The reconciliation report belongs to a different dry-run ledger.");
 if(reconciliation.complete!==true||(reconciliation.blockers||[]).length)
  throw Error("Mirror reconciliation is incomplete. Resolve it before creating a cutover packet.");
 if(!identity||identity.schema!=="adminerva-v4-mcs-identity-candidates-v1"||
    identity.schoolId!==SCHOOL_ID||identity.readOnly!==true||identity.grantsCreated!==false)
  throw Error("Use the current read-only MCS identity-candidate report.");
 const stages={};
 for(const id of ["foundation","academic_access","assessment","evidence_grade",
   "student_repositories","planning_support","planning","practice"]){
  stages[id]={complete:false,receiptSha256:"",reviewReference:""};
 }
 return {
  schema:SCHEMA,schoolId:SCHOOL_ID,status:"unapproved",generatedAt:new Date().toISOString(),
  sourceArtifacts:{
   legacyMirrorLedger:{sha256:ledgerSha256,eligibleRecords:eligible.length},
   legacyMirrorReconciliation:{sha256:reconciliationSha256,complete:true},
   identityCandidates:{sha256:identitySha256,
    matchedVerifiedAccounts:Number(identity.summary?.matchedVerifiedAccounts||0),
    unresolvedRows:Number(identity.summary?.unresolvedRows||0)}
  },
  backup:{
   captured:false,backupReference:"",backupSha256:"",recoveryOwnerRole:"",
   restoreProcedureReference:""
  },
  identityReview:{
   completed:false,unresolvedRows:Number(identity.summary?.unresolvedRows||0),
   reviewReference:"",resolutionNotes:""
  },
  sharedPlanningPolicy:{
   completed:false,decisionReference:"",resolutionNotes:""
  },
  canonicalStages:stages,
  ownerDecisionRecord:{reviewed:false,reference:""},
  rollback:{
   rehearsed:false,rehearsalReference:"",result:"pending",notes:""
  },
  approvedBy:"",approvedAt:"",reviewNotes:"",
  warning:"UNAPPROVED OPERATOR PACKET. Do not use this artifact as permission to migrate or cut over until every stage, backup, identity review, owner decision and rollback field is independently completed and validated."
 };
}
function main(){
 const args=process.argv.slice(2),
  ledgerFile=read(arg(args,"ledger"),"Ledger"),
  reconciliationFile=read(arg(args,"reconciliation"),"Reconciliation"),
  identityFile=read(arg(args,"identity"),"Identity report"),
  output=arg(args,"output"),
  packet=buildPacket({ledgerFile,reconciliationFile,identityFile});
 writeFileSync(output,JSON.stringify(packet,null,2)+"\n",{flag:"wx",mode:0o600});
 console.info(JSON.stringify({packetCreated:true,schoolId:SCHOOL_ID,status:"unapproved",
  eligibleRecords:packet.sourceArtifacts.legacyMirrorLedger.eligibleRecords,
  unresolvedIdentityRows:packet.identityReview.unresolvedRows}));
}
if(require.main===module)try{main();}catch(error){
 console.error("MCS cutover operator packet creation failed:",error.message);process.exitCode=1;
}
module.exports={SCHEMA,buildPacket};
