import {auth} from "../core/firebase-core.js?v=1.3.0";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getPushPreferences,savePushPreferences,getDevicePushState,
  enableDevicePush,disableDevicePush,syncDevicePush,sendTestPush
} from "../core/push-notifications.mjs?v=1.3.8";

const root=document.querySelector("[data-account-preferences]");
if(root){
  const staff=root.dataset.accountPreferences==="staff";
  const pushChoices=staff
    ?[['submission','Student submissions & evidence'],['grading','Grading alerts'],['issue','Reports & replies']]
    :[['assessment','New assessments'],['submission','Submission updates / action required'],['grade','Published or corrected grades'],['issue','Reports & replies']];
  const pushMarkup=`
    <fieldset class="mt-6" data-push-settings>
      <legend class="font-bold">Device notifications</legend>
      <p class="av-form-hint">Push alerts are on by default. Enable this device once to receive them.</p>
      <label class="av-preference-option mt-3"><input type="checkbox" data-push-master checked> ${staff?'Push important teaching alerts to my enabled devices':'Push important student alerts to my enabled devices'}</label>
      <div class="av-preference-options mt-2" data-push-options>
        ${pushChoices.map(([value,label])=>`<label class="av-preference-option"><input type="checkbox" value="${value}" checked> ${label}</label>`).join('')}
      </div>
      <div class="flex flex-wrap gap-2 mt-3">
        <button type="button" data-enable-push class="av-primary-button">Enable notifications on this device</button>
        <button type="button" data-test-push class="hidden border rounded px-4 py-2 text-sm font-bold text-blue-700">Send test ping</button>
        <button type="button" data-disable-push class="hidden border rounded px-4 py-2 text-sm font-bold">Disable on this device</button>
      </div>
      <p data-push-status role="status" class="av-badge mt-3"></p>
    </fieldset>`;
  root.innerHTML='<h2 id="notifications" class="text-xl font-bold">Notifications &amp; display</h2><p class="av-form-hint">Choose inbox alerts, device push, and motion preferences.</p><form data-notification-form><fieldset><legend class="font-bold mb-3">Show in my inbox</legend><div class="av-preference-options" data-notification-options></div></fieldset>'+pushMarkup+'<fieldset class="mt-6"><legend class="font-bold">Motion</legend><label class="av-preference-option"><input type="checkbox" data-reduce-motion> Reduce decorative motion</label></fieldset><button type="submit" class="av-primary-button mt-4">Save my preferences</button><p data-preference-status role="status" class="av-form-hint" hidden></p></form>';
  const categories=[["issue","Reports & replies"],["grade","Published grades"],["assessment","Assignments"],["release","Website updates"],["submission",staff?"Student submissions":"Submission updates"],...(staff?[["grading","Grading alerts"]]:[])];
  const options=root.querySelector("[data-notification-options]");
  for(const [value,title]of categories){const label=document.createElement("label"),input=document.createElement("input");label.className="av-preference-option";input.type="checkbox";input.value=value;input.name="notificationCategory";label.append(input,document.createTextNode(title));options.append(label);}
  const pushMaster=root.querySelector("[data-push-master]");
  const pushOptions=[...root.querySelectorAll("[data-push-options] input")];
  const enablePush=root.querySelector("[data-enable-push]");
  const testPush=root.querySelector("[data-test-push]");
  const disablePush=root.querySelector("[data-disable-push]");
  const pushStatus=root.querySelector("[data-push-status]");
  let owner="",muted=new Set(),authVersion=0;

  function setPushBusy(value){
    if(enablePush)enablePush.disabled=value;
    if(testPush)testPush.disabled=value;
    if(disablePush)disablePush.disabled=value;
    if(pushMaster)pushMaster.disabled=value;
    for(const input of pushOptions)input.disabled=value;
  }
  async function refreshPush(version=authVersion){
    if(!owner||version!==authVersion)return;
    const uid=owner;
    const prefs=await getPushPreferences(uid);
    if(version!==authVersion||owner!==uid)return;
    pushMaster.checked=prefs.enabled!==false;
    for(const input of pushOptions)input.checked=prefs[input.value]!==false;
    let state=await getDevicePushState();
    if(version!==authVersion||owner!==uid)return;
    if(state.permission==="granted"&&!state.registered&&!state.deviceOptedOut&&prefs.enabled!==false&&state.supported&&state.configured){
      pushStatus.textContent="Reconnecting…";
      const result=await syncDevicePush();
      if(version!==authVersion||owner!==uid)return;
      state=await getDevicePushState();
      if(version!==authVersion||owner!==uid)return;
      if(!state.registered&&result?.reason==="registration-error")
        pushStatus.textContent="Reconnect failed. Select Enable notifications to retry.";
    }
    const registered=state.permission==="granted"&&state.registered;
    enablePush.classList.toggle("hidden",registered);
    testPush.classList.toggle("hidden",!registered);
    disablePush.classList.toggle("hidden",!registered);
    if(!state.supported){
      enablePush.disabled=true;
      pushStatus.textContent="Push unavailable in this browser.";
    }else if(!state.configured){
      enablePush.disabled=true;
      pushStatus.textContent="Push setup pending.";
    }else if(state.permission==="denied"){
      enablePush.disabled=true;
      pushStatus.textContent="Blocked by browser or device settings.";
    }else if(state.deviceOptedOut){
      enablePush.disabled=false;
      pushStatus.textContent="Off on this device.";
    }else if(registered&&prefs.enabled===false){
      enablePush.disabled=false;
      pushStatus.textContent="Account push is off.";
    }else if(registered){
      enablePush.disabled=false;
      pushStatus.textContent="Enabled on this device.";
    }else if(state.permission==="granted"){
      enablePush.disabled=false;
      if(!pushStatus.textContent.startsWith("Reconnect failed"))
        pushStatus.textContent=prefs.enabled===false?"Account push is off.":"Reconnect this device.";
    }else{
      enablePush.disabled=false;
      pushStatus.textContent="Not enabled on this device.";
    }
  }

  onAuthStateChanged(auth,user=>{
    owner=user?.uid||"";const version=++authVersion;
    root.querySelector("button[type=submit]").disabled=!owner;
    try{const saved=JSON.parse(localStorage.getItem("Adminerva_notif_preferences_"+owner)||"[]");muted=new Set(Array.isArray(saved)?saved:[]);}catch{muted=new Set();}
    for(const input of options.querySelectorAll("input"))input.checked=!muted.has(input.value);
    try{root.querySelector("[data-reduce-motion]").checked=localStorage.getItem("Adminerva_motion_"+owner)==="reduce";}catch{}
    const preferenceStatus=root.querySelector("[data-preference-status]");
    preferenceStatus.hidden=true;preferenceStatus.textContent="";
    if(!owner){
      setPushBusy(true);pushStatus.textContent="Sign in to manage push.";
    }else{
      setPushBusy(false);void refreshPush(version);
    }
  });

  enablePush?.addEventListener("click",async()=>{
    if(!owner||auth.currentUser?.uid!==owner)return;
    const uid=owner;setPushBusy(true);pushStatus.textContent="Requesting permission…";
    try{
      const prefs=await getPushPreferences(uid);
      await savePushPreferences({...prefs,enabled:true},uid);
      await enableDevicePush({requestPermission:true});
      pushStatus.textContent="Enabled on this device.";
    }catch(error){pushStatus.textContent=error.message;}
    finally{if(auth.currentUser?.uid===uid){setPushBusy(false);void refreshPush();}}
  });
  testPush?.addEventListener("click",async()=>{
    if(!owner||auth.currentUser?.uid!==owner)return;
    const uid=owner;setPushBusy(true);pushStatus.textContent="Sending test ping…";
    try{
      const result=await sendTestPush();
      pushStatus.textContent="Test ping sent · closes in about 15 seconds.";
    }catch(error){pushStatus.textContent="Test ping failed: "+error.message;}
    finally{if(auth.currentUser?.uid===uid)setPushBusy(false);}
  });
  disablePush?.addEventListener("click",async()=>{
    if(!owner||auth.currentUser?.uid!==owner)return;
    const uid=owner;setPushBusy(true);pushStatus.textContent="Disabling…";
    try{await disableDevicePush();pushStatus.textContent="Disabled on this device.";}
    catch(error){pushStatus.textContent="Unable to disable this device: "+error.message;}
    finally{if(auth.currentUser?.uid===uid){setPushBusy(false);void refreshPush();}}
  });

  root.querySelector("form").addEventListener("submit",async event=>{
    event.preventDefault();if(!owner||auth.currentUser?.uid!==owner)return;
    const uid=owner;
    try{
      for(const input of options.querySelectorAll("input")){if(input.checked)muted.delete(input.value);else muted.add(input.value);}
      const reduced=root.querySelector("[data-reduce-motion]").checked;
      localStorage.setItem("Adminerva_notif_preferences_"+owner,JSON.stringify([...muted]));localStorage.setItem("Adminerva_motion_"+owner,reduced?"reduce":"system");
      document.documentElement.dataset.motion=reduced?"reduce":"system";
      const values={enabled:pushMaster.checked};
      for(const input of pushOptions)values[input.value]=input.checked;
      await savePushPreferences(values,uid);
      if(values.enabled&&typeof Notification!=="undefined"&&Notification.permission==="granted")void syncDevicePush();
      document.dispatchEvent(new CustomEvent("adminerva-notification-preferences",{detail:{uid:owner}}));
      const preferenceStatus=root.querySelector("[data-preference-status]");
      preferenceStatus.hidden=false;preferenceStatus.textContent="Saved.";
    }catch(error){
      const preferenceStatus=root.querySelector("[data-preference-status]");
      preferenceStatus.hidden=false;preferenceStatus.textContent="Couldn’t save: "+error.message;
    }
  });
  if(location.hash==="#notifications"){window.switchSettingsCategory?.("account");requestAnimationFrame(()=>root.scrollIntoView({block:"start"}));}
}
