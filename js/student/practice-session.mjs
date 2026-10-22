/** Account-bound scored-session control; random browser keys are not device fingerprints. */
import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable,connectFunctionsEmulator} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {GoogleAuthProvider,GithubAuthProvider,reauthenticateWithPopup,getIdTokenResult} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
const functions=getFunctions(app,"asia-southeast1");
if(["localhost","127.0.0.1"].includes(location.hostname)&&Number.isInteger(window.ADMINERVA_PRACTICE_EMULATOR))
  connectFunctionsEmulator(functions,"127.0.0.1",window.ADMINERVA_PRACTICE_EMULATOR);
let current=null;
function browserKey(){
  let value=localStorage.getItem("Adminerva_Practice_Browser_v2");
  if(!/^[a-f0-9]{32}$/.test(value||"")){value=[...crypto.getRandomValues(new Uint8Array(16))].map(part=>part.toString(16).padStart(2,"0")).join("");localStorage.setItem("Adminerva_Practice_Browser_v2",value);}
  return value;
}
async function call(name,payload){
  const uid=auth.currentUser?.uid;if(!uid)throw Error("Sign in to continue practice.");
  const result=await httpsCallable(functions,name)(payload);
  if(auth.currentUser?.uid!==uid)throw Error("Account changed. Reload practice before continuing.");
  return result.data;
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
  const result=await call(season?"practiceSeasonSession":"practiceSession",{browserId:browserKey(),takeover});
  current={...result,uid:user.uid};return current;
}
export function resetPracticeSession(){current=null;}
export function activePracticeSession(){return current?.uid===auth.currentUser?.uid?current:null;}
export async function practiceRequest(name,payload={}){
  const session=activePracticeSession();if(!session)throw Error("Resume a scored session here before requesting a challenge.");
  try{return await call(name,{...payload,sessionId:session.sessionId});}
  catch(error){if(current?.uid===session.uid&&current?.sessionId===session.sessionId&&["session-moved","recent-sign-in"].includes(error.details?.reason))current=null;throw error;}
}
