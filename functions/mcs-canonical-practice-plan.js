"use strict";
/**
 * Read-only MCS canonical Practice migration planner.
 *
 * Migrates student-visible durable state only:
 * - pre-season verified progress
 * - current season score, mission states, awards and course progress
 * - class leaderboard rows rebuilt from approved active enrollments
 *
 * Ephemeral attempts/sessions/security events remain in the quarantined legacy
 * mirror. Legacy public leaderboard consent is NOT carried forward.
 */
const {initializeApp,getApps,applicationDefault}=require("firebase-admin/app");
const {getFirestore,FieldPath}=require("firebase-admin/firestore");
const {readFileSync,writeFileSync}=require("node:fs");
const {createHash}=require("node:crypto");
const {SCHOOL_ID}=require("./mcs-canonical-foundation-plan.js");
const {validatePlan:validateFoundationPlan,validateApproval:validateFoundationApproval}=
 require("./mcs-canonical-foundation-apply.js");
const {validatePlan:validateAccessPlan,validateApproval:validateAccessApproval}=
 require("./mcs-canonical-academic-access-apply.js");
const {schoolPracticeClassRankId}=require("./school-practice-season-service.js");

const SCHEMA="adminerva-v4-mcs-canonical-practice-plan-v1";
const sha=value=>createHash("sha256").update(value).digest("hex");
function clean(value,max=5000){return typeof value==="string"?value.trim().slice(0,max):"";}
function number(value,fallback=0){
 const n=Number(value);return Number.isFinite(n)?n:fallback;
}
async function listCollection(db,path,max=5000){
 const rows=[];let cursor=null;
 while(rows.length<max){
  let query=db.collection(path).orderBy(FieldPath.documentId()).limit(Math.min(200,max-rows.length));
  if(cursor)query=query.startAfter(cursor);
  const snap=await query.get();
  for(const doc of snap.docs)rows.push({id:doc.id,path:doc.ref.path,data:doc.data()});
  if(snap.size<200)return rows;
  cursor=snap.docs.at(-1);
 }
 throw Error("Practice migration collection exceeds planner cap: "+path);
}
async function readDoc(db,path){
 const doc=await db.doc(path).get();
 return doc.exists?{id:doc.id,path:doc.ref.path,data:doc.data()}:null;
}
function approvedStudents(foundationPlan,foundationPlanRaw,foundationApproval){
 const approved=validateFoundationApproval(
  validateFoundationPlan(foundationPlan),foundationPlanRaw,foundationApproval);
 const map=new Map();
 for(const member of approved.memberships){
  if(!member.roles.includes("student"))continue;
  const person=approved.people.find(row=>row.uid===member.uid);
  if(person)map.set(member.uid,{
   uid:member.uid,personId:person.personId,membershipStatus:member.status
  });
 }
 return map;
}
function activeSections(accessPlan,accessPlanRaw,accessApproval){
 const approved=validateAccessApproval(
  validateAccessPlan(accessPlan),accessPlanRaw,accessApproval);
 const byPerson=new Map();
 for(const enrollment of approved.enrollments){
  if(enrollment.status!=="active")continue;
  const set=byPerson.get(enrollment.personId)||new Set();
  set.add(enrollment.sectionId);byPerson.set(enrollment.personId,set);
 }
 return byPerson;
}
function canonicalAlias(uid){
 return "Learner-"+sha(SCHOOL_ID+":"+uid).slice(0,7).toUpperCase();
}
function canonicalPublicId(uid){
 return "mcspr_"+sha(SCHOOL_ID+"\0"+uid).slice(0,32);
}
function normalizeVerifiedProgress(row,student){
 const completed=Array.isArray(row.data?.completed)?
  [...new Set(row.data.completed.filter(value=>typeof value==="string"&&value).slice(0,1000))]:[];
 const reflections=row.data?.reflections&&typeof row.data.reflections==="object"&&!Array.isArray(row.data.reflections)?
  row.data.reflections:{};
 return {
  courseId:row.id,targetPath:"schools/"+SCHOOL_ID+
   "/practice_verified_progress/"+student.uid+"/courses/"+row.id,
  schoolId:SCHOOL_ID,ownerUid:student.uid,personId:student.personId,
  completed,reflections,migration:{sourcePath:row.path}
 };
}
function seasonKey(season,missionId){return String(season)+"_"+String(missionId);}
function reconcileCurrentSeason({score,states,awards,progress,currentSeason,student,sections}){
 const blockers=[],reviewItems=[];
 if(!score)return {current:null,blockers,reviewItems};
 const season=clean(score.data?.season,80);
 if(!season)return {current:null,blockers:[{type:"practice_score_season_missing",sourcePath:score.path}],reviewItems};
 if(season!==currentSeason)return {current:null,blockers,reviewItems,historical:true};
 const scorePoints=number(score.data?.points,NaN),completedCount=Number(score.data?.completedCount);
 if(!Number.isFinite(scorePoints)||scorePoints<0||!Number.isInteger(completedCount)||completedCount<0)
  blockers.push({type:"practice_score_invalid",sourcePath:score.path});
 const currentAwards=awards.filter(row=>clean(row.data?.season,80)===season),
  currentStates=states.filter(row=>clean(row.data?.season,80)===season),
  currentProgress=progress.filter(row=>clean(row.data?.season,80)===season);
 const stateMap=new Map(currentStates.map(row=>[seasonKey(season,row.data?.missionId),row])),
  progressByCourse=new Map(currentProgress.map(row=>[clean(row.data?.courseId,128),row]));
 const awardMissions=new Set(),awardPoints=[];
 for(const award of currentAwards){
  const courseId=clean(award.data?.courseId,128),missionId=clean(award.data?.missionId,128),
   points=number(award.data?.points,NaN),key=seasonKey(season,missionId);
  if(!courseId||!missionId||!Number.isFinite(points)||points<0||awardMissions.has(key)){
   blockers.push({type:"practice_award_invalid_or_duplicate",sourcePath:award.path});continue;
  }
  awardMissions.add(key);awardPoints.push(points);
  const state=stateMap.get(key);
  if(!state||state.data?.completed!==true||number(state.data?.earnedPoints,NaN)!==points)
   blockers.push({type:"practice_award_state_mismatch",sourcePath:award.path,missionId});
  const course=progressByCourse.get(courseId),
   completed=Array.isArray(course?.data?.completed)?course.data.completed:[],
   missionScores=course?.data?.missionScores&&typeof course.data.missionScores==="object"?
    course.data.missionScores:{};
  if(!course||!completed.includes(missionId)||number(missionScores[missionId],NaN)!==points)
   blockers.push({type:"practice_award_progress_mismatch",sourcePath:award.path,courseId,missionId});
 }
 const awardedTotal=awardPoints.reduce((sum,value)=>sum+value,0);
 if(Number.isFinite(scorePoints)&&Math.abs(scorePoints-awardedTotal)>0.000001)
  blockers.push({type:"practice_score_points_mismatch",sourcePath:score.path,
   scorePoints,awardPoints:awardedTotal});
 if(Number.isInteger(completedCount)&&completedCount!==currentAwards.length)
  blockers.push({type:"practice_score_completion_count_mismatch",sourcePath:score.path,
   completedCount,awardCount:currentAwards.length});
 for(const state of currentStates){
  if(state.data?.completed===true&&!awardMissions.has(seasonKey(season,state.data?.missionId)))
   blockers.push({type:"practice_completed_state_without_award",sourcePath:state.path});
 }
 for(const course of currentProgress){
  const completed=Array.isArray(course.data?.completed)?course.data.completed:[],
   courseId=clean(course.data?.courseId,128);
  for(const missionId of completed)
   if(typeof missionId==="string"&&!awardMissions.has(seasonKey(season,missionId)))
    blockers.push({type:"practice_progress_without_award",sourcePath:course.path,courseId,missionId});
 }
 if(score.data?.optIn===true)reviewItems.push({
  type:"practice_legacy_public_opt_in_not_carried_forward",uid:student.uid,
  legacyAlias:clean(score.data?.alias,24),
  resolution:"New school leaderboard starts opted out. Preserve the old preference only as migration provenance."
 });
 const alias=canonicalAlias(student.uid),publicId=canonicalPublicId(student.uid);
 const scoreTarget={
  targetPath:"schools/"+SCHOOL_ID+"/practice_season_scores/"+student.uid,
  schoolId:SCHOOL_ID,ownerUid:student.uid,personId:student.personId,season,
  alias,optIn:false,points:scorePoints,completedCount,publicId,
  migration:{sourcePath:score.path,legacyAlias:clean(score.data?.alias,24),
   legacyOptIn:score.data?.optIn===true}
 };
 const missionStates=currentStates.map(row=>({
  id:row.id,targetPath:"schools/"+SCHOOL_ID+"/practice_season_scores/"+student.uid+
   "/mission_state/"+row.id,schoolId:SCHOOL_ID,ownerUid:student.uid,personId:student.personId,
  season,courseId:clean(row.data?.courseId,128),missionId:clean(row.data?.missionId,128),
  wrongSubmissions:Math.max(0,Number(row.data?.wrongSubmissions)||0),
  completed:row.data?.completed===true,earnedPoints:Math.max(0,number(row.data?.earnedPoints,0)),
  migration:{sourcePath:row.path}
 }));
 const awardRows=currentAwards.map(row=>({
  id:row.id,targetPath:"schools/"+SCHOOL_ID+"/practice_season_awards/"+student.uid+
   "/missions/"+row.id,schoolId:SCHOOL_ID,ownerUid:student.uid,personId:student.personId,
  season,courseId:clean(row.data?.courseId,128),missionId:clean(row.data?.missionId,128),
  points:Math.max(0,number(row.data?.points,0)),
  wrongSubmissions:Math.max(0,Number(row.data?.wrongSubmissions)||0),
  migration:{sourcePath:row.path}
 }));
 const courseRows=currentProgress.map(row=>({
  id:row.id,targetPath:"schools/"+SCHOOL_ID+"/practice_season_progress/"+student.uid+
   "/courses/"+row.id,schoolId:SCHOOL_ID,ownerUid:student.uid,personId:student.personId,
  season,courseId:clean(row.data?.courseId,128),
  completed:Array.isArray(row.data?.completed)?[...new Set(row.data.completed.filter(value=>typeof value==="string"&&value))]:[],
  missionScores:row.data?.missionScores&&typeof row.data.missionScores==="object"&&!Array.isArray(row.data.missionScores)?
   row.data.missionScores:{},migration:{sourcePath:row.path}
 }));
 const classRankings=[...sections].map(sectionId=>({
  sectionId,id:schoolPracticeClassRankId(sectionId,student.uid),
  targetPath:"schools/"+SCHOOL_ID+"/practice_class_season_rankings/"+
   schoolPracticeClassRankId(sectionId,student.uid),
  schoolId:SCHOOL_ID,ownerUid:student.uid,personId:student.personId,
  alias,points:scorePoints,completedCount,season
 }));
 return {current:{score:scoreTarget,missionStates,awards:awardRows,
  courses:courseRows,classRankings},blockers,reviewItems};
}
function legacyMillis(value){
 return value?.toMillis?.()||0;
}
function historicalSeasonArchive({score,states,awards,progress,student,currentSeason}){
 if(!score)return null;
 const season=clean(score.data?.season,80);
 if(!season||season===currentSeason)return null;
 const archiveId="season_"+sha(season).slice(0,24),
  base="schools/"+SCHOOL_ID+"/practice_season_history/"+student.uid+"/seasons/"+archiveId;
 return {
  archiveId,season,targetPath:base,
  schoolId:SCHOOL_ID,ownerUid:student.uid,personId:student.personId,
  score:{points:number(score.data?.points,0),completedCount:Number(score.data?.completedCount)||0,
   legacyAlias:clean(score.data?.alias,24),legacyOptIn:score.data?.optIn===true,
   legacyUpdatedAt:legacyMillis(score.data?.updatedAt)},
  missionStates:states.filter(row=>clean(row.data?.season,80)===season).map(row=>({
   id:row.id,targetPath:base+"/mission_state/"+row.id,
   season,courseId:clean(row.data?.courseId,128),missionId:clean(row.data?.missionId,128),
   wrongSubmissions:Math.max(0,Number(row.data?.wrongSubmissions)||0),
   completed:row.data?.completed===true,earnedPoints:Math.max(0,number(row.data?.earnedPoints,0)),
   legacyLastSubmittedAt:legacyMillis(row.data?.lastSubmittedAt),sourcePath:row.path
  })),
  awards:awards.filter(row=>clean(row.data?.season,80)===season).map(row=>({
   id:row.id,targetPath:base+"/awards/"+row.id,
   season,courseId:clean(row.data?.courseId,128),missionId:clean(row.data?.missionId,128),
   points:Math.max(0,number(row.data?.points,0)),
   wrongSubmissions:Math.max(0,Number(row.data?.wrongSubmissions)||0),
   legacyAwardedAt:legacyMillis(row.data?.awardedAt),sourcePath:row.path
  })),
  courses:progress.filter(row=>clean(row.data?.season,80)===season).map(row=>({
   id:row.id,targetPath:base+"/courses/"+row.id,
   season,courseId:clean(row.data?.courseId,128),
   completed:Array.isArray(row.data?.completed)?[...new Set(row.data.completed.filter(value=>typeof value==="string"&&value))]:[],
   missionScores:row.data?.missionScores&&typeof row.data.missionScores==="object"&&!Array.isArray(row.data.missionScores)?
    row.data.missionScores:{},
   legacyUpdatedAt:legacyMillis(row.data?.updatedAt),sourcePath:row.path
  })),
  migration:{sourcePath:score.path}
 };
}
async function buildPracticePlan(db,{foundationPlan,foundationPlanRaw,foundationApproval,
 academicAccessPlan,academicAccessPlanRaw,academicAccessApproval,currentSeason}){
 if(typeof currentSeason!=="string"||!currentSeason)
  throw Error("A current Practice season ID is required.");
 const students=approvedStudents(foundationPlan,foundationPlanRaw,foundationApproval),
  sections=activeSections(academicAccessPlan,academicAccessPlanRaw,academicAccessApproval);
 const candidates=[],blockers=[],reviewItems=[];
 for(const student of students.values()){
  const base="schools/"+SCHOOL_ID+"/legacy_roots/";
  const [verified,score,states,progress,awards]=await Promise.all([
   listCollection(db,base+"practice_verified_progress/documents/"+student.uid+"/courses").catch(()=>[]),
   readDoc(db,base+"practice_season_scores/documents/"+student.uid),
   listCollection(db,base+"practice_season_scores/documents/"+student.uid+"/mission_state").catch(()=>[]),
   listCollection(db,base+"practice_season_progress/documents/"+student.uid+"/courses").catch(()=>[]),
   listCollection(db,base+"practice_season_awards/documents/"+student.uid+"/missions").catch(()=>[])
  ]);
  const current=reconcileCurrentSeason({score,states,awards,progress,currentSeason,student,
   sections:sections.get(student.personId)||new Set()});
  blockers.push(...current.blockers.map(item=>({...item,uid:student.uid})));
  reviewItems.push(...current.reviewItems);
  const historical=historicalSeasonArchive({score,states,awards,progress,student,currentSeason});
  const candidate={
   uid:student.uid,personId:student.personId,
   verifiedProgress:verified.map(row=>normalizeVerifiedProgress(row,student)),
   currentSeason:current.current||null,historicalSeason:historical
  };
  if(candidate.verifiedProgress.length||candidate.currentSeason||candidate.historicalSeason)
   candidates.push(candidate);
 }
 return {
  schema:SCHEMA,schoolId:SCHOOL_ID,readOnly:true,generatedAt:new Date().toISOString(),
  currentSeason,students:candidates,blockers,reviewItems,readyForApply:false,
  summary:{
   students:candidates.length,
   verifiedProgressCourses:candidates.reduce((sum,row)=>sum+row.verifiedProgress.length,0),
   currentSeasonStudents:candidates.filter(row=>row.currentSeason).length,
   historicalSeasonArchives:candidates.filter(row=>row.historicalSeason).length,
   currentAwards:candidates.reduce((sum,row)=>sum+(row.currentSeason?.awards.length||0),0),
   blockers:blockers.length,reviewItems:reviewItems.length
  },
  intentionallyLegacyOnly:[
   "practice_attempts","practice_season_attempts","practice_sessions",
   "practice_browser_sessions","practice_security_events","practice_rankings",
   "practice_class_progress","practice_class_season_rankings","practice_public_rankings"
  ],
  nextRequiredReview:[
   "Current season score must reconcile exactly with immutable award rows and course progress.",
   "Legacy public-leaderboard consent is not carried into the school leaderboard; migrated students start opted out.",
   "Current class leaderboard rows are rebuilt only for approved active enrollment sections.",
   "Ephemeral attempts/sessions and old derived ranking rows remain available only in the quarantined MCS mirror.",
   "A previous season score, if still present in the legacy head, is archived under school history and is not treated as the current season."
  ]
 };
}
function arg(args,name){
 const value=args.find(item=>item.startsWith("--"+name+"="))?.slice(name.length+3);
 if(!value||!value.startsWith("/")||value.includes("\0"))
  throw Error("Provide --"+name+" as a restricted absolute path.");
 return value;
}
function read(path){const raw=readFileSync(path),data=JSON.parse(raw.toString("utf8"));return {raw,data};}
async function main(){
 const args=process.argv.slice(2),foundation=read(arg(args,"foundation-plan")),
  foundationApproval=read(arg(args,"foundation-approval")),
  access=read(arg(args,"academic-access-plan")),
  accessApproval=read(arg(args,"academic-access-approval")),
  output=arg(args,"output"),seasonModule=await import("./practice-season.mjs");
 if(!getApps().length)initializeApp({credential:applicationDefault()});
 const plan=await buildPracticePlan(getFirestore(),{
  foundationPlan:foundation.data,foundationPlanRaw:foundation.raw,
  foundationApproval:foundationApproval.data,
  academicAccessPlan:access.data,academicAccessPlanRaw:access.raw,
  academicAccessApproval:accessApproval.data,
  currentSeason:seasonModule.PRACTICE_SEASON
 });
 writeFileSync(output,JSON.stringify(plan,null,2)+"\n",{flag:"wx",mode:0o600});
 console.info(JSON.stringify({practicePlanCreated:true,schoolId:SCHOOL_ID,
  currentSeason:plan.currentSeason,summary:plan.summary,readyForApply:false}));
}
if(require.main===module)main().catch(error=>{
 console.error("MCS canonical Practice planning failed:",error.code||error.message);
 process.exitCode=1;
});
module.exports={SCHEMA,approvedStudents,activeSections,canonicalAlias,canonicalPublicId,
 normalizeVerifiedProgress,reconcileCurrentSeason,historicalSeasonArchive,buildPracticePlan};
