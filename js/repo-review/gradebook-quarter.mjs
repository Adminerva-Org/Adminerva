/** Assessment authoring, repository evidence, individual review and protected grading: gradebook quarter. */
import { auth, db } from "../core/firebase-core.js?v=1.3.0";
import {resolveStaffSubjects} from "../core/staff-session.mjs?v=1.3.10";
import { cleanGradeFeedback } from "../core/feedback-format.mjs?v=1.3.0";
import {assertGradeVersion,nextGradeVersion} from "./services/grade-version.mjs?v=1.3.0";
import {publicationCandidates,publishGradeEntries,publicationRecovery} from "./grade-publication.mjs?v=1.3.1";
import {renderFeedbackMarkdown,reviewNotice} from "./review-ui.mjs?v=1.3.0";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, query, where, runTransaction,
  writeBatch, serverTimestamp
} from "../core/teaching-firestore.mjs?v=1.3.0";
import { parseGithubRepository } from "./services/github-evidence-client.mjs?v=1.3.0";

/* Quarter matrix companion to the primary single-assessment class review.
   It does not change existing document identifiers or grade schemas. */
const el = id => document.getElementById(id);
const state = { students: [], assessments: [], tasks: [], rows: [], grades: new Map(), active: null, ready: false, mode: "single", loading: false, subjectFocus: [] };
let loadSerial=0,bulkBusy=false,detailsDirty=false;
const publicationContext=()=>"quarter:"+el("gbQuarterSection").value+":"+el("gbQuarter").value;
function queueEntries(){return [...state.grades.values()].map(entry=>({...entry,schemaVersion:state.tasks.find(task=>task.id===entry.data.taskId)?.schemaVersion,maxScore:state.tasks.find(task=>task.id===entry.data.taskId)?.maxScore}));}
function syncPublication(){
  const entries=queueEntries(),count=publicationCandidates(entries).length,button=el("gbQuarterPublish");
  const flagged=entries.filter(entry=>entry.data?.published!==true&&entry.data?.reviewRequired===true).length;
  button.textContent="Publish private drafts ("+count+")";button.disabled=state.loading||bulkBusy||!count;
  el("gbQuarterUnpublish").disabled=state.loading||bulkBusy||![...state.grades.values()].some(entry=>entry.data.published);
  const recovery=publicationRecovery(publicationContext());
  el("gbQuarterRecovery").textContent=recovery?.pending.length?
    "Interrupted batch: "+recovery.pending.length+" pending. Reload and confirm to retry; nothing resumes automatically.":
    count+" ready to publish"+(flagged?" · "+flagged+" flagged for manual review":"")+".";
}
const add = (parent, tag, className = "", value = null) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== null) node.textContent = String(value);
  parent.append(node);
  return node;
};
const status = (message, error = false) => {
  el("gbQuarterStatus").textContent = message;
  el("gbQuarterStatus").className = error ? "text-sm text-rose-700" : "text-sm text-slate-600";
};
function quarterOf(assessment) {
  const stored = String(assessment.quarter || "").toUpperCase().trim();
  if (/^Q[1-4]$/.test(stored)) return stored;
  const inferred = String(assessment.title || "").match(/\b(?:Q|QUARTER\s*)([1-4])\b/i);
  return inferred ? "Q" + inferred[1] : "legacy";
}
const inSection = (assessment, section) =>
  assessment.deployments?.some(item => item.section === section) ||
  (!assessment.deployments?.length && assessment.targetSections?.includes(section));
function repoInfo(student) {
  try {
    const parsed = parseGithubRepository(student.repoUrl);
    const url = "https://github.com/" + encodeURIComponent(parsed.owner) + "/" + encodeURIComponent(parsed.repo);
    const login = String(student.githubUsername || "").trim().replace(/^@/, "");
    return { name: parsed.repo, url, commits: /^[a-zA-Z0-9-]+$/.test(login) ?
      url + "/commits?author=" + encodeURIComponent(login) : url + "/commits" };
  } catch { return null; }
}
function view(mode) {
  state.mode = mode;
  el("gbLegacyView").classList.toggle("hidden", mode !== "single");
  el("gbQuarterPanel").classList.toggle("hidden", mode !== "quarter");
  el("gbClassReviewTools")?.classList.toggle("hidden", mode !== "single" || !el("gbClassReviewTools")?.dataset.ready);
  el("gbViewQuarter").className = "px-4 py-2 rounded-lg text-sm font-bold " +
    (mode === "quarter" ? "bg-blue-600 text-white" : "text-slate-600");
  el("gbViewSingle").className = "px-4 py-2 rounded-lg text-sm font-bold " +
    (mode === "single" ? "bg-blue-600 text-white" : "text-slate-600");
  if (mode === "quarter" && state.ready) loadQuarter();
  if (mode === "single") window.dispatchEvent(new Event("adminerva:open-legacy-gradebook"));
}
function cell(row, value, css = "") {
  return add(row, "td", "p-3 border-b border-slate-100 align-middle " + css, value);
}
function heading(row, value, css = "") {
  const th = add(row, "th", "p-3 text-xs font-bold tracking-wide " + css, value);
  th.scope = "col";
  return th;
}
function render() {
  syncPublication();
  const table = el("gbQuarterTable");
  table.replaceChildren();
  const head = add(table, "thead", "bg-slate-800 text-white");
  const hr = add(head, "tr");
  heading(hr, "Student", "sticky left-0 z-20 bg-slate-800 min-w-[180px]");
  heading(hr, "Group / repository", "min-w-[155px]");
  for (const assessment of state.tasks) {
    const th = heading(hr, assessment.title || "Untitled", "min-w-[128px] max-w-[220px] whitespace-normal");
    th.title = (assessment.type || "") + " • Max " + (assessment.maxScore || 20);
  }
  if (!state.rows.length || !state.tasks.length) {
    const tr = add(add(table, "tbody"), "tr");
    const td = cell(tr, !state.rows.length ? "No students in this section." :
      "No assessments are assigned to this quarter and section.");
    td.colSpan = Math.max(2, state.tasks.length + 2);
    return;
  }
  const body = add(table, "tbody");
  for (const student of state.rows) {
    const tr = add(body, "tr", "hover:bg-slate-50");
    const studentCell = cell(tr, null, "sticky left-0 z-10 bg-white min-w-[180px]");
    add(studentCell, "div", "font-bold text-slate-900", student.name || "Unnamed student");
    add(studentCell, "div", "text-xs text-slate-500", student.githubUsername ? "@" + student.githubUsername : "GitHub not linked");
    const rep = cell(tr);
    const info = repoInfo(student);
    if (info) {
      const link = add(rep, "a", "font-semibold text-blue-700 hover:underline break-all", info.name);
      link.href = info.url; link.target = "_blank"; link.rel = "noopener noreferrer";
      add(rep, "span", "block");
      const commits = add(rep, "a", "text-xs text-blue-600 hover:underline", "View student commits ↗");
      commits.href = info.commits; commits.target = "_blank"; commits.rel = "noopener noreferrer";
    } else add(rep, "span", "text-xs text-slate-400", "No repository");
    for (const task of state.tasks) {
      const entry = state.grades.get(student.id + "::" + task.id);
      const scoreCell = cell(tr, null, "text-center");
      if (!entry) {
        add(scoreCell, "span", "text-slate-400", "—");
        continue;
      }
      const grade = entry.data;
      const btn = add(scoreCell, "button",
        "inline-flex flex-col items-center gap-1 rounded-lg border border-slate-200 bg-white hover:border-blue-500 hover:bg-blue-50 px-3 py-2 min-w-[85px]");
      btn.type = "button";
      add(btn, "strong", "text-base text-slate-900", String(grade.score) + " / " + String(grade.maxScore || task.maxScore || 20));
      add(btn, "span", "text-[10px] font-semibold " + (grade.published ? "text-emerald-700" :
        grade.reviewRequired ? "text-amber-700" : "text-slate-500"),
        grade.published ? "Published" : grade.provisionalScore ? "Investigate draft" :
        grade.reviewRequired ? "Review needed" : "Ready to publish");
      btn.addEventListener("click", () => openDetails(student, task, entry));
    }
  }
}
async function loadQuarter() {
  if (!state.ready || state.mode !== "quarter") return;
  const serial=++loadSerial;state.loading=true;syncPublication();
  const section = el("gbQuarterSection").value;
  const quarter = el("gbQuarter").value;
  if (!section) { state.loading=false;state.tasks=[];state.rows=[];state.grades.clear();render();status("Choose a class section."); return; }
  const tasks = state.assessments.filter(a => inSection(a, section) && quarterOf(a) === quarter)
    .sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  const students = state.students.filter(s => s.section === section)
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  state.tasks = tasks; state.rows = students; state.grades = new Map(); render();
  if (!tasks.length) { state.loading=false;syncPublication();status("No assessments found for this quarter."); return; }
  state.loading = true;
  status("Loading " + tasks.length + " assessment(s)…");
  try {
    const studentIds = new Set(students.map(s => s.id));
    // Bounded parallelism avoids one large read of all grades in the school.
    for (let i = 0; i < tasks.length; i += 4) {
      const batch = tasks.slice(i, i + 4);
      const snaps = await Promise.all(batch.map(task =>
        getDocs(query(collection(db, "student_grades"), where("taskId", "==", task.id)))));
      if(serial!==loadSerial)return;
      snaps.forEach((snapshot, n) => {
        const task = batch[n];
        snapshot.forEach(d => {
          const data = d.data();
          if (studentIds.has(data.studentId)) {
            state.grades.set(data.studentId + "::" + task.id, { ref: d.ref, data });
          }
        });
      });
    }
    render();
    status(students.length + " students • " + tasks.length + " assessments • click a score for details.");
  } catch (error) {
    if(serial!==loadSerial)return;
    status("Gradebook loading failed: " + error.message, true);
  } finally { if(serial===loadSerial){state.loading = false;syncPublication();} }
}
function detailLine(container, label, value) {
  const p = add(container, "p", "text-sm text-slate-700");
  add(p, "strong", "mr-2", label + ":");
  add(p, "span", "break-all", value == null || value === "" ? "Not recorded" : String(value));
}
function links(container, title, items, href) {
  detailLine(container, title, items.length ? items.length + " recorded" : "None");
  for (const item of items.slice(0, 40)) {
    const p = add(container, "p", "ml-3 text-xs");
    if (href) {
      const a = add(p, "a", "text-blue-700 hover:underline break-all", item);
      a.href = href(item); a.target = "_blank"; a.rel = "noopener noreferrer";
    } else add(p, "span", "break-all", item);
  }
  if (items.length > 40) add(container, "p", "ml-3 text-xs text-slate-500", "Showing the first 40.");
}
function renderEvidence(student, task, grade) {
  const box = el("gbDetailEvidence"); box.replaceChildren();
  const evidence = grade.contributionEvidence || {};
  const info = repoInfo(student);
  detailLine(box, "Repository", evidence.repository || info?.name);
  detailLine(box, "GitHub login", evidence.githubLogin || student.githubUsername);
  detailLine(box, "Graded revision", grade.gradedSha || evidence.scannedSha);
  detailLine(box, "Assessment target", grade.targetPath || task.targetPaths?.join(", "));
  detailLine(box, "File discovery", grade.sourceSelectionMode === "investigation"
    ? "ALTERNATIVE FILES — PROVISIONAL SCORE; HIGH-PRIORITY TEACHER REVIEW"
    : "Blueprint target-path match");
  detailLine(box, "Expected file types", evidence.expectedExtensions?.join(", ") || "Not specified");
  detailLine(box, "Penalties / flags", (grade.penaltyTags || []).join(", "));
  if (grade.sourceSelectionMode === "investigation") {
    links(box, "Investigation reasons",
      (evidence.fallbackReasons || []).map(f =>
        f.path + " — " + (f.reasons || []).join("; ")));
    links(box, "Other candidate file paths", evidence.fallbackCandidatePaths || []);
  }
  detailLine(box, "Review status", grade.reviewRequired ? "Draft requires teacher review" : grade.published ? "Published" : "Unpublished");
  const breakdown = grade.criteriaScores || grade.rubricBreakdown || grade.criterionScores;
  if (breakdown) detailLine(box, "Rubric breakdown", JSON.stringify(breakdown));
  else detailLine(box, "Rubric breakdown", "Not stored by the current grader");
  links(box, "Considered files", evidence.matchedPaths || grade.pathsFound || []);
  links(box, "Excluded out-of-scope or other-named files",
    evidence.excludedTaskOrClassmatePaths || []);
  const reviewReasons=(grade.reviewReasons||[]).filter(reason=>{
    const text=String(reason||"");
    if(Number.isFinite(Number(grade.score))&&/no grade has been recorded/i.test(text))return false;
    if(grade.reviewRequired!==true&&/saved grade draft predates the current evidence approval/i.test(text))return false;
    return true;
  });
  links(box, grade.published?"Review notes":"Evidence warnings", reviewReasons);
  const commits = evidence.acceptedCommitShas || [];
  links(box, "Attributed commits", commits, sha => info ? info.url + "/commit/" + encodeURIComponent(sha) : "#");
  if (info) {
    const a = add(box, "a", "inline-block text-blue-700 font-bold underline mt-2", "Open student's GitHub commits ↗");
    a.href = info.commits; a.target = "_blank"; a.rel = "noopener noreferrer";
  }
}
async function loadRevisions(entry) {
  const historyBox = el("gbRevisionHistory");
  historyBox.replaceChildren();
  add(historyBox, "p", "text-slate-500", "Loading previous grades…");
  try {
    const result = await getDocs(query(collection(db, "grade_revisions"), where("gradeId", "==", entry.ref.id)));
    if (state.active?.entry.ref.id !== entry.ref.id) return;
    historyBox.replaceChildren();
    const records = result.docs.map(d => d.data()).sort((a, b) =>
      (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    if (!records.length) {
      add(historyBox, "p", "text-slate-500", "No previous grade revisions recorded.");
      return;
    }
    for (const version of records.slice(0, 40)) {
      const wrap = add(historyBox, "details", "border-b border-slate-200 py-2");
      const date = version.createdAt?.toDate ? version.createdAt.toDate().toLocaleString() : "Earlier revision";
      add(wrap, "summary", "cursor-pointer text-slate-700 font-semibold", date + " — " + (version.reason || "Grade changed"));
      add(wrap, "p", "mt-2 text-slate-700", "Before: " + (version.before?.score ?? "n/a") +
        " • After: " + (version.after?.score ?? "n/a"));
      if (version.before?.feedback) add(wrap, "p", "mt-1 break-words whitespace-pre-wrap", "Previous feedback: " + cleanGradeFeedback(version.before.feedback));
    }
  } catch (error) {
    historyBox.replaceChildren();
    add(historyBox, "p", "text-rose-700", "Revision history unavailable: " + error.message);
  }
}
function openDetails(student, task, entry) {
  detailsDirty=false;
  state.active = { student, task, entry };
  const grade = entry.data;
  el("gbDetailTitle").textContent = student.name + " — " + task.title;
  el("gbDetailSubtitle").textContent = (student.githubUsername ? "@" + student.githubUsername + " · " : "") +
    (repoInfo(student)?.name || "Unlinked repository");
  el("gbEditScore").value = Number(grade.score);
  el("gbEditMax").value = String(grade.maxScore || task.maxScore || 20);
  el("gbEditFeedback").value = cleanGradeFeedback(grade.feedback);
  renderFeedbackMarkdown(el("gbFeedbackPreview"),grade.feedback);
  for(const id of ["gbEditScore","gbEditFeedback","gbEditReason","gbMarkReviewed","gbDetailSave"])el(id).disabled=grade.published===true||task.schemaVersion===2;
  el("gbDetailReviewLink").classList.toggle("hidden",task.schemaVersion!==2);
  el("gbDetailReviewLink").href="repofetch.html?"+new URLSearchParams({student:student.id,assessment:task.id,section:student.section||""});
  el("gbEditReason").value = "";
  el("gbMarkReviewed").checked = !grade.reviewRequired;
  el("gbDetailStatus").textContent = grade.published ? "Published grade protected. Unpublish before revising." :
    grade.reviewRequired ? "Private: flagged for teacher review before publishing." : "Private: ready for publication.";
  el("gbDetailPublish").classList.toggle("hidden", grade.published === true);
  el("gbDetailUnpublish").classList.toggle("hidden", grade.published !== true);
  renderEvidence(student, task, grade);
  el("gbDetailModal").classList.remove("hidden");
  void loadRevisions(entry);
}
function closeDetails() {
  if(detailsDirty&&!confirm("Discard unsaved teacher feedback or score changes?"))return false;
  el("gbDetailModal").classList.add("hidden");
  state.active = null;
  return true;
}
async function saveDetails() {
  const active = state.active;
  if (!active) return;
  const grade = active.entry.data;
  if(grade.published)return reviewNotice("Published grade protected. Unpublish before revising.",true);
  if(active.task.schemaVersion===2)return alert("Use Review & Grade in RepoFetch to adjust V2 scores and feedback against the current approved evidence. Unpublish a released grade before editing.");
  const score = Number(el("gbEditScore").value);
  const feedback = cleanGradeFeedback(el("gbEditFeedback").value);
  const reason = el("gbEditReason").value.trim();
  const maxScore = Number(grade.maxScore || active.task.maxScore || 20);
  if (!el("gbEditScore").value.trim() || !Number.isFinite(score) || score < 0 || score > maxScore)
    return alert("Enter a valid score between 0 and " + maxScore + ".");
  if (!feedback) return alert("Feedback cannot be empty.");
  if (!reason) return alert("Describe the reason for the adjustment or review.");
  if (grade.published && !confirm("This grade is published. Saving a revised score or feedback will immediately be visible to the student. Continue?")) return;
  const reviewed = el("gbMarkReviewed").checked;
  try {
    el("gbDetailSave").disabled = true;
    const revision = doc(collection(db, "grade_revisions"));
    await runTransaction(db, async tx => {
      const latest = await tx.get(active.entry.ref);
      if (!latest.exists()) throw new Error("The grade no longer exists.");
      const before = latest.data();
      assertGradeVersion(before,grade);
      tx.set(revision, {
        studentId: active.student.id, taskId: active.task.id,
        gradeId: active.entry.ref.id, reason, editorUid: auth.currentUser?.uid || null,
        before: { score: before.score, feedback: before.feedback, published: before.published, reviewRequired: before.reviewRequired === true },
        after: { score, feedback, published: before.published, reviewRequired: !reviewed },
        createdAt: serverTimestamp()
      });
      tx.update(active.entry.ref, {
        score, feedback,gradeVersion:nextGradeVersion(before),reviewRequired: !reviewed, editedAt: serverTimestamp(),
        manuallyAdjusted: true, editedBy: auth.currentUser?.uid || null
      });
    });
    el("gbDetailStatus").textContent = "Saved. Previous score and feedback were archived in grade_revisions.";
    detailsDirty=false;
    await loadQuarter();
    closeDetails();
  } catch (error) {
    el("gbDetailStatus").textContent = "Save failed: " + error.message;
  } finally { el("gbDetailSave").disabled = false; }
}
async function togglePublish(makePublished) {
  if (!state.active) return;
  const active = state.active;
  if(detailsDirty)return reviewNotice("Save or discard your edits before changing publication.",true);
  if (makePublished && active.entry.data.reviewRequired && !el("gbMarkReviewed").checked) {
    return alert("Review the evidence and check the teacher-review confirmation before publishing.");
  }
  if (!confirm((makePublished ? "Publish" : "Unpublish") + " this student's grade?")) return;
  try {
    const revision = doc(collection(db, "grade_revisions"));
    await runTransaction(db, async tx => {
      const gradeSnap = await tx.get(active.entry.ref);
      if (!gradeSnap.exists()) throw new Error("Grade missing.");
      const previous = gradeSnap.data();
      assertGradeVersion(previous,active.entry.data);
      const isV2=active.task.schemaVersion===2;
      if(makePublished&&isV2){
        const {verifyGradePublication}=await import("./services/evidence-transaction.mjs?v=1.3.0");
        await verifyGradePublication(tx,active.entry.ref,previous);
      }
      if (makePublished && previous.reviewRequired && !el("gbMarkReviewed").checked) {
        throw new Error("Teacher review is required.");
      }
      tx.set(revision, {
        studentId: active.student.id, taskId: active.task.id, gradeId: active.entry.ref.id,
        reason: makePublished ? "Teacher published grade" : "Teacher unpublished grade",
        editorUid: auth.currentUser?.uid || null,
        before: { published: !!previous.published, reviewRequired: !!previous.reviewRequired },
        after: { published: makePublished, reviewRequired: makePublished ? false : !!previous.reviewRequired },
        createdAt: serverTimestamp()
      });
      tx.update(active.entry.ref, {
        published: makePublished,
        ...(makePublished&&!isV2 ? { reviewRequired: false, reviewedAt: serverTimestamp() } : {})
      });
    });
    closeDetails(); await loadQuarter();
  } catch (error) { alert("Unable to change grade visibility: " + error.message); }
}
async function bulkVisibility(makePublished) {
  if(bulkBusy||state.loading)return;
  const entries=queueEntries(),eligible=publicationCandidates(entries,makePublished);
  const flagged=makePublished?entries.filter(entry=>entry.data?.published!==true&&entry.data?.reviewRequired===true).length:0;
  if (!eligible.length) return alert(makePublished&&flagged?
    "All remaining private drafts are flagged for manual review.":
    "No eligible grades to " + (makePublished ? "publish." : "unpublish."));
  const message=makePublished?
    "Publish "+eligible.length+" private draft"+(eligible.length===1?"":"s")+" for this quarter?"+(flagged?" "+flagged+" flagged draft"+(flagged===1?" will":"s will")+" stay private.":""):
    "Unpublish "+eligible.length+" grade"+(eligible.length===1?"":"s")+" for the selected quarter and section?";
  if (!confirm(message)) return;
  bulkBusy=true;syncPublication();
  try {
    const result=await publishGradeEntries(eligible,makePublished,{context:publicationContext(),onProgress:value=>reviewNotice(value.completed.length+" processed; "+value.pending.length+" pending.")});
    reviewNotice(result.pending.length?
      "Some grades changed or failed. Reload before retrying.":
      makePublished?"Published "+result.completed.length+" private draft"+(result.completed.length===1?"":"s")+(flagged?"; flagged drafts stayed private.":"."):"Unpublish complete.",
      Boolean(result.pending.length));
    await loadQuarter();
  } catch (error) { reviewNotice("Batch paused: " + error.message,true); }
  finally{bulkBusy=false;syncPublication();}
}
function tableData() {
  const header = ["Student name", "Repository"].concat(state.tasks.map(t => t.title));
  const rows = state.rows.map(student => {
    const rep = repoInfo(student);
    return [student.name || "", rep?.name || ""].concat(state.tasks.map(task => {
      const entry = state.grades.get(student.id + "::" + task.id);
      return entry && Number.isFinite(Number(entry.data.score)) ? String(entry.data.score) : "";
    }));
  });
  return [header, ...rows];
}
function sheetCell(value) {
  let str = String(value ?? "").replace(/[\r\n\t]+/g, " ").trim();
  if (/^[=+@-]/.test(str)) str = "'" + str;
  return str;
}
async function copyTable() {
  try {
    await navigator.clipboard.writeText(tableData().map(row => row.map(sheetCell).join("\t")).join("\n"));
    status("Quarter matrix copied. Paste directly into Google Sheets or Excel.");
  } catch (error) { status("Clipboard failed: " + error.message, true); }
}
function exportCSV() {
  const content = "\ufeff" + tableData().map(row => row.map(cell => {
    const safe = sheetCell(cell);
    return '"' + safe.replaceAll('"', '""') + '"';
  }).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "Adminerva_" + (el("gbQuarterSection").value || "section") + "_" +
    el("gbQuarter").value + "_scores.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function init() {
  window.openGradebookFeedback=async({studentId,taskId})=>{
    const student=state.students.find(item=>item.id===studentId),task=state.assessments.find(item=>item.id===taskId);
    if(!student||!task)return reviewNotice("This record is not in the loaded roster. Reload the gradebook.",true);
    if(state.active&&!closeDetails())return;
    try{
      const ref=doc(db,"student_grades",studentId+"_"+taskId),snapshot=await getDoc(ref);
      if(snapshot.exists())openDetails(student,task,{ref,data:snapshot.data()});
      else reviewNotice("This saved grade is unavailable. Reload before continuing.",true);
    }catch{reviewNotice("Feedback could not load. Check your connection and sign-in; no grade changed.",true);}
  };
  for(const id of ["gbEditScore","gbEditFeedback","gbEditReason","gbMarkReviewed"])el(id).addEventListener("input",()=>{detailsDirty=true;renderFeedbackMarkdown(el("gbFeedbackPreview"),el("gbEditFeedback").value);});
  el("gbViewQuarter").addEventListener("click", () => view("quarter"));
  el("gbViewSingle").addEventListener("click", () => view("single"));
  el("gbQuarterSection").addEventListener("change", loadQuarter);
  el("gbQuarter").addEventListener("change", loadQuarter);
  el("gbCopyTSV").addEventListener("click", copyTable);
  el("gbDownloadCSV").addEventListener("click", exportCSV);
  el("gbQuarterPublish").addEventListener("click", () => bulkVisibility(true));
  el("gbQuarterUnpublish").addEventListener("click", () => bulkVisibility(false));
  el("gbDetailClose").addEventListener("click", closeDetails);
  el("gbDetailSave").addEventListener("click", saveDetails);
  el("gbDetailPublish").addEventListener("click", () => togglePublish(true));
  el("gbDetailUnpublish").addEventListener("click", () => togglePublish(false));
  el("gbDetailModal").addEventListener("click", e => {
    if (e.target === el("gbDetailModal")) closeDetails();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !el("gbDetailModal").classList.contains("hidden")) closeDetails();
  });
  view("single");
  onAuthStateChanged(auth, async user => {
    if (!user) return;
    try {
      status("Loading class roster and assessment quarters…");
      const [students, assessments] = await Promise.all([
        getDocs(collection(db, "students")), getDocs(collection(db, "assessments"))
      ]);
      state.students = students.docs.map(d => ({ id: d.id, ...d.data() }));
      state.subjectFocus=await resolveStaffSubjects(user);
      state.assessments = assessments.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(assessment=>!state.subjectFocus.length||!assessment.subject||state.subjectFocus.includes(assessment.subject));
      const sections = [...new Set(state.students.map(s => s.section).filter(Boolean))].sort();
      const select = el("gbQuarterSection"); select.replaceChildren();
      add(select, "option", "", "Select class section").value = "";
      for (const section of sections) add(select, "option", "", section).value = section;
      state.ready = true;
      if (sections.length) { select.value = sections[0]; await loadQuarter(); }
      else status("No enrolled students were found.");
    } catch (error) { status("Unable to initialize quarter matrix: " + error.message, true); }
  });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
