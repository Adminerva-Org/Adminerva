import { db } from "../core/firebase-core.js";
import {
  collection,
  getDocs,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
let targetPaths = [];
let allSections = [];
let objectiveRules = [];
let assessments = [];
let currentAssessmentId = null;
let deploySelectedSections = [];
let fpInstance = null;

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
    minDate: "today",
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
  await fetchSectionsFromStudents();
  await loadAssessments();
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
    const snap = await getDocs(q);
    assessments = [];
    snap.forEach((doc) => assessments.push({ id: doc.id, ...doc.data() }));
    renderAssessmentGrid();
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
                    <h3 class="font-bold text-white text-lg truncate" title="${escapeHTML(item.title)}">${escapeHTML(item.title)}</h3>
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

window.openCreateModal = function () {
  currentAssessmentId = null;
  document.getElementById("createModalTitle").textContent =
    "Create Assessment Blueprint";
  document.getElementById("saveAssessmentBtn").textContent = "Save Blueprint";

  document.getElementById("assessTitle").value = "";
  document.getElementById("maxScore").value = "20";
  document.getElementById("assessType").value = "Mini PETA";
  document.getElementById("systemPersona").value =
    "You are a strict Java high school programming teacher grading a student's code.";
  document.getElementById("taskContext").value = "";
  document.getElementById("evalCriteria").value = "";

  objectiveRules = [];
  targetPaths = []; // Clear array
  renderRules();
  renderTargets(); // Render UI

  document.getElementById("createModal").classList.remove("hidden");
};
window.openEditModal = function () {
  const item = assessments.find((a) => a.id === currentAssessmentId);
  if (!item) return;

  document.getElementById("createModalTitle").textContent = "Edit Blueprint";
  document.getElementById("saveAssessmentBtn").textContent = "Update Blueprint";

  document.getElementById("assessTitle").value = item.title || "";
  document.getElementById("maxScore").value = item.maxScore || 20;
  document.getElementById("assessType").value = item.type || "Mini PETA";
  document.getElementById("systemPersona").value = item.systemPersona || "";
  document.getElementById("taskContext").value = item.taskContext || "";
  document.getElementById("evalCriteria").value = item.evalCriteria || "";

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
  const title = document.getElementById("assessTitle").value.trim();
  if (!title) return alert("Please enter an Assessment Title.");

  const payload = {
    title: title,
    type: document.getElementById("assessType").value,
    maxScore: parseInt(document.getElementById("maxScore").value) || 20,
    targetPaths: targetPaths, // Save the array to Firebase
    systemPersona: document.getElementById("systemPersona").value.trim(),
    taskContext: document.getElementById("taskContext").value.trim(),
    evalCriteria: document.getElementById("evalCriteria").value.trim(),
    rules: objectiveRules,
  };

  window.showSubtleLoader("Saving Blueprint...");

  try {
    if (currentAssessmentId) {
      await updateDoc(doc(db, "assessments", currentAssessmentId), payload);
    } else {
      payload.deployments = [];
      payload.createdAt = serverTimestamp();
      await addDoc(collection(db, "assessments"), payload);
    }
    window.closeModals();
    await loadAssessments();
  } catch (e) {
    alert("Failed to save: " + e.message);
  } finally {
    window.hideSubtleLoader();
  }
};

window.deleteAssessment = async function () {
  if (!currentAssessmentId) return;
  if (
    confirm(
      "Are you sure you want to permanently delete this Assessment Blueprint? It will be immediately revoked from all deployed sections.",
    )
  ) {
    window.showSubtleLoader("Deleting Blueprint...");
    try {
      await deleteDoc(doc(db, "assessments", currentAssessmentId));
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
    (a, b) => new Date(a.deadline) - new Date(b.deadline),
  );

  sorted.forEach((deploy) => {
    tbody.insertAdjacentHTML(
      "beforeend",
      `
            <tr class="border-b last:border-0 hover:bg-gray-50 transition">
                <td class="px-4 py-3 font-bold text-gray-800">${escapeHTML(deploy.section)}</td>
                <td class="px-4 py-3">${formatPrettyDate(deploy.postDate)}</td>
                <td class="px-4 py-3 font-bold text-blue-600">${formatPrettyDate(deploy.deadline)}</td>
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
    fpInstance.setDate(
      [new Date(deploy.postDate), new Date(deploy.deadline)],
      true,
    );

    document.getElementById("deploySectionSelector").classList.add("hidden");
    document.getElementById("deployEditNotice").classList.remove("hidden");
  } else {
    document.getElementById("deployModalTitle").textContent = "Deploy Task";
    document.getElementById("deploySaveBtn").textContent = "Deploy";
    document.getElementById("deployId").value = "";

    deploySelectedSections = [];
    fpInstance.clear();

    document.getElementById("deploySectionSelector").classList.remove("hidden");
    document.getElementById("deployEditNotice").classList.add("hidden");
  }

  renderDeployChips();
  updateDeployDropdown();
  document.getElementById("deployModal").classList.remove("hidden");
};

function updateDeployDropdown() {
  const selector = document.getElementById("deploySectionSelector");
  selector.innerHTML = `<option value="" disabled selected>+ Select sections to deploy to...</option>`;

  const item = assessments.find((a) => a.id === currentAssessmentId);
  const existingDeployments = item
    ? (item.deployments || []).map((d) => d.section)
    : [];

  const available = allSections.filter(
    (sec) => !deploySelectedSections.includes(sec),
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
  if (!currentAssessmentId) return;

  const deployId = document.getElementById("deployId").value;
  const postDate = document.getElementById("deployPostDate").value;
  const deadline = document.getElementById("deployDeadline").value;

  if (deploySelectedSections.length === 0 || !postDate || !deadline) {
    return alert("Please select at least one section and set both dates.");
  }

  const item = assessments.find((a) => a.id === currentAssessmentId);
  let deployments = [...(item.deployments || [])];

  if (deployId) {
    const index = deployments.findIndex((d) => d.id === deployId);
    if (index > -1) {
      deployments[index] = {
        id: deployId,
        section: deploySelectedSections[0],
        postDate,
        deadline,
      };
    }
  } else {
    deploySelectedSections.forEach((section) => {
      deployments.push({
        id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
        section: section,
        postDate: postDate,
        deadline: deadline,
      });
    });
  }

  window.showSubtleLoader("Applying deployment schedule...");
  try {
    await updateDoc(doc(db, "assessments", currentAssessmentId), {
      deployments,
    });
    document.getElementById("deployModal").classList.add("hidden");
    await loadAssessments();
    window.openViewModal(currentAssessmentId);
  } catch (e) {
    alert("Failed to deploy: " + e.message);
  } finally {
    window.hideSubtleLoader();
  }
};

window.deleteDeployment = async function (deployId) {
  if (!currentAssessmentId) return;
  if (
    confirm(
      "Remove this deployment? The assignment will be withdrawn from the section.",
    )
  ) {
    const item = assessments.find((a) => a.id === currentAssessmentId);
    const deployments = (item.deployments || []).filter(
      (d) => d.id !== deployId,
    );

    window.showSubtleLoader("Removing deployment...");
    try {
      await updateDoc(doc(db, "assessments", currentAssessmentId), {
        deployments,
      });
      await loadAssessments();
      window.openViewModal(currentAssessmentId);
    } catch (e) {
      alert("Error: " + e.message);
    } finally {
      window.hideSubtleLoader();
    }
  }
};

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
