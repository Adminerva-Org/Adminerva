import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source=fs.readFileSync("js/lesson-review/app-ui.js","utf8");
const overviewStart=source.indexOf("window.renderOverview = function ()");
const overviewEnd=source.indexOf("window.syncOutputToData=",overviewStart);
assert.ok(overviewStart>0 && overviewEnd>overviewStart,"Expected separate overview and sync implementations");
const overviewCode=source.slice(overviewStart,overviewEnd);

test("weekly overview renders without referencing an absent session or index",()=>{
 const container={
   classList:{add(){},remove(){}},
   innerHTML:"",
   querySelectorAll(){return[]}
 };
 const context={window:{
   currentWeeklyOverview:{
     topic:"Programming",content_standard:"Algorithms",
     performance_standard:"Working code",materials:"Laptop"
   }
 },document:{getElementById:id=>id==="weeklyOverviewContainer"?container:null},
 escapeLessonText:value=>String(value)};
 vm.runInNewContext(overviewCode,context);
 assert.doesNotThrow(()=>context.window.renderOverview());
 assert.match(container.innerHTML,/Content Standard/);
 assert.match(container.innerHTML,/Performance Standard/);
 assert.match(container.innerHTML,/Materials & Tech/);
 assert.doesNotMatch(container.innerHTML,/data-key="objectives"/);
});
test("objectives are editable in each regular session rather than the weekly overview",()=>{
 const render=source.slice(source.indexOf("window.renderOutput = function ()"));
 assert.match(render,/data-key="objectives"/);
 assert.match(render,/session\.objectives/);
 assert.ok(render.indexOf('data-key="objectives"')<render.indexOf("Learning Activities"));
});

test("older saved lessons can render without a weekly overview",()=>{
 const start=source.indexOf("window.loadSpecificPlan = function (planData)");
 const end=source.indexOf("window.generateRollingWeekDropdown = function ()",start);
 assert.ok(start>=0 && end>start);
 const code=source.slice(start,end);
 const fields=new Map();
 for(const key of ["lpSchoolYear","lpAcademicTerm","lpCourseWeek","lpDateRange","lpCustomInstructions","lpGradeLevel"]){
   fields.set(key,{value:"",options:[],appendChild(){},});
 }
 const context={
   window:{currentPlan:[],currentWeeklyOverview:null,renderOverview(){},renderOutput(){},closeLoadPlanModal(){}},
   document:{
     getElementById:id=>fields.get(id)||null,
     querySelectorAll:()=>[],
     querySelector:()=>null,
     createElement:()=>({value:"",textContent:""})
   },
   localStorage:{setItem(){}},alert(){}
 };
 vm.runInNewContext(code,context);
 assert.doesNotThrow(()=>context.window.loadSpecificPlan({
   grade_level:"Grade 11",sessions:[{session_name:"Session 1",topic:"Algorithms"}]
 }));
 assert.equal(context.window.currentWeeklyOverview.topic,"");
 assert.equal(context.window.currentPlan.length,1);
});
test("lesson generation schema requests school-required session fields",()=>{
 const ai=fs.readFileSync("js/lesson-review/ai-engine.js","utf8");
 for(const field of ["competencies","objectives","evaluation","remarks"]){
   assert.match(ai,new RegExp('"'+field+'"'));
 }
 assert.match(ai,/Previous lesson unavailable; generating without lookback/);
});
test("print exporter uses the active Adminerva teacher and subject settings",()=>{
 const exporter=fs.readFileSync("js/lesson-review/document-exporter.js","utf8");
 assert.match(exporter,/localStorage\\.getItem\\("Adminerva_defaultSubject"\\)/);
 assert.match(exporter,/localStorage\\.getItem\\("Adminerva_defaultTeacher"\\)/);
});
