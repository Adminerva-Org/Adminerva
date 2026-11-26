import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {UPDATE_STATUS_URL,DOWNLOAD_CENTER_URL,compareVersions,
 evaluateUpdateManifest,checkUpdateStatus}=require("../apps/desktop/update-check.cjs");
const manifest=JSON.parse(readFileSync(new URL("../native-update-channel.json",import.meta.url),"utf8"));
const desktop=require("../apps/desktop/package.json");
const mobile=require("../apps/mobile/package.json");
test("native semantic versions compare correctly and reject non-release values",()=>{
 assert.equal(compareVersions("0.1.1","0.1.0"),1);
 assert.equal(compareVersions("0.1.0","0.1.0"),0);
 assert.equal(compareVersions("0.1.0","0.2.0"),-1);
 for(const bad of ["v0.1.0","0.1","1.0.0-beta","01.0.0","4.0.0.1"])
  assert.throws(()=>compareVersions(bad,"0.1.0"));
});
test("update status is advisory and refuses unsigned auto-install authority",()=>{
 assert.throws(()=>evaluateUpdateManifest({...manifest,installMode:"automatic"},
  {platform:"windows",currentVersion:"0.1.0"}));
 assert.throws(()=>evaluateUpdateManifest({...manifest,officialSignedRelease:true},
  {platform:"macos",currentVersion:"0.1.0"}));
 assert.deepEqual(evaluateUpdateManifest(manifest,{platform:"ios",currentVersion:"0.1.0"}),
  {state:"unsupported"});
 assert.deepEqual(evaluateUpdateManifest(
  {...manifest,latestVersion:{...manifest.latestVersion,windows:"0.2.0"}},
  {platform:"windows",currentVersion:"0.1.0"}),
  {state:"newer-preview-listed",currentVersion:"0.1.0",
   latestVersion:"0.2.0",installMode:"manual-preview",canAutoInstall:false});
});
test("native version checks fetch only first-party JSON without following redirects",async()=>{
 let called=false;
 const fetchImpl=async(url,options)=>{
  called=true;
  assert.equal(url,UPDATE_STATUS_URL);
  assert.equal(options.method,"GET");
  assert.equal(options.redirect,"error");
  assert.equal(options.cache,"no-store");
  return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify(manifest)};
 };
 assert.equal((await checkUpdateStatus({
  platform:"windows",currentVersion:"0.1.0",fetchImpl
 })).canAutoInstall,false);
 assert.ok(called);
 assert.match(DOWNLOAD_CENTER_URL,/^https:\/\/adminerva-org\.github\.io\/Adminerva\//);
 await assert.rejects(checkUpdateStatus({
  platform:"windows",currentVersion:"0.1.0",
  fetchImpl:async()=>({ok:true,headers:{get:()=>null},text:async()=>"<".repeat(5000)})
 }),/large/);
});
test("preview shells surface version checks but never download or execute unsigned updates",()=>{
 assert.equal(manifest.latestVersion.windows,desktop.version);
 assert.equal(manifest.latestVersion.macos,desktop.version);
 assert.equal(manifest.latestVersion.android,mobile.version);
 const page=readFileSync(new URL("../apps/mobile/preview-index.html",import.meta.url),"utf8");
 const prep=readFileSync(new URL("../apps/mobile/prepare-preview.mjs",import.meta.url),"utf8");
 const mobileJs=readFileSync(new URL("../apps/mobile/preview-update.mjs",import.meta.url),"utf8");
 const main=readFileSync(new URL("../apps/desktop/main.cjs",import.meta.url),"utf8");
 assert.ok(desktop.build.files.includes("update-check.cjs"));
 assert.match(page,/id="preview-check-update"/);
 assert.match(prep,/preview-update\.mjs/);
 assert.match(mobileJs,/Automatic APK updates are not available/);
 assert.match(main,/label:"Check for updates…"/);
 assert.match(main,/showUpdateStatus/);
 assert.doesNotMatch(main,/autoUpdater|downloadUpdate|quitAndInstall/);
});
