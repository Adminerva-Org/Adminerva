/**
 * Pilot-only Studio process observations. Firestore remains server-owned.
 * This never captures source, text, filenames, clipboard, terminal output,
 * keystrokes, cursor locations, grades, or session recordings.
 */
import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {currentV4StudioSchool} from "../student/v4-studio-service.mjs?v=20261121-recovery-guard";

const endpoint=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolPilotResearch");
const sessionId=crypto.randomUUID();
const PROJECT_ID=/^[A-Za-z0-9_-]{1,160}$/;
let schoolId="",ownerUid="",enabled=false,ready=false,generation=0;
let currentProjectId="",changeCount=0,lastEditFlush=Date.now(),pending=[];
let ongoing=null, sent=0,paused=false;

async function loadPilotScope(){
  if(ongoing)return ongoing;
  const epoch=++generation,user=auth.currentUser;
  if(!user){schoolId="";ownerUid="";ready=true;enabled=false;pending=[];return;}
  ongoing=(async()=>{
    try{
      const school=await currentV4StudioSchool();
      if(epoch!==generation||auth.currentUser?.uid!==user.uid)return;
      if(!school?.schoolId){enabled=false;ready=true;pending=[];return;}
      const response=(await endpoint({action:"status",schoolId:school.schoolId})).data;
      if(epoch!==generation||auth.currentUser?.uid!==user.uid)return;
      schoolId=school.schoolId;ownerUid=user.uid;
      enabled=response?.enabled===true;ready=true;
      if(!enabled){pending=[];return;}
      const queued=pending.splice(0);
      for(const event of queued)void send(event);
    }catch{
      if(epoch===generation){enabled=false;ready=true;pending=[];}
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
  try{await endpoint({action:"record",schoolId:target,event});}
  catch(error){
    if(auth.currentUser?.uid!==uid)return;
    if(/permission-denied|resource-exhausted/.test(String(error?.code||"")))paused=true;
    // Research collection is best-effort. Never delay or mutate student work.
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
  if(user)void loadPilotScope();
});
window.addEventListener("adminerva:school-ready",()=>{
  flushEdits();generation++;ongoing=null;ready=false;enabled=false;schoolId="";pending=[];
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
