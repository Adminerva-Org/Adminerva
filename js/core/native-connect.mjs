/**
 * Browser-side authorization only. This module cannot retrieve a desktop token.
 * A login must be recent; authorization is explicit, one time and code-bound.
 */
import {app,auth} from "./firebase-core.js";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {onAuthStateChanged,GoogleAuthProvider,GithubAuthProvider,signInWithPopup} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {validFlowId} from "./native-connect-model.mjs";
const params=new URLSearchParams(location.search);
const flowId=params.get("flow");
const status=document.getElementById("native-connect-status");
const identity=document.getElementById("native-identity");
const providerSelection=document.getElementById("native-provider-selection");
const accountLabel=document.getElementById("native-account");
const approveButton=document.getElementById("native-approve");
const codeInput=document.getElementById("native-pair-code");
let busy=false;
function showStatus(message){status.textContent=message;}
function render(){
 const user=auth.currentUser,valid=validFlowId(flowId);
 identity.hidden=!user||!valid;
 providerSelection.hidden=!valid;
 if(!valid){showStatus("This pairing link is invalid. Begin again inside Adminerva Desktop.");return;}
 if(user){accountLabel.textContent="Signing in as "+(user.email||"your verified account");showStatus("Check the code on your desktop before authorizing.");}
 else showStatus("Sign in first, then enter your desktop pairing code.");
}
onAuthStateChanged(auth,render);
async function login(provider){
 if(busy||!validFlowId(flowId))return;
 busy=true;
 try{
  await signInWithPopup(auth,provider);
  render();
 }catch(error){showStatus(error?.code==="auth/popup-closed-by-user"?
  "Sign-in window was closed. Retry when ready.":
  "Sign-in could not finish. Check your verified account and try again.");}
 finally{busy=false;}
}
document.getElementById("native-google").addEventListener("click",()=>void login(new GoogleAuthProvider()));
document.getElementById("native-github").addEventListener("click",()=>{
 const provider=new GithubAuthProvider();provider.addScope("read:user");provider.addScope("user:email");
 void login(provider);
});
approveButton.addEventListener("click",async()=>{
 if(busy||!auth.currentUser||!validFlowId(flowId))return;
 const confirmationCode=codeInput.value.trim();
 if(!/^\d{8}$/.test(confirmationCode)){showStatus("Enter the eight-digit code shown in your desktop application.");return;}
 busy=true;approveButton.disabled=true;
 try{
  await auth.currentUser.getIdToken(true);
  const action=httpsCallable(getFunctions(app,"asia-southeast1"),"nativeClientHandoff");
  const result=await action({action:"authorize",flowId,confirmationCode});
  if(result.data?.state!=="approved")throw Error("Unexpected pairing state.");
  codeInput.value="";
  identity.hidden=true;
  showStatus("Desktop approved. Return to your Adminerva Desktop application to finish signing in.");
 }catch(error){
  const code=String(error?.code||"");
  showStatus(code.includes("failed-precondition")?
   "Native sign-in is not enabled, or the code expired. Start a new pairing after release.":
   code.includes("unauthenticated")?
   "Sign in again with your verified Adminerva account.":
   code.includes("permission-denied")?
   "The code or account was not accepted. Check the code and your account.":
   "Could not approve this desktop. Review the code and try again.");
 }finally{busy=false;approveButton.disabled=false;}
});
render();
