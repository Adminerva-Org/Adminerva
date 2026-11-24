import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
const require=createRequire(import.meta.url);
const {checkedEvent,createPlatformAccountDiagnostics}=require("../functions/platform-account-diagnostics.js");

const NOW=Date.UTC(2026,10,24,12),ADMIN="platform-owner",ACCOUNT_A="user-a",ACCOUNT_B="user-b";
const stamp=ms=>({toMillis:()=>ms});
const FieldValue={serverTimestamp:()=>stamp(NOW)};
const Timestamp={fromMillis:stamp};
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const request=(uid,body)=>({
  auth:{uid,token:{email_verified:true}},
  data:body,
  rawRequest:{path:"/schoolStudioProjects",headers:{"x-cloud-trace-context":"a".repeat(32)+"/1;o=1"}}
});
const normal=(n)=>({eventId:id(n),sessionId:id(1000),kind:"navigation",
  module:"studio",action:"page_open",state:"ok",route:"/student-playground.html"});
const error=(n)=>({eventId:id(n),sessionId:id(1000),kind:"error",
  module:"studio",action:"cloud_save_failed",state:"error",errorCode:"unavailable",
  route:"/student-playground.html"});
const offline=n=>({eventId:id(n),sessionId:id(1000),kind:"system",
  module:"other",action:"network_offline",state:"unavailable",route:""});

function mockDb(){
  const values=new Map([["platform_admins/"+ADMIN,{role:"platform_admin",status:"active"}]]);
  const audit=[];
  function collection(path){
    const parts=path.split("/");
    return {
      id:parts.at(-1),path,
      parent:parts.length>1?doc(parts.slice(0,-1).join("/")):null,
      doc:key=>doc(path+"/"+key),where:(...args)=>query(path,false).where(...args),
      orderBy:(...args)=>query(path,false).orderBy(...args),
      add:async data=>{const key="audit_"+audit.length;values.set(path+"/"+key,data);audit.push(data);return doc(path+"/"+key);}
    };
  }
  function doc(path){
    const parts=path.split("/");
    return {
      id:parts.at(-1),path,
      parent:parts.length>1?collection(parts.slice(0,-1).join("/")):null,
      collection:sub=>collection(path+"/"+sub),
      get:async()=>snapshot(path)
    };
  }
  function snapshot(path){return {exists:values.has(path),id:path.split("/").at(-1),ref:doc(path),data:()=>values.get(path)};}
  function millis(value){return typeof value?.toMillis==="function"?value.toMillis():value;}
  function query(path,group){
    const filters=[];let sort="createdAt",desc=true,size=500,afterPath="";
    const q={
      where(key,op,target){filters.push([key,op,target]);return q;},
      orderBy(key,direction="asc"){sort=key;desc=direction==="desc";return q;},
      limit(value){size=value;return q;},
      startAfter(last){afterPath=last.ref.path;return q;},
      async get(){
        let keys=[...values.keys()].filter(key=>group?
          key.split("/").length>=4&&key.split("/").at(-2)===path:
          key.startsWith(path+"/")&&key.slice(path.length+1).split("/").length===1);
        keys=keys.filter(key=>filters.every(([field,op,expected])=>{
          const actual=values.get(key)?.[field];
          if(op==="==")return actual===expected;
          if(op===">=")return millis(actual)>=millis(expected);
          throw Error("Unsupported fake DB query filter "+op);
        }));
        keys.sort((a,b)=>{
          const aValue=millis(values.get(a)?.[sort]),bValue=millis(values.get(b)?.[sort]);
          const primary=aValue===bValue?0:(aValue>bValue?1:-1)*(desc?-1:1);
          return primary||a.localeCompare(b);
        });
        if(afterPath){const i=keys.indexOf(afterPath);keys=i<0?[]:keys.slice(i+1);}
        const docs=keys.slice(0,size).map(snapshot);
        return {docs,size:docs.length,empty:docs.length===0};
      }
    };
    return q;
  }
  return {
    values,audit,collection,doc,
    collectionGroup:key=>query(key,true),
    runTransaction:async callback=>callback({
      get:async ref=>snapshot(ref.path),
      create:(ref,data)=>{assert.ok(!values.has(ref.path));values.set(ref.path,data);},
      set:(ref,data,{merge=false}={})=>values.set(ref.path,merge?{...values.get(ref.path),...data}:data)
    }),
    batch(){const deleting=[];return {delete:ref=>deleting.push(ref.path),
      commit:async()=>deleting.forEach(key=>values.delete(key))};}
  };
}
function create(){const db=mockDb();return {db,api:createPlatformAccountDiagnostics({db,FieldValue,Timestamp,now:()=>NOW})};}

test("all-user feed merges every newly indexed browser event chronologically and audits the read",async()=>{
  const {db,api}=create();
  await api.service(request(ACCOUNT_A,{action:"record",event:normal(1)}));
  await api.service(request(ACCOUNT_B,{action:"record",event:offline(2)}));
  await api.service(request(ACCOUNT_A,{action:"record",event:error(3)}));
  // Deliberately seed an unrelated entries collection with similar-looking data.
  db.values.set("other_tenant/school/entries/"+id(4),{
    ownerUid:ACCOUNT_B,diagnosticScope:"platform_account_diagnostic",
    createdAt:stamp(NOW),kind:"error",state:"error",action:"api_failed"
  });
  await assert.rejects(api.service(request(ACCOUNT_A,{action:"global_feed",reason:"Investigating school-wide save failure"})),/Platform Administrator/);
  await assert.rejects(api.service(request(ADMIN,{action:"global_feed",reason:"short"})),/12–300/);
  const result=await api.service(request(ADMIN,{action:"global_feed",reason:"Investigating school-wide save failure",limit:10}));
  assert.equal(result.scope,"all_recorded_account_events");
  assert.equal(result.events.length,3); // The other tenant's entry is never exposed.
  assert.deepEqual(new Set(result.events.map(e=>e.ownerUid)),new Set([ACCOUNT_A,ACCOUNT_B]));
  assert.deepEqual(new Set(result.events.map(e=>e.severity)),new Set(["normal","warning","failure"]));
  assert.equal(db.audit.at(-1).action,"platform_user_diagnostics_global_viewed");
  assert.equal(JSON.stringify(result).includes("Investigating school-wide"),false);
});

test("server-side global filters and cursors retain account isolation and explicit scope",async()=>{
  const {api}=create();
  await api.service(request(ACCOUNT_A,{action:"record",event:error(11)}));
  await api.service(request(ACCOUNT_B,{action:"record",event:error(12)}));
  await api.service(request(ACCOUNT_A,{action:"record",event:normal(13)}));
  const investigation="Investigating repeated cross-account save failures";
  const first=await api.service(request(ADMIN,{
    action:"global_feed",reason:investigation,limit:1,severity:"failure",module:"studio"
  }));
  assert.equal(first.events.length,1);
  assert.equal(first.events[0].severity,"failure");
  assert.equal(first.hasMore,true);
  assert.match(first.cursor,/^platform_account_diagnostics\/[^/]+\/entries\/[a-f0-9-]{36}$/);
  const second=await api.service(request(ADMIN,{
    action:"global_feed",reason:investigation,limit:1,severity:"failure",module:"studio",cursor:first.cursor
  }));
  assert.equal(second.events.length,1);
  assert.notEqual(second.events[0].id,first.events[0].id);
  assert.equal(second.hasMore,false);
  await assert.rejects(api.service(request(ADMIN,{
    action:"global_feed",reason:investigation,cursor:"unrelated/private/cursor"
  })),/cursor is invalid/);
  const pattern=first.events[0].fingerprint;
  const match=await api.service(request(ADMIN,{
    action:"global_feed",reason:investigation,fingerprint:pattern
  }));
  assert.equal(match.events.length,2);
  assert.equal(match.events.every(e=>e.fingerprint===pattern),true);
  await assert.rejects(api.service(request(ADMIN,{
    action:"global_feed",reason:investigation,fingerprint:pattern,severity:"failure"
  })),/cannot be combined/);
});

test("cross-account impact highlights same error signature and names sample limits",async()=>{
  const {db,api}=create();
  await api.service(request(ACCOUNT_A,{action:"record",event:error(21)}));
  await api.service(request(ACCOUNT_B,{action:"record",event:error(22)}));
  await api.service(request(ACCOUNT_B,{action:"record",event:offline(23)}));
  const body={action:"global_impact",reason:"Investigating cross-account Studio error reports"};
  await assert.rejects(api.service(request(ACCOUNT_A,body)),/Platform Administrator/);
  const result=await api.service(request(ADMIN,body));
  assert.equal(result.scope,"bounded_global_sample");
  assert.equal(result.eventsSampled,3);
  assert.equal(result.observedAccounts,2);
  assert.equal(result.severityCounts.failure,2);
  assert.equal(result.severityCounts.warning,1);
  assert.equal(result.clusters[0].observedAccounts,2);
  assert.equal(result.clusters[0].observedEvents,2);
  assert.ok(result.clusters[0].key.length>=20);
  assert.equal(db.audit.at(-1).action,"platform_user_diagnostics_impact_viewed");
});

test("selected canonical backend mutations log sanitized server processes and Cloud trace IDs",async()=>{
  const {db,api}=create();
  const req=request(ACCOUNT_A,{action:"save",files:{secret:"private code"},email:"not stored"});
  await api.recordServerProcess(req,{service:"schoolStudioProjects",startedAt:NOW-140});
  await api.writeServerFailure(req,{code:"unavailable",message:"private transcript"},NOW-200);
  const saved=[...db.values.values()].filter(x=>x.ownerUid===ACCOUNT_A&&x.eventId);
  assert.equal(saved.length,2);
  const success=saved.find(x=>x.action==="api_succeeded");
  const failure=saved.find(x=>x.action==="api_failed");
  assert.equal(success.service,"schoolStudioProjects.save");
  assert.equal(success.durationMs,140);
  assert.equal(success.traceId,"a".repeat(32));
  assert.equal(success.phase,"completed");
  assert.equal(failure.durationMs,200);
  assert.equal(failure.traceId,"a".repeat(32));
  assert.equal(failure.phase,"failed");
  assert.equal(JSON.stringify(saved).includes("private code"),false);
  assert.equal(JSON.stringify(saved).includes("private transcript"),false);
});


test("client environment remains coarse, allowlisted and independent of raw user agents",()=>{
  const details={deviceClass:"phone",browserFamily:"safari",osFamily:"ios",viewport:"sm"};
  const clean=checkedEvent({...normal(40),...details});
  assert.equal(clean.osFamily,"ios");
  assert.equal(clean.deviceClass,"phone");
  for(const [key,value] of [
    ["userAgent","Mozilla/5.0 private string"],["screenHeight",834],
    ["browserFamily","Safari 17.5 user agent"],["osFamily","iOS-16.1"],
    ["viewport","1170x2532"],["deviceClass","iPhone 13 Pro"]
  ]){
    assert.throws(()=>checkedEvent({...normal(41),[key]:value}),/only approved metadata|environment category/);
  }
  const code=readFileSync(new URL("../js/core/platform-account-diagnostics.mjs",import.meta.url),"utf8");
  assert.match(code,/const MAX_DELAYED_EVENTS=20/);
  assert.match(code,/if\(navigator\.onLine===false\)\{queueDelayed\(event\);return;\}/);
  assert.match(code,/function environment\(\)/);
  assert.match(code,/return \{osFamily,browserFamily,deviceClass,viewport\}/);
  assert.doesNotMatch(code,/userAgent:ua|userAgent,|localStorage\.setItem/);
});

test("normal activity quota leaves bounded diagnostic room for genuine failures",async()=>{
  const {db,api}=create();
  const quota="platform_account_diagnostics/"+ACCOUNT_A+"/daily_quotas/2026-11-24";
  db.values.set(quota,{count:240,normalCount:240});
  await assert.rejects(
    api.service(request(ACCOUNT_A,{action:"record",event:normal(50)})),
    /reserved for warnings and errors/
  );
  assert.deepEqual(await api.service(request(ACCOUNT_A,{action:"record",event:error(51)})),
    {recorded:true,duplicate:false});
  const count=db.values.get(quota);
  assert.equal(count.count,241);
  assert.equal(count.normalCount,240);
});


test("Platform Admin live tail is chronological, incrementally cursor-paged and audit-window bounded",async()=>{
  const {db,api}=create(),reason="Investigating save and assessment events across active users";
  await api.service(request(ACCOUNT_A,{action:"record",event:normal(101)}));
  await api.service(request(ACCOUNT_B,{action:"record",event:offline(102)}));
  db.values.get("platform_account_diagnostics/"+ACCOUNT_A+"/entries/"+id(101)).createdAt=stamp(NOW-20000);
  db.values.get("platform_account_diagnostics/"+ACCOUNT_B+"/entries/"+id(102)).createdAt=stamp(NOW-10000);
  const start=await api.service(request(ADMIN,{action:"global_live",reason,limit:10}));
  assert.equal(start.scope,"live_indexed_account_events");
  assert.equal(start.initial,true);
  assert.equal(start.pollAfterMs,3000);
  assert.equal(start.events.length,2);
  assert.equal(start.events[0].id,id(101));
  assert.equal(start.events[1].id,id(102));
  assert.match(start.cursor,/^platform_account_diagnostics\/user-b\/entries\//);
  await assert.rejects(api.service(request(ACCOUNT_A,{action:"global_live",reason})),/Platform Administrator/);
  await assert.rejects(api.service(request(ADMIN,{action:"global_live",reason:"short"})),/12–300/);
  await api.service(request(ACCOUNT_A,{action:"record",event:error(103)}));
  await api.service(request(ACCOUNT_B,{action:"record",event:normal(104)}));
  const first=await api.service(request(ADMIN,{action:"global_live",reason,cursor:start.cursor,limit:1}));
  assert.equal(first.initial,false);
  assert.equal(first.events.length,1);
  assert.equal(first.hasMore,true);
  assert.equal(first.events[0].severity,"failure");
  const second=await api.service(request(ADMIN,{action:"global_live",reason,cursor:first.cursor,limit:1}));
  assert.equal(second.events.length,1);
  assert.equal(second.hasMore,false);
  assert.equal(second.events[0].ownerUid,ACCOUNT_B);
  assert.notEqual(second.events[0].id,first.events[0].id);
  const idle=await api.service(request(ADMIN,{action:"global_live",reason,cursor:second.cursor,limit:10}));
  assert.equal(idle.events.length,0);
  assert.equal(idle.cursor,second.cursor);
  const audits=db.audit.filter(a=>a.action==="platform_user_diagnostics_live_viewed");
  assert.equal(audits.length,0); // Deterministic live-audit documents are not add() records.
  const watchAudit=[...db.values.entries()].filter(([key])=>key.startsWith("platform_audit/diagnostic_live_"));
  assert.equal(watchAudit.length,1);
  assert.equal(watchAudit[0][1].reason,reason);
  assert.equal(watchAudit[0][1].windowMinutes,10);
  await assert.rejects(api.service(request(ADMIN,{
    action:"global_live",reason,cursor:"other_school/user/entries/"+id(101)
  })),/cursor/);
});
