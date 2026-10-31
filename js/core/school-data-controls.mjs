import {app,auth} from "./firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "./tenant-school-picker.mjs?v=4.0.0";

const functions=getFunctions(app,"asia-southeast1");
const policyApi=httpsCallable(functions,"schoolFilePolicy");
const exportApi=httpsCallable(functions,"schoolDataExport");
const el=id=>document.getElementById(id);
let policy=null,manifest=null,busy=false,epoch=0;
const EXPORT_SCHEMA="adminerva-school-continuity-export-v2";

function say(message,error=false){
  el("dataFilesStatus").textContent=message;
  el("dataFilesStatus").className="text-sm "+(error?"text-rose-700":"text-slate-600");
}
function setBusy(value){
  busy=value;
  for(const node of document.querySelectorAll("#dataFilesWorkspace button,#dataFilesWorkspace input,#dataFilesWorkspace select,#dataFilesWorkspace textarea"))
    node.disabled=value;
}
async function call(callable,details={}){
  const lease=picker.scope.lease();
  const result=(await callable({schoolId:lease.schoolId,...details})).data;
  picker.scope.assertLease(lease);return result;
}
function renderPolicy(){
  const form=el("filePolicyForm"),p=policy||{};
  form.elements.enabled.checked=Boolean(p.enabled);
  form.elements.supportAttachmentsEnabled.checked=Boolean(p.supportAttachmentsEnabled);
  if(p.retentionDays)form.elements.retentionDays.value=String(p.retentionDays);
  if(p.maxBytes)form.elements.maxBytes.value=String(p.maxBytes);
  el("filePolicySummary").textContent=!p.configured?
    "No file policy has been configured. Browser Storage remains closed.":
    (p.supportAttachmentsEnabled?
      "Support attachments enabled · "+p.retentionDays+" day retention · "+
        Math.round(p.maxBytes/1048576)+" MB per file. Existing finalized files expire according to their recorded retention date.":
      "File policy configured but support attachments are disabled. Existing finalized files remain readable to authorized report participants until their recorded expiry.");
}
function fillList(id,items){
  const host=el(id);host.replaceChildren();
  for(const item of items||[]){const li=document.createElement("li");li.textContent=item;host.append(li);}
}
function renderManifest(){
  if(!manifest)return;
  fillList("exportIncluded",manifest.includes);fillList("exportExcluded",manifest.excludes);
  const total=Object.values(manifest.counts||{}).reduce((sum,value)=>sum+Number(value||0),0);
  el("exportCounts").textContent=Object.entries(manifest.counts||{})
    .map(([key,value])=>key.replaceAll("_"," ")+": "+Number(value).toLocaleString()).join(" · ")+
    " · total records: "+total.toLocaleString();
}
async function loadWorkspace(){
  const sequence=++epoch;setBusy(true);say("Loading school data controls…");
  try{
    const [policyResult,manifestResult]=await Promise.all([
      call(policyApi,{action:"status"}),call(exportApi,{action:"manifest"})
    ]);
    if(sequence!==epoch)return;
    policy=policyResult.policy;manifest=manifestResult;
    renderPolicy();renderManifest();el("dataFilesWorkspace").hidden=false;
    say("School data controls loaded for "+manifest.schoolDisplayName+".");
  }catch(error){if(sequence===epoch)say(error?.message||"School data controls are unavailable.",true);}
  finally{if(sequence===epoch)setBusy(false);}
}
async function sha256(value){
  const bytes=new TextEncoder().encode(JSON.stringify(value));
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,"0")).join("");
}
async function exportCategory(category){
  const rows=[];let cursor=null,pages=0;
  do{
    const page=await call(exportApi,{action:"page",category,cursor,limit:100});
    rows.push(...(page.rows||[]));cursor=page.nextCursor||null;pages++;
    if(pages>500)throw new Error("Export pagination safety limit reached for "+category+".");
  }while(cursor);
  return rows;
}
async function createExport(){
  if(busy||!manifest)return;
  const total=Object.values(manifest.counts||{}).reduce((sum,value)=>sum+Number(value||0),0);
  if(total>20000)throw new Error("This continuity export exceeds the current 20,000-record browser export limit.");
  setBusy(true);
  try{
    const categories={},localIntegrity={};let done=0;
    for(const category of manifest.categories||[]){
      say("Exporting "+category.replaceAll("_"," ")+"…");
      categories[category]=await exportCategory(category);
      localIntegrity[category]={
        count:categories[category].length,
        sha256:await sha256(categories[category])
      };
      done++;
      say("Exported "+done+" of "+manifest.categories.length+" categories…");
    }
    // Re-read each category server-side after assembly. A continuity file is
    // refused if any collection changed while browser pagination was running.
    for(let index=0;index<(manifest.categories||[]).length;index++){
      const category=manifest.categories[index];
      say("Verifying export consistency "+(index+1)+" of "+manifest.categories.length+"…");
      const remote=await call(exportApi,{action:"integrity",category});
      const local=localIntegrity[category];
      if(remote.count!==local.count||remote.sha256!==local.sha256)
        throw new Error("School data changed while exporting "+category.replaceAll("_"," ")+
          ". No continuity file was created; run the export again.");
    }
    const finalCounts=Object.fromEntries(Object.entries(localIntegrity).map(([category,row])=>[category,row.count]));
    const payload={
      schema:EXPORT_SCHEMA,schoolId:manifest.schoolId,
      schoolDisplayName:manifest.schoolDisplayName,
      generatedAt:new Date().toISOString(),
      sourceManifest:{
        generatedAt:manifest.generatedAt,counts:finalCounts,
        initialCounts:manifest.counts,categoryIntegrity:localIntegrity,
        includes:manifest.includes,excludes:manifest.excludes,
        privacyNotice:manifest.privacyNotice
      },
      categories
    };
    const digest=await sha256(payload),bundle={...payload,sha256:digest},
      json=JSON.stringify(bundle,null,2)+"\n",blob=new Blob([json],{type:"application/json"}),
      url=URL.createObjectURL(blob),link=document.createElement("a"),
      date=new Date().toISOString().slice(0,10);
    link.href=url;link.download="adminerva-"+manifest.schoolId+"-continuity-"+date+".json";
    document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    say("Continuity export created. SHA-256: "+digest.slice(0,16)+"…");
  }finally{setBusy(false);}
}
async function previewRestore(file){
  if(!file){el("restorePreviewResult").textContent="No file selected.";return;}
  if(file.size>25*1024*1024)throw new Error("Restore preview files are limited to 25 MB.");
  const parsed=JSON.parse(await file.text());
  if(parsed.schema!==EXPORT_SCHEMA)throw new Error("This is not an Adminerva 4.0 continuity export.");
  const current=picker.scope.current;
  if(!current||parsed.schoolId!==current.schoolId)
    throw new Error("This continuity file belongs to another school.");
  const supplied=String(parsed.sha256||"");
  if(!/^[a-f0-9]{64}$/.test(supplied))throw new Error("The continuity file has no valid SHA-256 integrity value.");
  const {sha256:_,...payload}=parsed,computed=await sha256(payload);
  if(computed!==supplied)throw new Error("Continuity export integrity check failed. The file changed after export.");
  const categories=parsed.categories&&typeof parsed.categories==="object"?parsed.categories:{},
    expected=parsed.sourceManifest?.counts||{},
    integrity=parsed.sourceManifest?.categoryIntegrity||{},
    rows=Object.entries(categories).map(([name,value])=>[name,Array.isArray(value)?value.length:0]),
    mismatches=[];
  for(const [name,count] of rows){
    if(Number(expected[name])!==count){mismatches.push(name+" count");continue;}
    const saved=integrity[name];
    if(!saved||saved.count!==count||!/^([a-f0-9]{64})$/.test(String(saved.sha256||""))){
      mismatches.push(name+" integrity metadata");continue;
    }
    if(await sha256(categories[name])!==saved.sha256)mismatches.push(name+" digest");
  }
  if(mismatches.length)
    throw new Error("Continuity category integrity failed: "+mismatches.join(", ")+".");
  const total=rows.reduce((sum,row)=>sum+row[1],0);
  el("restorePreviewResult").textContent=
    "Integrity verified for "+parsed.schoolDisplayName+" · "+total.toLocaleString()+" records across "+
    rows.length+" categories. Category counts and SHA-256 digests match the saved manifest. Preview only: no records were written.";
}
const picker=createTenantSchoolPicker({
  host:el("dataFilesSchoolSwitcher"),status:el("dataFilesStatus"),
  onBeforeChange:async()=>{
    if(busy)throw new Error("Finish the current data operation before switching schools.");
    ++epoch;policy=null;manifest=null;el("dataFilesWorkspace").hidden=true;
    el("restorePreviewResult").textContent="No file selected.";
  },
  onReady:scope=>{if(scope.current)void loadWorkspace();}
});

el("filePolicyForm").addEventListener("submit",event=>{
  event.preventDefault();if(busy)return;
  const form=event.currentTarget,values=new FormData(form);
  void (async()=>{
    setBusy(true);
    try{
      say("Saving audited school file policy…");
      const result=await call(policyApi,{
        action:"configure",
        enabled:values.get("enabled")==="on",
        supportAttachmentsEnabled:values.get("supportAttachmentsEnabled")==="on",
        retentionDays:Number(values.get("retentionDays")),
        maxBytes:Number(values.get("maxBytes")),
        reason:String(values.get("reason")||"")
      });
      policy=result.policy;renderPolicy();form.elements.reason.value="";
      say("School file policy saved and audited.");
    }catch(error){say(error?.message||"File policy could not be saved.",true);}
    finally{setBusy(false);}
  })();
});
el("createContinuityExport").addEventListener("click",()=>void createExport().catch(error=>{
  setBusy(false);say(error?.message||"Continuity export failed.",true);
}));
el("restorePreviewFile").addEventListener("change",event=>{
  const file=event.target.files?.[0]||null;
  void previewRestore(file).catch(error=>{
    el("restorePreviewResult").textContent=error?.message||"Restore preview failed.";
  });
});

try{
  await picker.load();
  if(!auth.currentUser)say("Sign in with a verified school administrator account.",true);
}catch(error){say(error?.message||"Unable to load school data controls.",true);}
