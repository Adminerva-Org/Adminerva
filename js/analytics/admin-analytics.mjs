/** Administrator-only operational monitoring, roster assignment and explicit coarse-summary publication. */
import {auth, db} from "../core/firebase-core.js?v=1.3.0";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {collection, getDocs, getDoc, doc, query, orderBy, limit, where, setDoc, writeBatch, runTransaction, serverTimestamp, Timestamp} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {staffRole, TEACHER_EMAIL} from "../core/staff-role.mjs?v=1.3.0";
import {summarizeActivity} from "./activity-model.mjs?v=1.3.0";

const field = id => document.getElementById(id);
let teacherEmail=TEACHER_EMAIL;
let records = [], preferences = [], students = [], selectedSections = [], epoch = 0, activeOperation=null;
let reviewedPolicyRevision = null;
function syncPolicyControls() {
  const unavailable = reviewedPolicyRevision === null;
  for (const id of ["maintenance-cleanup", "maintenance-summary"]) {
    field(id).indeterminate = unavailable;
  }
  for (const id of ["maintenance-cleanup", "maintenance-summary", "maintenance-reason", "save-maintenance"]) {
    field(id).disabled = unavailable || Boolean(activeOperation);
  }
}
function textCell(row, value) { const cell = row.insertCell(); cell.textContent = String(value); }
async function operation(message, work) {
  if(activeOperation||staffRole(auth.currentUser)!=="admin")return;
  const current=epoch,uid=auth.currentUser.uid,token={};activeOperation=token;
  const end = window.beginLoading?.(message, field("operations")) || (() => {});
  field("admin-analytics-status").textContent = message;
  const controls=[...field("operations").querySelectorAll("button,select,input,textarea")].filter(control=>!control.disabled);
  controls.forEach(control=>control.disabled=true);
  const active=()=>current===epoch&&auth.currentUser?.uid===uid&&activeOperation===token;
  try { await work(); } catch(error) { if(active())field("admin-analytics-status").textContent = (error?.message||"Monitoring operation unavailable.")+" Check permissions and connection, then refresh."; }
  finally { end(); if(active()){activeOperation=null;controls.forEach(control=>control.disabled=false);syncPolicyControls();} }
}
async function refresh({requireComplete=false}={}) {
  const current = epoch;
  const results = await Promise.allSettled([
    getDocs(query(collection(db, "activity_events"), orderBy("createdAt", "desc"), limit(500))),
    getDocs(query(collection(db, "issues"), orderBy("createdAt", "desc"), limit(200))),
    getDocs(query(collection(db, "activity_preferences"), limit(500))),
    getDocs(collection(db, "students")),
    getDoc(doc(db, "analytics_rosters", teacherEmail)),
    getDoc(doc(db, "monitoring_control", "runtime")),
    getDoc(doc(db, "monitoring_status", "runtime"))
  ]);
  if (current !== epoch || staffRole(auth.currentUser) !== "admin") throw Error("Account or monitoring context changed.");
  const names=["optional activity","support reports","consent records","student directory","instructor assignment","maintenance policy","worker status"];
  const missing=results.flatMap((result,index)=>result.status==="rejected"?[names[index]]:[]);
  if (results[5].status === "rejected") {
    reviewedPolicyRevision = null;
    syncPolicyControls();
  }
  if(requireComplete&&missing.length)throw Error("Required monitoring sources unavailable");
  const snapshots=results.map(result=>result.status==="fulfilled"?result.value:{docs:[],data:()=>null});
  records = snapshots[0].docs.map(record => ({id:record.id, ...record.data()}));
  preferences = snapshots[2].docs.map(record => record.data());
  students = snapshots[3].docs.map(record => ({id:record.id, ...record.data()}));
  selectedSections = snapshots[4].data()?.sections || [];
  const policy = snapshots[5].data(), maintenance = snapshots[6].data();
  reviewedPolicyRevision = results[5].status === "fulfilled" ? (policy?.revision ?? 0) : null;
  syncPolicyControls();
  field("maintenance-cleanup").checked = policy?.cleanupEnabled === true;
  field("maintenance-summary").checked = policy?.summaryRefreshEnabled === true;
  field("maintenance-status").textContent = results[6].status === "rejected" ?
    "Worker status is unavailable. Refresh monitoring to retry." : maintenance ?
    "Last server result: " + maintenance.state + ". " + (maintenance.finishedAt?.toDate().toLocaleString() || "Run in progress") +
    ". Expired events removed: " + (maintenance.eventsRemoved || 0) + "; diagnostic trails removed: " + (maintenance.diagnosticsRemoved || 0) +
    ". Summary refreshed: " + (maintenance.summaryRefreshed ? "yes" : "no") + (maintenance.cleanupCapped ? ". Cleanup limit reached; a backlog may remain." : "") :
    "No server run is recorded. Saving policy does not deploy or confirm the availability of a backend worker.";
  const enabled = new Map(preferences.filter(profile => profile.enabled).map(profile => [profile.ownerUid, profile]));
  const events = records.filter(event => enabled.get(event.ownerUid)?.studentId === event.studentId);
  const summary = summarizeActivity(events);
  const usageReady=results[0].status==="fulfilled"&&results[2].status==="fulfilled";
  field("usage-count").textContent = usageReady?summary.length:"—";
  field("return-count").textContent = usageReady?summary.filter(row => row.days > 1).length:"—";
  field("active-time").textContent = usageReady?Math.round(summary.reduce((sum, row) => sum + row.activeSeconds, 0) / 60) + " min":"—";
  const issues = snapshots[1].docs.map(record => record.data());
  field("bug-count").textContent = results[1].status==="fulfilled"?issues.filter(issue => issue.category === "Bug" && issue.status !== "Resolved").length:"—";
  const moduleSeconds = {};
  for (const row of summary) for (const [page, seconds] of Object.entries(row.modules)) moduleSeconds[page] = (moduleSeconds[page] || 0) + seconds;
  field("module-usage").replaceChildren();
  for (const [page, seconds] of Object.entries(moduleSeconds).sort((first, second) => second[1] - first[1])) {
    const row = field("module-usage").insertRow(); textCell(row, page); textCell(row, Math.round(seconds / 60) + " min");
  }
  if(!field("module-usage").rows.length){const row=field("module-usage").insertRow();const cell=row.insertCell();cell.colSpan=2;cell.textContent=usageReady?"No opted-in activity in this sample. This is not inactivity or poor engagement.":"Activity totals unavailable. Refresh to retry; missing data is not zero.";}
  field("raw-events").replaceChildren();
  for (const event of records.slice(0, 100)) {
    const row = field("raw-events").insertRow();
    for (const value of [event.createdAt?.toDate().toLocaleString() || "Pending", event.ownerUid, event.page, event.action, event.activeSeconds]) textCell(row, value);
  }
  field("roster-sections").replaceChildren();
  for (const section of [...new Set(students.map(student => student.section).filter(Boolean))].sort()) {
    const option = new Option(section, section); option.selected = selectedSections.includes(section); field("roster-sections").add(option);
  }
  field("admin-analytics-status").textContent = (missing.length?"Partially refreshed. Unavailable: "+missing.join(", ")+". Use Refresh monitoring to retry. ":"Refreshed. ")+"Usage: last 7 days from at most 500 newest events; bug counts: at most 200 newest reports. These are partial, self-reported observations, not population totals or proof of learning.";
  field("operations").dataset.unavailable=missing.join(",");
}
field("refresh-analytics").addEventListener("click", () => operation("Loading monitoring…", refresh));
field("save-roster").addEventListener("click", () => operation("Saving teacher assignment…", async () => {
  if(/instructor assignment|student directory/.test(field("operations").dataset.unavailable||""))throw Error("Reload the complete assignment first");
  const sections = [...field("roster-sections").selectedOptions].map(option => option.value);
  await setDoc(doc(db, "analytics_rosters", teacherEmail), {teacherEmail:teacherEmail, sections, updatedBy:auth.currentUser.uid, updatedAt:serverTimestamp()});
  selectedSections = sections;
  field("admin-analytics-status").textContent = "Assignment saved. Publish a fresh summary to replace the previous teacher snapshot.";
}));
field("publish-engagement").addEventListener("click", () => operation("Preparing teacher summary…", async () => {
  const actor=auth.currentUser,generation=epoch,targetTeacher=teacherEmail;
  await refresh({requireComplete:true});
  const captured = records.slice();
  if(generation!==epoch||auth.currentUser?.uid!==actor.uid)throw Error("Account changed.");
  if (!confirm("Replace the teacher's engagement summary from the current sample? Consent and assigned sections will be checked again before saving. This does not change grades or publish to students.")) return;
  await runTransaction(db, async transaction => {
    const roster = await transaction.get(doc(db, "analytics_rosters", targetTeacher));
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
    transaction.set(doc(db, "analytics_views", targetTeacher), {teacherEmail:targetTeacher, rows, sections, windowDays:7, eventLimit:500, publishedBy:actor.uid, publishedAt:serverTimestamp()});
  });
  field("admin-analytics-status").textContent = "Teacher summary refreshed. Only coarse student learning activity is included, never diagnostic trails or bug reports.";
}));
field("save-maintenance").addEventListener("click", () => operation("Saving maintenance policy…", async () => {
  const expectedRevision = reviewedPolicyRevision;
  if (expectedRevision === null) throw Error("Refresh monitoring to load the current maintenance policy first.");
  const cleanupEnabled = field("maintenance-cleanup").checked, summaryRefreshEnabled = field("maintenance-summary").checked;
  const reason = field("maintenance-reason").value.trim(), actor = auth.currentUser, generation = epoch;
  if (reason.length < 12 || reason.length > 600) { field("admin-analytics-status").textContent = "Explain this policy change in 12–600 characters before saving."; return; }
  if ((cleanupEnabled || summaryRefreshEnabled) && !confirm("Save this automatic-maintenance policy? Only an already approved and deployed backend can execute it. Review school privacy, cost and retention policy first. Grades and feedback are never published by maintenance.")) return;
  const savedRevision = await runTransaction(db, async transaction => {
    const ref = doc(db, "monitoring_control", "runtime"), snapshot = await transaction.get(ref);
    const before = snapshot.exists() ? snapshot.data() : null;
    if (generation !== epoch || auth.currentUser?.uid !== actor.uid) throw Error("Account changed.");
    if ((before?.revision ?? 0) !== expectedRevision) {
      reviewedPolicyRevision = null;
      throw Error("Another administrator changed the maintenance policy. Refresh monitoring and review the new settings before saving.");
    }
    const revision = expectedRevision + 1;
    const after = {cleanupEnabled, summaryRefreshEnabled, reason, revision, updatedBy:actor.uid, updatedAt:serverTimestamp()};
    transaction.set(ref, after);
    transaction.set(doc(ref, "revisions", String(revision)), {before, after, reason, actorUid:actor.uid, createdAt:serverTimestamp()});
    return revision;
  });
  if (generation !== epoch || auth.currentUser?.uid !== actor.uid) return;
  reviewedPolicyRevision = savedRevision;
  field("maintenance-reason").value = "";
  field("admin-analytics-status").textContent = "Maintenance policy saved with an immutable audit record. This does not deploy a worker; check its recorded server result after activation.";
}));
field("purge-events").addEventListener("click", () => operation("Removing expired monitoring records…", async () => {
  if (!confirm("Permanently delete up to 500 expired events and 500 expired diagnostic attachments? Academic records are not affected.")) return;
  let count=0;const actor=auth.currentUser,generation=epoch;
  try{
    for (const name of ["activity_events", "issue_diagnostics"]) {
      if(generation!==epoch||auth.currentUser?.uid!==actor.uid)return;
      const expired = await getDocs(query(collection(db, name), where("expiresAt", "<=", Timestamp.now()), limit(500)));
      if(generation!==epoch||auth.currentUser?.uid!==actor.uid)return;
      if (expired.empty) continue;
      const batch = writeBatch(db); expired.docs.forEach(record => batch.delete(record.ref)); await batch.commit(); count += expired.size;
    }
  }catch(error){if(generation===epoch)field("admin-analytics-status").textContent=count+" expired records removed before cleanup stopped: "+(error?.message||"unknown error");return;}
  try{await refresh();}catch{if(generation===epoch)field("admin-analytics-status").textContent=count+" expired records removed. Monitoring could not refresh.";return;}
  field("admin-analytics-status").textContent = count + " expired records removed. Repeat if the batch limit was reached. Automatic TTL cleanup requires separate server configuration.";
}));
onAuthStateChanged(auth, user => {
  epoch++; activeOperation=null; records = []; preferences = []; students = [];
  reviewedPolicyRevision = null;
  field("maintenance-reason").value = "";
  field("operations").querySelectorAll("button,select,input,textarea").forEach(control=>control.disabled=false);
  syncPolicyControls();
  field("raw-events").replaceChildren(); field("module-usage").replaceChildren();
  field("operations").hidden = staffRole(user) !== "admin";
  if (staffRole(user) === "admin") void operation("Loading monitoring…", async()=>{
    const generation=epoch;
    const accounts=await getDocs(collection(db,"staff_access"));
    if(generation!==epoch||auth.currentUser?.uid!==user.uid)return;
    const selector=field("roster-teacher");selector.replaceChildren();
    const emails=new Set([TEACHER_EMAIL,user.email.toLowerCase(),...accounts.docs.filter(record=>record.data().status==="active").map(record=>record.id)]);
    for(const email of emails)selector.add(new Option(email,email));
    if(!emails.has(teacherEmail))teacherEmail=emails.values().next().value;
    selector.value=teacherEmail;
    await refresh();
  });
  else field("admin-analytics-status").textContent = "Administrator access requires a verified authorized account. No monitoring records were requested.";
});

field("roster-teacher").addEventListener("change",()=>{if(activeOperation){field("roster-teacher").value=teacherEmail;return;}teacherEmail=field("roster-teacher").value;epoch++;void operation("Loading selected instructor assignment…",refresh);});
