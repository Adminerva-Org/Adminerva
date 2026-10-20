import test,{before,after,beforeEach} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {initializeTestEnvironment,assertSucceeds,assertFails} from "@firebase/rules-unit-testing";
import {doc,setDoc,getDoc,updateDoc,deleteDoc,getDocs,query,where,collection,serverTimestamp} from "firebase/firestore";
import {COURSES} from "../js/student/practice-courses.mjs";
import {practiceAlias} from "../js/student/practice-ranking-model.mjs";
let env;const email=id=>id+"@example.test";
const account=(id,verified=true)=>env.authenticatedContext(id,{email:email(id),email_verified:verified}).firestore();
const courseRecord=(id,courseId,completed)=>({ownerUid:id,studentId:id,courseId,completed,reflections:{},updatedAt:serverTimestamp()});
const ranking=(id,count,section="A")=>({ownerUid:id,studentId:id,section,alias:practiceAlias(id),completedCount:count,points:count*10,catalogMaximum:300,updatedAt:serverTimestamp()});
const selection=(id,section)=>({ownerUid:id,studentId:id,section,alias:practiceAlias(id),leaderboardOptIn:false,updatedAt:serverTimestamp()});
before(async()=>{const address=process.env.FIRESTORE_EMULATOR_HOST;assert.match(address||"",/^(127\.0\.0\.1|localhost):\d+$/);const [host,port]=address.split(":");env=await initializeTestEnvironment({projectId:"demo-adminerva-practice-rankings",firestore:{host,port:Number(port),rules:readFileSync("firestore.rules","utf8")}});});
beforeEach(async()=>{await env.clearFirestore();await env.withSecurityRulesDisabled(async context=>{const db=context.firestore();for(const [id,section] of [["alice","A"],["bob","A"],["carol","B"]])await setDoc(doc(db,"students",id),{name:id,email:email(id),section});});});
after(async()=>{await env?.cleanup();});
test("student progress saves without activity consent or teacher approval and valid legacy mission IDs remain available",async()=>{
 const alice=account("alice"),ref=doc(alice,"student_practice_progress","alice","courses","java");
 await assertSucceeds(setDoc(ref,courseRecord("alice","java",["j1","java-m1-02"])));
 await assertSucceeds(setDoc(doc(alice,"practice_rankings","alice"),ranking("alice",2)));
 assert.equal((await getDoc(doc(alice,"practice_rankings","alice"))).data().points,20);
 assert.equal((await getDoc(doc(alice,"activity_preferences","alice"))).exists(),false);
 await assertSucceeds(setDoc(ref,courseRecord("alice","java",["j1","java-m1-02"])));
 await assertSucceeds(setDoc(doc(alice,"practice_rankings","alice"),ranking("alice",2)));
});
test("unknown guests, unverified identities and forged cross-course or duplicated completion IDs cannot save ranked progress",async()=>{
 for(const [id,verified] of [["guest",true],["alice",false]])await assertFails(setDoc(doc(account(id,verified),"student_practice_progress",id,"courses","java"),courseRecord(id,"java",["j1"])));
 const alice=account("alice"),ref=doc(alice,"student_practice_progress","alice","courses","java");
 for(const completed of [["j1","j1"],["p1"],["fake"],Array(76).fill("j1")])await assertFails(setDoc(ref,courseRecord("alice","java",completed)));
 await assertFails(setDoc(ref,{...courseRecord("alice","java",["j1"]),studentId:"bob"}));await assertFails(setDoc(doc(account("bob"),"student_practice_progress","alice","courses","java"),courseRecord("alice","java",["j1"])));
});
test("automatic XP is derived from actual course records, with immutable owner/alias and no manual staff scoring",async()=>{
 const alice=account("alice"),ref=doc(alice,"practice_rankings","alice");
 await assertSucceeds(setDoc(doc(alice,"student_practice_progress","alice","courses","java"),courseRecord("alice","java",["j1"])));
 await assertFails(setDoc(ref,ranking("alice",2)));await assertFails(setDoc(ref,{...ranking("alice",1),points:999}));
 await assertSucceeds(setDoc(ref,ranking("alice",1)));
 for(const change of [{ownerUid:"bob"},{alias:"Learner-ZZZZZZZ"},{alias:"A real name"},{section:"B"},{grade:100}])await assertFails(updateDoc(ref,{...change,updatedAt:serverTimestamp()}));
 await assertFails(deleteDoc(ref));
 const admin=env.authenticatedContext("admin",{email:"babaynike2013@gmail.com",email_verified:true}).firestore();
 await assertFails(updateDoc(doc(admin,"practice_rankings","alice"),{points:3000,updatedAt:serverTimestamp()}));
});
test("class-only alias queries work without legacy opt-in, and private reflections remain inaccessible to peers",async()=>{
 const alice=account("alice"),bob=account("bob"),carol=account("carol");
 await setDoc(doc(alice,"student_practice_progress","alice","courses","java"),courseRecord("alice","java",["j1"]));await setDoc(doc(alice,"practice_rankings","alice"),ranking("alice",1));
 await setDoc(doc(bob,"practice_profiles","bob"),selection("bob","A"));await setDoc(doc(carol,"practice_profiles","carol"),selection("carol","B"));
 const rows=await assertSucceeds(getDocs(query(collection(bob,"practice_rankings"),where("section","==","A"))));assert.equal(rows.size,1);
 await assertFails(getDocs(collection(bob,"practice_rankings")));await assertFails(getDoc(doc(carol,"practice_rankings","alice")));await assertFails(getDocs(query(collection(carol,"practice_rankings"),where("section","==","A"))));
 await assertFails(getDoc(doc(bob,"student_practice_progress","alice","courses","java")));
 await env.withSecurityRulesDisabled(context=>updateDoc(doc(context.firestore(),"students","bob"),{section:"B"}));
 await assertFails(getDocs(query(collection(bob,"practice_rankings"),where("section","==","A"))));
});
test("all four 75-mission courses fit permission bounds without changing school-grade records",async()=>{
 const alice=account("alice");for(const course of COURSES)await assertSucceeds(setDoc(doc(alice,"student_practice_progress","alice","courses",course.id),courseRecord("alice",course.id,course.missions.map(mission=>mission.id))));
 await assertSucceeds(setDoc(doc(alice,"practice_rankings","alice"),ranking("alice",300)));
 assert.equal((await getDoc(doc(alice,"practice_rankings","alice"))).data().points,3000);
});
