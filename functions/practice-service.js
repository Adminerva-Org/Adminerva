/** Server-owned practice attempts, session handovers and idempotent formative XP. */
const {randomBytes,createHash}=require("node:crypto");
const {createPracticeSeasonService}=require("./practice-season-service.js");
const CATALOG_VERSION="2026.10.21.3";
const id=()=>randomBytes(24).toString("hex");
const hash=value=>createHash("sha256").update(value).digest("hex");
const millis=value=>value?.toMillis?.()||0;
class PracticeError extends Error {
  constructor(code,message,reason){super(message);this.code=code;this.details={reason};}
}
const reject=(code,message,reason)=>{throw new PracticeError(code,message,reason);};
const recent=(identity,now)=>{
  const authenticated=Number(identity.token.auth_time)*1000;
  if(!Number.isFinite(authenticated)||authenticated>now+60000||now-authenticated>600000)
    reject("unauthenticated","Sign in again before starting or transferring a scored practice session.","recent-sign-in");
};
async function defaultCatalog(){return import("./practice-courses.mjs");}
function publicAttempt(attempt){
  const result={attemptId:attempt.attemptId,courseId:attempt.courseId,missionId:attempt.missionId,
    state:attempt.state,expiresAt:millis(attempt.expiresAt),catalogVersion:attempt.catalogVersion,
    question:{prompt:attempt.question.prompt,code:attempt.question.code,choices:attempt.question.choices}};
  if(attempt.state==="predicted")Object.assign(result,{reasoning:attempt.reasoning,correctChoice:attempt.question.correct,
    explanation:attempt.question.why,workspace:attempt.question.workspace||null});
  return result;
}
function createPracticeService({db,Timestamp,resolveUser,now=Date.now,randomId=id,catalog=defaultCatalog}){
  const stamp=time=>Timestamp.fromMillis(time);
  async function identity(request){
    const actor=request.auth;
    if(!actor?.uid||actor.token?.email_verified!==true||typeof actor.token.email!=="string")
      reject("unauthenticated","A verified enrolled student sign-in is required.","verified-sign-in");
    const record=await resolveUser(actor.uid);
    if(record.disabled||!record.emailVerified||record.email?.toLowerCase()!==actor.token.email.toLowerCase()||
      (record.tokensValidAfterTime&&Date.parse(record.tokensValidAfterTime)>Number(actor.token.auth_time)*1000))
      reject("unauthenticated","Your sign-in is no longer valid. Sign in again.","revoked-sign-in");
    const profiles=await db.collection("students").where("email","==",actor.token.email.toLowerCase()).limit(11).get();
    if(profiles.empty||profiles.size>10)reject("permission-denied","An enrolled student profile is required.","enrollment");
    return {...actor,email:actor.token.email.toLowerCase(),profiles:profiles.docs};
  }
  async function enrollment(transaction,actor){
    const records=await Promise.all(actor.profiles.map(profile=>transaction.get(profile.ref)));
    if(records.some(record=>!record.exists||record.data().email?.toLowerCase()!==actor.email||
      typeof record.data().section!=="string"||!record.data().section||record.data().status==="disabled"||record.data().active===false))
      reject("permission-denied","Enrollment changed. Reload your student workspace.","enrollment");
    return records.map(record=>({id:record.id,...record.data()}));
  }
  function checkSession(record,request,actor,time){
    const session=record.data();
    if(!session||session.ownerUid!==actor.uid||session.sessionId!==request.data?.sessionId||session.revokedAt||millis(session.expiresAt)<=time)
      reject("failed-precondition","This scored session expired or moved to another sign-in. Resume or transfer practice here.","session-moved");
    return session;
  }
  function checkAttempt(attempt,actor,session,time){
    if(!attempt||attempt.ownerUid!==actor.uid||attempt.sessionId!==session.sessionId||
      session.activeAttemptId!==attempt.attemptId||attempt.catalogVersion!==CATALOG_VERSION||millis(attempt.expiresAt)<=time)
      reject("failed-precondition","This challenge expired or was replaced. Request a new example.","attempt-expired");
  }
  async function acquire(request){
    const actor=await identity(request),time=now(),browserId=request.data?.browserId;
    if(typeof browserId!=="string"||!/^([a-f0-9]{32}|[a-f0-9]{48})$/.test(browserId))
      reject("invalid-argument","A random browser installation key is required.","browser-key");
    const browserHash=hash(browserId),sessionRef=db.doc("practice_sessions/"+actor.uid),browserRef=db.doc("practice_browser_sessions/"+browserHash);
    const sessionId=randomId(),eventId=randomId();
    return db.runTransaction(async transaction=>{
      const [sessionRecord,browserRecord]=await Promise.all([transaction.get(sessionRef),transaction.get(browserRef)]);
      await enrollment(transaction,actor);
      const previous=sessionRecord.data(),browser=browserRecord.data();
      const same=previous&&!previous.revokedAt&&millis(previous.expiresAt)>time&&previous.browserHash===browserHash;
      const accountConflict=previous&&!same&&!previous.revokedAt&&millis(previous.expiresAt)>time;
      const browserConflict=browser&&browser.ownerUid!==actor.uid&&millis(browser.expiresAt)>time;
      if((accountConflict||browserConflict)&&request.data?.takeover!==true)
        reject("failed-precondition","Another scored session is active. Confirm a controlled transfer; no cheating verdict or penalty is applied.","transfer-required");
      if(!same||browserConflict)recent(actor,time);
      const oldSession=browserConflict?await transaction.get(db.doc("practice_sessions/"+browser.ownerUid)):null;
      const oldBrowser=previous?.browserHash&&previous.browserHash!==browserHash?await transaction.get(db.doc("practice_browser_sessions/"+previous.browserHash)):null;
      const nextId=same&&!browserConflict?previous.sessionId:sessionId;
      const after={ownerUid:actor.uid,sessionId:nextId,browserHash,activeAttemptId:same&&!browserConflict?previous.activeAttemptId||null:null,
        createdAt:same?previous.createdAt:stamp(time),expiresAt:stamp(time+1800000),revokedAt:null,
        windowAt:previous?.windowAt||stamp(time),starts:previous?.starts||0};
      if(oldSession?.exists&&oldSession.data().sessionId===browser.sessionId)
        transaction.update(oldSession.ref,{revokedAt:stamp(time),activeAttemptId:null});
      if(oldBrowser?.exists&&oldBrowser.data().ownerUid===actor.uid)
        transaction.delete(oldBrowser.ref);
      transaction.set(sessionRef,after);
      transaction.set(browserRef,{ownerUid:actor.uid,sessionId:nextId,expiresAt:after.expiresAt});
      if(accountConflict||browserConflict)transaction.create(db.doc("practice_security_events/"+eventId),{
        ownerUid:actor.uid,type:browserConflict?"shared-browser-handover":"account-session-transfer",createdAt:stamp(time),expiresAt:stamp(time+30*86400000),
        interpretation:"Session handover only; not proof of who answered or of misconduct."});
      return {sessionId:nextId,expiresAt:time+1800000,transferred:Boolean(accountConflict||browserConflict)};
    });
  }
  async function start(request){
    const actor=await identity(request),time=now(),library=await catalog();
    const course=library.COURSES.find(item=>item.id===request.data?.courseId),mission=course?.missions.find(item=>item.id===request.data?.missionId);
    if(!mission)reject("invalid-argument","Choose a mission from the current catalog.","mission");
    const attemptId=randomId(),seed=randomBytes(4).readInt32BE(),question=mission.build(seed);
    return db.runTransaction(async transaction=>{
      const sessionRef=db.doc("practice_sessions/"+actor.uid),record=await transaction.get(sessionRef);
      const session=checkSession(record,request,actor,time);await enrollment(transaction,actor);
      const module=course.modules.find(item=>item.missions.some(entry=>entry.id===mission.id));
      const position=module.missions.findIndex(item=>item.id===mission.id);
      const progress=await transaction.get(db.doc("practice_verified_progress/"+actor.uid+"/courses/"+course.id));
      const completed=progress.data()?.completed||[];
      if(position>0&&!completed.includes(mission.id)&&!completed.includes(module.missions[position-1].id))
        reject("failed-precondition","Complete the preceding mission in this module first.","prerequisite");
      const active=session.activeAttemptId?await transaction.get(db.doc("practice_attempts/"+session.activeAttemptId)):null;
      const prior=active?.data();
      if(prior?.missionId===mission.id&&prior.courseId===course.id&&["open","predicted"].includes(prior.state)&&millis(prior.expiresAt)>time)
        return publicAttempt(prior);
      const currentWindow=time-millis(session.windowAt)<60000,starts=currentWindow?session.starts||0:0;
      if(starts>=12)reject("resource-exhausted","Too many new examples. Wait a minute and retry.","practice-rate-limit");
      const attempt={ownerUid:actor.uid,sessionId:session.sessionId,attemptId,courseId:course.id,missionId:mission.id,
        catalogVersion:CATALOG_VERSION,state:"open",question,createdAt:stamp(time),expiresAt:stamp(time+7200000)};
      if(prior&&["open","predicted"].includes(prior.state))transaction.update(active.ref,{state:"replaced"});
      transaction.create(db.doc("practice_attempts/"+attemptId),attempt);
      transaction.update(sessionRef,{activeAttemptId:attemptId,starts:starts+1,windowAt:currentWindow?session.windowAt:stamp(time)});
      return publicAttempt(attempt);
    });
  }
  async function predict(request){
    const actor=await identity(request),time=now(),choice=request.data?.choice,reasoning=request.data?.reasoning;
    if(!Number.isInteger(choice)||choice<0||choice>3||typeof reasoning!=="string"||reasoning.trim().length<25||reasoning.length>500)
      reject("invalid-argument","Choose an answer and explain your reasoning in 25–500 characters.","prediction");
    if(!/^[a-f0-9]{48}$/.test(request.data?.attemptId||""))reject("invalid-argument","Invalid challenge.","attempt");
    return db.runTransaction(async transaction=>{
      const [sessionRecord,attemptRecord]=await Promise.all([transaction.get(db.doc("practice_sessions/"+actor.uid)),transaction.get(db.doc("practice_attempts/"+request.data.attemptId))]);
      const session=checkSession(sessionRecord,request,actor,time),attempt=attemptRecord.data();
      await enrollment(transaction,actor);checkAttempt(attempt,actor,session,time);
      if(attempt.state==="predicted"&&attempt.choice===choice&&attempt.reasoning===reasoning.trim())return {...publicAttempt(attempt),correct:true};
      if(attempt.state!=="open")reject("failed-precondition","This prediction was already consumed. Request a new example.","prediction-consumed");
      const correct=choice===attempt.question.correct;
      const after={...attempt,state:correct?"predicted":"incorrect",choice,reasoning:reasoning.trim(),predictedAt:stamp(time)};
      transaction.update(attemptRecord.ref,{state:after.state,choice,reasoning:after.reasoning,predictedAt:after.predictedAt});
      return correct?{...publicAttempt(after),correct:true}:{correct:false,state:"incorrect",message:"Trace the code again, then request a new example. This attempt earned no XP."};
    });
  }
  async function complete(request){
    const actor=await identity(request),time=now(),observation=request.data?.observation,library=await catalog();
    if(!/^[a-f0-9]{48}$/.test(request.data?.attemptId||"")||typeof observation!=="string"||observation.trim().length<25||observation.length>500)
      reject("invalid-argument","Describe the observed result in 25–500 characters.","reflection");
    return db.runTransaction(async transaction=>{
      const [sessionRecord,attemptRecord]=await Promise.all([transaction.get(db.doc("practice_sessions/"+actor.uid)),transaction.get(db.doc("practice_attempts/"+request.data.attemptId))]);
      const session=checkSession(sessionRecord,request,actor,time),attempt=attemptRecord.data(),profiles=await enrollment(transaction,actor);
      checkAttempt(attempt,actor,session,time);
      if(attempt.state==="completed")return {awarded:false,points:10,alreadyRecorded:true};
      if(attempt.state!=="predicted")reject("failed-precondition","Complete a correct server-checked prediction first.","prediction-required");
      if(time-millis(attempt.predictedAt)<3000)reject("failed-precondition","Take time to test the example before recording your comparison.","experiment-pending");
      const course=library.COURSES.find(item=>item.id===attempt.courseId);
      if(!course?.missions.some(item=>item.id===attempt.missionId))reject("failed-precondition","The catalog changed. Request a current example.","catalog-changed");
      const awardRef=db.doc("practice_awards/"+actor.uid+"/missions/"+attempt.missionId),award=await transaction.get(awardRef);
      const progress=await Promise.all(library.COURSES.map(item=>transaction.get(db.doc("practice_verified_progress/"+actor.uid+"/courses/"+item.id))));
      const rankings=await Promise.all(profiles.map(profile=>transaction.get(db.doc("practice_rankings/"+profile.id))));
      if(rankings.some(record=>record.exists&&record.data().verificationVersion===1&&record.data().ownerUid!==actor.uid))
        reject("failed-precondition","This enrollment is linked to another saved account. Ask an administrator to review account linking.","account-linking");
      const current=progress.find(record=>record.id===course.id),existing=current.data()||{};
      const completed=[...new Set([...(existing.completed||[]),attempt.missionId])].filter(missionId=>course.missions.some(item=>item.id===missionId));
      const count=library.COURSES.reduce((total,item)=>total+(item.id===course.id?completed.length:new Set((progress.find(record=>record.id===item.id)?.data()?.completed||[]).filter(missionId=>item.missions.some(mission=>mission.id===missionId))).size),0);
      if(!award.exists)transaction.create(awardRef,{ownerUid:actor.uid,courseId:course.id,missionId:attempt.missionId,attemptId:attempt.attemptId,catalogVersion:CATALOG_VERSION,points:10,awardedAt:stamp(time)});
      transaction.set(current.ref,{ownerUid:actor.uid,courseId:course.id,sections:profiles.map(profile=>profile.section),studentIds:profiles.map(profile=>profile.id),completed,
        reflections:{...(existing.reflections||{}),[attempt.missionId]:("Prediction: "+attempt.reasoning+"\nObserved: "+observation.trim()).slice(0,1000)},updatedAt:stamp(time)});
      for(const profile of profiles){
        transaction.set(db.doc("practice_class_progress/"+profile.id+"/courses/"+course.id),{ownerUid:actor.uid,studentId:profile.id,section:profile.section,courseId:course.id,
          completed,reflections:{...(existing.reflections||{}),[attempt.missionId]:("Prediction: "+attempt.reasoning+"\nObserved: "+observation.trim()).slice(0,1000)},updatedAt:stamp(time)});
        const alias="Learner-"+(library.hashSeed(profile.id)>>>0).toString(36).toUpperCase().padStart(7,"0");
        transaction.set(db.doc("practice_rankings/"+profile.id),{ownerUid:actor.uid,studentId:profile.id,section:profile.section,alias,completedCount:count,points:count*10,catalogMaximum:300,verificationVersion:1,updatedAt:stamp(time)});
      }
      transaction.update(attemptRecord.ref,{state:"completed",observation:observation.trim(),completedAt:stamp(time)});
      return {awarded:!award.exists,points:count*10,completedCount:count,alreadyRecorded:award.exists};
    });
  }
  return {acquire,start,predict,complete,...createPracticeSeasonService({db,Timestamp,resolveUser,now,randomId,catalog,reject})};
}
module.exports={createPracticeService,PracticeError,CATALOG_VERSION};
