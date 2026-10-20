import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {workspacePath,scopedStorage,personalPlanId,requireCurrentVersion} from "../js/lesson-review/workspace-model.mjs";
import {staffRole,rememberStaff,ADMIN_EMAIL,TEACHER_EMAIL} from "../js/core/staff-role.mjs";

test("identical lessons and schedule IDs remain in different authenticated UID paths",()=>{
  assert.notDeepEqual(workspacePath("admin","lesson_plans","same-week"),workspacePath("teacher","lesson_plans","same-week"));
  assert.notDeepEqual(workspacePath("admin","schedules","same-semester"),workspacePath("teacher","schedules","same-semester"));
  assert.throws(()=>workspacePath("","lesson_plans"));assert.throws(()=>workspacePath("forged/owner","lesson_plans"));assert.throws(()=>workspacePath("teacher","staff_access"));
});
test("an account switch cannot reuse the previous account's in-memory planning workspace",async()=>{
  const user={uid:"original",emailVerified:true},redirects=[];
  let changed;
  const context={auth:{currentUser:user},staffSessionReady:Promise.resolve({user,role:"teacher"}),resolveStaffRole:async()=>"teacher",
    onAuthStateChanged:(_auth,listener)=>{changed=listener;},workspacePath,scopedStorage,localStorage:{getItem:()=>"private original cache"},
    location:{replace:value=>redirects.push(value)},document:{readyState:"complete"},doc:(_database,...parts)=>parts,collection:(_database,...parts)=>parts};
  const source=readFileSync("js/lesson-review/workspace-session.mjs","utf8").replace(/^import[^;]+;\s*/gm,"").replace(/\bexport\s+/g,"");
  runInNewContext(source+"\nglobalThis.api={workspaceUid,ownedDoc,lessonStorage};",context);
  await context.staffSessionReady;await Promise.resolve();
  assert.equal(context.api.workspaceUid(),"original");
  context.auth.currentUser={uid:"different",emailVerified:true};changed(context.auth.currentUser);
  assert.throws(()=>context.api.ownedDoc({},"lesson_plans","same"),/Account changed/);
  assert.equal(context.api.lessonStorage.getItem("Adminerva_defaultTeacher"),null);
  assert.deepEqual(redirects,["login.html?error=account-changed"]);
});
test("device preferences never read another account or silently adopt shared legacy keys",()=>{
  const values=new Map([["Adminerva_defaultTeacher","Legacy owner"]]);
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const first=scopedStorage(storage,"first"),second=scopedStorage(storage,"second");
  assert.equal(first.getItem("Adminerva_defaultTeacher"),null);first.setItem("Adminerva_defaultTeacher","First teacher");
  assert.equal(second.getItem("Adminerva_defaultTeacher"),null);second.setItem("Adminerva_defaultTeacher","Second teacher");
  assert.equal(first.getItem("Adminerva_defaultTeacher"),"First teacher");second.removeItem("Adminerva_defaultTeacher");assert.equal(first.getItem("Adminerva_defaultTeacher"),"First teacher");
});
test("workspace reads wait for restored authentication and bind only a server-authorized identity",async()=>{
  const user={uid:"restored",emailVerified:true};let restore,called=false;
  const auth={currentUser:null,authStateReady:()=>new Promise(resolve=>{restore=resolve;})};
  const context={auth,staffSessionReady:Promise.resolve({user:null,role:null}),resolveStaffRole:async identity=>{called=true;return identity===user?"teacher":null;},
    onAuthStateChanged(){},workspacePath,scopedStorage,localStorage:{},location:{replace(){}},document:{readyState:"loading",addEventListener(){}},doc:(_database,...parts)=>parts,collection:(_database,...parts)=>parts};
  const source=readFileSync("js/lesson-review/workspace-session.mjs","utf8").replace(/^import[^;]+;\s*/gm,"").replace(/\bexport\s+/g,"");
  runInNewContext(source+"\nglobalThis.api={requireStaffWorkspace,workspaceUid};",context);
  const ready=context.api.requireStaffWorkspace();assert.equal(called,false);auth.currentUser=user;restore();
  assert.equal(await ready,"restored");assert.equal(context.api.workspaceUid(),"restored");
});
test("lesson identifiers preserve subject punctuation and the full academic term",()=>{
  const plan={grade:"11",subject:"A-B",term:"FIRST SEMESTER FIRST QUARTER",week:"Week 1",schoolYear:"2026-2027"};
  assert.notEqual(personalPlanId(plan),personalPlanId({...plan,subject:"AB"}));assert.notEqual(personalPlanId(plan),personalPlanId({...plan,term:"SECOND SEMESTER FIRST QUARTER"}));
  assert.throws(()=>personalPlanId({...plan,subject:""}));assert.throws(()=>personalPlanId({...plan,subject:"x".repeat(1500)}));
});
test("stale or unopened versions cannot silently replace an existing lesson or schedule",()=>{
  assert.equal(requireCurrentVersion(null,0),1);assert.equal(requireCurrentVersion({version:4},4),5);
  assert.throws(()=>requireCurrentVersion({version:4},3),/newer saved version/);assert.throws(()=>requireCurrentVersion({version:4},0));
});
test("only verified bootstrap identities or active administrator-managed teachers receive a staff role",()=>{
  const user={uid:"dynamic-role-test",email:"second.teacher@example.edu",emailVerified:true};
  assert.equal(staffRole(user),null);rememberStaff(user,{email:user.email,role:"teacher",status:"active"});assert.equal(staffRole(user),"teacher");
  rememberStaff(user,{email:user.email,role:"teacher",status:"disabled"});assert.equal(staffRole(user),null);
  rememberStaff(user,{email:user.email,role:"admin",status:"active"});assert.equal(staffRole(user),null);
  assert.equal(staffRole({uid:"admin",email:ADMIN_EMAIL,emailVerified:true}),"admin");assert.equal(staffRole({uid:"unverified",email:ADMIN_EMAIL,emailVerified:false}),null);
  const legacy={uid:"legacy-test",email:TEACHER_EMAIL,emailVerified:true};assert.equal(staffRole(legacy),"teacher");rememberStaff(legacy,{email:TEACHER_EMAIL,role:"teacher",status:"disabled"});assert.equal(staffRole(legacy),null);
});
