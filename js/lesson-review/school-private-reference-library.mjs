import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs?v=4.0.0";

const api=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolReferences");
const el=id=>document.getElementById(id);
const status=el("privateReferenceStatus"),workspace=el("privateReferenceWorkspace"),
  folderHost=el("privateReferenceFolders"),documentHost=el("privateReferenceDocuments"),
  detail=el("privateReferenceDetail"),empty=el("privateReferenceEmpty");
let folders=[],selected=null,documents=[],busy=false,epoch=0;

function say(message,error=false){
  status.textContent=message;
  status.className="text-sm "+(error?"text-rose-700":"text-slate-600");
}
function make(tag,className,text){
  const node=document.createElement(tag);
  if(className)node.className=className;
  if(text!==undefined)node.textContent=String(text);
  return node;
}
function date(value){return value?new Date(value).toLocaleString():"—";}
function setBusy(value){
  busy=value;
  for(const control of document.querySelectorAll(
    "#privateReferenceWorkspace button,#privateReferenceWorkspace input,#privateReferenceWorkspace textarea"))
    control.disabled=value;
  el("privateReferenceRefresh").disabled=value;
}
async function perform(action,details={}){
  const lease=picker.scope.lease();
  const result=(await api({schoolId:lease.schoolId,action,...details})).data;
  picker.scope.assertLease(lease);
  return result;
}
function selectedFolder(){return folders.find(item=>item.folderId===selected)||null;}

function renderFolders(){
  folderHost.replaceChildren();
  for(const folder of folders){
    const button=make("button",
      "w-full text-left rounded-xl border p-3 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-cyan-500");
    button.type="button";
    if(folder.folderId===selected)button.classList.add("border-cyan-500","bg-cyan-50");
    const top=make("div","flex gap-2 justify-between items-start");
    top.append(make("strong","text-sm break-words",folder.name),
      make("span","text-[10px] font-bold rounded-full bg-slate-100 px-2 py-1 shrink-0",
        String(folder.documentCount||0)));
    button.append(top,make("p","text-xs text-slate-500 mt-1",
      "Revision "+(folder.revision||1)+" · "+date(folder.updatedAt)));
    button.addEventListener("click",()=>void openFolder(folder.folderId));
    folderHost.append(button);
  }
  if(!folders.length)folderHost.append(make("p","text-sm text-slate-500 py-3",
    "No private reference folders yet. Create one or copy a school-shared folder."));
}
function renderDocuments(){
  documentHost.replaceChildren();
  el("privateReferenceDocumentCount").textContent=
    documents.length+" document"+(documents.length===1?"":"s");
  if(!documents.length){
    documentHost.append(make("p","rounded-xl border border-dashed p-4 text-sm text-slate-500",
      "This folder has no active reference documents."));
    return;
  }
  for(const item of documents){
    const card=make("article","rounded-xl border border-slate-200 p-4");
    const top=make("div","flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3");
    const info=make("div","min-w-0");
    info.append(make("strong","block text-sm break-words",item.title),
      make("p","text-xs text-slate-500 mt-1",
        String(item.sourceType||"text").replaceAll("_"," ")+" · revision "+(item.revision||1)+
        " · "+date(item.updatedAt)));
    const actions=make("div","flex flex-wrap gap-2 shrink-0");
    const rename=make("button","rounded-lg border px-3 py-2 text-xs font-bold","Rename");
    rename.type="button";rename.addEventListener("click",()=>void renameDocument(item));
    const archive=make("button","rounded-lg border border-amber-400 text-amber-900 px-3 py-2 text-xs font-bold","Archive");
    archive.type="button";archive.addEventListener("click",()=>void archiveDocument(item));
    actions.append(rename,archive);top.append(info,actions);card.append(top);

    const details=make("details","mt-3 rounded-lg bg-slate-50 border border-slate-200 p-3");
    const summary=make("summary","text-xs font-bold cursor-pointer","View extracted/reference text");
    const text=make("pre","mt-3 whitespace-pre-wrap break-words text-xs text-slate-700 max-h-[34rem] overflow-auto",
      item.text||"No text is stored for this reference.");
    details.append(summary,text);card.append(details);documentHost.append(card);
  }
}
function renderSelection(){
  const folder=selectedFolder();
  if(!folder){
    detail.hidden=true;empty.hidden=false;documents=[];documentHost.replaceChildren();return;
  }
  empty.hidden=true;detail.hidden=false;
  el("privateReferenceFolderName").textContent=folder.name;
  el("privateReferenceFolderMeta").textContent=
    "Revision "+(folder.revision||1)+" · updated "+date(folder.updatedAt);
  renderFolders();renderDocuments();
}
async function refresh({retainSelection=true}={}){
  if(busy)return;
  const sequence=++epoch;setBusy(true);say("Loading your private school reference folders…");
  try{
    const result=await perform("list_folders");
    if(sequence!==epoch)return;
    folders=result.folders||[];
    if(!retainSelection||!folders.some(item=>item.folderId===selected)){
      selected=null;documents=[];
    }
    renderFolders();renderSelection();workspace.hidden=false;
    say(folders.length?
      folders.length+" private reference folder"+(folders.length===1?"":"s")+" loaded.":
      "No private reference folders yet. Create one or copy a school-shared folder.");
  }catch(error){
    if(sequence===epoch){workspace.hidden=true;say(error?.message||"Private reference library is unavailable.",true);}
  }finally{if(sequence===epoch)setBusy(false);}
}
async function openFolder(folderId){
  if(busy)return;
  const sequence=++epoch;selected=folderId;renderFolders();setBusy(true);
  say("Loading private reference documents…");
  try{
    const result=await perform("list_documents",{folderId});
    if(sequence!==epoch||selected!==folderId)return;
    documents=result.documents||[];renderSelection();
    say("Private folder loaded. Changes affect only your reference library in this school.");
  }catch(error){
    if(sequence===epoch){selected=null;documents=[];renderSelection();say(error?.message||"Reference folder is unavailable.",true);}
  }finally{if(sequence===epoch)setBusy(false);}
}
async function mutate(action,details,message,{reloadFolder=true}={}){
  if(busy)return null;
  setBusy(true);say(message);
  try{
    const result=await perform(action,details);
    const prior=selected;
    const foldersResult=await perform("list_folders");
    folders=foldersResult.folders||[];
    if(!folders.some(item=>item.folderId===prior)){selected=null;documents=[];}
    else selected=prior;
    renderFolders();
    if(reloadFolder&&selected){
      const docs=await perform("list_documents",{folderId:selected});
      documents=docs.documents||[];
    }
    renderSelection();say(message.replace(/…$/,"")+" complete.");
    return result;
  }catch(error){
    say(error?.message||"Reference library change was not saved.",true);return null;
  }finally{setBusy(false);}
}

el("privateReferenceCreateFolder").addEventListener("submit",event=>{
  event.preventDefault();
  const form=event.currentTarget,name=String(new FormData(form).get("name")||"").trim();
  if(!name)return;
  void (async()=>{
    const result=await mutate("create_folder",{name},"Creating private reference folder…",{reloadFolder:false});
    if(!result)return;
    form.reset();selected=result.folderId;await openFolder(result.folderId);
  })();
});
el("privateReferenceRename").addEventListener("click",()=>{
  const folder=selectedFolder();if(!folder||busy)return;
  const name=prompt("Rename this private reference folder:",folder.name);
  if(name===null||!String(name).trim()||String(name).trim()===folder.name)return;
  void mutate("rename_folder",{folderId:folder.folderId,expectedRevision:folder.revision,name:String(name).trim()},
    "Renaming private reference folder…");
});
el("privateReferenceArchive").addEventListener("click",()=>{
  const folder=selectedFolder();if(!folder||busy)return;
  if(!confirm("Archive “"+folder.name+"”? Its documents remain preserved but the folder will leave the active library."))return;
  void mutate("archive_folder",{folderId:folder.folderId,expectedRevision:folder.revision},
    "Archiving private reference folder…",{reloadFolder:false});
});
el("privateReferenceAddText").addEventListener("submit",event=>{
  event.preventDefault();const folder=selectedFolder();if(!folder||busy)return;
  const form=event.currentTarget,data=new FormData(form),
    title=String(data.get("title")||"").trim(),text=String(data.get("text")||"").trim();
  if(!title||!text)return;
  void (async()=>{
    const result=await mutate("add_text",{folderId:folder.folderId,title,text},
      "Adding private text reference…");
    if(result)form.reset();
  })();
});
function fileToBase64(file){
  return file.arrayBuffer().then(buffer=>{
    const bytes=new Uint8Array(buffer),chunk=0x8000;let binary="";
    for(let i=0;i<bytes.length;i+=chunk)
      binary+=String.fromCharCode(...bytes.subarray(i,Math.min(i+chunk,bytes.length)));
    return btoa(binary);
  });
}
el("privateReferenceAddPdf").addEventListener("submit",event=>{
  event.preventDefault();const folder=selectedFolder();if(!folder||busy)return;
  const form=event.currentTarget,data=new FormData(form),file=data.get("pdf"),
    title=String(data.get("title")||"").trim();
  if(!(file instanceof File)||!file.size||!title)return;
  if(file.size>4*1024*1024){say("Use a PDF no larger than 4 MB.",true);return;}
  if(file.type&&file.type!=="application/pdf"&&!file.name.toLowerCase().endsWith(".pdf")){
    say("Choose a PDF file.",true);return;
  }
  void (async()=>{
    setBusy(true);say("Preparing PDF for transient school-AI text extraction…");
    try{
      const pdfBase64=await fileToBase64(file);
      const result=await perform("import_pdf",{
        folderId:folder.folderId,title,fileName:file.name,pdfBase64
      });
      const foldersResult=await perform("list_folders");folders=foldersResult.folders||[];
      const docs=await perform("list_documents",{folderId:folder.folderId});
      documents=docs.documents||[];renderFolders();renderSelection();form.reset();
      say("PDF text extracted into your private reference library. The raw PDF was not stored.");
      return result;
    }catch(error){say(error?.message||"PDF reference could not be imported.",true);}
    finally{setBusy(false);}
  })();
});
async function renameDocument(item){
  if(busy)return;
  const title=prompt("Rename this private reference:",item.title);
  if(title===null||!String(title).trim()||String(title).trim()===item.title)return;
  await mutate("rename_document",{
    folderId:selected,documentId:item.documentId,expectedRevision:item.revision,title:String(title).trim()
  },"Renaming private reference…");
}
async function archiveDocument(item){
  if(busy)return;
  if(!confirm("Archive “"+item.title+"”? Its retained history is preserved."))return;
  await mutate("archive_document",{
    folderId:selected,documentId:item.documentId,expectedRevision:item.revision
  },"Archiving private reference…");
}
el("privateReferenceRefresh").addEventListener("click",()=>void refresh());

const picker=createTenantSchoolPicker({
  host:el("privateReferenceSwitcher"),status,
  onBeforeChange:async()=>{
    if(busy)throw new Error("Finish the current reference-library action before switching schools.");
    ++epoch;folders=[];selected=null;documents=[];
    folderHost.replaceChildren();documentHost.replaceChildren();
    detail.hidden=true;empty.hidden=false;workspace.hidden=true;
    say("Switching verified school context…");
  },
  onReady:scope=>{
    if(!scope.current){workspace.hidden=true;return;}
    if(!scope.current.roles.includes("teacher")){
      workspace.hidden=true;say("Verified teacher access is required for the private reference library.",true);return;
    }
    void refresh({retainSelection:false});
  }
});

try{
  await picker.load();
  if(!auth.currentUser)say("Sign in with a verified school teacher account.",true);
}catch(error){say(error?.message||"Unable to load the private school reference library.",true);}
