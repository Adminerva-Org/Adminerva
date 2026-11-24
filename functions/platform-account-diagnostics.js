"use strict";
/**
 * Adminerva per-login diagnostic timeline. Server-owned support evidence,
 * separate from academic records, research analytics and fleet telemetry.
 * Only allowlisted metadata is stored; no user text, URLs with query strings,
 * passwords, tokens, code, grades, private notifications or request bodies.
 */
const {platformAuthority,TenantAccessError}=require("./tenant-access.js");
const {randomUUID}=require("node:crypto");
const RETENTION_DAYS=60,PER_ACCOUNT_DAILY_LIMIT=300,MAX_PAGE=75,DAY_MS=86400000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UID=/^[A-Za-z0-9_-]{1,128}$/;
const MODULES=["auth","home","studio","assessments","classroom","school","games","grades","notifications","settings","platform","api","other"];
const KINDS=["session","navigation","action","error","notification","system"];
const ACTIONS=["session_started","session_ended","page_open","school_switched","signed_in","signed_out",
  "cloud_save_confirmed","notification_delivered","network_offline","network_online",
  "javascript_error","promise_error","resource_error","api_failed","api_succeeded","support_report_submitted"];
const STATES=["info","ok","error","unavailable"];
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
  if(typeof value!=="string"||!/^\/[A-Za-z0-9_/-]{0,100}(?:\.html)?$/.test(value))
    deny("invalid-argument","Page paths may not include parameters or personal information.");
  return value;
}
function release(value){
  if(value===undefined||value===null||value==="")return "";
  if(typeof value!=="string"||!/^[-A-Za-z0-9_.]{1,48}$/.test(value))
    deny("invalid-argument","Release markers must be version identifiers.");
  return value;
}
function checkedEvent(input){
  if(!input||typeof input!=="object"||Array.isArray(input))
    deny("invalid-argument","A diagnostic event is required.");
  const keys=Object.keys(input);
  if(keys.some(key=>!["eventId","sessionId","kind","module","action","state","errorCode","route","release"].includes(key)))
    deny("invalid-argument","Diagnostic events accept only approved metadata.");
  if(typeof input.eventId!=="string"||!UUID.test(input.eventId)||
     typeof input.sessionId!=="string"||!UUID.test(input.sessionId))
    deny("invalid-argument","Diagnostic event identifiers are invalid.");
  if(!KINDS.includes(input.kind)||!MODULES.includes(input.module)||
     !ACTIONS.includes(input.action)||!STATES.includes(input.state))
    deny("invalid-argument","Diagnostic event category is invalid.");
  if(input.kind==="error"&&input.state!=="error"&&input.state!=="unavailable")
    deny("invalid-argument","Error events must declare an error or unavailable state.");
  if(input.kind!=="error"&&input.errorCode)
    deny("invalid-argument","An error code is only valid for error events.");
  return {
    eventId:input.eventId.toLowerCase(),sessionId:input.sessionId.toLowerCase(),
    kind:input.kind,module:input.module,action:input.action,state:input.state,
    errorCode:code(input.errorCode),route:route(input.route),release:release(input.release)
  };
}
function safeService(value){
  return typeof value==="string"&&/^[a-zA-Z0-9_-]{1,64}$/.test(value)?value:"school_api";
}
function serverErrorCode(error){
  const value=String(error?.code||"internal").replace(/^functions\//,"");
  return /^[-A-Za-z0-9_./]{1,64}$/.test(value)?value:"internal";
}
function createdAtNumber(value){
  return typeof value?.toMillis==="function"?value.toMillis():
    typeof value==="number"?value:0;
}
function serialize(doc,source="client"){
  const row=doc.data()||{};
  return {
    id:doc.id,at:createdAtNumber(row.createdAt),
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
      const expiry=Timestamp.fromMillis(at+RETENTION_DAYS*DAY_MS);
      tx.set(account,{ownerUid,updatedAt:FieldValue.serverTimestamp()},{merge:true});
      tx.set(quota,{count:count+1,expiresAt:expiry});
      tx.create(entry,{...event,ownerUid,source,...(service?{service}:{}),
        createdAt:FieldValue.serverTimestamp(),expiresAt:expiry});
      return {recorded:true,duplicate:false};
    });
  }
  async function writeServerFailure(request,error){
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
      action:"api_failed",state:"error",errorCode:type,route:"",release:""
    };
    try{return await insert(ownerUid,synthetic,{source:"backend",service:service+"."+safeAction});}
    catch(writeError){console.warn("Account diagnostic write skipped",{code:writeError?.code||"unknown"});}
  }
  async function recordNotificationDelivered(ownerUid){
    if(!UID.test(String(ownerUid||"")))return;
    const event={eventId:randomUUID(),sessionId:randomUUID(),kind:"notification",
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
  async function service(request){
    const input=request.data||{},action=String(input.action||"record");
    if(action==="record"){
      if(request?.auth?.token?.email_verified!==true||!request?.auth?.uid)
        deny("unauthenticated","Sign in with a verified account.");
      const ownerUid=uid(request.auth.uid);
      return insert(ownerUid,checkedEvent(input.event));
    }
    if(action==="list")return list(request,input);
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
  return {service,writeServerFailure,recordNotificationDelivered,cleanup};
}
module.exports={RETENTION_DAYS,PER_ACCOUNT_DAILY_LIMIT,checkedEvent,createPlatformAccountDiagnostics};
