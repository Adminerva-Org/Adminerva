/** Academic analytics for the selected instructor's configured sections; raw operations stay in the admin module. */
import { db, auth } from "../core/firebase-core.js";
import {selectedTeacherSections} from "./teacher-engagement.mjs?v=2026.10.19.3";
import {staffRole} from "../core/staff-role.mjs?v=2026.10.19.2";
import {
  collection,
  getDocs,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

let velocityChartInstance = null;
let globalStudents = [];
let globalGrades = [];
let globalAssessments = {};
let dashboardRequest = 0;

window.showLoader = function (msg = "Processing...") {
  if (typeof window.showSubtleLoader === "function")
    window.showSubtleLoader(msg);
};
window.hideLoader = function () {
  if (typeof window.hideSubtleLoader === "function") window.hideSubtleLoader();
};

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

function getRepoId(repoUrl) {
  if (!repoUrl || repoUrl === "unassigned") return null;
  try {
    const parts = repoUrl.replace(/\/$/, "").replace(".git", "").split("/");
    return `${parts[parts.length - 2]}_${parts[parts.length - 1]}`.toLowerCase();
  } catch (e) {
    return null;
  }
}

document.addEventListener("analytics-teacher-change", () => {
  initDashboard();
});

async function initDashboard() {
  const request = ++dashboardRequest;
  globalStudents = []; globalGrades = []; globalAssessments = {};
  for (const id of ["statStudents", "statGrades", "statAvgTime", "statMastery", "tierList", "penaltyList", "criteriaList", "topStudentsList", "atRiskList", "ghostList", "equityList", "modalGradeHistory"]) document.getElementById(id).textContent = "—";
  document.getElementById("sectionSelect").replaceChildren();
  document.getElementById("student360Modal").classList.add("hidden");
  if (velocityChartInstance) { velocityChartInstance.destroy(); velocityChartInstance = null; }
  if (!db || !staffRole(auth.currentUser)) return;
  const end = window.beginLoading?.("Loading teacher analytics…") || (() => {});
  try {
    const sections = await selectedTeacherSections();
    if (request !== dashboardRequest) return;
    globalStudents = []; globalGrades = []; globalAssessments = {};
    document.getElementById("taskSelect").replaceChildren(new Option("All assessments", "ALL"));
    document.getElementById("sectionSelect").replaceChildren();

    // Fetch Assessments for Task Filter & Naming
    const assSnap = await getDocs(collection(db, "assessments"));
    if (request !== dashboardRequest) return;
    const taskSelect = document.getElementById("taskSelect");
    assSnap.forEach((d) => {
      globalAssessments[d.id] = d.data();
      taskSelect.insertAdjacentHTML(
        "beforeend",
        `<option value="${escapeHTML(d.id)}">${escapeHTML(d.data().title)}</option>`,
      );
    });

    // Fetch Sections
    const snap = await getDocs(collection(db, "students"));
    if (request !== dashboardRequest) return;
    const select = document.getElementById("sectionSelect");
    let uniqueSections = new Set();

    snap.forEach((d) => {
      const data = d.data();
      if (!sections.includes(data.section)) return;
      globalStudents.push({ id: d.id, ...data });
      if (data.section) uniqueSections.add(data.section);
    });

    [...uniqueSections].sort().forEach((sec) => {
      select.insertAdjacentHTML(
        "beforeend",
        `<option value="${escapeHTML(sec)}">${escapeHTML(sec)}</option>`,
      );
    });

    if (uniqueSections.size > 0) await window.loadDashboardData();
    else {
      document.getElementById("sectionSelect").add(new Option("No assigned sections", ""));
      document.getElementById("academic-status").textContent = "No sections assigned to this instructor yet. Ask the administrator to save an analytics assignment.";
    }
  } catch (e) {
    console.error("Init Error", e);
    document.getElementById("academic-status").textContent = "Academic analytics could not load. Check your connection and assigned permissions.";
  } finally {
    end();
  }
}

window.loadDashboardData = async function () {
  const section = document.getElementById("sectionSelect").value;
  const taskIdFilter = document.getElementById("taskSelect").value;
  if (!section) return;
  const request = ++dashboardRequest;
  const end = window.beginLoading?.("Analyzing learning records…") || (() => {});
  document.getElementById("academic-status").textContent = "Loading section records…";

  try {
    // 1. Filter Students
    const sectionStudents = globalStudents.filter((s) => s.section === section);
    const studentIds = new Set(sectionStudents.map((s) => s.id));
    document.getElementById("statStudents").textContent =
      sectionStudents.length;

    // 2. Fetch Grades (Live to catch recent manual grading updates)
    const gradesSnap = await getDocs(collection(db, "student_grades"));
    if (request !== dashboardRequest) return;
    globalGrades = [];
    gradesSnap.forEach((d) => {
      if (studentIds.has(d.data().studentId)) {
        globalGrades.push({ id: d.id, ...d.data() });
      }
    });

    // Filter by specific task if requested
    const filteredGrades =
      taskIdFilter === "ALL"
        ? globalGrades
        : globalGrades.filter((g) => g.taskId === taskIdFilter);

    // Analytics Trackers
    let totalLatency = 0,
      latencyCount = 0;
    let t1 = 0,
      t2 = 0,
      t3 = 0;
    let totalMasteryPercentage = 0;
    const penaltyCounts = {};
    const taskAverages = {};
    const studentPerformance = {}; // For Top 5 / At-Risk calculations

    sectionStudents.forEach((s) => {
      studentPerformance[s.id] = {
        id:s.id,
        name: s.name,
        gh: s.githubUsername,
        grades: [],
        totalPerc: 0,
        penaltyCount: 0,
      };
    });

    filteredGrades.forEach((g) => {
      // Latency
      if (g.gradingDurationMs) {
        totalLatency += g.gradingDurationMs;
        latencyCount++;
      }

      // Dynamic Mastery Math
      const maxScore =
        g.maxScore || globalAssessments[g.taskId]?.maxScore || 20;
      const score = g.score || 0;
      const perc = (score / maxScore) * 100;

      totalMasteryPercentage += perc;

      if (perc >= 75) t1++;
      else if (perc >= 50) t2++;
      else t3++;

      // Populate Student Stats
      if (studentPerformance[g.studentId]) {
        studentPerformance[g.studentId].grades.push({
          task: g.taskId,
          score,
          maxScore,
          perc,
        });
        studentPerformance[g.studentId].totalPerc += perc;
      }

      // Penalties
      if (g.penaltyTags && Array.isArray(g.penaltyTags)) {
        g.penaltyTags.forEach((tag) => {
          penaltyCounts[tag] = (penaltyCounts[tag] || 0) + 1;
          if (studentPerformance[g.studentId])
            studentPerformance[g.studentId].penaltyCount++;
        });
      }

      // Task Averages (For Weaknesses Panel)
      if (!taskAverages[g.taskId])
        taskAverages[g.taskId] = { totalPerc: 0, count: 0 };
      taskAverages[g.taskId].totalPerc += perc;
      taskAverages[g.taskId].count++;
    });

    // Update KPI Cards
    document.getElementById("statGrades").textContent = filteredGrades.length;
    const avgMs = latencyCount > 0 ? totalLatency / latencyCount : 0;
    document.getElementById("statAvgTime").textContent =
      avgMs > 0 ? (avgMs / 1000).toFixed(1) + "s" : "N/A";

    const secAvg =
      filteredGrades.length > 0
        ? Math.round(totalMasteryPercentage / filteredGrades.length)
        : 0;
    document.getElementById("statMastery").textContent = `${secAvg}%`;

    // 3. Process Student Rankings (Top 5 & At-Risk)
    const rankedStudents = Object.values(studentPerformance)
      .filter((s) => s.grades.length > 0)
      .map((s) => {
        s.avgPerc = s.totalPerc / s.grades.length;
        return s;
      })
      .sort((a, b) => b.avgPerc - a.avgPerc);

    renderStudentRadar(rankedStudents);

    // 4. Group Repo Analytics (Equity & Ghost)
    const cacheSnap = await getDocs(collection(db, "group_repo_cache"));
    if (request !== dashboardRequest) return;
    const repoCacheMap = {};
    cacheSnap.forEach((d) => (repoCacheMap[d.id] = d.data()));

    const groups = {};
    sectionStudents.forEach((s) => {
      const rid = getRepoId(s.repoUrl);
      if (rid) {
        if (!groups[rid]) groups[rid] = [];
        groups[rid].push(s);
      }
    });

    const equityAlerts = [];
    const ghostAlerts = [];
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    Object.keys(groups).forEach((rid) => {
      const groupMembers = groups[rid];
      const cacheData = repoCacheMap[rid];

      // Check Ghost / Dormancy
      if (
        !cacheData ||
        !cacheData.latestSha ||
        cacheData.lastUpdated < weekAgo
      ) {
        ghostAlerts.push({ repoId: rid, members: groupMembers });
      }

      // Check Equity
      if (groupMembers.length > 1 && cacheData && cacheData.studentStats) {
        let totalGroupCommits = 0;
        const memberCommits = [];

        groupMembers.forEach((m) => {
          const stats = cacheData.studentStats[m.id];
          const count = stats ? stats.count : 0;
          totalGroupCommits += count;
          memberCommits.push({ name: m.name, count: count });
        });

        if (totalGroupCommits > 5) {
          memberCommits.sort((a, b) => b.count - a.count);
          const topShare = memberCommits[0].count / totalGroupCommits;
          const bottomShare =
            memberCommits[memberCommits.length - 1].count / totalGroupCommits;

          if (topShare - bottomShare > 0.6) {
            equityAlerts.push({
              repoId: rid,
              total: totalGroupCommits,
              top: memberCommits[0],
              bottom: memberCommits[memberCommits.length - 1],
            });
          }
        }
      }
    });

    // Render Components
    renderTiers(t1, t2, t3, filteredGrades.length);
    renderPenalties(penaltyCounts, filteredGrades.length);
    renderTaskAverages(taskAverages);
    renderRadarAlerts(ghostAlerts, equityAlerts);

    if (sectionStudents.length > 0) {
      await renderVelocityChart(sectionStudents, request);
    } else {
      renderEmptyChart();
    }
    if (request === dashboardRequest) document.getElementById("academic-status").textContent = "Academic records loaded. Repository commit counts indicate activity only, not verified authorship, effort or individual mastery.";
  } catch (e) {
    document.getElementById("academic-status").textContent = "Some academic records could not load. Retry your section selection.";
    console.error(e);
  } finally {
    end();
  }
};

// ==========================================
// RENDERING FUNCTIONS
// ==========================================

function renderTiers(t1, t2, t3, total) {
  const list = document.getElementById("tierList");
  if (total === 0) {
    list.innerHTML =
      '<div class="text-center text-xs text-slate-400 italic">No grades found.</div>';
    return;
  }
  const p1 = Math.round((t1 / total) * 100) || 0;
  const p2 = Math.round((t2 / total) * 100) || 0;
  const p3 = Math.round((t3 / total) * 100) || 0;

  list.innerHTML = `
    <div class="flex flex-col gap-1">
        <div class="flex justify-between text-xs font-bold text-slate-600"><span>Mastered (≥75%)</span><span>${p1}%</span></div>
        <div class="w-full bg-slate-100 rounded-full h-2.5 shadow-inner"><div class="bg-emerald-500 h-2.5 rounded-full" style="width: ${p1}%"></div></div>
        <div class="text-[9px] text-slate-400 text-right">${t1} Submissions</div>
    </div>
    <div class="flex flex-col gap-1 mt-2">
        <div class="flex justify-between text-xs font-bold text-slate-600"><span>Developing (50-74%)</span><span>${p2}%</span></div>
        <div class="w-full bg-slate-100 rounded-full h-2.5 shadow-inner"><div class="bg-amber-400 h-2.5 rounded-full" style="width: ${p2}%"></div></div>
        <div class="text-[9px] text-slate-400 text-right">${t2} Submissions</div>
    </div>
    <div class="flex flex-col gap-1 mt-2">
        <div class="flex justify-between text-xs font-bold text-slate-600"><span>Critical (<50%)</span><span>${p3}%</span></div>
        <div class="w-full bg-slate-100 rounded-full h-2.5 shadow-inner"><div class="bg-rose-500 h-2.5 rounded-full" style="width: ${p3}%"></div></div>
        <div class="text-[9px] text-slate-400 text-right">${t3} Submissions</div>
    </div>
  `;
}

function renderTaskAverages(taskAverages) {
  const list = document.getElementById("criteriaList");
  const taskIds = Object.keys(taskAverages);
  if (taskIds.length === 0) {
    list.innerHTML =
      '<div class="text-center text-xs text-slate-400 italic mt-4">No assessments graded yet.</div>';
    return;
  }

  const sortedTasks = taskIds
    .map((id) => {
      return {
        id,
        name: globalAssessments[id]?.title || "Unknown Task",
        perc: taskAverages[id].totalPerc / taskAverages[id].count,
      };
    })
    .sort((a, b) => a.perc - b.perc);

  list.innerHTML = "";
  sortedTasks.forEach((task) => {
    let colorClass = "text-emerald-600 bg-emerald-50";
    if (task.perc < 50) colorClass = "text-rose-600 bg-rose-50 border-rose-200";
    else if (task.perc < 75)
      colorClass = "text-amber-600 bg-amber-50 border-amber-200";

    list.insertAdjacentHTML(
      "beforeend",
      `
      <div class="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg">
        <span class="font-bold text-slate-700 text-xs truncate max-w-[200px]" title="${escapeHTML(task.name)}">${escapeHTML(task.name)}</span>
        <span class="font-black text-sm px-2 py-0.5 rounded border ${colorClass}">${Math.round(task.perc)}%</span>
      </div>
    `,
    );
  });
}

function renderPenalties(penaltyCounts, totalGrades) {
  const list = document.getElementById("penaltyList");
  const sorted = Object.entries(penaltyCounts).sort((a, b) => b[1] - a[1]);

  if (sorted.length === 0) {
    list.innerHTML =
      '<div class="text-center text-xs text-emerald-500 font-bold italic mt-4">Clean code! No penalties found.</div>';
    return;
  }
  list.innerHTML = sorted
    .map(([tag, count], index) => {
      const percentage = Math.round((count / totalGrades) * 100);
      const colorClass =
        index < 2
          ? "bg-rose-50 text-rose-700 border-rose-200"
          : "bg-amber-50 text-amber-700 border-amber-200";
      return `
      <div class="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg">
        <span class="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded border ${colorClass}">${escapeHTML(tag)}</span>
        <div class="text-right flex flex-col">
          <span class="font-bold text-slate-700 text-sm">${count}</span>
          <span class="text-[9px] text-slate-400 font-bold tracking-wider">${percentage}% incidence</span>
        </div>
      </div>
    `;
    })
    .join("");
}

function renderStudentRadar(rankedStudents) {
  const topList = document.getElementById("topStudentsList");
  const riskList = document.getElementById("atRiskList");

  if (rankedStudents.length === 0) {
    topList.innerHTML = riskList.innerHTML =
      '<div class="text-xs text-slate-400 italic">No grading data available yet.</div>';
    return;
  }

  const top5 = rankedStudents.slice(0, 5);
  const bottom5 = [...rankedStudents]
    .reverse()
    .slice(0, 5)
    .filter((s) => s.avgPerc < 75); // Only show at-risk if they actually struggle

  const renderCard = (s, isRisk) => `
    <button type="button" data-student-id="${escapeHTML(s.id)}" class="w-full flex justify-between items-center p-3 bg-white border ${isRisk ? "border-rose-200 hover:bg-rose-50" : "border-slate-200 hover:bg-emerald-50"} rounded-lg cursor-pointer transition shadow-sm">
        <div class="flex flex-col">
            <span class="font-bold text-slate-700 text-xs">${escapeHTML(s.name)}</span>
            <span class="text-[9px] text-slate-400 font-mono">@${escapeHTML(s.gh || "unlinked")}</span>
        </div>
        <div class="flex flex-col items-end">
            <span class="font-black text-sm ${isRisk ? "text-rose-600" : "text-emerald-600"}">${Math.round(s.avgPerc)}%</span>
            ${s.penaltyCount === 0 && !isRisk ? '<span class="text-[8px] bg-emerald-100 text-emerald-700 px-1 rounded uppercase font-bold">Zero Penalties</span>' : ""}
        </div>
    </button>
  `;

  topList.innerHTML = top5.map((s) => renderCard(s, false)).join("");
  riskList.innerHTML =
    bottom5.length > 0
      ? bottom5.map((s) => renderCard(s, true)).join("")
      : '<div class="text-xs text-slate-600 italic">No below-threshold recorded averages in this sample.</div>';
}

function renderRadarAlerts(ghostAlerts, equityAlerts) {
  const gl = document.getElementById("ghostList");
  const el = document.getElementById("equityList");

  gl.innerHTML =
    ghostAlerts.length > 0
      ? ghostAlerts
          .map(
            (g) =>
              `<div class="p-2 border-l-2 border-slate-400 bg-slate-50 text-xs font-bold text-slate-700 mb-2">${escapeHTML(g.repoId)} <span class="text-[9px] text-slate-400 font-normal ml-1">(Cache missing or older than 7 days; refresh before interpreting)</span></div>`,
          )
          .join("")
      : '<div class="text-xs text-slate-600 italic">Repository cache is recent; this does not establish current participation.</div>';

  el.innerHTML =
    equityAlerts.length > 0
      ? equityAlerts
          .map(
            (alert) => `
      <div class="p-3 bg-amber-50 border border-amber-200 rounded-lg flex flex-col gap-2 mb-2">
        <div class="flex justify-between items-center border-b border-amber-100 pb-1">
          <span class="font-bold text-slate-800 text-xs truncate">${escapeHTML(alert.repoId)}</span>
        </div>
        <div class="flex justify-between text-xs">
          <div class="flex flex-col"><span class="text-[9px] text-slate-400 uppercase">Higher commit count</span><span class="font-bold text-slate-700">${escapeHTML(alert.top.name)} (${alert.top.count})</span></div>
          <div class="flex flex-col text-right"><span class="text-[9px] text-slate-400 uppercase">Lower commit count</span><span class="font-bold text-amber-600">${escapeHTML(alert.bottom.name)} (${alert.bottom.count})</span></div>
        </div>
      </div>`,
          )
          .join("")
      : '<div class="text-xs text-emerald-500 font-bold italic">Team commits are balanced.</div>';
}

window.openStudent360 = function (studentId) {
  const student = globalStudents.find((s) => s.id === studentId);
  const sGrades = globalGrades.filter((g) => g.studentId === studentId);
  if (!student) return;

  document.getElementById("modalStudentName").textContent = student.name;
  document.getElementById("modalStudentGithub").textContent =
    `@${student.githubUsername || "unlinked"}`;

  let totalPerc = 0,
    penalties = 0;
  const historyHtml = sGrades
    .map((g) => {
      const max = g.maxScore || globalAssessments[g.taskId]?.maxScore || 20;
      const score = g.score || 0;
      const perc = (score / max) * 100;
      totalPerc += perc;
      if (g.penaltyTags) penalties += g.penaltyTags.length;

      let color =
        perc >= 75
          ? "text-emerald-600"
          : perc >= 50
            ? "text-amber-600"
            : "text-rose-600";
      return `
            <div class="flex justify-between items-center p-2 bg-slate-50 border border-slate-100 rounded">
                <div class="flex flex-col">
                    <span class="text-xs font-bold text-slate-700">${escapeHTML(globalAssessments[g.taskId]?.title || "Task")}</span>
                    <span class="text-[9px] text-slate-400">${escapeHTML(g.penaltyTags ? g.penaltyTags.join(", ") : "No penalties")}</span>
                </div>
                <div class="flex flex-col items-end">
                    <span class="font-black text-sm ${color}">${score} / ${max}</span>
                    <span class="text-[9px] font-bold ${color}">${Math.round(perc)}%</span>
                </div>
            </div>
        `;
    })
    .join("");

  document.getElementById("modalMastery").textContent =
    sGrades.length > 0 ? `${Math.round(totalPerc / sGrades.length)}%` : "N/A";
  document.getElementById("modalSubmissions").textContent = sGrades.length;
  document.getElementById("modalPenaltiesCount").textContent = penalties;
  document.getElementById("modalGradeHistory").innerHTML =
    historyHtml ||
    '<div class="text-xs italic text-slate-400">No grades recorded.</div>';

  document.getElementById("student360Modal").classList.remove("hidden");
};

document.addEventListener("click", event => {
  const button = event.target.closest?.("[data-student-id]");
  if (button) window.openStudent360(button.dataset.studentId);
});

// Chart Logic (Unchanged core, but encapsulated cleanly)
async function renderVelocityChart(students, request) {
  const ghToken = localStorage.getItem("Adminerva_github_token");
  if (!ghToken) return renderEmptyChart();

  const dates = [];
  const dateCounts = {};
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];
    dates.push(dateStr);
    dateCounts[dateStr] = 0;
  }

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const sinceIso = thirtyDaysAgo.toISOString();

  const uniqueRepos = new Set();
  students.forEach((s) => {
    if (s.repoUrl && s.repoUrl !== "unassigned") {
      uniqueRepos.add(s.repoUrl.trim().replace(/\/$/, "").replace(".git", ""));
    }
  });

  const fetchPromises = Array.from(uniqueRepos).map(async (url) => {
    try {
      const urlParts = url.split("/");
      const repo = urlParts.pop();
      const owner = urlParts.pop();
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/commits?since=${sinceIso}`,
        {
          headers: {
            Authorization: `Bearer ${ghToken}`,
            Accept: "application/vnd.github+json",
          },
        },
      );
      if (res.ok) {
        const commits = await res.json();
        commits.forEach((c) => {
          const commitDateStr = c.commit.author.date.split("T")[0];
          if (dateCounts[commitDateStr] !== undefined)
            dateCounts[commitDateStr]++;
        });
      }
    } catch (e) {}
  });

  await Promise.all(fetchPromises);
  if (request !== dashboardRequest) return;
  drawChart(
    dates,
    dates.map((d) => dateCounts[d]),
  );
}

function drawChart(labels, data) {
  const ctx = document.getElementById("velocityChart").getContext("2d");
  if (velocityChartInstance) velocityChartInstance.destroy();
  velocityChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Section Commits",
          data: data,
          borderColor: "#4f46e5",
          backgroundColor: "rgba(79, 70, 229, 0.1)",
          borderWidth: 2.5,
          pointBackgroundColor: "#fff",
          pointBorderColor: "#4f46e5",
          pointRadius: 4,
          fill: true,
          tension: 0.4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { precision: 0, color: "#94a3b8" },
          grid: { color: "#f1f5f9" },
          border: { display: false },
        },
        x: {
          ticks: {
            color: "#94a3b8",
            maxTicksLimit: 10,
            callback: function (val) {
              return this.getLabelForValue(val).substring(5);
            },
          },
          grid: { display: false },
          border: { display: false },
        },
      },
    },
  });
}
function renderEmptyChart() {
  drawChart(["No Data"], [0]);
}
