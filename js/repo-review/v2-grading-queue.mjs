import {resolveStaffRole} from "../core/staff-session.mjs?v=2026.10.20.1";
/**
 * RepoFetch is the primary V2 assessment workspace.
 * Evidence and Contribution Inspector remain supporting pages with deep links.
 * No automatic grade writes or grade publication occur from this queue.
 */
import {auth,db} from "../core/firebase-core.js";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {collection,getDocs,query,where}
  from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {parseRepository} from "./services/assessment-evidence.mjs";
import {gradeMatchesEvidence} from "./services/evidence-lifecycle.mjs";

const el=id=>document.getElementById(id);
const node=(tag,content="",className="")=>{
  const item=document.createElement(tag);item.textContent=content;
  if(className)item.className=className;
  return item;
};
const qs=new URLSearchParams(location.search);
let roster=[],assessments=[],activeTask=null,loadId=0,initDeepLink=true;
function status(text){el("v2QueueStatus").textContent=text;}
function link(text,url){
  const a=node("a",text,"text-indigo-700 underline font-semibold text-xs");
  a.href=url;return a;
}
function selectOptions(select,options,placeholder){
  select.replaceChildren();
  const empty=node("option",placeholder);empty.value="";select.append(empty);
  for(const {value,label} of options){const opt=node("option",label);opt.value=value;select.append(opt);}
}
function scopedUrl(path,student,task){
  const params=new URLSearchParams({
    section:student.section,student:student.id,assessment:task.id
  });
  return path+"?"+params.toString();
}
async function initialize(user){
  if(!await resolveStaffRole(user)){
    status("Sign in with an authorized instructor account to review V2 submissions.");
    el("v2Queue").replaceChildren();return;
  }
  try{
    status("Loading V2 assessments and student roster…");
    const [studentsSnap,assessmentSnap]=await Promise.all([
      getDocs(collection(db,"students")),getDocs(collection(db,"assessments"))
    ]);
    if(auth.currentUser?.uid!==user.uid)return;
    roster=studentsSnap.docs.map(d=>({id:d.id,...d.data()}));
    assessments=assessmentSnap.docs.map(d=>({id:d.id,...d.data()}))
      .filter(a=>a.schemaVersion===2);
    const sections=[...new Set(roster.map(s=>s.section).filter(s=>typeof s==="string"&&s))].sort();
    selectOptions(el("v2SectionSelect"),sections.map(v=>({value:v,label:v})),"Choose section");
    const requested=qs.get("section");
    const fallback=el("sectionSelect")?.value;
    el("v2SectionSelect").value=sections.includes(requested)?requested:
      sections.includes(fallback)?fallback:(sections[0]||"");
    await updateAssessments();
  }catch(error){status("Could not load grading queue: "+error.message);}
}
async function updateAssessments(){
  const section=el("v2SectionSelect").value,select=el("v2AssessmentSelect");
  const tasks=assessments.filter(a=>(a.deployments||[]).some(d=>d.section===section));
  selectOptions(select,tasks.map(a=>({value:a.id,label:a.title||a.id})),"Choose V2 assessment");
  select.value=tasks.some(a=>a.id===qs.get("assessment"))?qs.get("assessment"):(tasks[0]?.id||"");
  await renderQueue();
}
function eligibility(evidence){
  return evidence?.status==="approved" &&
    /^[a-f0-9]{40}$/i.test(evidence.approvedCheckpointSha||"") &&
    evidence.approvedCheckpointSha===evidence.checkpointSha;
}
async function renderQueue(){
  const sequence=++loadId;
  const section=el("v2SectionSelect").value,assessmentId=el("v2AssessmentSelect").value;
  const container=el("v2Queue");container.replaceChildren();
  activeTask=assessments.find(a=>a.id===assessmentId);
  if(!section||!activeTask){status("Choose a class section and V2 assessment.");return;}
  status("Loading submission and grading status for "+(activeTask.title||assessmentId)+"…");
  try{
    const [evidenceSnap,gradeSnap]=await Promise.all([
      getDocs(query(collection(db,"assessment_evidence"),where("assessmentId","==",assessmentId))),
      getDocs(query(collection(db,"student_grades"),where("taskId","==",assessmentId)))
    ]);
    if(sequence!==loadId)return;
    const evidence=new Map(evidenceSnap.docs.map(d=>[d.data().studentId,d.data()]));
    const grades=new Map(gradeSnap.docs.map(d=>[d.data().studentId,d.data()]));
    const members=roster.filter(s=>s.section===section)
      .sort((a,b)=>(a.name||a.id).localeCompare(b.name||b.id));
    let pending=0,approved=0,drafts=0,published=0;
    for(const student of members){
      const ev=evidence.get(student.id),grade=grades.get(student.id);
      const row=node("article","","p-4 border border-slate-200 rounded-xl bg-white space-y-2 sm:space-y-0 sm:flex sm:items-center sm:justify-between sm:gap-4");
      const heading=node("div","","min-w-0");
      heading.append(node("p",student.name||student.id,"text-sm font-bold text-slate-900 break-words"));
      const repoText=String(student.repoUrl||"").trim();
      heading.append(node("p",repoText||"No GitHub repository linked","text-xs text-slate-500 break-all"));
      let stateText="",stateClass="text-slate-600";
      if(grade?.published===true){published++;stateText="Published "+grade.score+"/"+(grade.maxScore||activeTask.maxScore);}
      else if(grade){drafts++;stateText=gradeMatchesEvidence(grade,ev)?
        "Saved private grade draft · "+grade.score+"/"+(grade.maxScore||activeTask.maxScore):
        "Grade draft requires fresh evidence review · publication blocked";}
      else if(eligibility(ev)){approved++;stateText="Checkpoint approved · ready to grade";stateClass="text-emerald-700";}
      else if(ev){pending++;stateText="Evidence "+String(ev.status||"needs review")+" · approval required";stateClass="text-amber-800";}
      else{pending++;stateText="No approved evidence";stateClass="text-slate-500";}
      heading.append(node("p",stateText,"text-xs font-semibold mt-1 "+stateClass));
      const actions=node("div","","flex flex-wrap items-center gap-3 sm:justify-end mt-3 sm:mt-0");
      let repo=null;try{repo=parseRepository(repoText);}catch{}
      const review=node("button",grade?.published?"Review published grade":"Review & Grade",
        "bg-blue-700 text-white rounded-lg px-4 py-2.5 text-xs font-bold disabled:opacity-50");
      review.type="button";review.disabled=!repo;
      review.addEventListener("click",()=>{
        if(typeof window.openManualGradeReview!=="function"){
          status("Grading tools are still loading. Refresh and try again.");return;
        }
        window.openManualGradeReview({studentId:student.id,taskId:assessmentId,
          owner:repo.owner,repo:repo.repo});
      });
      actions.append(review);
      row.append(heading,actions);container.append(row);
    }
    status(members.length+" students · "+approved+" approved checkpoints awaiting grading · "+
      drafts+" unpublished grades · "+published+" published · "+pending+" awaiting evidence/review");
    if(!members.length)container.append(node("p","No students found in this section.","text-slate-600 text-sm p-4"));
    if(initDeepLink){
      initDeepLink=false;
      const targetStudent=members.find(s=>s.id===qs.get("student"));
      if(targetStudent&&activeTask.id===qs.get("assessment")){
        const repoUrl=String(targetStudent.repoUrl||"");
        try{
          const repo=parseRepository(repoUrl);
          window.openManualGradeReview?.({studentId:targetStudent.id,
            taskId:activeTask.id,owner:repo.owner,repo:repo.repo});
        }catch{status("Student repository is not linked; open Evidence Review to investigate.");}
      }
    }
  }catch(error){
    if(sequence===loadId)status("Unable to load grading queue: "+error.message);
  }
}
el("v2SectionSelect").addEventListener("change",()=>{void updateAssessments();});
el("v2AssessmentSelect").addEventListener("change",()=>{void renderQueue();});
el("v2RefreshQueue").addEventListener("click",()=>{void renderQueue();});
window.addEventListener("adminerva:manual-grade-saved",()=>{void renderQueue();});
onAuthStateChanged(auth,user=>{void initialize(user);});
