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

test("observed transaction preserves SDK return/rejection, counts callback attempts, and tolerates telemetry failure",async()=>{
 const source=readFileSync("functions/school-studio-projects.js","utf8");
 const start=source.indexOf("async function observedStudioTransaction("),end=source.indexOf("function createSchoolStudioProjectService(",start);
 const run=new Function(source.slice(start,end)+";return observedStudioTransaction;")();
 const db={runTransaction:async callback=>{await callback({});return callback({});}};
 let observation;
 assert.equal(await run(db,()=>42,value=>{observation=value;}),42);
 assert.equal(observation.transactionAttempts,2);assert.equal(observation.transactionOutcome,"returned");
 assert.equal(await run(db,()=>42,()=>{throw Error("diagnostic only");}),42);
 const failure=Error("existing domain rejection");
 await assert.rejects(run(db,()=>{throw failure;},value=>{observation=value;}),error=>error===failure);
 assert.equal(observation.transactionAttempts,1);assert.equal(observation.transactionOutcome,"rejected");
});
test("cross-document marker observer does not change storage or emit identifying data",()=>{
 const studio=readFileSync("js/student/project-studio.mjs","utf8");
 const start=studio.indexOf("function observePeerMarker("),end=studio.indexOf("function readMarker(",start);
 const handler=studio.slice(start,end);
 assert.match(handler,/auth.currentUser\?\.uid!==uid/);
 assert.match(handler,/event.key!==key/);
 assert.match(handler,/context:\{peerMarker,localSaveState\}/);
 assert.doesNotMatch(handler,/writeMarker\(|markerCache\.set\(|cloudPending\.delete\(|flushOne\(/);
});


test("mutable Studio artifacts persist against the last accepted snapshot, not the live object",()=>{
  const source=readFileSync("js/student/project-studio.mjs","utf8");
  const extract=(start,end)=>{
    const a=source.indexOf(start),b=source.indexOf(end,a);
    assert.ok(a>=0&&b>a);
    return source.slice(a,b);
  };
  const run=new Function(`
    let activeProject=null,activeContentBaseline=null,device=null;
    let saves=0,queued=0,failDevice=false;
    const cloudEnabled=true,projectStorage={},uid="student";
    const unbackedProjectIds=new Set();
    const validateProject=p=>{if(p.invalid)throw Error("invalid");};
    const findCodeProject=()=>device;
    const saveCodeProject=(_storage,_uid,p)=>{
      if(failDevice)throw Error("quota");
      saves++;device=structuredClone(p);return structuredClone(p);
    };
    const normalizeProject=p=>structuredClone(p);
    const readMarker=()=>({kind:"school",pending:false});
    const scheduleCloudSave=()=>{queued++;};
    const updateProjectHeading=()=>{},updateQuotaUI=()=>{},setCloudStatus=()=>{};
    const window={dispatchEvent(){}};
    const CustomEvent=class {};
    const console={warn(){}};
    ${extract("  function stable(","  function setCloudStatus(")}
    ${extract("  function store(","  function saveState(")}
    const initial={id:"p",title:"Project",state:{files:{"Main.java":"old"}},
      design:{},database:{tables:{}},evidence:{runs:[]}};
    activeProject=structuredClone(initial);device=structuredClone(initial);
    activeContentBaseline={id:initial.id,key:contentKey(initial)};
    return {
      mutate:fn=>fn(activeProject),
      save:()=>store(activeProject,true),
      counts:()=>[saves,queued],
      device:()=>device,
      memory:()=>activeProject,
      fail:()=>{failDevice=true;},
      unbacked:()=>unbackedProjectIds.has("p")
    };
  `)();
  run.save();assert.deepEqual(run.counts(),[0,0]);
  const changes=[
    p=>{p.design.useCase="flowchart TD";},
    p=>{p.database.tables.people={rows:[{id:1}]};},
    p=>{p.evidence.runs.push({status:"finished"});},
    p=>{p.state.files["Main.java"]="reset";},
    p=>{p.title="Imported bundle";}
  ];
  for(const [index,change] of changes.entries()){
    run.mutate(change);run.save();
    assert.deepEqual(run.counts(),[index+1,index+1]);
    assert.deepEqual(run.device(),run.memory());
    run.save();assert.deepEqual(run.counts(),[index+1,index+1]);
  }
  run.mutate(p=>{p.invalid=true;});
  assert.throws(()=>run.save(),/invalid/);
  assert.deepEqual(run.counts(),[5,5]);
  run.mutate(p=>{delete p.invalid;p.design.useCase="memory-only";});
  run.fail();run.save();
  assert.equal(run.unbacked(),true);
  assert.equal(run.memory().design.useCase,"memory-only");
  assert.notEqual(run.device().design.useCase,"memory-only");
  assert.deepEqual(run.counts(),[5,6]);
});
