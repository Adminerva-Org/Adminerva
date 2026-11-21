import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFile} from "node:fs/promises";
const require=createRequire(import.meta.url);
const {studentAccountUids,studentRecordUidAllowed}=require("../functions/student-account-history.js");
const {legacyStudentRecordsForAccount}=require("../functions/legacy-student-identity.js");

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


test("canonical Enrollment exposes audited cleanup for pre-canonical orphan enrollments",async()=>{
  const [service,html,ui]=await Promise.all([
    readFile(new URL("../functions/school-enrollment.js",import.meta.url),"utf8"),
    readFile(new URL("../school-enrollment.html",import.meta.url),"utf8"),
    readFile(new URL("../js/school-admin/enrollment.mjs",import.meta.url),"utf8")
  ]);
  assert.match(service,/end_orphan_enrollments/);
  assert.match(service,/pre_canonical_student_enrollments_ended/);
  assert.match(service,/This student now has an active official registration/);
  assert.match(service,/registrationId/);
  assert.match(html,/Pre-canonical enrollment reconciliation/);
  assert.match(html,/en-legacy-reconciliation-dialog/);
  assert.match(ui,/renderLegacyRegistrations/);
  assert.match(ui,/end_orphan_enrollments/);
});


test("blocked recovery deep-links the exact replacement person into enrollment reconciliation",async()=>{
  const [service,peopleUi,enrollmentUi,peopleHtml]=await Promise.all([
    readFile(new URL("../functions/school-enrollment.js",import.meta.url),"utf8"),
    readFile(new URL("../js/school-admin/people-access.mjs",import.meta.url),"utf8"),
    readFile(new URL("../js/school-admin/enrollment.mjs",import.meta.url),"utf8"),
    readFile(new URL("../people-access.html",import.meta.url),"utf8")
  ]);
  assert.match(service,/activeLegacyEnrollments/);
  assert.match(service,/collection\(root\+"enrollments"\)\.where\("personId","==",personId\)/);
  assert.match(peopleHtml,/pa-account-recovery-reconcile/);
  assert.match(peopleUi,/school-enrollment\.html\?personId=/);
  assert.match(enrollmentUi,/result\.activeLegacyEnrollments/);
  assert.match(enrollmentUi,/en-legacy-reconciliation-card/);
});


test("People & Access can safely end a compatibility placement before reassignment",async()=>{
  const [html,ui,academics]=await Promise.all([
    readFile(new URL("../people-access.html",import.meta.url),"utf8"),
    readFile(new URL("../js/school-admin/people-access.mjs",import.meta.url),"utf8"),
    readFile(new URL("../functions/school-academics.js",import.meta.url),"utf8")
  ]);
  assert.match(html,/pa-detail-current-placement/);
  assert.match(html,/End current placement/);
  assert.doesNotMatch(ui,/schoolEnrollment/);
  assert.match(ui,/review_student_section_placement/);
  assert.match(ui,/end_student_section_placement/);
  assert.match(ui,/activeLegacyEnrollments/);
  assert.match(ui,/people-access\.html\?personId=/);
  assert.match(ui,/Current placement could not be verified\. Placement changes are disabled/);
  assert.match(ui,/End the current placement before assigning the student to another section/);
  assert.match(academics,/input\.action==="review_student_section_placement"/);
  assert.match(academics,/input\.action==="end_student_section_placement"/);
  assert.match(academics,/student_section_placement_ended/);
  assert.match(academics,/registrationId/);
});


test("recovered verified students can enter Classroom and subject routes without a legacy student lookup",async()=>{
  const [guard,profile]=await Promise.all([
    readFile(new URL("../js/core/auth-guard-v4-pilot.js",import.meta.url),"utf8"),
    readFile(new URL("../functions/school-student-profile.js",import.meta.url),"utf8")
  ]);
  assert.match(guard,/const v4OnlyStudent=access\.schoolStudent&&/);
  assert.match(guard,/"student-classroom\.html"/);
  assert.match(guard,/"student-subject\.html"/);
  assert.match(guard,/"student-assessments\.html"/);
  assert.match(profile,/member\.data\(\)\.personId/);
  assert.match(profile,/person\.data\(\)\.authUid!==ctx\.uid/);
  assert.match(profile,/collection\(prefix\+"enrollments"\)[\s\S]*?\.where\("personId","==",personId\)/);
});


test("recovered students retain legacy assessment and personalized-task identity",async()=>{
  const [helper,index,access,assignments,variants]=await Promise.all([
    readFile(new URL("../functions/legacy-student-identity.js",import.meta.url),"utf8"),
    readFile(new URL("../functions/index.js",import.meta.url),"utf8"),
    readFile(new URL("../js/student/student-access.mjs",import.meta.url),"utf8"),
    readFile(new URL("../js/student/assessments.js",import.meta.url),"utf8"),
    readFile(new URL("../functions/studio-assessment-variants.js",import.meta.url),"utf8")
  ]);
  assert.match(helper,/legacyStudentIds/);
  assert.match(helper,/source:"canonical_person"/);
  assert.match(helper,/source:"email_fallback"/);
  assert.match(index,/legacyStudentRecordsForAccount/);
  assert.match(index,/profiles,identitySource/);
  assert.match(access,/readyProjection/);
  assert.match(assignments,/projection\?\.profiles/);
  assert.match(assignments,/compatibility assessments, submissions and personalized variants/);
  assert.match(variants,/legacyStudentRecordsForAccount/);
  assert.doesNotMatch(variants,/db\.collection\("students"\)\.where\("email","==",email\)/);
});


test("student assessment recovery bundle is cache-versioned end to end",async()=>{
  const [html,assignments,workflow]=await Promise.all([
    readFile(new URL("../student-assessments.html",import.meta.url),"utf8"),
    readFile(new URL("../js/student/assessments.js",import.meta.url),"utf8"),
    readFile(new URL("../.github/workflows/shared-ui-cache-bump.yml",import.meta.url),"utf8")
  ]);
  const pageVersion=html.match(/js\/student\/assessments\.js\?v=([^"']+)/)?.[1];
  const accessVersion=assignments.match(/student-access\.mjs\?v=([^"']+)/)?.[1];
  assert.ok(pageVersion&&pageVersion!=="20261121-studio-route-hotfix");
  assert.ok(accessVersion&&accessVersion!=="1.3.6");
  assert.match(workflow,/"js\/student\/assessments\.js"/);
  assert.match(workflow,/"js\/student\/student-access\.mjs"/);
  assert.match(workflow,/js\/student\/assessments\\\.js\\\?v=/);
  assert.match(workflow,/student-access\\\.mjs\\\?v=/);
});


function legacyIdentityDb(records){
  const snapshot=(path,data)=>({
    id:path.split("/").at(-1),exists:data!==undefined,data:()=>data
  });
  return {
    doc(path){return {path,get:async()=>snapshot(path,records[path])};},
    async getAll(...refs){return refs.map(ref=>snapshot(ref.path,records[ref.path]));},
    collection(name){
      return {
        where(field,op,value){
          assert.equal(name,"students");assert.equal(field,"email");assert.equal(op,"==");
          return {
            limit(max){
              return {get:async()=>({
                docs:Object.entries(records)
                  .filter(([path,data])=>path.startsWith("students/")&&data?.email===value)
                  .slice(0,max).map(([path,data])=>snapshot(path,data))
              })};
            }
          };
        }
      };
    }
  };
}

test("recovered canonical migration resolves legacy student through previous Auth UID",async()=>{
  const db=legacyIdentityDb({
    "schools/mcs-manila/memberships/new-uid":{
      schoolId:"mcs-manila",status:"active",roles:["student"],personId:"person-davis"
    },
    "schools/mcs-manila/people/person-davis":{
      schoolId:"mcs-manila",kind:"student",status:"active",authUid:"new-uid",
      previousAuthUids:["old-uid"]
    },
    "students/legacy-davis":{
      email:"old-davis@example.edu",status:"active",section:"St. Carlo Acutis",name:"Davis Izon"
    }
  });
  const result=await legacyStudentRecordsForAccount({
    db,uid:"new-uid",email:"replacement@example.edu",
    resolveUser:async uid=>{
      assert.equal(uid,"old-uid");
      return {uid,email:"old-davis@example.edu",disabled:false};
    }
  });
  assert.equal(result.source,"canonical_account_history");
  assert.deepEqual(result.records.map(row=>row.id),["legacy-davis"]);
});

test("recovered identity fails closed instead of binding current replacement email",async()=>{
  const db=legacyIdentityDb({
    "schools/mcs-manila/memberships/new-uid":{
      schoolId:"mcs-manila",status:"active",roles:["student"],personId:"person-davis"
    },
    "schools/mcs-manila/people/person-davis":{
      schoolId:"mcs-manila",kind:"student",status:"active",authUid:"new-uid",
      previousAuthUids:["old-uid"]
    },
    "students/replacement-row":{
      email:"replacement@example.edu",status:"active",section:"Wrong Section",name:"Duplicate"
    }
  });
  const result=await legacyStudentRecordsForAccount({
    db,uid:"new-uid",email:"replacement@example.edu",
    resolveUser:async()=>({uid:"old-uid",email:"old-davis@example.edu"})
  });
  assert.equal(result.source,"canonical_history_unmapped");
  assert.deepEqual(result.records,[]);
});
