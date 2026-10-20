import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {initializeTestEnvironment,assertSucceeds,assertFails} from "@firebase/rules-unit-testing";
import {doc,setDoc,getDoc,getDocs,updateDoc,deleteDoc,collection,query,where,orderBy,limit,serverTimestamp,writeBatch} from "firebase/firestore";
let env;
const adminEmail="babaynike2013@gmail.com";
const account=(uid,email,verified=true)=>env.authenticatedContext(uid,{email,email_verified:verified}).firestore();
const pending=(uid,email)=>({ownerUid:uid,email,displayName:"Fixture guest",requestedRole:"teacher",status:"pending",revision:0,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
before(async()=>{
 const address=process.env.FIRESTORE_EMULATOR_HOST;assert.match(address||"",/^(127\.0\.0\.1|localhost):\d+$/);const [host,port]=address.split(":");
 env=await initializeTestEnvironment({projectId:"demo-adminerva-admissions",firestore:{host,port:Number(port),rules:readFileSync("firestore.rules","utf8")}});
 await env.clearFirestore();await env.withSecurityRulesDisabled(async context=>{const db=context.firestore();await setDoc(doc(db,"staff_access","teacher@example.edu"),{email:"teacher@example.edu",role:"teacher",status:"active"});await setDoc(doc(db,"students","existing"),{email:"enrolled@example.edu",name:"Existing student",section:"11-A",repoUrl:"unassigned"});});
});
after(async()=>{await env?.cleanup();});
test("new verified accounts can create only their own bounded pending request",async()=>{
 const guest=account("first","first@example.edu"),ref=doc(guest,"account_requests","first");
 await assertSucceeds(setDoc(ref,pending("first","first@example.edu")));
 await assertFails(setDoc(doc(guest,"account_requests","other"),pending("other","first@example.edu")));
 await assertFails(setDoc(doc(guest,"account_requests","forged"),{...pending("forged","first@example.edu"),status:"approved",approvedRole:"teacher"}));
 await assertFails(setDoc(doc(account("unverified","unverified@example.edu",false),"account_requests","unverified"),pending("unverified","unverified@example.edu")));
 await assertFails(updateDoc(ref,{email:"someone@example.edu",updatedAt:serverTimestamp()}));await assertFails(updateDoc(ref,{displayName:"x".repeat(121),updatedAt:serverTimestamp()}));
 await assertSucceeds(updateDoc(ref,{requestedRole:"student",updatedAt:serverTimestamp()}));
 await assertFails(updateDoc(ref,{role:"admin",updatedAt:serverTimestamp()}));await assertFails(deleteDoc(ref));
});
test("guest requests are private; guest, teacher and unauthenticated listing are denied",async()=>{
 const guest=account("first","first@example.edu"),other=account("other","other@example.edu"),teacher=account("teacher","teacher@example.edu"),admin=account("admin",adminEmail);
 await assertSucceeds(getDoc(doc(guest,"account_requests","first")));await assertFails(getDoc(doc(other,"account_requests","first")));
 for(const db of [guest,teacher,env.unauthenticatedContext().firestore()])await assertFails(getDocs(collection(db,"account_requests")));
 await assertSucceeds(getDocs(query(collection(admin,"account_requests"),orderBy("createdAt","desc"),limit(100))));
 for(const name of ["students","assessment_evidence","student_grades","lesson_plans","activity_events"])await assertFails(getDocs(collection(guest,name)));
 await assertSucceeds(getDocs(query(collection(guest,"students"),where("email","==","first@example.edu"))));
});
async function requestFor(uid,email){const db=account(uid,email);await setDoc(doc(db,"account_requests",uid),pending(uid,email));return (await getDoc(doc(db,"account_requests",uid))).data();}
function decisionBatch(db,uid,before,changes){
 const ref=doc(db,"account_requests",uid),after={...before,...changes,revision:1,decidedBy:"admin",reason:"School verified the requested identity.",updatedAt:serverTimestamp()},batch=writeBatch(db);
 batch.set(ref,after);batch.set(doc(ref,"revisions","1"),{before,after,actorUid:"admin",createdAt:serverTimestamp()});return batch;
}
test("teacher approval requires administrator identity, immutable audit and matching active staff record",async()=>{
 const uid="admit-teacher",email="admit@example.edu",before=await requestFor(uid,email),admin=account("admin",adminEmail),guest=account(uid,email),ref=doc(admin,"account_requests",uid);
 await assertFails(updateDoc(ref,{status:"approved",approvedRole:"teacher",studentId:null,revision:1,decidedBy:"admin",reason:"Unaudited authorization attempt",updatedAt:serverTimestamp()}));
 await assertFails(decisionBatch(admin,uid,before,{status:"approved",approvedRole:"teacher",studentId:null}).commit());
 await assertFails(decisionBatch(guest,uid,before,{status:"approved",approvedRole:"teacher",studentId:null}).commit());
 const batch=decisionBatch(admin,uid,before,{status:"approved",approvedRole:"teacher",studentId:null}),staff={email,displayName:"Fixture teacher",role:"teacher",status:"active",revision:1,reason:"School verified the requested identity.",updatedBy:"admin",updatedAt:serverTimestamp()},staffRef=doc(admin,"staff_access",email);
 batch.set(staffRef,staff);batch.set(doc(staffRef,"revisions","1"),{before:null,after:staff,actorUid:"admin",createdAt:serverTimestamp()});await assertSucceeds(batch.commit());
 await assertSucceeds(setDoc(doc(guest,"staff_workspaces",uid,"lesson_plans","new"),{ownerUid:uid,version:1,sessions:[],weekly_overview:{},subject_title:"Fixture subject"}));
 await assertFails(updateDoc(doc(ref,"revisions","1"),{actorUid:"forged"}));await assertFails(deleteDoc(doc(ref,"revisions","1")));await assertFails(updateDoc(doc(guest,"account_requests",uid),{requestedRole:"student",updatedAt:serverTimestamp()}));
});
test("student linking uses exact verified email and never rewrites an existing enrolled record",async()=>{
 const uid="link-student",email="enrolled@example.edu",before=await requestFor(uid,email),admin=account("admin",adminEmail);
 await assertFails(decisionBatch(admin,uid,before,{status:"approved",approvedRole:"student",studentId:"missing"}).commit());
 await assertSucceeds(decisionBatch(admin,uid,before,{status:"approved",approvedRole:"student",studentId:"existing"}).commit());
 assert.equal((await getDoc(doc(admin,"students","existing"))).data().name,"Existing student");
 const other=await requestFor("wrong-link","other@example.edu");
 await assertFails(decisionBatch(admin,"wrong-link",other,{status:"approved",approvedRole:"student",studentId:"existing"}).commit());
});
test("rejections need a complete audit; owners cannot delete or reactivate a decided request",async()=>{
 const uid="rejected",email="reject@example.edu",before=await requestFor(uid,email),admin=account("admin",adminEmail);
 await assertSucceeds(decisionBatch(admin,uid,before,{status:"rejected",approvedRole:null,studentId:null}).commit());
 await assertFails(updateDoc(doc(account(uid,email),"account_requests",uid),{status:"pending",updatedAt:serverTimestamp()}));await assertFails(deleteDoc(doc(admin,"account_requests",uid)));
});
test("school catalog requires admin-only sequential audited changes and immutable revisions",async()=>{
 const admin=account("admin",adminEmail),teacher=account("teacher","teacher@example.edu"),guest=account("first","first@example.edu"),ref=doc(admin,"school_catalog","sections","records","11-A");
 const data={name:"11-A",scheme:"strengthened-shs",type:"Section",notes:"Configured by school",status:"active",revision:1,updatedBy:"admin",updatedAt:serverTimestamp()};
 await assertFails(setDoc(ref,data));await assertFails(setDoc(doc(teacher,"school_catalog","sections","records","forged"),data));
 const batch=writeBatch(admin);batch.set(ref,data);batch.set(doc(ref,"revisions","1"),{before:null,after:data,actorUid:"admin",createdAt:serverTimestamp()});await assertSucceeds(batch.commit());
 await assertSucceeds(getDocs(collection(teacher,"school_catalog","sections","records")));await assertFails(getDocs(collection(guest,"school_catalog","sections","records")));
 const before=(await getDoc(ref)).data(),after={...before,status:"archived",revision:2,updatedAt:serverTimestamp()},revision=writeBatch(admin);
 revision.set(ref,after);revision.set(doc(ref,"revisions","2"),{before,after,actorUid:"admin",createdAt:serverTimestamp()});await assertSucceeds(revision.commit());
 await assertFails(updateDoc(doc(ref,"revisions","1"),{actorUid:"forged"}));await assertFails(deleteDoc(ref));await assertFails(updateDoc(ref,{name:"x".repeat(121),updatedAt:serverTimestamp()}));
 const current=(await getDoc(ref)).data();await assertFails(setDoc(doc(ref,"revisions","3"),{before:current,after:{...current,revision:3},actorUid:"admin",createdAt:serverTimestamp()}));
});
