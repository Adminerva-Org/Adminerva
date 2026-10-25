import {ownedDoc,ownedCollection,lessonStorage,workspaceUid,assertWorkspaceAccount,workspaceOnReady,requireStaffWorkspace} from "./workspace-session.mjs?v=1.3.0";
import { printLesson } from "./lesson-print.mjs?v=1.4.18";
import {exportLessonToGoogleDocs,buildGoogleDocsSource} from "./google-docs-export.mjs?v=1.4.18";
/** School-format lesson document construction and export. */
import {
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
const escapePrintText=value=>String(value??"").replace(/[&<>"']/g,c=>({
"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
})[c]);
const linesForPrint=value=>escapePrintText(value).replace(/\\n|\n/g,"<br>");
const competencySentenceCase=value=>String(value??"").replace(
  /(^|\\n|\n)(\s*(?:(?:[-•*]|\d+[.\)])\s*)?)([A-Z])/g,
  (_match,start,prefix,letter)=>start+prefix+letter.toLowerCase(),
);

window.formatListForPrint = function (text, isOrdered = true) {
  if (!text) return "";
  const lines = String(text)
    .split(/\\n|\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return "";
  if (lines.length === 1 && !/^([-•*]|\d+[\.\)])/.test(lines[0])) return linesForPrint(text);

  const tag = isOrdered ? "ol" : "ul";
  const type = isOrdered ? "decimal" : "disc";
  let html = `<${tag} style="margin: 0; padding-left: 20px; list-style-type: ${type};">`;
  lines.forEach((line) => {
    let cleanLine = line.replace(/^([-•*]|\d+[\.\)])\s*/, "").trim();
    if (cleanLine) html += `<li style="margin-bottom: 4px;">${escapePrintText(cleanLine)}</li>`;
  });
  html += `</${tag}>`;
  return html;
};

window.buildDocumentLayout = async function () {
  window.syncOutputToData?.();
  if (
    !window.currentPlan ||
    window.currentPlan.length === 0 ||
    !window.currentWeeklyOverview
  ) {
    alert("Please generate a lesson plan first before exporting.");
    return false;
  }

  let headerImgUrl = lessonStorage.getItem("Adminerva_headerImage") || lessonStorage.getItem("lessonReview_headerImage") || "";
  let rawSubject =
    lessonStorage.getItem("Adminerva_defaultSubject") || lessonStorage.getItem("lessonReview_defaultSubject") || "SUBJECT";
  let rawTeacher =
    lessonStorage.getItem("Adminerva_defaultTeacher") || lessonStorage.getItem("lessonReview_defaultTeacher") || "TEACHER";

  let s1Name = lessonStorage.getItem("Adminerva_sig1Name") ||
    lessonStorage.getItem("lessonReview_sig1Name") || rawTeacher;
  let s1Title =
    lessonStorage.getItem("Adminerva_sig1Title") ||
    lessonStorage.getItem("lessonReview_sig1Title") || "Subject Teacher";
  let s2Name = lessonStorage.getItem("Adminerva_sig2Name") ||
    lessonStorage.getItem("lessonReview_sig2Name") || "";
  let s2Title = lessonStorage.getItem("Adminerva_sig2Title") ||
    lessonStorage.getItem("lessonReview_sig2Title") || "";
  let s3Name = lessonStorage.getItem("Adminerva_sig3Name") ||
    lessonStorage.getItem("lessonReview_sig3Name") || "";
  let s3Title = lessonStorage.getItem("Adminerva_sig3Title") ||
    lessonStorage.getItem("lessonReview_sig3Title") || "";
  let s4Name = lessonStorage.getItem("Adminerva_sig4Name") ||
    lessonStorage.getItem("lessonReview_sig4Name") || "";
  let s4Title = lessonStorage.getItem("Adminerva_sig4Title") ||
    lessonStorage.getItem("lessonReview_sig4Title") || "";

  if (window.db) {
    try {
      const docSnap = await getDoc(
        ownedDoc(window.db,"preferences","lesson_review_config"),
      );
      if (docSnap.exists()) {
        const data = docSnap.data();
        headerImgUrl = data.header_image_base64 || headerImgUrl;
        rawSubject = data.subject_title || rawSubject;
        rawTeacher = data.teacher_name || rawTeacher;
        s1Name = data.sig_teacher || s1Name;
        s1Title = data.sig_teacher_title || s1Title;
        s2Name = data.sig_subject_coord || s2Name;
        s2Title = data.sig_subject_coord_title || s2Title;
        s3Name = data.sig_grade_coord || s3Name;
        s3Title = data.sig_grade_coord_title || s3Title;
        s4Name = data.sig_principal || s4Name;
        s4Title = data.sig_principal_title || s4Title;

        lessonStorage.setItem("lessonReview_headerImage", headerImgUrl);
        lessonStorage.setItem("lessonReview_defaultSubject", rawSubject);
        lessonStorage.setItem("lessonReview_defaultTeacher", rawTeacher);
        lessonStorage.setItem("lessonReview_sig1Name", s1Name);
        lessonStorage.setItem("lessonReview_sig1Title", s1Title);
        lessonStorage.setItem("lessonReview_sig2Name", s2Name);
        lessonStorage.setItem("lessonReview_sig2Title", s2Title);
        lessonStorage.setItem("lessonReview_sig3Name", s3Name);
        lessonStorage.setItem("lessonReview_sig3Title", s3Title);
        lessonStorage.setItem("lessonReview_sig4Name", s4Name);
        lessonStorage.setItem("lessonReview_sig4Title", s4Title);
      }
    } catch (e) {
      console.warn("Firestore fetch failed, using local defaults.", e);
    }
  }

  const saved=window.currentLessonSettings||{};
  rawSubject=saved.subject_title||(window.currentPlanSubject||rawSubject);
  rawTeacher=saved.teacher_name||(window.currentPlanTeacher||rawTeacher);
  s1Name=saved.sig_teacher??s1Name;s1Title=saved.sig_teacher_title??s1Title;
  s2Name=saved.sig_subject_coord??s2Name;s2Title=saved.sig_subject_coord_title??s2Title;
  s3Name=saved.sig_grade_coord??s3Name;s3Title=saved.sig_grade_coord_title??s3Title;
  s4Name=saved.sig_principal??s4Name;s4Title=saved.sig_principal_title??s4Title;

  const headerImgEl = document.getElementById("printHeaderImage");
  const headerContainer = document.getElementById("printHeaderBannerContainer");
  if (headerImgUrl && headerImgEl) {
    headerImgEl.src = headerImgUrl;
    headerImgEl.classList.remove("hidden");
    headerImgEl.style.display = "block";
    headerImgEl.style.margin = "0 auto";
    if (headerContainer) headerContainer.classList.remove("hidden");
  } else if (headerImgEl) {
    headerImgEl.removeAttribute("src");
    headerImgEl.classList.add("hidden");
    if (headerContainer) headerContainer.classList.add("hidden");
  }

  const rawSY = document.getElementById("lpSchoolYear").value || "2026-2027";
  document.getElementById("printMainTitle").textContent =
    `CURRICULUM MAP / LEARNING PLAN IN ${rawSubject.toUpperCase()}`;
  document.getElementById("printSYHeader").textContent = `SCHOOL YEAR ${rawSY}`;
  const contextLine = document.getElementById("printContextLine");
  if (contextLine) contextLine.textContent = [
    document.getElementById("lpGradeLevel")?.value,
    document.getElementById("lpProgram")?.value,
    rawTeacher,
  ].filter(Boolean).join(" · ");

  const termStr = document.getElementById("lpAcademicTerm").value;
  const [semStr, qtrStr] = termStr.split("/");
  document.getElementById("printSemester").textContent = semStr;
  document.getElementById("printQuarter").textContent = qtrStr;

  const courseWeek = document.getElementById("lpCourseWeek").value;
  const dateRange = document.getElementById("lpDateRange").value;
  document.getElementById("printScopeHeader").textContent =
    `${courseWeek}: ${dateRange}`;

  document.getElementById("printSig1Name").textContent = s1Name;
  document.getElementById("printSig1Title").textContent = s1Title;
  document.getElementById("printSig2Name").textContent = s2Name;
  document.getElementById("printSig2Title").textContent = s2Title;
  document.getElementById("printSig3Name").textContent = s3Name;
  document.getElementById("printSig3Title").textContent = s3Title;
  document.getElementById("printSig4Name").textContent = s4Name;
  document.getElementById("printSig4Title").textContent = s4Title;

  const tbody = document.getElementById("printTableBody");
  tbody.innerHTML = "";

  window.currentPlan.forEach((session, index) => {
    const isFlex = String(session.session_name||"").toLowerCase().includes("flex");
    const isLab = String(session.session_name||"").includes("4-6");
    const taxonomyScrubber =
      /\s*[\(\[]?(?:Cognitive|Psychomotor|Affective)[\)\]]?\.?/gi;

    const compText = isFlex
      ? ""
      : linesForPrint(competencySentenceCase((session.competencies || "").replace(taxonomyScrubber, "")));

    const objText = isFlex
      ? ""
      : window.formatListForPrint(
          (session.objectives || "N/A").replace(taxonomyScrubber, ""),
          true,
        );

    const matText = window.formatListForPrint(
      window.currentWeeklyOverview.materials || "",
      false,
    );

    const prelimText = window.formatListForPrint(
      session.preliminary || "",
      true,
    );

    const activitiesText = window.formatListForPrint(
      session.learning_activities || "",
      true,
    );
    const cleanRemarks = escapePrintText(session.remarks || "")
      .replace(/\s*\|\s*/g, "<br>")
      .replace(/;/g, "<br>")
      .replace(/\\n|\n/g, "<br>");

    let parts = [];
    parts.push({
      time: "",
      content: `<div style="font-weight: bold;">${escapePrintText(session.session_name)}</div>`,
    });

    if (isFlex) {
      parts.push({
        time: "",
        content: `<strong>Learning Activities:</strong><br><div style="padding-left: 8px;">${activitiesText}</div>`,
      });
    } else {
      parts.push({
        time: isLab ? "10 mins" : "5 mins",
        content: `<strong>Preliminary Activities:</strong><br><div style="padding-left: 8px;">${prelimText}</div>`,
      });
      parts.push({
        time: isLab ? "10 mins" : "5 mins",
        content: `<strong>Motivation / Recall:</strong><br><div style="padding-left: 8px; white-space: pre-wrap;">${linesForPrint(session.motivation)}</div>`,
      });
      parts.push({
        time: isLab ? "110 mins" : "26 mins",
        content: `<strong>Learning Activities:</strong><br><div style="padding-left: 8px;">${activitiesText}</div>`,
      });
      parts.push({
        time: isLab ? "15 mins" : "10 mins",
        content: `<strong>Evaluation:</strong><br><div style="padding-left: 8px; white-space: pre-wrap;">${linesForPrint(session.evaluation)}</div>`,
      });

      if (session.closing) {
        parts.push({
          time: isLab ? "5 mins" : "4 mins",
          content: `<strong>Closing Activities:</strong><br><div style="padding-left: 8px; white-space: pre-wrap;">${linesForPrint(session.closing)}</div>`,
        });
      }
      if (session.values_integration) {
        parts.push({
          time: "",
          content: `<strong>Values Integration:</strong><br><div style="padding-left: 8px; white-space: pre-wrap;">${linesForPrint(session.values_integration)}</div>`,
        });
      }
    }

    const rowCount = parts.length;

    parts.forEach((part, pIndex) => {
      const tr = document.createElement("tr");
      let rowHtml = "";

      const isFirst = pIndex === 0;
      const isLast = pIndex === rowCount - 1;

      let timeStyle =
        "text-align: center; font-weight: bold; vertical-align: top; font-size: 10pt; padding: 6px;";
      let contentStyle = "vertical-align: top; font-size: 10pt; padding: 6px;";

      if (pIndex === 0) {
        if (isFlex) {
          // 🚀 FIX: Blank out Topic, Standards, Objectives, and Materials for Flex
          rowHtml += `<td rowspan="${rowCount}"></td>`; // 1. Blank Topic
          rowHtml += `<td rowspan="${rowCount}"></td>`; // 2. Blank Standards
          rowHtml += `<td rowspan="${rowCount}"></td>`; // 3. Blank Objectives
          rowHtml += `<td style="${timeStyle}">${part.time}</td>`; // 4. Time
          rowHtml += `<td style="${contentStyle}">${part.content}</td>`; // 5. Activities
          rowHtml += `<td rowspan="${rowCount}"></td>`; // 6. Blank Materials
        } else {
          // 🚀 FIX: Restored the missing Content/Topic column!
          rowHtml += `<td rowspan="${rowCount}" style="font-weight: bold; text-align: center; vertical-align: middle;">
                        ${linesForPrint(session.topic || window.currentWeeklyOverview.topic)}
                      </td>`;
          rowHtml += `<td rowspan="${rowCount}" style="vertical-align: top;">
                        <strong>Content Standard:</strong><br>${linesForPrint(window.currentWeeklyOverview.content_standard)}<br><br>
                        <strong>Performance Standard:</strong><br>${linesForPrint(window.currentWeeklyOverview.performance_standard)}<br><br>
                        <strong>Formation Standard:</strong><br>${linesForPrint(session.formation_standard || "N/A")}
                      </td>`;
          rowHtml += `<td rowspan="${rowCount}" style="vertical-align: top;">
                        <strong>The learners should be able to...</strong><br>${compText}<br><br>
                        <strong>Objectives:</strong><br>${objText}
                      </td>`;
          rowHtml += `<td style="${timeStyle}">${part.time}</td>`;
          rowHtml += `<td style="${contentStyle}">${part.content}</td>`;
          rowHtml += `<td rowspan="${rowCount}" style="vertical-align: top;">${matText}</td>`;
        }

        // Remarks are kept for both normal and Flex sessions to maintain schedule visibility
        rowHtml += `<td rowspan="${rowCount}" style="vertical-align: top;">${cleanRemarks}</td>`;
      } else {
        rowHtml += `<td style="${timeStyle}">${part.time}</td>`;
        rowHtml += `<td style="${contentStyle}">${part.content}</td>`;
      }

      tr.innerHTML = rowHtml;
      tbody.appendChild(tr);
    });
  });

  return true;
};

window.exportPDF = () => printLesson();
window.saveAndPrint = () => printLesson({ saveFirst: true });

window.exportToGoogleDocs = function () {
  if (!window.currentPlan?.length || !window.currentWeeklyOverview)
    return alert("Generate or load a lesson plan before exporting.");
  exportLessonToGoogleDocs({
    accountUid: workspaceUid,
    assertAccount: assertWorkspaceAccount,
    loginHint: () => window.auth?.currentUser?.email || "",
    prepare: async (uid) => {
      const ready = await window.buildDocumentLayout();
      assertWorkspaceAccount(uid);
      if (!ready) throw Error("The lesson could not be prepared for export.");
      const grade = String(window.currentTargetGrade || "11").replace(/\D/g, "") || "11";
      const subject = window.currentLessonSettings?.subject_title || window.currentPlanSubject ||
        lessonStorage.getItem("lessonReview_defaultSubject") || "Subject";
      const shortSubject = String(subject).split(/\s+/).map(word => /\d/.test(word) ? word : word.slice(0, 4)).join("").replace(/[^a-zA-Z0-9]/g, "") || "Subject";
      const term = document.getElementById("lpAcademicTerm")?.value || "";
      const semester = term.includes("SECOND SEMESTER") ? "2" : "1";
      const quarter = term.includes("FOURTH QUARTER") ? "4" : term.includes("THIRD QUARTER") ? "3" : term.includes("SECOND QUARTER") ? "2" : "1";
      const week = (document.getElementById("lpCourseWeek")?.value || "").replace(/\D/g, "") || "1";
      const filename = `${grade}-Sem${semester},Qtr${quarter},W${week}(${shortSubject})`;
      return buildGoogleDocsSource(document.getElementById("printDocumentWrapper"), filename);
    },
  });
};
