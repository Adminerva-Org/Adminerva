import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const desktop=require("../apps/desktop/package.json");
const mobile=require("../apps/mobile/package.json");
const config=require("../apps/mobile/capacitor.config.json");
const pipeline=readFileSync(new URL("../.github/workflows/native-public-preview-builds.yml",import.meta.url),"utf8");
const main=readFileSync(new URL("../apps/desktop/main.cjs",import.meta.url),"utf8");
const preload=readFileSync(new URL("../apps/desktop/preload.cjs",import.meta.url),"utf8");
test("preview installers remain unsigned and are never published as official releases",()=>{
 assert.equal(desktop.private,true);
 assert.equal(desktop.build.publish,null);
 assert.match(desktop.build.productName,/Public Preview/);
 assert.equal(desktop.build.win.target,"nsis");
 assert.equal(desktop.build.mac.target,"dmg");
 assert.equal(desktop.build.nsis.perMachine,false);
 assert.equal(desktop.build.win.signAndEditExecutable,false);
 assert.match(desktop.scripts["dist:win"],/--publish never/);
 assert.match(desktop.scripts["dist:mac"],/--publish never/);
 assert.match(pipeline,/CSC_IDENTITY_AUTO_DISCOVERY: "false"/);
 assert.doesNotMatch(pipeline,/releases\/create|gh release|firebase deploy|npm publish/i);
 assert.match(pipeline,/retention-days: 7/);
});
test("CI builds Windows EXE, macOS DMGs and Android debug APK with checksums",()=>{
 for(const token of ["windows-latest","macos-latest","ubuntu-latest",
 "npm run dist:win","npm run dist:mac","./gradlew assembleDebug",
 "apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk",
 "actions/upload-artifact@v4","SHA256SUMS.txt"])
  assert.ok(pipeline.includes(token),"Missing preview step "+token);
 assert.equal(mobile.private,true);
 assert.equal(config.server?.url,undefined);
});
test("packaged desktop preview does not enable authentication or exam monitoring",()=>{
 assert.doesNotMatch(main,/desktopCapturer|autoUpdater/);
 assert.match(main,/const DEV_SIGNIN=!app\.isPackaged/);
 for(const dev of ["preload-auth-dev.cjs","native-auth-protocol.cjs","native-handoff-client.cjs"])
  assert.equal(desktop.build.files.includes(dev),false,"Developer auth must not ship in previews");
 assert.match(main,/setPermissionRequestHandler\([\s\S]*?callback\(false\)/);
 assert.match(main,/contextIsolation:true,nodeIntegration:false/);
 assert.match(preload,/capabilities:Object\.freeze\(\[\]\)/);
 assert.doesNotMatch(preload,/ipcRenderer|desktopCapturer/);
 assert.match(main,/contents\.on\("will-navigate",details=>/);
});

test("iOS Simulator preview is a non-installable, public-only Xcode build",()=>{
 assert.match(pipeline,/ios-simulator-preview:/);
 assert.match(pipeline,/--packagemanager SPM/);
 assert.match(pipeline,/xcodebuild -project ios\/App\/App\.xcodeproj/);
 assert.match(pipeline,/generic\/platform=iOS Simulator/);
 assert.match(pipeline,/CODE_SIGNING_ALLOWED=NO build/);
 assert.match(pipeline,/Adminerva-iOS-Simulator-Public-Preview-NOT-IPA/);
 assert.doesNotMatch(pipeline,/xcodebuild[^\n]*-exportArchive|altool|notarytool/);
 const page=readFileSync(new URL("../apps/mobile/preview-index.html",import.meta.url),"utf8");
 const source=readFileSync(new URL("../apps/mobile/preview-device-check.mjs",import.meta.url),"utf8");
 const prep=readFileSync(new URL("../apps/mobile/prepare-preview.mjs",import.meta.url),"utf8");
 assert.match(page,/id="preview-check-connection"/);
 assert.match(source,/data\.channel!=="public-preview"/);
 assert.match(source,/no project data was changed/);
 assert.match(prep,/preview-device-check\.mjs/);
});
