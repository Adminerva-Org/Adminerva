import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";

const require=createRequire(import.meta.url);
const {schoolEnrollmentMode}=require("../functions/tenant-access.js");

test("canonical enrollment is enabled by verified school capability, not by school ID",()=>{
  assert.equal(schoolEnrollmentMode({compatibilityMode:"v4_only",provisioningMode:"standard"}),"canonical");
  assert.equal(schoolEnrollmentMode({compatibilityMode:"v4_only"}),"canonical");
  assert.equal(schoolEnrollmentMode({compatibilityMode:"legacy_allowed",provisioningMode:"standard"}),"compatibility");
  assert.equal(schoolEnrollmentMode({compatibilityMode:"v4_only",provisioningMode:"legacy"}),"compatibility");
});


const {canReviewApplication,isReviewedApplicationRevision,normalizeAdmissionRequirements,admissionRequirementsReady,normalizeRequirementTemplate,templateCovered,pendingRequirementsReady}=require("../functions/school-enrollment.js");
test("admissions transitions permit reviewed acceptance and correction, not terminal reversal",()=>{
  assert.equal(canReviewApplication("submitted","accepted"),true);
  assert.equal(canReviewApplication("needs_information","submitted"),true);
  assert.equal(canReviewApplication("needs_information","accepted"),true);
  assert.equal(canReviewApplication("accepted","needs_information"),true);
  for(const status of ["enrolled","rejected","withdrawn","constructor","unknown"])assert.equal(canReviewApplication(status,"accepted"),false);
});
test("only the current accepted revision can be enrolled",()=>{
  const reviewed={requirementsReviewed:true,noRequirements:false,requirements:[{label:"School record",status:"verified"}]};
  assert.equal(isReviewedApplicationRevision({status:"accepted",revision:4,...reviewed},4),true);
  assert.equal(isReviewedApplicationRevision({status:"accepted",revision:5,...reviewed},4),false);
  assert.equal(isReviewedApplicationRevision({status:"accepted",revision:4},4),false);
  for(const status of ["submitted","needs_information","enrolled","rejected"])assert.equal(isReviewedApplicationRevision({status,revision:4},4),false);
  assert.equal(isReviewedApplicationRevision({status:"accepted",revision:4},NaN),false);
});


test("admission requirements must be explicitly reviewed and verified",()=>{
  const pending={requirementsReviewed:true,noRequirements:false,requirements:[{label:"School record",status:"received"}]};
  assert.equal(admissionRequirementsReady(pending),false);
  assert.equal(admissionRequirementsReady({...pending,requirements:[{label:"School record",status:"verified"}]}),true);
  assert.equal(admissionRequirementsReady({requirementsReviewed:false,noRequirements:true,requirements:[]}),false);
  assert.equal(admissionRequirementsReady({requirementsReviewed:true,noRequirements:false,requirements:[]}),false);
  assert.equal(admissionRequirementsReady({requirementsReviewed:true,noRequirements:true,requirements:[]}),true);
  assert.throws(()=>normalizeAdmissionRequirements([],false));
  assert.throws(()=>normalizeAdmissionRequirements([{label:"A",status:"waived"}],false));
  assert.throws(()=>normalizeAdmissionRequirements([{label:"A",status:"verified"},{label:" a ",status:"missing"}],false));
  assert.deepEqual(normalizeAdmissionRequirements([{label:"  School record ",status:"missing"}],false),[{label:"School record",status:"missing"}]);
});


test("school templates cannot be bypassed with an empty or incomplete checklist",()=>{
  const template={revision:2,labels:["Birth certificate","Prior school record"]};
  const reviewed={requirementsReviewed:true,noRequirements:false,requirementsTemplateRevision:2,requirements:[{label:"Birth certificate",status:"verified"},{label:"Prior school record",status:"verified"}]};
  assert.equal(pendingRequirementsReady(reviewed,template),true);
  assert.equal(pendingRequirementsReady({...reviewed,requirementsTemplateRevision:1},template),false);
  assert.equal(pendingRequirementsReady({...reviewed,requirements:reviewed.requirements.slice(0,1)},template),false);
  assert.equal(pendingRequirementsReady({...reviewed,noRequirements:true,requirements:[]},template),false);
  assert.equal(templateCovered([{label:" birth certificate "}],["Birth certificate"]),true);
  assert.throws(()=>normalizeRequirementTemplate(["A"," a "]));
  assert.deepEqual(normalizeRequirementTemplate(["  School record "]),["School record"]);
});


test("admissions document custody validates file size, encoding, type and scoped paths",()=>{
  const {fileBytes,documentPath}=require("../functions/school-admission-documents.js");
  const pdf=Buffer.from("%PDF-1.7 sample");
  assert.deepEqual(fileBytes(pdf.toString("base64"),"application/pdf"),pdf);
  assert.throws(()=>fileBytes(pdf.toString("base64"),"image/png"));
  assert.throws(()=>fileBytes("abcd==","application/pdf"));
  assert.throws(()=>fileBytes(Buffer.alloc(2*1024*1024+1).toString("base64"),"application/pdf"));
  assert.throws(()=>documentPath("school","../other","doc"));
  assert.equal(documentPath("school-a","app-1","doc-1"),"registrar/school-a/applications/app-1/doc-1");
  assert.equal(admissionRequirementsReady({requirementsReviewed:true,noRequirements:true,requirements:[],admissionDocuments:[{state:"pending"}]}),false);
});


test("onsite and online intake share a deterministic school-scoped application key",()=>{
  const {admissionApplicationId,acceptedIdentityMatches}=require("../functions/school-enrollment.js");
  const details={schoolId:"school-a",yearId:"year-1",displayName:"Student A",birthDate:"2012-01-01",guardianEmail:"parent@example.test"};
  assert.equal(admissionApplicationId(details),admissionApplicationId({...details,displayName:"student a"}));
  assert.notEqual(admissionApplicationId(details),admissionApplicationId({...details,schoolId:"school-b"}));
  assert.equal(acceptedIdentityMatches({...details,personId:"student-1"}, {...details,personId:"student-1"}),true);
  assert.equal(acceptedIdentityMatches({...details,personId:"student-1"}, {...details,personId:"student-2"}),false);
  assert.equal(acceptedIdentityMatches(details,{...details,birthDate:"2013-01-01"}),false);
});


test("admissions search uses bounded school-local cursor pages and corrections preserve identity keys",()=>{
  const source=require("node:fs").readFileSync(new URL("../functions/school-enrollment.js",import.meta.url),"utf8");
  assert.match(source,/collection\(root\+"enrollment_applications"\)\.orderBy\(FieldPath\.documentId\(\)\)\.limit\(pageSize\+1\)/);
  assert.match(source,/if\(cursor\)scan=scan.startAfter\(cursor\)/);
  const correction=source.slice(source.indexOf('if(input.action==="correct_application")'),source.indexOf('if(input.action==="list_applications")'));
  assert.match(correction,/staffCorrected:true/);assert.match(correction,/requirementsReviewed:false/);
  assert.doesNotMatch(correction,/changes=\{[^}]*birthDate/);
});
