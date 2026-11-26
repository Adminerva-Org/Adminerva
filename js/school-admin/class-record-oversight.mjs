import {app} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs?v=4.0.0";

const el=id=>document.getElementById(id);
const api=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolClassRecordAdmin");
const list=el("cro-list"),status=el("cro-status"),search=el("cro-search"),filter=el("cro-filter");
const auditDialog=el("cro-audit-dialog"),auditList=el("cro-audit-list");
let picker=null,records=null,busy=false;
let overviewRequest=0,auditRequest=0;
const deepLinkParams=new URLSearchParams(location.search);
const deepLinkOfferingId=String(deepLinkParams.get("offeringId")||"");
const deepLinkAudit=deepLinkParams.get("audit")==="1";
let deepLinkHandled=false;

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
  if(filter.value==="policy_issue")return ["missing","ambiguous"].includes(record.gradingPolicy?.state);
  return true;
}
function renderSummary(){
  if(records===null){
    for(const id of ["cro-total","cro-finalized","cro-released","cro-changed","cro-policy-issues"])el(id).textContent="—";
    return;
  }
  el("cro-total").textContent=records.length;
  el("cro-finalized").textContent=records.filter(row=>row.finalization).length;
  el("cro-released").textContent=records.filter(row=>row.finalization?.releasedRevision).length;
  el("cro-changed").textContent=records.filter(row=>row.finalization?.layoutChangedSinceFinalization).length;
  el("cro-policy-issues").textContent=records.filter(row=>["missing","ambiguous"].includes(row.gradingPolicy?.state)).length;
}
function chip(text,kind=""){
  const c=node("span","cro-chip "+(kind==="released"?"border-emerald-200 bg-emerald-50 text-emerald-800":
    kind==="warning"?"border-amber-200 bg-amber-50 text-amber-900":""),text);
  return c;
}
function renderRecords(){
  renderSummary();list.replaceChildren();
  if(records===null)return;
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
    const policy=record.gradingPolicy||{state:"missing",label:"No grading policy"};
    metrics.append(chip(policy.state==="resolved"?"Policy · "+policy.label:
      policy.state==="ambiguous"?"Grading policy conflict":"No grading policy",
      policy.state==="resolved"?"released":"warning"));
    card.append(metrics);
    const final=node("p","text-sm font-semibold mt-3 "+(record.finalization?.layoutChangedSinceFinalization?"text-amber-800":"text-slate-700"),
      finalizationLabel(record));
    card.append(final);
    if(record.updatedAt)card.append(node("p","text-xs text-slate-500 mt-1","Class Record updated "+when(record.updatedAt)));
    const actions=node("div","flex flex-wrap gap-2 mt-4");
    const audit=node("button","cro-btn primary","View audit history");audit.type="button";
    audit.addEventListener("click",()=>void openAudit(record));actions.append(audit);
    if(["missing","ambiguous"].includes(record.gradingPolicy?.state)){
      const policyLink=node("a","cro-btn","Fix grading policy");
      policyLink.href="school-grading-schemes.html";
      policyLink.textContent=record.gradingPolicy.state==="ambiguous"?"Resolve policy conflict":"Add matching policy";
      actions.append(policyLink);
    }
    card.append(actions);list.append(card);
  }
}
function setBusy(value,message=""){
  busy=value;el("cro-refresh").disabled=value||!picker?.scope.current?.roles.includes("school_admin");
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
  if(busy||!records?.includes(record))return;
  const request=++auditRequest;
  auditList.replaceChildren(node("p","text-sm text-slate-600 py-8 text-center","Loading Class Record audit history…"));
  el("cro-audit-status").textContent="";
  el("cro-audit-context").textContent=record.subjectName+" · "+record.sectionName;
  auditDialog.showModal();
  try{
    const result=await scoped("audit",{offeringId:record.offeringId});
    if(request!==auditRequest||!auditDialog.open)return;
    renderAudit(result);
    el("cro-audit-status").textContent=(result.events||[]).length+" audit event"+((result.events||[]).length===1?"":"s")+" loaded.";
  }catch(error){
    if(request!==auditRequest||!auditDialog.open)return;
    auditList.replaceChildren(node("p","text-sm text-rose-700 py-6",error?.message||"Audit history could not be loaded."));
  }
}
async function load(){
  if(!picker?.scope.current?.roles.includes("school_admin"))return;
  const request=++overviewRequest;
  setBusy(true,"Loading school Class Record oversight…");
  let deepLinkRecord=null;
  try{
    const result=await scoped("overview");
    if(request!==overviewRequest)return;
    records=result.records||[];
    showCustodyOfferings();
    renderRecords();
    status.textContent=records.length+" Class Record"+(records.length===1?"":"s")+" loaded. Oversight is read-only.";
    if(!deepLinkHandled&&deepLinkOfferingId){
      deepLinkRecord=records.find(record=>record.offeringId===deepLinkOfferingId)||null;
      deepLinkHandled=true;
      if(!deepLinkRecord)status.textContent="The requested Class Record is not available in this verified school.";
    }
  }catch(error){
    if(request!==overviewRequest)return;
    records=null;renderRecords();status.textContent=error?.message||"Class Record oversight could not be loaded.";
  }finally{if(request===overviewRequest)setBusy(false);}
  if(request===overviewRequest&&deepLinkRecord){
    search.value=[deepLinkRecord.subjectName,deepLinkRecord.sectionName].filter(Boolean).join(" ");
    renderRecords();
    if(deepLinkAudit)void openAudit(deepLinkRecord);
  }
}

const custodyForm=el("cro-legacy-form"),custodyOffering=el("cro-legacy-offering");
const custodyStatus=el("cro-legacy-result"),custodyApproval=el("cro-legacy-approval");
let verifiedCustody=null,custodyBusy=false;
function resetCustody(){
  verifiedCustody=null;custodyApproval.hidden=true;custodyStatus.textContent="";
  el("cro-legacy-title").value="";el("cro-legacy-reason").value="";
}
function showCustodyOfferings(){
  const previous=custodyOffering.value;
  custodyOffering.replaceChildren(new Option("Choose an offering…",""));
  const shown=new Set();
  for(const row of records||[]){
    if(!row.offeringId||shown.has(row.offeringId))continue;
    shown.add(row.offeringId);
    custodyOffering.add(new Option([row.subjectName,row.sectionName,row.termName,row.yearName]
      .filter(Boolean).join(" · "),row.offeringId));
  }
  custodyOffering.value=shown.has(previous)?previous:"";
}
function custodyFields(){
  return {assessmentId:el("cro-legacy-id").value.trim(),
    offeringId:custodyOffering.value,originalSection:el("cro-legacy-section").value.trim()};
}
function setCustodyBusy(value){
  custodyBusy=value;
  for(const id of ["cro-legacy-preview","cro-legacy-approve","cro-legacy-revoke"])
    el(id).disabled=value;
}
custodyForm.addEventListener("submit",event=>void (async()=>{
  event.preventDefault();
  if(custodyBusy)return;
  resetCustody();setCustodyBusy(true);
  custodyStatus.textContent="Verifying original assessment, Primary Teacher assignment and preserved student identities…";
  try{
    const result=await scoped("preview_legacy_custody",custodyFields());
    verifiedCustody=result;custodyApproval.hidden=false;
    custodyStatus.textContent=(result.originalTitle||"Historical assessment")+" · "+
      result.originalSection+" · "+result.verifiedStudentCount+" / "+result.rosterCount+
      " student identities verified (minimum "+result.requiredStudentCount+"). "+
      (result.eligible?"Ready for a different School Administrator to approve custody.":
        "Not eligible: reconcile the official class roster and original identities first.");
    el("cro-legacy-approve").disabled=!result.eligible;
  }catch(error){custodyStatus.textContent=error?.message||"Historical source could not be verified.";}
  finally{setCustodyBusy(false);if(verifiedCustody&&!verifiedCustody.eligible)
    el("cro-legacy-approve").disabled=true;}
})());
el("cro-legacy-approve").addEventListener("click",()=>void (async()=>{
  if(custodyBusy||!verifiedCustody?.eligible)return;
  const reason=el("cro-legacy-reason").value.trim();
  if(el("cro-legacy-title").value.trim()!==verifiedCustody.originalTitle||
     reason.length<30){custodyStatus.textContent="Type the exact original title and a detailed school-administrator justification (at least 30 characters).";return;}
  setCustodyBusy(true);
  try{
    await scoped("approve_legacy_custody",{
      ...custodyFields(),confirmTitle:el("cro-legacy-title").value.trim(),reason
    });
    custodyStatus.textContent="Approved for the verified Primary Teacher. Open V4 Review & Grade or Class Record for this offering. Original scores and evidence were not copied.";
    verifiedCustody=null;custodyApproval.hidden=true;
  }catch(error){custodyStatus.textContent=error?.message||"Custody approval failed.";}
  finally{setCustodyBusy(false);}
})());
el("cro-legacy-revoke").addEventListener("click",()=>void (async()=>{
  if(custodyBusy||!verifiedCustody)return;
  const reason=el("cro-legacy-reason").value.trim();
  if(reason.length<20){custodyStatus.textContent="Explain why this existing custody link must be revoked (at least 20 characters).";return;}
  setCustodyBusy(true);
  try{
    await scoped("revoke_legacy_custody",{...custodyFields(),reason});
    custodyStatus.textContent="Legacy custody revoked. The original assessment and student scores remain unchanged.";
    verifiedCustody=null;custodyApproval.hidden=true;
  }catch(error){custodyStatus.textContent=error?.message||"Custody revocation failed.";}
  finally{setCustodyBusy(false);}
})());
el("cro-legacy-id").addEventListener("input",resetCustody);
el("cro-legacy-section").addEventListener("input",resetCustody);
custodyOffering.addEventListener("change",resetCustody);

search.addEventListener("input",renderRecords);
filter.addEventListener("change",renderRecords);
el("cro-refresh").addEventListener("click",()=>void load());
el("cro-audit-close").addEventListener("click",()=>{++auditRequest;auditDialog.close();});

picker=createTenantSchoolPicker({
  host:el("cro-school-switcher"),
  status,
  onBeforeChange:async()=>{
    ++overviewRequest;++auditRequest;
    setBusy(true);
    records=null;deepLinkHandled=false;search.value="";filter.value="all";renderRecords();auditList.replaceChildren();
    resetCustody();custodyOffering.replaceChildren(new Option("Choose an offering…",""));
    el("cro-audit-context").textContent="";el("cro-audit-status").textContent="";
    if(auditDialog.open)auditDialog.close();
  },
  onReady:scope=>{
    if(!scope.current?.roles.includes("school_admin")){
      records=null;renderRecords();setBusy(false);
      status.textContent="School administrator access is required for Class Record oversight.";
      return;
    }
    void load();
  }
});
picker.load().catch(error=>{status.textContent=error?.message||"Verified school access is unavailable.";});
