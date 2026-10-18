/** Practice missions, private progress and personal completion points. */
import {auth,db} from "../core/firebase-core.js";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {collection,doc,getDocs,runTransaction,serverTimestamp} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {COURSES,practiceQuestion} from "./practice-courses.mjs";
import {makePracticeTransfer,readPracticeTransfer,practiceBridgeKey} from "./practice-playground-bridge.mjs";

let user=null,completed=new Map(),reflections=new Map(),activeCourse=null,
  activeMission=null,attempt=0,question=null,choice=null,canFinish=false,
  syncing=new Set(),progressLoadVersion=0;

const el=id=>document.getElementById(id);
const reflectionDraftKey=()=>user&&activeMission
  ? "Adminerva_Practice_Draft_"+user.uid+"_"+activeMission.id+"_"+attempt:null;
function storeReflectionDraft(){
  const key=reflectionDraftKey();
  if(!key)return;
  try{
    sessionStorage.setItem(key,JSON.stringify({
      reasoning:el("practiceReasoning")?.value.slice(0,500)||"",
      observation:el("practiceObservation")?.value.slice(0,500)||""
    }));
  }catch{}
}
function restoreReflectionDraft(){
  const key=reflectionDraftKey();
  if(!key)return;
  try{
    const draft=JSON.parse(sessionStorage.getItem(key)||"null");
    if(draft){
      if(typeof draft.reasoning==="string")el("practiceReasoning").value=draft.reasoning;
      if(typeof draft.observation==="string")el("practiceObservation").value=draft.observation;
    }
  }catch{}
}

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
function persistLocal(courseId,complete,reasons,needsSync=false){
  try{localStorage.setItem(progressKey(user.uid,courseId),JSON.stringify({
    completed:complete,reflections:reasons,needsSync
  }));return true}catch{return false}
}
async function syncCourse(courseId){
  if(!user||syncing.has(courseId))return false;
  syncing.add(courseId);
  const currentUid=user.uid;
  const course=COURSES.find(c=>c.id===courseId);
  const localSet=completed.get(courseId),localNotes=reflections.get(courseId);
  try{
    // Merge with current cloud work inside a transaction so a second device
    // cannot replace earlier completions from another session.
    const ref=doc(db,"student_practice_progress",currentUid,"courses",courseId);
    const merged=await runTransaction(db,async tx=>{
      const remote=await tx.get(ref);
      const existing=remote.exists()?remote.data():{};
      const completedIds=[...new Set([...(existing.completed||[]),...localSet])]
        .filter(id=>course.missions.some(m=>m.id===id));
      const notes={...(existing.reflections||{}),...localNotes};
      tx.set(ref,{ownerUid:currentUid,courseId,completed:completedIds,
        reflections:notes,updatedAt:serverTimestamp()});
      return {completedIds,notes};
    });
    const {completedIds,notes}=merged;
    if(user?.uid!==currentUid)return false;
    completed.set(courseId,new Set(completedIds));
    reflections.set(courseId,notes);
    persistLocal(courseId,completedIds,notes,false);
    return true;
  }catch(error){
    console.warn("Practice checkpoint sync failed:",error);
    status("Cloud sync unavailable. Your local progress is retained; use Retry sync when online.");
    return false;
  }finally{syncing.delete(courseId)}
}
async function loadProgress(){
  const end = window.beginLoading?.("Loading practice progress…") || (() => {});
  try {
  const loadVersion=++progressLoadVersion;
  const uid=user.uid;
  const pending=[];
  for(const course of COURSES){
    const local=safeLocal(course.id);
    completed.set(course.id,new Set(local.completed.filter(id=>course.missions.some(m=>m.id===id))));
    reflections.set(course.id,local.reflections||{});
    if(local.needsSync)pending.push(course.id);
  }
  renderCourses();
  try{
    const snap=await getDocs(collection(db,"student_practice_progress",uid,"courses"));
    if(!user || user.uid!==uid || loadVersion!==progressLoadVersion)return;
    snap.forEach(record=>{
      const course=COURSES.find(c=>c.id===record.id);
      if(!course)return;
      const data=record.data();
      const set=completed.get(course.id);
      for(const id of data.completed||[])
        if(course.missions.some(m=>m.id===id))set.add(id);
      reflections.set(course.id,{...(data.reflections||{}),...reflections.get(course.id)});
      persistLocal(course.id,[...set],reflections.get(course.id),pending.includes(course.id));
    });
    for(const courseId of pending) await syncCourse(courseId);
    status(pending.length?"Local checkpoints checked for cloud sync.":"Your learning progress is ready.");
  }catch(error){
    console.warn("Practice progress temporarily unavailable:",error);
    status("Cloud progress unavailable. Local progress is shown; completed work will sync on your next visit.");
  }
  if(user?.uid===uid && loadVersion===progressLoadVersion){
    renderCourses();
    const params=new URLSearchParams(window.location.search);
    const course=COURSES.find(c=>c.id===params.get("course"));
    const mission=course?.missions.find(m=>m.id===params.get("mission"));
    if(mission)openMission(course,mission);
  }
  } finally { end(); }
}
function renderCourses(){
  const list=el("practiceCourseList");
  list.replaceChildren();
  const total=COURSES.reduce((sum,c)=>sum+c.missions.length,0);
  const achieved=COURSES.reduce((sum,c)=>sum+(completed.get(c.id)?.size||0),0);
  const summaries=[
    [achieved+"/"+total,"Missions completed"],
    [COURSES.filter(c=>(completed.get(c.id)?.size||0)===c.missions.length).length+"/"+COURSES.length,"Courses finished"],
    [achieved*10+" / "+total*10,"Personal practice points · self-recorded, not grades"]
  ];
  const overview=el("practiceOverview");
  if(overview){
    overview.replaceChildren();
    summaries.forEach(([value,label])=>{
      const card=node("div","bg-white rounded-xl border border-slate-200 p-4");
      card.append(node("strong","text-2xl font-extrabold text-slate-900",value),
        node("p","text-xs text-slate-600 mt-1",label));
      overview.append(card);
    });
  }
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
  const pending=readPracticeTransfer(sessionStorage,user.uid);
  if(pending?.courseId===course.id && pending.missionId===mission.id && pending.predictionCorrect)
    attempt=pending.attempt;
  el("practiceCourseList").classList.add("hidden");
  el("practiceMissionPanel").classList.remove("hidden");
  el("practiceCourseName").textContent=course.name;
  el("practiceMissionTitle").textContent=mission.title;
  el("practiceConcept").textContent=mission.concept;
  el("practiceReasoning").value=reflections.get(course.id)?.[mission.id]||"";
  renderQuestion();
  restoreReflectionDraft();
  if(pending?.courseId===course.id && pending.missionId===mission.id && pending.predictionCorrect){
    el("practiceReasoning").value=pending.reasoning||"";
    // The student may have started the comparison on an earlier visit.
    restoreReflectionDraft();
    choice=question.correct;
    revealExperiment();
    el("practiceExperimentStatus").textContent=pending.runCount>0
      ? "Playground run attempted. Compare the output or preview with your prediction below."
      : "The experiment is ready. Open the sandbox and select Run before continuing.";
    if(pending.runCount>0){
      el("practiceReflectionPanel").classList.remove("hidden");
      el("practiceFinishBtn").classList.remove("hidden");
      el("practiceStage").textContent="Step 3 of 3 · Compare and reflect";
    }
  }
  el("practiceMissionPanel").scrollIntoView({behavior:"smooth",block:"start"});
}
function renderQuestion(){
  question=practiceQuestion(user.uid,activeMission,attempt);
  choice=null;canFinish=false;
  el("practiceStage").textContent="Step 1 of 3 · Predict";
  el("practiceExperimentPanel").classList.add("hidden");
  el("practiceReflectionPanel").classList.add("hidden");
  el("practiceObservation").value="";
  el("practiceExperimentStatus").textContent="";
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
  revealExperiment();
  el("practiceRetryBtn").classList.add("hidden");
  el("practiceCheckBtn").classList.add("hidden");
}
function revealExperiment(){
  canFinish=true;
  el("practiceStage").textContent="Step 2 of 3 · Test";
  el("practiceExperimentPanel").classList.remove("hidden");
  el("practiceCheckBtn").classList.add("hidden");
  el("practiceRetryBtn").classList.add("hidden");
}
function openExperiment(event){
  if(!canFinish||!user)return event.preventDefault();
  const transfer=makePracticeTransfer(user.uid,activeCourse.id,activeMission.id,attempt);
  if(!transfer){event.preventDefault();return status("Could not prepare a sandbox. Reload this mission.")}
  transfer.predictionCorrect=true;
  transfer.reasoning=el("practiceReasoning").value.trim().slice(0,500);
  transfer.predicted=question.choices[question.correct];
  try{sessionStorage.setItem(practiceBridgeKey(user.uid),JSON.stringify(transfer))}
  catch(error){event.preventDefault();status("Browser session storage is unavailable; the sandbox cannot be opened safely.")}
}
async function finishMission(){
  if(!canFinish||!activeMission||!user)return;
  const transfer=readPracticeTransfer(sessionStorage,user.uid);
  const observation=el("practiceObservation").value.trim();
  if(!transfer || transfer.courseId!==activeCourse.id ||
    transfer.missionId!==activeMission.id || transfer.attempt!==attempt ||
    transfer.runCount<1){
    return status("Run or preview this example in the practice sandbox, then return to complete it.");
  }
  if(observation.length<25)
    return status("Describe what you observed and how it compares with your prediction (at least 25 characters).");
  const id=activeCourse.id;
  const set=completed.get(id);
  set.add(activeMission.id);
  const notes=reflections.get(id);
  const reasoning=el("practiceReasoning").value.trim().slice(0,240);
  notes[activeMission.id]=("Prediction: "+reasoning+"\nObserved: "+observation).slice(0,500);
  const localOkay=persistLocal(id,[...set],notes,true);
  el("practiceFinishBtn").disabled=true;
  try{
    if(!await syncCourse(id))throw Error("Cloud checkpoint unavailable");
    status("Mission completed: reasoning and experiment reflection saved to your account.");
  }catch(error){
    console.warn("Practice cloud save failed:",error);
    status(localOkay?"Mission saved on this device; it will retry cloud sync on your next visit.":"Storage unavailable. Save your reflection elsewhere and retry.");
  }finally{el("practiceFinishBtn").disabled=false}
  try{
    sessionStorage.removeItem(practiceBridgeKey(user.uid));
    sessionStorage.removeItem(reflectionDraftKey());
  }catch{}
  renderCourses();
}
el("practiceSyncBtn")?.addEventListener("click",async()=>{
  if(!user)return;
  const button=el("practiceSyncBtn");
  button.disabled=true;
  status("Checking pending course progress…");
  try{
    const pending=COURSES.filter(course=>safeLocal(course.id).needsSync);
    if(!pending.length){status("All locally saved practice checkpoints are up to date.");return}
    let successful=0;
    for(const course of pending){
      if(await syncCourse(course.id))successful++;
    }
    status(successful===pending.length
      ? "All pending practice checkpoints are saved to your account."
      : successful+" of "+pending.length+" pending courses synced. Retry when connected.");
    renderCourses();
  }finally{button.disabled=false}
});
el("practiceBackBtn")?.addEventListener("click",renderCourses);
el("practiceReasoning")?.addEventListener("input",storeReflectionDraft);
el("practiceObservation")?.addEventListener("input",storeReflectionDraft);
el("practiceExperimentLink")?.addEventListener("click",openExperiment);
el("practiceCheckBtn")?.addEventListener("click",checkPrediction);
el("practiceRetryBtn")?.addEventListener("click",()=>{attempt++;renderQuestion()});
el("practiceFinishBtn")?.addEventListener("click",()=>void finishMission());
onAuthStateChanged(auth,async current=>{
  user=current;
  if(!current){status("Sign in to start Practice Lab.");return}
  await loadProgress();
});
