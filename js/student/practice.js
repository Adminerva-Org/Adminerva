/** Server-checked practice with private drafts, explicit session transfers and no client-awarded XP. */
import {auth,db} from "../core/firebase-core.js?v=1.3.0";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {collection,getDocs} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {COURSES} from "./practice-courses.mjs?v=1.3.0";
import {makeCheckedPracticeTransfer,readPracticeTransfer,practiceBridgeKey} from "./practice-playground-bridge.mjs?v=1.3.0";
import {resumePracticeSession,resetPracticeSession,activePracticeSession,practiceRequest} from "./practice-session.mjs?v=1.3.0";
let user=null,completed=new Map(),reflections=new Map(),activeCourse=null,activeMission=null,checked=null,choice=null,busy=false,epoch=0;
const field=id=>document.getElementById(id);
const status=message=>{field("practiceStatus").textContent=message;};
const sessionStatus=message=>{field("practiceSessionStatus").textContent=message;};
const feedback=message=>{field("practiceFeedback").textContent=message;};
function node(tag,text,classes=""){const element=document.createElement(tag);element.textContent=text;element.className=classes;return element;}
const draftKey=()=>user&&activeMission?"Adminerva_Practice_Draft_"+user.uid+"_"+activeMission.id:null;
const pendingKey=()=>user?"Adminerva_Practice_Pending_"+user.uid:null;
function storeDraft(){
  if(!draftKey())return;
  try{sessionStorage.setItem(draftKey(),JSON.stringify({reasoning:field("practiceReasoning").value.slice(0,500),observation:field("practiceObservation").value.slice(0,500)}));}catch{}
}
function restoreDraft(){
  try{const draft=JSON.parse(sessionStorage.getItem(draftKey())||"null");if(draft){field("practiceReasoning").value=draft.reasoning||"";field("practiceObservation").value=draft.observation||"";}}catch{}
}
function setBusy(value){
  busy=value;
  for(const id of ["practiceCheckBtn","practiceFinishBtn","practiceRetryBtn","practiceBackBtn","practiceSyncBtn","practiceTransferBtn"])field(id).disabled=value;
  field("practiceMissionPanel").setAttribute("aria-busy",String(value));
  field("practiceReasoning").disabled=value||!checked||checked.state!=="open";
  field("practiceObservation").disabled=value;
  for(const radio of field("practiceChoices").querySelectorAll("input"))radio.disabled=value||checked?.state!=="open";
  for(const [id,label] of [["practiceCheckBtn","Check prediction"],["practiceFinishBtn","Save mission completion"],["practiceSyncBtn","Refresh saved progress"]])field(id).textContent=value&& !field(id).classList.contains("hidden")?"Please wait…":label;
}
function setStage(step){
  const labels=["Predict","Run the example","Reflect and save"];
  field("practiceStage").textContent="Step "+step+" of 3 · "+labels[step-1];
  for(let index=1;index<=3;index++){
    const item=field("practiceStep"+index);item.classList.toggle("av-step-current",index===step);item.classList.toggle("av-step-complete",index<step);
    if(index===step)item.setAttribute("aria-current","step");else item.removeAttribute("aria-current");
  }
}
function sessionFailure(error){
  const reason=error.details?.reason;
  const needsTransfer=["transfer-required","recent-sign-in","session-moved"].includes(reason);
  field("practiceTransferBtn").classList.toggle("hidden",!needsTransfer);
  if(needsTransfer){checked=null;for(const id of ["practiceCheckBtn","practiceFinishBtn","practiceExperimentPanel","practiceReflectionPanel","practiceRetryBtn"])field(id).classList.add("hidden");}
  const message=reason==="transfer-required"?"Practice is active on another device or account. Select “Continue practice on this device” to move it here. Your saved XP stays safe.":
    reason==="recent-sign-in"||reason==="session-moved"?"Your practice session needs to reconnect. Select “Continue practice on this device”; you may be asked to sign in again.":
    reason==="enrollment"?"Your account needs an active student record and section. Ask your teacher to check your school email and section in User Directory.":
    reason==="verified-sign-in"?"Verify your account email and sign in again to save practice progress.":
    reason==="prerequisite"?"Complete the previous mission in this module first. Return to all courses to continue.":
    reason==="attempt-expired"||reason==="prediction-consumed"?"This example has ended. Select “New example” to continue. Your written draft is kept.":
    error.code==="functions/resource-exhausted"||error.code==="resource-exhausted"?"You have requested several examples. Wait a moment, then try again.":
    (error.message||"Practice could not connect.")+" Your draft is kept. Check your connection and try again.";
  if(["attempt-expired","prediction-consumed"].includes(reason)){
    checked=null;field("practiceCheckBtn").classList.add("hidden");field("practiceFinishBtn").classList.add("hidden");
    field("practiceRetryBtn").textContent="New example";field("practiceRetryBtn").classList.remove("hidden");
  }
  sessionStatus(message);feedback(message);
}
async function resume(takeover=false){
  const uid=user?.uid;if(!uid)return false;
  try{
    const result=await resumePracticeSession({takeover,reauthenticate:takeover});
    if(user?.uid!==uid)return false;
    field("practiceTransferBtn").classList.add("hidden");
    sessionStatus(result.transferred?"Practice moved to this device. Your saved progress is ready.":"Connected. Completed missions save to your account.");
    return true;
  }catch(error){if(user?.uid===uid)sessionFailure(error);return false;}
}
async function loadProgress(){
  const uid=user?.uid,version=epoch;if(!uid)return;
  try{
    const records=await getDocs(collection(db,"practice_verified_progress",uid,"courses"));
    if(user?.uid!==uid||epoch!==version)return;
    completed=new Map(COURSES.map(course=>[course.id,new Set()]));reflections=new Map();
    for(const record of records.docs){
      const course=COURSES.find(item=>item.id===record.id);if(!course)continue;
      completed.set(course.id,new Set((record.data().completed||[]).filter(id=>course.missions.some(mission=>mission.id===id))));
      reflections.set(course.id,record.data().reflections||{});
    }
    renderCourses();status("Your saved progress is up to date. Choose a course to continue.");
  }catch{if(user?.uid===uid)status("Saved progress could not load. Your draft is kept. Check your connection and select “Refresh saved progress”.");}
}
function renderCourses(){
  const list=field("practiceCourseList");list.replaceChildren();
  const count=COURSES.reduce((sum,course)=>sum+(completed.get(course.id)?.size||0),0),total=COURSES.reduce((sum,course)=>sum+course.missions.length,0);
  field("practiceOverview").replaceChildren(...[[count+" / "+total,"Missions completed"],[COURSES.filter(course=>completed.get(course.id)?.size===course.missions.length).length+" / "+COURSES.length,"Courses finished"],[count*10+" XP","Practice points earned"]].map(([value,label])=>{
    const card=node("div","","bg-white border rounded-xl p-5");card.append(node("strong",value,"block text-2xl font-extrabold"),node("p",label,"text-sm mt-2"));return card;
  }));
  for(const course of COURSES){
    const card=node("article","","rounded-xl bg-white border p-5 shadow-sm");
    card.append(node("h2",course.icon+" "+course.name,"text-xl font-extrabold"),node("p",course.subtitle,"text-sm my-2"),node("p",(completed.get(course.id)?.size||0)+" of "+course.missions.length+" missions completed","text-sm font-bold my-3"));
    for(const [moduleIndex,module] of course.modules.entries()){
      const details=node("details","","av-practice-module border rounded p-3 my-2");details.dataset.practiceModule=module.id;
      const moduleCompleted=module.missions.filter(mission=>completed.get(course.id)?.has(mission.id)).length;
      details.open=moduleIndex===Math.max(0,course.modules.findIndex(item=>item.missions.some(mission=>!completed.get(course.id)?.has(mission.id))));
      details.append(node("summary",(moduleIndex+1)+". "+module.title+" · "+moduleCompleted+"/"+module.missions.length,"font-bold cursor-pointer"));
      const entries=node("div","","grid gap-2 mt-3");
      module.missions.forEach((mission,index)=>{
        const done=completed.get(course.id)?.has(mission.id),locked=!done&&index>0&&!completed.get(course.id)?.has(module.missions[index-1].id);
        const button=node("button",(done?"✓ ":locked?"🔒 ":"→ ")+(index+1)+". "+mission.title+(done?" · Completed":locked?" · Complete mission "+index+" first":""),"text-left border rounded p-3 text-sm "+(done?"bg-emerald-50":locked?"bg-slate-50 text-slate-500":"bg-blue-50"));
        if(locked)button.title="Complete mission "+index+" in this module to unlock this mission.";
        button.type="button";button.disabled=locked;button.addEventListener("click",()=>void openMission(course,mission));entries.append(button);
      });details.append(entries);card.append(details);
    }list.append(card);
  }
}
async function openMission(course,mission){
  if(busy||!user)return;
  storeDraft();activeCourse=course;activeMission=mission;checked=null;choice=null;
  field("practiceCourseList").classList.add("hidden");field("practiceMissionPanel").classList.remove("hidden");
  field("practiceCourseName").textContent=course.name;field("practiceMissionTitle").textContent=mission.title;field("practiceConcept").textContent=mission.concept;
  field("practiceMissionTitle").focus({preventScroll:true});
  field("practiceReasoning").value="";field("practiceObservation").value="";restoreDraft();
  await requestChallenge();
}
async function requestChallenge(){
  if(!activeMission||!user||busy)return;
  checked=null;choice=null;
  setStage(1);field("practiceRetryBtn").textContent="New example";
  field("practiceCode").textContent="";field("practicePrompt").textContent="";field("practiceChoices").replaceChildren();
  for(const id of ["practiceCheckBtn","practiceExperimentPanel","practiceReflectionPanel","practiceFinishBtn","practiceRetryBtn"])field(id).classList.add("hidden");
  feedback("Preparing your example…");
  setBusy(true);const uid=user.uid,missionId=activeMission.id;
  try{
    if(!activePracticeSession()&&!await resume())return;
    const result=await practiceRequest("practiceStart",{courseId:activeCourse.id,missionId});
    if(user?.uid!==uid||activeMission?.id!==missionId)return;
    checked=result;choice=null;field("practiceCode").textContent=result.question.code;field("practicePrompt").textContent=result.question.prompt;
    setStage(1);field("practiceFeedback").textContent="Choose your answer and explain your prediction below.";
    for(const id of ["practiceExperimentPanel","practiceReflectionPanel","practiceFinishBtn","practiceRetryBtn"])field(id).classList.add("hidden");
    field("practiceCheckBtn").classList.remove("hidden");field("practiceChoices").replaceChildren();
    result.question.choices.forEach((answer,index)=>{
      const label=node("label","","border rounded p-3 flex gap-2 cursor-pointer"),radio=document.createElement("input");radio.type="radio";radio.name="practiceAnswer";radio.value=String(index);radio.addEventListener("change",()=>{choice=index;});label.append(radio,node("span",answer));field("practiceChoices").append(label);
    });
    if(result.state==="predicted")revealExperiment();
    field("practiceMissionPanel").scrollIntoView({behavior:"smooth",block:"start"});
  }catch(error){if(user?.uid===uid){sessionFailure(error);if(!["transfer-required","recent-sign-in","session-moved","enrollment","verified-sign-in","prerequisite"].includes(error.details?.reason)){field("practiceRetryBtn").textContent="Retry example";field("practiceRetryBtn").classList.remove("hidden");}}}
  finally{setBusy(false);}
}
async function checkPrediction(){
  if(busy||!checked||checked.state!=="open")return;
  const reasoning=field("practiceReasoning").value.trim();
  if(choice===null||reasoning.length<25){const message=choice===null?"Choose one answer, then explain your prediction in at least 25 characters.":"Add at least 25 characters of reasoning before checking.";feedback(message);if(choice===null)field("practiceChoices").querySelector("input")?.focus();else field("practiceReasoning").focus();return;}
  const uid=user.uid,attemptId=checked.attemptId;setBusy(true);storeDraft();
  try{
    const result=await practiceRequest("practicePredict",{attemptId,choice,reasoning});
    if(user?.uid!==uid||checked?.attemptId!==attemptId)return;
    if(!result.correct){checked.state="incorrect";field("practiceFeedback").textContent=result.message;field("practiceCheckBtn").classList.add("hidden");field("practiceRetryBtn").classList.remove("hidden");return;}
    checked=result;field("practiceFeedback").textContent="Correct prediction. "+result.explanation;revealExperiment();
  }catch(error){if(user?.uid===uid)sessionFailure(error);}finally{setBusy(false);}
}
function revealExperiment(){
  field("practiceReasoning").value=checked.reasoning||field("practiceReasoning").value;
  setStage(2);field("practiceExperimentPanel").classList.remove("hidden");field("practiceCheckBtn").classList.add("hidden");
  field("practiceExperimentStatus").textContent="Next: run the code in Playground, then return here.";
  const transfer=readPracticeTransfer(sessionStorage,user.uid);
  if(transfer?.serverAttemptId===checked.attemptId&&transfer.runCount>0){
    setStage(3);
    field("practiceReflectionPanel").classList.remove("hidden");field("practiceFinishBtn").classList.remove("hidden");
    field("practiceExperimentStatus").textContent="Run recorded. Describe what happened below to finish this mission.";
  }
}
function openExperiment(event){
  if(busy||checked?.state!=="predicted"){event.preventDefault();feedback(busy?"Please wait for the current action to finish.":"Check your prediction before opening the practice example.");return;}
  const prior=readPracticeTransfer(sessionStorage,user.uid),transfer=prior?.serverAttemptId===checked.attemptId?prior:makeCheckedPracticeTransfer(user.uid,checked);
  if(!transfer){event.preventDefault();feedback("The practice example could not open. Select “New example” to try a fresh challenge. Your reflection draft is kept.");field("practiceRetryBtn").textContent="New example";field("practiceRetryBtn").classList.remove("hidden");return;}
  try{sessionStorage.setItem(practiceBridgeKey(user.uid),JSON.stringify(transfer));storeDraft();}catch{event.preventDefault();feedback("This browser cannot save the practice handoff. Allow browser storage, then try again. Your draft is still shown here.");}
}
async function submitCompletion(payload){
  const uid=user?.uid;
  const result=await practiceRequest("practiceComplete",{attemptId:payload.attemptId,observation:payload.observation});
  if(user?.uid!==uid)throw Error("Account changed. No other account's draft was modified.");
  sessionStorage.removeItem(pendingKey());
  await loadProgress();
  if(user?.uid===uid)status(result.awarded?"Mission complete! You earned 10 XP. Choose your next mission below.":"Replay saved. You have already earned XP for this mission.");
  return result;
}
async function finishMission(){
  if(busy||checked?.state!=="predicted"||!user)return;
  const transfer=readPracticeTransfer(sessionStorage,user.uid),observation=field("practiceObservation").value.trim();
  if(transfer?.serverAttemptId!==checked.attemptId||transfer.runCount<1){feedback("Open the practice sandbox and select Run before recording your comparison.");return;}
  if(observation.length<25){feedback("Describe what you observed in at least 25 characters before recording completion.");field("practiceObservation").focus();return;}
  const uid=user.uid,payload={attemptId:checked.attemptId,sessionId:activePracticeSession()?.sessionId,observation};
  storeDraft();setBusy(true);
  try{sessionStorage.setItem(pendingKey(),JSON.stringify(payload));await submitCompletion(payload);if(user?.uid===uid){checked.state="completed";field("practiceMissionPanel").classList.add("hidden");field("practiceCourseList").classList.remove("hidden");field("practiceStatus").scrollIntoView({behavior:"smooth",block:"center"});}}
  catch(error){if(user?.uid===uid){sessionFailure(error);status("Completion has not been confirmed yet. Your reflection is kept in this tab. Select “Refresh saved progress” to retry saving.");}}
  finally{setBusy(false);}
}
field("practiceSyncBtn").addEventListener("click",async()=>{
  if(busy||!user)return;setBusy(true);
  try{if(!await resume())return;const pending=JSON.parse(sessionStorage.getItem(pendingKey())||"null");
    if(pending&&pending.sessionId===activePracticeSession()?.sessionId){await submitCompletion(pending);if(checked?.attemptId===pending.attemptId){checked.state="completed";field("practiceMissionPanel").classList.add("hidden");field("practiceCourseList").classList.remove("hidden");}}else await loadProgress();
    if(pending&&pending.sessionId!==activePracticeSession()?.sessionId)status("Your earlier example belongs to another session. Your reflection is kept; open a new example to continue.");
  }catch(error){sessionFailure(error);}finally{setBusy(false);}
  if(activeMission&&!checked)await requestChallenge();
});
field("practiceTransferBtn").addEventListener("click",async()=>{
  if(busy||!confirm("Continue practice on this device? Practice on your other device, or another account using this browser, will stop earning new XP. Your saved progress stays safe."))return;
  setBusy(true);const success=await resume(true);setBusy(false);
  if(success&&activeMission)await requestChallenge();
});
field("practiceBackBtn").addEventListener("click",()=>{storeDraft();field("practiceMissionPanel").classList.add("hidden");field("practiceCourseList").classList.remove("hidden");});
field("practiceReasoning").addEventListener("input",storeDraft);field("practiceObservation").addEventListener("input",storeDraft);
field("practiceCheckBtn").addEventListener("click",()=>void checkPrediction());field("practiceFinishBtn").addEventListener("click",()=>void finishMission());
field("practiceRetryBtn").addEventListener("click",()=>void requestChallenge());field("practiceExperimentLink").addEventListener("click",openExperiment);
setInterval(()=>{if(user&&!busy&&document.visibilityState==="visible"&&activePracticeSession())void resume();},600000);
onAuthStateChanged(auth,async current=>{
  epoch++;user=current;activeCourse=null;activeMission=null;checked=null;choice=null;resetPracticeSession();
  field("practiceChoices").replaceChildren();field("practiceCode").textContent="";field("practiceReasoning").value="";field("practiceObservation").value="";
  field("practiceMissionPanel").classList.add("hidden");field("practiceCourseList").classList.remove("hidden");
  completed=new Map(COURSES.map(course=>[course.id,new Set()]));reflections=new Map();renderCourses();
  if(!current)return status("Sign in to start practice. No other account's results are shown.");
  await Promise.all([loadProgress(),resume()]);
  const parameters=new URLSearchParams(location.search),course=COURSES.find(item=>item.id===parameters.get("course")),mission=course?.missions.find(item=>item.id===parameters.get("mission"));
  if(user?.uid===current.uid&&mission)await openMission(course,mission);
});
