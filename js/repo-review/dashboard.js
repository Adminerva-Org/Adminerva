import { db } from "../core/firebase-core.js";
import {
  collection,
  getDocs,
  query,
  where,
  getDoc,
  doc,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

let velocityChartInstance = null;

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
    (match) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[match],
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

document.addEventListener("DOMContentLoaded", () => {
  loadSections();
});

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
        `<option value="${escapeHTML(sec)}">${escapeHTML(sec)}</option>`,
      );
    });

    if (uniqueSections.size > 0) {
      window.loadDashboardData();
    }
  } catch (e) {
    console.error("Failed to load sections", e);
  }
}

window.loadDashboardData = async function () {
  const section = document.getElementById("sectionSelect").value;
  if (!section) return;

  window.showLoader("Analyzing Database Insights...");

  try {
    // 1. Fetch Students in Section
    const qStudents = query(
      collection(db, "students"),
      where("section", "==", section),
    );
    const stuSnap = await getDocs(qStudents);
    const students = [];
    const studentIds = new Set();
    stuSnap.forEach((d) => {
      const s = { id: d.id, ...d.data() };
      students.push(s);
      studentIds.add(d.id);
    });
    document.getElementById("statStudents").textContent = students.length;

    // 2. Fetch Grades (Filter client-side for this section)
    const gradesSnap = await getDocs(collection(db, "student_grades"));
    const sectionGrades = [];
    let totalLatency = 0;
    let latencyCount = 0;

    // Tier Tracking
    let t1 = 0,
      t2 = 0,
      t3 = 0;

    // Penalty Tracking
    const penaltyCounts = {};

    // Assessment Averages Tracking
    const taskAverages = {};

    gradesSnap.forEach((d) => {
      const g = d.data();
      if (studentIds.has(g.studentId)) {
        sectionGrades.push(g);

        // Latency
        if (g.gradingDurationMs) {
          totalLatency += g.gradingDurationMs;
          latencyCount++;
        }

        // Tiers
        const score = g.score || 0;
        if (score >= 15) t1++;
        else if (score >= 10) t2++;
        else t3++;

        // Penalties
        if (g.penaltyTags && Array.isArray(g.penaltyTags)) {
          g.penaltyTags.forEach((tag) => {
            penaltyCounts[tag] = (penaltyCounts[tag] || 0) + 1;
          });
        }

        // Task Averages
        if (!taskAverages[g.taskId])
          taskAverages[g.taskId] = { total: 0, count: 0 };
        taskAverages[g.taskId].total += score;
        taskAverages[g.taskId].count++;
      }
    });

    // Process Top KPI Cards
    document.getElementById("statGrades").textContent = sectionGrades.length;
    const avgMs = latencyCount > 0 ? totalLatency / latencyCount : 0;
    document.getElementById("statAvgTime").textContent =
      avgMs > 0 ? (avgMs / 1000).toFixed(1) + "s" : "N/A";

    // 3. Fetch Group Repos & Repobanks for Equity and Stale Memory
    const cacheSnap = await getDocs(collection(db, "group_repo_cache"));
    const repoCacheMap = {};
    cacheSnap.forEach((d) => (repoCacheMap[d.id] = d.data()));

    const bankSnap = await getDocs(collection(db, "repobank"));
    const repoBankMap = {};
    bankSnap.forEach((d) => (repoBankMap[d.id] = d.data()));

    const groups = {};
    students.forEach((s) => {
      const rid = getRepoId(s.repoUrl);
      if (rid) {
        if (!groups[rid]) groups[rid] = [];
        groups[rid].push(s);
      }
    });

    let staleCount = 0;
    const equityAlerts = [];

    Object.keys(groups).forEach((rid) => {
      const groupMembers = groups[rid];

      // Check Staleness
      const bankData = repoBankMap[rid];
      const cacheData = repoCacheMap[rid];

      if (!bankData) {
        staleCount++; // Never mapped
      } else if (bankData.lastUpdated && cacheData && cacheData.latestSha) {
        // Fallback: Check if it's a Firebase Timestamp or an old date string
        const lastUpdatedTime =
          typeof bankData.lastUpdated.toDate === "function"
            ? bankData.lastUpdated.toDate().getTime()
            : new Date(bankData.lastUpdated).getTime();

        // We consider it stale if the repobank hasn't been updated in 14 days
        const bankAgeDays =
          (Date.now() - lastUpdatedTime) / (1000 * 60 * 60 * 24);
        if (bankAgeDays > 14) staleCount++;
      }
      // Check Team Equity (Groups > 1 member)
      if (groupMembers.length > 1 && cacheData && cacheData.studentStats) {
        let totalGroupCommits = 0;
        const memberCommits = [];

        groupMembers.forEach((m) => {
          const stats = cacheData.studentStats[m.id];
          const count = stats ? stats.count : 0;
          totalGroupCommits += count;
          memberCommits.push({ name: m.name, count: count });
        });

        // Only analyze active repos to avoid noise
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

    document.getElementById("statStaleMemory").textContent = staleCount;

    // Render Sub-Panels
    renderTiers(t1, t2, t3, sectionGrades.length);
    renderPenalties(penaltyCounts, sectionGrades.length);
    await renderTaskAverages(taskAverages);
    renderEquityAlerts(equityAlerts);

    // 4. Fetch GitHub Velocity Data
    if (students.length > 0) {
      window.showLoader("Fetching 30-Day Commit Velocity...");
      await renderVelocityChart(students);
    } else {
      renderEmptyChart();
    }
  } catch (e) {
    alert("Dashboard Error: " + e.message);
    console.error(e);
  } finally {
    window.hideLoader();
  }
};

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
        <div class="flex justify-between text-xs font-bold text-slate-600"><span>Tier 1 (Proficient)</span><span>${p1}%</span></div>
        <div class="w-full bg-slate-100 rounded-full h-2.5 shadow-inner"><div class="bg-emerald-500 h-2.5 rounded-full" style="width: ${p1}%"></div></div>
        <div class="text-[9px] text-slate-400 text-right">${t1} Submissions (Score 15-20)</div>
    </div>
    <div class="flex flex-col gap-1 mt-2">
        <div class="flex justify-between text-xs font-bold text-slate-600"><span>Tier 2 (Developing)</span><span>${p2}%</span></div>
        <div class="w-full bg-slate-100 rounded-full h-2.5 shadow-inner"><div class="bg-amber-400 h-2.5 rounded-full" style="width: ${p2}%"></div></div>
        <div class="text-[9px] text-slate-400 text-right">${t2} Submissions (Score 10-14)</div>
    </div>
    <div class="flex flex-col gap-1 mt-2">
        <div class="flex justify-between text-xs font-bold text-slate-600"><span>Tier 3 (Critical)</span><span>${p3}%</span></div>
        <div class="w-full bg-slate-100 rounded-full h-2.5 shadow-inner"><div class="bg-rose-500 h-2.5 rounded-full" style="width: ${p3}%"></div></div>
        <div class="text-[9px] text-slate-400 text-right">${t3} Submissions (Score <10)</div>
    </div>
  `;
}

function renderPenalties(penaltyCounts, totalGrades) {
  const list = document.getElementById("penaltyList");
  const sorted = Object.entries(penaltyCounts).sort((a, b) => b[1] - a[1]);

  if (sorted.length === 0) {
    list.innerHTML =
      '<div class="text-center text-xs text-emerald-500 font-bold italic mt-4">Clean code! No diagnostic penalties found.</div>';
    return;
  }

  list.innerHTML = "";
  sorted.forEach(([tag, count], index) => {
    const percentage = Math.round((count / totalGrades) * 100);
    const colorClass =
      index < 2
        ? "bg-rose-50 text-rose-700 border-rose-200"
        : "bg-amber-50 text-amber-700 border-amber-200";

    list.insertAdjacentHTML(
      "beforeend",
      `
      <div class="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg">
        <div class="flex items-center gap-2">
           <span class="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded border ${colorClass}">${escapeHTML(tag)}</span>
        </div>
        <div class="text-right flex flex-col">
          <span class="font-bold text-slate-700 text-sm">${count}</span>
          <span class="text-[9px] text-slate-400 font-bold tracking-wider">${percentage}% of grades</span>
        </div>
      </div>
    `,
    );
  });
}

async function renderTaskAverages(taskAverages) {
  const list = document.getElementById("criteriaList");
  const taskIds = Object.keys(taskAverages);

  if (taskIds.length === 0) {
    list.innerHTML =
      '<div class="text-center text-xs text-slate-400 italic mt-4">No assessments graded yet.</div>';
    return;
  }

  // Fetch assessment titles
  const assSnap = await getDocs(collection(db, "assessments"));
  const taskNames = {};
  assSnap.forEach((d) => (taskNames[d.id] = d.data().title || "Unknown Task"));

  const sortedTasks = taskIds
    .map((id) => {
      return {
        name: taskNames[id] || id,
        avg: taskAverages[id].total / taskAverages[id].count,
      };
    })
    .sort((a, b) => a.avg - b.avg); // Lowest scores first (weaknesses)

  list.innerHTML = "";
  sortedTasks.forEach((task, index) => {
    let colorClass = "text-emerald-600 bg-emerald-50";
    if (task.avg < 10) colorClass = "text-rose-600 bg-rose-50";
    else if (task.avg < 15) colorClass = "text-amber-600 bg-amber-50";

    list.insertAdjacentHTML(
      "beforeend",
      `
      <div class="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg">
        <span class="font-bold text-slate-700 text-xs truncate max-w-[200px]" title="${escapeHTML(task.name)}">${escapeHTML(task.name)}</span>
        <span class="font-black text-sm px-2 py-0.5 rounded border border-transparent ${colorClass}">${task.avg.toFixed(1)} / 20</span>
      </div>
    `,
    );
  });
}

function renderEquityAlerts(alerts) {
  const list = document.getElementById("equityList");
  if (alerts.length === 0) {
    list.innerHTML =
      '<div class="text-center text-xs text-emerald-500 font-bold italic mt-4">All groups show balanced commit distributions.</div>';
    return;
  }

  list.innerHTML = "";
  alerts.forEach((alert) => {
    list.insertAdjacentHTML(
      "beforeend",
      `
      <div class="p-3 bg-rose-50/50 border border-rose-200 rounded-lg flex flex-col gap-2">
        <div class="flex justify-between items-center border-b border-rose-100 pb-2">
          <span class="font-bold text-slate-800 text-xs truncate">${escapeHTML(alert.repoId)}</span>
          <span class="text-[9px] text-rose-500 font-black uppercase tracking-wider bg-rose-100 px-1.5 py-0.5 rounded">High Disparity</span>
        </div>
        <div class="flex justify-between text-xs">
          <div class="flex flex-col"><span class="text-[9px] text-slate-400 uppercase">Top Contributor</span><span class="font-bold text-slate-700">${escapeHTML(alert.top.name)} (${alert.top.count})</span></div>
          <div class="flex flex-col text-right"><span class="text-[9px] text-slate-400 uppercase">Bottom Contributor</span><span class="font-bold text-rose-600">${escapeHTML(alert.bottom.name)} (${alert.bottom.count})</span></div>
        </div>
      </div>
    `,
    );
  });
}

async function renderVelocityChart(students) {
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

  // Deduplicate repos to prevent double-counting team commits
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
          if (dateCounts[commitDateStr] !== undefined) {
            dateCounts[commitDateStr]++;
          }
        });
      }
    } catch (e) {
      console.warn("Chart fetch error for repo:", url);
    }
  });

  await Promise.all(fetchPromises);

  const dataPoints = dates.map((d) => dateCounts[d]);
  drawChart(dates, dataPoints);
}

function drawChart(labels, data) {
  const ctx = document.getElementById("velocityChart").getContext("2d");

  if (velocityChartInstance) {
    velocityChartInstance.destroy();
  }

  velocityChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Total Section Commits",
          data: data,
          borderColor: "#4f46e5", // Indigo-600
          backgroundColor: "rgba(79, 70, 229, 0.1)",
          borderWidth: 2.5,
          pointBackgroundColor: "#fff",
          pointBorderColor: "#4f46e5",
          pointRadius: 4,
          pointHoverRadius: 6,
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
