import { db } from "../core/firebase-core.js";
import { resolveContributions } from "./services/contribution-resolver.mjs";
import { createGithubEvidenceClient, parseGithubRepository } from "./services/github-evidence-client.mjs";
import {
  doc,
  getDoc,
  runTransaction,
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
    if (taskData.gradingMode && taskData.gradingMode !== "individual") {
      throw new Error("Only individual grading is supported by this Auto-Checker.");
    }
    const studentData = studentSnap.exists()
      ? studentSnap.data()
      : { name: "Unknown Student", githubUsername: "Unknown" };

    const maxScore = taskData.maxScore || 20;
    const floorScore = Math.round(maxScore * 0.2); // ✨ Updated: 20% Safety Net Floor

    let pathsToScan =
      taskData.targetPaths ||
      (taskData.targetPath ? [taskData.targetPath] : []);
    if (pathsToScan.length === 0) pathsToScan = ["*"];

    // Resolve individual contribution evidence before asking AI for a score.
    // This evaluates the student's GitHub-linked commits, not the shared file at HEAD.
    updateStatus("Retrieving complete GitHub history...");
    const ghName = String(studentData.githubUsername || "").trim().replace(/^@/, "");
    if (!ghName) throw new Error("The student has no linked GitHub username.");
    const repoFullName = parseGithubRepository(owner + "/" + repo).fullName;
    if (studentData.repoUrl && studentData.repoUrl !== "unassigned") {
      const linkedRepo = parseGithubRepository(studentData.repoUrl).fullName;
      if (linkedRepo.toLowerCase() !== repoFullName.toLowerCase()) {
        throw new Error("The selected repository differs from the student's linked repository.");
      }
    }
    const identityRes = await fetch(
      "https://api.github.com/users/" + encodeURIComponent(ghName),
      { headers: { Authorization: "Bearer " + ghToken, Accept: "application/vnd.github+json" } },
    );
    if (!identityRes.ok) throw new Error("Unable to verify the linked GitHub account (HTTP " + identityRes.status + ").");
    const ghProfile = await identityRes.json();
    if (!Number.isSafeInteger(ghProfile.id) || ghProfile.login?.toLowerCase() !== ghName.toLowerCase()) {
      throw new Error("The GitHub account identity could not be resolved.");
    }

    const toISO = (value) => {
      if (value == null || value === "") return null;
      const date = typeof value.toDate === "function" ? value.toDate() :
        (typeof value.seconds === "number" ? new Date(value.seconds * 1000) : new Date(value));
      if (!Number.isFinite(date.getTime())) throw new Error("Invalid assessment submission date.");
      return date.toISOString();
    };
    const deployment = (taskData.deployments || []).find(d => d.section === studentData.section);
    const deadline = toISO(deployment?.deadline || taskData.deadline || taskData.dueDate);
    const postDate = toISO(deployment?.postDate || taskData.postDate);
    // Existing student projects can predate assessment deployment.
    // Enforce a strict start window only when the teacher explicitly enables it.
    const enforceSubmissionStart = taskData.enforceSubmissionStart === true;
    const rawPaths = (Array.isArray(pathsToScan) ? pathsToScan : [pathsToScan])
      .map(raw => String(raw || "").trim().replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, ""))
      .filter(Boolean);
    // Existing blueprints may contain broad quarter folders plus narrower task paths.
    // Prefer specific targets to avoid grading other assignments in a shared repository.
    const specificPaths = rawPaths.filter(pattern => {
      if (pattern === "*") return rawPaths.length === 1;
      const hasGlob = /[?*]/.test(pattern);
      if (!hasGlob) {
        // A narrower explicit folder takes priority over a broader quarter folder.
        // Do NOT discard a directory because of a sibling pattern ending in "/*":
        // the directory is necessary for nested Java packages.
        return !rawPaths.some(other => other !== pattern &&
          !/[?*]/.test(other) && other.startsWith(pattern.replace(/\/$/, "") + "/"));
      }
      if (pattern.endsWith("/*")) {
        const parent = pattern.slice(0, -2);
        if (rawPaths.includes(parent) || rawPaths.includes(parent + "/")) return false;
        return !rawPaths.some(other => other !== pattern &&
          !/[?*]/.test(other) && other.startsWith(parent + "/"));
      }
      return true;
    });
    const targetPaths = [...new Set(specificPaths.flatMap(path => {
      if (path === "*") return ["*"];
      const isFolder = !/[?*]/.test(path) && !/\.[a-z0-9]+$/i.test(path);
      const normalized = isFolder ? path.replace(/\/$/, "") + "/**" : path;
      // Assessment Studio paths may be relative to Android Java package roots.
      return normalized.startsWith("**/") || normalized.startsWith("app/")
        ? [normalized] : [normalized, "**/" + normalized];
    }))];
    const client = createGithubEvidenceClient({ token: ghToken, maxPages: 20, maxCommitFilesPages: 30 });
    const evidence = await client.resolveEvidence({
      repository: repoFullName,
      student: { id: studentId, githubUsername: ghProfile.login, githubUserId: ghProfile.id },
      assessment: {
        id: taskId, targetPaths,
        postDate: enforceSubmissionStart ? postDate : null,
        deadline, caseSensitivePaths: taskData.caseSensitivePaths === true,
      },
      resolver: resolveContributions,
      // Scan the pinned current default-branch HEAD, not one student's latest commit.
      // Other earlier merged student commits may not be ancestors of that student's SHA.
      ref: null,
    });
    if (evidence.historyWarning || evidence.historyPagesFetched >= 20 && evidence.status === "requires_review" &&
        evidence.warnings.some(w => w.includes("pagination"))) {
      throw new Error("Commit history could not be verified as complete. Grading paused for review.");
    }
    if (evidence.relevantFiles.some(f => f.missingPatch)) {
      throw new Error("Matching source-code changes have missing patches. Grading paused for teacher review.");
    }
    // A merge commit is intentionally omitted by the resolver. It may require
    // manual inspection before any AI suggestion is published.
    const sourceFiles = evidence.relevantFiles.filter(f =>
      f.kind !== "asset" && f.kind !== "other" && f.patches.length > 0
    );
    if (!sourceFiles.length) {
      throw new Error("No matching student patches. Check assessment directory patterns, nested practical exam files, and GitHub identity.");
    }
    if (sourceFiles.length > 20) {
      throw new Error("More than 20 relevant files need review. Automated scoring will not silently omit them.");
    }
    const reviewReasons = [
      "GitHub account association has not been independently verified against the student record.",
      ...evidence.warnings,
      ...evidence.reviewCommits.map(c => "Commit " + c.sha.slice(0, 12) + ": " + c.reason),
    ];
    if (deadline) reviewReasons.push("Commit dates do not establish that code was pushed before the assessment deadline.");
    if (postDate && !enforceSubmissionStart) {
      reviewReasons.push("Assessment posting date was advisory: earlier work may be included; teacher must verify assignment relevance.");
    }
    const pathsFound = sourceFiles.map(f => f.path);
    const displayPathText = pathsFound.length > 1
      ? pathsFound[0].split("/").pop() + " (+" + (pathsFound.length - 1) + " files)"
      : pathsFound[0].split("/").pop();
    const fileRawText = sourceFiles.map(f => {
      const patches = f.patches.slice().reverse().map(p =>
        "Commit " + p.sha + "\n" + p.patch
      ).join("\n\n");
      return "--- ATTRIBUTED CHANGES: " + f.path + " ---\n" + patches;
    }).join("\n\n");
    if (fileRawText.length > 80000) {
      throw new Error("Relevant changes exceed the AI context limit. Grading paused to avoid silently truncated evidence.");
    }
    // Identity and deadline caveats are not student mistakes and never incur score deductions.
    const diagnosticWarnings = [];
    const autoPenalties = [];

    let finalScore = 0;
    let finalFeedback = "";
    let finalTags = autoPenalties;

    // ✨ PHASE 5: AI Evaluation using Diagnostics & Strict Rubric
    {
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
            
            Grade only the student's attributed Git diff hunks. Do not credit other group members' work to ${studentData.name}.

            EVIDENCE CAVEATS (not scoring penalties):
            ${reviewReasons.map(w => "- " + w).join("\n")}
            Do not deduct points because of missing identity verification, merge ancestry, or an unverified submission cutoff.
            Teacher review is required before publication.

            SYSTEM DIAGNOSTICS:
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
            ${fileRawText} 
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

      const rawAiScore = Number(parsed.score);
      if (!Number.isFinite(rawAiScore) || parsed.score == null || parsed.score === "") {
        throw new Error("The AI returned an invalid score. Nothing was saved.");
      }
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
    const gradeRef = doc(db, "student_grades", gradeDocId);
    const durationMs = Math.round(performance.now() - checkStartTime);

    // A transaction prevents an AI run from overwriting a grade while a teacher publishes it.
    // All AI results remain unpublished drafts requiring teacher verification.
    await runTransaction(db, async transaction => {
      const previous = await transaction.get(gradeRef);
      if (previous.exists() && previous.data().published === true) {
        throw new Error("A published grade exists. Unpublish and review it before replacing the score.");
      }
      transaction.set(gradeRef, {
        studentId, taskId, score: finalScore, maxScore,
        feedback: "[AI DRAFT - REVIEW CONTRIBUTIONS BEFORE PUBLISHING] " + finalFeedback,
        penaltyTags: finalTags,
        targetPath: displayPathText,
        gradingDurationMs: durationMs,
        // RepoFetch uses this student's most recent attributed SHA as the freshness key.
        gradedSha: /^[a-f0-9]{40}$/i.test(currentSha || "") ? currentSha : evidence.scannedRef,
        gradedAt: serverTimestamp(),
        published: false,
        gradingMode: "individual",
        reviewRequired: true,
        reviewReasons,
        contributionEvidence: {
          repository: repoFullName,
          githubLogin: ghProfile.login,
          githubUserId: ghProfile.id,
          scannedSha: evidence.scannedRef,
          matchedPaths: pathsFound,
          acceptedCommitShas: evidence.acceptedCommits.map(c => c.sha),
          reviewCommitShas: evidence.reviewCommits.map(c => c.sha),
          deadlineVerified: false,
        },
      }, { merge: true });
    });

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
