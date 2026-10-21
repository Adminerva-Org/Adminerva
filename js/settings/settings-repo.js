/** Scoped product configuration and staff preferences: settings repo. */
import {
  collection,
  getDocs,
  deleteDoc,
  doc,
  setDoc,
} from "../core/teaching-firestore.mjs?v=1.1.0";

// ==========================================
// RUBRIC MANAGEMENT & REPOSITORY SETTINGS
// ==========================================
window.templates = [];
window.activeTemplateId = null;
window.editingTemplate = null;

const DEFAULT_TEMPLATES = [
  {
    id: "default_pct",
    name: "Standard Grading",
    scoringType: "percentage",
    generalPrompt: "",
    criteria: [{ name: "Logic", weight: 50, description: "Checks logic" }],
  },
];

window.initRubrics = async function () {
  window.showLoader("Loading Rubrics from Cloud...");
  try {
    if (!window.db) throw new Error("Firebase disconnected.");

    const snap = await getDocs(collection(window.db, "templates"));
    window.templates = [];
    snap.forEach((d) => window.templates.push({ id: d.id, ...d.data() }));

    if (window.templates.length === 0) {
      window.templates = JSON.parse(JSON.stringify(DEFAULT_TEMPLATES));
    }

    window.activeTemplateId =
      localStorage.getItem("Adminerva_active_template_id") ||
      window.templates[0].id;
    window.editingTemplate = JSON.parse(
      JSON.stringify(
        window.templates.find((t) => t.id === window.activeTemplateId) ||
          window.templates[0],
      ),
    );

    window.renderTemplateDropdown();
    window.renderTemplateEditor();
    window.updateRubricEquippedUI();
  } catch (e) {
    console.error("Failed to load rubrics:", e);
  } finally {
    window.hideLoader();
  }
};

window.renderTemplateDropdown = function () {
  const select = document.getElementById("templateSelect");
  if (!select) return;
  select.innerHTML = "";
  window.templates.forEach((t) => {
    select.insertAdjacentHTML(
      "beforeend",
      `<option value="${t.id}" ${t.id === window.editingTemplate.id ? "selected" : ""}>${t.id === window.activeTemplateId ? "⭐ " : ""}${t.name}</option>`,
    );
  });
};

window.updateRubricEquippedUI = function () {
  const banner = document.getElementById("activeEquippedBanner");
  if (banner)
    banner.textContent = (
      window.templates.find((t) => t.id === window.activeTemplateId) ||
      window.templates[0]
    ).name;
};

window.changeTemplate = function () {
  const target = window.templates.find(
    (t) => t.id === document.getElementById("templateSelect").value,
  );
  if (target) {
    window.editingTemplate = JSON.parse(JSON.stringify(target));
    window.renderTemplateEditor();
    window.updateRubricEquippedUI();
  }
};

window.renderTemplateEditor = function () {
  if (document.getElementById("tplName"))
    document.getElementById("tplName").value = window.editingTemplate.name;
  if (document.getElementById("tplGeneralPrompt"))
    document.getElementById("tplGeneralPrompt").value =
      window.editingTemplate.generalPrompt || "";

  document.getElementsByName("tplScoreType").forEach((r) => {
    r.checked =
      r.value === (window.editingTemplate.scoringType || "percentage");
  });

  const container = document.getElementById("criteriaContainer");
  if (!container) return;
  container.innerHTML = "";

  let totalWeight = 0;
  window.editingTemplate.criteria.forEach((crit, index) => {
    totalWeight += Number(crit.weight || 0);
    container.insertAdjacentHTML(
      "beforeend",
      `
            <div class="criterion-row bg-white border border-gray-200 rounded p-3 flex gap-3 mb-2">
                <input type="text" class="crit-name w-1/4 p-1 border-b" value="${crit.name}" onchange="updateTemplatePreview()">
                <input type="number" class="crit-weight w-1/6 p-1 border-b" value="${crit.weight}" onchange="updateTemplatePreview(); window.renderTemplateEditor();">
                <input type="text" class="crit-desc w-1/2 p-1 border-b" value="${crit.description}" onchange="updateTemplatePreview()">
                <button onclick="removeCriterion(${index})" class="text-red-400">🗑️</button>
            </div>
        `,
    );
  });

  const weightBadge = document.getElementById("tplTotalWeight");
  if (weightBadge) {
    const isPct = window.editingTemplate.scoringType === "percentage";
    weightBadge.textContent = `Total: ${totalWeight}${isPct ? "%" : " pts"}`;
  }
};

window.updateTemplatePreview = function () {
  window.editingTemplate.name =
    document.getElementById("tplName")?.value || "Unnamed";
  window.editingTemplate.generalPrompt =
    document.getElementById("tplGeneralPrompt")?.value || "";

  const scoreType = document.querySelector(
    'input[name="tplScoreType"]:checked',
  );
  if (scoreType) {
    window.editingTemplate.scoringType = scoreType.value;
  }

  window.editingTemplate.criteria = Array.from(
    document.querySelectorAll(".criterion-row"),
  ).map((row) => ({
    name: row.querySelector(".crit-name").value,
    weight: Number(row.querySelector(".crit-weight").value),
    description: row.querySelector(".crit-desc").value,
  }));
};

window.equipCurrentTemplate = function () {
  const selectedId = document.getElementById("templateSelect").value;
  window.activeTemplateId = selectedId;
  localStorage.setItem("Adminerva_active_template_id", selectedId);
  window.updateRubricEquippedUI();
  window.renderTemplateDropdown();
  alert("✅ Rubric equipped! The AutoGrader will now use this template.");
};

window.createNewTemplate = function () {
  const newId = "tpl_" + Date.now();
  window.editingTemplate = {
    id: newId,
    name: "New Custom Template",
    scoringType: "percentage",
    generalPrompt: "",
    criteria: [
      { name: "First Criterion", weight: 100, description: "Description here" },
    ],
  };

  window.templates.push(window.editingTemplate);
  window.renderTemplateDropdown();
  document.getElementById("templateSelect").value = newId;
  window.renderTemplateEditor();
};

window.deleteCurrentTemplate = async function () {
  if (window.templates.length <= 1)
    return alert("You must have at least one template.");
  if (
    confirm(`Are you sure you want to delete '${window.editingTemplate.name}'?`)
  ) {
    window.showLoader("Deleting from Cloud...");
    try {
      if (window.db)
        await deleteDoc(doc(window.db, "templates", window.editingTemplate.id));

      window.templates = window.templates.filter(
        (t) => t.id !== window.editingTemplate.id,
      );
      window.editingTemplate = JSON.parse(JSON.stringify(window.templates[0]));

      window.renderTemplateDropdown();
      window.renderTemplateEditor();
    } catch (e) {
      alert("Failed to delete rubric: " + e.message);
    } finally {
      window.hideLoader();
    }
  }
};

window.addCriterion = function () {
  window.updateTemplatePreview();
  window.editingTemplate.criteria.push({
    name: "",
    weight: 10,
    description: "",
  });
  window.renderTemplateEditor();
};

window.removeCriterion = function (i) {
  window.updateTemplatePreview();
  window.editingTemplate.criteria.splice(i, 1);
  window.renderTemplateEditor();
};

window.saveRubrics = async function () {
  if (!window.db) return alert("Firebase disconnected.");
  window.showLoader("Saving Rubric to Cloud...");
  window.updateTemplatePreview();

  try {
    await setDoc(
      doc(window.db, "templates", window.editingTemplate.id),
      window.editingTemplate,
    );
    const idx = window.templates.findIndex(
      (t) => t.id === window.editingTemplate.id,
    );
    if (idx >= 0) window.templates[idx] = window.editingTemplate;
    else window.templates.push(window.editingTemplate);

    window.renderTemplateDropdown();
    alert("Rubric saved to cloud successfully.");
  } catch (e) {
    alert("Failed to save rubric: " + e.message);
  } finally {
    window.hideLoader();
  }
};
