import {auth} from "../core/firebase-core.js?v=1.3.0";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

const root=document.getElementById("adminerva-nav");
const roleSummary=document.getElementById("settingsRoleSummary");
const emailNode=document.getElementById("settingsAccountEmail");
const roleNode=document.getElementById("settingsAccountRole");
let verifiedRole="",teachingInitialized=false;

function label(role){
  return ({
    teacher:"Teacher",
    registrar:"Registrar",
    schooladmin:"School administrator",
    superadmin:"System administrator",
    platformowner:"Platform administrator"
  })[role]||"Staff";
}
function teachingAuthority(role){
  return role==="teacher"||root?.dataset.schoolTeacher==="true";
}
function panelIsTeaching(panel){
  return Boolean(panel?.matches?.("[data-teaching-settings]"));
}
function applyRole(role){
  verifiedRole=role||"";
  if(role==="student"){
    const target=root?.dataset.schoolStudent==="true"?"school-student-settings.html":"student-settings.html";
    location.replace(target);return;
  }
  const canTeach=teachingAuthority(role);
  for(const node of document.querySelectorAll("[data-teaching-settings]"))node.hidden=!canTeach;
  if(roleNode)roleNode.textContent=label(role);
  if(roleSummary)roleSummary.textContent=canTeach
    ?"Common account controls are shown first. Teaching-only connections, rubrics, document exports and presentation defaults are available because this account has teaching authority."
    :"Only common account, notification, display and privacy controls are shown for this role. Teaching defaults are hidden unless the verified school context grants teaching authority.";
  const active=[...document.querySelectorAll(".settings-panel")].find(panel=>!panel.classList.contains("hidden"));
  if(!canTeach&&panelIsTeaching(active))window.switchSettingsCategory?.("account",{updateHistory:false});
  if(canTeach&&!teachingInitialized){
    teachingInitialized=true;
    window.initializeTeachingSettings?.();
  }
}
onAuthStateChanged(auth,user=>{
  if(emailNode)emailNode.textContent=user?.email||"Not signed in";
});
document.addEventListener("adminerva:role-ready",event=>{
  const role=event.detail?.role;
  if(["student","teacher","registrar","schooladmin","superadmin","platformowner"].includes(role))applyRole(role);
});
if(root?.dataset.verifiedRole)applyRole(root.dataset.verifiedRole);
else{
  for(const node of document.querySelectorAll("[data-teaching-settings]"))node.hidden=true;
  if(roleSummary)roleSummary.textContent="Verifying which settings are available to this account…";
}
