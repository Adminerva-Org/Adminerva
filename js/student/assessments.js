import { db, auth } from "../core/firebase-core.js";
import { cleanGradeFeedback } from "../core/feedback-format.mjs";
import {asDate,assessmentStatus} from "./assessment-state.mjs";
import {
  collection,
  getDocs,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

let allAssessments = [];
let userProfiles = [];
let currentSection = "";
let myGrades = {};
let mySubmitted = {};
let submissionLookupSucceeded = false;

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

onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  // ✨ UX FIX 1: Remove the white screen instantly!
  const pageBody = document.getElementById("pageBody");
  if (pageBody) pageBody.classList.remove("hidden");

  // ✨ UX FIX 2: Show the skeleton loader instantly while Firebase thinks!
  const container = document.getElementById("assignmentsFeed");
  if (container) {
    container.innerHTML = `
        <div class="animate-pulse bg-white p-5 rounded-xl border border-slate-200">
          <div class="h-4 bg-slate-200 rounded w-1/4 mb-4"></div>
          <div class="h-4 bg-slate-200 rounded w-3/4 mb-2"></div>
          <div class="h-4 bg-slate-200 rounded w-1/2"></div>
        </div>
      `;
  }

  const targetEmail =
    localStorage.getItem("Adminerva_Impersonate") || user.email;

  try {
    // Now that the UI is loading, we can safely do the heavy database queries
    const q = query(
      collection(db, "students"),
      where("email", "==", targetEmail.toLowerCase()),
    );
    const snap = await getDocs(q);

    if (!snap.empty) {
      userProfiles = [];
      snap.forEach((d) => userProfiles.push({ id: d.id, ...d.data() }));

      const selector = document.getElementById("sectionSelectorAssessments");
      if (userProfiles.length > 1 && selector) {
        selector.classList.remove("hidden");
        selector.innerHTML = "";
        userProfiles.forEach((profile, index) => {
          selector.insertAdjacentHTML(
            "beforeend",
            `<option value="${index}">${escapeHTML(profile.section)}</option>`,
          );
        });
        selector.addEventListener("change", (e) => {
          currentSection = userProfiles[e.target.value].section;

          // Re-trigger the skeleton if they change sections
          container.innerHTML = `
            <div class="animate-pulse bg-white p-5 rounded-xl border border-slate-200">
              <div class="h-4 bg-slate-200 rounded w-1/4 mb-4"></div>
              <div class="h-4 bg-slate-200 rounded w-3/4 mb-2"></div>
              <div class="h-4 bg-slate-200 rounded w-1/2"></div>
            </div>
          `;
          fetchAssessments();
        });
      }

      currentSection = userProfiles[0].section;
      fetchAssessments();
    }
  } catch (error) {
    console.error("Error identifying student section:", error);
  }
});

async function fetchAssessments() {
  if (!currentSection) return;
  const container = document.getElementById("assignmentsFeed");

  const studentProfile = userProfiles.find((p) => p.section === currentSection);
  const studentId = studentProfile ? studentProfile.id : null;

  myGrades = {};
  mySubmitted = {};
  submissionLookupSucceeded = false;
  if(studentId) {
    try{
      const submissionSnap=await getDocs(query(
        collection(db,"student_submissions"),where("studentId","==",studentId)
      ));
      submissionSnap.forEach(item=>{
        const entry=item.data();
        const previous=mySubmitted[entry.assessmentId];
        const timestamp=asDate(entry.submittedAt)?.getTime()||0;
        if(!previous||timestamp>(asDate(previous.submittedAt)?.getTime()||0))
          mySubmitted[entry.assessmentId]=entry;
      });
      submissionLookupSucceeded=true;
    }catch(error){
      console.warn("Submission receipts are not available; status remains unknown:",error);
    }
  }
  if (studentId) {
    try {
      const gradeSnap = await getDocs(
        query(
          collection(db, "student_grades"),
          where("studentId", "==", studentId),
        where("published", "==", true),
        ),
      );
      gradeSnap.forEach((d) => {
        const data = d.data();
        if (data.published === true) myGrades[data.taskId] = data;
      });
    } catch (e) {
      console.warn(
        "Could not fetch grades - Check your Firestore Security Rules!",
        e,
      );
    }
  }

  try {
    const q = query(collection(db, "assessments"));
    const snap = await getDocs(q);

    allAssessments = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      let isAssignedToStudent = false;
      let activeDeadline = null;
      let noDeadline = false;
      let activePostDate=asDate(data.createdAt)||new Date();

      if (data.deployments && Array.isArray(data.deployments)) {
        const deployment = data.deployments.find(
          (d) => d.section === currentSection,
        );
        if (deployment) {
          isAssignedToStudent = true;
          noDeadline = deployment.deadlineEnabled === false;
          if (deployment.deadline && !noDeadline)
            activeDeadline=asDate(deployment.deadline);
          if (deployment.postDate)
            activePostDate=asDate(deployment.postDate)||activePostDate;
        }
      } else if (data.targetSections && Array.isArray(data.targetSections)) {
        if (data.targetSections.includes(currentSection)) {
          isAssignedToStudent = true;
          if (data.dueDate)
            activeDeadline=asDate(data.dueDate);
        }
      }

      if (isAssignedToStudent) {
        const isUrgent = activeDeadline
          ? new Date(activeDeadline) < new Date()
          : false;
        allAssessments.push({
          ...data,
          id: docSnap.id,
          isUrgent,
          postedDate: activePostDate,
          dueDate: activeDeadline,
          noDeadline,
        });
      }
    });

    renderAssessments();
  } catch (error) {
    container.innerHTML = `<div class="p-5 text-center text-red-500 font-bold border border-red-200 bg-red-50 rounded-xl">Failed to load assignments. Check console.</div>`;
    console.error("Fetch Error:", error);
  }
}

function renderAssessments() {
  const container = document.getElementById("assignmentsFeed");
  const searchQuery = document
    .getElementById("searchAssInput")
    .value.toLowerCase();
  const filterStatus = document.getElementById("filterStatus").value;
  const sortOption = document.getElementById("sortDate").value;

  let filtered = allAssessments.filter((ass) => {
    const matchesSearch =
      String(ass.title||"").toLowerCase().includes(searchQuery) ||
      (ass.taskContext || "").toLowerCase().includes(searchQuery);
    const matchesStatus =
      filterStatus === "all" ||
      (filterStatus === "urgent" && ass.isUrgent) ||
      (filterStatus === "pending" && !ass.isUrgent);
    return matchesSearch && matchesStatus;
  });

  filtered.sort((a, b) => {
    if (sortOption === "newest") return b.postedDate - a.postedDate;
    if (sortOption === "oldest") return a.postedDate - b.postedDate;
    if (sortOption === "deadline") {
      const dateA = a.dueDate ? new Date(a.dueDate) : a.postedDate;
      const dateB = b.dueDate ? new Date(b.dueDate) : b.postedDate;
      return dateA - dateB;
    }
  });

  container.innerHTML = "";
  if (filtered.length === 0) {
    container.innerHTML = `<div class="py-12 text-center text-slate-400 font-medium italic border-2 border-dashed border-slate-200 rounded-xl bg-white">No assignments found for ${escapeHTML(currentSection)}.</div>`;
    return;
  }

  filtered.forEach((ass) => {
    const typeColor =
      ass.type === "PETA"
        ? "bg-purple-100 text-purple-700 border-purple-200"
        : ass.type === "Formative"
          ? "bg-green-100 text-green-700 border-green-200"
          : "bg-blue-100 text-blue-700 border-blue-200";

    const myGrade=myGrades[ass.id];
    const status=assessmentStatus({
      grade:myGrade,submitted:Boolean(mySubmitted[ass.id]),
      deadline:ass.noDeadline?null:ass.dueDate,
      knownSubmissions:submissionLookupSucceeded
    });
    const colors={
      graded:"text-emerald-800 bg-emerald-50 border-emerald-200",
      revision:"text-amber-800 bg-amber-50 border-amber-200",
      submitted:"text-blue-800 bg-blue-50 border-blue-200",
      pastdue:"text-rose-700 bg-rose-50 border-rose-200",
      notSubmitted:"text-slate-700 bg-slate-100 border-slate-200",
      unknown:"text-amber-700 bg-amber-50 border-amber-200"
    };
    const urgencyBadge=`<span class="text-[10px] font-bold border rounded-full px-2 py-1 ${colors[status.kind]}">${escapeHTML(status.text)}${status.kind==="graded"?" · "+escapeHTML(myGrade.score):""}</span>`;

    const deadlineString = ass.noDeadline
      ? '<span class="text-[10px] text-slate-500 font-medium ml-auto">No deadline</span>'
      : ass.dueDate
      ? `<span class="text-[10px] text-slate-400 font-medium ml-auto">Due: ${ass.dueDate.toLocaleDateString()}</span>`
      : `<span class="text-[10px] text-slate-400 font-medium ml-auto">Posted: ${ass.postedDate.toLocaleDateString()}</span>`;

    const card = `
      <div class="bg-white p-5 rounded-xl border ${ass.isUrgent && !myGrade ? "border-rose-300 shadow-sm" : "border-slate-200"} hover:shadow-md transition cursor-pointer flex flex-col sm:flex-row sm:items-center gap-4" onclick="viewAssessmentDetails('${ass.id}')">
        <div class="flex-grow">
          <div class="flex items-center gap-3 mb-2 flex-wrap">
            <span class="${typeColor} text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider">${escapeHTML(ass.type)}</span>
            ${urgencyBadge}
            ${deadlineString}
          </div>
          <h3 class="text-lg font-bold text-slate-800 leading-tight">${escapeHTML(ass.title)}</h3>
          <p class="text-sm text-slate-500 mt-2 line-clamp-2">${escapeHTML(ass.taskContext || "No context provided.")}</p>
        </div>
        <div class="sm:border-l sm:border-slate-200 sm:pl-4 flex flex-row sm:flex-col items-center justify-between sm:justify-center w-full sm:w-32 gap-2 mt-2 sm:mt-0">
          <span class="text-[10px] text-slate-400 uppercase font-bold tracking-widest">Target File</span>
          <span class="text-[10px] font-mono bg-slate-100 text-slate-600 px-2 py-1 rounded truncate max-w-full" title="${escapeHTML(ass.targetPath || "Any")}">${escapeHTML(ass.targetPath || "Any")}</span>
        </div>
      </div>
    `;
    container.insertAdjacentHTML("beforeend", card);
  });
}

window.addEventListener("adminerva:submission-recorded",event=>{
  const {assessmentId,studentId}=event.detail||{};
  const profile=userProfiles.find(p=>p.section===currentSection);
  if(profile?.id===studentId && assessmentId){
    mySubmitted[assessmentId]={assessmentId,submittedAt:new Date()};
    submissionLookupSucceeded=true;
    renderAssessments();
  }
});

document.addEventListener("DOMContentLoaded", () => {
  document
    .getElementById("searchAssInput")
    ?.addEventListener("input", renderAssessments);
  document
    .getElementById("filterStatus")
    ?.addEventListener("change", renderAssessments);
  document
    .getElementById("sortDate")
    ?.addEventListener("change", renderAssessments);
});

window.__adminervaSubmissionContext = () => ({
  task: allAssessments.find(a => a.id === window.__adminervaViewedAssessmentId),
  profile: userProfiles.find(p => p.section === currentSection),
  section: currentSection
});
window.viewAssessmentDetails = function (id) {
  window.__adminervaViewedAssessmentId = id;
  const ass = allAssessments.find((a) => a.id === id);
  if (!ass) return;

  const typeColor =
    ass.type === "PETA"
      ? "bg-purple-500/20 text-purple-300 border-purple-500/30"
      : ass.type === "Formative"
        ? "bg-green-500/20 text-green-300 border-green-500/30"
        : "bg-blue-500/20 text-blue-300 border-blue-500/30";
  document.getElementById("modalAssType").className =
    `${typeColor} text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider mb-2 inline-block`;
  document.getElementById("modalAssType").textContent = ass.type;
  document.getElementById("modalAssTitle").textContent = ass.title;
  document.getElementById("modalAssPath").textContent =
    `Target File: ${ass.targetPath || "Any"}`;
  document.getElementById("modalAssContext").textContent =
    ass.taskContext || "No instructions provided.";
  document.getElementById("modalAssRubric").textContent =
    ass.evalCriteria || "No specific criteria provided.";

  const scoreArea = document.getElementById("modalScoreArea");
  const myGrade = myGrades[id];
  if (myGrade) {
    document.getElementById("modalScoreValue").textContent = myGrade.score;
    document.getElementById("modalScoreFeedback").textContent =
      cleanGradeFeedback(myGrade.feedback) || "No feedback provided.";
    scoreArea.classList.remove("hidden");
  } else {
    scoreArea.classList.add("hidden");
  }

  document.getElementById("assessmentModal").classList.remove("hidden");
  window.dispatchEvent(new CustomEvent("adminerva:assessment-opened",{detail:{assessmentId:id}}));
};
