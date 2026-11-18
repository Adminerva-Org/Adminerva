import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createPlatformOperationsService}=require("../functions/platform-operations.js");
const {asPolicy,validateFeatureInput,featureEnabled}=require("../functions/platform-operations-model.js");
const {stateFromIndicator,vendorProbe}=require("../functions/platform-operations-monitor.js");

function fixture(){
  const records=new Map(),uid="owner";
  let sequence=0;
  const clock=()=>1763424000000;
  records.set("platform_admins/"+uid,{status:"active",role:"platform_admin"});
  records.set("platform_schools/other-school",{
    displayName:"Example Institution",state:"active",revision:3,
    provisioningMode:"standard",compatibilityMode:"v4_only"
  });
  records.set("platform_audit/audit-1",{action:"school_created",schoolId:"other-school",
    actorUid:"PRIVATE-UID",reason:"PRIVATE-REASON",createdAt:clock()});
  records.set("schools/other-school/support_reports/report-1",{
    status:"Open",priority:"Critical",reporterUid:"PRIVATE-STUDENT",description:"PRIVATE REPORT CONTENT"
  });
  records.set("schools/other-school/support_reports/report-2",{
    status:"Resolved",priority:"Normal",reporterUid:"PRIVATE-STUDENT"
  });
  records.set("monitoring_control/runtime",{cleanupEnabled:false,summaryRefreshEnabled:false});
  records.set("push_devices/device-1",{ownerUid:uid,enabled:true,token:"TOKEN-THAT-IS-LONG-ENOUGH-FOR-READINESS"});
  records.set("schools/other-school/private_config/ai",{
    schoolId:"other-school",enabled:true,apiKey:"PRIVATE-SCHOOL-AI-KEY",
    model:"gemini-test-model",dailyLimit:100,maxConcurrent:6,updatedAt:clock()
  });
  function snapshot(path){
    const data=records.get(path);
    return {id:path.split("/").at(-1),exists:data!==undefined,data:()=>data,
      ref:doc(path)};
  }
  function doc(path){
    return {path,id:path.split("/").at(-1),get:async()=>snapshot(path),
      create:async data=>{if(records.has(path))throw Error("already exists");records.set(path,data);},
      set:async data=>{records.set(path,data);},
      update:async data=>{records.set(path,{...records.get(path),...data});}};
  }
  class Query{
    constructor(path,filters=[],limit=null,sort=null){
      this.path=path;this.filters=filters;this.max=limit;this.sort=sort;
    }
    where(field,operation,value){assert.equal(operation,"==");
      return new Query(this.path,[...this.filters,[field,value]],this.max,this.sort);}
    limit(n){return new Query(this.path,this.filters,n,this.sort);}
    orderBy(field,direction="asc"){return new Query(this.path,this.filters,this.max,[field,direction]);}
    async get(){
      let rows=[...records.keys()].filter(key=>key.startsWith(this.path+"/")&&
        !key.slice(this.path.length+1).includes("/")).map(snapshot);
      for(const [field,value]of this.filters)rows=rows.filter(x=>x.data()?.[field]===value);
      if(this.sort)rows.sort((a,b)=>{
        const [field,direction]=this.sort,v1=a.data()?.[field],v2=b.data()?.[field];
        const n=typeof v1==="string"?String(v1).localeCompare(String(v2)):((v1||0)-(v2||0));
        return direction==="desc"?-n:n;
      });
      if(this.max!=null)rows=rows.slice(0,this.max);
      return {docs:rows,size:rows.length,empty:rows.length===0};
    }
    count(){return {get:async()=>{const rows=await this.get();return {data:()=>({count:rows.size})};}};}
    doc(id){return doc(this.path+"/"+(id||"generated"+(++sequence)));}
  }
  const database={
    doc,collection:path=>new Query(path),batch:()=>{const writes=[];return{
      create:(ref,data)=>writes.push(()=>ref.create(data)),
      commit:async()=>{for(const write of writes)await write();}
    };},
    runTransaction:async fn=>{
      const writes=[];
      const tx={
        get:ref=>ref.get(),
        create:(ref,data)=>writes.push(()=>ref.create(data)),
        update:(ref,data)=>writes.push(()=>ref.update(data)),
        set:(ref,data)=>writes.push(()=>ref.set(data))
      };
      const result=await fn(tx);for(const write of writes)await write();return result;
    }
  };
  const requests=[];
  const fetcher=async(url,options={})=>{
    requests.push({url:String(url),options});
    if(String(url).includes("status.cloud.google.com"))
      return {ok:true,status:200,json:async()=>[]};
    return {ok:true,status:200,json:async()=>({status:{indicator:"none"}})};
  };
  const service=createPlatformOperationsService({
    db:database,auth:{listUsers:async()=>({users:[]})},fetcher,now:clock
  });
  return {database,records,service,requests};
}
function req(uid,action,fields={}){
  return {auth:{uid,token:{email_verified:true,email:"example@example.com"}},data:{action,...fields}};
}

test("only server-verified platform administrators can query operational data",async()=>{
  const {service}=fixture();
  await assert.rejects(()=>service(req("student","overview")),
    error=>error.code==="permission-denied");
  await assert.rejects(()=>service({data:{action:"overview"}}),
    error=>error.code==="unauthenticated");
});

test("overview includes actual counts, no student or actor details",async()=>{
  const {service}=fixture();
  const result=await service(req("owner","overview"));
  assert.equal(result.counts.total,1);
  assert.equal(result.counts.active,1);
  assert.equal(result.features.length,3);
  assert.equal(result.observations.notificationDelivery,"not_monitored");
  assert.equal(result.push.active,1);
  assert.equal(result.events[0].action,"school_created");
  assert.equal(JSON.stringify(result).includes("PRIVATE"),false);
});

test("selected school and fleet expose bounded aggregate support fields only",async()=>{
  const {service}=fixture();
  const row=await service(req("owner","school",{schoolId:"other-school"}));
  assert.deepEqual(row.support,{total:2,open:1,resolved:1,closed:0,critical:1});
  assert.equal(row.ai.configured,true);
  assert.equal(row.ai.model,"gemini-test-model");
  assert.equal(JSON.stringify(row).includes("PRIVATE-SCHOOL-AI-KEY"),false);
  const fleet=await service(req("owner","fleet_support",{offset:0}));
  assert.equal(fleet.rows.length,1);
  assert.equal(fleet.rows[0].support.critical,1);
  assert.equal(JSON.stringify(fleet).includes("PRIVATE"),false);
});

test("school AI diagnostic is fixed, rate-limited and never returns credentials",async()=>{
  const {service,records,requests}=fixture();
  const result=await service(req("owner","test_school_ai",{schoolId:"other-school"}));
  assert.equal(result.state,"healthy");
  assert.equal(result.kind,"accepted");
  assert.equal(JSON.stringify(result).includes("PRIVATE-SCHOOL-AI-KEY"),false);
  const request=requests.find(item=>item.url.includes("generativelanguage.googleapis.com"));
  assert.ok(request);
  assert.equal(JSON.parse(request.options.body).contents[0].parts[0].text,"Return only OK.");
  const saved=records.get("platform_operations_service_state/school_ai_other-school");
  assert.equal(saved.lastState,"healthy");
  assert.equal(JSON.stringify(saved).includes("PRIVATE-SCHOOL-AI-KEY"),false);
  await assert.rejects(()=>service(req("owner","test_school_ai",{schoolId:"other-school"})),
    error=>error.code==="resource-exhausted");
});

test("Google public incident feed is broad context rather than school credential health",async()=>{
  const now=()=>1763424000000;
  const healthy=await vendorProbe("google_cloud_status",async()=>({
    ok:true,status:200,json:async()=>[{end:"2024-01-01T00:00:00Z",severity:"medium"}]
  }),now);
  assert.equal(healthy.state,"healthy");
  const degraded=await vendorProbe("google_cloud_status",async()=>({
    ok:true,status:200,json:async()=>[{end:null,severity:"medium",status_impact:"SERVICE_DISRUPTION"}]
  }),now);
  assert.equal(degraded.state,"degraded");
  assert.match(degraded.note,/does not verify/i);
});

test("incident actions require revision, enforce transitions and retain server audit",async()=>{
  const {service,records}=fixture();
  const created=await service(req("owner","create_incident",{
    title:"Authentication outage",description:"Sign in attempts are failing for staff.",
    severity:"high",serviceId:"firebase_auth"
  }));
  const id=created.incident.id;
  const changed=await service(req("owner","change_incident",{
    incidentId:id,revision:1,transition:"acknowledge",
    note:"Reviewed the repeated operational failures."
  }));
  assert.equal(changed.incident.status,"acknowledged");
  await assert.rejects(()=>service(req("owner","change_incident",{
    incidentId:id,revision:1,transition:"resolve",
    note:"Resolved after verification completed."
  })),error=>error.code==="failed-precondition");
  assert.equal(records.get("platform_operations_incidents/"+id).revision,2);
});

test("policy and rollouts reject stale revisions and unknown schools",async()=>{
  const {service}=fixture(),settings=asPolicy(null);
  const saved=await service(req("owner","save_policy",{
    revision:0,reason:"Enable controlled status monitoring only.",
    policy:{...settings,automatedChecks:false,automaticIncidents:false,dailyDigest:false}
  }));
  assert.equal(saved.policy.revision,1);
  await assert.rejects(()=>service(req("owner","save_policy",{
    revision:0,reason:"Reapply stale configuration values.",
    policy:{...settings,automatedChecks:true}
  })),error=>error.code==="failed-precondition");
  await assert.rejects(()=>service(req("owner","save_feature",{
    featureId:"fleet_support",revision:0,mode:"pilot",schoolIds:["not-registered"],
    reason:"Restrict fleet observation to chosen schools."
  })),error=>error.code==="not-found");
  const enabled=await service(req("owner","save_feature",{
    featureId:"fleet_support",revision:0,mode:"pilot",schoolIds:["other-school"],
    reason:"Limit fleet support observation for the pilot."
  }));
  assert.equal(enabled.feature.mode,"pilot");
  assert.equal(featureEnabled(enabled.feature,"other-school"),true);
  assert.equal(featureEnabled(enabled.feature,"unknown-school"),false);
});

test("public vendor status checks never certify individual OAuth or delivery",()=>{
  assert.equal(stateFromIndicator("none"),"healthy");
  assert.equal(stateFromIndicator("minor"),"degraded");
  assert.equal(stateFromIndicator("critical"),"unavailable");
  assert.throws(()=>validateFeatureInput({featureId:"unknown",mode:"all"}),{code:"invalid-argument"});
});
