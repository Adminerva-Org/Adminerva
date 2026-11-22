import test from "node:test";
import assert from "node:assert/strict";
import {COURSES,hashSeed} from "../functions/practice-courses.mjs";
import {PRACTICE_SEASON,missionMeta,seasonActivity,publicActivity} from "../functions/practice-season.mjs";

test("operator precedence Bug Hunt states the goal and tests precedence",()=>{
  const course=COURSES.find(item=>item.id==="java");
  const mission=course.missions.find(item=>
    item.title.startsWith("Apply operator precedence")&&missionMeta(course,item).type==="debugging");
  assert.ok(mission,"expected a Java operator-precedence Bug Hunt mission");
  assert.equal(mission.practiceTopic,"precedence");

  const seed=Math.abs(hashSeed(PRACTICE_SEASON+mission.id));
  const activity=seasonActivity(course,mission,seed);

  assert.equal(activity.type,"debugging");
  assert.equal(activity.focusLine,1);
  assert.match(activity.debugGoal,/operator precedence|multiply/i);
  assert.match(activity.debugGoal,/should print/i);
  assert.match(activity.code,/\([^\n]+\+[^\n]+\)\s*\*/);
  assert.doesNotMatch(activity.code,/points\s*-=/);

  const publicQuestion=publicActivity(activity);
  assert.equal(publicQuestion.debugGoal,activity.debugGoal);
  assert.equal("solution" in publicQuestion,false);
  assert.equal("why" in publicQuestion,false);
});

test("numeric Bug Hunt missions expose a specific expected behavior before repair",()=>{
  for(const course of COURSES.filter(item=>["java","python","logic"].includes(item.id))){
    for(const mission of course.missions.filter(item=>missionMeta(course,item).type==="debugging")){
      const seed=Math.abs(hashSeed(PRACTICE_SEASON+mission.id));
      const activity=seasonActivity(course,mission,seed);
      assert.ok(String(activity.debugGoal||"").trim(),course.id+" "+mission.id+" missing debugGoal");
      assert.match(activity.prompt,/Which replacement fixes line \d+\?/);
      assert.ok(Number.isInteger(activity.focusLine)&&activity.focusLine>=1);
    }
  }
});
