/**
 * Pilot-only Studio process observations. Firestore remains server-owned.
 * This never captures source, text, filenames, clipboard, terminal output,
 * keystrokes, cursor locations, grades, or session recordings.
 */
import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {currentV4StudioSchool} from "../student/v4-studio-service.mjs?v=20261123-cloud-recovery-1";

const endpoint=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolPilotResearch");
const status=document.getElementById("studioPilotResearchStatus");
const setStatus=text=>{if(status)status.textContent=text;};
const sessionId=crypto.randomUUID();
const PROJECT_ID=/^[A-Za-z0-9_-]{1,160}$/;
let schoolId="",ownerUid="",enabled=false,ready=false,generation=0;
let currentProjectId="",changeCount=0,lastEditFlush=Date.now(),pending=[];
let ongoing=null, sent=0,paused=false;

async function loadPilotScope(){
  if(ongoing)return ongoing;
  const epoch=++generation,user=auth.currentUser;
  if(!user){schoolId="";ownerUid="";ready=true;enabled=false;pending=[];setStatus("Pilot research: sign in to a designated test account.");return;}
  ongoing=(async()=>{
    try{
      const school=await currentV4StudioSchool();
      if(epoch!==generation||auth.currentUser?.uid!==user.uid)return;
      if(!school?.schoolId){enabled=false;ready=true;pending=[];setStatus("Pilot research inactive: select a verified school.");return;}
      const response=(await endpoint({action:"status",schoolId:school.schoolId})).data;
      if(epoch!==generation||auth.currentUser?.uid!==user.uid)return;
      schoolId=school.schoolId;ownerUid=user.uid;
      enabled=response?.enabled===true;ready=true;
      if(!enabled){pending=[];setStatus("Pilot research inactive for this account. Studio work is unaffected.");return;}
      setStatus("Pilot research active: collecting limited Studio process statistics.");
      const queued=pending.splice(0);
      for(const event of queued)void send(event);
    }catch{
      if(epoch===generation){enabled=false;ready=true;pending=[];
        setStatus("Pilot research unavailable: collection not confirmed; Studio work is unaffected.");}
    }finally{
      if(epoch===generation)ongoing=null;
    }
  })();
  return ongoing;
}
function observe(type,projectId,details={}){
  if(paused||sent>=600||!auth.currentUser||!PROJECT_ID.test(String(projectId||"")))return;
  const event={eventId:crypto.randomUUID(),sessionId,projectId,type,...details};
  if(!ready){
    pending.push(event);if(pending.length>40)pending.shift();
    void loadPilotScope();return;
  }
  if(enabled)void send(event);
}
async function send(event){
  if(!enabled||!schoolId||paused||sent>=600||auth.currentUser?.uid!==ownerUid)return;
  const target=schoolId,uid=ownerUid;
  sent++;
  const epoch=generation;
  for(let attempt=0;attempt<3;attempt++){
    if(epoch!==generation||auth.currentUser?.uid!==uid||schoolId!==target||paused)return;
    try{
      const response=(await endpoint({action:"record",schoolId:target,event})).data;
      if(epoch===generation&&schoolId===target&&auth.currentUser?.uid===uid&&response?.recorded===true)
        setStatus("Pilot research active: last event confirmed at "+new Date().toLocaleTimeString()+".");
      return;
    }catch(error){
      if(epoch!==generation||auth.currentUser?.uid!==uid||schoolId!==target)return;
      const code=String(error?.code||"");
      if(/permission-denied|resource-exhausted|unauthenticated|invalid-argument/.test(code)){
        paused=true;
        setStatus("Pilot research paused: test-account access or collection limit must be checked. Studio work is unaffected.");
        return;
      }
      if(attempt===2){
        setStatus("Pilot research connection unavailable: recent activity was not confirmed. Studio work is unaffected.");
        return;
      }
      await new Promise(resolve=>setTimeout(resolve,attempt===0?400:1600));
    }
  }
}
function flushEdits(){
  if(!currentProjectId||changeCount<1)return;
  const count=Math.min(250,changeCount);
  changeCount=0;lastEditFlush=Date.now();
  observe("editor_activity",currentProjectId,{editCount:count});
}
function runOutcome(detail){
  if(detail?.compileSucceeded===false)return "compile_error";
  if(detail?.runSucceeded===true)return "success";
  if(detail?.status==="cancelled")return "cancelled";
  if(detail?.runSucceeded===false)return "runtime_error";
  return "unknown";
}
function runMode(value){
  return ["console","desktop","web","python"].includes(value)?value:"other";
}
onAuthStateChanged(auth,user=>{
  generation++;ongoing=null;ready=false;enabled=false;paused=false;sent=0;
  ownerUid=user?.uid||"";schoolId="";currentProjectId="";changeCount=0;pending=[];
  setStatus("Pilot research: checking test-account eligibility…");
  if(user)void loadPilotScope();
});
window.addEventListener("adminerva:school-ready",()=>{
  flushEdits();generation++;ongoing=null;ready=false;enabled=false;schoolId="";pending=[];
  sent=0;paused=false;setStatus("Pilot research: checking selected school…");
  void loadPilotScope();
});
window.addEventListener("adminerva:studio-ready",event=>{
  flushEdits();
  currentProjectId=String(event.detail?.projectId||"");
  observe("project_open",currentProjectId);
});
window.addEventListener("adminerva:studio-home",()=>{flushEdits();currentProjectId="";});
window.addEventListener("adminerva:studio-edit-observed",event=>{
  if(!currentProjectId||document.hidden)return;
  changeCount+=Math.max(1,Math.min(100,Math.trunc(Number(event.detail?.count)||1)));
  if(changeCount>=250||Date.now()-lastEditFlush>=30000)flushEdits();
});
window.addEventListener("adminerva:studio-run-recorded",event=>{
  flushEdits();
  const detail=event.detail||{};
  observe("run_finished",String(detail.projectId||currentProjectId),{
    mode:runMode(detail.mode),outcome:runOutcome(detail)
  });
});
document.addEventListener("adminerva:v4-project-synced",event=>{
  const detail=event.detail||{};
  if(detail.schoolId&&schoolId&&detail.schoolId!==schoolId)return;
  flushEdits();
  observe("cloud_saved",String(detail.projectId||currentProjectId));
});
document.addEventListener("visibilitychange",()=>{if(document.hidden)flushEdits();});
setInterval(()=>{if(changeCount&&Date.now()-lastEditFlush>=30000)flushEdits();},10000);
window.addEventListener("pagehide",flushEdits);
