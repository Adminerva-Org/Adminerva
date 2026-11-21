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


test("promotion into a student-login grade requires canonical identity readiness",()=>{
  assert.match(source,/targetStudentEmailRequired=gradeRequiresStudentEmail\(targetGrade\)/);
  assert.match(source,/student_identity_required/);
  assert.match(source,/activation email or link their verified account in People & Access/);
  assert.match(source,/accountResponsibility:targetStudentEmailRequired\?"student":"guardian"/);
});

test("progression final-grade gate requires the released revision to match the student's finalized grade",()=>{
  assert.match(source,/gradeData\.status==="finalized"/);
  assert.match(source,/Number\(gradeData\.finalizationRevision\)===releasedRevision/);
});


test("student placement history is derived from canonical registrations and registrar audit records",()=>{
  assert.match(source,/if\(input\.action==="student_history"\)/);
  assert.match(source,/student_registrations/);
  assert.match(source,/directory_audit/);
  assert.match(source,/activeRegistrationCount/);
  assert.match(source,/progressedToRegistrationId/);
  assert.doesNotMatch(source.slice(
    source.indexOf('if(input.action==="student_history")'),
    source.indexOf('if(input.action==="list_registrations")')
  ),/student_grades|class_record_period_grades/);
});


test("progression blocks mismatched canonical registration rosters",()=>{
  assert.match(source,/registration_roster_mismatch/);
  assert.match(source,/registration_course_count_mismatch/);
  assert.match(source,/row\.registrationId===registrationId/);
});

test("placement history includes the initial registration audit event",()=>{
  assert.match(source,/\^student_\(\?:registration_\|registered_\)/);
});


test("cohort progression reuses individual preview and audited progression transactions",()=>{
  const frontend=readFileSync(new URL("../js/school-admin/enrollment.mjs",import.meta.url),"utf8");
  assert.match(frontend,/mapLimit\(candidates,4/);
  assert.match(frontend,/perform\("preview_progression",payload\)/);
  assert.match(frontend,/perform\("progress_registration",\{\.\.\.row\.payload,reason\}\)/);
  assert.match(frontend,/Each registration will be committed and audited independently/);
  assert.match(frontend,/exceeds 60 active registrations/);
});

test("cohort preview is invalidated when canonical registrations refresh",()=>{
  const frontend=readFileSync(new URL("../js/school-admin/enrollment.mjs",import.meta.url),"utf8");
  assert.match(frontend,/Registration data changed\. Preview the cohort again/);
  assert.match(frontend,/cohortPreview=null/);
  assert.match(frontend,/cohortForm\(\)\.reset\(\)/);
});
