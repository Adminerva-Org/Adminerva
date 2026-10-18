/** Privacy boundary: allowlisted activity, foreground-time accounting and non-grading summaries. */
export const PAGES = Object.freeze(["home", "project", "assessments", "playground", "xml-lab", "practice", "review", "grades", "lessons", "slides", "analytics", "reports", "settings", "other"]);
export const ACTIONS = Object.freeze(["page-open", "active-time", "help-open", "run", "save", "evaluate", "submit", "withdraw"]);
export function pageForPath(pathname) {
  const page = String(pathname).split("/").pop().toLowerCase();
  return ({
    "index.html":"home", "student-home.html":"home", "teacher-home.html":"home",
    "student-dashboard.html":"project", "repobank.html":"project",
    "student-assessments.html":"assessments", "assessment-studio.html":"assessments",
    "student-playground.html":"playground", "student-xml-lab.html":"xml-lab", "student-practice.html":"practice",
    "repofetch.html":"review", "submissions.html":"review", "assessment-evidence-review.html":"review", "contribution-inspector.html":"review", "group-inspector.html":"review", "activity-grader.html":"review",
    "gradebook.html":"grades", "student-grades.html":"grades",
    "lesson-planner.html":"lessons", "library.html":"lessons", "schedule.html":"lessons", "presentation.html":"slides",
    "teacher-analytics.html":"analytics", "admin-analytics.html":"analytics", "practice-analytics.html":"analytics",
    "issues.html":"reports", "settings.html":"settings", "student-settings.html":"settings", "users.html":"settings"
  })[page] || "other";
}
export function safeStep(page, action) {
  return PAGES.includes(page) && ACTIONS.includes(action) ? {page, action} : null;
}
export function activeInterval({previous, now, lastInput, visible, focused}) {
  if (!visible || !focused || now < previous || now - previous > 65000) return 0;
  return Math.max(0, Math.min(now, lastInput + 60000) - previous) / 1000;
}
export function summarizeActivity(events, {now = Date.now(), since = now - 7 * 86400000} = {}) {
  const students = new Map();
  for (const event of events) {
    const time = event.createdAt?.toMillis?.() ?? event.createdAt;
    if (!Number.isFinite(time) || time < since || time > now || !event.studentId || !safeStep(event.page, event.action)) continue;
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
export function diagnosticPayload(steps) {
  const clean = steps.map(step => safeStep(step.page, step.action)).filter(Boolean).slice(-20);
  return {pages:clean.map(step => step.page), actions:clean.map(step => step.action)};
}
