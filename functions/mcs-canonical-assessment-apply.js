"use strict";
/**
 * Controlled create-only MCS assessment migration.
 * Default is preflight. Historical task creation emits no notifications.
 */
const {initializeApp,getApps,applicationDefault}=require("firebase-admin/app");
const {getFirestore,FieldValue,Timestamp}=require("firebase-admin/firestore");
const {readFileSync,writeFileSync}=require("node:fs");
const {createHash}=require("node:crypto");
const {SCHEMA:PLAN_SCHEMA}=require("./mcs-canonical-assessment-plan.js");
const {SCHOOL_ID}=require("./mcs-canonical-foundation-plan.js");
const {APPROVAL_SCHEMA}=require("./mcs-canonical-assessment-approval-template.js");
const {rowKey}=require("./school-academics.js");

const WRITE_ACK="YES_I_APPROVE_MCS_CANONICAL_ASSESSMENTS";
const RECEIPT_SCHEMA="adminerva-v4-mcs-canonical-assessment-receipt-v1";
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
function intArg(args,name,fallback,min=1,max=100){
 const raw=args.find(item=>item.startsWith("--"+name+"="))?.slice(name.length+3);
 if(raw===undefined)return fallback;const value=Number(raw);
 if(!Number.isInteger(value)||value<min||value>max)throw Error("--"+name+" must be "+min+"-"+max+".");
 return value;
}
function validatePlan(plan){
 if(!plan||plan.schema!==PLAN_SCHEMA||plan.schoolId!==SCHOOL_ID||plan.readOnly!==true||plan.readyForApply!==false)
  throw Error("Use a current MCS canonical assessment plan.");
 return plan;
}
function explicitDecisions(planRows,approvalRows,key){
 const planned=new Map(planRows.map(row=>[row[key],row]));
 if(approvalRows.length!==planRows.length)throw Error("Approval assessment count differs from the bound plan.");
 const approved=[];
 for(const review of approvalRows){
  const row=planned.get(review[key]);if(!row)throw Error("Approval contains an assessment not present in the plan.");
  if(!["approve","exclude"].includes(review.decision))
   throw Error("Every assessment record requires an explicit approve or exclude decision.");
  if(review.decision==="exclude"){
   const reason=String(review.exclusionReason||"").trim();
   if(reason.length<12||reason.length>1000)throw Error("Excluded assessment records need a 12–1,000 character reason.");
  }else approved.push(row);
 }
 return approved;
}
function validateApproval(plan,raw,approval){
 if(!approval||approval.schema!==APPROVAL_SCHEMA||approval.schoolId!==SCHOOL_ID||
    approval.scope!=="canonical_assessments_only")
  throw Error("Approval does not authorize canonical MCS assessments.");
 const planSha256=sha(raw);
 if(approval.planSha256!==planSha256)throw Error("Approval belongs to a different assessment plan.");
 if(typeof approval.approvedBy!=="string"||approval.approvedBy.trim().length<3||
    typeof approval.approvedAt!=="string"||!Number.isFinite(Date.parse(approval.approvedAt)))
  throw Error("Approval must identify the reviewer and timestamp.");
 for(const key of ["ownersReviewed","rubricsReviewed","offeringScopesReviewed","submissionModesReviewed",
   "legacyNoDeadlineReviewed","historicalLinksReviewed","noDeploymentNotifications","backupsAndRollbackReviewed"])
  if(approval.acknowledgements?.[key]!==true)throw Error("Missing approval acknowledgement: "+key);
 if((approval.unresolvedBlockers||[]).length)throw Error("Resolve every assessment migration blocker before apply.");
 if((approval.reviewItems||[]).some(item=>item.resolved!==true))
  throw Error("Resolve every assessment migration review item before apply.");
 const blueprints=explicitDecisions(plan.blueprints||[],approval.blueprints||[],"blueprintId");
 const tasks=explicitDecisions(plan.tasks||[],approval.tasks||[],"taskId");
 const blueprintIds=new Set(blueprints.map(row=>row.blueprintId));
 for(const task of tasks)if(!blueprintIds.has(task.blueprintId))
  throw Error("An approved deployed task requires its canonical blueprint to be approved.");
 return {planSha256,blueprints,tasks};
}
function meta(approved,type,key){return {source:"mcs_legacy_v3",planSha256:approved.planSha256,type,key};}
function same(data,approved,type,key){
 return data?.schoolId===SCHOOL_ID&&data?.migration?.planSha256===approved.planSha256&&
  data?.migration?.type===type&&data?.migration?.key===key;
}
async function inspect(db,approved){
 const rows=[];
 for(const row of approved.blueprints){
  const ref=db.doc(row.targetPath),doc=await ref.get();
  rows.push({kind:"blueprint",key:row.blueprintId,targetPath:ref.path,
   state:!doc.exists?"ready":same(doc.data(),approved,"blueprint",row.blueprintId)?"already_applied":"target_conflict"});
 }
 for(const row of approved.tasks){
  const ref=db.doc(row.targetPath),doc=await ref.get();
  rows.push({kind:"task",key:row.taskId,targetPath:ref.path,
   state:!doc.exists?"ready":same(doc.data(),approved,"task",row.taskId)?"already_applied":"target_conflict"});
 }
 return rows;
}
async function createBlueprint(db,approved,row){
 const ref=db.doc(row.targetPath);
 return db.runTransaction(async tx=>{
  const [current,member,school]=await Promise.all([
   tx.get(ref),tx.get(db.doc("schools/"+SCHOOL_ID+"/memberships/"+row.ownerUid)),
   tx.get(db.doc("platform_schools/"+SCHOOL_ID))
  ]);
  if(current.exists){
   if(same(current.data(),approved,"blueprint",row.blueprintId))return "already_applied";
   throw Error("Blueprint target changed after preflight.");
  }
  if(!school.exists||!["draft","active"].includes(school.data().state))
   throw Error("MCS school is unavailable.");
  if(!member.exists||member.data().schoolId!==SCHOOL_ID||member.data().status!=="active"||
     !Array.isArray(member.data().roles)||!member.data().roles.includes("teacher"))
   throw Error("Blueprint owner is not an active reviewed teacher.");
  const now=FieldValue.serverTimestamp();
  tx.create(ref,{schoolId:SCHOOL_ID,creatorUid:row.ownerUid,ownerUid:row.ownerUid,
   title:row.title,description:row.description||"",instructions:row.instructions||"",
   rubric:row.rubric,visibility:"private",sharedWithUids:[],status:"draft",
   contentRevision:1,aclRevision:1,createdAt:now,updatedAt:now,
   migration:meta(approved,"blueprint",row.blueprintId)});
  tx.create(db.collection("schools/"+SCHOOL_ID+"/resource_audit").doc(),{
   schoolId:SCHOOL_ID,resourceId:row.blueprintId,actorUid:"migration",
   action:"mcs_assessment_blueprint_migrated",planSha256:approved.planSha256,createdAt:now});
  return "created";
 });
}
async function createTask(db,approved,row){
 const ref=db.doc(row.targetPath);
 return db.runTransaction(async tx=>{
  const grantRef=db.doc("schools/"+SCHOOL_ID+"/staff_assignments/"+rowKey(row.ownerUid,row.offeringId));
  const [current,blueprint,member,grant,offering]=await Promise.all([
   tx.get(ref),tx.get(db.doc("schools/"+SCHOOL_ID+"/assessment_blueprints/"+row.blueprintId)),
   tx.get(db.doc("schools/"+SCHOOL_ID+"/memberships/"+row.ownerUid)),
   tx.get(grantRef),tx.get(db.doc("schools/"+SCHOOL_ID+"/course_offerings/"+row.offeringId))
  ]);
  if(current.exists){
   if(same(current.data(),approved,"task",row.taskId))return "already_applied";
   throw Error("Assessment task target changed after preflight.");
  }
  if(!blueprint.exists||blueprint.data().schoolId!==SCHOOL_ID||blueprint.data().ownerUid!==row.ownerUid)
   throw Error("Approved assessment blueprint is unavailable.");
  if(!member.exists||member.data().status!=="active"||!member.data().roles?.includes("teacher"))
   throw Error("Assessment owner teaching membership is unavailable.");
  if(!grant.exists||grant.data().schoolId!==SCHOOL_ID||grant.data().teacherUid!==row.ownerUid||
     grant.data().offeringId!==row.offeringId||grant.data().status!=="active")
   throw Error("Assessment owner is no longer assigned to the approved offering.");
  if(!offering.exists||offering.data().schoolId!==SCHOOL_ID||offering.data().status!=="active"||
     ["yearId","termId","subjectId","sectionId"].some(key=>offering.data()[key]!==row[key]))
   throw Error("Assessment offering changed after approval.");
  if(!Number.isFinite(row.opensAt)||!Number.isFinite(row.dueAt)||row.dueAt<=row.opensAt)
   throw Error("Approved assessment deployment window is invalid.");
  const now=FieldValue.serverTimestamp();
  tx.create(ref,{schoolId:SCHOOL_ID,ownerUid:row.ownerUid,
   blueprintId:row.blueprintId,blueprintRevision:1,
   offeringId:row.offeringId,yearId:row.yearId,termId:row.termId,
   subjectId:row.subjectId,sectionId:row.sectionId,
   title:row.title,description:row.description||"",instructions:row.instructions||"",
   rubric:row.rubric,rubricMax:row.rubricMax,submissionSource:row.submissionSource,
   opensAt:Timestamp.fromMillis(row.opensAt),dueAt:Timestamp.fromMillis(row.dueAt),
   requestKey:"migration_"+row.taskId,status:"deployed",createdAt:now,
   migration:{...meta(approved,"task",row.taskId),
    sourceAssessmentId:row.sourceAssessmentId,sourceDeploymentId:row.sourceDeploymentId||null,
    legacyNoDeadline:Boolean(row.legacyNoDeadline),windowSource:row.windowSource}});
  tx.create(db.collection("schools/"+SCHOOL_ID+"/assessment_audit").doc(),{
   schoolId:SCHOOL_ID,taskId:row.taskId,actorUid:"migration",action:"mcs_assessment_task_migrated",
   offeringId:row.offeringId,source:row.submissionSource,planSha256:approved.planSha256,
   notificationsSuppressed:true,createdAt:now});
  return "created";
 });
}
function units(approved){
 return [...approved.blueprints.map(row=>({kind:"blueprint",row})),
  ...approved.tasks.map(row=>({kind:"task",row}))];
}
async function applyAssessments(db,approved,{apply=false,maxUnits=50}={}){
 const inspected=await inspect(db,approved),
  blockers=inspected.filter(row=>row.state==="target_conflict"),work=units(approved);
 const receipt={schema:RECEIPT_SCHEMA,schoolId:SCHOOL_ID,scope:"canonical_assessments_only",
  planSha256:approved.planSha256,mode:apply?"apply":"preflight",generatedAt:new Date().toISOString(),
  approvedBlueprints:approved.blueprints.length,approvedTasks:approved.tasks.length,
  blocked:!!blockers.length,blockers,created:0,alreadyApplied:0,processedUnits:0,
  remainingUnits:work.length,complete:false,notificationsSent:false};
 if(blockers.length||!apply)return receipt;
 let newWrites=0;
 for(const unit of work){
  if(newWrites>=maxUnits)break;
  const result=unit.kind==="blueprint"?await createBlueprint(db,approved,unit.row):
   await createTask(db,approved,unit.row);
  receipt.processedUnits++;
  if(result==="created"){receipt.created++;newWrites++;}else receipt.alreadyApplied++;
 }
 receipt.remainingUnits=Math.max(0,work.length-receipt.processedUnits);
 receipt.complete=receipt.remainingUnits===0;return receipt;
}
async function main(){
 const args=process.argv.slice(2),apply=args.includes("--apply"),
  planPath=arg(args,"plan"),approvalPath=arg(args,"approval"),receiptPath=arg(args,"receipt"),
  maxUnits=intArg(args,"max-units",50);
 if(apply&&process.env.ADMINERVA_MCS_ASSESSMENT_WRITE!==WRITE_ACK)
  throw Error("Write mode requires the exact ADMINERVA_MCS_ASSESSMENT_WRITE acknowledgement.");
 const planFile=load(planPath,"Plan"),approvalFile=load(approvalPath,"Approval");
 const approved=validateApproval(validatePlan(planFile.data),planFile.raw,approvalFile.data);
 if(!getApps().length)initializeApp({credential:applicationDefault()});
 const receipt=await applyAssessments(getFirestore(),approved,{apply,maxUnits});
 writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+"\n",{flag:"wx",mode:0o600});
 console.info(JSON.stringify({mode:receipt.mode,blocked:receipt.blocked,created:receipt.created,
  alreadyApplied:receipt.alreadyApplied,remainingUnits:receipt.remainingUnits,complete:receipt.complete,
  notificationsSent:false}));
 if(receipt.blocked)process.exitCode=2;
}
if(require.main===module)main().catch(error=>{
 console.error("MCS canonical assessment apply failed:",error.code||error.message);process.exitCode=1;
});
module.exports={WRITE_ACK,RECEIPT_SCHEMA,validatePlan,validateApproval,inspect,units,applyAssessments};
