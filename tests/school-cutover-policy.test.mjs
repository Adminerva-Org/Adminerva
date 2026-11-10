import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {SCHEMA,normalizeCutoverDecisions,evaluateCutoverDecisionRecord}=
  require("../functions/school-cutover-policy.js");

function approved(overrides={}){
  return {
    institutionalAuthorityReference:"MCS authority record 2026",
    calendarReference:"MCS academic calendar 2026-2027",
    privacyPolicyReference:"MCS privacy policy approved",
    retentionPolicyReference:"MCS retain-all policy approved",
    retentionMode:"retain_all",
    backupPolicyReference:"MCS backup and recovery policy",
    dataStewardRole:"school_admin",
    aiPermission:"approved",
    repositoryPermission:"approved",
    firstAdminAcknowledged:true,
    schoolAdminConfigurationReviewed:true,
    ...overrides
  };
}
test("MCS-style cutover decisions allow retain-all, AI and repositories with School Admin stewardship",()=>{
  const value=normalizeCutoverDecisions(approved());
  assert.equal(value.retentionMode,"retain_all");
  assert.equal(value.dataStewardRole,"school_admin");
  assert.equal(value.aiPermission,"approved");
  assert.equal(value.repositoryPermission,"approved");
});
test("cutover decision record requires the retention mode and exact first-admin binding",()=>{
  const record={schema:SCHEMA,schoolId:"mcs-manila",firstAdminUid:"uid-1",...approved()};
  assert.equal(evaluateCutoverDecisionRecord(record,{schoolId:"mcs-manila",firstAdminUid:"uid-1"}).ok,true);
  const stale=evaluateCutoverDecisionRecord({...record,retentionMode:null},
    {schoolId:"mcs-manila",firstAdminUid:"uid-1"});
  assert.equal(stale.ok,false);
  assert.ok(stale.missing.includes("retentionMode"));
  assert.equal(evaluateCutoverDecisionRecord(record,{schoolId:"mcs-manila",firstAdminUid:"uid-2"}).ok,false);
});
