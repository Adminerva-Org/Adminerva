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


const {canReviewApplication,isReviewedApplicationRevision,normalizeAdmissionRequirements,admissionRequirementsReady}=require("../functions/school-enrollment.js");
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
