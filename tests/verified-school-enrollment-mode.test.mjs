import test from "node:test";
import assert from "node:assert/strict";
import {createVerifiedSchoolScope} from "../js/core/verified-school-scope.mjs";

test("verified school scope preserves the server-authorized enrollment capability",async()=>{
  const scope=createVerifiedSchoolScope({
    loadSchools:async()=>({schools:[{
      schoolId:"school-one",name:"School One",roles:["school_admin"],
      compatibilityMode:"v4_only",enrollmentMode:"canonical",platformOverride:false
    }]})
  });
  const state=await scope.refresh({uid:"admin-user"});
  assert.equal(state.state,"ready");
  assert.equal(scope.current.schoolId,"school-one");
  assert.equal(scope.current.enrollmentMode,"canonical");
  assert.equal(scope.current.compatibilityMode,"v4_only");
});

test("missing or unknown enrollment capability fails back to compatibility workflow",async()=>{
  const scope=createVerifiedSchoolScope({
    loadSchools:async()=>({schools:[{
      schoolId:"school-two",name:"School Two",roles:["school_admin"],
      compatibilityMode:"legacy_allowed"
    }]})
  });
  await scope.refresh({uid:"admin-user"});
  assert.equal(scope.current.enrollmentMode,"compatibility");
});
