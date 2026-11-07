import {app,auth} from "./firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
const functions=getFunctions(app,"asia-southeast1");
const api=httpsCallable(functions,"platformSchools");
const readinessApi=httpsCallable(functions,"schoolCutoverReadiness");
const byId=id=>document.getElementById(id);
const status=byId("owner-status"),workspace=byId("owner-content"),
  schoolList=byId("owner-schools"),actions=byId("owner-actions");
let selected=null,schools=[],busy=false,latestReadiness=null,latestCutoverPackage=null;
const say=text=>status.textContent=text;
async function execute(action,details={}){
  return (await api({action,...details})).data;
}
function updateCutoverAvailability(){
  const button=byId("owner-cutover")?.querySelector('button[type="submit"]');
  if(!button||!selected)return;
  const packageReady=selected.schoolId!=="mcs-manila"||
    (latestCutoverPackage?.recorded===true&&latestCutoverPackage?.ready===true&&latestCutoverPackage?.fresh===true);
  button.disabled=!(latestReadiness?.ready===true&&packageReady);
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
  latestReadiness=null;latestCutoverPackage=null;
  const packageSection=byId("owner-cutover-package-section");
  if(packageSection)packageSection.hidden=selected.schoolId!=="mcs-manila";
  updateCutoverAvailability();
  void loadReadiness(selected.schoolId);
  void loadCutoverPackage(selected.schoolId);
  void loadCutoverDecisions(selected.schoolId);
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
    latestReadiness=result;updateCutoverAvailability();
    return result;
  }catch(error){
    if(selected?.schoolId===schoolId)host.textContent=error?.message||"Cutover readiness could not be checked.";
    return null;
  }
}
async function loadCutoverPackage(schoolId=selected?.schoolId){
  const host=byId("owner-cutover-package-status");
  if(!host||!schoolId)return null;
  if(schoolId!=="mcs-manila"){
    latestCutoverPackage={required:false,recorded:false,ready:true,fresh:true};
    updateCutoverAvailability();return latestCutoverPackage;
  }
  host.textContent="Checking the recorded MCS cutover package…";
  try{
    const result=await execute("get_mcs_cutover_package",{schoolId});
    if(selected?.schoolId!==schoolId)return null;
    latestCutoverPackage=result;
    if(!result.recorded)host.textContent="No successful cutover package is recorded yet.";
    else if(!result.ready)host.textContent="The recorded cutover package is not marked ready.";
    else if(!result.fresh)host.textContent="The recorded cutover package is older than 24 hours. Generate and record a fresh package.";
    else host.textContent="Cutover package recorded and fresh · package "+String(result.packageSha256||"").slice(0,12)+"…";
    updateCutoverAvailability();
    return result;
  }catch(error){
    latestCutoverPackage=null;updateCutoverAvailability();
    if(selected?.schoolId===schoolId)host.textContent=error?.message||"Cutover package status could not be loaded.";
    return null;
  }
}
async function loadCutoverDecisions(schoolId=selected?.schoolId){
  const form=byId("owner-cutover-decisions"),message=byId("owner-cutover-decisions-status");
  if(!form||!message||!schoolId)return null;
  message.textContent="Loading owner decision record…";
  try{
    const result=await execute("get_cutover_decisions",{schoolId});
    if(selected?.schoolId!==schoolId)return null;
    const data=result.decisions||{};
    for(const name of ["institutionalAuthorityReference","calendarReference","privacyPolicyReference",
      "retentionPolicyReference","retentionMode","backupPolicyReference","dataStewardRole",
      "aiPermission","repositoryPermission","notes"]){
      const field=form.elements.namedItem(name);if(field)field.value=data[name]||"";
    }
    for(const name of ["firstAdminAcknowledged","schoolAdminConfigurationReviewed"]){
      const field=form.elements.namedItem(name);if(field)field.checked=data[name]===true;
    }
    const first=result.firstAdminUid||"not designated";
    message.textContent=result.decisions?
      "Decision record loaded. First school administrator: "+first+(result.firstAdminActive?" (active).":" (not active)."):
      "No decision record yet. First school administrator: "+first+(result.firstAdminActive?" (active).":" (not active).");
    return result;
  }catch(error){
    if(selected?.schoolId===schoolId)message.textContent=error?.message||"Owner decisions could not be loaded.";
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
byId("owner-cutover-package").addEventListener("submit",async event=>{
  event.preventDefault();if(!selected||selected.schoolId!=="mcs-manila"||busy)return;
  const f=event.currentTarget;if(!f.reportValidity())return;
  const d=new FormData(f),file=d.get("packageFile");
  if(!(file instanceof File)||!file.size){say("Choose the generated MCS cutover package JSON.");return;}
  if(file.size>512000){say("Cutover package file is unexpectedly large. Regenerate the summary package.");return;}
  let packageData;
  try{packageData=JSON.parse(await file.text());}
  catch{say("The selected cutover package is not valid JSON.");return;}
  if(!confirm("Record this successful MCS cutover package for "+selected.displayName+"? This does not switch compatibility mode."))return;
  void submit(f,"record_mcs_cutover_package",{schoolId:selected.schoolId,package:packageData,
    reason:String(d.get("reason")||"").trim()});
});
byId("owner-cutover-decisions").addEventListener("submit",event=>{
  event.preventDefault();if(!selected)return;
  const f=event.currentTarget,d=new FormData(f);
  const decisions={
    institutionalAuthorityReference:String(d.get("institutionalAuthorityReference")||"").trim(),
    calendarReference:String(d.get("calendarReference")||"").trim(),
    privacyPolicyReference:String(d.get("privacyPolicyReference")||"").trim(),
    retentionPolicyReference:String(d.get("retentionPolicyReference")||"").trim(),
    retentionMode:String(d.get("retentionMode")||""),
    backupPolicyReference:String(d.get("backupPolicyReference")||"").trim(),
    dataStewardRole:String(d.get("dataStewardRole")||"school_admin").trim(),
    aiPermission:String(d.get("aiPermission")||""),
    repositoryPermission:String(d.get("repositoryPermission")||""),
    firstAdminAcknowledged:d.get("firstAdminAcknowledged")==="on",
    schoolAdminConfigurationReviewed:d.get("schoolAdminConfigurationReviewed")==="on",
    notes:String(d.get("notes")||"").trim()
  };
  void submit(f,"save_cutover_decisions",{schoolId:selected.schoolId,decisions,
    reason:String(d.get("reason")||"").trim()});
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
