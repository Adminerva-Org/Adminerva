import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {classifyReconciliation,summarize}=require("../functions/mcs-migration-reconcile.js");
const {canonicalDigest}=require("../functions/mcs-migration-ledger.js");

const sourcePath="students/example";
const targetPath="schools/mcs-manila/legacy_roots/students/documents/example";
const data={name:"Example",section:"ICT A"};
const entry={sourcePath,targetPath,sourceDigest:canonicalDigest(data)};

test("reconciliation reports identical source and mirror digests",()=>{
  assert.equal(classifyReconciliation({
    entry,sourceExists:true,sourceData:data,targetExists:true,targetData:{section:"ICT A",name:"Example"}
  }).state,"identical");
});
test("reconciliation blocks changed, missing and conflicting records",()=>{
  assert.equal(classifyReconciliation({
    entry,sourceExists:false,sourceData:null,targetExists:true,targetData:data
  }).state,"source_missing");
  assert.equal(classifyReconciliation({
    entry,sourceExists:true,sourceData:{...data,section:"ICT B"},targetExists:true,targetData:data
  }).state,"source_changed");
  assert.equal(classifyReconciliation({
    entry,sourceExists:true,sourceData:data,targetExists:false,targetData:null
  }).state,"target_missing");
  assert.equal(classifyReconciliation({
    entry,sourceExists:true,sourceData:data,targetExists:true,targetData:{...data,name:"Different"}
  }).state,"target_mismatch");
});
test("reconciliation summary counts every state deterministically",()=>{
  assert.deepEqual(summarize([{state:"identical"},{state:"identical"},{state:"target_missing"}]),
    {identical:2,target_missing:1});
});
