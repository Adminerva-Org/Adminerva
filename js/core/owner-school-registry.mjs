import {app,auth} from "./firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
const api=httpsCallable(getFunctions(app,"asia-southeast1"),"platformSchools");
const byId=id=>document.getElementById(id);
const status=byId("owner-status"),workspace=byId("owner-content"),
  schoolList=byId("owner-schools"),actions=byId("owner-actions");
let selected=null,schools=[],busy=false;
const say=text=>status.textContent=text;
async function execute(action,details={}){
  return (await api({action,...details})).data;
}
function choose(id){
  selected=schools.find(s=>s.schoolId===id)||null;
  for(const button of schoolList.querySelectorAll("button"))button.setAttribute("aria-pressed",String(button.dataset.schoolId===id));
  actions.hidden=!selected;
  if(!selected)return;
  byId("owner-current").textContent=selected.displayName;
  byId("owner-current-status").textContent=selected.schoolId+" · "+selected.state+" · revision "+selected.revision;
  byId("owner-activate").hidden=selected.state!=="draft";
  byId("owner-suspend").hidden=selected.state!=="active";
  byId("owner-grant").hidden=selected.state==="archived";
}
async function refresh(prefer=selected?.schoolId){
  const records=await execute("list");
  schools=Array.isArray(records.schools)?records.schools:[];
  schoolList.replaceChildren();
  for(const school of schools){
    const item=document.createElement("div");item.setAttribute("role","list");
    const button=document.createElement("button");
    button.type="button";button.dataset.schoolId=school.schoolId;
    const name=document.createElement("strong");name.textContent=school.displayName;
    const meta=document.createElement("span");meta.className="own-muted";
    meta.textContent=" · "+school.state+" · "+school.schoolId;
    button.append(name,meta);
    button.addEventListener("click",()=>choose(school.schoolId));
    item.append(button);schoolList.append(item);
  }
  if(!schools.length){
    const blank=document.createElement("p");blank.className="own-muted";
    blank.textContent="No schools have been provisioned.";
    schoolList.append(blank);
  }
  choose(prefer||schools[0]?.schoolId);
  workspace.hidden=false;
}
async function submit(form,action,fields){
  if(busy)return;
  if(!form.reportValidity())return;
  const buttons=[...document.querySelectorAll(".own-button")];
  busy=true;buttons.forEach(button=>button.disabled=true);
  say("Checking owner privileges and recording the action…");
  try {
    const response=await execute(action,fields);
    say("School operation recorded: "+action.replaceAll("_"," ")+".");
    form.reset();
    await refresh(response.schoolId||fields.schoolId);
  }catch(error){say(error?.message||"The change was not recorded. No local permission was granted.");}
  finally{busy=false;buttons.forEach(button=>button.disabled=false);}
}
byId("owner-create").addEventListener("submit",event=>{
  event.preventDefault();const f=event.currentTarget,d=new FormData(f);
  void submit(f,"create_draft",{schoolId:String(d.get("schoolId")||"").trim(),
    displayName:String(d.get("displayName")||"").trim()});
});
byId("owner-grant").addEventListener("submit",event=>{
  event.preventDefault();if(!selected)return;
  const f=event.currentTarget,d=new FormData(f);
  void submit(f,"grant_school_admin",{schoolId:selected.schoolId,targetUid:String(d.get("targetUid")||"").trim(),
    reason:String(d.get("reason")||"").trim()});
});
byId("owner-activate").addEventListener("submit",event=>{
  event.preventDefault();if(!selected)return;
  const f=event.currentTarget,d=new FormData(f);
  const attestation=Object.fromEntries(["institutionalDataAuthority","provenanceVerified","calendarConfigured","privacyPolicyApproved"]
    .map(name=>[name,d.get(name)==="on"]));
  if(!Object.values(attestation).every(Boolean)){say("Complete all required institutional attestations.");return;}
  if(!confirm("Activate "+selected.displayName+"? Only proceed with verified authority and readiness."))return;
  void submit(f,"activate",{schoolId:selected.schoolId,reason:String(d.get("reason")||"").trim(),attestation});
});
byId("owner-suspend").addEventListener("submit",event=>{
  event.preventDefault();if(!selected)return;
  const f=event.currentTarget,d=new FormData(f);
  if(!confirm("Suspend "+selected.displayName+"? All verified v4 school access will be denied."))return;
  void submit(f,"suspend",{schoolId:selected.schoolId,reason:String(d.get("reason")||"").trim()});
});
try {
  await auth.authStateReady();
  if(!auth.currentUser?.emailVerified){
    say("Sign in with a verified Platform Administrator account.");
    const link=document.createElement("a");link.href="login.html";link.textContent="Sign in";
    status.append(" ",link);
  }else{
    await refresh();
    say("Owner school registry loaded. School-specific private academic records are never displayed here.");
  }
}catch(error){
  workspace.hidden=true;
  say(error?.message||"Your account does not have verified platform-owner access.");
}
