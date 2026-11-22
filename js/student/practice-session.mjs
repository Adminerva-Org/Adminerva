/** Account-bound scored-session control; random browser keys are not device fingerprints. */
import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable,connectFunctionsEmulator} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {GoogleAuthProvider,GithubAuthProvider,reauthenticateWithPopup,getIdTokenResult} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

const functions=getFunctions(app,"asia-southeast1");
if(["localhost","127.0.0.1"].includes(location.hostname)&&Number.isInteger(window.ADMINERVA_PRACTICE_EMULATOR))
  connectFunctionsEmulator(functions,"127.0.0.1",window.ADMINERVA_PRACTICE_EMULATOR);

const SCHOOL_ENDPOINTS=Object.freeze({
  practiceSeasonSession:"schoolPracticeSeasonSession",
  practiceHub:"schoolPracticeHub",
  practiceMissionStart:"schoolPracticeMissionStart",
  practiceMissionSubmit:"schoolPracticeMissionSubmit",
  practicePreferences:"schoolPracticePreferences"
});
const tenantSchools=httpsCallable(functions,"tenantSchools");
const platformLeaderboard=httpsCallable(functions,"practicePlatformLeaderboard");
const schoolKey=uid=>"Adminerva_last_verified_school_"+uid;
let current=null,schoolCache=null;

function browserKey(){
  let value=localStorage.getItem("Adminerva_Practice_Browser_v2");
  if(!/^[a-f0-9]{32}$/.test(value||"")){value=[...crypto.getRandomValues(new Uint8Array(16))].map(part=>part.toString(16).padStart(2,"0")).join("");localStorage.setItem("Adminerva_Practice_Browser_v2",value);}
  return value;
}
function storedSchool(uid){try{return sessionStorage.getItem(schoolKey(uid))||"";}catch{return "";}}
function rememberSchool(uid,schoolId){try{if(schoolId)sessionStorage.setItem(schoolKey(uid),schoolId);}catch{}}
function practiceError(message,reason){const error=new Error(message);error.details={reason};return error;}

async function legacyCall(name,payload){
  const uid=auth.currentUser?.uid;if(!uid)throw Error("Sign in to continue practice.");
  const result=await httpsCallable(functions,name)(payload);
  if(auth.currentUser?.uid!==uid)throw Error("Account changed. Reload practice before continuing.");
  return result.data;
}

export async function practicePlatformLeaderboard(){
  const result=await platformLeaderboard({});
  return result.data||{};
}

export async function resolvePracticeContext({refresh=false}={}){
  await auth.authStateReady();
  const user=auth.currentUser;if(!user?.uid)throw practiceError("Sign in to continue Practice.","verified-sign-in");
  if(!refresh&&schoolCache?.uid===user.uid&&schoolCache.schoolId)return {...schoolCache};
  const preferred=storedSchool(user.uid)||null;
  const payload=(await tenantSchools({preferredSchoolId:preferred,includePracticePilot:true})).data||{};
  if(auth.currentUser?.uid!==user.uid)throw practiceError("Account changed while Practice was checking your school.","account-changed");
  const schools=(Array.isArray(payload.schools)?payload.schools:[]).filter(school=>
    typeof school?.schoolId==="string"&&(school.platformOverride===true||Array.isArray(school.roles)&&school.roles.length));
  const selectedId=payload.selection?.schoolId;
  const selected=schools.find(school=>school.schoolId===preferred)||
    schools.find(school=>school.schoolId===selectedId)||
    (schools.length===1?schools[0]:null)||
    (!schools.length&&payload.practicePilot?.schoolId==="mcs-manila"?payload.practicePilot:null);
  if(!selected){
    if(!schools.length)throw practiceError("No active school is linked to this account. Ask your school administrator to check your membership.","enrollment");
    throw practiceError("Choose your active school from the account menu, then reconnect Games.","school-selection");
  }
  rememberSchool(user.uid,selected.schoolId);
  const roles=Array.isArray(selected.roles)?selected.roles:[],
   mode=selected.platformOverride===true||!roles.includes("student")?"preview":"student";
  schoolCache={uid:user.uid,schoolId:selected.schoolId,roles:[...roles],mode,
   platformOverride:selected.platformOverride===true,practicePilot:selected.practicePilot===true};
  return {...schoolCache,roles:[...schoolCache.roles]};
}

export async function resolvePracticeSchool({refresh=false}={}){
  const context=await resolvePracticeContext({refresh});
  if(context.mode!=="student")
    throw practiceError("This school account can preview Games, but scored Practice is reserved for enrolled student identities.","staff-preview");
  return context.schoolId;
}

export async function practiceSchoolRequest(name,payload={},options={}){
  const endpoint=SCHOOL_ENDPOINTS[name]||name,context=await resolvePracticeContext({refresh:options.refreshSchool===true});
  if(context.mode!=="student")throw practiceError("Scored Practice is reserved for enrolled student identities.","staff-preview");
  const uid=auth.currentUser?.uid;
  const result=await httpsCallable(functions,endpoint)({...payload,schoolId:context.schoolId,practicePilot:context.practicePilot===true});
  if(auth.currentUser?.uid!==uid)throw practiceError("Account changed while Practice was reconnecting.","account-changed");
  return result.data;
}

export async function resumePracticeSession({takeover=false,reauthenticate=false,season=false}={}){
  const user=auth.currentUser;if(!user)throw Error("Sign in to practise.");
  if(reauthenticate){
    const token=await getIdTokenResult(user),age=Date.now()-Number(token.claims.auth_time)*1000;
    if(!Number.isFinite(age)||age>540000){
      const providerId=user.providerData.find(provider=>["google.com","github.com"].includes(provider.providerId))?.providerId;
      if(!providerId)throw practiceError("Sign out and sign in again, then resume Practice. Your saved points remain unchanged.","recent-sign-in");
      const provider=providerId==="google.com"?new GoogleAuthProvider():new GithubAuthProvider();
      if(providerId==="google.com")provider.setCustomParameters({login_hint:user.email,prompt:"select_account"});
      await reauthenticateWithPopup(user,provider);await user.getIdToken(true);
    }else await user.getIdToken(true);
  }
  if(auth.currentUser?.uid!==user.uid)throw Error("Account changed. Resume under your current sign-in.");
  const result=season
    ?await practiceSchoolRequest("practiceSeasonSession",{browserId:browserKey(),takeover},{refreshSchool:true})
    :await legacyCall("practiceSession",{browserId:browserKey(),takeover});
  current={...result,uid:user.uid,schoolId:result.schoolId||null};return current;
}
export function resetPracticeSession(){current=null;schoolCache=null;}
export function activePracticeSession(){return current?.uid===auth.currentUser?.uid?current:null;}
export async function practiceRequest(name,payload={}){
  const session=activePracticeSession();if(!session)throw Error("Resume a scored session here before requesting a challenge.");
  const schoolScoped=Boolean(SCHOOL_ENDPOINTS[name]);
  try{
    return schoolScoped
      ?await practiceSchoolRequest(name,{...payload,sessionId:session.sessionId})
      :await legacyCall(name,{...payload,sessionId:session.sessionId});
  }catch(error){
    if(current?.uid===session.uid&&current?.sessionId===session.sessionId&&
      ["session-moved","recent-sign-in","enrollment","school-selection"].includes(error.details?.reason))current=null;
    throw error;
  }
}
