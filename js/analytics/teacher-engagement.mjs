import {resolveStaffRole} from "../core/staff-session.mjs?v=1.3.0";
/** Teacher-only coarse engagement snapshots; administrators select a teacher here, not in operations analytics. */
import {auth, db} from "../core/firebase-core.js?v=1.3.0";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {doc, getDocFromServer, collection, getDocs, onSnapshot} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {staffRole,staffSections} from "../core/staff-role.mjs?v=1.3.0";

const selector = document.getElementById("analytics-teacher");
let epoch = 0;
let stopView = () => {};
export async function selectedTeacherSections() {
  const current = epoch, user = auth.currentUser;
  const email = String(selector.value || "").toLowerCase();
  if (!email || !user) return [];
  const ownEmail = String(user.email || "").toLowerCase();
  if (email === ownEmail && staffRole(user) === "teacher") {
    const assigned = staffSections(user);
    if (assigned.length) return assigned;
  }
  const access = await getDocFromServer(doc(db, "staff_access", email));
  if (current !== epoch) return [];
  const assigned = Array.isArray(access.data()?.sections) ? access.data().sections : [];
  if (assigned.length || staffRole(user) !== "admin") return assigned;
  try {
    const roster = await getDocFromServer(doc(db, "analytics_rosters", email));
    if (current !== epoch) return [];
    return Array.isArray(roster.data()?.sections) ? roster.data().sections : [];
  } catch {
    return assigned;
  }
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
    const published=data.publishedAt?.toMillis?.();
    if (!Number.isFinite(published) || Date.now() - published > 30 * 86400000 || !Array.isArray(data.rows)) { status.textContent = "Snapshot expired or incomplete. Ask an administrator to refresh it. Academic records load independently."; return; }
    for (const row of data.rows) {
      const element = body.insertRow();
      for (const value of [row.studentId, row.visits, row.days, Math.round((row.activeSeconds || 0) / 60) + " min", Object.entries(row.modules || {}).map(([page, seconds]) => page + ": " + Math.round(seconds / 60) + " min").join(" · ")]) element.insertCell().textContent = String(value);
    }
    status.textContent = (data.source === "scheduled" ? "System refresh " : "Administrator snapshot ") + data.publishedAt.toDate().toLocaleString() + ". Last 7 days, capped at 500 events; opted-in students only. Active foreground time and returning days are approximate, not grades or evidence of effort. " + (data.truncated ? "Student display limit reached; this is a partial sample. " : "") + "Consent removal is processed by the optional backend handler or the next administrator refresh.";
  }, () => {
    end(); if (current !== epoch) return;
    body.replaceChildren(); status.textContent = "Learning activity is unavailable or the assignment/snapshot expired. Ask an administrator to refresh the permitted summary.";
  });
  stopView = () => { unsubscribe(); end(); };
}
selector.addEventListener("change", () => { void renderEngagement(); document.dispatchEvent(new Event("analytics-teacher-change")); });
document.getElementById("analytics-refresh")?.addEventListener("click",()=>{void renderEngagement();document.dispatchEvent(new Event("analytics-teacher-change"));});
onAuthStateChanged(auth, async user => {
  stopView();
  epoch++; selector.replaceChildren(); document.getElementById("engagement-rows").replaceChildren();
  const accountEpoch=epoch;
  const role = await resolveStaffRole(user);
  if(accountEpoch!==epoch)return;
  selector.disabled = role !== "admin";
  document.getElementById("instructor-selection")?.toggleAttribute("hidden",role!=="admin");
  if (!role) { document.dispatchEvent(new Event("analytics-teacher-change")); return; }
  try {
    if (role === "admin") {
      const current = epoch;
      const [rosters,accounts]=await Promise.all([getDocs(collection(db,"analytics_rosters")),getDocs(collection(db,"staff_access"))]);
      if (current !== epoch) return;
      const emails=new Set([...rosters.docs.map(record=>record.id),"josephsixson@mcstayuman.edu.ph",user.email.toLowerCase()]);
      if(current!==epoch)return;
      for(const account of accounts.docs)if(account.data().status==="active")emails.add(account.id);
      const names=new Map(accounts.docs.map(record=>[record.id,record.data().displayName]));
      for(const email of emails)selector.add(new Option(email===user.email.toLowerCase()?"My teaching sections":names.get(email)||email,email));
      selector.value=rosters.docs.find(record=>record.data().sections?.length)?.id||user.email.toLowerCase();
    } else selector.add(new Option(user.email.toLowerCase(), user.email.toLowerCase()));
    await renderEngagement();
    document.dispatchEvent(new Event("analytics-teacher-change"));
  } catch {
    if(accountEpoch!==epoch)return;
    if(!selector.options.length)selector.add(new Option(user.email.toLowerCase(),user.email.toLowerCase()));
    void renderEngagement();document.dispatchEvent(new Event("analytics-teacher-change"));
  }
});
