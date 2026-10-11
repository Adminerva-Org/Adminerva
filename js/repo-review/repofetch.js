import { db } from "../core/firebase-core.js";
import {
  collection,
  getDocs,
  doc,
  setDoc,
  getDoc,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const CACHE_VERSION = 7;
let globalStudentsData = {};
let currentClassSection = "";

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

function parseRepoInfo(repoUrl) {
  if (!repoUrl || repoUrl.trim() === "" || repoUrl === "unassigned")
    return null;
  try {
    const cleanUrl = repoUrl
      .trim()
      .replace(/\/$/, "")
      .replace(/\.git$/, "");
    const parts = cleanUrl.split("/");
    const repo = parts.pop();
    const owner = parts.pop();
    return { owner, repo, cleanUrl, groupId: `${owner}_${repo}`.toLowerCase() };
  } catch (e) {
    return null;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  if (!db) return;
  try {
    const snap = await getDocs(collection(db, "students"));
    const select = document.getElementById("sectionSelect");
    let uniqueSections = new Set();
    snap.forEach((d) => {
      if (d.data().section) uniqueSections.add(d.data().section);
    });
    [...uniqueSections]
      .sort()
      .forEach((sec) =>
        select.insertAdjacentHTML(
          "beforeend",
          `<option value="${escapeHTML(sec)}">${escapeHTML(sec)}</option>`,
        ),
      );
  } catch (e) {
    console.error(e);
  }
});

window.fetchAndSyncRepos = async function () {
  const ghToken = localStorage.getItem("Adminerva_github_token");
  if (!ghToken) return alert("Missing GitHub PAT in settings.");

  const section = document.getElementById("sectionSelect").value;
  if (!section) return;
  currentClassSection = section;

  window.showSubtleLoader(`Loading ${section} from database...`);
  globalStudentsData = {};

  try {
    const qStudents = query(
      collection(db, "students"),
      where("section", "==", section),
    );
    const stuSnap = await getDocs(qStudents);
    const repoGroups = {};

    stuSnap.forEach((d) => {
      const student = {
        id: d.id,
        ...d.data(),
        commitCount: 0,
        latestSha: null,
      };
      const repoInfo = parseRepoInfo(student.repoUrl);
      if (!repoInfo) return;

      if (!repoGroups[repoInfo.groupId]) {
        repoGroups[repoInfo.groupId] = {
          ...repoInfo,
          members: [],
          apiError: null,
        };
      }
      repoGroups[repoInfo.groupId].members.push(student);
      globalStudentsData[student.id] = student;
    });

    const groupKeys = Object.keys(repoGroups);

    const cachePromises = groupKeys.map(async (groupId) => {
      const cacheRef = doc(db, "group_repo_cache", groupId);
      const cacheSnap = await getDoc(cacheRef);
      if (cacheSnap.exists()) {
        const cachedData = cacheSnap.data();
        const stats = cachedData.studentStats || {};
        repoGroups[groupId].members.forEach((member) => {
          if (stats[member.id])
            member.commitCount = stats[member.id].count || 0;
          member.latestSha = cachedData.latestSha;
        });
        repoGroups[groupId].latestSha = cachedData.latestSha;
      }
    });

    await Promise.all(cachePromises);
    renderGroupedUI(repoGroups);

    let requiresUIRefresh = false;
    let processed = 0;

    const syncGroup = async (groupId) => {
      const group = repoGroups[groupId];
      try {
        let actualOwner = group.owner;
        let actualRepo = group.repo;

        const repoInfoRes = await fetch(
          `https://api.github.com/repos/${actualOwner}/${actualRepo}`,
          {
            headers: {
              Authorization: `Bearer ${ghToken}`,
              Accept: "application/vnd.github+json",
            },
          },
        );

        if (repoInfoRes.ok) {
          const repoInfo = await repoInfoRes.json();
          actualOwner = repoInfo.owner.login;
          actualRepo = repoInfo.name;
        } else if (repoInfoRes.status === 404) {
          group.apiError = "Private Repo or Broken Link (404)";
          requiresUIRefresh = true;
          processed++;
          window.showSubtleLoader(
            `Syncing GitHub... ${processed}/${groupKeys.length}`,
          );
          return;
        } else if (repoInfoRes.status === 403) {
          group.apiError = "API Rate Limit Reached (403)";
          requiresUIRefresh = true;
          processed++;
          window.showSubtleLoader(
            `Syncing GitHub... ${processed}/${groupKeys.length}`,
          );
          return;
        }

        const res = await fetch(
          `https://api.github.com/repos/${actualOwner}/${actualRepo}/commits?per_page=100`,
          {
            headers: {
              Authorization: `Bearer ${ghToken}`,
              Accept: "application/vnd.github+json",
            },
          },
        );

        if (!res.ok) {
          if (res.status === 409) group.apiError = "Empty Repository (409)";
          else if (res.status === 401)
            group.apiError = "Invalid GitHub Token (401)";
          else group.apiError = `HTTP Error ${res.status}`;
          requiresUIRefresh = true;
          processed++;
          window.showSubtleLoader(
            `Syncing GitHub... ${processed}/${groupKeys.length}`,
          );
          return;
        }

        if (group.apiError !== null) {
          group.apiError = null;
          requiresUIRefresh = true;
        }

        const commits = await res.json();
        if (commits.length === 0) {
          processed++;
          window.showSubtleLoader(
            `Syncing GitHub... ${processed}/${groupKeys.length}`,
          );
          return;
        }

        group.members.forEach((m) => {
          m.latestSha = commits[0].sha;
        });

        if (group.latestSha === commits[0].sha) {
          processed++;
          window.showSubtleLoader(
            `Syncing GitHub... ${processed}/${groupKeys.length}`,
          );
          return;
        }

        requiresUIRefresh = true;
        let updatedStats = {};
        group.members.forEach((m) => {
          updatedStats[m.id] = {
            count: 0,
            additions: 0,
            deletions: 0,
            messages: [],
          };
        });

        commits.forEach((c) => {
          const authorLogin = (c.author?.login || "").toLowerCase().trim();
          const authorEmail = (c.commit?.author?.email || "")
            .toLowerCase()
            .trim();
          const authorName = (c.commit?.author?.name || "")
            .toLowerCase()
            .trim();

          let matchedMember = group.members.find((m) => {
            const dbUser = (m.githubUsername || "").toLowerCase().trim();
            const dbEmail = (m.email || "").toLowerCase().trim();
            if (dbUser && authorLogin === dbUser) return true;
            if (dbEmail && authorEmail === dbEmail) return true;
            return false;
          });

          if (!matchedMember) {
            matchedMember = group.members.find((m) => {
              const dbName = (m.name || "").toLowerCase().trim();
              return (
                dbName &&
                authorName &&
                (dbName === authorName ||
                  authorName.includes(dbName.split(" ")[0]))
              );
            });
          }

          if (matchedMember) {
            updatedStats[matchedMember.id].count++;
            matchedMember.commitCount = updatedStats[matchedMember.id].count;
          }
        });

        const cacheRef = doc(db, "group_repo_cache", groupId);
        await setDoc(
          cacheRef,
          {
            repoUrl: group.cleanUrl,
            latestSha: commits[0].sha,
            studentStats: updatedStats,
            cacheVersion: CACHE_VERSION,
          },
          { merge: true },
        );
      } catch (err) {
        console.warn(`Failed to sync ${group.repo}`, err);
        group.apiError = "Network/Fetch Error";
        requiresUIRefresh = true;
      }
      processed++;
      window.showSubtleLoader(
        `Syncing GitHub... ${processed}/${groupKeys.length}`,
      );
    };

    const batchSize = 3;
    for (let i = 0; i < groupKeys.length; i += batchSize) {
      const batch = groupKeys.slice(i, i + batchSize);
      await Promise.all(batch.map((groupId) => syncGroup(groupId)));
      if (i + batchSize < groupKeys.length) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    if (requiresUIRefresh) {
      window.showSubtleLoader("Applying fresh updates to view...");
      renderGroupedUI(repoGroups);
    }
  } catch (e) {
    alert("Execution Error: " + e.message);
  } finally {
    window.hideSubtleLoader();
  }
};

function renderGroupedUI(repoGroups) {
  const container = document.getElementById("groupsContainer");
  container.innerHTML = "";

  Object.values(repoGroups).forEach((group, index) => {
    let membersHtml = "";
    group.members.forEach((student) => {
      const safeName = escapeHTML(student.name || "Unknown");
      const safeUser = escapeHTML(student.githubUsername || "");
      const commitCount = student.commitCount || 0;

      const profileUrl = safeUser ? `https://github.com/${safeUser}` : "#";
      const commitsUrl = safeUser
        ? `https://github.com/${group.owner}/${group.repo}/commits?author=${safeUser}`
        : `https://github.com/${group.owner}/${group.repo}/commits`;

      membersHtml += `
            <div class="flex flex-col md:flex-row md:items-center justify-between p-4 border-b last:border-0 hover:bg-gray-50 transition gap-4">
                <div>
                    <div class="font-bold text-gray-800">${safeName}</div>
                    <div class="text-xs text-gray-500">${safeUser ? `@${safeUser}` : "No GitHub Linked"} &bull; <span class="${commitCount > 0 ? "text-green-600 font-bold" : "text-red-500"}">${commitCount} Commits Found</span></div>
                </div>
                <div class="flex flex-wrap gap-2">
                    <a href="${profileUrl}" target="_blank" class="${!safeUser ? "pointer-events-none opacity-50" : ""} bg-white text-gray-700 hover:bg-gray-100 border px-3 py-1.5 rounded text-xs font-bold transition shadow-sm">👤 Profile</a>
                    <a href="${commitsUrl}" target="_blank" class="bg-white text-gray-700 hover:bg-gray-100 border px-3 py-1.5 rounded text-xs font-bold transition shadow-sm">🕒 View Commits</a>
                    <button onclick="openGradingModal('${student.id}', '${group.owner}', '${group.repo}')" class="${commitCount > 0 ? "bg-purple-50 text-purple-700 hover:bg-purple-600 hover:text-white border-purple-200" : "bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed"} border px-3 py-1.5 rounded text-xs font-bold transition shadow-sm" ${commitCount > 0 ? "" : "disabled"}>⭐ Grade Work</button>
                </div>
            </div>
        `;
    });

    const errorBadge = group.apiError
      ? `<span class="bg-red-500/10 text-red-400 text-[10px] font-bold px-2 py-0.5 rounded border border-red-500/30 shrink-0">⚠️ ${escapeHTML(group.apiError)}</span>`
      : "";
    const accordionId = `group-content-${index}`;
    const isOpen = index === 0;
    const displayClass = isOpen ? "flex flex-col" : "hidden flex-col";
    const iconTransform = isOpen ? "rotate(180deg)" : "rotate(0deg)";

    const cardHtml = `
        <div class="bg-white border rounded-lg shadow-sm mb-4 overflow-hidden">
            <div class="bg-slate-800 p-4 flex justify-between items-center cursor-pointer hover:bg-slate-700 transition gap-4" onclick="toggleAccordion('${accordionId}')">
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-3 mb-1"><h3 class="font-bold text-white text-lg truncate">${escapeHTML(group.owner)} / ${escapeHTML(group.repo)}</h3>${errorBadge}</div>
                    <a href="${group.cleanUrl}" target="_blank" class="text-xs text-cyan-400 hover:underline truncate block" onclick="event.stopPropagation()">${group.cleanUrl}</a>
                </div>
                <div class="accordion-icon text-slate-300 transform transition-transform duration-200 font-bold shrink-0" id="icon-${accordionId}" style="transform: ${iconTransform}">▼</div>
            </div>
            <div id="${accordionId}" class="${displayClass} accordion-content">${membersHtml}</div>
        </div>
    `;
    container.insertAdjacentHTML("beforeend", cardHtml);
  });

  if (container.innerHTML === "")
    container.innerHTML = `<div class="py-8 text-center text-gray-500 font-bold">No repositories found for this section.</div>`;
}

window.toggleAccordion = function (id) {
  const el = document.getElementById(id);
  const icon = document.getElementById(`icon-${id}`);
  const isCurrentlyHidden = el.classList.contains("hidden");

  document.querySelectorAll(".accordion-content").forEach((content) => {
    content.classList.add("hidden");
    content.classList.remove("flex", "flex-col");
  });
  document.querySelectorAll(".accordion-icon").forEach((icn) => {
    icn.style.transform = "rotate(0deg)";
  });

  if (isCurrentlyHidden) {
    el.classList.remove("hidden");
    el.classList.add("flex", "flex-col");
    icon.style.transform = "rotate(180deg)";
  }
};

window.openGradingModal = async function (studentId, owner, repo) {
  const student = globalStudentsData[studentId];
  if (!student) return;
  const currentStudentSha = student.latestSha;

  document.getElementById("modalStudentName").textContent =
    `${student.name} (@${student.githubUsername || "Unlinked"})`;
  document.getElementById("modalStudentRepo").textContent = `${owner}/${repo}`;
  document.getElementById("gradingModal").classList.remove("hidden");

  const listContainer = document.getElementById("dynamicAssessmentsList");
  listContainer.innerHTML = `<div class="text-center text-gray-400 italic py-4 text-sm"><div class="animate-spin inline-block rounded-full h-4 w-4 border-b-2 border-gray-400 mr-2"></div>Loading assigned tasks...</div>`;

  try {
    const snap = await getDocs(collection(db, "assessments"));
    let activeTasks = [];
    snap.forEach((doc) => {
      const data = doc.data();
      if (data.deployments && Array.isArray(data.deployments)) {
        const sectionDeployment = data.deployments.find(
          (d) => d.section === currentClassSection,
        );
        if (sectionDeployment)
          activeTasks.push({
            id: doc.id,
            deployment: sectionDeployment,
            ...data,
          });
      } else if (data.targetSections && Array.isArray(data.targetSections)) {
        if (data.targetSections.includes(currentClassSection)) {
          activeTasks.push({
            id: doc.id,
            deployment: {
              section: currentClassSection,
              deadline: data.dueDate || new Date().toISOString(),
            },
            ...data,
          });
        }
      }
    });

    if (activeTasks.length === 0) {
      listContainer.innerHTML = `<div class="text-center text-gray-500 py-4 text-sm border-2 border-dashed border-gray-300 rounded">No tasks are currently deployed to ${escapeHTML(currentClassSection)}.</div>`;
      return;
    }

    const gradesQuery = query(
      collection(db, "student_grades"),
      where("studentId", "==", studentId),
    );
    const gradesSnap = await getDocs(gradesQuery);
    const existingGrades = {};
    gradesSnap.forEach((doc) => {
      existingGrades[doc.data().taskId] = doc.data();
    });

    listContainer.innerHTML = "";
    activeTasks.sort(
      (a, b) =>
        new Date(a.deployment.deadline) - new Date(b.deployment.deadline),
    );

    activeTasks.forEach((task) => {
      const taskCardId = `task-card-${studentId}-${task.id}`;
      const gradeRecord = existingGrades[task.id];
      const isUpToDate =
        gradeRecord && gradeRecord.gradedSha === currentStudentSha;

      let actionAreaHtml = "";

      if (isUpToDate) {
        const maxScore = task.maxScore || 20;
        let scoreColor = "text-green-600";
        if (gradeRecord.score < maxScore * 0.75) scoreColor = "text-red-600";
        else if (gradeRecord.score < maxScore * 0.9)
          scoreColor = "text-yellow-600";

        const isPub = gradeRecord.published || false;

        // NEW: Extract and render penalty tags directly into the UI
        let tagsHtml = "";
        const penaltyTags = gradeRecord.penaltyTags || [];
        if (penaltyTags.length > 0) {
          tagsHtml = `<div class="flex flex-wrap gap-1 mb-1 mt-1">
                ${penaltyTags.map((t) => `<span class="bg-rose-50 text-rose-600 text-[8.5px] px-1.5 py-0.5 rounded border border-rose-200 font-extrabold uppercase tracking-wider shadow-sm">${escapeHTML(t)}</span>`).join("")}
            </div>`;
        }

        actionAreaHtml = `
              <div class="flex items-center justify-end gap-3 bg-gray-50 p-2 rounded border border-gray-200 w-full sm:w-[360px] shadow-inner">
                  <div class="text-2xl font-bold ${scoreColor} leading-none ml-2 w-10 text-center">${gradeRecord.score}</div>
                  <div class="flex-1 min-w-0 border-l border-gray-200 pl-3 ml-1">
                      <p class="text-[9px] font-bold text-gray-500 uppercase mb-1 tracking-wider">Up to Date</p>
                      ${tagsHtml}
                      <div class="text-[10px] text-gray-700 leading-relaxed max-h-24 overflow-y-auto pr-1 whitespace-pre-wrap">${escapeHTML(gradeRecord.feedback)}</div>
                  </div>
                  <div class="flex flex-col items-center justify-center border-l border-gray-200 pl-2 shrink-0 w-12">
                      <span id="pub-lbl-${task.id}" class="text-[7px] font-bold ${isPub ? "text-blue-600" : "text-gray-400"} uppercase mb-1 tracking-wider">${isPub ? "Visible" : "Hidden"}</span>
                      <label class="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" class="sr-only peer" ${isPub ? "checked" : ""} onchange="window.togglePublishGrade('${studentId}', '${task.id}', this)">
                        <div class="w-6 h-3.5 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-2.5 after:w-2.5 after:transition-all peer-checked:bg-blue-500"></div>
                      </label>
                  </div>
                  <button onclick="window.startAutoCheck('${studentId}', '${owner}', '${repo}', '${task.id}', '${currentStudentSha}')" class="text-gray-400 hover:text-blue-500 transition px-1 shrink-0 border-l border-gray-200 pl-2 ml-1" title="Force Re-evaluate">🔄</button>
              </div>
          `;
      } else {
        actionAreaHtml = `
              <button onclick="window.startAutoCheck('${studentId}', '${owner}', '${repo}', '${task.id}', '${currentStudentSha}')" class="${gradeRecord ? "bg-amber-500 hover:bg-amber-600" : "bg-purple-600 hover:bg-purple-700"} text-white px-4 py-1.5 rounded text-xs font-bold transition shadow-sm whitespace-nowrap flex items-center gap-2">
                  ✨ ${gradeRecord ? "Evaluate New Commits" : "Run Auto-Check"}
              </button>
          `;
      }
      const pathsArray =
        task.targetPaths || (task.targetPath ? [task.targetPath] : []);
      const formattedTargets =
        pathsArray.length > 0
          ? `Target(s): ${pathsArray.join(", ")}`
          : "Target: Entire Repository";

      const cardHtml = `
            <div id="${taskCardId}" class="p-4 bg-white border ${gradeRecord && !isUpToDate ? "border-amber-400 bg-amber-50/30" : "border-gray-200"} rounded-lg shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 hover:border-blue-300 transition">
                <div class="flex-1">
                    <div class="flex items-center gap-2 mb-1">
                        <span class="bg-blue-50 text-blue-600 border border-blue-200 text-[10px] font-bold px-2 py-0.5 rounded uppercase">${escapeHTML(task.type)}</span>
                        <h4 class="font-bold text-sm text-gray-800">${escapeHTML(task.title)}</h4>
                    </div>
                    <p class="text-[10px] text-gray-500 font-mono truncate" title="${escapeHTML(formattedTargets)}">${escapeHTML(formattedTargets)}</p>
                    <p class="text-[10px] text-red-500 font-bold mt-1">Due: ${new Date(task.deployment.deadline).toLocaleDateString()}</p>
                </div>
                <div class="grade-action-area shrink-0">${actionAreaHtml}</div>
            </div>
        `;
      listContainer.insertAdjacentHTML("beforeend", cardHtml);
    });
  } catch (err) {
    console.error(err);
    listContainer.innerHTML = `<div class="text-center text-red-500 font-bold py-4 text-sm">Failed to load tasks.</div>`;
  }
};

window.closeGradingModal = function () {
  document.getElementById("gradingModal").classList.add("hidden");
};

window.togglePublishGrade = async function (studentId, taskId, checkbox) {
  const gradeDocId = `${studentId}_${taskId}`;
  const label = document.getElementById(`pub-lbl-${taskId}`);

  try {
    await setDoc(
      doc(db, "student_grades", gradeDocId),
      { published: checkbox.checked },
      { merge: true },
    );
    if (label) {
      label.textContent = checkbox.checked ? "Visible" : "Hidden";
      label.className = `text-[7px] font-bold ${checkbox.checked ? "text-blue-600" : "text-gray-400"} uppercase mb-1 tracking-wider`;
    }
  } catch (e) {
    console.error("Failed to publish grade", e);
    alert("Failed to update publish status. Check permissions.");
    checkbox.checked = !checkbox.checked;
  }
};

window.openBulkGradeModal = async function () {
  if (!currentClassSection)
    return alert("Please select a section and click 'Fetch & Sync' first.");

  const studentsToGrade = Object.values(globalStudentsData).filter(
    (s) => s.latestSha && s.repoUrl && s.repoUrl !== "unassigned",
  );
  if (studentsToGrade.length === 0)
    return alert(
      "No valid student repositories found to grade. Please fetch and sync first.",
    );

  window.showSubtleLoader("Loading active assessments...");
  try {
    const snap = await getDocs(collection(db, "assessments"));
    let activeTasks = [];
    snap.forEach((doc) => {
      const data = doc.data();
      if (data.deployments && Array.isArray(data.deployments)) {
        if (data.deployments.some((d) => d.section === currentClassSection))
          activeTasks.push({ id: doc.id, ...data });
      } else if (data.targetSections && Array.isArray(data.targetSections)) {
        if (data.targetSections.includes(currentClassSection))
          activeTasks.push({ id: doc.id, ...data });
      }
    });

    if (activeTasks.length === 0) {
      window.hideSubtleLoader();
      return alert(
        `No active assignments found deployed to ${currentClassSection}.`,
      );
    }

    const select = document.getElementById("bulkAssessmentSelect");
    select.innerHTML = "";
    activeTasks.forEach((t) => {
      select.insertAdjacentHTML(
        "beforeend",
        `<option value="${t.id}">${escapeHTML(t.title)} (${escapeHTML(t.type)})</option>`,
      );
    });

    document.getElementById("bulkGradeModal").classList.remove("hidden");
  } catch (e) {
    alert("Failed to load assessments: " + e.message);
  } finally {
    window.hideSubtleLoader();
  }
};

window.executeBulkGrade = async function () {
  const taskId = document.getElementById("bulkAssessmentSelect").value;
  const taskSelect = document.getElementById("bulkAssessmentSelect");
  const taskName = taskSelect.options[taskSelect.selectedIndex].text;
  const skipGraded = document.getElementById("bulkSkipGraded").checked;

  if (!taskId) return;

  document.getElementById("bulkGradeModal").classList.add("hidden");
  const studentsToGrade = Object.values(globalStudentsData).filter(
    (s) => s.latestSha && s.repoUrl && s.repoUrl !== "unassigned",
  );

  window.showSubtleLoader("Initializing Bulk Grader...");

  let gradedList = [];
  let skippedList = [];
  let failedList = [];

  // ✨ NEW: Start the master timer for the entire bulk run
  const bulkStartTime = performance.now();

  try {
    for (let i = 0; i < studentsToGrade.length; i++) {
      const student = studentsToGrade[i];
      const repoInfo = parseRepoInfo(student.repoUrl);
      if (!repoInfo) continue;

      const gradeDocRef = doc(db, "student_grades", `${student.id}_${taskId}`);
      const gradeSnap = await getDoc(gradeDocRef);

      let shouldSkip = false;
      if (gradeSnap.exists() && skipGraded) {
        shouldSkip = true;
      }

      if (shouldSkip) {
        skippedList.push(student.name);
        continue;
      }

      window.showSubtleLoader(
        `Grading Student ${i + 1} of ${studentsToGrade.length}: ${student.name} (Cooling down API 15s...)`,
      );

      const result = await window.startAutoCheck(
        student.id,
        repoInfo.owner,
        repoInfo.repo,
        taskId,
        student.latestSha,
      );

      if (result && result.success) {
        gradedList.push(student.name);
      } else {
        failedList.push({
          name: student.name,
          reason: result ? result.reason : "Unknown error",
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 15000));
    }

    // ✨ NEW: Calculate total elapsed time and average speed
    const totalSeconds = Math.round((performance.now() - bulkStartTime) / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const timeString = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

    // Only calculate average if we actually graded someone
    const attempts = gradedList.length + failedList.length;
    const avgPerStudent =
      attempts > 0
        ? (totalSeconds / attempts).toFixed(1) + "s / student"
        : "N/A";

    console.log("============= BULK GRADE REPORT =============");
    console.log("🎯 Assessment:", taskName);
    console.log(`⏱️ Elapsed Time: ${timeString} (${avgPerStudent})`);
    console.log(`✅ Graded (${gradedList.length}):`, gradedList);
    console.log(`⏭️ Skipped (${skippedList.length}):`, skippedList);
    console.log(`❌ Failed (${failedList.length}):`, failedList);
    console.log("=============================================");

    document.getElementById("resGradedCount").textContent = gradedList.length;
    document.getElementById("resSkippedCount").textContent = skippedList.length;
    document.getElementById("resFailedCount").textContent = failedList.length;

    const taskNameEl = document.getElementById("resTaskName");
    if (taskNameEl) {
      taskNameEl.textContent = `Target: ${taskName}`;
    }

    // ✨ NEW: Inject the elapsed time into the UI modal
    const elapsedTimeEl = document.getElementById("resElapsedTime");
    if (elapsedTimeEl) {
      elapsedTimeEl.textContent = `⏱️ Run Time: ${timeString} (Avg: ${avgPerStudent})`;
    }

    const failedContainer = document.getElementById("resFailedSection");
    const failedUl = document.getElementById("resFailedList");

    if (failedList.length > 0) {
      failedContainer.classList.remove("hidden");
      failedUl.innerHTML = failedList
        .map(
          (f) => `
            <li class="p-3 hover:bg-rose-50/50 transition flex flex-col gap-1">
                <span class="font-bold text-slate-800 text-sm">${escapeHTML(f.name)}</span>
                <span class="text-[11px] text-rose-500 font-mono bg-rose-50 px-2 py-1 rounded w-fit">${escapeHTML(f.reason)}</span>
            </li>
        `,
        )
        .join("");
    } else {
      failedContainer.classList.add("hidden");
    }

    document.getElementById("bulkResultModal").classList.remove("hidden");
  } catch (e) {
    console.error("Bulk Grading Error", e);
    alert("An error occurred during bulk grading: " + e.message);
  } finally {
    window.hideSubtleLoader();
  }
};
