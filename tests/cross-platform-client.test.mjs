import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import {describeAppClient,assessNativeCapability,CLIENT_PROTOCOL} from "../js/core/app-compatibility.mjs";
const require=createRequire(import.meta.url);
const {APP_ORIGIN,START_URL,classifyNavigation}=require("../apps/desktop/navigation-policy.cjs");
const source=readFileSync(new URL("../apps/desktop/main.cjs",import.meta.url),"utf8");
const preload=readFileSync(new URL("../apps/desktop/preload.cjs",import.meta.url),"utf8");
const pkg=JSON.parse(readFileSync(new URL("../apps/desktop/package.json",import.meta.url),"utf8"));

test("desktop preview only stays within explicit PUBLIC Adminerva pages",()=>{
 assert.equal(START_URL,APP_ORIGIN+"/Adminerva/guest-home.html");
 for(const route of ["guest-home.html","guest-playground.html","wiki.html","downloads.html"])
  assert.equal(classifyNavigation(APP_ORIGIN+"/Adminerva/"+route).action,"internal");
 for(const route of ["login.html","student-playground.html","school-admin.html","teacher-classroom.html"])
  assert.equal(classifyNavigation(APP_ORIGIN+"/Adminerva/"+route).action,"external");
 assert.equal(classifyNavigation("https://github.com/Adminerva-Org/Adminerva").action,"external");
 for(const url of ["http://adminerva-org.github.io/Adminerva/index.html",
  "https://evil.example","file:///etc/passwd","javascript:alert(1)",
  "https://adminerva-org.github.io.evil.example/Adminerva/index.html",
  "https://adminerva-org.github.io/Adminerva/../student-playground.html",
  "adminerva://callback?token=secret"])
  assert.equal(classifyNavigation(url).action,"block",url);
});

test("desktop window is sandboxed, denies native permissions and has no privileged renderer API",()=>{
 for(const assertion of [/app\.enableSandbox\(\)/,/sandbox:true/,/contextIsolation:true/,
  /nodeIntegration:false/,/webSecurity:true/,/webviewTag:false/,
  /setPermissionRequestHandler\([\s\S]*?callback\(false\)/,
  /setPermissionCheckHandler\(\(\)=>false\)/,
  /will-attach-webview/,/setWindowOpenHandler/])
  assert.match(source,assertion);
 assert.doesNotMatch(source,/desktopCapturer|globalShortcut|autoUpdater/);
 assert.match(source,/ipcMain\.handle\("adminerva:consume-signin-token"/);
 assert.match(source,/currentBootstrap\(event\.sender\)/);
 assert.match(preload,/capabilities:Object\.freeze\(\[\]\)/);
 assert.doesNotMatch(preload,/desktopCapturer|shell\.openExternal|fs\.readFile/);
 assert.match(preload,/ipcRenderer\.invoke\("adminerva:consume-signin-token"\)/);
 assert.match(preload,/ipcRenderer\.invoke\("adminerva:confirm-signin"\)/);
 assert.equal(pkg.version,"0.1.0");
 assert.equal(CLIENT_PROTOCOL,1);
});

test("native capabilities are conservative UI hints, not exam or OS authorization",()=>{
 assert.deepEqual(describeAppClient(null),{
  kind:"web",channel:"browser",protocol:null,shellVersion:null,capabilities:[]
 });
 assert.equal(assessNativeCapability(null,"screen-capture").reason,"browser");
 const preview={kind:"desktop",channel:"public-preview",protocol:1,shellVersion:"0.1.0",
  capabilities:["screen-capture","screen-capture","not-allowed"]};
 assert.deepEqual(describeAppClient(preview).capabilities,["screen-capture"]);
 assert.equal(assessNativeCapability(preview,"screen-capture").reason,"unreleased-client");
 assert.equal(assessNativeCapability({...preview,channel:"release",protocol:3},"screen-capture").reason,
  "incompatible-bridge");
 const advertised=assessNativeCapability({...preview,channel:"release"},"screen-capture");
 assert.deepEqual(advertised,{supported:true,reason:"advertised-only"});
 assert.equal(assessNativeCapability({...preview,channel:"release"},"foreground-applications").supported,false);
});

test("mobile preview packages canonical public assets, not remote native web permissions",()=>{
 const cfg=JSON.parse(readFileSync(new URL("../apps/mobile/capacitor.config.json",import.meta.url),"utf8"));
 const mobilePackage=JSON.parse(readFileSync(new URL("../apps/mobile/package.json",import.meta.url),"utf8"));
 const script=readFileSync(new URL("../apps/mobile/prepare-preview.mjs",import.meta.url),"utf8");
 const entry=readFileSync(new URL("../apps/mobile/preview-index.html",import.meta.url),"utf8");
 assert.equal(cfg.appId,"io.adminerva.preview");
 assert.equal(cfg.webDir,"www");
 assert.equal(cfg.server?.url,undefined);
 assert.equal(mobilePackage.private,true);
 assert.match(script,/guest-home\.html/);
 assert.match(script,/copyFileSync\(path\.join\(here,"preview-index\.html"\)/);
 assert.match(entry,/public-only test bundle/);
 assert.doesNotMatch(entry,/firebase-auth|signInWithPopup|desktopCapturer/);
});

test("mobile preview staging generates a canonical public bundle without native login",async()=>{
 const {execFileSync}=await import("node:child_process");
 const {existsSync,rmSync}=await import("node:fs");
 const {fileURLToPath}=await import("node:url");
 const appDir=fileURLToPath(new URL("../apps/mobile/",import.meta.url));
 const script=fileURLToPath(new URL("../apps/mobile/prepare-preview.mjs",import.meta.url));
 const output=fileURLToPath(new URL("../apps/mobile/www/",import.meta.url));
 try{
  execFileSync(process.execPath,[script],{cwd:appDir,timeout:20000,stdio:"pipe"});
  for(const relative of ["index.html","guest-home.html","guest-playground.html",
   "assets/adminerva-emblem.png","js/core/public-shell.mjs","css/public-shell.css"])
   assert.ok(existsSync(fileURLToPath(new URL("../apps/mobile/www/"+relative,import.meta.url))),
    "Missing canonical shared asset: "+relative);
 }finally{
  rmSync(output,{recursive:true,force:true});
 }
});

test("native app stays public until the paired session completes in the trusted bootstrap",()=>{
 const boot="https://adminerva-org.github.io/Adminerva/desktop-session.html";
 const privatePage="https://adminerva-org.github.io/Adminerva/student-playground.html";
 assert.equal(classifyNavigation(boot).action,"external");
 assert.equal(classifyNavigation(boot,{allowBootstrap:true}).action,"internal");
 assert.equal(classifyNavigation(privatePage).action,"external");
 assert.equal(classifyNavigation(privatePage,{allowPrivate:true}).action,"internal");
 assert.equal(classifyNavigation("https://evil.example/Adminerva/student-playground.html",{allowPrivate:true}).action,"block");
 assert.equal(classifyNavigation("https://adminerva-org.github.io/Adminerva/login.html",{allowPrivate:true}).action,"external");
});
