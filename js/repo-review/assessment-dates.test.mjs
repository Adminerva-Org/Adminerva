/** Regression coverage: Assessment authoring, repository evidence, individual review and protected grading: assessment dates. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateDeploymentDates} from './assessment-dates.mjs';

test('retroactive October 9 launch and October 23 extension is allowed',()=>{
  assert.equal(validateDeploymentDates({
    postDate:'2026-10-08T16:00:00.000Z',
    deadline:'2026-10-23T15:59:59.999Z',
    deadlineEnabled:true
  }),null);
});
test('invalid deployment windows are rejected',()=>{
  assert.match(validateDeploymentDates({postDate:'2026-10-24',deadline:'2026-10-23',deadlineEnabled:true}),/on or before/);
  assert.match(validateDeploymentDates({postDate:'2026-10-09',deadline:'',deadlineEnabled:true}),/both/);
  assert.match(validateDeploymentDates({postDate:'invalid',deadline:'2026-10-23',deadlineEnabled:true}),/valid/);
});
test('legacy no-deadline deployment remains supported',()=>{
  assert.equal(validateDeploymentDates({deadlineEnabled:false}),null);
});
test('date-picker accepts past issue dates and UI explains why',()=>{
  const code=readFileSync('js/repo-review/assessment-studio.js','utf8');
  const html=readFileSync('assessment-studio.html','utf8');
  assert.doesNotMatch(code,/minDate:\s*["']today["']/);
  assert.match(code,/validateDeploymentDates/);
  assert.match(html,/original date it was assigned in class/);
});
