/** Public mission season. Only explicit authenticated answer submissions change scores. */
const {createHash}=require("node:crypto");
const hash=value=>createHash("sha256").update(value).digest("hex");
const millis=value=>value?.toMillis?.()||0;
function createPracticeSeasonService({db,Timestamp,resolveUser,now,randomId,catalog,reject}){
  const stamp=value=>Timestamp.fromMillis(value),rules=()=>import("./practice-season.mjs");
  async function member(request){
    const actor=request.auth;
    if(!actor?.uid||actor.token?.email_verified!==true||typeof actor.token.email!=="string")reject("unauthenticated","Sign in with a verified account to submit practice answers.","verified-sign-in");
    const user=await resolveUser(actor.uid),email=actor.token.email.toLowerCase();
    if(user.disabled||!user.emailVerified||user.email?.toLowerCase()!==email||(user.tokensValidAfterTime&&Date.parse(user.tokensValidAfterTime)>Number(actor.token.auth_time)*1000))reject("unauthenticated","Sign in again before continuing practice.","revoked-sign-in");
    const [students,admission,staff]=await Promise.all([db.collection("students").where("email","==",email).limit(11).get(),db.doc("account_requests/"+actor.uid).get(),db.doc("staff_access/"+email).get()]);
    if(students.size>10)reject("permission-denied","Ask your school to review the records linked to your email.","enrollment");
    const isStaff=["babaynike2013@gmail.com","josephsixson@mcstayuman.edu.ph"].includes(email)||staff.data()?.status==="active"&&staff.data()?.role==="teacher";
    if(students.empty&&!isStaff&&!["pending","approved"].includes(admission.data()?.status))reject("permission-denied","Finish your access request before submitting practice. Public missions remain visible.","guest-registration");
    return {...actor,email,profiles:students.docs,isStaff};
  }
  async function eligibility(transaction,actor){
    if(actor.profiles.length){
      const records=await Promise.all(actor.profiles.map(profile=>transaction.get(profile.ref)));
      if(records.some(record=>!record.exists||record.data().email?.toLowerCase()!==actor.email||record.data().active===false||record.data().status==="disabled"))reject("permission-denied","Your student record changed. Ask your teacher to check your account.","enrollment");
      return records.filter(record=>typeof record.data().section==="string"&&record.data().section.trim()).map(record=>({id:record.id,...record.data()}));
    }
    if(!actor.isStaff){const admission=await transaction.get(db.doc("account_requests/"+actor.uid));if(!["pending","approved"].includes(admission.data()?.status))reject("permission-denied","Your access request is no longer eligible for saved practice.","guest-registration");}
    return [];
  }
  function sessionOkay(record,request,actor,time){const session=record.data();if(!session||session.ownerUid!==actor.uid||session.sessionId!==request.data?.sessionId||session.revokedAt||millis(session.expiresAt)<=time)reject("failed-precondition","Reconnect practice on this device before submitting.","session-moved");return session;}
  function newScore(actor,season,previous={}){return previous.season===season?previous:{ownerUid:actor.uid,season,alias:"Learner-"+hash(actor.uid).slice(0,7).toUpperCase(),optIn:false,points:0,completedCount:0,publicId:randomId()};}
  const boardData=(score,time)=>({alias:score.alias,points:score.points,completedCount:score.completedCount,season:score.season,updatedAt:stamp(time)});
  async function acquireSeason(request){
    const actor=await member(request),time=now(),browserId=request.data?.browserId;
    if(typeof browserId!=="string"||!/^([a-f0-9]{32}|[a-f0-9]{48})$/.test(browserId))reject("invalid-argument","A browser practice key is required.","browser-key");
    const browserHash=hash(browserId),sessionRef=db.doc("practice_sessions/"+actor.uid),browserRef=db.doc("practice_browser_sessions/"+browserHash),nextId=randomId();
    return db.runTransaction(async transaction=>{
      const [sessionRecord,browserRecord]=await Promise.all([transaction.get(sessionRef),transaction.get(browserRef)]);await eligibility(transaction,actor);
      const previous=sessionRecord.data(),browser=browserRecord.data(),same=previous&&!previous.revokedAt&&millis(previous.expiresAt)>time&&previous.browserHash===browserHash;
      const accountConflict=previous&&!same&&!previous.revokedAt&&millis(previous.expiresAt)>time,browserConflict=browser&&browser.ownerUid!==actor.uid&&millis(browser.expiresAt)>time;
      if((accountConflict||browserConflict)&&request.data?.takeover!==true)reject("failed-precondition","Practice is active on another device or account. Continue practice here to transfer it.","transfer-required");
      const authenticated=Number(actor.token.auth_time)*1000;if((!same||browserConflict)&&(!Number.isFinite(authenticated)||authenticated>time+60000||time-authenticated>600000))reject("unauthenticated","Sign in again to start or move your practice session.","recent-sign-in");
      const oldSession=browserConflict?await transaction.get(db.doc("practice_sessions/"+browser.ownerUid)):null,oldBrowser=previous?.browserHash&&previous.browserHash!==browserHash?await transaction.get(db.doc("practice_browser_sessions/"+previous.browserHash)):null;
      const sessionId=same&&!browserConflict?previous.sessionId:nextId,after={...(same?previous:{}),ownerUid:actor.uid,sessionId,browserHash,activeAttemptId:same?previous.activeAttemptId||null:null,createdAt:same?previous.createdAt:stamp(time),expiresAt:stamp(time+1800000),revokedAt:null};
      if(oldSession?.exists&&oldSession.data().sessionId===browser.sessionId)transaction.update(oldSession.ref,{revokedAt:stamp(time),activeAttemptId:null});if(oldBrowser?.exists&&oldBrowser.data().ownerUid===actor.uid)transaction.delete(oldBrowser.ref);
      transaction.set(sessionRef,after);transaction.set(browserRef,{ownerUid:actor.uid,sessionId,expiresAt:after.expiresAt});
      return {sessionId,expiresAt:time+1800000,transferred:Boolean(accountConflict||browserConflict)};
    });
  }
  async function hub(request){
    const {PRACTICE_SEASON}=await rules();if(!request.auth)return {season:PRACTICE_SEASON,eligible:false,classes:[],courses:[],legacyCount:0};
    const actor=await member(request),[saved,progress,legacy]=await Promise.all([db.doc("practice_season_scores/"+actor.uid).get(),db.collection("practice_season_progress/"+actor.uid+"/courses").get(),db.collection("practice_verified_progress/"+actor.uid+"/courses").get()]);
    const score=newScore(actor,PRACTICE_SEASON,saved.data()),classes=actor.profiles.filter(profile=>profile.data().active!==false&&profile.data().status!=="disabled"&&typeof profile.data().section==="string"&&profile.data().section.trim()).map(profile=>({id:profile.id,section:profile.data().section}));
    const current=classes.find(profile=>profile.id===request.data?.classId)||classes[0];let classRows=[];
    if(current?.section){const rows=await db.collection("practice_class_season_rankings").where("section","==",current.section).limit(500).get();classRows=rows.docs.map(row=>row.data()).filter(row=>row.season===PRACTICE_SEASON).map(row=>({alias:row.alias,points:row.points,completedCount:row.completedCount,isCurrent:row.ownerUid===actor.uid})).sort((a,b)=>b.points-a.points);}
    return {season:PRACTICE_SEASON,eligible:true,alias:score.alias,optIn:score.optIn,points:score.points,completedCount:score.completedCount,classes,classId:current?.id||"",classRows,courses:progress.docs.map(row=>row.data()).filter(row=>row.season===PRACTICE_SEASON),legacyCount:legacy.docs.reduce((count,row)=>count+(row.data().completed?.length||0),0)};
  }
  async function startSeason(request){
    const actor=await member(request),time=now(),library=await catalog(),seasonRules=await rules();
    const course=library.COURSES.find(course=>course.id===request.data?.courseId),mission=course?.missions.find(mission=>mission.id===request.data?.missionId);
    if(!mission)reject("invalid-argument","Choose a mission from the practice map.","mission");
    const season=seasonRules.PRACTICE_SEASON,attemptId=hash(season+":"+actor.uid+":"+mission.id+":"+request.data?.sessionId).slice(0,48),question=seasonRules.seasonActivity(course,mission,Math.abs(library.hashSeed(season+mission.id)));
    return db.runTransaction(async transaction=>{
      const sessionRef=db.doc("practice_sessions/"+actor.uid),attemptRef=db.doc("practice_season_attempts/"+attemptId),stateRef=db.doc("practice_season_scores/"+actor.uid+"/mission_state/"+season+"_"+mission.id);
      const [sessionRecord,existing,state]=await Promise.all([transaction.get(sessionRef),transaction.get(attemptRef),transaction.get(stateRef)]);const session=sessionOkay(sessionRecord,request,actor,time);await eligibility(transaction,actor);
      const currentWindow=time-millis(session.seasonWindowAt)<60000,starts=currentWindow?session.seasonStarts||0:0;
      const needsRefresh=!existing.exists||millis(existing.data().expiresAt)<=time;
      if(needsRefresh&&starts>=20)reject("resource-exhausted","Give the map a moment, then open your mission again.","practice-rate-limit");
      if(needsRefresh){transaction.set(attemptRef,{ownerUid:actor.uid,sessionId:session.sessionId,season,attemptId,courseId:course.id,missionId:mission.id,question,createdAt:stamp(time),expiresAt:stamp(time+7200000)});transaction.update(sessionRef,{seasonStarts:starts+1,seasonWindowAt:currentWindow?session.seasonWindowAt:stamp(time)});}
      const wrong=state.data()?.wrongSubmissions||0,completed=state.data()?.completed===true;
      return {attemptId,courseId:course.id,missionId:mission.id,season,question:seasonRules.publicActivity(question),wrongSubmissions:wrong,availablePoints:Math.max(question.difficulty.floor,question.difficulty.maximum-wrong*question.difficulty.deduction),completed,earnedPoints:state.data()?.earnedPoints||0,...(completed?{explanation:question.why,workspace:question.workspace}:{})};
    });
  }
  async function submitSeason(request){
    const actor=await member(request),time=now(),seasonRules=await rules(),attemptId=request.data?.attemptId,submissionId=request.data?.submissionId,answer=request.data?.answer;
    if(!/^[a-f0-9]{48}$/.test(attemptId||"")||!/^([a-f0-9]{32}|[a-f0-9]{48})$/.test(submissionId||""))reject("invalid-argument","Open a mission and submit a complete answer.","submission");
    return db.runTransaction(async transaction=>{
      const [sessionRecord,attemptRecord]=await Promise.all([transaction.get(db.doc("practice_sessions/"+actor.uid)),transaction.get(db.doc("practice_season_attempts/"+attemptId))]);const session=sessionOkay(sessionRecord,request,actor,time),attempt=attemptRecord.data(),profiles=await eligibility(transaction,actor);
      if(!attempt||attempt.ownerUid!==actor.uid||attempt.sessionId!==session.sessionId||attempt.season!==seasonRules.PRACTICE_SEASON||millis(attempt.expiresAt)<=time)reject("failed-precondition","This mission session ended. Reopen it; saved mistakes and rewards are preserved.","attempt-expired");
      const question=attempt.question;if(!seasonRules.validSeasonAnswer(question,answer))reject("invalid-argument","Complete every answer before selecting Submit answer.","answer-incomplete");
      const key=attempt.season+"_"+attempt.missionId,stateRef=db.doc("practice_season_scores/"+actor.uid+"/mission_state/"+key),awardRef=db.doc("practice_season_awards/"+actor.uid+"/missions/"+key),scoreRef=db.doc("practice_season_scores/"+actor.uid),progressRef=db.doc("practice_season_progress/"+actor.uid+"/courses/"+attempt.season+"_"+attempt.courseId),responseRef=db.doc("practice_season_attempts/"+attemptId+"/submissions/"+submissionId);
      const [stateRecord,award,scoreRecord,progressRecord,response]=await Promise.all([transaction.get(stateRef),transaction.get(awardRef),transaction.get(scoreRef),transaction.get(progressRef),transaction.get(responseRef)]);
      if(response.exists)return response.data().result;
      if(award.exists)return {correct:seasonRules.gradeSeasonAnswer(question,answer),alreadyRecorded:true,awarded:false,earnedPoints:award.data().points,explanation:question.why,workspace:question.workspace,courseId:attempt.courseId,missionId:attempt.missionId,attemptId};
      const state=stateRecord.data()||{},score=newScore(actor,attempt.season,scoreRecord.data());
      if(time-millis(state.lastSubmittedAt)<900)reject("resource-exhausted","Wait a moment before another graded submission.","practice-rate-limit");
      const correct=seasonRules.gradeSeasonAnswer(question,answer),wrong=(state.wrongSubmissions||0)+(correct?0:1),availablePoints=Math.max(question.difficulty.floor,question.difficulty.maximum-wrong*question.difficulty.deduction);
      const result={correct,awarded:correct,earnedPoints:correct?availablePoints:0,availablePoints,wrongSubmissions:wrong,deduction:correct?0:Math.max(0,Math.max(question.difficulty.floor,question.difficulty.maximum-(state.wrongSubmissions||0)*question.difficulty.deduction)-availablePoints),floor:question.difficulty.floor,courseId:attempt.courseId,missionId:attempt.missionId,attemptId};
      transaction.set(stateRef,{ownerUid:actor.uid,season:attempt.season,courseId:attempt.courseId,missionId:attempt.missionId,wrongSubmissions:wrong,completed:correct,earnedPoints:correct?availablePoints:0,lastSubmittedAt:stamp(time)});
      if(correct){
        result.explanation=question.why;result.workspace=question.workspace;
        const progress=progressRecord.data()||{},completed=[...new Set([...(progress.completed||[]),attempt.missionId])],missionScores={...(progress.missionScores||{}),[attempt.missionId]:availablePoints};
        const next={...score,points:(score.points||0)+availablePoints,completedCount:(score.completedCount||0)+1,updatedAt:stamp(time)};
        transaction.create(awardRef,{ownerUid:actor.uid,season:attempt.season,courseId:attempt.courseId,missionId:attempt.missionId,points:availablePoints,wrongSubmissions:wrong,awardedAt:stamp(time)});
        transaction.set(progressRef,{ownerUid:actor.uid,season:attempt.season,courseId:attempt.courseId,completed,missionScores,updatedAt:stamp(time)});transaction.set(scoreRef,next);
        if(next.optIn)transaction.set(db.doc("practice_public_rankings/"+next.publicId),boardData(next,time));
        for(const profile of profiles)transaction.set(db.doc("practice_class_season_rankings/"+profile.id),{ownerUid:actor.uid,section:profile.section,alias:next.alias,points:next.points,completedCount:next.completedCount,season:attempt.season,updatedAt:stamp(time)});
      }
      transaction.set(responseRef,{ownerUid:actor.uid,result,createdAt:stamp(time)});return result;
    });
  }
  async function preferences(request){
    const actor=await member(request),time=now(),{PRACTICE_SEASON}=await rules();
    if(typeof request.data?.optIn!=="boolean")reject("invalid-argument","Choose whether to join the public leaderboard.","preferences");
    const alias=String(request.data?.alias||"").trim();if(!/^[A-Za-z0-9 _-]{3,24}$/.test(alias))reject("invalid-argument","Use a nickname of 3–24 letters, numbers, spaces, dashes or underscores. Do not use your real name.","alias");
    return db.runTransaction(async transaction=>{const ref=db.doc("practice_season_scores/"+actor.uid),record=await transaction.get(ref),profiles=await eligibility(transaction,actor);const before=newScore(actor,PRACTICE_SEASON,record.data()),score={...before,alias,optIn:request.data.optIn,updatedAt:stamp(time)};transaction.set(ref,score);const publicRef=db.doc("practice_public_rankings/"+score.publicId);if(score.optIn)transaction.set(publicRef,boardData(score,time));else transaction.delete(publicRef);for(const profile of profiles)transaction.set(db.doc("practice_class_season_rankings/"+profile.id),{ownerUid:actor.uid,section:profile.section,alias:score.alias,points:score.points,completedCount:score.completedCount,season:PRACTICE_SEASON,updatedAt:stamp(time)});return {alias:score.alias,optIn:score.optIn};});
  }
  return {hub,acquireSeason,startSeason,submitSeason,preferences};
}
module.exports={createPracticeSeasonService};
