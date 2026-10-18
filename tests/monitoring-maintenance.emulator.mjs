/** Real local Firestore worker regressions; never connects to a production database or invokes deployment. */
import test, {before, after, beforeEach} from "node:test";
import assert from "node:assert/strict";
import {initializeApp, deleteApp} from "firebase-admin/app";
import {getFirestore, Timestamp, FieldValue} from "firebase-admin/firestore";
import {initializeTestEnvironment} from "@firebase/rules-unit-testing";
import {readFileSync} from "node:fs";
import worker from "../functions/monitoring-service.js";

const TEACHER = "josephsixson@mcstayuman.edu.ph";
let app, db, environment, service, clock;
const identities = [{uid:"alice-uid", email:"alice@example.test", emailVerified:true}, {uid:"bob-uid", email:"bob@example.test", emailVerified:true}];
before(async () => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(?:127\.0\.0\.1|localhost):\d+$/);
  const projectId = "demo-adminerva-security";
  environment = await initializeTestEnvironment({projectId, firestore:{rules:readFileSync("firestore.rules", "utf8")}});
  app = initializeApp({projectId}, "monitoring-worker-tests"); db = getFirestore(app);
});
after(async () => { await environment?.cleanup(); if (app) await deleteApp(app); });
beforeEach(async () => {
  await environment.clearFirestore(); clock = Date.now();
  service = worker.createMonitoringService({db, Timestamp, FieldValue, now:() => clock, resolveUsers:async uids => identities.filter(identity => uids.includes(identity.uid))});
  await Promise.all([
    db.doc("analytics_rosters/" + TEACHER).set({teacherEmail:TEACHER, sections:["11-A"]}),
    db.doc("students/alice").set({email:identities[0].email, section:"11-A", githubToken:"must-not-enter-summary"}),
    db.doc("students/bob").set({email:identities[1].email, section:"11-B"}),
    db.doc("activity_preferences/alice-uid").set({ownerUid:"alice-uid", studentId:"alice", enabled:true}),
    db.doc("activity_preferences/bob-uid").set({ownerUid:"bob-uid", studentId:"bob", enabled:true}),
    db.doc("student_grades/protected").set({score:18, published:true, feedback:"Protected teacher feedback"}),
    db.doc("assessment_evidence/protected").set({status:"approved", checkpointSha:"a".repeat(40)})
  ]);
});
function settings(flags = {}) { return db.doc("monitoring_control/runtime").set({cleanupEnabled:false, summaryRefreshEnabled:false, revision:1, ...flags}); }
function event(studentId = "alice", changes = {}) { return {ownerUid:studentId + "-uid", studentId, sessionId:"a".repeat(36), page:"playground", action:"page-open", activeSeconds:0, createdAt:Timestamp.fromMillis(clock - 60000), expiresAt:Timestamp.fromMillis(clock + 86400000), ...changes}; }
test("missing policy and explicit disabled policy perform no cleanup or summary writes", async () => {
  await db.doc("activity_events/expired").set(event("alice", {expiresAt:Timestamp.fromMillis(clock - 1)}));
  assert.equal((await service.runScheduled()).state, "disabled");
  await settings(); assert.equal((await service.runScheduled()).state, "disabled");
  assert.equal((await db.doc("activity_events/expired").get()).exists, true);
  assert.equal((await db.doc("analytics_views/" + TEACHER).get()).exists, false);
  assert.equal((await db.doc("monitoring_status/runtime").get()).exists, false);
});
test("cleanup removes expired monitoring only; academic records and fresh events remain unchanged", async () => {
  await settings({cleanupEnabled:true});
  await Promise.all([
    db.doc("activity_events/expired").set(event("alice", {expiresAt:Timestamp.fromMillis(clock - 1)})),
    db.doc("activity_events/fresh").set(event()),
    db.doc("issue_diagnostics/expired").set({expiresAt:Timestamp.fromMillis(clock - 1), actions:["run"]}),
    db.doc("issues/keep").set({title:"Keep the report", expiresAt:Timestamp.fromMillis(clock - 1)})
  ]);
  const outcome = await service.runScheduled();
  assert.equal(outcome.eventsRemoved, 1); assert.equal(outcome.diagnosticsRemoved, 1);
  assert.equal((await db.doc("activity_events/expired").get()).exists, false);
  assert.equal((await db.doc("activity_events/fresh").get()).exists, true);
  assert.equal((await db.doc("issues/keep").get()).exists, true);
  assert.deepEqual((await db.doc("student_grades/protected").get()).data(), {score:18, published:true, feedback:"Protected teacher feedback"});
  assert.deepEqual((await db.doc("assessment_evidence/protected").get()).data(), {status:"approved", checkpointSha:"a".repeat(40)});
  assert.equal((await db.doc("monitoring_status/runtime").get()).data().state, "completed");
});
test("worker caps cleanup batches, records backlog, and does not overlap an active lease", async () => {
  await settings({cleanupEnabled:true});
  for (let index = 0; index < 650; index += 200) {
    const batch = db.batch();
    for (let offset = index; offset < Math.min(index + 200, 650); offset++) batch.set(db.doc("activity_events/expired-" + offset), event("alice", {expiresAt:Timestamp.fromMillis(clock - 1)}));
    await batch.commit();
  }
  const result = await service.runScheduled(); assert.equal(result.eventsRemoved, 600); assert.equal(result.cleanupCapped, true);
  assert.equal((await db.collection("activity_events").get()).size, 50);
  await db.doc("monitoring_status/runtime").set({runId:"another-run", leaseUntil:Timestamp.fromMillis(clock + 1000)});
  assert.equal((await service.runScheduled()).state, "busy");
  clock += 2000; assert.equal((await service.runScheduled()).eventsRemoved, 50);
});
test("scheduled projection verifies current identities, consent and sections, and contains no raw diagnostics", async () => {
  await settings({summaryRefreshEnabled:true});
  await Promise.all([
    db.doc("activity_events/first").set(event()),
    db.doc("activity_events/duplicate").set(event()),
    db.doc("activity_events/time").set(event("alice", {action:"active-time", activeSeconds:30})),
    db.doc("activity_events/other-section").set(event("bob")),
    db.doc("activity_events/outside-window").set(event("alice", {createdAt:Timestamp.fromMillis(clock - 8 * 86400000)}))
  ]);
  assert.equal((await service.runScheduled()).summaryRows, 1);
  const snapshot = (await db.doc("analytics_views/" + TEACHER).get()).data();
  assert.equal(snapshot.source, "scheduled"); assert.equal(snapshot.rows[0].visits, 1); assert.equal(snapshot.rows[0].activeSeconds, 30);
  assert.ok(!JSON.stringify(snapshot).includes("must-not-enter-summary")); assert.ok(!JSON.stringify(snapshot).includes("ownerUid"));
  await db.doc("students/alice").update({email:"reassigned@example.test"});
  await service.runScheduled(); assert.deepEqual((await db.doc("analytics_views/" + TEACHER).get()).data().rows, []);
});
test("consent removal is current-state checked, idempotent, and independent of the optional hourly policy", async () => {
  await db.doc("analytics_views/" + TEACHER).set({rows:[{studentId:"alice", visits:1}, {studentId:"bob", visits:1}], publishedAt:Timestamp.fromMillis(clock - 10000)});
  await db.doc("activity_preferences/alice-uid").update({enabled:false});
  assert.equal(await service.applyConsentChange("alice-uid", "alice"), 1);
  assert.equal(await service.applyConsentChange("alice-uid", "alice"), 0);
  const reduced = (await db.doc("analytics_views/" + TEACHER).get()).data();
  assert.deepEqual(reduced.rows, [{studentId:"bob", visits:1}]); assert.equal(reduced.publishedAt.toMillis(), clock - 10000);
  await db.doc("activity_preferences/alice-uid").update({enabled:true});
  await db.doc("analytics_views/" + TEACHER).set({rows:[{studentId:"alice", visits:2}]});
  assert.equal(await service.applyConsentChange("alice-uid", "alice"), 0);
  await db.doc("activity_preferences/alice-uid").delete();
  assert.equal(await service.applyConsentChange("alice-uid", "alice"), 1);
});
test("a consent change during identity resolution is re-read inside the summary transaction", async () => {
  await settings({summaryRefreshEnabled:true}); await db.doc("activity_events/one").set(event());
  const racing = worker.createMonitoringService({db, Timestamp, FieldValue, now:() => clock, resolveUsers:async () => {
    await db.doc("activity_preferences/alice-uid").update({enabled:false}); return identities;
  }});
  await racing.runScheduled(); assert.deepEqual((await db.doc("analytics_views/" + TEACHER).get()).data().rows, []);
});
test("policy changes during work stop summary writes and report interruption rather than false completion", async () => {
  await settings({summaryRefreshEnabled:true}); await db.doc("activity_events/one").set(event());
  const racing = worker.createMonitoringService({db, Timestamp, FieldValue, now:() => clock, resolveUsers:async () => {
    await settings({revision:2}); return identities;
  }});
  assert.equal((await racing.runScheduled()).state, "interrupted");
  assert.equal((await db.doc("analytics_views/" + TEACHER).get()).exists, false);
  assert.equal((await db.doc("monitoring_status/runtime").get()).data().state, "interrupted");
});
