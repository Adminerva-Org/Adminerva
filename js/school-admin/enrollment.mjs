import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs";

const get=id=>document.getElementById(id);
const api=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolEnrollment");
const status=get("en-status"),workspace=get("en-workspace"),form=get("en-register-form");
let picker=null,catalog={years:[],programs:[],terms:[],sections:[],subjects:[],offerings:[]},
  saving=false,loadedApplication=null,registrations=[];

function assistMode(){
  try{return sessionStorage.getItem("Adminerva_platform_school_mode")==="assist"?"assist":"";}catch{return "";}
}
function perform(action,details={}){
  const lease=picker.scope.lease();
  return api({schoolId:lease.schoolId,action,...details,...(assistMode()?{platformMode:"assist"}:{})})
    .then(response=>{picker.scope.assertLease(lease);return response.data;});
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
  catalog=await perform("catalog");
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
    const identity=item.accountResponsibility==="guardian"
      ?"guardian-managed · no student login required"
      :(item.accountLinked?"student account linked":"student activation pending");
    meta.textContent=registrationLabel(item)+" · "+item.courseCount+" subject"+(item.courseCount===1?"":"s")+
      (item.studentNumber?" · "+item.studentNumber:"")+" · "+identity+" · "+(item.source==="online"?"online application":"onsite");
    info.append(name,meta);
    const badge=document.createElement("span");badge.className="en-badge";badge.textContent=item.status||"active";
    row.append(info,badge);host.append(row);
  }
}
async function loadRegistrations(){
  const result=await perform("list_registrations");
  registrations=(result.items||[]).slice().sort((a,b)=>
    registrationLabel(a).localeCompare(registrationLabel(b))||a.displayName.localeCompare(b.displayName));
  renderRegistrations();
}
function applicationMeta(item){
  const year=catalog.years.find(x=>x.id===item.yearId)?.name||item.yearId;
  const program=catalog.programs.find(x=>x.id===item.preferredProgramId)?.name||"No program preference";
  return [item.reference,year,levelLabel(item.incomingLevel),program].filter(Boolean).join(" · ");
}
function loadApplicationIntoForm(item){
  loadedApplication=item;
  form.elements.applicationId.value=item.applicationId;
  form.elements.displayName.value=item.displayName||"";
  form.elements.birthDate.value=item.birthDate||"";
  form.elements.guardianName.value=item.guardianName||"";
  form.elements.guardianRelationship.value=item.guardianRelationship||"";
  form.elements.guardianEmail.value=item.guardianEmail||"";
  form.elements.guardianMobile.value=item.guardianMobile||"";
  form.elements.studentEmail.value=item.studentEmail||"";
  form.elements.studentEmailType.value=item.studentEmailType||"personal";
  if((catalog.years||[]).some(row=>row.id===item.yearId))form.elements.yearId.value=item.yearId;
  if((catalog.programs||[]).some(row=>row.id===item.preferredProgramId))form.elements.programId.value=item.preferredProgramId;
  get("en-register-title").textContent="Review & place online application";
  get("en-register-help").textContent=item.reference+" · "+levelLabel(item.incomingLevel)+
    ". Confirm official program, period and section before enrollment.";
  get("en-clear-application").hidden=false;
  refreshPlacement();
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
}
async function reviewApplication(item,nextStatus){
  if(saving)return;
  const label=nextStatus==="rejected"?"rejection":"request for more information";
  const reason=prompt("Enter the reason for this "+label+". This is recorded in the enrollment review history.");
  if(!reason)return;
  saving=true;
  status.textContent="Saving enrollment review…";
  try{
    await perform("review_application",{applicationId:item.applicationId,status:nextStatus,reason});
    const message=nextStatus==="rejected"?"Application rejected.":"Application marked as needing information.";
    status.textContent=message;
    try{await loadApplications();}catch{status.textContent=message+" The list could not refresh. Use Refresh applications.";}
  }catch(error){status.textContent=error?.message||"Application review was not saved.";}
  finally{saving=false;updateCoursePreview();}
}
async function loadApplications(){
  const result=await perform("list_applications"),host=get("en-application-list");
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
}
async function refreshAll(){
  status.textContent="Loading enrollment configuration…";
  await loadCatalog();
  await Promise.all([loadApplications(),loadRegistrations()]);
  status.textContent="";
}
function activationUrl(){
  const url=new URL("join-school.html",location.href);
  url.searchParams.set("schoolId","manila-cathedral-school");
  url.searchParams.set("mode","roster");
  return url.href;
}
const activation=activationUrl();
get("en-activation-link").value=activation;get("en-open-activation").href=activation;
get("en-copy-activation").addEventListener("click",async()=>{
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
get("en-clear-application").addEventListener("click",()=>clearLoadedApplication({resetIdentity:true}));
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
    saving=true;get("en-register-button").disabled=true;
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
    finally{saving=false;updateCoursePreview();}
  })();
});
get("en-refresh").addEventListener("click",()=>void refreshAll().catch(error=>{
  status.textContent=error?.message||"Enrollment data could not be refreshed.";
}));

picker=createTenantSchoolPicker({
  host:get("en-school-picker"),status,
  onBeforeChange:async()=>{
    if(saving)throw new Error("Finish the current enrollment before switching schools.");
    loadedApplication=null;workspace.hidden=true;
  },
  onReady:scope=>{
    const current=scope.current;
    if(!current?.roles.includes("school_admin")){
      workspace.hidden=true;status.textContent="School Administrator access is required for Enrollment during this phase.";return;
    }
    if(current.schoolId!=="manila-cathedral-school"||current.compatibilityMode!=="v4_only"){
      workspace.hidden=true;
      status.textContent="This standard Enrollment workspace is isolated to Manila Cathedral School. The legacy-compatible pilot remains on its existing workflow.";
      return;
    }
    workspace.hidden=false;
    void refreshAll().catch(error=>{status.textContent=error?.message||"Enrollment data could not be loaded.";});
  }
});
try{
  await picker.load();
  if(!auth.currentUser)status.textContent="Sign in to use school enrollment.";
}catch(error){status.textContent=error?.message||"Enrollment access could not be verified.";}