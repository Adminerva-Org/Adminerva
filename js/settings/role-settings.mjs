import {auth} from "../core/firebase-core.js?v=1.3.0";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

const root=document.getElementById("adminerva-nav");
const roleSummary=document.getElementById("settingsRoleSummary");
const emailNode=document.getElementById("settingsAccountEmail");
const roleNode=document.getElementById("settingsAccountRole");
const roleChips=document.getElementById("settingsRoleChips");
let verifiedRole="",teachingInitialized=false,lastContext=null;

function label(role){
  return ({
    student:"Student",
    teacher:"Teacher",
    registrar:"Registrar",
    schooladmin:"School administrator",
    superadmin:"System administrator",
    platformowner:"Platform administrator"
  })[role]||"Staff";
}
function normalizedContext(role,detail={}){
  return {
    role,
    platformAdmin:Boolean(detail.platformAdmin??root?.dataset.platformAdmin==="true"),
    schoolAdmin:Boolean(detail.schoolAdmin??root?.dataset.schoolAdmin==="true"),
    schoolRegistrar:Boolean(detail.schoolRegistrar??root?.dataset.schoolRegistrar==="true"),
    schoolTeacher:Boolean(detail.schoolTeacher??root?.dataset.schoolTeacher==="true"),
    schoolStudent:Boolean(detail.schoolStudent??root?.dataset.schoolStudent==="true")
  };
}
function accessLabels(context){
  const roles=[];
  const add=(key,title)=>{if(!roles.some(item=>item.key===key))roles.push({key,title});};
  if(context.platformAdmin)add("platformowner","Platform administrator");
  if(context.schoolAdmin)add("schooladmin","School administrator");
  if(context.schoolRegistrar)add("registrar","Registrar");
  if(context.schoolTeacher)add("teacher","Teacher");
  if(context.schoolStudent)add("student","Student");
  if(!roles.length)add(context.role,label(context.role));
  return roles;
}
function teachingAuthority(context){
  return context.role==="teacher"||context.schoolTeacher;
}
function panelIsTeaching(panel){
  return Boolean(panel?.matches?.("[data-teaching-settings]"));
}
function renderRoles(context){
  const roles=accessLabels(context);
  const primary=roles.find(item=>item.key===context.role)||roles[0];
  if(roleNode)roleNode.textContent=roles.map(item=>item.title).join(" · ");
  if(roleChips){
    roleChips.replaceChildren();
    for(const item of roles){
      const chip=document.createElement("span");
      chip.className="av-settings-role-chip";
      chip.dataset.primary=String(item.key===primary?.key);
      chip.textContent=item.title;
      roleChips.append(chip);
    }
  }
  return roles;
}
function applyRole(role,detail={}){
  verifiedRole=role||"";
  const context=normalizedContext(role,detail);lastContext=context;
  if(role==="student"){
    const target=context.schoolStudent?"school-student-settings.html":"student-settings.html";
    location.replace(target);return;
  }
  const canTeach=teachingAuthority(context),roles=renderRoles(context);
  document.documentElement.dataset.adminervaSettingsRole=role;
  for(const node of document.querySelectorAll("[data-teaching-settings]"))node.hidden=!canTeach;
  if(roleSummary)roleSummary.textContent=canTeach
    ?"Personal settings stay separate from teaching defaults. Teaching tools are available because this account currently has teacher access."
    :"This role uses personal account, notification, display and privacy settings only. Teacher-specific defaults stay hidden unless teacher access is granted.";
  const active=[...document.querySelectorAll(".settings-panel")].find(panel=>!panel.classList.contains("hidden"));
  if(!canTeach&&panelIsTeaching(active))window.switchSettingsCategory?.("account",{updateHistory:false});
  if(canTeach&&!teachingInitialized){
    teachingInitialized=true;
    window.initializeTeachingSettings?.();
  }
  document.dispatchEvent(new CustomEvent("adminerva:settings-role-context",{
    detail:{...context,canTeach,roles}
  }));
}
onAuthStateChanged(auth,user=>{
  if(emailNode)emailNode.textContent=user?.email||"Not signed in";
});
document.addEventListener("adminerva:role-ready",event=>{
  const role=event.detail?.role;
  if(["student","teacher","registrar","schooladmin","superadmin","platformowner"].includes(role))
    applyRole(role,event.detail||{});
});
if(root?.dataset.verifiedRole)applyRole(root.dataset.verifiedRole,{});
else{
  for(const node of document.querySelectorAll("[data-teaching-settings]"))node.hidden=true;
  if(roleSummary)roleSummary.textContent="Verifying which settings are available to this account…";
}
