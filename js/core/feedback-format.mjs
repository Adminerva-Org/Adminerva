/**
 * Normalize grade feedback for display and future saves.
 * Legacy reviewer-status text belongs in grade metadata, never feedback.
 * This deliberately removes only known Adminerva status markers from the
 * beginning of the field; it does not rewrite substantive student feedback.
 */
const OLD_REVIEW_PREFIX = /^\s*\[\s*AI\s+DRAFT\s*[-–—:]\s*REVIEW\s+CONTRIBUTIONS\s+BEFORE\s+PUBLISHING\s*\]\s*/i;
export function cleanGradeFeedback(value) {
  let text = String(value ?? '');
  // Support duplicate legacy markers without erasing arbitrary bracketed notes.
  for (let i = 0; i < 3 && OLD_REVIEW_PREFIX.test(text); i++) {
    text = text.replace(OLD_REVIEW_PREFIX, '');
  }
  return text.trim();
}
