import {
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
const escapePrintText=value=>String(value??"").replace(/[&<>"']/g,c=>({
"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
})[c]);
const linesForPrint=value=>escapePrintText(value).replace(/\\n|\n/g,"<br>");
const GOOGLE_CLIENT_ID =
  "396238862950-ctpihosaaetvf7agaftbucupbkot4n7r.apps.googleusercontent.com";

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

  let headerImgUrl = localStorage.getItem("lessonReview_headerImage") || "";
  let rawSubject =
    localStorage.getItem("lessonReview_defaultSubject") || "SUBJECT";
  let rawTeacher =
    localStorage.getItem("lessonReview_defaultTeacher") || "TEACHER";

  let s1Name = localStorage.getItem("lessonReview_sig1Name") || rawTeacher;
  let s1Title =
    localStorage.getItem("lessonReview_sig1Title") || "Subject Teacher";
  let s2Name = localStorage.getItem("lessonReview_sig2Name") || "";
  let s2Title = localStorage.getItem("lessonReview_sig2Title") || "";
  let s3Name = localStorage.getItem("lessonReview_sig3Name") || "";
  let s3Title = localStorage.getItem("lessonReview_sig3Title") || "";
  let s4Name = localStorage.getItem("lessonReview_sig4Name") || "";
  let s4Title = localStorage.getItem("lessonReview_sig4Title") || "";

  if (window.db) {
    try {
      const docSnap = await getDoc(
        doc(window.db, "global_settings", "lesson_review_config"),
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

        localStorage.setItem("lessonReview_headerImage", headerImgUrl);
        localStorage.setItem("lessonReview_defaultSubject", rawSubject);
        localStorage.setItem("lessonReview_defaultTeacher", rawTeacher);
        localStorage.setItem("lessonReview_sig1Name", s1Name);
        localStorage.setItem("lessonReview_sig1Title", s1Title);
        localStorage.setItem("lessonReview_sig2Name", s2Name);
        localStorage.setItem("lessonReview_sig2Title", s2Title);
        localStorage.setItem("lessonReview_sig3Name", s3Name);
        localStorage.setItem("lessonReview_sig3Title", s3Title);
        localStorage.setItem("lessonReview_sig4Name", s4Name);
        localStorage.setItem("lessonReview_sig4Title", s4Title);
      }
    } catch (e) {
      console.warn("Firestore fetch failed, using local defaults.", e);
    }
  }

  const headerImgEl = document.getElementById("printHeaderImage");
  const headerContainer = document.getElementById("printHeaderBannerContainer");
  if (headerImgUrl && headerImgEl) {
    headerImgEl.src = headerImgUrl;
    headerImgEl.classList.remove("hidden");
    headerImgEl.style.display = "block";
    headerImgEl.style.margin = "0 auto";
    if (headerContainer) headerContainer.classList.remove("hidden");
  }

  const rawSY = document.getElementById("lpSchoolYear").value || "2026-2027";
  document.getElementById("printMainTitle").textContent =
    `CURRICULUM MAP / LEARNING PLAN IN ${rawSubject.toUpperCase()}`;
  document.getElementById("printSYHeader").textContent = `SCHOOL YEAR ${rawSY}`;

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
      : linesForPrint((session.competencies || "").replace(taxonomyScrubber, ""));

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

      if (!isFirst) {
        timeStyle += " border-top: none !important;";
        contentStyle += " border-top: none !important;";
      }
      if (!isLast) {
        timeStyle += " border-bottom: none !important;";
        contentStyle += " border-bottom: none !important;";
      }

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

window.exportPDF = async function () {
  const isReady = await window.buildDocumentLayout();
  if (isReady) {
    setTimeout(() => {
      window.print();
    }, 300);
  }
};

window.saveAndPrint = async function () {
  const isSaved = await window.saveLessonPlan();
  const isReady = await window.buildDocumentLayout();
  if (isSaved && isReady) {
    setTimeout(() => {
      window.print();
    }, 300);
  }
};

window.exportToGoogleDocs = function () {
  if (typeof htmlDocx === "undefined")
    return alert("The Document generator is still loading. Please wait.");
  if (typeof google === "undefined")
    return alert("Google scripts failed to load. Please refresh the page.");

  const tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope:
      "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/documents",
    callback: async (tokenResponse) => {
      if (tokenResponse.error !== undefined)
        return alert("Google Authentication failed.");
      if (typeof window.showSubtleLoader === "function") {
        window.showSubtleLoader("Exporting and formatting Google Doc...");
      }

      const isReady = await window.buildDocumentLayout();
      if (!isReady) {
        if (typeof window.hideSubtleLoader === "function") {
          window.hideSubtleLoader();
        }
        return;
      }

      await processAndUploadToDrive(tokenResponse.access_token);
    },
  });
  tokenClient.requestAccessToken();
};

async function processAndUploadToDrive(accessToken) {
  const rawGrade = window.currentTargetGrade.replace(/\D/g, "") || "11";
  const rawSubject =
    localStorage.getItem("lessonReview_defaultSubject") || "Subject";
  const shortSubject = rawSubject
    .split(/\s+/)
    .map((w) => (w.match(/\d+/) ? w : w.substring(0, 4)))
    .join("")
    .replace(/[^a-zA-Z0-9]/g, "");

  const term = document.getElementById("lpAcademicTerm").value;
  const semNum = term.includes("SECOND SEMESTER") ? "2" : "1";
  let qtrNum = "1";
  if (term.includes("SECOND QUARTER")) qtrNum = "2";
  if (term.includes("THIRD QUARTER")) qtrNum = "3";
  if (term.includes("FOURTH QUARTER")) qtrNum = "4";

  const anchoredWeek = document
    .getElementById("lpCourseWeek")
    .value.replace(/\D/g, "");
  const filename = `${rawGrade}-Sem${semNum},Qtr${qtrNum},W${anchoredWeek}(${shortSubject})`;

  const printWrapper = document.getElementById("printDocumentWrapper");
  let cleanHtml = printWrapper.innerHTML;
  cleanHtml = cleanHtml.replace(/>\s+</g, "><");
  cleanHtml = cleanHtml.replace(/(<\/div>|<img[^>]+>)\s*<br\s*\/?>/gi, "$1");
  cleanHtml = cleanHtml.replace(
    /<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi,
    '<div style="font-weight: bold; text-align: center; margin: 0; padding: 0; font-size: 14pt;">$1</div>',
  );
  cleanHtml = cleanHtml.replace(
    /<img /gi,
    '<img height="80" style="margin: 0 auto; display: block;" ',
  );
  cleanHtml = cleanHtml.replace(/<th\b/gi, "<td").replace(/<\/th>/gi, "</td>");
  cleanHtml = cleanHtml.replace(/#b4c6e7;/gi, "#b4c6e7; font-weight: bold;");

  const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                /* 🚀 FIX: Force zero margins on the body and all blocks */
                body, div, p { margin: 0; padding: 0; font-family: 'Arial Narrow', Arial, sans-serif; font-size: 10pt; color: #333; }
                table { border-collapse: collapse; margin-top: 10px; width: 100%; }
                td { border: 1px solid #000; padding: 6px 8px; font-size: 10pt; vertical-align: top; }
            </style>
        </head>
        <body>
            ${cleanHtml}
        </body> 
        </html>
    `;

  const metadata = {
    name: filename,
    mimeType: "application/vnd.google-apps.document",
  };

  const boundary = "-------314159265358979323846";
  const delimiter = "\r\n--" + boundary + "\r\n";
  const close_delim = "\r\n--" + boundary + "--";

  const multipartBody =
    delimiter +
    "Content-Type: application/json\r\n\r\n" +
    JSON.stringify(metadata) +
    delimiter +
    "Content-Type: text/html\r\n\r\n" +
    htmlContent +
    close_delim;

  try {
    const response = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body: multipartBody,
      },
    );

    if (!response.ok) throw new Error(`Upload failed: ${response.statusText}`);

    const result = await response.json();
    const docId = result.id;
    if(!docId)throw Error("Google Drive did not return a document ID.");

    const docResponse = await fetch(
      `https://docs.googleapis.com/v1/documents/${docId}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if(!docResponse.ok)throw Error("Could not inspect the generated Google Doc: HTTP "+docResponse.status);
    const docData = await docResponse.json();
    if(!Array.isArray(docData?.body?.content))throw Error("Google Docs returned an unexpected document structure.");

    const tables = [];
    for (const element of docData.body.content) {
      if (element.table) {
        tables.push(element.startIndex);
      }
    }

    const requests = [
      {
        updateDocumentStyle: {
          documentStyle: {
            pageSize: {
              width: { magnitude: 936, unit: "PT" },
              height: { magnitude: 612, unit: "PT" },
            },
            marginTop: { magnitude: 36, unit: "PT" },
            marginBottom: { magnitude: 36, unit: "PT" },
            marginLeft: { magnitude: 36, unit: "PT" },
            marginRight: { magnitude: 36, unit: "PT" },
          },
          fields: "pageSize,marginTop,marginBottom,marginLeft,marginRight",
        },
      },
    ];

    if (tables.length > 0) {
      // 🚀 FIX: Reduced Materials & Remarks from 121 to 90. Added the saved width to Activities (276 -> 338).
      const mainWidths = [69, 121, 121, 35, 338, 90, 90];
      mainWidths.forEach((width, index) => {
        requests.push({
          updateTableColumnProperties: {
            tableStartLocation: { index: tables[0] },
            columnIndices: [index],
            tableColumnProperties: {
              widthType: "FIXED_WIDTH",
              width: { magnitude: width, unit: "PT" },
            },
            fields: "width,widthType",
          },
        });
      });
    }

    if (tables.length > 1) {
      const sigWidths = [216, 216, 216, 216];
      sigWidths.forEach((width, index) => {
        requests.push({
          updateTableColumnProperties: {
            tableStartLocation: { index: tables[1] },
            columnIndices: [index],
            tableColumnProperties: {
              widthType: "FIXED_WIDTH",
              width: { magnitude: width, unit: "PT" },
            },
            fields: "width,widthType",
          },
        });
      });
    }

    if(tables.length<2)throw Error("The generated Google Doc is missing its curriculum or signature table. Check the export manually before submitting.");
    const formattingResponse=await fetch(
      `https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ requests }),
      },
    );
    if(!formattingResponse.ok)
      throw Error("Google Docs formatting was rejected (HTTP "+formattingResponse.status+"). Check the document before submitting.");

    if (typeof window.hideLoader === "function") window.hideLoader();
    window.open(`https://docs.google.com/document/d/${docId}/edit`, "_blank");
  } catch (e) {
    if (typeof window.hideLoader === "function") window.hideLoader();
    alert("Failed to export to Google Docs: " + e.message);
  }
}
