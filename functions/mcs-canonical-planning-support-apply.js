"use strict";
/**
 * Controlled create-only MCS reference-folder and teacher-schedule migration.
 *
 * Default mode is preflight. Each folder (with its documents) and each schedule
 * (with all prior revisions) is an atomic migration unit. Partial target state
 * is a blocker and is never repaired implicitly.
 */
const {initializeApp,getApps,applicationDefault}=require("firebase-admin/app");
const {getFirestore,FieldValue,Timestamp}=require("firebase-admin/firestore");
const {readFileSync,writeFileSync}=require("node:fs");
const {createHash}=require("node:crypto");
const {SCHEMA:PLAN_SCHEMA}=require("./mcs-canonical-planning-support-plan.js");
const {APPROVAL_SCHEMA}=require("./mcs-canonical-planning-support-approval-template.js");
const {SCHOOL_ID}=require("./mcs-canonical-foundation-plan.js");
const {normalizeRows,rowsToText,scheduleId,assignedPairs}=require("./school-schedules.js");

const WRITE_ACK="YES_I_APPROVE_MCS_CANONICAL_PLANNING_SUPPORT";
const RECEIPT_SCHEMA="adminerva-v4-mcs-canonical-planning-support-receipt-v1";
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
 if(raw===undefined)return fallback;
 const value=Number(raw);
 if(!Number.isInteger(value)||value<min||value>max)
  throw Error("--"+name+" must be "+min+"-"+max+".");
 return value;
}
function validatePlan(plan){
 if(!plan||plan.schema!==PLAN_SCHEMA||plan.schoolId!==SCHOOL_ID||
    plan.readOnly!==true||plan.readyForApply!==false)
  throw Error("Use a current MCS planning-support plan.");
 return plan;
}
function decisions(planRows,reviewRows,key){
 const planned=new Map(planRows.map(row=>[row[key],row]));
 if(reviewRows.length!==planRows.length)
  throw Error("Approval record count differs from the bound planning-support plan.");
 const approved=[];
 for(const review of reviewRows){
  const row=planned.get(review[key]);
  if(!row||row.ownerUid!==review.ownerUid)
   throw Error("Approval contains a planning-support record not present in the bound plan.");
  if(!["approve","exclude"].includes(review.decision))
   throw Error("Every reference/schedule record requires an explicit approve or exclude decision.");
  if(review.decision==="exclude"){
   const reason=String(review.exclusionReason||"").trim();
   if(reason.length<12||reason.length>1000)
    throw Error("Excluded planning-support records require a 12–1,000 character reason.");
  }else approved.push(row);
 }
 return approved;
}
function validateApproval(plan,raw,approval){
 if(!approval||approval.schema!==APPROVAL_SCHEMA||approval.schoolId!==SCHOOL_ID||
    approval.scope!=="canonical_planning_support_only")
  throw Error("Approval does not authorize MCS planning-support migration.");
 const planSha256=sha(raw);
 if(approval.planSha256!==planSha256)
  throw Error("Approval belongs to a different planning-support plan.");
 if(typeof approval.approvedBy!=="string"||approval.approvedBy.trim().length<3||
    typeof approval.approvedAt!=="string"||!Number.isFinite(Date.parse(approval.approvedAt)))
  throw Error("Approval must identify the reviewer and timestamp.");
 for(const key of ["referenceOwnershipReviewed","extractedTextOnlyReviewed",
   "referenceIdContinuityReviewed","scheduleOwnershipReviewed",
   "scheduleAssignmentPairsReviewed","scheduleRevisionHistoryReviewed",
   "sharedLegacySourcesReviewed","noSharedDataReplication",
   "noMigrationNotifications","backupsAndRollbackReviewed"])
  if(approval.acknowledgements?.[key]!==true)
   throw Error("Missing approval acknowledgement: "+key);
 if((approval.unresolvedBlockers||[]).length)
  throw Error("Resolve every planning-support migration blocker before apply.");
 if((approval.reviewItems||[]).some(item=>item.resolved!==true))
  throw Error("Resolve every planning-support migration review item before apply.");
 return {
  planSha256,
  referenceFolders:decisions(plan.referenceFolders||[],approval.referenceFolders||[],"folderId"),
  schedules:decisions(plan.schedules||[],approval.schedules||[],"scheduleId")
 };
}
function migration(approved,type,key){
 return {source:"mcs_legacy_v3",planSha256:approved.planSha256,type,key};
}
function same(data,approved,type,key){
 return data?.schoolId===SCHOOL_ID&&data?.migration?.planSha256===approved.planSha256&&
  data?.migration?.type===type&&data?.migration?.key===key;
}
function validateFolder(row){
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(row.folderId))
  throw Error("Reference folder ID is incompatible with the V4 contract.");
 if(typeof row.name!=="string"||!row.name.trim()||row.name.trim().length>140)
  throw Error("Reference folder name is invalid.");
 if(row.status!=="active"||row.revision!==1)
  throw Error("Reference folder migration supports the preserved active version-1 legacy shape only.");
 if(!Array.isArray(row.documents)||row.documents.length>100||
    row.documentCount!==row.documents.length)
  throw Error("Reference folder document count exceeds or disagrees with the V4 contract.");
 const ids=new Set();
 for(const doc of row.documents){
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(doc.documentId)||ids.has(doc.documentId))
   throw Error("Reference document ID is invalid or duplicated.");
  ids.add(doc.documentId);
  if(doc.folderId!==row.folderId||doc.ownerUid!==row.ownerUid||
     doc.status!=="active"||doc.revision!==1)
   throw Error("Reference document ownership/lifecycle does not match its folder.");
  if(typeof doc.title!=="string"||!doc.title.trim()||doc.title.trim().length>180||
     typeof doc.text!=="string"||!doc.text.trim()||
     Buffer.byteLength(doc.text,"utf8")>650000||
     !["text","pdf_extracted_text"].includes(doc.sourceType))
   throw Error("Reference document content is outside the V4 contract.");
 }
}
async function validateSchedule(db,row){
 if(row.scheduleId!==scheduleId(row.ownerUid,row.schoolYear,row.semester))
  throw Error("Teacher schedule runtime ID mismatch.");
 if(!Number.isInteger(row.revision)||row.revision<1||
    !Array.isArray(row.revisions)||row.revisions.length!==row.revision-1)
  throw Error("Teacher schedule revision history is incomplete.");
 const prefix="schools/"+SCHOOL_ID+"/",pairs=await assignedPairs(db,prefix,row.ownerUid);
 const current=normalizeRows(row.rows,pairs);
 if(JSON.stringify(current)!==JSON.stringify(row.rows)||
    rowsToText(current)!==row.rawText)
  throw Error("Teacher schedule no longer matches canonical assignment validation.");
 for(let index=0;index<row.revisions.length;index++){
  const revision=row.revisions[index];
  if(revision.version!==index+1||
     revision.schoolYear!==row.schoolYear||revision.semester!==row.semester)
   throw Error("Teacher schedule revision sequence/scope is invalid.");
  const rows=normalizeRows(revision.rows,pairs);
  if(JSON.stringify(rows)!==JSON.stringify(revision.rows)||
     rowsToText(rows)!==revision.rawText)
   throw Error("A teacher schedule revision no longer matches canonical assignment validation.");
 }
}
async function inspectFolder(db,approved,row){
 try{validateFolder(row);}
 catch(error){return {kind:"reference_folder",key:row.folderId,targetPath:row.targetPath,
   state:"candidate_integrity_error",message:error.message};}
 const refs=[db.doc(row.targetPath),...row.documents.map(doc=>db.doc(doc.targetPath))];
 const snapshots=await Promise.all(refs.map(ref=>ref.get()));
 const states=snapshots.map((snap,index)=>{
  const type=index===0?"reference_folder":"reference_document",
   key=index===0?row.folderId:row.documents[index-1].documentId;
  return !snap.exists?"ready":same(snap.data(),approved,type,key)?"already_applied":"target_conflict";
 });
 if(states.includes("target_conflict"))
  return {kind:"reference_folder",key:row.folderId,targetPath:row.targetPath,state:"target_conflict"};
 if(new Set(states).size>1)
  return {kind:"reference_folder",key:row.folderId,targetPath:row.targetPath,state:"partial_target_state"};
 return {kind:"reference_folder",key:row.folderId,targetPath:row.targetPath,state:states[0]};
}
async function inspectSchedule(db,approved,row){
 try{await validateSchedule(db,row);}
 catch(error){return {kind:"schedule",key:row.scheduleId,targetPath:row.targetPath,
   state:"candidate_integrity_error",message:error.message};}
 const refs=[db.doc(row.targetPath),...row.revisions.map(revision=>
  db.doc(row.targetPath+"/revisions/"+revision.version))];
 const snapshots=await Promise.all(refs.map(ref=>ref.get()));
 const states=snapshots.map((snap,index)=>{
  const type=index===0?"teacher_schedule":"teacher_schedule_revision",
   key=index===0?row.scheduleId:row.scheduleId+"_"+row.revisions[index-1].version;
  return !snap.exists?"ready":same(snap.data(),approved,type,key)?"already_applied":"target_conflict";
 });
 if(states.includes("target_conflict"))
  return {kind:"schedule",key:row.scheduleId,targetPath:row.targetPath,state:"target_conflict"};
 if(new Set(states).size>1)
  return {kind:"schedule",key:row.scheduleId,targetPath:row.targetPath,state:"partial_target_state"};
 return {kind:"schedule",key:row.scheduleId,targetPath:row.targetPath,state:states[0]};
}
async function inspect(db,approved){
 const school=await db.doc("platform_schools/"+SCHOOL_ID).get(),rows=[];
 if(!school.exists||!["draft","active"].includes(school.data().state))
  rows.push({state:"school_missing_or_unavailable",targetPath:"platform_schools/"+SCHOOL_ID});
 for(const folder of approved.referenceFolders){
  const member=await db.doc("schools/"+SCHOOL_ID+"/memberships/"+folder.ownerUid).get();
  if(!member.exists||member.data().schoolId!==SCHOOL_ID||
     !Array.isArray(member.data().roles)||!member.data().roles.includes("teacher")){
   rows.push({kind:"reference_folder",key:folder.folderId,targetPath:folder.targetPath,
    state:"teacher_membership_missing"});continue;
  }
  rows.push(await inspectFolder(db,approved,folder));
 }
 for(const schedule of approved.schedules){
  const member=await db.doc("schools/"+SCHOOL_ID+"/memberships/"+schedule.ownerUid).get();
  if(!member.exists||member.data().schoolId!==SCHOOL_ID||
     !Array.isArray(member.data().roles)||!member.data().roles.includes("teacher")){
   rows.push({kind:"schedule",key:schedule.scheduleId,targetPath:schedule.targetPath,
    state:"teacher_membership_missing"});continue;
  }
  rows.push(await inspectSchedule(db,approved,schedule));
 }
 return rows;
}
async function createFolder(db,approved,row){
 validateFolder(row);
 const folderRef=db.doc(row.targetPath),prefix="schools/"+SCHOOL_ID+"/";
 return db.runTransaction(async tx=>{
  const refs=[folderRef,...row.documents.map(doc=>db.doc(doc.targetPath))];
  const [member,...targets]=await Promise.all([
   tx.get(db.doc(prefix+"memberships/"+row.ownerUid)),...refs.map(ref=>tx.get(ref))
  ]);
  if(!member.exists||member.data().schoolId!==SCHOOL_ID||
     !Array.isArray(member.data().roles)||!member.data().roles.includes("teacher"))
   throw Error("Reference owner no longer has the reviewed teacher role.");
  const states=targets.map((snap,index)=>{
   const type=index===0?"reference_folder":"reference_document",
    key=index===0?row.folderId:row.documents[index-1].documentId;
   return !snap.exists?"ready":same(snap.data(),approved,type,key)?"already_applied":"target_conflict";
  });
  if(states.includes("target_conflict"))throw Error("Reference target changed after preflight.");
  if(states.every(state=>state==="already_applied"))return "already_applied";
  if(states.some(state=>state==="already_applied"))
   throw Error("Reference folder is only partially migrated; reconcile before retrying.");
  const now=FieldValue.serverTimestamp();
  tx.create(folderRef,{schoolId:SCHOOL_ID,ownerUid:row.ownerUid,name:row.name,
   status:"active",documentCount:row.documents.length,revision:1,
   createdAt:now,updatedAt:now,
   migration:{...migration(approved,"reference_folder",row.folderId),
    sourcePath:row.migration?.sourcePath,legacyFolderId:row.migration?.legacyFolderId}});
  for(const doc of row.documents)tx.create(db.doc(doc.targetPath),{
   schoolId:SCHOOL_ID,ownerUid:row.ownerUid,folderId:row.folderId,
   title:doc.title,text:doc.text,sourceType:doc.sourceType,
   status:"active",revision:1,createdAt:now,updatedAt:now,
   migration:{...migration(approved,"reference_document",doc.documentId),
    sourcePath:doc.migration?.sourcePath,source:doc.migration?.source,digest:doc.digest}
  });
  tx.create(db.collection(prefix+"planning_audit").doc(),{
   schoolId:SCHOOL_ID,actorUid:"migration",resourceId:row.folderId,
   action:"mcs_reference_folder_migrated",ownerUid:row.ownerUid,
   documentCount:row.documents.length,notificationsSuppressed:true,
   planSha256:approved.planSha256,createdAt:now});
  return "created";
 });
}
async function createSchedule(db,approved,row){
 await validateSchedule(db,row);
 const ref=db.doc(row.targetPath),prefix="schools/"+SCHOOL_ID+"/";
 return db.runTransaction(async tx=>{
  const revisionRefs=row.revisions.map(revision=>ref.collection("revisions").doc(String(revision.version)));
  const [member,current,...prior]=await Promise.all([
   tx.get(db.doc(prefix+"memberships/"+row.ownerUid)),tx.get(ref),
   ...revisionRefs.map(item=>tx.get(item))
  ]);
  if(!member.exists||member.data().schoolId!==SCHOOL_ID||
     !Array.isArray(member.data().roles)||!member.data().roles.includes("teacher"))
   throw Error("Schedule owner no longer has the reviewed teacher role.");
  const states=[
   !current.exists?"ready":same(current.data(),approved,"teacher_schedule",row.scheduleId)?"already_applied":"target_conflict",
   ...prior.map((snap,index)=>!snap.exists?"ready":
    same(snap.data(),approved,"teacher_schedule_revision",row.scheduleId+"_"+row.revisions[index].version)?
     "already_applied":"target_conflict")
  ];
  if(states.includes("target_conflict"))throw Error("Schedule target changed after preflight.");
  if(states.every(state=>state==="already_applied"))return "already_applied";
  if(states.some(state=>state==="already_applied"))
   throw Error("Schedule is only partially migrated; reconcile before retrying.");
  const now=FieldValue.serverTimestamp();
  for(const revision of row.revisions)tx.create(
   ref.collection("revisions").doc(String(revision.version)),{
    schoolId:SCHOOL_ID,ownerUid:row.ownerUid,schoolYear:row.schoolYear,
    semester:row.semester,rows:revision.rows,rawText:revision.rawText,
    revision:revision.version,archivedRevisionAt:now,
    migration:{...migration(approved,"teacher_schedule_revision",
      row.scheduleId+"_"+revision.version),
     sourcePath:revision.migration?.sourcePath}
   });
  tx.create(ref,{schoolId:SCHOOL_ID,ownerUid:row.ownerUid,
   schoolYear:row.schoolYear,semester:row.semester,rows:row.rows,rawText:row.rawText,
   revision:row.revision,createdAt:now,updatedAt:now,
   migration:{...migration(approved,"teacher_schedule",row.scheduleId),
    sourcePath:row.migration?.sourcePath,legacyScheduleId:row.migration?.legacyScheduleId,
    legacyRawText:row.migration?.legacyRawText||null}});
  tx.create(db.collection(prefix+"planning_audit").doc(),{
   schoolId:SCHOOL_ID,actorUid:"migration",resourceId:row.scheduleId,
   action:"mcs_teacher_schedule_migrated",ownerUid:row.ownerUid,
   schoolYear:row.schoolYear,semester:row.semester,revision:row.revision,
   notificationsSuppressed:true,planSha256:approved.planSha256,createdAt:now});
  return "created";
 });
}
function units(approved){
 return [...approved.referenceFolders.map(row=>({kind:"reference_folder",row})),
  ...approved.schedules.map(row=>({kind:"schedule",row}))];
}
async function applyPlanningSupport(db,approved,{apply=false,maxUnits=30}={}){
 const inspected=await inspect(db,approved),
  blockers=inspected.filter(row=>!["ready","already_applied"].includes(row.state)),
  work=units(approved);
 const receipt={schema:RECEIPT_SCHEMA,schoolId:SCHOOL_ID,
  scope:"canonical_planning_support_only",planSha256:approved.planSha256,
  mode:apply?"apply":"preflight",generatedAt:new Date().toISOString(),
  approvedReferenceFolders:approved.referenceFolders.length,
  approvedReferenceDocuments:approved.referenceFolders.reduce((sum,row)=>sum+row.documents.length,0),
  approvedSchedules:approved.schedules.length,blocked:!!blockers.length,blockers,
  created:0,alreadyApplied:0,processedUnits:0,remainingUnits:work.length,
  complete:false,notificationsSent:false,sharedLegacyDataReplicated:false};
 if(blockers.length||!apply)return receipt;
 let newWrites=0;
 for(const unit of work){
  if(newWrites>=maxUnits)break;
  const result=unit.kind==="reference_folder"?
   await createFolder(db,approved,unit.row):await createSchedule(db,approved,unit.row);
  receipt.processedUnits++;
  if(result==="created"){receipt.created++;newWrites++;}else receipt.alreadyApplied++;
 }
 receipt.remainingUnits=Math.max(0,work.length-receipt.processedUnits);
 receipt.complete=receipt.remainingUnits===0;
 return receipt;
}
async function main(){
 const args=process.argv.slice(2),apply=args.includes("--apply"),
  planPath=arg(args,"plan"),approvalPath=arg(args,"approval"),
  receiptPath=arg(args,"receipt"),maxUnits=intArg(args,"max-units",30);
 if(apply&&process.env.ADMINERVA_MCS_PLANNING_SUPPORT_WRITE!==WRITE_ACK)
  throw Error("Write mode requires the exact ADMINERVA_MCS_PLANNING_SUPPORT_WRITE acknowledgement.");
 const planFile=load(planPath,"Plan"),approvalFile=load(approvalPath,"Approval");
 const approved=validateApproval(validatePlan(planFile.data),planFile.raw,approvalFile.data);
 if(!getApps().length)initializeApp({credential:applicationDefault()});
 const receipt=await applyPlanningSupport(getFirestore(),approved,{apply,maxUnits});
 writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+"\n",{flag:"wx",mode:0o600});
 console.info(JSON.stringify({mode:receipt.mode,blocked:receipt.blocked,
  created:receipt.created,alreadyApplied:receipt.alreadyApplied,
  remainingUnits:receipt.remainingUnits,complete:receipt.complete,
  sharedLegacyDataReplicated:false,notificationsSent:false}));
 if(receipt.blocked)process.exitCode=2;
}
if(require.main===module)main().catch(error=>{
 console.error("MCS planning-support apply failed:",error.code||error.message);
 process.exitCode=1;
});
module.exports={WRITE_ACK,RECEIPT_SCHEMA,validatePlan,validateApproval,validateFolder,
 validateSchedule,inspect,units,applyPlanningSupport};
