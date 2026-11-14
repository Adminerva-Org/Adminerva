import {app} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs?v=4.0.0";

const el=id=>document.getElementById(id);
const api=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolClassRecordAdmin");
const list=el("cro-list"),status=el("cro-status"),search=el("cro-search"),filter=el("cro-filter");
const auditDialog=el("cro-audit-dialog"),auditList=el("cro-audit-list");
let picker=null,records=[],busy=false;

function node(tag,className,text){
  const item=document.createElement(tag);
  if(className)item.className=className;
  if(text!==undefined)item.textContent=String(text);
  return item;
}
function scoped(action,details={}){
  if(!picker?.scope.current)return Promise.reject(new Error("Choose a verified school first."));
  const lease=picker.scope.lease();
  return api({schoolId:lease.schoolId,action,...details}).then(response=>{
    picker.scope.assertLease(lease);
    return response.data;
  });
}
function when(value){
  const date=Number(value);
  if(!Number.isFinite(date)||date<=0)return "Time unavailable";
  return new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"}).format(new Date(date));
}
function scoreText(value){return value===null||value===undefined?"blank":String(value)}
function finalizationLabel(record){
  if(!record.finalization)return "Not finalized";
  const parts=["Finalized rev "+record.finalization.revision];
  if(record.finalization.releasedRevision)parts.push("Final Grade released rev "+record.finalization.releasedRevision);
  if(record.finalization.layoutChangedSinceFinalization)parts.push("layout changed afterward");
  return parts.join(" · ");
}
function visible(record){
  const terms=search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const haystack=[
    record.subjectName,record.sectionName,record.termName,record.yearName,record.programName,
    ...(record.teacherNames||[])
  ].join(" ").toLowerCase();
  if(!terms.every(term=>haystack.includes(term)))return false;
  if(filter.value==="not_finalized")return !record.finalization;
  if(filter.value==="finalized")return Boolean(record.finalization);
  if(filter.value==="released")return Boolean(record.finalization?.releasedRevision);
  if(filter.value==="layout_changed")return Boolean(record.finalization?.layoutChangedSinceFinalization);
  return true;
}
function renderSummary(){
  el("cro-total").textContent=records.length;
  el("cro-finalized").textContent=records.filter(row=>row.finalization).length;
  el("cro-released").textContent=records.filter(row=>row.finalization?.releasedRevision).length;
  el("cro-changed").textContent=records.filter(row=>row.finalization?.layoutChangedSinceFinalization).length;
}
function chip(text,kind=""){
  const c=node("span","cro-chip "+(kind==="released"?"border-emerald-200 bg-emerald-50 text-emerald-800":
    kind==="warning"?"border-amber-200 bg-amber-50 text-amber-900":""),text);
  return c;
}
function renderRecords(){
  renderSummary();list.replaceChildren();
  const rows=records.filter(visible);
  if(!rows.length){
    list.append(node("p","text-sm text-slate-600 py-8 text-center md:col-span-2",
      records.length?"No Class Records match the current filters.":"No Class Records have been created for this school yet."));
    return;
  }
  for(const record of rows){
    const card=node("article","cro-card");
    const top=node("div","flex items-start justify-between gap-3");
    const info=node("div","min-w-0");
    info.append(node("h3","font-extrabold text-slate-900",record.subjectName+" · "+record.sectionName));
    info.append(node("p","text-sm text-slate-600 mt-1",[record.termName,record.yearName,record.programName].filter(Boolean).join(" · ")));
    info.append(node("p","text-xs text-slate-500 mt-2",
      (record.teacherNames?.length?record.teacherNames.join(", "):"No active assigned teacher")+" · sheet rev "+record.sheetRevision));
    top.append(info);
    if(record.finalization?.releasedRevision)top.append(chip("Released","released"));
    else if(record.finalization)top.append(chip("Finalized"));
    else top.append(chip("Working"));
    card.append(top);

    const metrics=node("div","flex flex-wrap gap-1.5 mt-3");
    metrics.append(
      chip(record.activeColumnCount+" active"),
      chip(record.releasedColumnCount+" student-visible",record.releasedColumnCount?"released":""),
      chip(record.manualColumnCount+" manual"),
      chip(record.assessmentColumnCount+" linked"),
      chip(record.archivedColumnCount+" archived")
    );
    card.append(metrics);
    const final=node("p","text-sm font-semibold mt-3 "+(record.finalization?.layoutChangedSinceFinalization?"text-amber-800":"text-slate-700"),
      finalizationLabel(record));
    card.append(final);
    if(record.updatedAt)card.append(node("p","text-xs text-slate-500 mt-1","Class Record updated "+when(record.updatedAt)));
    const actions=node("div","flex flex-wrap gap-2 mt-4");
    const audit=node("button","cro-btn primary","View audit history");audit.type="button";
    audit.addEventListener("click",()=>void openAudit(record));actions.append(audit);
    card.append(actions);list.append(card);
  }
}
function setBusy(value,message=""){
  busy=value;el("cro-refresh").disabled=value||!picker?.scope.current;
  if(message)status.textContent=message;
}
function layoutChangeText(change){
  if(change.type==="added")return change.columnLabel+" added"+
    (change.after?.studentVisibility==="released"?" and released to students":".");
  const pieces=[];
  const before=change.before||{},after=change.after||{};
  if(before.label!==after.label)pieces.push("label: "+(before.label||"—")+" → "+(after.label||"—"));
  if(before.category!==after.category)pieces.push("category: "+(before.category||"—")+" → "+(after.category||"—"));
  if(Boolean(before.archived)!==Boolean(after.archived))pieces.push(after.archived?"archived":"restored");
  if(before.studentVisibility!==after.studentVisibility)pieces.push(
    "student visibility: "+(before.studentVisibility||"hidden")+" → "+(after.studentVisibility||"hidden"));
  return change.columnLabel+(pieces.length?" · "+pieces.join(" · "):" updated");
}
function eventDetails(event){
  const host=node("div","mt-3 text-sm text-slate-700");
  if(event.action==="class_record_manual_scores_saved"){
    const details=node("details","rounded-lg border border-slate-200 bg-slate-50 p-3");
    const summary=node("summary","cursor-pointer font-bold",event.changes.length+" score change"+(event.changes.length===1?"":"s"));
    details.append(summary);
    const rows=node("div","grid gap-1.5 mt-2");
    for(const change of event.changes){
      rows.append(node("p","text-sm",change.personName+": "+scoreText(change.before)+" → "+scoreText(change.after)));
    }
    details.append(rows);host.append(details);
  }else if(event.action==="class_record_cell_status_saved"){
    host.append(node("p","",[
      event.personName||"Student",event.columnLabel||"Class Record column",
      (event.beforeStatus||"normal")+" → "+(event.afterStatus||"normal")
    ].join(" · ")));
  }else if(event.action==="class_record_layout_saved"){
    if(event.columnChanges?.length){
      const details=node("details","rounded-lg border border-slate-200 bg-slate-50 p-3");
      details.open=event.columnChanges.length<=4;
      details.append(node("summary","cursor-pointer font-bold",event.columnChanges.length+" field-level column change"+(event.columnChanges.length===1?"":"s")));
      const rows=node("div","grid gap-1.5 mt-2");
      for(const change of event.columnChanges)rows.append(node("p","text-sm",layoutChangeText(change)));
      details.append(rows);host.append(details);
    }else{
      host.append(node("p","text-slate-600",
        "Historical layout event · field-level differences were not stored for this older revision."));
    }
    const meta=node("div","flex flex-wrap gap-1.5 mt-2");
    if(event.activeColumnCount!==null)meta.append(chip(event.activeColumnCount+" active"));
    meta.append(chip(event.releasedColumnCount+" student-visible"),chip(event.archivedColumnCount+" archived"));
    host.append(meta);
    if(event.categoryWeights?.length){
      host.append(node("p","text-xs text-slate-500 mt-2",
        "Weights: "+event.categoryWeights.map(row=>row.category+" "+row.weight+"%").join(" · ")));
    }
  }else if(event.action==="class_record_period_finalized"){
    host.append(node("p","",("Frozen revision "+(event.revision||"—"))+
      (event.studentCount?" · "+event.studentCount+" students":"")+
      (event.sheetRevision?" · sheet rev "+event.sheetRevision:"")));
  }else if(event.action==="class_record_final_grade_released"){
    host.append(node("p","","Frozen Final Grade revision "+(event.revision||"—")+" released to students."));
  }else if(event.action==="class_record_final_grade_withdrawn"){
    host.append(node("p","","Student visibility withdrawn for frozen Final Grade revision "+(event.revision||"—")+"."));
  }else{
    host.append(node("p","text-slate-600","No additional structured details were stored for this event."));
  }
  return host;
}
function renderAudit(result){
  auditList.replaceChildren();
  el("cro-audit-context").textContent=[
    result.offering?.subjectName,result.offering?.sectionName,result.offering?.termName,result.offering?.yearName
  ].filter(Boolean).join(" · ");
  const events=result.events||[];
  if(!events.length){
    auditList.append(node("p","text-sm text-slate-600 py-8 text-center","No Class Record audit events have been recorded for this offering."));
    return;
  }
  for(const event of events){
    const card=node("article","cro-event");
    const top=node("div","flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2");
    const info=node("div");
    info.append(node("h3","font-extrabold text-slate-900",event.actionLabel));
    info.append(node("p","text-xs text-slate-500 mt-1",event.actorName+" · "+when(event.createdAt)));
    top.append(info);
    if(event.revision)top.append(chip("Revision "+event.revision));
    card.append(top,eventDetails(event));auditList.append(card);
  }
}
async function openAudit(record){
  if(busy)return;
  auditList.replaceChildren(node("p","text-sm text-slate-600 py-8 text-center","Loading Class Record audit history…"));
  el("cro-audit-status").textContent="";
  el("cro-audit-context").textContent=record.subjectName+" · "+record.sectionName;
  auditDialog.showModal();
  try{
    const result=await scoped("audit",{offeringId:record.offeringId});
    renderAudit(result);
    el("cro-audit-status").textContent=(result.events||[]).length+" audit event"+((result.events||[]).length===1?"":"s")+" loaded.";
  }catch(error){
    auditList.replaceChildren(node("p","text-sm text-rose-700 py-6",error?.message||"Audit history could not be loaded."));
  }
}
async function load(){
  setBusy(true,"Loading school Class Record oversight…");
  try{
    const result=await scoped("overview");
    records=result.records||[];
    renderRecords();
    status.textContent=records.length+" Class Record"+(records.length===1?"":"s")+" loaded. Oversight is read-only.";
  }catch(error){
    records=[];renderRecords();status.textContent=error?.message||"Class Record oversight could not be loaded.";
  }finally{setBusy(false);}
}

search.addEventListener("input",renderRecords);
filter.addEventListener("change",renderRecords);
el("cro-refresh").addEventListener("click",()=>void load());
el("cro-audit-close").addEventListener("click",()=>auditDialog.close());

picker=createTenantSchoolPicker({
  host:el("cro-school-switcher"),
  status,
  onBeforeChange:async()=>{
    records=[];renderRecords();auditList.replaceChildren();
    if(auditDialog.open)auditDialog.close();
  },
  onReady:scope=>{
    if(!scope.current?.roles.includes("school_admin")){
      records=[];renderRecords();
      status.textContent="School administrator access is required for Class Record oversight.";
      return;
    }
    void load();
  }
});
picker.load().catch(error=>{status.textContent=error?.message||"Verified school access is unavailable.";});
