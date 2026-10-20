import {auth,db} from "../core/firebase-core.js";
import {signOut,onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {doc,onSnapshot,updateDoc,serverTimestamp} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {resolveAccountAccess} from "../core/staff-session.mjs?v=2026.10.20.1";
import {ensureGuestRequest} from "../core/admission-service.mjs?v=2026.10.21.1-dev.1";
import {admissionDestination,guestStorageKey} from "../core/admission-model.mjs?v=2026.10.21.1-dev.1";
import {COURSES} from "../student/practice-courses.mjs?v=2026.10.21.2-dev.1";
const field=id=>document.getElementById(id),page=document.querySelector("[data-guest-page]").dataset.guestPage;
let currentUid="",allowed=false;
const status=message=>{field("guest-status").textContent=message;};
function requireLocalAccess(){if(!allowed||auth.currentUser?.uid!==currentUid)throw Error("Account access changed. Save an export and return to Guest Home.");}
function localRead(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}}
function localWrite(key,value){requireLocalAccess();try{localStorage.setItem(key,JSON.stringify(value));status("Saved on this device only.");}catch{status("Device storage is unavailable. Export your code before leaving.");}}
function tools(uid){
  const key=guestStorageKey(uid,page);
  if(page==="playground"){
    field("guest-source").value=localRead(key,"<h1>Hello, Adminerva!</h1>\n<style>body { font-family: system-ui; padding: 24px; }</style>");
    field("guest-run").onclick=()=>{requireLocalAccess();field("guest-preview").srcdoc='<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data:; connect-src \'none\'; form-action \'none\'; base-uri \'none\'">'+field("guest-source").value;};
    field("guest-save").onclick=()=>localWrite(key,field("guest-source").value);
    field("guest-export").onclick=()=>{const link=document.createElement("a"),url=URL.createObjectURL(new Blob([field("guest-source").value],{type:"text/html"}));link.href=url;link.download="adminerva-guest-draft.html";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  }
  if(page==="practice"){
    let completed=localRead(key,[]);if(!Array.isArray(completed))completed=[];
    const count=()=>{field("guest-points").textContent=completed.length+" locally completed missions · "+completed.length*10+" practice points";};
    field("guest-course").replaceChildren(...COURSES.map(course=>new Option(course.name,course.id)));
    const render=()=>{
      field("guest-missions").replaceChildren();count();
      const course=COURSES.find(item=>item.id===field("guest-course").value);
      const module=course.modules.find(item=>item.id===field("guest-module").value)||course.modules[0];
      for(const mission of module.missions){
        const exercise=mission.build(17),section=document.createElement("section"),title=document.createElement("h2"),prompt=document.createElement("p"),code=document.createElement("pre"),result=document.createElement("p");
        title.textContent=mission.title;prompt.textContent=exercise.prompt;code.textContent=exercise.code;section.append(title,prompt,code);
        exercise.choices.forEach((choice,index)=>{const button=document.createElement("button");button.type="button";button.textContent=choice;button.onclick=()=>{requireLocalAccess();result.textContent=exercise.why;if(index===exercise.correct&&!completed.includes(mission.id)){completed.push(mission.id);localWrite(key,completed);count();}};section.append(button);});
        result.setAttribute("role","status");section.append(result);field("guest-missions").append(section);
      }
    };
    const chooseCourse=()=>{const course=COURSES.find(item=>item.id===field("guest-course").value);field("guest-module").replaceChildren(...course.modules.map(module=>new Option(module.title,module.id)));render();};
    field("guest-course").onchange=chooseCourse;field("guest-module").onchange=render;chooseCourse();
  }
  field("guest-clear").onclick=()=>{requireLocalAccess();if(confirm("Clear only this account's local "+page+" draft/progress?")){localStorage.removeItem(key);location.reload();}};
}
field("guest-signout").onclick=()=>signOut(auth).then(()=>location.assign("login.html"));
await auth.authStateReady();
const user=auth.currentUser;
if(!user?.emailVerified){location.replace("login.html?error=verified-email-required");}
else try{
  currentUid=user.uid;
  onAuthStateChanged(auth,next=>{if(next?.uid!==currentUid){allowed=false;location.replace("login.html?error=account-changed");}});
  field("guest-identity").textContent=(user.displayName||"Guest")+" · "+user.email;
  const access=await resolveAccountAccess(user),destination=admissionDestination(access);
  if(destination!=="guest-home.html"){location.replace(destination);}
  else{
    await ensureGuestRequest(user,access.needsTeacherApproval?"teacher":"guest");
    let initialized=false;
    onSnapshot(doc(db,"account_requests",user.uid),snapshot=>{
      if(auth.currentUser?.uid!==user.uid)return;
      const request=snapshot.data();allowed=request?.status==="pending";field("guest-content").hidden=!allowed;
      if(!allowed&&page==="playground")field("guest-preview").srcdoc="";
      status(request?.status==="pending"?"Pending administrator review · limited guest access":request?.status==="rejected"?"Access request not approved. Contact your school administrator.":"Your request was approved. Open your assigned workspace; local guest drafts are not migrated.");
      if(request?.status==="approved"){field("guest-approved").href=request.approvedRole==="teacher"?"teacher-home.html":"student-home.html";field("guest-approved").hidden=false;}
      if(allowed&&!initialized){initialized=true;if(page==="home"){
        field("guest-role").value=request.requestedRole;
        field("guest-request").onsubmit=async event=>{event.preventDefault();try{requireLocalAccess();await updateDoc(doc(db,"account_requests",user.uid),{requestedRole:field("guest-role").value,updatedAt:serverTimestamp()});status("Request saved. Only an administrator can grant access.");}catch{status("Request could not save. Refresh your status and retry.");}};
      }else tools(user.uid);}
    },()=>{allowed=false;field("guest-content").hidden=true;status("Access status could not load. No school access was granted; retry after checking your connection.");});
  }
}catch{status("Your guest workspace could not load. Check your connection and retry; no school access was granted.");}
