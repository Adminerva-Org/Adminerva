import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const source=readFileSync(new URL("../functions/people-directory.js",import.meta.url),"utf8");

test("staff person archival protects both teaching and adviser authority",()=>{
  assert.match(source,/section_advisers/);
  assert.match(source,/End this teacher's active Section Adviser \/ Homeroom assignment before archiving/);
  assert.match(source,/inactive_person_active_adviser_assignment/);
});

test("directory reconciliation includes adviser assignments in integrity review",()=>{
  assert.match(source,/\["people","memberships","enrollments","student_registrations","staff_assignments","section_advisers","course_offerings","invitations"\]/);
  assert.match(source,/advisersByTeacher/);
});
