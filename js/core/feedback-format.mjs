/**
 * Normalize grade feedback for display and future saves.
 * Legacy reviewer-status text belongs in grade metadata, never feedback.
 * Structured evaluation labels are kept as plain text but separated into
 * readable paragraphs so the same stored string works in textareas, previews
 * and student-facing grade views.
 */
const OLD_REVIEW_PREFIX = /^\s*\[\s*AI\s+DRAFT\s*[-–—:]\s*REVIEW\s+CONTRIBUTIONS\s+BEFORE\s+PUBLISHING\s*\]\s*/i;

export function formatStructuredFeedback(value) {
  let text = String(value ?? '').replace(/\r\n?/g, '\n').trim();
  if (!text) return '';

  text = text
    .replace(/\s*(Verified accomplishments:)\s*/i, '$1 ')
    .replace(/\s*(Score-affecting issues:)\s*/i, '\n\n$1 ')
    .replace(/\s*(Recommended improvements:)\s*/i, '\n\n$1 ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

export function cleanGradeFeedback(value) {
  let text = String(value ?? '');
  // Support duplicate legacy markers without erasing arbitrary bracketed notes.
  for (let i = 0; i < 3 && OLD_REVIEW_PREFIX.test(text); i++) {
    text = text.replace(OLD_REVIEW_PREFIX, '');
  }
  return formatStructuredFeedback(text);
}
