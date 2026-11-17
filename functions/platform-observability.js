"use strict";
/** Read model and retention helpers for Adminerva's internal observability UI. */
const {METRIC_BUCKET_MS,TRACE_RETENTION_MS,METRIC_RETENTION_MS}=require("./platform-telemetry.js");

const HISTOGRAM=[
  ["le_250",250],["le_500",500],["le_1000",1000],["le_2500",2500],
  ["le_5000",5000],["le_10000",10000],["gt_10000",15000]
];
function n(value){return Number.isFinite(Number(value))?Number(value):0;}
function safe(value,max=120){return String(value??"").replace(/[\r\n\t]/g," ").trim().slice(0,max);}
function metricRow(doc){
  const d=doc.data()||{};
  return {
    id:doc.id,bucketStart:n(d.bucketStart),service:safe(d.service,90),operation:safe(d.operation,90),
    source:safe(d.source,40),release:safe(d.release,120),lastSeen:n(d.lastSeen),
    successEstimate:n(d.successEstimate),failureCount:n(d.failureCount),observedCount:n(d.observedCount),
    latencyWeight:n(d.latencyWeight),latencyTotalMs:n(d.latencyTotalMs),
    histogram:Object.fromEntries(HISTOGRAM.map(([key])=>[key,n(d["latency_"+key])]))
  };
}
function traceRow(doc){
  const d=doc.data()||{};
  return {traceId:safe(d.traceId||doc.id,64),service:safe(d.service,90),operation:safe(d.operation,90),
    source:safe(d.source,40),release:safe(d.release,120),schoolId:safe(d.schoolId,120),
    startedAt:n(d.startedAt),finishedAt:n(d.finishedAt),durationMs:n(d.durationMs),
    status:d.status==="error"?"error":"ok",errorFingerprint:safe(d.errorFingerprint,40),
    spans:Array.isArray(d.spans)?d.spans.slice(0,12).map(span=>({
      name:safe(span.name,80),startedAt:n(span.startedAt),finishedAt:n(span.finishedAt),
      durationMs:n(span.durationMs),status:span.status==="error"?"error":"ok",code:safe(span.code,60)
    })):[]
  };
}
function errorRow(doc){
  const d=doc.data()||{};
  return {fingerprint:safe(d.fingerprint||doc.id,40),service:safe(d.service,90),operation:safe(d.operation,90),
    source:safe(d.source,40),code:safe(d.code,70),sampleMessage:safe(d.sampleMessage,260),
    count:n(d.count),firstSeen:n(d.firstSeen),lastSeen:n(d.lastSeen),lastRelease:safe(d.lastRelease,120),
    schoolIds:Array.isArray(d.schoolIds)?d.schoolIds.slice(0,25).map(id=>safe(id,120)):[],
    schoolsTruncated:d.schoolsTruncated===true};
}
function jobRow(doc){
  const d=doc.data()||{};
  return {jobId:doc.id,name:safe(d.name||d.kind||"job",100),source:safe(d.source,50),
    status:safe(d.status,30),release:safe(d.release,120),startedAt:n(d.startedAt),
    finishedAt:n(d.finishedAt),durationMs:n(d.durationMs),errorCode:safe(d.errorCode,60),
    summary:d.summary&&typeof d.summary==="object"?Object.fromEntries(
      Object.entries(d.summary).filter(([,v])=>Number.isFinite(Number(v))).slice(0,10).map(([k,v])=>[safe(k,40),Number(v)])
    ):null};
}
function combine(rows){
  const out={requests:0,failures:0,latencyTotalMs:0,latencyWeight:0,histogram:{}};
  for(const row of rows){
    out.requests+=row.successEstimate+row.failureCount;
    out.failures+=row.failureCount;
    out.latencyTotalMs+=row.latencyTotalMs;
    out.latencyWeight+=row.latencyWeight;
    for(const [key] of HISTOGRAM)out.histogram[key]=(out.histogram[key]||0)+(row.histogram[key]||0);
  }
  out.errorRate=out.requests?out.failures/out.requests:0;
  out.avgLatencyMs=out.latencyWeight?Math.round(out.latencyTotalMs/out.latencyWeight):0;
  out.p95LatencyMs=percentile(out.histogram,.95);
  return out;
}
function percentile(histogram,ratio){
  const total=HISTOGRAM.reduce((sum,[key])=>sum+n(histogram?.[key]),0);
  if(!total)return 0;
  const threshold=total*ratio;let seen=0;
  for(const [key,upper] of HISTOGRAM){seen+=n(histogram?.[key]);if(seen>=threshold)return upper;}
  return 15000;
}
function group(rows){
  const map=new Map();
  for(const row of rows){
    const key=row.service+"|"+row.operation;
    if(!map.has(key))map.set(key,[]);
    map.get(key).push(row);
  }
  return map;
}
function serviceRows(rows){
  return [...group(rows)].map(([key,list])=>{
    const [service,operation]=key.split("|"),stats=combine(list);
    return {service,operation,...stats,lastSeen:Math.max(...list.map(x=>x.lastSeen||x.bucketStart))};
  }).sort((a,b)=>b.failures-a.failures||b.requests-a.requests).slice(0,40);
}
function timeline(rows){
  const buckets=new Map();
  for(const row of rows){
    if(!buckets.has(row.bucketStart))buckets.set(row.bucketStart,[]);
    buckets.get(row.bucketStart).push(row);
  }
  return [...buckets].sort((a,b)=>a[0]-b[0]).slice(-24).map(([at,list])=>({at,...combine(list)}));
}
function anomalies(rows,at){
  const current=rows.filter(row=>row.bucketStart>=at-30*60*1000);
  const baseline=rows.filter(row=>row.bucketStart>=at-90*60*1000&&row.bucketStart<at-30*60*1000);
  const cur=group(current),base=group(baseline),alerts=[];
  for(const [key,list] of cur){
    const nowStats=combine(list),baseStats=combine(base.get(key)||[]);
    if(nowStats.requests>=5&&nowStats.errorRate>=.10&&
       nowStats.errorRate>Math.max(.05,baseStats.errorRate*2)){
      const [service,operation]=key.split("|");
      alerts.push({kind:"error_spike",severity:nowStats.errorRate>=.25?"high":"medium",
        service,operation,currentValue:nowStats.errorRate,baselineValue:baseStats.errorRate,
        message:"Failure rate is above the recent baseline."});
    }
    if(nowStats.latencyWeight>=5&&nowStats.avgLatencyMs>=2500&&
       (!baseStats.avgLatencyMs||nowStats.avgLatencyMs>baseStats.avgLatencyMs*1.75)){
      const [service,operation]=key.split("|");
      alerts.push({kind:"latency_spike",severity:nowStats.avgLatencyMs>=7000?"high":"medium",
        service,operation,currentValue:nowStats.avgLatencyMs,baselineValue:baseStats.avgLatencyMs,
        message:"Average latency is elevated against the recent baseline."});
    }
  }
  return alerts.sort((a,b)=>(b.severity==="high")-(a.severity==="high")).slice(0,20);
}
function releases(traces){
  const map=new Map();
  for(const trace of traces){
    const key=trace.release||"unknown";
    if(!map.has(key))map.set(key,{release:key,firstSeen:trace.startedAt,lastSeen:trace.finishedAt,samples:0,failures:0,sources:new Set()});
    const row=map.get(key);row.firstSeen=Math.min(row.firstSeen||trace.startedAt,trace.startedAt);
    row.lastSeen=Math.max(row.lastSeen||trace.finishedAt,trace.finishedAt);
    row.samples++;if(trace.status==="error")row.failures++;row.sources.add(trace.source);
  }
  return [...map.values()].map(row=>({...row,sources:[...row.sources]}))
    .sort((a,b)=>b.lastSeen-a.lastSeen).slice(0,12);
}

function createPlatformObservability({db,now=Date.now}){
  async function overview(){
    const at=now();
    const [metrics,errors,traces,jobs]=await Promise.all([
      db.collection("platform_telemetry_metrics").where("bucketStart",">=",at-2*60*60*1000)
        .orderBy("bucketStart","desc").limit(180).get(),
      db.collection("platform_telemetry_errors").orderBy("lastSeen","desc").limit(30).get(),
      db.collection("platform_telemetry_traces").orderBy("startedAt","desc").limit(40).get(),
      db.collection("platform_operations_jobs").orderBy("startedAt","desc").limit(30).get()
    ]);
    const metricRows=metrics.docs.map(metricRow),recent=metricRows.filter(row=>row.bucketStart>=at-60*60*1000);
    return {
      generatedAt:at,
      summary:combine(recent),
      services:serviceRows(recent),
      timeline:timeline(metricRows),
      anomalies:anomalies(metricRows,at),
      errors:errors.docs.map(errorRow),
      traces:traces.docs.map(traceRow),
      jobs:jobs.docs.map(jobRow),
      releases:releases(traces.docs.map(traceRow)),
      sampling:{backendSuccessRate:.10,browserPageLoadRate:.10,failures:"all"},
      retention:{tracesDays:Math.round(TRACE_RETENTION_MS/86400000),metricsDays:Math.round(METRIC_RETENTION_MS/86400000),
        errorGroups:"retained until explicitly cleared"}
    };
  }
  async function detectAnomalies(){
    const at=now();
    const metrics=await db.collection("platform_telemetry_metrics")
      .where("bucketStart",">=",at-90*60*1000).orderBy("bucketStart","desc").limit(180).get();
    return {generatedAt:at,anomalies:anomalies(metrics.docs.map(metricRow),at)};
  }
  async function cleanup(){
    const at=now(),targets=[
      ["platform_telemetry_traces","startedAt",at-TRACE_RETENTION_MS],
      ["platform_telemetry_metrics","bucketStart",at-METRIC_RETENTION_MS],
      ["platform_telemetry_client_rate","minuteStart",at-2*24*60*60*1000]
    ],result={deleted:0,collections:{}};
    for(const [collection,field,cutoff] of targets){
      const snap=await db.collection(collection).where(field,"<",cutoff).limit(20).get();
      if(snap.empty){result.collections[collection]=0;continue;}
      const batch=db.batch();for(const doc of snap.docs)batch.delete(doc.ref);
      await batch.commit();result.deleted+=snap.size;result.collections[collection]=snap.size;
    }
    return result;
  }
  return {overview,detectAnomalies,cleanup};
}

module.exports={metricRow,traceRow,errorRow,combine,percentile,anomalies,createPlatformObservability};