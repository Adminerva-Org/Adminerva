import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {classification,mapPath,candidateEntry,canonicalDigest}=
  require("../functions/mcs-migration-ledger.js");

test("all existing school assessment and nested evidence paths retain their IDs under MCS",()=>{
  const source="assessment_evidence/sampleEvidence/revisions/2";
  assert.equal(mapPath(source,"mcs-manila").targetPath,
    "schools/mcs-manila/legacy_roots/assessment_evidence/documents/sampleEvidence/revisions/2");
  assert.equal(classification("staff_access"),"identity_review");
  assert.equal(classification("system_private"),"platform_or_secret_review");
});
test("document hashing ignores object field order but preserves snapshot revisions",()=>{
  assert.equal(canonicalDigest({b:2,a:{z:1,y:2}}),
    canonicalDigest({a:{y:2,z:1},b:2}));
  assert.notEqual(canonicalDigest({revision:1}),canonicalDigest({revision:2}));
});
test("conflicting explicit school labels are held even with the MCS-only owner confirmation",()=>{
  const entry=candidateEntry({sourcePath:"students/example",
    data:{schoolId:"another-school",name:"Example"},schoolId:"mcs-manila"});
  assert.equal(entry.decision,"school_conflict");
  assert.equal(entry.targetPath,"schools/mcs-manila/legacy_roots/students/documents/example");
});
test("raw V3 school records are mirror-only and never treated as canonical V4 documents",()=>{
  const entry=candidateEntry({sourcePath:"assessments/legacy-task",
    data:{title:"Legacy task"},schoolId:"mcs-manila"});
  assert.equal(entry.migrationMode,"legacy_mirror");
  assert.equal(entry.canonicalV4TargetPath,null);
  assert.equal(entry.decision,"eligible_for_approved_mirror");
  assert.equal(entry.targetPath,
    "schools/mcs-manila/legacy_roots/assessments/documents/legacy-task");
});
test("identity and secret documents never receive an automatic destination",()=>{
  const entry=candidateEntry({sourcePath:"staff_access/staff",data:{role:"teacher"},schoolId:"mcs-manila"});
  assert.equal(entry.targetPath,null);
  assert.equal(entry.decision,"manual_review");
});
