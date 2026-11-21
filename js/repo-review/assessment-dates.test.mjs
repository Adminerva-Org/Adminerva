/** Regression coverage: Assessment authoring, repository evidence, individual review and protected grading: assessment dates. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateDeploymentDates,rescheduleLegacyDeployment} from './assessment-dates.mjs';

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
  const html=readFileSync('js/assessment/assessment-studio-library-shell.mjs','utf8');
  assert.doesNotMatch(code,/minDate:\s*["']today["']/);
  assert.match(code,/validateDeploymentDates/);
  assert.match(html,/original date it was assigned in class/);
});

test('legacy Mini PETA deadline extension preserves the original section, opening date and evidence metadata',()=>{
  const historical={id:'legacy-deploy-1',section:'Grade 12 ICT',postDate:'2026-10-08T16:10:00.000Z',
    deadline:'2026-11-20T15:59:59.999Z',deadlineEnabled:true,allowLateSubmissions:false,
    originalTeacherUid:'instructor',createdAt:'2026-10-08T16:10:00.000Z'};
  const updated=rescheduleLegacyDeployment(historical,{
    deadlineEnabled:true,deadline:'2026-12-04T15:59:59.999Z',allowLateSubmissions:true
  });
  assert.equal(updated.postDate,historical.postDate);
  assert.equal(updated.section,historical.section);
  assert.equal(updated.id,historical.id);
  assert.equal(updated.createdAt,historical.createdAt);
  assert.equal(updated.originalTeacherUid,historical.originalTeacherUid);
  assert.equal(updated.deadline,'2026-12-04T15:59:59.999Z');
  assert.equal(updated.allowLateSubmissions,true);
  assert.equal(historical.allowLateSubmissions,false);
  assert.equal(historical.deadline,'2026-11-20T15:59:59.999Z');
});
test('enabling late submissions without changing the due date preserves its exact historical timestamp',()=>{
  const historical={id:'d1',section:'ICT',postDate:'2026-10-09T02:25:36.765Z',
    deadline:'2026-11-20T11:27:43.432Z',deadlineEnabled:true,allowLateSubmissions:false};
  const updated=rescheduleLegacyDeployment(historical,{
    deadlineEnabled:true,deadline:historical.deadline,allowLateSubmissions:true
  });
  assert.equal(updated.deadline,historical.deadline);
  assert.equal(updated.postDate,historical.postDate);
  assert.equal(updated.allowLateSubmissions,true);
});
test('disabling the deadline does not erase the historical issue date or prior due date',()=>{
  const historical={id:'d2',section:'ICT',postDate:'2026-10-09T02:25:36.765Z',
    deadline:'2026-11-20T11:27:43.432Z',deadlineEnabled:true,allowLateSubmissions:false};
  const updated=rescheduleLegacyDeployment(historical,{
    deadlineEnabled:false,deadline:null,allowLateSubmissions:true
  });
  assert.equal(updated.postDate,historical.postDate);
  assert.equal(updated.deadline,historical.deadline);
  assert.equal(updated.deadlineEnabled,false);
  assert.equal(updated.allowLateSubmissions,false);
});
test('legacy schedule refuses a deadline earlier than the original issue date',()=>{
  assert.throws(()=>rescheduleLegacyDeployment({
    id:'d3',section:'ICT',postDate:'2026-11-21T10:00:00Z',deadline:'2026-12-04T10:00:00Z'
  },{deadlineEnabled:true,deadline:'2026-11-20T10:00:00Z',allowLateSubmissions:false}),/on or before/);
});
test('historical deployments have a separate deployed-tab route and explicit legacy edit deep links',()=>{
  const library=readFileSync('js/repo-review/teacher-assessment-library.mjs','utf8');
  const controller=readFileSync('js/repo-review/assessment-studio.js','utf8');
  const html=readFileSync('repository-assessment-studio.html','utf8');
  assert.match(library,/list_legacy_deployments/);
  assert.match(library,/legacyDeployment:assigned\.id/);
  assert.match(controller,/route\.get\("legacyDeployment"\)/);
  assert.match(controller,/window\.openDeployModal\(deploymentId\)/);
  assert.match(html,/id="deployEditDeadline"/);
});
