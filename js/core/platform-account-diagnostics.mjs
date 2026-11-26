/**
 * First-party operational diagnostics. Sent only for signed-in verified users.
 * Metadata only: no messages, stack traces, inputs, code, URLs with parameters,
 * clipboard contents, student work, marks, or notification bodies.
 */
import {app,auth} from "./firebase-core.js?v=1.3.0";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
const record=httpsCallable(getFunctions(app,"asia-southeast1"),"platformAccountDiagnostics");
let activeUid="",sessionId="",enabled=false,eventsSent=0,epoch=0,pendingRunOperationId="";
let pending=[],flushing=false;const MAX_DELAYED_EVENTS=20;
let errors=new Map();
const MAX_PAGE_EVENTS=90;
const ID=()=>crypto.randomUUID();
const allowedRoutes=/(?:^\/$|^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]{1,80}\.html$)/;
const allowedCodes=/^[-a-zA-Z0-9_./]{1,64}$/;
const release="v20261126-context"; // The emitter revision, not the full app release.
function environment(){
  // Convert the browser environment to coarse allowlisted categories; never
  // transmit a full user-agent string, fingerprint, IP address or screen size.
  const ua=String(navigator.userAgent||"");
  const osFamily=/iPad|iPhone|iPod/i.test(ua)?"ios":/Android/i.test(ua)?"android":
    /Windows/i.test(ua)?"windows":/Mac OS X|Macintosh/i.test(ua)?"macos":
    /Linux/i.test(ua)?"linux":"other";
  const browserFamily=/Edg\//i.test(ua)?"edge":/Firefox|FxiOS/i.test(ua)?"firefox":
    /Chrome|CriOS/i.test(ua)?"chrome":/Safari/i.test(ua)?"safari":"other";
  const width=Number(window.innerWidth)||0;
  const viewport=width<=0?"unknown":width<361?"xs":width<600?"sm":width<960?"md":
    width<1440?"lg":"xl";
  const deviceClass=/iPad|Tablet/i.test(ua)?"tablet":
    /iPhone|Android.*Mobile|iPod/i.test(ua)?"phone":
    /Android/i.test(ua)?"tablet":"desktop";
  return {osFamily,browserFamily,deviceClass,viewport};
}

const controls=new Set(["runBtn","studioConfirmSubmit","evidenceSubmit","evidenceWithdraw","manualReviewAnalyze","newCodeProjectBtn","archivedCodeProjectsBtn","legacyDraftProjectBtn","refreshEarlierProjectsBtn","studioTaskSubmitShortcut","studioTaskOpenDesktop","studioMobileTask","backToProjectsBtn","saveProjectBtn","cloudSaveProjectBtn","cloudLoadProjectBtn","loadProjectBtn","undoRestoreBtn","restoreSubmittedSourceBtn","importZipBtn","exportZipBtn","resetBtn","snapshotBtn","legacyImportBtn","studioSubmitAssessment","aiTutorBtn","projectSettingsBtn","studioPreferencesBtn","studioMobileRun","studioCancelQueueBtn","cancelRunBtn","stopDesktopBtn","stopCheerpjBtn","saveDesignBtn","renderDesignBtn","enableProjectDbBtn","dbNewTableBtn","dbExportCsvBtn","dbInsertRowBtn","dbRunBtn","evidenceRefresh","projectWizardCreate","projectSettingsSave","studioReadinessJoin","pu-create","pu-refresh","pu-save-profile","pu-reset-password","pu-platform-authority","pu-lifecycle","pu-test-toggle","pu-test-grant","pu-create-submit"]);
const processes=new Map();
const MAX_TRACKED=24;
const elapsed=start=>Math.min(3600000,Math.max(0,Math.round(performance.now()-start)));
function snapshotContext(extra={}){
  const active=[...processes].slice(0,6).map(([id,p])=>({name:p.name,id,ageMs:elapsed(p.start)}));
  return {clientAt:Date.now(),visibility:["visible","hidden"].includes(document.visibilityState)?document.visibilityState:"other",
    network:navigator.onLine===false?"offline":"online",focus:document.hasFocus()?"focused":"unfocused",
    ready:["loading","interactive","complete"].includes(document.readyState)?document.readyState:"other",
    dialog:document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]:not([hidden])[aria-hidden="false"]')?"open":"none",
    busy:document.querySelector('[aria-busy="true"]')?"busy":"idle",active,overflow:Math.max(0,processes.size-active.length),...extra};
}
function beginProcess(name){
  if(!enabled||name!=="studio_cloud_save"||processes.size>=MAX_TRACKED)return ()=>{};
  const id=ID(),start=performance.now(),turn=epoch;
  processes.set(id,{name,start});
  try{emit("process_started",{module:"studio",operationId:id,phase:"started",context:{process:name}});}catch{}
  let finished=false;
  return (success)=>{
    if(finished)return;finished=true;
    if(turn!==epoch)return;
    const context={process:name,elapsedMs:elapsed(start)};
    processes.delete(id);
    emit(success===true?"process_finished":"process_failed",{module:"studio",kind:success===true?"action":"error",
      state:success===true?"ok":"error",operationId:id,phase:success===true?"completed":"failed",
      errorCode:success===true?"":"cloud_save_failed",context});
  };
}
function queueDelayed(event){
  if(pending.length<MAX_DELAYED_EVENTS)pending.push(event);
}
async function flushPending(){
  if(flushing||!enabled||navigator.onLine===false||!pending.length)return;
  flushing=true;const flushEpoch=epoch;
  try{
    const batch=pending.splice(0,MAX_DELAYED_EVENTS);
    for(let i=0;i<batch.length;i++){
      if(!enabled||epoch!==flushEpoch)return;
      if(navigator.onLine===false){
        pending=batch.slice(i).concat(pending).slice(0,MAX_DELAYED_EVENTS);
        break;
      }
      await send(batch[i],true);
    }
  }finally{if(epoch===flushEpoch)flushing=false;}
}
function route(){
  const candidate=location.pathname||"/";
  return allowedRoutes.test(candidate)?candidate:"";
}
function moduleForRoute(){
  const path=route().toLowerCase();
  if(/login|register|auth/.test(path))return "auth";
  if(/platform-logs/.test(path))return "platform";
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
async function send(event,replay=false){
  if(!enabled||!activeUid||auth.currentUser?.uid!==activeUid||(!replay&&eventsSent>=MAX_PAGE_EVENTS))return;
  const uid=activeUid,turn=epoch;
  if(!replay)eventsSent++;
  if(navigator.onLine===false){queueDelayed(event);return;}
  for(let attempt=0;attempt<2;attempt++){
    if(auth.currentUser?.uid!==uid||turn!==epoch)return;
    try{
      await record({action:"record",event});
      if(turn===epoch&&!flushing&&pending.length)void flushPending();
      return;
    }catch(error){
      if(turn!==epoch||auth.currentUser?.uid!==uid)return;
      const raw=String(error?.code||"");
      if(/permission-denied|unauthenticated|resource-exhausted|invalid-argument/.test(raw))return;
      if(attempt===0)await new Promise(resolve=>setTimeout(resolve,600));
      else queueDelayed(event);
    }
  }
}
function emit(action,{kind="action",module=moduleForRoute(),state="info",errorCode="",operationId="",phase="",context={}}={}){
  if(!enabled||!activeUid||!sessionId||eventsSent>=MAX_PAGE_EVENTS)return;
  const event={eventId:ID(),sessionId,kind,module,action,state,
    errorCode:kind==="error"?code(errorCode):"",route:route(),release,
    ...environment(),context:snapshotContext(context),
    ...(operationId?{operationId}:{}),...(phase?{phase}:{})};
  void send(event);
}
function diagnosticError(action,value,module=moduleForRoute(),operationId=""){
  const errorCode=code(value)||"unknown";
  const key=action+"|"+errorCode+"|"+route(),now=Date.now();
  if(now-(errors.get(key)||0)<60000)return;
  errors.set(key,now);
  if(errors.size>40)errors=new Map([...errors].slice(-25));
  emit(action,{kind:"error",module,state:"error",errorCode,operationId,phase:"failed"});
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
  if(fresh)emit("session_started",{kind:"session",state:"ok",phase:"observed"});
}
onAuthStateChanged(auth,user=>{
  epoch++;activeUid="";sessionId="";enabled=false;eventsSent=0;pendingRunOperationId="";pending=[];flushing=false;errors.clear();processes.clear();
  if(!user?.emailVerified)return;
  activeUid=user.uid;enabled=true;
  initializeSession(user);
  emit("auth_session_observed",{kind:"session",module:"auth",state:"ok",phase:"observed"});
  emit("page_open",{kind:"navigation",state:"ok",phase:"observed"});
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
window.addEventListener("online",()=>{
  emit("network_online",{kind:"system",state:"ok",phase:"completed"});
  void flushPending();
});
document.addEventListener("adminerva:role-ready",event=>{
  if(event?.detail?.schoolId)emit("school_switched",{kind:"action",module:"school",state:"ok"});
});
document.addEventListener("adminerva:v4-project-synced",()=>emit("cloud_save_confirmed",{module:"studio",state:"ok"}));
document.addEventListener("adminerva:studio-cloud-confirmed",()=>emit("cloud_save_confirmed",{module:"studio",state:"ok"}));
document.addEventListener("adminerva:notification-opened",()=>emit("notification_opened",{kind:"notification",module:"notifications",state:"ok"}));
document.addEventListener("adminerva:studio-submitted",()=>emit("assessment_submitted",{module:"assessments",state:"ok"}));
window.addEventListener("adminerva:studio-run-recorded",event=>{
  const run=event.detail||{};
  // Completion evidence is asynchronous and does not carry the original run ID.
  // Do not infer a match to the latest click when executions can overlap.
  const operationId="";pendingRunOperationId="";
  if(run.compileSucceeded===false)diagnosticError("studio_run_failed","compile_error","studio",operationId);
  else if(run.runSucceeded===false)diagnosticError("studio_run_failed","runtime_error","studio",operationId);
  else if(run.runSucceeded===true)emit("studio_run_completed",{module:"studio",state:"ok",operationId,phase:"completed"});
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
  if(!event.isTrusted||!button||button.disabled||!controls.has(button.id))return;
  const [action,module]=buttonActions[button.id]||["control_clicked",moduleForRoute()];
  const operationId=ID();
  if(action==="studio_run_requested")pendingRunOperationId=operationId;
  emit(action,{module,state:"info",operationId,phase:action==="control_clicked"?"observed":"started",context:{control:button.id}});
},true);
document.addEventListener("adminerva:diagnostic-event",event=>{
  const data=event?.detail||{};
  if(data.action==="cloud_save_failed")diagnosticError("cloud_save_failed",data.errorCode||"unavailable","studio");
  else if(data.action==="api_failed")diagnosticError("api_failed",data.errorCode||"unavailable",
    ["studio","assessments","classroom","school","games","grades","notifications","settings","api"].includes(data.module)?data.module:"api");
  else if(data.action==="support_report_submitted")emit("support_report_submitted",{module:"other",state:"ok"});
});
window.AdminervaDiagnostic=Object.freeze({emit,beginProcess,apiFailed:(error,module="api")=>{
  diagnosticError("api_failed",error?.code||error?.name||"unavailable",module);
}});
