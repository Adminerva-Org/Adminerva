import {detectDownloadPlatform,getInstallHint} from "./downloads-platform.mjs?v=20261123-1";
const nav=navigator;
const device=detectDownloadPlatform(nav.userAgent,nav.platform,nav.maxTouchPoints||0);
const standalone=()=>window.matchMedia?.("(display-mode: standalone)")?.matches===true||nav.standalone===true;
const installButton=document.getElementById("downloadInstallButton");
const installHint=document.getElementById("downloadInstallHint");
const installStatus=document.getElementById("downloadInstallStatus");
const installHeading=document.getElementById("downloadInstallHeading");
let installEvent=null;
function updateInstall(){
 if(!installHint)return;
 installHint.textContent=getInstallHint(device,{standalone:standalone(),installPrompt:!!installEvent});
 installButton.hidden=standalone()||!installEvent;
 if(standalone())installHeading.textContent="Adminerva web experience installed";
}
document.querySelector('[data-platform="'+device+'"]')?.setAttribute("data-recommended","true");
const guide={windows:"desktop-instructions",macos:"desktop-instructions",android:"android-instructions",ios:"ios-instructions"}[device];
if(guide)document.getElementById(guide)?.setAttribute("data-recommended","true");
window.addEventListener("beforeinstallprompt",event=>{
 // The browser alone decides whether installation is available.
 event.preventDefault();
 installEvent=event;
 updateInstall();
});
installButton?.addEventListener("click",async()=>{
 if(!installEvent)return;
 const event=installEvent;
 installEvent=null;
 installButton.hidden=true;
 try{
  await event.prompt();
  const choice=await event.userChoice;
  installStatus.textContent=choice?.outcome==="accepted"
   ?"Your browser accepted the installation request. Follow any remaining browser prompts."
   :"Installation was not completed. You can still open Adminerva in your browser.";
 }catch{
  installStatus.textContent="Installation is unavailable from this browser. Use the instructions below or open Adminerva on the web.";
 }
 updateInstall();
});
window.addEventListener("appinstalled",()=>{
 installEvent=null;
 installStatus.textContent="Adminerva's web experience was installed. Native Companion features are not included.";
 updateInstall();
});
updateInstall();
