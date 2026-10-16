import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

test("lesson tools use the common authentication guard",()=>{
  for (const path of ["lesson-planner.html","schedule.html","library.html","presentation.html"]) {
    const source=readFileSync(path,"utf8");
    assert.ok(source.includes('src="js/core/auth-guard.js"'),path+" must protect instructor access");
  }
});

test("saved teacher, subject and signature defaults hydrate on new devices",async()=>{
  const source=readFileSync("js/settings/settings-lesson.js","utf8");
  const start=source.indexOf("const safeSet =");
  const end=source.indexOf("window.previewHeaderImage = function",start);
  assert.ok(start>=0 && end>start);
  const stored=new Map();
  const data={
    teacher_name:"Teacher Example",
    subject_title:"Mobile App Development",
    default_prelim:"Attendance",
    default_closing:"Summary",
    sig_teacher:"First Signer",
    sig_principal:"Final Signer"
  };
  const context={
    localStorage:{
      getItem:key=>stored.has(key)?stored.get(key):null,
      setItem:(key,value)=>stored.set(key,value)
    },
    window:{db:{},populateSettingsSubjectDropdown(){}},
    document:{getElementById:()=>null},
    doc:()=>({}),
    getDoc:async()=>({exists:()=>true,data:()=>data}),
    console
  };
  vm.runInNewContext(source.slice(start,end),context);
  await context.window.loadLessonReviewSettings();
  assert.equal(stored.get("Adminerva_defaultTeacher"),data.teacher_name);
  assert.equal(stored.get("Adminerva_defaultSubject"),data.subject_title);
  assert.equal(stored.get("Adminerva_sig1Name"),data.sig_teacher);
  assert.equal(stored.get("Adminerva_sig4Name"),data.sig_principal);
  assert.equal(stored.get("Adminerva_defaultPrelim"),data.default_prelim);
  assert.equal(stored.get("Adminerva_defaultClosing"),data.default_closing);
  assert.match(source,/document\.addEventListener\("DOMContentLoaded"/);
});

test("offline printing uses the same signature storage as lesson settings",()=>{
  const source=readFileSync("js/lesson-review/document-exporter.js","utf8");
  for(let i=1;i<=4;i++)for(const field of ["Name","Title"])
    assert.ok(source.includes('localStorage.getItem("Adminerva_sig'+i+field+'")'));
});

test("lesson save validates school year without throwing out of save handler",()=>{
  const source=readFileSync("js/lesson-review/lesson-firebase.js","utf8");
  const start=source.indexOf("window.saveLessonPlan = async function");
  const end=source.indexOf("window.openLoadPlanModal = async function",start);
  const save=source.slice(start,end);
  assert.match(save,/normalizeSchoolYear\(document\.getElementById\("lpSchoolYear"\)\.value\)/);
  assert.match(save,/alert\("Cannot save lesson plan: "/);
  assert.match(save,/return false;/);
});

test("no-schedule generation cannot silently invent teaching times",()=>{
  const source=readFileSync("js/lesson-review/ai-engine.js","utf8");
  assert.ok(source.includes("No teacher timetable was found"));
  assert.ok(source.includes("do NOT invent class sections") ||
            source.includes("do NOT invent sections"));
  assert.ok(source.includes("Do not invent section names or meeting times."));
});

test("loading another subject never changes the saved lesson identity",()=>{
  const ui=readFileSync("js/lesson-review/app-ui.js","utf8");
  const save=readFileSync("js/lesson-review/lesson-firebase.js","utf8");
  const generation=readFileSync("js/lesson-review/ai-engine.js","utf8");
  const start=ui.indexOf("window.loadSpecificPlan = function");
  const end=ui.indexOf('document.getElementById("lpSchoolYear").value',start);
  assert.ok(start>=0 && end>start);
  const context={
    window:{currentPlan:[],currentPlanSubject:"",currentPlanTeacher:""},
    localStorage:{getItem:key=>key==="Adminerva_defaultSubject"?"New Semester Subject":"Current Teacher"},
    document:{getElementById:()=>({value:"Grade 11"})},
    alert(){}
  };
  vm.runInNewContext(ui.slice(start,end)+"}",context);
  context.window.loadSpecificPlan({
    sessions:[{session_name:"Session 1"}],
    grade_level:"Grade 11",
    subject_title:"Previous Subject",
    teacher_name:"Original Teacher"
  });
  assert.equal(context.window.currentPlanSubject,"Previous Subject");
  assert.equal(context.window.currentPlanTeacher,"Original Teacher");
  assert.ok(save.includes('const subject = window.currentPlanSubject ||'));
  assert.ok(save.includes('const teacher = window.currentPlanTeacher ||'));
  assert.ok(generation.includes('window.currentPlanSubject = subject;'));
  assert.ok(generation.includes('window.currentPlanSubject = localStorage.getItem("Adminerva_defaultSubject")'));
});
