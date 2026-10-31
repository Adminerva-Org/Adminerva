"use strict";
/**
 * Controlled create-only MCS enrollment and teacher-assignment migration.
 * Default mode is preflight. No notifications are emitted.
 */
const {initializeApp,getApps,applicationDefault}=require("firebase-admin/app");
const {getFirestore,FieldValue}=require("firebase-admin/firestore");
const {readFileSync,writeFileSync}=require("node:fs");
const {createHash}=require("node:crypto");
const {SCHEMA:PLAN_SCHEMA,SCHOOL_ID}=require("./mcs-canonical-academic-access-plan.js");
const {APPROVAL_SCHEMA}=require("./mcs-canonical-academic-access-approval-template.js");
const {rowKey}=require("./school-academics.js");

const WRITE_ACK="YES_I_APPROVE_MCS_CANONICAL_ACADEMIC_ACCESS";
const RECEIPT_SCHEMA="adminerva-v4-mcs-canonical-academic-access-receipt-v1";
const sha=value=>createHash("sha256").update(value).digest("hex");
function arg(args,name){
 const value=args.find(item=>item.startsWith("--"+name+"="))?.slice(name.length+3);
 if(!value||!value.startsWith("/")||value.includes("\0"))throw Error("Provide --"+name+" as a restricted absolute path.");
 return value;
}
function load(path,label){
 const raw=readFileSync(path);let data;
 try{data=JSON.parse(raw.toString("utf8"));}catch{throw Error(label+" is not valid JSON.");}
 return {raw,data};
}
function integerArg(args,name,fallback,min=1,max=100){
 const raw=args.find(item=>item.startsWith("--"+name+"="))?.slice(name.length+3);
 if(raw===undefined)return fallback;const value=Number(raw);
 if(!Number.isInteger(value)||value<min||value>max)throw Error("--"+name+" must be "+min+"-"+max+".");
 return value;
}
function validatePlan(plan){
 if(!plan||plan.schema!==PLAN_SCHEMA||plan.schoolId!==SCHOOL_ID||plan.readOnly!==true||plan.readyForApply!==false)
  throw Error("Use a current MCS canonical academic-access plan.");
 return plan;
}
function decisionRows(planRows,approvalRows,keyField){
 const planned=new Map(planRows.map(row=>[row[keyField],row])),approved=[];
 if(approvalRows.length!==planRows.length)throw Error("Approval relationship count differs from the bound plan.");
 for(const review of approvalRows){
  const row=planned.get(review[keyField]);
  if(!row)throw Error("Approval contains a relationship not present in the plan.");
  if(!["approve","exclude"].includes(review.decision))
   throw Error("Every relationship requires an explicit approve or exclude decision.");
  if(review.decision==="exclude"){
   const reason=String(review.exclusionReason||"").trim();
   if(reason.length<12||reason.length>1000)throw Error("Excluded migration relationships need a 12–1,000 character reason.");
  }else approved.push(row);
 }
 return approved;
}
function validateApproval(plan,raw,approval){
 if(!approval||approval.schema!==APPROVAL_SCHEMA||approval.schoolId!==SCHOOL_ID||
    approval.scope!=="canonical_academic_access_only")
  throw Error("Approval does not authorize MCS canonical academic access.");
 const planSha256=sha(raw);
 if(approval.planSha256!==planSha256)throw Error("Approval belongs to a different academic-access plan.");
 if(typeof approval.approvedBy!=="string"||approval.approvedBy.trim().length<3||
    typeof approval.approvedAt!=="string"||!Number.isFinite(Date.parse(approval.approvedAt)))
  throw Error("Approval must identify the reviewer and timestamp.");
 for(const key of ["enrollmentScopesReviewed","teacherScopesReviewed","endedHistoryReviewed",
   "excludedRowsExplained","noImplicitElectiveEnrollment","noImplicitTeacherExpansion","backupsAndRollbackReviewed"])
  if(approval.acknowledgements?.[key]!==true)throw Error("Missing approval acknowledgement: "+key);
 if((approval.unresolvedBlockers||[]).length)throw Error("Resolve every academic-access blocker before apply.");
 if((approval.reviewItems||[]).some(item=>item.resolved!==true))
  throw Error("Resolve every academic-access review item before apply.");
 const enrollments=decisionRows(plan.enrollments||[],approval.enrollments||[],"enrollmentId");
 const assignments=decisionRows(plan.assignments||[],approval.assignments||[],"assignmentId");
 return {planSha256,enrollments,assignments};
}
function migration(planSha256,type,key){
 return {source:"mcs_legacy_v3",planSha256,type,key};
}
function same(data,approved,type,key){
 return data?.schoolId===SCHOOL_ID&&data?.migration?.planSha256===approved.planSha256&&
  data?.migration?.type===type&&data?.migration?.key===key;
}
async function inspect(db,approved){
 const rows=[],school=await db.doc("platform_schools/"+SCHOOL_ID).get();
 if(!school.exists||!["draft","active"].includes(school.data().state))
  rows.push({state:"school_missing_or_unavailable",targetPath:"platform_schools/"+SCHOOL_ID});
 for(const row of approved.enrollments){
  if(row.enrollmentId!==rowKey(row.personId,row.offeringId))
   rows.push({state:"runtime_key_mismatch",kind:"enrollment",key:row.enrollmentId,targetPath:row.targetPath});
  const ref=db.doc(row.targetPath),doc=await ref.get();
  rows.push({state:!doc.exists?"ready":same(doc.data(),approved,"enrollment",row.enrollmentId)?"already_applied":"target_conflict",
   kind:"enrollment",key:row.enrollmentId,targetPath:ref.path});
 }
 for(const row of approved.assignments){
  if(row.assignmentId!==rowKey(row.teacherUid,row.offeringId))
   rows.push({state:"runtime_key_mismatch",kind:"assignment",key:row.assignmentId,targetPath:row.targetPath});
  const ref=db.doc(row.targetPath),doc=await ref.get();
  rows.push({state:!doc.exists?"ready":same(doc.data(),approved,"assignment",row.assignmentId)?"already_applied":"target_conflict",
   kind:"assignment",key:row.assignmentId,targetPath:ref.path});
 }
 return rows;
}
async function createEnrollment(db,approved,row){
 const ref=db.doc(row.targetPath);
 return db.runTransaction(async tx=>{
  const [current,person,member,offering]=await Promise.all([
   tx.get(ref),tx.get(db.doc("schools/"+SCHOOL_ID+"/people/"+row.personId)),
   tx.get(db.doc("schools/"+SCHOOL_ID+"/memberships/"+row.studentUid)),
   tx.get(db.doc("schools/"+SCHOOL_ID+"/course_offerings/"+row.offeringId))
  ]);
  if(current.exists){
   if(same(current.data(),approved,"enrollment",row.enrollmentId))return "already_applied";
   throw Error("Enrollment target changed after preflight.");
  }
  if(!person.exists||person.data().schoolId!==SCHOOL_ID||person.data().kind!=="student"||
     person.data().authUid!==row.studentUid)
   throw Error("Enrollment person/account linkage is not canonical.");
  if(!member.exists||member.data().schoolId!==SCHOOL_ID||
     !Array.isArray(member.data().roles)||!member.data().roles.includes("student"))
   throw Error("Enrollment requires the reviewed student membership.");
  if(row.status==="active"&&(person.data().status!=="active"||member.data().status!=="active"))
   throw Error("Active enrollment requires an active person and membership.");
  if(!offering.exists||offering.data().schoolId!==SCHOOL_ID||offering.data().status!=="active"||
     ["yearId","termId","sectionId","subjectId"].some(key=>offering.data()[key]!==row[key]))
   throw Error("Enrollment course offering changed after approval.");
  const now=FieldValue.serverTimestamp();
  tx.create(ref,{schoolId:SCHOOL_ID,personId:row.personId,offeringId:row.offeringId,
   yearId:row.yearId,termId:row.termId,sectionId:row.sectionId,subjectId:row.subjectId,
   status:row.status,revision:1,createdByUid:"migration",createdAt:now,
   ...(row.status==="ended"?{endedByUid:"migration",endedAt:now,endReason:"Historical MCS roster relationship migrated as ended."}:{}),
   migration:migration(approved.planSha256,"enrollment",row.enrollmentId)});
  tx.create(db.collection("schools/"+SCHOOL_ID+"/directory_audit").doc(),{
   schoolId:SCHOOL_ID,actorUid:"migration",personId:row.personId,offeringId:row.offeringId,
   action:"mcs_canonical_enrollment_migrated",status:row.status,planSha256:approved.planSha256,createdAt:now});
  return "created";
 });
}
async function createAssignment(db,approved,row){
 const ref=db.doc(row.targetPath);
 return db.runTransaction(async tx=>{
  const [current,member,offering]=await Promise.all([
   tx.get(ref),tx.get(db.doc("schools/"+SCHOOL_ID+"/memberships/"+row.teacherUid)),
   tx.get(db.doc("schools/"+SCHOOL_ID+"/course_offerings/"+row.offeringId))
  ]);
  if(current.exists){
   if(same(current.data(),approved,"assignment",row.assignmentId))return "already_applied";
   throw Error("Teacher-assignment target changed after preflight.");
  }
  if(!member.exists||member.data().schoolId!==SCHOOL_ID||member.data().status!=="active"||
     !Array.isArray(member.data().roles)||!member.data().roles.includes("teacher"))
   throw Error("Teacher assignment requires an active reviewed teacher membership.");
  if(!offering.exists||offering.data().schoolId!==SCHOOL_ID||offering.data().status!=="active"||
     ["yearId","termId","sectionId","subjectId"].some(key=>offering.data()[key]!==row[key]))
   throw Error("Teacher assignment course offering changed after approval.");
  const now=FieldValue.serverTimestamp();
  tx.create(ref,{schoolId:SCHOOL_ID,teacherUid:row.teacherUid,offeringId:row.offeringId,
   yearId:row.yearId,termId:row.termId,sectionId:row.sectionId,subjectId:row.subjectId,
   status:"active",revision:1,createdByUid:"migration",createdAt:now,
   migration:migration(approved.planSha256,"assignment",row.assignmentId)});
  tx.create(db.collection("schools/"+SCHOOL_ID+"/directory_audit").doc(),{
   schoolId:SCHOOL_ID,actorUid:"migration",teacherUid:row.teacherUid,offeringId:row.offeringId,
   action:"mcs_canonical_teacher_assignment_migrated",planSha256:approved.planSha256,createdAt:now});
  return "created";
 });
}
function units(approved){
 return [...approved.enrollments.map(row=>({kind:"enrollment",row})),
  ...approved.assignments.map(row=>({kind:"assignment",row}))];
}
async function applyAccess(db,approved,{apply=false,maxUnits=50}={}){
 const inspected=await inspect(db,approved);
 const blockers=inspected.filter(row=>["school_missing_or_unavailable","runtime_key_mismatch","target_conflict"].includes(row.state));
 const work=units(approved);
 const receipt={schema:RECEIPT_SCHEMA,schoolId:SCHOOL_ID,scope:"canonical_academic_access_only",
  planSha256:approved.planSha256,mode:apply?"apply":"preflight",generatedAt:new Date().toISOString(),
  approvedEnrollments:approved.enrollments.length,approvedAssignments:approved.assignments.length,
  blocked:!!blockers.length,blockers,created:0,alreadyApplied:0,processedUnits:0,
  remainingUnits:work.length,complete:false};
 if(blockers.length||!apply)return receipt;
 let newWrites=0;
 for(const unit of work){
  if(newWrites>=maxUnits)break;
  const result=unit.kind==="enrollment"?await createEnrollment(db,approved,unit.row):
   await createAssignment(db,approved,unit.row);
  receipt.processedUnits++;
  if(result==="created"){receipt.created++;newWrites++;}else receipt.alreadyApplied++;
 }
 receipt.remainingUnits=Math.max(0,work.length-receipt.processedUnits);
 receipt.complete=receipt.remainingUnits===0;return receipt;
}
async function main(){
 const args=process.argv.slice(2),apply=args.includes("--apply"),planPath=arg(args,"plan"),
  approvalPath=arg(args,"approval"),receiptPath=arg(args,"receipt"),
  maxUnits=integerArg(args,"max-units",50);
 if(apply&&process.env.ADMINERVA_MCS_ACADEMIC_ACCESS_WRITE!==WRITE_ACK)
  throw Error("Write mode requires the exact ADMINERVA_MCS_ACADEMIC_ACCESS_WRITE acknowledgement.");
 const planFile=load(planPath,"Plan"),approvalFile=load(approvalPath,"Approval");
 const approved=validateApproval(validatePlan(planFile.data),planFile.raw,approvalFile.data);
 if(!getApps().length)initializeApp({credential:applicationDefault()});
 const receipt=await applyAccess(getFirestore(),approved,{apply,maxUnits});
 writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+"\n",{flag:"wx",mode:0o600});
 console.info(JSON.stringify({mode:receipt.mode,blocked:receipt.blocked,created:receipt.created,
  alreadyApplied:receipt.alreadyApplied,remainingUnits:receipt.remainingUnits,complete:receipt.complete}));
 if(receipt.blocked)process.exitCode=2;
}
if(require.main===module)main().catch(error=>{
 console.error("MCS canonical academic-access apply failed:",error.code||error.message);process.exitCode=1;
});
module.exports={WRITE_ACK,RECEIPT_SCHEMA,validatePlan,validateApproval,inspect,units,applyAccess};
