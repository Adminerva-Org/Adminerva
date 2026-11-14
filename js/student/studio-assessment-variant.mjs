/** Loads the server-issued personalized task bound to a Studio assessment attempt. */
import {app,auth,db} from "../core/firebase-core.js?v=1.3.0";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {doc,getDoc} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {getV4StudioPersonalizedTask,listV4StudioAssignments} from "./v4-studio-service.mjs?v=4.1.0";

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
function showOverview(data,{school=false}={}){
  if(!overview||!data)return;
  // Published student assignment fields only, never teacher checking instructions.
  const instructions=String(data.taskContext||data.instructions||"").trim();
  const schoolRubric=school&&Array.isArray(data.rubric)?data.rubric.map(row=>{
    const title=String(row.criterion||row.name||row.label||"Criterion").trim();
    const pts=Number(row.points);
    return "- "+title+(Number.isFinite(pts)?" ("+pts+" points)":"")+
      (row.description?" — "+String(row.description):"");
  }).join("\n"):"";
  const criteria=schoolRubric||String(data.evalCriteria||"").trim();
  overview.classList.remove("hidden");
  overview.dataset.taskKind=data.practicalExam===true?"Practical exam":
    data.personalizedTask?.enabled===true?"Personalized task":"Studio assignment";
  loadingNote?.classList.add("hidden");
  if(overviewTitle)overviewTitle.textContent=String(data.title||"Assigned Studio assessment").slice(0,180);
  if(overviewMeta)overviewMeta.textContent=data.personalizedTask?.enabled===true
    ?"Follow your teacher's published instructions and the individual task below."
    :"Review your teacher's published instructions before submitting the project.";
  if(overviewText)overviewText.textContent=instructions||"Open My Assessments for the full task instructions.";
  overviewCriteria?.classList.toggle("hidden",!criteria);
  if(overviewRubric)overviewRubric.textContent=criteria;
  window.dispatchEvent(new CustomEvent("adminerva:studio-task-overview",{
    detail:{assessmentId,title:String(data.title||"Assigned Studio assessment").slice(0,180)}
  }));
}
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
  overview?.classList.add("hidden");
  loadingNote?.classList.toggle("hidden",!assessmentId);
  if(loadingNote)loadingNote.textContent="Loading your assignment instructions. You can also review them in My Assessments.";
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
  if(!user?.uid){
    if(loadingNote)loadingNote.textContent="Sign in to view the assigned instructions.";
    return;
  }
  let canonicalError=null;
  let matchedSchoolAssessment=false;
  try{
    const tasks=await listV4StudioAssignments();
    if(stamp!==generation||auth.currentUser?.uid!==user.uid)return;
    const task=Array.isArray(tasks)?tasks.find(item=>
      item.taskId===assessmentId&&item.submissionSource==="studio"):null;
    if(task){
      matchedSchoolAssessment=true;
      showOverview(task,{school:true});
      if(task.personalizedTask?.enabled!==true){
        reportContext({status:"not-personalized",personalized:false,readOnly:false});
        return;
      }
      panel?.classList.remove("hidden");
      if(meta)meta.textContent=" · preparing your verified-school version…";
      showStatus("Your task stays fixed for this attempt. A teacher-requested new revision receives a different variant.");
      const schoolVariant=await getV4StudioPersonalizedTask(assessmentId);
      if(stamp!==generation||auth.currentUser?.uid!==user.uid)return;
      if(!schoolVariant||schoolVariant.personalized===false)
        throw Error("The assigned school variant is unavailable. Return to My Assessments.");
      showVariant(schoolVariant);return;
    }
  }catch(error){canonicalError=error;}
  // A failed canonical task must never silently become a legacy attempt.
  const v4Only=document.getElementById("adminerva-nav")?.dataset.v4OnlyStudent==="true";
  if(matchedSchoolAssessment||v4Only){
    reportContext({status:"unavailable",personalized:matchedSchoolAssessment,readOnly:false});
    if(loadingNote)loadingNote.textContent="The school assignment could not be loaded. Return to My Assignments or retry after verifying your school.";
    if(matchedSchoolAssessment){
      panel?.classList.remove("hidden");
      showStatus("Your assigned version is unavailable: "+String(canonicalError?.message||"Try again later")+". Do not begin a substitute task.");
    }
    return;
  }
  try{
    const task=await getDoc(doc(db,"assessments",assessmentId));
    if(stamp!==generation||auth.currentUser?.uid!==user.uid)return;
    if(!task.exists()){
      if(canonicalError)throw canonicalError;
      reportContext({status:"unavailable",personalized:false,readOnly:false});
      if(loadingNote)loadingNote.textContent="The assignment is unavailable or unpublished. Return to My Assessments.";
      return;
    }
    if(task.data().schemaVersion!==3||task.data().submissionSource!=="studio"||task.data().published===false||
       task.data().personalizedTask?.enabled!==true){
      showOverview(task.data());
      reportContext({status:task.data().personalizedTask?.enabled===true?"unavailable":"not-personalized",
        personalized:task.data().personalizedTask?.enabled===true,readOnly:false});
      return;
    }
    showOverview(task.data());
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
