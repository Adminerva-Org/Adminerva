/** Assessment authoring, repository evidence, individual review and protected grading: repobank. */
import { db } from "../core/firebase-core.js";
import {
  collection,
  getDocs,
  query,
  where,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

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

window.showLoader = function (msg = "Processing...") {
  if (typeof window.showSubtleLoader === "function")
    window.showSubtleLoader(msg);
};
window.hideLoader = function () {
  if (typeof window.hideSubtleLoader === "function") window.hideSubtleLoader();
};

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
      window.loadRepobankData();
    }
  } catch (e) {
    console.error("Failed to load sections", e);
  }
}

function getRepoId(repoUrl) {
  try {
    const parts = repoUrl.replace(/\/$/, "").replace(".git", "").split("/");
    return `${parts[parts.length - 2]}_${parts[parts.length - 1]}`;
  } catch (e) {
    return "unknown_repo";
  }
}

let activeSectionStudents = [];

window.loadRepobankData = async function () {
  const section = document.getElementById("sectionSelect").value;
  const container = document.getElementById("repobankContainer");
  if (!section) return;

  window.showLoader("Accessing Long-Term Memory...");
  container.innerHTML = "";

  try {
    const qStudents = query(
      collection(db, "students"),
      where("section", "==", section),
    );
    const stuSnap = await getDocs(qStudents);
    activeSectionStudents = [];
    stuSnap.forEach((d) =>
      activeSectionStudents.push({ id: d.id, ...d.data() }),
    );

    if (activeSectionStudents.length === 0) {
      container.innerHTML = `<div class="text-gray-500 italic font-medium col-span-full">No students found in this section.</div>`;
      return window.hideLoader();
    }

    const uniqueRepos = new Map();
    activeSectionStudents.forEach((student) => {
      if (student.repoUrl && student.repoUrl !== "unassigned") {
        const id = getRepoId(student.repoUrl);
        if (!uniqueRepos.has(id)) {
          uniqueRepos.set(id, { url: student.repoUrl, members: [] });
        }
        uniqueRepos.get(id).members.push(student);
      }
    });

    if (uniqueRepos.size === 0) {
      container.innerHTML = `<div class="text-gray-500 italic font-medium col-span-full">No valid repositories linked in this section.</div>`;
      return window.hideLoader();
    }

    for (const [repoId, repoData] of uniqueRepos.entries()) {
      try {
        const snap = await getDoc(doc(db, "repobank", repoId));
        let concept =
          "Awaiting system processing. Click 'Update Memory' to initialize.";
        let feedback = "No group feedback generated yet.";
        let lastUpdated = "Never";

        let owner = "";
        let repoName = "Unknown Repo";
        try {
          const parts = repoData.url
            .replace(/\/$/, "")
            .replace(".git", "")
            .split("/");
          repoName = parts.pop();
          owner = parts.pop();
        } catch (e) {}

        let membersData = {};

        if (snap.exists()) {
          const data = snap.data();
          concept = data.concept || concept;
          feedback = data.feedback || feedback;
          membersData = data.members || {};
          if (data.lastUpdated) {
            lastUpdated = new Date(
              data.lastUpdated.toDate
                ? data.lastUpdated.toDate()
                : data.lastUpdated,
            ).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });
          }
        }

        let membersHtml = `<div class="mt-4 space-y-3">`;
        repoData.members.forEach((student) => {
          const memAI = membersData[student.id] || {};
          const overall =
            memAI.overallContribution || "No overall role recorded.";
          const recent =
            memAI.recentContribution || "No recent activity logged.";

          membersHtml += `
                <div class="bg-gray-50 border border-gray-200 p-3 rounded-lg shadow-sm">
                   <h5 class="font-bold text-gray-800 text-sm mb-2">${escapeHTML(student.name)} <span class="text-[10px] font-normal text-gray-500 font-mono">(@${escapeHTML(student.githubUsername || "unlinked")})</span></h5>
                   <div class="grid grid-cols-1 gap-2">
                      <div>
                         <span class="text-[9px] font-extrabold uppercase tracking-wider text-emerald-600 block mb-0.5">Overall Role</span>
                         <p class="text-xs text-gray-700 leading-relaxed">${escapeHTML(overall)}</p>
                      </div>
                      <div class="border-t border-gray-200 pt-2 mt-1">
                         <span class="text-[9px] font-extrabold uppercase tracking-wider text-blue-600 block mb-0.5">Recent Contribution</span>
                         <p class="text-xs text-gray-700 leading-relaxed">${escapeHTML(recent)}</p>
                      </div>
                   </div>
                </div>
             `;
        });
        membersHtml += `</div>`;

        const cardId = `repobank-card-${repoId}`;
        const html = `
            <div id="${cardId}" class="bg-white border border-gray-200 rounded-xl p-5 shadow-sm flex flex-col h-full relative">
              <div class="flex flex-col sm:flex-row justify-between items-start mb-4 pb-3 border-b border-gray-100 gap-3">
                <div class="flex-1 min-w-0">
                  <a href="${escapeHTML(repoData.url)}" target="_blank" class="font-extrabold text-gray-800 text-lg hover:text-blue-600 transition flex items-center gap-2 truncate">
                     📁 ${escapeHTML(repoName)}
                  </a>
                  <span class="text-[10px] font-bold text-gray-500 bg-gray-100 px-2 py-1 rounded border shadow-inner whitespace-nowrap inline-block mt-2">Upd: ${lastUpdated}</span>
                </div>
                
                <div class="action-container shrink-0 flex flex-col gap-2">
                    <a href="submissions.html?repo=${encodeURIComponent(repoData.url)}" class="border border-indigo-200 bg-indigo-50 text-indigo-800 px-3 py-2 rounded text-xs font-bold hover:bg-indigo-100">Assessment Evidence →</a>
                    <button onclick="window.updateRepoMemory('${repoId}', '${owner}', '${repoName}')" class="bg-slate-800 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-slate-900 transition shadow flex items-center gap-1">
                        🧠 Update Memory
                    </button>
                </div>
              </div>
              
              <div class="mb-4">
                <span class="text-[10px] font-extrabold uppercase tracking-wider text-blue-500 block mb-1">Project Concept</span>
                <p class="text-sm text-gray-700 leading-relaxed">${escapeHTML(concept)}</p>
              </div>
              
              <div class="mb-5">
                <span class="text-[10px] font-extrabold uppercase tracking-wider text-amber-600 block mb-1">Whole Group Feedback</span>
                <p class="text-sm text-gray-700 leading-relaxed">${escapeHTML(feedback)}</p>
              </div>

              <div class="border-t border-gray-200 pt-4 mt-auto">
                <span class="text-[10px] font-extrabold uppercase tracking-wider text-gray-600 block mb-2">Team Members & Contributions</span>
                ${membersHtml}
              </div>
            </div>
          `;
        container.insertAdjacentHTML("beforeend", html);
      } catch (e) {
        console.error(`Failed to load repobank for ${repoId}`, e);
      }
    }
  } catch (e) {
    console.error(e);
    alert("Error loading Repobank data.");
  } finally {
    window.hideLoader();
  }
};

window.updateRepoMemory = async function (repoId, owner, repo) {
  const ghToken = localStorage.getItem("Adminerva_github_token");
  const geminiKey = localStorage.getItem("Adminerva_gemini_token");
  // Default to Pro here since mapping takes a massive context window
  const aiModel = localStorage.getItem("Adminerva_ai_model") || "gemini-3.5";

  if (!ghToken || !geminiKey) {
    alert(
      "Missing API Keys! Please configure GitHub and Gemini tokens in your settings.",
    );
    return;
  }

  const cardId = `repobank-card-${repoId}`;
  const taskCard = document.getElementById(cardId);
  if (!taskCard) return;

  const actionArea = taskCard.querySelector(".action-container");

  const updateStatus = (message) => {
    actionArea.innerHTML = `<span class="text-xs font-bold text-blue-500 flex items-center gap-2"><div class="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div> ${message}</span>`;
  };

  try {
    updateStatus("Fetching Repository...");
    const repoRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      { headers: { Authorization: `Bearer ${ghToken}` } },
    );
    if (!repoRes.ok) throw new Error("Repo inaccessible.");
    const repoData = await repoRes.json();
    const defaultBranch = repoData.default_branch;

    updateStatus("Mapping Architecture...");
    const treeRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`,
      { headers: { Authorization: `Bearer ${ghToken}` } },
    );
    const treeData = await treeRes.json();

    const allowedExts = /\.(java|kt|dart|xml|js|ts|json|gradle|sql|md)$/i;
    const matchedFiles = (treeData.tree || []).filter(
      (f) => f.type === "blob" && allowedExts.test(f.path),
    );

    matchedFiles.sort(
      (a, b) => a.path.split("/").length - b.path.split("/").length,
    );
    const filesToProcess = matchedFiles.slice(0, 50);

    updateStatus(`Reading ${filesToProcess.length} core files...`);
    let combinedCode = "";

    const filePromises = filesToProcess.map(async (file) => {
      // FIXED CORS ERROR: Routing through main API with raw header
      const fileRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${file.path}?ref=${defaultBranch}`,
        {
          headers: {
            Authorization: `Bearer ${ghToken}`,
            Accept: "application/vnd.github.v3.raw",
          },
        },
      );
      if (fileRes.ok) return { path: file.path, text: await fileRes.text() };
      return null;
    });

    const fetchedFiles = await Promise.all(filePromises);
    fetchedFiles.forEach((fileObj) => {
      if (fileObj && fileObj.text.trim()) {
        combinedCode += `\n\n--- FILE: ${fileObj.path} ---\n${fileObj.text}`;
      }
    });

    const groupMembers = activeSectionStudents.filter(
      (s) => getRepoId(s.repoUrl || "") === repoId,
    );
    const memberContext = groupMembers
      .map((m) => `Name: ${m.name}, GitHub: ${m.githubUsername || "Unknown"}`)
      .join("\n");

    updateStatus("Analyzing App Structure...");

    const prompt = `
            You are a senior software architect assessing a student group project.
            Analyze the following repository structure and source code to deduce the app's purpose, the overall quality, and what each member likely contributed (based on the code structure and their GitHub usernames if present in comments or typical separation of concerns).

            Group Members:
            ${memberContext}

            Codebase Collection:
            \`\`\`
            ${combinedCode.substring(0, 80000)}
            \`\`\`

            Return ONLY a valid JSON object matching exactly this schema:
            {
                "concept": "<1 paragraph explaining what the app does and its tech stack>",
                "feedback": "<1 paragraph of constructive feedback for the entire group regarding their code organization or logic>",
                "members": {
                    "<student_id_here>": {
                        "overallContribution": "<1-2 sentences on what area of the app this student seems to be handling>",
                        "recentContribution": "<1 sentence on any notable logic or UI element they appear to have worked on recently>"
                    }
                }
            }

            CRITICAL: Use the exact 'Name' provided in the Group Members list above to match the students to their contributions, but use their actual ID string for the keys in the "members" object. If you cannot determine specific contributions, provide a generic "Collaborated on app logic" response for them. 

            Here are the exact IDs to use for the "members" object keys:
            ${groupMembers.map((m) => `${m.name} ->${m.id}`).join("\n")}
        `;

    const aiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${aiModel}:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            response_mime_type: "application/json",
            temperature: 0.2,
          },
        }),
      },
    );

    if (!aiRes.ok) throw new Error("Architectural mapping failed to respond.");
    const aiData = await aiRes.json();

    let cleanJson = aiData.candidates[0].content.parts[0].text;
    cleanJson = cleanJson
      .replace(/^```json\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const parsed = JSON.parse(cleanJson);

    updateStatus("Committing to Memory...");

    await setDoc(
      doc(db, "repobank", repoId),
      {
        repoName: repo,
        concept: parsed.concept || "App concept could not be determined.",
        feedback: parsed.feedback || "No feedback generated.",
        members: parsed.members || {},
        lastUpdated: serverTimestamp(),
      },
      { merge: true },
    );

    actionArea.innerHTML = `<span class="text-xs font-bold text-green-600">✅ Memory Updated</span>`;
    setTimeout(() => window.loadRepobankData(), 1500);
  } catch (error) {
    console.error("[RepoBank] Update Failed:", error);
    actionArea.innerHTML = `
            <div class="text-right flex flex-col items-end">
                <span class="text-[10px] font-bold text-red-500">Mapping Failed</span>
                <button onclick="window.updateRepoMemory('${repoId}', '${owner}', '${repo}')" class="mt-0.5 text-[9px] font-bold text-blue-500 hover:underline">Retry</button>
            </div>
        `;
  }
};
