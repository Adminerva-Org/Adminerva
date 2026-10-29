/** Read-only proof that GitHub Pages serves this checkout's public release. */
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const base="https://adminerva-org.github.io/Adminerva/";
const pages=[
  ["index.html",["av-public-hero","wiki.html#school-setup"]],
  ["login.html",['id="loginForm"','id="googleLoginBtn"']],
  ["wiki.html",['id="school-setup"',"teacher-accounts.html"]],
  ["manage-sections.html",['data-catalog-kind="sections"','id="catalog-roster-sections"']],
  ["student-practice.html",['id="practiceApp"','js/student/practice-game.mjs']],
  ["guest-home.html",['data-home-experience="guest"','js/core/home-experience.mjs']],
  ["student-home.html",['data-home-experience="student"','js/core/home-pulse.mjs']],
  ["teacher-home.html",['data-home-experience="teacher"','js/core/home-pulse.mjs']],
  ["school-admin.html",['data-home-experience="admin"','js/core/home-experience.mjs']],
  ["reclaim-inbox.html",['id="reclaimRefresh"','js/repo-review/reclaim-inbox.mjs']]
];
const assets=["css/adminerva-ui.css","css/documentation.css","js/core/adminerva-nav.js","js/core/adminerva-loader.js","js/core/school-catalog.mjs","js/student/practice.js","js/student/practice-standings.mjs","js/settings/settings-security.js","js/lesson-review/library.js","css/home-experience.css","css/home-showcase.css","js/core/home-experience.mjs","js/core/home-showcase.mjs","js/core/home-pulse.mjs","js/student/assessment-evidence.mjs","js/repo-review/assessment-evidence-review.mjs","js/repo-review/services/reclaim-decision.mjs","js/repo-review/reclaim-inbox.mjs"];
const digest=bytes=>createHash("sha256").update(bytes).digest("hex");
function manifest(bytes,label){
  let value;try{value=JSON.parse(Buffer.from(bytes).toString("utf8"));}catch{throw Error(label+" is not valid JSON.");}
  if(!value||Array.isArray(value)||typeof value!=="object"||typeof value.version!=="string"||!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(value.version))throw Error(label+" has an invalid release version.");
  return value;
}

export async function checkPagesRelease({fetchImpl=globalThis.fetch,readLocal=path=>readFile(new URL("../"+path,import.meta.url)),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=Date.now,attempts=30,log=value=>console.log(JSON.stringify(value))}={}){
  if(!Number.isInteger(attempts)||attempts<1||attempts>30)throw Error("Release polling requires 1–30 attempts.");
  const expected=manifest(await readLocal("site-release.json"),"Local site-release.json").version;
  const deadline=now()+300000;
  const request=async(path,timeout=15000)=>{
    const url=new URL(path,base);url.searchParams.set("release_check",expected+"-"+now());
    const response=await fetchImpl(url.href,{method:"GET",credentials:"omit",redirect:"error",cache:"no-store",signal:AbortSignal.timeout(Math.max(1,timeout))});
    if(response.status!==200)throw Error(path+" returned HTTP "+response.status+"; expected 200.");
    return Buffer.from(await response.arrayBuffer());
  };
  let matched=false,lastReason="Release manifest was not checked.",manifestAttempts=0;
  for(let attempt=1;attempt<=attempts&&now()<deadline;attempt++){
    manifestAttempts=attempt;
    try{
      const live=manifest(await request("site-release.json",Math.min(15000,deadline-now())),"Deployed site-release.json");
      if(live.version===expected){matched=true;break;}
      lastReason="Deployed version is "+live.version+"; expected "+expected+".";
    }catch(error){lastReason=error.message||"Manifest request failed.";}
    log({event:"waiting_for_pages",attempt,expectedVersion:expected,reason:lastReason});
    if(attempt<attempts&&now()<deadline)await sleep(Math.min(10000,deadline-now()));
  }
  if(!matched)throw Error("Pages did not publish version "+expected+" within the bounded polling window ("+manifestAttempts+" attempts). "+lastReason);

  // Independent public reads run together; each request, including its body, has a 15-second deadline.
  const results=await Promise.all([
    ...pages.map(async([path,markers])=>{
      const [deployed,checkout]=await Promise.all([request(path),readLocal(path)]);
      const text=deployed.toString("utf8");
      for(const marker of markers)if(!text.includes(marker))throw Error(path+" is missing expected release content: "+marker);
      const actual=digest(deployed),expectedHash=digest(checkout);
      if(actual!==expectedHash)throw Error(path+" SHA-256 differs from this checkout (expected "+expectedHash+", received "+actual+").");
      return {path,status:200,contentMarkers:true,sha256:actual,matchesCheckout:true,version:expected};
    }),
    ...assets.map(async path=>{
      const [deployed,checkout]=await Promise.all([request(path),readLocal(path)]);
      const actual=digest(deployed),expectedHash=digest(checkout);
      if(actual!==expectedHash)throw Error(path+" SHA-256 differs from this checkout (expected "+expectedHash+", received "+actual+").");
      return {path,status:200,sha256:actual,matchesCheckout:true};
    })
  ]);
  const proof={event:"pages_release_verified",base,version:expected,manifestAttempts,verifiedAt:new Date(now()).toISOString(),files:results};
  log(proof);return proof;
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  checkPagesRelease().catch(error=>{console.error(JSON.stringify({event:"pages_release_failed",message:error.message}));process.exitCode=1;});
}
