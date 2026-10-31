"use strict";
/**
 * Controlled create-only apply engine for school continuity exports.
 *
 * Memberships are intentionally excluded. The engine never overwrites an
 * existing canonical record and never emits student/teacher notifications.
 */
const {initializeApp,getApps,applicationDefault}=require("firebase-admin/app");
const {getFirestore,Timestamp,FieldValue}=require("firebase-admin/firestore");
const {getAuth}=require("firebase-admin/auth");
const {readFileSync,writeFileSync}=require("node:fs");
const {createHash}=require("node:crypto");
const {definitions}=require("./school-data-export.js");
const {rowKey}=require("./school-academics.js");
const {
 PLAN_SCHEMA,AUTO_CATEGORIES,verifyBundle,comparable
}=require("./school-continuity-restore-plan.js");
const {APPROVAL_SCHEMA}=require("./school-continuity-restore-approval-template.js");

const WRITE_ACK="YES_I_APPROVE_SCHOOL_CONTINUITY_RESTORE";
const RECEIPT_SCHEMA="adminerva-school-continuity-restore-receipt-v1";
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
function intArg(args,name,fallback,min=1,max=200){
 const raw=args.find(item=>item.startsWith("--"+name+"="))?.slice(name.length+3);
 if(raw===undefined)return fallback;
 const value=Number(raw);
 if(!Number.isInteger(value)||value<min||value>max)
  throw Error("--"+name+" must be "+min+"-"+max+".");
 return value;
}
function validatePlan(plan){
 if(!plan||plan.schema!==PLAN_SCHEMA||plan.readOnly!==true||plan.readyForApply!==false)
  throw Error("Use a current school continuity restore plan.");
 if((plan.blockers||[]).length)
  throw Error("Regenerate the restore plan after resolving every blocker.");
 if((plan.excludedFromAutomaticRestore||[]).includes("memberships")!==true)
  throw Error("Restore plan must explicitly exclude automatic membership restoration.");
 return plan;
}
function validateApproval(plan,raw,approval){
 if(!approval||approval.schema!==APPROVAL_SCHEMA||approval.schoolId!==plan.schoolId||
    approval.scope!=="school_continuity_restore_only")
  throw Error("Approval does not authorize this continuity restore.");
 const planSha256=sha(raw);
 if(approval.planSha256!==planSha256||approval.exportSha256!==plan.exportSha256)
  throw Error("Approval belongs to another restore plan or export.");
 if(typeof approval.approvedBy!=="string"||approval.approvedBy.trim().length<3||
    typeof approval.approvedAt!=="string"||!Number.isFinite(Date.parse(approval.approvedAt)))
  throw Error("Approval must identify the reviewer and timestamp.");
 for(const key of [
  "sameSchoolRestoreReviewed","targetConflictsResolved",
  "membershipsAndRolesRecoveredSeparately","noAutomaticMembershipOrRoleGrant",
  "teacherPrivateResourcesRemainExcluded","studentSourceEvidenceRemainExcluded",
  "publishedGradesOnlyReviewed","supportBinaryAndCommentsExcludedReviewed",
  "backupsAndRollbackReviewed","noRestoreNotifications"
 ])
  if(approval.acknowledgements?.[key]!==true)
   throw Error("Missing restore acknowledgement: "+key);
 if((approval.unresolvedBlockers||[]).length)
  throw Error("Approval still contains unresolved restore blockers.");
 const categories=[];
 for(const category of AUTO_CATEGORIES){
  const review=approval.categories?.[category];
  if(!review||!["approve","exclude"].includes(review.decision))
   throw Error("Every continuity category requires an explicit approve or exclude decision.");
  if(review.decision==="exclude"){
   const reason=String(review.exclusionReason||"").trim();
   if(reason.length<12||reason.length>1000)
    throw Error("Excluded restore categories require a 12–1,000 character reason.");
  }else categories.push(category);
 }
 return {
  planSha256,exportSha256:plan.exportSha256,schoolId:plan.schoolId,
  approvedBy:approval.approvedBy.trim(),categories
 };
}
function convertValue(key,value){
 if(value===null||value===undefined)return value;
 if(key.endsWith("At")&&typeof value==="string"){
  const millis=Date.parse(value);
  if(!Number.isFinite(millis))throw Error("Invalid timestamp in continuity record: "+key);
  return Timestamp.fromMillis(millis);
 }
 return value;
}
function inflate(category,row,approved){
 const def=definitions[category],data={schoolId:approved.schoolId};
 for(const key of def.fields)if(row[key]!==undefined)data[key]=convertValue(key,row[key]);
 data.continuityRestore={
  exportSha256:approved.exportSha256,planSha256:approved.planSha256,
  category,restoredBy:approved.approvedBy
 };
 return data;
}
function exactTargetPath(schoolId,category,row){
 return "schools/"+schoolId+"/"+definitions[category].path+"/"+row.id;
}
async function ensurePersonAuth(auth,row){
 if(!row.authUid)return;
 let user;
 try{user=await auth.getUser(row.authUid);}
 catch(error){
  if(error.code==="auth/user-not-found")throw Error("Linked Firebase Auth user is missing for person "+row.id+".");
  throw error;
 }
 if(row.status==="active"&&(user.disabled||!user.emailVerified))
  throw Error("Active person "+row.id+" is linked to a disabled or unverified Auth account.");
}
async function ensureDependencies(db,approved,category,row){
 const prefix="schools/"+approved.schoolId+"/";
 const get=path=>db.doc(prefix+path).get();
 if(category==="people")return;
 if(category==="terms"){
  const year=await get("academic_years/"+row.yearId);
  if(!year.exists)throw Error("Term "+row.id+" requires academic year "+row.yearId+".");
 }
 if(category==="course_offerings"){
  const [year,term,subject,section]=await Promise.all([
   get("academic_years/"+row.yearId),get("terms/"+row.termId),
   get("subjects/"+row.subjectId),get("sections/"+row.sectionId)
  ]);
  if([year,term,subject,section].some(doc=>!doc.exists))
   throw Error("Course offering "+row.id+" has an unresolved catalog dependency.");
 }
 if(category==="enrollments"){
  const [person,offering]=await Promise.all([
   get("people/"+row.personId),get("course_offerings/"+row.offeringId)
  ]);
  if(!person.exists||!offering.exists)
   throw Error("Enrollment "+row.id+" requires its person and course offering.");
 }
 if(category==="staff_assignments"){
  const [offering,member]=await Promise.all([
   get("course_offerings/"+row.offeringId),get("memberships/"+row.teacherUid)
  ]);
  if(!offering.exists)throw Error("Teacher assignment "+row.id+" requires its course offering.");
  if(row.status==="active"&&(!member.exists||member.data().status!=="active"||
     !Array.isArray(member.data().roles)||!member.data().roles.includes("teacher")))
   throw Error("Active teacher assignment "+row.id+" requires separately restored active teacher membership.");
 }
 if(category==="student_repository_configs"){
  const [person,offering,member]=await Promise.all([
   get("people/"+row.personId),get("course_offerings/"+row.offeringId),
   get("memberships/"+row.studentUid)
  ]);
  if(!person.exists||person.data().schoolId!==approved.schoolId||
     person.data().kind!=="student"||person.data().authUid!==row.studentUid)
   throw Error("Repository configuration "+row.id+" requires its canonical student person/Auth link.");
  if(!offering.exists||offering.data().schoolId!==approved.schoolId)
   throw Error("Repository configuration "+row.id+" requires its course offering.");
  if(!member.exists||member.data().status!=="active"||
     !Array.isArray(member.data().roles)||!member.data().roles.includes("student")||
     member.data().personId!==row.personId)
   throw Error("Repository configuration "+row.id+" requires separately restored active student membership.");
 }
 if(category==="assessments"){
  const reviewerUid=row.reviewerUid||row.ownerUid;
  const [offering,member,assignment]=await Promise.all([
   get("course_offerings/"+row.offeringId),get("memberships/"+reviewerUid),
   get("staff_assignments/"+rowKey(reviewerUid,row.offeringId))
  ]);
  if(!offering.exists)throw Error("Assessment "+row.id+" requires its course offering.");
  if(row.status==="deployed"&&row.lifecycle!=="cancelled"){
   if(!member.exists||member.data().status!=="active"||
      !Array.isArray(member.data().roles)||!member.data().roles.includes("teacher"))
    throw Error("Deployed assessment "+row.id+" requires separately restored active responsible-teacher membership.");
   if(!assignment.exists||assignment.data().schoolId!==approved.schoolId||
      assignment.data().teacherUid!==reviewerUid||
      assignment.data().offeringId!==row.offeringId||assignment.data().status!=="active")
    throw Error("Deployed assessment "+row.id+" requires an active responsible-teacher assignment.");
  }
 }
 if(category==="student_grades"){
  const [task,person,member]=await Promise.all([
   get("assessments/"+row.taskId),get("people/"+row.personId),get("memberships/"+row.studentUid)
  ]);
  if(!task.exists||!person.exists)
   throw Error("Published grade "+row.id+" requires its assessment and person.");
  if(!member.exists||member.data().status!=="active"||
     !Array.isArray(member.data().roles)||!member.data().roles.includes("student")||
     member.data().personId!==row.personId)
   throw Error("Published grade "+row.id+" requires separately restored active student membership.");
  if(person.data().authUid&&person.data().authUid!==row.studentUid)
   throw Error("Published grade "+row.id+" does not match the restored person/Auth linkage.");
 }
}
async function inspectRecord(db,auth,approved,category,row){
 const ref=db.doc(exactTargetPath(approved.schoolId,category,row)),current=await ref.get();
 if(current.exists){
  return {category,recordId:row.id,targetPath:ref.path,
   state:JSON.stringify(comparable(category,current.data()))===
    JSON.stringify(comparable(category,row))?"identical":"target_conflict"};
 }
 try{
  if(category==="people")await ensurePersonAuth(auth,row);
  await ensureDependencies(db,approved,category,row);
  return {category,recordId:row.id,targetPath:ref.path,state:"ready"};
 }catch(error){
  return {category,recordId:row.id,targetPath:ref.path,
   state:"dependency_blocked",message:error.message};
 }
}
async function inspect(db,auth,approved,bundle){
 const school=await db.doc("platform_schools/"+approved.schoolId).get(),rows=[];
 if(!school.exists||!["draft","active","suspended"].includes(school.data().state))
  rows.push({state:"target_school_missing_or_unavailable",schoolId:approved.schoolId});
 for(const category of approved.categories)
  for(const row of bundle.categories[category])
   rows.push(await inspectRecord(db,auth,approved,category,row));
 return rows;
}
async function createRecord(db,auth,approved,category,row){
 if(category==="people")await ensurePersonAuth(auth,row);
 await ensureDependencies(db,approved,category,row);
 const ref=db.doc(exactTargetPath(approved.schoolId,category,row)),
  data=inflate(category,row,approved);
 return db.runTransaction(async tx=>{
  const current=await tx.get(ref);
  if(current.exists){
   if(JSON.stringify(comparable(category,current.data()))===
      JSON.stringify(comparable(category,row)))return "identical";
   throw Error("Continuity restore target changed after preflight: "+ref.path);
  }
  const now=FieldValue.serverTimestamp();
  tx.create(ref,{...data,continuityRestore:{...data.continuityRestore,restoredAt:now}});
  tx.create(db.collection("schools/"+approved.schoolId+"/continuity_restore_audit").doc(),{
   schoolId:approved.schoolId,category,recordId:row.id,targetPath:ref.path,
   exportSha256:approved.exportSha256,planSha256:approved.planSha256,
   approvedBy:approved.approvedBy,action:"continuity_record_restored",
   notificationsSuppressed:true,createdAt:now
  });
  return "created";
 });
}
function workItems(approved,bundle){
 return approved.categories.flatMap(category=>
  bundle.categories[category].map(row=>({category,row})));
}
async function applyRestore(db,auth,approved,bundle,{apply=false,maxWrites=100}={}){
 const checked=await inspect(db,auth,approved,bundle),
  blockers=checked.filter(row=>!["ready","identical"].includes(row.state)),
  work=workItems(approved,bundle);
 const receipt={
  schema:RECEIPT_SCHEMA,schoolId:approved.schoolId,
  scope:"school_continuity_restore_only",exportSha256:approved.exportSha256,
  planSha256:approved.planSha256,mode:apply?"apply":"preflight",
  generatedAt:new Date().toISOString(),approvedCategories:approved.categories,
  membershipsRestored:0,rolesGranted:0,notificationsSent:false,
  blocked:!!blockers.length,blockers,created:0,identical:0,
  processed:0,remaining:work.length,complete:false
 };
 if(blockers.length||!apply)return receipt;
 let writes=0;
 for(const item of work){
  if(writes>=maxWrites)break;
  const result=await createRecord(db,auth,approved,item.category,item.row);
  receipt.processed++;
  if(result==="created"){receipt.created++;writes++;}else receipt.identical++;
 }
 const after=await inspect(db,auth,approved,bundle);
 receipt.remaining=after.filter(row=>row.state==="ready").length;
 receipt.complete=after.every(row=>row.state==="identical");
 return receipt;
}
async function main(){
 const args=process.argv.slice(2),apply=args.includes("--apply"),
  exportFile=load(arg(args,"export"),"Continuity export"),
  planFile=load(arg(args,"plan"),"Restore plan"),
  approvalFile=load(arg(args,"approval"),"Restore approval"),
  receiptPath=arg(args,"receipt"),maxWrites=intArg(args,"max-writes",100);
 if(apply&&process.env.ADMINERVA_SCHOOL_CONTINUITY_RESTORE_WRITE!==WRITE_ACK)
  throw Error("Write mode requires the exact ADMINERVA_SCHOOL_CONTINUITY_RESTORE_WRITE acknowledgement.");
 const verified=verifyBundle(exportFile.data),plan=validatePlan(planFile.data);
 if(verified.schoolId!==plan.schoolId||verified.digest!==plan.exportSha256)
  throw Error("Restore plan belongs to another continuity export.");
 const approved=validateApproval(plan,planFile.raw,approvalFile.data);
 if(!getApps().length)initializeApp({credential:applicationDefault()});
 const receipt=await applyRestore(getFirestore(),getAuth(),approved,exportFile.data,{apply,maxWrites});
 writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+"\n",{flag:"wx",mode:0o600});
 console.info(JSON.stringify({mode:receipt.mode,schoolId:receipt.schoolId,
  blocked:receipt.blocked,created:receipt.created,identical:receipt.identical,
  remaining:receipt.remaining,complete:receipt.complete,
  membershipsRestored:0,rolesGranted:0,notificationsSent:false}));
 if(receipt.blocked)process.exitCode=2;
}
if(require.main===module)main().catch(error=>{
 console.error("School continuity restore apply failed:",error.message);process.exitCode=1;
});
module.exports={WRITE_ACK,RECEIPT_SCHEMA,validatePlan,validateApproval,convertValue,
 inflate,ensureDependencies,inspectRecord,inspect,workItems,applyRestore};
