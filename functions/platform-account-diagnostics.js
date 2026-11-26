"use strict";
/**
 * Adminerva per-login diagnostic timeline. Server-owned support evidence,
 * separate from academic records, research analytics and fleet telemetry.
 * Only allowlisted metadata is stored; no user text, URLs with query strings,
 * passwords, tokens, code, grades, private notifications or request bodies.
 */
const {platformAuthority,TenantAccessError}=require("./tenant-access.js");
const {randomUUID,createHash}=require("node:crypto");
const RETENTION_DAYS=60,PER_ACCOUNT_DAILY_LIMIT=300,NORMAL_DAILY_LIMIT=240,MAX_PAGE=75,DAY_MS=86400000;
const GLOBAL_SCOPE="platform_account_diagnostic";
const GLOBAL_SAMPLE_LIMIT=400;
const TREND_SAMPLE_LIMIT=800;
const SERVER_ONLY_ACTIONS=new Set(["notification_delivered","api_succeeded","signed_in","signed_out"]);
const GLOBAL_WINDOWS={24:1,168:7,720:30,1440:60};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UID=/^[A-Za-z0-9_-]{1,128}$/;
const MODULES=["auth","home","studio","assessments","classroom","school","games","grades","notifications","settings","platform","api","other"];
const KINDS=["session","navigation","action","error","notification","system"];
const ACTIONS=["session_started","auth_session_observed","session_ended","page_open","school_switched","signed_in","signed_out",
  "cloud_save_confirmed","notification_delivered","notification_opened","network_offline","network_online",
  "javascript_error","promise_error","resource_error","api_failed","api_succeeded","support_report_submitted",
  "studio_run_requested","studio_run_completed","studio_run_failed","cloud_save_failed",
  "assessment_submit_requested","assessment_submitted","assessment_withdraw_requested","assessment_evaluate_requested","control_clicked","process_started","process_finished","process_failed"];
const STATES=["info","ok","error","unavailable"];
const PHASES=["observed","started","completed","failed","interrupted"];
const DEVICE_CLASSES=["desktop","tablet","phone","unknown"];
const BROWSERS=["chrome","edge","firefox","safari","other"];
const OPERATING_SYSTEMS=["windows","macos","ios","android","linux","other"];
const VIEWPORTS=["xs","sm","md","lg","xl","unknown"];
function deny(code,message){throw new TenantAccessError(code,message);}
function uid(value){if(typeof value!=="string"||!UID.test(value))deny("invalid-argument","A valid account ID is required.");return value;}
function reason(value){
  if(typeof value!=="string"||value.trim().length<12||value.trim().length>300)
    deny("invalid-argument","Explain the support or security need in 12–300 characters.");
  return value.trim();
}
function code(value){
  if(value===undefined||value===null||value==="")return "";
  if(typeof value!=="string"||!/^[-a-zA-Z0-9_./]{1,64}$/.test(value))deny("invalid-argument","Only diagnostic error codes are accepted.");
  return value;
}
function route(value){
  if(value===undefined||value===null||value==="")return "";
  if(typeof value!=="string"||!/(?:^\/$|^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]{1,80}\.html$)/.test(value))
    deny("invalid-argument","Page paths may not include parameters or personal information.");
  return value;
}
function release(value){
  if(value===undefined||value===null||value==="")return "";
  if(typeof value!=="string"||!/^[-A-Za-z0-9_.]{1,48}$/.test(value))
    deny("invalid-argument","Release markers must be version identifiers.");
  return value;
}

const CONTROLS=new Set(["runBtn","studioConfirmSubmit","evidenceSubmit","evidenceWithdraw","manualReviewAnalyze","newCodeProjectBtn","archivedCodeProjectsBtn","legacyDraftProjectBtn","refreshEarlierProjectsBtn","studioTaskSubmitShortcut","studioTaskOpenDesktop","studioMobileTask","backToProjectsBtn","saveProjectBtn","cloudSaveProjectBtn","cloudLoadProjectBtn","loadProjectBtn","undoRestoreBtn","restoreSubmittedSourceBtn","importZipBtn","exportZipBtn","resetBtn","snapshotBtn","legacyImportBtn","studioSubmitAssessment","aiTutorBtn","projectSettingsBtn","studioPreferencesBtn","studioMobileRun","studioCancelQueueBtn","cancelRunBtn","stopDesktopBtn","stopCheerpjBtn","saveDesignBtn","renderDesignBtn","enableProjectDbBtn","dbNewTableBtn","dbExportCsvBtn","dbInsertRowBtn","dbRunBtn","evidenceRefresh","projectWizardCreate","projectSettingsSave","studioReadinessJoin","pu-create","pu-refresh","pu-save-profile","pu-reset-password","pu-platform-authority","pu-lifecycle","pu-test-toggle","pu-test-grant","pu-create-submit"]);
const PROCESS_NAMES=new Set(["studio_cloud_save"]);
const CONTEXT_ENUMS={visibility:["visible","hidden","other"],network:["online","offline"],focus:["focused","unfocused"],ready:["loading","interactive","complete","other"],dialog:["open","none"],busy:["busy","idle"]};
function checkedContext(value){
  if(!value||typeof value!=="object"||Array.isArray(value))deny("invalid-argument","Invalid diagnostic context.");
  const allowed=[...Object.keys(CONTEXT_ENUMS),"control","process","active","overflow","clientAt","elapsedMs"];
  if(Object.keys(value).some(k=>!allowed.includes(k)))deny("invalid-argument","Diagnostic context accepts only approved metadata.");
  const out={};
  for(const [key,options] of Object.entries(CONTEXT_ENUMS)){
    if(value[key]!==undefined){if(!options.includes(value[key]))deny("invalid-argument","Invalid diagnostic state.");out[key]=value[key];}
  }
  for(const [key,options] of [["control",CONTROLS],["process",PROCESS_NAMES]]){
    if(value[key]!==undefined){if(!options.has(value[key]))deny("invalid-argument","Unknown diagnostic control or process.");out[key]=value[key];}
  }
  if(value.active!==undefined){
    if(!Array.isArray(value.active)||value.active.length>6)deny("invalid-argument","Invalid active process snapshot.");
    const seen=new Set();
    out.active=value.active.map(p=>{
      if(!p||typeof p!=="object"||Array.isArray(p)||Object.keys(p).some(k=>!["name","id","ageMs"].includes(k))||
        !PROCESS_NAMES.has(p.name)||typeof p.id!=="string"||!UUID.test(p.id)||seen.has(p.id.toLowerCase())||
        !Number.isInteger(p.ageMs)||p.ageMs<0||p.ageMs>3600000)deny("invalid-argument","Invalid active process.");
      seen.add(p.id.toLowerCase());return {name:p.name,id:p.id.toLowerCase(),ageMs:p.ageMs};
    });
  }
  for(const [key,max] of [["overflow",100],["clientAt",8640000000000000],["elapsedMs",3600000]]){
    if(value[key]!==undefined){if(!Number.isSafeInteger(value[key])||value[key]<0||value[key]>max)deny("invalid-argument","Invalid diagnostic timing or count.");out[key]=value[key];}
  }
  return out;
}

function checkedEvent(input){
  if(!input||typeof input!=="object"||Array.isArray(input))
    deny("invalid-argument","A diagnostic event is required.");
  const keys=Object.keys(input);
  if(keys.some(key=>!["eventId","sessionId","kind","module","action","state","errorCode","route","release","operationId","phase","deviceClass","browserFamily","osFamily","viewport","context"].includes(key)))
    deny("invalid-argument","Diagnostic events accept only approved metadata.");
  if(typeof input.eventId!=="string"||!UUID.test(input.eventId)||
     typeof input.sessionId!=="string"||!UUID.test(input.sessionId))
    deny("invalid-argument","Diagnostic event identifiers are invalid.");
  if(!KINDS.includes(input.kind)||!MODULES.includes(input.module)||
     !ACTIONS.includes(input.action)||!STATES.includes(input.state))
    deny("invalid-argument","Diagnostic event category is invalid.");
  const kindActions={
    session:["session_started","auth_session_observed","session_ended","signed_in","signed_out"],
    navigation:["page_open"],notification:["notification_delivered","notification_opened"],
    system:["network_offline","network_online"],
    error:["javascript_error","promise_error","resource_error","api_failed","studio_run_failed","cloud_save_failed","process_failed"],
    action:["school_switched","cloud_save_confirmed","api_succeeded","support_report_submitted",
      "studio_run_requested","studio_run_completed","assessment_submit_requested","assessment_submitted",
      "assessment_withdraw_requested","assessment_evaluate_requested","control_clicked","process_started","process_finished"]
  };
  if(!kindActions[input.kind].includes(input.action))
    deny("invalid-argument","Diagnostic category and action must agree.");
  if(input.kind==="error"&&input.state!=="error"&&input.state!=="unavailable")
    deny("invalid-argument","Error events must declare an error or unavailable state.");
  if(input.kind!=="error"&&input.errorCode)
    deny("invalid-argument","An error code is only valid for error events.");
  if(input.operationId!==undefined&&(!UUID.test(input.operationId)||typeof input.operationId!=="string"))
    deny("invalid-argument","Operation correlation ID must be a UUID.");
  if(input.phase!==undefined&&!PHASES.includes(input.phase))
    deny("invalid-argument","Diagnostic process phase is invalid.");
  for(const [key,allow] of [["deviceClass",DEVICE_CLASSES],["browserFamily",BROWSERS],
    ["osFamily",OPERATING_SYSTEMS],["viewport",VIEWPORTS]]){
    if(input[key]!==undefined&&!allow.includes(input[key]))
      deny("invalid-argument","Diagnostic client environment category is invalid.");
  }
  return {
    eventId:input.eventId.toLowerCase(),sessionId:input.sessionId.toLowerCase(),
    kind:input.kind,module:input.module,action:input.action,state:input.state,
    errorCode:code(input.errorCode),route:route(input.route),release:release(input.release),
    ...(input.context!==undefined?{context:checkedContext(input.context)}:{}),
    ...(input.operationId?{operationId:input.operationId.toLowerCase()}:{}),
    ...(input.phase?{phase:input.phase}:{}),
    ...Object.fromEntries(["deviceClass","browserFamily","osFamily","viewport"]
      .filter(key=>input[key]!==undefined).map(key=>[key,input[key]]))
  };
}
function safeService(value){
  return typeof value==="string"&&/^[a-zA-Z0-9_-]{1,64}$/.test(value)?value:"school_api";
}
function serverErrorCode(error){
  const value=String(error?.code||"internal").replace(/^functions\//,"");
  return /^[-A-Za-z0-9_./]{1,64}$/.test(value)?value:"internal";
}
function deliveryId(ownerUid,notificationId){
  const hash=createHash("sha256").update(ownerUid+"|"+notificationId).digest("hex");
  return hash.slice(0,8)+"-"+hash.slice(8,12)+"-4"+hash.slice(13,16)+"-a"+hash.slice(17,20)+"-"+hash.slice(20,32);
}
function createdAtNumber(value){
  return typeof value?.toMillis==="function"?value.toMillis():
    typeof value==="number"?value:0;
}
function safeProcess(value,max=70){
  return typeof value==="string"&&new RegExp("^[A-Za-z][A-Za-z0-9_-]{0,"+(max-1)+"}$").test(value)
    ?value:"call";
}
function traceFromRequest(request){
  const raw=String(request?.rawRequest?.headers?.["x-cloud-trace-context"]||"").split("/")[0];
  return /^[0-9a-f]{32}$/i.test(raw)?raw.toLowerCase():"";
}
function fingerprint(row){
  if(!["failure","warning"].includes(diagnosticSeverity(row)))return "";
  const values=[row.module||"other",row.service||"",row.action||"",row.errorCode||"unknown"];
  return createHash("sha256").update(values.join("|")).digest("hex").slice(0,20);
}
function diagnosticSeverity(row){
  // Only server-interpreted outcomes are flagged; an observed button click
  // is a normal event, not evidence that its requested operation succeeded.
  if(row?.kind==="error"||row?.state==="error"||
    ["api_failed","studio_run_failed","cloud_save_failed","javascript_error","promise_error","resource_error"].includes(row?.action))
    return "failure";
  if(row?.action==="network_offline"||row?.state==="unavailable")
    return "warning";
  return "normal";
}
function serialize(doc,source="client"){
  const row=doc.data()||{};
  let context;try{if(row.context!==undefined)context=checkedContext(row.context);}catch{}
  return {
    ...(context?{context}:{}),
    id:doc.id,at:createdAtNumber(row.createdAt),severity:diagnosticSeverity(row),
    provenance:row.source==="backend"?"server_confirmed":"client_observed",
    phase:String(row.phase||(row.state==="error"?"failed":row.state==="unavailable"?"interrupted":"observed")).slice(0,16),sessionId:String(row.sessionId||"").slice(0,40),
    operationId:String(row.operationId||"").slice(0,40),traceId:String(row.traceId||"").slice(0,40),
    durationMs:Number.isInteger(row.durationMs)?row.durationMs:null,
    deviceClass:String(row.deviceClass||"").slice(0,16),
    browserFamily:String(row.browserFamily||"").slice(0,16),
    osFamily:String(row.osFamily||"").slice(0,16),
    viewport:String(row.viewport||"").slice(0,8),
    fingerprint:String(row.fingerprint||fingerprint(row)).slice(0,24),
    kind:String(row.kind||"system").slice(0,30),module:String(row.module||"other").slice(0,30),
    action:String(row.action||"").slice(0,48),state:String(row.state||"info").slice(0,24),
    errorCode:String(row.errorCode||"").slice(0,64),
    route:String(row.route||"").slice(0,110),release:String(row.release||"").slice(0,48),
    source:String(row.source||source).slice(0,30),
    ...(row.service?{service:String(row.service).slice(0,64)}:{})
  };
}
function createPlatformAccountDiagnostics({db,FieldValue,Timestamp,now=Date.now}){
  const root=id=>db.collection("platform_account_diagnostics").doc(id);
  async function insert(ownerUid,event,{source="browser",service=""}={}){
    const at=now(),date=new Date(at).toISOString().slice(0,10);
    const account=root(ownerUid),entry=account.collection("entries").doc(event.eventId);
    const quota=account.collection("daily_quotas").doc(date);
    return db.runTransaction(async tx=>{
      const existing=await tx.get(entry);
      if(existing.exists)return {recorded:true,duplicate:true};
      const counter=await tx.get(quota),count=Number(counter.data()?.count)||0;
      if(count>=PER_ACCOUNT_DAILY_LIMIT)
        deny("resource-exhausted","Account diagnostic collection reached its daily safety limit.");
      const isNormal=diagnosticSeverity(event)==="normal";
      const normalCount=Number(counter.data()?.normalCount)||0;
      if(isNormal&&normalCount>=NORMAL_DAILY_LIMIT)
        deny("resource-exhausted","Normal event budget is full; diagnostic slots are reserved for warnings and errors.");
      const expiry=Timestamp.fromMillis(at+RETENTION_DAYS*DAY_MS);
      tx.set(account,{
        ownerUid,updatedAt:FieldValue.serverTimestamp(),
        lastSeverity:diagnosticSeverity(event),
        lastKind:event.kind,lastAction:event.action,lastModule:event.module,
        lastState:event.state,lastErrorCode:event.errorCode||""
      },{merge:true});
      tx.set(quota,{count:count+1,normalCount:normalCount+(isNormal?1:0),expiresAt:expiry});
      const sanitized={...event,ownerUid,source,...(service?{service}:{}),
        diagnosticScope:GLOBAL_SCOPE,
        phase:event.phase||(event.state==="error"?"failed":event.state==="unavailable"?"interrupted":
          event.action.endsWith("_requested")?"started":event.state==="ok"?"completed":"observed"),
        createdAt:FieldValue.serverTimestamp(),expiresAt:expiry};
      sanitized.severity=diagnosticSeverity(sanitized);
      sanitized.fingerprint=fingerprint(sanitized);
      tx.create(entry,sanitized);
      return {recorded:true,duplicate:false};
    });
  }
  async function writeServerFailure(request,error,startedAt=now()){
    if(request?.auth?.token?.email_verified!==true||!request?.auth?.uid)return;
    const ownerUid=String(request.auth.uid);
    if(!UID.test(ownerUid))return;
    const rawPath=String(request?.rawRequest?.path||"").split("?")[0].split("/").at(-1);
    const service=safeService(rawPath);
    const type=serverErrorCode(error);
    const action=String(request?.data?.action||"");
    // Never include user data, arbitrary action arguments or error messages.
    const safeAction=/^[a-z][a-z0-9_-]{0,45}$/.test(action)?action:"call";
    const synthetic={
      eventId:randomUUID(),sessionId:randomUUID(),kind:"error",module:"api",
      action:"api_failed",state:"error",errorCode:type,route:"",release:"",
      phase:"failed",traceId:traceFromRequest(request),
      durationMs:Math.max(0,Math.min(120000,now()-(Number(startedAt)||now())))
    };
    try{return await insert(ownerUid,synthetic,{source:"backend",service:service+"."+safeAction});}
    catch(writeError){console.warn("Account diagnostic write skipped",{code:writeError?.code||"unknown"});}
  }
  async function recordNotificationDelivered(ownerUid,notificationId){
    if(!UID.test(String(ownerUid||""))||typeof notificationId!=="string"||!notificationId||notificationId.length>160)return;
    const event={eventId:deliveryId(ownerUid,notificationId),sessionId:randomUUID(),kind:"notification",
      module:"notifications",action:"notification_delivered",state:"ok",
      errorCode:"",route:"",release:""};
    try{return await insert(ownerUid,event,{source:"backend"});}
    catch(error){console.warn("Notification diagnostic skipped",{code:error?.code||"unknown"});}
  }
  async function list(request,input){
    const authority=await platformAuthority({db,request});
    if(!authority.platformAdmin)deny("permission-denied","Platform Administrator authority is required.");
    const ownerUid=uid(input.targetUid),purpose=reason(input.reason);
    const limit=Number.isInteger(input.limit)&&input.limit>=1?Math.min(MAX_PAGE,input.limit):40;
    const cursor=input.cursor===undefined||input.cursor===null||input.cursor===""?"":
      (typeof input.cursor==="string"&&UUID.test(input.cursor)?input.cursor:"invalid");
    if(cursor==="invalid")deny("invalid-argument","Diagnostic pagination cursor is invalid.");
    const account=root(ownerUid);
    let q=account.collection("entries").orderBy("createdAt","desc").limit(limit+1);
    if(cursor){
      const last=await account.collection("entries").doc(cursor).get();
      if(!last.exists)deny("failed-precondition","Diagnostic page expired; refresh the account timeline.");
      q=q.startAfter(last);
    }
    const rows=await q.get(),page=rows.docs.slice(0,limit);
    // Historical platform lifecycle actions are already immutable in platform_audit.
    // Do not duplicate them as new diagnostic events.
    let accountAudit=[];
    if(!cursor){
      const audit=await db.collection("platform_audit").where("targetUid","==",ownerUid).limit(100).get();
      accountAudit=audit.docs.map(doc=>{
        const data=doc.data()||{};
        const action=String(data.action||"").slice(0,90);
        return {
          id:doc.id,source:"platform_audit",at:createdAtNumber(data.createdAt),
          action:/^[a-z][a-z0-9_-]{0,89}$/.test(action)?action:"administrative_action",
          actorUid:typeof data.actorUid==="string"&&UID.test(data.actorUid)?data.actorUid:"",
          kind:"administrative_audit"
        };
      }).sort((a,b)=>b.at-a.at);
    }
    // Viewing activity for any account is itself an immutable audited act.
    await db.collection("platform_audit").add({
      actorUid:authority.uid,targetUid:ownerUid,action:"platform_user_diagnostics_viewed",
      reason:purpose,returned:page.length,createdAt:FieldValue.serverTimestamp()
    });
    return {targetUid:ownerUid,events:page.map(doc=>serialize(doc)),accountAudit,
      auditSampleCapped:accountAudit.length===100,
      hasMore:rows.size>limit,cursor:rows.size>limit?page.at(-1)?.id:null,
      retentionDays:RETENTION_DAYS,
      note:"Best-effort diagnostics plus preserved existing platform lifecycle audit records. No historical browser events can be reconstructed."};
  }
  async function recentAccounts(request,input){
    const authority=await platformAuthority({db,request});
    if(!authority.platformAdmin)deny("permission-denied","Platform Administrator authority is required.");
    const purpose=reason(input.reason);
    const limit=Number.isInteger(input.limit)&&input.limit>=1?Math.min(MAX_PAGE,input.limit):30;
    const cursor=input.cursor===undefined||input.cursor===null||input.cursor===""?"":uid(input.cursor);
    let query=db.collection("platform_account_diagnostics")
      .orderBy("updatedAt","desc").limit(limit+1);
    if(cursor){
      const previous=await root(cursor).get();
      if(!previous.exists)deny("failed-precondition","Activity list changed; reload recent accounts.");
      query=query.startAfter(previous);
    }
    const response=await query.get(),page=response.docs.slice(0,limit);
    const accounts=page.map(doc=>{
      const row=doc.data()||{},severity=["normal","warning","failure"].includes(row.lastSeverity)
        ?row.lastSeverity:"unknown";
      return {
        ownerUid:doc.id,at:createdAtNumber(row.updatedAt),severity,
        action:typeof row.lastAction==="string"?row.lastAction.slice(0,48):"",
        module:typeof row.lastModule==="string"?row.lastModule.slice(0,30):"",
        state:typeof row.lastState==="string"?row.lastState.slice(0,24):"",
        errorCode:typeof row.lastErrorCode==="string"?row.lastErrorCode.slice(0,64):""
      };
    }).filter(row=>UID.test(row.ownerUid));
    await db.collection("platform_audit").add({
      actorUid:authority.uid,action:"platform_user_diagnostics_recent_viewed",
      reason:purpose,returned:accounts.length,createdAt:FieldValue.serverTimestamp()
    });
    return {accounts,hasMore:response.size>limit,
      cursor:response.size>limit?page.at(-1)?.id:null,scope:"account_activity_index",
      note:"Recently observed account activity only; accounts without recorded events are available in Platform Users and the account directory."};
  }

  async function recordServerProcess(request,{service,startedAt,status="ok"}={}){
    // Server-owned process outcome. Never trust arbitrary request field values as
    // event text. Only a small set of write actions is instrumented in index.js.
    if(request?.auth?.token?.email_verified!==true||!UID.test(String(request?.auth?.uid||"")))return;
    const ownerUid=request.auth.uid;
    const rawAction=String(request?.data?.action||"call");
    const safeAction=safeProcess(rawAction,48);
    const safeServiceName=safeProcess(service,64);
    const ms=Math.max(0,Math.min(120000,now()-(Number(startedAt)||now())));
    const event={
      eventId:randomUUID(),sessionId:randomUUID(),kind:"action",module:"api",
      action:"api_succeeded",state:"ok",errorCode:"",route:"",
      release:"",phase:"completed",durationMs:ms,traceId:traceFromRequest(request)
    };
    try{return await insert(ownerUid,event,{source:"backend",service:safeServiceName+"."+safeAction});}
    catch(error){console.warn("Diagnostic server completion skipped",{code:error?.code||"unknown"});}
  }
  function globalQuery({severity="",module="",fingerprint:pattern="",windowHours=24}={}){
    if(severity&&!["normal","warning","failure"].includes(severity))
      deny("invalid-argument","Unsupported log flag filter.");
    if(module&&!MODULES.includes(module))
      deny("invalid-argument","Unsupported log module filter.");
    if(pattern&&(!/^[0-9a-f]{20}$/.test(pattern)||severity||module))
      deny("invalid-argument","Fingerprint investigation cannot be combined with other event filters.");
    if(!Object.hasOwn(GLOBAL_WINDOWS,String(windowHours)))
      deny("invalid-argument","Unsupported log time window.");
    let query=db.collectionGroup("entries").where("diagnosticScope","==",GLOBAL_SCOPE);
    if(pattern)query=query.where("fingerprint","==",pattern);
    if(severity)query=query.where("severity","==",severity);
    if(module)query=query.where("module","==",module);
    // No reliance on the caller's clock. Data entered before the global index
    // was introduced remains accessible in each account's original timeline.
    query=query.where("createdAt",">=",Timestamp.fromMillis(now()-windowHours*3600000));
    return query.orderBy("createdAt","desc");
  }
  function safeGlobalDoc(doc){
    const parent=doc?.ref?.parent;
    const account=parent?.parent;
    if(parent?.id!=="entries"||account?.parent?.id!=="platform_account_diagnostics"||
      !UID.test(account.id)||doc.data()?.ownerUid!==account.id||
      doc.data()?.diagnosticScope!==GLOBAL_SCOPE)return null;
    return {...serialize(doc),ownerUid:account.id};
  }
  async function globalFeed(request,input){
    const authority=await platformAuthority({db,request});
    if(!authority.platformAdmin)deny("permission-denied","Platform Administrator authority is required.");
    const purpose=reason(input.reason);
    const windowHours=input.windowHours===undefined?24:Number(input.windowHours);
    const severity=input.severity||"",module=input.module||"",pattern=input.fingerprint||"";
    const limit=Number.isInteger(input.limit)&&input.limit>=1?Math.min(MAX_PAGE,input.limit):35;
    let query=globalQuery({severity,module,fingerprint:pattern,windowHours});
    if(input.cursor!==undefined&&input.cursor!==null&&input.cursor!==""){
      const parts=String(input.cursor).split("/");
      if(parts.length!==4||parts[0]!=="platform_account_diagnostics"||!UID.test(parts[1])||
        parts[2]!=="entries"||!UUID.test(parts[3]))
        deny("invalid-argument","Global feed page cursor is invalid.");
      const last=await root(parts[1]).collection("entries").doc(parts[3]).get();
      if(!last.exists||last.data()?.diagnosticScope!==GLOBAL_SCOPE)
        deny("failed-precondition","This log page expired; refresh the feed.");
      query=query.startAfter(last);
    }
    const result=await query.limit(limit+1).get();
    const page=result.docs.slice(0,limit);
    const events=page.map(safeGlobalDoc).filter(Boolean);
    // Every cross-account log query is itself a permanent platform action.
    await db.collection("platform_audit").add({
      actorUid:authority.uid,action:"platform_user_diagnostics_global_viewed",
      reason:purpose,returned:events.length,
      filters:{severity,module,windowHours,pattern},createdAt:FieldValue.serverTimestamp()
    });
    return {events,hasMore:result.size>limit,
      cursor:result.size>limit?(page.at(-1)?.ref?.path||null):null,
      scope:"all_recorded_account_events",windowHours,activePattern:pattern,
      coverage:"Globally indexed events only. Earlier per-user diagnostics remain in account history; anonymous and unrecorded actions are not reconstructed."};
  }

  // Three-second near-live watch. Do not create one immutable audit write per
  // poll: a platform admin's continuously authenticated access is audited once
  // per ten-minute investigation window, with a fresh reason on each window.
  async function liveFeed(request,input){
    const authority=await platformAuthority({db,request});
    if(!authority.platformAdmin)
      deny("permission-denied","Platform Administrator authority is required.");
    const purpose=reason(input.reason);
    uid(authority.uid);
    const limit=Number.isInteger(input.limit)&&input.limit>=1?Math.min(MAX_PAGE,input.limit):60;
    const windowKey=Math.floor(now()/600000);
    const purposeKey=createHash("sha256").update(purpose).digest("hex").slice(0,12);
    const audit=db.collection("platform_audit")
      .doc("diagnostic_live_"+authority.uid+"_"+windowKey+"_"+purposeKey);
    await db.runTransaction(async tx=>{
      const existing=await tx.get(audit);
      if(!existing.exists)tx.create(audit,{
        actorUid:authority.uid,action:"platform_user_diagnostics_live_viewed",
        reason:purpose,windowMinutes:10,createdAt:FieldValue.serverTimestamp()
      });
    });
    const scope=db.collectionGroup("entries").where("diagnosticScope","==",GLOBAL_SCOPE);
    const rawCursor=input.cursor===undefined||input.cursor===null?"":input.cursor;
    if(typeof rawCursor!=="string"||rawCursor.length>260)
      deny("invalid-argument","Invalid live diagnostic cursor.");
    let docs=[],nextCursor="",hasMore=false,initial=!rawCursor;
    if(rawCursor){
      const parts=rawCursor.split("/");
      if(parts.length!==4||parts[0]!=="platform_account_diagnostics"||!UID.test(parts[1])||
         parts[2]!=="entries"||!UUID.test(parts[3]))
        deny("invalid-argument","Invalid live diagnostic cursor.");
      const last=await root(parts[1]).collection("entries").doc(parts[3]).get();
      if(!last.exists||last.data()?.ownerUid!==parts[1]||
        last.data()?.diagnosticScope!==GLOBAL_SCOPE)
        deny("failed-precondition","Live cursor expired; restart from the latest indexed events.");
      const result=await scope.orderBy("createdAt","asc").startAfter(last).limit(limit+1).get();
      docs=result.docs.slice(0,limit);
      nextCursor=docs.at(-1)?.ref?.path||rawCursor;
      hasMore=result.size>limit;
    }else{
      const result=await scope.orderBy("createdAt","desc").limit(Math.min(limit,50)).get();
      docs=result.docs.slice().reverse();
      nextCursor=result.docs[0]?.ref?.path||"";
    }
    const events=docs.map(safeGlobalDoc).filter(Boolean);
    return {
      scope:"live_indexed_account_events",initial,events,cursor:nextCursor,hasMore,
      pollAfterMs:3000,serverAt:now(),
      coverage:"Near-live 3-second polling, not direct device monitoring. Only recorded, indexed and authorized diagnostic metadata; no guarantee of every click or anonymous sign-in."
    };
  }


  async function globalTrends(request,input){
    const authority=await platformAuthority({db,request});
    if(!authority.platformAdmin)deny("permission-denied","Platform Administrator authority is required.");
    const purpose=reason(input.reason);
    const windowHours=input.windowHours===undefined?24:Number(input.windowHours);
    const module=input.module||"";
    // This uses the canonical, index-backed global event query. It intentionally
    // samples at most 800 newest entries; a clipped period is never reported
    // as an exact fleet-wide rate or a complete zero-activity bucket.
    const result=await globalQuery({module,windowHours}).limit(TREND_SAMPLE_LIMIT+1).get();
    const events=result.docs.slice(0,TREND_SAMPLE_LIMIT).map(safeGlobalDoc).filter(Boolean);
    const truncated=result.size>TREND_SAMPLE_LIMIT,periodStart=now()-windowHours*3600000;
    const bucketHours=windowHours===24?1:windowHours===168?6:windowHours===720?24:48;
    const bucketMs=bucketHours*3600000,binCount=Math.ceil(windowHours/bucketHours);
    const bins=Array.from({length:binCount},(_,index)=>({
      at:periodStart+index*bucketMs,normal:0,warning:0,failure:0,
      serverConfirmed:0,clientObserved:0
    }));
    const affected=new Set(),backendServices=new Map(),browserFailures=new Map();
    const durations=[],summary={normal:0,warning:0,failure:0,
      serverConfirmed:0,clientObserved:0};
    let oldestAt=0,newestAt=0;
    for(const row of events){
      const at=Number(row.at)||0;
      if(!at||at<periodStart||at>now()+60000)continue;
      oldestAt=!oldestAt?at:Math.min(oldestAt,at);
      newestAt=Math.max(newestAt,at);
      affected.add(row.ownerUid);
      const level=["normal","warning","failure"].includes(row.severity)?row.severity:"normal";
      const provenance=row.provenance==="server_confirmed"?"serverConfirmed":"clientObserved";
      summary[level]++;summary[provenance]++;
      const index=Math.max(0,Math.min(binCount-1,Math.floor((at-periodStart)/bucketMs)));
      bins[index][level]++;bins[index][provenance]++;
      if(provenance==="serverConfirmed"&&Number.isInteger(row.durationMs)&&
        row.durationMs>=0)durations.push(row.durationMs);
      if(provenance==="serverConfirmed"&&row.service){
        if(!backendServices.has(row.service))backendServices.set(row.service,{
          service:row.service,success:0,failure:0,warning:0,accounts:new Set()
        });
        const service=backendServices.get(row.service);
        service.accounts.add(row.ownerUid);
        if(level==="failure")service.failure++;
        else if(level==="warning")service.warning++;
        else if(row.action==="api_succeeded")service.success++;
      }
      if(level!=="failure"||provenance!=="clientObserved")continue;
      const browser=row.browserFamily||"unknown";
      if(!browserFailures.has(browser))browserFailures.set(browser,{
        browser,events:0,accounts:new Set()
      });
      const environment=browserFailures.get(browser);
      environment.events++;environment.accounts.add(row.ownerUid);
    }
    durations.sort((a,b)=>a-b);
    const pct=percentage=>durations.length?
      durations[Math.ceil(percentage*durations.length)-1]:null;
    await db.collection("platform_audit").add({
      actorUid:authority.uid,action:"platform_user_diagnostics_trends_viewed",
      reason:purpose,windowHours,module,returned:events.length,
      createdAt:FieldValue.serverTimestamp()
    });
    return {
      scope:"bounded_global_diagnostic_trends",windowHours,bucketHours,
      sampleCap:TREND_SAMPLE_LIMIT,truncated,eventsSampled:events.length,
      observedAccounts:affected.size,oldestSampleAt:oldestAt,newestSampleAt:newestAt,
      windowStartAt:periodStart,windowEndAt:now(),
      summary,series:bins,
      backendDurationP50Ms:pct(.5),backendDurationP95Ms:pct(.95),
      backendDurationSample:durations.length,
      backendServices:[...backendServices.values()].map(item=>({
        service:item.service,success:item.success,failure:item.failure,warning:item.warning,
        affectedAccounts:item.accounts.size
      })).sort((a,b)=>b.failure-a.failure||b.warning-a.warning||b.success-a.success).slice(0,10),
      clientErrorBrowsers:[...browserFailures.values()].map(item=>({
        browser:item.browser,events:item.events,affectedAccounts:item.accounts.size
      })).sort((a,b)=>b.events-a.events).slice(0,6),
      coverage:"Newest indexed records only. Browser reports are not server-confirmed results; sample truncation and missing telemetry can understate event volume, affected accounts and failure rates."
    };
  }

  async function globalImpact(request,input){
    const authority=await platformAuthority({db,request});
    if(!authority.platformAdmin)deny("permission-denied","Platform Administrator authority is required.");
    const purpose=reason(input.reason);
    const windowHours=input.windowHours===undefined?24:Number(input.windowHours);
    const snapshot=await globalQuery({windowHours}).limit(GLOBAL_SAMPLE_LIMIT+1).get();
    const docs=snapshot.docs.slice(0,GLOBAL_SAMPLE_LIMIT).map(safeGlobalDoc).filter(Boolean);
    const severityCounts={normal:0,warning:0,failure:0};
    const modules=new Map(),patterns=new Map(),accounts=new Set();
    for(const event of docs){
      severityCounts[event.severity]=(severityCounts[event.severity]||0)+1;
      accounts.add(event.ownerUid);
      const mod=event.module||"other";
      modules.set(mod,(modules.get(mod)||0)+1);
      if(event.severity!=="failure"&&event.severity!=="warning")continue;
      const key=event.fingerprint||
        createHash("sha256").update([event.module,event.action,event.errorCode].join("|")).digest("hex").slice(0,20);
      if(!patterns.has(key))patterns.set(key,{
        key,module:event.module,action:event.action,code:event.errorCode||"",
        severity:event.severity,events:0,accounts:new Set(),firstAt:event.at,lastAt:event.at
      });
      const group=patterns.get(key);
      group.events++;group.accounts.add(event.ownerUid);
      group.firstAt=Math.min(group.firstAt,event.at);group.lastAt=Math.max(group.lastAt,event.at);
    }
    const clusters=[...patterns.values()].map(group=>({
      key:group.key,module:group.module,action:group.action,errorCode:group.code,
      severity:group.severity,observedEvents:group.events,observedAccounts:group.accounts.size,
      firstAt:group.firstAt,lastAt:group.lastAt
    })).sort((a,b)=>b.observedAccounts-a.observedAccounts||b.observedEvents-a.observedEvents).slice(0,12);
    await db.collection("platform_audit").add({
      actorUid:authority.uid,action:"platform_user_diagnostics_impact_viewed",
      reason:purpose,returned:docs.length,windowHours,createdAt:FieldValue.serverTimestamp()
    });
    return {
      scope:"bounded_global_sample",windowHours,eventsSampled:docs.length,
      sampleCap:GLOBAL_SAMPLE_LIMIT,truncated:snapshot.size>GLOBAL_SAMPLE_LIMIT,
      observedAccounts:accounts.size,severityCounts,
      modules:[...modules].map(([module,count])=>({module,count})).sort((a,b)=>b.count-a.count),
      clusters,
      note:"Impact estimates use the newest 400 indexed events, not an exhaustive platform count; a repeated error code across accounts is a lead, not confirmation of a shared incident."
    };
  }

  async function service(request){
    const input=request.data||{},action=String(input.action||"record");
    if(action==="record"){
      if(request?.auth?.token?.email_verified!==true||!request?.auth?.uid)
        deny("unauthenticated","Sign in with a verified account.");
      const ownerUid=uid(request.auth.uid),event=checkedEvent(input.event);
      if(SERVER_ONLY_ACTIONS.has(event.action))
        deny("permission-denied","Server-confirmed outcomes cannot be submitted from the browser.");
      return insert(ownerUid,event);
    }
    if(action==="list")return list(request,input);
    if(action==="recent_accounts")return recentAccounts(request,input);
    if(action==="global_feed")return globalFeed(request,input);
    if(action==="global_live")return liveFeed(request,input);
    if(action==="global_impact")return globalImpact(request,input);
    if(action==="global_trends")return globalTrends(request,input);
    deny("invalid-argument","Unknown diagnostic operation.");
  }
  async function cleanup({maxAccounts=50,maxPerAccount=200}={}){
    let deleted=0,accountCursor=null,accountsScanned=0,truncated=false;
    do{
      let q=db.collection("platform_account_diagnostics").orderBy("__name__").limit(maxAccounts);
      if(accountCursor)q=q.startAfter(accountCursor);
      const accounts=await q.get();
      for(const account of accounts.docs){
        accountsScanned++;
        for(const sub of ["entries","daily_quotas"]){
          const records=await account.ref.collection(sub)
            .where("expiresAt","<=",Timestamp.fromMillis(now())).limit(maxPerAccount).get();
          if(records.size===maxPerAccount)truncated=true;
          for(let offset=0;offset<records.docs.length;offset+=200){
            const batch=db.batch();
            for(const doc of records.docs.slice(offset,offset+200))batch.delete(doc.ref);
            await batch.commit();
          }
          deleted+=records.size;
        }
      }
      if(accounts.size<maxAccounts)break;
      accountCursor=accounts.docs.at(-1);
    }while(accountCursor);
    return {deleted,accountsScanned,truncated};
  }
  return {service,writeServerFailure,recordServerProcess,recordNotificationDelivered,cleanup};
}
module.exports={RETENTION_DAYS,PER_ACCOUNT_DAILY_LIMIT,checkedEvent,diagnosticSeverity,createPlatformAccountDiagnostics};
