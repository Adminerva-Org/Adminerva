import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {checkPagesRelease} from "../scripts/check-pages-release.mjs";

const local=path=>readFileSync(new URL("../"+path,import.meta.url));
const version=JSON.parse(local("site-release.json")).version;
function fixture(override=()=>null){
  const requests=[],logs=[];let elapsed=0;
  return {requests,logs,options:{now:()=>elapsed,sleep:async ms=>{elapsed+=ms;},log:value=>logs.push(value),fetchImpl:async(url,options)=>{
    const parsed=new URL(url);assert.equal(parsed.origin,"https://adminerva-org.github.io");assert.ok(parsed.pathname.startsWith("/Adminerva/"));
    assert.equal(options.method,"GET");assert.equal(options.credentials,"omit");assert.equal(options.redirect,"error");assert.equal(options.cache,"no-store");assert.ok(options.signal instanceof AbortSignal);
    const path=parsed.pathname.slice("/Adminerva/".length);requests.push(path);
    return await override(path,requests)||new Response(local(path),{status:200});
  }},advance:ms=>{elapsed+=ms;},get elapsed(){return elapsed;}};
}

test("release verification waits for the requested manifest version, then proves deployed assets match checkout bytes",async()=>{
  let manifests=0;const app=fixture(path=>path==="site-release.json"&&++manifests===1?new Response(JSON.stringify({version:"0.0.0"})):null);
  const proof=await checkPagesRelease(app.options);
  assert.equal(proof.version,version);assert.equal(proof.manifestAttempts,2);assert.equal(app.elapsed,10000);
  assert.equal(proof.files.filter(file=>file.matchesCheckout).length,9);assert.equal(proof.files.filter(file=>file.contentMarkers).length,5);
  assert.ok(proof.files.filter(file=>file.sha256).every(file=>/^[a-f0-9]{64}$/.test(file.sha256)));
  assert.equal(app.logs.at(-1).event,"pages_release_verified");
});

test("missing deployed pages and altered assets fail instead of reporting a successful publication",async()=>{
  const missing=fixture(path=>path==="login.html"?new Response("Missing",{status:404}):null);
  await assert.rejects(checkPagesRelease(missing.options),/login\.html returned HTTP 404/);
  assert.equal(missing.logs.some(log=>log.event==="pages_release_verified"),false);
  const mismatch=fixture(path=>path==="css/adminerva-ui.css"?new Response("old cached CSS"):null);
  await assert.rejects(checkPagesRelease(mismatch.options),/adminerva-ui\.css SHA-256 differs/);
});

test("a release manifest alone cannot pass when deployed HTML lacks the expected workflow content",async()=>{
  const app=fixture(path=>path==="wiki.html"?new Response("old handbook?v="+version):null);
  await assert.rejects(checkPagesRelease(app.options),/wiki\.html is missing expected release content/);
});

test("old or malformed manifest responses stop after a finite number of polls",async()=>{
  for(const body of [JSON.stringify({version:"0.0.0"}),"not JSON",JSON.stringify({version:123})]){
    const app=fixture(path=>path==="site-release.json"?new Response(body):null);
    await assert.rejects(checkPagesRelease({...app.options,attempts:3}),/bounded polling window \(3 attempts\)/);
    assert.equal(app.requests.length,3);assert.equal(app.elapsed,20000);assert.equal(app.logs.some(log=>log.event==="pages_release_verified"),false);
  }
});

test("network timeouts stay inside the five-minute manifest deadline and malformed local JSON performs no network reads",async()=>{
  const app=fixture(()=>{app.advance(15000);throw new DOMException("Request timed out","TimeoutError");});
  await assert.rejects(checkPagesRelease(app.options),/bounded polling window/);assert.equal(app.elapsed,300000);assert.equal(app.requests.length,12);
  const invalid=fixture();await assert.rejects(checkPagesRelease({...invalid.options,readLocal:async()=>Buffer.from("broken")}),/Local site-release\.json is not valid JSON/);
  assert.equal(invalid.requests.length,0);
});
