/** Account-bound scored-session control; random browser keys are not device fingerprints. */
import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable,connectFunctionsEmulator} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {GoogleAuthProvider,GithubAuthProvider,reauthenticateWithPopup,getIdTokenResult} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
const functions=getFunctions(app,"asia-southeast1");
if(["localhost","127.0.0.1"].includes(location.hostname)&&Number.isInteger(window.ADMINERVA_PRACTICE_EMULATOR))
  connectFunctionsEmulator(functions,"127.0.0.1",window.ADMINERVA_PRACTICE_EMULATOR);

const tenantSchools=httpsCallable(functions,"tenantSchools");
const schoolNames=new Map([
  ["practiceSeasonSession","schoolPracticeSeasonSession"],
  ["practiceHub","schoolPracticeHub"],
  ["practiceMissionStart","schoolPracticeMissionStart"],
  ["practiceMissionSubmit","schoolPracticeMissionSubmit"],
  ["practicePreferences","schoolPracticePreferences"]
]);
let current=null,scopePromise=null;

function preferredSchool(uid){
  try{return sessionStorage.getItem("Adminerva_last_verified_school_"+uid)||"";}catch{return "";}
}
function browserKey(){
  let value=localStorage.getItem("Adminerva_Practice_Browser_v2");
  if(!/^[a-f0-9]{32}$/.test(value||"")){
    value=[...crypto.getRandomValues(new Uint8Array(16))]
      .map(part=>part.toString(16).padStart(2,"0")).join("");
    localStorage.setItem("Adminerva_Practice_Browser_v2",value);
  }
  return value;
}
function scopeError(message,reason){
  const error=Error(message);error.details={reason};return error;
}
async function resolveScope(){
  const user=auth.currentUser;
  if(!user)return {mode:"guest",schoolId:null,uid:null};
  if(scopePromise?.uid===user.uid)return scopePromise.promise;
  const promise=(async()=>{
    try{
      const preferred=preferredSchool(user.uid),
        response=await tenantSchools({preferredSchoolId:preferred||null}),
        schools=Array.isArray(response.data?.schools)?response.data.schools:[],
        studentSchools=schools.filter(item=>Array.isArray(item.roles)&&item.roles.includes("student"));
      if(!studentSchools.length)return {mode:"legacy",schoolId:null,uid:user.uid};
      if(studentSchools.length===1)
        return {mode:"school",schoolId:studentSchools[0].schoolId,uid:user.uid};
      const selected=studentSchools.find(item=>item.schoolId===preferred);
      if(!selected)throw scopeError(
        "Choose the school you want to use for Practice from the account menu, then reopen Practice.",
        "school-selection-required");
      return {mode:"school",schoolId:selected.schoolId,uid:user.uid};
    }catch(error){
      if(error?.details?.reason==="school-selection-required")throw error;
      // Staged 3.x compatibility only. Once V4 is the sole production route,
      // tenant lookup failures should fail closed rather than use legacy Practice.
      console.warn("Verified Practice school lookup unavailable; using legacy compatibility.",error?.code||error?.message||error);
      return {mode:"legacy",schoolId:null,uid:user.uid};
    }
  })();
  scopePromise={uid:user.uid,promise};
  return promise;
}
async function rawCall(name,payload){
  const uid=auth.currentUser?.uid||null;
  const result=await httpsCallable(functions,name)(payload);
  if(uid&&auth.currentUser?.uid!==uid)
    throw Error("Account changed. Reload practice before continuing.");
  if(!uid&&auth.currentUser)
    throw Error("Account changed while Practice was loading. Reload before continuing.");
  return result.data;
}
function mappedName(name,scope){
  if(scope.mode!=="school")return name;
  const mapped=schoolNames.get(name);
  if(!mapped)throw scopeError("This Practice action has not been migrated to the verified school service.","school-practice-unavailable");
  return mapped;
}
async function scopedCall(name,payload={},scope=null){
  const resolved=scope||await resolveScope();
  const body=resolved.mode==="school"?{...payload,schoolId:resolved.schoolId}:payload;
  return rawCall(mappedName(name,resolved),body);
}

export async function practiceScope(){return resolveScope();}
export async function practiceAccountRequest(name,payload={}){
  return scopedCall(name,payload);
}
export async function resumePracticeSession({takeover=false,reauthenticate=false,season=false}={}){
  const user=auth.currentUser;if(!user)throw Error("Sign in to practise.");
  if(reauthenticate){
    const token=await getIdTokenResult(user),age=Date.now()-Number(token.claims.auth_time)*1000;
    if(!Number.isFinite(age)||age>540000){
      const providerId=user.providerData.find(provider=>["google.com","github.com"].includes(provider.providerId))?.providerId;
      if(!providerId)throw Error("Sign out and sign in again, then resume practice. Your saved points remain unchanged.");
      const provider=providerId==="google.com"?new GoogleAuthProvider():new GithubAuthProvider();
      if(providerId==="google.com")provider.setCustomParameters({login_hint:user.email,prompt:"select_account"});
      await reauthenticateWithPopup(user,provider);await user.getIdToken(true);
    }
  }
  if(auth.currentUser?.uid!==user.uid)throw Error("Account changed. Resume under your current sign-in.");
  const scope=await resolveScope();
  const result=await scopedCall(season?"practiceSeasonSession":"practiceSession",
    {browserId:browserKey(),takeover},scope);
  current={...result,uid:user.uid,practiceMode:scope.mode,schoolId:scope.schoolId||null};
  return current;
}
export function resetPracticeSession(){current=null;}
export function activePracticeSession(){
  return current?.uid===auth.currentUser?.uid?current:null;
}
export async function practiceRequest(name,payload={}){
  const session=activePracticeSession();
  if(!session)throw Error("Resume a scored session here before requesting a challenge.");
  const scope={mode:session.practiceMode||"legacy",schoolId:session.schoolId||null,uid:session.uid};
  try{
    return await scopedCall(name,{...payload,sessionId:session.sessionId},scope);
  }catch(error){
    if(current?.uid===session.uid&&current?.sessionId===session.sessionId&&
       ["session-moved","recent-sign-in","school-selection-required"].includes(error.details?.reason))
      current=null;
    throw error;
  }
}
document.addEventListener("adminerva:preferred-school-changed",()=>{
  current=null;scopePromise=null;
});
