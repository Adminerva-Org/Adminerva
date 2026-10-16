import { db, auth } from "../core/firebase-core.js";
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  signOut,
  GithubAuthProvider,
  GoogleAuthProvider,
  signInWithPopup,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

const SUPER_ADMIN_EMAIL = "babaynike2013@gmail.com".toLowerCase();
const TEACHER_EMAIL = "josephsixson@mcstayuman.edu.ph".toLowerCase();
const errBox = document.getElementById("loginErrorBox");

// ==========================================
// UI STATE MANAGERS
// ==========================================
const showError = (title, message) => {
  if (typeof window.hideSubtleLoader === "function") window.hideSubtleLoader();
  if (!errBox) return;
  errBox.innerHTML = `
    <div class="text-red-500 text-3xl mb-2">⛔</div>
    <h3 class="text-red-400 font-black text-lg uppercase tracking-wider mb-1">${title}</h3>
    <p class="text-slate-300 text-sm font-medium mb-4">${message}</p>
  `;
  errBox.classList.remove("hidden");
};

// ==========================================
// THE LOGIN ENGINE
// ==========================================
const handleOAuthLogin = async (provider, providerType) => {
  if (errBox) errBox.classList.add("hidden");

  // Utilize the global loader from adminerva-loader.js
  if (typeof window.showSubtleLoader === "function") {
    window.showSubtleLoader("Connecting to Provider...");
  }

  try {
    if (providerType === "github") {
      provider.addScope("repo");
      provider.addScope("read:user");
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
    const isEducator = email === SUPER_ADMIN_EMAIL || email === TEACHER_EMAIL;
    let targetCollection = isEducator ? "teachers" : "students";

    const q = query(
      collection(db, targetCollection),
      where("email", "==", email),
    );
    const snap = await getDocs(q);

    if (snap.empty) {
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

        const updatePromises = snap.docs.map((docSnap) =>
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
        ? email === SUPER_ADMIN_EMAIL
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
    let errorMessage = error.message.replace("Firebase:", "").trim();

    if (error.message === "no-email") {
      errorMessage =
        "Your GitHub account does not expose a public email. Please sign in with Google.";
    } else if (error.message.startsWith("unrecognized-email:")) {
      errorTitle = "Access Denied";
      const failedEmail = error.message.split(":")[1];
      errorMessage = `Your email (${failedEmail}) is not recognized. If you clicked GitHub, your personal email might not match the school records. <strong>Please click "Continue with Google" instead.</strong>`;
    } else if (error.code === "auth/popup-blocked") {
      errorMessage =
        "Your browser aggressively blocked the login window. <strong>Please check the URL bar, allow popups for teachernosxis.github.io</strong>, and try again.";
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
  }
};

// ==========================================
// EVENT LISTENERS
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
  const urlParams = new URLSearchParams(window.location.search);
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
