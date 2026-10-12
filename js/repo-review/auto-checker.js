import { db } from "../core/firebase-core.js";
import {
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

function sanitizePath(p) {
  if (!p) return "";
  return p.replace(/[_\-\s]/g, "").toLowerCase();
}

window.startAutoCheck = async function (
  studentId,
  owner,
  repo,
  taskId,
  currentSha,
) {
  const ghToken = localStorage.getItem("Adminerva_github_token");
  const geminiKey = localStorage.getItem("Adminerva_gemini_token");
  const aiModel =
    localStorage.getItem("Adminerva_ai_model") || "gemini-1.5-flash-latest";

  if (!ghToken || !geminiKey) {
    alert("Missing API Keys!");
    return;
  }

  const checkStartTime = performance.now();
  const cardId = `task-card-${studentId}-${taskId}`;
  const taskCard = document.getElementById(cardId);
  const actionArea = taskCard
    ? taskCard.querySelector(".grade-action-area")
    : null;

  const updateStatus = (message) => {
    if (actionArea)
      actionArea.innerHTML = `<span class="text-xs font-bold text-blue-500 flex items-center gap-2"><div class="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div> ${message}</span>`;
  };

  try {
    updateStatus("Fetching Context...");
    const taskSnap = await getDoc(doc(db, "assessments", taskId));
    const studentSnap = await getDoc(doc(db, "students", studentId));

    if (!taskSnap.exists()) throw new Error("Blueprint missing in database.");
    const taskData = taskSnap.data();
    const studentData = studentSnap.exists()
      ? studentSnap.data()
      : { name: "Unknown Student", githubUsername: "Unknown" };

    const maxScore = taskData.maxScore || 20;
    const floorScore = Math.round(maxScore * 0.2); // ✨ Updated: 20% Safety Net Floor

    let pathsToScan =
      taskData.targetPaths ||
      (taskData.targetPath ? [taskData.targetPath] : []);
    if (pathsToScan.length === 0) pathsToScan = ["*"];

    updateStatus("Tracking Repository Data...");

    // PHASE 1: Concurrent Data Fetching
    const [repoRes, treeRes, commitsRes] = await Promise.all([
      fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: { Authorization: `Bearer ${ghToken}` },
      }),
      fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/trees/${currentSha}?recursive=1`,
        { headers: { Authorization: `Bearer ${ghToken}` } },
      ),
      fetch(
        `https://api.github.com/repos/${owner}/${repo}/commits?per_page=100`,
        { headers: { Authorization: `Bearer ${ghToken}` } },
      ),
    ]);

    if (!repoRes.ok) throw new Error("Repo inaccessible. Might be private.");
    const repoData = await repoRes.json();
    if (!repoData.default_branch) throw new Error("Repository is empty.");

    const treeData = await treeRes.json();
    const commitsData = await commitsRes.json();

    const ignoredExts =
      /\.(class|jar|exe|png|jpg|jpeg|gif|ico|svg|mp3|mp4|zip|rar|tar|gz|pdf|docx|xlsx|pptx)$/i;
    const allBlobs = (treeData.tree || []).filter(
      (f) => f.type === "blob" && !ignoredExts.test(f.path),
    );

    const normalizedName = studentData.name
      ? studentData.name
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
      : "";
    const sNameParts = normalizedName
      .replace(/[^a-z0-9]/g, " ")
      .split(" ")
      .filter((w) => w.length > 2);
    const ghName = studentData.githubUsername
      ? studentData.githubUsername.toLowerCase()
      : "";

    // Isolate ONLY this student's commits
    const studentCommits = (commitsData || []).filter((c) => {
      const authorLogin = (c.author?.login || "").toLowerCase();
      const authorEmail = (c.commit?.author?.email || "").toLowerCase();
      const authorName = (c.commit?.author?.name || "").toLowerCase();
      return (
        (ghName && authorLogin === ghName) ||
        (studentData.email &&
          authorEmail === studentData.email.toLowerCase()) ||
        sNameParts.some((part) => authorName.includes(part)) ||
        (ghName && authorName.includes(ghName))
      );
    });

    let matchedFilesMap = new Map();
    let autoPenalties = [];
    let diagnosticWarnings = [];

    // ✨ PHASE 2 & 3: Commit-Driven File Resolution & Diagnostics
    updateStatus("Analyzing Commit Modifications...");

    // Safe to use 80 now! The cache protects your API limit.
    const commitDetailsPromises = studentCommits.slice(0, 80).map(async (c) => {
      try {
        const cacheRef = doc(db, "commit_cache", c.sha);
        const cacheSnap = await getDoc(cacheRef);

        // 1. Check Firebase Cache First
        if (cacheSnap.exists()) {
          return cacheSnap.data();
        }

        // 2. If not cached, fetch from GitHub
        const res = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/commits/${c.sha}`,
          { headers: { Authorization: `Bearer ${ghToken}` } },
        );

        if (res.ok) {
          const rawData = await res.json();

          // Strip down the data to save Firestore space (we only need the files array)
          const minimalData = {
            files: (rawData.files || []).map((f) => ({
              filename: f.filename,
              status: f.status,
              patch: f.patch || "No raw code preview available.",
            })),
          };

          // 3. Save to Firebase so we never have to fetch this SHA again
          await setDoc(cacheRef, minimalData);
          return minimalData;
        }
      } catch (e) {
        console.warn(`Failed to process commit ${c.sha}`, e);
      }
      return null;
    });

    const commitDetails = (await Promise.all(commitDetailsPromises)).filter(
      (c) => c !== null && c.files && c.files.length > 0,
    );

    if (diagnosticWarnings.length > 0) {
      autoPenalties.push("Submission Format Error");
    }

    let filesToProcess = Array.from(matchedFilesMap.values());

    // Sort files to put primary valid code extensions at the top to save context window space
    filesToProcess.sort((a, b) => {
      const aIsPrimary = validCodeExts.test(a.path);
      const bIsPrimary = validCodeExts.test(b.path);
      if (aIsPrimary && !bIsPrimary) return -1;
      if (!aIsPrimary && bIsPrimary) return 1;
      return 0;
    });

    filesToProcess = filesToProcess.slice(0, 20);

    let forceFail = false;
    let failMessage = "";
    let pathsFound = [];
    let fileRawText = "";
    let displayPathText = pathsToScan.join(", ") || "Entire Repository";

    // PHASE 4: Extract Code via Blob or Patch Fallback
    if (filesToProcess.length === 0) {
      forceFail = true;
      failMessage = `No code files found matching the task requirements in your commits. Please ensure you pushed the correct assignment.`;
      autoPenalties.push("Empty Submission");
    } else {
      updateStatus(`Reading ${filesToProcess.length} File(s)...`);

      const filePromises = filesToProcess.map(async (file) => {
        if (file.isPatchOnly) {
          return {
            path: `${file.path} (Extracted from Commit Patch)`,
            text: file.rawText,
          };
        }
        try {
          const fileRes = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/contents/${file.path}?ref=${currentSha}`,
            {
              headers: {
                Authorization: `Bearer ${ghToken}`,
                Accept: "application/vnd.github.v3.raw",
              },
            },
          );
          if (fileRes.ok)
            return { path: file.path, text: await fileRes.text() };
        } catch (e) {
          return null;
        }
        return null;
      });

      const fetchedFiles = await Promise.all(filePromises);
      fetchedFiles.forEach((fileObj) => {
        if (fileObj && fileObj.text.trim()) {
          fileRawText += `\n\n--- FILE: ${fileObj.path} ---\n${fileObj.text}`;
          pathsFound.push(fileObj.path);
        }
      });

      if (!fileRawText.trim()) {
        forceFail = true;
        failMessage = "Files found, but contents were empty or unreadable.";
        autoPenalties.push("Empty Submission");
      } else {
        if (pathsFound.length > 1)
          displayPathText = `${pathsFound[0].split("/").pop()} (+${pathsFound.length - 1} files)`;
        else if (pathsFound.length === 1)
          displayPathText = pathsFound[0].split("/").pop();
      }
    }

    let finalScore = 0;
    let finalFeedback = failMessage;
    let finalTags = autoPenalties;

    // ✨ PHASE 5: AI Evaluation using Diagnostics & Strict Rubric
    if (!forceFail) {
      updateStatus("Evaluating Code...");

      let rulesText = "No strict objective string rules applied.";
      if (taskData.rules && taskData.rules.length > 0) {
        rulesText =
          "Objective String Filters (Deduct points if the Target Student violates these):\n";
        taskData.rules.forEach((r) => {
          rulesText += `- ${r.type}: "${r.value}"\n`;
        });
      }

      // Compile diagnostics for AI Instructions
      const sysDiagnosticsText =
        diagnosticWarnings.length > 0
          ? diagnosticWarnings.map((w) => `- ${w}`).join("\n")
          : "- No structural submission errors detected.";

      const prompt = `
            Persona: ${taskData.systemPersona || "Strict teacher"}
            Context: ${taskData.taskContext || "Evaluate code quality"}
            Rubric: ${taskData.evalCriteria || "Score based on correctness"}
            Max Score: ${maxScore}
            Floor Score: ${floorScore}
            
            Code to evaluate belongs exclusively to: ${studentData.name}

            SYSTEM DIAGNOSTICS (CRITICAL):
            The automated system logged the following submission formatting errors based on the student's GitHub commits. You MUST explicitly mention these in your feedback and apply deductions for poor file organization:
            ${sysDiagnosticsText}

            RULES:
            1. Score 0 if code is blank, an unmodified template, or blatantly bypasses logic.
            2. Score ${floorScore} (Floor) for a genuine attempt with catastrophic failures.
            3. Otherwise, strictly calculate the score by evaluating the code ONLY based on the Rubric, minus any deductions for the System Diagnostics above.
            
            FEEDBACK FORMAT (CRITICAL):
            Provide a direct, ultra-concise 1-2 sentence \`teacher_note\`. State exactly what was done well, what was wrong based on the Rubric, AND explicitly address any System Diagnostics warnings. 
            Do NOT use fluff, greetings, AI meta-language, or robotic breakdowns. Be blunt and professional.

            JSON OUTPUT ONLY:
            {"score": <number>, "penalty_tags": ["<tag1>", "<tag2>"], "teacher_note": "<short direct feedback>"}
            
            ${rulesText}
            
            Student Code Collection:
            \`\`\`
            ${fileRawText.substring(0, 80000)} 
            \`\`\`
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

      if (!aiRes.ok)
        throw new Error(
          "Automated engine failed to respond. (Check console for API details)",
        );
      const aiData = await aiRes.json();
      let cleanJson = aiData.candidates[0].content.parts[0].text
        .replace(/^```(json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
      const parsed = JSON.parse(cleanJson);

      let rawAiScore = parsed.score !== undefined ? parsed.score : floorScore;
      finalScore = Math.min(Math.max(rawAiScore, 0), maxScore);

      finalFeedback =
        parsed.teacher_note || parsed.feedback || "No feedback generated.";

      let aiTags = [];
      if (Array.isArray(parsed.penalty_tags)) aiTags = parsed.penalty_tags;
      else if (typeof parsed.penalty_tags === "string")
        aiTags = [parsed.penalty_tags];
      finalTags = [...new Set([...autoPenalties, ...aiTags])];
    }

    updateStatus("Saving Grade...");
    const gradeDocId = `${studentId}_${taskId}`;
    const durationMs = Math.round(performance.now() - checkStartTime);

    await setDoc(
      doc(db, "student_grades", gradeDocId),
      {
        studentId,
        taskId,
        score: finalScore,
        maxScore: maxScore,
        feedback: finalFeedback,
        penaltyTags: finalTags,
        targetPath: displayPathText,
        gradingDurationMs: durationMs,
        gradedSha: currentSha,
        gradedAt: serverTimestamp(),
      },
      { merge: true },
    );

    if (actionArea)
      renderGradeResult(
        actionArea,
        finalScore,
        maxScore,
        finalFeedback,
        finalTags,
        displayPathText,
        studentId,
        owner,
        repo,
        taskId,
        currentSha,
      );
    return { success: true };
  } catch (error) {
    console.error("[Auto-Check] Failed:", error);
    if (actionArea)
      actionArea.innerHTML = `<div class="text-right flex flex-col items-end"><span class="text-xs font-bold text-red-500">Check Failed</span><p class="text-[9px] text-gray-500 max-w-[200px] truncate" title="${escapeHTML(error.message)}">${escapeHTML(error.message)}</p><button onclick="window.startAutoCheck('${studentId}', '${owner}', '${repo}', '${taskId}', '${currentSha}')" class="mt-0.5 text-[10px] font-bold text-blue-500 hover:underline">Retry Check</button></div>`;
    return { success: false, reason: error.message };
  }
};

function renderGradeResult(
  container,
  score,
  maxScore,
  feedback,
  penaltyTags,
  exactPath,
  studentId,
  owner,
  repo,
  taskId,
  currentSha,
) {
  let scoreColor = "text-green-600";
  if (score < maxScore * 0.75) scoreColor = "text-red-600";
  else if (score < maxScore * 0.9) scoreColor = "text-yellow-600";

  let tagsHtml = "";
  if (penaltyTags && penaltyTags.length > 0) {
    tagsHtml = `<div class="flex flex-wrap gap-1 mb-1 mt-1">${penaltyTags.map((t) => `<span class="bg-rose-50 text-rose-600 text-[8.5px] px-1.5 py-0.5 rounded border border-rose-200 font-extrabold uppercase tracking-wider shadow-sm whitespace-normal leading-tight text-left max-w-full">${escapeHTML(t)}</span>`).join("")}</div>`;
  }

  container.innerHTML = `
        <div class="flex items-start justify-end gap-3 bg-gray-50 p-3 rounded border border-gray-200 w-full xl:w-[450px] shadow-inner">
            <div class="flex flex-col items-center ml-1 w-10 shrink-0 mt-1">
                <div class="text-2xl font-bold ${scoreColor} leading-none text-center">${score}</div>
                <div class="text-[8px] font-bold text-gray-400 mt-1">/ ${maxScore}</div>
            </div>
            <div class="flex-1 min-w-0 border-l border-gray-200 pl-3 ml-1">
                <p class="text-[9px] font-mono text-gray-400 truncate mb-1" title="${escapeHTML(exactPath)}">File(s): ${escapeHTML(exactPath)}</p>
                ${tagsHtml}
                <div class="text-[10px] text-gray-700 leading-relaxed max-h-24 overflow-y-auto pr-1 whitespace-pre-wrap">${escapeHTML(feedback)}</div>
            </div>
            <div class="flex flex-col items-center justify-center border-l border-gray-200 pl-2 shrink-0 w-12 mt-1">
                <span id="pub-lbl-${taskId}" class="text-[7px] font-bold text-gray-400 uppercase mb-1 tracking-wider">Hidden</span>
                <label class="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" class="sr-only peer" onchange="window.togglePublishGrade('${studentId}', '${taskId}', this)">
                  <div class="w-6 h-3.5 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-2.5 after:w-2.5 after:transition-all peer-checked:bg-blue-500"></div>
                </label>
            </div>
            <button onclick="window.startAutoCheck('${studentId}', '${owner}', '${repo}', '${taskId}', '${currentSha}')" class="text-gray-400 hover:text-blue-500 transition px-1 shrink-0 border-l border-gray-200 pl-2 ml-1 mt-1" title="Force Re-evaluate">🔄</button>
        </div>
    `;
}
