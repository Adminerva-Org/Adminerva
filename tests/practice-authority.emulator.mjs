import test,{before,after,beforeEach} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {initializeTestEnvironment,assertFails,assertSucceeds} from "@firebase/rules-unit-testing";
import {initializeApp,deleteApp} from "firebase-admin/app";
import {getFirestore,Timestamp,FieldValue} from "firebase-admin/firestore";
import {doc,getDoc,setDoc,updateDoc,getDocs,collection,query,where} from "firebase/firestore";
import backend from "../functions/practice-service.js";
import projection from "../functions/teaching-access-service.js";
import {COURSES} from "../functions/practice-courses.mjs";
import preparation from "../functions/academic-preparation.js";
const projectId="demo-adminerva-practice-authority",teacherEmail="josephsixson@mcstayuman.edu.ph";
let env,app,db,service,access,clock;
const email=uid=>uid+"@example.test";
const identity=(uid,age=0)=>({uid,token:{email:email(uid),email_verified:true,auth_time:Math.floor((clock-age)/1000)}});
const request=(uid,data,age=0)=>({auth:identity(uid,age),data});
const browserA="a".repeat(32),browserB="b".repeat(32);
const client=(uid,address=email(uid))=>env.authenticatedContext(uid,{email:address,email_verified:true}).firestore();
async function challenge(uid="alice",browserId=browserA){const session=await service.acquire(request(uid,{browserId}));const attempt=await service.start(request(uid,{sessionId:session.sessionId,courseId:"java",missionId:"j1"}));return {session,...attempt};}
async function predictCorrect(challengeData,uid="alice"){
  const stored=(await db.doc("practice_attempts/"+challengeData.attemptId).get()).data();
  return service.predict(request(uid,{sessionId:challengeData.session.sessionId,attemptId:stored.attemptId,choice:stored.question.correct,reasoning:"I traced the statements in order and checked the changing value."}));
}
before(async()=>{
  assert.match(process.env.FIRESTORE_EMULATOR_HOST||"",/^(127\.0\.0\.1|localhost):\d+$/);
  env=await initializeTestEnvironment({projectId,firestore:{rules:readFileSync("firestore.rules","utf8")}});
  app=initializeApp({projectId},projectId);db=getFirestore(app);
  service=backend.createPracticeService({db,Timestamp,now:()=>clock,resolveUser:async uid=>({email:email(uid),emailVerified:true,disabled:uid==="disabled"})});
  access=projection.createTeachingAccessService({db,Timestamp,now:()=>clock});
});
after(async()=>{await env?.cleanup();if(app)await deleteApp(app);});
beforeEach(async()=>{
  clock=Date.now();await env.clearFirestore();
  await Promise.all([db.doc("students/alice").set({name:"Alice",email:email("alice"),section:"A",githubToken:"private-token-never-for-teachers",repoUrl:"https://github.com/example/app"}),
    db.doc("students/bob").set({name:"Bob",email:email("bob"),section:"B"}),
    db.doc("staff_access/"+teacherEmail).set({email:teacherEmail,role:"teacher",status:"active",sections:["A"]}),
    db.doc("assessments/task").set({ownerUid:"admin",sectionIds:["A"],deployments:[{section:"A"}],title:"Task",schemaVersion:2,maxScore:20})]);
  await access.synchronize("alice");await access.synchronize("bob");
});
test("ranked attempts hide answers and reject client-forged awards, totals and completion records",async()=>{
  const current=await challenge(),alice=client("alice");
  assert.equal(current.question.correct,undefined);assert.equal(current.question.why,undefined);assert.equal(current.correctChoice,undefined);
  await assertFails(getDoc(doc(alice,"practice_attempts",current.attemptId)));
  for(const path of [["practice_sessions","alice"],["practice_rankings","alice"],["practice_verified_progress","alice","courses","java"],["practice_awards","alice","missions","j1"],["student_practice_progress","alice","courses","java"]])await assertFails(setDoc(doc(alice,...path),{ownerUid:"alice",completed:["j1"],points:999}));
  await assert.rejects(service.complete(request("alice",{sessionId:current.session.sessionId,attemptId:current.attemptId,observation:"A forged comparison cannot replace the server prediction."})),error=>error.details.reason==="prediction-required");
});
test("one consumed prediction and concurrent/replayed completions award a unique mission exactly once",async()=>{
  const current=await challenge();await predictCorrect(current);clock+=4000;
  const payload={sessionId:current.session.sessionId,attemptId:current.attemptId,observation:"I ran the example and compared the printed value with my prediction."};
  const results=await Promise.all([service.complete(request("alice",payload)),service.complete(request("alice",payload))]);
  assert.equal(results.filter(result=>result.awarded).length,1);
  assert.equal((await db.doc("practice_rankings/alice").get()).data().points,10);
  assert.equal((await db.collection("practice_awards/alice/missions").get()).size,1);
  assert.equal((await service.complete(request("alice",payload))).awarded,false);
  assert.equal((await db.collection("student_grades").get()).size,0);
});
test("legacy/local completion claims never become verified XP",async()=>{
  await db.doc("student_practice_progress/alice/courses/java").set({ownerUid:"alice",completed:["j1","j2","j3","j4"]});
  await db.doc("practice_rankings/alice").set({ownerUid:"alice",section:"A",points:9000});
  const current=await challenge();await predictCorrect(current);clock+=4000;
  await service.complete(request("alice",{sessionId:current.session.sessionId,attemptId:current.attemptId,observation:"The displayed output matched the sequence of variable updates."}));
  const ranking=(await db.doc("practice_rankings/alice").get()).data();assert.equal(ranking.points,10);assert.equal(ranking.verificationVersion,1);
  assert.equal((await db.doc("student_practice_progress/alice/courses/java").get()).data().completed.length,4);
});
test("incorrect predictions cannot brute-force the same attempt or borrow another account's challenge",async()=>{
  const current=await challenge(),answer=(await db.doc("practice_attempts/"+current.attemptId).get()).data().question.correct;
  const payload={sessionId:current.session.sessionId,attemptId:current.attemptId,choice:(answer+1)%4,reasoning:"I traced this particular example and selected one predicted result."};
  assert.equal((await service.predict(request("alice",payload))).correct,false);
  await assert.rejects(service.predict(request("alice",{...payload,choice:answer})),error=>error.details.reason==="prediction-consumed");
  await assert.rejects(service.predict(request("bob",{...payload,choice:answer})),error=>error.details.reason==="session-moved");
});
test("device transfers require recent sign-in, invalidate old attempts and never create a misconduct penalty",async()=>{
  const old=await challenge();await predictCorrect(old);
  await assert.rejects(service.acquire(request("alice",{browserId:browserB})),error=>error.details.reason==="transfer-required");
  await assert.rejects(service.acquire(request("alice",{browserId:browserB,takeover:true},700000)),error=>error.details.reason==="recent-sign-in");
  const next=await service.acquire(request("alice",{browserId:browserB,takeover:true}));assert.equal(next.transferred,true);
  await assert.rejects(service.complete(request("alice",{sessionId:old.session.sessionId,attemptId:old.attemptId,observation:"This old session may not earn points after a controlled device transfer."})),error=>error.details.reason==="session-moved");
  const event=(await db.collection("practice_security_events").get()).docs[0].data();assert.equal(event.type,"account-session-transfer");assert.match(event.interpretation,/not proof/);
  assert.equal((await db.doc("practice_rankings/alice").get()).exists,false);
});
test("shared-browser account handovers are allowed explicitly, isolate identities and revoke the previous lease",async()=>{
  const old=await challenge();
  await assert.rejects(service.acquire(request("bob",{browserId:browserA})),error=>error.details.reason==="transfer-required");
  const next=await service.acquire(request("bob",{browserId:browserA,takeover:true}));
  assert.equal(next.transferred,true);assert.equal(next.ownerUid,undefined);
  await assert.rejects(service.start(request("alice",{sessionId:old.session.sessionId,courseId:"java",missionId:"j1"})),error=>error.details.reason==="session-moved");
  assert.equal((await db.collection("practice_security_events").get()).docs[0].data().type,"shared-browser-handover");
});
test("challenge replacement, expiry, verified enrollment and rate limits fail closed",async()=>{
  const current=await challenge();
  const alternate=COURSES[0].modules[1].missions[0].id;
  const replaced=await service.start(request("alice",{sessionId:current.session.sessionId,courseId:"java",missionId:alternate}));
  await assert.rejects(predictCorrect(current),error=>error.details.reason==="attempt-expired");
  for(let index=0;index<10;index++)await service.start(request("alice",{sessionId:current.session.sessionId,courseId:"java",missionId:index%2?alternate:"j1"}));
  await assert.rejects(service.start(request("alice",{sessionId:current.session.sessionId,courseId:"java",missionId:"j1"})),error=>error.code==="resource-exhausted");
  clock+=7200001;
  await assert.rejects(service.predict(request("alice",{sessionId:current.session.sessionId,attemptId:replaced.attemptId,choice:0,reasoning:"Expired challenges never become accepted scored completion records."})),error=>error.details.reason==="session-moved");
  await assert.rejects(service.acquire(request("guest",{browserId:browserB})),error=>error.details.reason==="enrollment");
  const unverified=request("alice",{browserId:browserA});unverified.auth.token.email_verified=false;
  await assert.rejects(service.acquire(unverified),error=>error.details.reason==="verified-sign-in");
});

test("mission prerequisites use verified progress, not local or legacy completion claims",async()=>{
  const current=await challenge();
  const next=COURSES[0].modules[0].missions[1].id;
  const payload={sessionId:current.session.sessionId,courseId:"java",missionId:next};
  await db.doc("student_practice_progress/alice/courses/java").set({ownerUid:"alice",completed:["j1"]});
  await assert.rejects(service.start(request("alice",payload)),error=>error.details.reason==="prerequisite");
  await predictCorrect(current);clock+=4000;
  await service.complete(request("alice",{sessionId:current.session.sessionId,attemptId:current.attemptId,observation:"I compared the predicted output with the observed variable changes."}));
  assert.equal((await service.start(request("alice",payload))).missionId,next);
});
test("teachers see only assigned credential-free roster projections and cannot self-assign sections",async()=>{
  const teacher=client("teacher",teacherEmail);
  await assertSucceeds(getDocs(query(collection(teacher,"teaching_roster"),where("section","==","A"))));
  await assertFails(getDocs(collection(teacher,"teaching_roster")));
  await assertFails(getDoc(doc(teacher,"students","alice")));await assertFails(getDoc(doc(teacher,"teaching_roster","bob")));
  const visible=(await getDoc(doc(teacher,"teaching_roster","alice"))).data();assert.equal(visible.githubToken,undefined);
  await assertFails(updateDoc(doc(teacher,"staff_access",teacherEmail),{sections:["A","B"]}));
  await assertFails(setDoc(doc(teacher,"unknown_collection","escape"),{section:"A"}));
  await db.doc("staff_access/"+teacherEmail).update({sections:["B"]});
  await assertFails(getDoc(doc(teacher,"teaching_roster","alice")));await assertSucceeds(getDoc(doc(teacher,"teaching_roster","bob")));
});
test("legacy activity grading remains scoped and teacher cache writes cannot change global counters",async()=>{
  const teacher=client("teacher",teacherEmail),grade={studentId:"alice",section:"A",githubUsername:"alice",activity:"Practice activity",score:5,maxScore:10,gradedAt:new Date().toISOString()};
  const ref=doc(teacher,"activity_grades","alice_activity");await assertSucceeds(setDoc(ref,grade));
  await assertFails(setDoc(doc(teacher,"activity_grades","bob_activity"),{...grade,studentId:"bob",section:"B"}));
  await assertFails(updateDoc(ref,{studentId:"bob",section:"B"}));await assertFails(updateDoc(ref,{score:11}));
  await assertFails(setDoc(doc(teacher,"system","ai_usage_today"),{requests:1}));
  await assertSucceeds(setDoc(doc(teacher,"teacher_materials","teacher","system","ai_usage_today"),{requests:1}));
});
test("assessment scope cannot deploy to another class, change ownership or downgrade protected V2 semantics",async()=>{
  const teacher=client("teacher",teacherEmail),ref=doc(teacher,"assessments","owned");
  const task={ownerUid:"teacher",sectionIds:["A"],deployments:[{section:"A"}],title:"Owned",schemaVersion:2,maxScore:20};
  await assertSucceeds(setDoc(ref,task));
  await assertFails(updateDoc(ref,{deployments:[{section:"B"}]}));await assertFails(updateDoc(ref,{sectionIds:["B"]}));
  await assertFails(updateDoc(ref,{ownerUid:"other-teacher"}));await assertFails(updateDoc(ref,{schemaVersion:1}));
  await db.doc("assessments/other").set({...task,ownerUid:"someone",sectionIds:["B"],deployments:[{section:"B"}]});
  await assertFails(getDoc(doc(teacher,"assessments","other")));await assertFails(getDocs(collection(teacher,"assessments")));
});
test("roster transfers revoke private practice access immediately and remove stale rankings without changing grades",async()=>{
  const current=await challenge();await predictCorrect(current);clock+=4000;
  await service.complete(request("alice",{sessionId:current.session.sessionId,attemptId:current.attemptId,observation:"This completed exercise is separate from school grades and personal identity proof."}));
  const teacher=client("teacher",teacherEmail),peer=client("bob");
  await assertSucceeds(getDoc(doc(teacher,"practice_class_progress","alice","courses","java")));
  await assertFails(getDoc(doc(peer,"practice_verified_progress","alice","courses","java")));
  await db.doc("students/alice").update({section:"B"});
  await assertFails(getDoc(doc(teacher,"practice_class_progress","alice","courses","java")));
  await access.synchronize("alice");assert.equal((await db.doc("practice_rankings/alice").get()).exists,false);
  await assertFails(getDoc(doc(teacher,"teaching_roster","alice")));
  assert.equal((await db.collection("student_grades").get()).size,0);
});

async function accessPlan(){
  const names=["students","teaching_roster","assessments","assessment_private","student_grades"];
  const records=Object.fromEntries(await Promise.all(names.map(async name=>[name,(await db.collection(name).get()).docs.map(record=>({id:record.id,path:record.ref.path,data:record.data(),version:preparation.version(record)}))])));
  return preparation.planAcademicAccess(records,"admin");
}
test("scope preparation is explicit, audited and preserves protected score, feedback and publication fields",async()=>{
  const original={studentId:"alice",taskId:"task",score:17,feedback:"Protected teacher feedback",published:true,evidenceRevision:3};
  await db.doc("student_grades/alice_task").set(original);
  const plan=await accessPlan();assert.equal(plan.blockers.length,0);assert.equal(plan.counts.student_grades,1);
  assert.equal((await db.doc("student_grades/alice_task").get()).data().section,undefined);
  const operation=preparation.createAcademicPreparation({db,FieldValue});
  await operation.apply(plan,{actorUid:"admin",runId:"test-preparation-1"});
  const after=(await db.doc("student_grades/alice_task").get()).data();assert.deepEqual(after,{...original,section:"A"});
  await operation.apply(plan,{actorUid:"admin",runId:"test-preparation-1"});
  const audits=await db.collection("academic_access_preparations/test-preparation-1/changes").get();assert.equal(audits.size,plan.changes.length);
  const audit=doc(client("teacher",teacherEmail),"academic_access_preparations","test-preparation-1","changes",audits.docs[0].id);
  await assertFails(getDoc(audit));await assertFails(setDoc(audit,{actorUid:"teacher"}));
});
test("scope preparation rejects a canonical roster change after dry-run and never guesses missing student identity",async()=>{
  await db.doc("student_grades/alice_task").set({studentId:"alice",taskId:"task",score:17,published:false});
  const plan=await accessPlan();await db.doc("students/alice").update({section:"B"});
  await assert.rejects(preparation.createAcademicPreparation({db,FieldValue}).apply(plan,{actorUid:"admin",runId:"test-preparation-2"}),/Records changed/);
  assert.equal((await db.doc("student_grades/alice_task").get()).data().section,undefined);
  await db.doc("student_grades/orphan_task").set({studentId:"missing",taskId:"task",score:10});
  assert.ok((await accessPlan()).blockers.some(blocker=>blocker.path==="student_grades/orphan_task"));
});
