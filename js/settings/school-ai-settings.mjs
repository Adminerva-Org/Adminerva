import {auth} from "../core/firebase-core.js?v=1.3.0";
import {schoolAIStatus,configureSchoolAI} from "../core/school-ai.mjs?v=1.3.0";
const root=document.getElementById("panel-security");
if(root){
  const card=document.createElement("section");card.id="schoolAIConnection";card.className="rounded-2xl border border-cyan-200 bg-cyan-50 p-5 mb-6";
  card.innerHTML=`<h3 class="text-lg font-extrabold text-cyan-950">School AI connection</h3><p class="text-sm text-cyan-950 mt-2">One connection for lesson plans, slides and assessment drafts. Teachers do not need the school key.</p><p id="schoolAISettingsStatus" role="status" class="text-sm mt-3">Loading school connection…</p><form id="schoolAIConnectionForm" hidden class="mt-4 space-y-3"><div class="grid sm:grid-cols-2 gap-3"><label class="text-sm font-semibold">School Gemini key <span class="font-normal">(leave blank to keep current)</span><input id="schoolAIKey" type="password" autocomplete="new-password" class="block w-full rounded-lg border p-2 mt-1"></label><label class="text-sm font-semibold">Model ID<input id="schoolAIModel" value="gemini-3.8-flash" class="block w-full rounded-lg border p-2 mt-1"></label><label class="text-sm font-semibold">Requests per teacher per day<input id="schoolAIDaily" type="number" min="1" max="500" value="100" class="block w-full rounded-lg border p-2 mt-1"></label><label class="text-sm font-semibold">School requests at the same time<input id="schoolAIConcurrent" type="number" min="1" max="10" value="6" class="block w-full rounded-lg border p-2 mt-1"></label></div><label class="flex items-center gap-2 text-sm"><input id="schoolAIEnabled" type="checkbox" checked> Enable school AI for authorized teachers</label><div class="flex flex-wrap gap-2"><button type="submit" class="rounded-lg bg-cyan-800 text-white font-bold px-4 py-2">Save school connection</button><button id="schoolAIImportSaved" type="button" class="rounded-lg border border-cyan-500 bg-white font-bold text-cyan-900 px-4 py-2">Use my saved administrator key</button></div><p class="text-xs text-cyan-950">The school key stays on the server. Request limits apply to each teacher; AI produces drafts that teachers review before publishing.</p></form>`;
  root.prepend(card);
  const el=id=>card.querySelector("#"+id),message=text=>{el("schoolAISettingsStatus").textContent=text;};
  let owner=null;
  function fill(status){
    el("schoolAIConnectionForm").hidden=!status.canManage;el("schoolAIModel").value=status.model;el("schoolAIDaily").value=status.dailyLimit;el("schoolAIConcurrent").value=status.maxConcurrent;el("schoolAIEnabled").checked=status.enabled;
    message(status.configured?"School AI is ready · "+status.model+" · "+status.dailyLimit+" requests per teacher each day.":status.canManage?"Enable the connection once using your saved administrator key or a new school key.":"School AI is awaiting administrator setup. Your personal connection remains available if you configured one.");
  }
  async function save(importSaved=false){
    if(!owner||auth.currentUser?.uid!==owner)return message("Account changed. Reload settings.");
    const buttons=card.querySelectorAll("button");buttons.forEach(button=>button.disabled=true);message("Saving school connection…");
    try{
      const result=await configureSchoolAI({apiKey:el("schoolAIKey").value.trim()||undefined,model:el("schoolAIModel").value.trim(),dailyLimit:Number(el("schoolAIDaily").value),maxConcurrent:Number(el("schoolAIConcurrent").value),enabled:el("schoolAIEnabled").checked,useSavedAdministratorKey:importSaved});
      el("schoolAIKey").value="";fill(result);message("School connection saved. Authorized teachers can now use it without entering a key.");
    }catch(error){message("School connection could not be saved: "+error.message);}finally{buttons.forEach(button=>button.disabled=false);}
  }
  el("schoolAIConnectionForm").addEventListener("submit",event=>{event.preventDefault();void save();});
  el("schoolAIImportSaved").onclick=()=>void save(true);
  auth.onAuthStateChanged(async user=>{owner=user?.uid||null;el("schoolAIConnectionForm").hidden=true;if(!user)return message("Sign in to view your school connection.");try{const result=await schoolAIStatus({refresh:true});if(auth.currentUser?.uid===owner)fill(result);}catch(error){message("School connection could not load: "+error.message);}});
}
