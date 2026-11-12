import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';

const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const student=source('student-playground.html');
const guest=source('guest-playground.html');
const style=source('css/playground-workspace.css');
const main=source('js/student/playground.js');
const variant=source('js/student/studio-assessment-variant.mjs');
const submit=source('js/student/studio-assessment-submit.mjs');

for(const [name,page] of [['student',student],['guest',guest]]){
  for(const id of ['studioMobileMore','studioMobileToolsToggle','studioMobileTask',
    'studioAssignmentDock','studioTaskClose','studioToolsPanel','studioMobileBackdrop']){
    assert.equal((page.match(new RegExp('id="'+id+'"','g'))||[]).length,1,
      name+' needs exactly one '+id);
  }
  const header=page.slice(page.indexOf('<div class="studio-project-bar">'),
    page.indexOf('<nav class="studio-tabs"'));
  assert.match(header,/id="studioMobileMore"[\s\S]*id="studioMobileToolsToggle"[\s\S]*id="studioMobileTask"/,
    name+' mobile Menus, Tools and Task must share the same project header');
  const tabs=page.slice(page.indexOf('<nav class="studio-tabs"'),
    page.indexOf('</nav>',page.indexOf('<nav class="studio-tabs"')));
  assert.ok(!tabs.includes('id="studioMobileToolsToggle"'),
    'the Tools trigger should not consume a second row');
  assert.ok(page.indexOf('id="studioAssignmentDock"')<
    page.indexOf('<div class="studio-project-bar">'));
  assert.match(page,/css\/playground-workspace\.css\?v=3\.0\.9/);
  assert.ok(page.includes('-mobiletask1'),name+' must refresh JS cache');
}
assert.match(student,/id="studioTaskOverview"/);
assert.match(student,/id="studioTaskSubmitShortcut"/);
assert.match(student,/id="studioSubmitDetails"/);
assert.ok(!guest.includes('id="studioTaskSubmitShortcut"'),
  'guest Studio must not show assessment submission actions');
assert.match(style,/\.studio-tabs\.studio-tabs-expanded/);
assert.match(style,/\.studio-assignment-dock\.studio-assignment-open/);
assert.match(style,/#studioPersonalizedTaskPrompt/);
assert.match(main,/const taskAvailable=\(\)=>taskLink/);
assert.match(main,/taskDock\?\.setAttribute\('aria-modal','true'\)/);
assert.match(main,/setToolsOpen\(false\)/);
assert.match(variant,/showOverview\(task\.data\(\)\)/);
assert.match(variant,/overviewText\.textContent/);
assert.match(submit,/const eligibility=studioSubmissionAllowed\(task,chosen\.student\.section\)/);
assert.ok(!/window\.addEventListener\("adminerva:studio-ready",\(\)=>\{\s*button\.click\(\)/.test(submit),
  'opening an assignment should not automatically open its submission dialog');
console.log('Mobile Studio header, task drawer and assessment submission UX contracts passed.');
