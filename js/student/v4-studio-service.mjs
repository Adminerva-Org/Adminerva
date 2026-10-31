/**
 * Progressive V4 bridge for the existing Adminerva Studio.
 * The legacy UI remains usable until school callables are deployed; once an
 * active verified school membership is available, the same editor syncs to
 * the school namespace and can submit frozen school project revisions.
 */
import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs?v=4.0.0";

const functions=getFunctions(app,"asia-southeast1");
const projectsApi=httpsCallable(functions,"schoolStudioProjects");
const submissionsApi=httpsCallable(functions,"schoolStudioSubmissions");
const assessmentsApi=httpsCallable(functions,"schoolAssessments");
const host=document.getElementById("studioSchoolSwitcher");
const status=document.getElementById("studioSchoolStatus");
let picker=null,loadPromise=null,activeSchool=null,lastError="",syncTimer=null,queued=null,syncing=Promise.resolve();

function setStatus(message,tone="info"){
  if(!status)return;
  status.textContent=message||"";
  status.dataset.tone=tone;
  status.classList.toggle("hidden",!message);
}
function revisionKey(uid,schoolId,projectId){
  return "Adminerva_V4_Project_Revision_"+uid+"_"+schoolId+"_"+projectId;
}
function getRevision(uid,schoolId,projectId){
  try{
    const value=Number(localStorage.getItem(revisionKey(uid,schoolId,projectId)));
    return Number.isInteger(value)&&value>0?value:null;
  }catch{return null;}
}
function setRevision(uid,schoolId,projectId,revision){
  try{localStorage.setItem(revisionKey(uid,schoolId,projectId),String(revision));}catch{}
}
function projectPayload(project,state){
  if(!project?.id||!project?.title||!state?.files)throw Error("Open and save a named Studio project first.");
  const files=Object.keys(state.files).sort().map(path=>({path,content:String(state.files[path]??"")}));
  return {
    projectId:project.id,
    title:project.title,
    language:state.lang||project.lang||"text",
    files,
    artifacts:{
      database:project.database||{tables:{},history:[]},
      design:project.design||{},
      config:project.config||{},
      evidence:project.evidence||{events:[],runs:[]}
    }
  };
}
function canonicalJson(value){
  function normalize(node){
    if(node===null||typeof node==="string"||typeof node==="boolean")return node;
    if(typeof node==="number"){
      if(!Number.isFinite(node))throw Error("Project data contains a non-finite number.");
      return Object.is(node,-0)?0:node;
    }
    if(Array.isArray(node))return node.map(normalize);
    if(node&&typeof node==="object"){
      const result={};
      for(const key of Object.keys(node).sort())result[key]=normalize(node[key]);
      return result;
    }
    throw Error("Project data contains an unsupported value.");
  }
  return JSON.stringify(normalize(value));
}
async function digestPayload(payload){
  const data=canonicalJson({files:payload.files,artifacts:payload.artifacts});
  const bytes=new TextEncoder().encode(data);
  if(!crypto?.subtle)throw Error("Secure project verification is unavailable in this browser.");
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
}
function callableMessage(error,fallback){
  const message=String(error?.message||"").replace(/^Firebase:\s*/,"").replace(/\s*\(functions\/[^)]+\)\.?$/,"").trim();
  return message||fallback;
}
async function init(){
  if(loadPromise)return loadPromise;
  loadPromise=(async()=>{
    await auth.authStateReady();
    if(!auth.currentUser){activeSchool=null;return null;}
    picker=createTenantSchoolPicker({
      host:host||document.createElement("div"),
      status:null,
      onBeforeChange:async()=>{
        if(queued||syncTimer)throw Error("Finish the current Studio save before switching schools.");
      },
      onReady:scope=>{
        activeSchool=scope.current;
        if(activeSchool){
          const name=picker?.scope?.current?.schoolId||"school";
          setStatus("School project sync ready · "+name);
        }
      }
    });
    try{
      const state=await picker.load();
      activeSchool=picker.scope.current;
      if(state?.state==="choose_school"){
        setStatus("Choose your active school before school project synchronization.","attention");
        return null;
      }
      if(!activeSchool){
        setStatus(state?.state==="no_school"?"No verified school membership for Studio sync.":"School project sync is not active.","muted");
        return null;
      }
      return activeSchool;
    }catch(error){
      lastError=callableMessage(error,"School project sync unavailable.");
      activeSchool=null;
      setStatus("Using existing Studio storage · school sync unavailable.","muted");
      return null;
    }
  })();
  return loadPromise;
}
export async function currentV4StudioSchool(){
  await init();
  return activeSchool;
}
async function scopedCall(api,action,details={}){
  await init();
  if(!picker?.scope.current)return null;
  const lease=picker.scope.lease();
  const result=(await api({schoolId:lease.schoolId,action,...details})).data;
  picker.scope.assertLease(lease);
  return result;
}
export async function syncV4StudioProject(project,state,{quiet=false}={}){
  await init();
  if(!activeSchool||!auth.currentUser)return null;
  const payload=projectPayload(project,state);
  const uid=auth.currentUser.uid,schoolId=activeSchool.schoolId;
  let expectedRevision=getRevision(uid,schoolId,payload.projectId);
  try{
    let result;
    try{
      result=await scopedCall(projectsApi,"sync",{...payload,expectedRevision});
    }catch(error){
      // A fresh browser may not know a project already exists. Adopt its
      // server revision only if the complete checksum matches; never overwrite.
      if(!String(error?.code||"").includes("failed-precondition")&&
         !String(error?.message||"").toLowerCase().includes("revision"))throw error;
      const existing=await scopedCall(projectsApi,"get",{projectId:payload.projectId});
      if(!existing)throw error;
      const localDigest=await digestPayload(payload);
      if(existing.contentDigest!==localDigest)
        throw Error("This project has a different school-saved revision. Export your current work, then reload the school copy before overwriting it.");
      expectedRevision=existing.revision;
      setRevision(uid,schoolId,payload.projectId,existing.revision);
      result={projectId:payload.projectId,revision:existing.revision,
        contentDigest:existing.contentDigest,created:false,unchanged:true};
    }
    setRevision(uid,schoolId,payload.projectId,result.revision);
    if(!quiet)setStatus("Saved to "+schoolId+" · revision "+result.revision);
    document.dispatchEvent(new CustomEvent("adminerva:v4-project-synced",{detail:{
      schoolId,projectId:payload.projectId,revision:result.revision,contentDigest:result.contentDigest
    }}));
    return {...result,schoolId};
  }catch(error){
    lastError=callableMessage(error,"School project save failed.");
    setStatus(lastError,"error");
    throw error;
  }
}
export function queueV4StudioProjectSync(project,state){
  queued={project:structuredClone(project),state:structuredClone(state)};
  clearTimeout(syncTimer);
  syncTimer=setTimeout(()=>{
    syncTimer=null;
    const next=queued;queued=null;
    if(!next)return;
    syncing=syncing.catch(()=>{}).then(()=>syncV4StudioProject(next.project,next.state,{quiet:true}))
      .catch(error=>console.warn("V4 Studio sync skipped:",callableMessage(error,"save conflict")));
  },2200);
}
export async function listArchivedV4StudioProjects(){
  const result=await scopedCall(projectsApi,"list_archived");
  return result?result.projects||[]:null;
}
export async function restoreV4StudioProject(projectId,expectedRevision){
  await init();
  if(!activeSchool||!auth.currentUser)return null;
  if(!Number.isInteger(expectedRevision)||expectedRevision<1)
    throw Error("The archived school project revision is required.");
  const result=await scopedCall(projectsApi,"restore",{projectId,expectedRevision});
  setRevision(auth.currentUser.uid,activeSchool.schoolId,projectId,result.revision);
  return result;
}
export async function listV4StudioProjects(){
  const result=await scopedCall(projectsApi,"list");
  return result?result.projects||[]:null;
}
export async function loadV4StudioProject(projectId){
  const result=await scopedCall(projectsApi,"get",{projectId});
  if(result&&auth.currentUser&&picker?.scope.current)
    setRevision(auth.currentUser.uid,picker.scope.current.schoolId,projectId,result.revision);
  return result;
}
export async function archiveV4StudioProject(projectId){
  await init();
  if(!activeSchool||!auth.currentUser)return null;
  let revision=getRevision(auth.currentUser.uid,activeSchool.schoolId,projectId);
  if(!revision){
    const current=await scopedCall(projectsApi,"get",{projectId});
    if(!current)return null;
    revision=current.revision;
    setRevision(auth.currentUser.uid,activeSchool.schoolId,projectId,revision);
  }
  const result=await scopedCall(projectsApi,"archive",{projectId,expectedRevision:revision});
  setRevision(auth.currentUser.uid,activeSchool.schoolId,projectId,result.revision);
  return result;
}
export async function listV4StudioAssignments(){
  const result=await scopedCall(assessmentsApi,"list_student");
  return result?result.assignments||[]:null;
}
export async function getV4StudioSubmissionStatus(taskId){
  return scopedCall(submissionsApi,"my_status",{taskId});
}
export async function submitV4StudioProject({taskId,project,state}){
  const saved=await syncV4StudioProject(project,state);
  if(!saved)throw Error("Verified school project storage is not available.");
  return scopedCall(submissionsApi,"submit",{
    taskId,projectId:saved.projectId,projectRevision:saved.revision
  });
}
export function v4StudioBridgeState(){
  return {school:activeSchool,lastError,available:Boolean(activeSchool)};
}
window.addEventListener("adminerva:school-ready",event=>{
  if(!picker)return;
  activeSchool=picker.scope.current;
  if(activeSchool?.schoolId===event.detail?.schoolId)
    setStatus("School project sync ready · "+activeSchool.schoolId);
});
