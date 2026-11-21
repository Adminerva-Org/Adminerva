import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";

const require=createRequire(import.meta.url);
const {progressionGradeValid}=require("../functions/school-enrollment.js");
const source=readFileSync(new URL("../functions/school-enrollment.js",import.meta.url),"utf8");

test("numeric promotion advances exactly one grade while retention stays in grade",()=>{
  assert.equal(progressionGradeValid("promotion","7","8"),true);
  assert.equal(progressionGradeValid("promotion","7","9"),false);
  assert.equal(progressionGradeValid("promotion","7","7"),false);
  assert.equal(progressionGradeValid("retention","7","7"),true);
  assert.equal(progressionGradeValid("retention","7","8"),false);
  assert.equal(progressionGradeValid("graduation","12",null),true);
});

test("progression requires released Class Record final grades",()=>{
  assert.match(source,/class_record_finalizations/);
  assert.match(source,/releasedRevision/);
  assert.match(source,/class_record_period_grades/);
  assert.match(source,/final_grade_not_released/);
  assert.match(source,/A registration-owned class does not yet have the student's released Final Grade/);
});

test("progression preserves source registration and creates linked next placement",()=>{
  assert.match(source,/endReasonType:"progression",progressionType/);
  assert.match(source,/previousRegistrationId:registrationId,progressionType/);
  assert.match(source,/progressedToRegistrationId/);
  assert.match(source,/student_registration_progressed/);
  assert.match(source,/enrollmentSource:"official_progression"/);
});

test("graduated or progressed registrations cannot be directly restored",()=>{
  assert.match(source,/if\(restoring&&data\.progressionType\)/);
  assert.match(source,/progressed or graduated registration cannot be restored directly/);
});
