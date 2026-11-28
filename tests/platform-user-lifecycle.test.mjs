import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);

const backend=readFileSync(new URL("../functions/platform-users.js",import.meta.url),"utf8");
const client=readFileSync(new URL("../js/core/platform-users.mjs",import.meta.url),"utf8");
const page=readFileSync(new URL("../system-users.html",import.meta.url),"utf8");
const peopleBackend=readFileSync(new URL("../functions/people-directory.js",import.meta.url),"utf8");
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


test("explicit test students use platform designation plus school-scoped Assist for access",()=>{
  for(const action of ["mark_test_student","retire_test_student","list_test_school_targets"])
    assert.match(backend,new RegExp(action));
  assert.match(backend,/platform_test_accounts\/"\+uid/);
  assert.doesNotMatch(backend,/grant_test_student_school_access/);
  assert.doesNotMatch(backend,/schools\/"\+targetSchoolId\+"\/memberships/);

  assert.match(peopleBackend,/if\(input\.action==="activate_test_student_access"\)/);
  assert.match(peopleBackend,/Test-student cross-school access requires explicit System Admin Assist/);
  assert.match(peopleBackend,/platform_test_accounts\/"\+targetUid/);
  assert.match(peopleBackend,/roles:\["student"\]/);
  assert.match(peopleBackend,/testStudentAccess:true/);
  assert.match(peopleBackend,/source:"platform_test_student"/);
  assert.match(peopleBackend,/system_admin_assist_test_mobility/);
  assert.match(peopleBackend,/directory_audit/);
  assert.doesNotMatch(peopleBackend,/student_grades.*activate_test_student_access/);
  assert.doesNotMatch(peopleBackend,/assessment_submissions.*activate_test_student_access/);
  assert.doesNotMatch(peopleBackend,/studio_submissions.*activate_test_student_access/);
});

test("System Admin test mobility UI routes placement into the canonical school workflow",()=>{
  for(const id of ["pu-test-toggle","pu-test-school","pu-test-grant","pu-test-status"])
    assert.match(page,new RegExp('id="'+id+'"'));
  assert.match(page,/This does not move or delete the source school/);
  assert.match(page,/ordinary school access remains school-admin owned/);
  assert.match(client,/schoolAccessApi/);
  assert.match(client,/action:"activate_test_student_access"/);
  assert.match(client,/action:"suspend_access"/);
  assert.match(client,/expectedRevision:membership\.revision/);
  assert.match(client,/platformMode:"assist"/);
  assert.match(client,/Suspend test access/);
  assert.match(client,/enrollmentMode==="canonical"\?"school-enrollment\.html":"people-access\.html"/);
  assert.match(client,/Adminerva_platform_school_mode","assist"/);
  assert.match(client,/Manage placement/);
});

test("test-student actions validate audit reason in their own section",()=>{
  assert.match(page,/id="pu-test-reason"/);
  assert.match(page,/Reason for test-student designation or school access/);
  assert.match(page,/at least 12 characters/);
  assert.match(client,/function testStudentReason\(\)/);
  assert.match(client,/el\("pu-test-status"\)\.textContent="Enter a reason of at least 12 characters in Test student mobility/);
  assert.match(client,/const reason=testStudentReason\(\);if\(!reason\)return;\s*if\(!confirm\("Suspend this test student/);
  assert.match(client,/const reason=testStudentReason\(\);if\(!reason\)return;\s*const action=currentTestAccount\.active/);
  assert.match(client,/const target=selectedTestSchool\(\);[\s\S]{0,230}const reason=testStudentReason\(\);if\(!reason\)return;/);
  assert.match(client,/el\("pu-test-reason"\)\.value="";/);
  assert.match(backend,/const uid=checkedUid\(input\.uid\),auditReason=reason\(input\.reason\)/);
  assert.match(backend,/tx\.create\(db\.collection\("platform_audit"\)\.doc\(\),\{/);
});

test("compatibility People and Access mutations preserve explicit System Admin Assist authority",()=>{
  assert.match(peopleClient,/function assistMode\(\)/);
  assert.match(peopleClient,/Adminerva_platform_school_mode/);
  assert.ok((peopleClient.match(/platformMode:"assist"/g)||[]).length>=3);
  assert.match(peoplePage,/people-access\.mjs\?v=[A-Za-z0-9._-]+/);
  assert.doesNotMatch(peoplePage,/people-access\.mjs\?v=e44dd05d2bec/);
});

test("prior consent import is previewed, attested, bounded and preserves saved preferences",async()=>{
 const {importExistingActivityConsent}=require("../functions/existing-activity-consent.js");
 const docs=new Map([
  ["platform_schools/mcs-manila",{compatibilityMode:"legacy_allowed"}],
  ["students/student_a",{email:"a@example.test",status:"active"}],
  ["students/student_b",{email:"b@example.test",status:"active"}],
  ["activity_preferences/user_b",{ownerUid:"user_b",studentId:"student_b",enabled:false}],
  ["students/student_c",{email:"c@example.test",status:"active"}],
  ["activity_preferences/user_c",{ownerUid:"user_c",studentId:"student_c",enabled:true}]
 ]);
 let audit=0;
 const snapshot=path=>({id:path.split("/").at(-1),exists:docs.has(path),data:()=>docs.get(path)});
 const ref=path=>({path,get:async()=>snapshot(path)});
 const db={doc:ref,collection:path=>({
  doc:()=>ref(path+"/audit_"+(++audit)),
  where:(key,op,value)=>({limit:()=>({get:async()=>({docs:[...docs.keys()].filter(p=>p.startsWith(path+"/")&&docs.get(p)?.[key]===value).map(snapshot)})})})
 }),runTransaction:async callback=>callback({get:async r=>snapshot(r.path),create:(r,value)=>{assert.equal(docs.has(r.path),false);docs.set(r.path,value);}})};
 const auth={getUser:async uid=>({uid,email:uid.slice(-1)+"@example.test",emailVerified:uid!=="user_d",disabled:false})};
 const run=(action,extra={},authority={uid:"admin",platformAdmin:true})=>importExistingActivityConsent({db,auth,FieldValue:{serverTimestamp:()=>123},authority,input:{action,uids:["user_a","user_b","user_c","user_d","user_e"],...extra}});
 const preview=await run("preview_activity_consent");
 assert.deepEqual(preview.rows.map(x=>x.status),["eligible","existing_choice_preserved","already_enabled","account_ineligible","no_active_legacy_student"]);
 assert.equal(docs.has("activity_preferences/user_a"),false);
 await assert.rejects(run("initialize_activity_consent"),/Confirm previously obtained consent/);
 await assert.rejects(run("initialize_activity_consent",{consentConfirmed:true},{uid:"teacher",platformAdmin:false}),/System Administrator/);
 const result=await run("initialize_activity_consent",{consentConfirmed:true});
 assert.equal(result.rows[0].status,"initialized");
 assert.deepEqual(docs.get("activity_preferences/user_a"),{ownerUid:"user_a",studentId:"student_a",enabled:true,promptDismissed:true,updatedAt:123});
 assert.equal(docs.get("activity_preferences/user_b").enabled,false);
 assert.equal([...docs.values()].filter(v=>v.action==="existing_student_activity_consent_initialized").length,1);
 docs.get("activity_preferences/user_a").enabled=false;
 assert.equal((await run("initialize_activity_consent",{consentConfirmed:true})).rows[0].status,"existing_choice_preserved");
 assert.equal(docs.get("activity_preferences/user_a").enabled,false);
 docs.set("platform_schools/mcs-manila",{compatibilityMode:"v4_only"});
 assert.equal((await run("preview_activity_consent",{uids:["user_a"]})).rows[0].status,"v4_only_legacy_unavailable");
 assert.match(page,/id="pu-consent-preview"/);
 assert.match(page,/id="pu-consent-confirm"/);
 assert.match(client,/consentConfirmed:true/);
});
