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
