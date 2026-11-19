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
function subjectPageFor(item){
  const params=new URLSearchParams();
  if(item?.subjectId)params.set("subjectId",item.subjectId);
  if(item?.subject)params.set("subject",item.subject);
  if(item?.offeringIds?.length===1)params.set("offeringId",item.offeringIds[0]);
  if(item?.legacy)params.set("legacy","1");
  params.set("v","20261115-stream3");
  return "student-subject.html?"+params.toString();
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
function renderSubjects(){
  const host=el("classroomSubjects");host.replaceChildren();
  if(!subjects.length)host.append(node("p","rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600","No active subjects are assigned to this school account yet."));
  for(const item of subjects){
    const card=node("a","text-left rounded-xl border p-4 hover:border-cyan-400 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-cyan-500 transition","");
    card.href=subjectPageFor(item);card.dataset.subjectId=item.subjectId;
    const top=node("div","flex justify-between items-start gap-3");
    top.append(node("strong","text-base",item.subject));
    const selectedBadge=node("span","rounded-full bg-cyan-800 text-white text-[10px] font-extrabold px-2 py-1",
      programmingSubject(item)?"DEFAULT":"SUBJECT");
    top.append(selectedBadge);card.append(top);
    const sections=[...new Set((item.classes||[]).map(row=>row.section).filter(Boolean))];
    card.append(node("span","block text-xs text-slate-500 mt-2",
      sections.length?sections.join(" · "):item.legacy?"Default programming classroom":"Active school enrollment"));
    const count=item.assignmentCount;
    if(Number.isFinite(count))card.append(node("span","block text-xs font-bold text-indigo-700 mt-3",
      count+" current assignment"+(count===1?"":"s")));
    card.append(node("span","block text-sm font-extrabold text-cyan-800 mt-4","Open classroom →"));
    host.append(card);
  }
}
function groupSubjects(profile,tasks){
  const map=new Map(),byOffering=new Map();
  const countsAvailable=Array.isArray(tasks);
  for(const row of profile?.classes||[]){
    const id=String(row.subjectId||subjectKey(row.subject)||"subject");
    if(!map.has(id))map.set(id,{subjectId:id,subject:row.subject||"Subject",classes:[],offeringIds:[],legacy:false,assignmentCount:countsAvailable?0:null});
    const item=map.get(id);item.classes.push(row);if(row.offeringId&&!item.offeringIds.includes(row.offeringId)){item.offeringIds.push(row.offeringId);byOffering.set(row.offeringId,item);}
  }
  for(const task of tasks||[]){
    const item=byOffering.get(task.offeringId);
    if(item)item.assignmentCount++;
  }
  const rows=[...map.values()].sort((a,b)=>{
    const ap=programmingSubject(a)?0:1,bp=programmingSubject(b)?0:1;
    return ap-bp||a.subject.localeCompare(b.subject);
  });
  return rows;
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
      scoped(assessmentsApi,"list_student").catch(()=>null)
    ]);
    if(sequence!==epoch)return;
    subjects=groupSubjects(profile,tasks?.assignments??null);
    renderSubjects();
    const message=subjects.length===0?"No active school subjects found. Ask your adviser to check enrollment.":subjects.length===1?subjects[0].subject+" is your active classroom subject.":subjects.length+" active subjects are available. Computer Programming stays the default when it is enrolled.";
    say(message+(tasks?"":" Assignment counts are temporarily unavailable."),!tasks||!subjects.length);
  }catch(error){
    if(sequence!==epoch)return;
    subjects=[];renderSubjects();
    say("Verified school subjects could not be loaded: "+(error?.message||"retry later")+". Refresh to retry.",true);
  }finally{
    if(sequence===epoch){busy=false;el("classroomRefresh").disabled=false;}
  }
}
renderSubjects();
picker=createTenantSchoolPicker({
  host:el("classroomSchoolSwitcher"),status:null,
  onBeforeChange:async()=>{if(busy)throw new Error("Finish loading before switching schools.");++epoch;subjects=[];renderSubjects();},
  onReady:scope=>{if(scope.current)void refresh();}
});
el("classroomRefresh").addEventListener("click",()=>void refresh());
try{
  const state=await picker.load();
  if(!auth.currentUser)say("Sign in with your student account to load school subjects.",true);
  else if(state?.state==="no_school")
    say("Computer Programming is ready from your existing Adminerva class. School-scoped announcements will join automatically after verified school access is linked.");
  else if(state?.state==="choose_school")
    say("Choose your active school to load its subjects. Computer Programming remains available from your existing Adminerva class.");
}catch(error){
  say("Computer Programming is ready from your existing Adminerva class. Verified school subjects are temporarily unavailable.");
}