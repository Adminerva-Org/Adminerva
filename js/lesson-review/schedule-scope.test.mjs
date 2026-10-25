import {requireCurrentVersion,scopedStorage,workspacePath} from "./workspace-model.mjs";
/** Regression coverage: Lesson planning, school schedules, references and document export: schedule scope. */
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {scheduleScope, scheduleSemester, normalizeSchoolYear, parseScheduleRows, localScheduleText, parseClockMinutes} from "./schedule-scope.mjs";
import {isLegacySharedScope,isLegacyScheduleRetired,legacyScheduleNotice,resolveSectionGrade,scheduleRowsToText} from "./legacy-schedule-compat.mjs";

test("semester and school-year timetables never share document or cache keys",()=>{
  const first=scheduleScope("2026-2027","S1");
  const second=scheduleScope("2026-2027","S2");
  const other=scheduleScope("2027-2028","S2");
  assert.equal(first.id,"master_schedule_SY20262027_S1");
  assert.equal(second.id,"master_schedule_SY20262027_S2");
  assert.notEqual(first.id,second.id);
  assert.notEqual(other.jsonKey,second.jsonKey);
  assert.notEqual(first.textKey,second.textKey);
  assert.notEqual(first.pendingKey,second.pendingKey);
  assert.equal(scheduleSemester("SECOND SEMESTER/THIRD QUARTER"),"S2");
  assert.equal(scheduleSemester("FIRST SEMESTER/SECOND QUARTER"),"S1");
  assert.throws(()=>normalizeSchoolYear("2026-2026"),/valid school year/);
});

test("legacy timetable is never substituted for second semester",()=>{
  const values=new Map([["Adminerva_schedule","OLD FIRST SEMESTER"]]);
  const storage={getItem:key=>values.has(key)?values.get(key):null};
  assert.equal(localScheduleText(storage,"2026-2027","FIRST SEMESTER/FIRST QUARTER"),"OLD FIRST SEMESTER");
  assert.equal(localScheduleText(storage,"2026-2027","SECOND SEMESTER/FOURTH QUARTER"),"");
  assert.equal(localScheduleText(storage,"2027-2028","FIRST SEMESTER/FIRST QUARTER"),"");
  const second=scheduleScope("2026-2027","S2");
  values.set(second.textKey,"NEW SECOND SEMESTER");
  assert.equal(localScheduleText(storage,"2026-2027","SECOND SEMESTER/THIRD QUARTER"),"NEW SECOND SEMESTER");
  assert.deepEqual(parseScheduleRows("not JSON"),[]);
});

test("teacher schedule editor writes only the selected semester document",async()=>{
  const text=readFileSync("js/lesson-review/schedule.js","utf8");
  const source=text.slice(text.indexOf("let mySections = []"));
  const values=new Map([["Adminerva_schedule","OLD FIRST SEMESTER"]]);
  const storage={
    getItem:key=>values.has(key)?values.get(key):null,
    setItem:(key,value)=>values.set(key,String(value)),
    removeItem:key=>values.delete(key)
  };
  const elements={
    scheduleSchoolYear:{value:"2026-2027"},
    scheduleSemester:{value:"S2"},
    scheduleScopeStatus:{textContent:""},
    scheduleTableBody:{innerHTML:"",appendChild(){}},
    editSaveBtn:{classList:{toggle(){}}},
    modeBadge:{},
    addClassBtn:{classList:{toggle(){}}},
    addEventBtn:{classList:{toggle(){}}}
  };
  const inputs={
    ".time-start":{value:"08:00"},
    ".time-end":{value:"08:45"},
    ".mon-sec":{value:"Grade 11-A"},
    ".mon-sub":{value:"Programming"},
    ".mon-evt":{value:""}
  };
  const row={
    dataset:{rowType:"class"},
    querySelector:selector=>inputs[selector] || (selector.endsWith(".flatpickr-input") ? null : {value:""})
  };
  const writes=[];
  const context={
    window:{showSubtleLoader(){},hideSubtleLoader(){},addEventListener(){}},
    localStorage:storage,lessonStorage:scopedStorage(storage,"teacher-fixture"),db:{},
    workspaceOnReady(){},workspaceUid:()=>"teacher-fixture",requireStaffWorkspace:async()=>"teacher-fixture",assertWorkspaceAccount:uid=>assert.equal(uid,"teacher-fixture"),requireCurrentVersion,serverTimestamp:()=>"synthetic-timestamp",
    ownedDoc:(_db,kind,id)=>({id,path:workspacePath("teacher-fixture",kind,id).join("/")}),
    runTransaction:async(_db,work)=>work({get:async()=>({exists:()=>false}),set:(ref,data)=>writes.push({id:ref.id,path:ref.path,data})}),
    document:{
      addEventListener(){},
      getElementById:id=>elements[id]||null,
      querySelectorAll:selector=>selector==="#scheduleTableBody tr"?[row]:[],
      createElement:()=>({dataset:{},className:"",innerHTML:""})
    },
    scheduleScope,parseScheduleRows,parseClockMinutes,isLegacySharedScope,isLegacyScheduleRetired,legacyScheduleNotice,resolveSectionGrade,scheduleRowsToText,
    auth:{currentUser:{email:"other-teacher@example.edu"}},ADMIN_EMAIL:"admin@example.edu",TEACHER_EMAIL:"original-teacher@example.edu",
    doc:(_db,_collection,id)=>({id}),
    getDoc:async()=>({exists:()=>false}),
    setDoc:async(ref,data)=>{writes.push({id:ref.id,data});},
    alert:message=>{throw Error("Unexpected alert: "+message);},
    confirm:()=>true,
    console,
    flatpickr:()=>{}
  };
  vm.runInNewContext(source,context);
  await context.window.changeSchedulePeriod();
  assert.equal(await context.window.saveScheduleData(),true);
  assert.equal(writes[0].id,"master_schedule_SY20262027_S2");
  assert.match(writes[0].path,/staff_workspaces\/teacher-fixture\/schedules\//);
  assert.equal(writes[0].data.ownerUid,"teacher-fixture");
  assert.match(writes[0].data.raw_text,/Grade 11-A \(Programming\)/);
  elements.scheduleSemester.value="S1";
  await context.window.changeSchedulePeriod();
  assert.equal(await context.window.saveScheduleData(),true);
  assert.equal(writes[1].id,"master_schedule_SY20262027_S1");
  assert.equal(values.get("Adminerva_schedule"),"OLD FIRST SEMESTER");
});

test("lesson planner resolves schedules by academic term, not global legacy cache",()=>{
  const firebase=readFileSync("js/lesson-review/lesson-firebase.js","utf8");
  const generator=readFileSync("js/lesson-review/ai-engine.js","utf8");
  const page=readFileSync("schedule.html","utf8");
  assert.match(firebase,/window\.fetchScheduleForLesson/);
  assert.match(firebase,/schedule: await window\.fetchScheduleForLesson\(schoolYear, academicTerm, grade, subject\)/);
  assert.match(generator,/await window\.fetchScheduleForLesson\(schoolYear, academicTerm, targetGrade, subject\)/);
  for (const id of ["scheduleSchoolYear","scheduleSemester","scheduleScopeStatus"])
    assert.ok(page.includes('id="'+id+'"'),"Missing semester selector "+id);
});

test("start-time edits do not silently shorten existing lessons or labs",()=>{
  const script=readFileSync("js/lesson-review/schedule.js","utf8");
  const start=script.indexOf("window.autoFillEndTime = function");
  const end=script.indexOf("function formatTimeToAMPM",start);
  const context={window:{},Date};
  vm.runInNewContext(script.slice(start,end),context);
  const endTime={value:"11:00"};
  const row={querySelector:selector=>selector===".time-end"?endTime:null};
  const startTime={closest:selector=>selector==="tr"?row:null};
  context.window.autoFillEndTime("08:30",startTime);
  assert.equal(endTime.value,"11:00","Existing 3-hour class ending must be preserved");
  endTime.value="";
  context.window.autoFillEndTime("08:30",startTime);
  assert.equal(endTime.value,"09:15","Empty end-time gets a helpful default");
});

test("time parsing validates real 24-hour times, not arbitrary strings",()=>{
  assert.equal(parseClockMinutes("08:00"),480);
  assert.equal(parseClockMinutes("13:45"),825);
  for(const invalid of ["8:00","25:00","12:65","bad","",null]){
    assert.equal(parseClockMinutes(invalid),null,String(invalid));
  }
});

test("schedule edits warn before leaving the page without saving",()=>{
  const schedule=readFileSync("js/lesson-review/schedule.js","utf8");
  assert.match(schedule,/window\.addEventListener\("beforeunload"/);
  assert.match(schedule,/if \(!isEditing\) return;/);
});
