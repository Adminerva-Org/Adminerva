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

function wildcardToRegex(wildcardPath) {
  if (
    !wildcardPath ||
    wildcardPath.trim() === "" ||
    wildcardPath.trim() === "*"
  )
    return new RegExp(".*");
  let path = wildcardPath.trim();
  if (!path.match(/\.[a-zA-Z0-9]+$/)) path = path.replace(/\/$/, "") + "/*";
  let escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regexStr = escaped.replace(/\\\*/g, ".*");
  return new RegExp(regexStr, "i");
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

    updateStatus("Scanning Repo...");

    let pathsToScan =
      taskData.targetPaths ||
      (taskData.targetPath ? [taskData.targetPath] : []);
    if (pathsToScan.length === 0) pathsToScan = ["*"];

    let fileRawText = "";
    let displayPathText = pathsToScan.join(", ") || "Entire Repository";
    let autoPenalties = [];
    let forceFail = false;
    let failMessage = "";
    let pathsFound = [];

    const repoRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      { headers: { Authorization: `Bearer ${ghToken}` } },
    );
    if (!repoRes.ok) throw new Error("Repo inaccessible. Might be private.");
    const repoData = await repoRes.json();
    const defaultBranch = repoData.default_branch;
    if (!defaultBranch) throw new Error("Repository is empty.");

    const treeRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${currentSha}?recursive=1`,
      { headers: { Authorization: `Bearer ${ghToken}` } },
    );
    const treeData = await treeRes.json();
    const ignoredExts =
      /\.(class|jar|exe|png|jpg|jpeg|gif|ico|svg|mp3|mp4|zip|rar|tar|gz|pdf|docx|xlsx|pptx)$/i;
    const allBlobs = (treeData.tree || []).filter(
      (f) => f.type === "blob" && !ignoredExts.test(f.path),
    );

    let matchedFilesMap = new Map();

    pathsToScan.forEach((targetPath) => {
      if (targetPath === "*" || !targetPath.match(/\.[a-zA-Z0-9]+$/)) {
        const matcher = wildcardToRegex(targetPath);
        allBlobs.forEach((f) => {
          if (matcher.test(f.path)) {
            matchedFilesMap.set(f.path, f);
          }
        });
      } else {
        let foundExact = false;
        for (let f of allBlobs) {
          if (f.path === targetPath) {
            matchedFilesMap.set(f.path, f);
            foundExact = true;
            break;
          }
        }
        if (!foundExact) {
          const expectedFileName = targetPath.split("/").pop();
          const expectedBaseName = expectedFileName.replace(
            /\.[a-zA-Z0-9]+$/,
            "",
          );
          const expectedDir = targetPath
            .replace(expectedFileName, "")
            .replace(/\/$/, "");
          let bestMatch = null;
          for (let f of allBlobs) {
            const fName = f.path.split("/").pop();
            const fBase = fName.replace(/\.[a-zA-Z0-9]+$/, "");
            const fDir = f.path.replace(fName, "").replace(/\/$/, "");
            if (fName === expectedFileName) {
              bestMatch = f;
              autoPenalties.push(`Wrong Folder: ${expectedFileName}`);
              break;
            }
            if (fBase === expectedBaseName) {
              bestMatch = f;
              if (fDir === expectedDir)
                autoPenalties.push(`Missing Extension: ${expectedFileName}`);
              else
                autoPenalties.push(`Wrong Folder & Ext: ${expectedBaseName}`);
              break;
            }
          }
          if (bestMatch) matchedFilesMap.set(bestMatch.path, bestMatch);
        }
      }
    });

    let finalMatchedFiles = Array.from(matchedFilesMap.values());

    if (finalMatchedFiles.length === 0 && pathsToScan[0] !== "*") {
      let fuzzyMatches = [];
      const targetKeywords = pathsToScan
        .map((p) =>
          p
            .replace(/[^a-zA-Z0-9]/g, " ")
            .split(" ")
            .filter((w) => w.length > 2),
        )
        .flat();
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

      allBlobs.forEach((f) => {
        let score = 0;
        const lowerPath = f.path.toLowerCase();
        targetKeywords.forEach((kw) => {
          if (lowerPath.includes(kw.toLowerCase())) score += 1;
        });
        sNameParts.forEach((part) => {
          if (lowerPath.includes(part)) score += 5;
        });
        if (ghName && lowerPath.includes(ghName)) score += 5;
        if (score > 0) fuzzyMatches.push({ file: f, score: score });
      });

      fuzzyMatches.sort((a, b) => b.score - a.score);
      fuzzyMatches.slice(0, 5).forEach((match) => {
        matchedFilesMap.set(match.file.path, match.file);
      });
      finalMatchedFiles = Array.from(matchedFilesMap.values());
      if (finalMatchedFiles.length > 0)
        autoPenalties.push("Wrong Folder / Misnamed File");
    }

    if (finalMatchedFiles.length > 0) {
      finalMatchedFiles.forEach((f) => {
        const fileName = f.path.split("/").pop();
        if (!fileName.includes("."))
          autoPenalties.push(`No Extension (${fileName})`);
        else if (
          !fileName.match(/\.(java|kt|dart|cs|js|ts|html|css|py|cpp|php)$/i)
        )
          autoPenalties.push(`Invalid Extension (${fileName})`);
      });
    }

    if (finalMatchedFiles.length === 0) {
      forceFail = true;
      failMessage = `No code files found matching your target paths. Please ensure you committed your work.`;
      autoPenalties.push("Empty Submission");
    } else {
      const filesToProcess = finalMatchedFiles.slice(0, 40);
      updateStatus(`Reading ${filesToProcess.length} File(s)...`);

      let combinedCode = "";
      const filePromises = filesToProcess.map(async (file) => {
        const fileRes = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/contents/${file.path}?ref=${currentSha}`,
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
          pathsFound.push(fileObj.path);
        }
      });

      if (!combinedCode.trim()) {
        forceFail = true;
        failMessage = "Files found, but contents were empty or unreadable.";
        autoPenalties.push("Empty Submission");
      } else {
        fileRawText = combinedCode;
        if (pathsFound.length > 1)
          displayPathText = `${pathsFound[0].split("/").pop()} (+${pathsFound.length - 1} files)`;
        else if (pathsFound.length === 1)
          displayPathText = pathsFound[0].split("/").pop();
      }
    }

    // ✨ ZERO TOLERANCE: Empty work immediately gets 0.
    let finalScore = 0;
    let finalFeedback = failMessage;
    let finalTags = autoPenalties;

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

      // ✨ RUBRIC-DRIVEN PROMPT
      const prompt = `
            ${taskData.systemPersona || "You are a strict code evaluator."}
            Task Context: ${taskData.taskContext || "Evaluate general code quality."}
            Rubric: ${taskData.evalCriteria || "Score based on correctness and structure."}
            
            CRITICAL INSTRUCTION - TARGET STUDENT ISOLATION:
            You are grading ONLY the individual work of student: ${studentData.name} (GitHub username: @${studentData.githubUsername || "unlinked"}).
            Note: The student's name might be spelled slightly differently in the file path.
            The codebase below contains files from multiple group members. You MUST identify which files or code blocks belong to this specific student. DO NOT deduct points for errors found in files clearly belonging to other students.

            FILE LOCATION & NAMING CONTEXT:
            - The expected file/folder path requested by the teacher: ${pathsToScan.join(", ")}
            - The actual file path(s) submitted by the student: ${pathsFound.join(", ")}
            ${autoPenalties.length > 0 ? `\nADMINISTRATIVE PENALTY TRIGGERED: The student failed to follow exact naming/folder conventions (System Flags: ${autoPenalties.join(", ")}). You MUST explicitly explain what they did wrong with their file name or folder placement.` : ""}

            SCORING RULES & PENALTY DIAGNOSTICS:
            You are an automated grading script. Evaluate the code and calculate the score STRICTLY based on the provided Rubric. The maximum possible score is ${maxScore}.
            1. Calculate the points earned for each criterion defined in the Rubric.
            2. Sum the points together.
            3. If the Administrative Penalty was triggered above, deduct 3 points from the total sum.
            4. If the file is completely empty, is just an auto-generated scaffold, or contains a logic bypass to cheat the requirements, the final score MUST be 0.
            
            You MUST append specific diagnostic tags if points were deducted (e.g., "Syntax Error", "Missing Logic", "Incomplete Feature", "Paradigm Mismatch"). Combine feedback to explain the exact point breakdown so the student understands their score.

            CRITICAL JSON OUTPUT FORMAT:
            You MUST return your evaluation strictly as a JSON object with NO markdown formatting. Format EXACTLY like this:
            {"score": <number>, "penalty_tags": ["<tag1>", "<tag2>"], "teacher_note": "<2 to 4 sentences addressed directly to the student explaining the score breakdown and penalties>"}
            
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

      // ✨ SIMPLE CLAMP: Prevent negative scores or scores over the max, but allow 0!
      let rawAiScore = parsed.score || 0;
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
    tagsHtml = `<div class="flex flex-wrap gap-1 mb-1 mt-1">${penaltyTags.map((t) => `<span class="bg-rose-50 text-rose-600 text-[8.5px] px-1.5 py-0.5 rounded border border-rose-200 font-extrabold uppercase tracking-wider shadow-sm">${escapeHTML(t)}</span>`).join("")}</div>`;
  }

  container.innerHTML = `
        <div class="flex items-center justify-end gap-3 bg-gray-50 p-2 rounded border border-gray-200 w-full sm:w-[360px] shadow-inner">
            <div class="flex flex-col items-center ml-2 w-10">
                <div class="text-2xl font-bold ${scoreColor} leading-none text-center">${score}</div>
                <div class="text-[8px] font-bold text-gray-400 mt-1">/ ${maxScore}</div>
            </div>
            <div class="flex-1 min-w-0 border-l border-gray-200 pl-3 ml-1">
                <p class="text-[9px] font-mono text-gray-400 truncate mb-1" title="${escapeHTML(exactPath)}">File(s): ${escapeHTML(exactPath)}</p>
                ${tagsHtml}
                <div class="text-[10px] text-gray-700 leading-relaxed max-h-24 overflow-y-auto pr-1 whitespace-pre-wrap">${escapeHTML(feedback)}</div>
            </div>
            <div class="flex flex-col items-center justify-center border-l border-gray-200 pl-2 shrink-0 w-12">
                <span id="pub-lbl-${taskId}" class="text-[7px] font-bold text-gray-400 uppercase mb-1 tracking-wider">Hidden</span>
                <label class="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" class="sr-only peer" onchange="window.togglePublishGrade('${studentId}', '${taskId}', this)">
                  <div class="w-6 h-3.5 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-2.5 after:w-2.5 after:transition-all peer-checked:bg-blue-500"></div>
                </label>
            </div>
            <button onclick="window.startAutoCheck('${studentId}', '${owner}', '${repo}', '${taskId}', '${currentSha}')" class="text-gray-400 hover:text-blue-500 transition px-1 shrink-0 border-l border-gray-200 pl-2 ml-1" title="Force Re-evaluate">🔄</button>
        </div>
    `;
}
