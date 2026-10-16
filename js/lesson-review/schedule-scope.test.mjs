import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {scheduleScope, scheduleSemester, normalizeSchoolYear, parseScheduleRows, localScheduleText} from "./schedule-scope.mjs";

test("semester and school-year timetables never share document or cache keys",()=>{
  const first=scheduleScope("2026-2027","S1");
  const second=scheduleScope("2026-2027","S2");
  const other=scheduleScope("2027-2028","S2");
  assert.equal(first.id,"master_schedule_SY20262027_S1");
  assert.equal(second.id,"master_schedule_SY20262027_S2");
  assert.notEqual(first.id,second.id);
  assert.notEqual(other.jsonKey,second.jsonKey);
  assert.notEqual(first.textKey,second.textKey);
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
    setItem:(key,value)=>values.set(key,String(value))
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
    window:{showSubtleLoader(){},hideSubtleLoader(){}},
    localStorage:storage,db:{},
    document:{
      addEventListener(){},
      getElementById:id=>elements[id]||null,
      querySelectorAll:selector=>selector==="#scheduleTableBody tr"?[row]:[],
      createElement:()=>({dataset:{},className:"",innerHTML:""})
    },
    scheduleScope,parseScheduleRows,
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
  assert.match(firebase,/schedule: await window\.fetchScheduleForLesson\(schoolYear, academicTerm\)/);
  assert.match(generator,/await window\.fetchScheduleForLesson\(schoolYear, academicTerm\)/);
  for (const id of ["scheduleSchoolYear","scheduleSemester","scheduleScopeStatus"])
    assert.ok(page.includes('id="'+id+'"'),"Missing semester selector "+id);
});
