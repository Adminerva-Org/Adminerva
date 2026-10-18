/** Teacher-only coarse engagement snapshots; administrators select a teacher here, not in operations analytics. */
import {auth, db} from "../core/firebase-core.js";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {doc, getDoc, collection, getDocs, onSnapshot} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {staffRole} from "../core/staff-role.mjs?v=2026.10.19.2";

const selector = document.getElementById("analytics-teacher");
let epoch = 0;
let stopView = () => {};
export async function selectedTeacherSections() {
  const current = epoch, email = selector.value;
  const roster = await getDoc(doc(db, "analytics_rosters", email));
  if (current !== epoch) return [];
  return roster.data()?.sections || [];
}
async function renderEngagement() {
  stopView();
  const current = ++epoch, email = selector.value;
  const body = document.getElementById("engagement-rows"), status = document.getElementById("engagement-status");
  body.replaceChildren();
  if (!email) { status.textContent = "No teacher assignment yet. Ask an administrator to configure assigned sections."; return; }
  const end = window.beginLoading?.("Loading learning activity…") || (() => {});
  status.textContent = "Loading learning activity…";
  const unsubscribe = onSnapshot(doc(db, "analytics_views", email), snapshot => {
    end();
    if (current !== epoch) return;
    const data = snapshot.data(); body.replaceChildren();
    if (!data) { status.textContent = "No engagement snapshot has been prepared by an administrator. Academic analytics below remain separate."; return; }
    if (Date.now() - data.publishedAt.toMillis() > 30 * 86400000) { status.textContent = "Snapshot expired. Ask an administrator to refresh it."; return; }
    for (const row of data.rows) {
      const element = body.insertRow();
      for (const value of [row.studentId, row.visits, row.days, Math.round(row.activeSeconds / 60) + " min", Object.entries(row.modules).map(([page, seconds]) => page + ": " + Math.round(seconds / 60) + " min").join(" · ")]) element.insertCell().textContent = String(value);
    }
    status.textContent = (data.source === "scheduled" ? "System refresh " : "Administrator snapshot ") + data.publishedAt.toDate().toLocaleString() + ". Last 7 days, capped at 500 events; opted-in students only. Active foreground time and returning days are approximate, not grades or evidence of effort. " + (data.truncated ? "Student display limit reached; this is a partial sample. " : "") + "Consent removal is processed by the optional backend handler or the next administrator refresh.";
  }, () => {
    end(); if (current !== epoch) return;
    body.replaceChildren(); status.textContent = "Learning activity is unavailable or the assignment/snapshot expired. Ask an administrator to refresh the permitted summary.";
  });
  stopView = () => { unsubscribe(); end(); };
}
selector.addEventListener("change", () => { void renderEngagement(); document.dispatchEvent(new Event("analytics-teacher-change")); });
onAuthStateChanged(auth, async user => {
  stopView();
  epoch++; selector.replaceChildren(); document.getElementById("engagement-rows").replaceChildren();
  const role = staffRole(user);
  selector.disabled = role !== "admin";
  if (!role) { document.dispatchEvent(new Event("analytics-teacher-change")); return; }
  try {
    if (role === "admin") {
      const current = epoch, rosters = await getDocs(collection(db, "analytics_rosters"));
      if (current !== epoch) return;
      for (const roster of rosters.docs) selector.add(new Option(roster.id, roster.id));
    } else selector.add(new Option(user.email.toLowerCase(), user.email.toLowerCase()));
    await renderEngagement();
    document.dispatchEvent(new Event("analytics-teacher-change"));
  } catch { document.getElementById("engagement-status").textContent = "Teacher assignments are not available yet."; }
});
