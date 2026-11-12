/** Shared staff AI connection. Browser code never receives the school's key. */
import {auth} from "./firebase-core.js?v=1.3.0";

let cached=null;
let tenantCached=null;

async function callable(name,data,{signal,timeout=15000}={}){
  await auth.authStateReady();
  const user=auth.currentUser;
  if(!user)throw Error("Sign in before using school AI.");
  const token=await user.getIdToken();
  const response=await fetch("https://asia-southeast1-reporeview-e7ca4.cloudfunctions.net/"+name,{
    method:"POST",
    headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},
    body:JSON.stringify({data}),
    signal:signal||AbortSignal.timeout(timeout)
  });
  const json=await response.json().catch(()=>({}));
  if(auth.currentUser?.uid!==user.uid)throw Error("Account changed. The returned AI draft was ignored.");
  if(!response.ok||json.error){
    const error=Error(json.error?.message||"School AI could not connect. Retry shortly.");
    error.code=json.error?.status||"UNAVAILABLE";
    throw error;
  }
  return json.result??json.data;
}

function preferredSchool(uid){
  try{return sessionStorage.getItem("Adminerva_last_verified_school_"+uid)||null;}
  catch{return null;}
}

async function resolveSchoolContext({refresh=false}={}){
  await auth.authStateReady();
  const user=auth.currentUser;
  if(!user)throw Error("Sign in before using school AI.");
  const selection=preferredSchool(user.uid);
  if(!refresh&&tenantCached?.uid===user.uid&&tenantCached.preferred===selection&&tenantCached.at>Date.now()-60000)return tenantCached.value;
  const preferred=preferredSchool(user.uid);
  const value=await callable("tenantSchools",{preferredSchoolId:preferred});
  const schools=Array.isArray(value?.schools)?value.schools:[];
  let school=null;
  if(value?.selection?.schoolId)school=schools.find(item=>item.schoolId===value.selection.schoolId)||null;
  if(!school&&preferred)school=schools.find(item=>item.schoolId===preferred)||null;
  if(!school&&schools.length===1)school=schools[0];
  const context={
    schoolId:school?.schoolId||null,
    name:school?.name||school?.schoolId||null,
    schoolState:school?.schoolState||null,
    roles:Array.isArray(school?.roles)?school.roles:[],
    legacyCompatibilityAllowed:value?.legacyCompatibilityAllowed!==false,
    selectionState:value?.selection?.state||null
  };
  tenantCached={uid:user.uid,preferred:selection,at:Date.now(),value:context};
  return context;
}

function legacyFallbackStatus(context){
  return {
    schoolId:context?.schoolId||null,
    configured:false,
    enabled:false,
    model:localStorage.getItem("Adminerva_ai_model")||"gemini-3.8-flash",
    canManage:Boolean(context?.roles?.includes("school_admin")),
    canGenerate:true,
    legacyFallback:true,
    schoolState:context?.schoolState||null,
    capabilities:{inlineImages:false,structuredRubric:true}
  };
}

async function call(data,{signal}={}){
  return callable("schoolAI",data,{signal,timeout:data.action==="generate"?115000:15000});
}

export async function schoolAIStatus({refresh=false}={}){
  const uid=auth.currentUser?.uid;
  if(!refresh&&cached?.uid===uid&&cached.preferred===preferredSchool(uid)&&cached.at>Date.now()-60000)return cached.value;
  const context=await resolveSchoolContext({refresh});
  // During the 3.x -> 4.0 rollout, legacy Review & Grade must remain usable
  // while the verified school is still draft or before canonical membership is
  // available. The existing personal connection stays the fallback until the
  // controlled pilot is actually started.
  if(context.legacyCompatibilityAllowed&&
     (!context.schoolId||context.schoolState==="draft")){
    const value=legacyFallbackStatus(context);
    cached={uid,preferred:preferredSchool(uid),at:Date.now(),value};
    return value;
  }
  if(!context.schoolId){
    throw Error(context.selectionState==="choose_school"
      ?"Choose an authorized school before using school AI."
      :"No active school is available for AI evaluation.");
  }
  const value=await call({action:"status",schoolId:context.schoolId});
  cached={uid,preferred:preferredSchool(uid),at:Date.now(),value:{...value,schoolState:context.schoolState}};
  return cached.value;
}

export async function configureSchoolAI(values){
  const context=await resolveSchoolContext({refresh:true});
  if(!context.schoolId)throw Error("Choose an authorized school before configuring school AI.");
  if(context.schoolState==="draft")
    throw Error("School AI configuration becomes available when the controlled pilot starts. Your existing personal connection remains available during legacy compatibility.");
  const value=await call({action:"configure",schoolId:context.schoolId,...values});
  cached=null;
  return value;
}

export async function generateSchoolContent(payload,{signal,purpose="lesson"}={}){
  const status=await schoolAIStatus();
  if(status.canGenerate===false)throw Error("Your active school role does not include teacher AI access.");
  if(!status.configured){
    // A canonical pilot/active school must never silently use a personal key.
    if(!status.legacyFallback)
      throw Error("School AI is not enabled for this verified school. Ask a school administrator to configure it, or continue manually.");
    // Retain a teacher's explicitly configured personal connection only during legacy compatibility.
    const uid=auth.currentUser?.uid,
      key=localStorage.getItem("Adminerva_connection_owner")===uid
        ?localStorage.getItem("Adminerva_gemini_token"):null;
    if(!key)throw Error("School AI is not enabled yet. Configure your existing personal AI connection in Settings, or continue manually.");
    const model=localStorage.getItem("Adminerva_ai_model")||"gemini-3.8-flash";
    if(!/^[a-zA-Z0-9._-]{1,80}$/.test(model))throw Error("The configured personal AI model is invalid.");
    const response=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+
      encodeURIComponent(model)+":generateContent",{
        method:"POST",
        headers:{"Content-Type":"application/json","x-goog-api-key":key},
        body:JSON.stringify(payload),
        signal
      });
    if(!response.ok)throw Error("Your personal AI connection returned status "+response.status+". Check Connections or continue manually.");
    return response.json();
  }
  const requestId=crypto.randomUUID();
  for(let attempt=0;attempt<3;attempt++){
    if(signal?.aborted)throw new DOMException("Cancelled","AbortError");
    try{
      const result=await call({action:"generate",schoolId:status.schoolId,payload,purpose,requestId},{signal});
      const latest=await resolveSchoolContext({refresh:true});
      if(latest.schoolId!==status.schoolId)
        throw Error("School changed while generating. The returned draft was ignored.");
      return result;
    }
    catch(error){
      if(error.code!=="RESOURCE_EXHAUSTED"||!error.message.includes("busy")||attempt===2)throw error;
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(resolve,4000*(attempt+1));
        signal?.addEventListener("abort",()=>{
          clearTimeout(timer);
          reject(new DOMException("Cancelled","AbortError"));
        },{once:true});
      });
    }
  }
}

/* Keep school-only UI settings scoped to the verified selected school. */
export async function activeSchoolForAI(){
  const school=await resolveSchoolContext();
  if(!school.schoolId)throw Error("Choose a verified school before managing School AI.");
  return {...school,uid:auth.currentUser?.uid};
}
function invalidateSchoolAI(){cached=null;tenantCached=null;}
document.addEventListener("adminerva:preferred-school-changed",invalidateSchoolAI);
document.addEventListener("adminerva:school-ready",event=>{
  if(tenantCached?.value?.schoolId!==event.detail?.schoolId)invalidateSchoolAI();
});
auth.onAuthStateChanged(invalidateSchoolAI);
