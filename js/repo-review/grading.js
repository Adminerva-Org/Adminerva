/** Assessment authoring, repository evidence, individual review and protected grading: grading. */
import { db } from "../core/firebase-core.js";
import {
  collection,
  getDocs,
  doc,
  setDoc,
  query,
  where,
  getDoc,
  increment,
} from "../core/teaching-firestore.mjs?v=1.1.0";

// ==========================================
// GLOBAL STATE
// ==========================================
let activeTemplate = null;
let currentStudents = [];
let commitDataMap = {}; // Maps studentId -> github fetch results
let firestoreGradesMap = {}; // Maps studentId -> saved firebase grades

let activeStartDateStr = "";
let activeEndDateStr = "";

// 🔒 Security Patch: Helper to neutralize malicious HTML scripts from user input
function escapeHTML(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ==========================================
// DYNAMIC QUOTA MAPPING
// ==========================================
const modelQuotaMap = {
  "gemini-3-flash-preview": 10000,
  "gemini-3.1-pro-preview": 250,
  "gemini-3.1-pro-preview-customtools": 250,
  "gemini-3.5-flash": 10000,
  "gemini-3.6-flash": 10000,
  "gemini-3.7-flash": 10000,
  "gemini-3.8-flash": 10000,
};

function getModelQuota() {
  const model =
    localStorage.getItem("Adminerva_ai_model") || "gemini-3.7-flash";
  return modelQuotaMap[model] !== undefined ? modelQuotaMap[model] : 10000;
}

// ==========================================
// LOADER UTILS & QUOTA
// ==========================================
window.showLoader = function (msg, subMsg = "") {
  if (typeof window.showSubtleLoader === "function") {
    const combinedMsg = subMsg ? `${msg} -${subMsg}` : msg;
    window.showSubtleLoader(combinedMsg);
  }
};

window.hideLoader = function () {
  if (typeof window.hideSubtleLoader === "function") {
    window.hideSubtleLoader();
  }
};

function getQuarter(monthStr) {
  const m = parseInt(monthStr);
  if (m >= 7 && m <= 9) return "Q1";
  if ((m >= 10 && m <= 11) || m === 0) return "Q2";
  if (m >= 1 && m <= 3) return "Q3";
  return "Q4";
}

// 🔒 Security Patch: Native URL parsing to sanitize URL substrings
function getRepoId(repoUrl) {
  try {
    const parsedUrl = new URL(repoUrl);
    const parts = parsedUrl.pathname
      .replace(/\/$/, "")
      .replace(".git", "")
      .split("/");
    return `${parts[parts.length - 2]}_${parts[parts.length - 1]}`;
  } catch (e) {
    return "unknown_repo";
  }
}

function buildFeedbackHtml(gradeData, maxScore) {
  let html = `<div class="space-y-1">`;

  // Flexbox header to show Score and Token Usage side-by-side
  html += `<div class="flex justify-between items-end border-b pb-1 mb-2">`;
  html += `  <div class="font-extrabold text-lg text-gray-800">Total: ${escapeHTML(gradeData.total_score.toString())} /${escapeHTML(maxScore.toString())}</div>`;
  if (gradeData.tokensUsed) {
    html += `  <div class="text-[10px] font-bold text-gray-400 bg-gray-100 border border-gray-200 shadow-inner px-2 py-1 rounded" title="API Tokens Consumed">🪙 ${gradeData.tokensUsed.toLocaleString()} Tokens</div>`;
  }
  html += `</div>`;

  if (gradeData.breakdown) {
    gradeData.breakdown.forEach((b) => {
      // 🔒 Security Patch: Sanitize dynamically generated AI breakdown keys
      const safeCriterion = escapeHTML(b.criterion);
      const safeScore = escapeHTML(b.score.toString());
      const safeMax = escapeHTML(b.max.toString());
      html += `<div class="text-gray-700 font-semibold">${safeCriterion}: ${safeScore}/${safeMax}</div>`;
    });
  }

  // 🔒 Security Patch: Apply escapeHTML *before* injecting <br> tags so scripts are stripped but newlines function normally
  const safeFeedback = escapeHTML(
    gradeData.feedback_criteria || "None",
  ).replace(/\n/g, "<br>");
  const safeAdditional = escapeHTML(
    gradeData.additional_feedback || "None",
  ).replace(/\n/g, "<br>");
  const safeSuggestion = escapeHTML(
    gradeData.optional_suggestion || "None",
  ).replace(/\n/g, "<br>");

  html += `<div class="mt-4"><strong class="text-gray-800 uppercase text-[10px] tracking-wider">Feedback based on criteria:</strong><br><span class="text-gray-600 text-sm leading-relaxed">${safeFeedback}</span></div>`;
  html += `<div class="mt-2"><strong class="text-gray-800 uppercase text-[10px] tracking-wider">Additional feedback:</strong><br><span class="text-gray-600 text-sm leading-relaxed">${safeAdditional}</span></div>`;
  html += `<div class="mt-2"><strong class="text-gray-800 uppercase text-[10px] tracking-wider">Optional Suggestion:</strong><br><span class="text-gray-600 text-sm leading-relaxed">${safeSuggestion}</span></div>`;
  html += `</div>`;
  return html;
}

function initFirebase() {
  if (!db) {
    document.getElementById("gradingTableBody").innerHTML =
      `<tr><td colspan="6" class="py-8 text-center text-red-500 font-bold">Firebase not configured. Please check core configuration.</td></tr>`;
    return;
  }
  loadSections();
}

async function initRubric() {
  let activeId = localStorage.getItem("Adminerva_active_template_id");
  const rubricLabel = document.getElementById("activeRubricLabel");

  const setNoRubricWarning = () => {
    rubricLabel.textContent = "WARNING: No Rubric Found!";
    rubricLabel.classList.replace("text-purple-600", "text-red-600");
  };

  if (!db) return setNoRubricWarning();

  try {
    if (activeId) {
      const docSnap = await getDoc(doc(db, "templates", activeId));
      if (docSnap.exists()) {
        activeTemplate = { id: docSnap.id, ...docSnap.data() };
        // 🔒 Security Patch: Use textContent for template name rendering
        rubricLabel.textContent = activeTemplate.name;
        rubricLabel.classList.replace("text-red-600", "text-purple-600");
        return;
      }
    }

    const snap = await getDocs(collection(db, "templates"));
    if (!snap.empty) {
      const firstDoc = snap.docs[0];
      activeTemplate = { id: firstDoc.id, ...firstDoc.data() };
      localStorage.setItem("Adminerva_active_template_id", activeTemplate.id);
      rubricLabel.textContent = activeTemplate.name;
      rubricLabel.classList.replace("text-red-600", "text-purple-600");
    } else {
      setNoRubricWarning();
    }
  } catch (e) {
    console.error("Failed to fetch active rubric:", e);
    setNoRubricWarning();
  }
}

async function updateQuotaDisplay() {
  if (!db) return { requests: 0, tokens: 0 };
  const today = new Date().toISOString().split("T")[0];
  const docRef = doc(db, "system", `ai_usage_${today}`);
  const activeModel =
    localStorage.getItem("Adminerva_ai_model") || "gemini-3.7-flash";
  const safeModelKey = activeModel.replace(/\./g, "_");

  let currentRequests = 0;
  let currentTokens = 0;

  try {
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const data = snap.data();
      currentRequests = data[`${safeModelKey}_requests`] || 0;
      currentTokens = data[`${safeModelKey}_tokens`] || 0;
    } else {
      await setDoc(docRef, { date: today });
    }
  } catch (e) {
    console.error("Failed to fetch AI quota:", e);
  }

  const maxQuota = getModelQuota();
  const display = document.getElementById("aiQuotaDisplay");

  if (display) {
    const tokenDisplay =
      currentTokens >= 1000
        ? `${(currentTokens / 1000).toFixed(1)}k`
        : currentTokens;

    if (maxQuota === "Unlimited") {
      display.textContent = `${currentRequests} / Unlimited (🪙 ${tokenDisplay} tokens)`;
      display.classList.remove("text-red-600");
    } else {
      display.textContent = `${currentRequests} / ${maxQuota} (🪙 ${tokenDisplay} tokens)`;
      if (currentRequests >= maxQuota * 0.9) {
        display.classList.add("text-red-600");
      } else {
        display.classList.remove("text-red-600");
      }
    }
  }

  return { requests: currentRequests, tokens: currentTokens };
}

async function incrementAiQuota(tokensUsed = 0) {
  if (!db) return;
  const today = new Date().toISOString().split("T")[0];
  const activeModel =
    localStorage.getItem("Adminerva_ai_model") || "gemini-3.7-flash";
  const safeModelKey = activeModel.replace(/\./g, "_");
  const docRef = doc(db, "system", `ai_usage_${today}`);

  await setDoc(
    docRef,
    {
      date: today,
      [`${safeModelKey}_requests`]: increment(1),
      [`${safeModelKey}_tokens`]: increment(tokensUsed),
    },
    { merge: true },
  );

  await updateQuotaDisplay();
}

// ==========================================
// INITIALIZATION
// ==========================================
document.addEventListener("DOMContentLoaded", async () => {
  initFirebase();
  await initRubric();
  initDateSelects();
  updateQuotaDisplay();
});

function initDateSelects() {
  const currentYear = new Date().getFullYear();
  const yearSelect = document.getElementById("yearSelect");
  for (let i = currentYear - 2; i <= currentYear + 1; i++) {
    yearSelect.insertAdjacentHTML(
      "beforeend",
      `<option value="${i}" ${i === currentYear ? "selected" : ""}>${i}</option>`,
    );
  }

  const today = new Date();
  document.getElementById("monthSelect").value = today.getMonth();
  const day = today.getDate();
  document.getElementById("weekSelect").value =
    day <= 7 ? "1" : day <= 14 ? "2" : day <= 21 ? "3" : "4";
  updateDateScope();
}

window.updateDateScope = function () {
  const y = parseInt(document.getElementById("yearSelect").value);
  const m = parseInt(document.getElementById("monthSelect").value);
  const w = parseInt(document.getElementById("weekSelect").value);

  let startDay = 1,
    endDay = 7;
  if (w === 2) {
    startDay = 8;
    endDay = 14;
  }
  if (w === 3) {
    startDay = 15;
    endDay = 21;
  }
  if (w === 4) {
    startDay = 22;
    endDay = new Date(y, m + 1, 0).getDate();
  }

  const sDate = new Date(y, m, startDay, 0, 0, 0);
  const eDate = new Date(y, m, endDay, 23, 59, 59);

  activeStartDateStr = sDate.toISOString();
  activeEndDateStr = eDate.toISOString();

  const opts = { month: "short", day: "numeric", year: "numeric" };
  document.getElementById("dateScopeDisplay").textContent =
    `${sDate.toLocaleDateString("en-US", opts)} - ${new Date(y, m, endDay).toLocaleDateString("en-US", opts)}`;

  document.getElementById("gradingTableBody").innerHTML =
    `<tr><td colspan="6" class="py-8 text-center text-gray-400 italic">Date changed. Please fetch commits again.</td></tr>`;
  const pubBtn = document.getElementById("publishAllBtn");
  pubBtn.classList.add(
    "opacity-50",
    "cursor-not-allowed",
    "pointer-events-none",
  );
  pubBtn.classList.remove("hover:bg-green-700");
};

async function loadSections() {
  if (!db) return;
  try {
    const snap = await getDocs(collection(db, "students"));
    const select = document.getElementById("sectionSelect");
    select.innerHTML = "";

    let uniqueSections = new Set();
    snap.forEach((d) => {
      const sectionName = d.data().section;
      if (sectionName) uniqueSections.add(sectionName);
    });

    [...uniqueSections].sort().forEach((sec) => {
      select.insertAdjacentHTML(
        "beforeend",
        // 🔒 Security Patch: Neutralize dynamically rendered sections
        `<option value="${escapeHTML(sec)}">${escapeHTML(sec)}</option>`,
      );
    });

    if (
      typeof window.loadDashboardData === "function" &&
      uniqueSections.size > 0
    ) {
      window.loadDashboardData();
    }
  } catch (e) {
    console.error("Failed to load sections", e);
  }
}

// ==========================================
// FETCHING DATA (GITHUB + FIRESTORE)
// ==========================================
window.fetchSectionCommits = async function () {
  const ghToken = localStorage.getItem("Adminerva_github_token");
  if (!ghToken) return alert("Missing GitHub PAT. Configure it in Admin Hub.");
  if (!db) return alert("Firebase not connected.");

  const section = document.getElementById("sectionSelect").value;
  if (!section) return alert("Please select a section.");

  const year = parseInt(document.getElementById("yearSelect").value);
  const month = parseInt(document.getElementById("monthSelect").value);
  const week = parseInt(document.getElementById("weekSelect").value);

  window.showLoader(`Fetching students in ${section}...`);

  try {
    const qStudents = query(
      collection(db, "students"),
      where("section", "==", section),
    );
    const stuSnap = await getDocs(qStudents);
    currentStudents = [];
    stuSnap.forEach((d) => currentStudents.push({ id: d.id, ...d.data() }));

    if (currentStudents.length === 0) {
      document.getElementById("gradingTableBody").innerHTML =
        `<tr><td colspan="6" class="py-8 text-center text-gray-500">No students found in this section.</td></tr>`;
      return window.hideLoader();
    }

    window.showLoader("Syncing historical grades from Firebase...");
    firestoreGradesMap = {};
    const qGrades = query(
      collection(db, "grades"),
      where("section", "==", section),
      where("year", "==", year),
      where("month", "==", month),
      where("week", "==", week),
    );
    const gradeSnap = await getDocs(qGrades);
    gradeSnap.forEach((d) => {
      const g = d.data();
      firestoreGradesMap[g.studentId] = { docId: d.id, ...g };
    });

    commitDataMap = {};
    let processed = 0;

    for (let student of currentStudents) {
      processed++;
      window.showLoader(
        `Fetching GitHub Data...\n`,
        `Checking repos: ${processed} of${currentStudents.length}`,
      );

      commitDataMap[student.id] = {
        count: 0,
        additions: 0,
        deletions: 0,
        latestMsg: "No commits",
        patches: "",
        commitSha: null,
        error: null,
      };

      if (!student.repoUrl) {
        commitDataMap[student.id].error = "Missing Repo URL";
        continue;
      }

      try {
        // 🔒 Security Patch: Strict URL validation prior to fetching
        let owner, repo;
        try {
          const parsedUrl = new URL(student.repoUrl);
          const urlParts = parsedUrl.pathname
            .replace(/\/$/, "")
            .replace(".git", "")
            .split("/");
          repo = urlParts.pop();
          owner = urlParts.pop();
        } catch (e) {
          commitDataMap[student.id].error = "Invalid Repo URL";
          commitDataMap[student.id].latestMsg = "Check URL formatting.";
          continue;
        }

        const response = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/commits?since=${activeStartDateStr}&until=${activeEndDateStr}`,
          {
            headers: {
              Authorization: `Bearer ${ghToken}`,
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
            },
          },
        );

        if (!response.ok) {
          if (response.status === 409) {
            commitDataMap[student.id].error = "Empty Repo";
            commitDataMap[student.id].latestMsg =
              "Student hasn't pushed any code yet.";
          } else if (response.status === 404) {
            commitDataMap[student.id].error = "Not Found / Private";
            commitDataMap[student.id].latestMsg =
              "Check URL or invite teacher as collaborator.";
          } else if (response.status === 403) {
            commitDataMap[student.id].error = "API Blocked";
            commitDataMap[student.id].latestMsg =
              "GitHub rate limit exceeded or bad token.";
          } else if (response.status === 401) {
            commitDataMap[student.id].error = "Bad Token";
            commitDataMap[student.id].latestMsg =
              "Your GitHub PAT is invalid or expired.";
          } else {
            commitDataMap[student.id].error = `Error ${response.status}`;
            commitDataMap[student.id].latestMsg = "Unexpected API failure.";
          }
          continue;
        }

        let commits = await response.json();

        if (Array.isArray(commits)) {
          const ghUsername = (student.githubUsername || "")
            .toLowerCase()
            .trim();
          const stuEmail = (student.email || "").toLowerCase().trim();
          const stuName = (student.name || "").toLowerCase().trim();

          commits = commits.filter((c) => {
            const login = (c.author?.login || "").toLowerCase();
            const commitEmail = (c.commit?.author?.email || "").toLowerCase();
            const commitName = (c.commit?.author?.name || "").toLowerCase();

            if (ghUsername && login === ghUsername) return true;
            if (stuEmail && commitEmail === stuEmail) return true;
            if (stuName && commitName === stuName) return true;
            return false;
          });

          commitDataMap[student.id].count = commits.length;

          if (commits.length > 0) {
            commitDataMap[student.id].commitSha = commits[0]?.sha || null;
            commitDataMap[student.id].latestMsg =
              commits[0]?.commit?.message || "No commit message";
            commitDataMap[student.id].allMsgs = commits.map(
              (c) => c?.commit?.message || "No commit message",
            );

            const limit = Math.min(commits.length, 10);
            for (let i = 0; i < limit; i++) {
              const detailRes = await fetch(
                `https://api.github.com/repos/${owner}/${repo}/commits/${commits[i].sha}`,
                { headers: { Authorization: `Bearer ${ghToken}` } },
              );
              if (detailRes.ok) {
                const detail = await detailRes.json();
                if (detail.stats) {
                  commitDataMap[student.id].additions += detail.stats.additions;
                  commitDataMap[student.id].deletions += detail.stats.deletions;
                }

                commitDataMap[student.id].patches +=
                  `\n\n### COMMIT MESSAGE: "${commits[i]?.commit?.message || "No message"}"\n`;

                if (detail.files) {
                  detail.files.forEach((file) => {
                    if (
                      file.patch &&
                      !file.filename.match(/\.(png|jpg|exe|zip|svg|lock)$/i)
                    ) {
                      commitDataMap[student.id].patches +=
                        `--- ${file.filename} ---\n${file.patch}\n`;
                    }
                  });
                }
              }
            }
          }
        } else {
          commitDataMap[student.id].error = "API Error";
          commitDataMap[student.id].latestMsg =
            "GitHub returned invalid data format.";
        }
      } catch (err) {
        commitDataMap[student.id].error = "Network Error";
        commitDataMap[student.id].latestMsg = "Failed to reach GitHub API.";
      }
    }

    renderGradingTable();
    const pubBtn = document.getElementById("publishAllBtn");
    pubBtn.classList.remove(
      "opacity-50",
      "cursor-not-allowed",
      "pointer-events-none",
    );
    pubBtn.classList.add("hover:bg-green-700");
  } catch (e) {
    console.error(e);
    alert("Critical Error: " + e.message);
  } finally {
    window.hideLoader();
  }
};

function renderGradingTable() {
  const tbody = document.getElementById("gradingTableBody");
  tbody.innerHTML = "";

  currentStudents.forEach((student) => {
    const ghData = commitDataMap[student.id];
    const dbGrade = firestoreGradesMap[student.id];

    let feedbackHtml = `<span class="text-gray-400 italic">Not graded</span>`;
    let gradeBtnTxt = "Grade via AI";
    let publishBtnHtml = "";

    // 🔒 Security Patch: Sanitize all values before constructing innerHTML templates
    const safeStudentId = escapeHTML(student.id);
    const safeName = escapeHTML(student.name);
    const safeGithubUsername = escapeHTML(student.githubUsername);
    const safeLatestMsg = escapeHTML(ghData.latestMsg);
    const safeError = escapeHTML(ghData.error || "");

    let actionBtns =
      ghData.count > 0
        ? `<div class="flex flex-col gap-1.5 w-full">
            <button onclick="openDetails('${safeStudentId}')" class="bg-gray-100 text-gray-700 border border-gray-300 font-semibold px-2 py-1 rounded text-[10px] hover:bg-gray-200 transition shadow-sm text-left">📄 View Code</button>
            <button onclick="gradeCode('${safeStudentId}')" class="bg-purple-100 text-purple-700 border border-purple-300 font-semibold px-2 py-1 rounded text-[10px] hover:bg-purple-600 hover:text-white transition shadow-sm text-left">🤖 ${gradeBtnTxt}</button>${dbGrade ? `<button onclick="openEditModal('${safeStudentId}')" class="bg-amber-100 text-amber-700 border border-amber-300 font-semibold px-2 py-1 rounded text-[10px] hover:bg-amber-600 hover:text-white transition shadow-sm text-left w-full">✏️ Manual Edit</button>` : ""}
           </div>`
        : `<span class="text-[10px] text-gray-400 font-bold block text-center">No Data</span>`;

    if (dbGrade) {
      feedbackHtml = `
          <div class="mb-1 flex items-center gap-2">
              <strong class="text-purple-700 text-sm">Score: ${escapeHTML(dbGrade.score.toString())}/${escapeHTML(dbGrade.maxScore.toString())}</strong>
          </div>
          <button onclick="openFeedbackModal('${safeStudentId}')" class="text-blue-600 hover:text-blue-800 text-[11px] font-semibold flex items-center gap-1 mt-1 transition">
              💬 Read Full Feedback
          </button>
      `;

      if (dbGrade.publishedToGithub) {
        publishBtnHtml = `<span class="bg-green-100 text-green-700 border border-green-300 font-bold px-2 py-1 rounded text-[10px] block text-center mt-2 shadow-sm">✅ Published</span>`;
      } else if (dbGrade.commitSha) {
        publishBtnHtml = `<button onclick="publishSingle('${safeStudentId}')" class="w-full bg-blue-100 text-blue-700 border border-blue-300 font-semibold px-2 py-1 rounded text-[10px] hover:bg-blue-600 hover:text-white transition shadow-sm mt-2">🚀 Publish</button>`;
      }
    }

    let commitDisplay = ghData.error
      ? `<span class="text-red-500 text-[10px] font-bold leading-tight block">${safeError}</span>`
      : `<span class="${ghData.count === 0 ? "text-red-500" : "text-green-600"} font-bold text-sm">${ghData.count}</span>`;

    const tr = `
        <tr class="border-b hover:bg-gray-50">
            <td class="py-2 px-2 align-top">
                <div class="font-bold text-gray-800 text-xs">${safeName}</div>
                <div class="text-[10px] text-gray-500 truncate w-32" title="${safeGithubUsername}">${safeGithubUsername}</div>
            </td>
            <td class="py-2 px-2 text-center align-top">${commitDisplay}</td>
            <td class="py-2 px-2 text-center align-top text-[10px] font-mono whitespace-nowrap"><span class="text-green-600">+${ghData.additions}</span><br><span class="text-red-500">-${ghData.deletions}</span></td>
            <td class="py-2 px-2 text-[10px] text-gray-600 align-top">
                <div class="max-h-16 overflow-y-auto leading-snug">${safeLatestMsg}</div>
            </td>
            <td class="py-2 px-2 align-top" id="fb-${safeStudentId}">${feedbackHtml}</td>
            <td class="py-2 px-2 align-top">
                ${actionBtns}
                <div id="pub-${safeStudentId}">${publishBtnHtml}</div>
            </td>
        </tr>
    `;
    tbody.insertAdjacentHTML("beforeend", tr);
  });
}

// ==========================================
// MODALS
// ==========================================
window.openFeedbackModal = function (studentId) {
  const gradeRec = firestoreGradesMap[studentId];
  const student = currentStudents.find((s) => s.id === studentId);

  if (!gradeRec || !student) return;

  // 🔒 Security Patch: Render via textContent
  document.getElementById("aiStudentName").textContent =
    `Past feedback for: ${student.name}`;
  document.getElementById("aiScore").textContent = gradeRec.score;
  document.getElementById("aiScoreMax").textContent = `/${gradeRec.maxScore}`;

  // The feedback components are already sanitized during buildFeedbackHtml execution
  document.getElementById("aiFeedback").innerHTML = gradeRec.feedback;

  document.getElementById("aiModal").classList.remove("hidden");
};

window.openDetails = function (studentId) {
  const student = currentStudents.find((s) => s.id === studentId);
  const data = commitDataMap[studentId];
  if (!student || !data) return;

  document.getElementById("detailsTitle").textContent =
    `${student.name}'s Code`;
  document.getElementById("detCommits").textContent = data.count;
  document.getElementById("detAdded").textContent = "+" + data.additions;
  document.getElementById("detDeleted").textContent = "-" + data.deletions;

  // 🔒 Security Patch: Convert list to textContent node injection to kill XSS vectors inside commit messages
  const commitList = document.getElementById("detCommitList");
  commitList.innerHTML = "";
  if (data.allMsgs) {
    data.allMsgs.forEach((msg) => {
      const li = document.createElement("li");
      li.textContent = msg;
      commitList.appendChild(li);
    });
  }

  document.getElementById("detCodeBlock").textContent =
    data.patches || "No readable code changes recorded.";

  document.getElementById("detailsModal").classList.remove("hidden");
};
window.closeDetailsModal = function () {
  document.getElementById("detailsModal").classList.add("hidden");
};
window.closeAiModal = function () {
  document.getElementById("aiModal").classList.add("hidden");
};
window.openEditModal = function (studentId) {
  const gradeRec = firestoreGradesMap[studentId];
  if (!gradeRec || !gradeRec.rawAiData)
    return alert(
      "Cannot manually edit older grades. Please click 'Regrade via AI' first to convert to the new format.",
    );

  const ai = gradeRec.rawAiData;

  document.getElementById("editStudentId").value = studentId;
  document.getElementById("editMaxScore").value = gradeRec.maxScore;
  document.getElementById("editTotalScoreDisplay").textContent = ai.total_score;
  document.getElementById("editMaxScoreDisplay").textContent =
    gradeRec.maxScore;

  const container = document.getElementById("editCriteriaContainer");
  container.innerHTML = "";

  if (ai.breakdown) {
    ai.breakdown.forEach((b, index) => {
      // 🔒 Security Patch: Sanitize generated breakdown parameters
      const safeCriterion = escapeHTML(b.criterion);
      const safeScore = escapeHTML(b.score.toString());
      const safeMax = escapeHTML(b.max.toString());

      container.insertAdjacentHTML(
        "beforeend",
        `
            <div class="flex items-center justify-between bg-white p-2 border rounded shadow-sm">
                <label class="text-xs font-bold text-gray-700 w-2/3 truncate pr-2" title="${safeCriterion}">${safeCriterion}</label>
                <div class="flex items-center gap-1 w-1/3 justify-end">
                    <input type="number" id="editCrit_${index}" value="${safeScore}" max="${safeMax}" min="0" onchange="recalculateTotal()" class="w-16 p-1 border rounded text-center font-bold text-purple-700 focus:ring-purple-500">
                    <span class="text-xs text-gray-500 font-bold">/ ${safeMax}</span>
                    <input type="hidden" id="editCritName_${index}" value="${safeCriterion}">
                    <input type="hidden" id="editCritMax_${index}" value="${safeMax}">
                </div>
            </div>
        `,
      );
    });
  }

  document.getElementById("editFeedbackCriteria").value =
    ai.feedback_criteria || "";
  document.getElementById("editAdditionalFeedback").value =
    ai.additional_feedback || "";
  document.getElementById("editOptionalSuggestion").value =
    ai.optional_suggestion || "";

  document.getElementById("editGradeModal").classList.remove("hidden");
};

window.recalculateTotal = function () {
  let total = 0;
  const inputs = document.querySelectorAll('[id^="editCrit_"]');
  inputs.forEach((input) => {
    total += parseInt(input.value) || 0;
  });
  document.getElementById("editTotalScoreDisplay").textContent = total;
};

window.closeEditModal = function () {
  document.getElementById("editGradeModal").classList.add("hidden");
};

window.saveEditedGrade = async function () {
  const studentId = document.getElementById("editStudentId").value;
  const maxScore = parseInt(document.getElementById("editMaxScore").value);
  const gradeRec = firestoreGradesMap[studentId];
  if (!gradeRec) return;

  let newTotal = 0;
  let newBreakdown = [];
  const inputs = document.querySelectorAll('[id^="editCrit_"]');
  inputs.forEach((input, index) => {
    const score = parseInt(input.value) || 0;
    const criterion = document.getElementById(`editCritName_${index}`).value;
    const max = parseInt(document.getElementById(`editCritMax_${index}`).value);
    newTotal += score;
    newBreakdown.push({ criterion, score, max });
  });

  const newRawAiData = {
    total_score: newTotal,
    breakdown: newBreakdown,
    feedback_criteria: document
      .getElementById("editFeedbackCriteria")
      .value.trim(),
    additional_feedback: document
      .getElementById("editAdditionalFeedback")
      .value.trim(),
    optional_suggestion: document
      .getElementById("editOptionalSuggestion")
      .value.trim(),
  };

  const newFormattedFeedback = buildFeedbackHtml(newRawAiData, maxScore);

  window.showLoader("Saving Manual Override...");
  try {
    const updatedData = {
      score: newTotal,
      feedback: newFormattedFeedback,
      rawAiData: newRawAiData,
    };

    await setDoc(doc(db, "grades", gradeRec.docId), updatedData, {
      merge: true,
    });

    firestoreGradesMap[studentId].score = newTotal;
    firestoreGradesMap[studentId].feedback = newFormattedFeedback;
    firestoreGradesMap[studentId].rawAiData = newRawAiData;

    closeEditModal();
    renderGradingTable();
  } catch (e) {
    alert("Error saving manual edit: " + e.message);
  } finally {
    window.hideLoader();
  }
};

// ==========================================
// STRICT AI GRADING & REPOBANK MEMORY
// ==========================================
window.gradeCode = async function (studentId) {
  const gemKey = localStorage.getItem("Adminerva_gemini_token");
  const model =
    localStorage.getItem("Adminerva_ai_model") || "gemini-1.5-flash";
  if (!gemKey) return alert("Missing Gemini API Key.");

  const student = currentStudents.find((s) => s.id === studentId);
  const data = commitDataMap[studentId];

  if (!data.patches || data.patches.trim() === "") {
    return alert(
      "No code patches available to grade. Student may have only committed non-code files.",
    );
  }
  if (!activeTemplate) return alert("No active rubric equipped.");

  if (firestoreGradesMap[studentId]) {
    if (
      !confirm(
        `An existing grade was found for ${student.name}. Regrading will overwrite the current score and consume your daily AI quota. Proceed?`,
      )
    ) {
      return;
    }
  }

  // --- REPOBANK STATE FETCH ---
  const repoId = getRepoId(student.repoUrl);
  let repobankState = null;
  try {
    const repoSnap = await getDoc(doc(db, "repobank", repoId));
    if (repoSnap.exists()) {
      repobankState = repoSnap.data();
    }
  } catch (e) {
    console.warn("Could not fetch repobank state", e);
  }

  const repobankContext = repobankState
    ? `CURRENT REPOBANK STATE (JSON):\n${JSON.stringify(repobankState, null, 2)}`
    : `CURRENT REPOBANK STATE: None (This is the first time analyzing this repo).`;
  // -----------------------------

  const isPct = activeTemplate.scoringType === "percentage";
  const criteriaText = activeTemplate.criteria
    .map(
      (c) =>
        `- ${c.name} (${c.weight}${isPct ? "\%" : " pts"}): ${c.description}`,
    )
    .join("\n");
  const maxScore = isPct
    ? 100
    : activeTemplate.criteria.reduce(
        (sum, c) => sum + Number(c.weight || 0),
        0,
      );

  const prompt = `
[START OF RUBRIC PERSONA]
${activeTemplate.generalPrompt}
[END OF RUBRIC PERSONA]

CRITICAL SYSTEM INSTRUCTIONS:
1. DO NOT use conversational filler. Be blunt and direct.
2. Evaluate the code against the provided criteria and assign a specific score for each.
3. CODE QUOTATION RULE: If you quote the student's code, you MUST use backticks (\`) or single quotes ('). You are STRICTLY FORBIDDEN from using double quotes (").
4. DO NOT REPEAT THE STUDENT'S CODE. Limit your feedback to concise, actionable sentences.
5. FORMATTING: You MUST format the 'feedback_criteria' field as a bulleted list. Use a hyphen and a newline ("\\n- ") to separate the feedback for each specific criterion.
6. REPOBANK MEMORY: You are updating the long-term memory for this repository. Using the 'CURRENT REPOBANK STATE' and the new code changes below, update ${student.name}'s 'overallContribution' and 'recentContribution'. Update the project 'concept' if the new code clarifies it. Append to the whole group 'feedback' without losing past context. DO NOT modify or mention other members.

Grade out of a maximum total score of ${maxScore}.
Criteria:
${criteriaText}

${repobankContext}

Student's Commits & Code Patches:
${data.patches.substring(0, 40000)}
`;

  window.showLoader(
    `AI Analyzing Code for ${student.name}...`,
    "Applying strict grading rubrics.",
  );

  let attempt = 0;
  const maxAttempts = 3;
  let success = false;
  let gradeData = null;
  let lastError = "";

  while (attempt < maxAttempts && !success) {
    attempt++;
    try {
      const maxQuota = getModelQuota();
      const quota = await updateQuotaDisplay();

      if (maxQuota !== "Unlimited" && quota.requests >= maxQuota) {
        throw new Error(
          `Daily AI Quota Reached for ${model} (${maxQuota}/${maxQuota}). Please wait until tomorrow or switch models.`,
        );
      }

      if (attempt > 1) {
        window.showLoader(
          `AI Analyzing Code for ${student.name}...`,
          `Retry attempt ${attempt} of ${maxAttempts} (Recovering from API timeout/error)...`,
        );
      }

      // 1. THE 45-SECOND KILL SWITCH
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45000);

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${gemKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal, // Attach kill switch
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: "application/json",
              // 2. THE INFINITE LOOP FIX
              temperature: 0.0,
              topP: 0.1,
              response_schema: {
                type: "OBJECT",
                properties: {
                  total_score: { type: "INTEGER" },
                  breakdown: {
                    type: "ARRAY",
                    items: {
                      type: "OBJECT",
                      properties: {
                        criterion: { type: "STRING" },
                        score: { type: "INTEGER" },
                        max: { type: "INTEGER" },
                      },
                      required: ["criterion", "score", "max"],
                    },
                  },
                  feedback_criteria: { type: "STRING" },
                  additional_feedback: { type: "STRING" },
                  optional_suggestion: { type: "STRING" },
                  repobank_update: {
                    type: "OBJECT",
                    properties: {
                      concept: { type: "STRING" },
                      feedback: { type: "STRING" },
                      overallContribution: { type: "STRING" },
                      recentContribution: { type: "STRING" },
                    },
                    required: [
                      "concept",
                      "feedback",
                      "overallContribution",
                      "recentContribution",
                    ],
                  },
                },
                required: [
                  "total_score",
                  "breakdown",
                  "feedback_criteria",
                  "additional_feedback",
                  "optional_suggestion",
                  "repobank_update",
                ],
              },
            },
          }),
        },
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) {
          // 3. THE 60-SECOND COOLDOWN FOR 5 RPM LIMIT
          const totalSeconds = 60;
          const errorName =
            response.status === 429
              ? "Speed Limit Hit (5 RPM)"
              : "API Server Overloaded (503)";

          for (let remaining = totalSeconds; remaining > 0; remaining--) {
            window.showLoader(
              `AI Analyzing Code for ${student.name}...`,
              `${errorName}. Pausing to recover... ${remaining}s left.`,
            );
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }

          throw new Error(`API Error: ${response.status}`);
        }
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error?.message || response.statusText);
      }

      const aiResult = await response.json();
      let rawJson = aiResult.candidates[0].content.parts[0].text;
      rawJson = rawJson
        .replace(/^```json\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

      gradeData = JSON.parse(rawJson);
      if (!gradeData.breakdown) gradeData.breakdown = [];

      const tokensUsed = aiResult.usageMetadata
        ? aiResult.usageMetadata.totalTokenCount
        : 0;
      gradeData.tokensUsed = tokensUsed;

      // Increment both request count and total tokens for the active model
      await incrementAiQuota(tokensUsed);
      success = true;
    } catch (err) {
      lastError = err.message;

      if (err.name === "AbortError") {
        lastError = "API Connection Timeout (Took longer than 45 seconds).";
      } else if (err.message.includes("Daily AI Quota Reached")) {
        break;
      }
    }
  }

  if (!success) {
    window.hideLoader();
    return alert(
      `AI Grading failed after ${maxAttempts} attempts: ` + lastError,
    );
  }

  // --- SUCCESSFUL DATA SAVE LOGIC ---
  try {
    const formattedFeedback = buildFeedbackHtml(gradeData, maxScore);
    const y = parseInt(document.getElementById("yearSelect").value);
    const m = parseInt(document.getElementById("monthSelect").value);
    const w = parseInt(document.getElementById("weekSelect").value);
    const quarter = getQuarter(document.getElementById("monthSelect").value);

    const gradeDocId = `${student.id}_${y}_m${m}_w${w}`;

    const dbEntry = {
      studentId: student.id,
      section: student.section,
      githubUsername: student.githubUsername,
      year: y,
      month: m,
      week: w,
      quarter: quarter,
      score: gradeData.total_score,
      maxScore: maxScore,
      feedback: formattedFeedback,
      rawAiData: gradeData,
      publishedToGithub: false,
      commitSha: data.commitSha,
      tokenUsage: gradeData.tokensUsed,
    };

    // 1. Save standard grading data
    await setDoc(doc(db, "grades", gradeDocId), dbEntry);
    firestoreGradesMap[student.id] = { docId: gradeDocId, ...dbEntry };

    // 2. Save Repobank Update
    if (gradeData.repobank_update) {
      const repoUpdateData = {
        repoId: repoId,
        repoName: student.repoUrl.split("/").pop().replace(".git", ""),
        concept: gradeData.repobank_update.concept,
        feedback: gradeData.repobank_update.feedback,
        lastUpdated: new Date().toISOString(),
        members: {
          [student.id]: {
            name: student.name,
            overallContribution: gradeData.repobank_update.overallContribution,
            recentContribution: gradeData.repobank_update.recentContribution,
            lastCommitHashProcessed: data.commitSha,
          },
        },
      };
      await setDoc(doc(db, "repobank", repoId), repoUpdateData, {
        merge: true,
      });
    }

    document.getElementById("aiStudentName").textContent =
      `Graded: ${student.name}`;
    document.getElementById("aiScore").textContent = gradeData.total_score;
    document.getElementById("aiScoreMax").textContent = `/${maxScore}`;
    document.getElementById("aiFeedback").innerHTML = formattedFeedback;
    document.getElementById("aiModal").classList.remove("hidden");

    renderGradingTable();
  } catch (err) {
    alert("Database save failed: " + err.message);
  } finally {
    window.hideLoader();
  }
};

// ==========================================
// PUBLISHING (GITHUB API) & CONFIRMATION
// ==========================================
let pendingPublishAction = null;

async function postCommentToGithub(student, gradeRec) {
  const ghToken = localStorage.getItem("Adminerva_github_token");

  // 🔒 Security Patch: Strict URL evaluation
  let owner, repo;
  try {
    const parsedUrl = new URL(student.repoUrl);
    const urlParts = parsedUrl.pathname
      .replace(/\/$/, "")
      .replace(".git", "")
      .split("/");
    repo = urlParts.pop();
    owner = urlParts.pop();
    if (!owner || !repo) throw new Error("Invalid URL format");
  } catch (e) {
    throw new Error(
      `Could not parse owner/repo from URL: ${escapeHTML(student.repoUrl)}`,
    );
  }

  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const targetMonthName = monthNames[gradeRec.month];
  const targetWeek = `Week ${gradeRec.week}`;
  const publishTimestamp = new Date().toLocaleString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: true,
  });

  let commentBody = `### ${targetMonthName} ${targetWeek}\n\n`;

  if (gradeRec.rawAiData) {
    const ai = gradeRec.rawAiData;
    commentBody += `**Total: ${ai.total_score} / ${gradeRec.maxScore}**\n`;
    ai.breakdown.forEach((b) => {
      commentBody += `**${b.criterion}:** ${b.score}/${b.max}\n`;
    });
    commentBody += `\n**Feedback based on criteria:**\n${ai.feedback_criteria}\n\n`;
    commentBody += `**Additional feedback:**\n${ai.additional_feedback}\n\n`;
    commentBody += `**Optional Suggestion:**\n${ai.optional_suggestion}\n\n`;
  } else {
    // 🔒 Security Patch: Safe HTML stripping using DOMParser instead of vulnerable Regex
    let mdFeedback = "";
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(
        gradeRec.feedback.replace(/<br\s*\/?>/gi, "\n"),
        "text/html",
      );
      mdFeedback = doc.body.textContent || "";
    } catch (e) {
      mdFeedback = "Feedback content could not be parsed securely.";
    }

    commentBody += `**Total: ${gradeRec.score} / ${gradeRec.maxScore}**\n\n${mdFeedback}\n\n`;
  }

  commentBody += `*Graded via RepoReview System (${publishTimestamp})*`;

  const getRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/commits/${gradeRec.commitSha}/comments`,
    {
      headers: {
        Authorization: `Bearer ${ghToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  let existingCommentId = null;
  if (getRes.ok) {
    const comments = await getRes.json();
    const existing = comments.find(
      (c) => c.body && c.body.includes("Graded via RepoReview System"),
    );
    if (existing) existingCommentId = existing.id;
  }

  let fetchUrl = `https://api.github.com/repos/${owner}/${repo}/commits/${gradeRec.commitSha}/comments`;
  let fetchMethod = "POST";

  if (existingCommentId) {
    fetchUrl = `https://api.github.com/repos/${owner}/${repo}/comments/${existingCommentId}`;
    fetchMethod = "PATCH";
  }

  const res = await fetch(fetchUrl, {
    method: fetchMethod,
    headers: {
      Authorization: `Bearer ${ghToken}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ body: commentBody }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(`GitHub says: "${errorData.message || res.statusText}"`);
  }

  await setDoc(
    doc(db, "grades", gradeRec.docId),
    { publishedToGithub: true },
    { merge: true },
  );
  firestoreGradesMap[student.id].publishedToGithub = true;
}

window.publishSingle = function (studentId) {
  const student = currentStudents.find((s) => s.id === studentId);
  const gradeRec = firestoreGradesMap[studentId];

  if (!gradeRec || !gradeRec.commitSha)
    return alert(
      "Cannot publish: No valid commit SHA found to attach comment.",
    );

  pendingPublishAction = { type: "single", studentId: studentId };

  // 🔒 Security Patch: Sanitize student.name
  document.getElementById("publishConfirmWarning").innerHTML =
    `You are about to publish the AutoGrader report for <strong class="text-gray-900">${escapeHTML(student.name)}</strong>. <br><br>Once published, GitHub will instantly email this student the feedback and score below.`;

  document.getElementById("publishConfirmScore").textContent =
    `${gradeRec.score} / ${gradeRec.maxScore}`;

  // The feedback components are already sanitized during buildFeedbackHtml execution
  document.getElementById("publishConfirmFeedback").innerHTML =
    gradeRec.feedback;

  document.getElementById("publishConfirmPreview").classList.remove("hidden");
  document.getElementById("executePublishBtn").onclick = executePublish;
  document.getElementById("publishConfirmModal").classList.remove("hidden");
};

window.publishAllGrades = function () {
  const pendingQueue = currentStudents.filter((s) => {
    const g = firestoreGradesMap[s.id];
    return g && g.commitSha && !g.publishedToGithub;
  });

  if (pendingQueue.length === 0)
    return alert(
      "No pending grades to publish. Ensure students are graded first.",
    );

  pendingPublishAction = { type: "bulk", queue: pendingQueue };

  // 🔒 Security Patch: pendingQueue.length is natively safe as an integer, no escaping needed
  document.getElementById("publishConfirmWarning").innerHTML =
    `You are about to batch publish AutoGrader reports to <strong class="text-red-600 text-lg">${pendingQueue.length} student repositories</strong>.<br><br>⚠️ <strong class="text-gray-900">WARNING:</strong> GitHub will instantly blast an email to all ${pendingQueue.length} students containing their individual feedback. Are you absolutely sure the grades are finalized?`;

  document.getElementById("publishConfirmPreview").classList.add("hidden");
  document.getElementById("executePublishBtn").onclick = executePublish;
  document.getElementById("publishConfirmModal").classList.remove("hidden");
};

window.closePublishConfirmModal = function () {
  document.getElementById("publishConfirmModal").classList.add("hidden");
  pendingPublishAction = null;
};

async function executePublish() {
  const action = pendingPublishAction;
  closePublishConfirmModal();

  if (action.type === "single") {
    const student = currentStudents.find((s) => s.id === action.studentId);
    const gradeRec = firestoreGradesMap[action.studentId];

    window.showLoader(`Publishing to GitHub...`, student.name);
    try {
      await postCommentToGithub(student, gradeRec);
      renderGradingTable();
    } catch (e) {
      alert("Failed to publish: " + e.message);
    } finally {
      window.hideLoader();
    }
  } else if (action.type === "bulk") {
    const pendingQueue = action.queue;
    window.showLoader(
      "Initializing Batch Publish...",
      "Connecting to GitHub API...",
    );

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < pendingQueue.length; i++) {
      const student = pendingQueue[i];
      const gradeRec = firestoreGradesMap[student.id];

      window.showLoader(
        `Publishing: ${i + 1} / ${pendingQueue.length}`,
        `Target: ${student.name}`,
      );

      let published = false;
      let retries = 0;
      const maxRetries = 3;

      while (!published && retries < maxRetries) {
        try {
          await postCommentToGithub(student, gradeRec);
          published = true;
          successCount++;
          await new Promise((resolve) => setTimeout(resolve, 1500));
        } catch (e) {
          retries++;
          if (e.message.includes("GitHub says:") && retries < maxRetries) {
            const backoff = Math.pow(2, retries) * 1000;
            window.showLoader(
              `Rate Limit Triggered.`,
              `Pausing for ${backoff / 1000} seconds...`,
            );
            await new Promise((resolve) => setTimeout(resolve, backoff));
          } else {
            console.error(`Hard failure on ${student.name}:`, e);
            failCount++;
            break;
          }
        }
      }
    }

    window.hideLoader();
    renderGradingTable();
    alert(
      `Batch Complete: Published ${successCount} comments. Failed on ${failCount}.`,
    );
  }
}
