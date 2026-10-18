/** Administrator-only operational monitoring, roster assignment and explicit coarse-summary publication. */
import {auth, db} from "../core/firebase-core.js";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {collection, getDocs, getDoc, doc, query, orderBy, limit, where, setDoc, writeBatch, serverTimestamp, Timestamp} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {staffRole, TEACHER_EMAIL} from "../core/staff-role.mjs?v=2026.10.19.2";
import {summarizeActivity} from "./activity-model.mjs?v=2026.10.19.2";

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
    getDoc(doc(db, "analytics_rosters", TEACHER_EMAIL))
  ]);
  if (current !== epoch || staffRole(auth.currentUser) !== "admin") return;
  records = snapshots[0].docs.map(record => ({id:record.id, ...record.data()}));
  preferences = snapshots[2].docs.map(record => record.data());
  students = snapshots[3].docs.map(record => ({id:record.id, ...record.data()}));
  selectedSections = snapshots[4].data()?.sections || [];
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
  const allowed = new Set(students.filter(student => selectedSections.includes(student.section)).map(student => student.id));
  const consent = new Map(preferences.filter(profile => profile.enabled).map(profile => [profile.ownerUid, profile.studentId]));
  const rows = summarizeActivity(records.filter(event => allowed.has(event.studentId) && consent.get(event.ownerUid) === event.studentId));
  if (rows.length > 100) throw Error("Narrow the assigned sections before publishing.");
  if (!confirm("Replace the teacher's engagement summary with " + rows.length + " opted-in students? This does not change grades or publish to students.")) return;
  await setDoc(doc(db, "analytics_views", TEACHER_EMAIL), {teacherEmail:TEACHER_EMAIL, rows, sections:selectedSections, windowDays:7, eventLimit:500, publishedBy:auth.currentUser.uid, publishedAt:serverTimestamp()});
  field("admin-analytics-status").textContent = "Teacher summary refreshed. Only coarse student learning activity is included, never diagnostic trails or bug reports.";
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
