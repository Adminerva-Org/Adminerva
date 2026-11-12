import {app,auth} from "./firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "./tenant-school-picker.mjs?v=4.0.0";
import {getStorage,ref as storageRef,uploadBytes,getBytes} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";

const functions=getFunctions(app,"asia-southeast1");
const api=httpsCallable(functions,"schoolSupport");
const filePolicyApi=httpsCallable(functions,"schoolFilePolicy");
const storage=getStorage(app);
const el=id=>document.getElementById(id);
const workspace=el("schoolSupportWorkspace"),status=el("schoolSupportStatus"),
  list=el("schoolSupportList"),detail=el("schoolSupportDetail"),empty=el("schoolSupportEmpty");
let reports=[],selected=null,selectedDetail=null,busy=false,loadEpoch=0,filePolicy=null;

function say(message){status.textContent=message;}
function date(value){return value?new Date(value).toLocaleString():"—";}
function make(tag,className,text){
  const node=document.createElement(tag);if(className)node.className=className;
  if(text!==undefined)node.textContent=String(text);return node;
}
const picker=createTenantSchoolPicker({
  host:el("schoolSupportSwitcher"),status,
  onBeforeChange:async()=>{
    if(busy)throw new Error("Finish the current support action before switching schools.");
    ++loadEpoch;reports=[];selected=null;selectedDetail=null;list.replaceChildren();
    detail.hidden=true;empty.hidden=false;workspace.hidden=true;
  },
  onReady:scope=>{
    if(!scope.current){workspace.hidden=true;return;}
    workspace.hidden=false;
    void (async()=>{
      try{await loadFilePolicy();}catch(error){
        filePolicy=null;el("schoolSupportAttachmentField").hidden=true;
        el("schoolSupportFilePolicy").textContent="Attachment policy could not be loaded.";
      }
      await refresh(scope);
    })().catch(error=>say(error?.message||"School reports are unavailable."));
  }
});
async function perform(action,details={}){
  const lease=picker.scope.lease();
  const result=(await api({schoolId:lease.schoolId,action,...details})).data;
  picker.scope.assertLease(lease);return result;
}
async function loadFilePolicy(){
  const lease=picker.scope.lease();
  const result=(await filePolicyApi({schoolId:lease.schoolId,action:"status"})).data;
  picker.scope.assertLease(lease);
  filePolicy=result.policy||null;
  const enabled=Boolean(filePolicy?.supportAttachmentsEnabled);
  el("schoolSupportAttachmentField").hidden=!enabled;
  el("schoolSupportFiles").disabled=!enabled;
  el("schoolSupportFilePolicy").textContent=enabled?
    "Attachments are private to this report and authorized school administrators. "+
      "Retention: "+filePolicy.retentionDays+" days · per-file limit: "+
      Math.round(filePolicy.maxBytes/1048576)+" MB.":
    "Attachments are disabled until a school administrator enables the school file-retention policy.";
  el("schoolSupportAttachmentHelp").textContent=enabled?
    "PNG, JPEG, WebP, PDF or text. Up to 12 files per report; each file must stay within the school limit.":"";
  return filePolicy;
}
function attachmentId(){
  const bytes=crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map(value=>value.toString(16).padStart(2,"0")).join("");
}
async function uploadAttachment(reportId,file){
  if(!filePolicy?.supportAttachmentsEnabled)
    throw new Error("School attachments are not enabled.");
  if(!filePolicy.allowedContentTypes?.includes(file.type))
    throw new Error(file.name+": unsupported file type.");
  if(file.size>filePolicy.maxBytes)
    throw new Error(file.name+": file exceeds the school limit.");
  const fileId=attachmentId(),reservation=await perform("prepare_attachment",{
    reportId,fileId,originalName:file.name,contentType:file.type,size:file.size
  });
  await uploadBytes(storageRef(storage,reservation.storagePath),file,{
    contentType:reservation.contentType,
    customMetadata:reservation.requiredMetadata
  });
  return perform("finalize_attachment",{reportId,fileId});
}
async function downloadAttachment(item){
  say("Downloading private attachment…");
  try{
    const bytes=await getBytes(storageRef(storage,item.storagePath),filePolicy?.maxBytes||5242880);
    const blob=new Blob([bytes],{type:item.contentType||"application/octet-stream"}),
      url=URL.createObjectURL(blob),link=document.createElement("a");
    link.href=url;link.download=item.originalName||"attachment";document.body.append(link);link.click();
    link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    say("Attachment downloaded.");
  }catch(error){say(error?.message||"Attachment download failed.");}
}
function filteredReports(){
  const mode=el("schoolSupportFilter").value;
  if(mode==="mine")return reports.filter(item=>item.isMine);
  if(mode==="resolved")return reports.filter(item=>["Resolved","Closed"].includes(item.status));
  if(mode==="active")return reports.filter(item=>!["Resolved","Closed"].includes(item.status));
  return reports;
}
function renderList(){
  list.replaceChildren();
  const visible=filteredReports();
  for(const report of visible){
    const button=make("button","w-full text-left border rounded-xl p-3 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-cyan-500");
    button.type="button";button.dataset.reportId=report.reportId;
    if(report.reportId===selected)button.classList.add("border-cyan-500","bg-cyan-50");
    const top=make("div","flex gap-2 justify-between items-start");
    top.append(make("strong","text-sm break-words",report.title),
      make("span","text-[10px] font-bold rounded-full bg-slate-100 px-2 py-1 shrink-0",report.status));
    button.append(top,make("p","text-xs text-slate-500 mt-1",
      report.category+" · "+report.reporterLabel+" · "+date(report.updatedAt||report.createdAt)));
    button.addEventListener("click",()=>void openReport(report.reportId));
    list.append(button);
  }
  if(!visible.length)list.append(make("p","text-sm text-slate-500 py-3","No school reports match this filter."));
}
async function refresh(scope=picker.scope){
  const epoch=++loadEpoch;say("Loading reports for the selected school…");
  const result=await perform("list",{limit:100});
  if(epoch!==loadEpoch)return;
  reports=result.reports||[];renderList();
  say((reports.length||0)+" school support report"+(reports.length===1?"":"s")+" available."+
    (result.truncated?" Only the first 100 are shown.":""));
  const deep=new URL(location.href).searchParams.get("report");
  const target=(deep&&reports.some(item=>item.reportId===deep))?deep:
    selected&&reports.some(item=>item.reportId===selected)?selected:null;
  if(target)await openReport(target,{replaceUrl:false});
}
function renderAttachments(items){
  const section=el("schoolSupportAttachmentsSection"),host=el("schoolSupportAttachments"),
    count=el("schoolSupportAttachmentCount");
  host.replaceChildren();
  const rows=items||[];section.hidden=!rows.length;count.textContent=rows.length?rows.length+" file"+(rows.length===1?"":"s"):"";
  for(const item of rows){
    const row=make("div","flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between border rounded-lg p-3");
    const info=make("div","min-w-0");
    info.append(make("strong","block text-sm break-all",item.originalName),
      make("span","block text-xs text-slate-500 mt-1",
        item.contentType+" · "+Math.max(1,Math.round(item.size/1024))+" KB · expires "+date(item.expiresAt)));
    const button=make("button","rounded-lg border px-3 py-2 text-sm font-bold","Download");
    button.type="button";button.addEventListener("click",()=>void downloadAttachment(item));
    row.append(info,button);host.append(row);
  }
}
function renderComments(comments){
  const host=el("schoolSupportComments");host.replaceChildren();
  for(const comment of comments||[]){
    const row=make("article","rounded-xl border bg-slate-50 p-3");
    const head=make("div","flex justify-between gap-2 text-xs");
    head.append(make("strong","",comment.authorLabel),
      make("time","text-slate-500",date(comment.createdAt)));
    row.append(head,make("p","text-sm whitespace-pre-wrap break-words mt-2",comment.text));host.append(row);
  }
  if(!host.children.length)host.append(make("p","text-sm text-slate-500","No comments yet."));
}
function renderDetail(payload){
  selectedDetail=payload;const report=payload.report;
  detail.hidden=false;empty.hidden=true;
  el("schoolSupportTitle").textContent=report.title;
  el("schoolSupportMeta").textContent=report.category+" · "+(report.module||"General")+" · reported by "+report.reporterLabel+" · "+date(report.createdAt);
  el("schoolSupportDescription").textContent=report.description;
  el("schoolSupportBadge").textContent=report.status+" · "+report.priority;
  renderComments(payload.comments);
  renderAttachments(payload.attachments);
  const current=picker.scope.current,isAdmin=Boolean(current?.roles.includes("school_admin"));
  el("schoolSupportAdmin").hidden=!isAdmin;
  const triage=el("schoolSupportTriage");
  triage.elements.status.value=report.status;
  triage.elements.priority.value=report.priority;
  triage.elements.locked.checked=Boolean(report.locked);
  triage.elements.reason.value="";
  const commentForm=el("schoolSupportComment");
  commentForm.hidden=Boolean(report.locked)||report.status==="Closed";
  el("schoolSupportLocked").hidden=!commentForm.hidden;
  renderList();
}
async function openReport(reportId,{replaceUrl=true}={}){
  if(busy)return;
  selected=reportId;say("Loading private school report…");renderList();
  try{
    const payload=await perform("get",{reportId});
    if(selected!==reportId)return;
    renderDetail(payload);say("School support report loaded.");
    if(replaceUrl){
      const url=new URL(location.href);url.searchParams.set("report",reportId);
      history.replaceState(null,"",url);
    }
  }catch(error){
    if(selected===reportId){selected=null;selectedDetail=null;detail.hidden=true;empty.hidden=false;renderList();}
    say(error?.message||"This school report could not be opened.");
  }
}
async function submitAction(form,operation){
  if(busy)return null;
  busy=true;const controls=[...form.querySelectorAll("button,input,textarea,select")];
  controls.forEach(control=>control.disabled=true);
  try{return await operation();}
  catch(error){say(error?.message||"The support action was not saved.");return null;}
  finally{busy=false;controls.forEach(control=>control.disabled=false);}
}
el("schoolSupportCreate").addEventListener("submit",event=>{
  event.preventDefault();const form=event.currentTarget,values=new FormData(form),
    files=[...el("schoolSupportFiles").files];
  void submitAction(form,async()=>{
    if(files.length>12)throw new Error("A report supports up to 12 attachments.");
    say("Creating a private school report…");
    const result=await perform("create",{
      category:String(values.get("category")||""),
      module:String(values.get("module")||""),
      title:String(values.get("title")||""),
      description:String(values.get("description")||"")
    });
    if(files.length){
      let completed=0;
      for(const file of files){
        say("Uploading private attachment "+(completed+1)+" of "+files.length+"…");
        await uploadAttachment(result.reportId,file);completed++;
      }
    }
    form.reset();await refresh();await openReport(result.reportId);
    say("School report created"+(files.length?" with "+files.length+" private attachment"+(files.length===1?"":"s"):"")+
      ". Only you and authorized school administrators can access it.");
    return result;
  });
});
el("schoolSupportComment").addEventListener("submit",event=>{
  event.preventDefault();if(!selected)return;
  const form=event.currentTarget,text=String(new FormData(form).get("text")||"").trim();
  void submitAction(form,async()=>{
    say("Posting school support comment…");
    await perform("comment",{reportId:selected,text});form.reset();
    await openReport(selected,{replaceUrl:false});say("Comment posted.");
    return true;
  });
});
el("schoolSupportTriage").addEventListener("submit",event=>{
  event.preventDefault();if(!selected||!selectedDetail?.report)return;
  const form=event.currentTarget,values=new FormData(form),report=selectedDetail.report;
  if(!confirm("Save this school support triage decision? The action will be audited."))return;
  void submitAction(form,async()=>{
    say("Saving audited school support decision…");
    const result=await perform("triage",{
      reportId:selected,expectedRevision:report.revision,
      status:String(values.get("status")||""),
      priority:String(values.get("priority")||""),
      locked:values.get("locked")==="on",
      reason:String(values.get("reason")||"")
    });
    await refresh();await openReport(result.reportId,{replaceUrl:false});
    say("School support decision saved and audited.");return result;
  });
});
el("schoolSupportRefresh").addEventListener("click",()=>void refresh().catch(error=>say(error?.message||"Could not refresh school reports.")));
el("schoolSupportFilter").addEventListener("change",renderList);
try{
  await picker.load();
  if(!auth.currentUser){
    say("Sign in to use school support.");
  }
}catch(error){say(error?.message||"Unable to load verified school support.");}
