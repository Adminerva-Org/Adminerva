"use strict";
/* Platform-only operational schemas. Pure helpers are also used by focused tests. */
const FEATURE_CATALOG=Object.freeze([
  {id:"fleet_support",label:"Fleet support aggregates",description:"Include school support totals in the Operations Center fleet view.",defaultMode:"all"},
  {id:"school_readiness",label:"School setup observations",description:"Show school setup readiness checks for selected institutions.",defaultMode:"all"},
  {id:"digest_schools",label:"School scope in daily digest",description:"Include enabled schools in the optional operational digest.",defaultMode:"off"}
]);
const SERVICE_CATALOG=Object.freeze([
  {id:"firestore",label:"Firestore",source:"Internal read probe",category:"internal"},
  {id:"firebase_auth",label:"Firebase Authentication",source:"Admin SDK identity service probe",category:"internal"},
  {id:"github_status",label:"GitHub public status",source:"githubstatus.com (not user OAuth)",category:"vendor"},
  {id:"google_cloud_status",label:"Google Cloud public status",source:"status.cloud.google.com (broad provider signal; not Gemini key health)",category:"vendor"},
  {id:"cloudflare_status",label:"Cloudflare public status",source:"cloudflarestatus.com (not site configuration)",category:"vendor"},
  {id:"fcm_delivery",label:"Firebase push delivery",source:"System Admin can run an account self-test; device display receipt is not measured",category:"unmonitored"},
  {id:"cloud_billing",label:"Cloud billing / quota",source:"No Cloud Billing export connected",category:"unmonitored"}
]);
const DEFAULT_POLICY=Object.freeze({
  revision:0,automatedChecks:false,automaticIncidents:false,dailyDigest:false,
  failureThreshold:3,staleAfterMinutes:120,cooldownMinutes:120,
  criticalSupportThreshold:5,monthlyBudgetPHP:null
});
const INCIDENT_STATES=new Set(["open","acknowledged","investigating","resolved"]);
const SEVERITIES=new Set(["critical","high","medium","low"]);
const ACTIONS=Object.freeze({
  acknowledge:"acknowledged",investigate:"investigating",
  resolve:"resolved",reopen:"open"
});
function fail(code,message){const e=new Error(message);e.code=code;throw e;}
function required(value,label,min=3,max=200){
  if(typeof value!=="string"||value.trim().length<min||value.trim().length>max)
    fail("invalid-argument",label+" must contain "+min+"–"+max+" characters.");
  return value.trim();
}
function optional(value,max=800){
  if(value==null||value==="")return "";
  if(typeof value!=="string"||value.length>max)fail("invalid-argument","Text is too long.");
  return value.trim();
}
function docId(value){
  if(typeof value!=="string"||!/^[A-Za-z0-9_-]{1,120}$/.test(value))
    fail("invalid-argument","Invalid operational record ID.");
  return value;
}
function timestamp(value){
  const millis=value?.toMillis?.();
  return Number.isFinite(millis)?millis:(Number.isFinite(value)&&value>0?value:null);
}
function enumValue(value,allowed,label){
  if(!allowed.has(value))fail("invalid-argument","Choose a valid "+label+".");
  return value;
}
function asPolicy(source){
  const raw=source||{},policy={...DEFAULT_POLICY};
  for(const name of ["automatedChecks","automaticIncidents","dailyDigest"])
    policy[name]=raw[name]===true;
  for(const [name,min,max] of [["failureThreshold",2,12],["staleAfterMinutes",30,1440],
    ["cooldownMinutes",30,1440],["criticalSupportThreshold",1,1000]]){
    if(Number.isInteger(raw[name])&&raw[name]>=min&&raw[name]<=max)
      policy[name]=raw[name];
  }
  if(Number.isInteger(raw.monthlyBudgetPHP)&&raw.monthlyBudgetPHP>=1&&raw.monthlyBudgetPHP<=100000000)
    policy.monthlyBudgetPHP=raw.monthlyBudgetPHP;
  policy.revision=Number.isInteger(raw.revision)&&raw.revision>=0?raw.revision:0;
  return policy;
}
function parsePolicy(input,current=DEFAULT_POLICY){
  const policy={...asPolicy(current)};
  for(const flag of ["automatedChecks","automaticIncidents","dailyDigest"])
    if(typeof input?.[flag]!=="boolean")fail("invalid-argument","Invalid "+flag+" setting.");
    else policy[flag]=input[flag];
  for(const [name,min,max] of [["failureThreshold",2,12],["staleAfterMinutes",30,1440],
    ["cooldownMinutes",30,1440],["criticalSupportThreshold",1,1000]]){
    const n=input?.[name];
    if(!Number.isInteger(n)||n<min||n>max)fail("invalid-argument","Invalid "+name+".");
    policy[name]=n;
  }
  const budget=input?.monthlyBudgetPHP;
  if(budget!==null&&(!Number.isInteger(budget)||budget<1||budget>100000000))
    fail("invalid-argument","Monthly budget must be blank or an integer of PHP 1–100,000,000.");
  policy.monthlyBudgetPHP=budget;
  return policy;
}
function configuredFeature(item,id){
  const known=FEATURE_CATALOG.find(x=>x.id===id);
  if(!known)fail("invalid-argument","Unknown Operations Center feature.");
  const mode=["off","pilot","all"].includes(item?.mode)?item.mode:known.defaultMode;
  return {id,label:known.label,description:known.description,mode,
    schoolIds:mode==="pilot"&&Array.isArray(item?.schoolIds)?
      item.schoolIds.filter(s=>typeof s==="string").slice(0,30):[],
    revision:Number.isInteger(item?.revision)?item.revision:0};
}
function featureEnabled(feature,schoolId){
  return feature?.mode==="all"||(feature?.mode==="pilot"&&feature.schoolIds?.includes(schoolId));
}
function validateFeatureInput(input){
  const known=FEATURE_CATALOG.find(x=>x.id===input?.featureId);
  if(!known)fail("invalid-argument","Unknown Operations Center feature.");
  if(!["off","pilot","all"].includes(input.mode))fail("invalid-argument","Invalid feature rollout mode.");
  const ids=input.mode==="pilot"?input.schoolIds:[];
  if(!Array.isArray(ids)||ids.length>30||ids.some(x=>typeof x!=="string"||!/^[a-z][a-z0-9-]{1,63}$/.test(x))||
     new Set(ids).size!==ids.length||input.mode==="pilot"&&!ids.length)
    fail("invalid-argument","Pilot rollouts require 1–30 unique school IDs.");
  return {featureId:known.id,mode:input.mode,schoolIds:ids};
}
function incidentSummary(doc){
  const row=doc.data()||{};
  return {id:doc.id,title:String(row.title||"Operational incident").slice(0,160),
    description:String(row.description||"").slice(0,750),
    serviceId:String(row.serviceId||"").slice(0,50),
    schoolId:String(row.schoolId||"").slice(0,64),
    status:INCIDENT_STATES.has(row.status)?row.status:"open",
    severity:SEVERITIES.has(row.severity)?row.severity:"medium",
    source:row.source==="automated"?"automated":"manual",
    revision:Number.isInteger(row.revision)?row.revision:1,
    createdAt:timestamp(row.createdAt),updatedAt:timestamp(row.updatedAt),
    acknowledgedAt:timestamp(row.acknowledgedAt),resolvedAt:timestamp(row.resolvedAt)};
}
function alertSummary(doc){
  const row=doc.data()||{};
  return {id:doc.id,kind:String(row.kind||"operational").slice(0,60),
    serviceId:String(row.serviceId||"").slice(0,70),schoolId:String(row.schoolId||"").slice(0,64),
    operation:String(row.operation||"").slice(0,90),
    signalKind:String(row.signalKind||"").slice(0,50),
    message:String(row.message||"").slice(0,180),
    currentValue:Number.isFinite(row.currentValue)?row.currentValue:null,
    baselineValue:Number.isFinite(row.baselineValue)?row.baselineValue:null,
    severity:SEVERITIES.has(row.severity)?row.severity:"medium",
    status:row.status==="cleared"?"cleared":"active",
    count:Number.isInteger(row.count)?row.count:1,
    openedAt:timestamp(row.openedAt),updatedAt:timestamp(row.updatedAt),
    acknowledgedAt:timestamp(row.acknowledgedAt)};
}
function sampleSummary(doc){
  const row=doc.data()||{};
  return {id:doc.id,at:timestamp(row.at),kind:String(row.kind||"manual").slice(0,20),
    services:Array.isArray(row.services)?row.services.slice(0,10).map(x=>({
      id:String(x.id||"").slice(0,50),
      state:["healthy","degraded","unavailable","not_monitored"].includes(x.state)?x.state:"not_monitored",
      latencyMs:Number.isFinite(x.latencyMs)?Math.round(x.latencyMs):null,
      source:String(x.source||"").slice(0,160),
      note:String(x.note||"").slice(0,140)
    })):[]};
}
function validMonth(value){
  if(typeof value!=="string"||!/^20[2-9][0-9]-(0[1-9]|1[0-2])$/.test(value))
    fail("invalid-argument","Use a month in YYYY-MM format.");
  return value;
}
module.exports={FEATURE_CATALOG,SERVICE_CATALOG,DEFAULT_POLICY,INCIDENT_STATES,SEVERITIES,ACTIONS,
  fail,required,optional,docId,timestamp,enumValue,asPolicy,parsePolicy,configuredFeature,featureEnabled,
  validateFeatureInput,incidentSummary,alertSummary,sampleSummary,validMonth};
