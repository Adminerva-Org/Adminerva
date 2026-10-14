import { db } from "../core/firebase-core.js";
import { cleanGradeFeedback } from "../core/feedback-format.mjs";
import {
  collection,
  getDocs,
  query,
  where,
  doc,
  setDoc,
  getDoc,
  writeBatch,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

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

let allStudents = [];
let allAssessments = [];

let legacyGradebookInitialized = false;
async function ensureLegacyGradebook() {
  if (legacyGradebookInitialized) return;
  legacyGradebookInitialized = true;
  await loadFilters();
}
window.addEventListener("adminerva:open-legacy-gradebook", ensureLegacyGradebook);
document.addEventListener("DOMContentLoaded", async () => {
  if (!document.getElementById("gbLegacyView")?.classList.contains("hidden")) {
    await ensureLegacyGradebook();
  }
  document
    .getElementById("gbSection")
    .addEventListener("change", updateAssessmentsForSection);
  document.getElementById("gbAssessment").addEventListener("change", loadGrid);
  document.getElementById("gbSort").addEventListener("change", loadGrid);
});

async function loadFilters() {
  window.showSubtleLoader("Initializing Gradebook...");
  try {
    const [stuSnap, assSnap] = await Promise.all([
      getDocs(collection(db, "students")),
      getDocs(collection(db, "assessments")),
    ]);

    let sections = new Set();
    stuSnap.forEach((d) => {
      const data = d.data();
      allStudents.push({ id: d.id, ...data });
      if (data.section) sections.add(data.section);
    });

    const secSelect = document.getElementById("gbSection");
    secSelect.innerHTML =
      "<option value='' disabled selected>Select a section...</option>";
    [...sections]
      .sort()
      .forEach((s) =>
        secSelect.insertAdjacentHTML(
          "beforeend",
          `<option value="${escapeHTML(s)}">${escapeHTML(s)}</option>`,
        ),
      );

    const assSelect = document.getElementById("gbAssessment");
    assSelect.innerHTML =
      "<option value='' disabled selected>Select a section first...</option>";
    assSnap.forEach((d) => {
      allAssessments.push({ id: d.id, ...d.data() });
    });
  } catch (e) {
    console.error("Gradebook Load Error", e);
  } finally {
    window.hideSubtleLoader();
  }
}

async function loadGrid() {
  const section = document.getElementById("gbSection").value;
  const taskId = document.getElementById("gbAssessment").value;
  const tbody = document.getElementById("gbTableBody");

  if (!section || !taskId) return;

  tbody.innerHTML = `<tr><td colspan="4" class="px-6 py-12 text-center"><div class="animate-spin inline-block rounded-full h-6 w-6 border-b-2 border-indigo-600 mb-2"></div><p class="text-slate-400 font-bold text-sm">Crunching data...</p></td></tr>`;

  try {
    const gradesSnap = await getDocs(
      query(collection(db, "student_grades"), where("taskId", "==", taskId)),
    );
    const gradeMap = {};
    gradesSnap.forEach((d) => (gradeMap[d.data().studentId] = d.data()));

    const sortMode = document.getElementById("gbSort").value || "lastName";

    const classStudents = allStudents
      .filter((s) => s.section === section)
      .sort((a, b) => {
        if (sortMode === "needsGrading") {
          const gradeA = gradeMap[a.id];
          const gradeB = gradeMap[b.id];
          if (!gradeA && gradeB) return -1;
          if (gradeA && !gradeB) return 1;
        }
        const getLastName = (name) =>
          name.trim().split(" ").pop().toLowerCase();
        return getLastName(a.name).localeCompare(getLastName(b.name));
      });

    tbody.innerHTML = "";
    const pendingStats = [];

    classStudents.forEach((student) => {
      const grade = gradeMap[student.id];

      let repoStatus = `<span class="text-[10px] bg-rose-50 text-rose-600 font-bold px-2 py-1 rounded border border-rose-200">No Repo Linked</span>`;
      if (student.repoUrl && student.repoUrl !== "unassigned") {
        const cleanRepoUrl = student.repoUrl
          .trim()
          .replace(/\/$/, "")
          .replace(/\.git$/, "");
        const cleanUsername = (student.githubUsername || "")
          .replace(/^@/, "")
          .trim();

        const commitUrl = `${cleanRepoUrl}/commits?author=${cleanUsername}`;
        repoStatus = `
          <div class="flex flex-col gap-1 w-32">
            <a href="${escapeHTML(commitUrl)}" target="_blank" class="text-blue-500 hover:text-blue-700 hover:underline text-center text-xs font-mono bg-blue-50 px-2 py-1 rounded border border-blue-100 transition">View Commits</a>
            <div id="stats-${student.id}" class="text-[10px] text-slate-500 font-medium mt-1">
               <span class="animate-pulse">Loading stats...</span>
            </div>
          </div>
        `;
        pendingStats.push(student);
      }

      let scoreBadge = `<span class="bg-slate-100 text-slate-500 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider border border-slate-200">Needs Grading</span>`;
      let pubToggle = `<span class="text-slate-300 text-xs italic font-medium">Awaiting Score</span>`;

      if (grade) {
        const max = grade.maxScore || 20;
        let sColor =
          grade.score < max * 0.75
            ? "bg-rose-50 text-rose-700 border-rose-200"
            : grade.score < max * 0.9
              ? "bg-amber-50 text-amber-700 border-amber-200"
              : "bg-emerald-50 text-emerald-700 border-emerald-200";

        // NEW: Extract and render penalty tags for the Gradebook matrix UI
        let tagsHtml = "";
        const penaltyTags = grade.penaltyTags || [];
        if (penaltyTags.length > 0) {
          tagsHtml = `<div class="flex flex-wrap gap-1 mb-1 mt-1">
                ${penaltyTags.map((t) => `<span class="bg-rose-50 text-rose-600 text-[8.5px] px-1.5 py-0.5 rounded border border-rose-200 font-extrabold uppercase tracking-wider shadow-sm">${escapeHTML(t)}</span>`).join("")}
            </div>`;
        }

        scoreBadge = `
                    <div class="flex flex-col gap-1 w-64">
                        <span class="${sColor} px-2 py-0.5 rounded text-lg font-extrabold border inline-block w-12 text-center shadow-sm">${grade.score}</span>
                        ${tagsHtml}
                        <p class="text-[10px] text-slate-500 whitespace-normal leading-tight line-clamp-2" title="${escapeHTML(cleanGradeFeedback(grade.feedback))}">${escapeHTML(cleanGradeFeedback(grade.feedback))}</p>
                    </div>
                `;

        const isPub = grade.published || false;
        pubToggle = `
                    <label class="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" class="sr-only peer" ${isPub ? "checked" : ""} onchange="window.matrixTogglePub('${student.id}', '${taskId}', this)">
                        <div class="w-8 h-4 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-indigo-500"></div>
                        <span class="ml-3 text-[10px] font-extrabold uppercase tracking-wider ${isPub ? "text-indigo-600" : "text-slate-400"}">${isPub ? "Visible" : "Hidden"}</span>
                    </label>
                `;
      }

      tbody.insertAdjacentHTML(
        "beforeend",
        `
                <tr class="hover:bg-indigo-50/50 transition">
                    <td class="px-6 py-4">
                        <div class="font-extrabold text-slate-800 text-base">${escapeHTML(student.name)}</div>
                        <div class="text-[10px] text-slate-400 font-mono mt-0.5">@${escapeHTML(student.githubUsername || "unlinked")}</div>
                    </td>
                    <td class="px-6 py-4">${repoStatus}</td>
                    <td class="px-6 py-4">${scoreBadge}</td>
                    <td class="px-6 py-4">${pubToggle}</td>
                </tr>
        `,
      );
    });

    if (classStudents.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="px-6 py-12 text-center text-slate-400 font-medium italic">No students found in this section.</td></tr>`;
      return;
    }

    const studentsNeedingGitHub = [];

    await Promise.all(
      pendingStats.map(async (student) => {
        const statsContainer = document.getElementById(`stats-${student.id}`);
        if (!statsContainer) return;

        const cacheRef = doc(db, "github_stats_cache", student.id);
        try {
          const cacheSnap = await getDoc(cacheRef);
          if (cacheSnap.exists()) {
            const cacheData = cacheSnap.data();
            const cacheAgeHours =
              (Date.now() - cacheData.lastUpdated) / (1000 * 60 * 60);

            if (cacheAgeHours < 4) {
              statsContainer.innerHTML = `
              <div>Total: <span class="font-bold text-slate-800">${cacheData.totalCount}</span></div>
              <div>Recent: <span class="font-bold ${cacheData.recentCount > 0 ? "text-emerald-600" : "text-rose-500"}">${cacheData.recentCount}</span></div>
            `;
              return;
            }
          }
        } catch (e) {
          console.warn("Cache read error for", student.name, e);
        }

        studentsNeedingGitHub.push(student);
      }),
    );

    if (studentsNeedingGitHub.length > 0) {
      const batchSize = 3;
      for (let i = 0; i < studentsNeedingGitHub.length; i += batchSize) {
        const batch = studentsNeedingGitHub.slice(i, i + batchSize);

        await Promise.all(
          batch.map((student) =>
            fetchGitHubStats(student, `stats-${student.id}`),
          ),
        );

        if (i + batchSize < studentsNeedingGitHub.length) {
          await new Promise((r) => setTimeout(r, 250));
        }
      }
    }
  } catch (error) {
    console.error(error);
    tbody.innerHTML = `<tr><td colspan="4" class="px-6 py-12 text-center text-red-500 font-bold border border-red-200 bg-red-50">Failed to load matrix. Check permissions.</td></tr>`;
  }
}

window.matrixTogglePub = async function (studentId, taskId, checkbox) {
  const gradeRef = doc(db, "student_grades", `${studentId}_${taskId}`);
  const wantsPublish = checkbox.checked;
  try {
    const gradeSnap = await getDoc(gradeRef);
    if (!gradeSnap.exists()) throw new Error("Grade does not exist.");
    if (wantsPublish && gradeSnap.data().reviewRequired === true) {
      const verified = window.confirm(
        "This draft requires teacher review. Have you checked the attributed commits, matched files, and deadline limitations before publishing?"
      );
      if (!verified) { checkbox.checked = false; return; }
    }
    await runTransaction(db, async tx => {
      const latest = await tx.get(gradeRef);
      if (!latest.exists()) throw new Error("Grade was removed during publication.");
      tx.update(gradeRef, {
        published: wantsPublish,
        ...(wantsPublish && latest.data().reviewRequired === true
          ? { reviewRequired: false, reviewedAt: serverTimestamp() } : {}),
      });
    });
    const span = checkbox.nextElementSibling.nextElementSibling;
    span.textContent = wantsPublish ? "Visible" : "Hidden";
    span.className = `ml-3 text-[10px] font-extrabold uppercase tracking-wider ${wantsPublish ? "text-indigo-600" : "text-slate-400"}`;
  } catch (e) {
    console.error("Publication failed:", e);
    alert("Failed to update visibility: " + e.message);
    checkbox.checked = !wantsPublish;
  }
};

async function fetchGitHubStats(student, elementId) {
  const statsContainer = document.getElementById(elementId);
  if (!statsContainer) return;

  const ghToken = localStorage.getItem("Adminerva_github_token");
  if (!ghToken) {
    statsContainer.innerHTML = `<span class="text-amber-500 italic text-[10px]">No PAT Configured</span>`;
    return;
  }

  try {
    const cleanUrl = (student.repoUrl || "")
      .trim()
      .replace(/\/$/, "")
      .replace(/\.git$/, "");
    const urlParts = cleanUrl.split("/").filter(Boolean);
    if (urlParts.length < 2) throw new Error("Invalid URL");

    const repo = urlParts.pop();
    const owner = urlParts.pop();
    const author = (student.githubUsername || "").replace(/^@/, "").trim();

    if (!author || author === "unassigned" || author === "unlinked") {
      statsContainer.innerHTML = `<span class="text-slate-400 italic text-[10px]">Unlinked Account</span>`;
      return;
    }

    const headers = {
      Authorization: `Bearer ${ghToken}`,
      Accept: "application/vnd.github+json",
    };

    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/commits?per_page=100`,
      { headers },
    );

    if (!res.ok) {
      if (res.status === 409) {
        statsContainer.innerHTML = `<div>Total: <span class="font-bold text-slate-800">0</span></div><div>Recent: <span class="font-bold text-rose-500">0</span></div>`;
        return;
      }
      throw new Error(`HTTP ${res.status}`);
    }

    const allCommits = await res.json();

    const studentCommits = allCommits.filter((c) => {
      const authorLogin = (c.author?.login || "").toLowerCase().trim();
      const authorEmail = (c.commit?.author?.email || "").toLowerCase().trim();
      const authorName = (c.commit?.author?.name || "").toLowerCase().trim();

      const dbUser = author.toLowerCase();
      const dbEmail = (student.email || "").toLowerCase().trim();
      const dbName = (student.name || "").toLowerCase().trim();

      if (dbUser && authorLogin === dbUser) return true;
      if (dbEmail && authorEmail === dbEmail) return true;
      if (
        dbName &&
        authorName &&
        (dbName === authorName || authorName.includes(dbName.split(" ")[0]))
      )
        return true;

      return false;
    });

    const totalCount = studentCommits.length;

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentCount = studentCommits.filter((c) => {
      const commitDate = c.commit?.author?.date || c.commit?.committer?.date;
      return commitDate && new Date(commitDate) >= sevenDaysAgo;
    }).length;

    statsContainer.innerHTML = `
      <div>Total: <span class="font-bold text-slate-800">${totalCount}</span></div>
      <div>Recent: <span class="font-bold ${recentCount > 0 ? "text-emerald-600" : "text-rose-500"}">${recentCount}</span></div>
    `;

    await setDoc(
      doc(db, "github_stats_cache", student.id),
      {
        totalCount: totalCount,
        recentCount: recentCount,
        lastUpdated: Date.now(),
      },
      { merge: true },
    );
  } catch (error) {
    statsContainer.innerHTML = `<span class="text-rose-500 italic text-[10px]">Stats unavailable</span>`;
    console.warn(`Commit check failed for ${student.name}:`, error.message);
  }
}

function updateAssessmentsForSection() {
  const section = document.getElementById("gbSection").value;
  const assSelect = document.getElementById("gbAssessment");
  const tbody = document.getElementById("gbTableBody");

  assSelect.innerHTML =
    "<option value='' disabled selected>Select an assessment...</option>";
  tbody.innerHTML = `<tr><td colspan="4" class="px-6 py-12 text-center text-slate-400 font-medium italic">Select an Assessment above to load the matrix.</td></tr>`;

  if (!section) return;

  const applicableAssessments = allAssessments.filter((ass) => {
    return (
      Array.isArray(ass.deployments) &&
      ass.deployments.some((d) => d.section === section)
    );
  });

  if (applicableAssessments.length === 0) {
    assSelect.innerHTML =
      "<option value='' disabled selected>No assessments deployed to this section</option>";
    return;
  }

  applicableAssessments.forEach((d) => {
    assSelect.insertAdjacentHTML(
      "beforeend",
      `<option value="${d.id}">${escapeHTML(d.title)} (${escapeHTML(d.type)})</option>`,
    );
  });
}

window.bulkPublishCurrentGrid = async function () {
  const section = document.getElementById("gbSection").value;
  const taskId = document.getElementById("gbAssessment").value;
  const taskSelect = document.getElementById("gbAssessment");

  if (!section || !taskId) {
    return alert("Please select a Class Section and Target Assessment first.");
  }

  const taskName = taskSelect.options[taskSelect.selectedIndex].text;

  if (
    !confirm(
      `Are you sure you want to PUBLISH all grades for "${taskName}"?\n\nStudents in ${section} will immediately see their scores on their dashboard.`,
    )
  ) {
    return;
  }

  window.showSubtleLoader("Publishing Grades...");

  try {
    // 1. Get the list of student IDs for this section
    const sectionStudentIds = new Set(
      allStudents.filter((s) => s.section === section).map((s) => s.id),
    );

    if (sectionStudentIds.size === 0) {
      alert("No students found in this section.");
      return;
    }

    // 2. ONE network call: Fetch all existing grades for this task
    const gradesSnap = await getDocs(
      query(collection(db, "student_grades"), where("taskId", "==", taskId)),
    );

    // 3. Prepare the Firestore batch
    const batch = writeBatch(db);
    let publishedCount = 0;
    let reviewSkippedCount = 0;

    gradesSnap.forEach((gradeDoc) => {
      const data = gradeDoc.data();
      // Only publish if the grade belongs to a student in this section
      if (sectionStudentIds.has(data.studentId)) {
        if (data.reviewRequired === true) {
          reviewSkippedCount++;
          return;
        }
        batch.update(gradeDoc.ref, { published: true });
        publishedCount++;
      }
    });

    if (publishedCount === 0) {
      alert(reviewSkippedCount
        ? `No review-cleared grades to publish. ${reviewSkippedCount} draft(s) require individual teacher review.`
        : "No existing grades found to publish for this task.");
      return;
    }

    // 4. ONE network call: Commit all updates simultaneously
    await batch.commit();

    alert(
      `📢 Publish Complete!\n\nSuccessfully made ${publishedCount} grades visible to students for "${taskName}".${reviewSkippedCount ? `\nSkipped ${reviewSkippedCount} draft(s) pending review.` : ""}`,
    );

    // Refresh UI matrix to reflect visible status
    await loadGrid();
  } catch (e) {
    console.error("Bulk Publish Error", e);
    alert("An error occurred during publishing: " + e.message);
  } finally {
    window.hideSubtleLoader();
  }
};
