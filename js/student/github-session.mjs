import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {
  GithubAuthProvider,linkWithCredential,linkWithPopup,reauthenticateWithPopup
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";

const functions=getFunctions(app,"asia-southeast1");
const recoveredLinkApi=httpsCallable(functions,"prepareRecoveredGithubLink");

function key(kind,uid=auth.currentUser?.uid){
  return uid?"Adminerva_GitHub_"+kind+"_"+uid:"";
}
export function getGithubSession(uid=auth.currentUser?.uid){
  if(!uid)return {token:"",username:"",active:false};
  const token=String(sessionStorage.getItem(key("Token",uid))||"").trim();
  const username=String(sessionStorage.getItem(key("Username",uid))||"").trim().replace(/^@/,"");
  return {token,username,active:Boolean(token)};
}
export function clearGithubSession(uid=auth.currentUser?.uid){
  if(!uid)return;
  sessionStorage.removeItem(key("Token",uid));
  sessionStorage.removeItem(key("Username",uid));
  document.dispatchEvent(new CustomEvent("adminerva:github-session",{detail:{uid,active:false,username:""}}));
}
async function githubIdentity(token){
  const response=await fetch("https://api.github.com/user",{
    headers:{
      Accept:"application/vnd.github+json",
      "X-GitHub-Api-Version":"2022-11-28",
      Authorization:"Bearer "+token
    }
  });
  if(!response.ok)throw new Error("GitHub identity verification returned HTTP "+response.status+".");
  const data=await response.json(),providerUid=String(data?.id||""),
    username=String(data?.login||"").trim().replace(/^@/,"");
  if(!/^[0-9]{1,32}$/.test(providerUid)||!username)
    throw new Error("GitHub did not return a valid account identity.");
  return {providerUid,username};
}
function remember(uid,token,username){
  sessionStorage.setItem(key("Token",uid),token);
  if(username)sessionStorage.setItem(key("Username",uid),username);
  document.dispatchEvent(new CustomEvent("adminerva:github-session",{
    detail:{uid,active:true,username}
  }));
  return {token,username,active:true};
}
export function firebaseGithubLinked(user=auth.currentUser){
  return Boolean(user?.providerData?.some(provider=>provider.providerId==="github.com"));
}
export async function authorizeGithubSession(){
  const user=auth.currentUser;
  if(!user?.uid)throw new Error("Sign in to your Adminerva account before connecting GitHub.");
  const uid=user.uid,provider=new GithubAuthProvider();
  provider.addScope("repo");provider.addScope("read:user");
  let result,credential;
  try{
    result=firebaseGithubLinked(user)
      ?await reauthenticateWithPopup(user,provider)
      :await linkWithPopup(user,provider);
    if(auth.currentUser?.uid!==uid)throw new Error("Adminerva account changed during GitHub authorization.");
    credential=GithubAuthProvider.credentialFromResult(result);
  }catch(error){
    if(error?.code!=="auth/credential-already-in-use")throw error;
    const pending=GithubAuthProvider.credentialFromError(error),
      pendingToken=String(pending?.accessToken||"");
    if(!pending||!pendingToken)
      throw new Error("GitHub did not return a transferable authorization credential.");
    const identity=await githubIdentity(pendingToken);
    const released=await recoveredLinkApi({githubProviderUid:identity.providerUid});
    if(auth.currentUser?.uid!==uid)throw new Error("Adminerva account changed during GitHub recovery.");
    if(Number(released?.data?.released||0)<1)
      throw new Error("This GitHub account belongs to another Adminerva sign-in and is not part of this recovered student identity.");
    result=await linkWithCredential(user,pending);
    credential=pending;
  }
  const token=String(credential?.accessToken||"");
  if(!token)throw new Error("GitHub did not return a usable session credential.");
  const identity=await githubIdentity(token);
  if(auth.currentUser?.uid!==uid)throw new Error("Adminerva account changed during GitHub authorization.");
  return remember(uid,token,identity.username);
}
