// Keep schedules independent by school year and semester.
// Legacy master_schedule may be used as the initial first-semester reference only.
export const LEGACY_SCHEDULE_YEAR = "2026-2027";

export function normalizeSchoolYear(value) {
  const year = String(value ?? "").trim();
  const match = /^([0-9]{4})-([0-9]{4})$/.exec(year);
  if (!match || Number(match[2]) !== Number(match[1]) + 1) {
    throw new Error("Use a valid school year, for example 2026-2027.");
  }
  return year;
}

export function scheduleSemester(academicTerm = "") {
  return String(academicTerm).toUpperCase().includes("SECOND SEMESTER") ? "S2" : "S1";
}

export function scheduleScope(schoolYear, semesterOrTerm) {
  const year = normalizeSchoolYear(schoolYear);
  const semester = String(semesterOrTerm).toUpperCase() === "S2"
    ? "S2" : scheduleSemester(semesterOrTerm);
  const id = "master_schedule_SY" + year.replace("-", "") + "_" + semester;
  return {
    year, semester, id,
    jsonKey: "Adminerva_schedule_json_" + id,
    textKey: "Adminerva_schedule_" + id,
    allowLegacy: semester === "S1" && year === LEGACY_SCHEDULE_YEAR,
  };
}

export function parseScheduleRows(value) {
  try {
    const rows = JSON.parse(value || "[]");
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export function localScheduleText(storage, schoolYear, academicTerm) {
  const scope = scheduleScope(schoolYear, academicTerm);
  const scoped = storage.getItem(scope.textKey);
  if (scoped !== null) return scoped;
  return scope.allowLegacy ? storage.getItem("Adminerva_schedule") || "" : "";
}
