"use strict";
/**
 * Controlled resumable MCS Practice migration.
 *
 * Default is preflight. Per-student migration markers remain in_progress while
 * durable progress is being created. A later reconciliation pass marks the
 * student complete only after every expected target is present and bound to
 * this exact approved plan.
 */
const {initializeApp,getApps,applicationDefault}=require("firebase-admin/app");
const {getFirestore,FieldValue,Timestamp}=require("firebase-admin/firestore");
const {readFileSync,writeFileSync}=require("node:fs");
const {createHash}=require("node:crypto");
const {SCHEMA:PLAN_SCHEMA,canonicalAlias,canonicalPublicId}=
 require("./mcs-canonical-practice-plan.js");
const {APPROVAL_SCHEMA}=require("./mcs-canonical-practice-approval-template.js");
const {SCHOOL_ID}=require("./mcs-canonical-foundation-plan.js");
const {schoolPracticeClassRankId}=require("./school-practice-season-service.js");

const WRITE_ACK="YES_I_APPROVE_MCS_CANONICAL_PRACTICE";
const RECEIPT_SCHEMA="adminerva-v4-mcs-canonical-practice-receipt-v1";
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
 if(raw===undefined)return fallback;const value=Number(raw);
 if(!Number.isInteger(value)||value<min||value>max)
  throw Error("--"+name+" must be "+min+"-"+max+".");
 return value;
}
function validatePlan(plan){
 if(!plan||plan.schema!==PLAN_SCHEMA||plan.schoolId!==SCHOOL_ID||
    plan.readOnly!==true||plan.readyForApply!==false)
  throw Error("Use a current MCS canonical Practice plan.");
 return plan;
}
function validateApproval(plan,raw,approval){
 if(!approval||approval.schema!==APPROVAL_SCHEMA||approval.schoolId!==SCHOOL_ID||
    approval.scope!=="canonical_practice_only")
  throw Error("Approval does not authorize canonical MCS Practice migration.");
 const planSha256=sha(raw);
 if(approval.planSha256!==planSha256)
  throw Error("Approval belongs to a different Practice plan.");
 if(typeof approval.approvedBy!=="string"||approval.approvedBy.trim().length<3||
    typeof approval.approvedAt!=="string"||!Number.isFinite(Date.parse(approval.approvedAt)))
  throw Error("Approval must identify the reviewer and timestamp.");
 for(const key of ["verifiedProgressReviewed","currentSeasonScoreReviewed",
   "awardsAndMissionStateReconciled","courseProgressReconciled",
   "activeClassRankingsReviewed","historicalSeasonArchiveReviewed",
   "legacyPublicConsentResetReviewed","ephemeralLegacyDataRetentionReviewed",
   "noMigrationNotifications","backupsAndRollbackReviewed"])
  if(approval.acknowledgements?.[key]!==true)
   throw Error("Missing approval acknowledgement: "+key);
 if((approval.unresolvedBlockers||[]).length)
  throw Error("Resolve every Practice migration blocker before apply.");
 if((approval.reviewItems||[]).some(item=>item.resolved!==true))
  throw Error("Resolve every Practice migration review item before apply.");
 if((approval.students||[]).length!==(plan.students||[]).length)
  throw Error("Approval student count differs from the bound Practice plan.");
 const planned=new Map((plan.students||[]).map(row=>[row.uid,row])),students=[];
 for(const review of approval.students||[]){
  const row=planned.get(review.uid);
  if(!row||row.personId!==review.personId)
   throw Error("Approval contains a Practice student not present in the bound plan.");
  if(!["approve","exclude"].includes(review.decision))
   throw Error("Every Practice student requires an explicit approve or exclude decision.");
  if(review.decision==="exclude"){
   const reason=String(review.exclusionReason||"").trim();
   if(reason.length<12||reason.length>1000)
    throw Error("Excluded Practice students require a 12–1,000 character reason.");
  }else students.push(row);
 }
 return {planSha256,currentSeason:plan.currentSeason,students};
}
function migration(approved,type,key){
 return {source:"mcs_legacy_v3",planSha256:approved.planSha256,type,key};
}
function same(data,approved,type,key){
 return data?.schoolId===SCHOOL_ID&&data?.migration?.planSha256===approved.planSha256&&
  data?.migration?.type===type&&data?.migration?.key===key;
}
function timestampMillis(value){
 return Number.isFinite(Number(value))&&Number(value)>0?Timestamp.fromMillis(Number(value)):null;
}
function validateVerified(row,student){
 if(row.schoolId!==SCHOOL_ID||row.ownerUid!==student.uid||row.personId!==student.personId||
    !Array.isArray(row.completed)||!row.targetPath.endsWith("/"+row.courseId))
  throw Error("Verified Practice progress candidate identity is invalid.");
 if(row.completed.some(value=>typeof value!=="string"||!value))
  throw Error("Verified Practice completed mission IDs are invalid.");
}
function validateCurrent(current,student,season){
 if(!current)return;
 const score=current.score;
 if(score.schoolId!==SCHOOL_ID||score.ownerUid!==student.uid||score.personId!==student.personId||
    score.season!==season||score.optIn!==false||
    score.alias!==canonicalAlias(student.uid)||score.publicId!==canonicalPublicId(student.uid)||
    !Number.isFinite(score.points)||score.points<0||
    !Number.isInteger(score.completedCount)||score.completedCount<0)
  throw Error("Current Practice score candidate violates the canonical privacy/identity contract.");
 const awards=current.awards||[],states=current.missionStates||[],courses=current.courses||[],
  awardKeys=new Set(),awardPoints=new Map();
 for(const award of awards){
  const key=season+"_"+award.missionId;
  if(award.schoolId!==SCHOOL_ID||award.ownerUid!==student.uid||award.personId!==student.personId||
     award.season!==season||!award.courseId||!award.missionId||
     !Number.isFinite(award.points)||award.points<0||awardKeys.has(key))
   throw Error("Practice award candidate is invalid or duplicated.");
  awardKeys.add(key);awardPoints.set(key,award.points);
 }
 const stateByKey=new Map();
 for(const state of states){
  if(state.schoolId!==SCHOOL_ID||state.ownerUid!==student.uid||state.personId!==student.personId||
     state.season!==season||!state.missionId)
   throw Error("Practice mission-state candidate identity is invalid.");
  stateByKey.set(season+"_"+state.missionId,state);
 }
 for(const [key,points] of awardPoints){
  const state=stateByKey.get(key);
  if(!state||state.completed!==true||Number(state.earnedPoints)!==points)
   throw Error("Practice award no longer reconciles with mission state.");
 }
 const progressByCourse=new Map(courses.map(row=>[row.courseId,row]));
 for(const award of awards){
  const progress=progressByCourse.get(award.courseId);
  if(!progress||!progress.completed.includes(award.missionId)||
     Number(progress.missionScores?.[award.missionId])!==award.points)
   throw Error("Practice award no longer reconciles with course progress.");
 }
 const total=awards.reduce((sum,row)=>sum+row.points,0);
 if(Math.abs(total-score.points)>0.000001||awards.length!==score.completedCount)
  throw Error("Practice score no longer reconciles with immutable awards.");
 for(const ranking of current.classRankings||[]){
  if(ranking.id!==schoolPracticeClassRankId(ranking.sectionId,student.uid)||
     ranking.ownerUid!==student.uid||ranking.personId!==student.personId||
     ranking.alias!==score.alias||ranking.points!==score.points||
     ranking.completedCount!==score.completedCount||ranking.season!==season)
   throw Error("Practice class leaderboard row is inconsistent with the canonical score.");
 }
}
function validateHistory(history,student,currentSeason){
 if(!history)return;
 if(history.schoolId!==SCHOOL_ID||history.ownerUid!==student.uid||
    history.personId!==student.personId||!history.season||history.season===currentSeason)
  throw Error("Historical Practice season archive candidate is invalid.");
 const ids=new Set();
 for(const group of ["missionStates","awards","courses"])
  for(const row of history[group]||[]){
   if(!row.id||!row.targetPath||ids.has(group+"|"+row.id))
    throw Error("Historical Practice archive contains an invalid duplicate row.");
   ids.add(group+"|"+row.id);
  }
}
function validateStudent(student,approved){
 if(typeof student.uid!=="string"||!student.uid||typeof student.personId!=="string"||!student.personId)
  throw Error("Practice student identity is invalid.");
 for(const row of student.verifiedProgress||[])validateVerified(row,student);
 validateCurrent(student.currentSeason,student,approved.currentSeason);
 validateHistory(student.historicalSeason,student,approved.currentSeason);
}
function target(type,key,path,data){
 return {type,key,path,data};
}
function flattenStudent(student,approved){
 validateStudent(student,approved);
 const targets=[];
 for(const row of student.verifiedProgress||[])targets.push(target(
  "practice_verified_progress",row.courseId,row.targetPath,{
   schoolId:SCHOOL_ID,ownerUid:student.uid,personId:student.personId,
   completed:row.completed,reflections:row.reflections||{},
   migration:{...migration(approved,"practice_verified_progress",row.courseId),
    sourcePath:row.migration?.sourcePath}
  }));
 const current=student.currentSeason;
 if(current){
  const score=current.score;
  targets.push(target("practice_season_score",student.uid,score.targetPath,{
   schoolId:SCHOOL_ID,ownerUid:student.uid,personId:student.personId,
   season:score.season,alias:score.alias,optIn:false,points:score.points,
   completedCount:score.completedCount,publicId:score.publicId,
   migration:{...migration(approved,"practice_season_score",student.uid),
    sourcePath:score.migration?.sourcePath,legacyAlias:score.migration?.legacyAlias||"",
    legacyOptIn:Boolean(score.migration?.legacyOptIn)}
  }));
  for(const row of current.missionStates||[])targets.push(target(
   "practice_mission_state",row.id,row.targetPath,{
    schoolId:SCHOOL_ID,ownerUid:student.uid,personId:student.personId,
    season:row.season,courseId:row.courseId,missionId:row.missionId,
    wrongSubmissions:row.wrongSubmissions,completed:row.completed,
    earnedPoints:row.earnedPoints,
    migration:{...migration(approved,"practice_mission_state",row.id),
     sourcePath:row.migration?.sourcePath}
   }));
  for(const row of current.awards||[])targets.push(target(
   "practice_season_award",row.id,row.targetPath,{
    schoolId:SCHOOL_ID,ownerUid:student.uid,personId:student.personId,
    season:row.season,courseId:row.courseId,missionId:row.missionId,
    points:row.points,wrongSubmissions:row.wrongSubmissions,
    migration:{...migration(approved,"practice_season_award",row.id),
     sourcePath:row.migration?.sourcePath}
   }));
  for(const row of current.courses||[])targets.push(target(
   "practice_season_progress",row.id,row.targetPath,{
    schoolId:SCHOOL_ID,ownerUid:student.uid,personId:student.personId,
    season:row.season,courseId:row.courseId,completed:row.completed,
    missionScores:row.missionScores||{},
    migration:{...migration(approved,"practice_season_progress",row.id),
     sourcePath:row.migration?.sourcePath}
   }));
  for(const row of current.classRankings||[])targets.push(target(
   "practice_class_season_ranking",row.id,row.targetPath,{
    schoolId:SCHOOL_ID,ownerUid:student.uid,personId:student.personId,
    sectionId:row.sectionId,alias:row.alias,points:row.points,
    completedCount:row.completedCount,season:row.season,
    migration:migration(approved,"practice_class_season_ranking",row.id)
   }));
 }
 const history=student.historicalSeason;
 if(history){
  targets.push(target("practice_season_history",history.archiveId,history.targetPath,{
   schoolId:SCHOOL_ID,ownerUid:student.uid,personId:student.personId,
   season:history.season,score:history.score,
   migration:{...migration(approved,"practice_season_history",history.archiveId),
    sourcePath:history.migration?.sourcePath}
  }));
  for(const row of history.missionStates||[])targets.push(target(
   "practice_history_mission_state",row.id,row.targetPath,{
    schoolId:SCHOOL_ID,ownerUid:student.uid,personId:student.personId,
    season:row.season,courseId:row.courseId,missionId:row.missionId,
    wrongSubmissions:row.wrongSubmissions,completed:row.completed,
    earnedPoints:row.earnedPoints,legacyLastSubmittedAt:timestampMillis(row.legacyLastSubmittedAt),
    migration:{...migration(approved,"practice_history_mission_state",row.id),
     sourcePath:row.sourcePath}
   }));
  for(const row of history.awards||[])targets.push(target(
   "practice_history_award",row.id,row.targetPath,{
    schoolId:SCHOOL_ID,ownerUid:student.uid,personId:student.personId,
    season:row.season,courseId:row.courseId,missionId:row.missionId,
    points:row.points,wrongSubmissions:row.wrongSubmissions,
    legacyAwardedAt:timestampMillis(row.legacyAwardedAt),
    migration:{...migration(approved,"practice_history_award",row.id),
     sourcePath:row.sourcePath}
   }));
  for(const row of history.courses||[])targets.push(target(
   "practice_history_course",row.id,row.targetPath,{
    schoolId:SCHOOL_ID,ownerUid:student.uid,personId:student.personId,
    season:row.season,courseId:row.courseId,completed:row.completed,
    missionScores:row.missionScores||{},legacyUpdatedAt:timestampMillis(row.legacyUpdatedAt),
    migration:{...migration(approved,"practice_history_course",row.id),
     sourcePath:row.sourcePath}
   }));
 }
 const seen=new Set();
 for(const item of targets){
  if(seen.has(item.path))throw Error("Practice migration plan contains duplicate canonical target paths.");
  seen.add(item.path);
 }
 return targets;
}
async function inspectStudent(db,approved,student){
 let targets;
 try{targets=flattenStudent(student,approved);}
 catch(error){return {uid:student.uid,state:"candidate_integrity_error",
  message:error.message,targets:[],ready:[],same:[]};}
 const prefix="schools/"+SCHOOL_ID+"/",
  [member,person,marker,...snapshots]=await Promise.all([
   db.doc(prefix+"memberships/"+student.uid).get(),
   db.doc(prefix+"people/"+student.personId).get(),
   db.doc(prefix+"practice_migration_state/"+student.uid).get(),
   ...targets.map(item=>db.doc(item.path).get())
  ]);
 if(!member.exists||member.data().schoolId!==SCHOOL_ID||
    !Array.isArray(member.data().roles)||!member.data().roles.includes("student")||
    member.data().personId!==student.personId||
    !person.exists||person.data().schoolId!==SCHOOL_ID||
    person.data().kind!=="student"||person.data().authUid!==student.uid)
  return {uid:student.uid,state:"student_identity_mismatch",targets,ready:[],same:[]};
 if(marker.exists&&(marker.data().planSha256!==approved.planSha256||
    !["in_progress","complete"].includes(marker.data().status)))
  return {uid:student.uid,state:"migration_marker_conflict",targets,ready:[],same:[]};
 const ready=[],sameRows=[],conflicts=[];
 targets.forEach((item,index)=>{
  const snap=snapshots[index];
  if(!snap.exists)ready.push(item);
  else if(same(snap.data(),approved,item.type,item.key))sameRows.push(item);
  else conflicts.push(item);
 });
 if(conflicts.length)return {uid:student.uid,state:"target_conflict",targets,
  ready,same:sameRows,conflicts:conflicts.map(item=>item.path)};
 if(marker.exists&&marker.data().status==="complete"&&ready.length)
  return {uid:student.uid,state:"complete_marker_with_missing_targets",targets,ready,same:sameRows};
 return {uid:student.uid,state:ready.length?"ready":"reconciled",
  markerStatus:marker.exists?marker.data().status:null,targets,ready,same:sameRows};
}
async function inspect(db,approved){
 const school=await db.doc("platform_schools/"+SCHOOL_ID).get(),students=[];
 if(!school.exists||!["draft","active"].includes(school.data().state))
  return {schoolState:"school_missing_or_unavailable",students:[]};
 for(const student of approved.students)students.push(await inspectStudent(db,approved,student));
 return {schoolState:"ok",students};
}
async function writeBatch(db,approved,student,items){
 const prefix="schools/"+SCHOOL_ID+"/",markerRef=db.doc(prefix+"practice_migration_state/"+student.uid);
 return db.runTransaction(async tx=>{
  const [member,person,marker,...current]=await Promise.all([
   tx.get(db.doc(prefix+"memberships/"+student.uid)),
   tx.get(db.doc(prefix+"people/"+student.personId)),
   tx.get(markerRef),...items.map(item=>tx.get(db.doc(item.path)))
  ]);
  if(!member.exists||!member.data().roles?.includes("student")||
     member.data().personId!==student.personId||
     !person.exists||person.data().authUid!==student.uid)
   throw Error("Practice student identity changed after preflight.");
  if(marker.exists&&marker.data().planSha256!==approved.planSha256)
   throw Error("Practice migration marker belongs to another plan.");
  const now=FieldValue.serverTimestamp();
  if(!marker.exists)tx.create(markerRef,{
   schoolId:SCHOOL_ID,ownerUid:student.uid,personId:student.personId,
   planSha256:approved.planSha256,status:"in_progress",
   startedAt:now,updatedAt:now
  });
  else if(marker.data().status!=="complete")tx.update(markerRef,{status:"in_progress",updatedAt:now});
  items.forEach((item,index)=>{
   if(current[index].exists){
    if(!same(current[index].data(),approved,item.type,item.key))
     throw Error("Practice target changed after preflight.");
    return;
   }
   tx.create(db.doc(item.path),{...item.data,createdAt:now,updatedAt:now});
  });
  return {written:current.filter(snap=>!snap.exists).length};
 });
}
async function finalizeStudent(db,approved,student){
 const state=await inspectStudent(db,approved,student);
 if(state.state!=="reconciled")
  throw Error("Practice student cannot be finalized until all expected targets reconcile.");
 const markerRef=db.doc("schools/"+SCHOOL_ID+"/practice_migration_state/"+student.uid);
 await db.runTransaction(async tx=>{
  const marker=await tx.get(markerRef),now=FieldValue.serverTimestamp();
  if(marker.exists&&marker.data().planSha256!==approved.planSha256)
   throw Error("Practice migration marker changed before finalization.");
  const data={schoolId:SCHOOL_ID,ownerUid:student.uid,personId:student.personId,
   planSha256:approved.planSha256,status:"complete",
   completedAt:now,updatedAt:now,targetCount:state.targets.length};
  if(marker.exists)tx.update(markerRef,data);else tx.create(markerRef,{...data,startedAt:now});
 });
 return state.targets.length;
}
async function applyPractice(db,approved,{apply=false,maxWrites=150}={}){
 const checked=await inspect(db,approved),
  blockers=checked.schoolState==="ok"?checked.students.filter(row=>
   !["ready","reconciled"].includes(row.state)):
   [{state:checked.schoolState}];
 const receipt={schema:RECEIPT_SCHEMA,schoolId:SCHOOL_ID,scope:"canonical_practice_only",
  planSha256:approved.planSha256,mode:apply?"apply":"preflight",generatedAt:new Date().toISOString(),
  approvedStudents:approved.students.length,blocked:!!blockers.length,blockers,
  createdTargets:0,finalizedStudents:0,remainingTargets:checked.students.reduce((sum,row)=>
   sum+(row.ready?.length||0),0),complete:false,notificationsSent:false,
  publicLeaderboardOptInsCreated:0};
 if(blockers.length||!apply)return receipt;
 let budget=maxWrites;
 for(const student of approved.students){
  if(budget<=0)break;
  const state=await inspectStudent(db,approved,student);
  if(state.state==="reconciled"){
   await finalizeStudent(db,approved,student);receipt.finalizedStudents++;continue;
  }
  if(state.state!=="ready")throw Error("Practice migration state changed after preflight.");
  const batch=state.ready.slice(0,Math.min(budget,150));
  if(batch.length){
   const result=await writeBatch(db,approved,student,batch);
   receipt.createdTargets+=result.written;budget-=result.written;
  }
 }
 const after=await inspect(db,approved);
 receipt.remainingTargets=after.students.reduce((sum,row)=>sum+(row.ready?.length||0),0);
 for(const student of approved.students){
  const state=after.students.find(row=>row.uid===student.uid);
  if(state?.state==="reconciled"&&state.markerStatus!=="complete"&&budget>0){
   await finalizeStudent(db,approved,student);receipt.finalizedStudents++;
  }
 }
 const final=await inspect(db,approved);
 receipt.complete=final.students.every(row=>row.state==="reconciled"&&row.markerStatus==="complete");
 return receipt;
}
async function main(){
 const args=process.argv.slice(2),apply=args.includes("--apply"),
  planPath=arg(args,"plan"),approvalPath=arg(args,"approval"),
  receiptPath=arg(args,"receipt"),maxWrites=intArg(args,"max-writes",150);
 if(apply&&process.env.ADMINERVA_MCS_PRACTICE_WRITE!==WRITE_ACK)
  throw Error("Write mode requires the exact ADMINERVA_MCS_PRACTICE_WRITE acknowledgement.");
 const planFile=load(planPath,"Plan"),approvalFile=load(approvalPath,"Approval");
 const approved=validateApproval(validatePlan(planFile.data),planFile.raw,approvalFile.data);
 if(!getApps().length)initializeApp({credential:applicationDefault()});
 const receipt=await applyPractice(getFirestore(),approved,{apply,maxWrites});
 writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+"\n",{flag:"wx",mode:0o600});
 console.info(JSON.stringify({mode:receipt.mode,blocked:receipt.blocked,
  createdTargets:receipt.createdTargets,finalizedStudents:receipt.finalizedStudents,
  remainingTargets:receipt.remainingTargets,complete:receipt.complete,
  publicLeaderboardOptInsCreated:0,notificationsSent:false}));
 if(receipt.blocked)process.exitCode=2;
}
if(require.main===module)main().catch(error=>{
 console.error("MCS canonical Practice apply failed:",error.code||error.message);
 process.exitCode=1;
});
module.exports={WRITE_ACK,RECEIPT_SCHEMA,validatePlan,validateApproval,validateVerified,
 validateCurrent,validateHistory,validateStudent,flattenStudent,inspectStudent,inspect,
 applyPractice};
