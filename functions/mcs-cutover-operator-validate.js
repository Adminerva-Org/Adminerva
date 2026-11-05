"use strict";
/**
 * Validates a completed MCS cutover operator packet and emits a restricted,
 * read-only validation receipt. It does not contact Firebase or authorize writes.
 */
const {readFileSync,writeFileSync}=require("node:fs");
const {createHash}=require("node:crypto");
const {SCHEMA}=require("./mcs-cutover-operator-template.js");
const {SCHOOL_ID}=require("./mcs-migration-apply.js");

const RECEIPT_SCHEMA="adminerva-v4-mcs-cutover-operator-validation-v1";
const sha=value=>createHash("sha256").update(value).digest("hex");
function arg(args,name){
 const value=args.find(item=>item.startsWith("--"+name+"="))?.slice(name.length+3);
 if(!value||!value.startsWith("/")||value.includes("\0"))
  throw Error("Provide --"+name+" as a restricted absolute path.");
 return value;
}
function validHash(value){return typeof value==="string"&&/^[a-f0-9]{64}$/.test(value);}
function reference(value,min=8){return typeof value==="string"&&value.trim().length>=min;}
function validatePacket(packet){
 const blockers=[];
 const block=(id,detail)=>blockers.push({id,detail});
 if(!packet||packet.schema!==SCHEMA||packet.schoolId!==SCHOOL_ID)
  block("packet_schema","Use the current MCS cutover operator packet.");
 for(const [name,item] of Object.entries(packet?.sourceArtifacts||{}))
  if(!validHash(item?.sha256))block("artifact_hash_"+name,"Source artifact hash is missing or invalid.");
 const backup=packet?.backup||{};
 if(backup.captured!==true)block("backup_captured","Protected backup has not been confirmed.");
 if(!reference(backup.backupReference))block("backup_reference","Backup reference is missing.");
 if(!validHash(backup.backupSha256))block("backup_hash","Backup checksum is missing or invalid.");
 if(!reference(backup.recoveryOwnerRole,3))block("backup_owner","Recovery owner role is missing.");
 if(!reference(backup.restoreProcedureReference))block("restore_procedure","Restore procedure reference is missing.");
 const identity=packet?.identityReview||{};
 if(identity.completed!==true)block("identity_review","Identity review is incomplete.");
 if(!reference(identity.reviewReference))block("identity_review_reference","Identity review reference is missing.");
 if(Number(identity.unresolvedRows||0)>0&&!reference(identity.resolutionNotes,12))
  block("identity_resolution","Unresolved identity rows require documented resolution notes.");
 const planning=packet?.sharedPlanningPolicy||{};
 if(planning.completed!==true)block("shared_planning_policy","Shared planning/reference policy review is incomplete.");
 if(!reference(planning.decisionReference))block("shared_planning_reference","Shared planning/reference decision reference is missing.");
 const stages=packet?.canonicalStages||{};
 for(const id of ["foundation","academic_access","assessment","evidence_grade",
   "student_repositories","planning_support","planning","practice"]){
  const stage=stages[id]||{};
  if(stage.complete!==true)block("stage_"+id,id+" canonical migration stage is not complete.");
  if(!validHash(stage.receiptSha256))block("stage_receipt_"+id,id+" receipt checksum is missing or invalid.");
  if(!reference(stage.reviewReference))block("stage_review_"+id,id+" review/reconciliation reference is missing.");
 }
 if(packet?.ownerDecisionRecord?.reviewed!==true)
  block("owner_decisions","Platform-owner cutover decisions have not been reviewed.");
 if(!reference(packet?.ownerDecisionRecord?.reference))
  block("owner_decision_reference","Owner decision record reference is missing.");
 const rollback=packet?.rollback||{};
 if(rollback.rehearsed!==true||rollback.result!=="passed")
  block("rollback_rehearsal","Rollback must be rehearsed successfully.");
 if(!reference(rollback.rehearsalReference))
  block("rollback_reference","Rollback rehearsal reference is missing.");
 if(!reference(packet?.approvedBy,3)||!Number.isFinite(Date.parse(packet?.approvedAt||"")))
  block("operator_approval","Final operator reviewer and approval timestamp are required.");
 return blockers;
}
function main(){
 const args=process.argv.slice(2),packetPath=arg(args,"packet"),output=arg(args,"output"),
  raw=readFileSync(packetPath),packet=JSON.parse(raw.toString("utf8")),blockers=validatePacket(packet),
  receipt={schema:RECEIPT_SCHEMA,schoolId:SCHOOL_ID,readOnly:true,
   packetSha256:sha(raw),generatedAt:new Date().toISOString(),ready:blockers.length===0,
   blockers,warning:blockers.length?
    "Operator packet is incomplete. Do not enable V4-only cutover.":
    "Operator packet fields are complete. Live school cutover readiness and explicit platform-owner V4-only action are still required."};
 writeFileSync(output,JSON.stringify(receipt,null,2)+"\n",{flag:"wx",mode:0o600});
 console.info(JSON.stringify({validationCreated:true,ready:receipt.ready,blockers:blockers.length}));
 if(blockers.length)process.exitCode=2;
}
if(require.main===module)try{main();}catch(error){
 console.error("MCS cutover packet validation failed:",error.message);process.exitCode=1;
}
module.exports={RECEIPT_SCHEMA,validatePacket};
