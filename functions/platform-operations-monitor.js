"use strict";
/** Cost-bounded, independently gated platform monitoring. No school data mutations. */
const {createHash}=require("node:crypto");
const {asPolicy,SERVICE_CATALOG,configuredFeature,featureEnabled,sampleSummary,timestamp}=require("./platform-operations-model.js");
const {createPlatformObservability}=require("./platform-observability.js");
const ENDPOINTS=Object.freeze({
  github_status:"https://www.githubstatus.com/api/v2/status.json",
  google_cloud_status:"https://status.cloud.google.com/incidents.json",
  cloudflare_status:"https://www.cloudflarestatus.com/api/v2/status.json"
});
const MAX_PROBE_DURATION=4000;
const LEASE_MS=90000;
const DAY_MS=86400000;
function timeoutSignal(ms){return typeof AbortSignal!=="undefined"&&typeof AbortSignal.timeout==="function"?AbortSignal.timeout(ms):undefined;}
function stateFromIndicator(value){
  if(value==="none")return "healthy";
  if(value==="minor"||value==="maintenance")return "degraded";
  if(value==="major"||value==="critical")return "unavailable";
  return "degraded";
}
async function vendorProbe(id,fetcher,now){
  const start=now();
  try{
    const response=await fetcher(ENDPOINTS[id],{
      headers:{accept:"application/json"},signal:timeoutSignal(MAX_PROBE_DURATION)
    });
    if(!response.ok)return {id,state:"unavailable",latencyMs:now()-start,source:"public_status",note:"Public status endpoint did not respond successfully."};
    const body=await response.json();
    if(id==="google_cloud_status"){
      const incidents=Array.isArray(body)?body:[];
      const active=incidents.filter(item=>{
        const end=Date.parse(item?.end||"");
        return !item?.end||!Number.isFinite(end)||end>now();
      });
      const unavailable=active.some(item=>item?.status_impact==="SERVICE_OUTAGE"||item?.severity==="high");
      return {id,state:active.length?(unavailable?"unavailable":"degraded"):"healthy",
        latencyMs:now()-start,source:"public_status",
        note:active.length?
          active.length+" active Google Cloud public incident"+(active.length===1?"":"s")+"; this does not verify the school Gemini key.":
          "No active incident in the Google Cloud public incident feed; school Gemini credentials are checked separately."};
    }
    const indicator=body?.status?.indicator;
    return {id,state:stateFromIndicator(indicator),latencyMs:now()-start,
      source:"public_status",note:"Vendor-wide status only; individual Adminerva credentials are not checked."};
  }catch{
    return {id,state:"unavailable",latencyMs:now()-start,source:"public_status",
      note:"Public status probe failed; this does not prove the Adminerva integration is down."};
  }
}
async function probeServices({db,auth,fetcher=fetch,now=Date.now}){
  const probes=await Promise.all([
    (async()=>{
      const start=now();
      try{await db.doc("platform_operations/control").get();
        return {id:"firestore",state:"healthy",latencyMs:now()-start,source:"internal_read",note:"A single platform Firestore read succeeded."};
      }catch{return {id:"firestore",state:"unavailable",latencyMs:now()-start,source:"internal_read",note:"Platform Firestore read failed."};}
    })(),
    (async()=>{
      const start=now();
      try{await auth.listUsers(1);
        return {id:"firebase_auth",state:"healthy",latencyMs:now()-start,source:"admin_sdk",
          note:"Admin SDK identity list request succeeded; browser login is not probed."};
      }catch{return {id:"firebase_auth",state:"unavailable",latencyMs:now()-start,source:"admin_sdk",
        note:"Identity service request failed or lacks permission."};}
    })(),
    ...Object.keys(ENDPOINTS).map(id=>vendorProbe(id,fetcher,now))
  ]);
  for(const service of SERVICE_CATALOG.filter(s=>s.category==="unmonitored"))
    probes.push({id:service.id,state:"not_monitored",latencyMs:null,source:"not_configured",note:service.source});
  return probes;
}
function createPlatformPulse({db,auth,fetcher=fetch,now=Date.now}){
  const retention=createPlatformObservability({db,now});
  const controls=db.doc("platform_operations/control");
  const runtime=db.doc("platform_operations/runtime");
  async function appendJob(id,data){
    await db.collection("platform_operations_jobs").doc(id).set(data,{merge:true});
  }
  async function recordProbeStates(probes,policy,at){
    let newAlerts=0;
    await Promise.all(probes.filter(p=>p.state!=="not_monitored").map(async probe=>{
      const ref=db.doc("platform_operations_service_state/"+probe.id);
      const alertRef=db.doc("platform_operations_alerts/"+probe.id);
      const incidentRef=db.doc("platform_operations_incidents/auto_"+probe.id);
      const triggered=await db.runTransaction(async tx=>{
        const [before,oldAlert,oldIncident]=await Promise.all([
          tx.get(ref),tx.get(alertRef),tx.get(incidentRef)
        ]);
        const previous=before.exists?before.data()||{}:{};
        const streak=probe.state==="healthy"?0:(previous.streak||0)+1;
        const lastAlert=Number(previous.lastAlertAt)||0;
        const eligible=policy.automaticIncidents&&probe.state==="unavailable"&&
          streak>=policy.failureThreshold&&at-lastAlert>=policy.cooldownMinutes*60000;
        tx.set(ref,{serviceId:probe.id,streak,lastState:probe.state,lastCheckedAt:at,
          lastAlertAt:eligible?at:lastAlert});
        if(probe.state==="healthy"&&oldAlert.exists&&oldAlert.data().status!=="cleared")
          tx.update(alertRef,{status:"cleared",updatedAt:at});
        if(eligible){
          const count=(oldAlert.exists?oldAlert.data().count||0:0)+1;
          tx.set(alertRef,{kind:"service_failure",serviceId:probe.id,status:"active",
            severity:"high",count,openedAt:oldAlert.exists?(oldAlert.data().openedAt||at):at,
            updatedAt:at,acknowledgedAt:null});
          if(!oldIncident.exists||oldIncident.data().status==="resolved"){
            tx.set(incidentRef,{title:"Automated observation: "+probe.id,
              description:"Repeated platform probe failures. Verify the service before taking corrective action.",
              serviceId:probe.id,schoolId:"",source:"automated",severity:"high",status:"open",
              revision:(oldIncident.exists?(oldIncident.data().revision||0):0)+1,
              createdAt:oldIncident.exists?(oldIncident.data().createdAt||at):at,
              updatedAt:at,acknowledgedAt:null,resolvedAt:null});
            tx.create(db.collection("platform_operations_incidents/auto_"+probe.id+"/history").doc(),{
              transition:oldIncident.exists?"auto_reopen":"auto_created",
              from:oldIncident.exists?"resolved":"",to:"open",
              note:"Configured failure threshold reached.",at,actorUid:"system:platform-operations"
            });
          }else tx.update(incidentRef,{updatedAt:at});
        }
        return eligible;
      });
      if(triggered)newAlerts++;
    }));
    return newAlerts;
  }
  async function syncTelemetryAlerts(policy,at){
    const scan=await retention.detectAnomalies(),current=Array.isArray(scan.anomalies)?scan.anomalies:[],
      activeIds=new Set();let newAlerts=0,incidentsOpened=0;
    for(const item of current){
      const key=createHash("sha256").update([item.kind,item.service,item.operation].join("|")).digest("hex").slice(0,24),
        id="telemetry_"+key,ref=db.doc("platform_operations_alerts/"+id),before=await ref.get(),
        prior=before.exists?before.data()||{}:{},wasActive=prior.status==="active";
      activeIds.add(id);
      await ref.set({
        kind:"telemetry_anomaly",signalKind:item.kind,serviceId:String(item.service||"").slice(0,70),
        operation:String(item.operation||"").slice(0,90),message:String(item.message||"").slice(0,180),
        currentValue:Number(item.currentValue)||0,baselineValue:Number(item.baselineValue)||0,
        severity:item.severity==="high"?"high":"medium",status:"active",
        count:(Number(prior.count)||0)+1,openedAt:wasActive?(prior.openedAt||at):at,updatedAt:at,
        acknowledgedAt:wasActive?(prior.acknowledgedAt||null):null
      },{merge:false});
      if(!wasActive)newAlerts++;
      if(policy.automaticIncidents&&item.severity==="high"){
        const incidentRef=db.doc("platform_operations_incidents/auto_"+id),old=await incidentRef.get();
        if(!old.exists||old.data().status==="resolved"){
          const revision=(old.exists?(old.data().revision||0):0)+1;
          await incidentRef.set({
            title:"Telemetry anomaly: "+String(item.service||"service").slice(0,70),
            description:(String(item.message||"Operational anomaly")+
              " Operation: "+String(item.operation||"unknown")+
              ". Verify the sampled telemetry before corrective action.").slice(0,750),
            serviceId:String(item.service||"").slice(0,50),schoolId:"",source:"automated",
            severity:"high",status:"open",revision,
            createdAt:old.exists?(old.data().createdAt||at):at,updatedAt:at,
            acknowledgedAt:null,resolvedAt:null
          },{merge:false});
          await db.collection("platform_operations_incidents/auto_"+id+"/history").doc().create({
            transition:old.exists?"auto_reopen":"auto_created",from:old.exists?"resolved":"",
            to:"open",note:"High-severity telemetry anomaly crossed the recent baseline.",
            at,actorUid:"system:platform-telemetry"
          });
          incidentsOpened++;
        }
      }
    }
    const previous=await db.collection("platform_operations_alerts").where("kind","==","telemetry_anomaly").limit(100).get();
    await Promise.all(previous.docs.filter(doc=>!activeIds.has(doc.id)&&doc.data().status!=="cleared")
      .map(doc=>doc.ref.update({status:"cleared",updatedAt:at})));
    return {active:current.length,newAlerts,incidentsOpened};
  }

  async function createDailyDigest(at,policy,probes){
    if(!policy.dailyDigest)return {created:false};
    const day=new Date(at).toISOString().slice(0,10);
    const ref=db.doc("platform_operations_digests/"+day);
    const existing=await ref.get();
    if(existing.exists)return {created:false};
    const [registry,feature]=await Promise.all([
      db.collection("platform_schools").orderBy("displayName").limit(101).get(),
      db.doc("platform_operations_features/digest_schools").get()
    ]);
    const selection=configuredFeature(feature.exists?feature.data():null,"digest_schools");
    const schools=registry.docs.slice(0,100);
    const included=schools.filter(s=>featureEnabled(selection,s.id));
    const totals={registered:schools.length,
      active:schools.filter(x=>x.data().state==="active").length,
      suspended:schools.filter(x=>x.data().state==="suspended").length,
      pilot:schools.filter(x=>x.data().state==="pilot").length};
    try{await ref.create({day,createdAt:at,coverageTruncated:registry.size>100,
      includedSchoolCount:included.length,schoolIds:included.map(s=>s.id),
      totals,serviceStates:Object.fromEntries(probes.map(p=>[p.id,p.state])),
      kind:"automated_aggregate",source:"platform_operations_pulse"});
      return {created:true};
    }catch(error){if(error.code===6||error.code==="already-exists")return {created:false};throw error;}
  }
  async function removeOldSamples(at){
    const cutoff=at-90*DAY_MS;
    const stale=await db.collection("platform_operations_samples").where("at","<",cutoff)
      .orderBy("at").limit(10).get();
    if(!stale.empty){
      const batch=db.batch();
      for(const item of stale.docs)batch.delete(item.ref);
      await batch.commit();
    }
  }
  return async function runPulse({manual=false}={}){
    const runAt=now(),started=new Date(runAt).toISOString();
    const config=await controls.get();
    const policy=asPolicy(config.exists?config.data():null);
    if(!manual&&!policy.automatedChecks)return {state:"disabled",at:runAt};
    const runId="run_"+started.replace(/[^0-9]/g,"")+"_"+Math.floor(Math.random()*1000000).toString(36);
    const lease=await db.runTransaction(async tx=>{
      const current=await tx.get(runtime),record=current.exists?current.data()||{}:{};
      if(Number(record.leaseUntil)>runAt)return false;
      tx.set(runtime,{leaseUntil:runAt+LEASE_MS,runId,state:"running",startedAt:runAt},
        {merge:true});
      return true;
    });
    if(!lease)return {state:"busy",at:runAt};
    let final="completed";
    await appendJob(runId,{kind:manual?"manual_probe":"scheduled_probe",
      state:"running",startedAt:runAt});
    try{
      const probes=await probeServices({db,auth,fetcher,now});
      const at=now();
      const sampleRef=db.collection("platform_operations_samples").doc();
      await sampleRef.create({kind:manual?"manual":"scheduled",at,services:probes});
      const newAlerts=await recordProbeStates(probes,policy,at);
      const telemetryAnomalies=await syncTelemetryAlerts(policy,at);
      const digest=await createDailyDigest(at,policy,probes);
      let telemetryCleanup=null;
      if(!manual){
        await removeOldSamples(at);
        telemetryCleanup=await retention.cleanup();
      }
      await appendJob(runId,{state:"completed",finishedAt:now(),
        probes:probes.length,alerts:newAlerts+telemetryAnomalies.newAlerts,
        telemetryAnomalies:telemetryAnomalies.active,telemetryIncidents:telemetryAnomalies.incidentsOpened,
        digestCreated:digest.created,telemetryDeleted:telemetryCleanup?.deleted||0});
      return {state:"completed",at,sample:sampleSummary({id:sampleRef.id,data:()=>({at,kind:manual?"manual":"scheduled",services:probes})}),
        alertsCreated:newAlerts+telemetryAnomalies.newAlerts,digestCreated:digest.created,
        telemetryAnomalies:telemetryAnomalies.active,telemetryIncidents:telemetryAnomalies.incidentsOpened,
        telemetryDeleted:telemetryCleanup?.deleted||0};
    }catch(error){
      final="failed";
      await appendJob(runId,{state:"failed",finishedAt:now(),errorCode:String(error?.code||"internal").slice(0,50)});
      throw error;
    }finally{
      await db.runTransaction(async tx=>{
        const doc=await tx.get(runtime);
        if(doc.data()?.runId!==runId)return;
        tx.set(runtime,{state:final,lastState:final,lastRunAt:now(),leaseUntil:0},{merge:true});
      });
    }
  };
}
module.exports={createPlatformPulse,probeServices,stateFromIndicator,vendorProbe};
