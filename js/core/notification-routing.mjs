/**
 * Only open an Adminerva-owned page when following a notification.
 * Event bodies, URLs and report titles are untrusted strings.
 */
const PAGES = new Set([
  'issues.html', 'student-assessments.html', 'gradebook.html',
  'repofetch.html', 'submissions.html', 'student-dashboard.html', 'patch-notes.html'
]);
export function notificationTarget(value) {
  const raw=String(value||'');
  const match=raw.match(/^([a-z-]+\.html)(?:\?([A-Za-z0-9%_.=&-]+))?$/);
  if(!match || !PAGES.has(match[1]))return 'issues.html';
  return raw;
}
export function previewDestination(type) {
  switch(type) {
    case 'grading': return 'repofetch.html';
    case 'submission': return 'submissions.html';
    case 'grade': return 'student-assessments.html';
    default: return 'issues.html';
  }
}
