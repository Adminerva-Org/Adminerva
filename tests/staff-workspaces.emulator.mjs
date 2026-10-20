import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {initializeTestEnvironment,assertSucceeds,assertFails} from "@firebase/rules-unit-testing";
import {doc,setDoc,getDoc,updateDoc,deleteDoc,writeBatch,serverTimestamp,collection,getDocs,query,where} from "firebase/firestore";
let env;
const adminEmail="babaynike2013@gmail.com",firstEmail="first.teacher@example.edu",secondEmail="second.teacher@example.edu";
const profile=email=>({email,displayName:email,role:"teacher",status:"active",revision:1,reason:"Initial test authorization",updatedBy:"admin",updatedAt:new Date()});
const lesson=ownerUid=>({ownerUid,version:1,sessions:[],weekly_overview:{},subject_title:"Same subject"});
function account(uid,email,verified=true){return env.authenticatedContext(uid,{email,email_verified:verified}).firestore();}
before(async()=>{
  const address=process.env.FIRESTORE_EMULATOR_HOST;
  assert.match(address||"",/^(127\.0\.0\.1|localhost):\d+$/);
  const [host,port]=address.split(":");
  env=await initializeTestEnvironment({projectId:"demo-adminerva-workspaces",firestore:{host,port:Number(port),rules:readFileSync("firestore.rules","utf8")}});
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context=>{
    await setDoc(doc(context.firestore(),"staff_access",firstEmail),profile(firstEmail));
    await setDoc(doc(context.firestore(),"staff_access",secondEmail),profile(secondEmail));
    await setDoc(doc(context.firestore(),"lesson_plans","legacy"),{sessions:[],teacher_name:"Unknown shared owner"});
  });
});
after(async()=>{await env?.cleanup();});

test("separate owners can save the same lesson ID without cross-account writes or reads",async()=>{
  const first=account("first",firstEmail),second=account("second",secondEmail),admin=account("admin",adminEmail);
  await assertSucceeds(setDoc(doc(first,"staff_workspaces","first","lesson_plans","same"),lesson("first")));
  await assertSucceeds(setDoc(doc(second,"staff_workspaces","second","lesson_plans","same"),lesson("second")));
  await assertFails(getDoc(doc(first,"staff_workspaces","second","lesson_plans","same")));
  await assertFails(setDoc(doc(first,"staff_workspaces","second","lesson_plans","forged"),lesson("second")));
  await assertSucceeds(getDoc(doc(admin,"staff_workspaces","first","lesson_plans","same")));
  await assertFails(setDoc(doc(admin,"staff_workspaces","first","lesson_plans","admin-overwrite"),lesson("first")));
});
test("students, unknown kinds and unverified teacher identities cannot create personal staff records",async()=>{
  const student=account("student","student@example.edu"),unverified=account("unverified",firstEmail,false),first=account("first",firstEmail);
  await assertFails(setDoc(doc(student,"staff_workspaces","student","lesson_plans","new"),lesson("student")));
  await assertFails(setDoc(doc(unverified,"staff_workspaces","unverified","lesson_plans","new"),lesson("unverified")));
  await assertFails(setDoc(doc(first,"staff_workspaces","first","unknown","new"),{ownerUid:"first",version:1}));
  await assertFails(setDoc(doc(first,"staff_workspaces","first","lesson_plans","forged-owner"),lesson("second")));
});
test("teacher connection profiles remain private and cannot grant or modify staff authority",async()=>{
  const first=account("first",firstEmail),second=account("second",secondEmail),student=account("student","student@example.edu");
  const empty=await assertSucceeds(getDocs(query(collection(first,"teachers"),where("email","==",firstEmail))));assert.equal(empty.empty,true);
  await assertSucceeds(setDoc(doc(first,"teachers","first"),{email:firstEmail,name:"First teacher",uid:"first"}));
  await assertSucceeds(updateDoc(doc(first,"teachers","first"),{githubToken:"synthetic-not-a-real-token",githubUsername:"fixture-first"}));
  await assertFails(getDoc(doc(second,"teachers","first")));await assertFails(getDocs(collection(second,"teachers")));
  await assertFails(updateDoc(doc(first,"teachers","first"),{role:"admin"}));await assertFails(updateDoc(doc(first,"teachers","first"),{email:secondEmail}));
  await assertFails(setDoc(doc(student,"teachers","student"),{email:"student@example.edu",name:"Fake teacher",uid:"student"}));
});
test("personal updates require the next version and immutable matching history",async()=>{
  const first=account("first",firstEmail),ref=doc(first,"staff_workspaces","first","lesson_plans","versioned"),before=lesson("first");
  await assertSucceeds(setDoc(ref,before));
  await assertFails(updateDoc(ref,{version:2,subject_title:"Unaudited overwrite"}));
  const batch=writeBatch(first);batch.set(ref,{...before,version:2,subject_title:"Reviewed edit"});batch.set(doc(ref,"revisions","1"),{...before,archivedRevisionAt:serverTimestamp()});await assertSucceeds(batch.commit());
  await assertFails(updateDoc(ref,{version:2,subject_title:"Stale overwrite"}));
  await assertFails(updateDoc(doc(ref,"revisions","1"),{subject_title:"Tampered"}));await assertFails(deleteDoc(doc(ref,"revisions","1")));
  await assertFails(updateDoc(ref,{ownerUid:"second"}));
});
test("archive and restore change flags only, and deletion requires prior archiving",async()=>{
  const first=account("first",firstEmail),ref=doc(first,"staff_workspaces","first","lesson_plans","archive-test");await assertSucceeds(setDoc(ref,lesson("first")));
  await assertFails(deleteDoc(ref));await assertSucceeds(updateDoc(ref,{is_archived:true}));await assertSucceeds(updateDoc(ref,{is_archived:false}));
  await assertFails(updateDoc(ref,{is_archived:true,subject_title:"Hidden overwrite"}));await assertSucceeds(updateDoc(ref,{is_archived:true}));await assertSucceeds(deleteDoc(ref));
});
test("preferences and schedules are owner-scoped and oversized schedules are rejected",async()=>{
  const first=account("first",firstEmail),second=account("second",secondEmail);
  await assertSucceeds(setDoc(doc(first,"staff_workspaces","first","preferences","lesson_review_config"),{teacher_name:"First teacher"}));
  await assertFails(getDoc(doc(second,"staff_workspaces","first","preferences","lesson_review_config")));
  const schedule={ownerUid:"first",version:1,json_data:"[]",raw_text:""};
  await assertSucceeds(setDoc(doc(first,"staff_workspaces","first","schedules","same-semester"),schedule));
  await assertFails(setDoc(doc(first,"staff_workspaces","first","schedules","oversized"),{...schedule,raw_text:"x".repeat(100001)}));
});
test("legacy shared plans are preserved for administrator inspection, never rewritten",async()=>{
  const admin=account("admin",adminEmail),first=account("first",firstEmail);
  await assertSucceeds(getDoc(doc(admin,"lesson_plans","legacy")));await assertFails(getDoc(doc(first,"lesson_plans","legacy")));
  await assertFails(setDoc(doc(admin,"lesson_plans","legacy"),{teacher_name:"Reassigned"}));await assertFails(deleteDoc(doc(admin,"lesson_plans","legacy")));
  await assertFails(setDoc(doc(first,"app_config","master_schedule"),{raw_text:"Shared overwrite"}));
});
test("only administrator-audited admission grants a new teacher access",async()=>{
  const email="new.teacher@example.edu",newTeacher=account("new",email),admin=account("admin",adminEmail),ref=doc(admin,"staff_access",email);
  await assertFails(setDoc(doc(newTeacher,"staff_access",email),profile(email)));await assertFails(setDoc(ref,profile(email)));
  const after={...profile(email),updatedAt:serverTimestamp()};
  const batch=writeBatch(admin);batch.set(ref,after);batch.set(doc(ref,"revisions","1"),{before:null,after,actorUid:"admin",createdAt:serverTimestamp()});await assertSucceeds(batch.commit());
  await assertSucceeds(setDoc(doc(newTeacher,"staff_workspaces","new","lesson_plans","new"),lesson("new")));
  await assertFails(getDocs(collection(newTeacher,"activity_events")));await assertFails(getDocs(collection(newTeacher,"staff_access")));
  await assertFails(updateDoc(doc(ref,"revisions","1"),{actorUid:"new"}));
});
test("disabling a managed teacher immediately removes staff access without deleting records",async()=>{
  const email="disabled.teacher@example.edu",admin=account("admin",adminEmail),ref=doc(admin,"staff_access",email),before=profile(email);
  await env.withSecurityRulesDisabled(async context=>{await setDoc(doc(context.firestore(),"staff_access",email),before);});
  const teacher=account("disabled",email);await assertSucceeds(setDoc(doc(teacher,"staff_workspaces","disabled","lesson_plans","kept"),lesson("disabled")));
  const after={...before,status:"disabled",revision:2,updatedAt:serverTimestamp()},batch=writeBatch(admin);batch.set(ref,after);batch.set(doc(ref,"revisions","2"),{before,after,actorUid:"admin",createdAt:serverTimestamp()});await assertSucceeds(batch.commit());
  await assertFails(getDoc(doc(teacher,"staff_workspaces","disabled","lesson_plans","kept")));await assertSucceeds(getDoc(doc(admin,"staff_workspaces","disabled","lesson_plans","kept")));
});
