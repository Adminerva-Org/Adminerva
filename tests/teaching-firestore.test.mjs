import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

function fixture({role="teacher",sections=["A","B"],authorization=async()=>role,currentUser={uid:"instructor"},authReady=async()=>{}}={}){
  const calls=[],listeners=[],auth={currentUser,authStateReady:async()=>authReady(auth)};
  const reference=(type,path)=>({type,path,firestore:{}});
  const sdk={
    collection:(_database,...parts)=>reference("collection",parts.join("/")),
    doc:(database,...parts)=>reference("document",[database?.path,...parts].filter(Boolean).join("/")),
    query:(base,...constraints)=>({...base,type:"query",constraints}),where:(field,operator,value)=>({field,operator,value}),
    getDoc:async value=>{calls.push({operation:"get",path:value.path});return value;},
    getDocs:async value=>{calls.push({operation:"list",path:value.path,constraints:value.constraints});return {docs:[{ref:{path:value.path+"/same"}}]};},
    setDoc:async value=>calls.push({operation:"set",path:value.path}),updateDoc:async value=>calls.push({operation:"update",path:value.path}),
    deleteDoc:async value=>calls.push({operation:"delete",path:value.path}),addDoc:async value=>calls.push({operation:"add",path:value.path}),
    onSnapshot:(source,callback)=>{const entry={source,callback,stopped:false};listeners.push(entry);return()=>{entry.stopped=true;};},
    runTransaction:async(_database,callback)=>callback({get:sdk.getDoc,set:sdk.setDoc,update:sdk.updateDoc,delete:sdk.deleteDoc})
  };
  sdk.writeBatch=()=>({set:sdk.setDoc,update:sdk.updateDoc,delete:sdk.deleteDoc,commit:async()=>{}});
  sdk.getDocsFromServer=sdk.getDocs;sdk.getDocFromServer=sdk.getDoc;
  const context=vm.createContext({sdk,auth,db:{},resolveStaffRole:authorization,staffRole:()=>role,staffSections:()=>sections});
  const source=readFileSync("js/core/teaching-firestore.mjs","utf8").replace(/^export \* from .*;$/gm,"").replace(/^import .*;$/gm,"").replace(/\bexport /g,"");
  vm.runInContext(source+";globalThis.api={collection,query,doc,getDoc,getDocs,setDoc,updateDoc,deleteDoc,addDoc,runTransaction,writeBatch,onSnapshot};",context);
  return {api:context.api,auth,calls,listeners,sdk};
}
test("teacher student reads use the credential-free projection and constrain every assigned class",async()=>{
  const current=fixture();
  await current.api.getDoc(current.api.doc({},"students","alice"));
  assert.equal(current.calls[0].path,"teaching_roster/alice");
  const result=await current.api.getDocs(current.api.collection({},"students"));
  assert.equal(result.size,1,"Merged results must be deduplicated");
  const lists=current.calls.filter(call=>call.operation==="list");assert.equal(lists.length,2);
  assert.deepEqual(lists.map(call=>call.constraints.at(-1).value),["A","B"]);
  assert.ok(lists.every(call=>call.path==="teaching_roster"));
});
test("unassigned teachers receive an empty result, never a broad roster read",async()=>{
  const current=fixture({sections:[]});const result=await current.api.getDocs(current.api.collection({},"students"));
  assert.equal(result.empty,true);assert.equal(current.calls.length,0);
});
test("auth initialization does not look like an account switch",async()=>{
  const current=fixture({currentUser:null,authReady:async auth=>{auth.currentUser={uid:"instructor"};}});
  const result=await current.api.getDocs(current.api.collection({},"students"));
  assert.equal(result.size,1);
  assert.equal(current.calls.filter(call=>call.operation==="list").length,2);
});
test("teacher issue feeds are constrained to every assigned section",async()=>{
  const current=fixture();
  const audience={field:"audience",operator:"==",value:"teacher"};
  await current.api.getDocs(current.api.query(current.api.collection({},"issues"),audience));
  const lists=current.calls.filter(call=>call.operation==="list");
  assert.equal(lists.length,2);
  assert.ok(lists.every(call=>call.constraints[0]===audience));
  assert.deepEqual(lists.map(call=>call.constraints.at(-1).value),["A","B"]);
});
test("assessment owner and assigned-section plans preserve the caller's constraints",async()=>{
  const current=fixture();const constraint={field:"quarter",operator:"==",value:"Q3"};
  await current.api.getDocs(current.api.query(current.api.collection({},"assessments"),constraint));
  assert.equal(current.calls.length,3);
  assert.equal(current.calls[0].constraints[1].field,"ownerUid");
  assert.ok(current.calls.slice(1).every(call=>call.constraints[1].field==="sectionIds"&&call.constraints[1].operator==="array-contains"));
  assert.ok(current.calls.every(call=>call.constraints[0]===constraint));
});
test("private material reads, writes and transaction references stay in the instructor's namespace",async()=>{
  const current=fixture();const ref=current.api.doc({},"repobank","project");
  await current.api.setDoc(ref,{});await current.api.getDoc(ref);
  await current.api.runTransaction({},async transaction=>{await transaction.get(ref);transaction.set(ref,{});});
  assert.ok(current.calls.every(call=>call.path==="teacher_materials/instructor/repobank/project"));
});
test("legacy activity and diagnostic caches retain assigned/private access without restoring a teacher wildcard",async()=>{
  const current=fixture();await current.api.getDocs(current.api.collection({},"activity_grades"));
  assert.deepEqual(current.calls.map(call=>call.constraints.at(-1).value),["A","B"]);
  current.calls.length=0;
  for(const collection of ["system","github_stats_cache"])await current.api.setDoc(current.api.doc({},collection,"cache"),{});
  assert.ok(current.calls.every(call=>call.path.startsWith("teacher_materials/instructor/")));
});
test("reference-library batch writes retain the same owner namespace as single writes",async()=>{
  const current=fixture(),batch=current.api.writeBatch({});
  batch.update(current.api.doc({},"reference_folders","chapter"),{});
  batch.delete(current.api.doc({},"reference_folders","chapter","documents","page"));
  await batch.commit();
  assert.ok(current.calls.every(call=>call.path.startsWith("teacher_materials/instructor/reference_folders/chapter")));
});
test("administrator queries remain unchanged and browser role strings are not consulted",async()=>{
  const current=fixture({role:"admin"});await current.api.getDocs(current.api.collection({},"students"));
  assert.equal(current.calls.length,1);assert.equal(current.calls[0].path,"students");
});
test("unsubscribe before asynchronous authorization prevents late listeners",async()=>{
  const current=fixture();let received=0;
  const stop=current.api.onSnapshot(current.api.collection({},"students"),()=>received++);stop();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(current.listeners.length,0);assert.equal(received,0);
});
test("an account change during authorization cannot complete a stale teaching query",async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const current=fixture({authorization:()=>gate});const reading=current.api.getDocs(current.api.collection({},"students"));
  await new Promise(resolve=>setImmediate(resolve));current.auth.currentUser={uid:"another-account"};release("teacher");
  await assert.rejects(reading,/Account changed/);assert.equal(current.calls.length,0);
});
