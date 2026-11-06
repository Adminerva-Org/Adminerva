/** Assessment authoring, repository evidence, individual review and protected grading: temp activity grader. */
import { db } from "../core/firebase-core.js?v=1.3.0";
import {
  collection,
  getDocs,
  doc,
  setDoc,
  query,
  where,
} from "../core/teaching-firestore.mjs?v=1.3.0";

let currentStudents = [];
let commitDataMap = {};
let firestoreGradesMap = {};

window.showLoader = function (msg) {
  window.showSubtleLoader?.(msg);
};
window.hideLoader = function () {
  window.hideSubtleLoader?.();
};

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

document.addEventListener("DOMContentLoaded", async () => {
  if (!db) return;
  loadSections();
});

window.clearTable = function () {
  document.getElementById("gradingTableBody").innerHTML =
    `<tr><td colspan="4" class="py-8 text-center text-gray-400 italic">Target changed. Fetch repositories again.</td></tr>`;
};

async function loadSections() {
  try {
    const snap = await getDocs(collection(db, "students"));
    const select = document.getElementById("sectionSelect");
    select.innerHTML = "";
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
}

window.fetchSectionCommits = async function () {
  const ghToken = localStorage.getItem("Adminerva_github_token");
  if (!ghToken) return alert("Missing GitHub PAT.");

  const section = document.getElementById("sectionSelect").value;
  const activity = document.getElementById("activitySelect").value;

  window.showLoader(`Fetching students and repos...`);
  try {
    const qStudents = query(
      collection(db, "students"),
      where("section", "==", section),
    );
    const stuSnap = await getDocs(qStudents);
    currentStudents = [];
    stuSnap.forEach((d) => currentStudents.push({ id: d.id, ...d.data() }));

    // Fetch from NEW collection to protect AI data
    firestoreGradesMap = {};
    const qGrades = query(
      collection(db, "activity_grades"),
      where("section", "==", section),
      where("activity", "==", activity),
    );
    const gradeSnap = await getDocs(qGrades);
    gradeSnap.forEach((d) => {
      firestoreGradesMap[d.data().studentId] = { docId: d.id, ...d.data() };
    });

    commitDataMap = {};
    for (let student of currentStudents) {
      commitDataMap[student.id] = {
        count: 0,
        latestMsg: "No commits",
        patches: "",
        error: null,
      };
      if (!student.repoUrl) {
        commitDataMap[student.id].error = "Missing Repo URL";
        continue;
      }

      try {
        // 🔒 Security Patch: Native URL parsing to sanitize URL substrings
        let repo, owner;
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
          continue;
        }

        // Fetching latest 15 commits generally, rather than strict date bounding
        const response = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/commits?per_page=15`,
          {
            headers: {
              Authorization: `Bearer ${ghToken}`,
              Accept: "application/vnd.github+json",
            },
          },
        );

        if (!response.ok) {
          commitDataMap[student.id].error =
            response.status === 409 ? "Empty Repo" : `Error ${response.status}`;
          continue;
        }

        let commits = await response.json();
        const ghUsername = (student.githubUsername || "").toLowerCase().trim();
        commits = commits.filter(
          (c) => (c.author?.login || "").toLowerCase() === ghUsername,
        );

        commitDataMap[student.id].count = commits.length;
        if (commits.length > 0) {
          commitDataMap[student.id].allMsgs = commits.map(
            (c) => c?.commit?.message,
          );

          // Fetch details for the last 3 commits to see recent code changes
          for (let i = 0; i < Math.min(commits.length, 3); i++) {
            const detailRes = await fetch(
              `https://api.github.com/repos/${owner}/${repo}/commits/${commits[i].sha}`,
              { headers: { Authorization: `Bearer ${ghToken}` } },
            );
            if (detailRes.ok) {
              const detail = await detailRes.json();
              commitDataMap[student.id].patches +=
                `\n\n### MSG: "${commits[i]?.commit?.message}"\n`;
              if (detail.files)
                detail.files.forEach((file) => {
                  if (file.patch)
                    commitDataMap[student.id].patches +=
                      `--- ${file.filename} ---\n${file.patch}\n`;
                });
            }
          }
        }
      } catch (err) {
        commitDataMap[student.id].error = "Network Error";
      }
    }
    renderGradingTable();
  } catch (e) {
    alert(e.message);
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
    const currentScore = dbGrade ? dbGrade.score : "";

    // 🔒 Security Patch: Sanitize all text before placing it into the DOM
    const maxScore = escapeHTML(document.getElementById("maxScoreInput").value);
    const safeName = escapeHTML(student.name);
    const safeUrl = escapeHTML(student.repoUrl || "N/A");
    const safeError = escapeHTML(ghData.error || "");
    const safeStudentId = escapeHTML(student.id);

    let reviewBtn =
      ghData.count > 0
        ? `<button onclick="openDetails('${safeStudentId}')" class="bg-gray-100 border border-gray-300 font-semibold px-3 py-1.5 rounded text-xs hover:bg-gray-200 shadow-sm">📄 Inspect</button>`
        : `<span class="text-gray-400 text-xs italic">No code to view</span>`;

    const tr = `
        <tr class="border-b hover:bg-gray-50">
            <td class="py-3 px-2 align-middle">
                <div class="font-bold text-gray-800 text-sm">${safeName}</div>
                <a href="${safeUrl}" target="_blank" class="text-[10px] text-blue-600 hover:underline truncate w-40 block">${safeUrl}</a>
            </td>
            <td class="py-3 px-2 text-center align-middle font-bold ${ghData.error ? "text-red-500" : "text-green-600"}">
                ${safeError || ghData.count}
            </td>
            <td class="py-3 px-2 text-center align-middle">${reviewBtn}</td>
            <td class="py-3 px-2 align-middle">
                <div class="flex items-center gap-2">
                    <input type="number" id="score_${safeStudentId}" value="${currentScore}" class="w-16 p-1.5 border rounded text-center font-bold focus:ring-blue-500 ${currentScore !== "" ? "bg-green-50 border-green-300" : ""}" placeholder="0">
                    <span class="text-sm text-gray-500 font-bold">/ ${maxScore}</span>
                    <button onclick="saveManualGrade('${safeStudentId}')" class="bg-blue-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-blue-700 shadow-sm">Save</button>
                </div>
            </td>
        </tr>
    `;
    tbody.insertAdjacentHTML("beforeend", tr);
  });
}

window.saveManualGrade = async function (studentId) {
  const scoreInput = document.getElementById(`score_${studentId}`).value;
  if (scoreInput === "") return alert("Please enter a valid score.");

  const score = parseInt(scoreInput);
  const maxScore = parseInt(document.getElementById("maxScoreInput").value);
  const student = currentStudents.find((s) => s.id === studentId);
  const activity = document.getElementById("activitySelect").value;
  const gradeDocId = `${student.id}_${activity}`;

  window.showLoader(`Saving score...`);
  try {
    const dbEntry = {
      studentId: student.id,
      section: student.section,
      githubUsername: student.githubUsername,
      activity: activity,
      score: score,
      maxScore: maxScore,
      gradedAt: new Date().toISOString(),
    };

    await setDoc(doc(db, "activity_grades", gradeDocId), dbEntry, {
      merge: true,
    });

    const inputField = document.getElementById(`score_${studentId}`);
    inputField.classList.add("bg-green-50", "border-green-300");
  } catch (err) {
    alert("Database save failed: " + err.message);
  } finally {
    window.hideLoader();
  }
};

window.openDetails = function (studentId) {
  const student = currentStudents.find((s) => s.id === studentId);
  const data = commitDataMap[studentId];
  if (!student || !data) return;

  document.getElementById("detailsTitle").textContent =
    `${student.name}'s Recent Code`;

  // 🔒 Security Patch: Create DOM nodes strictly as text content to neutralize executable scripts
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
