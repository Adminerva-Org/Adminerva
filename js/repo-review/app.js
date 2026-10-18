/** Assessment authoring, repository evidence, individual review and protected grading: app. */
// ==========================================
// GLOBAL DATA & STATE
// ==========================================
window.globalCommitData = {};
let activeStartDateStr = "";
let activeEndDateStr = "";

let templates = [];
let activeTemplateId = null;
let editingTemplate = null;
let sections = [];

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

const DEFAULT_TEMPLATES = [
  {
    id: "default_pct",
    name: "Standard Project Grading (Percentage)",
    scoringType: "percentage",
    generalPrompt: "",
    criteria: [
      {
        name: "Logic & Functionality",
        weight: 40,
        description:
          "Does the code achieve its intended purpose without errors?",
      },
      {
        name: "Code Quality",
        weight: 30,
        description:
          "Are variables named well? Is the code indented and readable?",
      },
      {
        name: "Efficiency",
        weight: 30,
        description: "Are there redundant loops or unnecessary calls?",
      },
    ],
  },
];

const DEFAULT_SECTIONS = [{ name: "Section 1", url: "" }];

// ----------------------------------------------------
// INITIALIZATION
// ----------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  // Load local storage
  const storedSections = localStorage.getItem("Adminerva_comprog_sections");
  sections = storedSections
    ? JSON.parse(storedSections)
    : JSON.parse(JSON.stringify(DEFAULT_SECTIONS));
  populateDashboardSections();

  const storedTemplates = localStorage.getItem("Adminerva_grading_templates");
  templates = storedTemplates
    ? JSON.parse(storedTemplates)
    : JSON.parse(JSON.stringify(DEFAULT_TEMPLATES));

  activeTemplateId = localStorage.getItem("Adminerva_active_template_id");
  if (!templates.find((t) => t.id === activeTemplateId))
    activeTemplateId = templates[0].id;

  // Dynamic Year Population
  const currentYear = new Date().getFullYear();
  const yearSelect = document.getElementById("yearSelect");
  for (let i = currentYear - 2; i <= currentYear + 1; i++) {
    let opt = document.createElement("option");
    opt.value = i;
    opt.textContent = i;
    if (i === currentYear) opt.selected = true;
    yearSelect.appendChild(opt);
  }

  // Set Month/Week
  const today = new Date();
  document.getElementById("monthSelect").value = today.getMonth();
  const day = today.getDate();
  if (day <= 7) document.getElementById("weekSelect").value = "1";
  else if (day <= 14) document.getElementById("weekSelect").value = "2";
  else if (day <= 21) document.getElementById("weekSelect").value = "3";
  else document.getElementById("weekSelect").value = "4";

  updateDateScope();

  // Close menus if clicked outside
  window.addEventListener("click", function (e) {
    const menu = document.getElementById("burgerDropdown");
    const btn = document.getElementById("burgerBtn");
    if (!btn.contains(e.target) && !menu.contains(e.target))
      menu.classList.add("hidden");
  });
});

// ----------------------------------------------------
// DATE CALCULATION LOGIC
// ----------------------------------------------------
function updateDateScope() {
  const selectedYear = parseInt(document.getElementById("yearSelect").value);
  const monthNum = parseInt(document.getElementById("monthSelect").value);
  const weekNum = parseInt(document.getElementById("weekSelect").value);

  let startDay = 1,
    endDay = 7;
  if (weekNum === 2) {
    startDay = 8;
    endDay = 14;
  }
  if (weekNum === 3) {
    startDay = 15;
    endDay = 21;
  }
  if (weekNum === 4) {
    startDay = 22;
    endDay = new Date(selectedYear, monthNum + 1, 0).getDate(); // Last day of month
  }

  const sDate = new Date(selectedYear, monthNum, startDay);
  const eDate = new Date(selectedYear, monthNum, endDay);

  // Adjust for local timezone offset when generating ISO strings for GitHub
  const offsetStart = sDate.getTimezoneOffset() * 60000;
  const offsetEnd = eDate.getTimezoneOffset() * 60000;

  activeStartDateStr = new Date(sDate.getTime() - offsetStart)
    .toISOString()
    .split("T")[0];
  activeEndDateStr = new Date(eDate.getTime() - offsetEnd)
    .toISOString()
    .split("T")[0];

  const options = { month: "short", day: "numeric", year: "numeric" };
  document.getElementById("dateScopeDisplay").textContent =
    `${sDate.toLocaleDateString("en-US", options)} — ${eDate.toLocaleDateString("en-US", options)}`;
}

// ----------------------------------------------------
// UI & MENUS
// ----------------------------------------------------
window.toggleMenu = function () {
  document.getElementById("burgerDropdown").classList.toggle("hidden");
};

function populateDashboardSections() {
  const sectionSelect = document.getElementById("sectionSelect");
  sectionSelect.innerHTML = "";
  sections.forEach((sec) => {
    const option = document.createElement("option");
    option.value = sec.url;
    option.textContent = sec.name;
    sectionSelect.appendChild(option);
  });
}

window.openSettings = function (tabId) {
  document.getElementById("burgerDropdown").classList.add("hidden");
  document.getElementById("modalGithubToken").value =
    localStorage.getItem("Adminerva_github_token") || "";
  document.getElementById("modalGeminiKey").value =
    localStorage.getItem("Adminerva_gemini_token") || "";
  document.getElementById("modalAiModel").value =
    localStorage.getItem("Adminerva_ai_model") || "gemini-1.5-flash-latest";

  renderSectionsEditor();

  const templateToLoad =
    templates.find((t) => t.id === activeTemplateId) || templates[0];
  editingTemplate = JSON.parse(JSON.stringify(templateToLoad));
  renderTemplateDropdown();
  renderTemplateEditor();

  switchTab(tabId);
  document.getElementById("settingsModal").classList.remove("hidden");
};

window.closeSettings = function () {
  document.getElementById("settingsModal").classList.add("hidden");
};

window.switchTab = function (tabId) {
  ["security", "configuration", "rubrics"].forEach((id) => {
    document.getElementById("tab-" + id).classList.add("hidden");
    document.getElementById("tab-" + id).classList.remove("block");
    const btn = document.getElementById("tabBtn-" + id);
    btn.classList.remove("tab-active");
    btn.classList.add("tab-inactive");
  });
  document.getElementById("tab-" + tabId).classList.remove("hidden");
  document.getElementById("tab-" + tabId).classList.add("block");
  const activeBtn = document.getElementById("tabBtn-" + tabId);
  activeBtn.classList.add("tab-active");
  activeBtn.classList.remove("tab-inactive");
};

// ----------------------------------------------------
// SETTINGS: SECTIONS & RUBRICS
// ----------------------------------------------------
function renderSectionsEditor() {
  const container = document.getElementById("sectionsContainer");
  container.innerHTML = "";
  sections.forEach((sec, index) => {
    const safeName = escapeHTML(sec.name);
    const safeUrl = escapeHTML(sec.url);
    const html = `
            <div class="section-row bg-white border border-gray-200 rounded p-3 flex flex-col md:flex-row gap-3 items-start shadow-sm">
                <div class="w-full md:w-1/4">
                    <label class="block text-[10px] font-bold text-gray-500 uppercase">Section Name</label>
                    <input type="text" class="sec-name w-full p-1.5 text-sm border-b focus:border-blue-500 outline-none" value="${safeName}" placeholder="e.g. IT-301">
                </div>
                <div class="w-full md:flex-1">
                    <label class="block text-[10px] font-bold text-gray-500 uppercase">Google Sheet Link</label>
                    <input type="text" class="sec-url w-full p-1.5 text-sm border-b focus:border-blue-500 outline-none" value="${safeUrl}">
                </div>
                <button onclick="removeSection(${index})" class="text-red-400 hover:text-red-600 p-2 md:mt-4 transition opacity-50 hover:opacity-100">🗑️</button>
            </div>
        `;
    container.insertAdjacentHTML("beforeend", html);
  });
}

function syncSectionsToData() {
  const rowDivs = document.querySelectorAll(".section-row");
  sections = [];
  rowDivs.forEach((row) => {
    sections.push({
      name: row.querySelector(".sec-name").value.trim() || "Unnamed Section",
      url: row.querySelector(".sec-url").value.trim(),
    });
  });
  if (sections.length === 0)
    sections.push({ name: "Default Section", url: "" });
}

window.addSection = function () {
  syncSectionsToData();
  sections.push({ name: "", url: "" });
  renderSectionsEditor();
};
window.removeSection = function (index) {
  syncSectionsToData();
  sections.splice(index, 1);
  renderSectionsEditor();
};

function renderTemplateDropdown() {
  const select = document.getElementById("templateSelect");
  select.innerHTML = "";
  templates.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.name; // textContent handles escaping natively
    if (t.id === editingTemplate.id) opt.selected = true;
    select.appendChild(opt);
  });
}

window.changeTemplate = function () {
  const target = templates.find(
    (t) => t.id === document.getElementById("templateSelect").value,
  );
  if (target) {
    editingTemplate = JSON.parse(JSON.stringify(target));
    renderTemplateEditor();
  }
};

window.createNewTemplate = function () {
  const newId = "tpl_" + Date.now();
  editingTemplate = {
    id: newId,
    name: "New Custom Template",
    scoringType: "percentage",
    generalPrompt: "",
    criteria: [
      {
        name: "First Criterion",
        weight: 100,
        description: "Describe what to grade.",
      },
    ],
  };
  templates.push(editingTemplate);
  renderTemplateDropdown();
  document.getElementById("templateSelect").value = newId;
  renderTemplateEditor();
};

window.deleteCurrentTemplate = function () {
  if (templates.length <= 1)
    return alert("You must have at least one template.");
  if (confirm(`Delete '${editingTemplate.name}'?`)) {
    templates = templates.filter((t) => t.id !== editingTemplate.id);
    editingTemplate = JSON.parse(JSON.stringify(templates[0]));
    renderTemplateDropdown();
    renderTemplateEditor();
  }
};

function syncEditorToData() {
  editingTemplate.name =
    document.getElementById("tplName").value.trim() || "Unnamed Template";
  editingTemplate.scoringType = document.querySelector(
    'input[name="tplScoreType"]:checked',
  ).value;
  editingTemplate.generalPrompt =
    document.getElementById("tplGeneralPrompt").value;
  const rowDivs = document.querySelectorAll(".criterion-row");
  editingTemplate.criteria = [];
  rowDivs.forEach((row) => {
    editingTemplate.criteria.push({
      name: row.querySelector(".crit-name").value,
      weight: Number(row.querySelector(".crit-weight").value) || 0,
      description: row.querySelector(".crit-desc").value,
    });
  });
}

function renderTemplateEditor() {
  document.getElementById("tplName").value = editingTemplate.name;
  document.getElementById("tplGeneralPrompt").value =
    editingTemplate.generalPrompt;
  document
    .getElementsByName("tplScoreType")
    .forEach((r) => (r.checked = r.value === editingTemplate.scoringType));

  const container = document.getElementById("criteriaContainer");
  container.innerHTML = "";
  let totalWeight = 0;

  editingTemplate.criteria.forEach((crit, index) => {
    totalWeight += Number(crit.weight || 0);
    const safeName = escapeHTML(crit.name);
    const safeDesc = escapeHTML(crit.description);
    const html = `
            <div class="criterion-row bg-white border border-gray-200 rounded p-3 flex flex-col md:flex-row gap-3 items-start shadow-sm">
                <div class="w-full md:w-1/4">
                    <label class="block text-[10px] font-bold text-gray-500 uppercase">Criterion Name</label>
                    <input type="text" class="crit-name w-full p-1.5 text-sm border-b focus:border-purple-500 outline-none" value="${safeName}" onchange="updateTemplatePreview()">
                </div>
                <div class="w-full md:w-1/6">
                    <label class="block text-[10px] font-bold text-gray-500 uppercase">${editingTemplate.scoringType === "percentage" ? "Weight %" : "Points"}</label>
                    <input type="number" class="crit-weight w-full p-1.5 text-sm border-b focus:border-purple-500 outline-none" value="${crit.weight}" onchange="updateTemplatePreview()">
                </div>
                <div class="w-full md:flex-1">
                    <label class="block text-[10px] font-bold text-gray-500 uppercase">AI Prompt</label>
                    <input type="text" class="crit-desc w-full p-1.5 text-sm border-b focus:border-purple-500 outline-none" value="${safeDesc}" onchange="updateTemplatePreview()">
                </div>
                <button onclick="removeCriterion(${index})" class="text-red-400 hover:text-red-600 p-2 md:mt-4">🗑️</button>
            </div>
        `;
    container.insertAdjacentHTML("beforeend", html);
  });
  document.getElementById("tplTotalWeight").textContent =
    `Total: ${totalWeight}${editingTemplate.scoringType === "percentage" ? "%" : " pts"}`;
}

window.updateTemplatePreview = function () {
  syncEditorToData();
  renderTemplateEditor();
};
window.addCriterion = function () {
  syncEditorToData();
  editingTemplate.criteria.push({ name: "", weight: 10, description: "" });
  renderTemplateEditor();
};
window.removeCriterion = function (index) {
  syncEditorToData();
  editingTemplate.criteria.splice(index, 1);
  renderTemplateEditor();
};

window.saveSettings = function () {
  localStorage.setItem(
    "Adminerva_github_token",
    document.getElementById("modalGithubToken").value.trim(),
  );
  localStorage.setItem(
    "Adminerva_gemini_token",
    document.getElementById("modalGeminiKey").value.trim(),
  );
  localStorage.setItem(
    "Adminerva_ai_model",
    document.getElementById("modalAiModel").value.trim(),
  );

  syncSectionsToData();
  localStorage.setItem("Adminerva_comprog_sections", JSON.stringify(sections));
  populateDashboardSections();

  syncEditorToData();
  const tIndex = templates.findIndex((t) => t.id === editingTemplate.id);
  if (tIndex >= 0) templates[tIndex] = editingTemplate;
  else templates.push(editingTemplate);
  activeTemplateId = editingTemplate.id;
  localStorage.setItem(
    "Adminerva_grading_templates",
    JSON.stringify(templates),
  );
  localStorage.setItem("Adminerva_active_template_id", activeTemplateId);

  closeSettings();
};

// ----------------------------------------------------
// LOCAL STORAGE IDENTIFIER HELPER
// ----------------------------------------------------
function getGradeStorageKey(gitUser) {
  const repoUrl = document.getElementById("repoUrl").value.trim();
  const safeRepo = repoUrl.replace(/[^a-zA-Z0-9]/g, "_");
  const year = document.getElementById("yearSelect").value;
  const month = document.getElementById("monthSelect").value;
  const week = document.getElementById("weekSelect").value;
  return `grade_${safeRepo}_y${year}_m${month}_w${week}_${gitUser}`;
}

// ----------------------------------------------------
// REPORT GENERATION
// ----------------------------------------------------
function showError(msg) {
  document.getElementById("errorMessage").textContent = msg;
  document.getElementById("loading").classList.add("hidden");
  document.getElementById("errorBox").classList.remove("hidden");
}
function clearErrors() {
  document.getElementById("errorBox").classList.add("hidden");
  document.getElementById("errorMessage").textContent = "";
}

window.generateReport = async function () {
  clearErrors();
  const tokenInput = localStorage.getItem("Adminerva_github_token");
  if (!tokenInput)
    return showError("Missing GitHub Token. Please open settings.");

  const repoUrl = document.getElementById("repoUrl").value.trim();
  const csvUrl = document.getElementById("sectionSelect").value;
  if (!repoUrl)
    return showError("Validation Failed: Please fill out the Repo URL.");

  document.getElementById("loading").classList.remove("hidden");
  document.getElementById("resultsBody").innerHTML = "";
  window.globalCommitData = {};

  try {
    // 🔒 Security Patch: Strict URL validation
    let owner, repo;
    try {
      const parsedUrl = new URL(repoUrl);
      const urlParts = parsedUrl.pathname
        .replace(/\/$/, "")
        .replace(".git", "")
        .split("/");
      repo = urlParts.pop();
      owner = urlParts.pop();
      if (!owner || !repo) throw new Error();
    } catch (err) {
      throw new Error("Failed to parse GitHub URL securely.");
    }

    let students = [];
    if (csvUrl) students = await fetchStudents(csvUrl);

    const commits = await fetchCommits(
      owner,
      repo,
      activeStartDateStr,
      activeEndDateStr,
      tokenInput,
    );
    const commitDataByUser = await processCommits(
      owner,
      repo,
      commits,
      tokenInput,
    );
    window.globalCommitData = commitDataByUser;
    renderTable(students, commitDataByUser);
  } catch (error) {
    showError(error.message);
  } finally {
    document.getElementById("loading").classList.add("hidden");
  }
};

function fetchStudents(url) {
  return new Promise((resolve, reject) => {
    Papa.parse(url, {
      download: true,
      header: true,
      complete: (res) => resolve(res.data),
      error: () => reject(new Error("Failed to read CSV.")),
    });
  });
}

async function fetchCommits(owner, repo, start, end, token) {
  const since = new Date(start + "T00:00:00Z").toISOString();
  const until = new Date(end + "T23:59:59Z").toISOString();
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/commits?since=${since}&until=${until}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status} from GitHub API.`);
  return await response.json();
}

async function processCommits(owner, repo, commits, token) {
  const stats = {};
  for (let commit of commits) {
    const authorUsername = commit.author
      ? commit.author.login
      : commit.commit.author.name || "Unknown";
    if (!stats[authorUsername]) {
      stats[authorUsername] = {
        count: 0,
        additions: 0,
        deletions: 0,
        lastMsg: commit.commit.message,
        allMsgs: [],
        patches: "",
      };
    }
    stats[authorUsername].count += 1;
    stats[authorUsername].allMsgs.push(commit.commit.message);

    const detailResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/commits/${commit.sha}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (detailResponse.ok) {
      const detail = await detailResponse.json();
      if (detail.stats) {
        stats[authorUsername].additions += detail.stats.additions;
        stats[authorUsername].deletions += detail.stats.deletions;
      }
      if (detail.files)
        detail.files.forEach((file) => {
          if (file.patch)
            stats[authorUsername].patches +=
              `\n--- ${file.filename} ---\n${file.patch}\n`;
        });
    }
  }
  return stats;
}

function createRowHTML(name, gitUser, count, additions, deletions, lastMsg) {
  // 🔒 Security Patch: Completely neutralize all user variables before dropping them into the DOM
  const safeName = escapeHTML(name);
  const safeGitUser = escapeHTML(gitUser);
  const idSafeUser = escapeHTML(gitUser.replace(/[^a-zA-Z0-9]/g, "_"));
  const safeLastMsg = escapeHTML(lastMsg);
  const safeAdd = escapeHTML(additions.toString());
  const safeDel = escapeHTML(deletions.toString());
  const safeCount = escapeHTML(count.toString());

  // Check LocalStorage for saved grades based on Year/Month/Week/Repo
  const storageKey = getGradeStorageKey(gitUser);
  const savedDataStr = localStorage.getItem(storageKey);

  let feedbackHtml = `<span class="text-gray-400 italic">Not graded</span>`;
  let gradeBtnText = "Grade via AI";

  if (savedDataStr) {
    const savedData = JSON.parse(savedDataStr);
    feedbackHtml = `
            <div class="mb-1"><strong class="text-purple-700">Score: ${escapeHTML(savedData.score)}</strong></div>
            <div class="text-gray-700 leading-relaxed text-xs">${savedData.feedback}</div>
        `;
    gradeBtnText = "Regrade via AI";
  }

  const actionButtons =
    count > 0
      ? `<div class="flex flex-col gap-2">
            <button onclick="openDetailsModal('${safeGitUser}')" class="bg-blue-100 text-blue-700 border border-blue-300 font-semibold px-3 py-1.5 rounded text-xs hover:bg-blue-600 hover:text-white transition shadow-sm text-left flex items-center gap-1"><span>📄</span> View Details</button>
            <button onclick="gradeCodeWithAI('${safeGitUser}')" class="bg-purple-100 text-purple-700 border border-purple-300 font-semibold px-3 py-1.5 rounded text-xs hover:bg-purple-600 hover:text-white transition shadow-sm text-left flex items-center gap-1"><span>🤖</span> ${gradeBtnText}</button>
           </div>`
      : `<span class="text-xs text-gray-400 font-semibold italic">No Code Submitted</span>`;

  return `
        <tr class="border-b hover:bg-gray-50">
            <td class="py-3 px-4 text-gray-800 font-medium">${safeName}</td>
            <td class="py-3 px-4 text-gray-500 text-sm">${safeGitUser}</td>
            <td class="py-3 px-4 font-bold ${count === 0 ? "text-red-500" : "text-green-600"}">${safeCount}</td>
            <td class="py-3 px-4 text-sm font-mono"><span class="text-green-500">+${safeAdd}</span> | <span class="text-red-500">-${safeDel}</span></td>
            <td class="py-3 px-4 text-xs text-gray-600 truncate max-w-xs" title="${safeLastMsg}">${safeLastMsg}</td>
            <td class="py-3 px-4 text-xs text-gray-700" id="feedback-${idSafeUser}">${feedbackHtml}</td>
            <td class="py-3 px-4">${actionButtons}</td>
        </tr>
    `;
}

function renderTable(students, commitData) {
  const resultsBody = document.getElementById("resultsBody");
  const processedGitUsers = new Set();
  students.forEach((student) => {
    if (!student.Name) return;
    const gitUser = student.GitHubUsername ? student.GitHubUsername.trim() : "";
    processedGitUsers.add(gitUser);
    const data = commitData[gitUser] || {
      count: 0,
      additions: 0,
      deletions: 0,
      lastMsg: "No commits this week",
      allMsgs: [],
      patches: "",
    };
    resultsBody.insertAdjacentHTML(
      "beforeend",
      createRowHTML(
        student.Name,
        gitUser,
        data.count,
        data.additions,
        data.deletions,
        data.lastMsg,
      ),
    );
  });
  for (const [gitUser, data] of Object.entries(commitData)) {
    if (!processedGitUsers.has(gitUser))
      resultsBody.insertAdjacentHTML(
        "beforeend",
        createRowHTML(
          `Not in Sheet`,
          gitUser,
          data.count,
          data.additions,
          data.deletions,
          data.lastMsg,
        ),
      );
  }
}

// ----------------------------------------------------
// DETAILS MODAL
// ----------------------------------------------------
window.openDetailsModal = function (gitUser) {
  const userData = window.globalCommitData[gitUser];
  if (!userData) return;
  document.getElementById("detailsSubtitle").textContent =
    `Commit summary for GitHub user: ${gitUser}`;
  document.getElementById("detCommits").textContent = userData.count;
  document.getElementById("detAdded").textContent = "+" + userData.additions;
  document.getElementById("detDeleted").textContent = "-" + userData.deletions;

  // 🔒 Security Patch: Convert HTML injection to textContent node injection
  const commitList = document.getElementById("detCommitList");
  commitList.innerHTML = "";
  userData.allMsgs.forEach((msg) => {
    const li = document.createElement("li");
    li.textContent = msg;
    commitList.appendChild(li);
  });

  const codeBlock = document.getElementById("detCodeBlock");
  codeBlock.textContent = userData.patches || "No raw code changes recorded.";
  codeBlock.classList.add("hidden");
  document.getElementById("toggleCodeBtn").textContent = "Show Code Changes";
  document.getElementById("detailsModal").classList.remove("hidden");
};

window.closeDetailsModal = function () {
  document.getElementById("detailsModal").classList.add("hidden");
};
window.toggleCodeChanges = function () {
  const codeBlock = document.getElementById("detCodeBlock");
  const btn = document.getElementById("toggleCodeBtn");
  if (codeBlock.classList.contains("hidden")) {
    codeBlock.classList.remove("hidden");
    btn.textContent = "Hide Code Changes";
  } else {
    codeBlock.classList.add("hidden");
    btn.textContent = "Show Code Changes";
  }
};

// ----------------------------------------------------
// STRICT AI INTEGRATION & LOCAL STORAGE
// ----------------------------------------------------
window.gradeCodeWithAI = async function (gitUser) {
  const geminiKey = localStorage.getItem("Adminerva_gemini_token");
  const aiModel =
    localStorage.getItem("Adminerva_ai_model") || "gemini-1.5-flash-latest";
  if (!geminiKey) return alert("Missing Gemini API Key.");

  const userData = window.globalCommitData[gitUser];
  if (!userData || !userData.patches)
    return alert("No readable code changes found for this user.");

  const activeTpl =
    templates.find((t) => t.id === activeTemplateId) || templates[0];
  const isPercent = activeTpl.scoringType === "percentage";
  let criteriaText = activeTpl.criteria
    .map(
      (c) =>
        `- ${c.name} (${c.weight}${isPercent ? "%" : " pts"}): ${c.description}`,
    )
    .join("\n");
  let maxScore = isPercent
    ? 100
    : activeTpl.criteria.reduce((sum, c) => sum + Number(c.weight || 0), 0);

  const finalPromptText = `
${activeTpl.generalPrompt}

You are a strict Computer Programming Professor grading a student's weekly commits. Review the following GitHub diff patches. Identify the specific project/system the student is building.

CRITICAL INSTRUCTIONS:
1. DO NOT use conversational filler, flowery language, or sugar-coating. Be blunt, direct, and concise.
2. The 'feedback_summary' MUST follow this format exactly:
   - Provide exactly 1 sentence of factual praise acknowledging functional code and context.
   - Use bullet points to list missing logic, syntax errors, and inefficiencies based strictly on the criteria below.

Grade out of a maximum score of ${maxScore}.
Criteria:
${criteriaText}

Student Code:
${userData.patches.substring(0, 30000)}

Respond strictly in valid JSON format: {"score": <number>, "feedback_summary": "<string>"}
    `;

  document.getElementById("aiModal").classList.remove("hidden");
  document.getElementById("aiStudentName").textContent =
    `Reviewing commits for: ${gitUser}`;
  document.getElementById("aiLoading").classList.remove("hidden");
  document.getElementById("aiContent").classList.add("hidden");

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${aiModel}:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: finalPromptText }] }],
          generationConfig: { response_mime_type: "application/json" },
        }),
      },
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        `Google API Error (${response.status}): ${errorData.error ? errorData.error.message : response.statusText}`,
      );
    }

    const aiResult = await response.json();
    const gradeData = JSON.parse(aiResult.candidates[0].content.parts[0].text);

    document.getElementById("aiScore").textContent = gradeData.score;
    document.getElementById("aiScoreMax").textContent = `/${maxScore}`;

    // 🔒 Security Patch: Sanitize AI output before rendering HTML tags
    const formattedFeedback = escapeHTML(gradeData.feedback_summary).replace(
      /\n/g,
      "<br>",
    );
    document.getElementById("aiFeedback").innerHTML = formattedFeedback;

    // Display in table immediately
    const idSafeUser = escapeHTML(gitUser.replace(/[^a-zA-Z0-9]/g, "_"));
    const dashboardCell = document.getElementById(`feedback-${idSafeUser}`);
    if (dashboardCell) {
      dashboardCell.innerHTML = `
                <div class="mb-1"><strong class="text-purple-700">Score: ${escapeHTML(gradeData.score.toString())}/${escapeHTML(maxScore.toString())}</strong></div>
                <div class="text-gray-700 leading-relaxed text-xs">${formattedFeedback}</div>
            `;
    }

    // Save to Local Storage securely
    const storageKey = getGradeStorageKey(gitUser);
    const dataToSave = {
      score: `${gradeData.score}/${maxScore}`,
      feedback: formattedFeedback,
    };
    localStorage.setItem(storageKey, JSON.stringify(dataToSave));
  } catch (err) {
    document.getElementById("aiScore").textContent = "⚠️";
    document.getElementById("aiFeedback").textContent = err.message;
  } finally {
    document.getElementById("aiLoading").classList.add("hidden");
    document.getElementById("aiContent").classList.remove("hidden");
  }
};

window.closeAiModal = function () {
  document.getElementById("aiModal").classList.add("hidden");
};
