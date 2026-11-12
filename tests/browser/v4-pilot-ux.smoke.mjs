/** Visual MCS pilot readiness smoke, entirely synthetic. Never connects to Firebase. */
import test from "node:test";
import assert from "node:assert/strict";
import {readFile, mkdir} from "node:fs/promises";
import {createServer} from "node:http";
import {resolve, sep, extname} from "node:path";
import {chromium} from "playwright";

const root=process.cwd();
function server(){
  return createServer(async (req,res)=>{
    try{
      const pathname=decodeURIComponent(new URL(req.url||"/","http://localhost").pathname);
      const name=resolve(root,"."+pathname);
      if(!name.startsWith(root+sep))throw Error("Forbidden asset");
      const bytes=await readFile(name);
      const ext=extname(name);
      res.setHeader("Content-Type",ext===".js"||ext===".mjs"?"text/javascript":ext===".css"?"text/css":ext===".html"?"text/html":"application/octet-stream");
      res.end(bytes);
    }catch{res.writeHead(404);res.end("Not found");}
  });
}
const sections=[
  ["shs-g11-techpro-ict-st-isidore-of-seville","St. Isidore of Seville",45],
  ["shs-g11-techpro-ict-st-carlo-acutis","St. Carlo Acutis",35],
  ["shs-g12-tvl-ict-st-philip-the-apostle","St. Philip the Apostle",45],
  ["shs-g12-tvl-ict-st-anselm-of-canterbury","St. Anselm of Canterbury",44]
];
const demo={
  schoolId:"mcs-manila",schoolState:"draft",compatibilityMode:"legacy_allowed",productionAuthorized:false,
  expectedTotal:169,observedTotal:169,includedTotal:169,excludedTotal:0,deferredHistory:true,
  counts:sections.map(([sectionId,name,expected])=>({sectionId,name,expected,observed:expected,included:expected,delta:0})),
  canonical:{people:0,memberships:0,offerings:0,enrollments:0,teacherAssignments:0,ready:false},
  unresolved:[{legacyStudentId:"fictional-learner-1",displayName:"Fictional Learner",
    sectionName:"St. Isidore of Seville",sectionId:sections[0][0],
    issue:"No verified account link in this fictional fixture."}],
  duplicateLinks:[],sectionRecords:[],readyToStart:false,
  blockers:[{code:"identity_unresolved",label:"One fictional student identity still needs review."},
    {code:"canonical_migration_pending",label:"Reviewed school data are not yet applied."}]
};
test("pilot readiness works at desktop and mobile and denies unready activation",async t=>{
  const http=server();
  await new Promise(ok=>http.listen(0,"127.0.0.1",ok));
  const address=http.address();
  const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
  t.after(async()=>{await browser.close();await new Promise(ok=>http.close(ok));});
  const page=await browser.newPage({viewport:{width:1280,height:850}});
  const browserErrors=[];
  page.on("pageerror",error=>browserErrors.push(error.message));
  await page.addInitScript(data=>{
    window.__fakePilot=structuredClone(data);
    window.__fakePilotCalls=[];
    window.__failNextPilotRead=false;
  },demo);
  const fulfill=(route,body)=>route.fulfill({status:200,contentType:"text/javascript",headers:{"access-control-allow-origin":"*"},body});
  await page.route("**/js/core/firebase-core.js*",route=>fulfill(route,`
    const auth=window.__fakeAuth={
      currentUser:{uid:"fictional-teacher"},
      authStateReady:async()=>{},
      onAuthStateChanged(callback){this.listener=callback;return ()=>{}},
      emit(user){this.currentUser=user;this.listener?.(user)}
    };
    export const app={};export {auth};`));
  await page.route("**/firebase-functions.js*",route=>fulfill(route,`
    export function getFunctions(){return {}}
    export function httpsCallable(){return async({action})=>{
      window.__fakePilotCalls.push(action);
      if(action!=="overview")throw Error("Synthetic pilot forbids all writes");
      if(window.__failNextPilotRead){
        window.__failNextPilotRead=false;throw Error("Synthetic network unavailable");
      }
      return {data:structuredClone(window.__fakePilot)};
    }}`));
  await page.route("**/js/core/auth-guard-v4-pilot.js*",route=>fulfill(route,
    'document.querySelector("#pageBody")?.classList.remove("hidden");'));
  await page.route("**/js/core/adminerva-nav.js*",route=>fulfill(route,""));
  await page.route("**/js/core/adminerva-loader.js*",route=>fulfill(route,""));
  await page.route("https://cdn.tailwindcss.com/**",route=>fulfill(route,""));
  await page.goto(`http://127.0.0.1:${address.port}/school-pilot.html`,{waitUntil:"domcontentloaded"});
  await page.waitForFunction(()=>document.querySelector("#pilot-status")?.textContent==="Controlled-pilot status loaded.");
  assert.equal(await page.locator("#pilot-section-counts article").count(),4);
  assert.match(await page.locator("#pilot-roster-target").innerText(),/169 approved students/);
  assert.equal(await page.locator("#pilot-start-button").isDisabled(),true);
  assert.match(await page.locator("#pilot-blockers").innerText(),/identity still needs review/);
  const output=process.env.ADMINERVA_TEST_OUTPUT||"/tmp/adminerva-v4-pilot-browser";
  await mkdir(output,{recursive:true});
  await page.screenshot({path:output+"/pilot-desktop.png",fullPage:true});
  await page.setViewportSize({width:360,height:760});
  await page.screenshot({path:output+"/pilot-mobile.png",fullPage:true});
  const metrics=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:innerWidth}));
  assert.ok(metrics.scroll<=metrics.viewport+1,
    `Pilot screen must not overflow mobile viewport (${metrics.scroll} > ${metrics.viewport})`);
  await page.evaluate(()=>window.__failNextPilotRead=true);
  await page.locator("#pilot-refresh").click();
  await page.waitForFunction(()=>document.querySelector("#pilot-status")?.textContent?.includes("Synthetic network unavailable"));
  assert.equal(await page.locator("#pilot-workspace").isHidden(),true);
  await page.locator("#pilot-refresh").click();
  await page.waitForFunction(()=>document.querySelector("#pilot-status")?.textContent==="Controlled-pilot status loaded.");
  assert.equal(await page.locator("#pilot-start-button").isDisabled(),true);
  await page.evaluate(()=>window.__fakeAuth.emit(null));
  assert.equal(await page.locator("#pilot-workspace").isHidden(),true);
  assert.equal(browserErrors.length,0,browserErrors.join("\n"));
  assert.ok((await page.evaluate(()=>window.__fakePilotCalls)).every(action=>action==="overview"));
  await page.close();
});
