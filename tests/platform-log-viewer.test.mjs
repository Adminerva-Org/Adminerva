import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");

const users=read("system-users.html");
const usersClient=read("js/core/platform-users.mjs");
const page=read("platform-logs.html");
const viewer=read("js/core/platform-logs.mjs");
const css=read("css/platform-logs.css");
const navigation=read("js/core/navigation-ia.mjs");
const workflow=read("js/core/platform-admin-workflow.mjs");
const guard=read("js/core/auth-guard-v4-pilot.js");
const backend=read("functions/platform-account-diagnostics.js");

test("log inspection is a separate read-only page and no longer embedded in Users",()=>{
  assert.doesNotMatch(users,/id="pu-diagnostic-(?:load|events|audit|next|reason|status)"/);
  assert.doesNotMatch(usersClient,/function loadDiagnostics\(/);
  assert.doesNotMatch(usersClient,/resetDiagnostics|pu-diagnostic-/);
  assert.doesNotMatch(usersClient,/platformAccountDiagnostics/);
  assert.match(users,/id="pu-open-logs"[^>]*href="platform-logs.html"/);
  assert.match(usersClient,/el\("pu-open-logs"\)\.href="platform-logs\.html\?uid="/);
  assert.match(page,/User Action &amp; System Logs/);
  assert.match(page,/id="pl-reason"/);
  assert.match(page,/id="pl-accounts"/);
  assert.match(page,/id="pl-events"/);
  assert.match(page,/id="pl-more"/);
  assert.doesNotMatch(page,/id="pu-(?:create|lifecycle|platform-authority|save-profile)"/);
});

test("Log Viewer loads the shared Tailwind navigation and safely contains notifications",()=>{
  assert.match(page,/<script defer src="https:\/\/cdn\.tailwindcss\.com"><\/script>/);
  assert.match(page,/adminerva-nav\.js\?v=/);
  assert.match(css,/#adminerva-nav #av-alert-panel\.hidden\{display:none!important\}/);
  assert.match(css,/#adminerva-nav #av-alert-panel\{[\s\S]*?position:absolute/);
  assert.match(css,/@media\(max-width:640px\)\{[\s\S]*?#adminerva-nav #av-alert-panel/);
});

test("separate logs route retains platform administration role guards and canonical navigation",()=>{
  assert.match(guard,/owner-schools\|system-users\|platform-logs/);
  assert.match(navigation,/live\("platform-logs","User Action & System Logs","platform-logs\.html"/);
  assert.match(workflow,/file:"platform-logs\.html",label:"User Action & System Logs"/);
  assert.match(page,/auth-guard-v4-pilot\.js\?v=/);
  assert.match(page,/platform-logs\.mjs\?v=/);
});

test("global developer console queries individual events and provides bounded impact analysis",()=>{
  assert.match(page,/Global Event Stream/);
  assert.match(page,/id="pl-window"/);
  assert.match(page,/id="pl-impact-results"/);
  assert.match(page,/id="pl-event-search"/);
  assert.match(viewer,/action:"global_feed"/);
  assert.match(viewer,/action:"global_impact"/);
  assert.match(viewer,/function loadGlobal\(/);
  assert.match(viewer,/function loadImpact\(/);
  assert.match(viewer,/request trace|Cloud trace|cloud trace/i);
  assert.match(viewer,/record\.operationId/);
  assert.match(viewer,/state\.fingerprint/);
  assert.match(page,/the new global index starts with newly recorded events/);
});

test("normal, warning, failure flags remain readable on mobile and do not conflate clicks with saved outcomes",()=>{
  for(const level of ["normal","warning","failure"]){
    assert.match(page,new RegExp('data-level="'+level+'"'));
    assert.match(css,new RegExp('data-level='+level));
  }
  assert.match(page,/A normal click means it was observed, not that a save or submission succeeded/);
  assert.match(page,/filters apply to the currently loaded recent records/);
  assert.match(css,/@media\(max-width:560px\)/);
  assert.match(page,/minlength="12" maxlength="300"/);
  assert.match(viewer,/severity:severity\(row.severity\)/);
  assert.match(viewer,/function renderEvents\(\)/); // event properties are displayed, not edited.
});

test("directory and recent accounts are read only from canonical callable APIs after an audited reason",()=>{
  assert.match(viewer,/httpsCallable\(functions,"platformUsers"\)/);
  assert.match(viewer,/httpsCallable\(functions,"platformAccountDiagnostics"\)/);
  assert.match(viewer,/action:"list_all"/);
  assert.match(viewer,/action:"recent_accounts",reason/);
  assert.match(viewer,/action:"list",targetUid:selected,reason/);
  assert.match(viewer,/requiredReason\(\)/);
  assert.match(backend,/action:"platform_user_diagnostics_recent_viewed"/);
  assert.match(backend,/action:"platform_user_diagnostics_viewed"/);
  assert.match(backend,/if\(!authority\.platformAdmin\)deny\("permission-denied"/);
  assert.doesNotMatch(viewer,/setDoc|updateDoc|deleteDoc|collectionGroup/);
  assert.doesNotMatch(page,/export.*CSV/i);
});
