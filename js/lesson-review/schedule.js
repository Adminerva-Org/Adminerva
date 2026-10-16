import { db } from "../core/firebase-core.js";
import { scheduleScope, parseScheduleRows } from "./schedule-scope.mjs";
import {
  doc,
  getDoc,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

let mySections = [];
let mySubjects = [];
let myEvents = [];
let isEditing = false;
let activeYear = "2026-2027";
let activeSemester = "S1";
let loadSerial = 0;
let isSaving = false;

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

function cacheRows(scope, rows, rawText) {
  localStorage.setItem(scope.jsonKey, JSON.stringify(rows));
  localStorage.setItem(scope.textKey, rawText);
}

function cachedRows(scope) {
  const local = localStorage.getItem(scope.jsonKey);
  if (local !== null) return parseScheduleRows(local);
  return scope.allowLegacy
    ? parseScheduleRows(localStorage.getItem("Adminerva_schedule_json"))
    : [];
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
    button.textContent = isEditing ? "Save Schedule" : "Edit Schedule";
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
  for (const id of ["addClassBtn", "addEventBtn"]) {
    const node = document.getElementById(id);
    if (!node) continue;
    node.classList.toggle("hidden", !isEditing);
    node.classList.toggle("flex", isEditing);
  }
}

async function initFirebase() {
  await fetchScheduleFromCloud();
}

async function fetchScheduleFromCloud() {
  const request = ++loadSerial;
  const scope = currentScope();
  let rows = cachedRows(scope);
  let raw = localStorage.getItem(scope.textKey);
  if (raw === null && scope.allowLegacy)
    raw = localStorage.getItem("Adminerva_schedule");
  let source = rows.length ? "Local copy" : "No schedule saved; choose Edit Schedule to enter one.";
  if (db) {
    window.showLoader("Loading selected semester schedule...");
    try {
      let snap = await getDoc(doc(db, "app_config", scope.id));
      let fromLegacy = false;
      // Existing first-semester timetables used one unscoped document.
      // Never import that document into a different semester or school year.
      if (!snap.exists() && scope.allowLegacy &&
          localStorage.getItem(scope.jsonKey) === null) {
        snap = await getDoc(doc(db, "app_config", "master_schedule"));
        fromLegacy = snap.exists();
      }
      if (snap.exists()) {
        const data = snap.data();
        rows = parseScheduleRows(data.json_data);
        raw = typeof data.raw_text === "string" ? data.raw_text : "";
        source = fromLegacy ? "Legacy timetable loaded; save to store this semester independently."
          : "Loaded from cloud.";
      }
    } catch (error) {
      console.warn("Schedule cloud fetch failed; using local copy:", error);
      source = "Cloud unavailable; showing local copy if available.";
    } finally {
      window.hideLoader();
    }
  }
  if (request !== loadSerial) return;
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

document.addEventListener("DOMContentLoaded", async () => {
  loadConfig();
  const year = localStorage.getItem("Adminerva_schedule_selected_year");
  const semester = localStorage.getItem("Adminerva_schedule_selected_semester");
  if (year) {
    try { scheduleScope(year, semester || "S1"); activeYear = year; }
    catch (error) { console.warn("Invalid saved school year:", error); }
  }
  if (semester === "S1" || semester === "S2") activeSemester = semester;
  syncPeriodInputs();
  document.getElementById("scheduleSchoolYear")?.addEventListener("change", window.changeSchedulePeriod);
  document.getElementById("scheduleSemester")?.addEventListener("change", window.changeSchedulePeriod);
  updateEditControls();
  await initFirebase();
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
  updateEditControls();
  activeYear = requestedYear;
  activeSemester = requestedSemester;
  localStorage.setItem("Adminerva_schedule_selected_year", activeYear);
  localStorage.setItem("Adminerva_schedule_selected_semester", activeSemester);
  await fetchScheduleFromCloud();
};
// --- MODAL & CONFIG LOGIC ---
window.openSettingsModal = function () {
  document.getElementById("configSections").value =
    localStorage.getItem("Adminerva_sections") || "";
  document.getElementById("configSubjects").value =
    localStorage.getItem("Adminerva_subjects") || "";
  document.getElementById("configEvents").value =
    localStorage.getItem("Adminerva_events") || "";

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
  localStorage.setItem(
    "Adminerva_sections",
    document.getElementById("configSections").value,
  );
  localStorage.setItem(
    "Adminerva_subjects",
    document.getElementById("configSubjects").value,
  );
  localStorage.setItem(
    "Adminerva_events",
    document.getElementById("configEvents").value,
  );

  // Keep existing unsaved edits when changing dropdown options. The user
  // explicitly saves the timetable with Save Schedule after reviewing it.
  if (isEditing) {
    const draft = getTableDataFromDOM();
    localStorage.setItem(currentScope().jsonKey, JSON.stringify(draft));
  }
  loadConfig();
  renderTable();
  closeSettingsModal();
};

function loadConfig() {
  mySections = (localStorage.getItem("Adminerva_sections") || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  mySubjects = (localStorage.getItem("Adminerva_subjects") || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  myEvents = (localStorage.getItem("Adminerva_events") || "")
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
    } finally {
      isSaving = false;
    }
  } else {
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

  // ⏱️ UPDATED: 45-minute interval logic
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

  localStorage.setItem(currentScope().jsonKey, JSON.stringify(savedJson));
  renderTable();
};

window.deleteRow = function (index) {
  const data = getTableDataFromDOM();
  data.splice(index, 1);
  localStorage.setItem(currentScope().jsonKey, JSON.stringify(data));
  renderTable();
};

function renderTable() {
  const tbody = document.getElementById("scheduleTableBody");
  tbody.innerHTML = "";

  const savedJson = cachedRows(currentScope());

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
      const extractCell = (day) => ({
        sec: tr.querySelector(`.${day}-sec`).value,
        sub: tr.querySelector(`.${day}-sub`).value,
        evt: tr.querySelector(`.${day}-evt`).value,
      });
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

      const startMins =
        Number(row.startTime.split(":")[0]) * 60 +
        Number(row.startTime.split(":")[1]);
      const endMins =
        Number(row.endTime.split(":")[0]) * 60 +
        Number(row.endTime.split(":")[1]);

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

  // FORMAT FOR THE AI
  let rawTextForAI = "TEACHER WEEKLY SCHEDULE:\n\n";
  const dayData = {
    Monday: [],
    Tuesday: [],
    Wednesday: [],
    Thursday: [],
    Friday: [],
  };
  const daysMap = {
    mon: "Monday",
    tue: "Tuesday",
    wed: "Wednesday",
    thu: "Thursday",
    fri: "Friday",
  };

  jsonData.forEach((row) => {
    if (!row.startTime) return;
    const timeBlock = `${formatTimeToAMPM(row.startTime)} - ${formatTimeToAMPM(row.endTime)}`;

    if (row.type === "constant" && row.eventName) {
      const eventStr = `[EVENT: ${row.eventName}]`;
      Object.values(daysMap).forEach((day) =>
        dayData[day].push(`${timeBlock}: ${eventStr}`),
      );
    } else if (row.type === "class") {
      Object.keys(daysMap).forEach((key) => {
        const cell = row[key];
        let cellText = null;
        if (cell.evt) cellText = `[EVENT: ${cell.evt}]`;
        else if (cell.sec && cell.sub) cellText = `${cell.sec} (${cell.sub})`;

        if (cellText) dayData[daysMap[key]].push(`${timeBlock}: ${cellText}`);
      });
    }
  });

  Object.keys(dayData).forEach((day) => {
    if (dayData[day].length > 0) {
      rawTextForAI += `[${day}]\n`;
      dayData[day].forEach((entry) => (rawTextForAI += `- ${entry}\n`));
      rawTextForAI += `\n`;
    }
  });

  // Save locally
  localStorage.setItem("Adminerva_schedule_json", JSON.stringify(jsonData));
  localStorage.setItem("Adminerva_schedule", rawTextForAI);

  // Save to Firebase (Cloud Sync)
  if (!db) {
    alert(
      "Saved locally, but Firebase is not connected. Check Global Settings to enable cloud sync.",
    );
    return true;
  }

  window.showLoader("Saving schedule to Firebase...");
  try {
    const docRef = doc(db, "app_config", "master_schedule");
    await setDoc(docRef, {
      json_data: JSON.stringify(jsonData),
      raw_text: rawTextForAI,
      last_updated: new Date().toISOString(),
    });
  } catch (e) {
    console.error("Firebase save error:", e);
    alert("Error saving to cloud. Data saved locally only. " + e.message);
  } finally {
    window.hideLoader();
  }

  return true;
};
