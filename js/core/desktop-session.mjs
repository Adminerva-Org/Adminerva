/**
 * Trusted official-origin renderer bootstrap. The main process never places
 * a Firebase custom token in a URL, DOM attribute, browser storage or log.
 */
import {auth} from "./firebase-core.js";
import {signInWithCustomToken} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {resolveAccountAccess} from "./staff-session-v4-pilot.mjs";
import {sessionDestination} from "./session-destination-v4-pilot.mjs";
const status=document.getElementById("desktop-session-status");
function update(message){status.textContent=message;}
async function bootstrap(){
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
  if(!credential.user.emailVerified||!credential.user.email)
   throw Error("Verified account required.");
  const access=await resolveAccountAccess(credential.user);
  if(access.staffLookupUnavailable&&!access.platformAdmin&&!access.schoolAdmin&&
     !access.schoolTeacher&&!access.schoolStudent)
   throw Error("Your school access could not be verified.");
  if(auth.currentUser?.uid!==credential.user.uid)
   throw Error("Your signed-in account changed.");
  const destination=sessionDestination("",access);
  const accepted=await native.confirmSignIn();
  if(accepted!==true)throw Error("The desktop application did not confirm this session.");
  update("Opening your Adminerva workspace…");
  location.replace(destination);
 }catch{
  update("Your desktop sign-in could not finish. No school record was changed. Try the sign-in process again.");
 }
}
void bootstrap();
