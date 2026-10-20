import test from "node:test";
import assert from "node:assert/strict";
import {hasActivityPreferences} from "../js/help/page-help.mjs";

test("student, administrative and staff-settings guards mount account preferences regardless of cache version",()=>{
  for(const source of ["auth-guard.js?v=2026.10.19.3","admin-analytics.mjs?v=2026.10.20.1","settings-security.js","settings-security.js?v=next"])
    assert.equal(hasActivityPreferences([{src:"https://fixture.test/js/"+source}]),true,source);
});
test("public help and lookalike script names never initialize activity collection",()=>{
  assert.equal(hasActivityPreferences([{src:"https://fixture.test/js/core/adminerva-loader.js"}]),false);
  assert.equal(hasActivityPreferences([{src:"https://fixture.test/js/not-auth-guard.js"}]),false);
  assert.equal(hasActivityPreferences([]),false);
});
