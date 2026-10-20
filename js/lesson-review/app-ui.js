import {ownedDoc,ownedCollection,lessonStorage,workspaceUid,assertWorkspaceAccount,workspaceOnReady,requireStaffWorkspace} from "./workspace-session.mjs?v=2026.10.20.1";
/** Lesson-planner interface events and workflow coordination. */
// ==========================================
// 1. GLOBAL STATE MANAGER
// ==========================================

window.currentPlan = [];
window.currentWeeklyOverview = null;
window.currentTargetGrade = "";
window.currentPlanSubject = "";
window.currentPlanTeacher = "";
window.cachedCompiledText = "";
window.cachedSchedule = "";
window.cachedScope = "";
window.cachedCustomInstructions = "";
window.cachedPreviousPlan = null;
const escapeLessonText=value=>String(value??"").replace(/[&<>"']/g,c=>({
"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
})[c]);
window.currentAnchoredWeek = 1;

window.timerInterval = null;
window.verseInterval = null;
window.elapsedSeconds = 0;

window.bibleVerses = [
  "The fear of the Lord is the beginning of knowledge, but fools despise wisdom and instruction. - Proverbs 1:7",
  "For the Lord gives wisdom; from his mouth come knowledge and understanding. - Proverbs 2:6",
  "Trust in the Lord with all your heart and lean not on your own understanding. - Proverbs 3:5",
  "In all your ways submit to him, and he will make your paths straight. - Proverbs 3:6",
  "Blessed are those who find wisdom, those who gain understanding. - Proverbs 3:13",
  "Wisdom is the principal thing; therefore get wisdom: and with all thy getting get understanding. - Proverbs 4:7",
  "The way of a fool seems right to them, but the wise listen to advice. - Proverbs 12:15",
  "Plans fail for lack of counsel, but with many advisers they succeed. - Proverbs 15:22",
  "Commit to the Lord whatever you do, and he will establish your plans. - Proverbs 16:3",
  "Your word is a lamp for my feet, a light on my path. - Psalm 119:105",
  "Whatever you do, work at it with all your heart, as working for the Lord, not for human masters. - Colossians 3:23",
];

// ==========================================
// 2. INITIALIZATION
// ==========================================
workspaceOnReady( () => {
  if (window.initFirebase) window.initFirebase();
  window.generateRollingWeekDropdown();

  // 🚀 DYNAMIC FLOATING SCROLL BUTTON LOGIC
  const scrollBtn = document.getElementById("floatingScrollBtn");
  const scrollIcon = document.getElementById("scrollIcon");

  if (scrollBtn && scrollIcon) {
    let isPointingUp = false;

    const updateScrollState = () => {
      const maxScroll =
        document.documentElement.scrollHeight - window.innerHeight;

      if (maxScroll <= 0) {
        if (isPointingUp) {
          isPointingUp = false;
          scrollIcon.classList.remove("rotate-180");
          scrollBtn.title = "Scroll to Export Buttons";
        }
        return;
      }

      const scrollPercent = (window.scrollY / maxScroll) * 100;

      if (scrollPercent >= 50 && !isPointingUp) {
        isPointingUp = true;
        scrollIcon.classList.add("rotate-180");
        scrollBtn.title = "Scroll to Top";
      } else if (scrollPercent < 50 && isPointingUp) {
        isPointingUp = false;
        scrollIcon.classList.remove("rotate-180");
        scrollBtn.title = "Scroll to Export Buttons";
      }
    };

    window.addEventListener("scroll", updateScrollState);

    const resizeObserver = new ResizeObserver(() => updateScrollState());
    resizeObserver.observe(document.body);

    scrollBtn.addEventListener("click", () => {
      window.scrollTo({
        top: isPointingUp ? 0 : document.body.scrollHeight,
        behavior: "smooth",
      });
    });
  }
});
// ==========================================
// 3. UI & CALENDAR HELPERS
// ==========================================
window.showLoader = function (mainText = "Processing...") {
  if (typeof window.showSubtleLoader === "function") {
    window.showSubtleLoader(mainText);
  }
};

window.hideLoader = function () {
  if (typeof window.hideSubtleLoader === "function") {
    window.hideSubtleLoader();
  }
};

window.setupDateCalculator = function () {
  const syInput = document.getElementById("lpSchoolYear");
  const monthSelect = document.getElementById("lpMonth");
  const weekSelect = document.getElementById("lpWeek");
  const dateRangeInput = document.getElementById("lpDateRange");

  if (!syInput || !monthSelect || !weekSelect || !dateRangeInput) return;

  function calculateDateRange() {
    const sy = syInput.value.trim();
    const monthName = monthSelect.value;
    const weekNum = parseInt(weekSelect.value.replace("Week ", "")) - 1;

    if (!sy.includes("-")) return;
    const startYear = parseInt(sy.split("-")[0]);
    const endYear = parseInt(sy.split("-")[1]);

    const months = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    const monthIdx = months.indexOf(monthName);

    const year = monthIdx >= 0 && monthIdx <= 6 ? endYear : startYear;

    const firstDayOfMonth = new Date(year, monthIdx, 1);
    const dayOfWeek = firstDayOfMonth.getDay();
    const diff =
      dayOfWeek === 0 || dayOfWeek === 6
        ? dayOfWeek === 0
          ? 1
          : 2
        : 1 - dayOfWeek;

    const firstMonday = new Date(year, monthIdx, 1 + diff);
    const targetMonday = new Date(firstMonday);
    targetMonday.setDate(firstMonday.getDate() + weekNum * 7);

    const targetFriday = new Date(targetMonday);
    targetFriday.setDate(targetMonday.getDate() + 4);

    const formatOpts = { month: "short", day: "numeric" };
    dateRangeInput.value = `${targetMonday.toLocaleDateString("en-US", formatOpts)} - ${targetFriday.toLocaleDateString("en-US", formatOpts)}`;
  }

  syInput.addEventListener("input", calculateDateRange);
  monthSelect.addEventListener("change", calculateDateRange);
  weekSelect.addEventListener("change", calculateDateRange);
  calculateDateRange();
};

window.renderOverview = function () {
  const container = document.getElementById("weeklyOverviewContainer");
  if (!window.currentWeeklyOverview || !container) return;

  container.classList.remove("hidden");
  container.classList.add("flex");

  // 🚀 UI SHIFT: Removed Formation Standard from this section, adjusted to a 2-column grid
  container.innerHTML = `
        <div class="p-6 w-full">
            <h3 class="text-sm font-extrabold text-gray-400 uppercase tracking-widest mb-4">Weekly Curriculum Overview</h3>
            <div class="space-y-3">
                <div>
                    <label class="block text-[10px] font-bold text-gray-500 uppercase">Topic / Content</label>
                    <textarea data-weekly-field="topic" class="w-full p-2 border border-transparent rounded text-sm bg-white font-bold text-gray-800" rows="1">${escapeLessonText(window.currentWeeklyOverview.topic || "")}</textarea>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                        <label class="block text-[10px] font-bold text-gray-500 uppercase">Content Standard</label>
                        <textarea data-weekly-field="content_standard" class="w-full p-2 border border-gray-200 rounded text-xs bg-white" rows="2">${escapeLessonText(window.currentWeeklyOverview.content_standard || "")}</textarea>
                    </div>
                 <div>
                        <label class="block text-[10px] font-bold text-gray-500 uppercase">Performance Standard</label>
                        <textarea data-weekly-field="performance_standard" class="w-full p-2 border border-gray-200 rounded text-xs bg-white" rows="2">${escapeLessonText(window.currentWeeklyOverview.performance_standard || "")}</textarea>
                    </div>
                </div>
                <div>
                    <label class="block text-[10px] font-bold text-gray-500 uppercase">Materials & Tech</label>
                    <textarea data-weekly-field="materials" class="w-full p-2 border border-gray-200 rounded text-xs bg-white" rows="1">${escapeLessonText(window.currentWeeklyOverview.materials || "")}</textarea>
                </div>
            </div>
        </div>
    `;
  container.querySelectorAll("[data-weekly-field]").forEach(input=>{
    input.addEventListener("input",()=>{
      window.currentWeeklyOverview[input.dataset.weeklyField]=input.value;
    });
  });
};
window.syncOutputToData=function(){
  if(window.currentWeeklyOverview){
    document.querySelectorAll("#weeklyOverviewContainer [data-weekly-field]").forEach(input=>{
      window.currentWeeklyOverview[input.dataset.weeklyField]=input.value;
    });
  }
  document.querySelectorAll("#outputContainer .session-input").forEach(input=>{
    const index=Number(input.dataset.idx), key=input.dataset.key;
    if(window.currentPlan?.[index]&&key)window.currentPlan[index][key]=input.value;
  });
};
window.renderOutput = function () {
  const container = document.getElementById("outputContainer");
  const headerTitle = document.getElementById("planHeaderTitle");
  const headerBadge = document.getElementById("planHeaderBadge");
  if (!container) return;

  container.innerHTML = "";

  if (!window.currentPlan || !window.currentPlan.length) {
    if (headerTitle) headerTitle.textContent = "Generated Plan";
    if (headerBadge) headerBadge.textContent = "No Data";
    container.innerHTML =
      '<div class="text-center text-gray-400 italic mt-20">Select your scope, grade level, and folders to generate plans.</div>';
    return;
  }

  if (headerTitle)
    headerTitle.textContent = `${window.currentTargetGrade} Lesson Plan`;
  if (headerBadge)
    headerBadge.textContent = `${window.currentPlan.length} Sessions`;

  window.currentPlan.forEach((session, index) => {
    const isFlex = String(session.session_name||"").toLowerCase().includes("flex");

    let html = `<div class="bg-white p-5 rounded border border-gray-200 shadow-sm mb-6">
            <h3 class="text-lg font-bold ${isFlex ? "text-amber-600" : "text-blue-800"} mb-4 border-b pb-2">${escapeLessonText(session.session_name)} ${isFlex ? "(Asynchronous)" : ""}</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">`;

    if (!isFlex) {
      html += `
                <div class="md:col-span-2 mb-2">
                    <label class="block text-[10px] font-extrabold text-blue-600 uppercase tracking-wider mb-1">Session Sub-Topic</label>
                    <textarea class="session-input w-full p-2 border border-blue-200 rounded text-sm bg-white font-bold text-gray-800" rows="1" data-idx="${index}" data-key="topic">${escapeLessonText(session.topic || window.currentWeeklyOverview?.topic || "")}</textarea>
                </div>
                <div>
                    <label class="block text-[10px] font-extrabold text-blue-600 uppercase tracking-wider mb-1">Learning Competencies</label>
                    <textarea class="session-input w-full p-2 border border-blue-100 rounded text-sm bg-blue-50" rows="3" data-idx="${index}" data-key="competencies">${escapeLessonText(session.competencies || "")}</textarea>
                </div>
                <div>
                   <label class="block text-[10px] font-extrabold text-blue-600 uppercase tracking-wider mb-1">Learning Objectives</label>
                   <textarea class="session-input w-full p-2 border border-blue-100 rounded text-sm bg-blue-50" rows="3" data-idx="${index}" data-key="objectives">${escapeLessonText(session.objectives || "")}</textarea>
                 </div>
                <div>
                    <label class="block text-[10px] font-extrabold text-gray-500 uppercase tracking-wider mb-1">Preliminary Action</label>
                    <textarea class="session-input w-full p-2 border rounded text-sm bg-gray-50" rows="3" data-idx="${index}" data-key="preliminary">${escapeLessonText(session.preliminary || "")}</textarea>
                </div>
                <div>
                    <label class="block text-[10px] font-extrabold text-gray-500 uppercase tracking-wider mb-1">Motivation / Recall</label>
                    <textarea class="session-input w-full p-2 border rounded text-sm bg-gray-50" rows="3" data-idx="${index}" data-key="motivation">${escapeLessonText(session.motivation || "")}</textarea>
                </div>`;
    }

    html += `
                <div class="md:col-span-2">
                    <label class="block text-[10px] font-extrabold text-gray-500 uppercase tracking-wider mb-1">Learning Activities</label>
                    <textarea class="session-input w-full p-3 border border-gray-300 rounded text-sm bg-white font-mono leading-relaxed shadow-inner" rows="6" data-idx="${index}" data-key="learning_activities">${escapeLessonText(session.learning_activities || "")}</textarea>
                </div>`;

    if (!isFlex) {
      html += `
                <div>
                    <label class="block text-[10px] font-extrabold text-gray-500 uppercase tracking-wider mb-1">Evaluation</label>
                    <textarea class="session-input w-full p-2 border rounded text-sm bg-gray-50" rows="2" data-idx="${index}" data-key="evaluation">${escapeLessonText(session.evaluation || "")}</textarea>
                </div>
                <div>
                    <label class="block text-[10px] font-extrabold text-gray-500 uppercase tracking-wider mb-1">Closing Activities</label>
                    <textarea class="session-input w-full p-2 border rounded text-sm bg-gray-50" rows="2" data-idx="${index}" data-key="closing">${escapeLessonText(session.closing || "")}</textarea>
                </div>
                
                <!-- 🚀 NEW: Formation Standard now natively integrated per session -->
                <div>
                    <label class="block text-[10px] font-extrabold text-gray-500 uppercase tracking-wider mb-1">Formation Standard</label>
                    <textarea class="session-input w-full p-2 border rounded text-sm bg-gray-50" rows="2" data-idx="${index}" data-key="formation_standard">${escapeLessonText(session.formation_standard || "")}</textarea>
                </div>
                <div>
                    <label class="block text-[10px] font-extrabold text-gray-500 uppercase tracking-wider mb-1">Values Integration</label>
                    <textarea class="session-input w-full p-2 border rounded text-sm bg-gray-50" rows="2" data-idx="${index}" data-key="values_integration">${escapeLessonText(session.values_integration || "")}</textarea>
                </div>
                
                <div class="md:col-span-2">
                    <label class="block text-[10px] font-extrabold text-amber-600 uppercase tracking-wider mb-1">Remarks / Intervention</label>
                    <textarea class="session-input w-full p-2 border rounded text-sm bg-amber-50 border-amber-200" rows="2" data-idx="${index}" data-key="remarks">${escapeLessonText(session.remarks || "")}</textarea>
                </div>`;
    }

    html += `</div></div>`;
    container.insertAdjacentHTML("beforeend", html);
  });

  document.querySelectorAll(".session-input").forEach((input) => {
    input.addEventListener("input", (e) => {
      const idx = e.target.getAttribute("data-idx");
      const key = e.target.getAttribute("data-key");
      window.currentPlan[idx][key] = e.target.value;

      e.target.style.height = "auto";
      e.target.style.height = e.target.scrollHeight + "px";
    });
  });

  setTimeout(() => {
    const textareas = container.querySelectorAll(".session-input");
    textareas.forEach((ta) => {
      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + "px";
    });
  }, 50);
};

window.closeLoadPlanModal = function () {
  const modal = document.getElementById("loadPlanModal");
  if (modal) modal.classList.replace("flex", "hidden");
};

window.loadSpecificPlan = function (planData) {
  window.loadedPersonalPlan=planData.ownerUid===workspaceUid() ? {id:planData.id,version:Number(planData.version||1)} : null;
  window.legacySourcePlanId=planData.source_legacy_plan||null;
  // Older records may predate the weekly overview. Do not lose the open draft
  // or crash the editor when a saved record has missing session data.
  if (!planData || !Array.isArray(planData.sessions) || !planData.sessions.length) {
    alert("This saved record has no editable lesson sessions.");
    return;
  }
  window.currentWeeklyOverview =
    planData.weekly_overview && typeof planData.weekly_overview === "object"
      ? planData.weekly_overview
      : { topic: "", content_standard: "", performance_standard: "", materials: "" };
  window.currentPlan = planData.sessions;
  // Preserve the original subject and teacher for an edited saved lesson.
  // Defaults may have changed since this plan was first created.
  window.currentPlanSubject = planData.subject_title ||
    lessonStorage.getItem("Adminerva_defaultSubject") || "Subject";
  window.currentPlanTeacher = planData.teacher_name ||
    lessonStorage.getItem("Adminerva_defaultTeacher") || "Unassigned";
  window.currentTargetGrade = planData.grade_level || document.getElementById("lpGradeLevel")?.value || "Grade 11";

  document.getElementById("lpSchoolYear").value =
    planData.school_year || "2026-2027";

  document
    .querySelectorAll(".folder-checkbox")
    .forEach((cb) => (cb.checked = false));
  if (planData.reference_folders && Array.isArray(planData.reference_folders)) {
    planData.reference_folders.forEach((folderId) => {
      const checkbox = document.querySelector(
        `.folder-checkbox[value="${folderId}"]`,
      );
      if (checkbox) checkbox.checked = true;
    });
  }

  if (document.getElementById("lpAcademicTerm")) {
    document.getElementById("lpAcademicTerm").value =
      planData.safeTerm ||
      planData.academic_term ||
      "FIRST SEMESTER/FIRST QUARTER";
  }
  if (document.getElementById("lpCourseWeek")) {
    document.getElementById("lpCourseWeek").value =
      planData.safeWeek || planData.course_week || "Week 1";
  }

  const dateRangeEl = document.getElementById("lpDateRange");
  const physicalDateStr = planData.safeDate || planData.date_range;
  if (dateRangeEl && physicalDateStr) {
    let exists = Array.from(dateRangeEl.options).some(
      (opt) => opt.value === physicalDateStr,
    );
    if (!exists && physicalDateStr !== "No physical dates") {
      const historyOpt = document.createElement("option");
      historyOpt.value = physicalDateStr;
      historyOpt.textContent = `💾 Loaded: ${physicalDateStr}`;
      dateRangeEl.appendChild(historyOpt);
    }
    dateRangeEl.value = physicalDateStr;
  }

  const customInstructionsEl = document.getElementById("lpCustomInstructions");
  if (customInstructionsEl)
    customInstructionsEl.value = planData.custom_instructions || "";

  if (planData.grade_level)
    document.getElementById("lpGradeLevel").value = planData.grade_level;
  // Historical lessons retain their saved schedule as part of the plan.
  // Loading one must not replace the active semester timetable.

  window.renderOverview();
  window.renderOutput();
  window.closeLoadPlanModal();
  alert("✅ Lesson plan loaded successfully!");
};

window.generateRollingWeekDropdown = function () {
  const selectEl = document.getElementById("lpDateRange");
  if (!selectEl) return;

  selectEl.innerHTML = "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const day = today.getDay();
  const diffToMonday = today.getDate() - day + (day === 0 ? -6 : 1);
  const thisMonday = new Date(today);
  thisMonday.setDate(diffToMonday);

  for (let i = -6; i <= 6; i++) {
    const mon = new Date(thisMonday);
    mon.setDate(thisMonday.getDate() + i * 7);

    const fri = new Date(mon);
    fri.setDate(mon.getDate() + 4);

    const mMonth = mon.toLocaleString("en-US", { month: "long" });
    const mDay = mon.getDate();
    const fMonth = fri.toLocaleString("en-US", { month: "long" });
    const fDay = fri.getDate();
    const year = fri.getFullYear();

    let dateStr = "";
    if (mMonth === fMonth) {
      dateStr = `${mMonth} ${mDay}-${fDay}, ${year}`;
    } else {
      dateStr = `${mMonth} ${mDay}-${fMonth} ${fDay}, ${year}`;
    }

    const opt = document.createElement("option");
    opt.value = dateStr;
    opt.textContent = i === 0 ? `👉 Current: ${dateStr}` : dateStr;
    if (i === 0) opt.selected = true;

    selectEl.appendChild(opt);
  }
};
