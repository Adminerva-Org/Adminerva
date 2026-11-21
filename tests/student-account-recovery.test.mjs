import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";

const require=createRequire(import.meta.url);
const {studentAccountUids,studentRecordUidAllowed}=require("../functions/student-account-history.js");

test("student account history keeps the current login first and deduplicates prior UIDs",()=>{
  const person={previousAuthUids:["old-login","old-login","older-login"]};
  assert.deepEqual(studentAccountUids(person,"new-login"),["new-login","old-login","older-login"]);
  assert.equal(studentRecordUidAllowed(person,"new-login","old-login"),true);
  assert.equal(studentRecordUidAllowed(person,"new-login","other-student"),false);
});

test("invalid or current duplicate account IDs are excluded from historical access",()=>{
  const person={previousAuthUids:["new-login","",null,"bad uid","legacy_ok"]};
  assert.deepEqual(studentAccountUids(person,"new-login"),["new-login","legacy_ok"]);
});

const people=readFileSync(new URL("../functions/people-directory.js",import.meta.url),"utf8");
const peopleUi=readFileSync(new URL("../js/school-admin/people-access.mjs",import.meta.url),"utf8");
const peopleHtml=readFileSync(new URL("../people-access.html",import.meta.url),"utf8");
const gradebook=readFileSync(new URL("../functions/school-gradebook.js",import.meta.url),"utf8");
const studioProjects=readFileSync(new URL("../functions/school-studio-projects.js",import.meta.url),"utf8");
const studioSubmissions=readFileSync(new URL("../functions/school-studio-submissions.js",import.meta.url),"utf8");
const generalSubmissions=readFileSync(new URL("../functions/school-assessment-submissions.js",import.meta.url),"utf8");
const githubEvidence=readFileSync(new URL("../functions/school-github-evidence.js",import.meta.url),"utf8");
const studentProfile=readFileSync(new URL("../functions/school-student-profile.js",import.meta.url),"utf8");

test("account recovery is preview-first and preserves the canonical student person",()=>{
  assert.match(people,/preview_student_account_recovery/);
  assert.match(people,/recover_student_account/);
  assert.match(people,/previousAuthUids/);
  assert.match(people,/mergedIntoPersonId:personId/);
  assert.match(people,/status:"archived",authUid:null/);
  assert.match(people,/status:"suspended"/);
  assert.match(people,/action:"student_account_recovered"/);
  assert.match(people,/action:"duplicate_student_person_archived"/);
  assert.doesNotMatch(people,/tx\.delete\(review\.refs\.replacementRef/);
});

test("automatic account recovery fails closed when the replacement owns assessed or official records",()=>{
  assert.match(people,/official active registration/);
  assert.match(people,/already has grade history/);
  assert.match(people,/already has Studio submissions/);
  assert.match(people,/already has assessment submissions/);
  assert.match(people,/already has class repository configuration/);
  assert.match(people,/another school role/);
});

test("People and Access exposes the recovery only as an explicit reviewed action",()=>{
  assert.match(peopleHtml,/Student account recovery/);
  assert.match(peopleHtml,/Preview account recovery/);
  assert.match(peopleHtml,/Recover this student account/);
  assert.match(peopleUi,/preview_student_account_recovery/);
  assert.match(peopleUi,/recover_student_account/);
  assert.match(peopleUi,/expectedCanonicalRevision/);
  assert.match(peopleUi,/confirm\("Replace this student's school login/);
});

test("academic reads follow person identity while immutable artifacts keep UID provenance",()=>{
  assert.match(gradebook,/grades\.where\("personId","==",personId\)/);
  for(const source of [studioProjects,studioSubmissions,generalSubmissions,githubEvidence,studentProfile]){
    assert.match(source,/student-account-history\.js/);
  }
  assert.match(studioSubmissions,/previousStudentUids/);
  assert.match(generalSubmissions,/previousStudentUids/);
  assert.match(githubEvidence,/previousStudentUids/);
});
