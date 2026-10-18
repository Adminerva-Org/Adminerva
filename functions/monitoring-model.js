/** Packaged monitoring schema and bounded, non-grading summaries; parity-tested against the browser model. */
const PAGES = ["home", "project", "assessments", "playground", "xml-lab", "practice", "review", "grades", "lessons", "slides", "analytics", "reports", "settings", "other"];
const ACTIONS = ["page-open", "active-time", "help-open", "run", "save", "evaluate", "submit", "withdraw"];
const TEACHER_EMAIL = "josephsixson@mcstayuman.edu.ph";
const EVENT_LIMIT = 500;
const STUDENT_LIMIT = 100;
const WINDOW_DAYS = 7;
function summarizeActivity(events, {now = Date.now(), since = now - WINDOW_DAYS * 86400000} = {}) {
  const students = new Map();
  for (const event of events) {
    const time = event.createdAt?.toMillis?.() ?? event.createdAt;
    if (!Number.isFinite(time) || time < since || time > now || !event.studentId || !PAGES.includes(event.page) || !ACTIONS.includes(event.action)) continue;
    let row = students.get(event.studentId);
    if (!row) { row = {studentId:event.studentId, sessions:new Set(), activeSeconds:0, days:new Set(), modules:{}}; students.set(event.studentId, row); }
    row.days.add(new Date(time).toISOString().slice(0, 10));
    if (event.action === "page-open" && typeof event.sessionId === "string") row.sessions.add(event.sessionId + ":" + event.page);
    const seconds = event.action === "active-time" && Number.isInteger(event.activeSeconds) ? Math.max(0, Math.min(60, event.activeSeconds)) : 0;
    row.activeSeconds += seconds;
    row.modules[event.page] = (row.modules[event.page] || 0) + seconds;
  }
  return [...students.values()].map(({sessions, days, ...row}) => ({...row, visits:sessions.size, days:days.size}));
}
function validSettings(value) {
  return value && typeof value.cleanupEnabled === "boolean" && typeof value.summaryRefreshEnabled === "boolean" && Number.isInteger(value.revision) && value.revision > 0;
}
function mayIncludeEvent(event, preference, student, identity, sections) {
  return Boolean(preference?.enabled === true && preference.ownerUid === event.ownerUid &&
    preference.studentId === event.studentId && student && sections.includes(student.section) &&
    identity?.emailVerified === true && !identity.disabled && typeof student.email === "string" &&
    typeof identity.email === "string" && student.email.toLowerCase() === identity.email.toLowerCase());
}
module.exports = {PAGES, ACTIONS, TEACHER_EMAIL, EVENT_LIMIT, STUDENT_LIMIT, WINDOW_DAYS, summarizeActivity, validSettings, mayIncludeEvent};
