import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFile} from "node:fs/promises";
const require=createRequire(import.meta.url);
const {studentAccountUids,studentRecordUidAllowed}=require("../functions/student-account-history.js");

test("student account history keeps current login first and deduplicates prior logins",()=>{
  const person={previousAuthUids:["old-a","old-b","old-a","current"]};
  assert.deepEqual(studentAccountUids(person,"current"),["current","old-a","old-b"]);
  assert.equal(studentRecordUidAllowed(person,"current","old-a"),true);
  assert.equal(studentRecordUidAllowed(person,"current","unknown"),false);
});

test("People & Access recovery is preview-first, revision-safe, and archives only the duplicate identity",async()=>{
  const source=await readFile(new URL("../functions/people-directory.js",import.meta.url),"utf8");
  for(const marker of [
    'input.action==="preview_student_account_recovery"',
    'input.action==="recover_student_account"',
    "expectedCanonicalRevision","expectedReplacementMembershipRevision","mergedIntoPersonId",
    'action:"student_account_recovered"','action:"duplicate_student_person_archived"'
  ])assert.ok(source.includes(marker),"Missing recovery contract: "+marker);
  assert.match(source,/student_registrations/);
  assert.match(source,/class_record_period_grades/);
  assert.match(source,/assessment_threads/);
  assert.match(source,/active class enrollment/);
  assert.doesNotMatch(source,/delete\(review\.refs\.replacementRef\)/);
});

test("student-facing academic services resolve recovered login history",async()=>{
  const files=["school-gradebook.js","school-assessment-submissions.js","school-github-evidence.js",
    "school-studio-submissions.js","school-studio-assessment-variants.js","school-studio-projects.js",
    "school-student-profile.js","school-assessment-conversation.js"];
  for(const file of files){
    const source=await readFile(new URL("../functions/"+file,import.meta.url),"utf8");
    assert.match(source,/student-account-history\.js/,file+" must use canonical account history");
  }
});

test("People & Access exposes a guarded account recovery panel",async()=>{
  const [html,ui]=await Promise.all([
    readFile(new URL("../people-access.html",import.meta.url),"utf8"),
    readFile(new URL("../js/school-admin/people-access.mjs",import.meta.url),"utf8")
  ]);
  assert.match(html,/id="pa-account-recovery-card"/);
  assert.match(html,/Preview recovery/);
  assert.match(ui,/preview_student_account_recovery/);
  assert.match(ui,/recover_student_account/);
  assert.match(ui,/recoveryPreview/);
});
