"use strict";
/**
 * Controlled create-only MCS lesson/presentation migration.
 * Default mode is preflight. Resources remain private and emit no notifications.
 */
const {initializeApp,getApps,applicationDefault}=require("firebase-admin/app");
const {getFirestore,FieldValue,Timestamp}=require("firebase-admin/firestore");
const {readFileSync,writeFileSync}=require("node:fs");
const {createHash}=require("node:crypto");
const {SCHEMA:PLAN_SCHEMA}=require("./mcs-canonical-planning-plan.js");
const {APPROVAL_SCHEMA}=require("./mcs-canonical-planning-approval-template.js");
const {SCHOOL_ID}=require("./mcs-canonical-foundation-plan.js");
const {validateContent,deterministicId}=require("./school-planning.js");

const WRITE_ACK="YES_I_APPROVE_MCS_CANONICAL_PLANNING";
const RECEIPT_SCHEMA="adminerva-v4-mcs-canonical-planning-receipt-v1";
const sha=value=>createHash("sha256").update(value).digest("hex");

function arg(args,name){
 const value=args.find(item=>item.startsWith("--"+name+"="))?.slice(name.length+3);
 if(!value||!value.startsWith("/")||value.includes("\0"))
  throw Error("Provide --"+name+" as a restricted absolute path.");
 return value;
}
function load(path,label){
 const raw=readFileSync(path);let data;
 try{data=JSON.parse(raw.toString("utf8"));}catch{throw Error(label+" is not valid JSON.");}
 return {raw,data};
}
function intArg(args,name,fallback,min=1,max=100){
 const raw=args.find(item=>item.startsWith("--"+name+"="))?.slice(name.length+3);
 if(raw===undefined)return fallback;const value=Number(raw);
 if(!Number.isInteger(value)||value<min||value>max)
  throw Error("--"+name+" must be "+min+"-"+max+".");
 return value;
}
function ts(value){
 return Number.isFinite(Number(value))&&Number(value)>0?Timestamp.fromMillis(Number(value)):null;
}
function validatePlan(plan){
 if(!plan||plan.schema!==PLAN_SCHEMA||plan.schoolId!==SCHOOL_ID||
    plan.readOnly!==true||plan.readyForApply!==false)
  throw Error("Use a current MCS canonical planning plan.");
 return plan;
}
function validateApproval(plan,raw,approval){
 if(!approval||approval.schema!==APPROVAL_SCHEMA||approval.schoolId!==SCHOOL_ID||
    approval.scope!=="canonical_planning_only")
  throw Error("Approval does not authorize canonical MCS planning resources.");
 const planSha256=sha(raw);
 if(approval.planSha256!==planSha256)throw Error("Approval belongs to a different planning plan.");
 if(typeof approval.approvedBy!=="string"||approval.approvedBy.trim().length<3||
    typeof approval.approvedAt!=="string"||!Number.isFinite(Date.parse(approval.approvedAt)))
  throw Error("Approval must identify the reviewer and timestamp.");
 for(const key of ["teacherOwnershipReviewed","privateDefaultReviewed","lessonContentReviewed",
   "presentationContentReviewed","revisionHistoryReviewed","archivedStateReviewed",
   "unresolvedProvenanceReviewed","noAutomaticSharing","backupsAndRollbackReviewed"])
  if(approval.acknowledgements?.[key]!==true)
   throw Error("Missing approval acknowledgement: "+key);
 if((approval.unresolvedBlockers||[]).length)
  throw Error("Resolve every planning migration blocker before apply.");
 if((approval.reviewItems||[]).some(item=>item.resolved!==true))
  throw Error("Resolve every planning migration review item before apply.");
 if((approval.resources||[]).length!==(plan.resources||[]).length)
  throw Error("Approval resource count differs from the bound planning plan.");
 const planned=new Map((plan.resources||[]).map(row=>[row.resourceId,row])),resources=[];
 for(const review of approval.resources||[]){
  const row=planned.get(review.resourceId);
  if(!row||row.kind!==review.kind||row.ownerUid!==review.ownerUid)
   throw Error("Approval contains a planning resource not present in the bound plan.");
  if(!["approve","exclude"].includes(review.decision))
   throw Error("Every planning resource requires an explicit approve or exclude decision.");
  if(review.decision==="exclude"){
   const reason=String(review.exclusionReason||"").trim();
   if(reason.length<12||reason.length>1000)
    throw Error("Excluded planning resources require a 12–1,000 character reason.");
  }else resources.push(row);
 }
 return {planSha256,resources};
}
function migration(approved,type,key){
 return {source:"mcs_legacy_v3",planSha256:approved.planSha256,type,key};
}
function same(data,approved,row){
 return data?.schoolId===SCHOOL_ID&&data?.migration?.planSha256===approved.planSha256&&
  data?.migration?.type==="teaching_resource"&&data?.migration?.key===row.resourceId;
}
function validateResource(row){
 if(!["lesson","presentation"].includes(row.kind))throw Error("Unsupported planning kind.");
 if(!["active","archived"].includes(row.status))throw Error("Unsupported planning lifecycle state.");
 if(row.visibility!=="private"||(row.sharedWithUids||[]).length)
  throw Error("Migration cannot inherit planning-resource sharing.");
 if(!Number.isInteger(row.revision)||row.revision<1)
  throw Error("Planning resource revision is invalid.");
 if(!Array.isArray(row.revisions)||row.revisions.length!==row.revision-1)
  throw Error("Planning revision history is incomplete.");
 const id=deterministicId({schoolId:SCHOOL_ID,uid:row.ownerUid},row.kind,row.clientKey);
 if(id!==row.resourceId)throw Error("Planning runtime deterministic ID mismatch.");
 validateContent(row.content);
 for(let index=0;index<row.revisions.length;index++){
  const revision=row.revisions[index];
  if(revision.version!==index+1)throw Error("Planning revision sequence is incomplete.");
  validateContent(revision.content);
 }
}
async function inspect(db,approved){
 const rows=[],school=await db.doc("platform_schools/"+SCHOOL_ID).get();
 if(!school.exists||!["draft","active"].includes(school.data().state))
  rows.push({state:"school_missing_or_unavailable",targetPath:"platform_schools/"+SCHOOL_ID});
 for(const row of approved.resources){
  try{validateResource(row);}
  catch(error){
   rows.push({kind:row.kind,key:row.resourceId,targetPath:row.targetPath,
    state:"candidate_integrity_error",message:error.message});continue;
  }
  const [current,member]=await Promise.all([
   db.doc(row.targetPath).get(),db.doc("schools/"+SCHOOL_ID+"/memberships/"+row.ownerUid).get()
  ]);
  let state;
  if(!member.exists||member.data().schoolId!==SCHOOL_ID||
     !Array.isArray(member.data().roles)||!member.data().roles.includes("teacher"))
   state="teacher_membership_missing";
  else state=!current.exists?"ready":same(current.data(),approved,row)?"already_applied":"target_conflict";
  rows.push({kind:row.kind,key:row.resourceId,targetPath:row.targetPath,state});
 }
 return rows;
}
async function createResource(db,approved,row){
 validateResource(row);
 const ref=db.doc(row.targetPath),prefix="schools/"+SCHOOL_ID+"/";
 return db.runTransaction(async tx=>{
  const [current,member,school]=await Promise.all([
   tx.get(ref),tx.get(db.doc(prefix+"memberships/"+row.ownerUid)),
   tx.get(db.doc("platform_schools/"+SCHOOL_ID))
  ]);
  if(current.exists){
   if(same(current.data(),approved,row))return "already_applied";
   throw Error("Planning target changed after preflight.");
  }
  if(!school.exists||!["draft","active"].includes(school.data().state))
   throw Error("MCS school is unavailable.");
  if(!member.exists||member.data().schoolId!==SCHOOL_ID||
     !Array.isArray(member.data().roles)||!member.data().roles.includes("teacher"))
   throw Error("Planning resource owner no longer has the reviewed teacher role.");

  const importedAt=FieldValue.serverTimestamp();
  for(const revision of row.revisions){
   tx.create(ref.collection("revisions").doc(String(revision.version)),{
    schoolId:SCHOOL_ID,resourceId:row.resourceId,ownerUid:row.ownerUid,kind:row.kind,
    title:row.title,content:revision.content,revision:revision.version,
    archivedRevisionAt:ts(revision.archivedRevisionAt),
    migration:{...migration(approved,"teaching_resource_revision",row.resourceId+"_"+revision.version),
     sourcePath:revision.migration?.sourcePath||null}
   });
  }
  tx.create(ref,{schoolId:SCHOOL_ID,ownerUid:row.ownerUid,creatorUid:row.creatorUid||row.ownerUid,
   kind:row.kind,title:row.title,clientKey:row.clientKey,content:row.content,
   status:row.status,visibility:"private",sharedWithUids:[],revision:row.revision,
   ...(row.source?{source:row.source}:{}),
   createdAt:importedAt,updatedAt:importedAt,
   ...(row.status==="archived"?{archivedAt:importedAt}:{}),
   migration:{...migration(approved,"teaching_resource",row.resourceId),
    sourcePath:row.migration?.sourcePath,sourceKind:row.migration?.sourceKind,
    legacyId:row.migration?.legacyId,ownershipSource:row.migration?.ownershipSource,
    sourceLegacyPlan:row.migration?.sourceLegacyPlan||null,
    legacyPlanId:row.migration?.legacyPlanId||null,
    sourceLessonResolved:Boolean(row.migration?.sourceLessonResolved)}
  });
  tx.create(db.collection(prefix+"planning_audit").doc(),{
   schoolId:SCHOOL_ID,resourceId:row.resourceId,actorUid:"migration",
   action:"mcs_planning_resource_migrated",kind:row.kind,ownerUid:row.ownerUid,
   status:row.status,revision:row.revision,visibility:"private",
   notificationsSuppressed:true,planSha256:approved.planSha256,createdAt:importedAt
  });
  return "created";
 });
}
async function applyPlanning(db,approved,{apply=false,maxUnits=30}={}){
 const inspected=await inspect(db,approved),
  blockers=inspected.filter(row=>!["ready","already_applied"].includes(row.state));
 const receipt={schema:RECEIPT_SCHEMA,schoolId:SCHOOL_ID,scope:"canonical_planning_only",
  planSha256:approved.planSha256,mode:apply?"apply":"preflight",generatedAt:new Date().toISOString(),
  approvedResources:approved.resources.length,
  approvedLessons:approved.resources.filter(row=>row.kind==="lesson").length,
  approvedPresentations:approved.resources.filter(row=>row.kind==="presentation").length,
  blocked:!!blockers.length,blockers,created:0,alreadyApplied:0,
  processedUnits:0,remainingUnits:approved.resources.length,complete:false,
  notificationsSent:false,resourcesShared:false};
 if(blockers.length||!apply)return receipt;
 let newWrites=0;
 for(const row of approved.resources){
  if(newWrites>=maxUnits)break;
  const result=await createResource(db,approved,row);
  receipt.processedUnits++;
  if(result==="created"){receipt.created++;newWrites++;}else receipt.alreadyApplied++;
 }
 receipt.remainingUnits=Math.max(0,approved.resources.length-receipt.processedUnits);
 receipt.complete=receipt.remainingUnits===0;
 return receipt;
}
async function main(){
 const args=process.argv.slice(2),apply=args.includes("--apply"),
  planPath=arg(args,"plan"),approvalPath=arg(args,"approval"),
  receiptPath=arg(args,"receipt"),maxUnits=intArg(args,"max-units",30);
 if(apply&&process.env.ADMINERVA_MCS_PLANNING_WRITE!==WRITE_ACK)
  throw Error("Write mode requires the exact ADMINERVA_MCS_PLANNING_WRITE acknowledgement.");
 const planFile=load(planPath,"Plan"),approvalFile=load(approvalPath,"Approval");
 const approved=validateApproval(validatePlan(planFile.data),planFile.raw,approvalFile.data);
 if(!getApps().length)initializeApp({credential:applicationDefault()});
 const receipt=await applyPlanning(getFirestore(),approved,{apply,maxUnits});
 writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+"\n",{flag:"wx",mode:0o600});
 console.info(JSON.stringify({mode:receipt.mode,blocked:receipt.blocked,created:receipt.created,
  alreadyApplied:receipt.alreadyApplied,remainingUnits:receipt.remainingUnits,
  complete:receipt.complete,resourcesShared:false,notificationsSent:false}));
 if(receipt.blocked)process.exitCode=2;
}
if(require.main===module)main().catch(error=>{
 console.error("MCS canonical planning apply failed:",error.code||error.message);process.exitCode=1;
});
module.exports={WRITE_ACK,RECEIPT_SCHEMA,validatePlan,validateApproval,validateResource,
 inspect,applyPlanning};
