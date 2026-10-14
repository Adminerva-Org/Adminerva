import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanGradeFeedback } from './feedback-format.mjs';

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
