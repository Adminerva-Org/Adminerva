/** Regression coverage: Shared navigation, account access, reporting and release infrastructure: notification routing. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {notificationTarget, previewDestination} from './notification-routing.mjs';

test('allows only local Adminerva notification destinations',()=>{
  assert.equal(notificationTarget('issues.html?issue=report_123'), 'issues.html?issue=report_123');
  assert.equal(notificationTarget('submissions.html'),'submissions.html');
  assert.equal(notificationTarget('repofetch.html'),'repofetch.html');
  for(const bad of ['https://evil.example/','//evil.example','javascript:alert(1)',
    '../settings.html','login.html','issues.html#evil','issues.html?next=//evil.example']){
    assert.equal(notificationTarget(bad),'issues.html');
  }
});
test('routes grading and student submissions to different pages',()=>{
  assert.equal(previewDestination('grading'),'repofetch.html');
  assert.equal(previewDestination('submission'),'submissions.html');
  assert.equal(previewDestination('grade'),'student-assessments.html');
  assert.equal(previewDestination('issue'),'issues.html');
});
