/** Verified account admission, workspace visibility and sign-out routing. */
import { auth, db } from "./firebase-core.js";
import {staffRole} from "./staff-role.mjs?v=2026.10.19.2";
import {
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection,
  query,
  where,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const currentPath = window.location.pathname.toLowerCase();
const isLoginPage = currentPath.includes("login.html");

// 🚨 TIER 1: The Master Key (Can access system API settings)
const SUPER_ADMIN_EMAIL = "babaynike2013@gmail.com".toLowerCase();

// 🚨 TIER 2: The Instructor (Can access grading and rosters)
const TEACHER_EMAIL = "josephsixson@mcstayuman.edu.ph".toLowerCase();

onAuthStateChanged(auth, async (user) => {
  const endLoading = window.beginLoading?.("Checking account and page access…") || (() => {});
  try {
  if (!user) {
    if (!isLoginPage) window.location.href = "login.html";
    return;
  }

  const userEmail = user.email.toLowerCase();

  // 1. Strict Whitelist Enforcement
  if (userEmail !== SUPER_ADMIN_EMAIL && userEmail !== TEACHER_EMAIL) {
    try {
      const studentQuery = query(
        collection(db, "students"),
        where("email", "==", userEmail),
      );
      const studentSnap = await getDocs(studentQuery);

      const teacherQuery = query(
        collection(db, "teachers"),
        where("email", "==", userEmail),
      );
      const teacherSnap = await getDocs(teacherQuery);

      if (studentSnap.empty && teacherSnap.empty) {
        await signOut(auth);
        window.location.href = "login.html?error=unauthorized";
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
  if (staffRole(user) === "admin") actualRole = "superadmin";
  else if (staffRole(user) === "teacher") actualRole = "teacher";

  let activeRole = actualRole;

  // 3. The Shape-Shifter Logic (ONLY permitted for authorized admins/teachers)
  if (actualRole === "superadmin" || actualRole === "teacher") {
    const mockRole = localStorage.getItem("Adminerva_Mock_Role");
    if (mockRole) {
      activeRole = mockRole;
    }
    localStorage.setItem("Adminerva_Role", activeRole);
  } else {
    // 🔥 ANTI-HACK MEASURE: Force students back to their assigned role
    localStorage.setItem("Adminerva_Role", "student");
    localStorage.removeItem("Adminerva_Mock_Role");
    activeRole = "student";
  }
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

  // Only verified administrator accounts see management shortcuts.
  if (actualRole === "superadmin" && activeRole === "superadmin") {
    document.querySelectorAll("[data-admin-only]").forEach(el => el.classList.remove("hidden"));
  }
  // 5. Security cleared: Display the UI
  const pageBody = document.getElementById("pageBody");
  if (pageBody) pageBody.classList.remove("hidden");

  const emailDisplay = document.getElementById("userEmailDisplay");
  if (emailDisplay) {
    const mockNotice = localStorage.getItem("Adminerva_Mock_Role")
      ? ` (Simulating: ${activeRole})`
      : "";
    emailDisplay.textContent = userEmail + mockNotice;
  }
  } finally { endLoading(); }
});

// Centralized Sign Out
document.addEventListener("click", (e) => {
  if (e.target && e.target.id === "signOutBtn") {
    signOut(auth).then(() => {
      localStorage.removeItem("Adminerva_Role");
      localStorage.removeItem("Adminerva_Mock_Role");
      window.location.href = "login.html";
    });
  }
});
