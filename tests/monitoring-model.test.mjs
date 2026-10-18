/** Backend/browser parity and non-grading monitoring authorization-model regressions. */
import test from "node:test";
import assert from "node:assert/strict";
import backend from "../functions/monitoring-model.js";
import {PAGES, ACTIONS, summarizeActivity} from "../js/analytics/activity-model.mjs";
test("packaged worker schema and summaries match the browser without shipping browser dependencies", () => {
  assert.deepEqual(backend.PAGES, PAGES); assert.deepEqual(backend.ACTIONS, ACTIONS);
  const now = Date.UTC(2026, 9, 19);
  const events = Array.from({length:120}, (_, index) => ({ownerUid:"owner", studentId:"student-" + index % 4, page:PAGES[index % PAGES.length], sessionId:"session-" + index % 6, action:ACTIONS[index % ACTIONS.length], activeSeconds:index % 2 ? 20 : 9000, createdAt:now - index * 8640000}));
  events.push(...events, {studentId:"student", action:"bad", page:"unknown", createdAt:now});
  assert.deepEqual(backend.summarizeActivity(events, {now}), summarizeActivity(events, {now}));
  const page = {studentId:"alice", sessionId:"same-page", action:"page-open", page:"playground", createdAt:now};
  assert.equal(summarizeActivity([page, page, {...page, action:"help-open"}], {now})[0].visits, 1);
  assert.equal(summarizeActivity([page, {...page, sessionId:"new-page"}], {now})[0].visits, 2);
});
test("only current consent, verified account ownership and assigned sections enter worker projections", () => {
  const event = {ownerUid:"alice-uid", studentId:"alice"};
  const preference = {enabled:true, ownerUid:"alice-uid", studentId:"alice"};
  const student = {email:"alice@example.test", section:"11-A"};
  const identity = {email:"ALICE@example.test", emailVerified:true, disabled:false};
  const include = (changes = {}) => backend.mayIncludeEvent(changes.event || event, changes.preference || preference, changes.student || student, changes.identity || identity, changes.sections || ["11-A"]);
  assert.equal(include(), true);
  assert.equal(include({preference:{...preference, enabled:false}}), false);
  assert.equal(include({preference:{...preference, ownerUid:"bob"}}), false);
  assert.equal(include({student:{...student, email:"new-owner@example.test"}}), false);
  assert.equal(include({identity:{...identity, disabled:true}}), false);
  assert.equal(include({identity:{...identity, emailVerified:false}}), false);
  assert.equal(include({sections:["11-B"]}), false);
});
test("missing, malformed and disabled policy cannot silently activate maintenance", () => {
  assert.equal(backend.validSettings(null), null);
  assert.equal(backend.validSettings({cleanupEnabled:true}), false);
  assert.equal(backend.validSettings({cleanupEnabled:true, summaryRefreshEnabled:false, revision:0}), false);
  assert.equal(backend.validSettings({cleanupEnabled:false, summaryRefreshEnabled:false, revision:1}), true);
});
