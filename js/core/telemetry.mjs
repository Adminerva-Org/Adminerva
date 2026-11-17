/** Lightweight, privacy-bounded browser diagnostics for Adminerva. */
import {app,auth} from "./firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

const functions=getFunctions(app,"asia-southeast1");
const report=httpsCallable(functions,"platformTelemetry");
const version=new URL(import.meta.url).searchParams.get("v")||"dev";
function frontendRelease(){
  const versions=[...document.querySelectorAll('script[src*="?v="],link[href*="?v="]')].map(node=>{
    try{return new URL(node.src||node.href,location.href).searchParams.get("v")||"";}catch{return "";}
  });
  const hashed=versions.find(value=>/^[a-f0-9]{8,40}$/i.test(value));
  return "web-"+(hashed||version);
}
const release=frontendRelease();
const pending=[];
const seen=new Map();
let started=false,pageReported=false,userReady=Boolean(auth.currentUser);

function traceId(){
  try{return crypto.randomUUID().replace(/-/g,"");}
  catch{return Date.now().toString(36)+Math.random().toString(36).slice(2);}
}
function page(){
  return String(location.pathname||"/").slice(0,180);
}
function safeResource(value){
  if(!value)return "";
  try{const url=new URL(String(value),location.href);return url.pathname.slice(0,180);}
  catch{return "";}
}
function text(value,max=260){
  return String(value??"").replace(/[\r\n\t]/g," ").replace(/\s+/g," ").trim().slice(0,max);
}
function flushRepeat(key){
  const item=seen.get(key);
  if(!item)return;
  const remaining=Math.max(0,item.count-item.reported);
  if(remaining){
    item.reported=item.count;
    void send({...item.payload,occurrences:Math.min(20,remaining)});
  }
  item.timer=null;
}
function sendDeduped(key,payload,ttl=120000){
  const now=Date.now(),prior=seen.get(key);
  if(!prior||now-prior.at>=ttl){
    if(prior?.timer)clearTimeout(prior.timer);
    if(prior&&prior.count>prior.reported)flushRepeat(key);
    seen.set(key,{at:now,count:1,reported:1,payload,timer:null});
    void send({...payload,occurrences:1});
  }else{
    prior.count++;
    prior.payload=payload;
    if(!prior.timer)prior.timer=setTimeout(()=>flushRepeat(key),60000);
  }
  if(seen.size>80)for(const [k,item] of seen){
    if(now-item.at>ttl*2){if(item.timer)clearTimeout(item.timer);seen.delete(k);}
  }
}
async function send(payload){
  const data={...payload,page:page(),release,traceId:payload.traceId||traceId()};
  if(!userReady||!auth.currentUser){if(pending.length<8)pending.push(data);return null;}
  try{return (await report(data)).data||null;}
  catch{return null;}
}
function flush(){
  if(!userReady||!auth.currentUser)return;
  while(pending.length)void send(pending.shift());
}
function reportPageLoad(){
  if(pageReported||!userReady||!auth.currentUser)return;
  pageReported=true;
  if(Math.random()>=.10)return;
  const nav=performance.getEntriesByType?.("navigation")?.[0];
  const duration=Math.max(0,Math.round(nav?.duration||performance.now()||0));
  void send({kind:"page_load",operation:"page_load",durationMs:Math.min(120000,duration),sampleWeight:10});
}
function browserError(event){
  if(event.target&&event.target!==window){
    const resource=safeResource(event.target.src||event.target.href);
    const key="resource|"+resource;
    if(resource)sendDeduped(key,{
      kind:"resource_error",operation:"resource_load",
      message:"Browser resource failed to load: "+resource,code:String(event.target.tagName||"resource").toLowerCase()
    },300000);
    return;
  }
  const message=text(event.message||event.error?.message||"Unhandled browser error");
  const source=safeResource(event.filename);
  const key="error|"+message+"|"+source+"|"+String(event.lineno||0);
  sendDeduped(key,{kind:"error",operation:"javascript_error",message,
    code:text(event.error?.name||"error",60),
    line:Number(event.lineno)||0,column:Number(event.colno)||0,source});
}
function rejection(event){
  const reason=event.reason,message=text(reason?.message||reason||"Unhandled promise rejection");
  const key="rejection|"+message;
  sendDeduped(key,{kind:"unhandled_rejection",operation:"promise_rejection",
    message,code:text(reason?.name||reason?.code||"rejection",60)});
}
export async function trackOperation(name,fn,{sampleRate=.10}={}){
  const startedAt=performance.now(),id=traceId();
  try{
    const result=await fn(id);
    if(Math.random()<sampleRate)void send({kind:"operation",operation:text(name,80),
      durationMs:Math.round(performance.now()-startedAt),sampleWeight:Math.max(1,Math.round(1/sampleRate)),traceId:id});
    return result;
  }catch(error){
    void send({kind:"error",operation:text(name,80),durationMs:Math.round(performance.now()-startedAt),
      message:text(error?.message||"Frontend operation failed"),code:text(error?.code||error?.name||"error",60),traceId:id});
    throw error;
  }
}
export function startClientTelemetry(){
  if(started)return;started=true;
  window.addEventListener("error",browserError,true);
  window.addEventListener("unhandledrejection",rejection);
  onAuthStateChanged(auth,user=>{
    userReady=Boolean(user);
    if(user){flush();if(document.readyState==="complete")reportPageLoad();}
    else pending.length=0;
  });
  if(document.readyState==="complete")queueMicrotask(reportPageLoad);
  else window.addEventListener("load",()=>setTimeout(reportPageLoad,0),{once:true});
}
export function reportDiagnostic(kind,operation,details={}){
  return send({kind,operation,...details});
}
window.AdminervaTelemetry={trackOperation,reportDiagnostic};
