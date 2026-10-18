/** Regression coverage: Assessment authoring, repository evidence, individual review and protected grading: grade revision snapshot. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { pickDefinedGradeFields } from './grade-revision-snapshot.mjs';

test('legacy draft without maxScore creates a Firestore-safe before snapshot', () => {
  const legacy = {score: 0, feedback: 'Earlier feedback', published: false};
  const before = {
    ...pickDefinedGradeFields(legacy, ['score', 'maxScore']),
    feedback: legacy.feedback || '',
    published: !!legacy.published,
    reviewRequired: !!legacy.reviewRequired,
    gradedSha: legacy.gradedSha || null,
    gradedAt: legacy.gradedAt || null,
  };
  assert.deepEqual(before, {
    score: 0, feedback: 'Earlier feedback', published: false,
    reviewRequired: false, gradedSha: null, gradedAt: null,
  });
  assert.equal(Object.hasOwn(before, 'maxScore'), false);
  assert.deepEqual(legacy, {score: 0, feedback: 'Earlier feedback', published: false});
});

test('existing score and maximum are preserved precisely, including zero', () => {
  assert.deepEqual(
    pickDefinedGradeFields({score: 0, maxScore: 20}, ['score', 'maxScore']),
    {score: 0, maxScore: 20}
  );
});

test('missing or undefined fields are excluded without fabricating values', () => {
  const source = {score: undefined, maxScore: undefined, feedback: undefined};
  assert.deepEqual(pickDefinedGradeFields(source, ['score', 'maxScore', 'feedback']), {});
  assert.deepEqual(pickDefinedGradeFields(null, ['score', 'feedback']), {});
});

test('manual review audit preserves previous fields if available', () => {
  const legacy = {score: 12, published: false};
  const before = {
    ...pickDefinedGradeFields(legacy, ['score', 'feedback']),
    published: !!legacy.published,
  };
  assert.deepEqual(before, {score: 12, published: false});
  assert.equal(Object.hasOwn(before, 'feedback'), false);
});

test('explicit null, false and empty values remain unchanged', () => {
  const source = {score: null, feedback: '', published: false};
  assert.deepEqual(
    pickDefinedGradeFields(source, ['score', 'feedback', 'published', 'maxScore']),
    {score: null, feedback: '', published: false}
  );
});
