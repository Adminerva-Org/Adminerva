/** Server-checked practice with private drafts, explicit session transfers and no client-awarded XP. */
import {auth,db} from "../core/firebase-core.js";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {collection,getDocs} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {COURSES} from "./practice-courses.mjs";
import {makeCheckedPracticeTransfer,readPracticeTransfer,practiceBridgeKey} from "./practice-playground-bridge.mjs?v=1.1.0";
import {resumePracticeSession,resetPracticeSession,activePracticeSession,practiceRequest} from "./practice-session.mjs?v=1.1.0";
let user=null,completed=new Map(),reflections=new Map(),activeCourse=null,activeMission=null,checked=null,choice=null,busy=false,epoch=0;
const field=id=>document.getElementById(id);
const status=message=>{field("practiceStatus").textContent=message;};
const sessionStatus=message=>{field("practiceSessionStatus").textContent=message;};
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
}
function sessionFailure(error){
  const reason=error.details?.reason;
  sessionStatus(reason==="transfer-required"?"A scored session is active elsewhere or under another account on this browser. Use controlled transfer below; this is not a cheating finding.":
    reason==="recent-sign-in"||reason==="session-moved"?"Sign in again or transfer practice here. The older scored session cannot submit new credit.":
    (error.message||"Practice backend unavailable.")+" No client completion or local points can replace server-checked XP.");
}
async function resume(takeover=false){
  const uid=user?.uid;if(!uid)return false;
  try{
    const result=await resumePracticeSession({takeover,reauthenticate:takeover});
    if(user?.uid!==uid)return false;
    sessionStatus(result.transferred?"Scored session transferred here. Older attempts cannot earn new XP. No penalty was applied.":"Your scored practice session is active here. Accepted work saves automatically.");
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
    renderCourses();status("Server-checked progress loaded. Earlier self-recorded/local completions are retained separately, not converted into ranked XP.");
  }catch{if(user?.uid===uid)status("Saved progress could not load. Local reflections are retained, but no offline completion can award ranked XP.");}
}
function renderCourses(){
  const list=field("practiceCourseList");list.replaceChildren();
  const count=COURSES.reduce((sum,course)=>sum+(completed.get(course.id)?.size||0),0),total=COURSES.reduce((sum,course)=>sum+course.missions.length,0);
  field("practiceOverview").replaceChildren(...[[count+"/"+total,"Server-checked missions"],[COURSES.filter(course=>completed.get(course.id)?.size===course.missions.length).length+"/"+COURSES.length,"Courses finished"],[count*10+" / "+total*10,"Practice XP · not school grades"]].map(([value,label])=>{
    const card=node("div","","bg-white border rounded-xl p-5");card.append(node("strong",value,"block text-2xl font-extrabold"),node("p",label,"text-sm mt-2"));return card;
  }));
  for(const course of COURSES){
    const card=node("article","","rounded-xl bg-white border p-5 shadow-sm");
    card.append(node("h2",course.icon+" "+course.name,"text-xl font-extrabold"),node("p",course.subtitle,"text-sm my-2"),node("p",(completed.get(course.id)?.size||0)+" of "+course.missions.length+" missions checked","text-sm font-bold my-3"));
    for(const [moduleIndex,module] of course.modules.entries()){
      const details=node("details","","border rounded p-3 my-2");details.dataset.practiceModule=module.id;
      details.append(node("summary",(moduleIndex+1)+". "+module.title+" · "+module.missions.filter(mission=>completed.get(course.id)?.has(mission.id)).length+"/15","font-bold cursor-pointer"));
      const entries=node("div","","grid gap-2 mt-3");
      module.missions.forEach((mission,index)=>{
        const done=completed.get(course.id)?.has(mission.id),locked=!done&&index>0&&!completed.get(course.id)?.has(module.missions[index-1].id);
        const button=node("button",(done?"✓ ":locked?"🔒 ":"→ ")+(index+1)+". "+mission.title,"text-left border rounded p-3 text-sm "+(done?"bg-emerald-50":"bg-blue-50"));
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
  field("practiceReasoning").value="";field("practiceObservation").value="";restoreDraft();
  await requestChallenge();
}
async function requestChallenge(){
  if(!activeMission||!user||busy)return;
  setBusy(true);const uid=user.uid,missionId=activeMission.id;
  try{
    if(!activePracticeSession()&&!await resume())return;
    const result=await practiceRequest("practiceStart",{courseId:activeCourse.id,missionId});
    if(user?.uid!==uid||activeMission?.id!==missionId)return;
    checked=result;choice=null;field("practiceCode").textContent=result.question.code;field("practicePrompt").textContent=result.question.prompt;
    field("practiceStage").textContent="Step 1 of 3 · Server-checked prediction";field("practiceFeedback").textContent="";
    for(const id of ["practiceExperimentPanel","practiceReflectionPanel","practiceFinishBtn","practiceRetryBtn"])field(id).classList.add("hidden");
    field("practiceCheckBtn").classList.remove("hidden");field("practiceChoices").replaceChildren();
    result.question.choices.forEach((answer,index)=>{
      const label=node("label","","border rounded p-3 flex gap-2 cursor-pointer"),radio=document.createElement("input");radio.type="radio";radio.name="practiceAnswer";radio.value=String(index);radio.addEventListener("change",()=>{choice=index;});label.append(radio,node("span",answer));field("practiceChoices").append(label);
    });
    if(result.state==="predicted")revealExperiment();
    field("practiceMissionPanel").scrollIntoView({behavior:"smooth",block:"start"});
  }catch(error){if(user?.uid===uid){sessionFailure(error);status("Challenge unavailable. Resume this session or retry when connected; no XP was awarded.");}}
  finally{setBusy(false);}
}
async function checkPrediction(){
  if(busy||!checked||checked.state!=="open")return;
  const reasoning=field("practiceReasoning").value.trim();
  if(choice===null||reasoning.length<25)return status("Choose a prediction and explain it in at least 25 characters.");
  const uid=user.uid,attemptId=checked.attemptId;setBusy(true);storeDraft();
  try{
    const result=await practiceRequest("practicePredict",{attemptId,choice,reasoning});
    if(user?.uid!==uid||checked?.attemptId!==attemptId)return;
    if(!result.correct){checked.state="incorrect";field("practiceFeedback").textContent=result.message;field("practiceCheckBtn").classList.add("hidden");field("practiceRetryBtn").classList.remove("hidden");return;}
    checked=result;field("practiceFeedback").textContent="Correct server-checked prediction. "+result.explanation;revealExperiment();
  }catch(error){if(user?.uid===uid)sessionFailure(error);}finally{setBusy(false);}
}
function revealExperiment(){
  field("practiceReasoning").value=checked.reasoning||field("practiceReasoning").value;
  field("practiceStage").textContent="Step 2 of 3 · Experiment";field("practiceExperimentPanel").classList.remove("hidden");field("practiceCheckBtn").classList.add("hidden");
  const transfer=readPracticeTransfer(sessionStorage,user.uid);
  if(transfer?.serverAttemptId===checked.attemptId&&transfer.runCount>0){
    field("practiceStage").textContent="Step 3 of 3 · Compare and reflect";
    field("practiceReflectionPanel").classList.remove("hidden");field("practiceFinishBtn").classList.remove("hidden");
    field("practiceExperimentStatus").textContent="Run attempted. Describe the result; this is not proof of runtime correctness or independent authorship.";
  }
}
function openExperiment(event){
  if(busy||checked?.state!=="predicted")return event.preventDefault();
  const prior=readPracticeTransfer(sessionStorage,user.uid),transfer=prior?.serverAttemptId===checked.attemptId?prior:makeCheckedPracticeTransfer(user.uid,checked);
  if(!transfer){event.preventDefault();return status("Could not prepare this sandbox. Request the challenge again.");}
  try{sessionStorage.setItem(practiceBridgeKey(user.uid),JSON.stringify(transfer));storeDraft();}catch{event.preventDefault();status("Session storage is unavailable. Your XP was not changed.");}
}
async function submitCompletion(payload){
  const uid=user?.uid;
  const result=await practiceRequest("practiceComplete",{attemptId:payload.attemptId,observation:payload.observation});
  if(user?.uid!==uid)throw Error("Account changed. No other account's draft was modified.");
  sessionStorage.removeItem(pendingKey());
  status(result.awarded?"Mission saved automatically with 10 server-checked XP. Nothing changes school grades.":"Replay recorded; this mission cannot earn duplicate XP.");
  await loadProgress();return result;
}
async function finishMission(){
  if(busy||checked?.state!=="predicted"||!user)return;
  const transfer=readPracticeTransfer(sessionStorage,user.uid),observation=field("practiceObservation").value.trim();
  if(transfer?.serverAttemptId!==checked.attemptId||transfer.runCount<1)return status("Run the example in your sandbox before recording your comparison.");
  if(observation.length<25)return status("Describe the observed result in at least 25 characters.");
  const uid=user.uid,payload={attemptId:checked.attemptId,sessionId:activePracticeSession()?.sessionId,observation};
  storeDraft();setBusy(true);
  try{sessionStorage.setItem(pendingKey(),JSON.stringify(payload));await submitCompletion(payload);if(user?.uid===uid){field("practiceMissionPanel").classList.add("hidden");field("practiceCourseList").classList.remove("hidden");}}
  catch(error){if(user?.uid===uid){sessionFailure(error);status("Completion is not confirmed. Your reflection remains a private session draft; retry safely before the challenge expires.");}}
  finally{setBusy(false);}
}
field("practiceSyncBtn").addEventListener("click",async()=>{
  if(busy||!user)return;setBusy(true);
  try{if(!await resume())return;const pending=JSON.parse(sessionStorage.getItem(pendingKey())||"null");
    if(pending&&pending.sessionId===activePracticeSession()?.sessionId)await submitCompletion(pending);else await loadProgress();
    if(pending&&pending.sessionId!==activePracticeSession()?.sessionId)status("The old challenge belonged to a different session. Its reflection is retained, but request a new server-checked example for XP.");
  }catch(error){sessionFailure(error);}finally{setBusy(false);}
});
field("practiceTransferBtn").addEventListener("click",async()=>{
  if(busy||!confirm("Move scored practice here? Any older scored session or other account's active session on this browser will stop earning new credit. Shared devices are allowed; this applies no cheating penalty."))return;
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
