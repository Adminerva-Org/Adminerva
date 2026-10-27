import {auth,db} from "../core/firebase-core.js?v=1.3.0";
import {clearConnectionPreferences} from "../core/connection-cache.mjs?v=1.3.0";
import {signOut,onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {doc,getDoc,onSnapshot,updateDoc,serverTimestamp} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {resolveAccountAccess} from "../core/staff-session.mjs?v=1.3.0";
import {ensureGuestRequest} from "../core/admission-service.mjs?v=1.3.0";
import {admissionDestination,guestStorageKey} from "../core/admission-model.mjs?v=1.3.0";
import {COURSES} from "../student/practice-courses.mjs?v=1.3.0";
const field=id=>document.getElementById(id),page=document.querySelector("[data-guest-page]").dataset.guestPage;
let currentUid="",allowed=false;
const status=message=>{field("guest-status").textContent=message;};
function connectionFailure(message){
  status(message);
  if(field("guest-retry"))return;
  const retry=document.createElement("button");retry.id="guest-retry";retry.type="button";retry.textContent="Retry connection";retry.className="av-action-link";retry.onclick=()=>location.reload();field("guest-status").after(retry);
}
function requireLocalAccess(){if(!allowed||auth.currentUser?.uid!==currentUid)throw Error("Account access changed. Save an export and return to Guest Home.");}
function localRead(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}}
function localWrite(key,value){requireLocalAccess();try{localStorage.setItem(key,JSON.stringify(value));status("Saved on this device only.");return true;}catch{status(page==="practice"?"Browser storage is unavailable. Practice progress will be lost when you leave. Allow browser storage and try again.":"Device storage is unavailable. Export your code before leaving.");return false;}}
function tools(uid){
  const key=guestStorageKey(uid,page);
  if(page==="playground"){
    field("guest-source").value=localRead(key,"<h1>Hello, Adminerva!</h1>\n<style>body { font-family: system-ui; padding: 24px; }</style>");
    field("guest-run").onclick=()=>{requireLocalAccess();field("guest-preview").srcdoc='<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data:; connect-src \'none\'; form-action \'none\'; base-uri \'none\'">'+field("guest-source").value;};
    field("guest-save").onclick=()=>localWrite(key,field("guest-source").value);
    field("guest-export").onclick=()=>{const link=document.createElement("a"),url=URL.createObjectURL(new Blob([field("guest-source").value],{type:"text/html"}));link.href=url;link.download="adminerva-guest-draft.html";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  }
  if(page==="practice"){
    const missionIds=new Set(COURSES.flatMap(course=>course.missions.map(mission=>mission.id)));
    let completed=localRead(key,[]);completed=Array.isArray(completed)?[...new Set(completed.filter(id=>missionIds.has(id)))]:[];
    const count=()=>{field("guest-points").textContent=completed.length+" locally completed missions · "+completed.length*10+" practice points";};
    field("guest-course").replaceChildren(...COURSES.map(course=>new Option(course.name,course.id)));
    const render=()=>{
      field("guest-missions").replaceChildren();count();
      const course=COURSES.find(item=>item.id===field("guest-course").value);
      const module=course.modules.find(item=>item.id===field("guest-module").value)||course.modules[0];
      const next=module.missions.find(mission=>!completed.includes(mission.id))?.id;
      for(const [missionIndex,mission] of module.missions.entries()){
        const exercise=mission.build(17),section=document.createElement("section"),details=document.createElement("details"),title=document.createElement("summary"),concept=document.createElement("p"),prompt=document.createElement("h3"),code=document.createElement("pre"),result=document.createElement("p"),choices=document.createElement("div");
        section.className="av-guest-mission";details.className="av-practice-module";details.open=mission.id===next||!next&&missionIndex===0;
        const missionTitle=()=>{title.textContent=(missionIndex+1)+". "+mission.title+(completed.includes(mission.id)?" · Completed":"");};missionTitle();
        concept.textContent=mission.concept;prompt.textContent=exercise.prompt;code.textContent=exercise.code;code.setAttribute("aria-label","Code example");choices.className="av-learning-grid";
        details.append(title,concept,code,prompt,choices);
        exercise.choices.forEach((choice,index)=>{const button=document.createElement("button");button.type="button";button.textContent=choice;button.className="av-directory-card";button.onclick=()=>{
          try{
            requireLocalAccess();
            for(const answer of choices.querySelectorAll("button"))answer.setAttribute("aria-pressed",String(answer===button));
            const correct=index===exercise.correct,previouslyCompleted=completed.includes(mission.id);
            result.textContent=(correct?"Correct. ":"Not quite. ")+exercise.why+(correct?previouslyCompleted?" You already completed this mission.":" +10 local practice points. Open the next mission when you are ready.":" Compare the explanation with the code, then try another answer.");
            result.className=correct?"av-feedback-success":"av-feedback-warning";
            if(correct&&!previouslyCompleted){completed.push(mission.id);localWrite(key,completed);count();missionTitle();}
          }catch(error){status(error.message||"Your access changed. Return to Guest Home to continue.");}
        };button.setAttribute("aria-pressed","false");choices.append(button);});
        result.setAttribute("role","status");result.setAttribute("aria-live","polite");details.append(result);section.append(details);field("guest-missions").append(section);
      }
    };
    const chooseCourse=()=>{const course=COURSES.find(item=>item.id===field("guest-course").value);field("guest-module").replaceChildren(...course.modules.map(module=>new Option(module.title,module.id)));render();};
    field("guest-course").onchange=chooseCourse;field("guest-module").onchange=render;chooseCourse();
  }
  field("guest-clear").onclick=()=>{requireLocalAccess();if(confirm("Clear only this account's local "+page+" draft/progress?")){localStorage.removeItem(key);location.reload();}};
}
async function publicHome(){
  let stop=()=>{},generation=0;
  onAuthStateChanged(auth,async user=>{
    const version=++generation;stop();allowed=false;currentUid=user?.uid||"";
    field("guest-content").hidden=false;field("guest-signout").hidden=!user;field("guest-account-request").hidden=true;field("guest-approved").hidden=true;field("guest-signin-link").hidden=Boolean(user?.emailVerified);
    field("guest-identity").textContent=user?"Signed in as "+(user.displayName||user.email||"your account"):"No account needed for public learning tools.";
    if(!user?.emailVerified){status("Explore freely. Sign in with your verified school email when you need class access.");return;}
    try{
      const access=await resolveAccountAccess(user);if(version!==generation||auth.currentUser?.uid!==user.uid)return;
      if(access.staffLookupUnavailable)throw Error("School access is temporarily unavailable.");
      const destination=admissionDestination(access);
      if(destination!=="guest-home.html"){field("guest-approved").href=destination;field("guest-approved").hidden=false;status("Your school workspace is ready. Public learning tools remain available above.");return;}
      field("guest-account-request").hidden=false;
      const ref=doc(db,"account_requests",user.uid);
      stop=onSnapshot(ref,snapshot=>{
        if(version!==generation)return;const request=snapshot.data();allowed=!request||request.status==="pending";
        field("guest-account-request").hidden=Boolean(request)&&request.status!=="pending";
        if(request?.requestedRole)field("guest-role").value=request.requestedRole;
        if(request?.status==="approved"){field("guest-approved").href=request.approvedRole==="teacher"?"teacher-home.html":"student-home.html";field("guest-approved").hidden=false;status("Your request was approved. Open your school workspace when ready.");}
        else status(request?.status==="rejected"?"Your access request was not approved. Contact your school administrator. You can still use the public tools above.":request?"Your access request is awaiting school review. You can update the requested role below.":"Select the school role you need and save your request.");
      },()=>connectionFailure("School access status could not load. The public learning tools above are still available."));
      field("guest-request").onsubmit=async event=>{
        event.preventDefault();if(!allowed||auth.currentUser?.uid!==user.uid)return;const button=event.currentTarget.querySelector("button");button.disabled=true;const end=window.beginLoading?.("Saving school access request…")||(()=>{});
        try{const requested=field("guest-role").value,existing=await getDoc(ref);if(existing.exists())await updateDoc(ref,{requestedRole:requested,updatedAt:serverTimestamp()});else await ensureGuestRequest(user,requested);status("Access request saved. Your school administrator will review it.");}
        catch{status("The request could not save. Check your connection and try again.");}finally{button.disabled=false;end();}
      };
    }catch{if(version===generation)connectionFailure("Your account stays signed in. School access could not be checked; public tools remain available.");}
  });
}
field("guest-signout").onclick=async()=>{const button=field("guest-signout");button.disabled=true;button.textContent="Signing out…";try{try{clearConnectionPreferences();}catch{}await signOut(auth);location.assign("login.html?switch=1");}catch{button.disabled=false;button.textContent="Sign out";status("Sign out could not complete. Check your connection and try again.");}};
if(page==="home"){await publicHome();}
else{
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
      field("guest-approved").hidden=request?.status!=="approved";
      if(!allowed&&page==="playground")field("guest-preview").srcdoc="";
      status(request?.status==="pending"?"Pending administrator review · limited guest access":request?.status==="rejected"?"Access request not approved. Contact your school administrator.":"Your request was approved. Open your assigned workspace; local guest drafts are not migrated.");
      if(request?.status==="approved"){field("guest-approved").href=request.approvedRole==="teacher"?"teacher-home.html":"student-home.html";field("guest-approved").hidden=false;}
      if(allowed&&!initialized){initialized=true;if(page==="home"){
        field("guest-role").value=request.requestedRole;
        field("guest-request").onsubmit=async event=>{
          event.preventDefault();const form=field("guest-request"),button=form.querySelector("button");if(button.disabled)return;
          button.disabled=true;button.textContent="Saving request…";field("guest-role").disabled=true;form.setAttribute("aria-busy","true");const end=window.beginLoading?.("Updating school access request…")||(()=>{});
          try{requireLocalAccess();await updateDoc(doc(db,"account_requests",user.uid),{requestedRole:field("guest-role").value,updatedAt:serverTimestamp()});if(auth.currentUser?.uid===user.uid)status("Request saved. Your school administrator will review your access.");}
          catch{if(auth.currentUser?.uid===user.uid)status("Your request could not save. Check your connection and try again.");}
          finally{button.disabled=false;button.textContent="Save access request";field("guest-role").disabled=false;form.setAttribute("aria-busy","false");end();}
        };
      }else tools(user.uid);}
    },()=>{allowed=false;field("guest-content").hidden=true;connectionFailure("Your access status could not load. Check your connection and retry.");});
  }
}catch{connectionFailure("Your guest workspace could not load. Check your connection and retry.");}
}
