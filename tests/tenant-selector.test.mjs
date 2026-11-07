import test from "node:test";
import assert from "node:assert/strict";
import tenant from "../functions/tenant-access.js";
import {pickerState,schoolWorkspaceKey} from "../js/core/verified-school-scope.mjs";
test("a single verified school never displays a switcher",()=>{
 const items=[{schoolId:"mcs-manila",roles:["teacher"]}];
 assert.equal(tenant.selectVerifiedSchool(items,"another").showSwitcher,false);
 assert.equal(pickerState(items,"another").schoolId,"mcs-manila");
});
test("distinct schools have different browser scope keys",()=>{
 assert.notEqual(schoolWorkspaceKey("exampleUid","mcs-manila","studio"),schoolWorkspaceKey("exampleUid","school-b","studio"));
});
