import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {
  redactMessage,normalizedError,errorFingerprint,latencyBucket,measureSpan
}=require("../functions/platform-telemetry.js");
const {combine,percentile,anomalies}=require("../functions/platform-observability.js");

test("telemetry redacts credential-like values, email addresses and URL queries",()=>{
  const message="teacher@example.edu failed https://example.test/path?token=secret with AIzaABCDEFGHIJKLMNOPQRSTUVWXY and ghp-abcdefghijklmnopqrstuv";
  const redacted=redactMessage(message);
  assert.equal(redacted.includes("teacher@example.edu"),false);
  assert.equal(redacted.includes("?token=secret"),false);
  assert.equal(redacted.includes("AIzaABCDEFGHIJKLMNOPQRSTUVWXY"),false);
  assert.equal(redacted.includes("ghp-abcdefghijklmnopqrstuv"),false);
  assert.match(redacted,/\[email\]/);
});

test("error fingerprints normalize changing numeric and opaque identifiers",()=>{
  const a={code:"failed-precondition",message:"Project 123456 revision deadbeefdeadbeef failed"};
  const b={code:"failed-precondition",message:"Project 987654 revision cafebabecafebabe failed"};
  assert.equal(normalizedError(a.message),normalizedError(b.message));
  assert.equal(errorFingerprint("studio","save",a),errorFingerprint("studio","save",b));
});

test("latency histogram bands and percentile estimates are deterministic",()=>{
  assert.equal(latencyBucket(200),"le_250");
  assert.equal(latencyBucket(2600),"le_5000");
  assert.equal(latencyBucket(12000),"gt_10000");
  assert.equal(percentile({le_250:90,le_500:5,le_1000:5},.95),500);
});

test("trace span helper records bounded technical timing without request payload data",async()=>{
  const request={data:{secret:"must-not-be-copied"},__telemetry:{spans:[]}};
  const result=await measureSpan(request,"studio.project_save",async()=>42);
  assert.equal(result,42);
  assert.equal(request.__telemetry.spans.length,1);
  assert.equal(request.__telemetry.spans[0].name,"studio.project_save");
  assert.equal(JSON.stringify(request.__telemetry.spans).includes("must-not-be-copied"),false);
});

test("metric combination produces weighted operational estimates",()=>{
  const rows=[{
    successEstimate:90,failureCount:10,latencyTotalMs:100000,latencyWeight:100,
    histogram:{le_250:20,le_500:30,le_1000:40,le_2500:10}
  }];
  const result=combine(rows);
  assert.equal(result.requests,100);
  assert.equal(result.failures,10);
  assert.equal(result.errorRate,.1);
  assert.equal(result.avgLatencyMs,1000);
  assert.equal(result.p95LatencyMs,2500);
});

test("simple anomaly detector flags material failure and latency spikes only after enough traffic",()=>{
  const now=1763424000000,bucket=5*60*1000;
  const row=(at,{success=10,failed=0,latency=500}={})=>({
    bucketStart:at,service:"schoolStudioProjects",operation:"save",
    successEstimate:success,failureCount:failed,observedCount:1,
    latencyWeight:success+failed,latencyTotalMs:(success+failed)*latency,
    histogram:{le_250:0,le_500:success+failed,le_1000:0,le_2500:0,le_5000:0,le_10000:0,gt_10000:0},
    lastSeen:at
  });
  const rows=[];
  for(let i=7;i<=16;i++)rows.push(row(now-i*bucket,{success:20,failed:0,latency:500}));
  for(let i=0;i<6;i++)rows.push(row(now-i*bucket,{success:8,failed:4,latency:4000}));
  const found=anomalies(rows,now);
  assert.ok(found.some(item=>item.kind==="error_spike"));
  assert.ok(found.some(item=>item.kind==="latency_spike"));
});
