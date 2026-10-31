import {app,auth} from "./firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
const action=httpsCallable(getFunctions(app,"asia-southeast1"),"acceptSchoolInvitation");
const form=document.getElementById("join-form"),account=document.getElementById("join-account"),
  status=document.getElementById("join-result");
const params=new URLSearchParams(location.search);
const school=params.get("schoolId"),invitation=params.get("invitationId");
if(/^[a-z][a-z0-9-]{1,63}$/.test(school||""))
  form.elements.schoolId.value=school;
if(/^[A-Za-z0-9_-]{1,128}$/.test(invitation||""))
  form.elements.invitationId.value=invitation;
await auth.authStateReady();
if(!auth.currentUser){
  account.textContent="Sign in with your invited account first.";
  const link=document.createElement("a");
  link.href="login.html?returnTo="+encodeURIComponent("join-school.html"+location.search);
  link.textContent="Sign in to accept your invitation";
  account.append(" ",link);
}else if(!auth.currentUser.emailVerified){
  account.textContent="Verify your account email before accepting an invitation.";
}else{
  account.textContent="Signed in with your verified account. Invitation approval is checked by the server.";
  form.hidden=false;
}
form.addEventListener("submit",async event=>{
  event.preventDefault();
  if(!form.reportValidity())return;
  const button=form.querySelector("button");
  const schoolId=form.elements.schoolId.value.trim(),invitationId=form.elements.invitationId.value.trim();
  button.disabled=true;status.textContent="Validating invitation and activating school access…";
  try{
    const data=(await action({schoolId,invitationId})).data;
    status.replaceChildren();
    const message=document.createElement("span");
    message.textContent="School access approved for "+data.schoolId+". Your account is now a "+data.role+".";
    const home=document.createElement("a");
    home.href=data.role==="student"?"student-home.html":"teacher-home.html";
    home.textContent="Open your workspace";
    status.append(message," ",home);
    form.hidden=true;
  }catch(error){
    status.textContent=error?.message||"The invitation could not be accepted. Confirm the school and invitation IDs with your administrator.";
  }finally{button.disabled=false;}
});
