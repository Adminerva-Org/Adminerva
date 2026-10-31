/** Regression coverage: Shared navigation, account access, reporting and release infrastructure: feedback format. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanGradeFeedback, formatStructuredFeedback } from './feedback-format.mjs';

test('hides legacy internal draft prefix without removing student feedback', () => {
 assert.equal(cleanGradeFeedback('[AI DRAFT - REVIEW CONTRIBUTIONS BEFORE PUBLISHING] Your Java code works.'),
  'Your Java code works.');
});
test('removes repeated legacy prefixes', () => {
 assert.equal(cleanGradeFeedback('[AI DRAFT - REVIEW CONTRIBUTIONS BEFORE PUBLISHING] [AI DRAFT - REVIEW CONTRIBUTIONS BEFORE PUBLISHING] Test your input.'),
  'Test your input.');
});
test('preserves ordinary feedback including teacher considerations', () => {
 assert.equal(cleanGradeFeedback('[Consideration] Extra time approved.'),'[Consideration] Extra time approved.');
 assert.equal(cleanGradeFeedback(null),'');
});

test('separates standard evaluation feedback labels into readable paragraphs', () => {
  const input='Verified accomplishments: Built the assigned screen. Score-affecting issues: Generic IDs remain. Recommended improvements: Rename the views.';
  assert.equal(formatStructuredFeedback(input),
    'Verified accomplishments: Built the assigned screen.\n\nScore-affecting issues: Generic IDs remain.\n\nRecommended improvements: Rename the views.');
});
test('structured feedback formatting is idempotent and preserves ordinary feedback', () => {
  const structured='Verified accomplishments: Built the screen.\n\nScore-affecting issues: None.\n\nRecommended improvements: Keep refining spacing.';
  assert.equal(formatStructuredFeedback(structured),structured);
  assert.equal(formatStructuredFeedback('Clear work overall. Keep refining the layout.'),'Clear work overall. Keep refining the layout.');
});
