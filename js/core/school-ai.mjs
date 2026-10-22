/** Shared staff AI connection. Browser code never receives the school's key. */
import {auth} from "./firebase-core.js?v=1.3.0";
let cached=null;
async function call(data,{signal}={}){
  await auth.authStateReady();const user=auth.currentUser;if(!user)throw Error("Sign in before using school AI.");
  const token=await user.getIdToken();
  const response=await fetch("https://asia-southeast1-reporeview-e7ca4.cloudfunctions.net/schoolAI",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify({data}),signal:signal||AbortSignal.timeout(data.action==="generate"?115000:15000)});
  const json=await response.json().catch(()=>({}));
  if(auth.currentUser?.uid!==user.uid)throw Error("Account changed. The returned AI draft was ignored.");
  if(!response.ok||json.error){const error=Error(json.error?.message||"School AI could not connect. Retry shortly.");error.code=json.error?.status||"UNAVAILABLE";throw error;}
  return json.result??json.data;
}
export async function schoolAIStatus({refresh=false}={}){
  const uid=auth.currentUser?.uid;
  if(!refresh&&cached?.uid===uid&&cached.at>Date.now()-60000)return cached.value;
  const value=await call({action:"status"});cached={uid,at:Date.now(),value};return value;
}
export async function configureSchoolAI(values){const value=await call({action:"configure",...values});cached=null;return value;}
export async function generateSchoolContent(payload,{signal,purpose="lesson"}={}){
  const status=await schoolAIStatus();
  if(!status.configured){
    // Retain a teacher's explicitly configured personal connection during rollout.
    const uid=auth.currentUser?.uid,key=localStorage.getItem("Adminerva_connection_owner")===uid?localStorage.getItem("Adminerva_gemini_token"):null;
    if(!key)throw Error("School AI is not enabled yet. Ask your administrator to configure it in Connections; you can continue manually.");
    const model=localStorage.getItem("Adminerva_ai_model")||"gemini-3.8-flash";
    if(!/^[a-zA-Z0-9._-]{1,80}$/.test(model))throw Error("The configured personal AI model is invalid.");
    const response=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent",{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":key},body:JSON.stringify(payload),signal});
    if(!response.ok)throw Error("Your personal AI connection returned status "+response.status+". Check Connections or continue manually.");
    return response.json();
  }
  const requestId=crypto.randomUUID();
  for(let attempt=0;attempt<3;attempt++){
    if(signal?.aborted)throw new DOMException("Cancelled","AbortError");
    try{return await call({action:"generate",payload,purpose,requestId},{signal});}
    catch(error){
      if(error.code!=="RESOURCE_EXHAUSTED"||!error.message.includes("busy")||attempt===2)throw error;
      await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,4000*(attempt+1));signal?.addEventListener("abort",()=>{clearTimeout(timer);reject(new DOMException("Cancelled","AbortError"));},{once:true});});
    }
  }
}
