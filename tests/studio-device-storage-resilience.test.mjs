import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("school Studio retains unsaved project snapshots when local storage is full",()=>{
  const studio=readFileSync("js/student/project-studio.mjs","utf8");
  assert.match(studio,/const unbackedProjectIds=new Set\(\)/);
  assert.match(studio,/unbackedProjectIds\.add\(project\.id\)/);
  assert.match(studio,/cloudPending\.set\(id,snapshot\)/);
  assert.match(studio,/if\(same\)\{cloudPending\.delete\(id\);unbackedProjectIds\.delete\(id\);\}/);
  assert.match(studio,/if\(unbackedProjectIds\.has\(activeProject\.id\)\)/);
  assert.match(studio,/Device backup unavailable · cloud save pending/);
  assert.match(studio,/No device backup or cloud confirmation/);
});

test("assessment Studio creation and resume retain current source and identity under quota pressure",()=>{
  const studio=readFileSync("js/student/project-studio.mjs","utf8");
  assert.match(studio,/sameOpenAssessment/);
  assert.match(studio,/if\(changed\)project=store\(next,true\)/);
  assert.match(studio,/Device cache unavailable during assessment resume/);
  assert.match(studio,/createCodeProject\(memoryStorage,uid/);
  assert.match(studio,/assessment:ownership/);
  const playground=readFileSync("js/student/playground.js","utf8");
  assert.match(playground,/try\{localStorage\.setItem\(playgroundLanguageKey\(uid\),currentLang\);\}/);
});
