/**
 * System-browser authorization; never sends credentials or pairing code in URL.
 * An existing Firebase session alone is insufficient: the user must explicitly
 * reauthenticate with Google/GitHub before approving a new desktop device.
 */
import {app,auth} from "./firebase-core.js";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {onAuthStateChanged,GoogleAuthProvider,GithubAuthProvider,signInWithPopup,reauthenticateWithPopup} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {validFlowId} from "./native-connect-model.mjs";
const flowId=new URLSearchParams(location.search).get("flow");
const status=document.getElementById("native-connect-status");
const identity=document.getElementById("native-identity");
const providerSelection=document.getElementById("native-provider-selection");
const accountLabel=document.getElementById("native-account");
const approveButton=document.getElementById("native-approve");
const codeInput=document.getElementById("native-pair-code");
let busy=false,approved=false,reauthenticatedUid=null,proofAtMs=0;
function showStatus(message){status.textContent=message;}
function freshProof(user){
 return Boolean(user?.uid&&user.uid===reauthenticatedUid&&
  proofAtMs>0&&Date.now()-proofAtMs<4*60*1000);
}
function render(){
 const user=auth.currentUser,valid=validFlowId(flowId);
 if(!valid){
  identity.hidden=true;providerSelection.hidden=true;
  showStatus("This pairing link is invalid. Begin again inside Adminerva Desktop.");
  return;
 }
 if(!user||user.uid!==reauthenticatedUid){reauthenticatedUid=null;proofAtMs=0;}
 const verified=freshProof(user);
 identity.hidden=!verified||approved;
 providerSelection.hidden=approved;
 approveButton.disabled=busy||!verified||approved;
 if(approved){showStatus("Desktop approved. Return to the application to finish signing in.");return;}
 if(user){
  accountLabel.textContent="Verified account: "+(user.email||"your account");
  showStatus(verified?"Account freshly verified. Check the code shown in your own desktop application.":
   "Confirm your identity again with Google or GitHub before authorizing this device.");
 }else{
  showStatus("Sign in with your verified Adminerva account, then enter the desktop code.");
 }
}
onAuthStateChanged(auth,render);
async function authenticate(provider){
 if(busy||approved||!validFlowId(flowId))return;
 busy=true;
 try{
  const existing=auth.currentUser;
  const result=existing?
   await reauthenticateWithPopup(existing,provider):
   await signInWithPopup(auth,provider);
  const user=result.user;
  if(!user||!user.emailVerified||!user.email)
   throw Error("verified-email-required");
  const idToken=await user.getIdTokenResult(true);
  const authenticatedAt=Date.parse(idToken.authTime);
  if(!Number.isFinite(authenticatedAt)||authenticatedAt>Date.now()+30000||
     Date.now()-authenticatedAt>4*60*1000)
   throw Error("recent-signin-required");
  if(auth.currentUser?.uid!==user.uid)throw Error("account-changed");
  reauthenticatedUid=user.uid;
  proofAtMs=Date.now();
  render();
 }catch(error){
  reauthenticatedUid=null;proofAtMs=0;
  showStatus(error?.code==="auth/popup-closed-by-user"?
   "The verification window was closed. Retry when ready.":
   error?.code==="auth/user-mismatch"?
   "Use the Google or GitHub identity linked to the current account, or select Use another account.":
   error?.message==="verified-email-required"?
   "You must use an account with a verified email address.":
   "Verification failed. Use the provider linked to your Adminerva account and try again.");
 }finally{busy=false;approveButton.disabled=!freshProof(auth.currentUser)||approved;}
}
document.getElementById("native-google").addEventListener("click",()=>void authenticate(new GoogleAuthProvider()));
document.getElementById("native-github").addEventListener("click",()=>{
 const provider=new GithubAuthProvider();
 provider.addScope("read:user");provider.addScope("user:email");
 void authenticate(provider);
});
approveButton.addEventListener("click",async()=>{
 const user=auth.currentUser;
 if(busy||approved||!freshProof(user)||!validFlowId(flowId))return;
 const confirmationCode=codeInput.value.trim();
 if(!/^\d{8}$/.test(confirmationCode)){
  showStatus("Enter the eight-digit code shown by your own desktop application.");
  return;
 }
 busy=true;approveButton.disabled=true;
 try{
  const current=await user.getIdTokenResult(true);
  if(!freshProof(user)||Date.now()-Date.parse(current.authTime)>5*60*1000)
   throw Error("recent-signin-required");
  const action=httpsCallable(getFunctions(app,"asia-southeast1"),"nativeClientHandoff");
  const result=await action({action:"authorize",flowId,confirmationCode});
  if(result.data?.state!=="approved")throw Error("Unexpected pairing state.");
  codeInput.value="";approved=true;
  render();
 }catch(error){
  const code=String(error?.code||"");
  if(code.includes("unauthenticated")||error.message==="recent-signin-required"){
   reauthenticatedUid=null;proofAtMs=0;
  }
  showStatus(code.includes("resource-exhausted")?
   "Too many attempts. Start a fresh sign-in later or contact your administrator.":
   code.includes("failed-precondition")?
   "Desktop pairing expired or native sign-in is not enabled. Restart the pairing after release.":
   code.includes("unauthenticated")||error.message==="recent-signin-required"?
   "Verify your account again before authorizing the desktop.":
   code.includes("permission-denied")?
   "The code or account was not accepted. Check the desktop code and your account.":
   "Desktop approval could not finish. Check the code and try again.");
 }finally{busy=false;approveButton.disabled=approved||!freshProof(auth.currentUser);}
});
render();
