/** Focused integration guardrails for V4 pilot surfaces. No live accounts or writes. */
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const ids=source=>[...source.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);

test("Gradebook retains legacy and canonical views alongside complete bulk external UI",()=>{
  const page=read("gradebook.html");
  for(const id of [
    "gbBulkExternal","gbBulkExternalModal","gbBulkExternalPackage","gbBulkExternalResult",
    "gbBulkExternalImport","gbBulkExternalStatus","gbBulkExternalClose",
    "gbBulkExternalDone","gbBulkExternalPrev","gbBulkExternalNext","gbBulkExternalCopy",
    "gbV4Status","gbQuarterPanel","gbBulkEvaluate","gbBulkApprove"
  ])assert.equal(ids(page).filter(value=>value===id).length,1,id+" must exist once");
  assert.match(page,/role="dialog" aria-modal="true" aria-labelledby="gbBulkExternalTitle"/);
  assert.match(page,/js\/repo-review\/gradebook-class-review\.mjs/);
  const controller=read("js/repo-review/gradebook-class-review.mjs");
  for(const action of ["gbBulkExternal","gbBulkExternalImport","gbBulkExternalClose",
                        "gbBulkExternalPrev","gbBulkExternalNext","gbBulkExternalCopy"])
    assert.ok(controller.includes(action),action+" action must be handled");
  assert.match(controller,/supplemental review data unavailable/);
});
test("mobile Studio bindings retain verified school and project controls",()=>{
  const page=read("student-playground.html"),script=read("js/student/playground.js");
  const css=read("css/playground-workspace.css");
  const seen=ids(page),duplicates=seen.filter((value,index)=>seen.indexOf(value)!==index);
  assert.deepEqual(duplicates,[],"duplicate element IDs break event handlers");
  for(const id of [
    "studioSchoolSwitcher","studioSchoolStatus","archivedCodeProjectsBtn",
    "studioSubmitAssessment","studioMobileFiles","studioMobileEditor","studioMobileTerminal",
    "studioMobileRun","studioMobileMore","studioMobileBackdrop","studioMobileActions",
    "studioMobileCloseFiles","studioMobileCloseMore","projectExplorer","studioEditAssistToggle",
    "studioZoomOut","studioZoomIn","studioEditAssistBar","runBtn"
  ])assert.ok(seen.includes(id),id+" must be visible or mounted");
  assert.match(page,/aria-expanded="false"/);
  assert.match(page,/role="group" aria-label="Workspace pane"/);
  assert.match(script,/function initializeMobileStudio\(/);
  assert.match(script,/getElementById\("projectExplorer"\)/);
  assert.match(script,/studioMobileRun/);
  assert.match(css,/@media\(max-width:767px\)/);
  assert.match(css,/#projectExplorer\.studio-drawer-open/);
  assert.match(css,/prefers-reduced-motion/);
});
test("pilot navigation does not hide current teacher grading or expose unverified school routes",()=>{
  const nav=read("js/core/adminerva-nav.js");
  assert.match(nav,/gradebookRoute="gradebook.html"/);
  assert.match(nav,/Gradebook · current classes/);
  assert.match(nav,/Gradebook · 4\.0 pilot/);
  assert.match(nav,/hasSchoolTeacher/);
  assert.match(nav,/hasSchoolStudent/);
  assert.match(nav,/school-pilot\.html/);
});
test("canonical AI cannot silently use a personal key during a verified pilot",()=>{
  const ai=read("js/core/school-ai.mjs");
  assert.match(ai,/if\(!status\.legacyFallback\)/);
  assert.match(ai,/context\.schoolState==="draft"/);
  assert.match(ai,/School changed while generating/);
  assert.match(ai,/adminerva:preferred-school-changed/);
  const backend=read("functions/school-ai-service.js");
  assert.match(backend,/\["active","pilot"\]/);
  const index=read("functions/index.js");
  assert.match(index,/exports\.mcsPilotControl=onCall/);
  const rules=read("firestore.rules");
  assert.match(rules,/function legacyMcsAllowed\(/);
  assert.match(rules,/match \/schools\/\{schoolId\}/);
});
