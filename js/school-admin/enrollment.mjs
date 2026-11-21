import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs";

const get=id=>document.getElementById(id);
const api=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolEnrollment");
const status=get("en-status"),workspace=get("en-workspace"),form=get("en-register-form");
let picker=null,catalog={years:[],programs:[],terms:[],sections:[],subjects:[],offerings:[]},
  saving=false,draftDirty=false,loadedApplication=null,registrations=[],registrationChange=null;
const requestVersions={catalog:0,applications:0,registrations:0};
let refreshVersion=0;

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
  for(const control of document.querySelectorAll("#en-application-list button, #en-clear-application, #en-refresh, #en-refresh-applications, #en-registration-change-dialog button, #en-registration-change-form textarea"))
    control.disabled=value;
  updateCoursePreview();
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
    row.yearId===yearId&&row.programId===programId&&row.termId===termId&&row.sectionId===sectionId);
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
    const badge=document.createElement("span");badge.className="en-badge";badge.dataset.state=item.status||"active";badge.textContent=item.status||"active";actions.append(badge);
    const identityLink=document.createElement("a");identityLink.className="en-btn secondary";identityLink.style.cssText="display:inline-flex;align-items:center;text-decoration:none";
    identityLink.textContent="Identity & access";identityLink.href="people-access.html?personId="+encodeURIComponent(item.personId)+"#people";actions.append(identityLink);
    if(item.status==="active"){
      const end=document.createElement("button");end.type="button";end.className="en-btn secondary";end.textContent="End / change placement";
      end.addEventListener("click",()=>openRegistrationChange(item,"end"));actions.append(end);
    }else if(item.status==="ended"){
      const restore=document.createElement("button");restore.type="button";restore.className="en-btn secondary";restore.textContent="Restore";
      restore.addEventListener("click",()=>openRegistrationChange(item,"restore"));actions.append(restore);
    }
    row.append(info,actions);host.append(row);
  }
}
async function loadRegistrations(){
  const result=await latest("registrations","list_registrations");
  if(!result)return;
  registrations=(result.items||[]).slice().sort((a,b)=>
    registrationLabel(a).localeCompare(registrationLabel(b))||a.displayName.localeCompare(b.displayName));
  renderRegistrations();
}
function openRegistrationChange(item,mode){
  if(saving)return;
  registrationChange={item,mode};
  const dialog=get("en-registration-change-dialog"),form=get("en-registration-change-form");
  form.reset();
  get("en-registration-change-title").textContent=mode==="restore"?"Restore registration":"End registration / prepare placement change";
  get("en-registration-change-target").textContent=item.displayName+" · "+registrationLabel(item);
  get("en-registration-change-help").textContent=mode==="restore"
    ?"Restore only the subject enrollments that were ended with this registration. Restoration is blocked if another active official placement exists or required course offerings are no longer active."
    :"This ends the official registration and its currently active subject enrollments without deleting history or the student identity. Afterward, use the enrollment form to create a corrected/new placement if needed.";
  const confirmButton=get("en-registration-change-confirm");
  confirmButton.textContent=mode==="restore"?"Restore registration":"End registration";
  confirmButton.style.background=mode==="restore"?"#166534":"#9a3412";
  confirmButton.style.borderColor=mode==="restore"?"#166534":"#9a3412";
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
get("en-registration-change-form").addEventListener("submit",event=>{
  event.preventDefault();
  if(saving||!registrationChange||!event.currentTarget.reportValidity())return;
  const {item,mode}=registrationChange,reason=String(new FormData(event.currentTarget).get("reason")||"").trim();
  const action=mode==="restore"?"restore_registration":"end_registration";
  void (async()=>{
    setSaving(true);
    status.textContent=mode==="restore"?"Restoring official registration…":"Ending official registration and subject enrollments…";
    try{
      const result=await perform(action,{registrationId:item.registrationId,reason});
      const message=mode==="restore"
        ?item.displayName+" restored · "+result.courseCount+" subject enrollment"+(result.courseCount===1?"":"s")+" reactivated."
        :item.displayName+" ended · "+result.courseCount+" active subject enrollment"+(result.courseCount===1?"":"s")+" ended. A corrected placement can now be registered if needed.";
      registrationChange=null;get("en-registration-change-dialog").close();
      await loadRegistrations();
      status.textContent=message;
    }catch(error){status.textContent=error?.message||"The registration change was not saved.";}
    finally{setSaving(false);}
  })();
});
function applicationMeta(item){
  const year=catalog.years.find(x=>x.id===item.yearId)?.name||item.yearId;
  const program=catalog.programs.find(x=>x.id===item.preferredProgramId)?.name||"No program preference";
  return [item.reference,year,levelLabel(item.incomingLevel),program].filter(Boolean).join(" · ");
}
function loadApplicationIntoForm(item){
  if(saving||loadedApplication?.applicationId===item.applicationId||!discardDraft())return;
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
  loadedApplication=null;form.elements.applicationId.value="";
  get("en-register-title").textContent="Onsite / manual enrollment";
  get("en-register-help").textContent="Use this for walk-in enrollees. Online applications can be loaded here from the review queue before official placement.";
  get("en-clear-application").hidden=true;
  if(resetIdentity){
    for(const name of ["displayName","birthDate","studentNumber","guardianName","guardianRelationship","guardianEmail","guardianMobile","studentEmail"])
      form.elements[name].value="";
    form.elements.studentEmailType.value="personal";
  }
  refreshPlacement();
  draftDirty=false;
}
async function reviewApplication(item,nextStatus){
  if(saving)return;
  const label=nextStatus==="rejected"?"rejection":"request for more information";
  const reason=prompt("Enter the reason for this "+label+". This is recorded in the enrollment review history.");
  if(!reason)return;
  setSaving(true);
  status.textContent="Saving enrollment review…";
  try{
    await perform("review_application",{applicationId:item.applicationId,status:nextStatus,reason});
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
}
let activation="";
function renderActivation(schoolId){
  const input=get("en-activation-link"),open=get("en-open-activation");
  if(!schoolId){
    activation="";input.value="";open.removeAttribute("href");return;
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
get("en-registration-search")?.addEventListener("input",renderRegistrations);
get("en-registration-section")?.addEventListener("change",renderRegistrations);
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
      :"Registering onsite student and creating section subject enrollments…";
    try{
      const result=await perform("register_student",{
        applicationId:String(data.get("applicationId")||""),
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
    loadedApplication=null;registrationChange=null;draftDirty=false;registrations=[];
    catalog={years:[],programs:[],terms:[],sections:[],subjects:[],offerings:[]};
    if(get("en-registration-change-dialog").open)get("en-registration-change-dialog").close();
    form.reset();clearLoadedApplication({resetIdentity:true});
    get("en-application-list").replaceChildren();get("en-registration-list").replaceChildren();
    renderActivation("");workspace.hidden=true;
  },
  onReady:scope=>{
    const current=scope.current;
    if(!current?.roles.includes("school_admin")){
      workspace.hidden=true;status.textContent="School Administrator access is required for Enrollment during this phase.";return;
    }
    if(current.compatibilityMode!=="v4_only"){
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