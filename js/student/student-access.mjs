/** Server-verified student section projection used by assessment authorization. */
import {app,auth,db} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {doc,getDoc} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

let pending=null,readyUid="",readyProjection=null;
function validProfiles(value){
  return Array.isArray(value)?value.filter(profile=>
    profile&&typeof profile.id==="string"&&profile.id&&
    typeof profile.section==="string"&&profile.section.trim()
  ):[];
}
async function persistedProjection(uid){
  const snap=await getDoc(doc(db,"student_access",uid));
  if(!snap.exists())return null;
  const data=snap.data()||{};
  return {
    sections:Array.isArray(data.sections)?data.sections:[],
    studentIds:Array.isArray(data.studentIds)?data.studentIds:[],
    profiles:validProfiles(data.profiles),
    identitySource:String(data.identitySource||"")
  };
}
async function completeProjection(uid,value){
  const projection=value&&typeof value==="object"?{...value}:{};
  projection.profiles=validProfiles(projection.profiles);
  if(projection.profiles.length)return projection;
  try{
    const stored=await persistedProjection(uid);
    if(stored?.profiles?.length)return {...stored,...projection,profiles:stored.profiles};
    return {
      ...projection,
      sections:Array.isArray(projection.sections)?projection.sections:(stored?.sections||[]),
      studentIds:Array.isArray(projection.studentIds)?projection.studentIds:(stored?.studentIds||[]),
      identitySource:String(projection.identitySource||stored?.identitySource||""),
      profiles:[]
    };
  }catch(error){
    console.warn("Stored student access projection could not be read.",error?.code||error?.message||"unknown");
    return projection;
  }
}
export async function ensureStudentAccessProjection(){
  await auth.authStateReady();
  const user=auth.currentUser;
  if(!user?.uid||!user.emailVerified)throw Error("Sign in with your verified school account before loading assignments.");
  if(readyUid===user.uid)return readyProjection||{ready:true};
  if(pending?.uid===user.uid)return pending.operation;
  const uid=user.uid,call=httpsCallable(getFunctions(app,"asia-southeast1"),"refreshStudentAccess");
  const operation=call({}).then(async result=>{
    if(auth.currentUser?.uid!==uid)throw Error("Account changed while class access was being prepared.");
    readyUid=uid;
    readyProjection=await completeProjection(uid,result.data||{ready:true});
    return readyProjection;
  }).catch(async error=>{
    if(auth.currentUser?.uid!==uid)throw Error("Account changed while class access was being prepared.");
    // Static Pages may publish before the separately deployed Firebase callable.
    // Current production rules remain compatible with the section-scoped queries
    // until refreshStudentAccess + the matching rules are deployed together.
    if(error?.code==="functions/not-found"){
      console.warn("Student access projection is not deployed yet; using the current assessment rules for this session.");
      readyUid=uid;
      readyProjection=await completeProjection(uid,{ready:false,legacyRules:true});
      return readyProjection;
    }
    throw error;
  }).finally(()=>{if(pending?.operation===operation)pending=null;});
  pending={uid,operation};
  return operation;
}
