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

const CACHE_VERSION = 8; // Changes attribution and rejects mixed legacy cache documents
const initialScope=new URLSearchParams(location.search);
if(initialScope.get("embedded")==="1")document.getElementById("adminerva-nav")?.remove();

let repoGroups = {};
let studentStatsMap = {};

window.showLoader = function (msg, subMsg = "") {
  document.getElementById("loaderMessage").textContent = msg;
  document.getElementById("loaderSubMessage").textContent = subMsg;
  document.getElementById("globalLoader").classList.remove("hidden");
};
window.hideLoader = function () {
  document.getElementById("globalLoader").classList.add("hidden");
};

function escapeHTML(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

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

document.addEventListener("DOMContentLoaded", async () => {
  if (!db) return;
  loadSections();
});

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
    if([...select.options].some(option=>option.value===initialScope.get("section")))
      select.value=initialScope.get("section");
  } catch (e) {
    console.error(e);
  }
}

window.fetchGroupRepos = async function () {
  const ghToken = localStorage.getItem("Adminerva_github_token");
  if (!ghToken) return alert("Missing GitHub PAT. Configure it in settings.");

  const section = document.getElementById("sectionSelect").value;
  window.showLoader(`Initializing Fetch...`, `Gathering student data`);

  try {
    const qStudents = query(
      collection(db, "students"),
      where("section", "==", section),
    );
    const stuSnap = await getDocs(qStudents);

    repoGroups = {};
    studentStatsMap = {};

    stuSnap.forEach((d) => {
      const student = { id: d.id, ...d.data() };
      const rawUrl = student.repoUrl
        ? student.repoUrl.trim().replace(/\/$/, "")
        : "unassigned";

      const groupId =
        rawUrl !== "unassigned" ? getRepoId(rawUrl) : "unassigned";

      if (!repoGroups[groupId])
        repoGroups[groupId] = { url: rawUrl, members: [], apiError: null };
      repoGroups[groupId].members.push(student);

      studentStatsMap[student.id] = {
        name: student.name,
        email: student.email,
        repoUrl: rawUrl,
        githubUsername: (student.githubUsername || "").toLowerCase().trim(),
        count: 0,
        additions: 0,
        deletions: 0,
        messages: [],
        patches: "",
      };
    });

    const validGroupIds = Object.keys(repoGroups).filter(
      (id) => id !== "unassigned" && id !== "unknown_repo",
    );
    let processed = 0;

    const fetchPromises = validGroupIds.map(async (groupId) => {
      const group = repoGroups[groupId];
      let url = group.url;

      try {
        const parsedUrl = new URL(url);
        const match = parsedUrl.pathname.match(
          /\/([^/]+)\/([^/]+?)(?:\.git|\/)?$/,
        );
        if (!match) throw new Error("Invalid GitHub URL format");
        let owner = match[1];
        let repo = match[2];

        try {
          const repoInfoRes = await fetch(
            `https://api.github.com/repos/${owner}/${repo}`,
            { headers: { Authorization: `Bearer ${ghToken}` } },
          );

          if (repoInfoRes.ok) {
            const repoInfo = await repoInfoRes.json();
            const actualUrl = repoInfo.html_url + ".git";

            if (
              url.toLowerCase() !== actualUrl.toLowerCase() &&
              url.toLowerCase() !== repoInfo.html_url.toLowerCase()
            ) {
              const updatePromises = group.members.map((m) =>
                setDoc(
                  doc(db, "students", m.id),
                  { repoUrl: actualUrl },
                  { merge: true },
                ),
              );
              await Promise.all(updatePromises);

              owner = repoInfo.owner.login;
              repo = repoInfo.name;
              url = actualUrl;
              group.url = actualUrl; // Sync group url
            }
          }
        } catch (autoUpdateError) {
          console.warn("Failed to check for repo renames", autoUpdateError);
        }

        const cacheRef = doc(db, "group_repo_cache", groupId);
        const cacheSnap = await getDoc(cacheRef);
        const cachedData = cacheSnap.exists() ? cacheSnap.data() : {};
        let commitsCache = cachedData.cacheVersion === CACHE_VERSION
          ? (cachedData.commitsCache || {}) : {};
        const currentCommits = [];
        let historyComplete = false;
        for (let page = 1; page <= 20; page++) {
          const res = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/commits?per_page=100&page=${page}`,
            { headers: { Authorization: `Bearer ${ghToken}`, Accept: "application/vnd.github+json" } },
          );
          if (!res.ok) throw new Error(`GitHub history HTTP ${res.status}, page ${page}`);
          const pageCommits = await res.json();
          if (!Array.isArray(pageCommits)) throw new Error("Invalid GitHub history response");
          currentCommits.push(...pageCommits);
          if (pageCommits.length < 100) { historyComplete = true; break; }
        }
        if (!historyComplete) throw new Error("Commit history exceeds scan limit; counts are not reliable.");
        if (currentCommits.length === 0) return;

        if (
          cachedData.latestSha === currentCommits[0].sha &&
          cachedData.studentStats &&
          cachedData.cacheVersion === CACHE_VERSION
        ) {
          group.members.forEach((m) => {
            if (cachedData.studentStats[m.id]) {
              studentStatsMap[m.id] = cachedData.studentStats[m.id];
            }
          });
          processed++;
          window.showLoader(
            `Syncing Repositories`,
            `Completed ${processed} of ${validGroupIds.length}`,
          );
          return;
        }

        let tempStats = {};
        group.members.forEach((m) => {
          tempStats[m.id] = { ...studentStatsMap[m.id] };
        });

        for (let c of currentCommits) {
          if (Array.isArray(c.parents) && c.parents.length > 1) continue;
          const authorLogin = String(c.author?.login || "").toLowerCase().trim();
          if (!authorLogin) continue;
          const candidates = group.members.filter(m =>
            String(m.githubUsername || "").toLowerCase().trim().replace(/^@/, "") === authorLogin
          );
          if (candidates.length !== 1) continue;
          const member = candidates[0];
          if (member) {
            const stats = tempStats[member.id];
            stats.count++;

            let commitDetail = commitsCache[c.sha];

            if (!commitDetail && stats.count <= 10) {
              const detailRes = await fetch(
                `https://api.github.com/repos/${owner}/${repo}/commits/${c.sha}`,
                { headers: { Authorization: `Bearer ${ghToken}` } },
              );

              if (detailRes.ok) {
                const detail = await detailRes.json();
                let patchData = "";
                if (detail.files) {
                  detail.files.forEach((file) => {
                    if (file.patch)
                      patchData += `--- ${file.filename} ---\n${file.patch}\n`;
                  });
                }

                commitDetail = {
                  message: c.commit.message,
                  date: c.commit.author.date,
                  additions: detail.stats?.additions || 0,
                  deletions: detail.stats?.deletions || 0,
                  patch: patchData.substring(0, 3500),
                };

                commitsCache[c.sha] = commitDetail;
              }
            } else if (!commitDetail) {
              commitDetail = {
                message: c.commit.message,
                date: c.commit.author.date,
                additions: 0,
                deletions: 0,
                patch: "",
              };
            }

            if (commitDetail) {
              const dateStr = new Date(commitDetail.date).toLocaleDateString();
              stats.messages.push(`${dateStr} - ${commitDetail.message}`);
              stats.additions += commitDetail.additions;
              stats.deletions += commitDetail.deletions;
              if (commitDetail.patch)
                stats.patches += `\n\n### COMMIT: "${commitDetail.message}"\n${commitDetail.patch}`;
            }
          }
        }

        group.members.forEach((m) => {
          studentStatsMap[m.id] = tempStats[m.id];
        });

        await setDoc(
          cacheRef,
          {
            repoUrl: url,
            latestSha: currentCommits[0].sha,
            commitsCache: commitsCache,
            studentStats: tempStats,
            cacheVersion: CACHE_VERSION,
          },
          { merge: true },
        );

        processed++;
        window.showLoader(
          `Syncing Repositories`,
          `Completed ${processed} of ${validGroupIds.length}`,
        );
      } catch (err) {
        group.apiError = "Network/Fetch Error";
        processed++;
        window.showLoader(
          `Syncing Repositories`,
          `Completed ${processed} of ${validGroupIds.length}`,
        );
      }
    });

    await Promise.all(fetchPromises);
    renderGroupsUI();
  } catch (e) {
    alert(e.message);
  } finally {
    window.hideLoader();
  }
};

function renderGroupsUI() {
  const container = document.getElementById("groupsContainer");
  container.innerHTML = "";

  Object.entries(repoGroups).forEach(([groupId, groupData]) => {
    if (groupId === "unassigned") return;

    let groupName = "Unknown Repo";
    try {
      const parsedUrl = new URL(groupData.url);
      groupName = parsedUrl.pathname.split("/").pop().replace(".git", "");
    } catch (e) {}

    groupName = escapeHTML(groupName);
    const safeUrl = escapeHTML(groupData.url);

    const errorBadge = groupData.apiError
      ? `<span class="bg-red-500/10 text-red-500 text-[10px] font-bold px-2 py-0.5 rounded border border-red-500/30 shrink-0">⚠️ ${escapeHTML(groupData.apiError)}</span>`
      : "";

    let membersHtml = "";
    groupData.members.forEach((student) => {
      const stats = studentStatsMap[student.id];
      const hasCommits = stats.count > 0;
      const safeName = escapeHTML(student.name);
      const safeGithub = escapeHTML(student.githubUsername || "?");

      membersHtml += `
        <div class="flex items-center justify-between py-3 border-b border-gray-100 last:border-0 hover:bg-gray-50 transition px-2 rounded">
          <div>
            <div class="font-bold text-gray-800 text-sm flex items-center gap-2">
              ${safeName} 
              <span class="text-[10px] text-gray-400 font-normal">(@${safeGithub})</span>
            </div>
            <div class="text-[10px] font-mono mt-1 ${hasCommits ? "text-gray-600" : "text-red-500 font-bold"}">
               Total Commits: ${stats.count}
            </div>
          </div>
          <button onclick="openStudentDetails('${student.id}')" class="${hasCommits ? "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-600 hover:text-white" : "bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed"} border px-4 py-1.5 rounded text-xs font-bold transition shadow-sm" ${hasCommits ? "" : "disabled"}>
            🔍 Inspect
          </button>
        </div>
      `;
    });

    const card = `
      <div class="bg-white border border-gray-200 rounded-lg shadow-sm flex flex-col mb-5">
        <div class="bg-gray-50 border-b border-gray-200 p-4 rounded-t-lg flex justify-between items-center gap-4">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-3 mb-1">
                <h3 class="font-bold text-gray-800 truncate" title="${groupName}">${groupName}</h3>
                ${errorBadge}
            </div>
            <a href="${safeUrl}" target="_blank" class="text-[10px] text-blue-500 hover:underline truncate block">${safeUrl}</a>
          </div>
        </div>
        <div class="p-2 flex-1">
          ${membersHtml}
        </div>
      </div>
    `;
    container.insertAdjacentHTML("beforeend", card);
  });

  if (container.innerHTML === "") {
    container.innerHTML = `<div class="col-span-full py-8 text-center text-gray-500 font-bold">No valid repositories found for this section.</div>`;
  }
}

window.openStudentDetails = function (studentId) {
  const stats = studentStatsMap[studentId];
  if (!stats || stats.count === 0) return;

  document.getElementById("detailsTitle").textContent =
    `Inspection: ${stats.name}`;
  document.getElementById("detailsRepoLink").textContent = stats.repoUrl;
  document.getElementById("detCommits").textContent = stats.count;
  document.getElementById("detAdded").textContent = "+" + stats.additions;
  document.getElementById("detDeleted").textContent = "-" + stats.deletions;

  const commitList = document.getElementById("detCommitList");
  commitList.innerHTML = "";
  stats.messages.forEach((msg) => {
    const li = document.createElement("li");
    li.textContent = msg;
    commitList.appendChild(li);
  });

  document.getElementById("detCodeBlock").textContent =
    stats.patches || "No detailed file changes available.";
  document.getElementById("detailsModal").classList.remove("hidden");
};

window.closeDetailsModal = function () {
  document.getElementById("detailsModal").classList.add("hidden");
};
