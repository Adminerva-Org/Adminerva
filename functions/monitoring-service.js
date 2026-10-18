/** Disabled-by-default monitoring maintenance, bounded expiry cleanup and consent-safe coarse projections. */
const {randomUUID} = require("node:crypto");
const {TEACHER_EMAIL, EVENT_LIMIT, STUDENT_LIMIT, WINDOW_DAYS, summarizeActivity, validSettings, mayIncludeEvent} = require("./monitoring-model.js");
const BATCH_SIZE = 200;
const CLEANUP_BATCHES = 3;
const LEASE_MS = 300000;

function createMonitoringService({db, Timestamp, FieldValue, resolveUsers, now = Date.now, newRunId = randomUUID}) {
  const controlRef = db.doc("monitoring_control/runtime");
  const statusRef = db.doc("monitoring_status/runtime");
  const rosterRef = db.doc("analytics_rosters/" + TEACHER_EMAIL);
  const viewRef = db.doc("analytics_views/" + TEACHER_EMAIL);
  const currentLease = (status, runId) => status?.runId === runId && status.leaseUntil?.toMillis?.() > now();
  async function acquire(runId) {
    return db.runTransaction(async transaction => {
      const [control, status] = await transaction.getAll(controlRef, statusRef);
      const settings = control.data(), previous = status.data();
      if (!validSettings(settings) || (!settings.cleanupEnabled && !settings.summaryRefreshEnabled)) return {state:"disabled"};
      if (previous?.leaseUntil?.toMillis?.() > now()) return {state:"busy"};
      transaction.set(statusRef, {state:"running", runId, settingsRevision:settings.revision, startedAt:FieldValue.serverTimestamp(), leaseUntil:Timestamp.fromMillis(now() + LEASE_MS)});
      return {state:"running", settings};
    });
  }
  async function purgeCollection(name, runId, revision, cutoff) {
    let removed = 0, capped = false, stopped = false;
    for (let batchIndex = 0; batchIndex < CLEANUP_BATCHES; batchIndex++) {
      const outcome = await db.runTransaction(async transaction => {
        const [control, status] = await transaction.getAll(controlRef, statusRef);
        if (!currentLease(status.data(), runId) || !control.data()?.cleanupEnabled || control.data().revision !== revision) return {count:0, stopped:true};
        const expired = await transaction.get(db.collection(name).where("expiresAt", "<=", Timestamp.fromMillis(cutoff)).orderBy("expiresAt").limit(BATCH_SIZE));
        for (const record of expired.docs) transaction.delete(record.ref);
        return {count:expired.size, stopped:false};
      });
      removed += outcome.count; stopped = outcome.stopped;
      capped = batchIndex === CLEANUP_BATCHES - 1 && outcome.count === BATCH_SIZE;
      if (stopped || outcome.count < BATCH_SIZE) break;
    }
    return {removed, capped, stopped};
  }
  async function refreshSummary(runId, revision, cutoff) {
    const settings = (await controlRef.get()).data();
    if (!validSettings(settings) || !settings.summaryRefreshEnabled || settings.revision !== revision) return {refreshed:false, stopped:true};
    const eventQuery = db.collection("activity_events").where("createdAt", ">=", Timestamp.fromMillis(cutoff - WINDOW_DAYS * 86400000)).where("createdAt", "<=", Timestamp.fromMillis(cutoff)).orderBy("createdAt", "desc").limit(EVENT_LIMIT);
    const initial = await eventQuery.get();
    const ownerUids = [...new Set(initial.docs.map(record => record.data().ownerUid).filter(uid => typeof uid === "string" && uid.length > 0))];
    const identities = new Map();
    for (let index = 0; index < ownerUids.length; index += 100) {
      const resolved = await resolveUsers(ownerUids.slice(index, index + 100));
      for (const identity of resolved) identities.set(identity.uid, identity);
    }
    return db.runTransaction(async transaction => {
      const [control, status, roster] = await transaction.getAll(controlRef, statusRef, rosterRef);
      if (!currentLease(status.data(), runId) || !control.data()?.summaryRefreshEnabled || control.data().revision !== revision) return {refreshed:false, stopped:true};
      const sections = roster.data()?.sections;
      if (!Array.isArray(sections) || sections.length > 40 || !sections.every(section => typeof section === "string" && section.length <= 100)) return {refreshed:false};
      const events = await transaction.get(eventQuery);
      const data = events.docs.map(record => record.data());
      const uids = [...new Set(data.map(event => event.ownerUid).filter(uid => identities.has(uid)))];
      const studentIds = [...new Set(data.map(event => event.studentId).filter(studentId => typeof studentId === "string" && studentId.length > 0 && !studentId.includes("/")))];
      const preferences = uids.length ? await transaction.getAll(...uids.map(uid => db.doc("activity_preferences/" + uid))) : [];
      const students = studentIds.length ? await transaction.getAll(...studentIds.map(studentId => db.doc("students/" + studentId)), {fieldMask:["email", "section"]}) : [];
      const preferenceMap = new Map(preferences.map(record => [record.id, record.data()]));
      const studentMap = new Map(students.map(record => [record.id, record.data()]));
      const allowed = data.filter(event => mayIncludeEvent(event, preferenceMap.get(event.ownerUid), studentMap.get(event.studentId), identities.get(event.ownerUid), sections));
      const rows = summarizeActivity(allowed, {now:cutoff}).sort((first, second) => first.studentId.localeCompare(second.studentId));
      transaction.set(viewRef, {teacherEmail:TEACHER_EMAIL, rows:rows.slice(0, STUDENT_LIMIT), sections, windowDays:WINDOW_DAYS, eventLimit:EVENT_LIMIT, eventCount:events.size, studentLimit:STUDENT_LIMIT, truncated:rows.length > STUDENT_LIMIT, source:"scheduled", publishedBy:"system:monitoring-maintenance", publishedAt:FieldValue.serverTimestamp()});
      return {refreshed:true, rows:Math.min(rows.length, STUDENT_LIMIT), truncated:rows.length > STUDENT_LIMIT};
    });
  }
  async function runScheduled() {
    const runId = newRunId(), started = now();
    const acquired = await acquire(runId);
    if (acquired.state !== "running") return acquired;
    const result = {state:"completed", eventsRemoved:0, diagnosticsRemoved:0, cleanupCapped:false, summaryRefreshed:false};
    try {
      if (acquired.settings.cleanupEnabled) {
        for (const [name, counter] of [["activity_events", "eventsRemoved"], ["issue_diagnostics", "diagnosticsRemoved"]]) {
          const outcome = await purgeCollection(name, runId, acquired.settings.revision, started);
          result[counter] = outcome.removed; result.cleanupCapped ||= outcome.capped;
          if (outcome.stopped) { result.state = "interrupted"; break; }
        }
      }
      if (acquired.settings.summaryRefreshEnabled && result.state !== "interrupted") {
        const outcome = await refreshSummary(runId, acquired.settings.revision, started);
        result.summaryRefreshed = outcome.refreshed;
        result.summaryRows = outcome.rows || 0; result.summaryTruncated = outcome.truncated || false;
        if (outcome.stopped) result.state = "interrupted";
      }
      return result;
    } catch {
      result.state = "failed";
      throw Error("Monitoring maintenance failed. Check the administrator maintenance status; no academic writes are performed by this worker.");
    } finally {
      await db.runTransaction(async transaction => {
        const status = await transaction.get(statusRef);
        if (status.data()?.runId !== runId) return;
        transaction.set(statusRef, {...result, runId, settingsRevision:acquired.settings.revision, startedAt:Timestamp.fromMillis(started), finishedAt:FieldValue.serverTimestamp(), leaseUntil:Timestamp.fromMillis(0)});
      });
    }
  }
  async function applyConsentChange(ownerUid, previousStudentId) {
    return db.runTransaction(async transaction => {
      const [preference, view] = await transaction.getAll(db.doc("activity_preferences/" + ownerUid), viewRef);
      const current = preference.data(), snapshot = view.data();
      if (!snapshot || !Array.isArray(snapshot.rows)) return 0;
      const revoked = new Set([previousStudentId, current?.studentId].filter(studentId => typeof studentId === "string" && studentId.length > 0 && (current?.enabled !== true || current.studentId !== studentId)));
      const rows = snapshot.rows.filter(row => !revoked.has(row.studentId));
      if (rows.length === snapshot.rows.length) return 0;
      transaction.set(viewRef, {rows, privacyUpdatedAt:FieldValue.serverTimestamp()}, {merge:true});
      return snapshot.rows.length - rows.length;
    });
  }
  return {runScheduled, applyConsentChange};
}
module.exports = {createMonitoringService};
