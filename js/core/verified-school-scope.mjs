/**
 * V4 school scope for opted-in workspaces. The callable is authoritative;
 * browser state is a display hint, never a school membership or role grant.
 * Do not install on the legacy 3.0 auth guard before backend cutover.
 */
export function schoolWorkspaceKey(uid,schoolId,workspace) {
  const parts=[uid,schoolId,workspace];
  if(parts.some(part=>typeof part!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(part)))
    throw new Error("A verified account, school and workspace are required.");
  return "adminerva:v4:"+parts.join(":");
}
export function pickerState(options,preferredSchoolId) {
  const choices=Array.isArray(options)?options.filter(option=>
    option && typeof option.schoolId==="string" && Array.isArray(option.roles) && option.roles.length):[];
  if(!choices.length)return {state:"no_school",schoolId:null,showSwitcher:false};
  if(choices.length===1)return {state:"ready",schoolId:choices[0].schoolId,showSwitcher:false};
  const current=choices.find(option=>option.schoolId===preferredSchoolId);
  return {state:current?"ready":"choose_school",schoolId:current?.schoolId||null,showSwitcher:true};
}
export function createVerifiedSchoolScope({loadSchools,beforeChange=async()=>{},onChange=()=>{}}) {
  let generation=0,active=null,options=[],refreshRequest=0;
  async function refresh({uid,preferredSchoolId=null}={}) {
    if(typeof uid!=="string"||!uid)throw new Error("A signed-in account is required.");
    const requested=++refreshRequest,previous=active;
    // A host may veto switching while a submission/import is still being saved.
    // Do not invalidate that action's lease if the switch is vetoed.
    if(previous)await beforeChange({previous,next:null});
    if(requested!==refreshRequest)return null;
    const run=++generation;
    // After cleanup, old school leases and private views are invalid immediately.
    active=null;options=[];
    onChange({state:"checking",schoolId:null,showSwitcher:false,options:[],context:null,generation});
    try {
      const payload=await loadSchools(preferredSchoolId);
      if(requested!==refreshRequest||run!==generation)return null;
      const nextOptions=Array.isArray(payload?.schools)?payload.schools:[];
      const state=pickerState(nextOptions,preferredSchoolId);
      active=state.schoolId?{
        uid,schoolId:state.schoolId,
        roles:nextOptions.find(s=>s.schoolId===state.schoolId)?.roles||[]
      }:null;
      options=nextOptions;
      const resolved={...state,options:[...options],context:active,generation};
      onChange(resolved);
      return resolved;
    }catch(error) {
      if(requested===refreshRequest && run===generation){
        active=null;options=[];
        onChange({state:"unavailable",schoolId:null,showSwitcher:false,
          options:[],context:null,generation,error:error?.message||"School access unavailable"});
      }
      throw error;
    }
  }
  return Object.freeze({
    refresh,
    get current(){return active;},
    lease(){
      if(!active)throw new Error("School access must be verified before continuing.");
      return Object.freeze({uid:active.uid,schoolId:active.schoolId,generation});
    },
    assertLease(lease) {
      if(!active||!lease||lease.generation!==generation||lease.uid!==active.uid||lease.schoolId!==active.schoolId)
        throw new Error("Your school changed. Review the current school and retry this action.");
      return true;
    },
    clear(){
      refreshRequest++;generation++;const previous=active;active=null;options=[];
      onChange({state:"no_school",schoolId:null,showSwitcher:false,options:[],context:null,generation,previous});
    }
  });
}
/** Accessible account-menu chooser, only rendered when >1 verified membership exists. */
export function renderSchoolSwitcher(container,{options=[],schoolId=null,onSelect=async()=>{}}={}) {
  container.replaceChildren();
  const state=pickerState(options,schoolId);
  container.hidden=!state.showSwitcher;
  if(!state.showSwitcher)return state;
  const label=document.createElement("label");
  label.textContent="Active school";
  const select=document.createElement("select");
  select.className="av-school-select";
  select.setAttribute("aria-label","Switch active school");
  const placeholder=document.createElement("option");
  placeholder.value="";placeholder.textContent="Choose a school";
  select.append(placeholder);
  for(const school of options) {
    const option=document.createElement("option");
    option.value=school.schoolId;option.textContent=school.name||school.schoolId;
    option.selected=school.schoolId===state.schoolId;
    select.append(option);
  }
  const status=document.createElement("span");
  status.setAttribute("role","status");status.setAttribute("aria-live","polite");
  select.addEventListener("change",async()=>{
    select.disabled=true;status.textContent="Checking school access…";
    try {
      await onSelect(select.value);
      status.textContent="School selected";
    }catch(error){
      status.textContent=error?.message||"School access could not be confirmed.";
      select.value=schoolId||"";
    }finally{select.disabled=false;}
  });
  label.append(select);
  container.append(label,status);
  return state;
}
