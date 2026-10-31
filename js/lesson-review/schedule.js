import {requireCurrentVersion} from "./workspace-model.mjs?v=1.3.0";
import {ownedDoc,ownedCollection,lessonStorage,workspaceUid,assertWorkspaceAccount,workspaceOnReady,requireStaffWorkspace} from "./workspace-session.mjs?v=1.3.0";
/** Teacher schedule editing and scoped calendar workflow. */
import { db } from "../core/firebase-core.js?v=1.3.0";
import {loadSchoolOptions,fillSchoolDatalist} from "../core/school-options.mjs?v=1.3.0";
import {auth} from "../core/firebase-core.js?v=1.3.0";
import {resolveStaffRole} from "../core/staff-session.mjs?v=1.3.0";
import {ADMIN_EMAIL,TEACHER_EMAIL} from "../core/staff-role.mjs?v=1.3.0";
import { scheduleScope, parseScheduleRows, parseClockMinutes } from "./schedule-scope.mjs?v=1.3.0";
import {isLegacySharedScope,isLegacyScheduleRetired,legacyScheduleNotice,resolveSectionGrade,scheduleRowsToText} from "./legacy-schedule-compat.mjs?v=1.4.18";
import {
  doc,
  getDoc,
  setDoc,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

let mySections = [];
let mySubjects = [];
let myEvents = [];
let isEditing = false;
let draftRows = null;
let activeYear = "2026-2027";
let activeSemester = "S1";
let loadSerial = 0;
let isSaving = false;
let cloudVersion=0;
let loadingSchedule=false;
let schoolOptions=null;
async function refreshSchoolChoices(){
  const label=document.getElementById("scheduleCatalogStatus");
  try{
    schoolOptions=await loadSchoolOptions({schoolYear:activeYear});loadConfig();
    fillSchoolDatalist("scheduleSchoolYears",[activeYear,...schoolOptions.schoolYears]);
    fillSchoolDatalist("scheduleSubjectChoices",schoolOptions.subjects);
    if(label)label.textContent=schoolOptions.sections.length+" school sections and "+schoolOptions.subjects.length+" catalog subjects available."+(schoolOptions.warnings.length?" Some school records could not load; saved timetable values are preserved.":!schoolOptions.sections.length?" Ask an administrator to assign your exact roster sections before scheduling new classes.":"");
  }catch{if(label)label.textContent="School choices could not load. Saved timetable values and personal options are preserved. Select Refresh school choices to retry.";}
}
window.refreshScheduleSchoolChoices=async()=>{if(isSaving)return;if(isEditing)draftRows=getTableDataFromDOM();await refreshSchoolChoices();renderTable();};

function escapeHTML(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function currentScope() {
  return scheduleScope(activeYear, activeSemester);
}
function mayUseSharedLegacySchedule() {
  const email=String(auth.currentUser?.email||"").toLowerCase();
  return isLegacySharedScope(currentScope())&&(email===ADMIN_EMAIL||email===TEACHER_EMAIL);
}
function updateLegacyScheduleNotice() {
  const node=document.getElementById("legacyScheduleNotice");
  if(!node)return;
  const legacy=isLegacySharedScope(currentScope());
  node.hidden=!legacy;
  node.textContent=legacy?legacyScheduleNotice():"";
  node.dataset.tone=legacy&&isLegacyScheduleRetired()?"warning":"info";
}
workspaceOnReady(() => {
  const status=document.getElementById("scheduleScopeStatus");
  if(!status)return;
  const tools=document.createElement("div");tools.className="av-button-row my-3";
  const reload=document.createElement("button");reload.type="button";reload.className="av-secondary-button";reload.textContent="Reload my saved schedule";
  reload.addEventListener("click",async()=>{
    if(isSaving)return;
    if(!confirm("Reload your saved schedule and discard unsynced edits in this view?"))return;
    const scope=currentScope();
    for(const key of [scope.pendingKey,scope.jsonKey,scope.textKey])lessonStorage.removeItem(key);
    isEditing=false;draftRows=null;updateEditControls();await fetchScheduleFromCloud();
  });
  const legacy=document.createElement("button");legacy.type="button";legacy.className="av-secondary-button";legacy.textContent="Import older shared timetable…";legacy.hidden=true;
  resolveStaffRole(auth.currentUser).then(role=>{legacy.hidden=role!=="admin"||isLegacySharedScope(currentScope());});
  legacy.addEventListener("click",async()=>{
    if(isSaving)return;
    const scope=currentScope(),ownerUid=workspaceUid();
    if(!confirm("Copy the older shared timetable into your editable schedule? Nothing is saved until you choose Save Schedule. Existing shared records remain unchanged."))return;
    try{
      let snapshot=await getDoc(doc(db,"app_config",scope.id));
      if(!snapshot.exists()&&scope.allowLegacy)snapshot=await getDoc(doc(db,"app_config","master_schedule"));
      assertWorkspaceAccount(ownerUid);
      if(currentScope().id!==scope.id)return;
      if(!snapshot.exists()){updateScopeStatus("No older shared timetable exists for this period.");return;}
      draftRows=parseScheduleRows(snapshot.data().json_data);isEditing=true;updateEditControls();renderTable();
      updateScopeStatus("Shared timetable copied to your editor only. Review it, then Save Schedule into your own account.");
    }catch{updateScopeStatus("The older shared timetable could not be read. Your personal schedule was not changed.");}
  });
  tools.append(reload,legacy);status.after(tools);
});

function cacheRows(scope, rows, rawText) {
  lessonStorage.setItem(scope.jsonKey, JSON.stringify(rows));
  lessonStorage.setItem(scope.textKey, rawText);
}

function cachedRows(scope) {
  const local = lessonStorage.getItem(scope.jsonKey);
  if (local !== null) return parseScheduleRows(local);
  return [];
}

function updateScopeStatus(message) {
  const label = document.getElementById("scheduleScopeStatus");
  if (label) label.textContent = activeYear + " · " +
    (activeSemester === "S2" ? "Second Semester" : "First Semester") +
    " — " + message;
}

function syncPeriodInputs() {
  const year = document.getElementById("scheduleSchoolYear");
  const semester = document.getElementById("scheduleSemester");
  if (year) year.value = activeYear;
  if (semester) semester.value = activeSemester;
}

function updateEditControls() {
  const button = document.getElementById("editSaveBtn");
  const badge = document.getElementById("modeBadge");
  if (button) {
    const archived=isLegacySharedScope(currentScope())&&isLegacyScheduleRetired();
    button.disabled=loadingSchedule||isSaving||archived;
    button.textContent = archived ? "Legacy Schedule Archived" : (isEditing ? "Save Schedule" : "Edit Schedule");
    button.className = isEditing
      ? "bg-green-600 text-white px-6 py-2 rounded font-bold hover:bg-green-700 transition shadow-sm flex items-center gap-2"
      : "bg-blue-600 text-white px-6 py-2 rounded font-bold hover:bg-blue-700 transition shadow-sm flex items-center gap-2";
  }
  if (badge) {
    badge.textContent = isEditing ? "Editing Mode" : "Read-Only";
    badge.className = isEditing
      ? "bg-green-100 text-green-800 text-xs font-extrabold px-3 py-1 rounded-full uppercase tracking-wider"
      : "bg-gray-200 text-gray-700 text-xs font-extrabold px-3 py-1 rounded-full uppercase tracking-wider";
  }
  const archived=isLegacySharedScope(currentScope())&&isLegacyScheduleRetired();
  for (const id of ["addClassBtn", "addEventBtn"]) {
    const node = document.getElementById(id);
    if (!node) continue;
    node.classList.toggle("hidden", !isEditing||archived);
    node.classList.toggle("flex", isEditing&&!archived);
  }
  updateLegacyScheduleNotice();
}

async function initFirebase() {
  await fetchScheduleFromCloud();
}

async function fetchScheduleFromCloud() {
  const request = ++loadSerial;
  loadingSchedule=true;updateEditControls();
  const scope = currentScope();
  const ownerUid=workspaceUid();
  cloudVersion=Number(lessonStorage.getItem(scope.versionKey)||0);
  let rows = cachedRows(scope);
  let raw = lessonStorage.getItem(scope.textKey);

  let source = rows.length ? "Local copy" : "No schedule saved; choose Edit Schedule to enter one.";
  if (lessonStorage.getItem(scope.pendingKey) === "1") {
    loadingSchedule=false;updateEditControls();
    renderTable();
    updateScopeStatus("Unsynced edits from this device. Select Edit Schedule, then Save Schedule to retry.");
    return;
  }
  if (db) {
    window.showLoader("Loading selected semester schedule...");
    try {
      let shared=false;
      let snap=null;
      if(mayUseSharedLegacySchedule()){
        let sharedSnap=await getDoc(doc(db,"app_config",scope.id));
        if(!sharedSnap.exists()&&scope.allowLegacy)sharedSnap=await getDoc(doc(db,"app_config","master_schedule"));
        if(sharedSnap.exists()){snap=sharedSnap;shared=true;}
      }
      if(!snap)snap=await getDoc(ownedDoc(db,"schedules",scope.id));
      if(request!==loadSerial)return;
      assertWorkspaceAccount(ownerUid);
      // 2026–2027 uses one temporary shared timetable for the administrator
      // and original teacher. Newer school years remain account-owned.
      cloudVersion=shared?0:(snap.exists()?Number(snap.data().version||1):0);
      lessonStorage.setItem(scope.versionKey,String(cloudVersion));
      if (snap.exists()) {
        const data = snap.data();
        rows = parseScheduleRows(data.json_data);
        raw = typeof data.raw_text === "string" ? data.raw_text : "";
        source = shared ? "Loaded shared 2026–2027 legacy timetable." : "Loaded from cloud.";
      }
    } catch (error) {
      console.warn("Schedule cloud fetch failed; using local copy:", error);
      source = "Cloud unavailable; showing local copy if available.";
    } finally {
      if(request===loadSerial){loadingSchedule=false;updateEditControls();}
      window.hideLoader();
    }
  }
  if (request !== loadSerial) return;
  loadingSchedule=false;updateEditControls();
  assertWorkspaceAccount(ownerUid);
  cacheRows(scope, rows, raw || "");
  renderTable();
  updateScopeStatus(source);
}

// --- CLOUD SYNC HELPERS (Subtle Loader Adapter) ---
window.showLoader = function (msg = "Syncing schedule...") {
  if (typeof window.showSubtleLoader === "function") {
    window.showSubtleLoader(msg);
  }
};
window.hideLoader = function () {
  if (typeof window.hideSubtleLoader === "function") {
    window.hideSubtleLoader();
  }
};

workspaceOnReady( async () => {
  try{const saved=await getDoc(ownedDoc(db,"preferences","schedule_options"));if(saved.exists())for(const [field,key] of [["subjects","Adminerva_subjects"],["events","Adminerva_events"]])if(typeof saved.data()[field]==="string")lessonStorage.setItem(key,saved.data()[field]);}catch{/* Personal device options remain usable offline. */}
  loadConfig();
  const year = lessonStorage.getItem("Adminerva_schedule_selected_year");
  const semester = lessonStorage.getItem("Adminerva_schedule_selected_semester");
  if (year) {
    try { scheduleScope(year, semester || "S1"); activeYear = year; }
    catch (error) { console.warn("Invalid saved school year:", error); }
  }
  if (semester === "S1" || semester === "S2") activeSemester = semester;
  syncPeriodInputs();
  await refreshSchoolChoices();
  updateLegacyScheduleNotice();
  document.getElementById("scheduleSchoolYear")?.addEventListener("change", window.changeSchedulePeriod);
  document.getElementById("scheduleSemester")?.addEventListener("change", window.changeSchedulePeriod);
  updateEditControls();
  await initFirebase();
});

// Warn when the user leaves while an editable timetable may contain
// unsaved changes. Semester switching has its own confirmation.
window.addEventListener("beforeunload", event => {
  if (!isEditing) return;
  event.preventDefault();
  event.returnValue = "";
});

window.changeSchedulePeriod = async function () {
  if (isSaving) { syncPeriodInputs(); return; }
  const requestedYear = document.getElementById("scheduleSchoolYear")?.value.trim();
  const requestedSemester = document.getElementById("scheduleSemester")?.value;
  try {
    scheduleScope(requestedYear, requestedSemester);
  } catch (error) {
    alert(error.message);
    syncPeriodInputs();
    return;
  }
  if (requestedYear === activeYear && requestedSemester === activeSemester) return;
  if (isEditing && !confirm("Switch schedules and discard unsaved timetable edits? Save the current semester first if needed.")) {
    syncPeriodInputs();
    return;
  }
  isEditing = false;
  draftRows = null;
  updateEditControls();
  activeYear = requestedYear;
  activeSemester = requestedSemester;
  lessonStorage.setItem("Adminerva_schedule_selected_year", activeYear);
  lessonStorage.setItem("Adminerva_schedule_selected_semester", activeSemester);
  await refreshSchoolChoices();
  updateLegacyScheduleNotice();
  await fetchScheduleFromCloud();
};
// --- MODAL & CONFIG LOGIC ---
window.openSettingsModal = function () {
  document.getElementById("configSections").value =
    (schoolOptions?.sections||mySections).join(", ");
  document.getElementById("configSubjects").value =
    lessonStorage.getItem("Adminerva_subjects") || "";
  document.getElementById("configEvents").value =
    lessonStorage.getItem("Adminerva_events") || "";

  const modal = document.getElementById("settingsModal");
  modal.classList.remove("hidden");
  modal.classList.add("flex");
};

window.closeSettingsModal = function () {
  const modal = document.getElementById("settingsModal");
  modal.classList.remove("flex");
  modal.classList.add("hidden");
};

window.saveSettingsConfig = async function () {
  lessonStorage.setItem(
    "Adminerva_subjects",
    document.getElementById("configSubjects").value,
  );
  lessonStorage.setItem(
    "Adminerva_events",
    document.getElementById("configEvents").value,
  );

  // Keep existing unsaved edits when changing dropdown options. The user
  // explicitly saves the timetable with Save Schedule after reviewing it.
  if (isEditing) draftRows = getTableDataFromDOM();
  loadConfig();
  renderTable();
  try{
    const uid=await requireStaffWorkspace();
    await setDoc(ownedDoc(db,"preferences","schedule_options"),{subjects:document.getElementById("configSubjects").value,events:document.getElementById("configEvents").value});
    assertWorkspaceAccount(uid);window.closeSettingsModal();
  }catch{const label=document.getElementById("scheduleOptionsStatus");if(label)label.textContent="Options saved on this device. Cloud sync failed; select Save options to retry. Your timetable draft is unchanged.";}
};

function loadConfig() {
  mySections = schoolOptions?.sections || (lessonStorage.getItem("Adminerva_sections") || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  mySubjects = (lessonStorage.getItem("Adminerva_subjects") || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  mySubjects=[...new Set([...(schoolOptions?.subjects||[]),...mySubjects])].sort();
  myEvents = (lessonStorage.getItem("Adminerva_events") || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

// --- EDIT/LOCK ENGINE ---
window.toggleEditMode = async function () {
  if (isSaving) return;
  if (isEditing) {
    isSaving = true;
    try {
      const saved = await window.saveScheduleData();
      if (!saved) return;
      isEditing = false;
      draftRows = null;
    } finally {
      isSaving = false;
    }
  } else {
    draftRows = cachedRows(currentScope());
    isEditing = true;
  }
  updateEditControls();
  renderTable();
};

// --- TIME CALCULATIONS ---
window.autoFillEndTime = function (dateStr, startInputElement) {
  if (!dateStr) return;

  const row = startInputElement.closest("tr");
  if (!row) return;

  const endInput = row.querySelector(".time-end");
  if (!endInput) return;

  // A teacher may be editing a 60-minute class or a 3-hour laboratory.
  // Never silently replace an existing end time with a 45-minute slot.
  if (String(endInput.value || "").trim()) return;

  // Supply a default end time only for a new, incomplete row.
  const [hours, minutes] = dateStr.split(":").map(Number);
  const date = new Date();
  date.setHours(hours, minutes + 45, 0, 0);

  const endHours = String(date.getHours()).padStart(2, "0");
  const endMinutes = String(date.getMinutes()).padStart(2, "0");
  const finalTime = `${endHours}:${endMinutes}`;

  if (endInput._flatpickr) {
    endInput._flatpickr.setDate(finalTime, true);
  } else {
    endInput.value = finalTime;
  }
};

function formatTimeToAMPM(time24) {
  if (!time24) return "";
  const [h, m] = time24.split(":");
  let hours = parseInt(h, 10);
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  hours = hours ? hours : 12;
  return `${hours}:${m} ${ampm}`;
}

// --- TABLE RENDERING & DATA MANAGEMENT ---
window.addRow = function (type) {
  const savedJson = getTableDataFromDOM();
  let inheritedStartTime = "";
  let inheritedEndTime = "";

  if (savedJson.length > 0) {
    const lastRow = savedJson[savedJson.length - 1];
    if (lastRow.endTime) {
      inheritedStartTime = lastRow.endTime;
    }
  }

  // ⏱️ UPDATED: 45-minute interval logic
  if (inheritedStartTime && inheritedStartTime.includes(":")) {
    const [hours, minutes] = inheritedStartTime.split(":").map(Number);
    if (!isNaN(hours) && !isNaN(minutes)) {
      const date = new Date();
      date.setHours(hours, minutes + 45, 0, 0);

      const endHours = String(date.getHours()).padStart(2, "0");
      const endMinutes = String(date.getMinutes()).padStart(2, "0");
      inheritedEndTime = `${endHours}:${endMinutes}`;
    }
  }

  if (type === "class") {
    savedJson.push({
      type: "class",
      startTime: inheritedStartTime,
      endTime: inheritedEndTime,
      mon: { sec: "", sub: "" },
      tue: { sec: "", sub: "" },
      wed: { sec: "", sub: "" },
      thu: { sec: "", sub: "" },
      fri: { sec: "", sub: "" },
    });
  } else {
    savedJson.push({
      type: "constant",
      startTime: inheritedStartTime,
      endTime: inheritedEndTime,
      eventName: "",
    });
  }

  draftRows = savedJson;
  renderTable();
};

window.deleteRow = function (index) {
  const data = getTableDataFromDOM();
  data.splice(index, 1);
  draftRows = data;
  renderTable();
};

function renderTable() {
  const tbody = document.getElementById("scheduleTableBody");
  tbody.innerHTML = "";

  const savedJson = isEditing && draftRows ? draftRows : cachedRows(currentScope());

  if (savedJson.length === 0 && !isEditing) {
    tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-gray-400 italic">No schedule configured. Click 'Edit Schedule' to begin.</td></tr>`;
    return;
  }

  savedJson.forEach((row, rowIndex) => {
    const tr = document.createElement("tr");
    tr.className = "border-b hover:bg-gray-50 transition group";
    tr.dataset.rowType = row.type;

    const timeInputHtml = isEditing
      ? `<div class="flex flex-col gap-1 items-center justify-center">
                   <input type="text" class="time-start w-full p-1 border border-gray-300 rounded text-xs focus:ring-blue-500 font-bold text-gray-700 text-center cursor-pointer bg-white" value="${escapeHTML(row.startTime || "")}" placeholder="Start Time">
                   <span class="text-[9px] text-gray-400 font-bold uppercase">To</span>
                   <input type="text" class="time-end w-full p-1 border border-gray-300 rounded text-xs focus:ring-blue-500 font-bold text-gray-700 text-center cursor-pointer bg-white" value="${escapeHTML(row.endTime || "")}" placeholder="End Time">
               </div>`
      : `<div class="flex flex-col items-center justify-center text-center">
                   <span class="font-bold text-gray-800 text-xs">${formatTimeToAMPM(row.startTime) || '<span class="text-gray-300">--</span>'}</span>
                   <span class="text-[9px] text-gray-400 font-bold uppercase my-0.5">To</span>
                   <span class="font-bold text-gray-800 text-xs">${formatTimeToAMPM(row.endTime) || '<span class="text-gray-300">--</span>'}</span>
               </div>`;

    if (row.type === "constant") {
      if (isEditing) {
        let options = `<option value="">-- Select Event --</option>`;
        const availableEvents = [...myEvents];
        if (row.eventName && !availableEvents.includes(row.eventName)) availableEvents.push(row.eventName);
        availableEvents.forEach((e) => {
          const safeE = escapeHTML(e); // 🔒 Security Patch
          options += `<option value="${safeE}" ${row.eventName === e ? "selected" : ""}>${safeE}</option>`;
        });
        tr.innerHTML = `
                    <td class="p-2 border-r bg-gray-50 align-middle text-center w-[15%]">${timeInputHtml}</td>
                    <td colspan="5" class="p-2 border-r align-middle bg-amber-50 border-y border-amber-200">
                        <select class="event-input w-full p-2 border border-amber-300 rounded text-sm focus:ring-amber-500 font-bold text-amber-800 text-center bg-white">${options}</select>
                    </td>
                    <td class="p-2 text-center align-middle"><button onclick="deleteRow(${rowIndex})" class="text-red-400 hover:text-red-600 font-bold px-2 transition">✖</button></td>
                `;
      } else {
        const safeEventName = escapeHTML(row.eventName || "UNASSIGNED EVENT"); // 🔒 Security Patch
        tr.innerHTML = `
                    <td class="p-3 border-r bg-gray-50 text-center align-middle w-[15%]">${timeInputHtml}</td>
                    <td colspan="5" class="p-3 border-r align-middle bg-amber-50 border-y border-amber-200 text-center shadow-inner">
                        <span class="font-extrabold text-amber-700 text-sm uppercase tracking-widest">${safeEventName}</span>
                    </td>
                    <td class="p-3 text-center align-middle text-gray-300">-</td>
                `;
      }
    } else {
      if (isEditing) {
        tr.innerHTML = `
                    <td class="p-2 border-r bg-gray-50 align-middle text-center w-[15%]">${timeInputHtml}</td>
                    <td class="p-2 border-r align-top">${buildCellEdit("mon", row.mon)}</td>
                    <td class="p-2 border-r align-top">${buildCellEdit("tue", row.tue)}</td>
                    <td class="p-2 border-r align-top">${buildCellEdit("wed", row.wed)}</td>
                    <td class="p-2 border-r align-top">${buildCellEdit("thu", row.thu)}</td>
                    <td class="p-2 border-r align-top">${buildCellEdit("fri", row.fri)}</td>
                    <td class="p-2 text-center align-middle"><button onclick="deleteRow(${rowIndex})" class="text-red-400 hover:text-red-600 font-bold px-2 transition">✖</button></td>
                `;
      } else {
        tr.innerHTML = `
                    <td class="p-3 border-r bg-gray-50 text-center align-middle w-[15%]">${timeInputHtml}</td>
                    <td class="p-3 border-r align-top">${buildCellView(row.mon)}</td>
                    <td class="p-3 border-r align-top">${buildCellView(row.tue)}</td>
                    <td class="p-3 border-r align-top">${buildCellView(row.wed)}</td>
                    <td class="p-3 border-r align-top">${buildCellView(row.thu)}</td>
                    <td class="p-3 border-r align-top">${buildCellView(row.fri)}</td>
                    <td class="p-3 text-center align-middle text-gray-300">-</td>
                `;
      }
    }
    tbody.appendChild(tr);
  });

  if (isEditing) {
    flatpickr(".time-start", {
      enableTime: true,
      noCalendar: true,
      dateFormat: "H:i",
      altInput: true,
      altFormat: "h:i K",
      minuteIncrement: 5,
      onChange: function (selectedDates, dateStr, instance) {
        window.autoFillEndTime(dateStr, instance.element);
      },
    });

    flatpickr(".time-end", {
      enableTime: true,
      noCalendar: true,
      dateFormat: "H:i",
      altInput: true,
      altFormat: "h:i K",
      minuteIncrement: 5,
    });
  }
}

function buildCellEdit(dayPrefix, savedData = {}) {
  // 🔒 Security Patch: Sanitize generated options
  // A semester may reference sections/subjects removed from current settings.
  // Keep saved values selectable so re-rendering cannot erase those classes.
  const sections = [...mySections];
  const subjects = [...mySubjects];
  const events = [...myEvents];
  if (savedData.sec && !sections.includes(savedData.sec)) sections.push(savedData.sec);
  if (savedData.sub && !subjects.includes(savedData.sub)) subjects.push(savedData.sub);
  if (savedData.evt && !events.includes(savedData.evt)) events.push(savedData.evt);
  const secOptions = sections
    .map((s) => {
      const safeS = escapeHTML(s);
      return `<option value="${safeS}" ${savedData.sec === s ? "selected" : ""}>${safeS}</option>`;
    })
    .join("");

  const subOptions = subjects
    .map((s) => {
      const safeS = escapeHTML(s);
      return `<option value="${safeS}" ${savedData.sub === s ? "selected" : ""}>${safeS}</option>`;
    })
    .join("");

  const evtOptions = events
    .map((e) => {
      const safeE = escapeHTML(e);
      return `<option value="${safeE}" ${savedData.evt === e ? "selected" : ""}>${safeE}</option>`;
    })
    .join("");

  let secHtml = `<select class="w-full p-1 border border-gray-300 rounded text-xs focus:ring-blue-500 font-bold text-gray-800 mb-1 ${dayPrefix}-sec bg-white"><option value="">-- Section --</option>${secOptions}</select>`;
  let subHtml = `<select class="w-full p-1 border border-gray-300 rounded text-xs focus:ring-blue-500 text-gray-600 ${dayPrefix}-sub bg-white"><option value="">-- Subject --</option>${subOptions}</select>`;
  let eventHtml = `<select class="w-full p-1 border border-amber-300 rounded text-[10px] focus:ring-amber-500 text-amber-700 bg-amber-50 mt-1 ${dayPrefix}-evt"><option value="">-- Periodic Event --</option>${evtOptions}</select>`;
  return `<div class="flex flex-col">${secHtml}${subHtml}${eventHtml}</div>`;
}

function buildCellView(savedData = {}) {
  // 🔒 Security Patch: Sanitize viewed selections
  if (savedData.evt)
    return `<div class="flex flex-col bg-amber-50 border border-amber-200 p-2 rounded shadow-sm text-center h-full justify-center"><span class="font-extrabold text-amber-700 text-[10px] uppercase tracking-wider">${escapeHTML(savedData.evt)}</span></div>`;
  if (!savedData.sec && !savedData.sub)
    return `<span class="text-gray-300 text-xs italic">-</span>`;
  return `<div class="flex flex-col bg-blue-50 border border-blue-100 p-2 rounded shadow-sm"><span class="font-bold text-blue-900 text-xs">${escapeHTML(savedData.sec || "")}</span><span class="text-gray-600 text-[11px]">${escapeHTML(savedData.sub || "")}</span></div>`;
}

function getTableDataFromDOM() {
  const rows = document.querySelectorAll("#scheduleTableBody tr");
  const jsonData = [];
  rows.forEach((tr) => {
    const type = tr.dataset.rowType;

    let startInput =
      tr.querySelector(".time-start.flatpickr-input") ||
      tr.querySelector(".time-start");
    let endInput =
      tr.querySelector(".time-end.flatpickr-input") ||
      tr.querySelector(".time-end");

    if (!startInput) return;

    const startTime = startInput.value;
    const endTime = endInput.value;

    if (type === "constant") {
      jsonData.push({
        type: "constant",
        startTime,
        endTime,
        eventName: tr.querySelector(".event-input").value,
      });
    } else {
      const extractCell = (day) => {
        const sec=tr.querySelector(`.${day}-sec`).value;
        const cell={
          sec,
          sub: tr.querySelector(`.${day}-sub`).value,
          evt: tr.querySelector(`.${day}-evt`).value,
        };
        // Preserve the current legacy JSON shape. Newer timetable rows keep
        // the section grade so lesson filtering no longer needs inference.
        if(!isLegacySharedScope(currentScope())){
          cell.grade=resolveSectionGrade(sec,{catalogSections:schoolOptions?.catalogs?.sections||[]});
        }
        return cell;
      };
      jsonData.push({
        type: "class",
        startTime,
        endTime,
        mon: extractCell("mon"),
        tue: extractCell("tue"),
        wed: extractCell("wed"),
        thu: extractCell("thu"),
        fri: extractCell("fri"),
      });
    }
  });
  return jsonData;
}

window.adminervaScheduleBridgeState=function(){
  const scope=currentScope();
  const rows=isEditing?getTableDataFromDOM():cachedRows(scope);
  return {schoolYear:scope.year,semester:scope.semester,rows:structuredClone(rows),editing:isEditing};
};
window.adminervaApplySchoolSchedule=function({
  schoolYear,semester,rows,revision,saved=false,compatibilityMode="legacy_allowed"
}){
  const scope=currentScope();
  if(scope.year!==schoolYear||scope.semester!==semester)
    throw Error("Switch the timetable to "+schoolYear+" · "+semester+" before loading this school schedule.");
  if(isEditing&&!saved&&!confirm("Discard the unsaved timetable edits in this view and load the verified-school schedule?"))
    return false;
  const normalized=Array.isArray(rows)?structuredClone(rows):[];
  cacheRows(scope,normalized,scheduleRowsToText(normalized));
  isEditing=false;draftRows=null;updateEditControls();renderTable();
  updateScopeStatus((saved?"Saved":"Loaded")+" verified-school schedule · revision "+revision+
    (compatibilityMode==="v4_only"?".":". Legacy personal cloud storage remains separate during migration."));
  return true;
};

window.saveScheduleData = async function (bypassValidation = false) {
  const jsonData = getTableDataFromDOM();

  if (!bypassValidation) {
    const intervals = [];
    for (let i = 0; i < jsonData.length; i++) {
      const row = jsonData[i];
      if (!row.startTime || !row.endTime) {
        alert(`Row ${i + 1} is missing a start or end time.`);
        return false;
      }

      const startMins = parseClockMinutes(row.startTime);
      const endMins = parseClockMinutes(row.endTime);
      if (startMins === null || endMins === null) {
        alert(`Row ${i + 1} has an invalid time. Use a 24-hour time like 08:00 or 13:30.`);
        return false;
      }

      if (startMins >= endMins) {
        alert(
          `Row ${i + 1} has an invalid time (End time must be after Start time).`,
        );
        return false;
      }
      intervals.push({ start: startMins, end: endMins, rowNum: i + 1 });
    }

    intervals.sort((a, b) => a.start - b.start);

    for (let i = 0; i < intervals.length - 1; i++) {
      if (intervals[i].end > intervals[i + 1].start) {
        alert(
          `🚨 Time Overlap Detected!\nRow ${intervals[i].rowNum} conflicts with Row ${intervals[i + 1].rowNum}. Please fix this before saving.`,
        );
        return false;
      }
    }
  }

  const rawTextForAI = scheduleRowsToText(jsonData);

  const scope = currentScope();
  cacheRows(scope, jsonData, rawTextForAI);

  if(isLegacySharedScope(scope)&&isLegacyScheduleRetired()){
    updateScopeStatus("Legacy timetable is archived and read-only.");
    alert("The 2026–2027 legacy timetable is archived. Create a timetable for the new school year to continue schedule-based lesson planning.");
    return false;
  }

  if (!db) {
    lessonStorage.setItem(scope.pendingKey, "1");
    updateScopeStatus("Saved on this device only (cloud unavailable).");
    alert("Schedule saved locally. Connect Firebase to sync it across devices.");
    return true;
  }

  window.showLoader("Saving selected semester to Firebase...");
  try {
    const ownerUid=await requireStaffWorkspace();
    if(mayUseSharedLegacySchedule()){
      await setDoc(doc(db,"app_config",scope.id),{
        school_year:scope.year,
        semester:scope.semester,
        json_data:JSON.stringify(jsonData),
        raw_text:rawTextForAI,
        last_updated:new Date().toISOString(),
        compatibility_mode:"legacy-2026-2027",
        updated_by_uid:ownerUid,
        updated_by_email:String(auth.currentUser?.email||"").toLowerCase(),
      },{merge:true});
      assertWorkspaceAccount(ownerUid);
      lessonStorage.removeItem(scope.pendingKey);
      updateScopeStatus("Saved shared legacy timetable. Admin and teacher accounts now use this same schedule.");
      return true;
    }
    const ref=ownedDoc(db,"schedules",scope.id);
    const next=await runTransaction(db,async transaction=>{
      const prior=await transaction.get(ref);
      assertWorkspaceAccount(ownerUid);
      const version=requireCurrentVersion(prior.exists()?prior.data():null,cloudVersion);
      if(prior.exists())transaction.set(ownedDoc(db,"schedules",scope.id,"revisions",String(version-1)),{...prior.data(),archivedRevisionAt:serverTimestamp()});
      transaction.set(ref, {ownerUid,version,
      school_year: scope.year,
      semester: scope.semester,
      json_data: JSON.stringify(jsonData),
      raw_text: rawTextForAI,
      last_updated: new Date().toISOString(),
      });
      return version;
    });
    cloudVersion=next;
    lessonStorage.setItem(scope.versionKey,String(next));
    lessonStorage.removeItem(scope.pendingKey);
    updateScopeStatus("Saved to cloud.");
    return true;
  } catch (error) {
    console.error("Schedule cloud save failed:", error);
    lessonStorage.setItem(scope.pendingKey, "1");
    updateScopeStatus("Saved on this device only. Cloud save failed; retry.");
    alert("Cloud save failed. Your edits remain in this device. Please retry Save Schedule. " + error.message);
    return false;
  } finally {
    window.hideLoader();
  }
};
