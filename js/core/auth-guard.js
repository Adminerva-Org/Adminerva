import {resolveAccountAccess} from "./staff-session.mjs?v=1.1.0";
/** Verified account admission, workspace visibility and sign-out routing. */
import { auth } from "./firebase-core.js";
import {
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

const currentPath = window.location.pathname.toLowerCase();
const isLoginPage = currentPath.includes("login.html");
let admittedUid;

// 🚨 TIER 1: The Master Key (Can access system API settings)

// 🚨 TIER 2: The Instructor (Can access grading and rosters)

onAuthStateChanged(auth, async (user) => {
  if(admittedUid!==undefined&&admittedUid!==(user?.uid||null)){
    window.location.replace("login.html?error=account-changed");return;
  }
  admittedUid=user?.uid||null;
  const endLoading = window.beginLoading?.("Checking account and page access…") || (() => {});
  try {
  if (!user) {
    if (!isLoginPage) window.location.href = "login.html";
    return;
  }

  if(!user.emailVerified||!user.email){await signOut(auth);window.location.href="login.html?error=verified-email-required";return;}
  const userEmail = user.email.toLowerCase();
  let access;
  try {access=await resolveAccountAccess(user);}
  catch {await signOut(auth);window.location.href="login.html?error=server";return;}
  const admittedRole=access.role;

  // 1. Strict Whitelist Enforcement
  if (!admittedRole) {
    try {
      if (access.needsTeacherApproval || !access.students.length) {
        window.location.href = "guest-home.html";
        return; // Halt execution
      }
    } catch (error) {
      console.error("Database connection error:", error);
      await signOut(auth);
      window.location.href = "login.html?error=server";
      return;
    }
  }

  // 2. Determine absolute hardware role based strictly on the verified email
  let actualRole = "student";
  if (admittedRole === "admin") actualRole = "superadmin";
  else if (admittedRole === "teacher") actualRole = "teacher";

  let activeRole = actualRole;

  // 3. The Shape-Shifter Logic (ONLY permitted for authorized admins/teachers)
  if (actualRole === "superadmin" || actualRole === "teacher") {
    const mockRole = localStorage.getItem("Adminerva_Mock_Role");
    if ((actualRole === "superadmin" ? ["superadmin","teacher","student"] : ["teacher","student"]).includes(mockRole)) {
      activeRole = mockRole;
    }
    localStorage.setItem("Adminerva_Role", activeRole);
  } else {
    // 🔥 ANTI-HACK MEASURE: Force students back to their assigned role
    localStorage.setItem("Adminerva_Role", "student");
    localStorage.removeItem("Adminerva_Mock_Role");
    activeRole = "student";
  }
  if (/\/(teacher-accounts|admin-analytics|admin-hub|users|manage-sections|manage-programs|manage-subjects)\.html$/.test(currentPath) && admittedRole !== "admin") { window.location.href=actualRole==="student"?"student-home.html":"teacher-home.html"; return; }
  const isIssuesPage = currentPath.includes("issues.html");

  // 4. Strict Routing Enforcement
  if (
    activeRole === "student" &&
    !currentPath.includes("student-") &&
    !isLoginPage &&
    !isIssuesPage
  ) {
    window.location.href = "student-home.html";
    return;
  }
  if (activeRole !== "student" && currentPath.endsWith("/student-home.html")) {
    window.location.href = "teacher-home.html";
    return;
  }

  // Publish presentation state after admission and routing have succeeded.
  // Navigation may have rendered from a stale role cached by an earlier visit.
  const mockNotice = localStorage.getItem("Adminerva_Mock_Role")
    ? ` (Simulating: ${activeRole})` : "";
  const accountEmail = userEmail + mockNotice;
  const navigation = document.getElementById("adminerva-nav");
  if (navigation) {
    navigation.dataset.verifiedRole = activeRole;
    navigation.dataset.accountEmail = accountEmail;
  }
  document.dispatchEvent(new CustomEvent("adminerva:role-ready", {
    detail: { role: activeRole }
  }));

  // Only verified administrator accounts see management shortcuts.
  if (actualRole === "superadmin" && activeRole === "superadmin") {
    document.querySelectorAll("[data-admin-only]").forEach(el => el.classList.remove("hidden"));
  }
  // 5. Security cleared: Display the UI
  const pageBody = document.getElementById("pageBody");
  if (pageBody) pageBody.classList.remove("hidden");

  const emailDisplay = document.getElementById("userEmailDisplay");
  if (emailDisplay) emailDisplay.textContent = accountEmail;
  } finally { endLoading(); }
});

// Centralized Sign Out
document.addEventListener("click", (e) => {
  if (e.defaultPrevented) return;
  if (e.target && e.target.id === "signOutBtn") {
    e.preventDefault();
    signOut(auth).then(() => {
      localStorage.removeItem("Adminerva_Role");
      localStorage.removeItem("Adminerva_Mock_Role");
      window.location.href = "login.html";
    });
  }
});
