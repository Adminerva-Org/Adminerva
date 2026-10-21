import {ownedDoc,ownedCollection,lessonStorage,workspaceUid,assertWorkspaceAccount,workspaceOnReady,requireStaffWorkspace} from "../lesson-review/workspace-session.mjs?v=1.1.0";
/** Scoped product configuration and staff preferences: settings lesson. */
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

  const savedSub = lessonStorage.getItem("Adminerva_subjects") || "";
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
        ownedDoc(window.db,"preferences","lesson_review_config"),
      );
      if (docSnap.exists()) {
        cloudData = docSnap.data();
      }
    } catch (e) {
      console.warn("Firestore unreachable. Falling back to local storage.", e);
    }
  }

  // Generation and export read these defaults from lessonStorage. Keep that
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
        lessonStorage.setItem(key, cloudData[field]);
    }
  }

  const data = {
    teacher_name:
      cloudData?.teacher_name ||
      lessonStorage.getItem("Adminerva_defaultTeacher") ||
      lessonStorage.getItem("Adminerva_teacherName") ||
      "",
    subject_title:
      cloudData?.subject_title ||
      lessonStorage.getItem("Adminerva_defaultSubject") ||
      lessonStorage.getItem("Adminerva_subjectTitle") ||
      "",
    default_prelim:
      cloudData?.default_prelim ||
      lessonStorage.getItem("Adminerva_defaultPrelim") ||
      "Opening Prayer\nAttendance Checking\nTECHNOTES",
    default_closing:
      cloudData?.default_closing ||
      lessonStorage.getItem("Adminerva_defaultClosing") ||
      "Summary of the Lesson\nClosing Prayer",
    sig_teacher:
      cloudData?.sig_teacher ||
      lessonStorage.getItem("Adminerva_sig1Name") ||
      lessonStorage.getItem("Adminerva_sigTeacher") ||
      "",
    sig_teacher_title:
      cloudData?.sig_teacher_title ||
      lessonStorage.getItem("Adminerva_sig1Title") ||
      lessonStorage.getItem("Adminerva_sigTeacherTitle") ||
      "",
    sig_subject_coord:
      cloudData?.sig_subject_coord ||
      lessonStorage.getItem("Adminerva_sig2Name") ||
      lessonStorage.getItem("Adminerva_sigSubjectCoord") ||
      "",
    sig_subject_coord_title:
      cloudData?.sig_subject_coord_title ||
      lessonStorage.getItem("Adminerva_sig2Title") ||
      lessonStorage.getItem("Adminerva_sigSubjectCoordTitle") ||
      "",
    sig_grade_coord:
      cloudData?.sig_grade_coord ||
      lessonStorage.getItem("Adminerva_sig3Name") ||
      lessonStorage.getItem("Adminerva_sigGradeCoord") ||
      "",
    sig_grade_coord_title:
      cloudData?.sig_grade_coord_title ||
      lessonStorage.getItem("Adminerva_sig3Title") ||
      lessonStorage.getItem("Adminerva_sigGradeCoordTitle") ||
      "",
    sig_principal:
      cloudData?.sig_principal ||
      lessonStorage.getItem("Adminerva_sig4Name") ||
      lessonStorage.getItem("Adminerva_sigPrincipal") ||
      "",
    sig_principal_title:
      cloudData?.sig_principal_title ||
      lessonStorage.getItem("Adminerva_sig4Title") ||
      lessonStorage.getItem("Adminerva_sigPrincipalTitle") ||
      "",
    headerBase64:
      cloudData?.header_image_base64 ||
      lessonStorage.getItem("Adminerva_headerImage") ||
      "",
  };

  if(window.currentLessonSettings)Object.assign(data,window.currentLessonSettings);
  let scope=document.getElementById("lesson-settings-scope");
  if(!scope&&document.getElementById("setTeacherName")){
    scope=document.createElement("p");scope.id="lesson-settings-scope";scope.className="text-sm text-blue-700 my-3";
    document.getElementById("setTeacherName").closest("div")?.before(scope);
  }
  if(scope)scope.textContent=window.currentLessonSettings?"Editing this lesson's document settings only. Save the lesson afterward. Account defaults and header format stay unchanged.":"Editing account-wide planning defaults.";
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

  if(window.currentLessonSettings){
    const {header_image_base64,updated_at,...settings}=settingsData;
    window.currentLessonSettings=settings;
    window.currentPlanSubject=settings.subject_title;window.currentPlanTeacher=settings.teacher_name;
    window.hideLoader?.();
    alert("Document settings applied to this lesson only. Save the lesson to retain them. Account defaults and document format are unchanged.");
    return;
  }
  lessonStorage.setItem("Adminerva_defaultTeacher", settingsData.teacher_name);
  lessonStorage.setItem("Adminerva_teacherName", settingsData.teacher_name);
  lessonStorage.setItem("Adminerva_defaultSubject", settingsData.subject_title);
  lessonStorage.setItem("Adminerva_subjectTitle", settingsData.subject_title);
  lessonStorage.setItem("Adminerva_defaultPrelim", settingsData.default_prelim);
  lessonStorage.setItem(
    "Adminerva_defaultClosing",
    settingsData.default_closing,
  );
  lessonStorage.setItem(
    "Adminerva_headerImage",
    settingsData.header_image_base64,
  );
  lessonStorage.setItem("Adminerva_sig1Name", settingsData.sig_teacher);
  lessonStorage.setItem("Adminerva_sigTeacher", settingsData.sig_teacher);
  lessonStorage.setItem("Adminerva_sig1Title", settingsData.sig_teacher_title);
  lessonStorage.setItem(
    "Adminerva_sigTeacherTitle",
    settingsData.sig_teacher_title,
  );
  lessonStorage.setItem("Adminerva_sig2Name", settingsData.sig_subject_coord);
  lessonStorage.setItem(
    "Adminerva_sigSubjectCoord",
    settingsData.sig_subject_coord,
  );
  lessonStorage.setItem(
    "Adminerva_sig2Title",
    settingsData.sig_subject_coord_title,
  );
  lessonStorage.setItem(
    "Adminerva_sigSubjectCoordTitle",
    settingsData.sig_subject_coord_title,
  );
  lessonStorage.setItem("Adminerva_sig3Name", settingsData.sig_grade_coord);
  lessonStorage.setItem("Adminerva_sigGradeCoord", settingsData.sig_grade_coord);
  lessonStorage.setItem(
    "Adminerva_sig3Title",
    settingsData.sig_grade_coord_title,
  );
  lessonStorage.setItem(
    "Adminerva_sigGradeCoordTitle",
    settingsData.sig_grade_coord_title,
  );
  lessonStorage.setItem("Adminerva_sig4Name", settingsData.sig_principal);
  lessonStorage.setItem("Adminerva_sigPrincipal", settingsData.sig_principal);
  lessonStorage.setItem("Adminerva_sig4Title", settingsData.sig_principal_title);
  lessonStorage.setItem(
    "Adminerva_sigPrincipalTitle",
    settingsData.sig_principal_title,
  );

  if (window.db) {
    try {
      await setDoc(
        ownedDoc(window.db,"preferences","lesson_review_config"),
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

workspaceOnReady( () => {
  // Load teacher/subject defaults before lesson generation on a new device.
  if (document.getElementById("lpGradeLevel"))
    window.loadLessonReviewSettings().catch(error =>
      console.warn("Could not refresh lesson defaults:", error));
});
