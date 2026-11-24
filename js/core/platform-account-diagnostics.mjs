/**
 * First-party operational diagnostics. Sent only for signed-in verified users.
 * Metadata only: no messages, stack traces, inputs, code, URLs with parameters,
 * clipboard contents, student work, marks, or notification bodies.
 */
import {app,auth} from "./firebase-core.js?v=1.3.0";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
const record=httpsCallable(getFunctions(app,"asia-southeast1"),"platformAccountDiagnostics");
let activeUid="",sessionId="",enabled=false,eventsSent=0,epoch=0;
let errors=new Map();
const MAX_PAGE_EVENTS=90;
const ID=()=>crypto.randomUUID();
const allowedRoutes=/^\/[A-Za-z0-9_/-]{0,100}(?:\.html)?$/;
const allowedCodes=/^[-a-zA-Z0-9_./]{1,64}$/;
const release="v20261124"; // Identifies the diagnostic emitter, not the full app release.
function route(){
  const candidate=location.pathname||"/";
  return allowedRoutes.test(candidate)?candidate:"";
}
function moduleForRoute(){
  const path=route().toLowerCase();
  if(/login|register|auth/.test(path))return "auth";
  if(/studio|playground/.test(path))return "studio";
  if(/assessment|exam|quiz/.test(path))return "assessments";
  if(/classroom|subject|lesson/.test(path))return "classroom";
  if(/games|practice|mission/.test(path))return "games";
  if(/grade|record/.test(path))return "grades";
  if(/notification/.test(path))return "notifications";
  if(/setting|profile/.test(path))return "settings";
  if(/owner|system-users|admin-analytics/.test(path))return "platform";
  if(/school|people|enroll|registrar/.test(path))return "school";
  if(/home|index/.test(path))return "home";
  return "other";
}
function code(value){
  const raw=String(value||"").replace(/^functions\//,"");
  return allowedCodes.test(raw)?raw:"";
}
async function send(event){
  if(!enabled||!activeUid||auth.currentUser?.uid!==activeUid||eventsSent>=MAX_PAGE_EVENTS)return;
  const uid=activeUid,turn=epoch;
  eventsSent++;
  for(let attempt=0;attempt<2;attempt++){
    if(auth.currentUser?.uid!==uid||turn!==epoch)return;
    try{
      await record({action:"record",event});
      return;
    }catch(error){
      const raw=String(error?.code||"");
      if(/permission-denied|unauthenticated|resource-exhausted|invalid-argument/.test(raw))return;
      if(attempt===0)await new Promise(resolve=>setTimeout(resolve,600));
    }
  }
}
function emit(action,{kind="action",module=moduleForRoute(),state="info",errorCode=""}={}){
  if(!enabled||!activeUid||!sessionId||eventsSent>=MAX_PAGE_EVENTS)return;
  const event={eventId:ID(),sessionId,kind,module,action,state,
    errorCode:kind==="error"?code(errorCode):"",route:route(),release};
  void send(event);
}
function diagnosticError(action,value,module=moduleForRoute()){
  const errorCode=code(value)||"unknown";
  const key=action+"|"+errorCode+"|"+route(),now=Date.now();
  if(now-(errors.get(key)||0)<60000)return;
  errors.set(key,now);
  if(errors.size>40)errors=new Map([...errors].slice(-25));
  emit(action,{kind:"error",module,state:"error",errorCode});
}
function initializeSession(user){
  const key="Adminerva_diagnostic_session_"+user.uid;
  let id="",fresh=false;
  try{id=sessionStorage.getItem(key)||"";}catch{}
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)){
    id=ID();fresh=true;
    try{sessionStorage.setItem(key,id);}catch{}
  }
  sessionId=id;
  if(fresh)emit("session_started",{kind:"session",state:"ok"});
}
onAuthStateChanged(auth,user=>{
  epoch++;activeUid="";sessionId="";enabled=false;eventsSent=0;errors.clear();
  if(!user?.emailVerified)return;
  activeUid=user.uid;enabled=true;
  initializeSession(user);
  emit("page_open",{kind:"navigation",state:"ok"});
});
window.addEventListener("error",event=>{
  if(event?.target&&event.target!==window){
    diagnosticError("resource_error",String(event.target?.tagName||"resource").toLowerCase());
    return;
  }
  diagnosticError("javascript_error",event?.error?.name||"javascript_error");
},true);
window.addEventListener("unhandledrejection",event=>{
  diagnosticError("promise_error",event?.reason?.code||event?.reason?.name||"promise_error");
});
window.addEventListener("offline",()=>emit("network_offline",{kind:"system",state:"unavailable"}));
window.addEventListener("online",()=>emit("network_online",{kind:"system",state:"ok"}));
document.addEventListener("adminerva:role-ready",event=>{
  if(event?.detail?.schoolId)emit("school_switched",{kind:"action",module:"school",state:"ok"});
});
document.addEventListener("adminerva:v4-project-synced",()=>emit("cloud_save_confirmed",{module:"studio",state:"ok"}));
document.addEventListener("adminerva:studio-cloud-confirmed",()=>emit("cloud_save_confirmed",{module:"studio",state:"ok"}));
document.addEventListener("adminerva:notification-opened",()=>emit("notification_opened",{kind:"notification",module:"notifications",state:"ok"}));
document.addEventListener("adminerva:studio-submitted",()=>emit("assessment_submitted",{module:"assessments",state:"ok"}));
window.addEventListener("adminerva:studio-run-recorded",event=>{
  const run=event.detail||{};
  if(run.compileSucceeded===false)diagnosticError("studio_run_failed","compile_error","studio");
  else if(run.runSucceeded===false)diagnosticError("studio_run_failed","runtime_error","studio");
  else if(run.runSucceeded===true)emit("studio_run_completed",{module:"studio",state:"ok"});
});
const buttonActions={
  runBtn:["studio_run_requested","studio"],
  studioConfirmSubmit:["assessment_submit_requested","assessments"],
  evidenceSubmit:["assessment_submit_requested","assessments"],
  evidenceWithdraw:["assessment_withdraw_requested","assessments"],
  manualReviewAnalyze:["assessment_evaluate_requested","assessments"]
};
document.addEventListener("click",event=>{
  const button=event.target?.closest?.("button");
  if(!event.isTrusted||!button||button.disabled||!buttonActions[button.id])return;
  const [action,module]=buttonActions[button.id];
  emit(action,{module,state:"info"});
},true);
document.addEventListener("adminerva:diagnostic-event",event=>{
  const data=event?.detail||{};
  if(data.action==="cloud_save_failed")diagnosticError("cloud_save_failed",data.errorCode||"unavailable","studio");
  else if(data.action==="api_failed")diagnosticError("api_failed",data.errorCode||"unavailable",
    ["studio","assessments","classroom","school","games","grades","notifications","settings","api"].includes(data.module)?data.module:"api");
  else if(data.action==="support_report_submitted")emit("support_report_submitted",{module:"other",state:"ok"});
});
window.AdminervaDiagnostic=Object.freeze({emit,apiFailed:(error,module="api")=>{
  diagnosticError("api_failed",error?.code||error?.name||"unavailable",module);
}});
