import {auth,db} from "../core/firebase-core.js";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {collection,doc,getDocs,setDoc,serverTimestamp} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {COURSES,practiceQuestion} from "./practice-courses.mjs";

let user=null,completed=new Map(),reflections=new Map(),activeCourse=null,
  activeMission=null,attempt=0,question=null,choice=null,canFinish=false;

const el=id=>document.getElementById(id);
const status=msg=>{if(el("practiceStatus"))el("practiceStatus").textContent=msg};
const node=(tag,classes,text)=>{
  const e=document.createElement(tag);
  if(classes)e.className=classes;
  if(text!==undefined)e.textContent=String(text);
  return e;
};
function progressKey(uid,courseId){
  return "Adminerva_Practice_v1_"+uid+"_"+courseId;
}
function safeLocal(courseId){
  try{
    const data=JSON.parse(localStorage.getItem(progressKey(user.uid,courseId))||"null");
    return data&&Array.isArray(data.completed)?data:{completed:[],reflections:{}};
  }catch{return {completed:[],reflections:{}}}
}
function persistLocal(courseId,complete,reasons){
  try{localStorage.setItem(progressKey(user.uid,courseId),JSON.stringify({
    completed:complete,reflections:reasons
  }));return true}catch{return false}
}
async function loadProgress(){
  for(const course of COURSES){
    const local=safeLocal(course.id);
    completed.set(course.id,new Set(local.completed.filter(id=>course.missions.some(m=>m.id===id))));
    reflections.set(course.id,local.reflections||{});
  }
  try{
    const snap=await getDocs(collection(db,"student_practice_progress",user.uid,"courses"));
    snap.forEach(record=>{
      const course=COURSES.find(c=>c.id===record.id);
      if(!course)return;
      const data=record.data();
      const set=completed.get(course.id);
      for(const id of data.completed||[])
        if(course.missions.some(m=>m.id===id))set.add(id);
      reflections.set(course.id,{...(data.reflections||{}),...reflections.get(course.id)});
      persistLocal(course.id,[...set],reflections.get(course.id));
    });
    status("Your practice progress is loaded. Complete a mission to save a checkpoint.");
  }catch(error){
    console.warn("Practice progress temporarily unavailable:",error);
    status("Cloud progress unavailable. Local progress is shown; new completions will be kept on this device.");
  }
  renderCourses();
}
function renderCourses(){
  const list=el("practiceCourseList");
  list.replaceChildren();
  el("practiceMissionPanel").classList.add("hidden");
  list.classList.remove("hidden");
  for(const course of COURSES){
    const count=completed.get(course.id)?.size||0;
    const card=node("article","rounded-xl bg-white border border-slate-200 p-5 shadow-sm");
    card.append(node("div","text-2xl",course.icon),node("h2","text-xl font-extrabold mt-3",course.name),
      node("p","text-sm text-slate-600 mt-1",course.subtitle),
      node("p","text-xs font-semibold text-blue-900 mt-3",count+" of "+course.missions.length+" missions completed"));
    const progress=node("div","mt-3 h-2 rounded-full bg-slate-100 overflow-hidden");
    const fill=node("div","h-full bg-emerald-500");
    fill.style.width=(count/course.missions.length*100)+"%";
    progress.append(fill);card.append(progress);
    const entries=node("div","mt-4 flex flex-col gap-2");
    course.missions.forEach((mission,index)=>{
      const done=completed.get(course.id).has(mission.id);
      const locked=index>0&&!completed.get(course.id).has(course.missions[index-1].id);
      const b=node("button","text-left rounded-lg border px-3 py-3 text-sm font-semibold "+
        (locked?"bg-slate-50 text-slate-400":done?"bg-emerald-50 text-emerald-900 border-emerald-200":"bg-blue-50 text-blue-800 border-blue-200"),
        (done?"✓ ":locked?"🔒 ":"→ ")+(index+1)+". "+mission.title);
      b.type="button";b.disabled=locked;
      b.addEventListener("click",()=>openMission(course,mission));
      entries.append(b);
    });
    card.append(entries);list.append(card);
  }
}
function openMission(course,mission){
  activeCourse=course;activeMission=mission;attempt=0;
  el("practiceCourseList").classList.add("hidden");
  el("practiceMissionPanel").classList.remove("hidden");
  el("practiceCourseName").textContent=course.name;
  el("practiceMissionTitle").textContent=mission.title;
  el("practiceConcept").textContent=mission.concept;
  el("practiceReasoning").value=reflections.get(course.id)?.[mission.id]||"";
  renderQuestion();
  el("practiceMissionPanel").scrollIntoView({behavior:"smooth",block:"start"});
}
function renderQuestion(){
  question=practiceQuestion(user.uid,activeMission,attempt);
  choice=null;canFinish=false;
  el("practiceCode").textContent=question.code;
  el("practicePrompt").textContent=question.prompt;
  el("practiceFeedback").textContent="";
  el("practiceFinishBtn").classList.add("hidden");
  el("practiceRetryBtn").classList.add("hidden");
  el("practiceCheckBtn").classList.remove("hidden");
  const list=el("practiceChoices");list.replaceChildren();
  question.choices.forEach((answer,index)=>{
    const label=node("label","cursor-pointer border border-slate-300 rounded-lg p-3 text-sm flex gap-2 items-center hover:bg-blue-50");
    const radio=node("input","h-4 w-4");radio.type="radio";radio.name="practiceAnswer";
    radio.value=String(index);
    radio.addEventListener("change",()=>{choice=index});
    label.append(radio,node("span","",answer));list.append(label);
  });
}
function checkPrediction(){
  const feedback=el("practiceFeedback");
  const reasoning=el("practiceReasoning").value.trim();
  if(choice===null){feedback.textContent="Choose a prediction first.";return}
  if(reasoning.length<25){feedback.textContent="Explain the reasoning in your own words (at least 25 characters).";return}
  if(choice!==question.correct){
    feedback.textContent="Not quite. "+activeMission.concept+" Try another example and trace each step.";
    el("practiceRetryBtn").classList.remove("hidden");
    return;
  }
  canFinish=true;
  feedback.textContent="Correct prediction. "+question.why;
  el("practiceFinishBtn").classList.remove("hidden");
  el("practiceRetryBtn").classList.add("hidden");
  el("practiceCheckBtn").classList.add("hidden");
}
async function finishMission(){
  if(!canFinish||!activeMission||!user)return;
  const id=activeCourse.id;
  const set=completed.get(id);
  set.add(activeMission.id);
  const notes=reflections.get(id);
  notes[activeMission.id]=el("practiceReasoning").value.trim().slice(0,500);
  const data={ownerUid:user.uid,courseId:id,completed:[...set],
    reflections:notes,updatedAt:serverTimestamp()};
  const localOkay=persistLocal(id,[...set],notes);
  el("practiceFinishBtn").disabled=true;
  try{
    await setDoc(doc(db,"student_practice_progress",user.uid,"courses",id),data);
    status("Mission completed and saved to your account.");
  }catch(error){
    console.warn("Practice cloud save failed:",error);
    status(localOkay?"Mission saved on this device; cloud sync failed. Open this course again to retry.":"Progress could not be saved. Please reconnect and try again.");
  }finally{el("practiceFinishBtn").disabled=false}
  renderCourses();
}
el("practiceBackBtn")?.addEventListener("click",renderCourses);
el("practiceCheckBtn")?.addEventListener("click",checkPrediction);
el("practiceRetryBtn")?.addEventListener("click",()=>{attempt++;renderQuestion()});
el("practiceFinishBtn")?.addEventListener("click",()=>void finishMission());
onAuthStateChanged(auth,async current=>{
  user=current;
  if(!current){status("Sign in to start Practice Lab.");return}
  await loadProgress();
});
