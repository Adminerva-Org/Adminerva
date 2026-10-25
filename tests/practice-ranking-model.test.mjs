import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {COURSES,practiceQuestion} from "../js/student/practice-courses.mjs";
import {practiceAlias,completionTotal,automaticStandings,PRACTICE_MAXIMUM} from "../js/student/practice-ranking-model.mjs";
test("course hierarchy preserves legacy IDs and matches exact permission-rule mission catalogs",()=>{
 const rules=readFileSync("firestore.rules","utf8");
 for(const course of COURSES){const match=rules.match(new RegExp('courseId == "'+course.id+'" \\? (\\[[^\\n]+\\]) :'));assert.ok(match,course.id);assert.deepEqual(JSON.parse(match[1]),course.missions.map(mission=>mission.id));}
 assert.equal(PRACTICE_MAXIMUM,300);
});
test("recorded-completion XP is deduplicated, course scoped and is never a school grade",()=>{
 assert.equal(completionTotal([{courseId:"java",completed:["j1","j1","p2","forged"]},{courseId:"python",completed:["p2"]}]),2);
 assert.equal(completionTotal(COURSES.map(course=>({courseId:course.id,completed:course.missions.map(mission=>mission.id)}))),300);
 const rows=automaticStandings([{studentId:"alice",alias:practiceAlias("alice"),points:20,completedCount:2,email:"private@example.edu"},{studentId:"bob",alias:practiceAlias("bob"),points:20,completedCount:2},{alias:"Name",points:9000,completedCount:900}],"alice");
 assert.deepEqual(rows.map(row=>row.rank),[1,1]);assert.equal(rows.filter(row=>row.isCurrent).length,1);assert.ok(rows.every(row=>row.email===undefined&&row.studentId===undefined));
 assert.equal(practiceAlias("alice"),practiceAlias("alice"));assert.notEqual(practiceAlias("alice"),practiceAlias("bob"));
});
test("feedback independently scopes checkpoints, selected historical patches and actionable pending criteria",async()=>{
 const {buildRubricPrompt,parseSuggestedRubric}=await import("../js/repo-review/services/v2-grading-assistant.mjs");
 const checkpoint="a".repeat(40),commit="b".repeat(40),path="layout/row.xml",criteria=[{name:"XML",maxScore:5},{name:"Visual",maxScore:5}];
 const prompt=buildRubricPrompt({assessment:{maxScore:10},criteria,checkpointSha:checkpoint,files:[{path,text:"<TextView/>"}],patches:[{sha:commit,path,patch:"+<TextView/>"}],contributionScope:"Responsibilities need clarification"});
 assert.match(prompt,/including historical commits with a different SHA/);assert.match(prompt,/does not automatically invalidate instructor-verified attribution/);assert.match(prompt,/not observed in the inspected source/);
 const result=parseSuggestedRubric({criteria:[{status:"supported",score:4,evidence:[{sha:commit,path}],rationale:"The verified XML implements the named element."},{status:"needs_teacher_review",score:null,rationale:"Visual rendering has not been inspected.",reviewAction:"Inspect the pinned layout preview at narrow and wide screen sizes."}],feedback:"The XML defines the element. Inspect its visual layout before a final score."},criteria,10,{patches:[{sha:commit,path,substantive:true}]});
 assert.equal(result.score,null);assert.equal(result.partialScore,4);assert.equal(result.scoredMaximum,5);assert.equal(result.pendingCriteria,1);assert.match(result.criteria[1].reviewAction,/Inspect/);
});
test("help remains consolidated without injected page-heading links and review navigation precedes scrolling content",()=>{
 const help=readFileSync("js/help/page-help.mjs","utf8"),menu=readFileSync("js/core/information-menu.mjs","utf8"),html=readFileSync("repofetch.html","utf8");
 assert.doesNotMatch(help,/headerHelp|querySelector\("h1"\)/);assert.match(help,/page-help-open/);assert.match(menu,/data-information-help/);
 assert.ok(html.indexOf('id="manualReviewSteps"')<html.indexOf('id="manualReviewBody"'));
});

function completionFixture(){
 const source=readFileSync("js/student/practice.js","utf8");
 let release;const gate=new Promise(resolve=>{release=resolve;});
 const requests=[],removed=[],loaded=[];
 const context=vm.createContext({status(){},pendingKey:()=>"alice-pending",sessionStorage:{removeItem:key=>removed.push(key)},
  practiceRequest:async(name,payload)=>{requests.push({name,payload});await gate;return {awarded:true};},loadProgress:async()=>loaded.push(true)});
 vm.runInContext('let user={uid:"alice"};'+source.slice(source.indexOf("async function submitCompletion("),source.indexOf("async function finishMission(")),context);
 return {context,release,requests,removed,loaded};
}
test("completion sends an attempt and reflection, never client-computed XP, and keeps the outbox until acknowledged",async()=>{
 const fixture=completionFixture(),saving=vm.runInContext('submitCompletion({attemptId:"attempt",observation:"Observed result"})',fixture.context);
 await Promise.resolve();assert.equal(fixture.removed.length,0);
 assert.equal(fixture.requests[0].name,"practiceComplete");
 assert.deepEqual(Object.keys(fixture.requests[0].payload),["attemptId","observation"]);
 fixture.release();await saving;
 assert.equal(fixture.removed.length,1);assert.equal(fixture.loaded.length,1);
});
test("an account change during a pending completion cannot remove another account's outbox or display its progress",async()=>{
 const fixture=completionFixture(),saving=vm.runInContext('submitCompletion({attemptId:"attempt",observation:"Observed result"})',fixture.context);
 await Promise.resolve();vm.runInContext('user={uid:"bob"};',fixture.context);fixture.release();
 await assert.rejects(saving,/Account changed/);assert.equal(fixture.removed.length,0);assert.equal(fixture.loaded.length,0);
});
test("deployable server curriculum matches the client curriculum exactly",()=>{
 for(const name of ["practice-courses.mjs","practice-curriculum.mjs"]){
  const normalize=source=>source.replace(/\r/g,"").replace(/\.\/practice-curriculum\.mjs(?:\?v=[^"']+)?/g,"./practice-curriculum.mjs");
  assert.equal(normalize(readFileSync("functions/"+name,"utf8")),normalize(readFileSync("js/student/"+name,"utf8")),name);
 }
});

test("practice expiry policies include the required index configuration and never target earned progress",()=>{
 const configuration=JSON.parse(readFileSync("firestore.indexes.json","utf8"));
 assert.deepEqual(configuration.fieldOverrides.map(field=>field.collectionGroup),["practice_attempts","practice_sessions","practice_browser_sessions","practice_security_events","practice_season_attempts","school_ai_results"]);
 for(const field of configuration.fieldOverrides){
  assert.equal(field.fieldPath,"expiresAt");assert.equal(field.ttl,true);assert.deepEqual(field.indexes,[]);
 }
 const service=readFileSync("functions/practice-service.js","utf8");
 assert.doesNotMatch(service,/\.where\(["']expiresAt["']/);
});
