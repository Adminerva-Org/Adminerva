/** Regression coverage: Student submissions, practice progress and isolated code workspaces: practice playground bridge. */
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {COURSES,practiceQuestion} from "./practice-courses.mjs";
import {sandboxForQuestion,makePracticeTransfer,practiceBridgeKey,readPracticeTransfer,
  recordPracticeRun,practiceReturnUrl} from "./practice-playground-bridge.mjs";
import {validPlaygroundState} from "./playground-storage.mjs";

const store=()=>{const values=new Map();return{
  setItem:(key,value)=>values.set(key,String(value)),
  getItem:key=>values.has(key)?values.get(key):null,
  removeItem:key=>values.delete(key)
};};

test("each introductory mission produces an isolated runnable sample",()=>{
  for(const course of COURSES)for(const mission of course.missions)for(let attempt=0;attempt<48;attempt++){
    const question=practiceQuestion("student-test",mission,attempt);
    const sandbox=sandboxForQuestion(course.id,mission.id,question);
    assert.ok(validPlaygroundState(sandbox),course.id+"/"+mission.id+" attempt "+attempt);
    assert.equal(sandbox.fileOrder.length,1);
    const code=Object.values(sandbox.files)[0];
    assert.ok(code.trim().length>5,"A runnable single print statement is valid: "+mission.id);
    if(course.id==="java"){
      assert.equal(sandbox.lang,"java");
      assert.ok(code.includes("public static void main"));
      assert.ok(code.includes("System.out.println"));
    }
    if(course.id==="python"){
      assert.equal(sandbox.lang,"python");
      assert.ok(code.includes("print("));
    }
    if(course.id==="web"){
      assert.equal(sandbox.lang,"web");
      assert.ok(code.includes("<!doctype html>"));
      if(mission.id==="w4"){
        const match=code.match(/<script>([\s\S]*?)<\/script>/);
        assert.ok(match,"JavaScript sample must have a closing script tag");
        assert.doesNotThrow(()=>new vm.Script(match[1]));
      }
    }
    if(course.id==="logic"){
      assert.equal(sandbox.lang,"python");
      assert.ok(code.includes("print("));
    }
  }
});
test("practice handoffs belong to the current signed-in student and expire",()=>{
  const alice=makePracticeTransfer("alice","java","j1",2);
  assert.equal(alice.runCount,0);
  assert.equal(alice.uid,"alice");
  assert.match(practiceReturnUrl(alice),/course=java&mission=j1/);
  const storage=store();
  storage.setItem(practiceBridgeKey("alice"),JSON.stringify(alice));
  assert.ok(readPracticeTransfer(storage,"alice"));
  assert.equal(readPracticeTransfer(storage,"bob"),null);
  assert.ok(recordPracticeRun(storage,"alice","42\n"));
  assert.equal(readPracticeTransfer(storage,"alice").runCount,1);
  assert.equal(readPracticeTransfer(storage,"alice").observed,"42\n");
  const tooOld={...alice,startedAt:Date.now()-25*60*60*1000};
  storage.setItem(practiceBridgeKey("alice"),JSON.stringify(tooOld));
  assert.equal(readPracticeTransfer(storage,"alice"),null);
  const fake={...alice,missionId:"nonexistent"};
  storage.setItem(practiceBridgeKey("alice"),JSON.stringify(fake));
  assert.equal(readPracticeTransfer(storage,"alice"),null);
});
test("practice sandbox never writes over a student's normal workspace or cloud backups",()=>{
  const editor=readFileSync("js/student/playground.js","utf8");
  const page=readFileSync("student-playground.html","utf8");
  const persistent=store(),scratch=store(),workspace=sandboxForQuestion("java","j1",practiceQuestion("alice",COURSES[0].missions[0],0));
  persistent.setItem("personal-workspace","unchanged");
  const context=vm.createContext({window:{addEventListener(){}},document:{getElementById:()=>null},
    auth:{currentUser:{uid:"alice"}},loadedOwnerUid:"alice",guestMode:false,
    practiceMode:true,practiceTransfer:{uid:"alice",workspace},
    workspaceFiles:Object.fromEntries(Object.entries(workspace.files).map(([name,code])=>[name,{model:{getValue:()=>code}}])),
    currentLang:workspace.lang,fileOrder:workspace.fileOrder,activeFilename:workspace.activeFilename,
    workspaceFolders:[],projectOrder:workspace.fileOrder,normalizedProjectOrder:order=>order,
    localStorage:persistent,sessionStorage:scratch,practiceBridgeKey,
    clearTimeout(){},Date,JSON,console});
  const storageStart=editor.indexOf("let autoSaveTimeout;"),storageEnd=editor.indexOf("async function exportZIP()",storageStart);
  const backupStart=editor.indexOf("window.adminervaPlaygroundState=function()"),backupEnd=editor.indexOf("window.adminervaUndoPlaygroundRestore=function()",backupStart);
  assert.ok(storageStart>0&&storageEnd>storageStart&&backupStart>0&&backupEnd>backupStart);
  vm.runInContext(editor.slice(storageStart,storageEnd)+editor.slice(backupStart,backupEnd),context);
  assert.equal(vm.runInContext("persistWorkspace()",context),true);
  assert.deepEqual(JSON.parse(scratch.getItem(practiceBridgeKey("alice"))).scratch.files,workspace.files);
  assert.equal(persistent.getItem("personal-workspace"),"unchanged");
  assert.equal(context.window.adminervaPlaygroundState(),null);
  assert.equal(context.window.adminervaRestorePlayground(workspace),false);
  assert.match(editor,/notePracticeExecution\(\)/);
  assert.match(editor,/readPracticeTransfer\(sessionStorage,ownerUid\(\)\)/);
  assert.match(page,/id="practiceSandboxBanner"/);
  assert.match(page,/id="practiceReturnLink"/);
});

test("active season submissions require access and retain the same pending answer for retry",async()=>{
  const app=readFileSync("js/student/practice-game.mjs","utf8");
  const start=app.indexOf("async function submit(){"),end=app.indexOf("function markup()",start);
  assert.ok(start>0&&end>start);
  const fields=new Map(),stored=new Map(),calls=[];
  const field=id=>{if(!fields.has(id))fields.set(id,{});return fields.get(id);};
  const context=vm.createContext({busy:false,eligible:false,user:{uid:"alice"},epoch:1,pending:null,
    attempt:{attemptId:"attempt-one",question:{}},course:{id:"java"},mission:{id:"j1"},
    field,readAnswer:()=>0,pendingKey:()=>"pending-alice",
    localSet:(key,value)=>value===null?stored.delete(key):stored.set(key,JSON.stringify(value)),
    crypto:{getRandomValues:values=>values.fill(7)},Uint8Array,
    saveDraft(){},setBusy(value){context.busy=value;},sync(){},feedback(){},
    errorFeedback(){},pendingNotice(){},pointsText(){},renderAnswer(){},
    prepareExperiment(){},notice(){},refreshHub:async()=>{},
    practiceRequest:async(name,payload)=>{calls.push({name,payload:JSON.parse(JSON.stringify(payload))});throw Error("offline");}});
  vm.runInContext(app.slice(start,end),context);
  await vm.runInContext("submit()",context);
  assert.equal(calls.length,0,"An ineligible account cannot submit a scored answer");
  context.eligible=true;
  await vm.runInContext("submit()",context);
  assert.equal(calls[0].name,"practiceMissionSubmit");
  const saved=JSON.parse(stored.get("pending-alice"));
  assert.deepEqual(saved,calls[0].payload,"Save the exact answer before contacting the server");
  await vm.runInContext("submit()",context);
  assert.deepEqual(calls[1].payload,saved,"A retry must keep its submission ID and answer");
  context.practiceRequest=async()=>({correct:true,awarded:true,earnedPoints:20});
  await vm.runInContext("submit()",context);
  assert.equal(stored.has("pending-alice"),false);
  assert.equal(context.attempt.completed,true);
  assert.equal(context.attempt.earnedPoints,20);
  assert.doesNotMatch(app,/runTransaction|setDoc\(|updateDoc\(/);
});
