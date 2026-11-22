import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const schools=readFileSync(new URL("../functions/platform-schools.js",import.meta.url),"utf8");
const schoolPage=readFileSync(new URL("../owner-schools.html",import.meta.url),"utf8");
const schoolClient=readFileSync(new URL("../js/core/owner-school-registry.mjs",import.meta.url),"utf8");
const monitoringPage=readFileSync(new URL("../admin-analytics.html",import.meta.url),"utf8");
const monitoring=readFileSync(new URL("../js/analytics/admin-analytics.mjs",import.meta.url),"utf8");
const support=readFileSync(new URL("../js/core/issues-legacy.js",import.meta.url),"utf8");
const navigation=readFileSync(new URL("../js/core/navigation-ia.mjs",import.meta.url),"utf8");
const releases=readFileSync(new URL("../patch-notes.html",import.meta.url),"utf8");

test("School Registry exposes update retire and restore without hard deletion",()=>{
  for(const action of ["update_registry","archive_school","restore_archived_school"])
    assert.match(schools,new RegExp('action==="'+action+'"'));
  assert.match(schools,/Only a draft or suspended school can be retired/);
  assert.match(schools,/restoredState=\["draft","suspended"\]\.includes\(data\.archivedFromState\)\?data\.archivedFromState:"draft"/);
  assert.match(schools,/action:"school_registry_updated"/);
  assert.match(schools,/action:"school_archived"/);
  assert.match(schools,/action:"school_archived_restored"/);
  assert.match(schoolPage,/id="owner-registry-update"/);
  assert.match(schoolPage,/id="owner-archive-school"/);
  assert.match(schoolPage,/id="owner-restore-school"/);
  assert.match(schoolClient,/submit\(f,"update_registry"/);
  assert.match(schoolClient,/submit\(f,"archive_school"/);
  assert.match(schoolClient,/submit\(f,"restore_archived_school"/);
  assert.doesNotMatch(schools,/delete\(schoolRef/);
});

test("platform governance role definitions and assignments already have lifecycle CRUD",()=>{
  for(const action of [
    "create_governance_role","update_governance_role","archive_governance_role",
    "restore_governance_role","assign_governance_role",
    "end_governance_role_assignment","restore_governance_role_assignment"
  ]) assert.match(schools,new RegExp(action));
  assert.match(navigation,/School Governance Roles/);
});

test("legacy monitoring assignment is revisioned and can be retired and restored",()=>{
  assert.match(monitoringPage,/id="roster-reason"/);
  assert.match(monitoringPage,/id="retire-roster"/);
  assert.match(monitoringPage,/Save \/ restore assignment/);
  assert.match(monitoring,/reviewedRosterRevision/);
  assert.match(monitoring,/transaction\.set\(doc\(ref,"revisions",String\(revision\)\)/);
  assert.match(monitoring,/status:"archived"/);
  assert.match(monitoring,/status==="archived"\?\[\]/);
  assert.match(monitoring,/Only an active monitoring assignment can be retired/);
});

test("System Admin support lifecycle preserves reports and audits changes",()=>{
  assert.match(support,/async function updateIssueFields/);
  assert.match(support,/adminDecisionReason/);
  assert.match(support,/runTransaction\(db,async transaction/);
  assert.match(support,/doc\(ref,"revisions",String\(next\)\)/);
  assert.match(support,/status:"Closed \(Won't Fix\)",locked:true/);
  assert.match(support,/can be reopened through triage/);
  assert.doesNotMatch(support,/deleteDoc\(doc\(db,"issues",currentOpenIssueId\)/);
});

test("release history remains source-controlled rather than becoming mutable CRUD data",()=>{
  assert.match(navigation,/Published source-controlled release history/);
  assert.doesNotMatch(releases,/Create release/i);
  assert.doesNotMatch(releases,/Delete release/i);
});
