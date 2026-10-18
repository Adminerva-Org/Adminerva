/** Regression coverage: Lesson planning, school schedules, references and document export: lesson plan helpers. */
import test from "node:test";
import assert from "node:assert/strict";
import {quarterCode,schoolYearPlanId,legacyPlanId,expectedSessions,validateGeneratedLesson} from "./lesson-plan-helpers.mjs";
const base={grade:"Grade 11",subject:"Mobile App Development",term:"FIRST SEMESTER/SECOND QUARTER",week:"Week 5"};
test("school years cannot overwrite one another or legacy plans",()=>{
  const a=schoolYearPlanId({...base,schoolYear:"2025-2026"});
  const b=schoolYearPlanId({...base,schoolYear:"2026-2027"});
  assert.notEqual(a,b);
  assert.notEqual(a,legacyPlanId(base));
  assert.equal(a,schoolYearPlanId({...base,schoolYear:"2025-2026"}));
  assert.match(a,/SY20252026_Q2_Week5/);
});
test("quarter and session requirements follow existing lesson formats",()=>{
  assert.equal(quarterCode("SECOND SEMESTER/FOURTH QUARTER"),"Q4");
  assert.equal(expectedSessions("Grade 11").length,5);
  assert.deepEqual(expectedSessions("Grade 12"),["Session 1","Session 2","Session 3","Session Flex"]);
});
test("AI generation flags missing standards and sessions",()=>{
  const plan={weekly_overview:{topic:"Topic",content_standard:"",performance_standard:"Required",materials:"- laptop"},sessions:[]};
  assert.ok(validateGeneratedLesson(plan,"Grade 11").some(x=>x.includes("content_standard")));
  assert.ok(validateGeneratedLesson(plan,"Grade 11").some(x=>x.includes("Expected 5 sessions")));
});
test("valid plans pass without rewriting teachers' exact content",()=>{
  const sessions=expectedSessions("Grade 11").map(session_name=>({
    session_name,learning_activities:"- Debugging",competencies:"A",objectives:"B",evaluation:"C",remarks:"D"
  }));
  const plan={weekly_overview:{topic:"T",content_standard:"C",performance_standard:"P",materials:"M"},sessions};
  assert.deepEqual(validateGeneratedLesson(plan,"Grade 11"),[]);
  assert.equal(plan.sessions[0].objectives,"B");
});
