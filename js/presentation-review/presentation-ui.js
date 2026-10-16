window.currentPresentationDeck = [];
const safeSlideHTML=value=>window.sanitizePresentationHtml?.(value) ?? "";
window.activeSlideIndex = -1;
window.adminervaPresentationDirty = false;
window.addEventListener("beforeunload", event => {
  if (!window.adminervaPresentationDirty) return;
  event.preventDefault();
  event.returnValue = "";
});


let quillStandard = null;
let quillLeft = null;
let quillRight = null;

document.addEventListener("DOMContentLoaded", () => {
  initEditors();
  initPresentationDeck();
  applyPresentationTheme();
});

window.updateRibbon = function () {
  let subject =
    localStorage.getItem("lessonReview_defaultSubject") || "MAIN LESSON TITLE";
  let topic = "Subtopic Context";
  if (window.selectedPlanData) {
    subject = window.selectedPlanData.subject_title || subject;
    if (
      window.selectedPlanData.weekly_overview &&
      window.selectedPlanData.weekly_overview.topic
    ) {
      topic = window.selectedPlanData.weekly_overview.topic;
    }
  }
  const titleEl = document.getElementById("ribbon-title");
  const subtitleEl = document.getElementById("ribbon-subtitle");
  if (titleEl) titleEl.textContent = subject.toUpperCase();
  if (subtitleEl) subtitleEl.textContent = topic;
};

function initEditors() {
  if (document.getElementById("editor-container"))
    quillStandard = new Quill("#editor-container", {
      theme: "snow",
      modules: { formula: true, toolbar: "#toolbar-standard" },
    });
  if (document.getElementById("editor-left"))
    quillLeft = new Quill("#editor-left", {
      theme: "snow",
      modules: { formula: true, toolbar: "#toolbar-left" },
    });
  if (document.getElementById("editor-right"))
    quillRight = new Quill("#editor-right", {
      theme: "snow",
      modules: { formula: true, toolbar: "#toolbar-right" },
    });

  if (quillLeft)
    quillLeft.root.addEventListener("focus", () => {
      if (
        window.currentPresentationDeck[window.activeSlideIndex]?.layout ===
        "split"
      ) {
        document.getElementById("toolbar-left").classList.remove("hidden");
        document.getElementById("toolbar-right").classList.add("hidden");
      }
    });
  if (quillRight)
    quillRight.root.addEventListener("focus", () => {
      if (
        window.currentPresentationDeck[window.activeSlideIndex]?.layout ===
        "split"
      ) {
        document.getElementById("toolbar-right").classList.remove("hidden");
        document.getElementById("toolbar-left").classList.add("hidden");
      }
    });

  const checkAndSave = (source, editorObj, key) => {
    if (source !== "user" || window.activeSlideIndex < 0) return;
    const canvas = document.getElementById("slide-canvas");
    const editorRoot = editorObj.root;
    const maxSafeHeight = canvas.clientHeight * 0.85;

    if (editorRoot.scrollHeight > maxSafeHeight) {
      editorObj.history.undo();
      flashWarning();
    } else {
      window.currentPresentationDeck[window.activeSlideIndex][key] =
        safeSlideHTML(editorRoot.innerHTML);
      window.adminervaPresentationDirty = true;
    }
  };

  if (quillStandard)
    quillStandard.on("text-change", (d, od, s) =>
      checkAndSave(s, quillStandard, "content"),
    );
  if (quillLeft)
    quillLeft.on("text-change", (d, od, s) =>
      checkAndSave(s, quillLeft, "contentLeft"),
    );
  if (quillRight)
    quillRight.on("text-change", (d, od, s) =>
      checkAndSave(s, quillRight, "contentRight"),
    );
}

function flashWarning() {
  const warning = document.getElementById("overflowWarning");
  if (warning) {
    warning.classList.remove("hidden");
    setTimeout(() => warning.classList.add("hidden"), 1500);
  }
}

window.changeSlideLayout = function (layout) {
  if (window.activeSlideIndex < 0) return;
  window.currentPresentationDeck[window.activeSlideIndex].layout = layout;
  window.adminervaPresentationDirty = true;
  applyLayoutView(layout);
  renderSlideBlocks(); // Update icon
};

function applyLayoutView(layout) {
  const layoutStandard = document.getElementById("layout-standard");
  const layoutSplit = document.getElementById("layout-split");
  const layoutMedia = document.getElementById("layout-media");
  const ribbon = document.getElementById("slide-ribbon");

  const masterToolbar = document.getElementById("master-toolbar-container");
  const tStd = document.getElementById("toolbar-standard");
  const tLeft = document.getElementById("toolbar-left");
  const tRight = document.getElementById("toolbar-right");

  layoutStandard.classList.remove("flex", "hidden");
  layoutSplit.classList.remove("flex", "hidden");
  layoutMedia.classList.remove("flex", "hidden");
  ribbon.classList.remove("hidden");

  tStd.classList.add("hidden");
  tLeft.classList.add("hidden");
  tRight.classList.add("hidden");
  masterToolbar.style.opacity = "1";
  masterToolbar.style.pointerEvents = "auto";

  if (layout === "split") {
    layoutStandard.classList.add("hidden");
    layoutSplit.classList.add("flex");
    layoutMedia.classList.add("hidden");
    tLeft.classList.remove("hidden");
  } else if (layout === "media") {
    layoutStandard.classList.add("hidden");
    layoutSplit.classList.add("hidden");
    layoutMedia.classList.add("flex");
    ribbon.classList.add("hidden");
    masterToolbar.style.opacity = "0.3";
    masterToolbar.style.pointerEvents = "none";
    tStd.classList.remove("hidden");
    renderMediaPreview();
  } else {
    layoutStandard.classList.add("flex");
    layoutSplit.classList.add("hidden");
    layoutMedia.classList.add("hidden");
    tStd.classList.remove("hidden");
  }
}

window.handleMediaUpload = function (event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 800 * 1024) {
    alert("🚨 IMAGE TOO LARGE! Compress to under 800KB.");
    event.target.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = function (e) {
    window.currentPresentationDeck[window.activeSlideIndex].mediaUrl =
      e.target.result;
    renderMediaPreview();
  };
  reader.readAsDataURL(file);
};

function renderMediaPreview() {
  if (window.activeSlideIndex < 0) return;
  const slide = window.currentPresentationDeck[window.activeSlideIndex];
  const previewImg = document.getElementById("media-preview-img");
  const uploadUi = document.getElementById("media-upload-ui");

  if (slide.mediaUrl) {
    previewImg.src = slide.mediaUrl;
    previewImg.classList.remove("hidden");
    uploadUi.classList.add("hidden");
  } else {
    previewImg.src = "";
    previewImg.classList.add("hidden");
    uploadUi.classList.remove("hidden");
  }
}

window.clearMediaSlide = function () {
  if (window.activeSlideIndex < 0) return;
  window.currentPresentationDeck[window.activeSlideIndex].mediaUrl = "";
  document.getElementById("mediaFileInput").value = "";
  renderMediaPreview();
};

function initPresentationDeck() {
  if (window.currentPresentationDeck.length === 0) {
    window.currentPresentationDeck = [
      {
        layout: "standard",
        type: "title",
        label: "Title Slide",
        content: "<h1>Main Lesson Title</h1>",
        hidden: false,
      },
    ];
  }
  renderSlideBlocks();
  window.selectSlide(0);
}

// 🚀 ENHANCED SLIDE MANAGEMENT RENDERER
function renderSlideBlocks() {
  const listContainer = document.getElementById("slideBlockList");
  if (!listContainer) return;
  listContainer.innerHTML = "";

  window.currentPresentationDeck.forEach((slide, index) => {
    const isActive = index === window.activeSlideIndex;
    const activeStyles = "bg-blue-50 border border-blue-500 shadow-sm";
    const inactiveStyles =
      "bg-white border border-gray-100 hover:border-gray-300";
    const isHidden = slide.hidden ? "opacity-50 grayscale" : "";

    const html = `
      <div class="p-2 rounded transition flex flex-col gap-2 group ${isActive ? activeStyles : inactiveStyles} ${isHidden}">
          <div onclick="selectSlide(${index})" class="flex items-center gap-3 cursor-pointer">
              <span class="text-2xl font-black ${isActive ? "text-blue-600" : "text-gray-300"} w-6 text-center">${index + 1}</span>
              <div class="flex-1">
                  <div class="text-sm font-bold ${isActive ? "text-gray-900" : "text-gray-700"} ${slide.hidden ? "line-through text-red-500" : ""}">${slide.label || "Slide"}</div>
                  <div class="text-[9px] uppercase font-bold text-gray-400 mt-0.5">${slide.layout || "Standard"}</div>
              </div>
          </div>
          
          <!-- Slide Controls -->
          <div class="flex items-center justify-between border-t border-gray-100 pt-2 ${isActive ? "flex" : "hidden group-hover:flex"}">
              <div class="flex gap-1">
                  <button onclick="moveSlideUp(${index})" title="Move Up" class="text-gray-400 hover:text-blue-600 px-1">⬆️</button>
                  <button onclick="moveSlideDown(${index})" title="Move Down" class="text-gray-400 hover:text-blue-600 px-1">⬇️</button>
              </div>
              <div class="flex gap-2">
                  <button onclick="toggleHideSlide(${index})" title="${slide.hidden ? "Show Slide" : "Skip/Hide Slide"}" class="text-gray-400 hover:text-amber-500 px-1">${slide.hidden ? "👁️‍🗨️" : "👁️"}</button>
                  <button onclick="duplicateSlide(${index})" title="Duplicate Slide" class="text-gray-400 hover:text-green-600 px-1">📋</button>
                  <button onclick="deleteSlide(${index})" title="Delete Slide" class="text-gray-400 hover:text-red-600 px-1">🗑️</button>
              </div>
          </div>
      </div>
    `;
    listContainer.insertAdjacentHTML("beforeend", html);
  });
}

// 🚀 SLIDE MANAGEMENT ACTIONS
window.moveSlideUp = function (i) {
  if (i <= 0) return;
  const temp = window.currentPresentationDeck[i - 1];
  window.currentPresentationDeck[i - 1] = window.currentPresentationDeck[i];
  window.currentPresentationDeck[i] = temp;
  window.selectSlide(i - 1);
};
window.moveSlideDown = function (i) {
  if (i >= window.currentPresentationDeck.length - 1) return;
  const temp = window.currentPresentationDeck[i + 1];
  window.currentPresentationDeck[i + 1] = window.currentPresentationDeck[i];
  window.currentPresentationDeck[i] = temp;
  window.selectSlide(i + 1);
};
window.duplicateSlide = function (i) {
  const clone = JSON.parse(JSON.stringify(window.currentPresentationDeck[i]));
  window.currentPresentationDeck.splice(i + 1, 0, clone);
  window.selectSlide(i + 1);
};
window.deleteSlide = function (i) {
  if (window.currentPresentationDeck.length <= 1)
    return alert("Cannot delete the last slide.");
  if (confirm("Delete this slide?")) {
    window.currentPresentationDeck.splice(i, 1);
    window.selectSlide(Math.max(0, i - 1));
  }
};
window.toggleHideSlide = function (i) {
  window.currentPresentationDeck[i].hidden =
    !window.currentPresentationDeck[i].hidden;
  renderSlideBlocks();
};

window.selectSlide = function (index) {
  if (index < 0 || index >= window.currentPresentationDeck.length) return;
  window.activeSlideIndex = index;
  window.updateRibbon();
  renderSlideBlocks();

  const slide = window.currentPresentationDeck[index];
  const layout = slide.layout || "standard";
  document.getElementById("slideLayoutSelector").value = layout;
  applyLayoutView(layout);

  if (quillStandard) quillStandard.root.innerHTML = safeSlideHTML(slide.content);
  if (quillLeft) quillLeft.root.innerHTML = safeSlideHTML(slide.contentLeft);
  if (quillRight) quillRight.root.innerHTML = safeSlideHTML(slide.contentRight);
};

// 🚀 ADD SLIDE MODAL LOGIC
window.openAddSlideModal = function () {
  document.getElementById("addSlideModal").classList.replace("hidden", "flex");
};
window.closeAddSlideModal = function () {
  document.getElementById("addSlideModal").classList.replace("flex", "hidden");
};
window.confirmAddSlide = function (layoutType) {
  window.currentPresentationDeck.push({
    layout: layoutType,
    type: "blank",
    label: "Custom Slide",
    content: "",
    hidden: false,
  });
  window.closeAddSlideModal();
  window.selectSlide(window.currentPresentationDeck.length - 1);
};

async function applyPresentationTheme() {
  let bgBase64 = localStorage.getItem("presentation_logo");
  const canvasEl = document.getElementById("slide-canvas");
  const applyToCanvas = (b64) => {
    if (canvasEl && b64 && b64.length > 50) {
      canvasEl.style.backgroundImage = `url('${b64}')`;
      canvasEl.style.backgroundColor = "transparent";
    }
  };

  if (bgBase64 && bgBase64.length > 50) return applyToCanvas(bgBase64);

  let attempts = 0;
  const checkDb = setInterval(async () => {
    if (window.db) {
      clearInterval(checkDb);
      try {
        const { doc, getDoc } =
          await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js");
        const docSnap = await getDoc(
          doc(window.db, "global_settings", "presentation_config"),
        );
        if (docSnap.exists() && docSnap.data().logo_base64) {
          bgBase64 = docSnap.data().logo_base64;
          localStorage.setItem("presentation_logo", bgBase64);
          applyToCanvas(bgBase64);
        }
      } catch (e) {}
    }
    attempts++;
    if (attempts > 20) clearInterval(checkDb);
  }, 100);
}
// ==========================================
// 🚀 PREFAB HEADING ENGINE
// ==========================================
window.activeQuillInstance = null; // Tracks which editor was clicked last

// Update the tracker whenever a teacher clicks inside an editor
function attachFocusTrackers() {
  if (quillStandard)
    quillStandard.root.addEventListener(
      "focus",
      () => (window.activeQuillInstance = quillStandard),
    );
  if (quillLeft)
    quillLeft.root.addEventListener(
      "focus",
      () => (window.activeQuillInstance = quillLeft),
    );
  if (quillRight)
    quillRight.root.addEventListener(
      "focus",
      () => (window.activeQuillInstance = quillRight),
    );
}

// Call this once on load
document.addEventListener("DOMContentLoaded", () => {
  setTimeout(attachFocusTrackers, 500);
});

window.openPrefabModal = function () {
  if (!window.activeQuillInstance) {
    alert(
      "Please click inside a text box first so I know where to insert the heading.",
    );
    return;
  }
  document
    .getElementById("prefabHeadingModal")
    .classList.replace("hidden", "flex");
};

window.closePrefabModal = function () {
  document
    .getElementById("prefabHeadingModal")
    .classList.replace("flex", "hidden");
};

window.injectPrefab = function (icon, text, hexColor) {
  if (!window.activeQuillInstance) return;

  let range = window.activeQuillInstance.getSelection(true);
  if (!range) range = { index: 0 };

  // 🚀 Injects the Giant Title and the Color-Matched Expanding Box
  const htmlSnippet = `
        <p style="margin-bottom: 4px; line-height: 1;">
            <strong style="color: ${hexColor}; font-size: 36px; font-family: 'Arial Black', Arial, sans-serif; letter-spacing: -1px;">
                ${icon} ${text}
            </strong>
        </p>
        <blockquote style="color: ${hexColor};">
            <span style="color: #333333; font-size: 18px;">Type your content inside this expanding box...</span>
        </blockquote>
        <p><br></p>
    `;

  window.activeQuillInstance.clipboard.dangerouslyPasteHTML(
    range.index,
    safeSlideHTML(htmlSnippet),
  );
  window.closePrefabModal();
};
