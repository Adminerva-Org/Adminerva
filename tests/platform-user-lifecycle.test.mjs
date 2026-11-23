import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const backend=readFileSync(new URL("../functions/platform-users.js",import.meta.url),"utf8");
const client=readFileSync(new URL("../js/core/platform-users.mjs",import.meta.url),"utf8");
const page=readFileSync(new URL("../system-users.html",import.meta.url),"utf8");
const peopleClient=readFileSync(new URL("../js/school-admin/people-access.mjs",import.meta.url),"utf8");
const peoplePage=readFileSync(new URL("../people-access.html",import.meta.url),"utf8");

test("System Admin loads the complete Firebase Auth directory rather than one 25-user page",()=>{
  assert.match(backend,/if\(action==="list_all"\)/);
  assert.match(backend,/auth\.listUsers\(1000,pageToken\)/);
  assert.match(backend,/if\(users\.length>10000\)/);
  assert.match(client,/api\(\{action:"list_all"\}\)/);
  assert.match(client,/items\.length\+" total"/);
  assert.doesNotMatch(client,/pageSize:25/);
  assert.doesNotMatch(page,/25 Firebase Auth accounts per page/);
  assert.doesNotMatch(page,/id="pu-prev"/);
  assert.doesNotMatch(page,/id="pu-next"/);
});

test("global account lifecycle is audited and preserves school-owned history",()=>{
  for(const action of ["create","update_profile","disable","restore","reset_password"])
    assert.match(backend,new RegExp('action==="'+action+'"'));
  assert.match(backend,/db\.collection\("platform_audit"\)\.add/);
  assert.match(backend,/auth\.createUser\(/);
  assert.match(backend,/auth\.updateUser\(uid,\{displayName\}\)/);
  assert.match(backend,/auth\.updateUser\(uid,\{disabled:disabling\}\)/);
  assert.match(backend,/auth\.generatePasswordResetLink\(/);
  assert.doesNotMatch(backend,/auth\.deleteUser\(/);
  assert.match(page,/School person, enrollment, academic history and evidence remain in their school-scoped canonical workflows/);
});

test("dangerous platform-account lifecycle cases fail closed",()=>{
  assert.match(backend,/uid===authority\.uid&&disabling/);
  assert.match(backend,/Active Platform Administrator accounts must be retired from platform governance before they can be disabled/);
  assert.match(backend,/Restore this account before generating a password reset link/);
  assert.match(backend,/reason\(input\.reason\)/);
  assert.match(backend,/requiredText\(value,label,12,500\)/);
});

test("System Admin UI exposes account create, recovery, restore and profile correction without claiming school-person CRUD",()=>{
  assert.match(page,/id="pu-create"/);
  assert.match(page,/id="pu-save-profile"/);
  assert.match(page,/id="pu-reset-password"/);
  assert.match(page,/id="pu-platform-authority"/);
  assert.match(page,/id="pu-lifecycle"/);
  assert.match(page,/Student account replacement\/reconciliation stays in the canonical school People &amp; Access recovery workflow/);
  assert.match(client,/runDetailAction\("reset_password"/);
  assert.match(client,/currentAccount\.disabled\?"restore":"disable"/);
  assert.match(client,/action:"create",displayName,email,reason/);
});


test("Platform Administrator authority has an audited archive and restore lifecycle",()=>{
  for(const action of ["grant_platform_admin","archive_platform_admin","restore_platform_admin"])
    assert.match(backend,new RegExp(action));
  assert.match(backend,/You cannot retire your own Platform Administrator authority/);
  assert.match(backend,/Designate another active Platform Administrator before retiring this authority/);
  assert.match(backend,/platform_admin_granted/);
  assert.match(backend,/platform_admin_archived/);
  assert.match(backend,/platform_admin_restored/);
  assert.match(client,/platformAdminStatus==="active"\?"archive_platform_admin"/);
  assert.match(page,/Retired Platform admins/);
});


test("explicit test students can receive non-destructive cross-school student access",()=>{
  for(const action of ["mark_test_student","retire_test_student","grant_test_student_school_access","list_test_school_targets"])
    assert.match(backend,new RegExp(action));
  assert.match(backend,/platform_test_accounts\/"\+uid/);
  assert.match(backend,/Designate this login as a test student before granting cross-school test access/);
  assert.match(backend,/roles:\["student"\]/);
  assert.match(backend,/testStudentAccess:true/);
  assert.match(backend,/source:"platform_test_student"/);
  assert.match(backend,/platform_test_student_school_access_granted/);
  assert.match(backend,/db\.collection\("schools\/"\+targetSchoolId\+"\/directory_audit"\)/);
  assert.doesNotMatch(backend,/student_grades.*grant_test_student_school_access/);
  assert.doesNotMatch(backend,/assessment_submissions.*grant_test_student_school_access/);
  assert.doesNotMatch(backend,/studio_submissions.*grant_test_student_school_access/);
});

test("System Admin test mobility UI routes placement into the canonical school workflow",()=>{
  for(const id of ["pu-test-toggle","pu-test-school","pu-test-grant","pu-test-status"])
    assert.match(page,new RegExp('id="'+id+'"'));
  assert.match(page,/This does not move or delete the source school/);
  assert.match(client,/action:"grant_test_student_school_access"/);
  assert.match(client,/enrollmentMode==="canonical"\?"school-enrollment\.html":"people-access\.html"/);
  assert.match(client,/Adminerva_platform_school_mode","assist"/);
  assert.match(client,/Manage placement/);
});

test("compatibility People and Access mutations preserve explicit System Admin Assist authority",()=>{
  assert.match(peopleClient,/function assistMode\(\)/);
  assert.match(peopleClient,/Adminerva_platform_school_mode/);
  assert.ok((peopleClient.match(/platformMode:"assist"/g)||[]).length>=3);
  assert.match(peoplePage,/people-access\.mjs\?v=20261123-system-assist1/);
});
