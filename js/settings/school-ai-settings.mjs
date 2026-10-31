import {auth} from "../core/firebase-core.js?v=1.3.0";
import {schoolAIStatus,configureSchoolAI,activeSchoolForAI} from "../core/school-ai.mjs?v=4.0.0";

const root=document.getElementById("panel-security");
if(root){
  const card=document.createElement("section");
  card.id="schoolAIConnection";
  card.className="rounded-2xl border border-cyan-200 bg-cyan-50 p-5 mb-6";
  card.innerHTML=`<h3 class="text-lg font-extrabold text-cyan-950">School AI connection</h3>
    <p class="text-sm text-cyan-950 mt-2">The connection is isolated to the active verified school. Teachers never receive the school API key.</p>
    <p id="schoolAISettingsStatus" role="status" class="text-sm mt-3">Loading active school connection…</p>
    <form id="schoolAIConnectionForm" hidden class="mt-4 space-y-3">
      <div class="grid sm:grid-cols-2 gap-3">
        <label class="text-sm font-semibold">School Gemini key <span class="font-normal">(leave blank to keep current)</span>
          <input id="schoolAIKey" type="password" autocomplete="new-password" class="block w-full rounded-lg border p-2 mt-1">
        </label>
        <label class="text-sm font-semibold">Model ID
          <input id="schoolAIModel" value="gemini-3.8-flash" class="block w-full rounded-lg border p-2 mt-1">
        </label>
        <label class="text-sm font-semibold">Requests per teacher per day
          <input id="schoolAIDaily" type="number" min="1" max="500" value="100" class="block w-full rounded-lg border p-2 mt-1">
        </label>
        <label class="text-sm font-semibold">Requests per teacher per minute
          <input id="schoolAIMinute" type="number" min="1" max="30" value="6" class="block w-full rounded-lg border p-2 mt-1">
        </label>
        <label class="text-sm font-semibold">School requests at the same time
          <input id="schoolAIConcurrent" type="number" min="1" max="10" value="6" class="block w-full rounded-lg border p-2 mt-1">
        </label>
      </div>
      <label class="flex items-center gap-2 text-sm">
        <input id="schoolAIEnabled" type="checkbox"> Enable School AI for active teachers in this school
      </label>
      <button type="submit" class="rounded-lg bg-cyan-800 text-white font-bold px-4 py-2">Save school AI settings</button>
      <p class="text-xs text-cyan-950">4.0 does not fall back to a personal browser Gemini key. If this school connection is disabled, teachers continue manually.</p>
    </form>`;
  root.prepend(card);

  const el=id=>card.querySelector("#"+id);
  const message=text=>{el("schoolAISettingsStatus").textContent=text;};
  let owner=null,busy=false;

  function fill(status,school){
    el("schoolAIConnectionForm").hidden=!status.canManage;
    el("schoolAIModel").value=status.model;
    el("schoolAIDaily").value=status.dailyLimit;
    el("schoolAIMinute").value=status.perMinute;
    el("schoolAIConcurrent").value=status.maxConcurrent;
    el("schoolAIEnabled").checked=status.enabled;
    const name=school?.name||status.schoolId||"active school";
    message(status.configured?
      name+" · School AI ready · "+status.model+" · "+status.dailyLimit+" requests per teacher/day.":
      status.canManage?
        name+" · School AI is disabled or has no server key. Configure it here when institutional approval is ready.":
        name+" · School AI is not currently configured. Contact a school administrator.");
  }

  el("schoolAIConnectionForm").addEventListener("submit",event=>{
    event.preventDefault();
    if(busy||!owner||auth.currentUser?.uid!==owner)return;
    void (async()=>{
      busy=true;const buttons=card.querySelectorAll("button");
      buttons.forEach(button=>button.disabled=true);
      message("Saving AI settings only for the active school…");
      try{
        const school=await activeSchoolForAI();
        const result=await configureSchoolAI({
          apiKey:el("schoolAIKey").value.trim()||undefined,
          model:el("schoolAIModel").value.trim(),
          dailyLimit:Number(el("schoolAIDaily").value),
          perMinute:Number(el("schoolAIMinute").value),
          maxConcurrent:Number(el("schoolAIConcurrent").value),
          enabled:el("schoolAIEnabled").checked
        });
        el("schoolAIKey").value="";fill(result,school);
        message((school.name||school.schoolId)+" · School AI settings saved. No other school's connection was changed.");
      }catch(error){message("School AI settings were not saved: "+(error?.message||"check your school access."));}
      finally{busy=false;buttons.forEach(button=>button.disabled=false);}
    })();
  });

  async function load(user){
    owner=user?.uid||null;
    el("schoolAIConnectionForm").hidden=true;
    if(!user)return message("Sign in to view the active school's AI connection.");
    try{
      const [school,status]=await Promise.all([
        activeSchoolForAI(),schoolAIStatus({refresh:true})
      ]);
      if(auth.currentUser?.uid===owner)fill(status,school);
    }catch(error){
      if(auth.currentUser?.uid===owner)
        message(error?.message||"The active school's AI connection could not load.");
    }
  }
  auth.onAuthStateChanged(user=>void load(user));
  document.addEventListener("adminerva:preferred-school-changed",()=>void load(auth.currentUser));
  document.addEventListener("adminerva:school-ready",()=>void load(auth.currentUser));
}
