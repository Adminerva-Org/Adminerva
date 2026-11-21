import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");

test("V4 student settings is the canonical profile, account and integration surface",()=>{
  const html=read("school-student-settings.html");
  for(const id of ["profile","account-access","connected-services","preferences","privacy-support"])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(html,/data-account-preferences="student"/);
  assert.match(html,/studentSettingsGithubConnect/);
  assert.doesNotMatch(html,/student-dashboard\.html/);
});

test("student GitHub OAuth is shared between Settings and Project Hub",()=>{
  const session=read("js/student/github-session.mjs");
  const settings=read("js/student/school-student-settings.mjs");
  const projects=read("js/student/school-student-projects.mjs");
  assert.match(session,/prepareRecoveredGithubLink/);
  assert.match(session,/GithubAuthProvider\.credentialFromError/);
  assert.match(session,/linkWithCredential/);
  assert.match(session,/Adminerva_GitHub_/);
  assert.match(settings,/authorizeGithubSession/);
  assert.match(settings,/getGithubSession/);
  assert.match(projects,/authorizeGithubSession/);
  assert.match(projects,/getGithubSession/);
  assert.doesNotMatch(projects,/GithubAuthProvider,linkWithPopup,reauthenticateWithPopup/);
});

test("verified school students route gear and repository settings to V4 Settings",()=>{
  const nav=read("js/core/adminerva-nav.js");
  const ia=read("js/core/navigation-ia.mjs");
  assert.match(nav,/studentSettingsRoute = hasSchoolStudent \? "school-student-settings\.html" : "student-settings\.html"/);
  assert.match(ia,/Project & GitHub Settings/);
  assert.match(ia,/settings\+"#connected-services"/);
  assert.match(ia,/Settings & Profile/);
});

test("staff settings separates common account controls from teaching-only defaults",()=>{
  const html=read("settings.html");
  const core=read("js/settings/settings-core.js");
  const roles=read("js/settings/role-settings.mjs");
  assert.match(html,/Account &amp; notifications/);
  assert.match(html,/Teaching defaults/);
  assert.match(html,/id="panel-account" class="settings-panel block/);
  assert.match(html,/id="panel-security" data-teaching-settings/);
  assert.match(html,/id="panel-rubrics" data-teaching-settings/);
  assert.match(core,/requested : "account"/);
  assert.match(core,/window\.initializeTeachingSettings/);
  assert.match(roles,/role==="teacher"\|\|root\?\.dataset\.schoolTeacher==="true"/);
  assert.match(roles,/window\.initializeTeachingSettings\?\.\(\)/);
  assert.match(roles,/if\(role==="student"\)/);
});
