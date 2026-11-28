import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {checkedEvent,diagnosticSeverity,createPlatformAccountDiagnostics,RETENTION_DAYS}=require("../functions/platform-account-diagnostics.js");

const USER="student001",ADMIN="admin001",SESSION="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  EVENT="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",T=Date.UTC(2026,10,24,8);
const timestamp=ms=>({toMillis:()=>ms});
const clock={serverTimestamp:()=>timestamp(T)};
const request=(as=USER,data={})=>({
  auth:{uid:as,token:{email_verified:true,email:as+"@school.test"}},data,
  rawRequest:{path:"/schoolStudioProjects"}
});

function fakeDb(){
  const values=new Map([["platform_admins/"+ADMIN,{role:"platform_admin",status:"active"}]]);
  const reads=[];
  function snap(path){
    const exists=values.has(path);
    return {id:path.split("/").at(-1),exists,data:()=>values.get(path),ref:doc(path)};
  }
  function collection(path){
    return {
      path,
      doc(id){return doc(path+"/"+id);},
      async add(row){const id="audit_"+reads.length;values.set(path+"/"+id,row);reads.push(row);return doc(path+"/"+id);},
      where(key,op,target){return query(path,{key,op,target});},
      orderBy(key,direction){return query(path,{sortKey:key,direction});}
    };
  }
  function query(path,where={}){
    const params={...where};let size=100,after=null;
    const q={
      where(k,op,v){params.key=k;params.op=op;params.target=v;return q;},
      orderBy(key,direction="asc"){params.sortKey=key;params.direction=direction;return q;},
      limit(n){size=n;return q;},
      startAfter(doc){after=doc.id;return q;},
      async get(){
        let docs=[...values.keys()].filter(key=>key.startsWith(path+"/")&&!key.slice(path.length+1).includes("/"));
        if(params.key)docs=docs.filter(key=>values.get(key)?.[params.key]===params.target);
        if(params.sortKey)docs.sort((a,b)=>{
          const x=values.get(a)?.[params.sortKey]?.toMillis?.()||0;
          const y=values.get(b)?.[params.sortKey]?.toMillis?.()||0;
          return (params.direction==="desc"?y-x:x-y)||a.localeCompare(b);
        });
        if(after){const offset=docs.findIndex(p=>p.endsWith("/"+after));docs=offset<0?[]:docs.slice(offset+1);}
        docs=docs.slice(0,size);
        return {docs:docs.map(snap),size:docs.length,empty:!docs.length};
      }
    };
    return q;
  }
  function doc(path){
    return {
      path,id:path.split("/").at(-1),get:async()=>snap(path),
      collection(sub){return collection(path+"/"+sub);}
    };
  }
  return {
    values,reads,collection,doc,
    batch(){const ids=[];return {delete(ref){ids.push(ref.path);},commit:async()=>{ids.forEach(id=>values.delete(id));}};},
    runTransaction:async cb=>cb({
      get:async ref=>snap(ref.path),
      set:(ref,value,opts)=>values.set(ref.path,opts?.merge?{...values.get(ref.path),...value}:value),
      create:(ref,value)=>{assert.equal(values.has(ref.path),false);values.set(ref.path,value);}
    })
  };
}
function service(db){return createPlatformAccountDiagnostics({db,FieldValue:clock,Timestamp:{fromMillis:timestamp},now:()=>T});}
const event=(extras={})=>({
  eventId:EVENT,sessionId:SESSION,kind:"navigation",module:"studio",
  action:"page_open",state:"ok",route:"/student-playground.html",release:"v20261124",...extras
});

test("operational events reject user content, URL queries, tokens and arbitrary metadata",()=>{
  assert.equal(checkedEvent(event()).action,"page_open");
  for(const field of ["code","studentName","message","password","clipboard","stack","notificationBody"]){
    assert.throws(()=>checkedEvent(event({[field]:"secret"})),/only approved metadata/);
  }
  assert.throws(()=>checkedEvent(event({route:"/student-playground.html?token=secret"})),/parameters or personal information/);
  assert.throws(()=>checkedEvent(event({kind:"error",state:"error",action:"api_failed",errorCode:"secret@example.com"})),/error codes/);
  assert.throws(()=>checkedEvent(event({kind:"error",action:"api_failed",state:"ok"})),/must declare/);
});

test("severity categories distinguish normal observations, interruptions and failures",()=>{
  assert.equal(diagnosticSeverity({kind:"navigation",action:"page_open",state:"ok"}),"normal");
  assert.equal(diagnosticSeverity({kind:"action",action:"studio_run_requested",state:"info"}),"normal");
  assert.equal(diagnosticSeverity({kind:"system",action:"network_offline",state:"unavailable"}),"warning");
  assert.equal(diagnosticSeverity({kind:"action",action:"school_switched",state:"unavailable"}),"warning");
  assert.equal(diagnosticSeverity({kind:"error",action:"api_failed",state:"error"}),"failure");
  assert.equal(diagnosticSeverity({kind:"error",action:"resource_error",state:"unavailable"}),"failure");
  assert.equal(diagnosticSeverity({kind:"action",action:"cloud_save_failed",state:"error"}),"failure");
  assert.equal(diagnosticSeverity({kind:"action",action:"studio_run_completed",state:"ok"}),"normal");
});

test("Platform-only recent account activity is a bounded audited index of all observed logins",async()=>{
  const db=fakeDb(),api=service(db).service;
  await api(request(USER,{action:"record",event:event()}));
  await api(request("student002",{action:"record",event:event({
    eventId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    kind:"system",module:"other",action:"network_offline",state:"unavailable",route:""
  })}));
  await assert.rejects(api(request(USER,{action:"recent_accounts",reason:"Investigating recurring connectivity issues"})),/Platform Administrator/);
  await assert.rejects(api(request(ADMIN,{action:"recent_accounts",reason:"short"})),/12–300/);
  const result=await api(request(ADMIN,{action:"recent_accounts",reason:"Investigating recurring connectivity issues"}));
  assert.equal(result.accounts.length,2);
  assert.equal(result.scope,"account_activity_index");
  assert.equal(result.accounts.find(a=>a.ownerUid===USER).severity,"normal");
  assert.equal(result.accounts.find(a=>a.ownerUid==="student002").severity,"warning");
  assert.equal(result.accounts.find(a=>a.ownerUid==="student002").action,"network_offline");
  assert.equal(db.reads.length,1);
  assert.equal(db.reads[0].action,"platform_user_diagnostics_recent_viewed");
  assert.equal(JSON.stringify(result).includes("Investigating recurring"),false);
});

test("verified subject can append only own events, with idempotent retry and bounded expiry",async()=>{
  const db=fakeDb(),api=service(db).service;
  const payload={action:"record",event:event()};
  assert.deepEqual(await api(request(USER,payload)),{recorded:true,duplicate:false});
  assert.deepEqual(await api(request(USER,payload)),{recorded:true,duplicate:true});
  const saved=db.values.get("platform_account_diagnostics/"+USER+"/entries/"+EVENT);
  assert.equal(saved.ownerUid,USER);
  assert.equal(saved.expiresAt.toMillis(),T+RETENTION_DAYS*86400000);
  assert.equal(Object.hasOwn(saved,"code"),false);
  assert.equal(db.values.get("platform_account_diagnostics/"+USER+"/daily_quotas/2026-11-24").count,1);
  await assert.rejects(api({
    ...request(USER,payload),auth:{uid:USER,token:{email_verified:false}}
  }),/Sign in with a verified account/);
  await assert.rejects(api(request(USER,{action:"record",targetUid:ADMIN,event:event({
    eventId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",action:"notification_delivered",kind:"notification",module:"notifications"
  })})),/Server-confirmed outcomes cannot be submitted from the browser/);
});

test("only Platform Admin can view a specific login; access reason and reads are audited",async()=>{
  const db=fakeDb(),api=service(db).service;
  await api(request(USER,{action:"record",event:event()}));
  await assert.rejects(api(request(USER,{action:"list",targetUid:USER,reason:"Investigating support case"})),/Platform Administrator/);
  await assert.rejects(api(request(ADMIN,{action:"list",targetUid:USER,reason:"short"})),/12–300/);
  db.values.set("platform_audit/manual",{targetUid:USER,actorUid:ADMIN,
    action:"platform_login_disabled",createdAt:timestamp(T-2000)});
  const response=await api(request(ADMIN,{action:"list",targetUid:USER,reason:"Investigating support case #417"}));
  assert.equal(response.events.length,1);
  assert.equal(response.events[0].route,"/student-playground.html");
  assert.equal(response.events[0].severity,"normal");
  assert.equal(response.accountAudit.length,1);
  assert.equal(response.accountAudit[0].action,"platform_login_disabled");
  assert.equal(db.reads.length,1);
  assert.equal(db.reads[0].targetUid,USER);
  assert.equal(db.reads[0].action,"platform_user_diagnostics_viewed");
  const encoded=JSON.stringify(response);
  assert.equal(encoded.includes("Investigating support case"),false);
  assert.equal(encoded.includes(USER),true);
});

test("notification delivery audit is server generated, retry safe and contains no body",async()=>{
  const db=fakeDb(),collector=service(db);
  await collector.recordNotificationDelivered(USER,"notification_001");
  await collector.recordNotificationDelivered(USER,"notification_001");
  const keys=[...db.values.keys()].filter(key=>key.startsWith("platform_account_diagnostics/"+USER+"/entries/"));
  assert.equal(keys.length,1);
  const value=db.values.get(keys[0]);
  assert.equal(value.action,"notification_delivered");
  assert.equal(Object.hasOwn(value,"body"),false);
});

test("backend failure capture retains code and callable name, never request payloads",async()=>{
  const db=fakeDb(),collector=service(db);
  await collector.writeServerFailure(request(USER,{action:"sync",files:{Main:"private code"}}),{
    code:"failed-precondition",message:"private student answer"
  });
  const values=[...db.values.values()].filter(value=>value.action==="api_failed");
  assert.equal(values.length,1);
  assert.equal(values[0].errorCode,"failed-precondition");
  assert.equal(values[0].service,"schoolStudioProjects.sync");
  assert.equal(JSON.stringify(values[0]).includes("private student answer"),false);
  assert.equal(JSON.stringify(values[0]).includes("private code"),false);
});

test("bounded context accepts known controls and process snapshots only",async()=>{
  const ctx={control:"cloudSaveProjectBtn",visibility:"visible",network:"online",focus:"focused",ready:"complete",dialog:"none",busy:"busy",
    clientAt:T,active:[{name:"studio_cloud_save",id:SESSION,ageMs:300}],overflow:0};
  const e=event({kind:"action",action:"control_clicked",state:"info",context:ctx});
  assert.deepEqual(checkedEvent(e).context,ctx);
  for(const invalid of [{...ctx,control:"student-name"},{...ctx,network:"secret"},{...ctx,text:"private"},
    {...ctx,active:[{name:"studio_cloud_save",id:SESSION,ageMs:300,payload:"private"}]},
    {...ctx,active:Array(7).fill(ctx.active[0])},{...ctx,active:[ctx.active[0],ctx.active[0]]}]){
    assert.throws(()=>checkedEvent({...e,context:invalid}),/diagnostic|process/i);
  }
  const db=fakeDb(),api=service(db).service;
  await api(request(USER,{action:"record",event:e}));
  const response=await api(request(ADMIN,{action:"list",targetUid:USER,reason:"Investigating overlapping save operations"}));
  assert.deepEqual(response.events[0].context,ctx);
  await assert.rejects(api(request(USER,{action:"list",targetUid:USER,reason:"Investigating overlapping save operations"})),/Platform Administrator/);
});

test("fixed Studio callable lifecycle names are accepted; unknown processes are rejected",()=>{
 const e=event({kind:"action",action:"process_started",state:"info",operationId:SESSION,phase:"started",context:{process:"studio_api_submit",active:[{name:"studio_api_submit",id:SESSION,ageMs:0}]}});
 assert.equal(checkedEvent(e).context.process,"studio_api_submit");
 assert.throws(()=>checkedEvent({...e,context:{process:"arbitrary"}}),/Unknown diagnostic/);
});

test("Studio server policy denials preserve callable and exact reason without recording message",async()=>{
 const db=fakeDb(),collector=service(db);
 await collector.writeServerFailure(request(USER,{action:"sync"}),{code:"failed-precondition",diagnosticReason:"STUDIO_EXAM_CLOSED",message:"private text"},T,"schoolStudioProjects");
 const rows=[...db.values.values()].filter(row=>row.action==="api_failed");
 assert.equal(rows.length,1);assert.equal(rows[0].service,"schoolStudioProjects.sync");assert.equal(rows[0].severity,"warning");assert.equal(rows[0].context.reasonCode,"STUDIO_EXAM_CLOSED");assert.equal(JSON.stringify(rows[0]).includes("private text"),false);
 assert.throws(()=>checkedEvent(event({context:{reasonCode:"private reason"}})),/Invalid diagnostic context/);
 assert.equal(diagnosticSeverity({...rows[0],source:"browser"}),"failure");
});

test("callable correlation is bounded and never changes authenticated ownership",async()=>{
 const {clientCorrelation}=require("../functions/platform-account-diagnostics.js");
 const parent="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
 const diagnostic={sessionId:SESSION,operationId:EVENT,parentOperationId:parent};
 const req=request(USER,{action:"sync",_diagnostic:diagnostic});
 assert.deepEqual(clientCorrelation(req,"schoolStudioProjects"),diagnostic);
 assert.deepEqual(clientCorrelation(req,"otherService"),{});
 assert.deepEqual(clientCorrelation(request(USER,{action:"sync",_diagnostic:{...diagnostic,ownerUid:ADMIN}}),"schoolStudioProjects"),{});
 assert.deepEqual(clientCorrelation(request(USER,{action:"sync",_diagnostic:{...diagnostic,parentOperationId:EVENT}}),"schoolStudioProjects"),{});
 const db=fakeDb(),collector=service(db);
 await collector.writeServerFailure(req,{code:"failed-precondition",diagnosticReason:"STUDIO_EXAM_CLOSED"},T,"schoolStudioProjects");
 await collector.recordServerProcess(req,{service:"schoolStudioProjects",startedAt:T});
 const rows=[...db.values.values()].filter(row=>["api_failed","api_succeeded"].includes(row.action));
 assert.equal(rows.length,2);
 for(const row of rows){assert.equal(row.ownerUid,USER);assert.equal(row.operationId,EVENT);assert.equal(row.sessionId,SESSION);assert.equal(row.context.parentOperationId,parent);}
});

test("save stages and prolonged observations are bounded and cannot claim completion",()=>{
 const e=event({kind:"action",action:"process_progress",state:"info",operationId:EVENT,phase:"observed",context:{process:"studio_cloud_save",saveStage:"school_sync",elapsedMs:20,retryAttempt:1,waitingRequests:2}});
 assert.deepEqual(checkedEvent(e).context,e.context);
 for(const context of [{...e.context,saveStage:"private"},{...e.context,retryAttempt:5},{...e.context,waitingRequests:101}])assert.throws(()=>checkedEvent({...e,context}),/diagnostic/i);
 const slow={...e,kind:"system",action:"process_prolonged",state:"unavailable",context:{...e.context,elapsedMs:60000}};
 assert.equal(diagnosticSeverity(checkedEvent(slow)),"warning");
 assert.throws(()=>checkedEvent({...slow,context:{...slow.context,elapsedMs:59999}}),/prolonged/);
 assert.throws(()=>checkedEvent({...slow,state:"ok"}),/prolonged/);
});

test("backend transaction metrics cannot be forged by browser events or request payloads",async()=>{
 const metrics={transactionAttempts:2,transactionMs:125,transactionOutcome:"returned"};
 assert.throws(()=>checkedEvent(event({context:metrics})),/Backend transaction/);
 const db=fakeDb(),collector=service(db);
 await collector.recordServerProcess(request(USER,{action:"sync",...metrics}),{service:"schoolStudioProjects",startedAt:T});
 await collector.recordServerProcess(request(USER,{action:"sync"}),{service:"schoolStudioProjects",startedAt:T,transactionObservation:metrics});
 const rows=[...db.values.values()].filter(row=>row.action==="api_succeeded");
 assert.equal(rows.length,2);
 assert.equal(rows.filter(row=>row.context?.transactionAttempts===2).length,1);
 assert.deepEqual(rows.find(row=>row.context?.transactionAttempts===2).context,metrics);
});
test("peer marker observations are bounded, client-only and cannot assert success",()=>{
 const peer=event({kind:"system",module:"studio",action:"studio_peer_marker_changed",state:"unavailable",phase:"observed",context:{peerMarker:"pending",localSaveState:"writing",pageInstanceId:SESSION}});
 assert.equal(diagnosticSeverity(checkedEvent(peer)),"warning");
 assert.throws(()=>checkedEvent({...peer,state:"ok"}),/peer marker/);
 assert.throws(()=>checkedEvent({...peer,context:{...peer.context,peerMarker:"private"}}),/diagnostic/);
 assert.throws(()=>checkedEvent({...peer,context:{...peer.context,pageInstanceId:"project-name"}}),/diagnostic/);
});

test("academic correlation is allowed only for fixed write actions, never for grade reads",()=>{
 const {clientCorrelation}=require("../functions/platform-account-diagnostics.js");
 const diagnostic={sessionId:SESSION,operationId:EVENT};
 for(const [service,action,process,module] of [
  ["schoolAssessmentSubmissions","submit","assessment_response_submit","assessments"],
  ["schoolGradebook","correct_published","gradebook_correct","grades"],
  ["schoolClassRecord","finalize_period","class_record_finalize","grades"],
  ["schoolClassRecordAdmin","approve_legacy_custody","class_record_custody_approve","grades"]]){
   assert.deepEqual(clientCorrelation(request(USER,{action,_diagnostic:diagnostic}),service),diagnostic);
   assert.equal(checkedEvent(event({module,kind:"action",action:"process_started",state:"info",operationId:EVENT,phase:"started",context:{process}})).context.process,process);
 }
 for(const [service,action] of [["schoolGradebook","my_published"],["schoolClassRecord","workspace"],["schoolClassRecordAdmin","overview"],["schoolAssessmentSubmissions","get_draft"]]){
   assert.deepEqual(clientCorrelation(request(USER,{action,_diagnostic:diagnostic}),service),{});
 }
});
test("academic callable adapter preserves payload and response, never passes private data into telemetry",async()=>{
 const {observedAcademicCallable}=await import("../js/core/academic-callable-diagnostics.mjs");
 const original=globalThis.AdminervaDiagnostic,calls=[],events=[],diagnostic={sessionId:SESSION,operationId:EVENT};
 try{
   globalThis.AdminervaDiagnostic={beginProcess(name){events.push(name);const finish=(...args)=>events.push(args);finish.correlation=diagnostic;return finish;}};
   const input={schoolId:"school",action:"save_draft",scores:[12],feedback:"private"};
   const response={data:{revision:3}};
   const call=observedAcademicCallable("schoolGradebook",async payload=>{calls.push(payload);return response;});
   assert.equal(await call(input),response);assert.deepEqual(calls[0],{...input,_diagnostic:diagnostic});
   assert.equal(Object.hasOwn(input,"_diagnostic"),false);
   assert.deepEqual(events,["gradebook_draft_save",[true,"unknown"]]);
   const read={action:"get_draft"};await call(read);assert.equal(calls[1],read);assert.equal(events.length,2);
   const failure=Object.assign(Error("private student answer"),{code:"functions/failed-precondition"});
   await assert.rejects(observedAcademicCallable("schoolGradebook",async()=>{throw failure;})(input),error=>error===failure);
   assert.deepEqual(events.at(-1),[false,"failed-precondition"]);
   assert.doesNotMatch(JSON.stringify(events),/private|scores|feedback/);
   globalThis.AdminervaDiagnostic={beginProcess(){throw Error("telemetry");}};
   assert.equal(await call(input),response);assert.equal(calls.at(-1),input);
 }finally{if(original===undefined)delete globalThis.AdminervaDiagnostic;else globalThis.AdminervaDiagnostic=original;}
});

test("browser collection defaults on but account opt-out blocks new browser events and preserves necessary backend outcomes",async()=>{
 const db=fakeDb(),collector=service(db),api=collector.service,ref="platform_account_diagnostics/"+USER;
 assert.deepEqual(await api(request(USER,{action:"privacy_status"})),{browserEnabled:true});
 assert.equal(await api(request(USER,{action:"record",event:event()})).then(r=>r.recorded),true);
 const previous=db.values.get(ref);
 assert.deepEqual(await api(request(USER,{action:"set_browser_collection",enabled:false})),{browserEnabled:false});
 assert.equal(db.values.get(ref).lastAction,previous.lastAction);
 assert.deepEqual(await api(request(USER,{action:"record",event:event({eventId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc"})})),{recorded:false,disabled:true});
 assert.equal(db.values.has(ref+"/entries/cccccccc-cccc-4ccc-8ccc-cccccccccccc"),false);
 await collector.recordServerProcess(request(USER,{action:"sync",_diagnostic:{sessionId:SESSION,operationId:EVENT}}),{service:"schoolStudioProjects",startedAt:T});
 const row=[...db.values.values()].find(x=>x.action==="api_succeeded");
 assert.ok(row);assert.equal(row.operationId,undefined);assert.equal(db.values.get(ref).browserCollectionEnabled,false);
 assert.deepEqual(await api(request(ADMIN,{action:"privacy_status"})),{browserEnabled:true});
 await assert.rejects(api(request(ADMIN,{action:"set_browser_collection",enabled:true,targetUid:USER})),/own browser diagnostics/);
 await assert.rejects(api({data:{action:"privacy_status"}}),/verified account/);
 assert.equal((await api(request(USER,{action:"privacy_status"}))).browserEnabled,false);
 assert.deepEqual(await api(request(USER,{action:"set_browser_collection",enabled:true})),{browserEnabled:true});
});
