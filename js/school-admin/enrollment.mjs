import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs";

const get=id=>document.getElementById(id);
const api=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolEnrollment");
const status=get("en-status"),workspace=get("en-workspace"),form=get("en-register-form");
let picker=null,catalog={years:[],programs:[],terms:[],sections:[],offerings:[]},saving=false;

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
}
function selected(name){return String(form.elements[name].value||"");}
function refreshPlacement(){
  const yearId=selected("yearId"),programId=selected("programId");
  const terms=catalog.terms.filter(row=>
    (!yearId||row.yearId===yearId)&&(!programId||row.programId===programId));
  const sections=catalog.sections.filter(row=>!programId||row.programId===programId);
  options(form.elements.termId,terms,"Choose academic period");
  options(form.elements.sectionId,sections,"Choose section");
  updateCoursePreview();
}
function updateCoursePreview(){
  const yearId=selected("yearId"),programId=selected("programId"),
    termId=selected("termId"),sectionId=selected("sectionId");
  const count=catalog.offerings.filter(row=>
    row.yearId===yearId&&row.programId===programId&&row.termId===termId&&row.sectionId===sectionId).length;
  get("en-course-preview").textContent=!yearId||!programId||!termId||!sectionId
    ?"Choose the academic placement to see how many active subject offerings will be enrolled."
    :count
      ?count+" active subject offering"+(count===1?"":"s")+" will be enrolled for this section and period."
      :"No active subject offerings match this placement. Configure the section subjects before enrolling students.";
  get("en-register-button").disabled=saving||count===0;
}
async function loadCatalog(){
  catalog=await perform("catalog");
  options(form.elements.yearId,catalog.years||[],"Choose academic year");
  options(form.elements.programId,catalog.programs||[],"Choose program / division");
  blank(form.elements.termId,"Choose academic period");
  blank(form.elements.sectionId,"Choose section");
  updateCoursePreview();
}
function registrationLabel(row){
  const year=catalog.years.find(x=>x.id===row.yearId)?.name||row.yearId;
  const program=catalog.programs.find(x=>x.id===row.programId)?.name||row.programId;
  const term=catalog.terms.find(x=>x.id===row.termId)?.name||row.termId;
  const section=catalog.sections.find(x=>x.id===row.sectionId)?.name||row.sectionId;
  return [year,program,term,section].filter(Boolean).join(" · ");
}
async function loadRegistrations(){
  const result=await perform("list_registrations"),host=get("en-registration-list");
  host.replaceChildren();
  const items=result.items||[];
  if(!items.length){
    const empty=document.createElement("p");empty.className="en-muted";
    empty.textContent="No standard enrollment registrations yet.";host.append(empty);return;
  }
  for(const item of items){
    const row=document.createElement("article");row.className="en-row";row.setAttribute("role","listitem");
    const info=document.createElement("div"),name=document.createElement("strong"),meta=document.createElement("p");
    name.textContent=item.displayName;meta.className="en-muted";
    meta.textContent=registrationLabel(item)+" · "+item.courseCount+" subject"+(item.courseCount===1?"":"s")+
      (item.studentNumber?" · "+item.studentNumber:"")+(item.accountLinked?" · account linked":" · awaiting activation");
    info.append(name,meta);
    const badge=document.createElement("span");badge.className="en-badge";badge.textContent=item.status||"active";
    row.append(info,badge);host.append(row);
  }
}
async function refreshAll(){
  status.textContent="Loading enrollment configuration…";
  await loadCatalog();
  await loadRegistrations();
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
    get("en-activation-status").textContent="Activation link copied. It is reusable and still requires an exact verified roster email match.";
  }catch{
    get("en-activation-link").focus();get("en-activation-link").select();
    get("en-activation-status").textContent="Clipboard access was blocked. The activation link is selected for manual copying.";
  }
});
form.elements.yearId.addEventListener("change",refreshPlacement);
form.elements.programId.addEventListener("change",refreshPlacement);
form.elements.termId.addEventListener("change",updateCoursePreview);
form.elements.sectionId.addEventListener("change",updateCoursePreview);
form.addEventListener("submit",event=>{
  event.preventDefault();if(saving||!form.reportValidity())return;
  const data=new FormData(form);
  void (async()=>{
    saving=true;get("en-register-button").disabled=true;status.textContent="Registering student and creating section subject enrollments…";
    try{
      const result=await perform("register_student",{
        displayName:String(data.get("displayName")||"").trim(),
        activationEmail:String(data.get("activationEmail")||"").trim(),
        studentNumber:String(data.get("studentNumber")||"").trim(),
        yearId:String(data.get("yearId")||""),programId:String(data.get("programId")||""),
        termId:String(data.get("termId")||""),sectionId:String(data.get("sectionId")||"")
      });
      status.textContent=result.displayName+" registered · "+result.courseCount+
        " active subject enrollment"+(result.courseCount===1?"":"s")+
        (result.accountLinked?" · existing account remains linked.":" · ready for verified-email activation.");
      form.elements.displayName.value="";form.elements.activationEmail.value="";form.elements.studentNumber.value="";
      await loadRegistrations();
    }catch(error){status.textContent=error?.message||"Student enrollment was not saved.";}
    finally{saving=false;updateCoursePreview();}
  })();
});
get("en-refresh").addEventListener("click",()=>void refreshAll().catch(error=>{
  status.textContent=error?.message||"Enrollment data could not be refreshed.";
}));

picker=createTenantSchoolPicker({
  host:get("en-school-picker"),status,
  onBeforeChange:async()=>{if(saving)throw new Error("Finish the current enrollment before switching schools.");workspace.hidden=true;},
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
