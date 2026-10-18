/** Packaged maintenance handler deployment contracts; no production SDK operations. */
const test = require("node:test");
const assert = require("node:assert/strict");
process.env.GCLOUD_PROJECT = "demo-adminerva-contract";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8181";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9199";
const handlers = require("../functions/index.js");

test("monitoring handlers stay colocated, bounded and independently scoped", () => {
  for (const name of ["monitoringMaintenance", "activityConsentChanged"]) {
    const handler = handlers[name];
    assert.equal(typeof handler.run, "function");
    assert.deepEqual(handler.__endpoint.region, ["asia-southeast1"]);
    assert.equal(handler.__endpoint.maxInstances, 1);
    assert.equal(handler.__endpoint.concurrency, 1);
  }
  assert.equal(handlers.monitoringMaintenance.__endpoint.scheduleTrigger.schedule, "every 60 minutes");
  assert.equal(handlers.monitoringMaintenance.__endpoint.timeoutSeconds, 240);
  assert.equal(handlers.activityConsentChanged.__endpoint.timeoutSeconds, 120);
  assert.equal(handlers.activityConsentChanged.__endpoint.eventTrigger.eventFilterPathPatterns.document, "activity_preferences/{ownerUid}");
});
