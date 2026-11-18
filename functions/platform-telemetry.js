"use strict";
/**
 * Adminerva operational telemetry.
 * Stores bounded metadata only: no prompts, source code, grades, credentials,
 * notification bodies, student names or request payloads.
 */
const {createHash,randomUUID}=require("node:crypto");

const METRIC_BUCKET_MS=5*60*1000;
const TRACE_RETENTION_MS=7*24*60*60*1000;
const METRIC_RETENTION_MS=90*24*60*60*1000;
const CLIENT_RATE_LIMIT=24;
const ERROR_SCHOOL_LIMIT=25;
const DEFAULT_SUCCESS_SAMPLE_RATE=.10;

function clean(value,max=100){
  return String(value??"").replace(/[\r\n\t]/g," ").replace(/\s+/g," ").trim().slice(0,max);
}
function identifier(value,fallback="unknown",max=100){
  const result=clean(value,max).replace(/[^A-Za-z0-9_.:/-]/g,"_");
  return result||fallback;
}
function hash(value,length=24){
  return createHash("sha256").update(String(value)).digest("hex").slice(0,length);
}
function redactMessage(value){
  let text=clean(value,500);
  text=text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,"[email]");
  text=text.replace(/https?:\/\/[^\s]+/gi,match=>{
    try{const url=new URL(match);return url.origin+url.pathname;}catch{return "[url]";}
  });
  text=text.replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g,"[credential]");
  text=text.replace(/\b(?:ghp|github_pat|sk)-[A-Za-z0-9_-]{16,}\b/gi,"[credential]");
  text=text.replace(/\b[A-Za-z0-9_-]{40,}\b/g,"[token]");
  return text.slice(0,260);
}
function normalizedError(value){
  return redactMessage(value)
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi,"{uuid}")
    .replace(/\b[0-9a-f]{16,}\b/gi,"{id}")
    .replace(/\b\d{2,}\b/g,"{n}")
    .slice(0,220);
}
function errorCode(error){
  return identifier(error?.code||error?.name||"error","error",70);
}
function errorFingerprint(service,operation,error){
  return hash([service,operation,errorCode(error),normalizedError(error?.message||"")].join("|"),32);
}
function latencyBucket(durationMs){
  const n=Math.max(0,Number(durationMs)||0);
  if(n<=250)return "le_250";
  if(n<=500)return "le_500";
  if(n<=1000)return "le_1000";
  if(n<=2500)return "le_2500";
  if(n<=5000)return "le_5000";
  if(n<=10000)return "le_10000";
  return "gt_10000";
}
function releaseMarker(source="backend"){
  if(source==="browser")return "frontend";
  return identifier(process.env.K_REVISION||process.env.FUNCTION_TARGET||process.env.GCLOUD_PROJECT||"backend","backend",120);
}
function requestTraceId(request){
  const supplied=clean(request?.data?._telemetryTraceId,64);
  if(/^[A-Za-z0-9_-]{12,64}$/.test(supplied))return supplied;
  const cloud=clean(request?.rawRequest?.headers?.["x-cloud-trace-context"],100).split("/")[0];
  if(/^[a-f0-9]{16,64}$/i.test(cloud))return cloud;
  return randomUUID().replace(/-/g,"");
}
function actionName(request){
  return identifier(request?.data?.action||"call","call",80);
}
function serviceName(handlerName){
  return identifier(process.env.K_SERVICE||process.env.FUNCTION_TARGET||handlerName||"callable","callable",90);
}
function safeSchoolId(request){
  const value=clean(request?.data?.schoolId,120);
  return /^[A-Za-z0-9_-]{1,120}$/.test(value)?value:"";
}
function addSpan(request,name,{startedAt=Date.now(),finishedAt=Date.now(),status="ok",code=""}={}){
  const trace=request?.__telemetry;
  if(!trace||!Array.isArray(trace.spans)||trace.spans.length>=12)return;
  trace.spans.push({
    name:identifier(name,"step",80),
    startedAt:Number(startedAt)||Date.now(),
    finishedAt:Number(finishedAt)||Date.now(),
    durationMs:Math.max(0,(Number(finishedAt)||Date.now())-(Number(startedAt)||Date.now())),
    status:status==="error"?"error":"ok",
    ...(code?{code:identifier(code,"error",60)}:{})
  });
}
async function measureSpan(request,name,fn){
  const start=Date.now();
  try{
    const result=await fn();
    addSpan(request,name,{startedAt:start,finishedAt:Date.now(),status:"ok"});
    return result;
  }catch(error){
    addSpan(request,name,{startedAt:start,finishedAt:Date.now(),status:"error",code:errorCode(error)});
    throw error;
  }
}
function numericSummary(value){
  if(!value||typeof value!=="object"||Array.isArray(value))return null;
  const allow=["processed","failed","deleted","recipients","delivered","created","updated","skipped","scanned"];
  const out={};
  for(const key of allow)if(Number.isFinite(value[key]))out[key]=Number(value[key]);
  return Object.keys(out).length?out:null;
}

function createPlatformTelemetry({db,FieldValue,now=Date.now,random=Math.random}){
  function increment(value){return FieldValue.increment(value);}
  async function writeError({service,operation,error,at,schoolId,release,source,metaWeight=1}){
    const fingerprint=errorFingerprint(service,operation,error);
    const ref=db.doc("platform_telemetry_errors/"+fingerprint);
    await db.runTransaction(async tx=>{
      const previous=await tx.get(ref),before=previous.exists?previous.data()||{}:{};
      const schools=Array.isArray(before.schoolIds)?before.schoolIds.slice(0,ERROR_SCHOOL_LIMIT):[];
      let schoolsTruncated=before.schoolsTruncated===true;
      if(schoolId&&!schools.includes(schoolId)){
        if(schools.length<ERROR_SCHOOL_LIMIT)schools.push(schoolId);
        else schoolsTruncated=true;
      }
      tx.set(ref,{
        fingerprint,service,operation,source,code:errorCode(error),
        sampleMessage:((source==="browser"?"Browser ":"Backend ")+errorCode(error)+" in "+operation).slice(0,260),
        count:(Number(before.count)||0)+Math.min(20,Math.max(1,Number(metaWeight)||1)),
        firstSeen:Number(before.firstSeen)||at,lastSeen:at,
        lastRelease:release,schoolIds:schools,schoolsTruncated
      },{merge:false});
    });
    return fingerprint;
  }
  async function record(meta){
    const at=Number(meta.finishedAt)||now(),startedAt=Number(meta.startedAt)||at;
    const failed=Boolean(meta.error),rate=Math.min(1,Math.max(.01,Number(meta.sampleRate)||DEFAULT_SUCCESS_SAMPLE_RATE));
    if(!failed&&random()>=rate)return {recorded:false,traceId:meta.traceId};
    const weight=failed
      ?Math.min(20,Math.max(1,Number(meta.weight)||1))
      :Math.min(20,Math.max(1,Number(meta.weight)||Math.round(1/rate)));
    const service=identifier(meta.service,"unknown_service",90),operation=identifier(meta.operation,"operation",90);
    const source=identifier(meta.source,"backend",40),release=identifier(meta.release||releaseMarker(source),"release",120);
    const durationMs=Math.max(0,at-startedAt),schoolId=identifier(meta.schoolId,"",120);
    const traceId=identifier(meta.traceId||randomUUID().replace(/-/g,""),"trace",64);
    const bucketStart=Math.floor(at/METRIC_BUCKET_MS)*METRIC_BUCKET_MS;
    const metricId=String(bucketStart)+"_"+hash(service+"|"+operation,20);
    const bucket=latencyBucket(durationMs),metricRef=db.doc("platform_telemetry_metrics/"+metricId);
    const metricWrite={
      bucketStart,service,operation,source,release,lastSeen:at,
      observedCount:increment(1),
      successEstimate:increment(failed?0:weight),
      failureCount:increment(failed?weight:0),
      latencyWeight:increment(weight),
      latencyTotalMs:increment(durationMs*weight),
      ["latency_"+bucket]:increment(weight)
    };
    let fingerprint="";
    if(failed)fingerprint=await writeError({service,operation,error:meta.error,at,schoolId,release,source,metaWeight:weight});
    const spans=(Array.isArray(meta.spans)?meta.spans:[]).slice(0,12).map(span=>({
      name:identifier(span.name,"step",80),startedAt:Number(span.startedAt)||startedAt,
      finishedAt:Number(span.finishedAt)||at,durationMs:Math.max(0,Number(span.durationMs)||0),
      status:span.status==="error"?"error":"ok",...(span.code?{code:identifier(span.code,"error",60)}:{})
    }));
    await Promise.all([
      metricRef.set(metricWrite,{merge:true}),
      db.doc("platform_telemetry_traces/"+traceId).set({
        traceId,service,operation,source,release,schoolId,
        startedAt,finishedAt:at,durationMs,status:failed?"error":"ok",
        errorFingerprint:fingerprint,spans,
        expiresAt:at+TRACE_RETENTION_MS
      },{merge:false})
    ]);
    return {recorded:true,traceId,fingerprint};
  }
  async function runCallable(handler,request,{enabled=true,name}={}){
    if(!enabled)return handler(request);
    const traceId=requestTraceId(request),startedAt=now();
    request.__telemetry={traceId,startedAt,spans:[]};
    const service=serviceName(name||handler?.name),operation=actionName(request),schoolId=safeSchoolId(request);
    try{
      const result=await handler(request);
      await record({traceId,startedAt,finishedAt:now(),service,operation,schoolId,
        source:"callable",spans:request.__telemetry.spans}).catch(error=>console.warn("Telemetry success sample skipped",{code:error.code||"unknown"}));
      return result;
    }catch(error){
      await record({traceId,startedAt,finishedAt:now(),service,operation,schoolId,
        source:"callable",error,spans:request.__telemetry.spans,sampleRate:1}).catch(write=>console.warn("Telemetry failure sample skipped",{code:write.code||"unknown"}));
      throw error;
    }
  }
  async function runJob(name,handler){
    const startedAt=now(),service=identifier(name,"job",90),traceId=randomUUID().replace(/-/g,"");
    const id=String(startedAt)+"_"+hash(service+"|"+traceId,18);
    const ref=db.doc("platform_operations_jobs/"+id);
    await ref.set({jobId:id,name:service,source:"instrumented_job",status:"running",
      release:releaseMarker(),startedAt,updatedAt:startedAt},{merge:false});
    try{
      const result=await handler();
      const finishedAt=now(),summary=numericSummary(result);
      await Promise.all([
        ref.set({status:"completed",finishedAt,updatedAt:finishedAt,durationMs:Math.max(0,finishedAt-startedAt),
          ...(summary?{summary}:{})},{merge:true}),
        record({traceId,startedAt,finishedAt,service,operation:"run",source:"scheduled_job",sampleRate:1,weight:1})
      ]);
      return result;
    }catch(error){
      const finishedAt=now();
      await Promise.allSettled([
        ref.set({status:"failed",finishedAt,updatedAt:finishedAt,durationMs:Math.max(0,finishedAt-startedAt),
          errorCode:errorCode(error)},{merge:true}),
        record({traceId,startedAt,finishedAt,service,operation:"run",source:"scheduled_job",error,sampleRate:1})
      ]);
      throw error;
    }
  }
  async function runEvent(name,handler){
    const startedAt=now(),traceId=randomUUID().replace(/-/g,""),service=identifier(name,"event",90);
    try{
      const result=await handler();
      await record({traceId,startedAt,finishedAt:now(),service,operation:"event",
        source:"background_event"}).catch(()=>{});
      return result;
    }catch(error){
      await record({traceId,startedAt,finishedAt:now(),service,operation:"event",
        source:"background_event",error,sampleRate:1}).catch(()=>{});
      throw error;
    }
  }
  async function clientEvent(request){
    const uid=request?.auth?.uid;
    if(!uid||request?.auth?.token?.email_verified!==true){
      const error=Error("Sign in with a verified Adminerva account before reporting diagnostics.");
      error.code="unauthenticated";throw error;
    }
    const input=request.data||{},kind=identifier(input.kind,"",40);
    if(!new Set(["page_load","error","unhandled_rejection","resource_error","operation"]).has(kind)){
      const error=Error("Unsupported diagnostic event.");error.code="invalid-argument";throw error;
    }
    const minute=Math.floor(now()/60000)*60000,rateRef=db.doc("platform_telemetry_client_rate/"+hash(uid+"|"+minute,28));
    await db.runTransaction(async tx=>{
      const prior=await tx.get(rateRef),count=prior.exists?Number(prior.data()?.count)||0:0;
      if(count>=CLIENT_RATE_LIMIT){const error=Error("Browser diagnostics are temporarily rate limited.");error.code="resource-exhausted";throw error;}
      tx.set(rateRef,{minuteStart:minute,count:count+1,expiresAt:minute+2*24*60*60*1000},{merge:false});
    });
    const page=clean(input.page,180).replace(/[?#].*$/,""),operation=identifier(input.operation||kind,kind,90);
    const durationMs=Math.min(120000,Math.max(0,Number(input.durationMs)||0)),startedAt=now()-durationMs;
    const clientError=["error","unhandled_rejection","resource_error"].includes(kind)?
      Object.assign(Error(redactMessage(input.message||kind)),{code:identifier(input.code||kind,kind,60)}):null;
    const traceId=identifier(input.traceId||randomUUID().replace(/-/g,""),"browser_trace",64);
    const release=identifier(input.release||"frontend","frontend",120),
      weight=clientError?Math.min(20,Math.max(1,Number(input.occurrences)||1)):
        Math.min(20,Math.max(1,Number(input.sampleWeight)||1));
    const result=await record({traceId,startedAt,finishedAt:now(),service:"browser",operation:page?operation+"@"+page:operation,
      source:"browser",release,error:clientError,sampleRate:1,weight});
    return {accepted:true,traceId:result.traceId};
  }
  return {record,runCallable,runJob,runEvent,clientEvent};
}

module.exports={
  METRIC_BUCKET_MS,TRACE_RETENTION_MS,METRIC_RETENTION_MS,DEFAULT_SUCCESS_SAMPLE_RATE,
  redactMessage,normalizedError,errorFingerprint,latencyBucket,addSpan,measureSpan,
  createPlatformTelemetry
};