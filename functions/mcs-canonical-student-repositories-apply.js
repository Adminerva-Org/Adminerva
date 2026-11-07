"use strict";
/**
 * Controlled create-only MCS student repository configuration migration.
 * Default mode is preflight. OAuth tokens are never copied or accepted.
 */
const {initializeApp,getApps,applicationDefault}=require("firebase-admin/app");
const {getFirestore,FieldValue}=require("firebase-admin/firestore");
const {readFileSync,writeFileSync}=require("node:fs");
const {createHash}=require("node:crypto");
const {SCHEMA:PLAN_SCHEMA}=require("./mcs-canonical-student-repositories-plan.js");
const {APPROVAL_SCHEMA}=require("./mcs-canonical-student-repositories-approval-template.js");
const {SCHOOL_ID}=require("./mcs-canonical-foundation-plan.js");
const {rowKey}=require("./school-academics.js");
const {repository,username}=require("./school-student-profile.js");

const WRITE_ACK="YES_I_APPROVE_MCS_CANONICAL_STUDENT_REPOSITORIES";
const RECEIPT_SCHEMA="adminerva-v4-mcs-canonical-student-repositories-receipt-v1";
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
  throw Error("Use a current MCS student repository plan.");
 return plan;
}
function validateApproval(plan,raw,approval){
 if(!approval||approval.schema!==APPROVAL_SCHEMA||approval.schoolId!==SCHOOL_ID||
    approval.scope!=="canonical_student_repositories_only")
  throw Error("Approval does not authorize MCS student repository migration.");
 const planSha256=sha(raw);
 if(approval.planSha256!==planSha256)
  throw Error("Approval belongs to a different student repository plan.");
 if(typeof approval.approvedBy!=="string"||approval.approvedBy.trim().length<3||
    typeof approval.approvedAt!=="string"||!Number.isFinite(Date.parse(approval.approvedAt)))
  throw Error("Approval must identify the reviewer and timestamp.");
 for(const key of ["repositoryUrlsReviewed","offeringMappingsReviewed",
   "multiOfferingReplicationReviewed","legacyOauthTokensExcluded",
   "noOauthCredentialMigration","activeStudentAccessReviewed",
   "noMigrationNotifications","backupsAndRollbackReviewed"])
  if(approval.acknowledgements?.[key]!==true)
   throw Error("Missing approval acknowledgement: "+key);
 if((approval.unresolvedBlockers||[]).length)
  throw Error("Resolve every student repository migration blocker before apply.");
 if((approval.reviewItems||[]).some(item=>item.resolved!==true))
  throw Error("Resolve every student repository migration review item before apply.");
 const candidates=plan.candidates||[],reviews=approval.repositories||[];
 if(reviews.length!==candidates.length)
  throw Error("Approval repository count differs from the bound plan.");
 const planned=new Map(candidates.map(row=>[row.configId,row])),approved=[];
 for(const review of reviews){
  const row=planned.get(review.configId);
  if(!row||row.studentUid!==review.studentUid||row.personId!==review.personId||
     row.offeringId!==review.offeringId||row.repository!==review.repository)
   throw Error("Approval contains a repository mapping not present in the bound plan.");
  if(!["approve","exclude"].includes(review.decision))
   throw Error("Every student repository mapping requires approve or exclude.");
  if(review.decision==="exclude"){
   const reason=String(review.exclusionReason||"").trim();
   if(reason.length<12||reason.length>1000)
    throw Error("Excluded repository mappings require a 12–1,000 character reason.");
  }else approved.push(row);
 }
 return {planSha256,repositories:approved};
}
function migration(approved,key){
 return {source:"mcs_legacy_v3",planSha256:approved.planSha256,
  type:"student_repository_config",key};
}
function same(data,approved,row){
 return data?.schoolId===SCHOOL_ID&&data?.personId===row.personId&&
  data?.studentUid===row.studentUid&&data?.offeringId===row.offeringId&&
  data?.repository===row.repository&&data?.repositoryUrl===row.repositoryUrl&&
  String(data?.githubUsername||"")===String(row.githubUsername||"")&&
  data?.migration?.planSha256===approved.planSha256&&
  data?.migration?.type==="student_repository_config"&&
  data?.migration?.key===row.configId;
}
function validateCandidate(row){
 if(row.configId!==rowKey(row.personId,row.offeringId))
  throw Error("Student repository runtime key does not match the approved person/offering pair.");
 if(row.targetPath!=="schools/"+SCHOOL_ID+"/student_repository_configs/"+row.configId)
  throw Error("Student repository target path is outside the canonical school namespace.");
 const parsed=repository(row.repositoryUrl);
 if(parsed.repository!==row.repository||parsed.url!==row.repositoryUrl)
  throw Error("Approved repository URL no longer matches the runtime normalization.");
 if(username(row.githubUsername)!==String(row.githubUsername||""))
  throw Error("Approved GitHub username no longer matches the runtime normalization.");
 if(row.source?.legacyTokenPresent&&row.legacyToken)
  throw Error("Legacy OAuth credentials cannot appear in the canonical repository candidate.");
}
async function inspectRow(db,approved,row){
 try{validateCandidate(row);}catch(error){
  return {configId:row.configId,targetPath:row.targetPath,state:"candidate_integrity_error",message:error.message};
 }
 const prefix="schools/"+SCHOOL_ID+"/",enrollmentId=rowKey(row.personId,row.offeringId);
 const [school,current,person,member,enrollment,offering]=await Promise.all([
  db.doc("platform_schools/"+SCHOOL_ID).get(),
  db.doc(row.targetPath).get(),
  db.doc(prefix+"people/"+row.personId).get(),
  db.doc(prefix+"memberships/"+row.studentUid).get(),
  db.doc(prefix+"enrollments/"+enrollmentId).get(),
  db.doc(prefix+"course_offerings/"+row.offeringId).get()
 ]);
 if(!school.exists||!["draft","active"].includes(school.data().state))
  return {configId:row.configId,targetPath:row.targetPath,state:"school_missing_or_unavailable"};
 if(!person.exists||person.data().schoolId!==SCHOOL_ID||person.data().kind!=="student"||
    person.data().status!=="active"||person.data().authUid!==row.studentUid)
  return {configId:row.configId,targetPath:row.targetPath,state:"student_person_mismatch"};
 if(!member.exists||member.data().schoolId!==SCHOOL_ID||member.data().status!=="active"||
    !member.data().roles?.includes("student")||member.data().personId!==row.personId)
  return {configId:row.configId,targetPath:row.targetPath,state:"student_membership_mismatch"};
 if(!enrollment.exists||enrollment.data().schoolId!==SCHOOL_ID||
    enrollment.data().status!=="active"||enrollment.data().personId!==row.personId||
    enrollment.data().offeringId!==row.offeringId)
  return {configId:row.configId,targetPath:row.targetPath,state:"active_enrollment_missing"};
 if(!offering.exists||offering.data().schoolId!==SCHOOL_ID||offering.data().status!=="active")
  return {configId:row.configId,targetPath:row.targetPath,state:"active_offering_missing"};
 return {configId:row.configId,targetPath:row.targetPath,
  state:!current.exists?"ready":same(current.data(),approved,row)?"already_applied":"target_conflict"};
}
async function inspect(db,approved){
 const rows=[];
 for(const row of approved.repositories)rows.push(await inspectRow(db,approved,row));
 return rows;
}
async function createConfig(db,approved,row){
 validateCandidate(row);
 const prefix="schools/"+SCHOOL_ID+"/",ref=db.doc(row.targetPath),
  enrollmentRef=db.doc(prefix+"enrollments/"+rowKey(row.personId,row.offeringId));
 return db.runTransaction(async tx=>{
  const [school,current,person,member,enrollment,offering]=await Promise.all([
   tx.get(db.doc("platform_schools/"+SCHOOL_ID)),tx.get(ref),
   tx.get(db.doc(prefix+"people/"+row.personId)),
   tx.get(db.doc(prefix+"memberships/"+row.studentUid)),
   tx.get(enrollmentRef),tx.get(db.doc(prefix+"course_offerings/"+row.offeringId))
  ]);
  if(current.exists){
   if(same(current.data(),approved,row))return "already_applied";
   throw Error("Student repository target changed after preflight.");
  }
  if(!school.exists||!["draft","active"].includes(school.data().state))
   throw Error("MCS school is unavailable.");
  if(!person.exists||person.data().kind!=="student"||person.data().status!=="active"||
     person.data().authUid!==row.studentUid||
     !member.exists||member.data().status!=="active"||!member.data().roles?.includes("student")||
     member.data().personId!==row.personId)
   throw Error("Student identity changed after repository approval.");
  if(!enrollment.exists||enrollment.data().status!=="active"||
     enrollment.data().personId!==row.personId||enrollment.data().offeringId!==row.offeringId||
     !offering.exists||offering.data().schoolId!==SCHOOL_ID||offering.data().status!=="active")
   throw Error("Student course access changed after repository approval.");
  const now=FieldValue.serverTimestamp();
  tx.create(ref,{schoolId:SCHOOL_ID,personId:row.personId,studentUid:row.studentUid,
   offeringId:row.offeringId,repository:row.repository,repositoryUrl:row.repositoryUrl,
   githubUsername:String(row.githubUsername||""),revision:1,createdByUid:"migration",
   createdAt:now,updatedAt:now,migration:migration(approved,row.configId)});
  tx.create(db.collection(prefix+"student_profile_audit").doc(),{
   schoolId:SCHOOL_ID,actorUid:"migration",personId:row.personId,studentUid:row.studentUid,
   offeringId:row.offeringId,action:"mcs_student_repository_configuration_migrated",
   repository:row.repository,planSha256:approved.planSha256,
   oauthTokenMigrated:false,notificationsSuppressed:true,createdAt:now
  });
  return "created";
 });
}
async function applyRepositories(db,approved,{apply=false,maxUnits=50}={}){
 const checked=await inspect(db,approved),
  blockers=checked.filter(row=>!["ready","already_applied"].includes(row.state)),
  receipt={schema:RECEIPT_SCHEMA,schoolId:SCHOOL_ID,scope:"canonical_student_repositories_only",
   planSha256:approved.planSha256,mode:apply?"apply":"preflight",generatedAt:new Date().toISOString(),
   approvedRepositories:approved.repositories.length,blocked:!!blockers.length,blockers,
   created:0,alreadyApplied:0,processedUnits:0,remainingUnits:approved.repositories.length,
   complete:false,oauthTokensMigrated:false,notificationsSent:false};
 if(blockers.length||!apply)return receipt;
 let newWrites=0;
 for(const row of approved.repositories){
  if(newWrites>=maxUnits)break;
  const result=await createConfig(db,approved,row);receipt.processedUnits++;
  if(result==="created"){receipt.created++;newWrites++;}else receipt.alreadyApplied++;
 }
 receipt.remainingUnits=Math.max(0,approved.repositories.length-receipt.processedUnits);
 receipt.complete=receipt.remainingUnits===0;
 return receipt;
}
async function main(){
 const args=process.argv.slice(2),apply=args.includes("--apply"),
  planPath=arg(args,"plan"),approvalPath=arg(args,"approval"),
  receiptPath=arg(args,"receipt"),maxUnits=intArg(args,"max-units",50);
 if(apply&&process.env.ADMINERVA_MCS_STUDENT_REPOSITORY_WRITE!==WRITE_ACK)
  throw Error("Write mode requires the exact ADMINERVA_MCS_STUDENT_REPOSITORY_WRITE acknowledgement.");
 const planFile=load(planPath,"Plan"),approvalFile=load(approvalPath,"Approval"),
  approved=validateApproval(validatePlan(planFile.data),planFile.raw,approvalFile.data);
 if(!getApps().length)initializeApp({credential:applicationDefault()});
 const receipt=await applyRepositories(getFirestore(),approved,{apply,maxUnits});
 writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+"\n",{flag:"wx",mode:0o600});
 console.info(JSON.stringify({mode:receipt.mode,blocked:receipt.blocked,
  created:receipt.created,alreadyApplied:receipt.alreadyApplied,
  remainingUnits:receipt.remainingUnits,complete:receipt.complete,
  oauthTokensMigrated:false,notificationsSent:false}));
 if(receipt.blocked)process.exitCode=2;
}
if(require.main===module)main().catch(error=>{
 console.error("MCS student repository apply failed:",error.code||error.message);
 process.exitCode=1;
});
module.exports={WRITE_ACK,RECEIPT_SCHEMA,validatePlan,validateApproval,
 validateCandidate,inspectRow,inspect,applyRepositories};
