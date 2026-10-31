import {app,auth} from "./firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
const functions=getFunctions(app,"asia-southeast1");
const api=httpsCallable(functions,"platformSchools");
const readinessApi=httpsCallable(functions,"schoolCutoverReadiness");
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
  byId("owner-cutover").hidden=selected.compatibilityMode==="v4_only";
  byId("owner-cutover-rollback").hidden=selected.compatibilityMode!=="v4_only";
  byId("owner-cutover-mode").textContent="Compatibility: "+(selected.compatibilityMode||"legacy_allowed").replace("_"," ");
  void loadReadiness(selected.schoolId);
}
async function loadReadiness(schoolId=selected?.schoolId){
  const host=byId("owner-readiness");
  if(!schoolId){host.textContent="Select a school.";return null;}
  host.textContent="Checking canonical school integrity…";
  try{
    const result=(await readinessApi({action:"overview",schoolId})).data;
    if(selected?.schoolId!==schoolId)return null;
    host.replaceChildren();
    const summary=document.createElement("p");summary.style.fontWeight="700";
    summary.textContent=result.ready?"Technical readiness checks passed.":"Cutover blocked by "+result.blockers.length+" technical check(s).";
    host.append(summary);
    const list=document.createElement("ul");list.style.cssText="margin:.6rem 0 0;padding-left:1.2rem";
    for(const check of result.checks||[]){
      const item=document.createElement("li");
      item.textContent=(check.ok?"✓ ":"✕ ")+check.label+" — "+check.detail;
      if(!check.ok)item.style.color="#9f1239";
      list.append(item);
    }
    host.append(list);
    byId("owner-cutover").querySelector('button[type="submit"]').disabled=!result.ready;
    return result;
  }catch(error){
    if(selected?.schoolId===schoolId)host.textContent=error?.message||"Cutover readiness could not be checked.";
    return null;
  }
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
    meta.textContent=" · "+school.state+" · "+school.schoolId+" · "+String(school.compatibilityMode||"legacy_allowed").replace("_"," ");
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
byId("owner-admin-suspend").addEventListener("submit",event=>{
  event.preventDefault();if(!selected)return;
  const f=event.currentTarget,d=new FormData(f);
  const targetUid=String(d.get("targetUid")||"").trim();
  if(!confirm("Suspend this school administrator for "+selected.displayName+"? This pauses all V4 access for that school membership."))return;
  void submit(f,"suspend_school_admin",{schoolId:selected.schoolId,targetUid,
    reason:String(d.get("reason")||"").trim()});
});
byId("owner-admin-restore").addEventListener("submit",event=>{
  event.preventDefault();if(!selected)return;
  const f=event.currentTarget,d=new FormData(f);
  void submit(f,"restore_school_admin",{schoolId:selected.schoolId,
    targetUid:String(d.get("targetUid")||"").trim(),
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
byId("owner-readiness-refresh").addEventListener("click",()=>{
  if(selected)void loadReadiness(selected.schoolId);
});
byId("owner-cutover").addEventListener("submit",event=>{
  event.preventDefault();if(!selected)return;
  const f=event.currentTarget,d=new FormData(f),
    keys=["continuityBackupCaptured","migrationReconciled","rollbackReviewed","v4RoutesValidated"],
    attestation=Object.fromEntries(keys.map(key=>[key,d.get(key)==="on"]));
  if(!Object.values(attestation).every(Boolean)){say("Complete all cutover attestations.");return;}
  if(!confirm("Enable V4-only compatibility for "+selected.displayName+"? Legacy 3.x data is preserved, but migrated staff will be fenced from legacy global workspaces."))return;
  void submit(f,"set_compatibility_mode",{schoolId:selected.schoolId,mode:"v4_only",
    reason:String(d.get("reason")||"").trim(),attestation});
});
byId("owner-cutover-rollback").addEventListener("submit",event=>{
  event.preventDefault();if(!selected)return;
  const f=event.currentTarget,d=new FormData(f);
  if(!confirm("Restore legacy compatibility for "+selected.displayName+"? Canonical V4 data will remain unchanged."))return;
  void submit(f,"set_compatibility_mode",{schoolId:selected.schoolId,mode:"legacy_allowed",
    reason:String(d.get("reason")||"").trim()});
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
