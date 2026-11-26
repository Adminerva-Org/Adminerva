import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {describeStudioCloudSaveError,studioCloudRetryDelay} from "../js/student/studio-cloud-save-recovery.mjs";

test("temporary Studio cloud failures retry with bounded backoff",()=>{
  assert.equal(describeStudioCloudSaveError({code:"functions/unavailable"}).retryable,true);
  assert.equal(describeStudioCloudSaveError({code:"functions/deadline-exceeded"}).retryable,true);
  assert.equal(describeStudioCloudSaveError(new Error("Failed to fetch")).retryable,true);
  assert.equal(describeStudioCloudSaveError(new Error("Connection lost"),{online:false}).retryable,true);
  assert.deepEqual([0,1,2,3,4,50].map(studioCloudRetryDelay),[3000,6000,12000,24000,30000,30000]);
});
test("exam locks, school access, and revision conflicts never auto-retry",()=>{
  const cases=[
    {code:"functions/failed-precondition",message:"The Studio exam is closed to edits."},
    {code:"functions/failed-precondition",message:"This project belongs to an earlier exam session."},
    {code:"functions/failed-precondition",message:"Project changed in school storage. Reload before overwriting it."},
    {code:"functions/permission-denied",message:"Your school enrollment is no longer active for this exam."},
    {code:"functions/invalid-argument",message:"A single source file exceeds 150 KB."}
  ];
  for(const error of cases)assert.equal(describeStudioCloudSaveError(error).retryable,false,error.message);
});
test("Studio retries only the queued snapshot and retains safety gates",()=>{
  const studio=readFileSync("js/student/project-studio.mjs","utf8");
  const bridge=readFileSync("js/student/v4-studio-service.mjs","utf8");
  const playground=readFileSync("js/student/playground.js","utf8");
  assert.match(studio,/cloudPending\.has\(id\)&&!deletedProjects\.has\(id\)/);
  assert.match(studio,/cloudRetryAttempts\.get\(id\)/);
  assert.match(studio,/if\(closingSessionEpoch\)return false/);
  assert.match(studio,/expectedRevision:base\.kind==="school"/);
  assert.match(studio,/if\(same\)\{cloudPending\.delete\(id\);unbackedProjectIds\.delete\(id\);\}/);
  assert.match(studio,/await retryV4StudioSchool\(\)/);
  assert.match(bridge,/export async function retryV4StudioSchool\(\)/);
  assert.match(bridge,/await picker\.load\(\)/);
  assert.match(playground,/The project controller keeps the actual cloud failure detail/);
  assert.doesNotMatch(playground,/showSaveStatus\("Device copy saved · cloud pending"/);
});

test("revision lookup only follows explicit revision failures, never exam closing",()=>{
 const bridge=readFileSync("js/student/v4-studio-service.mjs","utf8");
 const start=bridge.indexOf("function isStudioRevisionRecovery("),end=bridge.indexOf("async function scopedCall(",start);
 assert.ok(start>=0&&end>start);
 const check=new Function("callableMessage",bridge.slice(start,end)+"; return isStudioRevisionRecovery;")(e=>e.message||"");
 const error=reason=>({code:"functions/failed-precondition",details:{diagnosticReason:reason}});
 for(const code of ["STUDIO_REVISION_REQUIRED","STUDIO_REVISION_CONFLICT"])assert.equal(check(error(code)),true);
 for(const code of ["STUDIO_EXAM_CLOSED","STUDIO_EXAM_SESSION_EXPIRED","STUDIO_PROJECT_ARCHIVED","STUDIO_EMPTY_SNAPSHOT_REJECTED"])assert.equal(check(error(code)),false);
 assert.equal(check({code:"functions/failed-precondition",message:"unknown"}),false);
 assert.equal(check({code:"functions/failed-precondition",message:"Project changed in school storage. Reload before overwriting it."}),true);
 assert.match(bridge,/if\(closingSaveSessionEpoch\|\|!isStudioRevisionRecovery\(error\)\)throw error/);
});
