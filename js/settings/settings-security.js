/** Scoped product configuration and staff preferences: settings security. */
import { auth, db } from "../core/firebase-core.js";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  updateDoc,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

window.initFirebase = function () {
  // Use centralized db directly
  window.db = db;

  // Trigger database pulls
  if (window.loadSectionsAndStudents) window.loadSectionsAndStudents();
  if (window.loadLessonReviewSettings) window.loadLessonReviewSettings();
};
window.db = db;

const safeSet = (id, val) => {
  if (document.getElementById(id))
    document.getElementById(id).value = val || "";
};

const safeGet = (id) =>
  document.getElementById(id) ? document.getElementById(id).value.trim() : "";

window.saveSecuritySettings = async function () {
  const fbConfigStr = safeGet("firebaseConfigInput");
  const githubToken = safeGet("adminGithubToken");
  const geminiKey = safeGet("adminGeminiKey");
  const aiModel = safeGet("adminAiModel") || "gemini-1.5-flash";
  const engineMode = safeGet("globalAiEngine") || "cloud";

  const originalBtnText = document.getElementById("saveSettingsBtn")
    ? document.getElementById("saveSettingsBtn").innerText
    : "Save";
  if (document.getElementById("saveSettingsBtn")) {
    document.getElementById("saveSettingsBtn").innerText =
      "Verifying Connections...";
  }

  try {
    // 1. FIREBASE VALIDATION
    if (fbConfigStr) {
      try {
        const fbJson = JSON.parse(fbConfigStr);
        if (!fbJson.projectId || !fbJson.apiKey) {
          throw new Error(
            "Missing required Firebase properties (projectId or apiKey).",
          );
        }
      } catch (e) {
        throw new Error("Invalid Firebase Configuration: " + e.message);
      }
    }

    // 2. GEMINI API LIVE CONNECTION TEST
    if (geminiKey) {
      const testUrl = `https://generativelanguage.googleapis.com/v1beta/models/${aiModel}:generateContent?key=${encodeURIComponent(geminiKey)}`;
      const testResponse = await fetch(testUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Connection test." }] }],
        }),
      });

      if (!testResponse.ok) {
        if (testResponse.status === 400)
          throw new Error("Gemini API Key is invalid.");
        if (testResponse.status === 404)
          throw new Error(`AI Model '${aiModel}' not found.`);
        if (testResponse.status === 503)
          console.warn(
            "Gemini is currently overloaded, but the credentials appear structurally valid.",
          );
        else
          throw new Error(`Gemini API returned status ${testResponse.status}`);
      }
    }

    // 3. SAVE TO LOCAL STORAGE (To keep other scripts working smoothly)
    localStorage.setItem("Adminerva_firebase_config", fbConfigStr);
    localStorage.setItem("Adminerva_github_token", githubToken);
    localStorage.setItem("Adminerva_gemini_token", geminiKey);
    localStorage.setItem("Adminerva_ai_model", aiModel);
    localStorage.setItem("Adminerva_engine_mode", engineMode);

    // 4. SYNC TO CLOUD (Firestore)
    const user = auth.currentUser;
    if (user) {
      const email = user.email.toLowerCase();
      const teacherQuery = query(
        collection(db, "teachers"),
        where("email", "==", email),
      );
      const snap = await getDocs(teacherQuery);

      if (!snap.empty) {
        // Profile exists, update it
        const docId = snap.docs[0].id;
        await updateDoc(doc(db, "teachers", docId), {
          githubToken: githubToken,
          geminiKey: geminiKey,
          aiModel: aiModel,
          engineMode: engineMode,
        });
      } else {
        // ✨ THE FIX: Profile doesn't exist, so we create one for this admin
        await setDoc(doc(db, "teachers",user.uid), {
          email: email,
          uid:user.uid,
          githubToken: githubToken,
          geminiKey: geminiKey,
          aiModel: aiModel,
          engineMode: engineMode,
        });
      }
    }

    alert(
      "✅ Settings Verified & Saved to the Cloud! You can now use these credentials on any device.",
    );
  } catch (error) {
    alert("❌ Save Aborted: " + error.message);
  } finally {
    if (document.getElementById("saveSettingsBtn")) {
      document.getElementById("saveSettingsBtn").innerText = originalBtnText;
    }
  }
};

window.loadSecuritySettings = async function () {
  // First, load immediately from local storage so the UI doesn't look empty
  safeSet(
    "firebaseConfigInput",
    localStorage.getItem("Adminerva_firebase_config") || "",
  );
  safeSet(
    "adminGithubToken",
    localStorage.getItem("Adminerva_github_token") || "",
  );
  safeSet(
    "adminGeminiKey",
    localStorage.getItem("Adminerva_gemini_token") || "",
  );
  safeSet(
    "adminAiModel",
    localStorage.getItem("Adminerva_ai_model") || "gemini-1.5-flash",
  );
  safeSet(
    "globalAiEngine",
    localStorage.getItem("Adminerva_engine_mode") || "cloud",
  );

  // Then, silently pull the master keys from the cloud and override local storage
  auth.onAuthStateChanged(async (user) => {
    if (user) {
      const email = user.email.toLowerCase();
      const teacherQuery = query(
        collection(db, "teachers"),
        where("email", "==", email),
      );
      const snap = await getDocs(teacherQuery);

      if (!snap.empty) {
        const cloudData = snap.docs[0].data();

        if (cloudData.githubToken) {
          localStorage.setItem("Adminerva_github_token", cloudData.githubToken);
          safeSet("adminGithubToken", cloudData.githubToken);
        }
        if (cloudData.geminiKey) {
          localStorage.setItem("Adminerva_gemini_token", cloudData.geminiKey);
          safeSet("adminGeminiKey", cloudData.geminiKey);
        }
        if (cloudData.aiModel) {
          localStorage.setItem("Adminerva_ai_model", cloudData.aiModel);
          safeSet("adminAiModel", cloudData.aiModel);
        }
        if (cloudData.engineMode) {
          localStorage.setItem("Adminerva_engine_mode", cloudData.engineMode);
          safeSet("globalAiEngine", cloudData.engineMode);
        }
      }
    }
  });
};
