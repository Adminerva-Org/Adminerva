import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const source = readFileSync(new URL("../js/analytics/admin-analytics.mjs", import.meta.url), "utf8")
  .replace(/^import .*;\r?$/gm, "");
function fixture() {
  const fields = new Map(), writes = [];
  const state = {policy: null, failPolicy: false, failStatus: false};
  const policySnapshot = () => ({data: () => state.policy, exists: () => Boolean(state.policy)});
  function field(id) {
    if (!fields.has(id)) fields.set(id, {
      dataset: {}, rows: [], listeners: {}, value: "", disabled: false,
      addEventListener(type, handler) { this.listeners[type] = handler; },
      querySelectorAll() { return [...fields.values()]; },
      replaceChildren() { this.rows = []; },
      insertRow() { const row = {insertCell: () => ({})}; this.rows.push(row); return row; }
    });
    return fields.get(id);
  }
  const context = {
    document: {getElementById: field}, window: {}, TEACHER_EMAIL: "instructor@example.test",
    auth: {currentUser: {uid: "administrator"}}, db: {}, staffRole: () => "admin",
    onAuthStateChanged() {}, confirm: () => true, serverTimestamp: () => "time",
    query: collection => collection, collection: (_, name) => name, orderBy() {}, limit() {},
    getDocs: async () => ({docs: []}), summarizeActivity: () => [],
    doc: (base, ...parts) => (typeof base === "string" ? [base, ...parts] : parts).join("/"),
    getDoc: async ref => {
      if (ref === "monitoring_control/runtime") {
        if (state.failPolicy) throw Error("Policy unavailable");
        return policySnapshot();
      }
      if (ref === "monitoring_status/runtime" && state.failStatus) throw Error("Status unavailable");
      return {data: () => null};
    },
    runTransaction: async (_, callback) => {
      const pending = [];
      const result = await callback({get: async () => policySnapshot(), set: (ref, data) => pending.push({ref, data})});
      for (const entry of pending) if (entry.ref === "monitoring_control/runtime") state.policy = entry.data;
      writes.push(...pending);
      return result;
    }
  };
  runInNewContext(source, context);
  return {field, state, writes, click: id => field(id).listeners.click()};
}
test("a maintenance policy edited elsewhere is preserved until the current policy is reviewed", async () => {
  const view = fixture();
  view.state.policy = {revision: 3, cleanupEnabled: false, summaryRefreshEnabled: false};
  await view.click("refresh-analytics");
  view.field("maintenance-reason").value = "Update monitoring policy";
  view.field("maintenance-cleanup").checked = true;
  view.state.policy = {revision: 4, cleanupEnabled: false, summaryRefreshEnabled: true};
  await view.click("save-maintenance");
  assert.deepEqual(view.writes, []);
  assert.match(view.field("admin-analytics-status").textContent, /another administrator/i);
  assert.equal(view.field("save-maintenance").disabled, true);
  await view.click("refresh-analytics");
  assert.equal(view.field("maintenance-summary").checked, true);
  view.field("maintenance-cleanup").checked = true;
  await view.click("save-maintenance");
  assert.equal(view.state.policy.revision, 5);
  assert.equal(view.state.policy.summaryRefreshEnabled, true);
  assert.equal(view.writes[1].ref, "monitoring_control/runtime/revisions/5");
});

test("an unreadable policy cannot be edited and an unreadable worker status is reported as unknown", async () => {
  const view = fixture();
  view.state.failPolicy = true;
  view.state.failStatus = true;
  await view.click("refresh-analytics");
  assert.equal(view.field("maintenance-cleanup").indeterminate, true);
  assert.equal(view.field("save-maintenance").disabled, true);
  assert.match(view.field("maintenance-status").textContent, /unavailable/i);
  view.state.failPolicy = false;
  await view.click("refresh-analytics");
  assert.equal(view.field("save-maintenance").disabled, false);
  assert.equal(view.field("maintenance-cleanup").indeterminate, false);
  view.field("maintenance-reason").value = "Create initial policy";
  await view.click("save-maintenance");
  assert.equal(view.state.policy.revision, 1);
});
