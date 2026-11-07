import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {addSchoolAdminRole}=require("../functions/platform-schools.js");

test("granting School Admin preserves an existing teacher role",()=>{
  assert.deepEqual(addSchoolAdminRole(["teacher"]),["teacher","school_admin"]);
  assert.deepEqual(addSchoolAdminRole(["teacher","school_admin"]),["teacher","school_admin"]);
});
test("granting School Admin to a roleless verified account adds only school_admin",()=>{
  assert.deepEqual(addSchoolAdminRole([]),["school_admin"]);
});
