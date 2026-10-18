/** Student submissions, practice progress and isolated code workspaces: settings. */
import { db, auth } from "../core/firebase-core.js";
import {
  collection,
  getDocs,
  query,
  where,
  doc,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

let userProfiles = [];

// 🔒 Security Patch
function escapeHTML(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

document.addEventListener("DOMContentLoaded", () => {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      // ✨ UX FIX: Remove the white screen instantly!
      const pageBody = document.getElementById("pageBody");
      if (pageBody) pageBody.classList.remove("hidden");

      const email = user.email.toLowerCase();
      try {
        const q = query(
          collection(db, "students"),
          where("email", "==", email),
        );
        const snap = await getDocs(q);

        if (snap.empty) {
          const errorBox = document.getElementById("rosterError");
          if (errorBox) errorBox.classList.remove("hidden");
          document.getElementById("saveRepoBtn").disabled = true;
          return;
        }

        userProfiles = [];
        let globalGhUser = "";

        // 🚀 THE FIX: Find any existing GitHub username
        snap.forEach((d) => {
          const data = d.data();
          if (data.githubUsername) globalGhUser = data.githubUsername;
          userProfiles.push({ id: d.id, ...data });
        });

        // 🚀 THE FIX: Apply that username to all profiles in memory
        userProfiles.forEach((p) => {
          if (!p.githubUsername && globalGhUser)
            p.githubUsername = globalGhUser;
        });

        const selector = document.getElementById("sectionSelectorSettings");
        const container = document.getElementById("sectionContainer");

        if (userProfiles.length > 0) {
          container.classList.remove("hidden");
          selector.innerHTML = "";

          userProfiles.forEach((profile, index) => {
            selector.insertAdjacentHTML(
              "beforeend",
              `<option value="${index}">${escapeHTML(profile.section)}</option>`,
            );
          });

          loadProfileData(0);

          selector.addEventListener("change", (e) => {
            loadProfileData(e.target.value);
          });
        }
      } catch (error) {
        console.error("Error fetching student record:", error);
      }
    }
  });
});

function loadProfileData(index) {
  const profile = userProfiles[index];
  if (!profile) return;

  if (document.getElementById("githubUsername")) {
    document.getElementById("githubUsername").value =
      profile.githubUsername || "";
  }
  if (document.getElementById("repoUrl")) {
    document.getElementById("repoUrl").value = profile.repoUrl || "";
  }

  const statusBox = document.getElementById("saveStatus");
  if (statusBox) statusBox.classList.add("hidden");
  const label = document.getElementById("studentIdentitySummary");
  if (label) label.textContent = [profile.name || "Student", profile.email || "", profile.section || ""].filter(Boolean).join(" • ");
  const gender = document.getElementById("studentGender");
  if (gender) gender.value = ["Female", "Male", "Non-binary", "Self-described"].includes(profile.gender) ? profile.gender : "";
  const repoChoices = document.getElementById("studentRepoChoices");
  if (repoChoices) { repoChoices.replaceChildren(); repoChoices.classList.add("hidden"); }
}

const repoForm = document.getElementById("repoForm");
if (repoForm) {
  repoForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const user = auth.currentUser;
    if (!user) return;

    const selector = document.getElementById("sectionSelectorSettings");
    const selectedIndex = selector.value;
    const profile = userProfiles[selectedIndex];

    if (!profile) return;

    const btn = document.getElementById("saveRepoBtn");
    const statusBox = document.getElementById("saveStatus");

    btn.disabled = true;
    btn.textContent = "Saving to Database...";
    statusBox.classList.remove("hidden");
    statusBox.textContent = "Saving...";
    statusBox.className =
      "text-xs font-medium text-center text-slate-500 mt-2 block";

    try {
      const newUsername = document
        .getElementById("githubUsername")
        .value.trim();
      const newRepoUrl = document.getElementById("repoUrl").value.trim();

      // 🚀 THE FIX: Use Promise.all to save the username globally, but the repo locally
      const updatePromises = userProfiles.map((p) => {
        const payload = { githubUsername: newUsername };

        // Only update the Repo URL for the specifically selected class
        if (p.id === profile.id) {
          payload.repoUrl = newRepoUrl;
          p.repoUrl = newRepoUrl;
        }

        p.githubUsername = newUsername;
        return setDoc(doc(db, "students", p.id), payload, { merge: true });
      });

      await Promise.all(updatePromises);

      statusBox.textContent = `✅ Saved configuration for ${profile.section}!`;
      statusBox.className =
        "text-xs font-bold text-center text-emerald-500 mt-2 block";
    } catch (error) {
      statusBox.textContent = "❌ Error saving settings: " + error.message;
      statusBox.className =
        "text-xs font-bold text-center text-red-500 mt-2 block";
    } finally {
      btn.disabled = false;
      btn.textContent = "Save Configuration";
    }
  });
}
const profileForm = document.getElementById("studentProfileForm");
if (profileForm) profileForm.addEventListener("submit", async event => {
  event.preventDefault();
  const index = Number(document.getElementById("sectionSelectorSettings")?.value || 0);
  const profile = userProfiles[index];
  if (!auth.currentUser || !profile) return;
  const selected = document.getElementById("studentGender").value;
  const gender = ["Female", "Male", "Non-binary", "Self-described"].includes(selected) ? selected : "";
  const button = document.getElementById("saveStudentProfile");
  const message = document.getElementById("profileSaveStatus");
  button.disabled = true;
  try {
    await setDoc(doc(db, "students", profile.id), { gender }, { merge: true });
    profile.gender = gender;
    message.textContent = "Profile saved. This field is optional and does not affect grades.";
    message.className = "mt-2 text-xs text-emerald-700";
  } catch (error) {
    message.textContent = "Unable to save profile: " + error.message;
    message.className = "mt-2 text-xs text-rose-700";
  } finally { button.disabled = false; }
});

document.getElementById("discoverStudentRepos")?.addEventListener("click", async () => {
  const index = Number(document.getElementById("sectionSelectorSettings")?.value || 0);
  const profile = userProfiles[index];
  const button = document.getElementById("discoverStudentRepos");
  const select = document.getElementById("studentRepoChoices");
  const message = document.getElementById("studentRepoStatus");
  if (!auth.currentUser || !profile?.githubUsername) {
    message.textContent = "Connect your GitHub account from the Student Dashboard first.";
    return;
  }
  const token = typeof profile.githubToken === "string" ? profile.githubToken : "";
  button.disabled = true;
  select.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select a repository…";
  select.append(placeholder);
  try {
    const repositories = new Map();
    for (let page = 1; page <= 3; page++) {
      const route = token
        ? "https://api.github.com/user/repos?affiliation=owner,collaborator,organization_member&per_page=100&page=" + page
        : "https://api.github.com/users/" + encodeURIComponent(profile.githubUsername) + "/repos?per_page=100&page=" + page;
      const headers = { Accept: "application/vnd.github+json" };
      if (token) headers.Authorization = "Bearer " + token;
      const response = await fetch(route, { headers });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error("GitHub access expired or lacks permission. Reconnect through Student Dashboard.");
        }
        throw new Error("GitHub returned HTTP " + response.status);
      }
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error("GitHub returned an unexpected repository list.");
      for (const item of data) {
        try {
          const parsed = new URL(item.html_url);
          if (parsed.protocol !== "https:" || parsed.hostname !== "github.com" ||
              parsed.pathname.split("/").filter(Boolean).length !== 2) continue;
          repositories.set(item.full_name, item);
        } catch { /* skip malformed links */ }
      }
      if (data.length < 100) break;
    }
    const ordered = [...repositories.values()].sort((a, b) => a.full_name.localeCompare(b.full_name));
    for (const item of ordered) {
      const option = document.createElement("option");
      option.value = item.html_url;
      option.textContent = item.full_name + (item.private ? " (private)" : "");
      select.append(option);
    }
    select.classList.remove("hidden");
    message.textContent = ordered.length
      ? "Select a repository, then click Save Configuration. " +
        (token ? "Shows repositories visible to this GitHub connection." : "Only public repositories are visible; reconnect to discover collaborator access.")
      : "No repositories were returned. Check GitHub connection permissions.";
  } catch (error) {
    message.textContent = error.message;
    message.className = "text-xs text-rose-700 mt-2";
  } finally { button.disabled = false; }
});
document.getElementById("studentRepoChoices")?.addEventListener("change", event => {
  if (event.target.value) document.getElementById("repoUrl").value = event.target.value;
});

// ==========================================
// BYOK: GEMINI API KEY MANAGEMENT
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
  const keyInput = document.getElementById("geminiApiKeyInput");
  const toggleBtn = document.getElementById("toggleKeyVisibilityBtn");
  const form = document.getElementById("geminiKeyForm");
  const removeBtn = document.getElementById("removeKeyBtn");
  const statusBox = document.getElementById("apiKeyStatus");

  if (!form || !keyInput) return;

  // Load existing key from localStorage if present
  const storedKey = localStorage.getItem("Adminerva_Gemini_Key");
  if (storedKey) {
    keyInput.value = storedKey;
    removeBtn?.classList.remove("hidden");
  }

  // Toggle Visibility between Password & Plaintext
  toggleBtn?.addEventListener("click", () => {
    const isPassword = keyInput.type === "password";
    keyInput.type = isPassword ? "text" : "password";
    toggleBtn.textContent = isPassword ? "Hide" : "Show";
  });

  // Save Key to LocalStorage
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const val = keyInput.value.trim();

    if (!val) {
      statusBox.textContent = "Please enter an API key.";
      statusBox.className =
        "text-xs font-bold text-center text-amber-500 mt-2 block";
      statusBox.classList.remove("hidden");
      return;
    }

    // Basic format sanity check for Gemini Keys
    if (!val.startsWith("AIza")) {
      statusBox.textContent =
        "Warning: Valid Gemini keys typically begin with 'AIza'.";
      statusBox.className =
        "text-xs font-bold text-center text-amber-500 mt-2 block";
      statusBox.classList.remove("hidden");
    }

    localStorage.setItem("Adminerva_Gemini_Key", val);
    removeBtn?.classList.remove("hidden");

    statusBox.textContent = "✅ Gemini API Key saved locally!";
    statusBox.className =
      "text-xs font-bold text-center text-emerald-500 mt-2 block";
    statusBox.classList.remove("hidden");
    setTimeout(() => statusBox.classList.add("hidden"), 3000);
  });

  // Remove Key
  removeBtn?.addEventListener("click", () => {
    localStorage.removeItem("Adminerva_Gemini_Key");
    keyInput.value = "";
    removeBtn.classList.add("hidden");

    statusBox.textContent = "API Key removed.";
    statusBox.className =
      "text-xs font-bold text-center text-slate-500 mt-2 block";
    statusBox.classList.remove("hidden");
    setTimeout(() => statusBox.classList.add("hidden"), 3000);
  });
});
