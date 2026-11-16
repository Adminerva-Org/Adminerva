import {app,auth} from "./firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
const functions=getFunctions(app,"asia-southeast1");
const invitationAction=httpsCallable(functions,"acceptSchoolInvitation");
const rosterAction=httpsCallable(functions,"activateSchoolRosterAccess");
const form=document.getElementById("join-form"),account=document.getElementById("join-account"),
  status=document.getElementById("join-result"),title=document.getElementById("join-title"),
  intro=document.getElementById("join-intro"),help=document.getElementById("join-help"),
  submit=document.getElementById("join-submit");
const params=new URLSearchParams(location.search);
const school=params.get("schoolId"),invitation=params.get("invitationId");
const rosterMode=params.get("mode")==="roster"&&school==="manila-cathedral-school";

if(/^[a-z][a-z0-9-]{1,63}$/.test(school||""))
  form.elements.schoolId.value=school;
if(/^[A-Za-z0-9_-]{1,128}$/.test(invitation||""))
  form.elements.invitationId.value=invitation;

if(rosterMode){
  title.textContent="Activate your Manila Cathedral School account";
  intro.textContent="Sign in with the same verified email recorded during school enrollment. You do not need an individual invitation ID.";
  help.textContent="If your verified email is not recognized, ask the School Administrator or Registrar to check your enrollment record. The activation link itself does not grant school access.";
  document.getElementById("join-school-field").hidden=true;
  document.getElementById("join-invite-field").hidden=true;
  form.elements.invitationId.required=false;
  submit.textContent="Activate my student account";
}

await auth.authStateReady();
if(!auth.currentUser){
  account.textContent=rosterMode
    ?"Sign in with the verified email used during enrollment first."
    :"Sign in with your invited account first.";
  const link=document.createElement("a");
  link.href="login.html?returnTo="+encodeURIComponent("join-school.html"+location.search);
  link.textContent=rosterMode?"Sign in to activate your school account":"Sign in to accept your invitation";
  account.append(" ",link);
}else if(!auth.currentUser.emailVerified){
  account.textContent="Verify your account email before continuing.";
}else{
  account.textContent=rosterMode
    ?"Signed in with a verified account. Adminerva will match this email to the active Manila Cathedral School enrollment roster."
    :"Signed in with your verified account. Invitation approval is checked by the server.";
  form.hidden=false;
}

form.addEventListener("submit",async event=>{
  event.preventDefault();
  if(!form.reportValidity())return;
  const button=form.querySelector("button");
  const schoolId=form.elements.schoolId.value.trim();
  const invitationId=form.elements.invitationId.value.trim();
  button.disabled=true;
  status.textContent=rosterMode
    ?"Checking your verified email against the active school enrollment roster…"
    :"Validating invitation and activating school access…";
  try{
    const data=rosterMode
      ?(await rosterAction({schoolId})).data
      :(await invitationAction({schoolId,invitationId})).data;
    status.replaceChildren();
    const message=document.createElement("span");
    if(rosterMode){
      message.textContent=(data.alreadyActive?"School access is already active for ":"School access activated for ")+
        (data.displayName||"this student")+".";
      const home=document.createElement("a");
      home.href="student-home.html";home.textContent="Open your student workspace";
      status.append(message," ",home);
    }else{
      message.textContent="School access approved for "+data.schoolId+". Your account is now a "+data.role+".";
      if(data.role==="teacher"){
        const home=document.createElement("a");
        home.href="teacher-assessment-library.html";
        home.textContent="Open the teacher assessment workspace";
        status.append(message," ",home);
      }else{
        const home=document.createElement("a");
        home.href="student-home.html";home.textContent="Open your student workspace";
        status.append(message," ",home);
      }
    }
    form.hidden=true;
  }catch(error){
    status.textContent=error?.message||(rosterMode
      ?"Your account could not be matched to an active school enrollment record."
      :"The invitation could not be accepted. Confirm the school and invitation IDs with your administrator.");
  }finally{button.disabled=false;}
});
