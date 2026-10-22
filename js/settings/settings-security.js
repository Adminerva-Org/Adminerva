/** Per-account integration preferences; the application connection is managed by deployment. */
import { app, auth, db } from "../core/firebase-core.js";
import {collection,query,where,getDocs,doc,updateDoc,setDoc} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const field=id=>document.getElementById(id);
const safeSet=(id,value)=>{if(field(id))field(id).value=value||"";};
const safeGet=id=>field(id)?.value.trim()||"";
const defaultModel="gemini-3.8-flash";
let saving=false,unsubscribe=null,editRevision=0;
const preferences=[["adminGithubToken","githubToken","Adminerva_github_token"],["adminGeminiKey","geminiKey","Adminerva_gemini_token"],["adminAiModel","aiModel","Adminerva_ai_model"],["globalAiEngine","engineMode","Adminerva_engine_mode"]];
function feedback(message,tone="info"){
  const region=field("security-save-status");if(region){region.textContent=message;region.dataset.tone=tone;}
}
function assertAccount(user){if(!user?.uid||auth.currentUser?.uid!==user.uid)throw Error("Your account changed. Reload this page before saving.");}
function showAppConnection(){
  safeSet("firebaseConfigInput",JSON.stringify({projectId:app.options.projectId||"",authDomain:app.options.authDomain||"",storageBucket:app.options.storageBucket||""},null,2));
  if(field("firebaseConfigInput"))field("firebaseConfigInput").readOnly=true;
}
field("panel-security")?.addEventListener("input",()=>{editRevision++;if(!saving)feedback("You have unsaved changes.");});
window.initFirebase=function(){
  window.db=db;showAppConnection();
  window.loadSectionsAndStudents?.();window.loadLessonReviewSettings?.();
};
window.db=db;showAppConnection();

window.saveSecuritySettings=async function(){
  if(saving)return;
  const user=auth.currentUser;
  if(!user?.uid||!user.email){feedback("Sign in to your staff account before saving connections.","error");return;}
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
    for(const [,key,storage] of preferences)localStorage.setItem(storage,values[key]);
    feedback("Connections saved to your teacher profile and this browser."+(values.engineMode==="cloud"&&!values.geminiKey?" No Gemini key is configured; add one before using cloud AI.":values.engineMode==="local"?" Local mode uses your running proxy.":" Gemini connection verified."),"success");
  }catch(error){feedback(error.name==="TimeoutError"?"The connection check timed out. Your settings were not saved; please try again.":"Settings could not be saved. "+(error.message||"Check your connection and try again."),"error");}
  finally{saving=false;if(button){button.disabled=false;button.textContent=originalText;}field("panel-security")?.removeAttribute("aria-busy");}
};

window.loadSecuritySettings=async function(){
  showAppConnection();
  for(const [id,,storage] of preferences)safeSet(id,localStorage.getItem(storage)||(id==="adminAiModel"?defaultModel:id==="globalAiEngine"?"cloud":""));
  if(unsubscribe)return;
  unsubscribe=auth.onAuthStateChanged(async user=>{
    if(!user)return;
    const revision=editRevision;
    try{
      const snapshot=await getDocs(query(collection(db,"teachers"),where("email","==",user.email.toLowerCase())));
      if(auth.currentUser?.uid!==user.uid||editRevision!==revision||saving)return;
      if(!snapshot.empty){
        const data=snapshot.docs[0].data();
        for(const [id,key,storage] of preferences)if(typeof data[key]==="string"){
          localStorage.setItem(storage,data[key]);safeSet(id,data[key]||(id==="adminAiModel"?defaultModel:id==="globalAiEngine"?"cloud":""));
        }
      }
    }catch{if(auth.currentUser?.uid===user.uid&&editRevision===revision&&!saving)feedback("Saved profile settings could not load. This browser’s current values are shown. Check your connection before saving.","error");}
  });
};
