import {app,auth} from "./firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {resolveAccountAccess} from "./staff-session.mjs?v=4.0.0";
import {createTenantSchoolPicker} from "./tenant-school-picker.mjs?v=4.0.0";

const api=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolOnboardingReadiness");
const statusNode=document.getElementById("setup-status");
const summaryNode=document.getElementById("setup-summary");
const progressBar=document.getElementById("setup-progress-bar");
const countsNode=document.getElementById("setup-counts");
const stepsNode=document.getElementById("setup-steps");
const noteNode=document.getElementById("setup-note");
const refreshButton=document.getElementById("setup-refresh");

const actions={
  school_admin:["people-access.html","Review access"],
  people:["people-access.html","Open People & Access"],
  teacher_access:["people-access.html","Review teacher access"],
  student_access:["people-access.html","Review student access"],
  academic_catalog:["people-access.html#classes","Configure academics"],
  course_offerings:["people-access.html#classes","Manage offerings"],
  teaching_assignments:["people-access.html#classes","Assign teachers"],
  student_enrollments:["people-access.html#classes","Enroll students"],
  file_policy:["school-data-controls.html","Configure files"],
  school_ai:["settings.html","Open settings"]
};
const countLabels=[
  ["activePeople","People"],
  ["activeTeachers","Teachers"],
  ["activeStudents","Students"],
  ["activeOfferings","Offerings"],
  ["activeAssignments","Teaching assignments"],
  ["activeEnrollments","Enrollments"],
  ["pendingInvitations","Pending invites"]
];

let activeScope=null;
function escapeText(value){return document.createTextNode(String(value??""))}
function setText(node,value){node.replaceChildren(escapeText(value))}
function badgeLabel(status){
  if(status==="complete")return "Complete";
  if(status==="optional")return "Optional";
  return "Needs attention";
}
function renderCounts(counts){
  countsNode.replaceChildren();
  for(const [key,label] of countLabels){
    const card=document.createElement("div");
    card.className="setup-count";
    const name=document.createElement("p");
    name.className="text-xs font-extrabold uppercase tracking-wide text-slate-500";
    setText(name,label);
    const value=document.createElement("strong");
    value.className="text-2xl";
    setText(value,Number.isInteger(counts?.[key])?counts[key]:0);
    card.append(name,value);
    countsNode.append(card);
  }
}
function renderSteps(steps){
  stepsNode.replaceChildren();
  for(const step of steps||[]){
    const card=document.createElement("article");
    card.className="setup-card";
    const head=document.createElement("div");
    head.className="setup-head";
    const title=document.createElement("h3");
    title.className="font-extrabold text-base";
    setText(title,step.label);
    const badge=document.createElement("span");
    badge.className="setup-badge "+step.status;
    setText(badge,badgeLabel(step.status));
    head.append(title,badge);

    const detail=document.createElement("p");
    detail.className="setup-muted text-sm mt-2";
    setText(detail,step.detail);

    const meta=document.createElement("p");
    meta.className="text-xs font-bold mt-3 "+(step.blocking?"text-slate-600":"text-slate-500");
    setText(meta,step.blocking?"Required for normal school operation":"Optional school service");
    card.append(head,detail,meta);

    const action=actions[step.id];
    if(action){
      const link=document.createElement("a");
      link.href=action[0];
      link.className="setup-link mt-1";
      setText(link,action[1]);
      card.append(link);
    }else if(step.id==="institution"&&step.status!=="complete"){
      const ownerNote=document.createElement("p");
      ownerNote.className="text-xs font-bold text-amber-800 mt-2";
      setText(ownerNote,"Platform-owner review is required for institutional attestations.");
      card.append(ownerNote);
    }
    stepsNode.append(card);
  }
}
function render(data){
  const progress=data.progress||{},done=Number(progress.completedRequired||0),
    total=Math.max(1,Number(progress.totalRequired||0)),
    percent=Math.max(0,Math.min(100,Math.round(done/total*100)));
  setText(summaryNode,data.operationalReady
    ?data.schoolDisplayName+" has all required operational setup items."
    :done+" of "+total+" required setup items are complete for "+data.schoolDisplayName+".");
  progressBar.style.width=percent+"%";
  renderCounts(data.counts||{});
  renderSteps(data.steps||[]);
  setText(noteNode,data.note||"Operational setup and cutover readiness are separate checks.");
}
async function refresh(scope){
  if(!scope?.current)return;
  refreshButton.disabled=true;
  setText(statusNode,"Refreshing verified school setup…");
  try{
    const lease=scope.lease();
    const response=await api({schoolId:lease.schoolId,action:"overview"});
    scope.assertLease(lease);
    render(response.data);
    setText(statusNode,response.data.operationalReady
      ?"Operational setup is ready. Optional services may still be configured."
      :"Setup still has required items needing attention.");
  }catch(error){
    setText(statusNode,error?.message||"School setup readiness is unavailable.");
  }finally{
    refreshButton.disabled=false;
  }
}

await auth.authStateReady();
const access=await resolveAccountAccess(auth.currentUser);
if(!access.schoolAdmin){
  window.location.assign(access.role==="admin"?"school-admin.html":"teacher-home.html");
}else{
  const picker=createTenantSchoolPicker({
    host:document.getElementById("setupSchoolSwitcher"),
    status:statusNode,
    onReady:scope=>{activeScope=scope;void refresh(scope);},
    onBeforeChange:async()=>{setText(statusNode,"Switching verified school context…");}
  });
  refreshButton.addEventListener("click",()=>{if(activeScope)void refresh(activeScope);});
  const state=await picker.load();
  if(state?.state==="choose_school")
    setText(statusNode,"Choose an active school to review setup readiness.");
}
