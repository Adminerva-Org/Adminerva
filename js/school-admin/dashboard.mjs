import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs?v=4.0.1";

const get=id=>document.getElementById(id);
const functions=getFunctions(app,"asia-southeast1");
const peopleApi=httpsCallable(functions,"peopleDirectory");
const classRecordApi=httpsCallable(functions,"schoolClassRecordAdmin");
const supportApi=httpsCallable(functions,"schoolSupport");
const status=get("adminOverviewStatus"),attentionList=get("adminAttentionList"),recordList=get("adminClassRecordList");
const refresh=get("adminRefresh"),attentionFilter=get("adminAttentionFilter"),recordFilter=get("adminRecordFilter"),recordSearch=get("adminRecordSearch");
let picker=null,loadGeneration=0,model={},attentionLimit=10,recordLimit=20;
const priorities={integrity:0,attention:1,review:2};
const tabs=new Set(["overview","people","invites","classes","access","import"]);
function escapeHTML(value){return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch]));}
function count(value){return Number.isFinite(value)&&value>=0?value.toLocaleString():"—";}
function set(id,value){get(id).textContent=value;}
function setWorkflow(id,value,noun){
  const node=get(id);if(!node)return;
  const numeric=Number(value),known=Number.isFinite(numeric)&&numeric>=0;
  node.textContent=!known?"Unavailable":numeric>0?numeric.toLocaleString()+" "+noun+(numeric===1?"":"s"):"Not started";
  node.className="rounded-full px-2 py-1 text-[11px] font-bold "+(!known?"bg-amber-100 text-amber-900":numeric>0?"bg-emerald-100 text-emerald-800":"bg-slate-200 text-slate-700");
}
function message(host,value){host.replaceChildren();const p=document.createElement("p");p.className="p-5 text-sm text-slate-600";p.textContent=value;host.append(p);}
function perform(api,action,lease){
  return api({schoolId:lease.schoolId,action}).then(response=>{picker.scope.assertLease(lease);return response.data;});
}
function issueHref(item){
  if(item.source==="record")return item.targetTab==="classes"?"people-access.html#classes":"school-class-records.html";
  return "people-access.html#"+(tabs.has(item.targetTab)?item.targetTab:"overview");
}
function recordState(record){
  if(!record.finalization)return {key:"not-finalized",label:"Not finalized",tone:"text-slate-600"};
  if(record.finalization.layoutChangedSinceFinalization)return {key:"review",label:"Needs review",tone:"text-amber-700"};
  if(record.finalization.releasedRevision)return {key:"released",label:"Released",tone:"text-emerald-700"};
  return {key:"finalized",label:"Finalized",tone:"text-blue-700"};
}
function issues(){
  const items=(model.reconciliation?.issues||[]).slice();
  for(const record of model.records||[]){
    if(!record.teacherNames?.length)items.push({source:"record",severity:"integrity",label:record.subjectName+" · "+record.sectionName,detail:"No active teacher is assigned to this Class Record.",targetTab:"classes"});
    if(record.finalization?.layoutChangedSinceFinalization)items.push({source:"record",severity:"attention",label:record.subjectName+" · "+record.sectionName,detail:"The Class Record changed after finalization and needs a new review.",targetTab:"records"});
  }
  return items.sort((a,b)=>(priorities[a.severity]??9)-(priorities[b.severity]??9)||String(a.label).localeCompare(String(b.label)));
}
function renderAttention(){
  const all=issues(),kind=attentionFilter.value,items=all.filter(item=>!kind||item.severity===kind),shown=items.slice(0,attentionLimit);
  const incomplete=!model.reconciliation||!model.records;
  set("adminAttentionCoverage",[
    model.reconciliation?.truncated?"Directory returned its first 150 issues; open People & Access for details.":"",
    incomplete?"Some checks are unavailable; this list is incomplete.":"",
    all.length?("Showing "+shown.length+" of "+items.length+" loaded items."):""
  ].filter(Boolean).join(" "));
  get("adminAttentionMore").hidden=items.length<=attentionLimit;
  if(!shown.length){message(attentionList,incomplete?"No matching issues could be confirmed. Refresh to retry unavailable checks.":all.length?"No issues match this filter.":"No issues found by the completed checks.");return;}
  attentionList.innerHTML=shown.map(item=>{
    const tone=item.severity==="integrity"?"text-rose-700 bg-rose-50":item.severity==="attention"?"text-amber-800 bg-amber-50":"text-slate-700 bg-slate-50";
    return '<div class="p-4 flex flex-wrap items-start justify-between gap-3"><div class="min-w-0 flex-1"><div class="flex flex-wrap items-center gap-2"><span class="rounded px-2 py-0.5 text-[10px] font-extrabold uppercase '+tone+'">'+escapeHTML(item.severity||"review")+'</span><strong class="text-sm break-words">'+escapeHTML(item.label||"School record")+'</strong></div><p class="text-xs text-slate-600 mt-1">'+escapeHTML(item.detail||"")+'</p></div><a class="shrink-0 text-sm font-bold text-blue-700" href="'+issueHref(item)+'">Review →</a></div>';
  }).join("");
}
function renderRecords(){
  const records=model.records,kind=recordFilter.value,query=recordSearch.value.trim().toLocaleLowerCase();
  if(!records){message(recordList,"Class Record status is unavailable. Refresh to retry.");set("adminRecordCoverage","");get("adminRecordMore").hidden=true;return;}
  const matching=records.filter(record=>(!kind||recordState(record).key===kind)&&(!query||[record.subjectName,record.sectionName,...(record.teacherNames||[])].some(value=>String(value||"").toLocaleLowerCase().includes(query))));
  const shown=matching.slice(0,recordLimit);
  set("adminRecordCoverage","Showing "+shown.length+" of "+matching.length+" matching · "+records.length+" loaded");
  get("adminRecordMore").hidden=shown.length>=matching.length;
  if(!shown.length){message(recordList,records.length?"No Class Records match the filters.":"No Class Records have been created yet.");return;}
  const rows=shown.map(record=>{const state=recordState(record);return '<tr class="border-b border-slate-100"><td class="px-4 py-3 text-sm font-semibold">'+escapeHTML(record.subjectName)+'</td><td class="px-4 py-3 text-sm">'+escapeHTML(record.sectionName)+'</td><td class="px-4 py-3 text-sm">'+escapeHTML((record.teacherNames||[]).join(", ")||"Unassigned")+'</td><td class="px-4 py-3 text-sm text-center">'+count(record.activeColumnCount)+'</td><td class="px-4 py-3 text-sm font-bold '+state.tone+'">'+state.label+'</td></tr>';}).join("");
  recordList.innerHTML='<table class="min-w-full"><thead class="bg-slate-50 text-xs uppercase text-slate-500"><tr><th scope="col" class="px-4 py-2 text-left">Subject</th><th scope="col" class="px-4 py-2 text-left">Section</th><th scope="col" class="px-4 py-2 text-left">Teacher</th><th scope="col" class="px-4 py-2 text-center">Activities</th><th scope="col" class="px-4 py-2 text-left">State</th></tr></thead><tbody>'+rows+'</tbody></table>';
}
function reset(){
  model={};attentionLimit=10;recordLimit=20;
  for(const id of ["adminPeopleCount","adminAttentionCount","adminClassRecordCount","adminReportCount","adminSupportOpen","adminSupportCritical","adminSupportWaiting","adminEnrollmentCount","adminAssignmentCount","adminInvitationCount"])set(id,"—");
  set("adminIntegrityMeta","Not checked");set("adminClassRecordMeta","Not checked");set("adminReportMeta","Not checked");
  for(const id of ["adminWorkflowPeople","adminWorkflowTeaching","adminWorkflowEnrollment","adminWorkflowRecords"]){const node=get(id);if(node){node.textContent="Checking…";node.className="rounded-full bg-slate-200 px-2 py-1 text-[11px] font-bold text-slate-700";}}
  set("adminAttentionCoverage","");set("adminRecordCoverage","");get("adminAttentionMore").hidden=true;get("adminRecordMore").hidden=true;
  message(attentionList,"Waiting for verified school checks…");message(recordList,"Waiting for verified school records…");
}
function renderSource(name,data){
  if(name==="directory"){
    model.overview=data;
    for(const [id,key] of [["adminPeopleCount","people"],["adminEnrollmentCount","enrollments"],["adminAssignmentCount","staff_assignments"],["adminInvitationCount","invitations"]])set(id,count(data?.counts?.[key]));
    setWorkflow("adminWorkflowPeople",data?.counts?.people,"record");setWorkflow("adminWorkflowTeaching",data?.counts?.staff_assignments,"assignment");setWorkflow("adminWorkflowEnrollment",data?.counts?.enrollments,"enrollment");
  }else if(name==="relationships"){
    model.reconciliation=data;
    set("adminAttentionCount",count(data?.counts?.total));
    set("adminIntegrityMeta",data?count(data.counts?.integrity)+" integrity · "+count(data.counts?.attention)+" attention":"Relationship checks unavailable");
    renderAttention();
  }else if(name==="records"){
    model.records=Array.isArray(data?.records)?data.records:null;
    set("adminClassRecordCount",model.records?count(model.records.length):"—");
    const finalized=model.records?.filter(row=>row.finalization&&!row.finalization.layoutChangedSinceFinalization).length;
    const released=model.records?.filter(row=>recordState(row).key==="released").length;
    set("adminClassRecordMeta",model.records?count(finalized)+" finalized · "+count(released)+" released":"Class Record source unavailable");
    setWorkflow("adminWorkflowRecords",model.records?.length,"record");
    renderRecords();renderAttention();
  }else if(name==="support"){
    model.support=data;
    for(const [id,key] of [["adminReportCount","open"],["adminSupportOpen","open"],["adminSupportCritical","critical"],["adminSupportWaiting","waiting"]])set(id,count(data?.counts?.[key]));
    set("adminReportMeta",data?count(data.counts?.critical)+" critical":"Support source unavailable");
  }
}
async function loadDashboard(){
  const generation=++loadGeneration,lease=picker.scope.lease();
  reset();refresh.disabled=true;status.textContent="Loading school operations…";get("adminLastChecked").textContent="";
  const sources=[["directory","Directory totals",peopleApi,"overview"],["relationships","Relationship checks",peopleApi,"reconcile_directory"],["records","Class Records",classRecordApi,"overview"],["support","Support reports",supportApi,"overview"]];
  const failed=[];
  const current=()=>generation===loadGeneration&&auth.currentUser?.uid===lease.uid;
  await Promise.all(sources.map(async ([name,label,api,action])=>{
    try{const result=await perform(api,action,lease);if(current())renderSource(name,result);}
    catch(error){if(current()){failed.push(label);renderSource(name,null);console.warn("School operations source unavailable",name,error);}}
  }));
  if(!current())return;
  refresh.disabled=false;set("adminLastChecked","Checked "+new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}));
  status.textContent=failed.length?"Unavailable: "+failed.join(", ")+". Other results remain usable.":"All four school operation sources loaded.";
}
refresh.addEventListener("click",()=>{if(picker.scope.current?.roles.includes("school_admin"))void loadDashboard();else void picker.load().catch(error=>{status.textContent=error?.message||"School access unavailable.";});});
attentionFilter.addEventListener("change",()=>{attentionLimit=10;renderAttention();});
recordFilter.addEventListener("change",()=>{recordLimit=20;renderRecords();});
recordSearch.addEventListener("input",()=>{recordLimit=20;renderRecords();});
get("adminAttentionMore").addEventListener("click",()=>{attentionLimit+=20;renderAttention();});
get("adminRecordMore").addEventListener("click",()=>{recordLimit+=20;renderRecords();});
picker=createTenantSchoolPicker({host:get("sa-school-picker"),status,
  onBeforeChange:async()=>{++loadGeneration;reset();refresh.disabled=true;get("adminSchoolName").textContent="Checking school…";},
  onReady:scope=>{
    if(!scope.current?.roles.includes("school_admin")){reset();refresh.disabled=false;status.textContent="School administrator access required.";return;}
    set("adminSchoolName",scope.current.name||scope.current.schoolId);
    void loadDashboard().catch(error=>{refresh.disabled=false;status.textContent=error?.message||"School operations could not be loaded.";});
  }
});
void picker.load().catch(error=>{refresh.disabled=false;status.textContent=error?.message||"School administration access could not be loaded.";});
