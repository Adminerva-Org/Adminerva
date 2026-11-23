import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {normalizeBrowserBatch,normalizeCompanionObservation,MAX_EVENTS}=require("../functions/exam-monitoring-model.js");
test("browser telemetry discards content and rejects invalid epochs or events",()=>{
 assert.deepEqual(normalizeBrowserBatch({taskId:"abc_1",sessionEpoch:1,
  events:[{kind:"page_hidden",clientAt:1000,url:"private",code:"private"}]}),
  {taskId:"abc_1",sessionEpoch:1,source:"browser",events:[{kind:"page_hidden",clientAt:1000}]});
 assert.throws(()=>normalizeBrowserBatch({taskId:"abc",sessionEpoch:0,events:[{kind:"page_hidden",clientAt:1}]}));
 assert.throws(()=>normalizeBrowserBatch({taskId:"abc",sessionEpoch:1,events:[{kind:"unrecognized",clientAt:1}]}));
 assert.throws(()=>normalizeBrowserBatch({taskId:"abc",sessionEpoch:1,
  events:Array(MAX_EVENTS+1).fill({kind:"page_hidden",clientAt:1})}));
});
test("companion observations are bounded and stripped of unrelated metadata",()=>{
 assert.deepEqual(normalizeCompanionObservation({
  kind:"running_applications",applications:["Chrome","VS Code","Chrome"],windowTitle:"Private title"
 }),{kind:"running_applications",applications:["Chrome","VS Code"]});
 assert.throws(()=>normalizeCompanionObservation({
  kind:"foreground_application",application:"C:\\secret\\application.exe"
 }));
});
