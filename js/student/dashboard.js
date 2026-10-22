import {loadPublishedGrades} from "./published-grades.mjs?v=1.3.0";
/** Legacy teacher analytics import compatibility entry. */
import { db, auth } from "../core/firebase-core.js?v=1.3.0";
import { cleanGradeFeedback } from "../core/feedback-format.mjs?v=1.3.0";
import {
  collection,
  getDocs,
  doc,
  getDoc,
  setDoc,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  onAuthStateChanged,
  signOut,
  linkWithPopup,
  GithubAuthProvider,
  signInWithPopup,
  reauthenticateWithPopup,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

let userProfiles = [];
let currentChart = null;
let currentStudentProfile = null;
let cachedCommitsData = [];
let currentSectionAssessments = [];
let myPublishedGrades = {}; // ✨ Global grade dictionary

function escapeHTML(str) {
  if (!str) return "";
  return String(str).replace(
    /[&<>"']/g,
    (m) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[m],
  );
}

onAuthStateChanged(auth, async (user) => {
  if (!user) return (window.location.href = "login.html");
  document.getElementById("pageBody").classList.remove("hidden");

  const impersonateEmail = localStorage.getItem("Adminerva_Impersonate");
  const targetEmail = impersonateEmail
    ? impersonateEmail.toLowerCase()
    : user.email.toLowerCase();
  const emailDisplay = document.getElementById("userEmailDisplay");
  if (emailDisplay)
    emailDisplay.textContent =
      targetEmail + (impersonateEmail ? " (Impersonating)" : "");

  if (impersonateEmail && !document.getElementById("impersonateBanner")) {
    document.getElementById("adminerva-nav").insertAdjacentHTML(
      "afterend",
      `
      <div id="impersonateBanner" class="bg-amber-400 text-amber-900 px-6 py-2.5 font-bold text-sm flex justify-between items-center shadow-sm border-b border-amber-500 w-full relative z-[100]">
          <div class="flex items-center gap-2"><span class="text-xl">👁️</span><span><strong>IMPERSONATION MODE:</strong> Viewing workspace exactly as <u>${escapeHTML(targetEmail)}</u> experiences it.</span></div>
          <button onclick="window.exitImpersonation()" class="bg-amber-900 text-amber-50 px-4 py-1.5 rounded hover:bg-amber-950 transition shadow-sm text-xs tracking-wide">Exit & Return</button>
      </div>
    `,
    );
    window.exitImpersonation = function () {
      localStorage.removeItem("Adminerva_Impersonate");
      localStorage.removeItem("Adminerva_Mock_Role");
      window.location.href = "users.html";
    };
  }

  const timeFilterDropdown = document.getElementById("timeFilter");
  if (timeFilterDropdown) {
    timeFilterDropdown.addEventListener("change", (e) => {
      if (currentStudentProfile) {
        renderCommits(cachedCommitsData, e.target.value);
        renderChart(cachedCommitsData, e.target.value);
      }
    });
  }

  const connectGithubBtn = document.getElementById("connectGithubBtn");
  if (connectGithubBtn) {
    if (impersonateEmail) {
      connectGithubBtn.textContent = "Disabled during Impersonation";
      connectGithubBtn.disabled = true;
      connectGithubBtn.classList.add("opacity-50", "cursor-not-allowed");
    } else {
      connectGithubBtn.addEventListener("click", linkGithubAccount);
    }
  }

  try {
    const q = query(
      collection(db, "students"),
      where("email", "==", targetEmail),
    );
    const snap = await getDocs(q);

    if (snap.empty) {
      document.getElementById("repoSubtitle").innerHTML =
        "<span class='text-red-500'>Profile incomplete. Please contact your instructor.</span>";
      document.getElementById("commitListContainer").innerHTML =
        "<p class='text-sm text-red-500 font-bold'>No directory record found.</p>";
      return;
    }

    userProfiles = [];
    let masterToken = null;
    let masterUsername = null;
    snap.forEach((d) => {
      const data = d.data();
      if (data.githubToken) masterToken = data.githubToken;
      if (data.githubUsername) masterUsername = data.githubUsername;
      userProfiles.push({ docId: d.id, ...data });
    });

    userProfiles.forEach((p) => {
      if (!p.githubToken && masterToken) p.githubToken = masterToken;
      if (!p.githubUsername && masterUsername)
        p.githubUsername = masterUsername;
    });

    const selector = document.getElementById("sectionSelector");
    if (selector) {
      if (userProfiles.length > 1) {
        selector.classList.remove("hidden");
        selector.innerHTML = "";
        userProfiles.forEach((profile, index) =>
          selector.insertAdjacentHTML(
            "beforeend",
            `<option value="${index}">${escapeHTML(profile.section)}</option>`,
          ),
        );
        selector.addEventListener("change", (e) =>
          loadDashboardProfile(userProfiles[e.target.value]),
        );
      } else {
        selector.classList.add("hidden");
      }
    }
    loadDashboardProfile(userProfiles[0]);
  } catch (error) {
    console.error("Dashboard Load Error:", error);
  }
});

async function loadDashboardProfile(studentData) {
  currentStudentProfile = studentData;
  const subtitle = document.getElementById("repoSubtitle");
  const container = document.getElementById("commitListContainer");
  const overlay = document.getElementById("githubAuthOverlay");
  const gradeContainer = document.getElementById("latestGradeContainer");

  verifyStudentSetup(studentData);
  overlay.classList.add("hidden");

  if (currentChart) {
    currentChart.destroy();
    currentChart = null;
  }

  // ✨ FETCH GRADES (Filtered in JS for Index safety)
  myPublishedGrades = {};
  if (gradeContainer) {
    try {
      const gradeSnap = await loadPublishedGrades(studentData.docId);

      let publishedGrades = [];
      gradeSnap.forEach((d) => {
        if (d.data().published === true) {
          publishedGrades.push(d.data());
          myPublishedGrades[d.data().taskId] = d.data();
        }
      });
      console.log("Dashboard Published Grades:", myPublishedGrades);

      if (publishedGrades.length > 0) {
        // Safe Date Sorting (Prevents crash if gradedAt is missing)
        publishedGrades.sort((a, b) => {
          const timeA =
            a.gradedAt && typeof a.gradedAt.toDate === "function"
              ? a.gradedAt.toDate().getTime()
              : 0;
          const timeB =
            b.gradedAt && typeof b.gradedAt.toDate === "function"
              ? b.gradedAt.toDate().getTime()
              : 0;
          return timeB - timeA;
        });
        const latest = publishedGrades[0];

        let scoreColor = "text-emerald-600";
        if (latest.score < 15) scoreColor = "text-rose-600";
        if (latest.score >= 15 && latest.score < 18)
          scoreColor = "text-amber-500";

        gradeContainer.innerHTML = `
          <div class="p-4 bg-slate-50 border border-slate-200 rounded-lg flex items-start gap-4 shadow-inner">
              <div class="text-3xl font-extrabold ${scoreColor} bg-white px-3 py-2 rounded-lg shadow-sm border border-slate-100 min-w-[70px] text-center">${latest.score}</div>
              <div class="flex-1 min-w-0">
                  <h4 class="font-bold text-slate-800 text-sm mb-1 uppercase tracking-wider text-[10px]">Score Breakdown</h4>
                  <p class="text-xs text-slate-600 whitespace-pre-wrap leading-relaxed max-h-32 overflow-y-auto pr-2">${escapeHTML(cleanGradeFeedback(latest.feedback))}</p>
              </div>
          </div>
        `;
      } else {
        gradeContainer.innerHTML = `
          <div class="p-5 bg-slate-50 border border-dashed border-slate-300 rounded-lg text-center">
            <span class="text-3xl block mb-2 opacity-50">📬</span><p class="text-sm text-slate-500 font-medium">No evaluations have been published for this repository yet.</p>
          </div>
        `;
      }
    } catch (err) {
      console.error("Failed to load grades", err);
    }
  }

  // Load assessments AFTER grades so the mini-widget can attach the scores
  loadStudentAssessments(studentData.section);

  if (!studentData.repoUrl || !studentData.githubUsername) {
    if (!studentData.repoUrl && studentData.githubUsername)
      subtitle.innerHTML = `<strong class="text-amber-700">${escapeHTML(studentData.section)}:</strong> <span class='text-amber-600'>Please set your Repository URL for this section in Settings.</span>`;
    else
      subtitle.innerHTML = `<strong class="text-amber-700">${escapeHTML(studentData.section)}:</strong> <span class='text-amber-600'>Please set your Repository URL and Username in Settings.</span>`;
    container.innerHTML =
      "<p class='text-sm text-amber-600 font-bold'>Awaiting GitHub configuration...</p>";
    renderChart([], "7d");
    if (!studentData.githubToken) overlay.classList.remove("hidden");
    return;
  }

  subtitle.innerHTML = `<strong>${escapeHTML(studentData.section)}:</strong> Tracking <span class="font-mono text-xs text-slate-800">${escapeHTML(studentData.githubUsername)}</span> on <a href="${escapeHTML(studentData.repoUrl)}" target="_blank" class="text-blue-500 hover:underline font-mono text-xs">${escapeHTML(studentData.repoUrl)}</a>`;
  const defaultFilter = document.getElementById("timeFilter")?.value || "7d";
  const cacheRef = doc(db, "student_dashboard_cache", studentData.docId);

  try {
    const cacheSnap = await getDoc(cacheRef);
    if (cacheSnap.exists()) {
      cachedCommitsData = cacheSnap.data().commits || [];
      renderCommits(cachedCommitsData, defaultFilter);
      renderChart(cachedCommitsData, defaultFilter);
    }
  } catch (error) {
    console.warn("Database read bypassed. Continuing to UI load.");
  }

  if (!studentData.githubToken) {
    overlay.classList.remove("hidden");
    return;
  }
  syncGitHubData(
    studentData.repoUrl,
    studentData.githubUsername,
    studentData.githubToken,
    cacheRef,
  );
}

async function syncGitHubData(repoUrl, username, token, cacheRef) {
  try {
    const urlParts = repoUrl.replace(/\/$/, "").replace(".git", "").split("/");
    let repo = urlParts.pop();
    let owner = urlParts.pop();

    try {
      const repoInfoRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (repoInfoRes.ok) {
        const repoInfo = await repoInfoRes.json();
        const actualUrl = repoInfo.html_url + ".git";

        if (
          repoUrl.toLowerCase() !== actualUrl.toLowerCase() &&
          repoUrl.toLowerCase() !== repoInfo.html_url.toLowerCase()
        ) {
          await setDoc(
            doc(db, "students", currentStudentProfile.docId),
            { repoUrl: actualUrl },
            { merge: true },
          );
          owner = repoInfo.owner.login;
          repo = repoInfo.name;
          const subtitle = document.getElementById("repoSubtitle");
          if (subtitle)
            subtitle.innerHTML = `<strong>${escapeHTML(currentStudentProfile.section)}:</strong> Tracking <span class="font-mono text-xs text-slate-800">${escapeHTML(currentStudentProfile.githubUsername)}</span> on <a href="${escapeHTML(actualUrl)}" target="_blank" class="text-blue-500 hover:underline font-mono text-xs">${escapeHTML(actualUrl)}</a>`;
        }
      }
    } catch (autoUpdateError) {}

    let allCommits = [];
    for (let page = 1; page <= 4; page++) {
      const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/commits?author=${encodeURIComponent(username)}&per_page=100&page=${page}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
          },
        },
      );
      if (!response.ok) break;
      const commits = await response.json();
      allCommits = allCommits.concat(commits);
      if (commits.length < 100) break;
    }

    if (allCommits.length > 0) {
      cachedCommitsData = allCommits;
      await setDoc(
        cacheRef,
        { commits: allCommits, lastSynced: new Date().toISOString() },
        { merge: true },
      );
      const filter = document.getElementById("timeFilter")?.value || "7d";
      renderCommits(cachedCommitsData, filter);
      renderChart(cachedCommitsData, filter);
    }
  } catch (err) {
    console.warn("Background sync failed, using cached data.", err);
  }
}

async function linkGithubAccount() {
  const provider = new GithubAuthProvider();
  provider.addScope("repo");
  provider.addScope("read:user");
  const currentUser = auth.currentUser;
  if (!currentUser) return;

  const isAlreadyGithub = currentUser.providerData.some(
    (p) => p.providerId === "github.com",
  );
  let result;
  try {
    if (isAlreadyGithub)
      result = await reauthenticateWithPopup(currentUser, provider);
    else result = await linkWithPopup(currentUser, provider);
  } catch (error) {
    if (error.code === "auth/credential-already-in-use")
      result = await signInWithPopup(auth, provider);
    else {
      alert("GitHub Connection Failed: " + error.message);
      return;
    }
  }

  const credential = GithubAuthProvider.credentialFromResult(result);
  const token = credential?.accessToken;
  const verifiedUsername =
    result._tokenResponse?.screenName ||
    result.user?.reloadUserInfo?.screenName ||
    result.user?.reloadUserInfo?.providerUserInfo?.find(
      (p) => p.providerId === "github.com",
    )?.screenName;

  if (token && userProfiles.length > 0) {
    const updateData = { githubToken: token };
    if (verifiedUsername) updateData.githubUsername = verifiedUsername;
    const updatePromises = userProfiles.map((p) => {
      p.githubToken = token;
      if (verifiedUsername) p.githubUsername = verifiedUsername;
      return setDoc(doc(db, "students", p.docId), updateData, { merge: true });
    });
    await Promise.all(updatePromises);
    const overlay = document.getElementById("githubAuthOverlay");
    if (overlay) overlay.classList.add("hidden");
    loadDashboardProfile(currentStudentProfile);
  }
}

function renderCommits(commits, filter) {
  const container = document.getElementById("commitListContainer");
  if (!commits || commits.length === 0) {
    container.innerHTML =
      "<p class='text-sm text-slate-500 font-bold'>No commits found in this timeframe.</p>";
    return;
  }
  container.innerHTML = "";
  commits.slice(0, 7).forEach((c) => {
    const date = new Date(c.commit.author.date).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    const safeUrl = escapeHTML(c.html_url);
    const safeSha = escapeHTML(c.sha.substring(0, 7));
    const safeMsg = escapeHTML(c.commit.message);
    const safeDate = escapeHTML(date);
    container.insertAdjacentHTML(
      "beforeend",
      `
      <div class="p-3 bg-slate-50 border border-slate-100 rounded-lg hover:border-blue-200 transition group">
          <div class="flex justify-between items-start mb-1">
              <a href="${safeUrl}" target="_blank" class="text-xs font-mono bg-slate-200 text-slate-700 px-2 py-0.5 rounded group-hover:bg-blue-100 group-hover:text-blue-700 transition">${safeSha}</a>
              <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wide">${safeDate}</span>
          </div>
          <p class="text-sm font-medium text-slate-800 break-words">${safeMsg}</p>
      </div>
    `,
    );
  });
}

function renderChart(commits, filter) {
  const now = new Date();
  const labels = [];
  const dataMap = {};
  if (filter === "24h") {
    for (let i = 23; i >= 0; i--) {
      let d = new Date(now.getTime() - i * 60 * 60 * 1000);
      let label = d.toLocaleTimeString([], { hour: "numeric", hour12: true });
      let key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`;
      labels.push({ label, key });
      dataMap[key] = 0;
    }
  } else {
    let days = filter === "7d" ? 7 : filter === "30d" ? 30 : 90;
    for (let i = days - 1; i >= 0; i--) {
      let d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      let label = d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
      let key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      labels.push({ label, key });
      dataMap[key] = 0;
    }
  }
  const hasData = commits && commits.length > 0;
  if (hasData) {
    commits.forEach((c) => {
      let cd = new Date(c.commit.author.date);
      let key =
        filter === "24h"
          ? `${cd.getFullYear()}-${cd.getMonth()}-${cd.getDate()}-${cd.getHours()}`
          : `${cd.getFullYear()}-${cd.getMonth()}-${cd.getDate()}`;
      let cutoff = new Date();
      if (filter === "24h") cutoff.setHours(now.getHours() - 24);
      else if (filter === "7d") cutoff.setDate(now.getDate() - 7);
      else if (filter === "30d") cutoff.setMonth(now.getMonth() - 1);
      else if (filter === "90d") cutoff.setMonth(now.getMonth() - 3);
      if (cd >= cutoff && dataMap[key] !== undefined) dataMap[key]++;
    });
  }

  const displayLabels = labels.map((l) => l.label);
  const dataPoints = labels.map((l) => dataMap[l.key]);
  let pointRadius = filter === "90d" ? 1 : filter === "30d" ? 3 : 5;
  let pointHoverRadius = filter === "90d" ? 4 : 7;
  let maxTicks =
    filter === "24h" ? 24 : filter === "7d" ? 7 : filter === "30d" ? 15 : 12;
  let lineTension = filter === "90d" ? 0.1 : filter === "30d" ? 0.2 : 0.4;
  const ctx = document.getElementById("commitChart").getContext("2d");
  if (currentChart) currentChart.destroy();
  currentChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: displayLabels,
      datasets: [
        {
          label: "Commits",
          data: dataPoints,
          borderColor: hasData ? "#3b82f6" : "#cbd5e1",
          backgroundColor: hasData
            ? "rgba(59, 130, 246, 0.1)"
            : "rgba(203, 213, 225, 0.1)",
          borderWidth: 2,
          tension: lineTension,
          fill: true,
          pointBackgroundColor: hasData ? "#1d4ed8" : "#94a3b8",
          pointBorderColor: "#fff",
          pointBorderWidth: 2,
          pointRadius: pointRadius,
          pointHoverRadius: pointHoverRadius,
          pointHitRadius: 15,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1, precision: 0 },
          grid: { color: "#f1f5f9" },
          border: { display: false },
        },
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: { maxTicksLimit: maxTicks, autoSkip: true },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#1e293b",
          padding: 10,
          cornerRadius: 8,
          displayColors: false,
          intersect: false,
          mode: "index",
        },
      },
    },
  });
}

document.addEventListener("click", (e) => {
  if (e.target && e.target.id === "signOutBtn") {
    signOut(auth).then(() => {
      localStorage.removeItem("Adminerva_Role");
      localStorage.removeItem("Adminerva_Mock_Role");
      localStorage.removeItem("Adminerva_Impersonate");
      window.location.href = "login.html";
    });
  }
});

async function verifyStudentSetup(studentData) {
  const banner = document.getElementById("studentWarningBanner");
  const title = document.getElementById("warningTitle");
  const msg = document.getElementById("warningMessage");
  if (!banner || !studentData) return;
  const triggerWarning = (colorClass, header, message) => {
    banner.className = `mb-6 p-4 rounded-lg border shadow-sm flex items-start gap-3 ${colorClass}`;
    title.textContent = header;
    msg.innerHTML = message;
    banner.classList.remove("hidden");
  };
  if (!studentData.repoUrl && !studentData.githubUsername)
    return triggerWarning(
      "bg-amber-50 border-amber-200 text-amber-800",
      "Missing Configuration",
      "You must configure your <strong>GitHub Username</strong> and <strong>Repository URL</strong> in your Settings to track your progress.",
    );
  else if (!studentData.repoUrl)
    return triggerWarning(
      "bg-amber-50 border-amber-200 text-amber-800",
      "Missing Repository URL",
      `You must configure the <strong>Repository URL</strong> for <strong>${escapeHTML(studentData.section)}</strong> in your Settings.`,
    );
  else if (!studentData.githubUsername)
    return triggerWarning(
      "bg-amber-50 border-amber-200 text-amber-800",
      "Missing GitHub Username",
      "You must configure your <strong>GitHub Username</strong> in your Settings to track your progress.",
    );
  if (!studentData.githubToken)
    return triggerWarning(
      "bg-blue-50 border-blue-200 text-blue-800",
      "GitHub Disconnected",
      "Please connect your GitHub account via the prompt in your analytics panel to sync your data.",
    );

  try {
    let owner, repo;
    const urlParts = studentData.repoUrl
      .replace(/\/$/, "")
      .replace(".git", "")
      .split("/");
    repo = urlParts.pop();
    owner = urlParts.pop();
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/commits?per_page=100`,
      {
        headers: {
          Authorization: `Bearer ${studentData.githubToken}`,
          Accept: "application/vnd.github+json",
        },
      },
    );
    if (res.status === 401) {
      const overlay = document.getElementById("githubAuthOverlay");
      if (overlay) overlay.classList.remove("hidden");
      return triggerWarning(
        "bg-red-50 border-red-200 text-red-800",
        "Token Expired or Revoked",
        "Your GitHub session has expired. Please click <strong>Connect Account</strong> on the chart to reauthorize.",
      );
    }
    if (res.status === 404)
      return triggerWarning(
        "bg-red-50 border-red-200 text-red-800",
        "Repository Not Found",
        "We cannot reach this code. Ensure the URL is correct and the linked GitHub account has access to it.",
      );
    if (res.status === 403)
      return triggerWarning(
        "bg-slate-50 border-slate-200 text-slate-800",
        "GitHub Rate Limit Reached",
        "Too many requests. Please wait a few minutes.",
      );
    if (res.status === 409)
      return triggerWarning(
        "bg-blue-50 border-blue-200 text-blue-800",
        "Empty Repository",
        "Your repository is linked, but it is completely empty.",
      );
    if (res.ok) {
      const commits = await res.json();
      const ghUsername = (studentData.githubUsername || "")
        .toLowerCase()
        .trim();
      const stuEmail = (studentData.email || "").toLowerCase().trim();
      const stuName = (studentData.name || "").toLowerCase().trim();
      const hasCommit = commits.some((c) => {
        const login = (c.author?.login || "").toLowerCase().trim();
        const commitEmail = (c.commit?.author?.email || "")
          .toLowerCase()
          .trim();
        const commitName = (c.commit?.author?.name || "").toLowerCase().trim();
        if (ghUsername && login === ghUsername) return true;
        if (stuEmail && commitEmail === stuEmail) return true;
        if (stuName && commitName === stuName) return true;
        const nameParts = stuName.split(" ").filter((w) => w.length > 2);
        if (commitName && nameParts.length > 0) {
          const matches = nameParts.filter((part) => commitName.includes(part));
          if (
            matches.length >= 2 ||
            (nameParts.length === 1 && matches.length === 1)
          )
            return true;
        }
        return false;
      });
      if (!hasCommit && commits.length > 0)
        return triggerWarning(
          "bg-amber-50 border-amber-200 text-amber-800",
          "Identity Mismatch Detected",
          `We checked the last 100 commits, but none match your linked GitHub account (<strong>@${escapeHTML(studentData.githubUsername)}</strong>). Are you pushing code using a different local Git name?`,
        );
      banner.classList.add("hidden");
    }
  } catch (e) {
    console.error("Diagnostic check failed:", e);
  }
}

async function loadStudentAssessments(studentSection) {
  const container = document.getElementById("studentAssessmentsContainer");
  if (!container) return;

  try {
    const q = query(collection(db, "assessments"));
    const snap = await getDocs(q);
    currentSectionAssessments = [];

    snap.forEach((docSnap) => {
      const data = docSnap.data();
      let isAssignedToStudent = false;
      if (data.deployments && Array.isArray(data.deployments)) {
        if (data.deployments.some((d) => d.section === studentSection))
          isAssignedToStudent = true;
      } else if (data.targetSections && Array.isArray(data.targetSections)) {
        if (data.targetSections.includes(studentSection))
          isAssignedToStudent = true;
      }
      if (isAssignedToStudent)
        currentSectionAssessments.push({ id: docSnap.id, ...data });
    });

    if (currentSectionAssessments.length === 0) {
      container.innerHTML = `<div class="p-4 bg-slate-50 border border-dashed border-slate-300 rounded-lg text-center text-sm text-slate-500 font-medium">No active assignments for this section.</div>`;
      return;
    }

    container.innerHTML = "";
    currentSectionAssessments.slice(0, 4).forEach((data) => {
      const typeColor =
        data.type === "PETA"
          ? "bg-purple-100 text-purple-700 border-purple-200"
          : data.type === "Formative"
            ? "bg-green-100 text-green-700 border-green-200"
            : "bg-blue-100 text-blue-700 border-blue-200";

      // ✨ ADD BADGE TO MINI WIDGET
      const myGrade = myPublishedGrades[data.id];
      const badgeHtml = myGrade
        ? `<span class="text-[9px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded border border-emerald-200 ml-2">✅ ${myGrade.score}</span>`
        : "";

      const card = `
        <div class="p-3 bg-white border border-slate-200 rounded-lg hover:border-indigo-300 hover:shadow-sm transition group cursor-pointer" onclick="viewAssessmentDetails('${data.id}')">
            <div class="flex justify-between items-start mb-1">
                <h4 class="font-bold text-sm text-slate-800 line-clamp-1 pr-2 group-hover:text-indigo-600 transition flex items-center">${escapeHTML(data.title)} ${badgeHtml}</h4>
                <span class="${typeColor} text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider whitespace-nowrap">${escapeHTML(data.type)}</span>
            </div>
            <p class="text-xs text-slate-500 line-clamp-2 mt-1">${escapeHTML(data.taskContext || "No context provided.")}</p>
        </div>
      `;
      container.insertAdjacentHTML("beforeend", card);
    });
  } catch (error) {
    console.error("Failed to load assessments:", error);
    container.innerHTML = `<div class="text-sm text-red-500 p-2">Failed to load assignments. Check console.</div>`;
  }
}

window.viewAssessmentDetails = function (id) {
  const ass = currentSectionAssessments.find((a) => a.id === id);
  if (!ass) return;

  const typeColor =
    ass.type === "PETA"
      ? "bg-purple-500/20 text-purple-300 border-purple-500/30"
      : ass.type === "Formative"
        ? "bg-green-500/20 text-green-300 border-green-500/30"
        : "bg-blue-500/20 text-blue-300 border-blue-500/30";
  document.getElementById("modalAssType").className =
    `${typeColor} text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider mb-2 inline-block`;
  document.getElementById("modalAssType").textContent = ass.type;
  document.getElementById("modalAssTitle").textContent = ass.title;
  document.getElementById("modalAssPath").textContent =
    `Target File: ${ass.targetPath || "Any"}`;
  document.getElementById("modalAssContext").textContent =
    ass.taskContext || "No instructions provided.";
  document.getElementById("modalAssRubric").textContent =
    ass.evalCriteria || "No specific criteria provided.";

  // ✨ INJECT SCORE INTO MODAL
  const scoreArea = document.getElementById("modalScoreArea");
  const myGrade = myPublishedGrades[id];
  if (myGrade) {
    document.getElementById("modalScoreValue").textContent = myGrade.score;
    document.getElementById("modalScoreFeedback").textContent =
      cleanGradeFeedback(myGrade.feedback) || "No feedback provided.";
    scoreArea.classList.remove("hidden");
  } else {
    scoreArea.classList.add("hidden");
  }

  document.getElementById("assessmentModal").classList.remove("hidden");
};
