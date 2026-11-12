/** Loads the server-issued personalized task bound to a Studio assessment attempt. */
import {app,auth,db} from "../core/firebase-core.js?v=1.3.0";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {doc,getDoc} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {getV4StudioPersonalizedTask} from "./v4-studio-service.mjs?v=4.1.0";

const assessmentId=new URL(location.href).searchParams.get("assessment");
const panel=document.getElementById("studioPersonalizedTask");
const meta=document.getElementById("studioPersonalizedTaskMeta");
const prompt=document.getElementById("studioPersonalizedTaskPrompt");
const status=document.getElementById("studioPersonalizedTaskStatus");
let generation=0;
function reportContext(context){
  if(!assessmentId)return;
  const detail={assessmentId,...context};
  window.adminervaStudioAssessmentContext=detail;
  window.dispatchEvent(new CustomEvent("adminerva:studio-assessment-context",{detail}));
}
// Keep assignment sessions conservative until the verified school or legacy
// assessment is resolved; runtime clients can read this state before listening.
if(assessmentId)reportContext({status:"loading",personalized:false,readOnly:false});

function hide(){
  panel?.classList.add("hidden");
  window.adminervaStudioAssessmentVariant=null;
}
function showStatus(text){if(status)status.textContent=text;}

function showVariant(variant){
  panel?.classList.remove("hidden");
  window.adminervaStudioAssessmentVariant=variant;
  reportContext({
    status:"ready",personalized:true,variantId:variant.variantId,
    attempt:variant.attempt,readOnly:variant.readOnly===true
  });
  if(meta)meta.textContent=" · Attempt "+variant.attempt+" · Variant "+variant.variantId;
  if(prompt)prompt.textContent=variant.prompt||"";
  showStatus(variant.readOnly
    ?"This is the task attached to your submitted revision. It is shown for reference and will not be regenerated."
    :"This version is yours for the current attempt. Reloading the page keeps the same task.");
  window.dispatchEvent(new CustomEvent("adminerva:studio-variant-ready",{detail:variant}));
}
async function load(user){
  const stamp=++generation;
  hide();
  if(!assessmentId)return;
  reportContext({status:user?.uid?"loading":"unavailable",personalized:false,readOnly:false});
  if(!user?.uid)return;
  let canonicalError=null;
  try{
    const schoolVariant=await getV4StudioPersonalizedTask(assessmentId);
    if(stamp!==generation||auth.currentUser?.uid!==user.uid)return;
    if(schoolVariant){
      if(schoolVariant.personalized===false){
        reportContext({status:"not-personalized",personalized:false,readOnly:false});
        return;
      }
      panel?.classList.remove("hidden");
      if(meta)meta.textContent=" · preparing your verified-school version…";
      showStatus("Your task stays fixed for this attempt. A teacher-requested new revision receives a different variant.");
      showVariant(schoolVariant);return;
    }
  }catch(error){canonicalError=error;}
  try{
    const task=await getDoc(doc(db,"assessments",assessmentId));
    if(stamp!==generation||auth.currentUser?.uid!==user.uid)return;
    if(!task.exists()){
      if(canonicalError)throw canonicalError;
      reportContext({status:"unavailable",personalized:false,readOnly:false});
      return;
    }
    if(task.data().schemaVersion!==3||task.data().submissionSource!=="studio"||
       task.data().personalizedTask?.enabled!==true){
      reportContext({status:task.data().personalizedTask?.enabled===true?"unavailable":"not-personalized",
        personalized:task.data().personalizedTask?.enabled===true,readOnly:false});
      return;
    }
    panel?.classList.remove("hidden");
    if(meta)meta.textContent=" · preparing your assigned version…";
    if(prompt)prompt.textContent="";
    showStatus("Your task stays fixed for this attempt. A teacher-requested new revision receives a different variant.");
    const call=httpsCallable(getFunctions(app,"asia-southeast1"),"studioAssessmentVariant");
    const response=await call({assessmentId});
    if(stamp!==generation||auth.currentUser?.uid!==user.uid)return;
    showVariant(response.data);
  }catch(error){
    if(stamp!==generation||auth.currentUser?.uid!==user.uid)return;
    reportContext({status:"unavailable",personalized:true,readOnly:false});
    panel?.classList.remove("hidden");
    if(meta)meta.textContent=" · unavailable";
    if(prompt)prompt.textContent="";
    showStatus("Personalized task could not load: "+String(error?.message||canonicalError?.message||"Unknown error")+
      ". Do not begin a substitute task; return to My Assessments and retry.");
  }
}
onAuthStateChanged(auth,user=>void load(user));
