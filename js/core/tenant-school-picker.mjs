/**
 * Opt-in V4 account-menu school picker. Deploy after tenantSchools backend and
 * school migration are ready; the legacy admission/navigation remains unchanged.
 */
import {app,auth} from "./firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createVerifiedSchoolScope,renderSchoolSwitcher} from "./verified-school-scope.mjs";
const callable=httpsCallable(getFunctions(app,"asia-southeast1"),"tenantSchools");
const preferredKey=uid=>"Adminerva_last_verified_school_"+uid;
function preferred(uid) {try{return sessionStorage.getItem(preferredKey(uid))||null;}catch{return null;}}
function remember(uid,id) {try{if(id)sessionStorage.setItem(preferredKey(uid),id);}catch{}}
export function createTenantSchoolPicker({host,status,onBeforeChange=async()=>{},onReady=()=>{}}) {
  const scope=createVerifiedSchoolScope({
    loadSchools:async preferredSchoolId=>(await callable({preferredSchoolId})).data,
    beforeChange:onBeforeChange,
    onChange:state=>{
      if(status)status.textContent=state.state==="checking"?"Checking school access…":
        state.state==="unavailable"?"School access is unavailable. Retry when connected.":
        state.state==="no_school"?"No verified school membership. Request an invitation.":
        state.state==="choose_school"?"Choose an authorized school.":"School access confirmed.";
      if(state.context){
        remember(state.context.uid,state.context.schoolId);
        document.dispatchEvent(new CustomEvent("adminerva:school-ready",{detail:{
          schoolId:state.context.schoolId,roles:state.context.roles,generation:state.generation
        }}));
      }
      renderSchoolSwitcher(host,{
        options:state.options||[],schoolId:state.context?.schoolId||null,
        onSelect:async schoolId=>{
          const uid=auth.currentUser?.uid;
          const response=await scope.refresh({uid,preferredSchoolId:schoolId});
          if(response?.schoolId!==schoolId)throw new Error("School access changed. Choose an available school.");
        }
      });
      if(state.context)onReady(scope);
    }
  });
  return {
    scope,
    async load() {
      await auth.authStateReady();
      const uid=auth.currentUser?.uid;
      if(!uid){scope.clear();return null;}
      return scope.refresh({uid,preferredSchoolId:preferred(uid)});
    },
    signOut(){scope.clear();host.replaceChildren();host.hidden=true;}
  };
}
