import {resolveAccountAccess} from "./staff-session.mjs?v=1.1.0";
import {ensureGuestRequest} from "./admission-service.mjs?v=1.2.0";
/** Approved-account sign-in and access feedback. */
import { db, auth } from "../core/firebase-core.js";
import {
  doc,
  updateDoc,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  signOut,
  GithubAuthProvider,
  GoogleAuthProvider,
  signInWithPopup,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

const errBox = document.getElementById("loginErrorBox");
let signingIn = false;

// ==========================================
// UI STATE MANAGERS
// ==========================================
const showError = (title, message) => {
  if (typeof window.hideSubtleLoader === "function") window.hideSubtleLoader();
  if (!errBox) return;
  const heading = document.createElement("h3"), detail = document.createElement("p");
  heading.textContent = title; detail.textContent = message;
  errBox.replaceChildren(heading, detail);
  errBox.classList.remove("hidden");
  errBox.focus();
};

// ==========================================
// THE LOGIN ENGINE
// ==========================================
const handleOAuthLogin = async (provider, providerType) => {
  if (signingIn) return;
  signingIn = true;
  const buttons = ["googleLoginBtn", "githubLoginBtn"].map(id => document.getElementById(id)).filter(Boolean);
  buttons.forEach(button => button.disabled = true);
  document.getElementById("loginForm")?.setAttribute("aria-busy", "true");
  if (errBox) errBox.classList.add("hidden");

  // Utilize the global loader from adminerva-loader.js
  if (typeof window.showSubtleLoader === "function") {
    window.showSubtleLoader("Connecting to Provider...");
  }

  try {
    if (providerType === "github") {
      provider.addScope("read:user");
      provider.addScope("user:email");
    }

    // 1. INSTANT POPUP
    const result = await signInWithPopup(auth, provider);
    const email = result.user.email?.toLowerCase().trim();

    if (!email) {
      await signOut(auth);
      throw new Error("no-email");
    }

    if (typeof window.showSubtleLoader === "function") {
      window.showSubtleLoader("Verifying Identity...");
    }

    // 2. VERIFY IDENTITY against Firestore Directory
    const access=await resolveAccountAccess(result.user),role=access.role;
    const isEducator=!!role;
    let targetCollection = isEducator ? "teachers" : "students";

    if(!isEducator&&(access.needsTeacherApproval||!access.students.length)){
      await ensureGuestRequest(result.user,access.needsTeacherApproval?"teacher":"guest");
      localStorage.setItem("Adminerva_Role","guest");localStorage.removeItem("Adminerva_Mock_Role");
      window.location.href="guest-home.html";return;
    }
    let profileDocs=isEducator?access.teachers:access.students;
    if(isEducator && !profileDocs.length){
      await setDoc(doc(db,"teachers",result.user.uid),{email,name:String(result.user.displayName||email).slice(0,120),uid:result.user.uid});
      profileDocs=[{id:result.user.uid}];
    }

    if (!profileDocs.length && !isEducator) {
      await signOut(auth);
      throw new Error("unrecognized-email:" + email);
    }

    // 3. 🚀 THE FIX: DISTRIBUTE TOKEN TO ALL PROFILES
    // If they logged directly into GitHub, broadcast the fresh token to EVERY section they are enrolled in.
    if (providerType === "github") {
      const credential = GithubAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        if (typeof window.showSubtleLoader === "function") {
          window.showSubtleLoader("Syncing GitHub Credentials...");
        }

        const ghUsername =
          result._tokenResponse?.screenName ||
          result.user.reloadUserInfo?.screenName ||
          "";

        const updatePromises = profileDocs.map((docSnap) =>
          updateDoc(doc(db, targetCollection, docSnap.id), {
            githubToken: credential.accessToken,
            githubUsername: ghUsername,
          }),
        );

        await Promise.all(updatePromises);
      }
    }

    // 4. ROUTE TO DASHBOARD
    if (typeof window.showSubtleLoader === "function") {
      window.showSubtleLoader("Preparing Workspace...");
    }

    localStorage.setItem(
      "Adminerva_Role",
      isEducator
        ? role === "admin"
          ? "superadmin"
          : "teacher"
        : "student",
    );
    window.location.href = isEducator
      ? "teacher-home.html"
      : "student-home.html";
  } catch (error) {
    await signOut(auth);

    let errorTitle = "Login Failed";
    let errorMessage = String(error.message || "Please try signing in again.").replace("Firebase:", "").trim();

    if (error.message === "teacher-approval-required") {
      errorTitle="Teacher approval required";
      errorMessage="Your teacher profile exists, but staff access is not active. Ask an administrator to authorize your verified email in Teacher Accounts. A directory entry alone does not grant staff permissions.";
    } else if (error.message === "no-email") {
      errorMessage =
        "Your GitHub account does not expose a public email. Please sign in with Google.";
    } else if (error.message.startsWith("unrecognized-email:")) {
      errorTitle = "Access Denied";
      const failedEmail = error.message.split(":")[1];
      errorMessage = `Your email (${failedEmail}) is not recognized. Your GitHub email might differ from your school record. Try Continue with Google using your school email.`;
    } else if (error.code === "auth/popup-blocked") {
      errorMessage =
        "The sign-in window was blocked. Allow popups for Adminerva using the browser address bar, then try again.";
    } else if (error.code === "auth/popup-closed-by-user") {
      errorMessage =
        "The login window was closed before finishing. Please try again.";
    } else if (error.code === "auth/account-exists-with-different-credential") {
      errorMessage =
        "You already registered this account using Google. Please click 'Continue with Google'.";
    } else if (error.code === "auth/network-request-failed") {
      errorMessage =
        "Network error. Please check your internet connection and try again.";
    }

    showError(errorTitle, errorMessage);
  } finally {
    signingIn = false;
    buttons.forEach(button => button.disabled = false);
    document.getElementById("loginForm")?.removeAttribute("aria-busy");
  }
};

// ==========================================
// EVENT LISTENERS
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
  const urlParams = new URLSearchParams(window.location.search);
  if(urlParams.get("error")==="verified-email-required")showError("Verified email required","Use a Google or GitHub account with a verified email. No school access was granted.");
  if(urlParams.get("error")==="teacher-approval-required")showError("Teacher approval required","Ask an administrator to activate your verified email in Teacher Accounts. Your teacher directory profile is preserved.");
  if(urlParams.get("error")==="account-changed")showError("Account changed","Sign in with the account you want to use. Your saved work stays with its original account.");
  if(urlParams.get("error")==="server")showError("Could not check your access","Check your connection and try signing in again. If it keeps happening, contact your school administrator.");
  if (urlParams.get("error") === "unauthorized") {
    showError("Session Expired", "Please sign in again to continue.");
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  const googleBtn = document.getElementById("googleLoginBtn");
  if (googleBtn) {
    googleBtn.addEventListener("click", () =>
      handleOAuthLogin(new GoogleAuthProvider(), "google"),
    );
  }

  const githubBtn = document.getElementById("githubLoginBtn");
  if (githubBtn) {
    githubBtn.addEventListener("click", () =>
      handleOAuthLogin(new GithubAuthProvider(), "github"),
    );
  }
});
