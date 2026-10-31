import {resolveAccountAccess} from "./staff-session.mjs?v=1.3.0";
import {activateConnectionOwner,writeConnectionPreferences,clearConnectionPreferences} from "./connection-cache.mjs?v=1.3.0";
import {rememberWorkspace,roleHome} from "./session-destination.mjs?v=1.3.8";
/** Verified account admission, workspace visibility and sign-out routing. */
import { auth } from "./firebase-core.js?v=1.3.0";
import {
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

const currentPath = window.location.pathname.toLowerCase();
const isLoginPage = currentPath.includes("login.html");
let admittedUid;
let checkingAccess=false,accessGate=null,accessEpoch=0;
function replacePage(destination){
  const target=new URL(destination,location.href);
  if(target.href!==location.href)window.location.replace(target.href);
}
const guardedSignOut = async () => {
  try{clearConnectionPreferences();}catch{}
  try{const push=await import("./push-notifications.mjs?v=1.3.6");await push.departPushAccount();}
  catch(error){console.warn("Push registration cleanup skipped during sign-out:",error?.message||error);}
  return signOut(auth);
};

function showAccessRecovery(message){
  if(!accessGate){
    accessGate=document.createElement("section");accessGate.id="account-access-recovery";
    accessGate.setAttribute("role","dialog");accessGate.setAttribute("aria-modal","true");accessGate.setAttribute("aria-labelledby","access-recovery-title");
    accessGate.style.cssText="position:fixed;inset:0;z-index:10000;display:grid;place-content:center;padding:24px;background:#eef3fa;color:#17324d;font:16px/1.6 system-ui;text-align:left;";
    accessGate.innerHTML='<div style="max-width:520px;background:white;padding:32px;border:1px solid #cad7e8;border-radius:18px;box-shadow:0 14px 40px #16395812"><h1 id="access-recovery-title" style="font-size:24px;font-weight:750;margin:0 0 12px">Let’s reconnect your workspace</h1><p data-recovery-message role="status"></p><p style="font-size:14px;color:#567086">Your account stays signed in. School data remains protected while we check access.</p><div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:20px"><button type="button" data-recovery-retry style="padding:12px 18px;background:#2458bd;color:white;border:0;border-radius:8px;font-weight:700">Retry access check</button><a href="wiki.html#support" style="padding:12px;color:#2458bd">Read help</a><button type="button" data-recovery-signout style="padding:12px;background:white;border:1px solid #cad7e8;border-radius:8px">Sign out</button></div></div>';
    document.documentElement.append(accessGate);
    accessGate.querySelector("[data-recovery-retry]").onclick=()=>void checkAccess(auth.currentUser);
    accessGate.querySelector("[data-recovery-signout]").onclick=async()=>{await guardedSignOut();location.assign("login.html?switch=1");};
    accessGate.addEventListener("keydown",event=>{if(event.key!=="Tab")return;const controls=[...accessGate.querySelectorAll("button,a[href]")].filter(control=>!control.disabled),first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}});
  }
  document.body.inert=true;
  accessGate.hidden=false;accessGate.querySelector("[data-recovery-message]").textContent=message;
  accessGate.querySelector("[data-recovery-retry]").disabled=false;
  accessGate.querySelector("[data-recovery-retry]").focus();
}
function dismissAccessRecovery(){if(accessGate)accessGate.hidden=true;document.body.inert=false;}

// 🚨 TIER 1: The Master Key (Can access system API settings)

// 🚨 TIER 2: The Instructor (Can access grading and rosters)

async function checkAccess(user){
  if(checkingAccess)return;
  checkingAccess=true;
  const check=++accessEpoch;
  if(accessGate)accessGate.querySelector("[data-recovery-retry]").disabled=true;
  try{if (user?.uid) activateConnectionOwner(user.uid);else clearConnectionPreferences();}catch{}
  if(admittedUid!==undefined&&admittedUid!==(user?.uid||null)){
    window.location.replace("login.html?error=account-changed");checkingAccess=false;return;
  }
  admittedUid=user?.uid||null;
  const endLoading = window.beginLoading?.("Checking account and page access…") || (() => {});
  try {
  if (!user) {
    if (!isLoginPage) {const destination=new URL("login.html",location.href);destination.searchParams.set("returnTo",location.pathname.split("/").pop()+location.search+location.hash);window.location.replace(destination.href);}
    return;
  }

  if(!user.emailVerified||!user.email){await guardedSignOut();replacePage("login.html?error=verified-email-required");return;}
  const userEmail = user.email.toLowerCase();
  let access;
  try {access=await resolveAccountAccess(user);}
  catch {if(check===accessEpoch&&auth.currentUser?.uid===user.uid)showAccessRecovery("We couldn’t check your school access. Check your connection, then retry. If it continues, ask your school administrator to review access.");return;}
  if(check!==accessEpoch||auth.currentUser?.uid!==user.uid)return;
  const hasVerifiedV4Role=Boolean(access.platformAdmin||access.schoolAdmin||access.schoolTeacher||access.schoolStudent);
  if(access.staffLookupUnavailable&&!hasVerifiedV4Role){
    showAccessRecovery("Your school access check is temporarily unavailable. Your account remains signed in. Please retry before continuing.");return;
  }
  const admittedRole=access.role;
  if (["admin", "teacher"].includes(admittedRole) && auth.currentUser?.uid === user.uid) {
    try{writeConnectionPreferences(user.uid, access.teachers?.[0]?.data?.() || {});}catch{}
  }

  // 1. Strict Whitelist Enforcement
  if (!admittedRole && !access.platformAdmin && !access.schoolAdmin && !access.schoolStudent) {
    try {
      if (access.needsTeacherApproval || !access.students.length) {
        replacePage(roleHome("guest"));
        return; // Halt execution
      }
    } catch (error) {
      console.error("Database connection error:", error);
      showAccessRecovery("Your school access could not be confirmed. Retry the check or contact your school administrator.");
      return;
    }
  }

  // 2. Determine absolute hardware role based strictly on the verified email
  let actualRole="student";
  if(admittedRole==="admin")actualRole="superadmin";
  else if(access.platformAdmin&&!access.schoolAdmin&&!access.schoolTeacher)actualRole="platformowner";
  else if(access.schoolAdmin)actualRole="schooladmin";
  else if(admittedRole==="teacher")actualRole="teacher";

  let activeRole = actualRole;

  // 3. The Shape-Shifter Logic (ONLY permitted for authorized admins/teachers)
  if(actualRole==="superadmin"||(actualRole==="teacher"&&access.legacyRole==="teacher")){
    const mockRole=localStorage.getItem("Adminerva_Mock_Role");
    if((actualRole==="superadmin"?["superadmin","teacher","student"]:["teacher","student"]).includes(mockRole))
      activeRole=mockRole;
    localStorage.setItem("Adminerva_Role",activeRole);
  }else{
    // School administrators are a distinct role and never become platform
    // superadmin through browser state. Students likewise cannot elevate.
    localStorage.setItem("Adminerva_Role",actualRole);
    localStorage.removeItem("Adminerva_Mock_Role");
    activeRole=actualRole;
  }
  const legacyAdminPage=currentPath.match(/\/(teacher-accounts|admin-analytics|admin-hub|users|manage-sections|manage-programs|manage-subjects)\.html$/)?.[1]||null;
  if(legacyAdminPage&&admittedRole!=="admin"){
    if(access.schoolAdmin){
      const destination=legacyAdminPage==="users"?"people-access.html#people":
        ["teacher-accounts","manage-sections","manage-subjects"].includes(legacyAdminPage)?
          "people-access.html#classes":"school-admin.html";
      replacePage(destination);return;
    }
    replacePage(roleHome(actualRole));return;
  }
  if(/\/(owner-schools)\.html$/.test(currentPath)&&
     !(access.platformAdmin||admittedRole==="admin")){
    replacePage(roleHome(actualRole));return;
  }
  if(/\/(school-admin|people-access|school-analytics)\.html$/.test(currentPath)&&
     !(access.schoolAdmin||admittedRole==="admin")){
    replacePage(roleHome(actualRole));return;
  }
  if(/\/(teacher-assessment-library)\.html$/.test(currentPath)&&
     !(["teacher","admin"].includes(admittedRole))){
    replacePage(roleHome(actualRole));return;
  }
  if(/\/(school-teacher-analytics)\.html$/.test(currentPath)&&
     !(access.schoolTeacher||access.schoolAdmin||admittedRole==="admin")){
    replacePage(roleHome(actualRole));return;
  }
  if(/\/(school-practice-analytics)\.html$/.test(currentPath)&&
     !(access.schoolTeacher||access.schoolAdmin||admittedRole==="admin")){
    replacePage(roleHome(actualRole));return;
  }
  if(/\/(school-gradebook)\.html$/.test(currentPath)&&!access.schoolTeacher){
    replacePage(roleHome(actualRole));return;
  }
  if(actualRole==="schooladmin"&&!access.schoolTeacher&&
     !/\/(teacher-home|school-admin|people-access|school-analytics|reclaim-inbox|settings|issues|school-support|join-school|wiki)\.html$/.test(currentPath)){
    replacePage("school-admin.html");return;
  }
  if(actualRole==="platformowner"&&!access.schoolAdmin&&!access.schoolTeacher&&!access.schoolStudent&&
     !/\/(owner-schools|settings|issues|wiki)\.html$/.test(currentPath)){
    replacePage("owner-schools.html");return;
  }
  if(/\/(school-support)\.html$/.test(currentPath)&&
     !(access.schoolAdmin||access.schoolTeacher||access.schoolStudent)){
    replacePage(roleHome(actualRole));return;
  }
  const v4OnlyStudent=access.schoolStudent&&!access.students?.length&&!access.schoolTeacher&&!access.schoolAdmin;
  if(v4OnlyStudent&&currentPath.endsWith("/issues.html")){
    replacePage("school-support.html");return;
  }
  const v4OnlyTeacher=access.schoolTeacher&&!["teacher","admin"].includes(access.legacyRole);
  if(v4OnlyTeacher){
    const page=currentPath.split("/").pop();
    const allowed=new Set([
      "teacher-home.html","teacher-assessment-library.html","school-gradebook.html",
      "school-support.html","people-access.html","school-admin.html","school-analytics.html","school-teacher-analytics.html","school-practice-analytics.html","reclaim-inbox.html",
      "settings.html","join-school.html","wiki.html",
      ...(access.platformAdmin?["owner-schools.html"]:[])
    ]);
    if(!allowed.has(page)){
      const gradingPages=new Set([
        "gradebook.html","repofetch.html","repobank.html","grading.html","activity-grader.html",
        "group-inspector.html","contribution-inspector.html","assessment-evidence-review.html",
        "submissions.html","studio-submissions.html"
      ]);
      const destination=gradingPages.has(page)?"school-gradebook.html":
        page==="assessment-studio.html"?"teacher-assessment-library.html":
        page==="issues.html"?"school-support.html":"teacher-home.html";
      replacePage(destination);return;
    }
  }
  const isIssuesPage = currentPath.includes("issues.html");
  const isSchoolSupportPage = currentPath.includes("school-support.html");

  // 4. Strict Routing Enforcement
  if (
    activeRole === "student" &&
    !currentPath.includes("student-") &&
    !isLoginPage &&
    !isIssuesPage &&
    !isSchoolSupportPage
  ) {
    replacePage(roleHome("student"));
    return;
  }
  if (activeRole !== "student" && currentPath.endsWith("/student-home.html")) {
    replacePage(roleHome(activeRole));
    return;
  }

  // Publish presentation state after admission and routing have succeeded.
  // Navigation may have rendered from a stale role cached by an earlier visit.
  const mockNotice = localStorage.getItem("Adminerva_Mock_Role")
    ? ` (Simulating: ${activeRole})` : "";
  const accountEmail = userEmail + mockNotice;
  const navigation = document.getElementById("adminerva-nav");
  if(navigation){
    navigation.dataset.verifiedRole=activeRole;
    navigation.dataset.accountEmail=accountEmail;
    navigation.dataset.platformAdmin=String(Boolean(access.platformAdmin));
    navigation.dataset.schoolAdmin=String(Boolean(access.schoolAdmin));
    navigation.dataset.schoolTeacher=String(Boolean(access.schoolTeacher));
    navigation.dataset.schoolStudent=String(Boolean(access.schoolStudent));
    navigation.dataset.v4OnlyTeacher=String(Boolean(v4OnlyTeacher));
    navigation.dataset.legacyTeacher=String(access.legacyRole==="teacher");
  }
  document.dispatchEvent(new CustomEvent("adminerva:role-ready", {
    detail:{role:activeRole,platformAdmin:Boolean(access.platformAdmin),schoolAdmin:Boolean(access.schoolAdmin),
      schoolTeacher:Boolean(access.schoolTeacher),schoolStudent:Boolean(access.schoolStudent),
      legacyTeacher:access.legacyRole==="teacher",v4OnlyTeacher}
  }));

  // Only verified administrator accounts see management shortcuts.
  if(actualRole==="superadmin"&&activeRole==="superadmin")
    document.querySelectorAll("[data-admin-only]").forEach(el=>el.classList.remove("hidden"));
  if(access.schoolAdmin&&activeRole==="schooladmin")
    document.querySelectorAll("[data-school-admin-only]").forEach(el=>el.classList.remove("hidden"));
  // 5. Security cleared: Display the UI
  dismissAccessRecovery();rememberWorkspace(user.uid);
  const pageBody = document.getElementById("pageBody");
  if (pageBody) pageBody.classList.remove("hidden");

  const emailDisplay = document.getElementById("userEmailDisplay");
  if (emailDisplay) emailDisplay.textContent = accountEmail;
  } finally { checkingAccess=false;endLoading(); }
}
onAuthStateChanged(auth,user=>{if(checkingAccess&&admittedUid!==(user?.uid||null)){accessEpoch++;checkingAccess=false;}void checkAccess(user);});
window.addEventListener("online",()=>{if(accessGate&&!accessGate.hidden)void checkAccess(auth.currentUser);});

// Centralized Sign Out
document.addEventListener("click", (e) => {
  if (e.defaultPrevented) return;
  if (e.target && e.target.id === "signOutBtn") {
    e.preventDefault();
    guardedSignOut().then(() => {
      localStorage.removeItem("Adminerva_Role");
      localStorage.removeItem("Adminerva_Mock_Role");
      replacePage("login.html");
    });
  }
});
