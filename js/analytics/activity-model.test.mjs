/** Regression tests for minimized activity, honest time accounting and verified staff identity. */
import test from "node:test";
import assert from "node:assert/strict";
import {PAGES, ACTIONS, pageForPath, safeStep, activeInterval, summarizeActivity, diagnosticPayload} from "./activity-model.mjs";
import {staffRole} from "../core/staff-role.mjs";
test("module names never retain query strings, credentials or unknown paths", () => {
  assert.equal(pageForPath("/student-playground.html"), "playground");
  assert.equal(pageForPath("/secret?token=private"), "other");
  assert.equal(safeStep("playground", "typed-password"), null);
  assert.equal(safeStep("https://example.com/private", "run"), null);
});
test("only active foreground intervals before idle cutoff count", () => {
  const state = {previous:0, now:30000, lastInput:0, visible:true, focused:true};
  assert.equal(activeInterval(state), 30);
  assert.equal(activeInterval({...state, previous:50000, now:80000}), 10);
  assert.equal(activeInterval({...state, previous:80000, now:110000}), 0);
  assert.equal(activeInterval({...state, visible:false}), 0);
  assert.equal(activeInterval({...state, focused:false}), 0);
  assert.equal(activeInterval({...state, now:900000}), 0);
  assert.equal(activeInterval({...state, previous:40000}), 0);
});
test("summaries distinguish returns from visits and reject expired or impossible signals", () => {
  const now = Date.UTC(2026, 9, 19), base = {studentId:"alice", page:"playground", createdAt:now - 86400000, action:"page-open"};
  const rows = summarizeActivity([base, base, {...base, createdAt:now}, {...base, action:"active-time", activeSeconds:6000}, {...base, createdAt:now - 8 * 86400000}, {...base, studentId:""}, {...base, createdAt:now + 1}], {now});
  assert.equal(rows.length, 1); assert.equal(rows[0].visits, 3); assert.equal(rows[0].days, 2); assert.equal(rows[0].activeSeconds, 60);
  assert.equal(rows[0].modules.playground, 60);
});
test("diagnostic attachments discard fields and contain only twenty allowlisted steps", () => {
  const steps = Array.from({length:30}, () => ({page:"practice", action:"save", password:"secret"}));
  const payload = diagnosticPayload([...steps, {page:"private", action:"save"}]);
  assert.equal(payload.pages.length, 20); assert.equal(payload.actions.length, 20);
  assert.ok(payload.pages.every(page => PAGES.includes(page))); assert.ok(payload.actions.every(action => ACTIONS.includes(action)));
  assert.ok(!JSON.stringify(payload).includes("secret"));
});
test("unverified email and simulated roles never authorize staff monitoring", () => {
  assert.equal(staffRole({email:"babaynike2013@gmail.com", emailVerified:false, role:"admin"}), null);
  assert.equal(staffRole({email:"student@example.com", emailVerified:true, role:"admin"}), null);
  assert.equal(staffRole({email:"BABAYNIKE2013@gmail.com", emailVerified:true}), "admin");
  assert.equal(staffRole({email:"josephsixson@mcstayuman.edu.ph", emailVerified:true}), "teacher");
});
