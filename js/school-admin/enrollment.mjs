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
const requestedSchoolId=(()=>{try{return new URL(location.href).searchParams.get("schoolId")||"";}catch{return "";}})();
let requestedPersonId=(()=>{try{
  const value=new URL(location.href).searchParams.get("personId")||"";
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)?value:"";
}catch{return "";}})();
let picker=null,catalog={years:[],programs:[],terms:[],sections:[],subjects:[],offerings:[]},
  saving=false,draftDirty=false,loadedApplication=null,loadedPerson=null,registrations=[],legacyRegistrations=[],
  registrationChange=null,legacyCleanup=null,progressionChange=null,cohortPreview=null;
const requestVersions={catalog:0,applications:0,registrations:0,legacy:0};
let registrationCursor=null,registrationBusy=false,legacyCursor=null,legacyBusy=false,legacyScanned=false,legacyBlocked=0;
let refreshVersion=0,progressionPreviewRun=0,historyRun=0,cohortRun=0;
let activeEnrollmentView="registrations";
const enrollmentViews={registrations:["en-registrations","en-legacy-reconciliation-card","en-admin-tools"],applications:["en-applications"],register:["en-register"],progression:["en-progression"],activation:["en-activation"],reports:["en-reports"]};
function showEnrollmentView(view){
  if(!Object.hasOwn(enrollmentViews,view))return;
  activeEnrollmentView=view;
  for(const [key,ids] of Object.entries(enrollmentViews))for(const id of ids){
    get(id).hidden=key!==view||(id==="en-admin-tools"&&!picker?.scope.current?.roles.includes("school_admin"));
  }
  for(const control of document.querySelectorAll("[data-en-view]"))control.setAttribute("aria-pressed",String(control.dataset.enView===view));
}
for(const control of document.querySelectorAll("[data-en-view]"))control.addEventListener("click",()=>showEnrollmentView(control.dataset.enView));

function assistMode(){
  try{return sessionStorage.getItem("Adminerva_platform_school_mode")==="assist"?"assist":"";}catch{return "";}
}
function perform(action,details={}){
  const lease=picker.scope.lease();
  return api({schoolId:lease.schoolId,action,...details,...(assistMode()?{platformMode:"assist"}:{})})
    .then(response=>{picker.scope.assertLease(lease);return response.data;});
}
async function latest(source,action,details={}){
  const version=++requestVersions[source];
  try{
    const result=await perform(action,details);
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
  get("en-applicant-type").disabled=value||Boolean(loadedPerson);
  for(const control of document.querySelectorAll("#en-application-list button, #en-application-list input, #en-registrations-more, #en-legacy-scan, #en-bulk-open, #en-bulk-clear, #en-bulk-form button, #en-bulk-form select, #en-applications-more, #en-correction-form button, #en-correction-form input, #en-correction-form select, #en-correction-form textarea, #en-documents-dialog button, #en-documents-form input, #en-documents-form select, #en-clearance-policy-open, #en-clearance-policy-form button, #en-clearance-policy-form input, #en-clearance-policy-form textarea, #en-clearance-form button, #en-clearance-form input, #en-clearance-form select, #en-clearance-form textarea, #en-template-open, #en-template-form button, #en-template-form select, #en-template-form textarea, #en-requirements-form button, #en-requirements-form input, #en-requirements-form select, #en-requirements-form textarea, #en-clear-application, #en-refresh, #en-refresh-applications, #en-registration-change-dialog button, #en-registration-change-form textarea, #en-registration-change-form select, #en-legacy-reconciliation-dialog button, #en-legacy-reconciliation-form textarea, #en-progression-dialog button, #en-progression-form textarea, #en-progression-form select, #en-cohort-form button, #en-cohort-form textarea, #en-cohort-form select"))
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
    updateBulkControls();updateRegistrationControls();
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
    (!yearId||row.yearId===yearId)&&(!programId||row.programId===programId)&&
    !(loadedPerson?.activeRegistrations||[]).some(reg=>reg.yearId===row.yearId&&reg.termId===row.id));
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
  get("en-register-button").disabled=saving||(loadedApplication?count===0:!yearId||!programId||!termId||!sectionId);
  get("en-register-button").textContent=loadedApplication?"Register & enroll student":"Save application";
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
  refreshCohortOptions();refreshReportYears();
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
  updateRegistrationControls();get("en-registrations-count").textContent=items.length+" matching · "+registrations.length+" loaded"+(registrationCursor?" · more records available":"");
  if(!items.length){
    const empty=document.createElement("p");empty.className="en-muted";
    empty.textContent=registrationCursor?"No matches in loaded registrations. Load more.":registrations.length
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
    const schoolQuery="&schoolId="+encodeURIComponent(picker.scope.current.schoolId);
    identityLink.textContent="Identity & access";identityLink.href="people-access.html?personId="+encodeURIComponent(item.personId)+schoolQuery+"#people";
    if(picker.scope.current.roles.includes("school_admin"))actions.append(identityLink);
    const recordsLink=document.createElement("a");recordsLink.className="en-btn secondary";recordsLink.style.cssText="display:inline-flex;align-items:center;text-decoration:none";
    recordsLink.textContent="201 file";recordsLink.href="school-student-records.html?personId="+encodeURIComponent(item.personId)+schoolQuery;actions.append(recordsLink);
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
      :!legacyScanned?"Scan legacy records when reconciliation is needed.":legacyCursor?"No candidates in scanned records. Continue scan.":legacyBlocked?"Some histories require manual review.":"No candidates found in completed scan.";
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
    button.disabled=item.personStatus!=="active"||item.hasRegistrationLinkedEnrollment||item.manualReview===true||item.courseCount>80;
    button.addEventListener("click",()=>openLegacyReconciliation(item));
    actions.append(button);
    row.append(info,actions);host.append(row);
  }
}
function updateRegistrationControls(){
  get("en-registrations-more").hidden=!registrationCursor;get("en-registrations-more").disabled=saving||registrationBusy;
  get("en-legacy-scan").disabled=saving||legacyBusy;get("en-legacy-scan").textContent=legacyCursor?"Continue scan":legacyScanned?"Rescan legacy records":"Scan legacy records";
}
async function scanLegacy(){
  if(saving||legacyBusy)return;
  const cursor=legacyCursor;if(!cursor){legacyRegistrations=[];legacyBlocked=0;}legacyBusy=true;updateRegistrationControls();
  try{
    const result=await latest("legacy","list_legacy_candidates",cursor?{cursor}:{});if(!result)return;
    const rows=new Map(legacyRegistrations.map(item=>[item.personId,item]));for(const item of result.items||[])rows.set(item.personId,item);
    legacyRegistrations=[...rows.values()].sort((a,b)=>a.displayName.localeCompare(b.displayName));legacyCursor=result.nextCursor||null;legacyScanned=true;legacyBlocked+=result.blockedCount||0;
    get("en-legacy-scan-status").textContent=legacyRegistrations.length+" candidates"+(legacyCursor?" · scan incomplete":" · scan complete")+(legacyBlocked?" · some histories require manual review":"");renderLegacyRegistrations();
  }catch(error){get("en-legacy-scan-status").textContent=error?.message||"Legacy scan failed.";}finally{legacyBusy=false;updateRegistrationControls();}
}
get("en-legacy-scan").addEventListener("click",()=>void scanLegacy());
get("en-registrations-more").addEventListener("click",()=>void loadRegistrations({more:true}).catch(error=>{status.textContent=error?.message||"Could not load more registrations.";}));
async function loadRegistrations({more=false}={}){
  if(more&&(!registrationCursor||registrationBusy||saving))return;
  const cursor=more?registrationCursor:null;registrationBusy=true;updateRegistrationControls();
  try{
    const result=await latest("registrations","list_registrations",cursor?{cursor}:{});if(!result)return;
    const rows=new Map((more?registrations:[]).map(item=>[item.registrationId,item]));for(const item of result.items||[])rows.set(item.registrationId,item);
    registrations=[...rows.values()].sort((a,b)=>registrationLabel(a).localeCompare(registrationLabel(b))||a.displayName.localeCompare(b.displayName));registrationCursor=result.nextCursor||null;
    if(!more){legacyRegistrations=[];legacyCursor=null;legacyScanned=false;legacyBlocked=0;get("en-legacy-scan-status").textContent="";}
  }finally{registrationBusy=false;renderRegistrations();renderLegacyRegistrations();}
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
      row.preview?.completion?.length?row.preview.completion.filter(item=>item.ready).length+"/"+row.preview.completion.length+" Final Grades ready":"",row.preview?.admissionApplication?"Returning "+row.preview.admissionApplication.reference:""]
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
  const run=++cohortRun,signature=cohortSignature(selection);let candidates;
  cohortPreview=null;get("en-cohort-apply").disabled=true;get("en-cohort-results").replaceChildren();
  message.textContent="Loading the full selected cohort…";
  try{const result=await perform("list_progression_cohort",{yearId:selection.sourceYearId,termId:selection.sourceTermId,sectionId:selection.sourceSectionId});if(run!==cohortRun)return;candidates=result.items||[];}catch(error){if(run===cohortRun)invalidateCohortPreview(error?.message||"Cohort could not be loaded.");return;}
  if(!candidates.length){invalidateCohortPreview("No active registrations match the selected source cohort.");return;}
  if(candidates.length>60){invalidateCohortPreview("This cohort exceeds 60 active registrations and requires paginated Registrar processing.");return;}
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
    try{const preview=await perform("preview_progression",payload);return {item,payload:{...payload,expectedAdmissionApplicationId:preview.admissionApplication?.applicationId||null,expectedAdmissionRevision:preview.admissionApplication?.revision||null},preview};}
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
      await Promise.allSettled([loadRegistrations(),loadApplications()]);
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
        " released Final Grade"+(result.completion.length===1?"":"s")+" verified · "+destination+(result.admissionApplication?" · Returning "+result.admissionApplication.reference:"")+".";
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
      const result=await perform("progress_registration",{...payload,reason,expectedAdmissionApplicationId:preview.admissionApplication?.applicationId||null,expectedAdmissionRevision:preview.admissionApplication?.revision||null});
      progressionChange=null;get("en-progression-dialog").close();
      await Promise.allSettled([loadRegistrations(),loadApplications()]);
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
  if(saving||item.status!=="accepted"||!item.requirementsReady||item.clearanceReady===false||!discardDraft())return;
  if(loadedApplication?.applicationId===item.applicationId&&loadedApplication.revision===item.revision){showEnrollmentView("register");return;}
  loadedPerson=null;form.elements.personId.value=item.personId||"";
  get("en-applicant-type-row").hidden=true;get("en-find-existing").hidden=true;
  for(const name of ["displayName","birthDate","guardianName","guardianRelationship","guardianEmail","guardianMobile","studentEmail","studentEmailType"]) {
    form.elements[name].readOnly=true;
    if(["guardianRelationship","studentEmailType"].includes(name))form.elements[name].style.pointerEvents="none";
  }
  loadedApplication=item;
  form.elements.applicationId.value=item.applicationId;
  form.elements.displayName.value=item.displayName||"";
  form.elements.birthDate.value=item.birthDate||"";
  form.elements.studentNumber.value=item.studentNumber||"";
  form.elements.studentNumber.readOnly=Boolean(item.studentNumber);
  form.elements.guardianName.value=item.guardianName||"";
  form.elements.guardianRelationship.value=item.guardianRelationship||"";
  form.elements.guardianEmail.value=item.guardianEmail||"";
  form.elements.guardianMobile.value=item.guardianMobile||"";
  form.elements.studentEmail.value=item.studentEmail||"";
  form.elements.studentEmailType.value=item.studentEmailType||"personal";
  form.elements.yearId.value=(catalog.years||[]).some(row=>row.id===item.yearId)?item.yearId:"";
  form.elements.programId.value=(catalog.programs||[]).some(row=>row.id===item.preferredProgramId)?item.preferredProgramId:"";
  form.elements.termId.value="";form.elements.sectionId.value="";
  get("en-register-title").textContent="Enroll accepted applicant";
  get("en-register-help").textContent=item.reference+" · "+levelLabel(item.incomingLevel)+
    ". Confirm official program, period and section before enrollment.";
  get("en-clear-application").hidden=false;
  refreshPlacement();
  if(item.preferredTermId&&(catalog.terms||[]).some(row=>row.id===item.preferredTermId))form.elements.termId.value=item.preferredTermId;
  if(item.preferredSectionId&&(catalog.sections||[]).some(row=>row.id===item.preferredSectionId))form.elements.sectionId.value=item.preferredSectionId;
  updateCoursePreview();
  draftDirty=false;
  showEnrollmentView("register");
  form.scrollIntoView({behavior:"smooth",block:"start"});
  form.elements.displayName.focus();
}
function clearLoadedApplication({resetIdentity=false}={}){
  const hadLoadedPerson=Boolean(loadedPerson);
  loadedApplication=null;loadedPerson=null;
  form.elements.applicationId.value="";form.elements.personId.value="";
  for(const name of ["displayName","birthDate","studentNumber","guardianName","guardianRelationship","guardianEmail","guardianMobile","studentEmail","studentEmailType"]){form.elements[name].readOnly=false;form.elements[name].style.pointerEvents="";}
  get("en-applicant-type-row").hidden=false;get("en-applicant-type").value="new";get("en-applicant-type").disabled=false;get("en-find-existing").hidden=false;
  if(hadLoadedPerson){
    try{
      const url=new URL(location.href);url.searchParams.delete("personId");
      history.replaceState({},"",url);
    }catch{}
  }
  get("en-register-title").textContent="Onsite application";
  get("en-register-help").textContent="";
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
    const activeRegistrations=result.activeRegistrations||[];
    const unresolvedLegacy=(result.activeLegacyEnrollments||[]).filter(row=>!activeRegistrations.some(reg=>row.registrationId===reg.registrationId||(!row.registrationId&&row.yearId===reg.yearId&&row.termId===reg.termId)));
    if(unresolvedLegacy.length){
      const legacyItem={
        personId:person.personId,displayName:person.displayName||"Student",
        studentNumber:person.studentNumber||"",personStatus:"active",
        courseCount:unresolvedLegacy.length,
        sectionIds:[...new Set(unresolvedLegacy.map(row=>row.sectionId).filter(Boolean))],
        yearIds:[...new Set(unresolvedLegacy.map(row=>row.yearId).filter(Boolean))],
        termIds:[...new Set(unresolvedLegacy.map(row=>row.termId).filter(Boolean))],
        hasRegistrationLinkedEnrollment:unresolvedLegacy.some(row=>Boolean(row.registrationId)),
        enrollments:unresolvedLegacy
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
      showEnrollmentView("registrations");
      if(scroll)get("en-legacy-reconciliation-card").scrollIntoView({behavior:"smooth",block:"start"});
      return false;
    }
    if(draftDirty&&!discardDraft())return false;
    clearLoadedApplication();loadedApplication=null;loadedPerson={...person,activeRegistrations};
    get("en-applicant-type").value="returning";get("en-applicant-type").disabled=true;get("en-find-existing").hidden=true;
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
    get("en-register-title").textContent="Returning student application";
    get("en-register-help").textContent="Existing student · "+(person.studentNumber||person.displayName)+(activeRegistrations.length?" · Choose a future academic period. Year-end progression remains required.":"");
    get("en-clear-application").hidden=false;
    get("en-clear-application").textContent="Clear loaded student";
    refreshPlacement();draftDirty=false;
    status.textContent=person.activationReady
      ?person.displayName+" loaded from the school directory. Their sign-in identity is already protected; confirm the student email only if the selected grade requires it."
      :person.displayName+" loaded from the school directory. Complete the required contact and placement fields.";
    showEnrollmentView("register");
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

let clearancePolicy=null,clearancePolicyRun=0,clearanceReview=null;
function closeClearancePolicy(){++clearancePolicyRun;clearancePolicy=null;get("en-clearance-policy-form").reset();get("en-clearance-policy-save").disabled=true;get("en-clearance-policy-dialog").close();}
function closeClearance(){clearanceReview=null;get("en-clearance-form").reset();get("en-clearance-dialog").close();}
get("en-clearance-policy-open").addEventListener("click",()=>void (async()=>{
  if(saving)return;const run=++clearancePolicyRun;clearancePolicy=null;const form=get("en-clearance-policy-form");form.reset();
  get("en-clearance-policy-save").disabled=true;get("en-clearance-policy-status").textContent="Loading…";get("en-clearance-policy-dialog").showModal();
  try{const result=await perform("get_enrollment_clearance_policy");if(run!==clearancePolicyRun)return;clearancePolicy=result;
    for(const control of form.querySelectorAll('input[name="requiredTypes"]'))control.checked=result.requiredTypes.includes(control.value);
    get("en-clearance-policy-save").disabled=false;get("en-clearance-policy-status").textContent=result.revision?"Policy revision "+result.revision:"No clearance required.";
  }catch(error){if(run===clearancePolicyRun)get("en-clearance-policy-status").textContent=error?.message||"Policy unavailable.";}
})());
get("en-clearance-policy-close").addEventListener("click",()=>{if(!saving)closeClearancePolicy();});
get("en-clearance-policy-dialog").addEventListener("cancel",event=>{event.preventDefault();if(!saving)closeClearancePolicy();});
get("en-clearance-policy-form").addEventListener("submit",event=>{
  event.preventDefault();if(saving||!clearancePolicy||!event.currentTarget.reportValidity())return;
  const data=new FormData(event.currentTarget),expectedRevision=clearancePolicy.revision,requiredTypes=data.getAll("requiredTypes"),reason=String(data.get("reason")||"").trim();
  void (async()=>{setSaving(true);try{await perform("save_enrollment_clearance_policy",{expectedRevision,requiredTypes,reason});closeClearancePolicy();selectedApplications.clear();await loadApplications();status.textContent="Clearance policy saved.";}catch(error){get("en-clearance-policy-status").textContent=error?.message||"Policy save failed.";}finally{setSaving(false);}})();
});
function openClearance(item){
  if(saving||item.status!=="accepted"||!item.clearanceRequired||get("en-clearance-policy-open").hidden)return;
  clearanceReview=item;const form=get("en-clearance-form");form.reset();get("en-clearance-target").textContent=item.displayName+" · "+item.reference;get("en-clearance-status").textContent="";get("en-clearance-dialog").showModal();
}
get("en-clearance-close").addEventListener("click",()=>{if(!saving)closeClearance();});
get("en-clearance-dialog").addEventListener("cancel",event=>{event.preventDefault();if(!saving)closeClearance();});
get("en-clearance-form").addEventListener("submit",event=>{
  event.preventDefault();if(saving||!clearanceReview||!event.currentTarget.reportValidity())return;
  const item=clearanceReview,data=new FormData(event.currentTarget),state=String(data.get("state")||""),reference=String(data.get("reference")||"").trim(),reason=String(data.get("reason")||"").trim(),confirmSourceReviewed=data.get("confirmSourceReviewed")!==null;
  void (async()=>{setSaving(true);try{await perform("record_enrollment_clearance",{applicationId:item.applicationId,expectedRevision:item.revision,expectedPolicyRevision:item.clearancePolicyRevision,state,reference,reason,confirmSourceReviewed});closeClearance();await loadApplications({refreshItem:item.applicationId});status.textContent="Enrollment clearance saved.";}catch(error){get("en-clearance-status").textContent=error?.message||"Clearance save failed.";}finally{setSaving(false);}})();
});
let requirementsReview=null,templateReview=null,templateLoadRun=0,correctionReview=null;
function closeCorrection(){
  correctionReview=null;for(const key of ["guardian","relationship","mobile","email","reason"])get("en-correction-"+key).value="";
  get("en-correction-dialog").close();
}
function openCorrection(item){
  if(saving||!["submitted","needs_information"].includes(item.status))return;
  correctionReview=item;get("en-correction-target").textContent=item.displayName+" · "+item.reference;
  for(const [key,value] of Object.entries({guardian:item.guardianName,relationship:item.guardianRelationship,mobile:item.guardianMobile,email:item.studentEmail,"email-type":item.studentEmailType||"personal",reason:""}))get("en-correction-"+key).value=value||"";
  options(get("en-correction-program"),catalog.programs||[],"No preference");get("en-correction-program").value=item.preferredProgramId||"";
  const required=gradeRequiresStudentEmail(item.incomingLevel);get("en-correction-email-label").hidden=!required;get("en-correction-email-type-label").hidden=!required;get("en-correction-email").required=required;
  get("en-correction-status").textContent="";get("en-correction-dialog").showModal();
}
get("en-correction-close").addEventListener("click",()=>{if(!saving)closeCorrection();});
get("en-correction-dialog").addEventListener("cancel",event=>{event.preventDefault();if(!saving)closeCorrection();});
get("en-correction-form").addEventListener("submit",event=>{
  event.preventDefault();if(saving||!correctionReview)return;
  const item=correctionReview,value=key=>get("en-correction-"+key).value.trim();
  void (async()=>{
    setSaving(true);get("en-correction-status").textContent="Saving…";
    try{
      await perform("correct_application",{applicationId:item.applicationId,expectedRevision:item.revision,guardianName:value("guardian"),guardianRelationship:value("relationship"),guardianMobile:value("mobile"),studentEmail:value("email"),studentEmailType:value("email-type"),preferredProgramId:value("program"),reason:value("reason")});
      closeCorrection();status.textContent="Correction saved. Review requirements again.";
      try{await loadApplications({refreshItem:item.applicationId});}catch{status.textContent="Correction saved. Refresh Admissions.";}
    }catch(error){get("en-correction-status").textContent=error?.message||"Correction failed.";}
    finally{setSaving(false);}
  })();
});
let documentReview=null,documentRun=0;
function closeDocuments(){
  ++documentRun;documentReview=null;get("en-documents-file").value="";get("en-documents-list").replaceChildren();get("en-documents-dialog").close();
}
function saveDocumentDownload(result){
  const bytes=Uint8Array.from(atob(result.base64),c=>c.charCodeAt(0)),ext=({"application/pdf":"pdf","image/jpeg":"jpg","image/png":"png"})[result.contentType];
  if(!ext)throw new Error("Unsupported document format.");
  const url=URL.createObjectURL(new Blob([bytes],{type:result.contentType})),link=document.createElement("a");
  link.href=url;link.download="admission-document."+ext;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function openDocuments(item){
  if(saving)return;
  const run=++documentRun;documentReview=item;
  get("en-documents-target").textContent=item.displayName+" · "+item.reference;
  get("en-documents-list").replaceChildren();get("en-documents-status").textContent="Loading…";
  get("en-documents-file").value="";
  const select=get("en-documents-requirement");select.replaceChildren(new Option("Choose requirement",""));
  for(const requirement of item.requirements||[])select.append(new Option(requirement.label,requirement.label));
  const editable=["submitted","needs_information"].includes(item.status);
  get("en-documents-form").hidden=!editable||!(item.requirements||[]).length;
  if(!get("en-documents-dialog").open)get("en-documents-dialog").showModal();
  try{
    const result=await perform("list_admission_documents",{applicationId:item.applicationId});
    if(run!==documentRun)return;
    const host=get("en-documents-list");
    for(const row of result.items||[]){
      const line=document.createElement("div");line.className="en-row";
      const name=document.createElement("span");name.textContent=row.label+" · "+Math.ceil(row.size/1024)+" KB"+(row.state==="pending"?" · Upload pending":"");line.append(name);
      const action=document.createElement("button");action.type="button";action.className="en-btn secondary";
      action.textContent=row.state==="stored"?"Download":"Cancel pending";
      if(row.state==="stored"||editable){
        action.addEventListener("click",()=>void (async()=>{
          if(saving||documentReview!==item)return;
          setSaving(true);get("en-documents-status").textContent="Working…";
          try{
            if(row.state==="stored"){saveDocumentDownload(await perform("download_admission_document",{applicationId:item.applicationId,documentId:row.documentId}));get("en-documents-status").textContent="Downloaded.";}
            else{await perform("cancel_admission_document",{applicationId:item.applicationId,documentId:row.documentId,expectedRevision:item.revision});closeDocuments();await loadApplications({refreshItem:item.applicationId});status.textContent="Pending upload cancelled.";}
          }catch(error){get("en-documents-status").textContent=error?.message||"Document action failed.";}
          finally{setSaving(false);}
        })());line.append(action);
      }
      host.append(line);
    }
    get("en-documents-status").textContent=result.items?.length?"":editable&&!item.requirements?.length?"Save the requirements checklist first.":"No documents stored.";
  }catch(error){if(run===documentRun)get("en-documents-status").textContent=error?.message||"Documents unavailable.";}
}
get("en-documents-close").addEventListener("click",()=>{if(!saving)closeDocuments();});
get("en-documents-dialog").addEventListener("cancel",event=>{event.preventDefault();if(!saving)closeDocuments();});
get("en-documents-form").addEventListener("submit",event=>{
  event.preventDefault();
  if(saving||!documentReview)return;
  const item=documentReview,file=get("en-documents-file").files?.[0],label=get("en-documents-requirement").value;
  if(!file||!label||file.size>2*1024*1024){get("en-documents-status").textContent="Choose a requirement and a supported file up to 2 MB.";return;}
  void (async()=>{
    setSaving(true);get("en-documents-status").textContent="Uploading…";
    try{
      const bytes=new Uint8Array(await file.arrayBuffer());let binary="";
      for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
      await perform("save_admission_document",{applicationId:item.applicationId,expectedRevision:item.revision,label,contentType:file.type,base64:btoa(binary)});
      closeDocuments();await loadApplications({refreshItem:item.applicationId});status.textContent="Document stored. Verify the requirement.";
    }catch(error){get("en-documents-status").textContent=(error?.message||"Upload failed.")+" Close and refresh before retrying the same file.";}
    finally{setSaving(false);}
  })();
});
function renderTemplateEditor(){
  const type=get("en-template-type").value||"new",template=templateReview?.templates.find(row=>row.type===type);
  get("en-template-labels").value=template?template.labels.join("\n"):"";
  get("en-template-reason").value="";
  get("en-template-save").disabled=!template||saving;
  get("en-template-status").textContent=template?(template.revision?"":"Not configured yet."):"Loading templates…";
}
function closeTemplateEditor(){
  ++templateLoadRun;templateReview=null;
  get("en-template-labels").value="";get("en-template-reason").value="";
  get("en-template-dialog").close();
}
async function openTemplateEditor(){
  if(saving||!picker.scope.current?.roles.includes("school_admin")||picker.scope.current.platformOverride)return;
  const run=++templateLoadRun;templateReview=null;
  get("en-template-type").value="new";renderTemplateEditor();
  get("en-template-dialog").showModal();
  try{
    const result=await perform("get_admission_templates");
    if(run!==templateLoadRun)return;
    templateReview={templates:result.templates||[]};renderTemplateEditor();
  }catch(error){if(run===templateLoadRun)get("en-template-status").textContent=error?.message||"Templates unavailable.";}
}
get("en-template-open").addEventListener("click",()=>void openTemplateEditor());
get("en-template-close").addEventListener("click",()=>{if(!saving)closeTemplateEditor();});
get("en-template-dialog").addEventListener("cancel",event=>{event.preventDefault();if(!saving)closeTemplateEditor();});
get("en-template-type").addEventListener("change",()=>{if(!saving)renderTemplateEditor();});
get("en-template-form").addEventListener("submit",event=>{
  event.preventDefault();
  if(saving||!templateReview)return;
  const type=get("en-template-type").value,template=templateReview.templates.find(row=>row.type===type);
  if(!template)return;
  const labels=get("en-template-labels").value.split(/\r?\n/).map(value=>value.trim()).filter(Boolean),
    reason=get("en-template-reason").value.trim();
  void (async()=>{
    setSaving(true);get("en-template-status").textContent="Saving…";
    try{
      const saved=await perform("save_admission_template",{type,labels,reason,expectedRevision:template.revision});
      templateReview.templates=templateReview.templates.map(row=>row.type===type?saved:row);
      renderTemplateEditor();get("en-template-status").textContent="Template saved.";
      try{await loadApplications();}catch{status.textContent="Template saved. Refresh applications.";}
    }catch(error){get("en-template-status").textContent=error?.message||"Template save failed.";}
    finally{setSaving(false);get("en-template-save").disabled=!templateReview;}
  })();
});
function renderRequirementRows(){
  const host=get("en-requirements-list");host.replaceChildren();
  if(!requirementsReview)return;
  const rows=requirementsReview.rows;
  get("en-requirements-add").disabled=rows.length>=24;
  if(rows.length)get("en-requirements-none").checked=false;
  get("en-requirements-none").disabled=rows.length>0;
  rows.forEach((item,index)=>{
    const row=document.createElement("div");row.className="en-requirement-row";
    const nameLabel=document.createElement("label");nameLabel.className="text-sm font-bold";nameLabel.textContent="Requirement";
    const name=document.createElement("input");name.className="en-input";name.type="text";name.maxLength=100;name.required=true;name.value=item.label;name.readOnly=Boolean(item.mandatory);
    name.addEventListener("input",()=>{item.label=name.value;});nameLabel.append(name);
    const statusLabel=document.createElement("label");statusLabel.className="text-sm font-bold";statusLabel.textContent="Status";
    const select=document.createElement("select");select.className="en-input";
    for(const [value,label] of [["missing","Missing"],["received","Received"],["verified","Verified"]]){
      const option=document.createElement("option");option.value=value;option.textContent=label;select.append(option);
    }
    select.value=item.status;select.addEventListener("change",()=>{item.status=select.value;});statusLabel.append(select);
    const remove=document.createElement("button");remove.type="button";remove.className="en-btn secondary";remove.textContent="Remove";
    remove.disabled=Boolean(item.mandatory);
    remove.addEventListener("click",()=>{if(!item.mandatory){rows.splice(index,1);renderRequirementRows();}});
    row.append(nameLabel,statusLabel,remove);host.append(row);
  });
}
function openRequirements(item){
  if(saving||!["submitted","needs_information"].includes(item.status))return;
  const normalize=value=>String(value||"").trim().toLowerCase();
  const mandatory=new Set((item.templateLabels||[]).map(normalize));
  const rows=(item.requirements||[]).map(row=>({label:row.label,status:row.status,mandatory:mandatory.has(normalize(row.label))}));
  for(const label of item.templateLabels||[])if(!rows.some(row=>normalize(row.label)===normalize(label)))rows.push({label,status:"missing",mandatory:true});
  requirementsReview={item,rows};
  get("en-requirements-target").textContent=item.displayName+" · "+item.reference;
  get("en-requirements-none").checked=item.noRequirements===true;
  get("en-requirements-reason").value="";
  get("en-requirements-status").textContent="";
  renderRequirementRows();get("en-requirements-dialog").showModal();
}
function closeRequirements(){
  requirementsReview=null;get("en-requirements-list").replaceChildren();get("en-requirements-reason").value="";
  get("en-requirements-none").checked=false;get("en-requirements-dialog").close();
}
get("en-requirements-close").addEventListener("click",()=>{if(!saving)closeRequirements();});
get("en-requirements-dialog").addEventListener("cancel",event=>{
  event.preventDefault();if(!saving)closeRequirements();
});
get("en-requirements-add").addEventListener("click",()=>{
  if(saving||!requirementsReview||requirementsReview.rows.length>=24)return;
  requirementsReview.rows.push({label:"",status:"missing"});renderRequirementRows();
});
get("en-requirements-form").addEventListener("submit",event=>{
  event.preventDefault();
  if(saving||!requirementsReview)return;
  const {item,rows}=requirementsReview,
    reason=get("en-requirements-reason").value.trim(),
    noRequirements=get("en-requirements-none").checked===true;
  if(!rows.length&&!noRequirements){get("en-requirements-status").textContent="Add requirements or confirm that none apply.";return;}
  void (async()=>{
    setSaving(true);get("en-requirements-status").textContent="Saving…";
    try{
      await perform("save_application_requirements",{applicationId:item.applicationId,
        expectedRevision:Number(item.revision)||1,expectedTemplateRevision:Number(item.templateRevision)||0,requirements:rows.map(row=>({label:row.label.trim(),status:row.status})),noRequirements,reason});
      closeRequirements();status.textContent="Requirements review saved.";
      try{await loadApplications({refreshItem:item.applicationId});}catch{status.textContent="Requirements saved. Refresh applications.";}
    }catch(error){get("en-requirements-status").textContent=error?.message||"Requirements review failed.";}
    finally{setSaving(false);if(requirementsReview)renderRequirementRows();}
  })();
});
async function linkReturningApplication(item){
  if(saving)return;
  const studentNumber=prompt("Enter the student's existing school student number:");
  if(!studentNumber?.trim())return;
  setSaving(true);status.textContent="Linking student…";
  try{
    await perform("bind_returning_application",{applicationId:item.applicationId,expectedRevision:item.revision,studentNumber:studentNumber.trim()});
    await loadApplications({refreshItem:item.applicationId});status.textContent="Existing student linked. Review requirements.";
  }catch(error){status.textContent=error?.message||"Student link failed.";}
  finally{setSaving(false);}
}
async function reviewApplication(item,nextStatus){
  if(saving)return;
  if(nextStatus==="accepted"&&!item.requirementsReady){status.textContent="Verify admission requirements before accepting.";return;}
  const label=({rejected:"rejection",needs_information:"request for more information",accepted:"acceptance after requirements review",submitted:"reopening for review"})[nextStatus];
  if(!label)return;
  const reason=prompt("Reason for "+label+":");
  if(!reason)return;
  setSaving(true);
  status.textContent="Saving enrollment review…";
  try{
    await perform("review_application",{applicationId:item.applicationId,status:nextStatus,
      expectedRevision:Number(item.revision)||1,reason});
    if(loadedApplication?.applicationId===item.applicationId)clearLoadedApplication({resetIdentity:true});
    const message=({rejected:"Application rejected.",needs_information:"Information requested.",accepted:"Application accepted. Ready for enrollment.",submitted:"Application reopened for review."})[nextStatus];
    status.textContent=message;
    try{await loadApplications({refreshItem:item.applicationId});}catch{status.textContent=message+" The list could not refresh. Use Refresh applications.";}
  }catch(error){status.textContent=error?.message||"Application review was not saved.";}
  finally{setSaving(false);}
}
let reportData=null,reportRun=0;
function clearReport(){
  ++reportRun;reportData=null;get("en-report-results").replaceChildren();get("en-report-headcount").replaceChildren();get("en-report-headcount").hidden=true;get("en-report-export").disabled=true;get("en-report-status").textContent="";
}
function refreshReportTerms(){
  const yearId=get("en-report-year").value,term=get("en-report-term");term.replaceChildren(new Option("All periods",""));
  for(const row of (catalog.terms||[]).filter(row=>row.yearId===yearId))term.append(new Option(row.name||row.id,row.id));
  term.value="";clearReport();
}
function refreshReportYears(){
  options(get("en-report-year"),catalog.years||[],"Choose academic year");refreshReportTerms();
}
get("en-report-year").addEventListener("change",refreshReportTerms);
get("en-report-term").addEventListener("change",clearReport);
const reportGroups=[["applications","Admissions · academic year"],["registrations","Registration records · selected period"],["documentRequests","Document requests · all years"]];
function reportLabel(value){return value.replaceAll("_"," ");}
function renderReport(data){
  const host=get("en-report-results");host.replaceChildren();
  for(const [key,label] of reportGroups){
    const card=document.createElement("section");card.className="en-summary";
    const title=document.createElement("h3");title.className="font-bold";title.textContent=label;card.append(title);
    const total=document.createElement("p");total.className="text-xl font-extrabold";total.textContent=String(data[key].total);card.append(total);
    for(const [state,count] of Object.entries(data[key].statuses)){
      const row=document.createElement("p");row.className="en-muted";row.textContent=reportLabel(state)+" · "+count;card.append(row);
    }
    host.append(card);
  }
  const head=get("en-report-headcount");head.replaceChildren();head.hidden=!data.headcount;
  if(data.headcount){
    const counts=data.headcount,title=document.createElement("h3");title.className="font-bold";title.textContent="Active learners · selected registration period";head.append(title);
    const summary=document.createElement("div");summary.className="en-summary";const metric=document.createElement("strong");metric.textContent=counts.uniqueLearners+" distinct registered learners";summary.append(metric);
    const detail=document.createElement("p");detail.className="en-muted";detail.textContent=counts.assignedLearners+" with a single resolved placement · "+counts.duplicateLearners+" duplicate placements · "+counts.unresolvedLearners+" unresolved placements · "+counts.invalidRecords+" invalid records";summary.append(detail);head.append(summary);
    if(counts.duplicateLearners||counts.unresolvedLearners||counts.invalidRecords){const warning=document.createElement("p");warning.className="en-notice";warning.textContent="Resolve placement conflicts before using section or grade totals. Conflicted learners are excluded from the breakdown.";head.append(warning);}
    for(const row of counts.byGrade){const line=document.createElement("p");line.className="en-muted";line.textContent=levelLabel(row.gradeLevel)+" · "+row.learnerCount+" learners";head.append(line);}
    for(const row of counts.bySection){const line=document.createElement("div");line.className="en-row";const name=document.createElement("strong"),total=document.createElement("span");name.textContent=row.sectionName+" · "+levelLabel(row.gradeLevel);total.textContent=String(row.learnerCount);line.append(name,total);head.append(line);}
  }
  get("en-report-status").textContent="Generated "+dateLabel(data.asOf)+(data.headcount?" · Active registration records as currently stored; headcount is distinct person IDs for the selected period.":" · Record counts. Choose one registration period for distinct headcount.");
  get("en-report-export").disabled=false;
}
get("en-report-load").addEventListener("click",()=>void (async()=>{
  if(saving)return;const yearId=get("en-report-year").value,termId=get("en-report-term").value;
  if(!yearId){get("en-report-status").textContent="Choose an academic year.";return;}
  clearReport();const run=reportRun;get("en-report-status").textContent="Generating…";
  try{const result=await perform("registrar_summary",{yearId,termId});if(run!==reportRun)return;reportData=result;renderReport(result);}
  catch(error){if(run===reportRun)get("en-report-status").textContent=error?.message||"Summary unavailable.";}
})());
get("en-report-export").addEventListener("click",()=>{
  if(!reportData||saving)return;
  const rows=[["year_id","term_id","scope","status","record_count","generated_at"],...reportGroups.flatMap(([key])=>[["total",reportData[key].total],...Object.entries(reportData[key].statuses)].map(([state,count])=>[key==="documentRequests"?"all":reportData.yearId,key==="registrations"?reportData.termId||"all":"all",key,state,count,new Date(reportData.asOf).toISOString()]))];
  const counts=reportData.headcount;
  if(counts){
    for(const key of ["activeRegistrationCount","uniqueLearners","assignedLearners","duplicateLearners","unresolvedLearners","invalidRecords"])rows.push([reportData.yearId,reportData.termId,"headcount",key,counts[key],new Date(reportData.asOf).toISOString()]);
    for(const row of counts.byGrade)rows.push([reportData.yearId,reportData.termId,"headcount_grade",row.gradeLevel,row.learnerCount,new Date(reportData.asOf).toISOString()]);
    for(const row of counts.bySection)rows.push([reportData.yearId,reportData.termId,"headcount_section",row.sectionName+" ("+row.sectionId+")",row.learnerCount,new Date(reportData.asOf).toISOString()]);
  }
  const csv=rows.map(row=>row.map(value=>{let cell=String(value??"");if(/^[\s]*[=+@-]/.test(cell)||/^[\t\r\n]/.test(cell))cell="'"+cell;return '"'+cell.replaceAll('"','""')+'"';}).join(",")).join("\r\n");
  const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"})),link=document.createElement("a");link.href=url;link.download="registrar-summary.csv";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
let applications=[],applicationCursor=null,applicationBusy=false;
let selectedApplications=new Map(),bulkReview=null;
function updateBulkControls(){
  get("en-bulk-open").disabled=saving||!selectedApplications.size;
  get("en-bulk-open").textContent="Enroll selected ("+selectedApplications.size+")";
  get("en-bulk-clear").hidden=!selectedApplications.size;
  get("en-bulk-clear").disabled=saving;
  get("en-applications-more").disabled=saving||applicationBusy;
}
function selectBulkApplication(item,checked){
  if(saving)return;
  if(!checked)selectedApplications.delete(item.applicationId);
  else{
    const first=selectedApplications.values().next().value;
    if(selectedApplications.size>=20){status.textContent="Select up to 20 accepted applicants.";renderApplications();return;}
    if(first&&(first.yearId!==item.yearId||first.incomingLevel!==item.incomingLevel)){status.textContent="Select applicants for the same school year and incoming grade.";renderApplications();return;}
    selectedApplications.set(item.applicationId,item);
  }
  updateBulkControls();
}
function closeBulk(){bulkReview=null;get("en-bulk-results").replaceChildren();get("en-bulk-dialog").close();}
function refreshBulkPlacement(){
  if(!bulkReview)return;
  const program=get("en-bulk-program").value;
  options(get("en-bulk-term"),catalog.terms.filter(row=>row.yearId===bulkReview.yearId&&row.programId===program),"Choose academic period");
  options(get("en-bulk-section"),catalog.sections.filter(row=>row.programId===program&&String(row.gradeLevel)===String(bulkReview.incomingLevel)),"Choose section");
}
function openBulk(){
  if(saving||!selectedApplications.size)return;
  const rows=[...selectedApplications.values()],first=rows[0];bulkReview={rows,yearId:first.yearId,incomingLevel:first.incomingLevel};
  get("en-bulk-target").textContent=rows.length+" applicants · "+levelLabel(first.incomingLevel)+" · "+(catalog.years.find(row=>row.id===first.yearId)?.name||first.yearId);
  get("en-bulk-results").replaceChildren();get("en-bulk-status").textContent="";get("en-bulk-apply").hidden=false;
  get("en-bulk-program").value="";get("en-bulk-term").value="";get("en-bulk-section").value="";
  options(get("en-bulk-program"),catalog.programs.filter(row=>catalog.sections.some(section=>section.programId===row.id&&String(section.gradeLevel)===String(first.incomingLevel))),"Choose program");
  refreshBulkPlacement();get("en-bulk-dialog").showModal();
}
get("en-bulk-open").addEventListener("click",openBulk);
get("en-bulk-clear").addEventListener("click",()=>{if(!saving){selectedApplications.clear();renderApplications();}});
get("en-bulk-close").addEventListener("click",()=>{if(!saving)closeBulk();});
get("en-bulk-dialog").addEventListener("cancel",event=>{event.preventDefault();if(!saving)closeBulk();});
get("en-bulk-program").addEventListener("change",refreshBulkPlacement);
function bulkRegistrationPayload(item,placement){
  return {...placement,applicationId:item.applicationId,applicationRevision:item.revision,personId:item.personId||"",
    displayName:item.displayName,birthDate:item.birthDate,studentNumber:item.studentNumber||"",guardianName:item.guardianName,
    guardianRelationship:item.guardianRelationship,guardianEmail:item.guardianEmail,guardianMobile:item.guardianMobile||"",studentEmail:item.studentEmail||"",studentEmailType:item.studentEmailType||""};
}
get("en-bulk-form").addEventListener("submit",event=>{
  event.preventDefault();if(saving||!bulkReview)return;
  const rows=bulkReview.rows.slice(),placement={yearId:bulkReview.yearId,programId:get("en-bulk-program").value,termId:get("en-bulk-term").value,sectionId:get("en-bulk-section").value};
  if(!placement.programId||!placement.termId||!placement.sectionId)return;
  if(!confirm("Enroll "+rows.length+" accepted applicants in the selected section? Each is validated and committed independently."))return;
  void (async()=>{
    setSaving(true);let succeeded=0,failed=0;const host=get("en-bulk-results");host.replaceChildren();
    try{
      for(const item of rows){
        get("en-bulk-status").textContent="Processing "+(succeeded+failed+1)+" / "+rows.length;
        const line=document.createElement("p");line.className="en-muted";
        try{await perform("register_student",bulkRegistrationPayload(item,placement));succeeded++;line.textContent=item.displayName+" · Enrolled";selectedApplications.delete(item.applicationId);}
        catch(error){failed++;line.textContent=item.displayName+" · "+(error?.message||"Enrollment failed");}
        host.append(line);
      }
      await Promise.allSettled([loadRegistrations(),loadApplications()]);
      get("en-bulk-status").textContent=succeeded+" enrolled · "+failed+" not enrolled. Review individual results.";
      get("en-bulk-apply").hidden=true;
    }finally{setSaving(false);renderApplications();}
  })();
});
function renderApplications(){
  const host=get("en-application-list");host.replaceChildren();
  const query=String(get("en-application-search").value||"").trim().toLowerCase();
  const filter=get("en-application-status").value||"pending";
  const items=applications.filter(item=>{
    const matchesStatus=filter==="all"||(filter==="pending"?["submitted","needs_information","accepted"].includes(item.status):item.status===filter);
    return matchesStatus&&(!query||[item.displayName,item.reference,item.applicationType].some(v=>String(v||"").toLowerCase().includes(query)));
  });
  updateBulkControls();
  get("en-applications-more").hidden=!applicationCursor;
  get("en-applications-more").disabled=saving||applicationBusy;
  get("en-applications-count").textContent=items.length+" matching · "+applications.length+" scanned"+(applicationCursor?" · more records available":"");
  if(!items.length){
    const empty=document.createElement("p");empty.className="en-muted";
    empty.textContent=applicationCursor?"No matches in loaded records. Load more to continue searching.":applications.length?"No applications match these filters.":"No applications loaded.";host.append(empty);return;
  }
  for(const item of items){
    const row=document.createElement("article");row.className="en-row";row.setAttribute("role","listitem");
    const info=document.createElement("div"),name=document.createElement("strong"),meta=document.createElement("p"),
      contacts=document.createElement("p");
    name.textContent=item.displayName;meta.className="en-muted";contacts.className="en-muted";
    meta.textContent=applicationMeta(item)+" · "+(item.applicationType||"new")+" · "+(item.source==="onsite"?"Onsite":"Online");
    contacts.textContent=item.guardianName+" · "+item.guardianEmail+
      (item.studentEmail?" · student: "+item.studentEmail:" · guardian-managed learner");
    info.append(name,meta,contacts);
    if(item.status==="accepted"&&item.requirementsReady&&item.clearanceReady!==false){
      const selectLabel=document.createElement("label");selectLabel.className="en-muted";
      const checkbox=document.createElement("input");checkbox.type="checkbox";checkbox.checked=selectedApplications.has(item.applicationId);checkbox.disabled=saving;
      checkbox.addEventListener("change",()=>selectBulkApplication(item,checkbox.checked));const selectText=document.createElement("span");selectText.textContent=" Select for bulk enrollment";selectLabel.append(checkbox,selectText);info.append(selectLabel);
    }
    if(["submitted","needs_information","accepted"].includes(item.status)){
      const requirements=document.createElement("p");requirements.className="en-muted";
      const total=item.requirements?.length||0,verified=(item.requirements||[]).filter(row=>row.status==="verified").length;
      requirements.textContent=item.requirementsReady?"Requirements verified":item.requirementsReviewed?verified+" / "+total+" verified":"Requirements review pending";
      info.append(requirements);
    }
    if(item.reviewReason){
      const note=document.createElement("p");note.className="en-muted";note.textContent="Review note: "+item.reviewReason;info.append(note);
    }
    const actions=document.createElement("div");actions.style.cssText="display:flex;gap:.4rem;flex-wrap:wrap;justify-content:flex-end";
    const badge=document.createElement("span");badge.className="en-badge";badge.textContent=item.status.replaceAll("_"," ");
    actions.append(badge);
    const addAction=(label,callback,primary=false)=>{
      const control=document.createElement("button");control.type="button";control.className="en-btn"+(primary?"":" secondary");
      control.textContent=label;control.addEventListener("click",callback);actions.append(control);
    };
    addAction("Documents",()=>void openDocuments(item));
    if(item.status==="accepted"&&item.clearanceRequired){const state=document.createElement("p");state.className="en-muted";state.textContent=item.clearanceReady?"Clearance recorded":"Clearance "+(item.clearanceState==="held"?"on hold":"pending");info.append(state);if(!get("en-clearance-policy-open").hidden)addAction("Clearance",()=>openClearance(item),!item.clearanceReady);}
    if(item.status==="accepted"&&item.requirementsReady&&item.clearanceReady!==false)addAction("Enroll",()=>loadApplicationIntoForm(item),true);
    if(["submitted","needs_information"].includes(item.status)){
      if(item.applicationType==="returning"&&!item.personId)addAction("Link student",()=>void linkReturningApplication(item),true);
      addAction("Correct",()=>openCorrection(item));
      addAction("Requirements",()=>openRequirements(item),!item.requirementsReady);
      if(item.requirementsReady&&(item.applicationType!=="returning"||item.personId))addAction("Accept",()=>void reviewApplication(item,"accepted"),true);
    }
    if(["submitted","accepted"].includes(item.status))addAction("Needs info",()=>void reviewApplication(item,"needs_information"));
    if(item.status==="needs_information")addAction("Reopen review",()=>void reviewApplication(item,"submitted"));
    if(["submitted","needs_information","accepted"].includes(item.status))addAction("Reject",()=>void reviewApplication(item,"rejected"));
    row.append(info,actions);host.append(row);
  }
  if(saving)for(const button of host.querySelectorAll("button"))button.disabled=true;
}
async function loadApplications({more=false,refreshItem=null}={}){
  if(more&&(!applicationCursor||applicationBusy||saving))return;
  const cursor=more?applicationCursor:null;applicationBusy=true;
  try{
    const result=await latest("applications","list_applications",refreshItem?{applicationId:refreshItem}:cursor?{cursor}:{});
    if(!result)return;
    const rows=new Map((more||refreshItem?applications:[]).map(item=>[item.applicationId,item]));
    for(const item of result.items||[])rows.set(item.applicationId,item);
    applications=[...rows.values()].sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));if(!refreshItem)applicationCursor=result.nextCursor||null;
    for(const [id,old] of selectedApplications){const current=rows.get(id);if(!current||current.revision!==old.revision||current.status!=="accepted"||!current.requirementsReady||current.clearanceReady===false)selectedApplications.delete(id);}
  }finally{applicationBusy=false;renderApplications();}
}
get("en-applications-more").addEventListener("click",()=>void loadApplications({more:true}).catch(error=>{status.textContent=error?.message||"More applications could not be loaded.";}));
get("en-application-search").addEventListener("input",renderApplications);
get("en-application-status").addEventListener("change",renderApplications);
async function refreshAll(){
  const version=++refreshVersion;
  status.textContent="Loading enrollment configuration…";
  if(!await loadCatalog()||version!==refreshVersion)return;
  const outcomes=await Promise.allSettled([loadApplications(),loadRegistrations()]);
  if(version!==refreshVersion)return;
  const unavailable=["Online applications","Current registrations"].filter((_,index)=>outcomes[index].status==="rejected");
  status.textContent=unavailable.length?unavailable.join(" and ")+" could not refresh. Available results remain usable; use Refresh to retry.":"";
  if(requestedPersonId&&!loadedApplication&&!loadedPerson&&version===refreshVersion){
    const personId=requestedPersonId;requestedPersonId="";
    if(requestedSchoolId&&requestedSchoolId!==picker.scope.current.schoolId){
      status.textContent="The linked student belongs to a different school. Select the intended school.";return;
    }
    await loadStudentCandidate(personId);
  }
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
  const applicationType=loadedPerson?"returning":get("en-applicant-type").value||"new";
  if(!loadedApplication&&applicationType==="returning"&&!loadedPerson){status.textContent="Find the existing student in Student Records first.";return;}
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
      const result=await perform(loadedApplication?"register_student":"create_onsite_application",{
        applicationType,
        applicationId:String(data.get("applicationId")||""),
        applicationRevision:loadedApplication?Number(loadedApplication.revision)||1:null,
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
      if(!loadedApplication){
        clearLoadedApplication({resetIdentity:true});get("en-application-search").value=result.reference||"";get("en-application-status").value="pending";
        showEnrollmentView("applications");status.textContent="Application saved. Review requirements and accept before enrollment.";
        try{await loadApplications({refreshItem:result.applicationId});}catch{status.textContent="Application saved. Refresh Admissions to continue review.";}return;
      }
      status.textContent=result.displayName+" enrolled · "+result.courseCount+
        " active subject enrollment"+(result.courseCount===1?"":"s")+" · "+
        (result.accountResponsibility==="guardian"
          ?"guardian-managed learner; no student account required yet."
          :(result.accountLinked?"student account already linked.":"student account ready for email activation."));
      clearLoadedApplication({resetIdentity:true});
      form.elements.studentNumber.value="";
      showEnrollmentView("registrations");
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
    if(requirementsReview&&!confirm("Discard the open requirements review?"))throw new Error("Finish the requirements review before switching schools.");
    if(requirementsReview)closeRequirements();
    if(correctionReview&&!confirm("Discard the open correction?"))throw new Error("Finish the correction before switching schools.");
    if(correctionReview)closeCorrection();
    if(documentReview)closeDocuments();
    if(bulkReview)closeBulk();selectedApplications.clear();clearReport();get("en-report-year").replaceChildren();get("en-report-term").replaceChildren();
    if(get("en-template-dialog").open&&!confirm("Discard the open template editor?"))throw new Error("Finish the template edit before switching schools.");
    closeTemplateEditor();get("en-template-open").hidden=true;closeClearance();closeClearancePolicy();get("en-clearance-policy-open").hidden=true;
    ++refreshVersion;requestedPersonId="";activeEnrollmentView="registrations";
    for(const source of Object.keys(requestVersions))++requestVersions[source];
    loadedApplication=null;loadedPerson=null;registrationChange=null;progressionChange=null;cohortPreview=null;draftDirty=false;registrations=[];
    ++progressionPreviewRun;++historyRun;++cohortRun;
    form.elements.displayName.readOnly=false;
    catalog={years:[],programs:[],terms:[],sections:[],subjects:[],offerings:[]};
    if(get("en-registration-change-dialog").open)get("en-registration-change-dialog").close();
    if(get("en-progression-dialog").open)get("en-progression-dialog").close();
    if(get("en-history-dialog").open)get("en-history-dialog").close();
    form.reset();cohortForm().reset();clearLoadedApplication({resetIdentity:true});
    registrations=[];registrationCursor=null;registrationBusy=false;legacyRegistrations=[];legacyCursor=null;legacyScanned=false;legacyBusy=false;legacyBlocked=0;get("en-legacy-scan-status").textContent="";get("en-registrations-count").textContent="";
    applications=[];applicationCursor=null;applicationBusy=false;get("en-applications-more").hidden=true;get("en-applications-count").textContent="";get("en-application-search").value="";get("en-application-status").value="pending";
    get("en-application-list").replaceChildren();get("en-registration-list").replaceChildren();
    get("en-cohort-results").replaceChildren();get("en-cohort-status").textContent="Choose a source cohort and decision.";
    renderActivation("");get("en-admin-tools").hidden=true;workspace.hidden=true;
  },
  onReady:scope=>{
    const current=scope.current;
    if(!current?.roles.some(role=>["school_admin","registrar"].includes(role))){
      workspace.hidden=true;status.textContent="School Administrator or Registrar access is required for Enrollment.";return;
    }
    if(current.enrollmentMode!=="canonical"){
      workspace.hidden=true;
      status.textContent=current.roles.includes("school_admin")
        ?"Compatibility enrollment: use People & Access for existing class relationships."
        :"Compatibility enrollment: contact your School Administrator for placement.";
      return;
    }
    get("en-template-open").hidden=!current.roles.includes("school_admin")||current.platformOverride===true;get("en-clearance-policy-open").hidden=get("en-template-open").hidden;
    get("en-find-existing").href="school-student-records.html?schoolId="+encodeURIComponent(current.schoolId);
    showEnrollmentView(activeEnrollmentView);
    renderActivation(current.schoolId);workspace.hidden=false;
    void refreshAll().catch(error=>{status.textContent=error?.message||"Enrollment data could not be loaded.";});
  }
});
try{
  await picker.load();
  if(!auth.currentUser)status.textContent="Sign in to use school enrollment.";
}catch(error){status.textContent=error?.message||"Enrollment access could not be verified.";}