import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");

test("V4 student settings is the canonical profile, account, services and preferences surface",()=>{
  const html=read("school-student-settings.html");
  for(const id of ["profile","account-access","connected-services","preferences"])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(html,/data-settings-surface="student"/);
  assert.match(html,/class="av-settings-shell"/);
  assert.match(html,/data-account-preferences="student"/);
  assert.match(html,/studentSettingsGithubConnect/);
  assert.doesNotMatch(html,/student-dashboard\.html/);
  assert.doesNotMatch(html,/id="privacy-support"/);
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
  const help=read("js/help/page-help.mjs");
  assert.match(nav,/studentSettingsRoute = hasSchoolStudent \? "school-student-settings\.html" : "student-settings\.html"/);
  assert.match(ia,/Project & GitHub Settings/);
  assert.match(ia,/settings\+"#connected-services"/);
  assert.match(ia,/Settings & Profile/);
  assert.match(help,/school-student-settings\.html/);
});

test("staff settings uses a two-column responsive shell and complete access context",()=>{
  const html=read("settings.html");
  const roles=read("js/settings/role-settings.mjs");
  const css=read("css/adminerva-ui.css");
  assert.match(html,/data-settings-surface="staff"/);
  assert.match(html,/class="av-settings-shell"/);
  assert.match(html,/id="settingsRoleChips"/);
  assert.match(html,/id="panel-account" class="settings-panel av-settings-panel block"/);
  assert.match(html,/id="panel-security" data-teaching-settings/);
  assert.match(html,/id="panel-rubrics" data-teaching-settings/);
  assert.match(roles,/schoolAdmin:Boolean/);
  assert.match(roles,/schoolTeacher:Boolean/);
  assert.match(roles,/roles\.map\(item=>item\.title\)\.join\(" · "\)/);
  assert.match(roles,/av-settings-role-chip/);
  assert.match(css,/\.av-settings-shell\{/);
  assert.match(css,/@media\(max-width:900px\)/);
});

test("non-teaching staff do not initialize teaching-only settings",()=>{
  const core=read("js/settings/settings-core.js");
  const roles=read("js/settings/role-settings.mjs");
  assert.match(core,/requested : "account"/);
  assert.match(core,/window\.initializeTeachingSettings/);
  assert.match(roles,/const canTeach=teachingAuthority\(context\)/);
  assert.match(roles,/node\.hidden=!canTeach/);
  assert.match(roles,/window\.initializeTeachingSettings\?\.\(\)/);
  assert.match(roles,/if\(role==="student"\)/);
});

test("activity privacy is integrated into personal settings instead of adding a third settings column",()=>{
  const prefs=read("js/settings/account-preferences.mjs");
  const activity=read("js/help/activity-preferences.mjs");
  assert.match(prefs,/data-activity-preferences/);
  assert.match(prefs,/Privacy & local data/);
  assert.match(activity,/!document\.querySelector\("\[data-account-preferences\]"\)/);
  assert.match(activity,/event\.target\.closest\?\.\("\[data-activity-preferences\]"\)/);
  assert.match(activity,/school-student-/);
});

test("notification choices follow the active role instead of showing teacher alerts to every staff role",()=>{
  const prefs=read("js/settings/account-preferences.mjs");
  assert.match(prefs,/if\(settingsRole\.canTeach\)/);
  assert.match(prefs,/return \[\["issue","Reports & replies"\],\["release","Website updates"\]\]/);
  assert.match(prefs,/adminerva:settings-role-context/);
});

test("legacy student and guest settings retain the same visual language",()=>{
  const student=read("student-settings.html");
  const guest=read("guest-settings.html");
  assert.match(student,/data-settings-surface="student"/);
  assert.match(student,/av-settings-page/);
  assert.match(student,/data-account-preferences="student"/);
  assert.match(guest,/data-settings-surface="guest"/);
  assert.match(guest,/av-settings-savebar/);
});
