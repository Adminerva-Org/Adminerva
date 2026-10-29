/** Assessment authoring, repository evidence, individual review and protected grading: assessment studio. */
import { db,auth } from "../core/firebase-core.js?v=1.3.0";
import {validateDeploymentDates} from "./assessment-dates.mjs?v=1.3.0";
import {loadSchoolOptions,fillSchoolDatalist} from "../core/school-options.mjs?v=1.3.0";
import {resolveStaffSubjects} from "../core/staff-session.mjs?v=1.3.10";
import {
  collection,
  getDocs,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  limit,
  where,
  serverTimestamp,
  writeBatch,
} from "../core/teaching-firestore.mjs?v=1.3.0";
import {Timestamp} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
let targetPaths = [];
let allSections = [];
let objectiveRules = [];
let assessments = [];
let currentAssessmentId = null;
let deploySelectedSections = [];
let fpInstance = null;
let savingBlueprint=false,savingDeployment=false,rubricSource="balanced",lastGeneratedRubric="",subjectFocus=[];
const rubricTemplates=new Map();
const defaultPersona="Assist the teacher by checking supported evidence against the published task and rubric. Distinguish verified individual contributions from shared project work. Do not infer authorship or misconduct. Leave unsupported, visual and runtime criteria for teacher review. Suggested scores stay unpublished until teacher approval.";
const balancedCriteria=[{name:"Task requirements",weight:40,description:"Requested features and outputs are demonstrated."},{name:"Correctness",weight:30,description:"The submitted work behaves or reasons correctly for the task."},{name:"Clarity and organization",weight:20,description:"The work is understandable, organized and appropriate for the task."},{name:"Explanation and supporting evidence",weight:10,description:"The student explains the approach and links relevant evidence of their own contribution."}];
const blueprintStatus=message=>{document.getElementById("blueprintStatus").textContent=message;};
function preparedTaskContext(){
  const title=document.getElementById("assessTitle").value.trim(),subject=document.getElementById("assessSubject").value.trim();
  return "Complete "+(title||"the assessment task")+(subject?" for "+subject:"")+". Submit the requested work and a brief explanation of your approach. Link relevant evidence of your own contribution. Your teacher will review the published rubric and submitted evidence.";
}
function updateContextPreview(){document.getElementById("assessmentContextPreview").textContent=document.getElementById("taskContext").value.trim()||preparedTaskContext();}
function pointsRubric(criteria,maxScore){
  const usable=criteria.filter(criterion=>typeof criterion.name==="string"&&criterion.name.trim()&&Number(criterion.weight)>0&&Number.isFinite(Number(criterion.weight)));
  if(!usable.length)throw Error("This rubric template has no weighted criteria. Choose the balanced rubric or enter your own criteria.");
  const total=usable.reduce((sum,criterion)=>sum+Number(criterion.weight),0);let assigned=0;
  return usable.map((criterion,index)=>{const points=index===usable.length-1?Math.round((maxScore-assigned)*100)/100:Math.round(maxScore*Number(criterion.weight)/total*100)/100;assigned+=points;return (index+1)+". "+criterion.name.trim()+" — "+points+" point"+(points===1?"":"s")+(criterion.description?": "+String(criterion.description).trim():"");}).join("\n");
}
function refreshRubricChoices(){
  const select=document.getElementById("assessmentRubricTemplate"),current=select.value;
  select.replaceChildren(new Option("Balanced task rubric","balanced"));
  for(const [id,template] of rubricTemplates)select.add(new Option("Saved template · "+template.name,id));
  for(const assessment of assessments)if(typeof assessment.evalCriteria==="string"&&assessment.evalCriteria.trim())select.add(new Option("Reuse assessment · "+assessment.title,"assessment:"+assessment.id));
  if([...select.options].some(option=>option.value===current))select.value=current;
}
window.applyAssessmentRubric=function(){
  const score=Number(document.getElementById("maxScore").value),selected=document.getElementById("assessmentRubricTemplate").value;
  if(!Number.isFinite(score)||score<1||score>1000){blueprintStatus("Enter a maximum score between 1 and 1,000 before preparing a rubric.");document.getElementById("maxScore").focus();return;}
  try{
    let text;
    if(selected.startsWith("assessment:")){text=assessments.find(item=>item.id===selected.slice(11))?.evalCriteria||"";if(!text)throw Error("This assessment rubric is unavailable. Choose another rubric.");}
    else text=pointsRubric(selected==="balanced"?balancedCriteria:rubricTemplates.get(selected)?.criteria||[],score);
    document.getElementById("evalCriteria").value=text;rubricSource=selected;lastGeneratedRubric=text;
    document.getElementById("assessmentRubricStatus").textContent=selected.startsWith("assessment:")?"Copied the existing assessment rubric. Check its point totals against this task’s maximum score.":"Prepared criteria total "+score+" points. Edit them to match this task before saving.";
    blueprintStatus("");
  }catch(error){blueprintStatus(error.message);}
};
async function loadBlueprintChoices(){
  const results=await Promise.allSettled([getDocs(collection(db,"templates")),loadSchoolOptions()]);
  if(results[0].status==="fulfilled")for(const record of results[0].value.docs){const data=record.data();if(Array.isArray(data.criteria)&&data.criteria.length)rubricTemplates.set("template:"+record.id,{name:data.name||"Saved rubric",criteria:data.criteria});}
  if(results[1].status==="fulfilled"){
    const subjects=subjectFocus.length?results[1].value.subjects.filter(subject=>subjectFocus.includes(subject)):results[1].value.subjects;
    fillSchoolDatalist("assessmentSubjectChoices",subjects);
  }
  refreshRubricChoices();
}
for(const id of ["assessTitle","assessSubject","assessType","taskContext"])document.getElementById(id).addEventListener("input",updateContextPreview);
document.getElementById("maxScore").addEventListener("input",()=>{
  if(document.getElementById("evalCriteria").value===lastGeneratedRubric&&!rubricSource.startsWith("assessment:")&&rubricSource!=="manual")window.applyAssessmentRubric();
  else document.getElementById("assessmentRubricStatus").textContent="Maximum score changed. Review the rubric’s point totals; your written criteria were preserved.";
});
document.getElementById("evalCriteria").addEventListener("input",()=>{document.getElementById("assessmentRubricStatus").textContent="Custom criteria. Check the point totals against the maximum score before saving.";});

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

function formatPrettyDate(isoString) {
  if (!isoString) return "Not set";
  const date = new Date(isoString);
  if (isNaN(date)) return "Invalid Date";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  if (!db) return;

  fpInstance = flatpickr("#deployDateRange", {
    mode: "range",
    // Historical issue dates are valid when assessments were assigned in class earlier.
    dateFormat: "M j, Y",
    onChange: function (selectedDates) {
      if (selectedDates.length === 2) {
        const post = new Date(selectedDates[0]);
        post.setHours(0, 0, 0, 0);
        document.getElementById("deployPostDate").value = post.toISOString();

        const deadline = new Date(selectedDates[1]);
        deadline.setHours(23, 59, 59, 999);
        document.getElementById("deployDeadline").value =
          deadline.toISOString();
      } else if (selectedDates.length === 1) {
        const post = new Date(selectedDates[0]);
        post.setHours(0, 0, 0, 0);
        document.getElementById("deployPostDate").value = post.toISOString();
        document.getElementById("deployDeadline").value = "";
      } else {
        document.getElementById("deployPostDate").value = "";
        document.getElementById("deployDeadline").value = "";
      }
    },
  });

  window.showSubtleLoader("Loading Assessment Studio...");
  subjectFocus=await resolveStaffSubjects(auth.currentUser);
  await fetchSectionsFromStudents();
  await loadAssessments();
  void loadBlueprintChoices();
  window.hideSubtleLoader();
});

async function fetchSectionsFromStudents() {
  try {
    const snap = await getDocs(collection(db, "students"));
    let uniqueSections = new Set();
    snap.forEach((d) => {
      if (d.data().section) uniqueSections.add(d.data().section);
    });
    allSections = [...uniqueSections].sort();
  } catch (e) {
    console.error("Error fetching sections: ", e);
  }
}

async function loadAssessments() {
  try {
    const q = query(
      collection(db, "assessments"),
      orderBy("createdAt", "desc"),
    );
    const [snap,privateSnap] = await Promise.all([
      getDocs(q),getDocs(collection(db,"assessment_private"))
    ]);
    const privateById=new Map(privateSnap.docs.map(item=>[item.id,item.data()]));
    assessments = [];
    snap.forEach(item => {
      const assessment={
        id:item.id,...item.data(),
        ...(item.data().schemaVersion===2 ? (privateById.get(item.id)||{}) : {})
      };
      if(!subjectFocus.length||!assessment.subject||subjectFocus.includes(assessment.subject))assessments.push(assessment);
    });
    renderAssessmentGrid();
    refreshRubricChoices();
  } catch (e) {
    console.error("Error loading assessments: ", e);
  }
}

function getTypeStyle(type) {
  if (type === "Mini PETA")
    return "bg-purple-500/20 text-purple-600 border-purple-500/30";
  if (type === "Practical Exam")
    return "bg-red-500/20 text-red-600 border-red-500/30";
  if (type === "Formative")
    return "bg-green-500/20 text-green-600 border-green-500/30";
  return "bg-blue-500/20 text-blue-600 border-blue-500/30";
}

function renderAssessmentGrid() {
  const grid = document.getElementById("assessmentGrid");
  grid.innerHTML = "";

  if (assessments.length === 0) {
    grid.innerHTML = `<div class="col-span-full py-12 text-center text-gray-400 italic border-2 border-dashed border-gray-300 rounded-lg">No assessments created yet. Click "+ New Blueprint" to start.</div>`;
    return;
  }

  assessments.forEach((item) => {
    const deployments = item.deployments || [];
    const uniqueSections = [...new Set(deployments.map((d) => d.section))];

    const sectionsHtml = uniqueSections
      .map(
        (sec) =>
          `<span class="bg-gray-100 text-gray-600 text-[10px] px-2 py-1 rounded-full font-bold shadow-sm">${escapeHTML(sec)}</span>`,
      )
      .join("");

    const card = `
            <div class="bg-white border rounded-xl shadow-sm hover:shadow-md transition cursor-pointer flex flex-col overflow-hidden" onclick="window.openViewModal('${item.id}')">
                <div class="bg-slate-800 p-4 border-b border-slate-700">
                    <div class="flex justify-between items-start mb-2">
                        <span class="${getTypeStyle(item.type)} text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider">${escapeHTML(item.type)}</span>
                        <span class="text-slate-400 hover:text-white transition">⋮</span>
                    </div>
                    <h3 class="font-bold text-white text-lg truncate" title="${escapeHTML(item.title)}">${escapeHTML(item.title)}</h3>\n                    ${item.subject ? `<p class="text-xs text-cyan-200 mt-1 truncate">${escapeHTML(item.subject)}</p>` : ""}
                </div>
                <div class="p-4 flex-1 flex flex-col">
                    <p class="text-sm text-gray-600 line-clamp-2 mb-4">${escapeHTML(item.taskContext || "No context provided.")}</p>
                    <div class="mt-auto">
                        <div class="text-[10px] font-bold text-gray-400 uppercase mb-1 flex justify-between">
                            <span>Deployed To</span>
                            <span class="text-blue-500">${deployments.length} Active Deployments</span>
                        </div>
                        <div class="flex flex-wrap gap-1">
                            ${sectionsHtml || `<span class="text-xs text-gray-400 italic">Template Only - Not Deployed</span>`}
                        </div>
                    </div>
                </div>
            </div>
        `;
    grid.insertAdjacentHTML("beforeend", card);
  });
}

function updatePracticalExamOption(){
  const studio=document.getElementById("assessSubmissionSource").value==="studio";
  document.getElementById("assessPracticalExam").disabled=!studio;
  document.getElementById("practicalExamOption").classList.toggle("opacity-60",!studio);
}
document.getElementById("assessSubmissionSource").addEventListener("change",()=>{
  updatePracticalExamOption();
  if(!currentAssessmentId&&document.getElementById("assessSubmissionSource").value==="studio"&&
    document.getElementById("assessType").value==="Practical Exam")
    document.getElementById("assessPracticalExam").checked=true;
});
document.getElementById("assessType").addEventListener("change",event=>{
  if(event.target.value==="Practical Exam"&&document.getElementById("assessSubmissionSource").value==="studio")
    document.getElementById("assessPracticalExam").checked=true;
});
window.openCreateModal = function () {
  currentAssessmentId = null;
  document.getElementById("createModalTitle").textContent =
    "Create Assessment Blueprint";
  document.getElementById("saveAssessmentBtn").textContent = "Save Blueprint";

  document.getElementById("assessTitle").value = "";
  document.getElementById("maxScore").value = "20";
  document.getElementById("assessType").value = "Mini PETA";
  document.getElementById("assessQuarter").value=assessments.find(item=>["Q1","Q2","Q3","Q4"].includes(item.quarter))?.quarter||"Q1";
  document.getElementById("assessSubject").value=subjectFocus.length===1?subjectFocus[0]:"";
  document.getElementById("assessSubmissionSource").value="repository";
  document.getElementById("assessSubmissionSource").disabled=false;
  document.getElementById("assessPracticalExam").checked=false;
  updatePracticalExamOption();
  document.getElementById("assessV2").checked = true;
  document.getElementById("assessV2").disabled = false;
  document.getElementById("assessExpectedExts").value = "";
  document.getElementById("assessInvestigationFallback").checked = true;
  document.getElementById("systemPersona").value =
    defaultPersona;
  document.getElementById("taskContext").value = "";
  document.getElementById("evalCriteria").value = "";
  refreshRubricChoices();
  const equipped="template:"+(localStorage.getItem("Adminerva_active_template_id")||"");
  document.getElementById("assessmentRubricTemplate").value=rubricTemplates.has(equipped)?equipped:"balanced";
  window.applyAssessmentRubric();updateContextPreview();blueprintStatus("");
  document.getElementById("blueprintAdvanced").open=false;document.getElementById("blueprintInstructions").open=false;

  objectiveRules = [];
  targetPaths = []; // Clear array
  renderRules();
  renderTargets(); // Render UI

  document.getElementById("createModal").classList.remove("hidden");
  document.getElementById("assessTitle").focus();
};
window.openEditModal = function () {
  const item = assessments.find((a) => a.id === currentAssessmentId);
  if (!item) return;
  if(item.schemaVersion===3&&(item.deployments||[]).length){
    alert("This Studio rubric is protected after deployment. Create a new blueprint for changed requirements; edit the deployment schedule separately.");
    return;
  }

  document.getElementById("createModalTitle").textContent = "Edit Blueprint";
  document.getElementById("saveAssessmentBtn").textContent = "Update Blueprint";

  document.getElementById("assessTitle").value = item.title || "";
  document.getElementById("maxScore").value = item.maxScore || 20;
  document.getElementById("assessType").value = item.type || "Mini PETA";
  document.getElementById("assessQuarter").value = item.quarter || "";
  document.getElementById("assessSubmissionSource").value=item.schemaVersion===3?"studio":"repository";
  document.getElementById("assessSubmissionSource").disabled=true;
  document.getElementById("assessPracticalExam").checked=item.practicalExam===true;
  updatePracticalExamOption();
  document.getElementById("assessV2").checked = item.schemaVersion === 2;
  document.getElementById("assessV2").disabled = true; // Never silently convert a legacy record.
  document.getElementById("assessExpectedExts").value =
    Array.isArray(item.expectedExtensions) ? item.expectedExtensions.join(", ") : "";
  document.getElementById("assessInvestigationFallback").checked =
    item.investigationFallback !== false;
  document.getElementById("systemPersona").value = item.systemPersona || "";
  document.getElementById("taskContext").value = item.taskContext || "";
  document.getElementById("evalCriteria").value = item.evalCriteria || "";
  document.getElementById("assessSubject").value=item.subject||"";rubricSource="manual";lastGeneratedRubric="";
  refreshRubricChoices();document.getElementById("assessmentRubricTemplate").value="balanced";
  if(!document.getElementById("evalCriteria").value.trim())window.applyAssessmentRubric();
  if(!document.getElementById("systemPersona").value.trim())document.getElementById("systemPersona").value=defaultPersona;
  updateContextPreview();blueprintStatus("");document.getElementById("assessmentRubricStatus").textContent="Your saved rubric is preserved. Use a template only if you want to replace it.";
  document.getElementById("blueprintAdvanced").open=false;document.getElementById("blueprintInstructions").open=false;

  objectiveRules = [...(item.rules || [])];
  // Load array, or fallback to the old single string if it exists
  targetPaths = [
    ...(item.targetPaths || (item.targetPath ? [item.targetPath] : [])),
  ];

  renderRules();
  renderTargets(); // Render UI

  document.getElementById("viewModal").classList.add("hidden");
  document.getElementById("createModal").classList.remove("hidden");
};

// 5. UPDATE saveAssessment to save the array instead of a string
window.saveAssessment = async function () {
  if(savingBlueprint)return;
  const title = document.getElementById("assessTitle").value.trim();
  if (!title){blueprintStatus("Enter an assessment title.");document.getElementById("assessTitle").focus();return;}
  const score=Number(document.getElementById("maxScore").value),criteria=document.getElementById("evalCriteria").value.trim(),actor=auth.currentUser;
  const subject=document.getElementById("assessSubject").value.trim();
  if(!actor?.uid){blueprintStatus("Sign in to your staff account before saving.");return;}
  if(subjectFocus.length&&(!subject||!subjectFocus.includes(subject))){blueprintStatus("Choose one of your assigned subjects before saving this assessment.");document.getElementById("assessSubject").focus();return;}
  if(!Number.isFinite(score)||score<1||score>1000){blueprintStatus("Maximum score must be between 1 and 1,000.");document.getElementById("maxScore").focus();return;}
  if(!criteria){blueprintStatus("Use a prepared rubric or enter your evaluation criteria before saving.");document.getElementById("evalCriteria").focus();return;}

  const prior = currentAssessmentId ? assessments.find(a=>a.id===currentAssessmentId) : null;
  const studio=prior ? prior.schemaVersion===3 : document.getElementById("assessSubmissionSource").value==="studio";
  const v2=prior ? prior.schemaVersion===2 : (!studio&&document.getElementById("assessV2").checked);
  const practicalExam=studio&&document.getElementById("assessPracticalExam").checked;
  const payload = {
    ownerUid:prior?.ownerUid||actor.uid,
    sectionIds:prior?.sectionIds||[...new Set((prior?.deployments||[]).map(deployment=>deployment.section))],
    ...(v2?{schemaVersion:2,evidenceMode:"commit_selection",checkpointMode:"individual"}:{}),
    ...(studio?{schemaVersion:3,submissionSource:"studio",evidenceMode:"studio_snapshot",practicalExam}:{}),
    title: title,
    type: document.getElementById("assessType").value,
    maxScore: score,
    quarter: document.getElementById("assessQuarter").value,
    subject,
    targetPaths: targetPaths, // Legacy path arrays are preserved.
    expectedExtensions: [...new Set(document.getElementById("assessExpectedExts").value
      .split(",").map(e => e.trim().toLowerCase().replace(/^\./, "")).filter(e => /^[a-z0-9]{1,12}$/.test(e)))],
    investigationFallback: document.getElementById("assessInvestigationFallback").checked,
    gradingMode: currentAssessmentId
      ? (assessments.find(a => a.id === currentAssessmentId)?.gradingMode || "individual")
      : "individual",
    taskContext: document.getElementById("taskContext").value.trim()||preparedTaskContext(),
    evalCriteria: criteria,
  };

  savingBlueprint=true;document.getElementById("saveAssessmentBtn").disabled=true;blueprintStatus("Saving the assessment and rubric…");
  window.showSubtleLoader("Saving Blueprint...");

  try {
    const teacherOnly={
      ownerUid:payload.ownerUid,sectionIds:payload.sectionIds,subject:payload.subject,
      systemPersona:document.getElementById("systemPersona").value.trim()||defaultPersona,
      rules:objectiveRules,updatedAt:serverTimestamp()
    };
    if(auth.currentUser?.uid!==actor.uid)throw Error("Account changed. Reload before saving this assessment.");
    if(v2||studio){
      const ref=currentAssessmentId
        ? doc(db,"assessments",currentAssessmentId)
        : doc(collection(db,"assessments"));
      const batch=writeBatch(db);
      if(!currentAssessmentId){
        payload.deployments=[];
        payload.createdAt=serverTimestamp();
      }
      batch.set(ref,payload,{merge:Boolean(currentAssessmentId)});
      batch.set(doc(db,"assessment_private",ref.id),teacherOnly);
      await batch.commit();
    }else if(currentAssessmentId){
      await updateDoc(doc(db,"assessments",currentAssessmentId),{
        ...payload,systemPersona:teacherOnly.systemPersona,rules:objectiveRules
      });
    }else{
      payload.deployments=[];
      payload.createdAt=serverTimestamp();
      await addDoc(collection(db,"assessments"),{
        ...payload,systemPersona:teacherOnly.systemPersona,rules:objectiveRules
      });
    }
    window.closeModals();
    await loadAssessments();
  } catch (e) {
    blueprintStatus("Could not save: "+e.message+". Your entered task and rubric are preserved.");
  } finally {
    savingBlueprint=false;document.getElementById("saveAssessmentBtn").disabled=false;
    window.hideSubtleLoader();
  }
};

window.deleteAssessment = async function () {
  if (!currentAssessmentId) return;
  if([2,3].includes(assessments.find(item=>item.id===currentAssessmentId)?.schemaVersion))
    return alert("V2 blueprints are retained to protect evidence and grade history. Remove their deployments to stop new submissions; do not delete the assessment.");
  if (
    confirm(
      "Are you sure you want to permanently delete this Assessment Blueprint? It will be immediately revoked from all deployed sections.",
    )
  ) {
    window.showSubtleLoader("Deleting Blueprint...");
    try {
      const item=assessments.find(a=>a.id===currentAssessmentId);
      if([2,3].includes(item?.schemaVersion)){
        if((item.deployments||[]).length)throw Error(
          "Withdraw all deployments before deleting a V2 blueprint.");
        const [evidence,grades]=await Promise.all([
          getDocs(query(collection(db,"assessment_evidence"),
            where("assessmentId","==",currentAssessmentId),limit(1))),
          getDocs(query(collection(db,"student_grades"),
            where("taskId","==",currentAssessmentId),limit(1)))
        ]);
        if(!evidence.empty||!grades.empty)throw Error(
          "This assessment has evidence or grades and cannot be deleted. Archive it instead.");
        const batch=writeBatch(db);
        batch.delete(doc(db,"assessment_private",currentAssessmentId));
        batch.delete(doc(db,"assessments",currentAssessmentId));
        await batch.commit();
      }else{
        await deleteDoc(doc(db,"assessments",currentAssessmentId));
      }
      window.closeModals();
      await loadAssessments();
    } catch (e) {
      alert("Error deleting: " + e.message);
    } finally {
      window.hideSubtleLoader();
    }
  }
};

window.openViewModal = function (id) {
  const item = assessments.find((a) => a.id === id);
  if (!item) return;

  currentAssessmentId = id;
  document.getElementById("viewTitle").textContent = item.title || "Untitled";

  // Format array for viewing
  const paths = item.targetPaths || (item.targetPath ? [item.targetPath] : []);
  document.getElementById("viewTargetPath").textContent =
    paths.length > 0
      ? `Targets: ${paths.join(" OR ")}`
      : "Target: Entire Repository";
  document.getElementById("viewTaskContext").textContent =
    item.taskContext || "No context provided.";
  document.getElementById("viewEvalCriteria").textContent =
    item.evalCriteria || "No rubric provided.";
  document.getElementById("viewSystemPersona").textContent =
    item.systemPersona || "No persona set.";

  const badge = document.getElementById("viewTypeBadge");
  badge.textContent = item.type || "Unknown";
  badge.className = `text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider inline-block ${getTypeStyle(item.type)}`;

  const rulesList = document.getElementById("viewObjectiveRules");
  rulesList.innerHTML = "";
  if (item.rules && item.rules.length > 0) {
    item.rules.forEach((rule) => {
      const color =
        rule.type === "Banned"
          ? "text-red-500 bg-red-50"
          : "text-green-600 bg-green-50";
      rulesList.insertAdjacentHTML(
        "beforeend",
        `<li><span class="font-mono ${color} px-1 rounded">${escapeHTML(rule.type)}: ${escapeHTML(rule.value)}</span></li>`,
      );
    });
  } else {
    rulesList.innerHTML = `<li class="text-gray-400 italic text-xs">No objective filters set.</li>`;
  }

  renderDeploymentsTable(item.deployments || []);
  document.getElementById("viewModal").classList.remove("hidden");
};

window.closeModals = function () {
  document.getElementById("createModal").classList.add("hidden");
  document.getElementById("viewModal").classList.add("hidden");
  document.getElementById("deployModal").classList.add("hidden");
};

// ==========================================
// DEPLOYMENT LOGIC (DATES & DEADLINES)
// ==========================================
function renderDeploymentsTable(deployments) {
  const tbody = document.getElementById("deploymentsTableBody");
  tbody.innerHTML = "";

  if (deployments.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="px-4 py-6 text-center text-gray-400 italic">No active deployments. Click "Deploy Task" above to assign to sections.</td></tr>`;
    return;
  }

  const sorted = [...deployments].sort(
    (a, b) => (Date.parse(a.deadline) || 0) - (Date.parse(b.deadline) || 0),
  );

  sorted.forEach((deploy) => {
    tbody.insertAdjacentHTML(
      "beforeend",
      `
            <tr class="border-b last:border-0 hover:bg-gray-50 transition">
                <td class="px-4 py-3 font-bold text-gray-800">${escapeHTML(deploy.section)}</td>
                <td class="px-4 py-3">${formatPrettyDate(deploy.postDate)}</td>
                <td class="px-4 py-3 font-bold text-blue-600">${deploy.deadlineEnabled === false ? "No deadline" : formatPrettyDate(deploy.deadline)}</td>
                <td class="px-4 py-3 text-right">
                    <button onclick="window.openDeployModal('${deploy.id}')" class="text-xs font-bold text-slate-500 hover:text-slate-800 mr-2">Edit</button>
                    <button onclick="window.deleteDeployment('${deploy.id}')" class="text-xs font-bold text-red-400 hover:text-red-600">Remove</button>
                </td>
            </tr>
        `,
    );
  });
}

function updatePresetUI(activeBtn) {
  document.querySelectorAll(".range-preset-btn").forEach((btn) => {
    btn.classList.remove("bg-blue-50", "border-blue-300", "text-blue-600");
    btn.classList.add("bg-white", "border-gray-300", "text-gray-600");
  });
  if (activeBtn) {
    activeBtn.classList.remove("bg-white", "border-gray-300", "text-gray-600");
    activeBtn.classList.add("bg-blue-50", "border-blue-300", "text-blue-600");
  }
}

window.setDeployRange = function (days, btnElement) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const endDate = new Date(today);
  endDate.setDate(today.getDate() + days);

  fpInstance.setDate([today, endDate], true);
  updatePresetUI(btnElement);
};

window.openCustomRange = function (btnElement) {
  updatePresetUI(btnElement);
  fpInstance.open();
};

window.toggleDeployDeadline = function () {
  const checkbox = document.getElementById("deployUseDeadline");
  const fields = document.getElementById("deployScheduleFields");
  if (checkbox && fields) fields.classList.toggle("hidden", !checkbox.checked);
};

window.openDeployModal = function (deployId = null) {
  const item = assessments.find((a) => a.id === currentAssessmentId);
  if (!item) return;

  updatePresetUI(null);

  if (deployId) {
    const deploy = (item.deployments || []).find((d) => d.id === deployId);
    document.getElementById("deployModalTitle").textContent = "Edit Deployment";
    document.getElementById("deploySaveBtn").textContent = "Update";
    document.getElementById("deployId").value = deploy.id;

    deploySelectedSections = [deploy.section];
    document.getElementById("deployUseDeadline").checked = deploy.deadlineEnabled !== false;
    if (deploy.postDate && deploy.deadline) {
      fpInstance.setDate([new Date(deploy.postDate), new Date(deploy.deadline)], true);
    } else fpInstance.clear();

    document.getElementById("deploySectionSelector").classList.add("hidden");
    document.getElementById("deployEditNotice").classList.remove("hidden");
  } else {
    document.getElementById("deployModalTitle").textContent = "Deploy Task";
    document.getElementById("deploySaveBtn").textContent = "Deploy";
    document.getElementById("deployId").value = "";

    deploySelectedSections = [];
    document.getElementById("deployUseDeadline").checked = false;
    fpInstance.clear();

    document.getElementById("deploySectionSelector").classList.remove("hidden");
    document.getElementById("deployEditNotice").classList.add("hidden");
  }

  renderDeployChips();
  updateDeployDropdown();
  window.toggleDeployDeadline();
  document.getElementById("deployModal").classList.remove("hidden");
};

function updateDeployDropdown() {
  const selector = document.getElementById("deploySectionSelector");
  selector.innerHTML = `<option value="" disabled selected>+ Select sections to deploy to...</option>`;

  const item = assessments.find((a) => a.id === currentAssessmentId);
  const existingDeployments = item
    ? (item.deployments || []).map((d) => d.section)
    : [];

  const available = allSections.filter(sec=>
    !deploySelectedSections.includes(sec) &&
    (Boolean(document.getElementById("deployId").value)||!existingDeployments.includes(sec))
  );

  available.forEach((sec) => {
    const label = existingDeployments.includes(sec)
      ? `${escapeHTML(sec)} (Already Deployed)`
      : escapeHTML(sec);
    selector.insertAdjacentHTML(
      "beforeend",
      `<option value="${escapeHTML(sec)}">${label}</option>`,
    );
  });
}

function renderDeployChips() {
  const container = document.getElementById("deployChipsContainer");
  container.innerHTML = "";

  if (deploySelectedSections.length === 0) {
    container.innerHTML = `<span class="text-xs text-gray-400 italic py-1">No sections selected.</span>`;
    return;
  }

  const isEditing = !!document.getElementById("deployId").value;

  deploySelectedSections.forEach((sec) => {
    const removeBtn = isEditing
      ? ""
      : `<button onclick="window.removeDeployChip('${escapeHTML(sec)}')" class="hover:text-red-500 ml-1 focus:outline-none">&times;</button>`;
    container.insertAdjacentHTML(
      "beforeend",
      `
            <span class="bg-blue-100 text-blue-800 text-xs px-2.5 py-1 rounded-full font-bold flex items-center gap-1 border border-blue-200 shadow-sm">
                ${escapeHTML(sec)} ${removeBtn}
            </span>
        `,
    );
  });
}

window.addDeployChip = function (section) {
  if (!section || deploySelectedSections.includes(section)) return;
  deploySelectedSections.push(section);
  document.getElementById("deploySectionSelector").value = "";
  renderDeployChips();
  updateDeployDropdown();
};

window.removeDeployChip = function (section) {
  deploySelectedSections = deploySelectedSections.filter((s) => s !== section);
  renderDeployChips();
  updateDeployDropdown();
};

window.saveDeployment = async function () {
  if (!currentAssessmentId||savingDeployment) return;

  const deployId = document.getElementById("deployId").value;
  const deadlineEnabled = document.getElementById("deployUseDeadline").checked;
  const postDate = deadlineEnabled ? document.getElementById("deployPostDate").value : null;
  const deadline = deadlineEnabled ? document.getElementById("deployDeadline").value : null;

  if (deploySelectedSections.length === 0) {
    return alert("Choose at least one class section.");
  }
  const dateError=validateDeploymentDates({postDate,deadline,deadlineEnabled});
  if(dateError)return alert(dateError);

  const item = assessments.find((a) => a.id === currentAssessmentId);
  if(!item)return alert("Assessment unavailable. Refresh the page and try again.");
  let deployments = [...(item.deployments || [])];
  if(!deployId){
    const duplicates=deploySelectedSections.filter(section=>deployments.some(entry=>entry.section===section));
    if(duplicates.length)return alert("Already deployed to "+duplicates.join(", ")+". Use Edit beside that class to change the schedule.");
  }
  if (deployId) {
    const index = deployments.findIndex((d) => d.id === deployId);
    if (index > -1) {
      deployments[index] = {
        id: deployId,
        section: deploySelectedSections[0],
        postDate,
        deadline,
        deadlineEnabled,
      };
    }
  } else {
    deploySelectedSections.forEach((section) => {
      deployments.push({
        id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
        section: section,
        postDate: postDate,
        deadline: deadline,
        deadlineEnabled,
      });
    });
  }

  savingDeployment=true;
  document.getElementById("deploySaveBtn").disabled=true;
  window.showSubtleLoader("Applying deployment schedule...");
  try {
    await saveDeploymentScope(item,deployments);
    document.getElementById("deployModal").classList.add("hidden");
    await loadAssessments();
    window.openViewModal(currentAssessmentId);
  } catch (e) {
    alert("Failed to deploy: " + e.message);
  } finally {
    savingDeployment=false;
    document.getElementById("deploySaveBtn").disabled=false;
    window.hideSubtleLoader();
  }
};

window.deleteDeployment = async function (deployId) {
  if (!currentAssessmentId||savingDeployment) return;
  if (
    confirm(
      "Remove this deployment? The assignment will be withdrawn from the section.",
    )
  ) {
    const item = assessments.find((a) => a.id === currentAssessmentId);
    const deployments = (item.deployments || []).filter(
      (d) => d.id !== deployId,
    );

    savingDeployment=true;
    document.getElementById("deploySaveBtn").disabled=true;
    window.showSubtleLoader("Removing deployment...");
    try {
      await saveDeploymentScope(item,deployments);
      await loadAssessments();
      window.openViewModal(currentAssessmentId);
    } catch (e) {
      alert("Error: " + e.message);
    } finally {
      savingDeployment=false;
      document.getElementById("deploySaveBtn").disabled=false;
      window.hideSubtleLoader();
    }
  }
};

async function saveDeploymentScope(item,deployments){
  if(new Set(deployments.map(entry=>entry.section)).size!==deployments.length)
    throw Error("A class can have only one deployment of the same assessment. Edit its existing schedule instead.");
  if(deployments.length>20)throw Error("An assessment supports at most 20 deployments. Create another blueprint for additional sections.");
  const sectionIds=[...new Set(deployments.map(deployment=>deployment.section))];
  const batch=writeBatch(db);
  const windows={};
  if(item.schemaVersion===3){
    for(const deployment of deployments){
      const opens=deployment.postDate?new Date(deployment.postDate):new Date(0);
      const closes=deployment.deadlineEnabled!==false&&deployment.deadline
        ?new Date(deployment.deadline):new Date("2100-01-01T00:00:00.000Z");
      if(!Number.isFinite(opens.getTime())||!Number.isFinite(closes.getTime())||opens>closes)
        throw Error("A Studio submission schedule is invalid.");
      windows[deployment.section]={opensAt:Timestamp.fromDate(opens),closesAt:Timestamp.fromDate(closes)};
    }
  }
  batch.update(doc(db,"assessments",item.id),{
    deployments,sectionIds,...(item.schemaVersion===3?{studioWindows:windows}:{})
  });
  if([2,3].includes(item.schemaVersion))batch.set(doc(db,"assessment_private",item.id),{ownerUid:item.ownerUid,sectionIds},{merge:true});
  await batch.commit();
}

// ==========================================
// DYNAMIC RULES BUILDER
// ==========================================
window.addObjectiveRule = function () {
  const type = document.getElementById("newRuleType").value;
  const value = document.getElementById("newRuleValue").value.trim();
  if (!value) return;
  objectiveRules.push({ type, value });
  document.getElementById("newRuleValue").value = "";
  renderRules();
};

window.removeObjectiveRule = function (index) {
  objectiveRules.splice(index, 1);
  renderRules();
};

function renderRules() {
  const container = document.getElementById("rulesContainer");
  container.innerHTML = "";
  if (objectiveRules.length === 0) {
    container.innerHTML = `<div class="text-xs text-gray-400 italic">No objective rules added.</div>`;
    return;
  }
  objectiveRules.forEach((rule, index) => {
    const colorClass =
      rule.type === "Banned"
        ? "text-red-600 bg-red-50 border-red-200"
        : "text-green-600 bg-green-50 border-green-200";
    container.insertAdjacentHTML(
      "beforeend",
      `
            <div class="flex justify-between items-center p-2 rounded border ${colorClass} text-sm font-mono shadow-sm">
                <div><span class="font-bold text-[10px] uppercase tracking-wider">${rule.type}:</span> ${escapeHTML(rule.value)}</div>
                <button onclick="window.removeObjectiveRule(${index})" class="text-gray-400 hover:text-red-600 font-bold">&times;</button>
            </div>
        `,
    );
  });
}
window.addTarget = function () {
  const val = document.getElementById("newTargetPath").value.trim();
  if (!val) return;
  targetPaths.push(val);
  document.getElementById("newTargetPath").value = "";
  renderTargets();
};

window.removeTarget = function (index) {
  targetPaths.splice(index, 1);
  renderTargets();
};

function renderTargets() {
  const container = document.getElementById("targetsContainer");
  container.innerHTML = "";
  if (targetPaths.length === 0) {
    container.innerHTML = `<div class="text-xs text-gray-400 italic">No specific paths set. (Will scan entire repository)</div>`;
    return;
  }
  targetPaths.forEach((path, index) => {
    container.insertAdjacentHTML(
      "beforeend",
      `
      <div class="flex justify-between items-center p-2 rounded border border-blue-200 bg-blue-50 text-blue-700 text-sm font-mono shadow-sm">
          <div>${escapeHTML(path)}</div>
          <button type="button" onclick="window.removeTarget(${index})" class="text-blue-400 hover:text-red-600 font-bold text-lg leading-none">&times;</button>
      </div>
      `,
    );
  });
}
