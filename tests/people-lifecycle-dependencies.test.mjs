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

test("person lifecycle changes require the reviewed revision",()=>{
  assert.match(source,/expectedRevision=Number\(input\.expectedRevision\)/);
  assert.match(source,/currentRevision!==expectedRevision/);
});


test("school membership suspend and restore require the reviewed revision",()=>{
  assert.match(source,/list_memberships[\s\S]*revision:Number\(member\.data\(\)\.revision\)\|\|1/);
  assert.match(source,/suspend_access[\s\S]*expectedRevision=Number\(input\.expectedRevision\)/);
  assert.match(source,/school access record changed after you reviewed it[\s\S]*suspending access/);
  assert.match(source,/restore_access[\s\S]*expectedRevision=Number\(input\.expectedRevision\)/);
  assert.match(source,/school access record changed after you reviewed it[\s\S]*restoring access/);
});


test("linked staff activation is pinned to the reviewed person revision",()=>{
  assert.match(source,/search_people[\s\S]*revision:Number\(person\.data\(\)\.revision\)\|\|1/);
  assert.match(source,/activate_linked_staff[\s\S]*expectedPersonRevision=Number\(input\.expectedPersonRevision\)/);
  assert.match(source,/staff identity changed after you selected it/);
});
