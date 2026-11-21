import {app,auth} from "./firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
const functions=getFunctions(app,"asia-southeast1");
const api=httpsCallable(functions,"platformSchools");
const usersApi=httpsCallable(functions,"platformUsers");
const readinessApi=httpsCallable(functions,"schoolCutoverReadiness");
const byId=id=>document.getElementById(id);
const status=byId("owner-status"),workspace=byId("owner-content"),
  schoolList=byId("owner-schools"),actions=byId("owner-actions");
let selected=null,schools=[],governanceRoles=[],schoolGovernanceAssignments=[],governanceRoleEdit=null,
  governanceLifecycleChange=null,schoolAdmins=[],busy=false,latestReadiness=null,latestCutoverPackage=null,
  onboardingSchoolId="",selectionEpoch=0;
const say=text=>status.textContent=text;
function scopedForms(){return [...actions.querySelectorAll("form")].filter(form=>form.id!=="owner-governance-create");}
function setFormReady(form,ready){
  if(!form)return;
  form.dataset.scopeReady=String(ready);
  for(const field of form.elements)field.disabled=busy||!ready;
}
function resetSchoolForms(){
  for(const form of scopedForms()){
    form.reset();
    form.dataset.schoolId=selected?.schoolId||"";
    form.dataset.selectionEpoch=String(selectionEpoch);
    setFormReady(form,!["owner-cutover-decisions","owner-governance-assign","owner-activate-standard","owner-resume"].includes(form.id));
  }
  byId("owner-governance-role-select")?.replaceChildren();
}
async function execute(action,details={}){
  return (await api({action,...details})).data;
}
async function resolveAccountUid(value,{allowDisabled=false}={}){
  const identity=String(value||"").trim();
  if(!identity)throw new Error("Enter the administrator email or account UID.");
  if(!identity.includes("@"))return identity;
  const result=(await usersApi({action:"lookup",query:identity})).data;
  const account=result?.account;
  if(!account?.uid)throw new Error("The account could not be resolved.");
  if(account.disabled&&!allowDisabled)
    throw new Error("This Firebase account is disabled. Re-enable the account before granting or restoring school access.");
  return account.uid;
}
function isLegacyProvisioning(school=selected){
  if(!school)return false;
  return school.provisioningMode==="legacy_migration"||
    (school.provisioningMode!=="standard"&&(school.compatibilityMode||"legacy_allowed")==="legacy_allowed");
}
function updateCutoverAvailability(){
  const button=byId("owner-cutover")?.querySelector('button[type="submit"]');
  if(!button||!selected)return;
  const packageReady=selected.schoolId!=="mcs-manila"||
    (latestCutoverPackage?.recorded===true&&latestCutoverPackage?.ready===true&&latestCutoverPackage?.fresh===true);
  button.disabled=busy||!(latestReadiness?.ready===true&&packageReady);
}
function choose(id,afterWrite=false){
  if(busy&&!afterWrite)return;
  ++selectionEpoch;
  selected=schools.find(s=>s.schoolId===id)||null;
  resetSchoolForms();
  for(const button of schoolList.querySelectorAll("button"))
    button.setAttribute("aria-pressed",String(button.dataset.schoolId===id));
  actions.hidden=!selected;
  if(!selected)return;

  const legacy=isLegacyProvisioning(selected);
  byId("owner-current").textContent=selected.displayName;
  byId("owner-current-status").textContent=selected.schoolId+" · "+selected.state+" · "+
    (legacy?"legacy pilot / migration":"standard school setup")+" · revision "+selected.revision;

  const lifecycle=byId("owner-pilot-command"),
    lifecycleLabel=lifecycle?.querySelector("p"),lifecycleHeading=lifecycle?.querySelector("h3"),
    summary=byId("owner-pilot-summary"),jump=byId("owner-pilot-jump");
  if(lifecycleLabel)lifecycleLabel.textContent=legacy?"Legacy school lifecycle":"School lifecycle";
  if(lifecycleHeading)lifecycleHeading.textContent=legacy?"Pilot / migration state":"School setup & activation";

  if(legacy){
    if(summary){
      if(selected.state==="draft")summary.textContent="Draft legacy tenant · Review migration readiness before starting the controlled pilot.";
      else if(selected.state==="pilot")summary.textContent="Legacy pilot active · Continue Quarter 3 work here; legacy compatibility remains available.";
      else if(selected.state==="active")summary.textContent="Legacy institution active · Review migration/cutover controls before changing compatibility.";
      else summary.textContent=selected.state+" · Review the historical institution lifecycle.";
    }
    if(jump){
      jump.textContent=selected.state==="draft"?"Review legacy pilot setup":
        selected.state==="pilot"?"Review legacy pilot":"Review legacy institution controls";
      jump.hidden=selected.state==="archived";
    }
  }else{
    if(summary){
      if(selected.state==="draft")summary.textContent="Draft · Complete the school setup checklist, then activate the school. No pilot or migration cutover is required.";
      else if(selected.state==="active")summary.textContent="Active · This is a standard school tenant for normal teacher and student operations.";
      else if(selected.state==="suspended")summary.textContent="Suspended · Existing school data is preserved while normal access is paused.";
      else summary.textContent=selected.state+" · Standard school provisioning.";
    }
    if(jump){
      jump.textContent=selected.state==="draft"?"Continue school setup":"Review school setup";
      jump.hidden=selected.state==="archived";
    }
  }

  const standard=byId("owner-standard-setup");
  if(standard)standard.hidden=legacy;
  for(const node of document.querySelectorAll("[data-legacy-provisioning]"))node.hidden=!legacy;

  byId("owner-start-pilot").hidden=!legacy||selected.state!=="draft";
  byId("owner-end-pilot").hidden=!legacy||selected.state!=="pilot";
  byId("owner-activate").hidden=!legacy||!["draft","pilot"].includes(selected.state);
  byId("owner-suspend").hidden=selected.state!=="active";
  byId("owner-resume").hidden=selected.state!=="suspended";
  byId("owner-grant").hidden=selected.state==="archived";
  byId("owner-cutover").hidden=!legacy||selected.compatibilityMode==="v4_only";
  byId("owner-cutover-rollback").hidden=!legacy||selected.compatibilityMode!=="v4_only";
  byId("owner-cutover-mode").textContent=legacy?
    "Legacy compatibility: "+(selected.compatibilityMode||"legacy_allowed").replace("_"," "):"";

  latestReadiness=null;latestCutoverPackage=null;updateCutoverAvailability();
  if(byId("owner-activate-standard"))byId("owner-activate-standard").hidden=true;
  const packageSection=byId("owner-cutover-package-section");
  if(packageSection)packageSection.hidden=selected.schoolId!=="mcs-manila";

  if(legacy){
    void loadReadiness(selected.schoolId);
    void loadCutoverPackage(selected.schoolId);
    void loadCutoverDecisions(selected.schoolId);
  }else{
    void loadStandardSetup(selected.schoolId);
  }
  if(selected.state==="suspended")void loadRecoveryStatus(selected.schoolId);
  schoolAdmins=[];renderSchoolAdmins();void loadSchoolAdmins(selected.schoolId);
  void loadSchoolAudit(selected.schoolId);
  void loadGovernanceRoles(selected.schoolId);
}
function administratorIdentity(admin){
  return admin.email||admin.uid;
}
function prefillAdminAccess(admin,mode){
  const form=byId(mode==="restore"?"owner-admin-restore":"owner-admin-suspend");
  if(!form)return;
  form.elements.targetUid.value=administratorIdentity(admin);
  form.scrollIntoView({behavior:"smooth",block:"center"});
  form.elements.reason.focus({preventScroll:true});
}
function renderSchoolAdmins(){
  const host=byId("owner-admin-list"),message=byId("owner-admin-list-status");
  if(!host||!message)return;
  host.replaceChildren();
  if(!schoolAdmins.length){
    const empty=document.createElement("p");empty.className="own-muted";
    empty.textContent="No School Administrator membership is currently recorded.";
    host.append(empty);message.textContent="0 School Administrators loaded.";return;
  }
  const activeCount=schoolAdmins.filter(admin=>admin.status==="active").length;
  for(const admin of schoolAdmins){
    const card=document.createElement("article");
    card.style.cssText="display:flex;justify-content:space-between;align-items:flex-start;gap:.75rem;flex-wrap:wrap;border:1px solid #e2e8f0;border-radius:10px;padding:.75rem;background:#f8fafc";
    const info=document.createElement("div"),name=document.createElement("strong"),meta=document.createElement("p");
    name.textContent=admin.displayName||admin.email||admin.uid;meta.className="own-muted";
    meta.textContent=[
      admin.email||"No account email",
      admin.status,
      "membership rev "+admin.revision,
      admin.isFirstAdmin?"designated first administrator":"",
      admin.accountDisabled?"Firebase account disabled":admin.emailVerified?"verified account":"account verification unavailable"
    ].filter(Boolean).join(" · ");
    info.append(name,meta);
    const controls=document.createElement("div");controls.style.cssText="display:flex;gap:.45rem;flex-wrap:wrap";
    if(admin.status==="active"){
      const button=document.createElement("button");button.type="button";button.className="own-button warn";button.textContent="Suspend";
      button.disabled=activeCount<=1;
      button.title=activeCount<=1?"Designate another active School Administrator before suspending the last administrator.":"";
      button.addEventListener("click",()=>prefillAdminAccess(admin,"suspend"));controls.append(button);
    }else if(admin.status==="suspended"){
      const button=document.createElement("button");button.type="button";button.className="own-button";button.textContent="Restore";
      button.disabled=admin.accountDisabled||!admin.emailVerified;
      button.title=button.disabled?"Restore the Firebase identity to a verified active account first.":"";
      button.addEventListener("click",()=>prefillAdminAccess(admin,"restore"));controls.append(button);
    }
    card.append(info,controls);host.append(card);
  }
  message.textContent=schoolAdmins.length+" School Administrator"+(schoolAdmins.length===1?"":"s")+" loaded · "+activeCount+" active.";
}
async function loadSchoolAdmins(schoolId=selected?.schoolId){
  const turn=selectionEpoch,message=byId("owner-admin-list-status");
  if(!schoolId||!message)return null;
  message.textContent="Loading current School Administrators…";
  try{
    const result=await execute("list_school_admins",{schoolId});
    if(turn!==selectionEpoch||selected?.schoolId!==schoolId)return null;
    schoolAdmins=result.admins||[];renderSchoolAdmins();return result;
  }catch(error){
    if(turn===selectionEpoch&&selected?.schoolId===schoolId){
      schoolAdmins=[];renderSchoolAdmins();
      message.textContent=error?.message||"School Administrators could not be loaded.";
    }
    return null;
  }
}
function reviewedAdminRevision(targetUid){
  const admin=schoolAdmins.find(item=>item.uid===targetUid);
  return Number(admin?.revision)||null;
}
function auditLabel(action){
  return String(action||"platform change").replace(/^school_/,"").replace(/^platform_/,"").replaceAll("_"," ");
}
async function loadSchoolAudit(schoolId=selected?.schoolId){
  const turn=selectionEpoch,host=byId("owner-audit-list"),message=byId("owner-audit-status");
  if(!host||!message||!schoolId)return null;
  host.replaceChildren();message.textContent="Loading recent platform audit history…";
  try{
    const result=await execute("list_school_audit",{schoolId});
    if(turn!==selectionEpoch||selected?.schoolId!==schoolId)return null;
    for(const event of result.events||[]){
      const card=document.createElement("article");
      card.style.cssText="border:1px solid #e2e8f0;border-radius:10px;padding:.75rem;background:#f8fafc";
      const title=document.createElement("strong");title.textContent=auditLabel(event.action);
      const meta=document.createElement("p");meta.className="own-muted";
      meta.textContent=(event.source==="assist"?"System Admin assist · ":"Platform control · ")+
        (event.createdAt?new Date(event.createdAt).toLocaleString():"Time unavailable")+
        (event.actorUid?" · actor "+event.actorUid:"");
      card.append(title,meta);
      const parts=[];
      for(const [key,value] of Object.entries(event.detail||{}))if(value)
        parts.push((key==="reason"?"Reason":key.replaceAll("_"," "))+": "+value);
      if(parts.length){const detail=document.createElement("p");detail.className="own-muted";detail.textContent=parts.join(" · ");card.append(detail);}
      host.append(card);
    }
    if(!host.children.length){
      const empty=document.createElement("p");empty.className="own-muted";empty.textContent="No school-scoped platform audit events are recorded yet.";host.append(empty);
    }
    message.textContent=(result.events||[]).length+" recent event"+((result.events||[]).length===1?"":"s")+" loaded."+
      (result.truncated?" Showing the most recent 50.":"");
    return result;
  }catch(error){
    if(turn===selectionEpoch&&selected?.schoolId===schoolId)message.textContent=error?.message||"Platform audit history could not be loaded.";
    return null;
  }
}
async function loadRecoveryStatus(schoolId=selected?.schoolId){
  const turn=selectionEpoch,form=byId("owner-resume"),host=byId("owner-resume-readiness"),
    refreshButton=byId("owner-resume-refresh");
  if(!form||!host||!schoolId)return null;
  setFormReady(form,false);
  if(refreshButton)refreshButton.disabled=busy;
  host.textContent="Checking production authorization and active School Administrator coverage…";
  try{
    const result=await execute("get_recovery_status",{schoolId});
    if(turn!==selectionEpoch||selected?.schoolId!==schoolId)return null;
    host.replaceChildren();
    const summary=document.createElement("p");summary.style.fontWeight="800";
    summary.textContent=result.canResume
      ?"Recovery checks passed. Institution-level access can be restored after recording a reason."
      :"Recovery is blocked until the requirements below are resolved.";
    host.append(summary);
    const detail=document.createElement("p");detail.className="own-muted";
    detail.textContent="Prior production authorization: "+(result.productionAuthorized?"yes":"no")+
      " · Active School Administrators: "+result.activeAdminCount+
      " · Suspended School Administrators: "+result.suspendedAdminCount;
    host.append(detail);
    if(result.blockers?.length){
      const list=document.createElement("ul");list.style.cssText="margin:.55rem 0 0;padding-left:1.25rem";
      for(const blocker of result.blockers){const item=document.createElement("li");item.textContent=blocker;list.append(item);}
      host.append(list);
    }
    setFormReady(form,result.canResume&&result.state==="suspended"&&result.revision===selected.revision);
    if(refreshButton)refreshButton.disabled=busy;
    return result;
  }catch(error){
    if(turn===selectionEpoch&&selected?.schoolId===schoolId){
      host.textContent=(error?.message||"Recovery requirements could not be checked.")+" Refresh before restoring access.";
      setFormReady(form,false);
      if(refreshButton)refreshButton.disabled=busy;
    }
    return null;
  }
}
async function loadStandardSetup(schoolId=selected?.schoolId){
  const turn=selectionEpoch;
  const host=byId("owner-setup-readiness"),form=byId("owner-activate-standard");
  if(!host||!schoolId)return null;
  setFormReady(form,false);
  host.textContent="Checking school setup…";
  try{
    const result=await execute("get_setup_status",{schoolId});
    if(turn!==selectionEpoch||selected?.schoolId!==schoolId)return null;
    host.replaceChildren();
    const summary=document.createElement("p");summary.style.fontWeight="800";
    summary.textContent=result.ready?
      (result.state==="active"?"School setup is complete and the school is active.":"Required setup is complete. The school can be activated."):
      "Complete "+result.checks.filter(check=>!check.ok).length+" setup item(s) before activation.";
    host.append(summary);
    const list=document.createElement("ol");
    list.style.cssText="margin:.7rem 0 0;padding-left:1.25rem;display:grid;gap:.35rem";
    for(const check of result.checks||[]){
      const item=document.createElement("li");
      item.textContent=(check.ok?"✓ ":"○ ")+check.label+" — "+check.detail;
      item.style.color=check.ok?"#166534":"#475569";
      list.append(item);
    }
    host.append(list);
    if(form){form.hidden=!(result.ready&&result.state==="draft");setFormReady(form,!form.hidden);}
    return result;
  }catch(error){
    if(turn===selectionEpoch&&selected?.schoolId===schoolId)host.textContent=error?.message||"School setup status could not be loaded.";
    if(turn===selectionEpoch&&selected?.schoolId===schoolId&&form)form.hidden=true;
    return null;
  }
}
async function loadReadiness(schoolId=selected?.schoolId){
  const turn=selectionEpoch;
  const host=byId("owner-readiness");
  if(!schoolId){host.textContent="Select a school.";return null;}
  latestReadiness=null;updateCutoverAvailability();
  host.textContent="Checking canonical school integrity…";
  try{
    const result=(await readinessApi({action:"overview",schoolId})).data;
    if(turn!==selectionEpoch||selected?.schoolId!==schoolId)return null;
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
    if(turn===selectionEpoch&&selected?.schoolId===schoolId)host.textContent=error?.message||"Cutover readiness could not be checked.";
    return null;
  }
}
async function loadCutoverPackage(schoolId=selected?.schoolId){
  const turn=selectionEpoch;
  const host=byId("owner-cutover-package-status");
  if(!host||!schoolId)return null;
  if(schoolId!=="mcs-manila"){
    latestCutoverPackage={required:false,recorded:false,ready:true,fresh:true};
    updateCutoverAvailability();return latestCutoverPackage;
  }
  latestCutoverPackage=null;updateCutoverAvailability();
  host.textContent="Checking the recorded MCS cutover package…";
  try{
    const result=await execute("get_mcs_cutover_package",{schoolId});
    if(turn!==selectionEpoch||selected?.schoolId!==schoolId)return null;
    latestCutoverPackage=result;
    if(!result.recorded)host.textContent="No successful cutover package is recorded yet.";
    else if(!result.ready)host.textContent="The recorded cutover package is not marked ready.";
    else if(!result.fresh)host.textContent="The recorded cutover package is older than 24 hours. Generate and record a fresh package.";
    else host.textContent="Cutover package recorded and fresh · package "+String(result.packageSha256||"").slice(0,12)+"…";
    updateCutoverAvailability();
    return result;
  }catch(error){
    if(turn===selectionEpoch&&selected?.schoolId===schoolId){latestCutoverPackage=null;updateCutoverAvailability();}
    if(turn===selectionEpoch&&selected?.schoolId===schoolId)host.textContent=error?.message||"Cutover package status could not be loaded.";
    return null;
  }
}
function governanceRoleById(roleId){
  return governanceRoles.find(role=>role.roleId===roleId)||null;
}
function cancelGovernanceRoleEdit({quiet=false}={}){
  const form=byId("owner-governance-create");
  governanceRoleEdit=null;
  if(form){
    form.reset();
    form.elements.roleId.readOnly=false;
    byId("owner-governance-create-submit").textContent="Create governance role";
    byId("owner-governance-edit-cancel").hidden=true;
  }
  if(!quiet)say("Governance role edit cancelled.");
}
function beginGovernanceRoleEdit(role){
  if(busy||role.status!=="active")return;
  governanceRoleEdit={...role};
  const form=byId("owner-governance-create");
  form.elements.roleId.value=role.roleId;form.elements.roleId.readOnly=true;
  form.elements.displayName.value=role.displayName||"";
  form.elements.description.value=role.description||"";
  byId("owner-governance-create-submit").textContent="Save governance role";
  byId("owner-governance-edit-cancel").hidden=false;
  form.scrollIntoView({behavior:"smooth",block:"center"});
  form.elements.displayName.focus({preventScroll:true});
}
function openGovernanceLifecycle(change){
  if(busy)return;
  governanceLifecycleChange=change;
  const form=byId("owner-governance-lifecycle-form");form.reset();
  const role=change.role||governanceRoleById(change.assignment?.roleId),
    actionLabel=change.type==="role"
      ?(change.mode==="restore"?"Restore role":"Archive role")
      :(change.mode==="restore"?"Restore school assignment":"End school assignment");
  byId("owner-governance-lifecycle-title").textContent=actionLabel;
  byId("owner-governance-lifecycle-target").textContent=
    (role?.displayName||role?.roleId||change.assignment?.roleId||"Governance role")+
    (change.type==="assignment"&&selected?" · "+selected.displayName:"");
  byId("owner-governance-lifecycle-help").textContent=change.type==="role"
    ?change.mode==="restore"
      ?"Restoring makes this policy-responsibility label available for assignment again. It does not grant any application permission."
      :"Archive only after active school assignments are ended. Historical assignments and audit events remain retained."
    :change.mode==="restore"
      ?"Restoring reactivates this policy-responsibility assignment only. The platform role definition must also be active."
      :"Ending removes this governance responsibility from the selected school without deleting its assignment history.";
  const confirm=byId("owner-governance-lifecycle-confirm");
  confirm.textContent=actionLabel;confirm.className="own-button "+(change.mode==="restore"?"":"warn");
  byId("owner-governance-lifecycle-dialog").showModal();
}
function renderGovernanceRoles(){
  const catalogHost=byId("owner-governance-catalog-list"),
    assignmentHost=byId("owner-governance-assignment-list");
  if(catalogHost){
    catalogHost.replaceChildren();
    const ordered=[...governanceRoles].sort((a,b)=>
      Number(a.status==="archived")-Number(b.status==="archived")||
      String(a.displayName||a.roleId).localeCompare(String(b.displayName||b.roleId)));
    for(const role of ordered){
      const card=document.createElement("article");
      card.style.cssText="display:flex;justify-content:space-between;align-items:flex-start;gap:.65rem;flex-wrap:wrap;border:1px solid #e2e8f0;border-radius:10px;padding:.7rem;background:#f8fafc";
      const info=document.createElement("div"),name=document.createElement("strong"),meta=document.createElement("p");
      name.textContent=role.displayName||role.roleId;meta.className="own-muted";
      meta.textContent=role.roleId+" · "+role.status+" · revision "+(role.revision||1)+(role.description?" · "+role.description:"");
      info.append(name,meta);
      const actions=document.createElement("div");actions.style.cssText="display:flex;gap:.4rem;flex-wrap:wrap";
      if(role.status==="active"){
        const edit=document.createElement("button");edit.type="button";edit.className="own-button";
        edit.textContent="Edit";edit.addEventListener("click",()=>beginGovernanceRoleEdit(role));actions.append(edit);
        const archive=document.createElement("button");archive.type="button";archive.className="own-button warn";
        archive.textContent="Archive";archive.addEventListener("click",()=>openGovernanceLifecycle({type:"role",mode:"archive",role}));actions.append(archive);
      }else if(role.status==="archived"){
        const restore=document.createElement("button");restore.type="button";restore.className="own-button";
        restore.textContent="Restore";restore.addEventListener("click",()=>openGovernanceLifecycle({type:"role",mode:"restore",role}));actions.append(restore);
      }
      card.append(info,actions);catalogHost.append(card);
    }
    if(!catalogHost.children.length){
      const empty=document.createElement("p");empty.className="own-muted";empty.textContent="No custom governance roles exist yet.";catalogHost.append(empty);
    }
  }
  if(assignmentHost){
    assignmentHost.replaceChildren();
    const ordered=[...schoolGovernanceAssignments].sort((a,b)=>
      Number(a.status==="ended")-Number(b.status==="ended")||
      String(governanceRoleById(a.roleId)?.displayName||a.roleId).localeCompare(String(governanceRoleById(b.roleId)?.displayName||b.roleId)));
    for(const assignment of ordered){
      const role=governanceRoleById(assignment.roleId),card=document.createElement("article");
      card.style.cssText="display:flex;justify-content:space-between;align-items:flex-start;gap:.65rem;flex-wrap:wrap;border:1px solid #e2e8f0;border-radius:10px;padding:.7rem;background:#f8fafc";
      const info=document.createElement("div"),name=document.createElement("strong"),meta=document.createElement("p");
      name.textContent=role?.displayName||assignment.roleId;meta.className="own-muted";
      meta.textContent=assignment.status+" · revision "+(assignment.revision||1)+
        (assignment.assignedAt?" · assigned "+new Date(assignment.assignedAt).toLocaleString():"");
      info.append(name,meta);
      const action=document.createElement("button");action.type="button";
      action.className="own-button "+(assignment.status==="active"?"warn":"");
      action.textContent=assignment.status==="active"?"End assignment":"Restore assignment";
      action.addEventListener("click",()=>openGovernanceLifecycle({
        type:"assignment",mode:assignment.status==="active"?"end":"restore",assignment,role
      }));
      card.append(info,action);assignmentHost.append(card);
    }
    if(!assignmentHost.children.length){
      const empty=document.createElement("p");empty.className="own-muted";
      empty.textContent="No governance-role assignment history is recorded for this school.";assignmentHost.append(empty);
    }
  }
}
async function loadGovernanceRoles(schoolId=selected?.schoolId){
  const turn=selectionEpoch;
  const message=byId("owner-governance-status"),select=byId("owner-governance-role-select");
  if(!message||!select||!schoolId)return null;
  const form=byId("owner-governance-assign");
  setFormReady(form,false);
  message.textContent="Loading governance roles…";
  try{
    const [catalog,assigned]=await Promise.all([
      execute("list_governance_roles"),execute("list_school_governance_roles",{schoolId})
    ]);
    if(turn!==selectionEpoch||selected?.schoolId!==schoolId)return null;
    governanceRoles=catalog.roles||[];
    schoolGovernanceAssignments=assigned.roles||[];
    const assignmentIds=new Set(schoolGovernanceAssignments.map(role=>role.roleId)),
      activeAssignments=schoolGovernanceAssignments.filter(role=>role.status==="active"),
      available=governanceRoles.filter(role=>role.status==="active"&&!assignmentIds.has(role.roleId)),
      previous=select.value;
    select.replaceChildren();
    const blank=document.createElement("option");blank.value="";blank.textContent="Choose unassigned governance role…";select.append(blank);
    for(const role of available){
      const option=document.createElement("option");option.value=role.roleId;
      option.textContent=role.displayName+" · "+role.roleId;select.append(option);
    }
    if(available.some(role=>role.roleId===previous))select.value=previous;
    renderGovernanceRoles();
    setFormReady(form,available.length>0);
    message.textContent=activeAssignments.length?
      activeAssignments.length+" active governance role assignment"+(activeAssignments.length===1?"":"s")+" for "+selected.displayName+
        (available.length?" · "+available.length+" additional role"+(available.length===1?"":"s")+" available.":" · no additional unassigned active roles.")
      :"No active custom governance role is assigned to this school. School Admin remains the default data steward."+
        (available.length?" "+available.length+" role"+(available.length===1?" is":"s are")+" available to assign.":"");
    return {catalog:governanceRoles,assignments:schoolGovernanceAssignments};
  }catch(error){
    if(turn===selectionEpoch&&selected?.schoolId===schoolId){
      governanceRoles=[];schoolGovernanceAssignments=[];renderGovernanceRoles();
      message.textContent=error?.message||"Governance roles could not be loaded.";
    }
    return null;
  }
}

async function loadCutoverDecisions(schoolId=selected?.schoolId){
  const turn=selectionEpoch;
  const form=byId("owner-cutover-decisions"),message=byId("owner-cutover-decisions-status");
  if(!form||!message||!schoolId)return null;
  setFormReady(form,false);
  message.textContent="Loading owner decision record…";
  try{
    const result=await execute("get_cutover_decisions",{schoolId});
    if(turn!==selectionEpoch||selected?.schoolId!==schoolId)return null;
    const data=result.decisions||{};
    for(const name of ["institutionalAuthorityReference","calendarReference","privacyPolicyReference",
      "retentionPolicyReference","retentionMode","backupPolicyReference","dataStewardRole",
      "aiPermission","repositoryPermission","notes"]){
      const field=form.elements.namedItem(name);if(field)field.value=data[name]||"";
    }
    for(const name of ["firstAdminAcknowledged","schoolAdminConfigurationReviewed"]){
      const field=form.elements.namedItem(name);if(field)field.checked=data[name]===true;
    }
    setFormReady(form,true);
    const first=result.firstAdminUid||"not designated";
    message.textContent=result.decisions?
      "Decision record loaded. First school administrator: "+first+(result.firstAdminActive?" (active).":" (not active)."):
      "No decision record yet. First school administrator: "+first+(result.firstAdminActive?" (active).":" (not active).");
    return result;
  }catch(error){
    if(turn===selectionEpoch&&selected?.schoolId===schoolId)message.textContent=error?.message||"Owner decisions could not be loaded.";
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
    const legacy=isLegacyProvisioning(school);
    meta.textContent=" · "+school.state+" · "+school.schoolId+" · "+(legacy?"legacy pilot / migration":"standard school");
    button.append(name,meta);
    button.addEventListener("click",()=>{if(!busy)choose(school.schoolId);});
    item.append(button);schoolList.append(item);
  }
  if(!schools.length){
    const blank=document.createElement("p");blank.className="own-muted";
    blank.textContent="No schools have been provisioned.";
    schoolList.append(blank);
  }
  const preferred=schools.some(school=>school.schoolId===prefer)?prefer:schools[0]?.schoolId;
  choose(preferred,true);
  workspace.hidden=false;
}
async function submit(form,action,fields){
  if(busy)return null;
  if(scopedForms().includes(form)&&(!selected||form.dataset.schoolId!==fields.schoolId||
     form.dataset.selectionEpoch!==String(selectionEpoch)||form.dataset.scopeReady!=="true")){
    say("Wait for the selected school's form to load before recording a change.");return null;
  }
  if(!form.reportValidity())return null;
  const buttons=[...document.querySelectorAll(".own-button")].filter(button=>!button.disabled);
  busy=true;buttons.forEach(button=>button.disabled=true);
  for(const scoped of scopedForms())setFormReady(scoped,scoped.dataset.scopeReady==="true");
  say("Checking owner privileges and recording the action…");
  try {
    const response=await execute(action,fields);
    const message="School operation recorded: "+action.replaceAll("_"," ")+".";
    form.reset();
    try{await refresh(response.schoolId||fields.schoolId);say(message);}catch{say(message+" School list could not refresh. Reload before the next change.");}
    return response;
  }catch(error){say(error?.message||"The change was not recorded. No local permission was granted.");return null;}
  finally{
    busy=false;buttons.forEach(button=>button.disabled=false);
    for(const scoped of scopedForms())setFormReady(scoped,scoped.dataset.scopeReady==="true");
    updateCutoverAvailability();
  }
}
function schoolSlug(value){
  return String(value||"").trim().toLowerCase().normalize("NFKD")
    .replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,64).replace(/-+$/,"");
}
function showOnboardingStep(step){
  const host=byId("owner-onboarding");if(!host)return;
  host.hidden=false;
  host.querySelectorAll("[data-onboard-step]").forEach(node=>node.hidden=Number(node.dataset.onboardStep)!==step);
  host.querySelectorAll("[data-onboard-indicator]").forEach(node=>{
    const current=Number(node.dataset.onboardIndicator);
    node.dataset.active=String(current===step);
    node.dataset.complete=String(current<step);
  });
  host.scrollIntoView({behavior:"smooth",block:"nearest"});
}
function closeOnboarding(){const host=byId("owner-onboarding");if(host)host.hidden=true;}
function enterSchoolAssist(target="school-admin.html"){
  const schoolId=selected?.schoolId;if(!schoolId)return;
  try{
    sessionStorage.setItem("Adminerva_platform_view_school",schoolId);
    sessionStorage.setItem("Adminerva_platform_view_role","schooladmin");
    sessionStorage.setItem("Adminerva_platform_test_mode","1");
    sessionStorage.setItem("Adminerva_platform_school_mode","assist");
  }catch{}
  const url=new URL(target,location.href);url.searchParams.set("schoolId",schoolId);
  location.href=url.href;
}
function enterSchoolPreview(role="schooladmin"){
  const schoolId=onboardingSchoolId||selected?.schoolId;if(!schoolId)return;
  try{
    sessionStorage.setItem("Adminerva_platform_view_school",schoolId);
    sessionStorage.setItem("Adminerva_platform_view_role",role);
    sessionStorage.setItem("Adminerva_platform_test_mode","1");
    sessionStorage.setItem("Adminerva_platform_school_mode","preview");
  }catch{}
  location.href=role==="student"?"student-home.html":role==="teacher"?"teacher-home.html":"school-admin.html";
}
document.querySelectorAll("[data-owner-assist-target]").forEach(button=>{
  button.addEventListener("click",()=>{if(!busy&&selected)enterSchoolAssist(button.dataset.ownerAssistTarget||"school-admin.html");});
});
byId("owner-pilot-jump")?.addEventListener("click",()=>{
  if(!selected)return;
  const legacy=isLegacyProvisioning(selected);
  const target=legacy?
    (selected.state==="draft"?byId("owner-start-pilot"):
      selected.state==="pilot"?byId("owner-end-pilot"):byId("owner-actions")):
    byId("owner-standard-setup");
  target?.scrollIntoView({behavior:"smooth",block:"center"});
  const focusable=target?.querySelector("input,button,select,textarea,a");
  setTimeout(()=>focusable?.focus?.(),250);
});
byId("owner-onboarding-start")?.addEventListener("click",()=>{
  onboardingSchoolId="";const form=byId("owner-create");form?.reset();
  if(form?.elements.schoolId)form.elements.schoolId.dataset.manual="false";
  showOnboardingStep(1);form?.elements.displayName?.focus();
});
byId("owner-onboarding-close")?.addEventListener("click",closeOnboarding);
byId("owner-onboarding-done")?.addEventListener("click",closeOnboarding);
const createForm=byId("owner-create");
createForm?.elements.displayName?.addEventListener("input",()=>{
  const idField=createForm.elements.schoolId;
  if(idField.dataset.manual!=="true")idField.value=schoolSlug(createForm.elements.displayName.value);
});
createForm?.elements.schoolId?.addEventListener("input",event=>{event.currentTarget.dataset.manual="true";});
byId("owner-create").addEventListener("submit",event=>{
  event.preventDefault();const f=event.currentTarget,d=new FormData(f);
  void (async()=>{
    const response=await submit(f,"create_draft",{schoolId:String(d.get("schoolId")||"").trim(),
      displayName:String(d.get("displayName")||"").trim()});
    if(!response)return;
    onboardingSchoolId=response.schoolId;
    const summary=byId("owner-onboarding-summary");
    if(summary)summary.textContent="“"+(selected?.displayName||response.schoolId)+"” is registered as a draft. Continue platform configuration now or preview the school workspace.";
    showOnboardingStep(2);
  })();
});
byId("owner-onboarding-admin")?.addEventListener("submit",event=>{
  event.preventDefault();if(!onboardingSchoolId)return;
  const f=event.currentTarget,d=new FormData(f);
  void (async()=>{
    let targetUid;
    try{targetUid=await resolveAccountUid(d.get("targetUid"));}catch(error){say(error?.message||"Administrator account lookup failed.");return;}
    const response=await submit(f,"grant_school_admin",{
      schoolId:onboardingSchoolId,targetUid,
      reason:String(d.get("reason")||"").trim()
    });
    if(response)showOnboardingStep(3);
  })();
});
byId("owner-onboarding-skip-admin")?.addEventListener("click",()=>showOnboardingStep(3));
byId("owner-onboarding-policies")?.addEventListener("click",()=>{
  closeOnboarding();
  if(onboardingSchoolId)choose(onboardingSchoolId);
  const target=byId("owner-standard-setup");
  target?.scrollIntoView({behavior:"smooth",block:"start"});
  target?.querySelector("a,button")?.focus();
});
byId("owner-onboarding-preview")?.addEventListener("click",()=>enterSchoolPreview("schooladmin"));
byId("owner-governance-edit-cancel").addEventListener("click",()=>cancelGovernanceRoleEdit());
byId("owner-governance-create").addEventListener("submit",event=>{
  event.preventDefault();const form=event.currentTarget,d=new FormData(form),edit=governanceRoleEdit;
  const action=edit?"update_governance_role":"create_governance_role",
    details={
      schoolId:selected?.schoolId||undefined,
      roleId:edit?edit.roleId:String(d.get("roleId")||"").trim().toLowerCase(),
      displayName:String(d.get("displayName")||"").trim(),
      description:String(d.get("description")||"").trim(),
      ...(edit?{expectedRevision:edit.revision}: {})
    };
  void (async()=>{
    const response=await submit(form,action,details);
    if(response){governanceRoleEdit=null;byId("owner-governance-edit-cancel").hidden=true;
      byId("owner-governance-create-submit").textContent="Create governance role";
      form.elements.roleId.readOnly=false;
    }
  })();
});
byId("owner-governance-assign").addEventListener("submit",event=>{
  event.preventDefault();if(!selected)return;
  const form=event.currentTarget,d=new FormData(form);
  void submit(form,"assign_governance_role",{
    schoolId:selected.schoolId,roleId:String(d.get("roleId")||"").trim(),
    reason:String(d.get("reason")||"").trim()
  });
});
byId("owner-governance-lifecycle-cancel").addEventListener("click",()=>{
  if(busy)return;governanceLifecycleChange=null;byId("owner-governance-lifecycle-dialog").close();
});
byId("owner-governance-lifecycle-dialog").addEventListener("cancel",event=>{
  if(busy)event.preventDefault();else governanceLifecycleChange=null;
});
byId("owner-governance-lifecycle-form").addEventListener("submit",event=>{
  event.preventDefault();
  if(busy||!selected||!governanceLifecycleChange||!event.currentTarget.reportValidity())return;
  const form=event.currentTarget,d=new FormData(form),change=governanceLifecycleChange,
    reason=String(d.get("reason")||"").trim();
  let action,details;
  if(change.type==="role"){
    action=change.mode==="restore"?"restore_governance_role":"archive_governance_role";
    details={schoolId:selected.schoolId,roleId:change.role.roleId,
      expectedRevision:change.role.revision,reason};
  }else{
    action=change.mode==="restore"?"restore_governance_role_assignment":"end_governance_role_assignment";
    details={schoolId:selected.schoolId,roleId:change.assignment.roleId,
      expectedRevision:change.assignment.revision,reason};
  }
  void (async()=>{
    const response=await submit(form,action,details);
    if(response){governanceLifecycleChange=null;byId("owner-governance-lifecycle-dialog").close();}
  })();
});
byId("owner-grant").addEventListener("submit",event=>{
  event.preventDefault();if(!selected)return;
  const f=event.currentTarget,d=new FormData(f);
  void (async()=>{
    let targetUid;
    try{targetUid=await resolveAccountUid(d.get("targetUid"));}catch(error){say(error?.message||"Administrator account lookup failed.");return;}
    const response=await submit(f,"grant_school_admin",{schoolId:selected.schoolId,targetUid,
      reason:String(d.get("reason")||"").trim()});
    if(response)void loadSchoolAdmins(selected.schoolId);
  })();
});
byId("owner-admin-suspend").addEventListener("submit",event=>{
  event.preventDefault();if(!selected)return;
  const f=event.currentTarget,d=new FormData(f);
  void (async()=>{
    let targetUid;
    try{targetUid=await resolveAccountUid(d.get("targetUid"),{allowDisabled:true});}catch(error){say(error?.message||"Administrator account lookup failed.");return;}
    const expectedMembershipRevision=reviewedAdminRevision(targetUid);
    if(!Number.isSafeInteger(expectedMembershipRevision)){
      say("Refresh the School Administrator list and choose the administrator again.");return;
    }
    if(!confirm("Suspend this school administrator for "+selected.displayName+"? This pauses all V4 access for that school membership."))return;
    const response=await submit(f,"suspend_school_admin",{schoolId:selected.schoolId,targetUid,expectedMembershipRevision,
      reason:String(d.get("reason")||"").trim()});
    if(response)void loadSchoolAdmins(selected.schoolId);
  })();
});
byId("owner-admin-restore").addEventListener("submit",event=>{
  event.preventDefault();if(!selected)return;
  const f=event.currentTarget,d=new FormData(f);
  void (async()=>{
    let targetUid;
    try{targetUid=await resolveAccountUid(d.get("targetUid"));}catch(error){say(error?.message||"Administrator account lookup failed.");return;}
    const expectedMembershipRevision=reviewedAdminRevision(targetUid);
    if(!Number.isSafeInteger(expectedMembershipRevision)){
      say("Refresh the School Administrator list and choose the administrator again.");return;
    }
    const response=await submit(f,"restore_school_admin",{schoolId:selected.schoolId,targetUid,expectedMembershipRevision,
      reason:String(d.get("reason")||"").trim()});
    if(response)void loadSchoolAdmins(selected.schoolId);
  })();
});
byId("owner-start-pilot").addEventListener("submit",event=>{
  event.preventDefault();if(!selected)return;
  const f=event.currentTarget,d=new FormData(f),acknowledgements={
    limitedScopeReviewed:d.get("limitedScopeReviewed")==="on",
    legacyCompatibilityRequired:d.get("legacyCompatibilityRequired")==="on",
    productionNotAuthorized:d.get("productionNotAuthorized")==="on"
  };
  if(!Object.values(acknowledgements).every(Boolean)){say("Complete all controlled-pilot acknowledgements.");return;}
  if(!confirm("Start limited V4 pilot access for "+selected.displayName+" while keeping legacy compatibility?"))return;
  void submit(f,"start_pilot",{schoolId:selected.schoolId,expectedRevision:selected.revision,
    scopeReference:String(d.get("scopeReference")||"").trim(),
    reason:String(d.get("reason")||"").trim(),acknowledgements});
});
byId("owner-end-pilot").addEventListener("submit",event=>{
  event.preventDefault();if(!selected)return;
  const f=event.currentTarget,d=new FormData(f);
  if(!confirm("Return "+selected.displayName+" to draft access? Canonical pilot data will be preserved."))return;
  void submit(f,"end_pilot",{schoolId:selected.schoolId,expectedRevision:selected.revision,
    reason:String(d.get("reason")||"").trim()});
});
byId("owner-activate").addEventListener("submit",event=>{
  event.preventDefault();if(!selected)return;
  const f=event.currentTarget,d=new FormData(f);
  const attestation=Object.fromEntries(["institutionalDataAuthority","provenanceVerified","calendarConfigured","privacyPolicyApproved"]
    .map(name=>[name,d.get(name)==="on"]));
  if(!Object.values(attestation).every(Boolean)){say("Complete all required institutional attestations.");return;}
  if(!confirm("Activate "+selected.displayName+"? Only proceed with verified authority and readiness."))return;
  void submit(f,"activate",{schoolId:selected.schoolId,expectedRevision:selected.revision,
    reason:String(d.get("reason")||"").trim(),attestation});
});
byId("owner-cutover-package").addEventListener("submit",async event=>{
  event.preventDefault();if(!selected||selected.schoolId!=="mcs-manila"||busy)return;
  const f=event.currentTarget;if(!f.reportValidity())return;
  const d=new FormData(f),file=d.get("packageFile");
  if(!(file instanceof File)||!file.size){say("Choose the generated MCS cutover package JSON.");return;}
  if(file.size>512000){say("Cutover package file is unexpectedly large. Regenerate the summary package.");return;}
  const schoolId=selected.schoolId,turn=selectionEpoch;
  let packageData;
  try{packageData=JSON.parse(await file.text());}
  catch{say("The selected cutover package is not valid JSON.");return;}
  if(busy||turn!==selectionEpoch||selected?.schoolId!==schoolId){say("School selection changed. Choose the package again.");return;}
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
byId("owner-setup-refresh")?.addEventListener("click",()=>{
  if(selected&&!isLegacyProvisioning(selected))void loadStandardSetup(selected.schoolId);
});
byId("owner-activate-standard")?.addEventListener("submit",event=>{
  event.preventDefault();if(!selected||isLegacyProvisioning(selected))return;
  const f=event.currentTarget,d=new FormData(f);
  if(!confirm("Activate "+selected.displayName+" for normal school operations?"))return;
  void submit(f,"activate_standard",{schoolId:selected.schoolId,expectedRevision:selected.revision,
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
  void submit(f,"set_compatibility_mode",{schoolId:selected.schoolId,expectedRevision:selected.revision,mode:"v4_only",
    reason:String(d.get("reason")||"").trim(),attestation});
});
byId("owner-cutover-rollback").addEventListener("submit",event=>{
  event.preventDefault();if(!selected)return;
  const f=event.currentTarget,d=new FormData(f);
  if(!confirm("Restore legacy compatibility for "+selected.displayName+"? Canonical V4 data will remain unchanged."))return;
  void submit(f,"set_compatibility_mode",{schoolId:selected.schoolId,expectedRevision:selected.revision,mode:"legacy_allowed",
    reason:String(d.get("reason")||"").trim()});
});
byId("owner-suspend").addEventListener("submit",event=>{
  event.preventDefault();if(!selected)return;
  const f=event.currentTarget,d=new FormData(f);
  if(!confirm("Suspend "+selected.displayName+"? All verified v4 school access will be denied."))return;
  void submit(f,"suspend",{schoolId:selected.schoolId,expectedRevision:selected.revision,
    reason:String(d.get("reason")||"").trim()});
});
byId("owner-admin-list-refresh")?.addEventListener("click",()=>{
  if(selected&&!busy)void loadSchoolAdmins(selected.schoolId);
});
byId("owner-audit-refresh")?.addEventListener("click",()=>{
  if(selected&&!busy)void loadSchoolAudit(selected.schoolId);
});
byId("owner-resume-refresh")?.addEventListener("click",()=>{
  if(selected?.state==="suspended"&&!busy)void loadRecoveryStatus(selected.schoolId);
});
byId("owner-resume").addEventListener("submit",event=>{
  event.preventDefault();if(!selected||selected.state!=="suspended")return;
  const f=event.currentTarget,d=new FormData(f);
  if(!confirm("Restore normal access for "+selected.displayName+"? Existing membership suspensions and school policies will still apply."))return;
  void submit(f,"resume",{schoolId:selected.schoolId,expectedRevision:selected.revision,
    reason:String(d.get("reason")||"").trim()});
});
try {
  await auth.authStateReady();
  if(!auth.currentUser?.emailVerified){
    say("Sign in with a verified Platform Administrator account.");
    const link=document.createElement("a");link.href="login.html";link.textContent="Sign in";
    status.append(" ",link);
  }else{
    const requestedSchoolId=new URL(location.href).searchParams.get("schoolId")||"";
    await refresh(requestedSchoolId);
    say("Owner school registry loaded. School-specific private academic records are never displayed here.");
  }
}catch(error){
  workspace.hidden=false;
  actions.hidden=true;
  const message=error?.message||"The School Registry backend could not verify platform authority.";
  say(message+" You can still open the school-registration workflow; saving requires the platform backend to be available.");
  const onboardingStart=byId("owner-onboarding-start");
  if(onboardingStart)onboardingStart.disabled=false;
}
