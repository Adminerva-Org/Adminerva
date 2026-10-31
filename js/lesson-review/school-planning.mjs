import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";

const functions=getFunctions(app,"asia-southeast1");
const planningApi=httpsCallable(functions,"schoolPlanning");
const tenantApi=httpsCallable(functions,"tenantSchools");
let schoolCache=null,pendingSchool=null;
const schoolKey=uid=>"Adminerva_last_verified_school_"+uid;

function preferred(uid){try{return sessionStorage.getItem(schoolKey(uid))||null;}catch{return null;}}
function invalidateSchoolCache(nextSchoolId=null){
  if(!schoolCache)return;
  if(!nextSchoolId||schoolCache.schoolId!==nextSchoolId)schoolCache=null;
}
document.addEventListener("adminerva:preferred-school-changed",event=>
  invalidateSchoolCache(event.detail?.schoolId||null));
document.addEventListener("adminerva:school-ready",event=>
  invalidateSchoolCache(event.detail?.schoolId||null));
function revisionKey(uid,schoolId,kind,clientKey){
  return "Adminerva_v4_planning_revision_"+uid+"_"+schoolId+"_"+kind+"_"+encodeURIComponent(clientKey);
}
function getRevision(uid,schoolId,kind,clientKey){
  try{
    const value=Number(localStorage.getItem(revisionKey(uid,schoolId,kind,clientKey)));
    return Number.isInteger(value)&&value>0?value:null;
  }catch{return null;}
}
function setRevision(uid,schoolId,kind,clientKey,revision){
  try{localStorage.setItem(revisionKey(uid,schoolId,kind,clientKey),String(revision));}catch{}
}
function normalize(node){
  if(node===null||typeof node==="string"||typeof node==="boolean")return node;
  if(typeof node==="number"){
    if(!Number.isFinite(node))throw Error("Planning data contains a non-finite number.");
    return Object.is(node,-0)?0:node;
  }
  if(Array.isArray(node))return node.map(normalize);
  if(node&&typeof node==="object"){
    const output={};for(const key of Object.keys(node).sort())output[key]=normalize(node[key]);return output;
  }
  throw Error("Planning data contains an unsupported value.");
}
function canonical(value){return JSON.stringify(normalize(value));}

export async function activePlanningSchool({refresh=false}={}){
  await auth.authStateReady();
  const user=auth.currentUser;
  if(!user?.uid||!user.emailVerified)throw Error("Sign in with a verified teacher account.");
  if(!refresh&&schoolCache?.uid===user.uid)return schoolCache;
  if(!pendingSchool||refresh){
    pendingSchool=tenantApi({preferredSchoolId:preferred(user.uid)}).then(response=>{
      const schools=Array.isArray(response.data?.schools)?response.data.schools:[];
      let schoolId=response.data?.selection?.schoolId||null;
      if(!schoolId&&schools.length===1)schoolId=schools[0].schoolId;
      if(!schoolId&&schools.length>1){
        const remembered=preferred(user.uid);
        if(schools.some(item=>item.schoolId===remembered))schoolId=remembered;
      }
      if(!schoolId)throw Error(schools.length?
        "Choose an active school from the account menu before using the school planning library.":
        "No active school membership is available.");
      const school=schools.find(item=>item.schoolId===schoolId);
      if(!school?.roles?.includes("teacher"))throw Error("The selected school has not granted you teacher planning access.");
      schoolCache={uid:user.uid,schoolId,name:school.name||schoolId,roles:school.roles,
        compatibilityMode:school.compatibilityMode||"legacy_allowed"};return schoolCache;
    }).finally(()=>{pendingSchool=null;});
  }
  return pendingSchool;
}
async function scoped(action,details={}){
  const school=await activePlanningSchool(),uid=auth.currentUser?.uid;
  const response=(await planningApi({schoolId:school.schoolId,action,...details})).data;
  if(auth.currentUser?.uid!==uid)throw Error("Account changed. School planning response ignored.");
  const latest=await activePlanningSchool();
  if(latest.schoolId!==school.schoolId)throw Error("School changed. School planning response ignored.");
  return response;
}
export async function listSchoolPlanning(kind){
  return (await scoped("list",{kind})).resources||[];
}
export async function getSchoolPlanning(resourceId){
  const result=await scoped("get",{resourceId});
  if(result?.canEdit&&result.clientKey&&auth.currentUser){
    const school=await activePlanningSchool();
    setRevision(auth.currentUser.uid,school.schoolId,result.kind,result.clientKey,result.revision);
  }
  return result;
}
export async function saveSchoolPlanning({kind,clientKey,title,content}){
  const school=await activePlanningSchool(),user=auth.currentUser;
  let expectedRevision=getRevision(user.uid,school.schoolId,kind,clientKey);
  if(!expectedRevision){
    const existing=(await listSchoolPlanning(kind)).find(item=>item.canEdit&&item.clientKey===clientKey);
    if(existing){
      const full=await getSchoolPlanning(existing.resourceId);
      if(canonical(full.content)!==canonical(content)||full.title!==title)
        throw Error("A different school-saved version already exists. Open the school planning library and compare it before replacing anything.");
      expectedRevision=full.revision;setRevision(user.uid,school.schoolId,kind,clientKey,full.revision);
    }
  }
  const result=await scoped("save",{kind,clientKey,title,content,expectedRevision:expectedRevision||0});
  setRevision(user.uid,school.schoolId,kind,clientKey,result.revision);
  return {...result,schoolId:school.schoolId,schoolName:school.name};
}
export async function archiveSchoolPlanning(resource){
  if(!resource?.canEdit)throw Error("Only the owner can archive this planning resource.");
  return scoped("archive",{resourceId:resource.resourceId,expectedRevision:resource.revision});
}
export async function planningRecipients(){
  return scoped("recipients");
}
export async function shareSchoolPlanning(resource,visibility,teacherUids=[]){
  const result=await scoped("share",{resourceId:resource.resourceId,visibility,teacherUids});
  if(result.revision&&resource.clientKey&&auth.currentUser){
    const school=await activePlanningSchool();
    setRevision(auth.currentUser.uid,school.schoolId,resource.kind,resource.clientKey,result.revision);
  }
  return result;
}
export async function copySchoolPlanning(resourceId){return scoped("copy",{resourceId});}
export async function schoolPlanningHistory(resourceId){return scoped("history",{resourceId});}

export function mountSchoolPlanningLibraryButton({kind,anchor,label="School copies",onOpen=null}){
  if(!anchor)return null;
  const button=document.createElement("button");
  button.type="button";button.textContent=label;
  button.className=anchor.className;button.removeAttribute("onclick");
  button.addEventListener("click",()=>void openLibrary(kind,onOpen));
  anchor.after(button);return button;
}

async function openShareDialog(resource,onSaved){
  let dialog=document.getElementById("v4PlanningShareDialog");
  if(!dialog){
    dialog=document.createElement("dialog");dialog.id="v4PlanningShareDialog";
    dialog.className="rounded-2xl border-0 shadow-2xl p-0 w-[min(94vw,620px)] max-h-[88dvh] backdrop:bg-slate-950/70";
    dialog.innerHTML='<form method="dialog" data-form class="bg-white p-5 max-h-[88dvh] overflow-y-auto">'+
      '<div class="flex justify-between gap-3 items-start"><div><p class="text-xs font-bold uppercase tracking-wider text-indigo-700">Teacher sharing</p>'+
      '<h2 class="text-xl font-extrabold">Share school planning resource</h2></div>'+
      '<button value="cancel" type="button" data-close class="rounded-lg border px-3 py-2">Close</button></div>'+
      '<p class="text-sm text-slate-600 mt-2">Recipients can preview and make an independent private copy. They cannot edit, archive, or reshare your original.</p>'+
      '<label class="block mt-4 text-sm font-bold">Audience<select data-visibility class="mt-1 w-full rounded-lg border p-2.5">'+
      '<option value="private">Private</option><option value="selected_teachers">Specific teachers</option>'+
      '<option value="school_teachers">All active teachers in this school</option></select></label>'+
      '<div data-recipients class="mt-3 rounded-xl border p-3 max-h-52 overflow-y-auto"></div>'+
      '<p data-status class="text-sm text-slate-600 mt-3" role="status"></p>'+
      '<div class="mt-4 flex gap-2 flex-wrap"><button type="submit" class="rounded-lg bg-indigo-700 text-white px-4 py-2.5 font-bold">Save sharing</button>'+
      '<button type="button" data-cancel class="rounded-lg border px-4 py-2.5 font-bold">Cancel</button></div></form>';
    document.body.append(dialog);
    dialog.querySelector("[data-close]").addEventListener("click",()=>dialog.close());
    dialog.querySelector("[data-cancel]").addEventListener("click",()=>dialog.close());
  }
  const form=dialog.querySelector("[data-form]"),
    recipients=dialog.querySelector("[data-recipients]"),status=dialog.querySelector("[data-status]");
  const audience=dialog.querySelector("[data-visibility]");
  audience.value=resource.visibility||"private";recipients.replaceChildren();
  status.textContent="Loading active teachers in this school…";
  let teachers=[];
  try{
    const result=await planningRecipients();teachers=result.teachers||[];
    status.textContent=result.truncated?
      "Showing the first 100 active teacher recipients.":"Choose who may preview and copy this resource.";
  }catch(error){status.textContent=error?.message||"Teacher recipients are unavailable.";}
  const selected=new Set(Array.isArray(resource.sharedWithUids)?resource.sharedWithUids:[]);
  for(const teacher of teachers){
    const label=document.createElement("label");label.className="flex items-start gap-2 py-1.5 text-sm";
    const input=document.createElement("input");input.type="checkbox";input.value=teacher.uid;input.checked=selected.has(teacher.uid);
    const text=document.createElement("span");text.textContent=teacher.name;label.append(input,text);recipients.append(label);
  }
  const sync=()=>{recipients.hidden=audience.value!=="selected_teachers";};
  audience.onchange=sync;sync();
  form.onsubmit=event=>{event.preventDefault();void (async()=>{
    const submit=form.querySelector('button[type="submit"]');submit.disabled=true;
    try{
      const ids=audience.value==="selected_teachers"?
        [...recipients.querySelectorAll('input[type="checkbox"]:checked')].map(input=>input.value):[];
      const result=await shareSchoolPlanning(resource,audience.value,ids);
      resource.visibility=result.visibility;
      resource.revision=result.revision||resource.revision;
      resource.sharedWithUids=ids;
      status.textContent="Sharing saved. Recipients still receive read/copy-only access.";
      await onSaved?.();dialog.close();
    }catch(error){status.textContent=error?.message||"Sharing was not changed.";}
    finally{submit.disabled=false;}
  })();};
  dialog.showModal();
}
async function openLibrary(kind,onOpen=null){
  let dialog=document.getElementById("v4PlanningLibraryDialog");
  if(!dialog){
    dialog=document.createElement("dialog");dialog.id="v4PlanningLibraryDialog";
    dialog.className="rounded-2xl border-0 shadow-2xl p-0 w-[min(94vw,760px)] max-h-[88dvh] backdrop:bg-slate-950/70";
    dialog.innerHTML='<div class="bg-white p-5 max-h-[88dvh] overflow-y-auto">'+
      '<div class="flex justify-between gap-3 items-start"><div><p class="text-xs font-bold uppercase tracking-wider text-indigo-700">Verified school</p>'+
      '<h2 class="text-xl font-extrabold">Planning library</h2></div>'+
      '<button type="button" data-close class="rounded-lg border px-3 py-2">Close</button></div>'+
      '<p data-status class="text-sm text-slate-600 mt-2" role="status">Loading…</p>'+
      '<div data-list class="grid gap-3 mt-4"></div></div>';
    document.body.append(dialog);
    dialog.querySelector("[data-close]").addEventListener("click",()=>dialog.close());
  }
  dialog.showModal();const host=dialog.querySelector("[data-list]"),status=dialog.querySelector("[data-status]");
  host.replaceChildren();status.textContent="Loading planning resources from the active school…";
  try{
    const school=await activePlanningSchool(),items=await listSchoolPlanning(kind);
    status.textContent=(school.name||school.schoolId)+" · "+items.length+" "+kind+" resource"+(items.length===1?"":"s");
    for(const item of items){
      const row=document.createElement("article");row.className="rounded-xl border p-3 flex flex-col sm:flex-row gap-3 sm:justify-between";
      const info=document.createElement("div"),title=document.createElement("strong"),meta=document.createElement("p");
      title.textContent=item.title;meta.className="text-xs text-slate-500 mt-1";
      meta.textContent=(item.canEdit?"Owned by you":"Shared with you")+" · "+item.visibility+" · revision "+item.revision;
      info.append(title,meta);const actions=document.createElement("div");actions.className="flex gap-2 flex-wrap";
      if(item.canEdit){
        if(typeof onOpen==="function"){
          const open=document.createElement("button");open.type="button";open.className="rounded-lg bg-indigo-700 text-white px-3 py-2 text-sm font-bold";open.textContent="Open";
          open.addEventListener("click",()=>void (async()=>{
            open.disabled=true;
            try{
              const full=await getSchoolPlanning(item.resourceId);
              await onOpen(full);dialog.close();
            }catch(error){status.textContent=error?.message||"School resource could not be opened.";}
            finally{open.disabled=false;}
          })());
          actions.append(open);
        }
        const share=document.createElement("button");share.type="button";share.className="rounded-lg border border-indigo-300 text-indigo-800 px-3 py-2 text-sm font-bold";share.textContent="Share";
        share.addEventListener("click",()=>void openShareDialog(item,async()=>{dialog.close();await openLibrary(kind,onOpen);}));
        actions.append(share);
        const archive=document.createElement("button");archive.type="button";archive.className="rounded-lg border px-3 py-2 text-sm font-bold";archive.textContent="Archive";
        archive.addEventListener("click",()=>void (async()=>{
          if(!confirm("Archive this school planning resource? Prior revisions remain retained."))return;
          archive.disabled=true;
          try{await archiveSchoolPlanning(item);row.remove();status.textContent="School planning resource archived.";}
          catch(error){status.textContent=error?.message||"Archive failed.";}finally{archive.disabled=false;}
        })());
        actions.append(archive);
      }else{
        const copy=document.createElement("button");copy.type="button";copy.className="rounded-lg bg-indigo-700 text-white px-3 py-2 text-sm font-bold";copy.textContent="Make private copy";
        copy.addEventListener("click",()=>void (async()=>{
          copy.disabled=true;
          try{await copySchoolPlanning(item.resourceId);status.textContent="Independent private school copy created.";dialog.close();await openLibrary(kind,onOpen);}
          catch(error){status.textContent=error?.message||"Copy failed.";}finally{copy.disabled=false;}
        })());
        actions.append(copy);
      }
      row.append(info,actions);host.append(row);
    }
    if(!items.length){const blank=document.createElement("p");blank.className="text-sm text-slate-500";blank.textContent="No school planning resources yet.";host.append(blank);}
  }catch(error){status.textContent=error?.message||"School planning library unavailable.";}
}
function invalidate(){schoolCache=null;pendingSchool=null;}
document.addEventListener("adminerva:preferred-school-changed",invalidate);
document.addEventListener("adminerva:school-ready",event=>{
  if(schoolCache&&event.detail?.schoolId!==schoolCache.schoolId)invalidate();
});
auth.onAuthStateChanged(()=>invalidate());
