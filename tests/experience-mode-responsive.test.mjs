import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const text=path=>readFile(new URL(path,root),'utf8');

test('full experience is wired to all six home entrypoints',async()=>{
  const pages=['index.html','guest-home.html','student-home.html','teacher-home.html','school-admin.html','owner-schools.html'];
  for(const page of pages){
    const source=await text(page);
    assert.ok(source.includes('css/experience-mode.css'),'missing experience CSS in '+page);
    assert.ok(source.includes('js/core/experience-mode.mjs'),'missing experience module in '+page);
  }
});
test('Pulse and Opportunity Hunter expose explicit scene chapters',async()=>{
  for(const page of ['opportunities.html','pulse.html']){
    const source=await text(page);
    assert.ok(source.includes('css/experience-mode.css'),'missing experience CSS in '+page);
    assert.ok(source.includes('js/core/cinematic-navigation.mjs'),'missing chapter module in '+page);
    assert.equal([...source.matchAll(/data-cine-chapter="\d+"/g)].length,3,page+' must have three scroll chapters');
  }
});
test('responsive experience has tablet and both phone orientations as first-class modes',async()=>{
  const css=await text('css/experience-mode.css');
  assert.match(css,/@media\(max-width:900px\) and \(orientation:portrait\)/);
  assert.match(css,/@media\(max-width:600px\) and \(orientation:portrait\)/);
  assert.match(css,/@media\(max-height:620px\) and \(orientation:landscape\) and \(pointer:coarse\)/);
  assert.match(css,/@media\(min-width:700px\) and \(max-width:1180px\) and \(orientation:landscape\) and \(min-height:621px\)/);
  assert.match(css,/scroll-snap-type:x mandatory/);
  assert.match(css,/100dvh/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});
test('experience modules preserve quick mode and avoid private data dependencies',async()=>{
  const [experience,chapter]=await Promise.all([
    text('js/core/experience-mode.mjs'),text('js/core/cinematic-navigation.mjs')
  ]);
  for(const source of [experience,chapter]){
    assert.match(source,/Full experience/);
    assert.match(source,/Quick mode/);
    assert.match(source,/prefers-reduced-motion/);
    assert.doesNotMatch(source,/firebase|firestore|studentId|schoolId|grade|enrollmentId|accessToken/i);
  }
  assert.match(experience,/loadPublicReleases/);
  assert.match(experience,/loadPublicChannel/);
  assert.match(experience,/catch\{\/\* Private browsing\/storage denial/);
});
test('role command-stage destinations exist',async()=>{
  const routes=[
    'student-classroom.html','student-dashboard.html','student-practice.html',
    'assessment-studio.html','repofetch.html','class-record.html',
    'people-access.html','school-enrollment.html','school-academic-structure.html',
    'system-users.html','issues.html','patch-notes.html'
  ];
  for(const route of routes)await assert.doesNotReject(access(new URL(route,root)),route+' must exist');
});
test('public full experience retains authoritative dynamic sources and routes',async()=>{
  const source=await text('js/core/experience-mode.mjs');
  for(const route of ['guest-playground.html','opportunities.html','guest-practice.html','pulse.html','enroll.html','login.html?continue=1']){
    assert.ok(source.includes(route),'missing public journey route '+route);
  }
  assert.match(source,/patch-notes\.html\?version=/);
  assert.match(source,/loadPublicChannel\('opportunities'/);
  assert.match(source,/loadPublicChannel\('experiences'/);
});
