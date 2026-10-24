/** Server-verified student section projection used by assessment authorization. */
import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";

let pending=null,readyUid="";
export async function ensureStudentAccessProjection(){
  await auth.authStateReady();
  const user=auth.currentUser;
  if(!user?.uid||!user.emailVerified)throw Error("Sign in with your verified school account before loading assignments.");
  if(readyUid===user.uid)return {ready:true};
  if(pending?.uid===user.uid)return pending.operation;
  const uid=user.uid,call=httpsCallable(getFunctions(app,"asia-southeast1"),"refreshStudentAccess");
  const operation=call({}).then(result=>{
    if(auth.currentUser?.uid!==uid)throw Error("Account changed while class access was being prepared.");
    readyUid=uid;
    return result.data||{ready:true};
  }).catch(error=>{
    if(auth.currentUser?.uid!==uid)throw Error("Account changed while class access was being prepared.");
    // Static Pages may publish before the separately deployed Firebase callable.
    // Current production rules remain compatible with the section-scoped queries
    // until refreshStudentAccess + the matching rules are deployed together.
    if(error?.code==="functions/not-found"){
      console.warn("Student access projection is not deployed yet; using the current assessment rules for this session.");
      readyUid=uid;
      return {ready:false,legacyRules:true};
    }
    throw error;
  }).finally(()=>{if(pending?.operation===operation)pending=null;});
  pending={uid,operation};
  return operation;
}
