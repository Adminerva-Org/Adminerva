"use strict";
/**
 * Verified-platform-only operations API. This module never reads student,
 * grades, submissions, report bodies or teacher-authored educational material.
 */
const {platformAuthority,checkedSchoolId,TenantAccessError}=require("./tenant-access.js");
const {createPlatformPulse}=require("./platform-operations-monitor.js");
const {createPlatformObservability}=require("./platform-observability.js");
const {
  FEATURE_CATALOG,SERVICE_CATALOG,SEVERITIES,ACTIONS,fail,required,optional,docId,timestamp,
  enumValue,asPolicy,parsePolicy,configuredFeature,featureEnabled,validateFeatureInput,
  incidentSummary,alertSummary,sampleSummary,validMonth
}=require("./platform-operations-model.js");
const LIMIT=100;
function timeoutSignal(ms){return typeof AbortSignal!=="undefined"&&typeof AbortSignal.timeout==="function"?AbortSignal.timeout(ms):undefined;}
const INCIDENTS="platform_operations_incidents";
const FEATURES="platform_operations_features";
const POLICY_PATH="platform_operations/control";
function clean(value,max=120){return typeof value==="string"?value.trim().slice(0,max):"";}
function count(query){return query.count().get().then(s=>s.data().count||0);}
function schoolSummary(doc){
  const row=doc.data()||{};
  return {schoolId:doc.id,name:clean(row.displayName,120)||doc.id,
    state:clean(row.state,24)||"unknown",
    provisioningMode:row.provisioningMode==="standard"?"standard":
      (row.provisioningMode==="legacy_migration"?"legacy_migration":
        (row.compatibilityMode==="v4_only"?"standard":"legacy_migration")),
    compatibilityMode:row.compatibilityMode==="v4_only"?"v4_only":"legacy_allowed",
    revision:Number.isInteger(row.revision)?row.revision:0,
    updatedAt:timestamp(row.updatedAt)};
}
function auditSummary(doc){
  const row=doc.data()||{};
  const action=clean(row.action,90).replace(/[^a-z0-9_-]/gi,"");
  if(!action)return null;
  return {id:doc.id,schoolId:clean(row.schoolId,64),action,at:timestamp(row.createdAt)};
}
function maintenanceSummary(control,status){
  const config=control.exists?control.data()||{}:null;
  const result=status.exists?status.data()||{}:null;
  return {configured:Boolean(config),cleanupEnabled:config?.cleanupEnabled===true,
    summaryRefreshEnabled:config?.summaryRefreshEnabled===true,
    lastState:clean(result?.state,30)||null,
    finishedAt:timestamp(result?.finishedAt),cleanupCapped:result?.cleanupCapped===true};
}
function costsSummary(doc){
  const row=doc.exists?doc.data()||{}:null;
  return row?{month:doc.id,reportedPHP:row.reportedPHP,
    source:"operator_reported",sourceReference:clean(row.sourceReference,120),
    updatedAt:timestamp(row.updatedAt),revision:row.revision||1}:null;
}
function createPlatformOperationsService({db,auth,fetcher,now=Date.now}){
  const pulse=createPlatformPulse({db,auth,fetcher,now});
  const observability=createPlatformObservability({db,now});
  const providerFetch=fetcher||fetch;
  const audit=({action,uid,schoolId="",resourceId="",reason=""})=>({
    action,actorUid:uid,schoolId,resourceId,reason,createdAt:now()
  });
  async function assertSchool(schoolId){
    const ref=db.doc("platform_schools/"+checkedSchoolId(schoolId));
    const school=await ref.get();
    if(!school.exists)fail("not-found","The selected school is not registered.");
    return school;
  }
  function assertRevision(input,actual){
    if(!Number.isInteger(input)||input!==actual)
      fail("failed-precondition","This operational record changed. Refresh before saving again.");
  }
  async function supportCounts(schoolId){
    const reports=db.collection("schools/"+checkedSchoolId(schoolId)+"/support_reports");
    const [total,resolved,closed,critical]=await Promise.all([
      count(reports),count(reports.where("status","==","Resolved")),
      count(reports.where("status","==","Closed")),
      count(reports.where("priority","==","Critical"))
    ]);
    return {total,open:Math.max(0,total-resolved-closed),resolved,closed,critical};
  }
  async function getRollouts(){
    const documents=await Promise.all(FEATURE_CATALOG.map(feature=>db.doc(FEATURES+"/"+feature.id).get()));
    return FEATURE_CATALOG.map((feature,i)=>configuredFeature(
      documents[i].exists?documents[i].data():null,feature.id));
  }
  async function overview(uid){
    const date=new Date(now()).toISOString().slice(0,7);
    const [registry,audits,control,status,policy,incidents,alerts,samples,
      jobs,digests,cost,rollouts,pushDevices,all,active,pilot,draft,suspended,archived]=await Promise.all([
      db.collection("platform_schools").orderBy("displayName").limit(LIMIT+1).get(),
      db.collection("platform_audit").orderBy("createdAt","desc").limit(20).get(),
      db.doc("monitoring_control/runtime").get(),db.doc("monitoring_status/runtime").get(),
      db.doc(POLICY_PATH).get(),
      db.collection(INCIDENTS).orderBy("updatedAt","desc").limit(35).get(),
      db.collection("platform_operations_alerts").orderBy("updatedAt","desc").limit(35).get(),
      db.collection("platform_operations_samples").orderBy("at","desc").limit(30).get(),
      db.collection("platform_operations_jobs").orderBy("startedAt","desc").limit(16).get(),
      db.collection("platform_operations_digests").orderBy("createdAt","desc").limit(10).get(),
      db.doc("platform_operations_costs/"+date).get(),
      getRollouts(),
      db.collection("push_devices").where("ownerUid","==",uid).limit(13).get(),
      count(db.collection("platform_schools")),
      count(db.collection("platform_schools").where("state","==","active")),
      count(db.collection("platform_schools").where("state","==","pilot")),
      count(db.collection("platform_schools").where("state","==","draft")),
      count(db.collection("platform_schools").where("state","==","suspended")),
      count(db.collection("platform_schools").where("state","==","archived"))
    ]);
    const events=audits.docs.map(auditSummary).filter(Boolean);
    const reportSamples=samples.docs.map(sampleSummary);
    const currentPolicy=asPolicy(policy.exists?policy.data():null);
    const latest=reportSamples[0]||null;
    const stale=latest&&now()-latest.at>currentPolicy.staleAfterMinutes*60000;
    const incidentRows=incidents.docs.map(incidentSummary);
    return {
      generatedAt:now(),limit:LIMIT,truncated:registry.size>LIMIT,
      counts:{total:all,active,pilot,draft,suspended,archived},
      schools:registry.docs.slice(0,LIMIT).map(schoolSummary),
      events,maintenance:maintenanceSummary(control,status),
      policy:currentPolicy,features:rollouts,
      incidents:incidentRows,alerts:alerts.docs.map(alertSummary),
      samples:reportSamples,latestSampleStale:!latest||Boolean(stale),
      jobs:jobs.docs.map(doc=>({id:doc.id,kind:clean(doc.data().kind||doc.data().name,60),
        state:clean(doc.data().state||doc.data().status,30),startedAt:timestamp(doc.data().startedAt),
        finishedAt:timestamp(doc.data().finishedAt),probes:doc.data().probes||0,
        alerts:doc.data().alerts||0,durationMs:Number.isFinite(doc.data().durationMs)?doc.data().durationMs:null,
        source:clean(doc.data().source,40),summary:doc.data().summary||null})),
      digests:digests.docs.map(doc=>({day:doc.id,at:timestamp(doc.data().createdAt),
        counts:doc.data().totals||null,includedSchools:doc.data().includedSchoolCount||0,
        coverageTruncated:doc.data().coverageTruncated===true})),
      costs:costsSummary(cost),
      push:{registered:Math.min(12,pushDevices.size),
        active:pushDevices.docs.slice(0,12).filter(doc=>{
          const row=doc.data()||{};
          return row.enabled===true&&typeof row.token==="string"&&row.token.length>20;
        }).length,
        truncated:pushDevices.size>12},
      services:SERVICE_CATALOG,
      observations:{platformApi:"reachable",registry:"reachable",
        callerAuthorization:"verified",notificationDelivery:"not_monitored",
        githubIntegration:"not_monitored",aiProviders:"not_monitored"}
    };
  }
  async function getSchool(input){
    const doc=await assertSchool(input.schoolId);
    const [aiDoc,aiHealthDoc]=await Promise.all([
      db.doc("schools/"+doc.id+"/private_config/ai").get(),
      db.doc("platform_operations_service_state/school_ai_"+doc.id).get()
    ]);
    const ai=aiDoc.exists?aiDoc.data()||{}:null;
    const latestAI=aiHealthDoc.exists?aiHealthDoc.data()||{}:null;
    const aiStatus=ai?{configured:Boolean(ai.enabled&&ai.apiKey),enabled:ai.enabled===true,
      model:clean(ai.model,80)||"gemini-3.8-flash",
      dailyLimit:Number.isInteger(ai.dailyLimit)?ai.dailyLimit:null,
      maxConcurrent:Number.isInteger(ai.maxConcurrent)?ai.maxConcurrent:null,
      updatedAt:timestamp(ai.updatedAt),
      lastTest:latestAI?{state:clean(latestAI.lastState,30),kind:clean(latestAI.lastKind,40),
        checkedAt:timestamp(latestAI.lastCheckedAt),latencyMs:Number.isFinite(latestAI.lastLatencyMs)?latestAI.lastLatencyMs:null}:null}:
      {configured:false,enabled:false,model:null,dailyLimit:null,maxConcurrent:null,updatedAt:null,lastTest:null};
    const rolloutDoc=await db.doc(FEATURES+"/fleet_support").get();
    const enabled=featureEnabled(configuredFeature(
      rolloutDoc.exists?rolloutDoc.data():null,"fleet_support"),doc.id);
    if(!enabled)return {school:schoolSummary(doc),support:null,supportUnavailable:false,
      supportDisabledByRollout:true,ai:aiStatus,
      github:{mode:"public_evidence",centrallyManagedCredential:false},generatedAt:now()};
    let support=null,unavailable=false;
    try{support=await supportCounts(doc.id);}catch{unavailable=true;}
    return {school:schoolSummary(doc),support,supportUnavailable:unavailable,ai:aiStatus,
      github:{mode:"public_evidence",centrallyManagedCredential:false},generatedAt:now()};
  }
  async function getFleet(input){
    const offset=Number(input.offset||0);
    if(!Number.isInteger(offset)||offset<0||offset>=100)
      fail("invalid-argument","Use a valid fleet offset between 0 and 99.");
    const [registry,feature]=await Promise.all([
      db.collection("platform_schools").orderBy("displayName").limit(101).get(),
      db.doc(FEATURES+"/fleet_support").get()
    ]);
    const rollout=configuredFeature(feature.exists?feature.data():null,"fleet_support");
    const slice=registry.docs.slice(offset,offset+8);
    const rows=await Promise.all(slice.map(async doc=>{
      const school=schoolSummary(doc),enabled=featureEnabled(rollout,school.schoolId);
      if(!enabled)return {schoolId:school.schoolId,name:school.name,state:school.state,
        support:null,availability:"disabled_by_rollout"};
      try{return {schoolId:school.schoolId,name:school.name,state:school.state,
        support:await supportCounts(doc.id),availability:"available"};}
      catch{return {schoolId:school.schoolId,name:school.name,state:school.state,
        support:null,availability:"unavailable"};}
    }));
    return {rows,offset,nextOffset:offset+8<Math.min(100,registry.size)?offset+8:null,
      truncated:registry.size>100,generatedAt:now()};
  }
  async function testSchoolAI(uid,input){
    const schoolId=checkedSchoolId(input.schoolId),school=await assertSchool(schoolId);
    const connection=await db.doc("schools/"+schoolId+"/private_config/ai").get();
    const cfg=connection.exists?connection.data()||{}:null;
    if(!cfg?.enabled||typeof cfg.apiKey!=="string"||!cfg.apiKey)
      fail("failed-precondition","School AI is not configured and enabled.");
    const model=clean(cfg.model,80)||"gemini-3.8-flash";
    if(!/^[a-zA-Z0-9._-]{1,80}$/.test(model))
      fail("failed-precondition","The stored school AI model identifier is invalid.");
    const stateRef=db.doc("platform_operations_service_state/school_ai_"+schoolId);
    const previous=await stateRef.get(),at=now(),last=Number(previous.data()?.lastManualTestAt)||0;
    if(at-last<60000)fail("resource-exhausted","Wait at least one minute between school AI connection tests.");
    const start=now();
    let state="unavailable",kind="provider",httpStatus=null,note="Provider request did not complete.";
    try{
      const response=await providerFetch(
        "https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent",
        {method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":cfg.apiKey},
          body:JSON.stringify({contents:[{parts:[{text:"Return only OK."}]}],
            generationConfig:{temperature:0,maxOutputTokens:8}}),
          signal:timeoutSignal(10000)}
      );
      httpStatus=response.status;
      if(response.ok){state="healthy";kind="accepted";note="Gemini accepted the school credential and model diagnostic request.";}
      else if(response.status===429){state="degraded";kind="quota";note="Gemini reached a provider quota or rate limit.";}
      else if([400,401,403].includes(response.status)){state="unavailable";kind="credential";note="The saved school credential was rejected or cannot authorize this request.";}
      else if(response.status===404){state="degraded";kind="model";note="The configured Gemini model is not available to this credential.";}
      else if(response.status>=500){state="unavailable";kind="provider";note="Gemini returned a provider-side error.";}
      else {state="degraded";kind="request";note="Gemini returned an unexpected diagnostic response.";}
    }catch{
      state="unavailable";kind="network";note="The Gemini diagnostic request timed out or could not reach the provider.";
    }
    const latencyMs=Math.max(0,now()-start);
    await Promise.all([
      stateRef.set({serviceId:"school_ai",schoolId,lastState:state,lastKind:kind,
        lastCheckedAt:at,lastLatencyMs:latencyMs,lastManualTestAt:at,httpStatus},{merge:true}),
      db.collection("platform_operations_audit").doc().create(audit({
        action:"school_ai_connection_tested",uid,schoolId,resourceId:"school_ai",
        reason:"Fixed diagnostic prompt; no school content submitted"
      }))
    ]);
    return {schoolId,schoolName:schoolSummary(school).name,state,kind,httpStatus,latencyMs,checkedAt:at,note};
  }

  async function createIncident(uid,input){
    const title=required(input.title,"Incident title",6,150);
    const description=required(input.description,"Incident description",12,750);
    const severity=enumValue(input.severity,SEVERITIES,"severity");
    const serviceId=optional(input.serviceId,50);
    if(serviceId&&!SERVICE_CATALOG.some(s=>s.id===serviceId))
      fail("invalid-argument","Select a registered service.");
    const schoolId=input.schoolId?checkedSchoolId(input.schoolId):"";
    if(schoolId)await assertSchool(schoolId);
    const ref=db.collection(INCIDENTS).doc(),at=now();
    const row={title,description,severity,serviceId,schoolId,source:"manual",
      status:"open",revision:1,createdAt:at,updatedAt:at,createdByUid:uid};
    const batch=db.batch();
    batch.create(ref,row);
    batch.create(db.collection(INCIDENTS+"/"+ref.id+"/history").doc(),{
      transition:"created",from:"",to:"open",note:"Manual incident recorded.",at,actorUid:uid
    });
    batch.create(db.collection("platform_operations_audit").doc(),audit({
      action:"incident_created",uid,schoolId,resourceId:ref.id,reason:"Manual incident entry"
    }));
    await batch.commit();
    return {incident:incidentSummary({id:ref.id,data:()=>row})};
  }
  async function changeIncident(uid,input){
    const id=docId(input.incidentId),transition=String(input.transition||"");
    if(!ACTIONS[transition])fail("invalid-argument","Unknown incident transition.");
    const ref=db.doc(INCIDENTS+"/"+id),at=now(),note=required(input.note,"Change note",12,500);
    let changed;
    await db.runTransaction(async tx=>{
      const record=await tx.get(ref);
      if(!record.exists)fail("not-found","The incident no longer exists.");
      const before=record.data(),to=ACTIONS[transition];
      assertRevision(input.revision,before.revision||1);
      if(before.status===to || (before.status==="resolved"&&to!=="open")||
         (before.status!=="resolved"&&to==="open"))
        fail("failed-precondition","This transition is not valid for the current incident status.");
      const patch={status:to,revision:(before.revision||1)+1,updatedAt:at,
        ...(to==="acknowledged"?{acknowledgedAt:at}:{}),
        ...(to==="resolved"?{resolvedAt:at}:{}),
        ...(to==="open"?{resolvedAt:null}:{}),
        lastNote:note};
      tx.update(ref,patch);
      tx.create(db.collection(INCIDENTS+"/"+id+"/history").doc(),{
        transition,from:before.status,to,note,at,actorUid:uid
      });
      tx.create(db.collection("platform_operations_audit").doc(),audit({
        action:"incident_"+transition,uid,schoolId:before.schoolId||"",resourceId:id,reason:note
      }));
      changed={id,...before,...patch};
    });
    return {incident:incidentSummary({id,data:()=>changed})};
  }
  async function incidentHistory(input){
    const id=docId(input.incidentId),incident=await db.doc(INCIDENTS+"/"+id).get();
    if(!incident.exists)fail("not-found","The incident no longer exists.");
    const snapshot=await db.collection(INCIDENTS+"/"+id+"/history").orderBy("at","desc").limit(30).get();
    return {incidentId:id,history:snapshot.docs.map(event=>{
      const row=event.data()||{};
      return {id:event.id,transition:clean(row.transition,32),from:clean(row.from,24),
        to:clean(row.to,24),note:clean(row.note,500),at:timestamp(row.at)};
    })};
  }
  async function acknowledgeAlert(uid,input){
    const id=docId(input.alertId),ref=db.doc("platform_operations_alerts/"+id),at=now();
    await db.runTransaction(async tx=>{
      const existing=await tx.get(ref);
      if(!existing.exists)fail("not-found","The operational alert no longer exists.");
      if(existing.data().status!=="active")fail("failed-precondition","This alert is already cleared.");
      tx.update(ref,{acknowledgedAt:at,acknowledgedByUid:uid,updatedAt:at});
      tx.create(db.collection("platform_operations_audit").doc(),audit({
        action:"alert_acknowledged",uid,resourceId:id,reason:"Operator acknowledged alert"
      }));
    });
    return {acknowledged:true};
  }
  async function savePolicy(uid,input){
    const expected=input.revision,reason=required(input.reason,"Policy change reason",12,300);
    const ref=db.doc(POLICY_PATH);let result;
    await db.runTransaction(async tx=>{
      const before=await tx.get(ref),old=asPolicy(before.exists?before.data():null);
      assertRevision(expected,old.revision);
      const next=parsePolicy(input.policy,old);next.revision=old.revision+1;
      tx.set(ref,{...next,updatedAt:now(),updatedByUid:uid});
      tx.create(db.collection("platform_operations_audit").doc(),audit({
        action:"monitor_policy_changed",uid,resourceId:"control",reason
      }));
      result=next;
    });
    return {policy:result};
  }
  async function saveFeature(uid,input){
    const value=validateFeatureInput(input),reason=required(input.reason,"Rollout reason",12,300);
    if(value.mode==="pilot")await Promise.all(value.schoolIds.map(assertSchool));
    const ref=db.doc(FEATURES+"/"+value.featureId),at=now();let rollout;
    await db.runTransaction(async tx=>{
      const prior=await tx.get(ref);
      const before=configuredFeature(prior.exists?prior.data():null,value.featureId);
      assertRevision(input.revision,before.revision);
      const next={...value,revision:before.revision+1,updatedAt:at,updatedByUid:uid};
      tx.set(ref,next);
      tx.create(db.collection("platform_operations_audit").doc(),audit({
        action:"operations_rollout_changed",uid,resourceId:value.featureId,reason
      }));
      rollout=configuredFeature(next,value.featureId);
    });
    return {feature:rollout};
  }
  async function cleanupTelemetry(uid){
    const result=await observability.cleanup();
    await db.collection("platform_operations_audit").doc().create(audit({
      action:"telemetry_retention_cleanup",uid,resourceId:"platform_telemetry",
      reason:"Manual bounded retention cleanup from Operations Center"
    }));
    return {cleanup:result,generatedAt:now()};
  }
    async function reportCost(uid,input){
    const month=validMonth(input.month),reportedPHP=input.reportedPHP,
      sourceReference=required(input.sourceReference,"Billing source reference",6,120),
      reason=required(input.reason,"Cost update reason",12,300);
    if(!Number.isInteger(reportedPHP)||reportedPHP<0||reportedPHP>100000000)
      fail("invalid-argument","Enter a valid nonnegative PHP cost estimate.");
    const ref=db.doc("platform_operations_costs/"+month),at=now();let result;
    await db.runTransaction(async tx=>{
      const before=await tx.get(ref),rev=before.exists?(before.data().revision||0):0;
      assertRevision(input.revision,rev);
      result={month,reportedPHP,sourceReference,revision:rev+1,updatedAt:at,
        actorUid:uid,source:"operator_reported"};
      tx.set(ref,result);
      tx.create(db.collection("platform_operations_audit").doc(),audit({
        action:"operator_cost_recorded",uid,resourceId:month,reason
      }));
    });
    return {costs:{month,reportedPHP,source:"operator_reported",sourceReference,
      revision:result.revision,updatedAt:at}};
  }
  return async request=>{
    const authority=await platformAuthority({db,request});
    if(!authority.platformAdmin)
      throw new TenantAccessError("permission-denied","Verified System Administrator access is required.");
    const input=request.data||{},action=input.action||"overview";
    switch(action){
      case "overview":return overview(authority.uid);
      case "school":return getSchool(input);
      case "fleet_support":return getFleet(input);
      case "test_school_ai":return testSchoolAI(authority.uid,input);
      case "observability":return observability.overview();
      case "cleanup_telemetry":return cleanupTelemetry(authority.uid);
      case "run_probes":{
        const result=await pulse({manual:true});
        return {state:result.state,at:result.at,alertsCreated:result.alertsCreated||0,
          sample:result.sample||null};
      }
      case "create_incident":return createIncident(authority.uid,input);
      case "change_incident":return changeIncident(authority.uid,input);
      case "incident_history":return incidentHistory(input);
      case "acknowledge_alert":return acknowledgeAlert(authority.uid,input);
      case "save_policy":return savePolicy(authority.uid,input);
      case "save_feature":return saveFeature(authority.uid,input);
      case "record_cost":return reportCost(authority.uid,input);
      default:fail("invalid-argument","Unknown Operations Center action.");
    }
  };
}
module.exports={createPlatformOperationsService,schoolSummary,maintenanceSummary};
