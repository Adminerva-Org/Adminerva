import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const text=path=>readFile(new URL(path,root),'utf8');

test('shared immersive engine is wired to all six public and role entrypoints',async()=>{
  for(const page of ['index.html','guest-home.html','student-home.html','teacher-home.html','school-admin.html','owner-schools.html']){
    const source=await text(page);
    assert.ok(source.includes('css/experience-mode.css'),'missing experience CSS in '+page);
    assert.ok(source.includes('js/core/experience-mode.mjs'),'missing experience module in '+page);
  }
  await assert.doesNotReject(access(new URL('js/core/experience-world.mjs',root)));
});
test('active surfaces retire orbit, constellation, particle and cinematic chapter layers',async()=>{
  const [publicHome,guestHome,opportunities,pulse,experience,css]=await Promise.all([
    text('index.html'),text('guest-home.html'),text('opportunities.html'),text('pulse.html'),
    text('js/core/experience-mode.mjs'),text('css/experience-mode.css')
  ]);
  for(const source of [publicHome,guestHome])assert.doesNotMatch(source,/public-universe\.(?:css|mjs)/);
  for(const source of [opportunities,pulse])assert.doesNotMatch(source,/editorial-cinematic\.css|editorial-motion\.mjs|cinematic-navigation\.mjs|data-cine-|av-cine-/);
  assert.doesNotMatch(experience,/avfx-orbit|radar|particle|constellation/i);
  assert.doesNotMatch(css,/\.avfx-orbit|\.av-universe|\.av-cine-particles/);
});
test('responsive experience treats desktop tablet phone and short landscape as separate compositions',async()=>{
  const css=await text('css/experience-mode.css');
  assert.match(css,/@media \(min-width:901px\) and \(max-width:1180px\)/);
  assert.match(css,/@media \(min-width:700px\) and \(max-width:1180px\) and \(orientation:landscape\) and \(min-height:621px\)/);
  assert.match(css,/@media \(min-width:700px\) and \(max-width:900px\) and \(orientation:portrait\)/);
  assert.match(css,/@media \(max-width:699px\) and \(orientation:portrait\)/);
  assert.match(css,/@media \(max-width:430px\) and \(orientation:portrait\)/);
  assert.match(css,/@media \(max-height:620px\) and \(orientation:landscape\) and \(pointer:coarse\)/);
  assert.match(css,/env\(safe-area-inset-right\)/);
  assert.match(css,/@media \(pointer:coarse\)/);
  assert.match(css,/@media \(prefers-reduced-motion:reduce\)/);
  assert.doesNotMatch(css,/scroll-snap-type/);
});
test('mode control is compact dialog based and preserves existing mode preference key',async()=>{
  const world=await text('js/core/experience-world.mjs');
  assert.match(world,/mountExperienceMode/);
  assert.match(world,/avx-view-trigger/);
  assert.match(world,/showModal/);
  assert.match(world,/Full Experience/);
  assert.match(world,/Quick Mode/);
  assert.match(world,/adminerva:experience-mode:/);
  assert.match(world,/prefers-reduced-motion/);
  assert.doesNotMatch(world,/firebase|firestore|schoolId|studentId|accessToken/i);
});
test('role runways point only to existing destinations and hand back to operational dashboards',async()=>{
  const routes=['student-classroom.html','student-dashboard.html','student-practice.html','assessment-studio.html','repofetch.html','class-record.html','people-access.html','school-enrollment.html','school-academic-structure.html','system-users.html','issues.html','patch-notes.html'];
  for(const route of routes)await assert.doesNotReject(access(new URL(route,root)),route+' must exist');
  const source=await text('js/core/experience-mode.mjs');
  assert.match(source,/Continue to operational dashboard/);
  assert.match(source,/authoritative dashboard/);
});
test('public full experience uses canonical public channels and real routes only',async()=>{
  const source=await text('js/core/experience-mode.mjs');
  assert.match(source,/loadPublicReleases\(\)/);
  assert.match(source,/loadPublicChannel\('experiences'/);
  assert.match(source,/loadPublicChannel\('opportunities'/);
  for(const route of ['guest-playground.html','opportunities.html','guest-practice.html','pulse.html','enroll.html','login.html?continue=1'])assert.ok(source.includes(route),'missing route '+route);
});


test('full experience escapes legacy centered shells and integrates public navigation',async()=>{
  const [css,experience]=await Promise.all([text('css/experience-mode.css'),text('js/core/experience-mode.mjs')]);
  assert.match(css,/\.avx-world-shell\{[^}]*width:100vw/);
  assert.match(css,/margin-left:calc\(50% - 50vw\)/);
  assert.match(css,/data-adminerva-experience="full"\] \.av-public-shell/);
  assert.match(experience,/const journey=el\('div','avx-world-shell'\)/);
  assert.doesNotMatch(experience,/el\('section','avx-(?:world-shell|threshold|route-section|current-section|crossing)'/);
});
