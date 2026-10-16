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
