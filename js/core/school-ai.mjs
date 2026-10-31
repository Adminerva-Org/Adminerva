/** School-scoped AI connection. Browser code never receives the school's key. */
import {app,auth} from "./firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";

const functions=getFunctions(app,"asia-southeast1");
const aiCallable=httpsCallable(functions,"schoolAI");
const tenantCallable=httpsCallable(functions,"tenantSchools");
let cachedStatus=null,cachedSchool=null,schoolLookup=null;

const preferredKey=uid=>"Adminerva_last_verified_school_"+uid;
function preferred(uid){try{return sessionStorage.getItem(preferredKey(uid))||null;}catch{return null;}}
async function activeSchool({refresh=false}={}){
  await auth.authStateReady();
  const user=auth.currentUser;
  if(!user?.uid||!user.emailVerified)throw Error("Sign in with a verified school account before using school AI.");
  if(!refresh&&cachedSchool?.uid===user.uid)return cachedSchool;
  if(!schoolLookup||refresh){
    schoolLookup=tenantCallable({preferredSchoolId:preferred(user.uid)}).then(response=>{
      const schools=Array.isArray(response.data?.schools)?response.data.schools:[];
      let schoolId=response.data?.selection?.schoolId||null;
      if(!schoolId&&schools.length===1)schoolId=schools[0].schoolId;
      if(!schoolId&&schools.length>1){
        const remembered=preferred(user.uid);
        if(schools.some(school=>school.schoolId===remembered))schoolId=remembered;
      }
      if(!schoolId){
        if(!schools.length)throw Error("No active school membership is available for School AI.");
        throw Error("Choose your active school from the account menu before using School AI.");
      }
      const school=schools.find(item=>item.schoolId===schoolId);
      if(!school)throw Error("The selected school is no longer available.");
      cachedSchool={uid:user.uid,schoolId,name:school.name||schoolId,
        roles:Array.isArray(school.roles)?school.roles:[]};
      return cachedSchool;
    }).finally(()=>{schoolLookup=null;});
  }
  return schoolLookup;
}
async function call(data,{signal}={}){
  const user=auth.currentUser||await auth.authStateReady().then(()=>auth.currentUser);
  if(!user)throw Error("Sign in before using school AI.");
  const school=await activeSchool();
  const result=(await aiCallable({schoolId:school.schoolId,...data},{signal})).data;
  if(auth.currentUser?.uid!==user.uid)throw Error("Account changed. The returned AI draft was ignored.");
  const latest=await activeSchool();
  if(latest.schoolId!==school.schoolId)throw Error("School changed. The returned AI draft was ignored.");
  return result;
}
export async function schoolAIStatus({refresh=false}={}){
  const school=await activeSchool({refresh});
  const key=school.uid+":"+school.schoolId;
  if(!refresh&&cachedStatus?.key===key&&cachedStatus.at>Date.now()-60000)return cachedStatus.value;
  const value=await call({action:"status"});cachedStatus={key,at:Date.now(),value};return value;
}
export async function configureSchoolAI(values){
  const value=await call({action:"configure",...values});
  cachedStatus=null;return value;
}
export async function generateSchoolContent(payload,{signal,purpose="lesson"}={}){
  const status=await schoolAIStatus();
  if(!status.canGenerate)throw Error("Your active school role does not include teacher AI access.");
  if(!status.configured)
    throw Error("School AI is not enabled for this school. Ask a school administrator to configure it; you can continue manually.");
  const requestId=crypto.randomUUID();
  for(let attempt=0;attempt<3;attempt++){
    if(signal?.aborted)throw new DOMException("Cancelled","AbortError");
    try{return await call({action:"generate",payload,purpose,requestId},{signal});}
    catch(error){
      const code=String(error?.code||"").toUpperCase();
      if(!code.includes("RESOURCE_EXHAUSTED")||
         !String(error?.message||"").toLowerCase().includes("busy")||attempt===2)throw error;
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(resolve,4000*(attempt+1));
        signal?.addEventListener("abort",()=>{
          clearTimeout(timer);reject(new DOMException("Cancelled","AbortError"));
        },{once:true});
      });
    }
  }
}
export async function activeSchoolForAI(){return activeSchool();}
function invalidate(){
  cachedStatus=null;cachedSchool=null;schoolLookup=null;
}
document.addEventListener("adminerva:preferred-school-changed",invalidate);
document.addEventListener("adminerva:school-ready",event=>{
  if(cachedSchool&&event.detail?.schoolId!==cachedSchool.schoolId)invalidate();
});
auth.onAuthStateChanged(()=>invalidate());
