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
const overview=document.getElementById("studioTaskOverview");
const loadingNote=document.getElementById("studioTaskLoadingNote");
const overviewTitle=document.getElementById("studioTaskOverviewTitle");
const overviewMeta=document.getElementById("studioTaskOverviewMeta");
const overviewText=document.getElementById("studioTaskOverviewText");
const overviewCriteria=document.getElementById("studioTaskOverviewCriteria");
const overviewRubric=document.getElementById("studioTaskOverviewRubric");
let generation=0;
function showOverview(data){
  if(!overview||!data)return;
  const instructions=String(data.taskContext||data.instructions||"").trim();
  const criteria=String(data.evalCriteria||"").trim();
  overview.classList.remove("hidden");
  overview.dataset.taskKind=data.practicalExam===true?"Practical exam":
    data.personalizedTask?.enabled===true?"Personalized task":"Studio assignment";
  loadingNote?.classList.add("hidden");
  if(overviewTitle)overviewTitle.textContent=String(data.title||"Assigned Studio assessment").slice(0,180);
  if(overviewMeta)overviewMeta.textContent=data.personalizedTask?.enabled===true
    ?"Complete your individual task below; the instructor's general instructions apply as well."
    :"Review your teacher's instructions before submitting the project.";
  if(overviewText)overviewText.textContent=instructions||"Open My Assessments for the full task instructions.";
  overviewCriteria?.classList.toggle("hidden",!criteria);
  if(overviewRubric)overviewRubric.textContent=criteria;
  window.dispatchEvent(new CustomEvent("adminerva:studio-task-overview",{
    detail:{assessmentId,title:String(data.title||"Assigned Studio assessment").slice(0,180)}
  }));
}
function reportContext(context){
  if(!assessmentId)return;
  const detail={assessmentId,...context};
  window.adminervaStudioAssessmentContext=detail;
  window.dispatchEvent(new CustomEvent("adminerva:studio-assessment-context",{detail}));
}
// An assignment-linked Studio session begins in a conservative loading state.
if(assessmentId)reportContext({status:"loading",personalized:false,readOnly:false});

function hide(){
  panel?.classList.add("hidden");
  overview?.classList.add("hidden");
  loadingNote?.classList.toggle("hidden",!assessmentId);
  if(loadingNote)loadingNote.textContent="Loading your assignment instructions. You can also review them in My Assessments.";
  window.adminervaStudioAssessmentVariant=null;
}
function showStatus(text){if(status)status.textContent=text;}

async function load(user){
  const stamp=++generation;
  hide();
  if(!assessmentId)return;
  reportContext({status:user?.uid?"loading":"unavailable",personalized:false,readOnly:false});
  if(!user?.uid){
    if(loadingNote)loadingNote.textContent="Sign in to view the assigned instructions.";
    return;
  }
  try{
    const task=await getDoc(doc(db,"assessments",assessmentId));
    if(stamp!==generation||auth.currentUser?.uid!==user.uid)return;
    if(!task.exists()||task.data().schemaVersion!==3||
      task.data().submissionSource!=="studio"||task.data().published===false){
      reportContext({status:"unavailable",personalized:false,readOnly:false});
      if(loadingNote)loadingNote.textContent="The assignment is unavailable or unpublished. Return to My Assessments for its current status.";
      return;
    }
    showOverview(task.data());
    if(task.data().personalizedTask?.enabled!==true){
      reportContext({status:"not-personalized",personalized:false,readOnly:false});
      return;
    }
    panel?.classList.remove("hidden");
    if(meta)meta.textContent=" · preparing your assigned version…";
    if(prompt)prompt.textContent="";
    showStatus("Your task stays fixed for this attempt. A teacher-requested new revision receives a different variant.");
    const call=httpsCallable(getFunctions(app,"asia-southeast1"),"studioAssessmentVariant");
    const response=await call({assessmentId});
    if(stamp!==generation||auth.currentUser?.uid!==user.uid)return;
    const variant=response.data;
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
  }catch(error){
    if(stamp!==generation)return;
    reportContext({status:"unavailable",personalized:true,readOnly:false});
    if(loadingNote)loadingNote.textContent="The personalized task could not be loaded. Return to My Assessments to retry.";
    panel?.classList.remove("hidden");
    if(meta)meta.textContent=" · unavailable";
    if(prompt)prompt.textContent="";
    showStatus("Personalized task could not load: "+String(error?.message||"Unknown error")+
      ". Do not begin a substitute task; return to My Assessments and retry.");
  }
}
onAuthStateChanged(auth,user=>void load(user));
