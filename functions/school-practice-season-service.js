"use strict";
/**
 * Adminerva 4.0 school-scoped Practice season.
 *
 * The mission catalog and scoring algorithm remain shared with the legacy
 * Practice Lab, but all authority and saved state are school scoped:
 * canonical membership -> linked student person -> active enrollment.
 */
const {createHash,randomBytes}=require("node:crypto");
const {getSchoolContext}=require("./tenant-access.js");
const {PracticeError}=require("./practice-service.js");

const hash=value=>createHash("sha256").update(value).digest("hex");
const millis=value=>value?.toMillis?.()||0;
const randomId=()=>randomBytes(24).toString("hex");
const reject=(code,message,reason)=>{throw new PracticeError(code,message,reason);};
const schoolPracticeClassRankId=(sectionId,uid)=>hash(JSON.stringify([sectionId,uid])).slice(0,40);
async function defaultCatalog(){return import("./practice-courses.mjs");}
async function defaultSeason(){return import("./practice-season.mjs");}

function createSchoolPracticeSeasonService({
 db,Timestamp,resolveUser,now=Date.now,catalog=defaultCatalog,seasonRules=defaultSeason,
 id=randomId
}){
 const stamp=value=>Timestamp.fromMillis(value);
 const prefix=schoolId=>"schools/"+schoolId+"/";
 const ref=(actor,path)=>db.doc(prefix(actor.schoolId)+path);
 const col=(actor,path)=>db.collection(prefix(actor.schoolId)+path);

 async function actor(request){
  const ctx=await getSchoolContext({db,request,schoolId:request.data?.schoolId,roles:["student"]});
  const token=request.auth?.token||{},user=await resolveUser(ctx.uid);
  if(user.disabled||!user.emailVerified||
     (user.tokensValidAfterTime&&Date.parse(user.tokensValidAfterTime)>Number(token.auth_time||0)*1000))
   reject("unauthenticated","Your sign-in is no longer valid. Sign in again.","revoked-sign-in");
  const memberRef=db.doc(prefix(ctx.schoolId)+"memberships/"+ctx.uid),member=await memberRef.get();
  const personId=member.data()?.personId;
  if(typeof personId!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(personId))
   reject("permission-denied","Your school account is not linked to a student person record.","enrollment");
  const personRef=db.doc(prefix(ctx.schoolId)+"people/"+personId),
   migrationRef=db.doc(prefix(ctx.schoolId)+"practice_migration_state/"+ctx.uid);
  const [person,migrationState]=await Promise.all([personRef.get(),migrationRef.get()]);
  if(migrationState.exists&&migrationState.data().status==="in_progress")
   reject("unavailable","Your Practice progress is being finalized for this school. No score can be submitted until reconciliation completes.","practice-migration");
  if(!person.exists||person.data().schoolId!==ctx.schoolId||person.data().kind!=="student"||
     person.data().status!=="active"||person.data().authUid!==ctx.uid)
   reject("permission-denied","Your linked school student record is inactive or changed.","enrollment");
  const enrollmentSnap=await db.collection(prefix(ctx.schoolId)+"enrollments")
   .where("personId","==",personId).limit(101).get();
  if(enrollmentSnap.size===101)
   reject("resource-exhausted","Your current enrollment list needs school review before Practice can continue.","enrollment");
  const enrollmentDocs=enrollmentSnap.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&
   doc.data().status==="active");
  if(!enrollmentDocs.length)
   reject("permission-denied","An active school enrollment is required to save Practice progress.","enrollment");
  const offerings=await Promise.all(enrollmentDocs.map(row=>
   db.doc(prefix(ctx.schoolId)+"course_offerings/"+row.data().offeringId).get()));
  const active=enrollmentDocs.filter((row,index)=>offerings[index].exists&&
   offerings[index].data().schoolId===ctx.schoolId&&offerings[index].data().status==="active");
  if(!active.length)
   reject("permission-denied","Your active Practice class is not currently available.","enrollment");
  const sectionIds=[...new Set(active.map(row=>row.data().sectionId).filter(Boolean))];
  const sectionDocs=await Promise.all(sectionIds.map(sectionId=>
   db.doc(prefix(ctx.schoolId)+"sections/"+sectionId).get()));
  const classes=sectionIds.map((sectionId,index)=>({
   id:sectionId,
   section:sectionDocs[index].exists&&sectionDocs[index].data().schoolId===ctx.schoolId?
    String(sectionDocs[index].data().name||sectionId):sectionId
  }));
  return {
   ...ctx,uid:ctx.uid,schoolId:ctx.schoolId,personId,token,
   memberRef,personRef,migrationRef,
   enrollments:active.map(row=>({
    ref:row.ref,id:row.id,offeringId:row.data().offeringId,
    sectionId:row.data().sectionId,subjectId:row.data().subjectId
   })),
   classes
  };
 }
 async function eligibility(tx,a){
  const schoolRef=db.doc("platform_schools/"+a.schoolId);
  const [school,member,person,migrationState,...records]=await Promise.all([
   tx.get(schoolRef),tx.get(a.memberRef),tx.get(a.personRef),tx.get(a.migrationRef),
   ...a.enrollments.map(item=>tx.get(item.ref)),
   ...a.enrollments.map(item=>tx.get(ref(a,"course_offerings/"+item.offeringId)))
  ]);
  if(migrationState.exists&&migrationState.data().status==="in_progress")
   reject("unavailable","Your Practice progress is still being reconciled. Retry after the migration is complete.","practice-migration");
  if(!school.exists||school.data().state!=="active"||
     !member.exists||member.data().schoolId!==a.schoolId||member.data().status!=="active"||
     !Array.isArray(member.data().roles)||!member.data().roles.includes("student")||
     member.data().personId!==a.personId||
     !person.exists||person.data().schoolId!==a.schoolId||person.data().kind!=="student"||
     person.data().status!=="active"||person.data().authUid!==a.uid)
   reject("permission-denied","Your school enrollment changed. Reload Practice before continuing.","enrollment");
  const count=a.enrollments.length,enrollments=records.slice(0,count),offerings=records.slice(count);
  if(enrollments.some((record,index)=>!record.exists||
      record.data().schoolId!==a.schoolId||record.data().personId!==a.personId||
      record.data().offeringId!==a.enrollments[index].offeringId||record.data().status!=="active")||
     offerings.some((record,index)=>!record.exists||record.data().schoolId!==a.schoolId||
      record.id!==a.enrollments[index].offeringId||record.data().status!=="active"))
   reject("permission-denied","Your class enrollment changed. Reload Practice before continuing.","enrollment");
  return a.enrollments;
 }
 function recent(a,time){
  const authenticated=Number(a.token?.auth_time)*1000;
  if(!Number.isFinite(authenticated)||authenticated>time+60000||time-authenticated>600000)
   reject("unauthenticated","Sign in again before starting or transferring a scored Practice session.","recent-sign-in");
 }
 function sessionOkay(record,request,a,time){
  const session=record.data();
  if(!session||session.ownerUid!==a.uid||session.schoolId!==a.schoolId||
     session.sessionId!==request.data?.sessionId||session.revokedAt||
     millis(session.expiresAt)<=time)
   reject("failed-precondition","This Practice session expired or moved. Resume it on this device.","session-moved");
  return session;
 }
 function scoreSeed(a,season,previous={}){
  return previous.season===season&&previous.schoolId===a.schoolId&&
   previous.ownerUid===a.uid&&previous.personId===a.personId?previous:{
   schoolId:a.schoolId,ownerUid:a.uid,personId:a.personId,season,
   alias:"Learner-"+hash(a.schoolId+":"+a.uid).slice(0,7).toUpperCase(),
   optIn:false,points:0,completedCount:0,publicId:id()
  };
 }
 const boardData=(a,score,time)=>({
  schoolId:a.schoolId,ownerUid:a.uid,alias:score.alias,points:score.points,
  completedCount:score.completedCount,season:score.season,updatedAt:stamp(time)
 });

 async function acquireSeason(request){
  const a=await actor(request),time=now(),browserId=request.data?.browserId;
  if(typeof browserId!=="string"||!/^([a-f0-9]{32}|[a-f0-9]{48})$/.test(browserId))
   reject("invalid-argument","A browser Practice key is required.","browser-key");
  const browserHash=hash(browserId),sessionRef=ref(a,"practice_sessions/"+a.uid),
   browserRef=ref(a,"practice_browser_sessions/"+browserHash),nextId=id();
  return db.runTransaction(async tx=>{
   const [sessionRecord,browserRecord]=await Promise.all([
    tx.get(sessionRef),tx.get(browserRef)
   ]);
   await eligibility(tx,a);
   const previous=sessionRecord.data(),browser=browserRecord.data(),
    same=previous&&!previous.revokedAt&&millis(previous.expiresAt)>time&&
     previous.browserHash===browserHash&&previous.schoolId===a.schoolId,
    accountConflict=previous&&!same&&!previous.revokedAt&&millis(previous.expiresAt)>time,
    browserConflict=browser&&browser.ownerUid!==a.uid&&millis(browser.expiresAt)>time;
   if((accountConflict||browserConflict)&&request.data?.takeover!==true)
    reject("failed-precondition","Practice is active on another device or account. Confirm the transfer to continue here.","transfer-required");
   if(!same||browserConflict)recent(a,time);
   const oldSession=browserConflict?await tx.get(ref(a,"practice_sessions/"+browser.ownerUid)):null,
    oldBrowser=previous?.browserHash&&previous.browserHash!==browserHash?
     await tx.get(ref(a,"practice_browser_sessions/"+previous.browserHash)):null;
   const sessionId=same&&!browserConflict?previous.sessionId:nextId,
    after={...(same?previous:{}),schoolId:a.schoolId,ownerUid:a.uid,personId:a.personId,
     sessionId,browserHash,activeAttemptId:same?previous.activeAttemptId||null:null,
     createdAt:same?previous.createdAt:stamp(time),expiresAt:stamp(time+1800000),revokedAt:null};
   if(oldSession?.exists&&oldSession.data().sessionId===browser.sessionId)
    tx.update(oldSession.ref,{revokedAt:stamp(time),activeAttemptId:null});
   if(oldBrowser?.exists&&oldBrowser.data().ownerUid===a.uid)tx.delete(oldBrowser.ref);
   tx.set(sessionRef,after);
   tx.set(browserRef,{schoolId:a.schoolId,ownerUid:a.uid,sessionId,expiresAt:after.expiresAt});
   return {schoolId:a.schoolId,sessionId,expiresAt:time+1800000,
    transferred:Boolean(accountConflict||browserConflict)};
  });
 }

 async function hub(request){
  const a=await actor(request),rules=await seasonRules(),season=rules.PRACTICE_SEASON;
  const [saved,progress,legacy,publicBoard]=await Promise.all([
   ref(a,"practice_season_scores/"+a.uid).get(),
   col(a,"practice_season_progress/"+a.uid+"/courses").get(),
   col(a,"practice_verified_progress/"+a.uid+"/courses").get(),
   col(a,"practice_public_rankings").orderBy("points","desc").limit(30).get()
  ]);
  const score=scoreSeed(a,season,saved.data()),
   current=a.classes.find(item=>item.id===request.data?.classId)||a.classes[0];
  let classRows=[];
  if(current?.id){
   const rows=await col(a,"practice_class_season_rankings")
    .where("sectionId","==",current.id).limit(500).get();
   classRows=rows.docs.map(row=>row.data()).filter(row=>row.season===season)
    .map(row=>({alias:row.alias,points:row.points,completedCount:row.completedCount,
      isCurrent:row.ownerUid===a.uid}))
    .sort((x,y)=>y.points-x.points);
  }
  const publicRows=publicBoard.docs.map(row=>row.data()).filter(row=>row.season===season)
   .map(row=>({alias:row.alias,points:row.points,completedCount:row.completedCount,
     isCurrent:row.ownerUid===a.uid}));
  return {schoolId:a.schoolId,season,eligible:true,alias:score.alias,optIn:score.optIn,
   points:score.points,completedCount:score.completedCount,
   classes:a.classes,classId:current?.id||"",classRows,publicRows,
   courses:progress.docs.map(row=>row.data()).filter(row=>row.season===season),
   legacyCount:legacy.docs.reduce((count,row)=>count+(row.data().completed?.length||0),0)};
 }

 async function startSeason(request){
  const a=await actor(request),time=now(),library=await catalog(),rules=await seasonRules();
  const course=library.COURSES.find(item=>item.id===request.data?.courseId),
   mission=course?.missions.find(item=>item.id===request.data?.missionId);
  if(!mission)reject("invalid-argument","Choose a mission from the Practice map.","mission");
  const season=rules.PRACTICE_SEASON,
   attemptId=hash(season+":"+a.schoolId+":"+a.uid+":"+mission.id+":"+request.data?.sessionId).slice(0,48),
   question=rules.seasonActivity(course,mission,Math.abs(library.hashSeed(season+mission.id))),
   sessionRef=ref(a,"practice_sessions/"+a.uid),
   attemptRef=ref(a,"practice_season_attempts/"+attemptId),
   stateRef=ref(a,"practice_season_scores/"+a.uid+"/mission_state/"+season+"_"+mission.id);
  return db.runTransaction(async tx=>{
   const [sessionRecord,existing,state]=await Promise.all([
    tx.get(sessionRef),tx.get(attemptRef),tx.get(stateRef)
   ]);
   const session=sessionOkay(sessionRecord,request,a,time);
   await eligibility(tx,a);
   const currentWindow=time-millis(session.seasonWindowAt)<60000,
    starts=currentWindow?session.seasonStarts||0:0,
    needsRefresh=!existing.exists||millis(existing.data().expiresAt)<=time;
   if(needsRefresh&&starts>=20)
    reject("resource-exhausted","Give the Practice map a moment, then open the mission again.","practice-rate-limit");
   if(needsRefresh){
    tx.set(attemptRef,{schoolId:a.schoolId,ownerUid:a.uid,personId:a.personId,
     sessionId:session.sessionId,season,attemptId,courseId:course.id,missionId:mission.id,
     question,createdAt:stamp(time),expiresAt:stamp(time+7200000)});
    tx.update(sessionRef,{seasonStarts:starts+1,
     seasonWindowAt:currentWindow?session.seasonWindowAt:stamp(time)});
   }
   const wrong=state.data()?.wrongSubmissions||0,completed=state.data()?.completed===true;
   return {attemptId,courseId:course.id,missionId:mission.id,season,
    question:rules.publicActivity(question),wrongSubmissions:wrong,
    availablePoints:Math.max(question.difficulty.floor,
     question.difficulty.maximum-wrong*question.difficulty.deduction),
    completed,earnedPoints:state.data()?.earnedPoints||0,
    ...(completed?{explanation:question.why,workspace:question.workspace}:{})};
  });
 }

 async function submitSeason(request){
  const a=await actor(request),time=now(),rules=await seasonRules(),
   attemptId=request.data?.attemptId,submissionId=request.data?.submissionId,answer=request.data?.answer;
  if(!/^[a-f0-9]{48}$/.test(attemptId||"")||
     !/^([a-f0-9]{32}|[a-f0-9]{48})$/.test(submissionId||""))
   reject("invalid-argument","Open a mission and submit a complete answer.","submission");
  const sessionRef=ref(a,"practice_sessions/"+a.uid),
   attemptRef=ref(a,"practice_season_attempts/"+attemptId);
  return db.runTransaction(async tx=>{
   const [sessionRecord,attemptRecord]=await Promise.all([
    tx.get(sessionRef),tx.get(attemptRef)
   ]);
   const session=sessionOkay(sessionRecord,request,a,time),
    attempt=attemptRecord.data(),enrollments=await eligibility(tx,a);
   if(!attempt||attempt.schoolId!==a.schoolId||attempt.ownerUid!==a.uid||
      attempt.sessionId!==session.sessionId||attempt.season!==rules.PRACTICE_SEASON||
      millis(attempt.expiresAt)<=time)
    reject("failed-precondition","This mission session ended. Reopen it; saved rewards are preserved.","attempt-expired");
   const question=attempt.question;
   if(!rules.validSeasonAnswer(question,answer))
    reject("invalid-argument","Complete every answer before selecting Submit answer.","answer-incomplete");
   const key=attempt.season+"_"+attempt.missionId,
    stateRef=ref(a,"practice_season_scores/"+a.uid+"/mission_state/"+key),
    awardRef=ref(a,"practice_season_awards/"+a.uid+"/missions/"+key),
    scoreRef=ref(a,"practice_season_scores/"+a.uid),
    progressRef=ref(a,"practice_season_progress/"+a.uid+"/courses/"+attempt.season+"_"+attempt.courseId),
    responseRef=attemptRef.collection("submissions").doc(submissionId);
   const [stateRecord,award,scoreRecord,progressRecord,response]=await Promise.all([
    tx.get(stateRef),tx.get(awardRef),tx.get(scoreRef),tx.get(progressRef),tx.get(responseRef)
   ]);
   if(response.exists)return response.data().result;
   if(award.exists)return {correct:rules.gradeSeasonAnswer(question,answer),
    alreadyRecorded:true,awarded:false,earnedPoints:award.data().points,
    explanation:question.why,workspace:question.workspace,
    courseId:attempt.courseId,missionId:attempt.missionId,attemptId};
   const state=stateRecord.data()||{},score=scoreSeed(a,attempt.season,scoreRecord.data());
   if(time-millis(state.lastSubmittedAt)<900)
    reject("resource-exhausted","Wait a moment before another graded submission.","practice-rate-limit");
   const correct=rules.gradeSeasonAnswer(question,answer),
    wrong=(state.wrongSubmissions||0)+(correct?0:1),
    availablePoints=Math.max(question.difficulty.floor,
     question.difficulty.maximum-wrong*question.difficulty.deduction),
    result={correct,awarded:correct,earnedPoints:correct?availablePoints:0,
     availablePoints,wrongSubmissions:wrong,
     deduction:correct?0:Math.max(0,Math.max(question.difficulty.floor,
      question.difficulty.maximum-(state.wrongSubmissions||0)*question.difficulty.deduction)-availablePoints),
     floor:question.difficulty.floor,courseId:attempt.courseId,
     missionId:attempt.missionId,attemptId};
   tx.set(stateRef,{schoolId:a.schoolId,ownerUid:a.uid,personId:a.personId,
    season:attempt.season,courseId:attempt.courseId,missionId:attempt.missionId,
    wrongSubmissions:wrong,completed:correct,earnedPoints:correct?availablePoints:0,
    lastSubmittedAt:stamp(time)});
   if(correct){
    result.explanation=question.why;result.workspace=question.workspace;
    const progress=progressRecord.data()||{},
     completed=[...new Set([...(progress.completed||[]),attempt.missionId])],
     missionScores={...(progress.missionScores||{}),[attempt.missionId]:availablePoints},
     next={...score,schoolId:a.schoolId,personId:a.personId,
      points:(score.points||0)+availablePoints,
      completedCount:(score.completedCount||0)+1,updatedAt:stamp(time)};
    tx.create(awardRef,{schoolId:a.schoolId,ownerUid:a.uid,personId:a.personId,
     season:attempt.season,courseId:attempt.courseId,missionId:attempt.missionId,
     points:availablePoints,wrongSubmissions:wrong,awardedAt:stamp(time)});
    tx.set(progressRef,{schoolId:a.schoolId,ownerUid:a.uid,personId:a.personId,
     season:attempt.season,courseId:attempt.courseId,completed,missionScores,updatedAt:stamp(time)});
    tx.set(scoreRef,next);
    const publicRef=ref(a,"practice_public_rankings/"+next.publicId);
    if(next.optIn)tx.set(publicRef,boardData(a,next,time));
    else tx.delete(publicRef);
    const sections=[...new Set(enrollments.map(item=>item.sectionId).filter(Boolean))];
    for(const sectionId of sections)
     tx.set(ref(a,"practice_class_season_rankings/"+schoolPracticeClassRankId(sectionId,a.uid)),{
      schoolId:a.schoolId,ownerUid:a.uid,personId:a.personId,sectionId,
      alias:next.alias,points:next.points,completedCount:next.completedCount,
      season:attempt.season,updatedAt:stamp(time)});
   }
   tx.set(responseRef,{schoolId:a.schoolId,ownerUid:a.uid,result,createdAt:stamp(time)});
   return result;
  });
 }

 async function preferences(request){
  const a=await actor(request),time=now(),rules=await seasonRules();
  if(typeof request.data?.optIn!=="boolean")
   reject("invalid-argument","Choose whether to join this school's public leaderboard.","preferences");
  const alias=String(request.data?.alias||"").trim();
  if(!/^[A-Za-z0-9 _-]{3,24}$/.test(alias))
   reject("invalid-argument","Use a nickname of 3–24 letters, numbers, spaces, dashes or underscores. Do not use your real name.","alias");
  const scoreRef=ref(a,"practice_season_scores/"+a.uid);
  return db.runTransaction(async tx=>{
   const record=await tx.get(scoreRef),enrollments=await eligibility(tx,a),
    before=scoreSeed(a,rules.PRACTICE_SEASON,record.data()),
    score={...before,schoolId:a.schoolId,personId:a.personId,alias,
     optIn:request.data.optIn,updatedAt:stamp(time)};
   tx.set(scoreRef,score);
   const publicRef=ref(a,"practice_public_rankings/"+score.publicId);
   if(score.optIn)tx.set(publicRef,boardData(a,score,time));else tx.delete(publicRef);
   const sections=[...new Set(enrollments.map(item=>item.sectionId).filter(Boolean))];
   for(const sectionId of sections)
    tx.set(ref(a,"practice_class_season_rankings/"+schoolPracticeClassRankId(sectionId,a.uid)),{
     schoolId:a.schoolId,ownerUid:a.uid,personId:a.personId,sectionId,
     alias:score.alias,points:score.points,completedCount:score.completedCount,
     season:rules.PRACTICE_SEASON,updatedAt:stamp(time)});
   return {schoolId:a.schoolId,alias:score.alias,optIn:score.optIn};
  });
 }

 return {acquireSeason,hub,startSeason,submitSeason,preferences};
}
module.exports={createSchoolPracticeSeasonService,schoolPracticeClassRankId};
