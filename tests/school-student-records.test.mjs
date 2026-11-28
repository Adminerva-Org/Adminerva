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


test("student-file history is independently paged and retains exact released grade resolution",()=>{
  const block=service.slice(service.indexOf('if(input.action==="student_file")'),service.indexOf('if(input.action==="adopt_primary_guardian")'));
  assert.match(block,/async function historyPage/);assert.match(block,/where\(field,"==",personId\)\.orderBy\(FieldPath\.documentId\(\)\)/);
  assert.match(block,/nextCursors\[name\]/);assert.match(block,/nextCursors,historySection:section/);
  assert.doesNotMatch(block,/Student 201-file history requires pagination/);
  assert.match(recordsUi,/run!==fileRun\|\|current\?\.person.personId!==personId/);
  assert.match(recordsUi,/current\[section\]=sortHistory/);
  assert.match(recordsHtml,/data-sr-view="releasedGrades"/);
});


test("school-wide document queue uses school-scoped cursors and reuses canonical request lifecycle",()=>{
  const block=service.slice(service.indexOf('if(input.action==="list_document_requests")'),service.indexOf('if(input.action==="search_students")'));
  assert.match(block,/student_document_requests/);assert.match(block,/where\("schoolId","==",ctx.schoolId\)/);
  assert.match(block,/nextCursor/);assert.match(block,/doc.data\(\).schoolId===ctx.schoolId/);
  assert.match(recordsUi,/openRequestLifecycle\(row,next,true\)/);assert.match(recordsHtml,/id="sr-requests-workspace"/);
});


test("LRN is an existing twelve digit string, never an invented student identifier",()=>{
  const {normalizeLrn,normalizeRegistrarProfile}=require("../functions/school-student-records.js");
  assert.equal(normalizeLrn("001234567890"),"001234567890");assert.equal(normalizeLrn(""),null);
  assert.throws(()=>normalizeLrn(123456789012));assert.throws(()=>normalizeLrn("12345678901"));
  assert.throws(()=>normalizeRegistrarProfile({lrn:"123456789012",lrnState:"unrecorded"}));
  assert.equal(normalizeRegistrarProfile({lrn:"123456789012",lrnState:"verified"}).lrnState,"verified");
  assert.match(service,/student_lrn_claims/);assert.match(service,/status:"superseded"/);
  assert.match(service,/This LRN is already associated/);assert.match(service,/requireRegistrarMembership/);
  assert.doesNotMatch(service.slice(service.indexOf('if(input.action==="search_students")'),service.indexOf('if(input.action==="student_file")')),/row\.lrn/);
});


test("academic preparation resolves released evidence and labels the result non-official",()=>{
  const {releasedGrade,certificateTemplate}=require("../functions/school-record-credentials.js");
  const grade={schoolId:"school",personId:"student",offeringId:"class",status:"finalized",finalizationRevision:2,finalGrade:91};
  assert.equal(releasedGrade(grade,"school","student","class",2),true);
  assert.equal(releasedGrade(grade,"other","student","class",2),false);
  assert.equal(releasedGrade(grade,"school","student","class",3),false);
  assert.equal(releasedGrade({...grade,finalGrade:null},"school","student","class",2),false);
  assert.throws(()=>certificateTemplate({signatoryName:"Registrar"}));
  const credential=readFileSync(new URL("../functions/school-record-credentials.js",import.meta.url),"utf8");
  assert.match(credential,/officialForm:false/);assert.match(credential,/certificateDraftDigest/);
  assert.match(credential,/Source registration, student or template changed/);assert.match(credential,/credentialState:"revoked"/);
  assert.match(credential,/signatureVerified:false/);assert.match(service,/Use the certificate issuance action/);
  assert.match(recordsUi,/UNSIGNED COPY/);
});


test("certificate digest survives Firestore map key ordering and rejects changed content",()=>{
  const {certificateDigest}=require("../functions/school-record-credentials.js");
  const first={studentName:"Student",templateRevision:1,placement:{year:"2026",period:"Q1"}};
  assert.equal(certificateDigest(first),certificateDigest({placement:{period:"Q1",year:"2026"},templateRevision:1,studentName:"Student"}));
  assert.notEqual(certificateDigest(first),certificateDigest({...first,templateRevision:2}));
  assert.match(service,/find_student_by_lrn/);assert.match(service,/claim.data\(\).status!=="active"/);
  assert.match(recordsHtml,/id="sr-lrn-dialog"/);
});


test("previous-school academic evidence is school-local, revisioned and separate from Class Record",()=>{
  const {externalRecordDetails,externalKey}=require("../functions/school-external-academic-records.js");
  const input={sourceSchool:"Prior school",schoolYear:"2025–2026",gradeLevel:"10",period:"Year",sourceReference:"File 1",results:[{subject:"Mathematics",result:"Passed"}]};
  assert.equal(externalRecordDetails(input).results[0].result,"Passed");assert.throws(()=>externalRecordDetails({...input,results:[{subject:"Math",result:"90"},{subject:"math",result:"91"}]}));
  assert.equal(externalKey("student",input),externalKey("student",{...input,sourceSchool:"prior school"}));assert.notEqual(externalKey("student",input),externalKey("other",input));
  const external=readFileSync(new URL("../functions/school-external-academic-records.js",import.meta.url),"utf8");
  assert.match(external,/ref.collection\("revisions"\)/);assert.match(external,/confirmSourceReviewed/);assert.doesNotMatch(external,/class_record_period_grades|student_registrations|enrollments\//);
  const credential=readFileSync(new URL("../functions/school-record-credentials.js",import.meta.url),"utf8");
  assert.match(credential,/mode==="sf10"&&!yearId/);assert.match(credential,/doc.data\(\).state==="verified"/);
});


test("institutional credential eligibility requires exact canonical outcomes and explicit moral attestation",()=>{
  const {eligibleRegistration,CREDENTIAL_TYPES}=require("../functions/school-record-credentials.js");
  assert.equal(eligibleRegistration("graduation_certificate",{status:"ended",endReasonType:"progression",progressionType:"graduation"}),true);
  assert.equal(eligibleRegistration("graduation_certificate",{status:"ended",endReasonType:"progression",progressionType:"promotion"}),false);
  assert.equal(eligibleRegistration("transfer_certificate",{status:"ended",endReasonType:"withdrawal"}),false);
  assert.equal(eligibleRegistration("transfer_certificate",{status:"ended",endReasonType:"transfer_out"}),true);
  assert.equal(eligibleRegistration("transfer_certificate",{status:"ended",endReasonType:"transfer_out",progressionType:"promotion"}),true);
  assert.equal(eligibleRegistration("certificate_of_enrollment",{status:"ended"}),false);
  assert.equal(CREDENTIAL_TYPES.good_moral_certificate.prefix,"GMC");
  const source=readFileSync(new URL("../functions/school-record-credentials.js",import.meta.url),"utf8");
  assert.match(source,/confirmSourceReviewed!==true/);assert.match(source,/attestation.registrationRevision/);assert.match(source,/A verified School Administrator must record/);
});


test("withdrawn office approval invalidates the unissued Good Moral draft",()=>{
  const source=readFileSync(new URL("../functions/school-record-credentials.js",import.meta.url),"utf8");
  const block=source.slice(source.indexOf('if(input.action==="withdraw_good_moral_attestation")'),source.indexOf('if(input.action==="record_good_moral_attestation")'));
  assert.match(block,/certificateDraft:FieldValue.delete\(\)/);assert.match(block,/status:"withdrawn"/);assert.match(block,/school_admin/);assert.match(block,/revision:expected\+1/);
});


test("record review detects duplicate identifiers and placements without treating optional profile fields as enrollment gates",()=>{
  const {studentReadinessIssues}=require("../functions/school-student-records.js");
  const scope={schoolId:"school",personId:"student",person:{displayName:"Student",birthDate:"2012-01-01",studentNumber:"A",status:"active",accountResponsibility:"guardian"},profile:{lrn:"001234567890",lrnState:"verified",sex:"female",addressLine:"Address",cityMunicipality:"City"},claim:{schoolId:"school",personId:"student",status:"active"},numberMatches:1,registrations:[{status:"active",yearId:"year",termId:"term"}],guardians:[{status:"active",isPrimary:true}]};
  assert.equal(studentReadinessIssues(scope).length,0);
  const issues=studentReadinessIssues({...scope,numberMatches:2,claim:{schoolId:"school",personId:"other",status:"active"},registrations:[...scope.registrations,...scope.registrations]});
  assert.deepEqual(issues.filter(row=>row.level==="conflict").map(row=>row.code).sort(),["duplicate_active_placement","duplicate_student_number","lrn_claim_conflict"]);
  assert.match(service,/student_record_readiness/);assert.match(service,/requestedRegistrationId:registrationId/);
  assert.match(recordsUi,/Request transfer certificate/);
});


test("student file only shows exact canonical finite released grades, not missing values as zero",()=>{
  assert.match(service,/doc.id===key\(doc.data\(\).offeringId,personId\)/);
  assert.match(service,/typeof doc.data\(\).finalGrade==="number"&&Number.isFinite/);
  assert.match(recordsHtml,/id="sr-request-status"/);
});
