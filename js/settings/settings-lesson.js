import {
  doc,
  getDoc,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const safeSet = (id, val) => {
  if (document.getElementById(id))
    document.getElementById(id).value = val || "";
};

const safeGet = (id) =>
  document.getElementById(id) ? document.getElementById(id).value.trim() : "";

window.populateSettingsSubjectDropdown = function () {
  const dataList = document.getElementById("savedSubjectsList");
  if (!dataList) return;

  const savedSub = localStorage.getItem("Adminerva_subjects") || "";
  const subjects = savedSub
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");

  dataList.innerHTML = "";
  subjects.forEach((sub) => {
    const option = document.createElement("option");
    option.value = sub;
    dataList.appendChild(option);
  });
};

window.loadLessonReviewSettings = async function () {
  let cloudData = null;

  if (window.db) {
    try {
      const docSnap = await getDoc(
        doc(window.db, "global_settings", "lesson_review_config"),
      );
      if (docSnap.exists()) {
        cloudData = docSnap.data();
      }
    } catch (e) {
      console.warn("Firestore unreachable. Falling back to local storage.", e);
    }
  }

  // Generation and export read these defaults from localStorage. Keep that
  // cache aligned with the cloud document, including on a different device.
  if (cloudData) {
    const mapping = {
      teacher_name: "Adminerva_defaultTeacher",
      subject_title: "Adminerva_defaultSubject",
      default_prelim: "Adminerva_defaultPrelim",
      default_closing: "Adminerva_defaultClosing",
      header_image_base64: "Adminerva_headerImage",
      sig_teacher: "Adminerva_sig1Name",
      sig_teacher_title: "Adminerva_sig1Title",
      sig_subject_coord: "Adminerva_sig2Name",
      sig_subject_coord_title: "Adminerva_sig2Title",
      sig_grade_coord: "Adminerva_sig3Name",
      sig_grade_coord_title: "Adminerva_sig3Title",
      sig_principal: "Adminerva_sig4Name",
      sig_principal_title: "Adminerva_sig4Title",
    };
    for (const [field, key] of Object.entries(mapping)) {
      if (typeof cloudData[field] === "string")
        localStorage.setItem(key, cloudData[field]);
    }
  }

  const data = {
    teacher_name:
      cloudData?.teacher_name ||
      localStorage.getItem("Adminerva_defaultTeacher") ||
      localStorage.getItem("Adminerva_teacherName") ||
      "",
    subject_title:
      cloudData?.subject_title ||
      localStorage.getItem("Adminerva_defaultSubject") ||
      localStorage.getItem("Adminerva_subjectTitle") ||
      "",
    default_prelim:
      cloudData?.default_prelim ||
      localStorage.getItem("Adminerva_defaultPrelim") ||
      "Opening Prayer\nAttendance Checking\nTECHNOTES",
    default_closing:
      cloudData?.default_closing ||
      localStorage.getItem("Adminerva_defaultClosing") ||
      "Summary of the Lesson\nClosing Prayer",
    sig_teacher:
      cloudData?.sig_teacher ||
      localStorage.getItem("Adminerva_sig1Name") ||
      localStorage.getItem("Adminerva_sigTeacher") ||
      "",
    sig_teacher_title:
      cloudData?.sig_teacher_title ||
      localStorage.getItem("Adminerva_sig1Title") ||
      localStorage.getItem("Adminerva_sigTeacherTitle") ||
      "",
    sig_subject_coord:
      cloudData?.sig_subject_coord ||
      localStorage.getItem("Adminerva_sig2Name") ||
      localStorage.getItem("Adminerva_sigSubjectCoord") ||
      "",
    sig_subject_coord_title:
      cloudData?.sig_subject_coord_title ||
      localStorage.getItem("Adminerva_sig2Title") ||
      localStorage.getItem("Adminerva_sigSubjectCoordTitle") ||
      "",
    sig_grade_coord:
      cloudData?.sig_grade_coord ||
      localStorage.getItem("Adminerva_sig3Name") ||
      localStorage.getItem("Adminerva_sigGradeCoord") ||
      "",
    sig_grade_coord_title:
      cloudData?.sig_grade_coord_title ||
      localStorage.getItem("Adminerva_sig3Title") ||
      localStorage.getItem("Adminerva_sigGradeCoordTitle") ||
      "",
    sig_principal:
      cloudData?.sig_principal ||
      localStorage.getItem("Adminerva_sig4Name") ||
      localStorage.getItem("Adminerva_sigPrincipal") ||
      "",
    sig_principal_title:
      cloudData?.sig_principal_title ||
      localStorage.getItem("Adminerva_sig4Title") ||
      localStorage.getItem("Adminerva_sigPrincipalTitle") ||
      "",
    headerBase64:
      cloudData?.header_image_base64 ||
      localStorage.getItem("Adminerva_headerImage") ||
      "",
  };

  safeSet("setTeacherName", data.teacher_name);
  safeSet("setSubjectTitle", data.subject_title);
  safeSet("setPrelimActivities", data.default_prelim);
  safeSet("setClosingActivities", data.default_closing);
  safeSet("sigTeacher", data.sig_teacher);
  safeSet("sigTeacherTitle", data.sig_teacher_title);
  safeSet("sigSubjectCoord", data.sig_subject_coord);
  safeSet("sigSubjectCoordTitle", data.sig_subject_coord_title);
  safeSet("sigGradeCoord", data.sig_grade_coord);
  safeSet("sigGradeCoordTitle", data.sig_grade_coord_title);
  safeSet("sigPrincipal", data.sig_principal);
  safeSet("sigPrincipalTitle", data.sig_principal_title);

  if (data.headerBase64 && document.getElementById("settingsHeaderBase64")) {
    document.getElementById("settingsHeaderBase64").value = data.headerBase64;
    const previewImg = document.getElementById("headerPreview");
    const placeholder = document.getElementById("headerPreviewPlaceholder");
    if (previewImg && placeholder) {
      previewImg.src = data.headerBase64;
      previewImg.classList.remove("hidden");
      placeholder.classList.add("hidden");
    }
  }

  window.populateSettingsSubjectDropdown();
};

window.previewHeaderImage = function (event) {
  const file = event.target.files[0];
  if (!file) return;

  if (file.size > 800 * 1024) {
    alert(
      "Please choose a smaller image (under 800KB) to keep the database fast.",
    );
    return;
  }

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
  const hiddenInput = document.getElementById("settingsHeaderBase64");
  const fileInput = document.getElementById("settingsHeaderFile");
  if (hiddenInput) hiddenInput.value = "";
  if (fileInput) fileInput.value = "";

  const previewImg = document.getElementById("headerPreview");
  const placeholder = document.getElementById("headerPreviewPlaceholder");

  if (previewImg && placeholder) {
    previewImg.src = "";
    previewImg.classList.add("hidden");
    placeholder.classList.remove("hidden");
  }
};

window.saveLessonReviewSettings = async function () {
  if (typeof window.showLoader === "function") {
    window.showLoader("Saving Configurations...");
  }

  const headerBase64Val = safeGet("settingsHeaderBase64");

  const settingsData = {
    teacher_name: safeGet("setTeacherName"),
    subject_title: safeGet("setSubjectTitle"),
    default_prelim: safeGet("setPrelimActivities"),
    default_closing: safeGet("setClosingActivities"),
    header_image_base64: headerBase64Val,
    sig_teacher: safeGet("sigTeacher"),
    sig_teacher_title: safeGet("sigTeacherTitle"),
    sig_subject_coord: safeGet("sigSubjectCoord"),
    sig_subject_coord_title: safeGet("sigSubjectCoordTitle"),
    sig_grade_coord: safeGet("sigGradeCoord"),
    sig_grade_coord_title: safeGet("sigGradeCoordTitle"),
    sig_principal: safeGet("sigPrincipal"),
    sig_principal_title: safeGet("sigPrincipalTitle"),
    updated_at: new Date().toISOString(),
  };

  localStorage.setItem("Adminerva_defaultTeacher", settingsData.teacher_name);
  localStorage.setItem("Adminerva_teacherName", settingsData.teacher_name);
  localStorage.setItem("Adminerva_defaultSubject", settingsData.subject_title);
  localStorage.setItem("Adminerva_subjectTitle", settingsData.subject_title);
  localStorage.setItem("Adminerva_defaultPrelim", settingsData.default_prelim);
  localStorage.setItem(
    "Adminerva_defaultClosing",
    settingsData.default_closing,
  );
  localStorage.setItem(
    "Adminerva_headerImage",
    settingsData.header_image_base64,
  );
  localStorage.setItem("Adminerva_sig1Name", settingsData.sig_teacher);
  localStorage.setItem("Adminerva_sigTeacher", settingsData.sig_teacher);
  localStorage.setItem("Adminerva_sig1Title", settingsData.sig_teacher_title);
  localStorage.setItem(
    "Adminerva_sigTeacherTitle",
    settingsData.sig_teacher_title,
  );
  localStorage.setItem("Adminerva_sig2Name", settingsData.sig_subject_coord);
  localStorage.setItem(
    "Adminerva_sigSubjectCoord",
    settingsData.sig_subject_coord,
  );
  localStorage.setItem(
    "Adminerva_sig2Title",
    settingsData.sig_subject_coord_title,
  );
  localStorage.setItem(
    "Adminerva_sigSubjectCoordTitle",
    settingsData.sig_subject_coord_title,
  );
  localStorage.setItem("Adminerva_sig3Name", settingsData.sig_grade_coord);
  localStorage.setItem("Adminerva_sigGradeCoord", settingsData.sig_grade_coord);
  localStorage.setItem(
    "Adminerva_sig3Title",
    settingsData.sig_grade_coord_title,
  );
  localStorage.setItem(
    "Adminerva_sigGradeCoordTitle",
    settingsData.sig_grade_coord_title,
  );
  localStorage.setItem("Adminerva_sig4Name", settingsData.sig_principal);
  localStorage.setItem("Adminerva_sigPrincipal", settingsData.sig_principal);
  localStorage.setItem("Adminerva_sig4Title", settingsData.sig_principal_title);
  localStorage.setItem(
    "Adminerva_sigPrincipalTitle",
    settingsData.sig_principal_title,
  );

  if (window.db) {
    try {
      await setDoc(
        doc(window.db, "global_settings", "lesson_review_config"),
        settingsData,
        { merge: true },
      );
      alert("✅ Settings successfully saved to the cloud and synced locally!");
    } catch (e) {
      alert(`⚠️ Saved locally, but cloud sync failed: ${e.message}`);
    }
  } else {
    alert("✅ Settings saved locally (Firebase offline).");
  }

  if (typeof window.hideLoader === "function") {
    window.hideLoader();
  }
};

document.addEventListener("DOMContentLoaded", () => {
  // Load teacher/subject defaults before lesson generation on a new device.
  if (document.getElementById("lpGradeLevel"))
    window.loadLessonReviewSettings().catch(error =>
      console.warn("Could not refresh lesson defaults:", error));
});
