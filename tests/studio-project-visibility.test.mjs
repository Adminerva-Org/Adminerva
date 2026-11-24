import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const html=read("student-playground.html");
const css=read("css/playground-workspace.css");
const ui=read("js/student/playground.js");
const projects=read("js/student/project-studio.mjs");
const rules=read("firestore.rules");

test("one Task entry follows Projects, not an overlapping mobile/ribbon duplicate",()=>{
  const nav=html.slice(html.indexOf('class="studio-project-bar"'),html.indexOf('id="studioMobileActions"'));
  assert.ok(nav.indexOf('id="backToProjectsBtn"')>=0);
  assert.ok(nav.indexOf('id="studioMobileTask"')>nav.indexOf('id="backToProjectsBtn"'));
  assert.ok(nav.indexOf('id="studioMobileTask"')<nav.indexOf('id="activeProjectTitle"'));
  assert.doesNotMatch(ui,/studioRibbonTask|ribbonTaskButton/);
  assert.match(css,/#studioMobileTask:not\(\.hidden\)\{\s*display:inline-flex!important/);
  assert.match(css,/#studioMobileTask:focus-visible/);
  assert.match(ui,/const taskAvailable=\(\)=>taskLink/);
  assert.match(ui,/taskButton\?\.addEventListener\('click',\(\)=>showDrawer\('task'\)\)/);
});

test("archived school projects have a real entry and retain the existing restore route",()=>{
  assert.match(html,/id="archivedCodeProjectsBtn"/);
  assert.match(projects,/listArchivedV4StudioProjects\(\)/);
  assert.match(projects,/restoreV4StudioProject\(summary\.projectId,summary\.revision\)/);
});

test("V4-only project home discovers older same-account device and cloud copies",()=>{
  for(const id of ["studioEarlierProjects","studioEarlierProjectList","refreshEarlierProjectsBtn"])
    assert.ok(html.includes('id="'+id+'"'),"missing "+id);
  assert.match(projects,/if\(!scopeToken\|\|guest\|\|!cloudEnabled\)/);
  assert.match(projects,/readCodeProjects\(localStorage,uid\)/);
  assert.match(projects,/getDocsFromServer\(collection\(db,"student_code_projects",uid,"projects"\)\)/);
  assert.match(projects,/data\?\.ownerUid!==uid\|\|data\?\.id!==record\.id/);
  assert.match(projects,/auth\.currentUser\?\.uid===uid/);
  assert.match(rules,/match \/student_code_projects\/\{uid\}\/projects\/\{projectId\} \{\s*allow read: if signedIn\(\) && request\.auth\.uid == uid/);
});

test("recovery never changes the original assessment or promotes a personal copy into a submission",()=>{
  assert.match(projects,/state:clone\(project\.state\),database:clone\(project\.database\)/);
  assert.match(projects,/design:clone\(project\.design\),evidence:\{events:\[\],runs:\[\]\},assessment:null/);
  assert.match(projects,/createCodeProject\(projectStorage,uid,\{/);
  assert.match(projects,/if\(project\.assessment\?\.provisionedBy==="assessment-launch"\)\{/);
  assert.match(projects,/if\(isExam\)\{\s*location\.assign\("student-assessments\.html#"/);
  assert.doesNotMatch(projects.slice(projects.indexOf("async function loadEarlierProjects"),projects.indexOf("function renderProjectHome")),/deleteDoc\(|updateDoc\(/);
});

test("cache keys preserve the released task UI while advancing Studio runtime behavior",()=>{
  assert.match(html,/css\/playground-workspace\.css\?v=20261123-studio-task-history-1/);
  assert.match(html,/js\/student\/playground\.js\?v=20261124-account-diagnostics-1/);
  assert.match(ui,/project-studio\.mjs\?v=20261124-account-diagnostics-1/);
  assert.match(ui,/studio-runtime-integration\.mjs\?v=20261123-java-diagnostics-1/);
});
