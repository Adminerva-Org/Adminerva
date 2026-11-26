/**
 * Trusted official-origin renderer bootstrap. The main process never places
 * a Firebase custom token in a URL, DOM attribute, browser storage or log.
 */
import {auth} from "./firebase-core.js";
import {signInWithCustomToken,signOut} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {eligibleNativeWorkspace} from "./native-session-admission.mjs";
import {resolveAccountAccess} from "./staff-session-v4-pilot.mjs";
import {sessionDestination} from "./session-destination-v4-pilot.mjs";
const status=document.getElementById("desktop-session-status");
function update(message){status.textContent=message;}
async function bootstrap(){
 let signedInUid=null;
 const native=window.adminervaClient;
 if(!native||native.kind!=="desktop"||typeof native.consumeSignInToken!=="function"||
    typeof native.confirmSignIn!=="function"){
  update("This page is only available inside the authorized Adminerva Desktop application.");
  return;
 }
 try{
  const token=await native.consumeSignInToken();
  if(typeof token!=="string"||!token){
   update("No pending desktop authorization. Start device sign-in from the desktop application.");
   return;
  }
  // Token is transient and is held only in this call stack until Firebase
  // establishes its standard session persistence in the isolated app partition.
  const credential=await signInWithCustomToken(auth,token);
  signedInUid=credential.user.uid;
  if(!credential.user.emailVerified||!credential.user.email)
   throw Error("Verified account required.");
  const access=await resolveAccountAccess(credential.user);
  if(!eligibleNativeWorkspace(credential.user,access))
   throw Error("A verified, active school relationship is required.");
  if(auth.currentUser?.uid!==credential.user.uid)
   throw Error("Your signed-in account changed.");
  const destination=sessionDestination("",access);
  const accepted=await native.confirmSignIn();
  if(accepted!==true)throw Error("The desktop application did not confirm this session.");
  update("Opening your Adminerva workspace…");
  location.replace(destination);
 }catch{
  // Do not leave a partly authenticated learner in shared-computer storage.
  if(signedInUid&&auth.currentUser?.uid===signedInUid){
   try{await signOut(auth);}catch{}
  }
  update("Desktop sign-in could not finish. No school record was changed. Start a new device sign-in from the app.");
 }
}
void bootstrap();
