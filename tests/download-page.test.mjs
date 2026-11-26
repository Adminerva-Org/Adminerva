import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {detectDownloadPlatform,getInstallHint} from "../js/core/downloads-platform.mjs";
test("platform guidance recognizes desktop, Android, iOS and iPadOS",()=>{
 assert.equal(detectDownloadPlatform("Mozilla Windows NT 10.0","Win32"),"windows");
 assert.equal(detectDownloadPlatform("Mozilla Macintosh","MacIntel"),"macos");
 assert.equal(detectDownloadPlatform("Mozilla Android 15","Linux armv8"),"android");
 assert.equal(detectDownloadPlatform("Mozilla iPhone","iPhone"),"ios");
 assert.equal(detectDownloadPlatform("Mozilla Macintosh","MacIntel",5),"ios");
 assert.equal(detectDownloadPlatform("Unknown","Linux"),"other");
 assert.match(getInstallHint("ios"),/Safari/);
 assert.match(getInstallHint("android"),/Chrome/);
 assert.match(getInstallHint("windows",{installPrompt:true}),/Install web app/);
 assert.match(getInstallHint("windows",{standalone:true}),/already open/);
});
test("public downloads page is navigable and never fabricates native release links",()=>{
 const html=readFileSync(new URL("../downloads.html",import.meta.url),"utf8");
 const shell=readFileSync(new URL("../js/core/public-shell.mjs",import.meta.url),"utf8");
 const home=readFileSync(new URL("../index.html",import.meta.url),"utf8");
 assert.match(html,/data-page="downloads"/);
 assert.match(html,/href="manifest.webmanifest"/);
 assert.match(html,/id="web-install"/);
 for(const platform of ["windows","macos","android","ios"])assert.match(html,new RegExp('data-platform="'+platform+'"'));
 assert.match(html,/Not available yet/);
 assert.doesNotMatch(html,/href="[^"]+\.(exe|dmg|msi|apk|ipa)"/i);
 assert.doesNotMatch(html,/href="https:\/\/(apps\.apple\.com|play\.google\.com)/i);
 assert.match(shell,/\["downloads","Download","downloads\.html"\]/);
 assert.match(home,/href="downloads\.html"/);
});

test("public downloads visibly separates real unsigned QA artifacts from unavailable official installers",()=>{
 const html=readFileSync(new URL("../downloads.html",import.meta.url),"utf8");
 const css=readFileSync(new URL("../css/downloads.css",import.meta.url),"utf8");
 const workflow="https://github.com/Adminerva-Org/Adminerva/actions/workflows/native-public-preview-builds.yml";
 assert.equal(html.split('href="'+workflow+'"').length-1,3);
 for(const label of ["Get Windows test build","Get macOS test build","Get Android test build"])
  assert.match(html,new RegExp(label));
 assert.match(html,/GitHub sign-in may be required/);
 assert.match(html,/builds expire after seven days/);
 assert.match(html,/School accounts, Studio exams and Companion are not enabled/);
 assert.match(html,/iOS test installation requires Apple signing/);
 assert.match(css,/downloads-preview-link/);
 assert.doesNotMatch(html,/href="[^"]+\.(exe|dmg|apk|ipa)"/i);
});
