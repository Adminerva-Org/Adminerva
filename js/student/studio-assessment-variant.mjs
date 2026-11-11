/** Loads the server-issued personalized task bound to a Studio assessment attempt. */
import {app,auth,db} from "../core/firebase-core.js?v=1.3.0";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {doc,getDoc} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";

const assessmentId=new URL(location.href).searchParams.get("assessment");
const panel=document.getElementById("studioPersonalizedTask");
const meta=document.getElementById("studioPersonalizedTaskMeta");
const prompt=document.getElementById("studioPersonalizedTaskPrompt");
const status=document.getElementById("studioPersonalizedTaskStatus");
let generation=0;

function hide(){
  panel?.classList.add("hidden");
  window.adminervaStudioAssessmentVariant=null;
}
function showStatus(text){if(status)status.textContent=text;}

async function load(user){
  const stamp=++generation;
  hide();
  if(!assessmentId||!user?.uid)return;
  try{
    const task=await getDoc(doc(db,"assessments",assessmentId));
    if(stamp!==generation||auth.currentUser?.uid!==user.uid)return;
    if(!task.exists()||task.data().schemaVersion!==3||
      task.data().submissionSource!=="studio"||task.data().personalizedTask?.enabled!==true)return;
    panel?.classList.remove("hidden");
    if(meta)meta.textContent=" · preparing your assigned version…";
    if(prompt)prompt.textContent="";
    showStatus("Your task stays fixed for this attempt. A teacher-requested new revision receives a different variant.");
    const call=httpsCallable(getFunctions(app,"asia-southeast1"),"studioAssessmentVariant");
    const response=await call({assessmentId});
    if(stamp!==generation||auth.currentUser?.uid!==user.uid)return;
    const variant=response.data;
    window.adminervaStudioAssessmentVariant=variant;
    if(meta)meta.textContent=" · Attempt "+variant.attempt+" · Variant "+variant.variantId;
    if(prompt)prompt.textContent=variant.prompt||"";
    showStatus(variant.readOnly
      ?"This is the task attached to your submitted revision. It is shown for reference and will not be regenerated."
      :"This version is yours for the current attempt. Reloading the page keeps the same task.");
    window.dispatchEvent(new CustomEvent("adminerva:studio-variant-ready",{detail:variant}));
  }catch(error){
    if(stamp!==generation)return;
    panel?.classList.remove("hidden");
    if(meta)meta.textContent=" · unavailable";
    if(prompt)prompt.textContent="";
    showStatus("Personalized task could not load: "+String(error?.message||"Unknown error")+
      ". Do not begin a substitute task; return to My Assessments and retry.");
  }
}
onAuthStateChanged(auth,user=>void load(user));
