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
  assert.match(editor,/if\(practiceMode\)\s*\{/);
  assert.match(editor,/sessionStorage\.setItem\(practiceBridgeKey\(uid\)/);
  assert.match(editor,/if\(practiceMode\)return null;/);
  assert.match(editor,/if\(practiceMode\)return false;/);
  assert.match(editor,/notePracticeExecution\(\)/);
  assert.match(editor,/readPracticeTransfer\(sessionStorage,auth\.currentUser\.uid\)/);
  assert.match(page,/id="practiceSandboxBanner"/);
  assert.match(page,/id="practiceReturnLink"/);
});
test("completion requires a run attempt and written comparison, with recoverable progress",()=>{
  const app=readFileSync("js/student/practice.js","utf8");
  const html=readFileSync("student-practice.html","utf8");
  assert.match(app,/transfer\.runCount<1/);
  assert.match(app,/observation\.length<25/);
  assert.match(app,/runTransaction\(db,async tx/);
  assert.match(app,/needsSync/);
  assert.match(app,/practiceExperimentLink/);
  assert.match(html,/id="practiceObservation"/);
  assert.match(html,/id="practiceExperimentLink"/);
  assert.match(html,/id="practiceOverview"/);
});
