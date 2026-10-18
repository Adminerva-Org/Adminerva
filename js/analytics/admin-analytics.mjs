/** Administrator-only operational monitoring, roster assignment and explicit coarse-summary publication. */
import {auth, db} from "../core/firebase-core.js";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {collection, getDocs, getDoc, doc, query, orderBy, limit, where, setDoc, writeBatch, runTransaction, serverTimestamp, Timestamp} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {staffRole, TEACHER_EMAIL} from "../core/staff-role.mjs?v=2026.10.19.2";
import {summarizeActivity} from "./activity-model.mjs?v=2026.10.19.3";

const field = id => document.getElementById(id);
let records = [], preferences = [], students = [], selectedSections = [], epoch = 0;
function textCell(row, value) { const cell = row.insertCell(); cell.textContent = String(value); }
async function operation(message, work) {
  const end = window.beginLoading?.(message, field("operations")) || (() => {});
  field("admin-analytics-status").textContent = message;
  field("operations").querySelectorAll("button").forEach(button => button.disabled = true);
  const current = epoch;
  try { await work(); } catch { if (current === epoch) field("admin-analytics-status").textContent = "Monitoring unavailable. Matching permissions and a connection are required; no academic data was changed. Try Refresh."; }
  finally { end(); if (current === epoch) field("operations").querySelectorAll("button").forEach(button => button.disabled = false); }
}
async function refresh() {
  const current = epoch;
  const snapshots = await Promise.all([
    getDocs(query(collection(db, "activity_events"), orderBy("createdAt", "desc"), limit(500))),
    getDocs(query(collection(db, "issues"), orderBy("createdAt", "desc"), limit(200))),
    getDocs(query(collection(db, "activity_preferences"), limit(500))),
    getDocs(collection(db, "students")),
    getDoc(doc(db, "analytics_rosters", TEACHER_EMAIL)),
    getDoc(doc(db, "monitoring_control", "runtime")),
    getDoc(doc(db, "monitoring_status", "runtime"))
  ]);
  if (current !== epoch || staffRole(auth.currentUser) !== "admin") return;
  records = snapshots[0].docs.map(record => ({id:record.id, ...record.data()}));
  preferences = snapshots[2].docs.map(record => record.data());
  students = snapshots[3].docs.map(record => ({id:record.id, ...record.data()}));
  selectedSections = snapshots[4].data()?.sections || [];
  const policy = snapshots[5].data(), maintenance = snapshots[6].data();
  field("maintenance-cleanup").checked = policy?.cleanupEnabled === true;
  field("maintenance-summary").checked = policy?.summaryRefreshEnabled === true;
  field("maintenance-status").textContent = maintenance ?
    "Last server result: " + maintenance.state + ". " + (maintenance.finishedAt?.toDate().toLocaleString() || "Run in progress") +
    ". Expired events removed: " + (maintenance.eventsRemoved || 0) + "; diagnostic trails removed: " + (maintenance.diagnosticsRemoved || 0) +
    ". Summary refreshed: " + (maintenance.summaryRefreshed ? "yes" : "no") + (maintenance.cleanupCapped ? ". Cleanup limit reached; a backlog may remain." : "") :
    "No server run is recorded. Saving policy does not deploy or confirm the availability of a backend worker.";
  const enabled = new Map(preferences.filter(profile => profile.enabled).map(profile => [profile.ownerUid, profile]));
  const events = records.filter(event => enabled.get(event.ownerUid)?.studentId === event.studentId);
  const summary = summarizeActivity(events);
  field("usage-count").textContent = summary.length;
  field("return-count").textContent = summary.filter(row => row.days > 1).length;
  field("active-time").textContent = Math.round(summary.reduce((sum, row) => sum + row.activeSeconds, 0) / 60) + " min";
  const issues = snapshots[1].docs.map(record => record.data());
  field("bug-count").textContent = issues.filter(issue => issue.category === "Bug" && issue.status !== "Resolved").length;
  const moduleSeconds = {};
  for (const row of summary) for (const [page, seconds] of Object.entries(row.modules)) moduleSeconds[page] = (moduleSeconds[page] || 0) + seconds;
  field("module-usage").replaceChildren();
  for (const [page, seconds] of Object.entries(moduleSeconds).sort((first, second) => second[1] - first[1])) {
    const row = field("module-usage").insertRow(); textCell(row, page); textCell(row, Math.round(seconds / 60) + " min");
  }
  field("raw-events").replaceChildren();
  for (const event of records.slice(0, 100)) {
    const row = field("raw-events").insertRow();
    for (const value of [event.createdAt?.toDate().toLocaleString() || "Pending", event.ownerUid, event.page, event.action, event.activeSeconds]) textCell(row, value);
  }
  field("roster-sections").replaceChildren();
  for (const section of [...new Set(students.map(student => student.section).filter(Boolean))].sort()) {
    const option = new Option(section, section); option.selected = selectedSections.includes(section); field("roster-sections").add(option);
  }
  field("admin-analytics-status").textContent = "Refreshed. Usage: last 7 days from at most 500 newest events; bug counts: at most 200 newest reports. These are partial, self-reported observations, not population totals or proof of learning.";
}
field("refresh-analytics").addEventListener("click", () => operation("Loading monitoring…", refresh));
field("save-roster").addEventListener("click", () => operation("Saving teacher assignment…", async () => {
  const sections = [...field("roster-sections").selectedOptions].map(option => option.value);
  await setDoc(doc(db, "analytics_rosters", TEACHER_EMAIL), {teacherEmail:TEACHER_EMAIL, sections, updatedBy:auth.currentUser.uid, updatedAt:serverTimestamp()});
  selectedSections = sections;
  field("admin-analytics-status").textContent = "Assignment saved. Publish a fresh summary to replace the previous teacher snapshot.";
}));
field("publish-engagement").addEventListener("click", () => operation("Preparing teacher summary…", async () => {
  await refresh();
  const captured = records.slice(), actor = auth.currentUser, generation = epoch;
  if (!confirm("Replace the teacher's engagement summary from the current sample? Consent and assigned sections will be checked again before saving. This does not change grades or publish to students.")) return;
  await runTransaction(db, async transaction => {
    const roster = await transaction.get(doc(db, "analytics_rosters", TEACHER_EMAIL));
    const sections = roster.data()?.sections || [];
    const ownerUids = [...new Set(captured.map(event => event.ownerUid))];
    const studentIds = [...new Set(captured.map(event => event.studentId).filter(Boolean))];
    const currentPreferences = await Promise.all(ownerUids.map(uid => transaction.get(doc(db, "activity_preferences", uid))));
    const currentStudents = await Promise.all(studentIds.map(studentId => transaction.get(doc(db, "students", studentId))));
    const allowed = new Set(currentStudents.filter(student => sections.includes(student.data()?.section)).map(student => student.id));
    const consent = new Map(currentPreferences.filter(preference => preference.data()?.enabled).map(preference => [preference.id, preference.data().studentId]));
    const rows = summarizeActivity(captured.filter(event => allowed.has(event.studentId) && consent.get(event.ownerUid) === event.studentId));
    if (rows.length > 100) throw Error("Narrow the assigned sections before publishing.");
    if (generation !== epoch || auth.currentUser?.uid !== actor.uid) throw Error("Account changed.");
    transaction.set(doc(db, "analytics_views", TEACHER_EMAIL), {teacherEmail:TEACHER_EMAIL, rows, sections, windowDays:7, eventLimit:500, publishedBy:actor.uid, publishedAt:serverTimestamp()});
  });
  field("admin-analytics-status").textContent = "Teacher summary refreshed. Only coarse student learning activity is included, never diagnostic trails or bug reports.";
}));
field("save-maintenance").addEventListener("click", () => operation("Saving maintenance policy…", async () => {
  const cleanupEnabled = field("maintenance-cleanup").checked, summaryRefreshEnabled = field("maintenance-summary").checked;
  const reason = field("maintenance-reason").value.trim(), actor = auth.currentUser, generation = epoch;
  if (reason.length < 12 || reason.length > 600) { field("admin-analytics-status").textContent = "Explain this policy change in 12–600 characters before saving."; return; }
  if ((cleanupEnabled || summaryRefreshEnabled) && !confirm("Save this automatic-maintenance policy? Only an already approved and deployed backend can execute it. Review school privacy, cost and retention policy first. Grades and feedback are never published by maintenance.")) return;
  await runTransaction(db, async transaction => {
    const ref = doc(db, "monitoring_control", "runtime"), snapshot = await transaction.get(ref);
    const before = snapshot.exists() ? snapshot.data() : null, revision = (before?.revision || 0) + 1;
    const after = {cleanupEnabled, summaryRefreshEnabled, reason, revision, updatedBy:actor.uid, updatedAt:serverTimestamp()};
    if (generation !== epoch || auth.currentUser?.uid !== actor.uid) throw Error("Account changed.");
    transaction.set(ref, after);
    transaction.set(doc(ref, "revisions", String(revision)), {before, after, reason, actorUid:actor.uid, createdAt:serverTimestamp()});
  });
  field("maintenance-reason").value = "";
  field("admin-analytics-status").textContent = "Maintenance policy saved with an immutable audit record. This does not deploy a worker; check its recorded server result after activation.";
}));
field("purge-events").addEventListener("click", () => operation("Removing expired monitoring records…", async () => {
  if (!confirm("Permanently delete up to 500 expired events and 500 expired diagnostic attachments? Academic records are not affected.")) return;
  let count = 0;
  for (const name of ["activity_events", "issue_diagnostics"]) {
    const expired = await getDocs(query(collection(db, name), where("expiresAt", "<=", Timestamp.now()), limit(500)));
    if (expired.empty) continue;
    const batch = writeBatch(db); expired.docs.forEach(record => batch.delete(record.ref)); await batch.commit(); count += expired.size;
  }
  await refresh();
  field("admin-analytics-status").textContent = count + " expired records removed. Repeat if the batch limit was reached. Automatic TTL cleanup requires separate server configuration.";
}));
onAuthStateChanged(auth, user => {
  epoch++; records = []; preferences = []; students = [];
  field("raw-events").replaceChildren(); field("module-usage").replaceChildren();
  field("operations").hidden = staffRole(user) !== "admin";
  if (staffRole(user) === "admin") void operation("Loading monitoring…", refresh);
  else field("admin-analytics-status").textContent = "Administrator access requires a verified authorized account. No monitoring records were requested.";
});
