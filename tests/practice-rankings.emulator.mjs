import test,{before,after,beforeEach} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {initializeTestEnvironment,assertSucceeds,assertFails} from "@firebase/rules-unit-testing";
import {doc,setDoc,getDoc,updateDoc,deleteDoc,getDocs,query,where,collection,serverTimestamp} from "firebase/firestore";
import {COURSES} from "../js/student/practice-courses.mjs";
import {practiceAlias} from "../js/student/practice-ranking-model.mjs";
let environment;
const email=identity=>identity+"@example.test";
const account=(identity,verified=true)=>environment.authenticatedContext(identity,{email:email(identity),email_verified:verified}).firestore();
const ranking=(identity,count,section="A")=>({ownerUid:identity,studentId:identity,section,alias:practiceAlias(identity),completedCount:count,points:count*10,catalogMaximum:300,verificationVersion:1,updatedAt:serverTimestamp()});
const selection=(identity,section)=>({ownerUid:identity,studentId:identity,section,alias:practiceAlias(identity),leaderboardOptIn:false,updatedAt:serverTimestamp()});
before(async()=>{
 const address=process.env.FIRESTORE_EMULATOR_HOST;assert.match(address||"",/^(127\.0\.0\.1|localhost):\d+$/);
 const [host,port]=address.split(":");
 environment=await initializeTestEnvironment({projectId:"demo-adminerva-practice-rankings",firestore:{host,port:Number(port),rules:readFileSync("firestore.rules","utf8")}});
});
beforeEach(async()=>{
 await environment.clearFirestore();
 await environment.withSecurityRulesDisabled(async context=>{
  for(const [identity,section] of [["alice","A"],["bob","A"],["carol","B"]])await setDoc(doc(context.firestore(),"students",identity),{name:identity,email:email(identity),section});
 });
});
after(async()=>{await environment?.cleanup();});
test("ranked XP requires server writes, never activity consent, student claims or manual staff approval",async()=>{
 const alice=account("alice");
 for(const parts of [["practice_rankings","alice"],["practice_verified_progress","alice","courses","java"],["student_practice_progress","alice","courses","java"]])
  await assertFails(setDoc(doc(alice,...parts),{ownerUid:"alice",completed:["j1"],points:10}));
 await environment.withSecurityRulesDisabled(context=>setDoc(doc(context.firestore(),"practice_rankings","alice"),ranking("alice",1)));
 assert.equal((await assertSucceeds(getDoc(doc(alice,"practice_rankings","alice")))).data().points,10);
 assert.equal((await getDoc(doc(alice,"activity_preferences","alice"))).exists(),false);
});
test("unknown guests and unverified identities cannot manufacture ranked progress",async()=>{
 for(const [identity,verified] of [["guest",true],["alice",false]])
  await assertFails(setDoc(doc(account(identity,verified),"practice_rankings",identity),ranking(identity,1)));
});
test("neither students nor administrator browser clients may forge, change or delete server-owned totals",async()=>{
 await environment.withSecurityRulesDisabled(context=>setDoc(doc(context.firestore(),"practice_rankings","alice"),ranking("alice",1)));
 const admin=environment.authenticatedContext("admin",{email:"babaynike2013@gmail.com",email_verified:true}).firestore();
 for(const database of [account("alice"),admin]){
  for(const change of [{points:999},{ownerUid:"bob"},{alias:"A real name"},{section:"B"},{grade:100}])
   await assertFails(updateDoc(doc(database,"practice_rankings","alice"),change));
  await assertFails(deleteDoc(doc(database,"practice_rankings","alice")));
 }
});
test("class-only alias queries work without opt-in and immediately revoke access after a class transfer",async()=>{
 const alice=account("alice"),bob=account("bob"),carol=account("carol");
 await environment.withSecurityRulesDisabled(async context=>{
  await setDoc(doc(context.firestore(),"practice_rankings","alice"),ranking("alice",1));
  await setDoc(doc(context.firestore(),"practice_verified_progress","alice","courses","java"),{ownerUid:"alice",completed:["j1"],reflections:{j1:"Private explanation"}});
 });
 await setDoc(doc(bob,"practice_profiles","bob"),selection("bob","A"));
 await setDoc(doc(carol,"practice_profiles","carol"),selection("carol","B"));
 assert.equal((await assertSucceeds(getDocs(query(collection(bob,"practice_rankings"),where("section","==","A"))))).size,1);
 await assertFails(getDocs(collection(bob,"practice_rankings")));
 await assertFails(getDoc(doc(carol,"practice_rankings","alice")));
 await assertFails(getDoc(doc(bob,"practice_verified_progress","alice","courses","java")));
 await assertSucceeds(getDoc(doc(alice,"practice_verified_progress","alice","courses","java")));
 await environment.withSecurityRulesDisabled(context=>updateDoc(doc(context.firestore(),"students","bob"),{section:"B"}));
 await assertFails(getDocs(query(collection(bob,"practice_rankings"),where("section","==","A"))));
});
test("the full 300-mission verified catalog fits class standings without school-grade records",async()=>{
 const total=COURSES.reduce((count,course)=>count+course.missions.length,0);assert.equal(total,300);
 await environment.withSecurityRulesDisabled(context=>setDoc(doc(context.firestore(),"practice_rankings","alice"),ranking("alice",total)));
 assert.equal((await getDoc(doc(account("alice"),"practice_rankings","alice"))).data().points,3000);
});
