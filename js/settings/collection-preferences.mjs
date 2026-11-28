import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
export function mountCollectionPreferences(root){
  if(!root||root.dataset.mounted)return;
  root.dataset.mounted="true";
  root.innerHTML=`<div class="av-settings-preference-row"><span><strong>Essential operational records</strong><small>Account security, required school records and backend outcomes are kept separately from optional browser observations.</small></span></div>
          <div class="av-settings-preference-row"><span><strong>Detailed browser diagnostics</strong><small>Page and control events, errors and process timing. No typed text, scores or source code. Enabled unless you turn it off.</small></span><button type="button" data-browser-collection class="av-secondary-button" disabled>Checking…</button></div>
          <div class="av-settings-preference-row" data-research-row hidden><span><strong>Test-account Studio research</strong><small>Limited project, edit-count and run statistics for designated test students. Separate from grades.</small></span><button type="button" data-research-collection class="av-secondary-button" disabled>Checking…</button></div>
          <p data-collection-status role="status" class="av-settings-muted"></p>`;
  let owner="",authVersion=0;
  const browserCall=httpsCallable(getFunctions(app,"asia-southeast1"),"platformAccountDiagnostics");
  const researchCall=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolPilotResearch");
  const browserButton=root.querySelector("[data-browser-collection]"),researchButton=root.querySelector("[data-research-collection]"),researchRow=root.querySelector("[data-research-row]"),collectionStatus=root.querySelector("[data-collection-status]");
  let privacyState={browser:null,research:null},privacyTurn=0;
  function paintCollection(){
    browserButton.textContent=privacyState.browser===null?"Unavailable":privacyState.browser?"Turn off":"Turn on";
    browserButton.disabled=privacyState.browser===null||!owner;
    researchRow.hidden=privacyState.research===null;
    researchButton.textContent=privacyState.research?"Turn off":"Turn on";researchButton.disabled=privacyState.research===null||!owner;
  }
  async function loadCollection(version){
    const uid=owner,turn=++privacyTurn;privacyState={browser:null,research:null};paintCollection();collectionStatus.textContent=uid?"Checking collection settings…":"";
    if(!uid)return;
    const [b,r]=await Promise.allSettled([browserCall({action:"privacy_status"}),researchCall({action:"privacy_status"})]);
    if(version!==authVersion||uid!==owner||auth.currentUser?.uid!==uid||turn!==privacyTurn)return;
    if(b.status==="fulfilled"&&typeof b.value.data?.browserEnabled==="boolean")privacyState.browser=b.value.data.browserEnabled;
    if(r.status==="fulfilled"&&r.value.data?.designated===true)privacyState.research=r.value.data.enabled===true;
    paintCollection();collectionStatus.textContent=privacyState.browser===null?"Could not load browser diagnostics preference. Reload to retry.":"";
  }
  async function changeCollection(kind){
    const uid=owner,version=authVersion,turn=++privacyTurn,value=privacyState[kind];
    if(!uid||auth.currentUser?.uid!==uid||value===null)return;
    browserButton.disabled=true;researchButton.disabled=true;collectionStatus.textContent="Saving collection preference…";
    try{
      const response=kind==="browser"?await browserCall({action:"set_browser_collection",enabled:!value}):await researchCall({action:"set_research_collection",enabled:!value});
      if(version!==authVersion||owner!==uid||auth.currentUser?.uid!==uid||turn!==privacyTurn)return;
      privacyState[kind]=kind==="browser"?response.data?.browserEnabled===true:response.data?.enabled===true;
      if(kind==="browser"&&!privacyState.browser)document.dispatchEvent(new Event("adminerva:browser-diagnostics-disabled"));
      collectionStatus.textContent=privacyState[kind]?"Enabled. New pages will use this preference.":"Disabled. New collection is blocked; earlier records remain subject to retention.";
    }catch{if(version===authVersion&&owner===uid&&turn===privacyTurn)collectionStatus.textContent="Could not save. Your previous preference is unchanged; reload to verify.";}finally{if(version===authVersion&&owner===uid&&turn===privacyTurn)paintCollection();}
  }
  browserButton.addEventListener("click",()=>void changeCollection("browser"));
  researchButton.addEventListener("click",()=>void changeCollection("research"));

  onAuthStateChanged(auth,user=>{
    owner=user?.emailVerified?user.uid:"";
    root.hidden=!owner;
    void loadCollection(++authVersion);
  });
}
const standalone=document.querySelector("[data-collection-preferences-standalone]");
if(standalone)mountCollectionPreferences(standalone);
