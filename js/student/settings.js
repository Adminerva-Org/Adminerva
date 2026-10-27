/** Student submissions, practice progress and isolated code workspaces: settings. */
import { db, auth } from "../core/firebase-core.js?v=1.3.0";
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
let profileOwnerUid="",profileLoadVersion=0,settingsBusy=false;
const settingsField=id=>document.getElementById(id);
function settingsNotice(message,tone="info",retry=false){
  settingsField("studentSettingsNotice").textContent=message;settingsField("rosterError").dataset.tone=tone;
  settingsField("rosterError").classList.toggle("hidden",!message);settingsField("studentSettingsRetry").classList.toggle("hidden",!retry);
}
function setSettingsBusy(value){
  settingsBusy=value;
  const enabled=!value&&!!profileOwnerUid&&profileOwnerUid===auth.currentUser?.uid&&userProfiles.length>0;
  for(const id of ["saveRepoBtn","saveStudentProfile","discoverStudentRepos","sectionSelectorSettings","studentGender","studentRepoChoices","repoUrl"])if(settingsField(id))settingsField(id).disabled=!enabled;
  settingsField("studentSettingsRetry").disabled=value;
  for(const id of ["repoForm","studentProfileForm"])settingsField(id)?.setAttribute("aria-busy",String(value));
}
function readyProfile(profile){
  if(profileOwnerUid===auth.currentUser?.uid&&profile&&profile.email?.toLowerCase()===auth.currentUser?.email?.toLowerCase())return true;
  settingsNotice("Your student profile is not ready. Retry loading it, or ask your teacher to check your school email and section in User Directory.","error",true);return false;
}

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

async function loadStudentProfiles(user=auth.currentUser){
  const version=++profileLoadVersion;
  userProfiles=[];profileOwnerUid="";setSettingsBusy(true);
  settingsField("sectionSelectorSettings").replaceChildren();settingsField("sectionContainer").classList.add("hidden");
  for(const id of ["githubUsername","repoUrl","studentGender"])settingsField(id).value="";
  settingsField("studentIdentitySummary").textContent="";
  if(!user?.email){settingsNotice("Sign in with your school account to load your student profile.","error");setSettingsBusy(false);return;}
  settingsField("pageBody")?.classList.remove("hidden");settingsNotice("Loading your student profile…");
  try{
    const snap=await getDocs(query(collection(db,"students"),where("email","==",user.email.toLowerCase())));
    if(version!==profileLoadVersion||auth.currentUser?.uid!==user.uid)return;
    if(snap.empty){settingsNotice("Your email is not linked to a student record yet. Ask your teacher to check your verified email and section in User Directory, then retry.","error",true);return;}
    snap.forEach(record=>userProfiles.push({id:record.id,...record.data()}));
    const globalGhUser=userProfiles.find(profile=>profile.githubUsername)?.githubUsername||"";
    userProfiles.forEach(profile=>{if(!profile.githubUsername&&globalGhUser)profile.githubUsername=globalGhUser;});
    profileOwnerUid=user.uid;
    const selector=settingsField("sectionSelectorSettings");
    userProfiles.forEach((profile,index)=>selector.insertAdjacentHTML("beforeend",`<option value="${index}">${escapeHTML(profile.section||"Section not assigned")}</option>`));
    settingsField("sectionContainer").classList.remove("hidden");loadProfileData(0);
    settingsNotice(userProfiles.some(profile=>!profile.section)?"Your student record has no section yet. Ask your teacher to assign your class in User Directory.":"");
  }catch{if(version===profileLoadVersion&&auth.currentUser?.uid===user.uid)settingsNotice("Your student profile could not load. Check your connection and retry. No settings have changed.","error",true);}
  finally{if(version===profileLoadVersion)setSettingsBusy(false);}
}
document.addEventListener("DOMContentLoaded",()=>{
  onAuthStateChanged(auth,user=>void loadStudentProfiles(user));
  settingsField("studentSettingsRetry").addEventListener("click",()=>void loadStudentProfiles());
  settingsField("sectionSelectorSettings").addEventListener("change",event=>loadProfileData(event.target.value));
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
    if(settingsBusy)return;

    const selector = document.getElementById("sectionSelectorSettings");
    const selectedIndex = selector.value;
    const profile = userProfiles[selectedIndex];

    if (!user||!readyProfile(profile)) return;

    const btn = document.getElementById("saveRepoBtn");
    const statusBox = document.getElementById("saveStatus");

    setSettingsBusy(true);
    const end=window.beginLoading?.("Saving repository configuration…",repoForm)||(()=>{});
    btn.textContent = "Saving configuration…";
    statusBox.classList.remove("hidden");
    statusBox.textContent = "Saving...";
    statusBox.className =
      "text-xs font-medium text-center text-slate-500 mt-2 block";

    try {
      const newUsername = document
        .getElementById("githubUsername")
        .value.trim();
      const newRepoUrl = document.getElementById("repoUrl").value.trim();
      const parsed=new URL(newRepoUrl);
      if(parsed.protocol!=="https:"||parsed.hostname!=="github.com"||parsed.username||parsed.password||parsed.search||parsed.hash||!/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(parsed.pathname))throw Error("Enter a GitHub repository URL, such as https://github.com/your-name/your-project.");

      // 🚀 THE FIX: Use Promise.all to save the username globally, but the repo locally
      const updatePromises = userProfiles.map(async(p) => {
        const payload = { githubUsername: newUsername };

        // Only update the Repo URL for the specifically selected class
        if (p.id === profile.id) {
          payload.repoUrl = newRepoUrl;
        }

        await setDoc(doc(db, "students", p.id), payload, { merge: true });
        if(auth.currentUser?.uid===user.uid&&profileOwnerUid===user.uid)Object.assign(p,payload);
      });

      await Promise.all(updatePromises);
      if(auth.currentUser?.uid!==user.uid||profileOwnerUid!==user.uid)return;

      statusBox.textContent = `✅ Saved configuration for ${profile.section}!`;
      statusBox.className =
        "text-xs font-bold text-center text-emerald-500 mt-2 block";
    } catch (error) {
      if(auth.currentUser?.uid!==user.uid)return;
      statusBox.textContent = "❌ Error saving settings: " + error.message;
      statusBox.className =
        "text-xs font-bold text-center text-red-500 mt-2 block";
    } finally {
      setSettingsBusy(false);end();
      btn.textContent = "Save Configuration";
    }
  });
}
const profileForm = document.getElementById("studentProfileForm");
if (profileForm) profileForm.addEventListener("submit", async event => {
  event.preventDefault();
  if(settingsBusy)return;
  const index = Number(document.getElementById("sectionSelectorSettings")?.value || 0);
  const profile = userProfiles[index];
  if (!readyProfile(profile)) return;
  const uid=auth.currentUser.uid;
  const selected = document.getElementById("studentGender").value;
  const gender = ["Female", "Male", "Non-binary", "Self-described"].includes(selected) ? selected : "";
  const button = document.getElementById("saveStudentProfile");
  const message = document.getElementById("profileSaveStatus");
  setSettingsBusy(true);const end=window.beginLoading?.("Saving student profile…",profileForm)||(()=>{});
  try {
    await setDoc(doc(db, "students", profile.id), { gender }, { merge: true });
    if(auth.currentUser?.uid!==uid||profileOwnerUid!==uid)return;
    profile.gender = gender;
    message.textContent = "Profile saved. This field is optional and does not affect grades.";
    message.className = "mt-2 text-xs text-emerald-700";
  } catch (error) {
    if(auth.currentUser?.uid!==uid)return;
    message.textContent = "Unable to save profile: " + error.message;
    message.className = "mt-2 text-xs text-rose-700";
  } finally { setSettingsBusy(false);end(); }
});

document.getElementById("discoverStudentRepos")?.addEventListener("click", async () => {
  if(settingsBusy)return;
  const index = Number(document.getElementById("sectionSelectorSettings")?.value || 0);
  const profile = userProfiles[index];
  const button = document.getElementById("discoverStudentRepos");
  const select = document.getElementById("studentRepoChoices");
  const message = document.getElementById("studentRepoStatus");
  if(!readyProfile(profile))return;
  const uid=auth.currentUser.uid;
  if (!profile.githubUsername) {
    message.textContent = "Connect your GitHub account from the Student Dashboard first.";
    return;
  }
  const token = typeof profile.githubToken === "string" ? profile.githubToken : "";
  setSettingsBusy(true);const end=window.beginLoading?.("Finding your GitHub repositories…")||(()=>{});
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
      if(auth.currentUser?.uid!==uid||profileOwnerUid!==uid)return;
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
    if(auth.currentUser?.uid!==uid)return;
    message.textContent = error.message;
    message.className = "text-xs text-rose-700 mt-2";
  } finally { setSettingsBusy(false);end(); }
});
document.getElementById("studentRepoChoices")?.addEventListener("change", event => {
  if (event.target.value) document.getElementById("repoUrl").value = event.target.value;
});

// ==========================================
// BYOK: GEMINI API KEY MANAGEMENT
// ==========================================
document.addEventListener("DOMContentLoaded", async () => {
  const keyInput = document.getElementById("geminiApiKeyInput");
  const toggleBtn = document.getElementById("toggleKeyVisibilityBtn");
  const form = document.getElementById("geminiKeyForm");
  const removeBtn = document.getElementById("removeKeyBtn");
  const statusBox = document.getElementById("apiKeyStatus");

  if (!form || !keyInput) return;
  await auth.authStateReady();
  const ownerUid=auth.currentUser?.uid;
  if(!ownerUid)return;
  const keyStorage="Adminerva_Gemini_Key_"+ownerUid;

  // Load only the key owned by this signed-in account.
  const storedKey = localStorage.getItem(keyStorage);
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

    if(auth.currentUser?.uid!==ownerUid){statusBox.textContent="Account changed. Reload before saving this key.";return;}
    localStorage.setItem(keyStorage, val);
    localStorage.removeItem("Adminerva_Gemini_Key");
    removeBtn?.classList.remove("hidden");

    statusBox.textContent = "✅ Gemini API Key saved locally!";
    statusBox.className =
      "text-xs font-bold text-center text-emerald-500 mt-2 block";
    statusBox.classList.remove("hidden");
    setTimeout(() => statusBox.classList.add("hidden"), 3000);
  });

  // Remove Key
  removeBtn?.addEventListener("click", () => {
    if(auth.currentUser?.uid!==ownerUid)return;
    localStorage.removeItem(keyStorage);
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
