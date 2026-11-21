import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";

const require=createRequire(import.meta.url);
const {registrationOwnsEnrollment}=require("../functions/school-enrollment.js");

test("registration-owned enrollment follows its explicit registration ID",()=>{
  assert.equal(registrationOwnsEnrollment("reg-a",{registrationId:"reg-a"},{rosterMode:"selective"}),true);
  assert.equal(registrationOwnsEnrollment("reg-a",{registrationId:"reg-b"},{rosterMode:"section"}),false);
});

test("legacy enrollment without registration ID is owned only when its offering is automatic",()=>{
  assert.equal(registrationOwnsEnrollment("reg-a",{}, {rosterMode:"section"}),true);
  assert.equal(registrationOwnsEnrollment("reg-a",{}, {rosterMode:"legacy"}),true);
  assert.equal(registrationOwnsEnrollment("reg-a",{}, {rosterMode:"selective"}),false);
  assert.equal(registrationOwnsEnrollment("reg-a",{}, null),false);
});
