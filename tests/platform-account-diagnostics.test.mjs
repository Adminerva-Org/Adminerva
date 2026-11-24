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
  })})),/server, not the browser/);
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
