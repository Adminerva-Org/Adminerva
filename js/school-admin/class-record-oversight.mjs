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
const deepLinkAssessment=String(deepLinkParams.get("assessmentId")||"").slice(0,128);
const deepLinkSection=String(deepLinkParams.get("originalSection")||"").slice(0,160);
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
    if(deepLinkAssessment&&!el("cro-legacy-id").value){
      el("cro-legacy-id").value=deepLinkAssessment;
      el("cro-legacy-section").value=deepLinkSection;
      if(records.some(row=>row.offeringId===deepLinkOfferingId))
        custodyOffering.value=deepLinkOfferingId;
    }
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
let verifiedCustody=null,custodyBusy=false,multiRecovery=null;
const custodyMatches=el("cro-legacy-matches");
let custodyGeneration=0;
function resetCustody(){
  ++custodyGeneration;verifiedCustody=null;multiRecovery=null;custodyApproval.hidden=true;custodyStatus.textContent="";
  custodyMatches.replaceChildren();custodyMatches.hidden=true;
  el("cro-legacy-approve").hidden=false;el("cro-legacy-revoke").hidden=false;
  el("cro-legacy-approve-many").hidden=true;
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
  for(const id of ["cro-legacy-id","cro-legacy-offering","cro-legacy-section","cro-legacy-title","cro-legacy-reason","cro-legacy-find-classes","cro-legacy-preview","cro-legacy-approve","cro-legacy-revoke","cro-legacy-approve-many"])
    el(id).disabled=value;
  for(const input of custodyMatches.querySelectorAll("input[type=checkbox]"))input.disabled=value;
  if(!value&&multiRecovery)syncMultiApproval();
  if(!value&&verifiedCustody&&!verifiedCustody.eligible)el("cro-legacy-approve").disabled=true;
}
function recoveryStatus(row){
  return ({already_approved:"Already recovered",existing_custody_review_required:"Existing custody requires review",overlapping_class_rosters:"Overlapping student identities",
    original_section_review_required:"Choose the original section manually",maximum_reconciliation_required:"Score maximum unresolved",
    identity_reconciliation_required:"Insufficient verified identities",original_submission_or_grade_not_found:"No original source records",
    verification_required:row.message||"Verification required",ready_for_school_admin_approval:"Ready to recover",
    active:"Recovered",failed:row.message||"Approval failed"})[row.status]||row.status||"Review required";
}
function selectedRecoveryClasses(){
  const selected=new Set([...custodyMatches.querySelectorAll("input:checked")].map(input=>input.value));
  return (multiRecovery?.candidates||[]).filter(row=>row.eligible&&selected.has(row.offeringId));
}
function syncMultiApproval(){
  const count=selectedRecoveryClasses().length,button=el("cro-legacy-approve-many");
  button.textContent="Approve selected classes ("+count+")";
  button.disabled=custodyBusy||count===0;
}
function renderRecoveryClasses(result){
  custodyMatches.replaceChildren();custodyMatches.hidden=false;
  for(const row of result.candidates){
    const item=node("div","rounded-lg border border-slate-200 p-3 flex flex-wrap items-center gap-3");
    if(row.eligible){
      const checkbox=node("input","w-5 h-5 shrink-0");
      checkbox.type="checkbox";checkbox.value=row.offeringId;
      checkbox.setAttribute("aria-label","Recover "+row.sectionName);
      checkbox.addEventListener("change",syncMultiApproval);item.append(checkbox);
    }
    const details=node("div","min-w-0 flex-1");
    details.append(node("p","font-bold",row.sectionName),
      node("p","text-sm text-slate-600",recoveryStatus(row)+
        (row.rosterCount!=null?" · "+row.verifiedStudentCount+"/"+row.rosterCount+" matched · "+row.originalSourceRecordCount+" source identities":"")));
    item.append(details);
    if(row.status==="active"||row.status==="already_approved"){
      const link=node("a","cro-btn","Class Record");
      link.href="class-record.html?"+new URLSearchParams({offering:row.offeringId}).toString();item.append(link);
      const review=node("a","cro-btn","Review & Grade");
      review.href="school-gradebook.html?"+new URLSearchParams({view:"review",task:"legacy:"+result.assessmentId+"@"+row.offeringId,offeringId:row.offeringId}).toString();item.append(review);
    }else if(row.status==="original_section_review_required"){
      const button=node("button","cro-btn","Verify manually");button.type="button";
      button.addEventListener("click",()=>{
        if(![...custodyOffering.options].some(option=>option.value===row.offeringId))
          custodyOffering.add(new Option(row.sectionName,row.offeringId));
        custodyOffering.value=row.offeringId;resetCustody();el("cro-legacy-section").focus();
      });item.append(button);
    }
    custodyMatches.append(item);
  }
  syncMultiApproval();
}
el("cro-legacy-find-classes").addEventListener("click",()=>void(async()=>{
  if(custodyBusy)return;
  if(!custodyForm.reportValidity())return;
  resetCustody();const generation=custodyGeneration;setCustodyBusy(true);
  custodyStatus.textContent="Matching original records to classes…";
  try{
    const result=await scoped("discover_legacy_custody_classes",custodyFields());
    if(generation!==custodyGeneration)return;
    multiRecovery=result;
    custodyStatus.textContent=(result.originalTitle||"Historical assessment")+" · "+result.candidates.filter(row=>row.eligible).length+" of "+result.candidates.length+" classes ready. Select classes to recover.";
    renderRecoveryClasses(result);
    custodyApproval.hidden=!result.candidates.some(row=>row.eligible);
    el("cro-legacy-approve").hidden=true;el("cro-legacy-revoke").hidden=true;el("cro-legacy-approve-many").hidden=false;
  }catch(error){if(generation===custodyGeneration)custodyStatus.textContent=error?.message||"Matching classes could not be loaded.";}
  finally{setCustodyBusy(false);}
})());
el("cro-legacy-approve-many").addEventListener("click",()=>void(async()=>{
  if(custodyBusy||!multiRecovery)return;
  const selected=selectedRecoveryClasses(),source=multiRecovery,reason=el("cro-legacy-reason").value.trim(),
    confirmTitle=el("cro-legacy-title").value.trim();
  if(!selected.length)return;
  if(confirmTitle!==source.originalTitle||reason.length<30){
    custodyStatus.textContent="Confirm the original title and enter the administrator reason (at least 30 characters).";return;
  }
  const generation=custodyGeneration,lease=picker.scope.lease();
  setCustodyBusy(true);let approved=0,failed=0;
  try{
    for(const row of selected){
      if(generation!==custodyGeneration)return;
      picker.scope.assertLease(lease);
      custodyStatus.textContent="Recovering "+row.sectionName+" ("+(approved+failed+1)+"/"+selected.length+")…";
      try{
        await scoped("approve_legacy_custody",{assessmentId:source.assessmentId,offeringId:row.offeringId,
          originalSection:row.originalSection,confirmTitle,reason});
        if(generation!==custodyGeneration)return;
        row.status="active";row.eligible=false;approved++;
      }catch(error){
        if(generation!==custodyGeneration)return;
        picker.scope.assertLease(lease);
        row.status="failed";row.message=error?.message||"Approval failed";row.eligible=false;failed++;
      }
    }
    custodyStatus.textContent=approved+" class(es) recovered · "+failed+" failed. Run matching again to retry or reconcile.";
    renderRecoveryClasses(source);custodyApproval.hidden=!source.candidates.some(row=>row.eligible);
  }catch(error){if(generation===custodyGeneration)custodyStatus.textContent=error?.message||"Recovery stopped; check existing approvals.";}
  finally{setCustodyBusy(false);}
})());
custodyForm.addEventListener("submit",event=>void (async()=>{
  event.preventDefault();
  if(custodyBusy)return;
  resetCustody();setCustodyBusy(true);
  custodyStatus.textContent="Verifying original assessment, Primary Teacher assignment and preserved student identities…";
  try{
    const result=await scoped("preview_legacy_custody",custodyFields());
    verifiedCustody=result;custodyApproval.hidden=false;
    custodyStatus.textContent=(result.originalTitle||"Historical assessment")+" · "+
      (result.originalSection||"No original section — matched by assessment student IDs")+" · "+result.verifiedStudentCount+" / "+result.rosterCount+
      " student identities verified (minimum "+result.requiredStudentCount+"). "+
      result.originalSourceRecordCount+" original submitted-evidence or grade record(s) matched. "+
      (result.originalMaxScore!=null?"Maximum "+result.originalMaxScore+(result.maximumProof==="consistent_original_grade_maxima"?" (verified from saved grades). ":" (original assessment). "):"Maximum score unresolved. ")+
      (result.eligible?"Ready for School Administrator approval.":
        result.status==="maximum_reconciliation_required"?"Not eligible: reconcile original maximum scores.":"Not eligible: reconcile the class identities and confirm the original assessment has real submissions or grades.");
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
