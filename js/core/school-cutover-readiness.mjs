import {app,auth} from "./firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "./tenant-school-picker.mjs?v=4.0.0";

const api=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolCutoverReadiness");
const el=id=>document.getElementById(id);
let busy=false,epoch=0;

function say(message,error=false){
  el("cutoverStatus").textContent=message;
  el("cutoverStatus").className="text-sm mt-3 "+(error?"text-rose-700":"text-slate-600");
}
function card(value,label){
  const node=document.createElement("div");node.className="rounded-xl border bg-white p-4 shadow-sm";
  const strong=document.createElement("strong");strong.className="block text-2xl font-extrabold";strong.textContent=String(value);
  const span=document.createElement("span");span.className="text-xs text-slate-500";span.textContent=label;
  node.append(strong,span);return node;
}
function render(result){
  el("cutoverMode").textContent=result.schoolDisplayName+" · compatibility "+String(result.compatibilityMode||"legacy_allowed").replace("_"," ");
  el("cutoverSummary").replaceChildren(
    card(result.ready?"Ready":"Blocked","Cutover status"),
    card(result.counts?.activeMemberships||0,"Active memberships"),
    card(result.counts?.activeOfferings||0,"Active offerings"),
    card(result.counts?.deployedAssessments||0,"Deployed assessments")
  );
  const host=el("cutoverChecks");host.replaceChildren();
  for(const check of result.checks||[]){
    const row=document.createElement("article");row.className="p-4 sm:p-5 flex gap-3 items-start";
    const mark=document.createElement("span");
    mark.className="grid place-items-center rounded-full h-7 w-7 shrink-0 font-extrabold "+(check.ok?"bg-emerald-100 text-emerald-700":"bg-rose-100 text-rose-700");
    mark.textContent=check.ok?"✓":"!";
    const text=document.createElement("div"),heading=document.createElement("strong"),detail=document.createElement("p");
    heading.className="text-sm";heading.textContent=check.label;
    detail.className="text-xs text-slate-500 mt-1";detail.textContent=check.detail;
    text.append(heading,detail);row.append(mark,text);host.append(row);
  }
  el("cutoverWorkspace").hidden=false;
}
async function load(){
  if(busy)return;
  const sequence=++epoch,lease=picker.scope.lease();busy=true;el("cutoverRefresh").disabled=true;
  say("Running bounded canonical readiness checks…");
  try{
    const result=(await api({schoolId:lease.schoolId,action:"overview"})).data;
    picker.scope.assertLease(lease);if(sequence!==epoch)return;
    render(result);
    say(result.ready?
      "Technical readiness checks passed. Platform-owner migration/backup/rollback attestations are still required.":
      result.blockers.length+" technical readiness blocker(s) remain.");
  }catch(error){if(sequence===epoch)say(error?.message||"Readiness checks could not complete.",true);}
  finally{if(sequence===epoch){busy=false;el("cutoverRefresh").disabled=false;}}
}
const picker=createTenantSchoolPicker({
  host:el("cutoverSchoolSwitcher"),status:el("cutoverStatus"),
  onBeforeChange:async()=>{
    if(busy)throw new Error("Finish the readiness check before switching schools.");
    ++epoch;el("cutoverWorkspace").hidden=true;
  },
  onReady:scope=>{if(scope.current)void load();}
});
el("cutoverRefresh").addEventListener("click",()=>void load());
try{
  await picker.load();
  if(!auth.currentUser)say("Sign in with a verified school administrator account.",true);
}catch(error){say(error?.message||"Unable to load cutover readiness.",true);}
