import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {COURSES} from "../js/student/practice-courses.mjs";

function domNode(tag="div"){
  const classes=new Set(),attributes=new Map();
  const element={tagName:tag,children:[],listeners:{},textContent:"",value:"",disabled:false,
    classList:{add:(...values)=>values.forEach(value=>classes.add(value)),remove:(...values)=>values.forEach(value=>classes.delete(value)),contains:value=>classes.has(value),toggle(value,force){const enabled=force??!classes.has(value);if(enabled)classes.add(value);else classes.delete(value);return enabled;}},
    append(...values){this.children.push(...values);},replaceChildren(...values){this.children=values;},
    addEventListener(type,callback){this.listeners[type]=callback;},setAttribute(key,value){attributes.set(key,value);},getAttribute:key=>attributes.get(key),removeAttribute:key=>attributes.delete(key),
    focus(){this.focused=true;},scrollIntoView(){},
    querySelectorAll(selector){return this.children.flatMap(child=>[...(child.tagName===selector?[child]:[]),...child.querySelectorAll(selector)]);},
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}};
  return element;
}
function fixture(){
  const fields=new Map(),storage=new Map(),calls=[];let active=null,transferRequired=true,failPrediction=false;
  const field=id=>{if(!fields.has(id))fields.set(id,domNode());return fields.get(id);};
  for(const id of ["practiceCheckBtn","practiceRetryBtn","practiceFinishBtn","practiceTransferBtn"])field(id).classList.add("hidden");
  const context=vm.createContext({document:{getElementById:field,createElement:domNode},COURSES,auth:{},db:{},
    onAuthStateChanged(){},setInterval(){},collection(){},getDocs:async()=>({docs:[]}),
    sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    activePracticeSession:()=>active,resetPracticeSession(){active=null;},
    resumePracticeSession:async()=>{if(transferRequired)throw {details:{reason:"transfer-required"}};active={sessionId:"session-one"};return active;},
    practiceRequest:async(name,payload)=>{calls.push({name,payload});if(name==="practiceStart")return {state:"open",attemptId:"attempt-one",question:{code:"print(2)",prompt:"What is printed?",choices:["2","3"]}};if(name==="practicePredict"&&failPrediction)throw {details:{reason:"attempt-expired"}};return {awarded:true};},
    readPracticeTransfer:()=>null,confirm:()=>true,location:{search:""},URLSearchParams});
  const source=readFileSync("js/student/practice.js","utf8").replace(/^import .*;\r?$/gm,"");
  vm.runInContext(source,context);vm.runInContext('user={uid:"alice"};activeCourse=COURSES[0];activeMission=COURSES[0].missions[0];',context);
  return {field,context,calls,allowSession(){transferRequired=false;},expirePrediction(){failPrediction=true;}};
}

test("an opened mission recovers a missing challenge after reconnecting, without exposing Check prematurely",async()=>{
  const state=fixture();await vm.runInContext("requestChallenge()",state.context);
  assert.equal(state.calls.length,0);assert.equal(state.field("practiceCheckBtn").classList.contains("hidden"),true);
  assert.equal(state.field("practiceTransferBtn").classList.contains("hidden"),false);
  state.allowSession();await state.field("practiceSyncBtn").listeners.click();
  assert.equal(state.calls.filter(call=>call.name==="practiceStart").length,1);
  assert.equal(state.field("practiceCheckBtn").classList.contains("hidden"),false);
  assert.equal(state.field("practiceTransferBtn").classList.contains("hidden"),true);
  assert.equal(state.field("practiceMissionPanel").getAttribute("aria-busy"),"false");
});

test("an expired prediction offers a fresh example and retains the written draft",async()=>{
  const state=fixture();state.allowSession();await vm.runInContext("requestChallenge()",state.context);
  state.field("practiceReasoning").value="I traced each statement and checked the changing variable.";
  vm.runInContext("choice=0",state.context);state.expirePrediction();await vm.runInContext("checkPrediction()",state.context);
  assert.equal(state.field("practiceCheckBtn").classList.contains("hidden"),true);
  assert.equal(state.field("practiceRetryBtn").classList.contains("hidden"),false);
  assert.equal(state.field("practiceRetryBtn").textContent,"New example");
  assert.match(state.field("practiceReasoning").value,/traced/);
  await vm.runInContext("requestChallenge()",state.context);
  assert.equal(state.field("practiceCheckBtn").classList.contains("hidden"),false);
});

test("moving an active session hides stale actions and reconnect loads a fresh attempt",async()=>{
  const state=fixture();state.allowSession();await vm.runInContext("requestChallenge()",state.context);
  vm.runInContext('sessionFailure({details:{reason:"session-moved"}})',state.context);
  assert.equal(state.field("practiceCheckBtn").classList.contains("hidden"),true);
  assert.equal(state.field("practiceFinishBtn").classList.contains("hidden"),true);
  assert.equal(state.field("practiceTransferBtn").classList.contains("hidden"),false);
  await state.field("practiceSyncBtn").listeners.click();
  assert.equal(state.calls.filter(call=>call.name==="practiceStart").length,2);
  assert.equal(state.field("practiceCheckBtn").classList.contains("hidden"),false);
});

test("refreshing saved progress cannot overwrite the awarded mission confirmation",async()=>{
  const state=fixture();await vm.runInContext('submitCompletion({attemptId:"attempt-one",observation:"The code printed the predicted value."})',state.context);
  assert.match(state.field("practiceStatus").textContent,/Mission complete.*10 XP/);
  assert.deepEqual(Object.keys(state.calls[0].payload),["attemptId","observation"]);
});

test("guest practice distinguishes incorrect answers, marks completion and cannot duplicate local points",()=>{
  const fields=new Map(),storage=new Map();
  const field=id=>{if(!fields.has(id))fields.set(id,domNode());return fields.get(id);};
  field("guest-course").value=COURSES[0].id;field("guest-module").value=COURSES[0].modules[0].id;
  const context=vm.createContext({document:{getElementById:field,createElement:domNode,querySelector:()=>({dataset:{guestPage:"practice"}})},COURSES,
    auth:{currentUser:{uid:"alice"}},guestStorageKey:(uid,page)=>uid+"-"+page,
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    Option:function(text,value){this.textContent=text;this.value=value;},confirm:()=>true,location:{reload(){}}});
  const source=readFileSync("js/guests/guest.mjs","utf8").replace(/^import .*;\r?$/gm,"");
  vm.runInContext(source.slice(0,source.indexOf('field("guest-signout").onclick')),context);
  vm.runInContext('allowed=true;currentUid="alice";tools("alice");',context);
  assert.equal(field("guest-missions").children.length,15);
  const details=field("guest-missions").children[0].children[0],choices=details.children[4],result=details.children[5];
  assert.equal(details.open,true);assert.equal(field("guest-missions").children[1].children[0].open,false);
  const exercise=COURSES[0].modules[0].missions[0].build(17);
  choices.children[(exercise.correct+1)%exercise.choices.length].onclick();
  assert.match(result.textContent,/Not quite/);assert.match(field("guest-points").textContent,/0 locally/);
  choices.children[exercise.correct].onclick();choices.children[exercise.correct].onclick();
  assert.match(result.textContent,/Correct.*already completed/);assert.match(details.children[0].textContent,/Completed/);
  assert.match(field("guest-points").textContent,/1 locally completed missions · 10 practice points/);
  assert.deepEqual(JSON.parse(storage.get("alice-practice")),[COURSES[0].modules[0].missions[0].id]);
  context.auth.currentUser={uid:"bob"};
  const secondChoices=field("guest-missions").children[1].children[0].children[4],secondExercise=COURSES[0].modules[0].missions[1].build(17);
  secondChoices.children[secondExercise.correct].onclick();
  assert.match(field("guest-status").textContent,/Account access changed/);
  assert.deepEqual(JSON.parse(storage.get("alice-practice")),[COURSES[0].modules[0].missions[0].id]);
});
