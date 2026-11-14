import {app} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs?v=4.0.1";

const get=id=>document.getElementById(id);
const functions=getFunctions(app,"asia-southeast1");
const peopleApi=httpsCallable(functions,"peopleDirectory");
const classRecordApi=httpsCallable(functions,"schoolClassRecordAdmin");
const supportApi=httpsCallable(functions,"schoolSupport");

const status=get("adminOverviewStatus");
const attentionList=get("adminAttentionList");
const recordList=get("adminClassRecordList");
let picker=null,loadGeneration=0;

function escapeHTML(value){
  return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch]));
}
function perform(api,action,details={}){
  const lease=picker.scope.lease();
  return api({schoolId:lease.schoolId,action,...details}).then(response=>{
    picker.scope.assertLease(lease);return response.data;
  });
}
function attentionHref(item){
  const tab=item?.targetTab||"overview";
  return "people-access.html#"+encodeURIComponent(tab);
}
function renderAttention(reconciliation,records){
  const items=[...(reconciliation?.issues||[])];
  for(const record of records||[]){
    if(!record.teacherNames?.length)items.unshift({
      severity:"integrity",label:record.subjectName+" · "+record.sectionName,
      detail:"No active teacher is assigned to this Class Record.",targetTab:"classes"
    });
    if(record.finalization?.layoutChangedSinceFinalization)items.unshift({
      severity:"attention",label:record.subjectName+" · "+record.sectionName,
      detail:"The Class Record changed after finalization and needs a new review.",targetTab:"classes"
    });
  }
  const shown=items.slice(0,10);
  if(!shown.length){
    attentionList.innerHTML='<div class="p-5 text-sm text-emerald-700 font-semibold">No blocking school relationship issues found.</div>';
    return;
  }
  attentionList.innerHTML=shown.map(item=>{
    const tone=item.severity==="integrity"?"text-rose-700 bg-rose-50":
      item.severity==="attention"?"text-amber-800 bg-amber-50":"text-slate-700 bg-slate-50";
    return '<div class="p-4 flex items-start justify-between gap-3">'+
      '<div class="min-w-0"><div class="flex items-center gap-2"><span class="rounded px-2 py-0.5 text-[10px] font-extrabold uppercase '+tone+'">'+
      escapeHTML(item.severity||"review")+'</span><strong class="text-sm">'+escapeHTML(item.label||"School record")+'</strong></div>'+
      '<p class="text-xs text-slate-600 mt-1">'+escapeHTML(item.detail||"")+'</p></div>'+
      '<a class="shrink-0 text-xs font-bold text-blue-700" href="'+attentionHref(item)+'">Fix</a></div>';
  }).join("");
}
function recordState(record){
  if(!record.finalization)return {label:"Not finalized",tone:"text-slate-600"};
  if(record.finalization.layoutChangedSinceFinalization)return {label:"Needs review",tone:"text-amber-700"};
  if(record.finalization.releasedRevision)return {label:"Released",tone:"text-emerald-700"};
  return {label:"Finalized",tone:"text-blue-700"};
}
function renderRecords(records){
  if(!records?.length){
    recordList.innerHTML='<div class="p-5 text-sm text-slate-500">No Class Records have been created yet.</div>';
    return;
  }
  const rows=records.slice(0,20).map(record=>{
    const state=recordState(record);
    return '<tr class="border-b border-slate-100">'+
      '<td class="px-4 py-3 text-sm font-semibold">'+escapeHTML(record.subjectName)+'</td>'+
      '<td class="px-4 py-3 text-sm">'+escapeHTML(record.sectionName)+'</td>'+
      '<td class="px-4 py-3 text-sm">'+escapeHTML((record.teacherNames||[]).join(", ")||"Unassigned")+'</td>'+
      '<td class="px-4 py-3 text-sm text-center">'+Number(record.activeColumnCount||0)+'</td>'+
      '<td class="px-4 py-3 text-sm font-bold '+state.tone+'">'+state.label+'</td>'+
      '</tr>';
  }).join("");
  recordList.innerHTML='<table class="min-w-full"><thead class="bg-slate-50 text-xs uppercase text-slate-500"><tr>'+
    '<th class="px-4 py-2 text-left">Subject</th><th class="px-4 py-2 text-left">Section</th>'+
    '<th class="px-4 py-2 text-left">Teacher</th><th class="px-4 py-2 text-center">Activities</th>'+
    '<th class="px-4 py-2 text-left">State</th></tr></thead><tbody>'+rows+'</tbody></table>';
}
async function loadDashboard(){
  const generation=++loadGeneration;
  status.textContent="Loading school operations…";
  attentionList.innerHTML='<div class="p-5 text-sm text-slate-500">Checking school relationships…</div>';
  recordList.innerHTML='<div class="p-5 text-sm text-slate-500">Loading Class Record state…</div>';
  const results=await Promise.allSettled([
    perform(peopleApi,"overview"),
    perform(peopleApi,"reconcile_directory"),
    perform(classRecordApi,"overview"),
    perform(supportApi,"overview")
  ]);
  if(generation!==loadGeneration)return;
  const [overviewResult,reconcileResult,recordsResult,supportResult]=results;
  const overview=overviewResult.status==="fulfilled"?overviewResult.value:null;
  const reconciliation=reconcileResult.status==="fulfilled"?reconcileResult.value:null;
  const records=recordsResult.status==="fulfilled"?(recordsResult.value.records||[]):[];
  const support=supportResult.status==="fulfilled"?supportResult.value:null;

  get("adminPeopleCount").textContent=overview?String(overview.counts?.people||0):"—";
  get("adminAttentionCount").textContent=reconciliation?String(reconciliation.counts?.total||0):"—";
  get("adminIntegrityMeta").textContent=reconciliation
    ?String(reconciliation.counts?.integrity||0)+" integrity · "+String(reconciliation.counts?.attention||0)+" attention"
    :"relationship checks unavailable";

  get("adminClassRecordCount").textContent=String(records.length);
  const finalized=records.filter(row=>row.finalization&&!row.finalization.layoutChangedSinceFinalization).length;
  const released=records.filter(row=>row.finalization?.releasedRevision).length;
  get("adminClassRecordMeta").textContent=finalized+" finalized · "+released+" released";

  get("adminReportCount").textContent=support?String(support.counts?.open||0):"—";
  get("adminSupportOpen").textContent=support?String(support.counts?.open||0):"—";
  get("adminSupportCritical").textContent=support?String(support.counts?.critical||0):"—";
  get("adminReportMeta").textContent=support&&support.counts?.critical
    ?support.counts.critical+" critical":"school support";

  renderAttention(reconciliation,records);
  renderRecords(records);

  const failed=results.filter(result=>result.status==="rejected");
  status.textContent=failed.length
    ?failed.length+" school operation source"+(failed.length===1?" is":"s are")+" temporarily unavailable."
    :"";
}

picker=createTenantSchoolPicker({
  host:get("sa-school-picker"),
  status,
  onBeforeChange:async()=>{loadGeneration++;},
  onReady:scope=>{
    if(!scope.current?.roles.includes("school_admin")){
      status.textContent="School administrator access required.";
      return;
    }
    void loadDashboard().catch(error=>{
      status.textContent=error?.message||"School operations could not be loaded.";
    });
  }
});
void picker.load().catch(error=>{
  status.textContent=error?.message||"School administration access could not be loaded.";
});
