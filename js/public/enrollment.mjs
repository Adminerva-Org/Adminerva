import {app} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";

const get=id=>document.getElementById(id);
const api=httpsCallable(getFunctions(app,"asia-southeast1"),"publicSchoolEnrollment");
const form=get("pe-form"),status=get("pe-status"),shell=get("pe-form-shell"),success=get("pe-success");
let catalog={years:[],programs:[]},submitting=false;

function gradeRequiresStudentEmail(level){
  const value=String(level||"").toLowerCase();
  return value==="sned_jhs"||(/^\d+$/.test(value)&&Number(value)>=7);
}
function fillSelect(select,items,placeholder,{optional=false}={}){
  select.replaceChildren();
  const first=document.createElement("option");
  first.value="";first.textContent=placeholder;first.selected=true;
  if(!optional)first.disabled=true;
  select.append(first);
  for(const item of items){
    const option=document.createElement("option");
    option.value=item.id;option.textContent=item.name||item.id;select.append(option);
  }
}
function updateEmailPolicy(){
  const level=form.elements.incomingLevel.value;
  const required=gradeRequiresStudentEmail(level);
  const emailPanel=get("pe-student-email"),guardianPanel=get("pe-guardian-managed");
  emailPanel.hidden=!required;guardianPanel.hidden=required;
  form.elements.studentEmail.required=required;
  form.elements.studentEmailType.required=required;
  if(!required){
    form.elements.studentEmail.value="";
    form.elements.studentEmailType.value="personal";
  }
}
async function load(){
  status.textContent="Loading Manila Cathedral School enrollment options…";
  const response=await api({action:"catalog",schoolId:"manila-cathedral-school"});
  catalog=response.data||{};
  fillSelect(form.elements.yearId,catalog.years||[],"Choose school year");
  fillSelect(form.elements.preferredProgramId,catalog.programs||[],"No preference",{optional:true});
  shell.hidden=false;status.textContent="";
}
form.elements.incomingLevel.addEventListener("change",updateEmailPolicy);
form.addEventListener("submit",event=>{
  event.preventDefault();
  updateEmailPolicy();
  if(submitting||!form.reportValidity())return;
  const data=new FormData(form);
  const guardianEmail=String(data.get("guardianEmail")||"").trim().toLowerCase();
  const studentEmail=String(data.get("studentEmail")||"").trim().toLowerCase();
  if(studentEmail&&studentEmail===guardianEmail){
    status.textContent="Student and parent/guardian email must be different.";
    form.elements.studentEmail.focus();return;
  }
  void (async()=>{
    submitting=true;get("pe-submit").disabled=true;
    status.textContent="Submitting enrollment application securely…";
    try{
      const response=await api({
        action:"submit_application",schoolId:"manila-cathedral-school",
        applicationType:String(data.get("applicationType")||""),
        yearId:String(data.get("yearId")||""),
        preferredProgramId:String(data.get("preferredProgramId")||""),
        displayName:String(data.get("displayName")||"").trim(),
        birthDate:String(data.get("birthDate")||""),
        incomingLevel:String(data.get("incomingLevel")||""),
        studentEmail,
        studentEmailType:studentEmail?String(data.get("studentEmailType")||"personal"):"",
        guardianName:String(data.get("guardianName")||"").trim(),
        guardianRelationship:String(data.get("guardianRelationship")||"").trim(),
        guardianEmail,
        guardianMobile:String(data.get("guardianMobile")||"").trim(),
        consent:data.get("consent")==="on",
        website:String(data.get("website")||"")
      });
      get("pe-reference").textContent=response.data.reference||"Submitted";
      get("pe-success-note").textContent=response.data.studentEmailRequired
        ?"The student email will be used for Adminerva account activation after official enrollment. The school may contact the parent/guardian email during review."
        :"This learner is guardian-managed for enrollment. The school may contact the parent/guardian email during review.";
      shell.hidden=true;success.hidden=false;status.textContent="";
      success.focus();
      window.scrollTo({top:0,behavior:"smooth"});
    }catch(error){
      status.textContent=error?.message||"The enrollment application could not be submitted. Review the form and try again.";
      window.scrollTo({top:Math.max(0,status.offsetTop-90),behavior:"smooth"});
    }finally{submitting=false;get("pe-submit").disabled=false;}
  })();
});
get("pe-new-application").addEventListener("click",()=>{
  form.reset();updateEmailPolicy();success.hidden=true;shell.hidden=false;
  fillSelect(form.elements.yearId,catalog.years||[],"Choose school year");
  fillSelect(form.elements.preferredProgramId,catalog.programs||[],"No preference",{optional:true});
  status.textContent="";form.elements.applicationType.focus();window.scrollTo({top:0,behavior:"smooth"});
});
load().catch(error=>{
  status.textContent=error?.message||"Online enrollment is temporarily unavailable. Please contact the school enrollment office.";
});
