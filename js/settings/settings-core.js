/** Scoped product configuration and staff preferences: settings core. */
window.showLoader = function (msg = "Processing...") {
  if (typeof window.showSubtleLoader === "function") {
    window.showSubtleLoader(msg);
  }
};

window.hideLoader = function () {
  if (typeof window.hideSubtleLoader === "function") {
    window.hideSubtleLoader();
  }
};
// 🚀 Vertical Sidebar Navigation (Dynamic Tailwind Injection)
window.switchSettingsCategory = function (targetPanelId) {
  // 1. Hide all right-side panels
  const panels = document.querySelectorAll(".settings-panel");
  panels.forEach((p) => p.classList.replace("block", "hidden"));

  // 2. Define the exact Tailwind strings for our states
  const activeClasses = [
    "bg-purple-50",
    "text-purple-700",
    "border-r-4",
    "border-purple-600",
  ];
  const inactiveClasses = ["text-gray-600", "hover:bg-gray-100", "rounded-lg"];

  // 3. Reset ALL buttons to the inactive gray state
  const buttons = document.querySelectorAll(".sidebar-btn");
  buttons.forEach((b) => {
    b.classList.remove(...activeClasses);
    b.classList.add(...inactiveClasses);
  });

  // 4. Show the target panel and apply the purple active state to the clicked button
  const targetPanel = document.getElementById(`panel-${targetPanelId}`);
  const targetBtn = document.getElementById(`navBtn-${targetPanelId}`);

  if (targetPanel && targetBtn) {
    targetPanel.classList.replace("hidden", "block");

    // Strip the gray hover and rounded corners, add the purple highlight
    targetBtn.classList.remove(...inactiveClasses);
    targetBtn.classList.add(...activeClasses);
  }
};

window.previewHeaderImage = function (event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 800 * 1024)
    return alert("Please choose an image under 800KB.");

  const reader = new FileReader();
  reader.onload = function (e) {
    const base64String = e.target.result;
    const hiddenInput = document.getElementById("settingsHeaderBase64");
    if (hiddenInput) hiddenInput.value = base64String;
    const previewImg = document.getElementById("headerPreview");
    const placeholder = document.getElementById("headerPreviewPlaceholder");
    if (previewImg && placeholder) {
      previewImg.src = base64String;
      previewImg.classList.remove("hidden");
      placeholder.classList.add("hidden");
    }
  };
  reader.readAsDataURL(file);
};

window.clearHeaderImage = function () {
  if (document.getElementById("settingsHeaderBase64"))
    document.getElementById("settingsHeaderBase64").value = "";
  if (document.getElementById("settingsHeaderFile"))
    document.getElementById("settingsHeaderFile").value = "";
  const previewImg = document.getElementById("headerPreview");
  const placeholder = document.getElementById("headerPreviewPlaceholder");
  if (previewImg && placeholder) {
    previewImg.src = "";
    previewImg.classList.add("hidden");
    placeholder.classList.remove("hidden");
  }
};

// Modal Toggles
window.openSectionsModal = () => {
  if (window.renderSectionsManagerTable) window.renderSectionsManagerTable();
  document.getElementById("sectionsModal")?.classList.replace("hidden", "flex");
};
window.closeSectionsModal = () =>
  document.getElementById("sectionsModal")?.classList.replace("flex", "hidden");
window.closeStudentModal = () =>
  document.getElementById("studentModal")?.classList.replace("flex", "hidden");

// Initialization
document.addEventListener("DOMContentLoaded", () => {
  if (window.loadSecuritySettings) window.loadSecuritySettings();

  // 1. Boot Firebase FIRST so window.db is established
  if (window.initFirebase) window.initFirebase();

  // 2. Fetch cloud rubrics AFTER Firebase is connected
  if (window.initRubrics) window.initRubrics();

  const csvInput = document.getElementById("csvFileInput");
  if (csvInput && window.handleCsvUpload)
    csvInput.addEventListener("change", window.handleCsvUpload);
});
