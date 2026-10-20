import {ownedDoc,ownedCollection,lessonStorage,workspaceUid,assertWorkspaceAccount,workspaceOnReady,requireStaffWorkspace} from "./workspace-session.mjs?v=2026.10.20.1";
/** Saved lesson records, version handling and lesson loading. */
// Import centralized database instead of initializing locally
import { db } from "../core/firebase-core.js";
import {personalPlanId,requireCurrentVersion} from "./workspace-model.mjs?v=2026.10.20.1";
import {scheduleScope,localScheduleText,normalizeSchoolYear} from "./schedule-scope.mjs?v=2026.10.20.1";
import {
  collection,
  getDocs,
  deleteDoc,
  doc,
  setDoc,
  getDoc,
  runTransaction,
  serverTimestamp,
  query,
  orderBy,
  limit,
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

// Resolve the timetable for the selected lesson school year and semester.
window.fetchScheduleForLesson = async function (schoolYear, academicTerm) {
  const scope = scheduleScope(schoolYear, academicTerm);
  const local = () => localScheduleText(localStorage, schoolYear, academicTerm);
  // A failed cloud save must not silently replace recent edits on this device.
  if (lessonStorage.getItem(scope.pendingKey) === "1") return local();
  try {
    const selected = await getDoc(ownedDoc(db,"schedules",scope.id));
    if (selected.exists()) {
      const text = String(selected.data().raw_text || "");
      lessonStorage.setItem(scope.textKey, text);
      return text;
    }
    if (lessonStorage.getItem(scope.textKey) !== null) return local();
  } catch (error) {
    console.warn("Could not load semester schedule from cloud; checking device cache:", error);
  }
  return local();
};

window.initFirebase = function () {
  if (window.loadLibraryFolders) {
    window.loadLibraryFolders();
  }
};
workspaceOnReady(async()=>{
  const legacyId=new URLSearchParams(location.search).get("legacyPlan");
  if(!legacyId)return;
  if(!confirm("Open this older shared lesson for inspection? Saving creates your own separate copy; the shared record remains unchanged."))return;
  try{
    const uid=await requireStaffWorkspace();
    const snapshot=await getDoc(doc(db,"lesson_plans",legacyId));
    assertWorkspaceAccount(uid);
    if(!snapshot.exists())throw Error("The older lesson no longer exists.");
    window.loadSpecificPlan({...snapshot.data(),id:snapshot.id});
    window.loadedPersonalPlan=null;window.legacySourcePlanId=legacyId;
    alert("Older shared lesson loaded. Ownership is unverified. Inspect it before saving a separate personal copy.");
  }catch(error){alert("Could not open the legacy lesson: "+error.message);}
});

window.loadLibraryFolders = async function () {
  const container = document.getElementById("libraryFolderContainer");
  if (!container) return;

  container.innerHTML =
    '<div class="text-xs text-gray-500 italic">Fetching folders from cloud...</div>';

  try {
    const snap = await getDocs(collection(db, "reference_folders"));
    const libraryData = [];
    snap.forEach((d) => libraryData.push({ id: d.id, ...d.data() }));

    lessonStorage.setItem("Adminerva_library", JSON.stringify(libraryData));

    container.innerHTML = "";
    if (libraryData.length === 0) {
      container.innerHTML =
        '<div class="text-xs text-gray-500 italic">No folders found in Firebase.</div>';
      return;
    }

    libraryData.forEach((folder) => {
      const docCount=(folder.documents?.length||0)+(folder.documentCount||0);
      const safeId = escapeHTML(folder.id);
      const safeName = escapeHTML(folder.name);

      container.insertAdjacentHTML(
        "beforeend",
        `
                <label class="flex items-center gap-2 cursor-pointer group">
                    <input type="checkbox" value="${safeId}" class="folder-checkbox w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 bg-white">
                    <span class="text-sm font-bold text-blue-900 group-hover:text-blue-700 transition">📁 ${safeName} <span class="text-[10px] text-gray-500 font-normal">(${docCount} docs)</span></span>
                </label>
            `,
      );
    });
  } catch (e) {
    container.innerHTML = `<div class="text-xs text-red-500 italic">Failed to load library: ${escapeHTML(e.message)}</div>`;
  }
};

// Read only the teacher-selected reference folders. Existing documents remain
// in their legacy arrays; new PDFs are stored in child documents.
window.fetchReferenceDocuments=async function(folderId){
  const root=await getDoc(doc(db,"reference_folders",folderId));
  if(!root.exists())throw Error("Selected reference folder no longer exists.");
  const legacy=Array.isArray(root.data().documents)?root.data().documents:[];
  const nested=await getDocs(collection(db,"reference_folders",folderId,"documents"));
  return [...legacy,...nested.docs.map(record=>record.data())];
};

window.fetchPreviousPlan = async function (
  grade,
  subject,
  academicTerm,
  currentCourseWeek,
  schoolYear,
) {
  if (!db) return null;

  const currentWeekNum = parseInt(currentCourseWeek.replace(/\D/g, ""));
  if (currentWeekNum <= 1) return null;

  const prevWeekStr = `Week ${currentWeekNum - 1}`;
  // New school-year key first, then a compatible legacy key.
  const options={grade,subject,term:academicTerm,week:prevWeekStr,schoolYear};
  for(const id of [personalPlanId(options)]){
    try{
      const result=await getDoc(ownedDoc(db,"lesson_plans",id));
      if(result.exists()&&result.data().school_year===schoolYear)return result.data();
    }catch(error){console.warn("Previous lesson lookup failed:",error);}
  }
  return null;
};

window.saveLessonPlan = async function () {
  let ownerUid;
  try{ownerUid=await requireStaffWorkspace();}catch(error){alert(error.message);return false;}
  if (typeof window.syncOutputToData === "function") {
    window.syncOutputToData();
  }

  if (
    !window.currentPlan ||
    window.currentPlan.length === 0 ||
    !window.currentWeeklyOverview
  ) {
    alert("Please generate a lesson plan first before saving.");
    return false;
  }
  if (!db) {
    alert("Firebase is not connected! Please configure it in Global Settings.");
    return false;
  }

  // A loaded lesson keeps its original identity even if global defaults
  // were changed for a different subject or a new semester.
  const subject = window.currentPlanSubject ||
    lessonStorage.getItem("Adminerva_defaultSubject") || "Subject";
  const teacher = window.currentPlanTeacher ||
    lessonStorage.getItem("Adminerva_defaultTeacher") || "Unassigned";
  const grade = window.currentTargetGrade || "Grade";

  const academicTerm = document.getElementById("lpAcademicTerm").value;
  const courseWeek = document.getElementById("lpCourseWeek").value;
  const dateRange = document.getElementById("lpDateRange").value;

  let schoolYear, safeDocId;
  try {
    schoolYear = normalizeSchoolYear(document.getElementById("lpSchoolYear").value);
    safeDocId = personalPlanId({
      grade, subject, term: academicTerm, week: courseWeek, schoolYear
    });
  } catch (error) {
    alert("Cannot save lesson plan: " + error.message);
    return false;
  }

  if (typeof window.showSubtleLoader === "function") {
    window.showSubtleLoader("Syncing lesson plan securely to Firebase...");
  }

  try {
    const planData = {
      ownerUid,
      ...(window.legacySourcePlanId ? {source_legacy_plan:window.legacySourcePlanId} : {}),
      teacher_name: teacher,
      subject_title: subject,
      school_year: document.getElementById("lpSchoolYear").value,
      academic_term: academicTerm,
      course_week: courseWeek,
      date_range: dateRange,
      grade_level: grade,
      custom_instructions: document
        .getElementById("lpCustomInstructions")
        .value.trim(),
      schedule: await window.fetchScheduleForLesson(schoolYear, academicTerm),
      reference_folders: Array.from(
        document.querySelectorAll(".folder-checkbox:checked"),
      ).map((cb) => cb.value),
      weekly_overview: window.currentWeeklyOverview,
      sessions: window.currentPlan,
      timestamp: new Date().toISOString(), // This is the key we use to find recent plans
    };

    const currentRef=ownedDoc(db,"lesson_plans",safeDocId);
    const action=await runTransaction(db,async tx=>{
      const prior=await tx.get(currentRef);
      const existing=prior.exists()?prior.data():null;
      assertWorkspaceAccount(ownerUid);
      const expected=window.loadedPersonalPlan?.id===safeDocId ? window.loadedPersonalPlan.version : 0;
      const version=requireCurrentVersion(existing,expected);
      if(existing){
        const same=Object.entries(planData).every(([key,value])=>
          key==="timestamp" || JSON.stringify(value)===JSON.stringify(existing[key])
        );
        if(same)return "unchanged";
        tx.set(ownedDoc(db,"lesson_plans",safeDocId,"revisions",String(existing.version)),{...existing,archivedRevisionAt:serverTimestamp()});
      }
      tx.set(currentRef,{...planData,version});
      window.pendingPersonalPlanVersion=version;
      return "saved";
    });
    if(action==="saved")window.loadedPersonalPlan={id:safeDocId,version:window.pendingPersonalPlanVersion};
    alert(action==="unchanged"?"No changes since the last save.":"Lesson plan saved. The previous version is retained.");
    return true;
  } catch (e) {
    console.error("Error saving plan:", e);
    alert("Failed to save to database: " + e.message);
    return false;
  } finally {
    if (typeof window.hideSubtleLoader === "function")
      window.hideSubtleLoader();
  }
};

window.openLoadPlanModal = async function () {
  const modal = document.getElementById("loadPlanModal");
  if (!modal) return alert("Modal HTML is missing!");
  modal.classList.replace("hidden", "flex");

  const container = document.getElementById("savedPlansListContainer");
  container.innerHTML = `
        <div class="flex flex-col items-center justify-center py-12">
            <div class="animate-spin rounded-full h-10 w-10 border-t-4 border-b-4 border-blue-500 mb-4"></div>
            <p class="text-gray-500 font-medium">Fetching organized curriculum...</p>
        </div>
    `;

  if (!db) {
    container.innerHTML = `<div class="p-4 bg-red-50 text-red-600 rounded-lg text-center font-bold">Firebase is not connected!</div>`;
    return;
  }

  try {
    const querySnapshot = await getDocs(ownedCollection(db,"lesson_plans"));
    if (querySnapshot.empty) {
      container.innerHTML = `<div class="text-center py-12"><p class="text-gray-500 font-bold">No saved plans found.</p></div>`;
      return;
    }

    const allFetchedPlans = [];
    const uniqueSYs = new Set();

    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      if (data.is_archived) return;

      const sy = data.school_year || "2026-2027";
      uniqueSYs.add(sy);

      let safeTerm = data.academic_term || "";
      if (!safeTerm) {
        const sem = /2|second/i.test(data.semester || "")
          ? "SECOND SEMESTER"
          : "FIRST SEMESTER";
        let qtr = "FIRST QUARTER";
        if (/2|second/i.test(data.quarter || "")) qtr = "SECOND QUARTER";
        if (/3|third/i.test(data.quarter || "")) qtr = "THIRD QUARTER";
        if (/4|fourth/i.test(data.quarter || "")) qtr = "FOURTH QUARTER";
        safeTerm = `${sem}/${qtr}`;
      }

      let safeWeek = data.course_week || "";
      if (!safeWeek) safeWeek = `Week ${data.absoluteWeek || 1}`;

      allFetchedPlans.push({
        id: docSnap.id,
        ...data,
        safeSY: sy,
        safeTerm: safeTerm,
        safeWeek: safeWeek,
        safeDate: data.date_range || "No physical dates",
        subjectGrade: `${data.subject_title || "Subject"} — ${data.grade_level || "Grade"}`,
      });
    });

    const syFilter = document.getElementById("modalSyFilter");
    if (syFilter) {
      const mainUiSy =
        document.getElementById("lpSchoolYear")?.value || "2026-2027";
      const currentSelection = syFilter.value || mainUiSy;

      syFilter.innerHTML = "";
      Array.from(uniqueSYs)
        .sort()
        .reverse()
        .forEach((sy) => {
          const selected = sy === currentSelection ? "selected" : "";
          const safeSy = escapeHTML(sy);
          syFilter.insertAdjacentHTML(
            "beforeend",
            `<option value="${safeSy}" ${selected}>SY: ${safeSy}</option>`,
          );
        });
    }

    const activeSY = syFilter ? syFilter.value : "2026-2027";
    const allPlans = allFetchedPlans.filter((p) => p.safeSY === activeSY);
    container.innerHTML = "";

    if (allPlans.length === 0) {
      container.innerHTML = `<div class="text-center py-12"><p class="text-gray-500 font-bold">No plans found for School Year ${escapeHTML(activeSY)}.</p></div>`;
      return;
    }

    // 🚀 NEW: Find the absolute most recently saved plan based on timestamp
    let latestPlan = allPlans[0];
    allPlans.forEach((p) => {
      const currentTs = p.timestamp ? new Date(p.timestamp).getTime() : 0;
      const latestTs = latestPlan.timestamp
        ? new Date(latestPlan.timestamp).getTime()
        : 0;
      if (currentTs > latestTs) {
        latestPlan = p;
      }
    });
    const latestTerm = latestPlan ? latestPlan.safeTerm : null;
    const latestSubject = latestPlan ? latestPlan.subjectGrade : null;

    const groupedPlans = {};
    allPlans.forEach((plan) => {
      const term = plan.safeTerm;
      const subjectGrade = plan.subjectGrade;
      if (!groupedPlans[term]) groupedPlans[term] = {};
      if (!groupedPlans[term][subjectGrade])
        groupedPlans[term][subjectGrade] = [];
      groupedPlans[term][subjectGrade].push(plan);
    });

    Object.keys(groupedPlans)
      .sort()
      .forEach((term) => {
        // 🚀 ONLY OPEN the main term accordion if it holds the most recent plan
        const isTermOpen = term === latestTerm ? "open" : "";
        let subjectAccordionsHTML = "";

        Object.keys(groupedPlans[term])
          .sort()
          .forEach((subjectGrade) => {
            const plans = groupedPlans[term][subjectGrade];
            plans.sort((a, b) => {
              const weekA = parseInt((a.safeWeek || "0").replace(/\D/g, ""));
              const weekB = parseInt((b.safeWeek || "0").replace(/\D/g, ""));
              return weekA - weekB;
            });

            let rowsHTML = "";
            plans.forEach((data) => {
              let shortDate = data.safeDate;
              const monthMap = {
                January: "Jan",
                February: "Feb",
                March: "Mar",
                April: "Apr",
                August: "Aug",
                September: "Sep",
                October: "Oct",
                November: "Nov",
                December: "Dec",
              };
              Object.keys(monthMap).forEach((longMonth) => {
                shortDate = shortDate.replace(
                  new RegExp(longMonth, "gi"),
                  monthMap[longMonth],
                );
              });

              const safeWeekStr = escapeHTML(data.safeWeek);
              const safeDateStr = escapeHTML(shortDate);
              const safeId = escapeHTML(data.id);
              const safeDataObjStr = escapeHTML(JSON.stringify(data));

              // 🚀 UX BONUS: Highlight the exact row of the most recent plan slightly yellow
              const isLatestRow =
                data.id === latestPlan.id
                  ? "bg-amber-50/50 border-l-4 border-amber-400 hover:bg-amber-100"
                  : "hover:bg-blue-50";

              rowsHTML += `
                        <tr class="border-b border-gray-100 ${isLatestRow} transition">
                            <td class="px-4 py-3 font-bold text-blue-900 w-1/4">${safeWeekStr}</td>
                            <td class="px-4 py-3 text-xs text-gray-600 font-medium">🗓️ ${safeDateStr}</td>
                            <td class="px-4 py-3 text-right">
                                <div class="flex justify-end gap-2">
                                    <button onclick='loadSpecificPlan(${safeDataObjStr})' class="px-3 py-1.5 bg-blue-600 text-white font-bold text-[10px] rounded hover:bg-blue-700 shadow-sm transition">Load</button>
                                    <a href="presentation.html?plan=${escapeHTML(encodeURIComponent(data.id))}" class="px-3 py-1.5 border border-indigo-300 text-indigo-800 font-bold text-[10px] rounded">Open in Slide Editor</a>
                                    <button onclick="openLessonHistory('${safeId}')" class="px-2 py-1.5 bg-slate-100 text-slate-700 font-bold text-[10px] rounded hover:bg-slate-200" title="Previous saved versions">History</button>
                                     <button onclick="deleteLessonPlan('${safeId}')" class="px-2 py-1.5 bg-red-50 text-red-600 font-bold text-[10px] rounded hover:bg-red-100 transition" title="Delete">✖</button>
                                </div>
                            </td>
                        </tr>
                    `;
            });

            // 🚀 ONLY OPEN the sub-accordion if it holds the most recent plan
            const isSubjectOpen =
              term === latestTerm && subjectGrade === latestSubject
                ? "open"
                : "";

            subjectAccordionsHTML += `
                    <details class="group/sub border border-gray-200 rounded-md mb-3 overflow-hidden shadow-sm" ${isSubjectOpen}>
                        <summary class="flex justify-between items-center bg-gray-50 p-3 cursor-pointer select-none hover:bg-gray-100 transition">
                            <span class="font-bold text-sm text-gray-800">📘 ${escapeHTML(subjectGrade)}</span>
                            <span class="text-gray-400 group-open/sub:rotate-180 transition-transform">▼</span>
                        </summary>
                        <div class="bg-white"><table class="w-full text-left"><tbody>${rowsHTML}</tbody></table></div>
                    </details>
                `;
          });

        container.insertAdjacentHTML(
          "beforeend",
          `
                <details class="group/main mb-4 bg-white border border-blue-200 rounded-lg shadow-sm" ${isTermOpen}>
                    <summary class="flex justify-between items-center font-extrabold text-blue-900 uppercase tracking-widest cursor-pointer select-none p-4 bg-blue-50 hover:bg-blue-100 transition rounded-t-lg border-b border-blue-100">
                        <div class="flex items-center gap-2"><span class="text-lg">📁</span><span>${escapeHTML(term)}</span></div>
                        <span class="text-blue-500 group-open/main:rotate-180 transition-transform">▼</span>
                    </summary>
                    <div class="p-4 bg-white rounded-b-lg">${subjectAccordionsHTML}</div>
                </details>
            `,
        );
      });
  } catch (e) {
    container.innerHTML = `<div class="p-4 bg-red-50 text-red-600 rounded-lg border border-red-200">Error: ${escapeHTML(e.message)}</div>`;
  }
};

// Earlier school records remain immutable; loading history only edits the
// current local draft. Teachers must explicitly Save to restore it in Firestore.
window.openLessonHistory=async function(planId){
  let modal=document.getElementById("lessonHistoryModal");
  if(!modal){
    modal=document.createElement("div");
    modal.id="lessonHistoryModal";
    modal.className="fixed inset-0 z-[260] bg-slate-950/80 p-3 flex items-center justify-center";
    modal.setAttribute("role","dialog");modal.setAttribute("aria-modal","true");
    const panel=document.createElement("div");
    panel.className="bg-white rounded-xl max-w-lg w-full p-5 max-h-[85dvh] overflow-y-auto";
    const header=document.createElement("div");
    header.className="flex justify-between items-center mb-4";
    const title=document.createElement("h2");
    title.textContent="Lesson plan versions";title.className="font-bold text-slate-900 text-lg";
    const close=document.createElement("button");
    close.textContent="Close";close.className="px-3 py-2 rounded bg-slate-200 text-slate-900";
    close.addEventListener("click",()=>modal.classList.add("hidden"));
    header.append(title,close);
    const list=document.createElement("div");list.id="lessonHistoryList";list.className="space-y-2";
    panel.append(header,list);modal.append(panel);document.body.append(modal);
  }
  modal.classList.remove("hidden");
  const list=modal.querySelector("#lessonHistoryList");
  list.textContent="Loading previous versions…";
  try{
    const records=await getDocs(query(ownedCollection(db,"lesson_plans",planId,"revisions"),
      orderBy("archivedRevisionAt","desc"),limit(15)));
    list.replaceChildren();
    if(records.empty)list.textContent="No prior versions have been saved for this plan.";
    records.forEach(record=>{
      const original=record.data();
      const row=document.createElement("div");
      row.className="p-3 rounded-lg border flex gap-2 items-center justify-between";
      const label=document.createElement("span");
      label.className="text-sm text-slate-800";
      label.textContent="Version "+String(original.version||"legacy")+" · "+String(original.timestamp||"Unknown time");
      const restore=document.createElement("button");
      restore.className="bg-blue-600 text-white px-3 py-2 font-semibold rounded-lg text-xs";
      restore.textContent="Load draft";
      restore.addEventListener("click",()=>{
        if(!confirm("Load this earlier lesson into the editor? Save explicitly to restore it."))return;
        window.loadSpecificPlan?.(original);modal.classList.add("hidden");
      });
      row.append(label,restore);list.append(row);
    });
  }catch(error){list.textContent="Could not retrieve lesson history: "+error.message;}
};

window.deleteLessonPlan = async function (docId) {
  if (
    !confirm(
      "Move this lesson plan to the Archive? It stays recoverable until manually deleted.",
    )
  )
    return;

  if (typeof window.showSubtleLoader === "function") {
    window.showSubtleLoader("Archiving lesson plan to the Recycle Bin...");
  }

  try {
    const purgeDate = new Date(
      Date.now() + 14 * 24 * 60 * 60 * 1000,
    ).toISOString();

    await setDoc(
      ownedDoc(db,"lesson_plans", docId),
      {
        is_archived: true,
        archived_at: new Date().toISOString(),
        purge_at: purgeDate,
      },
      { merge: true },
    );

    window.openLoadPlanModal();
  } catch (e) {
    alert("Failed to archive plan: " + e.message);
  } finally {
    if (typeof window.hideSubtleLoader === "function")
      window.hideSubtleLoader();
  }
};

// ==========================================
// ARCHIVE MANAGER
// ==========================================
window.openArchiveManager = async function () {
  if (!db) return alert("Firebase is not connected.");

  let modal = document.getElementById("archiveModal");
  if (!modal) {
    document.body.insertAdjacentHTML(
      "beforeend",
      `
            <div id="archiveModal" class="fixed inset-0 bg-gray-900/90 z-[200] flex items-center justify-center p-4 backdrop-blur-sm">
                <div class="bg-white rounded-xl shadow-2xl max-w-3xl w-full p-6 relative flex flex-col max-h-[85vh]">
                    <button onclick="document.getElementById('archiveModal').classList.add('hidden')" class="absolute top-4 right-4 text-gray-400 hover:text-red-500 text-xl font-bold">✖</button>
                    <h3 class="text-xl font-black text-blue-900 mb-2 flex items-center gap-2"><span>🗑️</span> Cloud Recycle Bin</h3>
                    <p class="text-sm text-gray-500 mb-4 border-b pb-4">Archived files remain recoverable until permanently deleted by a teacher.</p>
                    
                    <div id="archiveListContainer" class="flex-1 overflow-y-auto space-y-3 pr-2">
                        <p class="text-gray-400 italic text-center py-8">Scanning for archived files...</p>
                    </div>
                </div>
            </div>
        `,
    );
    modal = document.getElementById("archiveModal");
  } else {
    modal.classList.remove("hidden");
  }

  const container = document.getElementById("archiveListContainer");
  container.innerHTML = `<div class="animate-pulse flex space-x-4"><div class="flex-1 space-y-4 py-1"><div class="h-4 bg-gray-200 rounded w-3/4"></div></div></div>`;

  try {
    const { collection, getDocs } =
      await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js");
    const [plansSnap, presSnap] = await Promise.all([
      getDocs(ownedCollection(db,"lesson_plans")),
      getDocs(ownedCollection(db,"presentations")),
    ]);

    let archivedItems = [];
    const now = Date.now();

    plansSnap.forEach((doc) => {
      const d = doc.data();
      if (d.is_archived)
        archivedItems.push({
          collection: "lesson_plans",
          id: doc.id,
          title: `Lesson Plan: ${d.grade_level} - ${d.subject_title}`,
          ...d,
        });
    });

    presSnap.forEach((doc) => {
      const d = doc.data();
      if (d.is_archived)
        archivedItems.push({
          collection: "presentations",
          id: doc.id,
          title: `Presentation Slides: ${d.grade} - ${d.subject}`,
          ...d,
        });
    });

    container.innerHTML = "";
    if (archivedItems.length === 0)
      return (container.innerHTML = `<p class="text-gray-400 font-bold text-center py-8">Recycle Bin is empty.</p>`);

    archivedItems.sort(
      (a, b) =>
        new Date(b.archived_at).getTime() - new Date(a.archived_at).getTime(),
    );

    archivedItems.forEach((item) => {
      const daysLeft = Math.max(
        0,
        Math.ceil(
          (new Date(item.purge_at).getTime() - now) / (1000 * 60 * 60 * 24),
        ),
      );
      const icon = item.collection === "lesson_plans" ? "📘" : "🖥️";

      const safeTitle = escapeHTML(item.title);
      const safeCollection = escapeHTML(item.collection);
      const safeId = escapeHTML(item.id);

      container.insertAdjacentHTML(
        "beforeend",
        `
                <div class="p-3 border rounded-lg bg-gray-50 flex justify-between items-center">
                    <div>
                        <h4 class="font-bold text-gray-800 text-sm flex items-center gap-2"><span>${icon}</span> ${safeTitle}</h4>
                        <p class="text-[10px] ${daysLeft <= 3 ? "text-red-600" : "text-amber-600"} font-bold mt-1">Permanently deletes in ${daysLeft} days</p>
                    </div>
                    <div class="flex gap-2">
                        <button onclick="restoreDocument('${safeCollection}', '${safeId}')" class="px-3 py-1.5 bg-green-50 text-green-700 font-bold text-xs rounded border border-green-200 hover:bg-green-100 transition shadow-sm">♻️ Restore</button>
                        <button onclick="hardDeleteDocument('${safeCollection}', '${safeId}')" class="px-3 py-1.5 bg-red-600 text-white font-bold text-xs rounded hover:bg-red-700 transition shadow-sm">🗑️ Eradicate</button>
                    </div>
                </div>
            `,
      );
    });
  } catch (e) {
    container.innerHTML = `<p class="text-red-500 font-bold text-center py-8">Error: ${escapeHTML(e.message)}</p>`;
  }
};

window.restoreDocument = async function (collectionName, docId) {
  if (!db) return;
  try {
    const { doc, setDoc } =
      await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js");
    await setDoc(
      ownedDoc(db, collectionName, docId),
      { is_archived: false },
      { merge: true },
    );

    window.openArchiveManager();
    if (typeof window.openLoadPlanModal === "function")
      window.openLoadPlanModal();
  } catch (e) {
    alert("Failed to restore: " + e.message);
  }
};

window.hardDeleteDocument = async function (collectionName, docId) {
  if (
    !db ||
    !confirm(
      "WARNING: This will eradicate the file permanently. Cannot be undone. Proceed?",
    )
  )
    return;
  try {
    const { doc, deleteDoc } =
      await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js");
    await deleteDoc(ownedDoc(db, collectionName, docId));

    window.openArchiveManager();
    if (typeof window.openLoadPlanModal === "function")
      window.openLoadPlanModal();
  } catch (e) {
    alert("Failed to delete: " + e.message);
  }
};

// Automatic deletion is disabled: opening a planner must never purge school records.
