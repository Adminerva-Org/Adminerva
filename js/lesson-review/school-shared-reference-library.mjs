import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs?v=4.0.0";

const api=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolSharedReferences");
const el=id=>document.getElementById(id);
const status=el("schoolReferenceStatus"),workspace=el("schoolReferenceWorkspace"),
  folderHost=el("schoolReferenceFolders"),documentHost=el("schoolReferenceDocuments"),
  detail=el("schoolReferenceDetail"),empty=el("schoolReferenceEmpty");

let folders=[],selected=null,selectedPayload=null,busy=false,epoch=0;

function say(message){status.textContent=message;}
function make(tag,className,text){
  const node=document.createElement(tag);if(className)node.className=className;
  if(text!==undefined)node.textContent=String(text);return node;
}
function date(value){return value?new Date(value).toLocaleString():"—";}
function roles(){return picker.scope.current?.roles||[];}
function isAdmin(){return roles().includes("school_admin");}
function isTeacher(){return roles().includes("teacher");}

const picker=createTenantSchoolPicker({
  host:el("schoolReferenceSwitcher"),status,
  onBeforeChange:async()=>{
    if(busy)throw new Error("Finish the current library action before switching schools.");
    ++epoch;folders=[];selected=null;selectedPayload=null;
    folderHost.replaceChildren();documentHost.replaceChildren();
    detail.hidden=true;empty.hidden=false;workspace.hidden=true;
  },
  onReady:scope=>{
    if(!scope.current){workspace.hidden=true;return;}
    const allowed=scope.current.roles.some(role=>["teacher","school_admin"].includes(role));
    if(!allowed){workspace.hidden=true;say("Teacher or school administration access is required.");return;}
    workspace.hidden=false;syncRoleControls();
    void refresh(scope).catch(error=>say(error?.message||"School shared references are unavailable."));
  }
});

async function perform(action,details={}){
  const lease=picker.scope.lease();
  const result=(await api({schoolId:lease.schoolId,action,...details})).data;
  picker.scope.assertLease(lease);return result;
}
function syncRoleControls(){
  const admin=isAdmin(),teacher=isTeacher();
  el("schoolReferenceCreateFolder").hidden=!admin;
  el("schoolReferenceArchivedLabel").hidden=!admin;
  el("schoolReferenceAdminAdd").hidden=!admin||!selectedPayload||selectedPayload.folder.status!=="active";
  el("schoolReferenceRename").hidden=!admin||!selectedPayload;
  el("schoolReferenceLifecycle").hidden=!admin||!selectedPayload;
  el("schoolReferenceCopy").hidden=!teacher||!selectedPayload||selectedPayload.folder.status!=="active";
}
function renderFolders(){
  folderHost.replaceChildren();
  for(const folder of folders){
    const button=make("button",
      "w-full text-left rounded-xl border p-3 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-cyan-500");
    button.type="button";
    if(folder.folderId===selected)button.classList.add("border-cyan-500","bg-cyan-50");
    const top=make("div","flex gap-2 justify-between items-start");
    top.append(make("strong","text-sm break-words",folder.name),
      make("span","text-[10px] font-bold rounded-full bg-slate-100 px-2 py-1 shrink-0",folder.status));
    button.append(top,make("p","text-xs text-slate-500 mt-1",
      folder.documentCount+" document"+(folder.documentCount===1?"":"s")+" · "+date(folder.updatedAt)));
    button.addEventListener("click",()=>void openFolder(folder.folderId));
    folderHost.append(button);
  }
  if(!folders.length)folderHost.append(make("p","text-sm text-slate-500 py-3",
    isAdmin()?"No shared reference folders yet. Create the first school folder below.":"No active school reference folders are available."));
}
function renderDocuments(){
  documentHost.replaceChildren();
  const docs=selectedPayload?.documents||[];
  for(const doc of docs){
    const card=make("article","rounded-xl border border-slate-200 p-4");
    const top=make("div","flex flex-col sm:flex-row sm:justify-between gap-3");
    const info=make("div","min-w-0");
    info.append(make("strong","text-sm break-words",doc.title),
      make("p","text-xs text-slate-500 mt-1",doc.sourceType.replaceAll("_"," ")+" · "+doc.status+" · revision "+doc.revision));
    top.append(info);
    if(isAdmin()){
      const actions=make("div","flex flex-wrap gap-2 shrink-0");
      const edit=make("button","rounded-lg border px-3 py-2 text-xs font-bold","Edit");
      edit.type="button";edit.disabled=doc.status!=="active";
      edit.addEventListener("click",()=>openEdit(doc));
      const lifecycle=make("button","rounded-lg border border-amber-400 px-3 py-2 text-xs font-bold text-amber-900",
        doc.status==="active"?"Archive":"Restore");
      lifecycle.type="button";
      lifecycle.addEventListener("click",()=>void changeDocumentStatus(doc));
      actions.append(edit,lifecycle);top.append(actions);
    }
    card.append(top);
    const preview=make("p","mt-3 text-sm whitespace-pre-wrap break-words text-slate-700",
      doc.text.length>1400?doc.text.slice(0,1400)+"…":doc.text);
    card.append(preview);documentHost.append(card);
  }
  if(!docs.length)documentHost.append(make("p","text-sm text-slate-500 py-3","No documents in this shared folder."));
  el("schoolReferenceDocumentCount").textContent=docs.length+" shown";
}
function renderDetail(){
  if(!selectedPayload){detail.hidden=true;empty.hidden=false;syncRoleControls();return;}
  detail.hidden=false;empty.hidden=true;
  const folder=selectedPayload.folder;
  el("schoolReferenceFolderName").textContent=folder.name;
  el("schoolReferenceFolderMeta").textContent=
    "School shared · "+folder.status+" · revision "+folder.revision;
  el("schoolReferenceLifecycle").textContent=folder.status==="active"?"Archive folder":"Restore folder";
  renderDocuments();renderFolders();syncRoleControls();
}
async function refresh(){
  const version=++epoch,includeArchived=isAdmin()&&el("schoolReferenceArchived").checked;
  say("Loading the selected school's shared reference library…");
  const result=await perform("list_folders",{includeArchived});
  if(version!==epoch)return;
  folders=result.folders||[];renderFolders();
  if(selected&&folders.some(item=>item.folderId===selected))
    await openFolder(selected,{replaceStatus:false});
  else{selected=null;selectedPayload=null;renderDetail();}
  say(folders.length+" shared folder"+(folders.length===1?"":"s")+" available.");
}
async function openFolder(folderId,{replaceStatus=true}={}){
  if(busy)return;selected=folderId;renderFolders();
  try{
    const payload=await perform("list_documents",{
      folderId,includeArchived:isAdmin()&&el("schoolReferenceArchived").checked
    });
    if(selected!==folderId)return;
    selectedPayload=payload;renderDetail();
    if(replaceStatus)say("Shared reference folder loaded.");
  }catch(error){
    if(selected===folderId){selected=null;selectedPayload=null;renderDetail();}
    say(error?.message||"This shared reference folder is unavailable.");
  }
}
async function run(form,operation,message){
  if(busy)return null;busy=true;
  const controls=[...form.querySelectorAll("button,input,textarea,select")];
  controls.forEach(control=>control.disabled=true);
  try{
    const result=await operation();say(message);return result;
  }catch(error){say(error?.message||"The school reference change was not saved.");return null;}
  finally{busy=false;controls.forEach(control=>control.disabled=false);syncRoleControls();}
}
function bytesToBase64(bytes){
  let out="",chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk)
    out+=String.fromCharCode(...bytes.subarray(i,i+chunk));
  return btoa(out);
}
function openEdit(doc){
  const form=el("schoolReferenceEditForm");
  form.elements.documentId.value=doc.documentId;
  form.elements.revision.value=String(doc.revision);
  form.elements.title.value=doc.title;
  form.elements.text.value=doc.text;
  el("schoolReferenceEditDialog").showModal();
}
async function changeDocumentStatus(doc){
  if(!selectedPayload||busy)return;
  const next=doc.status==="active"?"archived":"active";
  if(!confirm((next==="archived"?"Archive":"Restore")+" ""+doc.title+"" in the school shared library?"))return;
  busy=true;
  try{
    await perform("set_document_status",{
      folderId:selectedPayload.folder.folderId,documentId:doc.documentId,
      expectedRevision:doc.revision,status:next
    });
    await Promise.all([openFolder(selected,{replaceStatus:false}),refresh()]);
    say("Shared reference document "+next+".");
  }catch(error){say(error?.message||"The document status was not changed.");}
  finally{busy=false;syncRoleControls();}
}

el("schoolReferenceRefresh").addEventListener("click",()=>void refresh());
el("schoolReferenceArchived").addEventListener("change",()=>void refresh());
el("schoolReferenceCreateFolder").addEventListener("submit",event=>{
  event.preventDefault();const form=event.currentTarget,name=String(new FormData(form).get("name")||"").trim();
  void run(form,async()=>{
    const result=await perform("create_folder",{name});form.reset();selected=result.folderId;
    await refresh();await openFolder(result.folderId,{replaceStatus:false});return result;
  },"Shared folder created.");
});
el("schoolReferenceRename").addEventListener("click",()=>{
  if(!selectedPayload||busy)return;
  const current=selectedPayload.folder,newName=prompt("Rename shared folder:",current.name);
  if(newName===null||newName.trim()===current.name)return;
  void (async()=>{
    busy=true;
    try{
      await perform("rename_folder",{folderId:current.folderId,name:newName.trim(),expectedRevision:current.revision});
      await refresh();await openFolder(current.folderId,{replaceStatus:false});say("Shared folder renamed.");
    }catch(error){say(error?.message||"Shared folder was not renamed.");}
    finally{busy=false;syncRoleControls();}
  })();
});
el("schoolReferenceLifecycle").addEventListener("click",()=>{
  if(!selectedPayload||busy)return;
  const folder=selectedPayload.folder,next=folder.status==="active"?"archived":"active";
  if(!confirm((next==="archived"?"Archive":"Restore")+" the shared folder ""+folder.name+""?"))return;
  void (async()=>{
    busy=true;
    try{
      await perform("set_folder_status",{folderId:folder.folderId,status:next,expectedRevision:folder.revision});
      selected=null;selectedPayload=null;await refresh();say("Shared folder "+next+".");
    }catch(error){say(error?.message||"Shared folder status was not changed.");}
    finally{busy=false;syncRoleControls();}
  })();
});
el("schoolReferenceCopy").addEventListener("click",()=>{
  if(!selectedPayload||busy)return;
  const folder=selectedPayload.folder;
  if(!confirm("Copy ""+folder.name+"" and its active documents into your private reference library? Future shared-library edits will not change your copy."))return;
  void (async()=>{
    busy=true;el("schoolReferenceCopy").disabled=true;
    try{
      const result=await perform("copy_folder",{folderId:folder.folderId});
      say("Copied "+result.documentCount+" document"+(result.documentCount===1?"":"s")+" into your private library.");
    }catch(error){say(error?.message||"The shared folder could not be copied.");}
    finally{busy=false;syncRoleControls();}
  })();
});
el("schoolReferenceAddText").addEventListener("submit",event=>{
  event.preventDefault();if(!selectedPayload)return;
  const form=event.currentTarget,values=new FormData(form);
  void run(form,async()=>{
    await perform("add_text",{folderId:selectedPayload.folder.folderId,
      title:String(values.get("title")||""),text:String(values.get("text")||"")});
    form.reset();await openFolder(selected,{replaceStatus:false});await refresh();return true;
  },"Shared text reference added.");
});
el("schoolReferenceAddPdf").addEventListener("submit",event=>{
  event.preventDefault();if(!selectedPayload)return;
  const form=event.currentTarget,file=form.elements.pdf.files?.[0];
  if(!file)return;
  void run(form,async()=>{
    if(file.size>6*1024*1024)throw new Error("PDF must be 6 MB or smaller.");
    const pdfBase64=bytesToBase64(new Uint8Array(await file.arrayBuffer()));
    await perform("import_pdf",{folderId:selectedPayload.folder.folderId,fileName:file.name,pdfBase64});
    form.reset();await openFolder(selected,{replaceStatus:false});await refresh();return true;
  },"PDF text extracted into the shared library.");
});
el("schoolReferenceEditForm").addEventListener("submit",event=>{
  event.preventDefault();if(!selectedPayload)return;
  const form=event.currentTarget,values=new FormData(form);
  void run(form,async()=>{
    await perform("update_document",{
      folderId:selectedPayload.folder.folderId,
      documentId:String(values.get("documentId")||""),
      expectedRevision:Number(values.get("revision")),
      title:String(values.get("title")||""),text:String(values.get("text")||"")
    });
    el("schoolReferenceEditDialog").close();
    await openFolder(selected,{replaceStatus:false});await refresh();return true;
  },"Shared reference updated.");
});
el("schoolReferenceEditCancel").addEventListener("click",()=>el("schoolReferenceEditDialog").close());

try{
  await picker.load();
  if(!auth.currentUser)say("Sign in to use the school reference library.");
}catch(error){say(error?.message||"Unable to load the verified school reference library.");}
