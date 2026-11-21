import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs";

const get=id=>document.getElementById(id);
const endTypeLabel=value=>({
  withdrawal:"Withdrawal",transfer_out:"Transfer out",
  registration_cancelled:"Registration cancelled",progression:"Progression",other:"Other"
})[value]||"";
const progressionTypeLabel=value=>({
  promotion:"Promotion",retention:"Retention",graduation:"Graduation"
})[value]||"Progression";
const api=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolEnrollment");
const status=get("en-status"),workspace=get("en-workspace"),form=get("en-register-form");
const requestedPersonId=(()=>{try{
  const value=new URL(location.href).searchParams.get("personId")||"";
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)?value:"";
}catch{return "";}})();
let picker=null,catalog={years:[],programs:[],terms:[],sections:[],subjects:[],offerings:[]},
  saving=false,draftDirty=false,loadedApplication=null,loadedPerson=null,registrations=[],legacyRegistrations=[],
  registrationChange=null,legacyCleanup=null,progressionChange=null,cohortPreview=null;
const requestVersions={catalog:0,applications:0,registrations:0};
let refreshVersion=0,progressionPreviewRun=0,historyRun=0,cohortRun=0;

function assistMode(){
  try{return sessionStorage.getItem("Adminerva_platform_school_mode")==="assist"?"assist":"";}catch{return "";}
}
function perform(action,details={}){
  const lease=picker.scope.lease();
  return api({schoolId:lease.schoolId,action,...details,...(assistMode()?{platformMode:"assist"}:{})})
    .then(response=>{picker.scope.assertLease(lease);return response.data;});
}
async function latest(source,action){
  const version=++requestVersions[source];
  try{
    const result=await perform(action);
    return version===requestVersions[source]?result:null;
  }catch(error){
    if(version!==requestVersions[source])return null;
    throw error;
  }
}
function setSaving(value){
  saving=value;
  if(value){
    ++refreshVersion;
    for(const source of Object.keys(requestVersions))++requestVersions[source];
  }
  for(const control of form.elements)control.disabled=value;
  for(const control of document.querySelectorAll("#en-application-list button, #en-clear-application, #en-refresh, #en-refresh-applications, #en-registration-change-dialog button, #en-registration-change-form textarea, #en-registration-change-form select, #en-legacy-reconciliation-dialog button, #en-legacy-reconciliation-form textarea, #en-progression-dialog button, #en-progression-form textarea, #en-progression-form select, #en-cohort-form button, #en-cohort-form textarea, #en-cohort-form select"))
    control.disabled=value;
  updateCoursePreview();
  if(!value){
    if(progressionChange){
      refreshProgressionPlacement();
      const payload=progressionFormPayload();
      get("en-progression-confirm").disabled=!progressionChange.preview?.canApply||
        progressionChange.previewSignature!==progressionSignature(payload);
    }
    refreshCohortOptions();
    const cohortReady=cohortPreview?.rows?.some(row=>row.preview?.canApply&&!row.applied)&&
      cohortPreview.signature===cohortSignature();
    get("en-cohort-apply").disabled=!cohortReady;
  }
}
function discardDraft(){
  return !draftDirty||confirm("Discard the unsaved enrollment details for the current student?");
}
function blank(select,label){
  select.replaceChildren();
  const option=document.createElement("option");
  option.value="";option.textContent=label;option.disabled=true;option.selected=true;
  select.append(option);
}
function options(select,items,label){
  const previous=select.value;blank(select,label);
  for(const item of items){
    const option=document.createElement("option");
    option.value=item.id;option.textContent=item.name||item.id;select.append(option);
  }
  if(items.some(item=>item.id===previous))select.value=previous;
  else if(items.length===1)select.value=items[0].id;
}
function selected(name){return String(form.elements[name].value||"");}
function gradeRequiresStudentEmail(level){
  const raw=String(level||"").trim().toLowerCase();
  return raw==="sned_jhs"||(/^\d+$/.test(raw)&&Number(raw)>=7);
}
function levelLabel(level){
  const special={nursery_prep:"Nursery / Prep",kinder_1:"Kinder 1",kinder_2:"Kinder 2",sned_elem:"SNED · Elementary",sned_jhs:"SNED · Junior High"};
  return special[level]||(/^\d+$/.test(String(level||""))?"Grade "+level:(level||"Level not specified"));
}
function progressionGradeValid(type,sourceLevel,targetLevel){
  const source=String(sourceLevel||"").trim().toLowerCase(),
    target=String(targetLevel||"").trim().toLowerCase();
  if(type==="graduation")return true;
  if(!source||!target)return false;
  if(type==="retention")return source===target;
  if(type!=="promotion"||source===target)return false;
  if(/^\d+$/.test(source)&&/^\d+$/.test(target))return Number(target)===Number(source)+1;
  return true;
}
function dateLabel(value){
  if(!Number.isFinite(Number(value))||Number(value)<=0)return "";
  try{return new Date(Number(value)).toLocaleString(undefined,{year:"numeric",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});}
  catch{return "";}
}
function registrationHistoryState(row){
  if(row.progressionType)return progressionTypeLabel(row.progressionType);
  if(row.status==="ended"&&row.endReasonType)return endTypeLabel(row.endReasonType);
  return row.status==="active"?"Active registration":"Ended registration";
}
function currentSection(){
  return catalog.sections.find(row=>row.id===selected("sectionId"))||null;
}
function updateStudentEmailPolicy(){
  const section=currentSection(),required=gradeRequiresStudentEmail(section?.gradeLevel);
  get("en-student-email-panel").hidden=!required;
  get("en-guardian-account-panel").hidden=required;
  form.elements.studentEmail.required=required;
  form.elements.studentEmailType.required=required;
  if(section&&!required){
    form.elements.studentEmail.value="";
    form.elements.studentEmailType.value="personal";
  }
  return required;
}
function refreshPlacement(){
  const yearId=selected("yearId"),programId=selected("programId");
  const terms=catalog.terms.filter(row=>
    (!yearId||row.yearId===yearId)&&(!programId||row.programId===programId));
  let sections=catalog.sections.filter(row=>!programId||row.programId===programId);
  if(loadedApplication?.incomingLevel)
    sections=sections.filter(row=>String(row.gradeLevel||"")===String(loadedApplication.incomingLevel));
  options(form.elements.termId,terms,"Choose academic period");
  options(form.elements.sectionId,sections,"Choose section");
  updateCoursePreview();
}
function updateCoursePreview(){
  const yearId=selected("yearId"),programId=selected("programId"),
    termId=selected("termId"),sectionId=selected("sectionId");
  const section=currentSection(),required=updateStudentEmailPolicy();
  const matched=catalog.offerings.filter(row=>
    row.yearId===yearId&&row.programId===programId&&row.termId===termId&&row.sectionId===sectionId&&
    row.rosterMode!=="selective");
  const count=matched.length,grade=section?.gradeLevel?levelLabel(section.gradeLevel):"";
  const subjectNames=[...new Set(matched.map(row=>
    catalog.subjects.find(subject=>subject.id===row.subjectId)?.name||row.subjectId).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b));
  const subjectSummary=subjectNames.length>6
    ?subjectNames.slice(0,6).join(", ")+" +"+(subjectNames.length-6)+" more"
    :subjectNames.join(", ");
  get("en-course-preview").textContent=!yearId||!programId||!termId||!sectionId
    ?"Choose the academic placement to see exactly which active subjects will be enrolled."
    :count
      ?grade+" · "+count+" active subject"+(count===1?"":"s")+
        (subjectSummary?": "+subjectSummary:"")+" · "+
        (required?"student email required for Adminerva sign-in":"guardian-managed; student login not required")
      :"No active subject offerings match this placement. Configure the section subjects before enrolling students.";
  get("en-register-button").disabled=saving||count===0;
}
async function loadCatalog(){
  const result=await latest("catalog","catalog");
  if(!result)return false;
  catalog=result;
  catalog.subjects=catalog.subjects||[];
  options(form.elements.yearId,catalog.years||[],"Choose academic year");
  options(form.elements.programId,catalog.programs||[],"Choose program / division");
  const sectionFilter=get("en-registration-section"),previousSection=sectionFilter?.value||"";
  if(sectionFilter){
    sectionFilter.replaceChildren(new Option("All sections",""));
    for(const section of (catalog.sections||[]).slice().sort((a,b)=>a.name.localeCompare(b.name)))
      sectionFilter.append(new Option(section.name,section.id));
    if((catalog.sections||[]).some(row=>row.id===previousSection))sectionFilter.value=previousSection;
  }
  refreshPlacement();
  refreshCohortOptions();
  return true;
}
function registrationLabel(row){
  const year=catalog.years.find(x=>x.id===row.yearId)?.name||row.yearId;
  const program=catalog.programs.find(x=>x.id===row.programId)?.name||row.programId;
  const term=catalog.terms.find(x=>x.id===row.termId)?.name||row.termId;
  const section=catalog.sections.find(x=>x.id===row.sectionId)?.name||row.sectionId;
  return [year,program,term,section].filter(Boolean).join(" · ");
}
function renderRegistrations(){
  const host=get("en-registration-list");
  if(!host)return;
  host.replaceChildren();
  const query=String(get("en-registration-search")?.value||"").trim().toLocaleLowerCase("en");
  const sectionId=String(get("en-registration-section")?.value||"");
  const items=registrations.filter(item=>{
    if(sectionId&&item.sectionId!==sectionId)return false;
    if(!query)return true;
    return [item.displayName,item.studentNumber,registrationLabel(item)]
      .some(value=>String(value||"").toLocaleLowerCase("en").includes(query));
  });
  if(!items.length){
    const empty=document.createElement("p");empty.className="en-muted";
    empty.textContent=registrations.length
      ?"No registrations match the current student/section filter."
      :"No standard enrollment registrations yet.";
    host.append(empty);return;
  }
  for(const item of items){
    const row=document.createElement("article");row.className="en-row";row.setAttribute("role","listitem");
    const info=document.createElement("div"),name=document.createElement("strong"),meta=document.createElement("p");
    name.textContent=item.displayName;meta.className="en-muted";
    const identityState=item.accountResponsibility==="guardian"
      ?"guardian-managed · no student login required"
      :(item.accountLinked?"student account linked":"student activation pending");
    meta.textContent=registrationLabel(item)+" · "+item.courseCount+" subject"+(item.courseCount===1?"":"s")+
      (item.studentNumber?" · "+item.studentNumber:"")+" · "+identityState+" · "+(item.source==="online"?"online application":"onsite");
    info.append(name,meta);
    const actions=document.createElement("div");actions.style.cssText="display:flex;gap:.45rem;align-items:center;flex-wrap:wrap;justify-content:flex-end";
    const badge=document.createElement("span");badge.className="en-badge";badge.dataset.state=item.status||"active";
    badge.textContent=item.status==="ended"&&item.progressionType
      ?"ended · "+progressionTypeLabel(item.progressionType).toLowerCase()
      :item.status==="ended"&&item.endReasonType
        ?"ended · "+endTypeLabel(item.endReasonType).toLowerCase()
        :(item.status||"active");actions.append(badge);
    const identityLink=document.createElement("a");identityLink.className="en-btn secondary";identityLink.style.cssText="display:inline-flex;align-items:center;text-decoration:none";
    identityLink.textContent="Identity & access";identityLink.href="people-access.html?personId="+encodeURIComponent(item.personId)+"#people";actions.append(identityLink);
    const recordsLink=document.createElement("a");recordsLink.className="en-btn secondary";recordsLink.style.cssText="display:inline-flex;align-items:center;text-decoration:none";
    recordsLink.textContent="201 file";recordsLink.href="school-student-records.html?personId="+encodeURIComponent(item.personId);actions.append(recordsLink);
    const historyButton=document.createElement("button");historyButton.type="button";historyButton.className="en-btn secondary";historyButton.textContent="History";
    historyButton.addEventListener("click",()=>void openStudentHistory(item));actions.append(historyButton);
    if(item.status==="active"){
      const progress=document.createElement("button");progress.type="button";progress.className="en-btn";progress.textContent="Progress student";
      progress.addEventListener("click",()=>openProgression(item));actions.append(progress);
      const move=document.createElement("button");move.type="button";move.className="en-btn";move.textContent="Change section";
      move.addEventListener("click",()=>openRegistrationChange(item,"move"));actions.append(move);
      const end=document.createElement("button");end.type="button";end.className="en-btn secondary";end.textContent="End registration";
      end.addEventListener("click",()=>openRegistrationChange(item,"end"));actions.append(end);
    }else if(item.status==="ended"&&!item.progressionType){
      const restore=document.createElement("button");restore.type="button";restore.className="en-btn secondary";restore.textContent="Restore";
      restore.addEventListener("click",()=>openRegistrationChange(item,"restore"));actions.append(restore);
    }
    row.append(info,actions);host.append(row);
  }
}
function legacyPlacementLabel(item){
  const sections=(item.sectionIds||[]).map(id=>catalog.sections.find(row=>row.id===id)?.name||id),
    years=(item.yearIds||[]).map(id=>catalog.years.find(row=>row.id===id)?.name||id),
    terms=(item.termIds||[]).map(id=>catalog.terms.find(row=>row.id===id)?.name||id);
  return [...new Set([...years,...terms,...sections])].filter(Boolean).join(" · ");
}
function renderLegacyRegistrations(){
  const host=get("en-legacy-registration-list");
  if(!host)return;
  host.replaceChildren();
  const query=String(get("en-registration-search")?.value||"").trim().toLocaleLowerCase("en"),
    sectionId=String(get("en-registration-section")?.value||"");
  const items=legacyRegistrations.filter(item=>{
    if(sectionId&&!(item.sectionIds||[]).includes(sectionId))return false;
    if(!query)return true;
    return [item.displayName,item.studentNumber,legacyPlacementLabel(item)]
      .some(value=>String(value||"").toLocaleLowerCase("en").includes(query));
  });
  if(!items.length){
    const empty=document.createElement("p");empty.className="en-muted";
    empty.textContent=legacyRegistrations.length
      ?"No pre-canonical enrollment records match the current student/section filter."
      :"No pre-canonical active enrollments require reconciliation.";
    host.append(empty);return;
  }
  for(const item of items){
    const row=document.createElement("article");row.className="en-row";row.setAttribute("role","listitem");
    const info=document.createElement("div"),name=document.createElement("strong"),meta=document.createElement("p");
    name.textContent=item.displayName;meta.className="en-muted";
    meta.textContent=(legacyPlacementLabel(item)||"Older class placement")+" · "+item.courseCount+
      " active legacy class enrollment"+(item.courseCount===1?"":"s")+
      (item.studentNumber?" · "+item.studentNumber:"");
    info.append(name,meta);
    if(item.hasRegistrationLinkedEnrollment){
      const warning=document.createElement("p");warning.className="en-muted";
      warning.textContent="Some active class records reference registration history and require manual review.";
      info.append(warning);
    }
    const actions=document.createElement("div");actions.style.cssText="display:flex;gap:.45rem;align-items:center;flex-wrap:wrap;justify-content:flex-end";
    const badge=document.createElement("span");badge.className="en-badge";badge.dataset.state="ended";
    badge.textContent="pre-canonical";actions.append(badge);
    const button=document.createElement("button");button.type="button";button.className="en-btn secondary";
    button.textContent="Reconcile";
    button.disabled=item.personStatus!=="active"||item.hasRegistrationLinkedEnrollment;
    button.addEventListener("click",()=>openLegacyReconciliation(item));
    actions.append(button);
    row.append(info,actions);host.append(row);
  }
}
async function loadRegistrations(){
  const result=await latest("registrations","list_registrations");
  if(!result)return;
  registrations=(result.items||[]).slice().sort((a,b)=>
    registrationLabel(a).localeCompare(registrationLabel(b))||a.displayName.localeCompare(b.displayName));
  legacyRegistrations=(result.legacyItems||[]).slice().sort((a,b)=>a.displayName.localeCompare(b.displayName));
  renderRegistrations();renderLegacyRegistrations();
  if(cohortPreview){
    ++cohortRun;cohortPreview=null;get("en-cohort-apply").disabled=true;
    get("en-cohort-results").replaceChildren();
    get("en-cohort-status").textContent="Registration data changed. Preview the cohort again before applying year-end progression.";
  }
}
function historyEventLabel(action){
  return {
    student_registered_and_enrolled:"Registered and enrolled",
    student_registration_section_changed:"Section placement changed",
    student_registration_ended:"Registration ended",
    student_registration_restored:"Registration restored",
    student_registration_progressed:"Academic progression recorded"
  }[action]||String(action||"Registration change").replaceAll("_"," ");
}
async function openStudentHistory(item){
  if(saving)return;
  const run=++historyRun,dialog=get("en-history-dialog"),host=get("en-history-list"),
    eventsHost=get("en-history-events"),message=get("en-history-status");
  host.replaceChildren();eventsHost.replaceChildren();
  get("en-history-target").textContent=item.displayName+(item.studentNumber?" · "+item.studentNumber:"");
  message.textContent="Loading canonical registration and placement history…";dialog.showModal();
  try{
    const result=await perform("student_history",{personId:item.personId});
    if(run!==historyRun||!dialog.open)return;
    message.textContent=result.registrations.length+" registration record"+(result.registrations.length===1?"":"s")+
      " · "+result.activeRegistrationCount+" active official placement"+(result.activeRegistrationCount===1?"":"s")+".";
    for(const record of result.registrations){
      const card=document.createElement("article");card.className="en-row";card.setAttribute("role","listitem");
      const info=document.createElement("div"),title=document.createElement("strong"),meta=document.createElement("p");
      title.textContent=registrationLabel(record);meta.className="en-muted";
      const dates=[
        record.createdAt?"created "+dateLabel(record.createdAt):"",
        record.progressedAt?"progressed "+dateLabel(record.progressedAt):"",
        record.endedAt?"ended "+dateLabel(record.endedAt):"",
        record.restoredAt?"restored "+dateLabel(record.restoredAt):""
      ].filter(Boolean);
      meta.textContent=[levelLabel(record.gradeLevel),registrationHistoryState(record),
        record.courseCount+" subject"+(record.courseCount===1?"":"s"),...dates].filter(Boolean).join(" · ");
      info.append(title,meta);
      if(record.previousRegistrationId||record.progressedToRegistrationId){
        const chain=document.createElement("p");chain.className="en-muted";
        chain.textContent=(record.previousRegistrationId?"Continues prior registration":"")+
          (record.previousRegistrationId&&record.progressedToRegistrationId?" · ":"")+
          (record.progressedToRegistrationId?"Progressed to a later registration":"");
        info.append(chain);
      }
      card.append(info);host.append(card);
    }
    if(!result.registrations.length){
      const empty=document.createElement("p");empty.className="en-muted";empty.textContent="No registration history found.";host.append(empty);
    }
    for(const event of result.events||[]){
      const card=document.createElement("article");card.className="en-row";
      const info=document.createElement("div"),title=document.createElement("strong"),meta=document.createElement("p");
      title.textContent=historyEventLabel(event.action);meta.className="en-muted";
      meta.textContent=[event.progressionType?progressionTypeLabel(event.progressionType):"",
        event.endReasonType?endTypeLabel(event.endReasonType):"",dateLabel(event.createdAt)].filter(Boolean).join(" · ");
      info.append(title,meta);
      if(event.reason){const reason=document.createElement("p");reason.className="en-muted";reason.textContent=event.reason;info.append(reason);}
      card.append(info);eventsHost.append(card);
    }
    if(!(result.events||[]).length){
      const empty=document.createElement("p");empty.className="en-muted";empty.textContent="No registrar lifecycle audit events for these registrations.";eventsHost.append(empty);
    }
  }catch(error){
    if(run!==historyRun||!dialog.open)return;
    message.textContent=error?.message||"Student placement history could not be loaded.";
  }
}
function closeStudentHistory(){
  ++historyRun;if(get("en-history-dialog").open)get("en-history-dialog").close();
}
get("en-history-close").addEventListener("click",closeStudentHistory);
get("en-history-dialog").addEventListener("cancel",()=>{++historyRun;});

function cohortForm(){return get("en-cohort-form");}
function cohortRows(){
  const form=cohortForm(),yearId=String(form.elements.sourceYearId.value||""),
    termId=String(form.elements.sourceTermId.value||""),
    sectionId=String(form.elements.sourceSectionId.value||"");
  return registrations.filter(row=>row.status==="active"&&row.yearId===yearId&&
    row.termId===termId&&row.sectionId===sectionId);
}
function cohortSelection(){
  const form=cohortForm(),type=String(form.elements.progressionType.value||"");
  return {
    sourceYearId:String(form.elements.sourceYearId.value||""),
    sourceTermId:String(form.elements.sourceTermId.value||""),
    sourceSectionId:String(form.elements.sourceSectionId.value||""),
    progressionType:type,
    ...(type&&type!=="graduation"?{
      targetYearId:String(form.elements.targetYearId.value||""),
      targetProgramId:String(form.elements.targetProgramId.value||""),
      targetTermId:String(form.elements.targetTermId.value||""),
      targetSectionId:String(form.elements.targetSectionId.value||"")
    }:{})
  };
}
function cohortSignature(selection=cohortSelection()){
  return JSON.stringify(selection);
}
function invalidateCohortPreview(message="Selection changed. Preview the cohort again."){
  ++cohortRun;cohortPreview=null;get("en-cohort-apply").disabled=true;
  get("en-cohort-results").replaceChildren();
  if(message)get("en-cohort-status").textContent=message;
}
function refreshCohortOptions(){
  const form=cohortForm();
  if(!form?.elements?.sourceYearId)return;
  const sourceYear=form.elements.sourceYearId,sourceTerm=form.elements.sourceTermId,
    sourceSection=form.elements.sourceSectionId,type=String(form.elements.progressionType.value||""),
    priorSource={year:sourceYear.value,term:sourceTerm.value,section:sourceSection.value};
  options(sourceYear,catalog.years||[],"Choose source academic year");
  if((catalog.years||[]).some(row=>row.id===priorSource.year))sourceYear.value=priorSource.year;
  const sourceTerms=(catalog.terms||[]).filter(row=>!sourceYear.value||row.yearId===sourceYear.value);
  options(sourceTerm,sourceTerms,"Choose source academic period");
  if(sourceTerms.some(row=>row.id===priorSource.term))sourceTerm.value=priorSource.term;
  options(sourceSection,catalog.sections||[],"Choose source section");
  if((catalog.sections||[]).some(row=>row.id===priorSource.section))sourceSection.value=priorSource.section;

  const targetMode=type==="promotion"||type==="retention",targetBox=get("en-cohort-target");
  targetBox.hidden=!targetMode;
  for(const name of ["targetYearId","targetProgramId","targetTermId","targetSectionId"]){
    form.elements[name].required=targetMode;form.elements[name].disabled=!targetMode;
  }
  if(!targetMode){
    for(const name of ["targetYearId","targetProgramId","targetTermId","targetSectionId"])form.elements[name].value="";
    return;
  }
  const sourceSectionRow=(catalog.sections||[]).find(row=>row.id===sourceSection.value)||null,
    targetYear=form.elements.targetYearId,targetProgram=form.elements.targetProgramId,
    targetTerm=form.elements.targetTermId,targetSection=form.elements.targetSectionId,
    prior={year:targetYear.value,program:targetProgram.value,term:targetTerm.value,section:targetSection.value},
    years=(catalog.years||[]).filter(row=>row.id!==sourceYear.value);
  options(targetYear,years,"Choose target academic year");
  if(years.some(row=>row.id===prior.year))targetYear.value=prior.year;
  options(targetProgram,catalog.programs||[],"Choose target program / division");
  if((catalog.programs||[]).some(row=>row.id===prior.program))targetProgram.value=prior.program;
  else if(sourceSectionRow&&(catalog.programs||[]).some(row=>row.id===sourceSectionRow.programId))
    targetProgram.value=sourceSectionRow.programId;
  const targetTerms=(catalog.terms||[]).filter(row=>
    (!targetYear.value||row.yearId===targetYear.value)&&(!targetProgram.value||row.programId===targetProgram.value));
  options(targetTerm,targetTerms,"Choose target academic period");
  if(targetTerms.some(row=>row.id===prior.term))targetTerm.value=prior.term;
  const targetSections=(catalog.sections||[]).filter(row=>
    (!targetProgram.value||row.programId===targetProgram.value)&&
    progressionGradeValid(type,sourceSectionRow?.gradeLevel,row.gradeLevel));
  options(targetSection,targetSections,"Choose target section");
  if(targetSections.some(row=>row.id===prior.section))targetSection.value=prior.section;
}
async function mapLimit(items,limit,worker){
  const results=new Array(items.length);let cursor=0;
  async function run(){
    while(cursor<items.length){
      const index=cursor++;results[index]=await worker(items[index],index);
    }
  }
  await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>run()));
  return results;
}
function renderCohortResults(rows){
  const host=get("en-cohort-results");host.replaceChildren();
  for(const row of rows){
    const card=document.createElement("article");card.className="en-row";card.setAttribute("role","listitem");
    const info=document.createElement("div"),name=document.createElement("strong"),meta=document.createElement("p");
    name.textContent=row.item.displayName;meta.className="en-muted";
    const state=row.applied?"Applied":row.applyError?"Apply failed":row.preview?.canApply?"Ready":"Blocked";
    meta.textContent=[levelLabel(row.item.gradeLevel),state,
      row.preview?.completion?.length?row.preview.completion.filter(item=>item.ready).length+"/"+row.preview.completion.length+" Final Grades ready":""]
      .filter(Boolean).join(" · ");
    info.append(name,meta);
    const issues=row.preview?.blockers||[];
    if(issues.length){
      const detail=document.createElement("p");detail.className="en-muted";
      detail.textContent=issues.slice(0,3).map(issue=>{
        const subject=issue.subjectId?catalog.subjects.find(item=>item.id===issue.subjectId)?.name:"";
        return (subject?subject+": ":"")+(issue.message||"Requires review");
      }).join(" • ")+(issues.length>3?" • +"+(issues.length-3)+" more":"");
      info.append(detail);
    }
    if(row.applyError){const error=document.createElement("p");error.className="en-muted";error.textContent=row.applyError;info.append(error);}
    card.append(info);host.append(card);
  }
}
async function previewCohort(){
  if(saving)return;
  const form=cohortForm(),selection=cohortSelection(),message=get("en-cohort-status");
  if(!selection.sourceYearId||!selection.sourceTermId||!selection.sourceSectionId){
    message.textContent="Choose the complete source cohort before previewing.";return;
  }
  if(!selection.progressionType){message.textContent="Choose Promotion, Retention or Graduation.";return;}
  if(selection.progressionType!=="graduation"&&
    (!selection.targetYearId||!selection.targetProgramId||!selection.targetTermId||!selection.targetSectionId)){
    message.textContent="Choose the complete target placement before previewing the cohort.";return;
  }
  const candidates=cohortRows();
  if(!candidates.length){invalidateCohortPreview("No active registrations match the selected source cohort.");return;}
  if(candidates.length>60){invalidateCohortPreview("This cohort exceeds 60 active registrations and requires paginated Registrar processing.");return;}
  const run=++cohortRun,signature=cohortSignature(selection);
  cohortPreview=null;get("en-cohort-apply").disabled=true;get("en-cohort-results").replaceChildren();
  message.textContent="Checking "+candidates.length+" learner"+(candidates.length===1?"":"s")+" against released Final Grades and target placement…";
  const rows=await mapLimit(candidates,4,async item=>{
    const payload={
      registrationId:item.registrationId,expectedRevision:Number(item.revision)||1,
      progressionType:selection.progressionType,
      ...(selection.progressionType!=="graduation"?{
        targetYearId:selection.targetYearId,targetProgramId:selection.targetProgramId,
        targetTermId:selection.targetTermId,targetSectionId:selection.targetSectionId
      }:{})
    };
    try{return {item,payload,preview:await perform("preview_progression",payload)};}
    catch(error){return {item,payload,preview:{canApply:false,blockers:[{message:error?.message||"Readiness check failed."}]}};}
  });
  if(run!==cohortRun)return;
  const ready=rows.filter(row=>row.preview?.canApply).length;
  cohortPreview={signature,rows};renderCohortResults(rows);
  get("en-cohort-apply").disabled=ready===0;
  message.textContent=ready+" ready · "+(rows.length-ready)+" blocked · "+rows.length+" learner"+(rows.length===1?"":"s")+" reviewed.";
}
get("en-cohort-preview").addEventListener("click",()=>void previewCohort());
for(const name of ["sourceYearId","sourceTermId","sourceSectionId","progressionType","targetYearId","targetProgramId","targetTermId","targetSectionId"]){
  cohortForm().elements[name].addEventListener("change",()=>{
    if(["sourceYearId","sourceSectionId","progressionType","targetYearId","targetProgramId"].includes(name))
      refreshCohortOptions();
    invalidateCohortPreview();
  });
}
get("en-cohort-apply").addEventListener("click",()=>{
  if(saving||!cohortPreview)return;
  const form=cohortForm(),selection=cohortSelection(),reason=String(new FormData(form).get("reason")||"").trim();
  if(!form.reportValidity())return;
  if(cohortPreview.signature!==cohortSignature(selection)){
    invalidateCohortPreview("The cohort selection changed. Preview again before applying progression.");return;
  }
  const ready=cohortPreview.rows.filter(row=>row.preview?.canApply&&!row.applied);
  if(!ready.length)return;
  if(!confirm("Apply "+progressionTypeLabel(selection.progressionType).toLowerCase()+" to "+ready.length+
    " ready learner"+(ready.length===1?"":"s")+"? Each registration will be committed and audited independently; blocked learners will remain unchanged."))return;
  void (async()=>{
    setSaving(true);const message=get("en-cohort-status");let applied=0,failed=0;
    try{
      for(let index=0;index<ready.length;index++){
        const row=ready[index];
        message.textContent="Applying "+(index+1)+" of "+ready.length+" · "+row.item.displayName+"…";
        try{
          await perform("progress_registration",{...row.payload,reason});row.applied=true;applied++;
        }catch(error){row.applyError=error?.message||"Progression failed.";failed++;}
        renderCohortResults(cohortPreview.rows);
      }
      await loadRegistrations();
      get("en-cohort-apply").disabled=true;
      message.textContent=applied+" progression"+(applied===1?"":"s")+" applied · "+failed+
        " failed after final server revalidation · blocked learners were unchanged.";
    }finally{setSaving(false);get("en-cohort-apply").disabled=true;}
  })();
});
function automaticOfferings(item,sectionId){
  return catalog.offerings.filter(row=>row.yearId===item.yearId&&row.programId===item.programId&&
    row.termId===item.termId&&row.sectionId===sectionId&&row.rosterMode!=="selective");
}
function progressionFormPayload(){
  if(!progressionChange)return null;
  const pform=get("en-progression-form"),type=String(pform.elements.progressionType.value||"");
  return {
    registrationId:progressionChange.item.registrationId,
    expectedRevision:Number(progressionChange.item.revision)||1,
    progressionType:type,
    ...(type&&type!=="graduation"?{
      targetYearId:String(pform.elements.targetYearId.value||""),
      targetProgramId:String(pform.elements.targetProgramId.value||""),
      targetTermId:String(pform.elements.targetTermId.value||""),
      targetSectionId:String(pform.elements.targetSectionId.value||"")
    }:{})
  };
}
function progressionSignature(payload=progressionFormPayload()){
  return payload?JSON.stringify(payload):"";
}
function refreshProgressionPlacement(){
  if(!progressionChange)return;
  const pform=get("en-progression-form"),type=String(pform.elements.progressionType.value||""),
    placement=get("en-progression-placement"),source=progressionChange.item,
    targetMode=type==="promotion"||type==="retention";
  placement.hidden=!targetMode;
  for(const name of ["targetYearId","targetProgramId","targetTermId","targetSectionId"]){
    pform.elements[name].required=targetMode;
    pform.elements[name].disabled=!targetMode;
  }
  if(!targetMode){
    for(const name of ["targetYearId","targetProgramId","targetTermId","targetSectionId"])pform.elements[name].value="";
    return;
  }
  const year=pform.elements.targetYearId,program=pform.elements.targetProgramId,
    term=pform.elements.targetTermId,section=pform.elements.targetSectionId,
    prior={year:year.value,program:program.value,term:term.value,section:section.value},
    years=(catalog.years||[]).filter(row=>row.id!==source.yearId);
  options(year,years,"Choose target academic year");
  if(years.some(row=>row.id===prior.year))year.value=prior.year;
  options(program,catalog.programs||[],"Choose target program / division");
  if((catalog.programs||[]).some(row=>row.id===prior.program))program.value=prior.program;
  else if((catalog.programs||[]).some(row=>row.id===source.programId))program.value=source.programId;
  const terms=(catalog.terms||[]).filter(row=>
    (!year.value||row.yearId===year.value)&&(!program.value||row.programId===program.value));
  options(term,terms,"Choose target academic period");
  if(terms.some(row=>row.id===prior.term))term.value=prior.term;
  const sections=(catalog.sections||[]).filter(row=>
    (!program.value||row.programId===program.value)&&
    progressionGradeValid(type,source.gradeLevel,row.gradeLevel));
  options(section,sections,"Choose target section");
  if(sections.some(row=>row.id===prior.section))section.value=prior.section;
}
async function updateProgressionPreview(){
  if(!progressionChange)return;
  const run=++progressionPreviewRun,payload=progressionFormPayload(),
    preview=get("en-progression-preview"),blockers=get("en-progression-blockers"),
    confirm=get("en-progression-confirm");
  progressionChange.preview=null;progressionChange.previewSignature="";
  blockers.replaceChildren();confirm.disabled=true;
  if(!payload?.progressionType){
    preview.textContent="Choose a progression decision to check released Final Grades and target placement.";return;
  }
  if(payload.progressionType!=="graduation"&&
    (!payload.targetYearId||!payload.targetProgramId||!payload.targetTermId||!payload.targetSectionId)){
    preview.textContent="Choose the complete target placement to run progression readiness.";return;
  }
  preview.textContent="Checking released Final Grades and official placement dependencies…";
  try{
    const result=await perform("preview_progression",payload);
    if(run!==progressionPreviewRun||!progressionChange)return;
    progressionChange.preview=result;progressionChange.previewSignature=progressionSignature(payload);
    for(const issue of result.blockers||[]){
      const row=document.createElement("p");row.className="en-muted";
      const subject=issue.subjectId?catalog.subjects.find(item=>item.id===issue.subjectId)?.name:"";
      row.textContent="• "+(subject?subject+": ":"")+(issue.message||"Progression requires review.");
      blockers.append(row);
    }
    if(result.canApply){
      const destination=result.progressionType==="graduation"
        ?"student academic completion / graduation"
        :registrationLabel({...result.target,displayName:""});
      preview.textContent="Ready · "+result.completion.filter(item=>item.ready).length+
        " released Final Grade"+(result.completion.length===1?"":"s")+" verified · "+destination+".";
      confirm.disabled=false;
    }else{
      preview.textContent=(result.blockers||[]).length+
        " progression blocker"+((result.blockers||[]).length===1?"":"s")+" must be resolved before this decision can be applied.";
    }
  }catch(error){
    if(run!==progressionPreviewRun||!progressionChange)return;
    preview.textContent=error?.message||"Progression readiness could not be checked.";
  }
}
function openProgression(item){
  if(saving)return;
  progressionChange={item,preview:null,previewSignature:""};++progressionPreviewRun;
  const dialog=get("en-progression-dialog"),pform=get("en-progression-form");
  pform.reset();get("en-progression-blockers").replaceChildren();
  get("en-progression-target").textContent=item.displayName+" · "+registrationLabel(item)+" · "+levelLabel(item.gradeLevel);
  get("en-progression-preview").textContent="Choose a progression decision to check released Final Grades and target placement.";
  get("en-progression-confirm").disabled=true;
  for(const select of [pform.elements.targetYearId,pform.elements.targetProgramId,pform.elements.targetTermId,pform.elements.targetSectionId])
    blank(select,"Choose after selecting a decision");
  refreshProgressionPlacement();dialog.showModal();
}
function closeProgression(){
  if(saving)return;
  ++progressionPreviewRun;progressionChange=null;
  get("en-progression-dialog").close();
}
function updateRegistrationChangePreview(){
  if(!registrationChange||registrationChange.mode!=="move")return;
  const select=get("en-registration-change-form").elements.sectionId,
    sectionId=String(select.value||""),preview=get("en-registration-change-preview"),
    confirm=get("en-registration-change-confirm");
  if(!sectionId){
    preview.textContent="Choose a new section to preview its automatic class roster.";
    confirm.disabled=true;return;
  }
  const offerings=automaticOfferings(registrationChange.item,sectionId),
    subjectNames=[...new Set(offerings.map(row=>
      catalog.subjects.find(subject=>subject.id===row.subjectId)?.name||row.subjectId).filter(Boolean))]
      .sort((a,b)=>a.localeCompare(b));
  preview.textContent=offerings.length
    ?offerings.length+" automatic class"+(offerings.length===1?"":"es")+" will become the student's official section roster"+
      (subjectNames.length?": "+subjectNames.join(", "):"")+
      ". Selective/elective enrollments are left unchanged."
    :"This section has no active automatic-roster classes for the student's current academic period.";
  confirm.disabled=offerings.length===0;
}
function openRegistrationChange(item,mode){
  if(saving)return;
  registrationChange={item,mode};
  const dialog=get("en-registration-change-dialog"),changeForm=get("en-registration-change-form"),
    placement=get("en-registration-change-placement"),endTypeSection=get("en-registration-end-type"),
    sectionSelect=changeForm.elements.sectionId,endTypeSelect=changeForm.elements.endReasonType,
    confirmButton=get("en-registration-change-confirm");
  changeForm.reset();
  placement.hidden=mode!=="move";
  endTypeSection.hidden=mode!=="end";
  sectionSelect.required=mode==="move";
  sectionSelect.disabled=mode!=="move";
  endTypeSelect.required=mode==="end";
  endTypeSelect.disabled=mode!=="end";
  confirmButton.disabled=false;
  get("en-registration-change-title").textContent=mode==="restore"?"Restore registration":
    mode==="move"?"Change official section":"End registration";
  get("en-registration-change-target").textContent=item.displayName+" · "+registrationLabel(item);
  get("en-registration-change-help").textContent=mode==="restore"
    ?"Restore only the subject enrollments that were ended with this registration. Restoration is blocked if another active official placement exists or required course offerings are no longer active."
    :mode==="move"
      ?"Move this active registration to another section in the same grade level and academic period. Adminerva ends the superseded official section enrollment, creates a new registration, moves only automatic section classes, and preserves the old registration, submissions, grades and audit history."
      :"End this official registration and its active registration-owned subject enrollments without deleting the student identity or historical academic records. Classify the institutional reason so withdrawal, transfer-out and cancellation remain distinguishable later.";
  if(mode==="move"){
    sectionSelect.replaceChildren(new Option("Choose new section",""));
    const candidates=(catalog.sections||[]).filter(section=>section.id!==item.sectionId&&
      section.programId===item.programId&&
      (!item.gradeLevel||!section.gradeLevel||String(section.gradeLevel)===String(item.gradeLevel))&&
      automaticOfferings(item,section.id).length>0)
      .sort((a,b)=>a.name.localeCompare(b.name));
    for(const section of candidates)sectionSelect.append(new Option(section.name,section.id));
    if(!candidates.length){
      sectionSelect.replaceChildren(new Option("No eligible section with automatic classes",""));
      confirmButton.disabled=true;
    }
    updateRegistrationChangePreview();
  }
  confirmButton.textContent=mode==="restore"?"Restore registration":mode==="move"?"Change section":"End registration";
  confirmButton.style.background=mode==="restore"?"#166534":mode==="move"?"#1d4ed8":"#9a3412";
  confirmButton.style.borderColor=mode==="restore"?"#166534":mode==="move"?"#1d4ed8":"#9a3412";
  dialog.showModal();
}
function closeRegistrationChange(){
  if(saving)return;
  registrationChange=null;
  get("en-registration-change-dialog").close();
}
get("en-registration-change-close").addEventListener("click",closeRegistrationChange);
get("en-registration-change-cancel").addEventListener("click",closeRegistrationChange);
get("en-registration-change-dialog").addEventListener("cancel",event=>{if(saving)event.preventDefault();else registrationChange=null;});
get("en-registration-change-form").elements.sectionId.addEventListener("change",updateRegistrationChangePreview);
get("en-progression-close").addEventListener("click",closeProgression);
get("en-progression-cancel").addEventListener("click",closeProgression);
get("en-progression-dialog").addEventListener("cancel",event=>{
  if(saving)event.preventDefault();else{++progressionPreviewRun;progressionChange=null;}
});
for(const name of ["progressionType","targetYearId","targetProgramId","targetTermId","targetSectionId"]){
  get("en-progression-form").elements[name].addEventListener("change",()=>{
    if(["progressionType","targetYearId","targetProgramId"].includes(name))refreshProgressionPlacement();
    void updateProgressionPreview();
  });
}
get("en-progression-form").addEventListener("submit",event=>{
  event.preventDefault();
  if(saving||!progressionChange||!event.currentTarget.reportValidity())return;
  const payload=progressionFormPayload(),signature=progressionSignature(payload),
    reason=String(new FormData(event.currentTarget).get("reason")||"").trim(),
    preview=progressionChange.preview;
  if(!preview?.canApply||progressionChange.previewSignature!==signature){
    get("en-progression-preview").textContent="The progression selection changed. Run the readiness check again before applying.";
    get("en-progression-confirm").disabled=true;return;
  }
  const item=progressionChange.item;
  void (async()=>{
    setSaving(true);status.textContent="Applying "+progressionTypeLabel(payload.progressionType).toLowerCase()+" and preserving completed registration history…";
    try{
      const result=await perform("progress_registration",{...payload,reason});
      progressionChange=null;get("en-progression-dialog").close();
      await loadRegistrations();
      status.textContent=result.progressionType==="graduation"
        ?item.displayName+" graduated · "+result.completedCourseCount+" released class result"+(result.completedCourseCount===1?"":"s")+" preserved."
        :item.displayName+" · "+progressionTypeLabel(result.progressionType)+" completed · "+
          result.createdCourseCount+" target class enrollment"+(result.createdCourseCount===1?"":"s")+" created; prior registration preserved.";
    }catch(error){
      get("en-progression-preview").textContent=error?.message||"The progression decision was not applied.";
    }finally{setSaving(false);}
  })();
});

get("en-registration-change-form").addEventListener("submit",event=>{
  event.preventDefault();
  if(saving||!registrationChange||!event.currentTarget.reportValidity())return;
  const {item,mode}=registrationChange,values=new FormData(event.currentTarget),
    reason=String(values.get("reason")||"").trim(),
    sectionId=String(values.get("sectionId")||""),
    endReasonType=String(values.get("endReasonType")||""),
    action=mode==="restore"?"restore_registration":mode==="move"?"change_registration_section":"end_registration";
  if(mode==="move"&&!automaticOfferings(item,sectionId).length){
    get("en-registration-change-preview").textContent="Choose a section with at least one active automatic-roster class.";return;
  }
  void (async()=>{
    setSaving(true);
    status.textContent=mode==="restore"?"Restoring official registration…":
      mode==="move"?"Changing official section and synchronizing automatic class rosters…":
      "Ending official registration and subject enrollments…";
    try{
      const result=await perform(action,{
        registrationId:item.registrationId,reason,
        expectedRevision:Number(item.revision)||1,
        ...(mode==="move"?{sectionId}: {}),
        ...(mode==="end"?{endReasonType}: {})
      });
      const targetName=catalog.sections.find(row=>row.id===sectionId)?.name||sectionId;
      const message=mode==="restore"
        ?item.displayName+" restored · "+result.courseCount+" subject enrollment"+(result.courseCount===1?"":"s")+" reactivated."
        :mode==="move"
          ?item.displayName+" moved to "+targetName+" · "+result.courseCount+" automatic class"+(result.courseCount===1?"":"es")+
            " active · "+result.endedCourses+" prior official class enrollment"+(result.endedCourses===1?"":"s")+" ended. Historical records were preserved."
          :item.displayName+" ended · "+endTypeLabel(result.endReasonType)+
            " · "+result.courseCount+" active official subject enrollment"+(result.courseCount===1?"":"s")+" ended.";
      registrationChange=null;get("en-registration-change-dialog").close();
      await loadRegistrations();
      status.textContent=message;
    }catch(error){status.textContent=error?.message||"The registration change was not saved.";}
    finally{setSaving(false);}
  })();
});

function openLegacyReconciliation(item){
  if(saving)return;
  legacyCleanup=item;
  const dialog=get("en-legacy-reconciliation-dialog"),form=get("en-legacy-reconciliation-form");
  form.reset();
  get("en-legacy-reconciliation-target").textContent=item.displayName+" · "+item.courseCount+
    " active pre-canonical class enrollment"+(item.courseCount===1?"":"s")+
    (legacyPlacementLabel(item)?" · "+legacyPlacementLabel(item):"");
  dialog.showModal();
}
function closeLegacyReconciliation(){
  if(saving)return;
  legacyCleanup=null;
  get("en-legacy-reconciliation-dialog").close();
}
get("en-legacy-reconciliation-close").addEventListener("click",closeLegacyReconciliation);
get("en-legacy-reconciliation-cancel").addEventListener("click",closeLegacyReconciliation);
get("en-legacy-reconciliation-dialog").addEventListener("cancel",event=>{
  if(saving)event.preventDefault();else legacyCleanup=null;
});
get("en-legacy-reconciliation-form").addEventListener("submit",event=>{
  event.preventDefault();
  if(saving||!legacyCleanup||!event.currentTarget.reportValidity())return;
  const item=legacyCleanup,reason=String(new FormData(event.currentTarget).get("reason")||"").trim();
  if(!confirm("End "+item.courseCount+" reviewed pre-canonical class enrollment"+(item.courseCount===1?"":"s")+
    " for "+item.displayName+"? Historical records will be preserved."))return;
  void (async()=>{
    setSaving(true);status.textContent="Reconciling older class enrollment records for "+item.displayName+"…";
    try{
      const result=await perform("end_orphan_enrollments",{
        personId:item.personId,reason,
        enrollments:(item.enrollments||[]).map(row=>({
          enrollmentId:row.enrollmentId,expectedRevision:Number(row.expectedRevision)||1
        }))
      });
      legacyCleanup=null;get("en-legacy-reconciliation-dialog").close();
      await loadRegistrations();
      status.textContent=item.displayName+" · "+result.courseCount+
        " pre-canonical class enrollment"+(result.courseCount===1?"":"s")+" ended; history preserved.";
    }catch(error){
      status.textContent=error?.message||"The pre-canonical enrollment reconciliation was not saved.";
    }finally{setSaving(false);}
  })();
});

function applicationMeta(item){
  const year=catalog.years.find(x=>x.id===item.yearId)?.name||item.yearId;
  const program=catalog.programs.find(x=>x.id===item.preferredProgramId)?.name||"No program preference";
  return [item.reference,year,levelLabel(item.incomingLevel),program].filter(Boolean).join(" · ");
}
function loadApplicationIntoForm(item){
  if(saving||loadedApplication?.applicationId===item.applicationId||!discardDraft())return;
  loadedPerson=null;form.elements.personId.value="";
  form.elements.displayName.readOnly=false;
  loadedApplication=item;
  form.elements.applicationId.value=item.applicationId;
  form.elements.displayName.value=item.displayName||"";
  form.elements.birthDate.value=item.birthDate||"";
  form.elements.studentNumber.value="";
  form.elements.guardianName.value=item.guardianName||"";
  form.elements.guardianRelationship.value=item.guardianRelationship||"";
  form.elements.guardianEmail.value=item.guardianEmail||"";
  form.elements.guardianMobile.value=item.guardianMobile||"";
  form.elements.studentEmail.value=item.studentEmail||"";
  form.elements.studentEmailType.value=item.studentEmailType||"personal";
  form.elements.yearId.value=(catalog.years||[]).some(row=>row.id===item.yearId)?item.yearId:"";
  form.elements.programId.value=(catalog.programs||[]).some(row=>row.id===item.preferredProgramId)?item.preferredProgramId:"";
  form.elements.termId.value="";form.elements.sectionId.value="";
  get("en-register-title").textContent="Review & place online application";
  get("en-register-help").textContent=item.reference+" · "+levelLabel(item.incomingLevel)+
    ". Confirm official program, period and section before enrollment.";
  get("en-clear-application").hidden=false;
  refreshPlacement();
  draftDirty=false;
  form.scrollIntoView({behavior:"smooth",block:"start"});
  form.elements.displayName.focus();
}
function clearLoadedApplication({resetIdentity=false}={}){
  const hadLoadedPerson=Boolean(loadedPerson);
  loadedApplication=null;loadedPerson=null;
  form.elements.applicationId.value="";form.elements.personId.value="";
  form.elements.displayName.readOnly=false;
  if(hadLoadedPerson){
    try{
      const url=new URL(location.href);url.searchParams.delete("personId");
      history.replaceState({},"",url);
    }catch{}
  }
  get("en-register-title").textContent="Onsite / manual enrollment";
  get("en-register-help").textContent="Use this for walk-in enrollees. Online applications and reviewed directory students can be loaded here before official placement.";
  get("en-clear-application").hidden=true;
  get("en-clear-application").textContent="Clear loaded student";
  if(resetIdentity){
    for(const name of ["displayName","birthDate","studentNumber","guardianName","guardianRelationship","guardianEmail","guardianMobile","studentEmail"])
      form.elements[name].value="";
    form.elements.studentEmailType.value="personal";
  }
  refreshPlacement();
  draftDirty=false;
}
async function loadStudentCandidate(personId,{scroll=true}={}){
  if(saving||!personId)return false;
  status.textContent="Loading the reviewed student directory record…";
  try{
    const result=await perform("student_candidate",{personId}),person=result.person;
    if(result.activeRegistrations?.length){
      const current=result.activeRegistrations[0],section=catalog.sections.find(row=>row.id===current.sectionId)?.name||current.sectionId||"assigned section";
      get("en-registration-search").value=person.displayName||person.studentNumber||"";
      renderRegistrations();
      status.textContent=person.displayName+" already has an active official registration"+(section?" · "+section:"")+
        ". Use the Current registrations controls to correct or end that placement.";
      if(scroll)get("en-registration-list").scrollIntoView({behavior:"smooth",block:"start"});
      return false;
    }
    if(result.activeLegacyEnrollments?.length){
      const legacyItem={
        personId:person.personId,displayName:person.displayName||"Student",
        studentNumber:person.studentNumber||"",personStatus:"active",
        courseCount:result.activeLegacyEnrollments.length,
        sectionIds:[...new Set(result.activeLegacyEnrollments.map(row=>row.sectionId).filter(Boolean))],
        yearIds:[...new Set(result.activeLegacyEnrollments.map(row=>row.yearId).filter(Boolean))],
        termIds:[...new Set(result.activeLegacyEnrollments.map(row=>row.termId).filter(Boolean))],
        hasRegistrationLinkedEnrollment:result.activeLegacyEnrollments.some(row=>Boolean(row.registrationId)),
        enrollments:result.activeLegacyEnrollments
      };
      const existingIndex=legacyRegistrations.findIndex(row=>row.personId===person.personId);
      if(existingIndex>=0)legacyRegistrations.splice(existingIndex,1,legacyItem);
      else legacyRegistrations.unshift(legacyItem);
      get("en-registration-search").value=person.displayName||person.studentNumber||"";
      renderRegistrations();renderLegacyRegistrations();
      status.textContent=legacyItem.hasRegistrationLinkedEnrollment
        ?person.displayName+" has active older class enrollments tied to registration history. Review is required before account recovery."
        :person.displayName+" has "+legacyItem.courseCount+" active pre-canonical class enrollment"+
          (legacyItem.courseCount===1?"":"s")+". Reconcile them below before account recovery.";
      if(scroll)get("en-legacy-reconciliation-card").scrollIntoView({behavior:"smooth",block:"start"});
      return false;
    }
    if(draftDirty&&!discardDraft())return false;
    loadedApplication=null;loadedPerson=person;
    form.elements.applicationId.value="";form.elements.personId.value=person.personId;
    form.elements.displayName.value=person.displayName||"";
    form.elements.displayName.readOnly=true;
    form.elements.birthDate.value=person.birthDate||"";
    form.elements.studentNumber.value=person.studentNumber||"";
    form.elements.guardianName.value=person.guardianName||"";
    form.elements.guardianRelationship.value=person.guardianRelationship||"";
    form.elements.guardianEmail.value=person.guardianEmail||"";
    form.elements.guardianMobile.value=person.guardianMobile||"";
    form.elements.studentEmail.value="";
    form.elements.studentEmailType.value=person.studentEmailType||"personal";
    form.elements.yearId.value="";form.elements.programId.value="";
    form.elements.termId.value="";form.elements.sectionId.value="";
    get("en-register-title").textContent="Place existing student";
    get("en-register-help").textContent="This form is bound to the reviewed school directory record for "+person.displayName+
      ". Complete any missing registrar details, then choose the official academic placement. Adminerva will not create a second person record.";
    get("en-clear-application").hidden=false;
    get("en-clear-application").textContent="Clear loaded student";
    refreshPlacement();draftDirty=false;
    status.textContent=person.activationReady
      ?person.displayName+" loaded from the school directory. Their sign-in identity is already protected; confirm the student email only if the selected grade requires it."
      :person.displayName+" loaded from the school directory. Complete the required contact and placement fields.";
    if(scroll){
      form.scrollIntoView({behavior:"smooth",block:"start"});
      (form.elements.birthDate.value?form.elements.yearId:form.elements.birthDate).focus();
    }
    return true;
  }catch(error){
    status.textContent=error?.message||"The reviewed student directory record could not be loaded.";
    return false;
  }
}

async function reviewApplication(item,nextStatus){
  if(saving)return;
  const label=nextStatus==="rejected"?"rejection":"request for more information";
  const reason=prompt("Enter the reason for this "+label+". This is recorded in the enrollment review history.");
  if(!reason)return;
  setSaving(true);
  status.textContent="Saving enrollment review…";
  try{
    await perform("review_application",{applicationId:item.applicationId,status:nextStatus,
      expectedRevision:Number(item.revision)||1,reason});
    if(loadedApplication?.applicationId===item.applicationId)clearLoadedApplication({resetIdentity:true});
    const message=nextStatus==="rejected"?"Application rejected.":"Application marked as needing information.";
    status.textContent=message;
    try{await loadApplications();}catch{status.textContent=message+" The list could not refresh. Use Refresh applications.";}
  }catch(error){status.textContent=error?.message||"Application review was not saved.";}
  finally{setSaving(false);}
}
async function loadApplications(){
  const result=await latest("applications","list_applications"),host=get("en-application-list");
  if(!result)return;
  host.replaceChildren();
  const items=result.items||[];
  if(!items.length){
    const empty=document.createElement("p");empty.className="en-muted";
    empty.textContent="No online enrollment applications yet.";host.append(empty);return;
  }
  for(const item of items){
    const row=document.createElement("article");row.className="en-row";row.setAttribute("role","listitem");
    const info=document.createElement("div"),name=document.createElement("strong"),meta=document.createElement("p"),
      contacts=document.createElement("p");
    name.textContent=item.displayName;meta.className="en-muted";contacts.className="en-muted";
    meta.textContent=applicationMeta(item);
    contacts.textContent=item.guardianName+" · "+item.guardianEmail+
      (item.studentEmail?" · student: "+item.studentEmail:" · guardian-managed learner");
    info.append(name,meta,contacts);
    if(item.reviewReason){
      const note=document.createElement("p");note.className="en-muted";note.textContent="Review note: "+item.reviewReason;info.append(note);
    }
    const actions=document.createElement("div");actions.style.cssText="display:flex;gap:.4rem;flex-wrap:wrap;justify-content:flex-end";
    const badge=document.createElement("span");badge.className="en-badge";badge.textContent=item.status.replaceAll("_"," ");
    actions.append(badge);
    if(item.status==="submitted"){
      const load=document.createElement("button");load.type="button";load.className="en-btn secondary";load.textContent="Review & place";
      load.addEventListener("click",()=>loadApplicationIntoForm(item));actions.append(load);
      const need=document.createElement("button");need.type="button";need.className="en-btn secondary";need.textContent="Needs info";
      need.addEventListener("click",()=>void reviewApplication(item,"needs_information"));actions.append(need);
      const reject=document.createElement("button");reject.type="button";reject.className="en-btn secondary";reject.textContent="Reject";
      reject.addEventListener("click",()=>void reviewApplication(item,"rejected"));actions.append(reject);
    }
    row.append(info,actions);host.append(row);
  }
  if(saving)for(const button of host.querySelectorAll("button"))button.disabled=true;
}
async function refreshAll(){
  const version=++refreshVersion;
  status.textContent="Loading enrollment configuration…";
  if(!await loadCatalog()||version!==refreshVersion)return;
  const outcomes=await Promise.allSettled([loadApplications(),loadRegistrations()]);
  if(version!==refreshVersion)return;
  const unavailable=["Online applications","Current registrations"].filter((_,index)=>outcomes[index].status==="rejected");
  status.textContent=unavailable.length?unavailable.join(" and ")+" could not refresh. Available results remain usable; use Refresh to retry.":"";
  if(requestedPersonId&&!loadedApplication&&!loadedPerson&&version===refreshVersion)
    await loadStudentCandidate(requestedPersonId);
}
let activation="";
function renderActivation(schoolId){
  const input=get("en-activation-link"),open=get("en-open-activation");
  if(!schoolId){
    activation="";input.value="";open.removeAttribute?.("href");open.href="";return;
  }
  const url=new URL("join-school.html",location.href);
  url.searchParams.set("schoolId",schoolId);
  url.searchParams.set("mode","roster");
  activation=url.href;input.value=activation;open.href=activation;
}
get("en-copy-activation").addEventListener("click",async()=>{
  if(!activation){
    get("en-activation-status").textContent="Choose an eligible school before copying its activation link.";return;
  }
  try{
    await navigator.clipboard.writeText(activation);
    get("en-activation-status").textContent="Activation link copied. Grade 7+ students still need an exact verified enrollment email match.";
  }catch{
    get("en-activation-link").focus();get("en-activation-link").select();
    get("en-activation-status").textContent="Clipboard access was blocked. The activation link is selected for manual copying.";
  }
});
form.elements.yearId.addEventListener("change",refreshPlacement);
form.elements.programId.addEventListener("change",refreshPlacement);
form.elements.termId.addEventListener("change",updateCoursePreview);
form.elements.sectionId.addEventListener("change",updateCoursePreview);
get("en-registration-search")?.addEventListener("input",()=>{renderRegistrations();renderLegacyRegistrations();});
get("en-registration-section")?.addEventListener("change",()=>{renderRegistrations();renderLegacyRegistrations();});
form.addEventListener("input",()=>{draftDirty=true;});
form.addEventListener("change",()=>{draftDirty=true;});
get("en-clear-application").addEventListener("click",()=>{if(!saving&&discardDraft())clearLoadedApplication({resetIdentity:true});});
get("en-refresh-applications").addEventListener("click",()=>void loadApplications().catch(error=>{
  status.textContent=error?.message||"Online applications could not be refreshed.";
}));

form.addEventListener("submit",event=>{
  event.preventDefault();updateStudentEmailPolicy();
  if(saving||!form.reportValidity())return;
  const data=new FormData(form);
  const studentEmail=String(data.get("studentEmail")||"").trim().toLowerCase();
  const guardianEmail=String(data.get("guardianEmail")||"").trim().toLowerCase();
  if(studentEmail&&studentEmail===guardianEmail){
    status.textContent="Student and parent/guardian email must be different.";
    form.elements.studentEmail.focus();return;
  }
  void (async()=>{
    setSaving(true);
    status.textContent=loadedApplication
      ?"Creating official enrollment from the reviewed application…"
      :loadedPerson
        ?"Creating official placement for the reviewed directory student…"
        :"Registering onsite student and creating section subject enrollments…";
    try{
      const result=await perform("register_student",{
        applicationId:String(data.get("applicationId")||""),
        personId:String(data.get("personId")||""),
        displayName:String(data.get("displayName")||"").trim(),
        birthDate:String(data.get("birthDate")||""),
        studentNumber:String(data.get("studentNumber")||"").trim(),
        guardianName:String(data.get("guardianName")||"").trim(),
        guardianRelationship:String(data.get("guardianRelationship")||"").trim(),
        guardianEmail,guardianMobile:String(data.get("guardianMobile")||"").trim(),
        studentEmail,studentEmailType:studentEmail?String(data.get("studentEmailType")||"personal"):"",
        yearId:String(data.get("yearId")||""),programId:String(data.get("programId")||""),
        termId:String(data.get("termId")||""),sectionId:String(data.get("sectionId")||"")
      });
      status.textContent=result.displayName+" enrolled · "+result.courseCount+
        " active subject enrollment"+(result.courseCount===1?"":"s")+" · "+
        (result.accountResponsibility==="guardian"
          ?"guardian-managed learner; no student account required yet."
          :(result.accountLinked?"student account already linked.":"student account ready for email activation."));
      clearLoadedApplication({resetIdentity:true});
      form.elements.studentNumber.value="";
      const message=status.textContent;
      const refreshes=await Promise.allSettled([loadApplications(),loadRegistrations()]);
      if(refreshes.some(item=>item.status==="rejected"))status.textContent=message+" Some lists could not refresh; use Refresh.";
    }catch(error){status.textContent=error?.message||"Student enrollment was not saved.";}
    finally{setSaving(false);}
  })();
});
get("en-refresh").addEventListener("click",()=>void refreshAll().catch(error=>{
  status.textContent=error?.message||"Enrollment data could not be refreshed.";
}));

picker=createTenantSchoolPicker({
  host:get("en-school-picker"),status,
  onBeforeChange:async()=>{
    if(saving)throw new Error("Finish the current enrollment before switching schools.");
    if(!discardDraft())throw new Error("Keep the current school open to finish the unsaved enrollment.");
    ++refreshVersion;
    for(const source of Object.keys(requestVersions))++requestVersions[source];
    loadedApplication=null;loadedPerson=null;registrationChange=null;progressionChange=null;cohortPreview=null;draftDirty=false;registrations=[];
    ++progressionPreviewRun;++historyRun;++cohortRun;
    form.elements.displayName.readOnly=false;
    catalog={years:[],programs:[],terms:[],sections:[],subjects:[],offerings:[]};
    if(get("en-registration-change-dialog").open)get("en-registration-change-dialog").close();
    if(get("en-progression-dialog").open)get("en-progression-dialog").close();
    if(get("en-history-dialog").open)get("en-history-dialog").close();
    form.reset();cohortForm().reset();clearLoadedApplication({resetIdentity:true});
    get("en-application-list").replaceChildren();get("en-registration-list").replaceChildren();
    get("en-cohort-results").replaceChildren();get("en-cohort-status").textContent="Choose a source cohort and decision.";
    renderActivation("");workspace.hidden=true;
  },
  onReady:scope=>{
    const current=scope.current;
    if(!current?.roles.some(role=>["school_admin","registrar"].includes(role))){
      workspace.hidden=true;status.textContent="School Administrator or Registrar access is required for Enrollment.";return;
    }
    if(current.enrollmentMode!=="canonical"){
      workspace.hidden=true;
      status.textContent="This school is still using its reviewed compatibility enrollment workflow. Use People & Access for legacy class relationships until the school adopts the canonical workflow.";
      return;
    }
    renderActivation(current.schoolId);workspace.hidden=false;
    void refreshAll().catch(error=>{status.textContent=error?.message||"Enrollment data could not be loaded.";});
  }
});
try{
  await picker.load();
  if(!auth.currentUser)status.textContent="Sign in to use school enrollment.";
}catch(error){status.textContent=error?.message||"Enrollment access could not be verified.";}