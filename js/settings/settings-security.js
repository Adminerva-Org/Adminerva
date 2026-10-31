/** Per-account integration preferences; the application connection is managed by deployment. */
import { app, auth, db } from "../core/firebase-core.js?v=1.3.0";
import "./school-ai-settings.mjs?v=4.0.0";
import {CONNECTION_DEFAULTS,activateConnectionOwner,writeConnectionPreferences,clearConnectionPreferences} from "../core/connection-cache.mjs?v=1.3.0";
import {collection,query,where,getDocs,doc,updateDoc,setDoc} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const field=id=>document.getElementById(id);
const safeSet=(id,value)=>{if(field(id))field(id).value=value||"";};
const safeGet=id=>field(id)?.value.trim()||"";
const defaultModel=CONNECTION_DEFAULTS.aiModel;
let saving=false,unsubscribe=null,editRevision=0,formOwnerUid=null,legacyCredentialsRetired=false;
const preferences=[["adminGithubToken","githubToken","Adminerva_github_token"],["adminGeminiKey","geminiKey","Adminerva_gemini_token"],["adminAiModel","aiModel","Adminerva_ai_model"],["globalAiEngine","engineMode","Adminerva_engine_mode"]];
function feedback(message,tone="info"){
  const region=field("security-save-status");if(region){region.textContent=message;region.dataset.tone=tone;}
}
function assertAccount(user){if(!user?.uid||auth.currentUser?.uid!==user.uid||formOwnerUid!==user.uid)throw Error("Your account changed. Reload this page before saving.");}
function setLegacyCredentialMode(detail=null){
  const nav=document.getElementById("adminerva-nav"),
    state=detail&&Object.keys(detail).length?detail:{
      schoolTeacher:nav?.dataset.schoolTeacher==="true",
      schoolAdmin:nav?.dataset.schoolAdmin==="true",
      v4Cutover:nav?.dataset.v4Cutover==="true",
      v4OnlyTeacher:nav?.dataset.v4OnlyTeacher==="true",
      legacyTeacher:nav?.dataset.legacyTeacher==="true"
    },
    canonicalSchoolUser=Boolean(state.schoolTeacher||state.schoolAdmin),
    retired=Boolean(canonicalSchoolUser&&(state.v4Cutover||state.v4OnlyTeacher||!state.legacyTeacher));
  legacyCredentialsRetired=retired;
  const card=field("legacyPersonalConnections"),hint=field("legacyConnectionHint"),button=field("saveSettingsBtn");
  if(card)card.hidden=retired;
  if(button)button.hidden=retired;
  if(hint){
    hint.textContent=retired?
      "Personal legacy API credentials are retired for this verified-school account. AI requests use the school connection above; GitHub evidence is handled by the school-scoped assessment workflow.":
      "These personal credentials support only legacy compatibility workflows during migration. Verified-school AI uses the school connection above and never falls back to a browser Gemini key.";
  }
}
document.addEventListener("adminerva:role-ready",event=>setLegacyCredentialMode(event.detail||{}));
setLegacyCredentialMode();
function fillPreferences(values){for(const [id,key] of preferences)safeSet(id,values[key]);}
function showAppConnection(){
  const options=app?.options||{};
  const publicConnection={
    projectId:options.projectId||"",
    authDomain:options.authDomain||"",
    storageBucket:options.storageBucket||"",
    messagingSenderId:options.messagingSenderId||"",
    appId:options.appId||""
  };
  safeSet("firebaseConfigInput",JSON.stringify(publicConnection,null,2));
  if(field("firebaseConfigInput"))field("firebaseConfigInput").readOnly=true;
}
field("panel-security")?.addEventListener("input",()=>{editRevision++;if(!saving)feedback("You have unsaved changes.");});
window.initFirebase=function(){
  window.db=db;showAppConnection();
  window.loadSectionsAndStudents?.();window.loadLessonReviewSettings?.();
};
window.db=db;showAppConnection();fillPreferences(CONNECTION_DEFAULTS);

window.saveSecuritySettings=async function(){
  if(saving)return;
  if(legacyCredentialsRetired){feedback("Personal legacy API credentials are retired for this verified-school account.");return;}
  const user=auth.currentUser;
  if(!user?.uid||!user.email){feedback("Sign in to your staff account before saving connections.","error");return;}
  if(formOwnerUid!==user.uid){feedback("Your account changed or settings have not loaded. Reload this page before saving.","error");return;}
  const values={githubToken:safeGet("adminGithubToken"),geminiKey:safeGet("adminGeminiKey"),aiModel:(safeGet("adminAiModel")||defaultModel).replace(/^models\//,""),engineMode:safeGet("globalAiEngine")||"cloud"};
  const button=field("saveSettingsBtn"),originalText=button?.textContent||"Save connections & keys";
  saving=true;editRevision++;if(button){button.disabled=true;button.textContent="Checking and saving…";}field("panel-security")?.setAttribute("aria-busy","true");
  feedback(values.engineMode==="cloud"&&values.geminiKey?"Checking the Gemini key and model…":"Saving your connections…");
  try{
    if(values.engineMode==="cloud"&&values.geminiKey){
      const model=values.aiModel;
      const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(values.geminiKey)}`,{
        method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:"Connection test."}]}]}),signal:AbortSignal.timeout(20000)
      });
      if(!response.ok){
        if(response.status===400||response.status===401||response.status===403)throw Error("Gemini could not authorize this key or request. Check the key and provider account.");
        if(response.status===404)throw Error("The selected Gemini model is unavailable. Check the model ID and your provider account.");
        if(response.status===429)throw Error("Gemini has reached the account’s current request limit. Try again later or choose an available model.");
        throw Error("Gemini connection check failed (status "+response.status+"). Please try again.");
      }
    }
    assertAccount(user);
    const snapshot=await getDocs(query(collection(db,"teachers"),where("email","==",user.email.toLowerCase())));
    assertAccount(user);
    if(!snapshot.empty)await updateDoc(doc(db,"teachers",snapshot.docs[0].id),values);
    else await setDoc(doc(db,"teachers",user.uid),{email:user.email.toLowerCase(),uid:user.uid,...values});
    assertAccount(user);
    writeConnectionPreferences(user.uid,values);
    feedback("Connections saved to your teacher profile and this browser."+(values.engineMode==="cloud"&&!values.geminiKey?" No Gemini key is configured; add one before using cloud AI.":values.engineMode==="local"?" Local mode uses your running proxy.":" Gemini connection verified."),"success");
  }catch(error){feedback(error.name==="TimeoutError"?"The connection check timed out. Your settings were not saved; please try again.":"Settings could not be saved. "+(error.message||"Check your connection and try again."),"error");}
  finally{saving=false;if(button){button.disabled=false;button.textContent=originalText;}field("panel-security")?.removeAttribute("aria-busy");}
};

window.loadSecuritySettings=async function(){
  showAppConnection();
  if(unsubscribe)return;
  fillPreferences(CONNECTION_DEFAULTS);formOwnerUid=null;
  unsubscribe=auth.onAuthStateChanged(async user=>{
    if((auth.currentUser?.uid||null)!==(user?.uid||null))return;
    const revision=++editRevision;formOwnerUid=null;fillPreferences(CONNECTION_DEFAULTS);
    if(!user){clearConnectionPreferences();return;}
    try{
      if(auth.currentUser?.uid!==user.uid)return;
      const owned=activateConnectionOwner(user.uid);formOwnerUid=user.uid;fillPreferences(owned);
      const snapshot=await getDocs(query(collection(db,"teachers"),where("email","==",user.email.toLowerCase())));
      if(auth.currentUser?.uid!==user.uid||formOwnerUid!==user.uid||editRevision!==revision||saving)return;
      const data=snapshot.empty?{}:snapshot.docs[0].data();
      fillPreferences(writeConnectionPreferences(user.uid,data));
    }catch{if(auth.currentUser?.uid===user.uid&&editRevision===revision&&!saving)feedback("Saved profile settings could not load. This browser’s current values are shown. Check your connection before saving.","error");}
  });
};
