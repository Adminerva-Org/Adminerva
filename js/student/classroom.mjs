import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs?v=4.0.0";

const functions=getFunctions(app,"asia-southeast1");
const profileApi=httpsCallable(functions,"schoolStudentProfile");
const assessmentsApi=httpsCallable(functions,"schoolAssessments");
const el=id=>document.getElementById(id);
const fallback={subjectId:"computer-programming",subject:"Computer Programming",classes:[],offeringIds:[],legacy:true};
let picker=null,subjects=[fallback],selected=fallback,busy=false,epoch=0;

function node(tag,className,text){
  const item=document.createElement(tag);if(className)item.className=className;
  if(text!==undefined)item.textContent=String(text);return item;
}
function subjectKey(value){return String(value||"").trim().toLowerCase();}
function programmingSubject(item){
  const name=subjectKey(item?.subject);
  return name.includes("computer programming")||name==="programming"||name.includes("programming");
}
function queryFor(item){
  const params=new URLSearchParams();
  if(item?.subjectId)params.set("subjectId",item.subjectId);
  if(item?.subject)params.set("subject",item.subject);
  if(item?.offeringIds?.length===1)params.set("offeringId",item.offeringIds[0]);
  const text=params.toString();return text?"?"+text:"";
}
function remember(item){
  try{sessionStorage.setItem("Adminerva_classroom_subject",JSON.stringify({subjectId:item.subjectId,subject:item.subject}));}catch{}
}
function preferredSubject(){
  const params=new URLSearchParams(location.search);
  const requested=params.get("subjectId")||"";
  if(requested){
    const match=subjects.find(item=>item.subjectId===requested);
    if(match)return match;
  }
  try{
    const stored=JSON.parse(sessionStorage.getItem("Adminerva_classroom_subject")||"null");
    const match=stored&&subjects.find(item=>item.subjectId===stored.subjectId);
    if(match)return match;
  }catch{}
  return subjects.find(programmingSubject)||subjects[0]||fallback;
}
function renderSelected(item){
  selected=item||fallback;remember(selected);
  el("selectedSubjectTitle").textContent=selected.subject||"Computer Programming";
  const labels=[...new Set((selected.classes||[]).flatMap(row=>[row.section,row.term,row.year]).filter(Boolean))];
  el("selectedSubjectMeta").textContent=labels.length?labels.join(" · "):
    selected.legacy?"Current default classroom for your programming assignments.":
    "Active school subject.";
  const q=queryFor(selected);
  el("classroomAssignments").href="student-assessments.html"+q;
  el("classroomGrades").href="school-student-grades.html"+q;
  el("classroomProjects").href="school-student-projects.html"+q;
  el("classroomAssignmentHint").textContent=programmingSubject(selected)?
    "Open current school tasks and migrated legacy programming assignments.":
    "Open current assignments for this subject.";
  for(const button of el("classroomSubjects").querySelectorAll("[data-subject-id]")){
    const active=button.dataset.subjectId===selected.subjectId;
    button.setAttribute("aria-pressed",active?"true":"false");
    button.classList.toggle("border-cyan-500",active);
    button.classList.toggle("bg-cyan-50",active);
    button.classList.toggle("border-slate-200",!active);
    button.querySelector("[data-selected]")?.classList.toggle("hidden",!active);
  }
}
function renderSubjects(){
  const host=el("classroomSubjects");host.replaceChildren();
  for(const item of subjects){
    const button=node("button","text-left rounded-xl border p-4 hover:border-cyan-400 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-cyan-500 transition","");button.type="button";
    button.dataset.subjectId=item.subjectId;button.setAttribute("aria-pressed","false");
    const top=node("div","flex justify-between items-start gap-3");
    top.append(node("strong","text-base",item.subject));
    const selectedBadge=node("span","hidden rounded-full bg-cyan-800 text-white text-[10px] font-extrabold px-2 py-1","SELECTED");
    selectedBadge.dataset.selected="true";top.append(selectedBadge);button.append(top);
    const sections=[...new Set((item.classes||[]).map(row=>row.section).filter(Boolean))];
    button.append(node("span","block text-xs text-slate-500 mt-2",
      sections.length?sections.join(" · "):item.legacy?"Default programming classroom":"Active school enrollment"));
    const count=item.assignmentCount;
    if(Number.isFinite(count))button.append(node("span","block text-xs font-bold text-indigo-700 mt-3",
      count+" current assignment"+(count===1?"":"s")));
    button.addEventListener("click",()=>renderSelected(item));
    host.append(button);
  }
  renderSelected(preferredSubject());
}
function groupSubjects(profile,tasks){
  const map=new Map();
  for(const row of profile?.classes||[]){
    const id=String(row.subjectId||subjectKey(row.subject)||"subject");
    if(!map.has(id))map.set(id,{subjectId:id,subject:row.subject||"Subject",classes:[],offeringIds:[],legacy:false,assignmentCount:0});
    const item=map.get(id);item.classes.push(row);item.offeringIds.push(row.offeringId);
  }
  for(const task of tasks||[]){
    const item=[...map.values()].find(entry=>entry.offeringIds.includes(task.offeringId));
    if(item)item.assignmentCount++;
  }
  const rows=[...map.values()].sort((a,b)=>{
    const ap=programmingSubject(a)?0:1,bp=programmingSubject(b)?0:1;
    return ap-bp||a.subject.localeCompare(b.subject);
  });
  return rows.length?rows:[fallback];
}
function say(message,error=false){
  el("classroomStatus").textContent=message;
  el("classroomStatus").className="text-sm mt-3 "+(error?"text-rose-700":"text-slate-600");
}
async function scoped(api,action){
  const lease=picker.scope.lease();
  const result=(await api({schoolId:lease.schoolId,action})).data;
  picker.scope.assertLease(lease);return result;
}
async function refresh(){
  if(!picker?.scope.current||busy)return;
  const sequence=++epoch;busy=true;el("classroomRefresh").disabled=true;say("Loading your active subjects…");
  try{
    const [profile,tasks]=await Promise.all([
      scoped(profileApi,"my_profile"),
      scoped(assessmentsApi,"list_student").catch(()=>({assignments:[]}))
    ]);
    if(sequence!==epoch)return;
    subjects=groupSubjects(profile,tasks.assignments||[]);
    renderSubjects();
    say(subjects.length===1?
      subjects[0].subject+" is your active classroom subject.":
      subjects.length+" active subjects are available. Computer Programming stays the default when it is enrolled.");
  }catch(error){
    if(sequence!==epoch)return;
    subjects=[fallback];renderSubjects();
    say("Using the Computer Programming classroom. Verified school subjects could not be loaded: "+(error?.message||"retry later"),true);
  }finally{
    if(sequence===epoch){busy=false;el("classroomRefresh").disabled=false;}
  }
}
renderSubjects();
picker=createTenantSchoolPicker({
  host:el("classroomSchoolSwitcher"),status:el("classroomStatus"),
  onBeforeChange:async()=>{if(busy)throw new Error("Finish loading before switching schools.");++epoch;subjects=[fallback];renderSubjects();},
  onReady:scope=>{if(scope.current)void refresh();}
});
el("classroomRefresh").addEventListener("click",()=>void refresh());
try{
  await picker.load();
  if(!auth.currentUser)say("Sign in with your student account to load school subjects.",true);
}catch(error){
  say("Computer Programming is ready as the default classroom. "+(error?.message||"School subject lookup is unavailable."),true);
}