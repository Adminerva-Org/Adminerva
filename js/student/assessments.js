import {loadPublishedGrades} from "./published-grades.mjs?v=1.3.0";
/** Student submissions, practice progress and isolated code workspaces: assessments. */
import { db, auth } from "../core/firebase-core.js?v=1.3.0";
import { cleanGradeFeedback } from "../core/feedback-format.mjs?v=1.3.0";
import {asDate,assessmentStatus,assessmentTargetDetails} from "./assessment-state.mjs?v=1.3.0";
import {ensureStudentAccessProjection} from "./student-access.mjs?v=1.3.6";
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
let myEvidence = {};
let submissionLookupSucceeded = false;
let profileGeneration=0,assessmentGeneration=0,assignmentOwnerUid="";
const assignmentField=id=>document.getElementById(id);
function assignmentsNotice(message,tone="info",retry=false){
  assignmentField("assignmentsNoticeText").textContent=message;assignmentField("assignmentsNotice").dataset.tone=tone;
  assignmentField("assignmentsNotice").classList.toggle("hidden",!message);assignmentField("assignmentsRetry").classList.toggle("hidden",!retry);
}
function assignmentsFeedState(title,message){assignmentField("assignmentsFeed").innerHTML=`<div class="bg-white border border-slate-200 rounded-xl p-6 text-center"><h2 class="font-bold text-slate-800">${escapeHTML(title)}</h2><p class="text-sm text-slate-600 mt-2">${escapeHTML(message)}</p></div>`;}
function setAssignmentControls(loading){for(const id of ["searchAssInput","filterStatus","sortDate","sectionSelectorAssessments","assignmentsRetry"])assignmentField(id).disabled=loading;}

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

async function loadStudentAssignments(user=auth.currentUser){
  const version=++profileGeneration,previousSection=assignmentOwnerUid===user?.uid?currentSection:"";
  assessmentGeneration++;allAssessments=[];userProfiles=[];currentSection="";myGrades={};mySubmitted={};myEvidence={};submissionLookupSucceeded=false;
  assignmentOwnerUid=user?.uid||"";setAssignmentControls(true);assignmentField("assessmentModal").classList.add("hidden");
  const selector=assignmentField("sectionSelectorAssessments");selector.replaceChildren();selector.classList.add("hidden");
  if(!user?.email){assignmentsNotice("Sign in with your school account to view your assignments.");assignmentsFeedState("Sign in to continue","Your class assignments appear after you sign in.");setAssignmentControls(false);return;}
  const end = window.beginLoading?.("Loading assessments and evidence…", document.getElementById("assignmentsFeed")) || (() => {});

  // ✨ UX FIX 1: Remove the white screen instantly!
  const pageBody = document.getElementById("pageBody");
  if (pageBody) pageBody.classList.remove("hidden");

  assignmentsNotice("Finding your class…");assignmentsFeedState("Loading your class","Your assignments will appear here shortly.");

  const targetEmail =
    localStorage.getItem("Adminerva_Impersonate") || user.email;

  try {
    // Now that the UI is loading, we can safely do the heavy database queries
    const q = query(
      collection(db, "students"),
      where("email", "==", targetEmail.toLowerCase()),
    );
    const snap = await getDocs(q);
    if(version!==profileGeneration||auth.currentUser?.uid!==user.uid)return;
    if (!snap.empty) {
      userProfiles = [];
      snap.forEach((d) => userProfiles.push({ id: d.id, ...d.data() }));

      if (selector) {
        selector.classList.toggle("hidden",userProfiles.length<2);
        selector.innerHTML = "";
        userProfiles.forEach((profile, index) => {
          selector.insertAdjacentHTML(
            "beforeend",
            `<option value="${index}">${escapeHTML(profile.section)}</option>`,
          );
        });
        selector.onchange = (e) => {
          currentSection = userProfiles[e.target.value].section;
          assignmentField("assessmentModal").classList.add("hidden");void fetchAssessments();
        };
      }
      const index=Math.max(0,userProfiles.findIndex(profile=>profile.section===previousSection));selector.value=String(index);currentSection = userProfiles[index].section;
      await fetchAssessments();
    }else{
      assignmentsNotice("Your school email is not linked to a class yet. Ask your teacher to check your email and section in User Directory, then retry.","info",true);
      assignmentsFeedState("No student class linked","Your teacher needs to add your verified school email and section before assignments can appear.");
    }
  } catch (error) {
    if(version===profileGeneration&&auth.currentUser?.uid===user.uid){assignmentsNotice("Your class could not load. Check your connection and retry.","error",true);assignmentsFeedState("Unable to load your class","Retry loading assignments when your connection is ready.");}
  } finally { end();if(version===profileGeneration)setAssignmentControls(false); }
}
onAuthStateChanged(auth,user=>void loadStudentAssignments(user));
assignmentField("assignmentsRetry").addEventListener("click",()=>void loadStudentAssignments());

async function fetchAssessments() {
  const sequence=++assessmentGeneration,uid=auth.currentUser?.uid,section=currentSection;
  const isCurrent=()=>sequence===assessmentGeneration&&uid===auth.currentUser?.uid&&section===currentSection;
  if (!section){assignmentsNotice("Your student record has no section yet. Ask your teacher to assign a class in User Directory, then retry.","info",true);assignmentsFeedState("No section assigned","Your assignments will appear after your teacher links your class.");return;}
  const end = window.beginLoading?.("Loading assessment records…") || (() => {});
  setAssignmentControls(true);assignmentsNotice("Loading assignments and review status…");assignmentsFeedState("Loading assignments","Checking your tasks, submissions and published feedback.");
  try {
  const container = document.getElementById("assignmentsFeed");

  const studentProfile = userProfiles.find((p) => p.section === currentSection);
  const studentId = studentProfile ? studentProfile.id : null;

  const nextGrades={},nextSubmitted={},nextEvidence={},nextAssessments=[],lookupFailures=[];
  let receiptsKnown=false;
  if(studentId) {
    try{
      const submissionSnap=await getDocs(query(
        collection(db,"student_submissions"),where("studentId","==",studentId)
      ));
      if(!isCurrent())return;
      submissionSnap.forEach(item=>{
        const entry=item.data();
        const previous=nextSubmitted[entry.assessmentId];
        const timestamp=asDate(entry.submittedAt)?.getTime()||0;
        if(!previous||timestamp>(asDate(previous.submittedAt)?.getTime()||0))
          nextSubmitted[entry.assessmentId]=entry;
      });
      receiptsKnown=true;
    }catch(error){
      lookupFailures.push("submissions");
    }
  }
  if(studentId){
    try{
      const evidenceSnap=await getDocs(query(collection(db,"assessment_evidence"),
        where("studentId","==",studentId)));
      if(!isCurrent())return;
      evidenceSnap.forEach(item=>{const data=item.data();nextEvidence[data.assessmentId]=data;});
    }catch(error){lookupFailures.push("evidence");}
  }
  if (studentId) {
    try {
      const gradeSnap = await loadPublishedGrades(studentId);
      if(!isCurrent())return;
      gradeSnap.forEach((d) => {
        const data = d.data();
        if (data.published === true) nextGrades[data.taskId] = data;
      });
    } catch (e) {
      lookupFailures.push("published feedback");
    }
  }

  try {
    await ensureStudentAccessProjection();
    if(!isCurrent())return;
    const [sectionSnap,legacySnap] = await Promise.all([
      getDocs(query(collection(db, "assessments"),where("sectionIds","array-contains",section))),
      getDocs(query(collection(db, "assessments"),where("targetSections","array-contains",section)))
    ]);
    if(!isCurrent())return;
    const assignedDocs=new Map();
    for(const docSnap of [...sectionSnap.docs,...legacySnap.docs])assignedDocs.set(docSnap.id,docSnap);
    assignedDocs.forEach((docSnap) => {
      const data = docSnap.data();
      let isAssignedToStudent = false;
      let activeDeadline = null;
      let noDeadline = false;
      let activePostDate=asDate(data.createdAt)||new Date();

      if (data.deployments && Array.isArray(data.deployments)) {
        const deployment = data.deployments.find(
          (d) => d.section === section,
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
        if (data.targetSections.includes(section)) {
          isAssignedToStudent = true;
          if (data.dueDate)
            activeDeadline=asDate(data.dueDate);
        }
      }

      if (isAssignedToStudent) {
        const isUrgent = activeDeadline
          ? new Date(activeDeadline) < new Date()
          : false;
        nextAssessments.push({
          ...data,
          id: docSnap.id,
          isUrgent,
          postedDate: activePostDate,
          dueDate: activeDeadline,
          noDeadline,
        });
      }
    });

    allAssessments=nextAssessments;myGrades=nextGrades;mySubmitted=nextSubmitted;myEvidence=nextEvidence;submissionLookupSucceeded=receiptsKnown&&lookupFailures.length===0;
    assignmentsNotice(lookupFailures.length?"Some "+lookupFailures.join(", ")+" could not load. Status may be incomplete. Retry to refresh these details.":"",lookupFailures.length?"error":"info",lookupFailures.length>0);renderAssessments();
  } catch (error) {
    if(isCurrent()){assignmentsNotice("Your assignments could not load. Check your connection and retry.","error",true);assignmentsFeedState("Unable to load assignments","Retry loading to reconnect to your class. No submissions or grades have changed.");}
  }
  } finally { end();if(isCurrent())setAssignmentControls(false); }
}

function assignmentStatusFor(ass){return assessmentStatus({grade:myGrades[ass.id],submitted:Boolean(mySubmitted[ass.id]),evidenceStatus:myEvidence[ass.id]?.status||null,deadline:ass.noDeadline?null:ass.dueDate,knownSubmissions:submissionLookupSucceeded});}
function needsStudentAction(ass){return ["notSubmitted","pastdue","revision"].includes(assignmentStatusFor(ass).kind);}

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
      (filterStatus === "pending" && needsStudentAction(ass));
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
    assignmentsFeedState(allAssessments.length?"No assignments match these filters":"No assignments posted yet",allAssessments.length?"Try All Assignments or clear your search to see more tasks.":"Your teacher has not posted assignments for "+currentSection+" yet. You can explore Practice Lab while you wait.");
    return;
  }

  filtered.forEach((ass) => {
    const typeColor =
      ass.type === "PETA"
        ? "bg-purple-100 text-purple-700 border-purple-200"
        : ass.type === "Formative"
          ? "bg-green-100 text-green-700 border-green-200"
          : "bg-blue-100 text-blue-700 border-blue-200";

    const fileScope=assessmentTargetDetails(ass);
    const myGrade=myGrades[ass.id];
    const status=assignmentStatusFor(ass);
    const colors={
      graded:"text-emerald-800 bg-emerald-50 border-emerald-200",
      revision:"text-amber-800 bg-amber-50 border-amber-200",
      submitted:"text-blue-800 bg-blue-50 border-blue-200",
      reviewed:"text-emerald-800 bg-emerald-50 border-emerald-200",
      evidence:"text-indigo-800 bg-indigo-50 border-indigo-200",
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
          <span class="text-[10px] text-slate-400 uppercase font-bold tracking-widest">Target Paths</span>
          <span class="text-[10px] font-mono bg-slate-100 text-slate-600 px-2 py-1 rounded truncate max-w-full" title="${escapeHTML(fileScope.paths)}">${escapeHTML(fileScope.paths)}</span>
          ${fileScope.expectedTypes ? `<span class="text-[10px] text-slate-600 text-center break-all">Expected: ${escapeHTML(fileScope.expectedTypes)}</span>` : ""}
        </div>
      </div>
    `;
    container.insertAdjacentHTML("beforeend", card);
  });
}

window.addEventListener("adminerva:submission-recorded",event=>{
  const {assessmentId,studentId,evidenceStatus}=event.detail||{};
  const profile=userProfiles.find(p=>p.section===currentSection);
  if(profile?.id===studentId && assessmentId){
    if(evidenceStatus)myEvidence[assessmentId]={...(myEvidence[assessmentId]||{}),status:evidenceStatus};
    if(evidenceStatus==="withdrawn")delete mySubmitted[assessmentId];
    else mySubmitted[assessmentId]={assessmentId,submittedAt:new Date()};
    submissionLookupSucceeded=true;
    renderAssessments();
  }
});

window.addEventListener("adminerva:evidence-status",event=>{
  const {assessmentId,studentId,evidenceStatus}=event.detail||{};
  if(userProfiles.find(profile=>profile.section===currentSection)?.id!==studentId||!assessmentId)return;
  myEvidence[assessmentId]={...(myEvidence[assessmentId]||{}),status:evidenceStatus};
  renderAssessments();
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
  const fileScope=assessmentTargetDetails(ass);
  document.getElementById("modalAssPath").textContent =
    `Target Paths: ${fileScope.paths}${fileScope.expectedTypes ? " · Expected file types: " + fileScope.expectedTypes : ""}`;
  document.getElementById("modalAssContext").textContent =
    ass.taskContext || "No instructions provided.";
  document.getElementById("modalAssRubric").textContent =
    ass.evalCriteria || "No specific criteria provided.";

  const scoreArea = document.getElementById("modalScoreArea");
  const myGrade = myGrades[id];
  const provenance=document.getElementById("modalFeedbackProvenance");
  if(provenance){provenance.open=false;provenance.classList.toggle("hidden",!myGrade?.aiAssistance);}
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
