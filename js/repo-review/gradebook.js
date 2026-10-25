import {feedbackSummary,inlineTask,reviewNotice} from "./review-ui.mjs?v=1.3.0";
import {openFeedbackDrawer} from "./feedback-drawer.mjs?v=1.3.0";
import {publicationCandidates,publishGradeEntries,publicationRecovery} from "./grade-publication.mjs?v=1.3.1";
import {assertGradeVersion} from "./services/grade-version.mjs?v=1.3.0";
import {writePublicationRevision} from "./grade-publication.mjs?v=1.3.1";
/** Teacher grade administration, protected revisions and explicit publication. */
import { db,auth } from "../core/firebase-core.js?v=1.3.0";
import {resolveStaffSubjects} from "../core/staff-session.mjs?v=1.3.10";
import { cleanGradeFeedback } from "../core/feedback-format.mjs?v=1.3.0";
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
} from "../core/teaching-firestore.mjs?v=1.3.0";

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

let allStudents = [],gridEntries=[],gridSerial=0,publishBusy=false,subjectFocus=[];
function syncPublishButton(loading=false){const button=document.getElementById("gbLegacyPublish"),eligible=publicationCandidates(gridEntries);button.disabled=loading||publishBusy||!eligible.length;button.textContent="Publish ready ("+eligible.length+")";const recovery=publicationRecovery("single:"+document.getElementById("gbSection").value+":"+document.getElementById("gbAssessment").value);document.getElementById("gbLegacyRecovery").textContent=recovery?.pending.length?"Interrupted batch: "+recovery.pending.length+" pending. Reload grades and confirm Publish to try again.":"Ready drafts can be published together; flagged evaluations stay private until reviewed.";}
window.openGridFeedback=(studentId,taskId)=>void openFeedbackDrawer({studentId,taskId});
let allAssessments = [];

let legacyGradebookInitialized = false;
async function ensureLegacyGradebook() {
  if (legacyGradebookInitialized) return;
  legacyGradebookInitialized = true;
  await loadFilters();
}
window.addEventListener("adminerva:open-legacy-gradebook", ensureLegacyGradebook);
async function initLegacyGradebook() {
  if (!document.getElementById("gbLegacyView")?.classList.contains("hidden")) {
    await ensureLegacyGradebook();
  }
  document
    .getElementById("gbSection")
    .addEventListener("change", updateAssessmentsForSection);
  document.getElementById("gbAssessment").addEventListener("change", loadGrid);
  document.getElementById("gbSort").addEventListener("change", loadGrid);
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",initLegacyGradebook,{once:true});
else void initLegacyGradebook();

async function loadFilters() {
  const finish=inlineTask("gbTableBody","Loading gradebook filters…");
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
    subjectFocus=await resolveStaffSubjects(auth.currentUser);
    assSnap.forEach((d) => {
      const assessment={ id: d.id, ...d.data() };
      if(!subjectFocus.length||!assessment.subject||subjectFocus.includes(assessment.subject))allAssessments.push(assessment);
    });
  } catch (e) {
    console.error("Gradebook Load Error", e);
  } finally {
    finish();
  }
}

function syncSelectedAssessmentLabel() {
  const field=document.getElementById("gbAssessment"),label=document.getElementById("gbSelectedAssessment");
  if(!field||!label)return;
  label.textContent=field.selectedIndex>=0&&field.value?field.selectedOptions[0]?.textContent||"":"";
}
async function loadGrid() {
  syncSelectedAssessmentLabel();
  const section = document.getElementById("gbSection").value;
  const taskId = document.getElementById("gbAssessment").value;
  const tbody = document.getElementById("gbTableBody");

  const serial=++gridSerial;gridEntries=[];syncPublishButton(true);
  if (!section || !taskId) {syncPublishButton();return;}

  tbody.innerHTML = `<tr aria-busy="true"><td colspan="5" class="px-6 py-8"><div class="animate-pulse space-y-3"><div class="h-4 rounded bg-slate-200 w-1/3"></div><div class="h-4 rounded bg-slate-100 w-2/3"></div><span class="text-sm text-slate-500">Loading saved scores…</span></div></td></tr>`;

  try {
    const gradesSnap = await getDocs(
      query(collection(db, "student_grades"), where("taskId", "==", taskId)),
    );
    if(serial!==gridSerial)return;
    const schemaVersion=allAssessments.find(task=>task.id===taskId)?.schemaVersion;
    const taskMaximum=allAssessments.find(task=>task.id===taskId)?.maxScore;
    gridEntries=gradesSnap.docs.filter(record=>allStudents.some(student=>student.id===record.data().studentId&&student.section===section)).map(record=>({ref:record.ref,data:record.data(),schemaVersion,maxScore:taskMaximum}));syncPublishButton();
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

        scoreBadge = '<button type="button" class="av-feedback-chip" onclick="window.openGridFeedback(\''+student.id+'\',\''+taskId+'\')"><strong>'+escapeHTML(String(grade.score))+' / '+max+'</strong><span>'+escapeHTML(feedbackSummary(grade.feedback))+'</span></button>';

        const isPub = grade.published || false;
        const requiresReview = !isPub && grade.reviewRequired===true;
        if(requiresReview){
          const reviewLink="repofetch.html?"+new URLSearchParams({section,assessment:taskId,student:student.id,view:"grade"});
          const reason=(grade.reviewReasons||[]).filter(Boolean).slice(0,3).join(" • ")||
            "This evaluation needs teacher attention before it can be published.";
          pubToggle='<div class="av-compact-status"><span class="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Private</span>'+
            '<span class="av-inline-flag"><button type="button" class="av-flag-button" data-av-popover aria-expanded="false" aria-label="Teacher review required">!</button>'+
            '<span class="av-flag-popover" role="tooltip"><strong>Teacher review required</strong>'+escapeHTML(reason)+
            '<br><a href="'+escapeHTML(reviewLink)+'">Review evaluation →</a></span></span></div>';
        }else pubToggle = `
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
                <tr class="hover:bg-indigo-50/50 transition" data-student-id="${student.id}">
                    <td data-label="Student" class="px-5 py-4">
                        <div class="font-extrabold text-slate-800 text-base">${escapeHTML(student.name)}</div>
                        <div class="text-[10px] text-slate-400 font-mono mt-0.5">@${escapeHTML(student.githubUsername || "unlinked")}</div>
                    </td>
                    <td data-label="Review" class="px-5 py-4"><div data-review-state="${student.id}" class="min-w-40 text-xs text-slate-500">Checking…</div></td>
                    <td data-label="Repository" class="px-5 py-4">${repoStatus}</td>
                    <td data-label="Score" class="px-5 py-4">${scoreBadge}</td>
                    <td data-label="Visibility" class="px-5 py-4">${pubToggle}</td>
                </tr>
        `,
      );
    });

    const gradebookGridDetail={
      section,taskId,schemaVersion,students:classStudents.map(student=>({id:student.id,name:student.name,section:student.section,repoUrl:student.repoUrl,githubUsername:student.githubUsername,email:student.email})),
      grades:Object.fromEntries(classStudents.filter(student=>gradeMap[student.id]).map(student=>[student.id,gradeMap[student.id]]))
    };
    window.__adminervaGradebookGridContext=gradebookGridDetail;
    window.dispatchEvent(new CustomEvent("adminerva:gradebook-grid-loaded",{detail:gradebookGridDetail}));

    if (classStudents.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="px-6 py-12 text-center text-slate-400 font-medium italic">No students found in this section.</td></tr>`;
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
    if(serial!==gridSerial)return;
    console.error(error);
    tbody.innerHTML = `<tr><td colspan="5" class="px-6 py-12 text-center text-red-500 font-bold border border-red-200 bg-red-50">Failed to load matrix. Check permissions.</td></tr>`;
  }
}

window.matrixTogglePub = async function (studentId, taskId, checkbox) {
  const gradeRef = doc(db, "student_grades", `${studentId}_${taskId}`);
  const wantsPublish = checkbox.checked;
  try {
    const gradeSnap = await getDoc(gradeRef);
    if (!gradeSnap.exists()) throw new Error("Grade does not exist.");
    const assessment=allAssessments.find(item=>item.id===taskId);
    if (wantsPublish && gradeSnap.data().reviewRequired === true) {
      checkbox.checked=false;
      alert("This evaluation is flagged for teacher review and will stay private until the flag is resolved.");
      return;
    }
    await runTransaction(db, async tx => {
      const latest = await tx.get(gradeRef);
      if (!latest.exists()) throw new Error("Grade was removed during publication.");
      assertGradeVersion(latest.data(),gradeSnap.data());
      if(wantsPublish){
        const {verifyGradePublication}=await import("./services/evidence-transaction.mjs?v=1.3.0");
        await verifyGradePublication(tx,gradeRef,{...latest.data(),taskId});
      }
      writePublicationRevision(tx,gradeRef,latest.data(),wantsPublish);
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
  gridEntries=[];syncPublishButton();
  const section = document.getElementById("gbSection").value;
  const assSelect = document.getElementById("gbAssessment");
  const tbody = document.getElementById("gbTableBody");

  assSelect.innerHTML =
    "<option value='' disabled selected>Select an assessment...</option>";
  syncSelectedAssessmentLabel();
  tbody.innerHTML = `<tr><td colspan="5" class="px-6 py-12 text-center text-slate-400 font-medium italic">Select an Assessment above to load the matrix.</td></tr>`;

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
      `<option value="${d.id}">${d.subject?escapeHTML(d.subject)+" · ":""}${escapeHTML(d.title)} (${escapeHTML(d.type)})</option>`,
    );
  });
}

window.bulkPublishCurrentGrid=async function(){
  if(publishBusy)return;
  const eligible=publicationCandidates(gridEntries);
  if(!eligible.length)return reviewNotice("No ready drafts are available. Flagged evaluations remain private until reviewed.");
  if(!confirm("Publish "+eligible.length+" ready grade(s) in this section? Flagged evaluations will be skipped and remain private."))return;
  const context="single:"+document.getElementById("gbSection").value+":"+document.getElementById("gbAssessment").value;
  publishBusy=true;syncPublishButton();
  try{const result=await publishGradeEntries(eligible,true,{context,onProgress:value=>reviewNotice("Publishing ready grades: "+value.completed.length+" complete, "+value.pending.length+" pending.")});reviewNotice(result.pending.length?"Some grades changed or failed validation. Reload before retrying.":"Ready grades published; flagged evaluations were skipped.",Boolean(result.pending.length));}
  catch(error){reviewNotice(error.message,true);}
  finally{publishBusy=false;await loadGrid();syncPublishButton();}
};
