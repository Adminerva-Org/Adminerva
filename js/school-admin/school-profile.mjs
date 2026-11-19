import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs?v=20261120";

const el=id=>document.getElementById(id);
const api=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolProfile");
const status=el("sp-status"),workspace=el("sp-workspace"),profileForm=el("sp-profile-form");
const campusDialog=el("sp-campus-dialog"),campusForm=el("sp-campus-form"),
  lifecycleDialog=el("sp-campus-lifecycle-dialog"),lifecycleForm=el("sp-campus-lifecycle-form");
let picker=null,model={profile:null,campuses:[]},busy=false,profileDirty=false,campusDirty=false,
  editingCampus=null,lifecycleChange=null,loadRun=0;

function platformModePayload(){
  try{return sessionStorage.getItem("Adminerva_platform_school_mode")==="assist"?{platformMode:"assist"}:{};}catch{return {};}
}
function scoped(action,details={}){
  const lease=picker.scope.lease();
  return api({schoolId:lease.schoolId,action,...platformModePayload(),...details})
    .then(response=>{picker.scope.assertLease(lease);return response.data;});
}
function say(message){status.textContent=message;}
function setBusy(value,message=""){
  busy=value;
  for(const control of profileForm.elements)control.disabled=value;
  el("sp-add-campus").disabled=value;
  for(const dialog of [campusDialog,lifecycleDialog])for(const control of dialog.querySelectorAll("button,input,select,textarea"))control.disabled=value;
  if(message)say(message);
}
function profileData(){
  const data=new FormData(profileForm),out={};
  for(const key of ["officialName","shortName","institutionType","primaryEmail","phone","website","timezone","locale",
    "addressLine1","addressLine2","city","region","postalCode","country"])out[key]=String(data.get(key)||"").trim();
  return out;
}
function campusData(){
  const data=new FormData(campusForm),out={};
  for(const key of ["name","code","timezone","addressLine1","addressLine2","city","region","postalCode","country"])out[key]=String(data.get(key)||"").trim();
  return out;
}
function populateProfile(){
  const p=model.profile;if(!p)return;
  for(const key of ["officialName","shortName","institutionType","primaryEmail","phone","website","timezone","locale",
    "addressLine1","addressLine2","city","region","postalCode","country"]){
    if(profileForm.elements[key])profileForm.elements[key].value=p[key]||"";
  }
  el("sp-profile-revision").textContent=p.revision?"Revision "+p.revision:"Not saved";
  profileDirty=false;
}
function campusAddress(campus){
  return [campus.addressLine1,campus.addressLine2,campus.city,campus.region,campus.postalCode,campus.country].filter(Boolean).join(", ");
}
function renderCampuses(){
  const host=el("sp-campus-list");host.replaceChildren();
  const rows=model.campuses||[];
  if(!rows.length){
    const empty=document.createElement("p");empty.className="sp-muted";empty.textContent="No campus records yet. Add the main campus when the school is ready.";host.append(empty);return;
  }
  for(const campus of rows){
    const card=document.createElement("article");card.className="sp-row";
    const top=document.createElement("div");top.className="flex items-start justify-between gap-3";
    const info=document.createElement("div"),name=document.createElement("strong"),meta=document.createElement("p");
    name.textContent=campus.name;meta.className="sp-muted mt-1";
    meta.textContent=[campus.code,campusAddress(campus),campus.timezone||"inherits school timezone","rev "+campus.revision].filter(Boolean).join(" · ");
    info.append(name,meta);
    const badge=document.createElement("span");badge.className="sp-badge";badge.dataset.state=campus.status;badge.textContent=campus.status;
    top.append(info,badge);card.append(top);
    const actions=document.createElement("div");actions.className="flex flex-wrap gap-2 mt-3";
    const edit=document.createElement("button");edit.type="button";edit.className="sp-btn";edit.textContent="Edit";
    edit.disabled=campus.status!=="active";edit.addEventListener("click",()=>openCampus(campus));actions.append(edit);
    const lifecycle=document.createElement("button");lifecycle.type="button";lifecycle.className=campus.status==="active"?"sp-btn warn":"sp-btn";
    lifecycle.textContent=campus.status==="active"?"Archive":"Restore";
    lifecycle.addEventListener("click",()=>openLifecycle(campus,campus.status==="active"?"archive":"restore"));actions.append(lifecycle);
    card.append(actions);host.append(card);
  }
}
async function load(){
  if(!picker?.scope.current?.roles.includes("school_admin"))return false;
  const run=++loadRun;setBusy(true,"Loading school profile and campuses…");
  try{
    const result=await scoped("get");if(run!==loadRun)return false;
    model={profile:result.profile,campuses:result.campuses||[]};populateProfile();renderCampuses();
    say("School profile loaded · "+model.campuses.filter(c=>c.status==="active").length+" active campus"+(model.campuses.filter(c=>c.status==="active").length===1?"":"es")+".");
    return true;
  }catch(error){
    if(run!==loadRun)return false;
    model={profile:null,campuses:[]};renderCampuses();say(error?.message||"School profile could not be loaded.");return false;
  }finally{if(run===loadRun)setBusy(false);}
}
function discardProfile(){return !profileDirty||confirm("Discard the unsaved school profile changes?");}
function discardCampus(){return !campusDirty||confirm("Discard the unsaved campus changes?");}

profileForm.addEventListener("input",()=>{profileDirty=true;});
profileForm.addEventListener("change",()=>{profileDirty=true;});
profileForm.addEventListener("submit",event=>{
  event.preventDefault();if(busy||!model.profile||!profileForm.reportValidity())return;
  const payload={...profileData(),expectedRevision:model.profile.revision};
  void (async()=>{
    setBusy(true,"Saving school profile…");
    try{
      const result=await scoped("save_profile",payload);
      model.profile={...model.profile,...payload,revision:result.revision};profileDirty=false;populateProfile();
      say("School profile saved at revision "+result.revision+".");
    }catch(error){say(error?.message||"School profile was not saved.");}
    finally{setBusy(false);}
  })();
});
el("sp-profile-reset").addEventListener("click",()=>{if(!busy&&discardProfile())populateProfile();});

function openCampus(campus=null){
  if(busy)return;
  editingCampus=campus;campusDirty=false;campusForm.reset();
  el("sp-campus-title").textContent=campus?"Edit campus":"Add campus";
  el("sp-campus-meta").textContent=campus?"Campus revision "+campus.revision:"Create a stable campus record.";
  const source=campus||{timezone:"",country:model.profile?.country||"Philippines"};
  for(const key of ["name","code","timezone","addressLine1","addressLine2","city","region","postalCode","country"])
    campusForm.elements[key].value=source[key]||"";
  campusDialog.showModal();
}
function closeCampus({force=false}={}){
  if((busy&&!force)||(!force&&!discardCampus()))return false;
  campusDirty=false;editingCampus=null;if(campusDialog.open)campusDialog.close();return true;
}
el("sp-add-campus").addEventListener("click",()=>openCampus());
el("sp-campus-close").addEventListener("click",()=>closeCampus());
el("sp-campus-cancel").addEventListener("click",()=>closeCampus());
campusDialog.addEventListener("cancel",event=>{if(busy||!discardCampus())event.preventDefault();else{campusDirty=false;editingCampus=null;}});
campusForm.addEventListener("input",()=>{campusDirty=true;});
campusForm.addEventListener("change",()=>{campusDirty=true;});
campusForm.addEventListener("submit",event=>{
  event.preventDefault();if(busy||!campusForm.reportValidity())return;
  const action=editingCampus?"update_campus":"create_campus";
  const payload={...campusData(),...(editingCampus?{campusId:editingCampus.campusId,expectedRevision:editingCampus.revision}:{})};
  void (async()=>{
    setBusy(true,editingCampus?"Saving campus changes…":"Creating campus…");
    try{
      await scoped(action,payload);campusDirty=false;closeCampus({force:true});
      await load();say(action==="create_campus"?"Campus created.":"Campus changes saved.");
    }catch(error){say(error?.message||"Campus was not saved.");}
    finally{setBusy(false);}
  })();
});

function openLifecycle(campus,mode){
  if(busy)return;
  lifecycleChange={campus,mode};lifecycleForm.reset();
  el("sp-campus-lifecycle-title").textContent=mode==="restore"?"Restore campus":"Archive campus";
  el("sp-campus-lifecycle-target").textContent=campus.name+" · revision "+campus.revision;
  el("sp-campus-lifecycle-help").textContent=mode==="restore"
    ?"Restoring makes this campus available to future school configuration again. Existing history is unchanged."
    :"Archiving removes this campus from future active use without deleting its historical identity.";
  const button=el("sp-campus-lifecycle-confirm");button.textContent=mode==="restore"?"Restore campus":"Archive campus";
  button.className=mode==="restore"?"sp-btn primary":"sp-btn warn";lifecycleDialog.showModal();
}
function closeLifecycle(){
  if(busy)return;lifecycleChange=null;if(lifecycleDialog.open)lifecycleDialog.close();
}
el("sp-campus-lifecycle-cancel").addEventListener("click",closeLifecycle);
lifecycleDialog.addEventListener("cancel",event=>{if(busy)event.preventDefault();else lifecycleChange=null;});
lifecycleForm.addEventListener("submit",event=>{
  event.preventDefault();if(busy||!lifecycleChange||!lifecycleForm.reportValidity())return;
  const {campus,mode}=lifecycleChange,reason=String(new FormData(lifecycleForm).get("reason")||"").trim();
  void (async()=>{
    setBusy(true,mode==="restore"?"Restoring campus…":"Archiving campus…");
    try{
      await scoped(mode==="restore"?"restore_campus":"archive_campus",{campusId:campus.campusId,expectedRevision:campus.revision,reason});
      lifecycleChange=null;lifecycleDialog.close();await load();say(mode==="restore"?"Campus restored.":"Campus archived without deleting history.");
    }catch(error){say(error?.message||"Campus status was not changed.");}
    finally{setBusy(false);}
  })();
});

picker=createTenantSchoolPicker({
  host:el("sp-school-picker"),status,
  onBeforeChange:async()=>{
    if(busy)throw new Error("Finish the current school profile operation before switching schools.");
    if(!discardProfile())throw new Error("Keep the current school open to finish the unsaved profile.");
    if(campusDialog.open&&!discardCampus())throw new Error("Keep the current school open to finish the unsaved campus.");
    ++loadRun;profileDirty=false;campusDirty=false;editingCampus=null;lifecycleChange=null;
    if(campusDialog.open)campusDialog.close();if(lifecycleDialog.open)lifecycleDialog.close();
    model={profile:null,campuses:[]};profileForm.reset();el("sp-campus-list").replaceChildren();workspace.hidden=true;
  },
  onReady:scope=>{
    if(!scope.current?.roles.includes("school_admin")){
      workspace.hidden=true;say("School Administrator access is required to manage the school profile.");return;
    }
    workspace.hidden=false;void load();
  }
});
try{
  await picker.load();
  if(!auth.currentUser)say("Sign in to manage the school profile.");
}catch(error){say(error?.message||"School profile access could not be verified.");}
