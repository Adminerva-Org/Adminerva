import {resolveStaffRole} from "../core/staff-session.mjs?v=2026.10.20.1";
/** Opt-in activity client; never records text, URLs, selectors, code, credentials or anonymous visitors. */
import {auth, db} from "../core/firebase-core.js";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {doc, getDocFromServer, setDoc, addDoc, collection, getDocs, query, where, serverTimestamp, Timestamp} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {pageForPath, safeStep, activeInterval, diagnosticPayload} from "./activity-model.mjs?v=2026.10.19.3";

const page = pageForPath(location.pathname);
let owner = null, profile = null, steps = [], diagnostics = false, generation = 0;
let previous = performance.now(), lastInput = previous, seconds = 0, writes = 0;
let wasVisible = !document.hidden, wasFocused = document.hasFocus();
const sessionId = crypto.randomUUID();
const listeners = new Set();
let preferencesState = {uid:null, ready:false};
function broadcast(ready, error = false) {
  preferencesState = {uid:owner?.uid || null, ready, error, enabled:profile?.enabled === true, diagnostics, promptDismissed:profile?.promptDismissed === true};
  for (const listener of listeners) listener(preferencesState);
}
export function watchPreferences(listener) {
  listeners.add(listener);
  listener(preferencesState);
  return () => listeners.delete(listener);
}
const status = () => document.getElementById("activity-status");
function notify(message) { if (status()) status().textContent = message; }
function preferenceKey(uid) { return "Adminerva_Diagnostics_" + uid; }
function tick() {
  const now = performance.now();
  seconds += activeInterval({previous, now, lastInput, visible:wasVisible && !document.hidden, focused:wasFocused && document.hasFocus()});
  previous = now;
  wasVisible = !document.hidden; wasFocused = document.hasFocus();
}
async function send(action, activeSeconds = 0) {
  if (!owner || !profile?.enabled || writes >= 120) return;
  const user = owner, epoch = generation;
  writes++;
  try {
    await addDoc(collection(db, "activity_events"), {ownerUid:user.uid, studentId:profile.studentId, sessionId, page, action, activeSeconds, createdAt:serverTimestamp(), expiresAt:Timestamp.fromMillis(Date.now() + 30 * 86400000)});
  } catch {
    if (generation === epoch) { profile.enabled = false; notify("Activity sharing paused: permissions or connection unavailable. Re-enable to retry. Your work is unaffected."); }
  }
}
export function recordAction(action) {
  const step = safeStep(page, action);
  if (!step || !owner) return;
  if (diagnostics) steps = [...steps, step].slice(-20);
  if (action !== "active-time") void send(action);
}
export function getDiagnosticSteps() { return diagnostics ? diagnosticPayload(steps) : {pages:[], actions:[]}; }
export async function savePreferences(enabled, keepDiagnostics, promptDismissed = profile?.promptDismissed === true) {
  if (!owner || !preferencesState.ready) throw Error("Load your signed-in preferences before changing them.");
  const user = owner, epoch = generation;
  let studentId = "";
  const email = (user.email || "").toLowerCase();
  if (!await resolveStaffRole(user)) {
    const matches = await getDocs(query(collection(db, "students"), where("email", "==", email)));
    if (matches.empty) throw Error("A linked student profile is required.");
    studentId = matches.docs[0].id;
  }
  if (generation !== epoch) throw Error("Account changed. Try again.");
  await setDoc(doc(db, "activity_preferences", user.uid), {ownerUid:user.uid, studentId, enabled:enabled === true, promptDismissed:promptDismissed === true, updatedAt:serverTimestamp()});
  if (generation !== epoch) return;
  profile = {studentId, enabled:enabled === true, promptDismissed:promptDismissed === true}; diagnostics = keepDiagnostics === true;
  try { localStorage.setItem(preferenceKey(user.uid), String(diagnostics)); } catch {}
  if (!diagnostics) steps = [];
  seconds = 0; previous = lastInput = performance.now(); writes = 0;
  notify("Preferences saved. Sharing is optional; stopping does not delete previously shared records. Contact your administrator for deletion.");
  if (profile.enabled) recordAction("page-open");
  broadcast(true);
}
onAuthStateChanged(auth, async user => {
  generation++; const epoch = generation;
  owner = user; profile = null; steps = []; seconds = 0; writes = 0; diagnostics = false;
  previous = lastInput = performance.now();
  broadcast(false);
  if (!user) return;
  try { diagnostics = localStorage.getItem(preferenceKey(user.uid)) === "true"; } catch {}
  try {
    const snapshot = await getDocFromServer(doc(db, "activity_preferences", user.uid));
    if (epoch !== generation) return;
    profile = snapshot.exists() ? snapshot.data() : null;
    broadcast(true);
    document.dispatchEvent(new CustomEvent("adminerva-activity-preferences", {detail:{enabled:profile?.enabled === true, diagnostics}}));
    recordAction("page-open");
  } catch { if (epoch === generation) { broadcast(false, true); notify("Activity storage is not available; sharing stays off. Your work is unaffected."); } }
});
for (const type of ["pointerdown", "keydown", "touchstart"]) document.addEventListener(type, event => { if (event.isTrusted) { tick(); lastInput = performance.now(); } }, {passive:true});
for (const type of ["focus", "blur"]) window.addEventListener(type, tick);
document.addEventListener("visibilitychange", tick);
setInterval(() => {
  tick(); const activeSeconds = Math.min(60, Math.floor(seconds)); seconds -= activeSeconds;
  if (activeSeconds > 0) void send("active-time", activeSeconds);
}, 30000);
window.addEventListener("pagehide", () => { tick(); seconds = 0; steps = []; });
window.adminervaActivity = {record:recordAction, diagnostics:getDiagnosticSteps};
const actionButtons = {runBtn:"run", xmlRender:"run", manualReviewAnalyze:"evaluate", manualReviewSave:"save", evidenceSubmit:"submit", evidenceWithdraw:"withdraw", xmlSave:"save"};
document.addEventListener("click", event => {
  const button = event.target.closest?.("button");
  if (!event.isTrusted || !button || button.disabled || !actionButtons[button.id]) return;
  recordAction(actionButtons[button.id]);
}, true);
