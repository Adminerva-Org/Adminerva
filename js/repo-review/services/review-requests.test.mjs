/** Regressions for parallel panel readiness, isolated failures and per-review request deduplication. */
import test from "node:test";
import assert from "node:assert/strict";
import {createReviewRequests,preloadReviewPanels} from "./review-requests.mjs";

test("panels start together, fail independently and never render a closed review",async()=>{
  const started=[],rendered=[],controller=new AbortController();let finish;
  const pending=new Promise(resolve=>{finish=resolve;});
  const work=preloadReviewPanels({evidence:()=>{started.push("evidence");return pending;},group:()=>{started.push("group");throw Error("offline");},history:()=>{started.push("history");return 3;}},
    {signal:controller.signal,onResult:name=>rendered.push(name),onError:name=>rendered.push(name+":error")});
  assert.deepEqual(started,["evidence","group","history"]);
  controller.abort();finish(1);
  const result=await work;
  assert.equal(result.filter(item=>item.status==="rejected").length,1);
  assert.ok(!rendered.includes("evidence"));
});

test("shared reads deduplicate in-flight requests, bound concurrency and retry failures",async()=>{
  let calls=0,running=0,peak=0,fail=true;
  const client=createReviewRequests({concurrency:2,fetchImpl:async url=>{
    calls++;running++;peak=Math.max(peak,running);
    await new Promise(resolve=>setTimeout(resolve,5));running--;
    if(url.includes("failed")&&fail){fail=false;return new Response("{}",{status:503});}
    return Response.json({url});
  }});
  const path="/repos/example/project/commits/"+"a".repeat(40);
  const results=await Promise.all([client.json(path+"?page=1&per_page=100"),client.json(path+"?per_page=100&page=1"),...Array.from({length:5},(_,index)=>client.json(path+"?page="+(index+2)))]);
  assert.equal(calls,6);assert.equal(peak,2);assert.deepEqual(results[0],results[1]);
  await assert.rejects(client.json("/repos/example/project/failed"),/503/);
  await client.json("/repos/example/project/failed");assert.equal(calls,8);
  await assert.rejects(client.json("https://other.example/repos/x/y"),/origin/);
});
