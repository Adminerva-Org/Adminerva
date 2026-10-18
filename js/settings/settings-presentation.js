/** Scoped product configuration and staff preferences: settings presentation. */
import {
  doc,
  getDoc,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// 🔒 Security Patch: Helper to neutralize malicious HTML scripts from user input
function escapeHTML(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const safeSet = (id, val) => {
  if (document.getElementById(id))
    document.getElementById(id).value = val || "";
};
const safeGet = (id) =>
  document.getElementById(id) ? document.getElementById(id).value.trim() : "";

let slideSequence = [
  { type: "title", label: "Title Slide" },
  { type: "objectives", label: "Objectives" },
  { type: "motivation", label: "Motivation / Recall" },
  { type: "core", label: "Core Content" },
  { type: "evaluation", label: "Evaluation" },
];

document.addEventListener("DOMContentLoaded", () => {
  const logoInput = document.getElementById("slideLogoFile");
  if (logoInput) {
    logoInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;

      if (file.size > 800 * 1024) {
        alert(
          "🚨 IMAGE TOO LARGE! Please compress your background to under 800KB.",
        );
        logoInput.value = "";
        return;
      }

      const reader = new FileReader();
      reader.onload = function (event) {
        const b64 = event.target.result;
        safeSet("slideLogoBase64", b64);

        const previewImg = document.getElementById("slideBgPreview");
        const placeholder = document.getElementById("slideBgPlaceholder");
        if (previewImg && placeholder) {
          previewImg.src = b64;
          previewImg.classList.remove("hidden");
          placeholder.classList.add("hidden");
        }
      };
      reader.readAsDataURL(file);
    });
  }

  setTimeout(loadPresentationSettings, 500);
});

window.clearSlideBackground = function () {
  safeSet("slideLogoBase64", "");
  if (document.getElementById("slideLogoFile"))
    document.getElementById("slideLogoFile").value = "";

  const previewImg = document.getElementById("slideBgPreview");
  const placeholder = document.getElementById("slideBgPlaceholder");
  if (previewImg && placeholder) {
    previewImg.src = "";
    previewImg.classList.add("hidden");
    placeholder.classList.remove("hidden");
  }
};

function renderSlideSequence() {
  const container = document.getElementById("slideTemplateSequence");
  if (!container) return;
  container.innerHTML = "";
  if (slideSequence.length === 0) {
    container.innerHTML = `<div class="text-xs text-gray-500 italic text-center py-4 border rounded bg-gray-50">No slides in default stack. Click "Add Slide Block" above.</div>`;
    return;
  }
  slideSequence.forEach((slide, index) => {
    const slideTypes = [
      { val: "title", text: "Title Slide" },
      { val: "objectives", text: "Objectives" },
      { val: "motivation", text: "Motivation / Recall" },
      { val: "core", text: "Core Lesson Content" },
      { val: "evaluation", text: "Evaluation" },
      { val: "closing", text: "Closing & Values" },
      { val: "blank", text: "Blank Slide" },
    ];

    // 🔒 Security Patch: Sanitize dropdown options
    let optionsHtml = slideTypes
      .map((opt) => {
        const safeVal = escapeHTML(opt.val);
        const safeText = escapeHTML(opt.text);
        const isSelected = slide.type === opt.val ? "selected" : "";
        return `<option value="${safeVal}" ${isSelected}>${safeText}</option>`;
      })
      .join("");

    const html = `
            <div class="flex items-center gap-3 bg-gray-50 border border-gray-200 p-2 rounded-lg shadow-sm slide-row">
                <div class="cursor-move text-gray-400 px-2 font-bold select-none">⋮⋮</div>
                <div class="font-bold text-xs text-gray-500 w-16 uppercase">Slide ${index + 1}</div>
                <select class="flex-1 p-1.5 border border-gray-300 rounded text-sm bg-white focus:ring-blue-500 slide-type-select" onchange="updateSlideSequence()">${optionsHtml}</select>
                <button onclick="removeSlideFromTemplate(${index})" class="text-red-400 hover:text-red-600 px-2 font-bold" title="Remove Slide">✖</button>
            </div>
        `;
    container.insertAdjacentHTML("beforeend", html);
  });
}

window.addSlideToTemplate = function () {
  slideSequence.push({ type: "blank", label: "Blank Slide" });
  renderSlideSequence();
};

window.removeSlideFromTemplate = function (index) {
  slideSequence.splice(index, 1);
  renderSlideSequence();
};

window.updateSlideSequence = function () {
  const rows = document.querySelectorAll(".slide-row");
  const newSequence = [];
  rows.forEach((row) => {
    const select = row.querySelector(".slide-type-select");
    newSequence.push({
      type: select.value,
      label: select.options[select.selectedIndex].text,
    });
  });
  slideSequence = newSequence;
  renderSlideSequence();
};

window.loadPresentationSettings = async function () {
  let cloudData = null;

  if (window.db) {
    try {
      const docSnap = await getDoc(
        doc(window.db, "global_settings", "presentation_config"),
      );
      if (docSnap.exists()) cloudData = docSnap.data();
    } catch (e) {
      console.warn(
        "Firestore unreachable for Presentations. Falling back to local storage.",
        e,
      );
    }
  }

  const theme =
    cloudData?.theme || localStorage.getItem("presentation_theme") || "light";
  const logoBase64 =
    cloudData?.logo_base64 || localStorage.getItem("presentation_logo") || "";
  const savedSequence =
    cloudData?.slide_sequence ||
    JSON.parse(localStorage.getItem("presentation_slide_sequence") || "null");

  safeSet("setSlideTheme", theme);
  safeSet("slideLogoBase64", logoBase64);

  // 🔥 POPULATE PREVIEW ON LOAD
  if (logoBase64) {
    const previewImg = document.getElementById("slideBgPreview");
    const placeholder = document.getElementById("slideBgPlaceholder");
    if (previewImg && placeholder) {
      previewImg.src = logoBase64;
      previewImg.classList.remove("hidden");
      placeholder.classList.add("hidden");
    }
    localStorage.setItem("presentation_logo", logoBase64);
  }

  if (savedSequence && Array.isArray(savedSequence)) {
    slideSequence = savedSequence;
  }
  renderSlideSequence();
};

window.savePresentationSettings = async function () {
  if (typeof window.showLoader === "function")
    window.showLoader("Saving Presentation Defaults...");
  window.updateSlideSequence();

  const settingsData = {
    theme: safeGet("setSlideTheme") || "light",
    logo_base64: safeGet("slideLogoBase64"),
    slide_sequence: slideSequence,
    updated_at: new Date().toISOString(),
  };

  try {
    localStorage.setItem("presentation_theme", settingsData.theme);
    localStorage.setItem("presentation_logo", settingsData.logo_base64);
    localStorage.setItem(
      "presentation_slide_sequence",
      JSON.stringify(settingsData.slide_sequence),
    );

    if (window.db) {
      await setDoc(
        doc(window.db, "global_settings", "presentation_config"),
        settingsData,
        { merge: true },
      );
      alert("✅ Presentation settings saved locally and synced to Firebase.");
    } else {
      alert("✅ Presentation settings saved locally (Firebase offline).");
    }
  } catch (e) {
    alert(`⚠️ Error saving settings: ${e.message}`);
  } finally {
    if (typeof window.hideLoader === "function") window.hideLoader();
  }
};
