import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";

const require=createRequire(import.meta.url);
const {
  normalizeGuardianEmail,guardianContactIdForEmail,guardianRelationshipId
}=require("../functions/school-guardian-identity.js");
const {
  REQUEST_TRANSITIONS,requestTypeLabel
}=require("../functions/school-student-records.js");

const service=readFileSync(new URL("../functions/school-student-records.js",import.meta.url),"utf8");
const enrollment=readFileSync(new URL("../functions/school-enrollment.js",import.meta.url),"utf8");
const peopleUi=readFileSync(new URL("../js/school-admin/people-access.mjs",import.meta.url),"utf8");
const recordsUi=readFileSync(new URL("../js/school-admin/student-records.mjs",import.meta.url),"utf8");
const recordsHtml=readFileSync(new URL("../school-student-records.html",import.meta.url),"utf8");

test("guardian identity is normalized and shared across sibling relationships",()=>{
  assert.equal(normalizeGuardianEmail(" Parent@Example.COM "),"parent@example.com");
  assert.equal(guardianContactIdForEmail("Parent@example.com"),guardianContactIdForEmail("parent@EXAMPLE.com"));
  assert.notEqual(guardianContactIdForEmail("one@example.com"),guardianContactIdForEmail("two@example.com"));
  const contact=guardianContactIdForEmail("parent@example.com");
  assert.equal(guardianRelationshipId("student-a",contact),guardianRelationshipId("student-a",contact));
  assert.notEqual(guardianRelationshipId("student-a",contact),guardianRelationshipId("student-b",contact));
});

test("document request lifecycle is explicit and terminal release is preserved",()=>{
  assert.deepEqual([...REQUEST_TRANSITIONS.requested].sort(),["cancelled","in_review"]);
  assert.deepEqual([...REQUEST_TRANSITIONS.in_review].sort(),["cancelled","ready"]);
  assert.deepEqual([...REQUEST_TRANSITIONS.ready].sort(),["cancelled","in_review","released"]);
  assert.deepEqual([...REQUEST_TRANSITIONS.released],[]);
  assert.deepEqual([...REQUEST_TRANSITIONS.cancelled],["in_review"]);
  assert.equal(requestTypeLabel("transcript_of_records"),"Transcript of Records");
});

test("Student Records 201 file aggregates canonical records instead of creating a duplicate student master",()=>{
  const start=service.indexOf('if(input.action==="student_file")');
  const end=service.indexOf('if(input.action==="adopt_primary_guardian")');
  const block=service.slice(start,end);
  assert.match(block,/student_registrations/);
  assert.match(block,/guardian_relationships/);
  assert.match(block,/class_record_period_grades/);
  assert.match(block,/student_document_requests/);
  assert.match(block,/class_record_finalizations/);
  assert.doesNotMatch(block,/tx\.create\([^\n]*people/);
});

test("released academic results resolve the exact released Class Record revision",()=>{
  assert.match(service,/releasedRevision=released\.get\(doc\.data\(\)\.offeringId\)\|\|0/);
  assert.match(service,/doc\.ref\.collection\("revisions"\)\.doc\(String\(releasedRevision\)\)/);
  assert.match(service,/Number\(historical\.data\(\)\.finalizationRevision\)!==releasedRevision/);
  assert.match(service,/status==="finalized"/);
});

test("guardian lifecycle is revision-safe and never hard deletes relationships",()=>{
  assert.match(service,/expectedRelationshipRevision/);
  assert.match(service,/expectedContactRevision/);
  assert.match(service,/This guardian relationship changed after you opened it/);
  assert.match(service,/end_guardian/);
  assert.match(service,/restore_guardian/);
  assert.doesNotMatch(service,/\.delete\(/);
});

test("new links reuse an existing canonical guardian contact instead of overwriting it",()=>{
  assert.match(service,/contactReused:contact\.exists&&!relationshipIdInput/);
  assert.match(service,/if\(relationshipIdInput\)[\s\S]*tx\.update\(contactRef/);
});

test("standard enrollment seeds canonical guardian relationships while preserving compatibility snapshots",()=>{
  assert.match(enrollment,/guardian_contacts/);
  assert.match(enrollment,/guardian_relationships/);
  assert.match(enrollment,/guardian_relationship_created_from_enrollment/);
  assert.match(enrollment,/primaryGuardianName:guardianName/);
  assert.match(enrollment,/primaryGuardianEmail:guardianEmail/);
});

test("People & Access no longer submits guardian contact fields as ordinary profile edits",()=>{
  const submit=peopleUi.slice(peopleUi.indexOf('get("pa-person-dialog-form").addEventListener("submit"'),
    peopleUi.indexOf('for(const id of ["pa-person-dialog"'));
  assert.match(submit,/details\.studentNumber/);
  assert.doesNotMatch(submit,/primaryGuardianName|primaryGuardianEmail|primaryGuardianMobile/);
  assert.match(peopleUi,/Guardian relationships belong to Student Records/);
});

test("Student Records UI deep-links to owning identity and enrollment workspaces",()=>{
  assert.match(recordsUi,/people-access\.html\?personId=/);
  assert.match(recordsUi,/school-enrollment\.html\?personId=/);
  assert.doesNotMatch(recordsHtml,/One record, not another student table/);
  assert.match(recordsHtml,/id="sr-open-people" hidden/);
  assert.match(recordsUi,/get\("sr-open-people"\)\.hidden=!picker\.scope\.current\.roles\.includes\("school_admin"\)/);
  assert.match(recordsUi,/schoolQuery="&schoolId="/);
  assert.match(recordsUi,/requestedSchoolId!==currentScope\.schoolId/);
  assert.match(recordsHtml,/js\/core\/adminerva-loader\.js/);
});


test("primary guardian selection is resolved inside the same transaction",()=>{
  assert.match(service,/tx\.get\(db\.collection\(root\+"guardian_relationships"\)\.where\("studentPersonId","==",personId\)\.limit\(51\)\)/);
  assert.match(enrollment,/const guardianRelationships=await tx\.get\(db\.collection\(root\+"guardian_relationships"\)/);
});


test("Student directory uses bounded school-local cursor pages without a whole-school ceiling",()=>{
  const block=service.slice(service.indexOf('if(input.action==="search_students")'),service.indexOf('if(input.action==="student_file")'));
  assert.match(block,/db\.collection\(root\+"people"\)/);
  assert.match(block,/orderBy\(FieldPath\.documentId\(\)\)/);
  assert.match(block,/startAfter\(cursor\)/);
  assert.match(block,/row\.schoolId!==ctx\.schoolId/);
  assert.match(block,/nextCursor,truncated:Boolean\(nextCursor\)/);
  assert.doesNotMatch(block,/limit\(251\)/);
  assert.match(recordsUi,/directoryCursor=result\.nextCursor\|\|null/);
  assert.match(recordsUi,/Search more records/);
  assert.match(recordsHtml,/id="sr-more"/);
});
