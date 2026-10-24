import {auth} from "../core/firebase-core.js?v=1.3.0";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getPushPreferences,savePushPreferences,getDevicePushState,
  enableDevicePush,disableDevicePush,syncDevicePush,sendTestPush
} from "../core/push-notifications.mjs?v=1.3.1";

const root=document.querySelector("[data-account-preferences]");
if(root){
  const staff=root.dataset.accountPreferences==="staff";
  const pushMarkup=staff?"":`
    <fieldset class="mt-6" data-push-settings>
      <legend class="font-bold">Device notifications</legend>
      <p class="av-form-hint">Assessment assignments, returned submissions, and published grades are enabled by default for your Adminerva account. Your browser still requires a one-time permission before this device can receive push alerts.</p>
      <label class="av-preference-option mt-3"><input type="checkbox" data-push-master checked> Push important student alerts to my enabled devices</label>
      <div class="av-preference-options mt-2" data-push-options>
        <label class="av-preference-option"><input type="checkbox" value="assessment" checked> New assessments</label>
        <label class="av-preference-option"><input type="checkbox" value="submission" checked> Returned submissions / action required</label>
        <label class="av-preference-option"><input type="checkbox" value="grade" checked> Published or corrected grades</label>
      </div>
      <div class="flex flex-wrap gap-2 mt-3">
        <button type="button" data-enable-push class="av-primary-button">Enable notifications on this device</button>
        <button type="button" data-test-push class="hidden border rounded px-4 py-2 text-sm font-bold text-blue-700">Send test ping</button>
        <button type="button" data-disable-push class="hidden border rounded px-4 py-2 text-sm font-bold">Disable on this device</button>
      </div>
      <p data-push-status role="status" class="av-form-hint"></p>
    </fieldset>`;
  root.innerHTML='<h2 id="notifications" class="text-xl font-bold">Notifications &amp; display</h2><p class="av-form-hint">Choose which items appear in your notification inbox on this browser. These choices are private to your signed-in account and do not change school records or email delivery.</p><form data-notification-form><fieldset><legend class="font-bold mb-3">Show in my inbox</legend><div class="av-preference-options" data-notification-options></div></fieldset>'+pushMarkup+'<fieldset class="mt-6"><legend class="font-bold">Motion</legend><label class="av-preference-option"><input type="checkbox" data-reduce-motion> Reduce decorative motion</label><p class="av-form-hint">Your device’s reduced-motion preference is always respected.</p></fieldset><button type="submit" class="av-primary-button mt-4">Save my preferences</button><p data-preference-status role="status" class="av-form-hint"></p></form>';
  const categories=[["issue","Reports & replies"],["grade","Published grades"],["assessment","Assignments"],["release","Website updates"],...(staff?[["submission","Student submissions"],["grading","Grading alerts"]]:[])];
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
    if(staff||!owner||version!==authVersion)return;
    const uid=owner;
    const prefs=await getPushPreferences(uid);
    if(version!==authVersion||owner!==uid)return;
    pushMaster.checked=prefs.enabled!==false;
    for(const input of pushOptions)input.checked=prefs[input.value]!==false;
    const state=await getDevicePushState();
    if(version!==authVersion||owner!==uid)return;
    enablePush.classList.toggle("hidden",state.permission==="granted"&&state.registered);
    testPush.classList.toggle("hidden",!(state.permission==="granted"&&state.registered));
    disablePush.classList.toggle("hidden",!(state.permission==="granted"&&state.registered));
    if(!state.supported){
      enablePush.disabled=true;
      pushStatus.textContent="This browser does not support Adminerva device notifications. In-app notifications remain available.";
    }else if(!state.configured){
      enablePush.disabled=true;
      pushStatus.textContent="Device push setup is pending the school Firebase Web Push key. Your in-app notifications are still active.";
    }else if(state.permission==="denied"){
      enablePush.disabled=true;
      pushStatus.textContent="Notifications are blocked in this browser. Allow notifications for Adminerva in your browser or device settings to enable this device.";
    }else if(state.permission==="granted"&&state.registered){
      enablePush.disabled=false;
      pushStatus.textContent="Device notifications are enabled on this device.";
    }else if(state.permission==="granted"){
      pushStatus.textContent="Permission is granted. Adminerva is reconnecting this device…";
      await syncDevicePush();
      if(version===authVersion&&owner===uid)await refreshPush(version);
    }else{
      enablePush.disabled=false;
      pushStatus.textContent="Important student push categories are ON by default. Enable this device once to receive them outside Adminerva.";
    }
  }

  onAuthStateChanged(auth,user=>{
    owner=user?.uid||"";const version=++authVersion;
    root.querySelector("button[type=submit]").disabled=!owner;
    try{const saved=JSON.parse(localStorage.getItem("Adminerva_notif_preferences_"+owner)||"[]");muted=new Set(Array.isArray(saved)?saved:[]);}catch{muted=new Set();}
    for(const input of options.querySelectorAll("input"))input.checked=!muted.has(input.value);
    try{root.querySelector("[data-reduce-motion]").checked=localStorage.getItem("Adminerva_motion_"+owner)==="reduce";}catch{}
    root.querySelector("[data-preference-status]").textContent=owner?"Your choices are loaded. Changes apply when you save.":"Sign in to save your preferences.";
    if(!staff){
      if(!owner){
        setPushBusy(true);pushStatus.textContent="Sign in to manage device notifications.";
      }else{
        setPushBusy(false);void refreshPush(version);
      }
    }
  });

  enablePush?.addEventListener("click",async()=>{
    if(!owner||auth.currentUser?.uid!==owner)return;
    const uid=owner;setPushBusy(true);pushStatus.textContent="Requesting device notification permission…";
    try{
      const prefs=await getPushPreferences(uid);
      await savePushPreferences({...prefs,enabled:true},uid);
      await enableDevicePush({requestPermission:true});
      pushStatus.textContent="Device notifications are enabled on this device.";
    }catch(error){pushStatus.textContent=error.message;}
    finally{if(auth.currentUser?.uid===uid){setPushBusy(false);void refreshPush();}}
  });
  testPush?.addEventListener("click",async()=>{
    if(!owner||auth.currentUser?.uid!==owner)return;
    const uid=owner;setPushBusy(true);pushStatus.textContent="Sending a test ping to your registered Adminerva devices…";
    try{
      const result=await sendTestPush();
      pushStatus.textContent="Test ping sent to "+result.sent+" registered device"+(result.sent===1?"":"s")+". It is not saved in Adminerva and should close after about 15 seconds.";
    }catch(error){pushStatus.textContent="Test ping failed: "+error.message;}
    finally{if(auth.currentUser?.uid===uid)setPushBusy(false);}
  });
  disablePush?.addEventListener("click",async()=>{
    if(!owner||auth.currentUser?.uid!==owner)return;
    const uid=owner;setPushBusy(true);pushStatus.textContent="Disabling notifications on this device…";
    try{await disableDevicePush();pushStatus.textContent="Device notifications are disabled on this device. Your account preferences remain unchanged for other devices.";}
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
      if(!staff){
        const values={enabled:pushMaster.checked};
        for(const input of pushOptions)values[input.value]=input.checked;
        await savePushPreferences(values,uid);
        if(values.enabled&&typeof Notification!=="undefined"&&Notification.permission==="granted")void syncDevicePush();
      }
      document.dispatchEvent(new CustomEvent("adminerva-notification-preferences",{detail:{uid:owner}}));
      root.querySelector("[data-preference-status]").textContent="Saved for your account. Your inbox, device alerts, and display preferences are updated.";
    }catch(error){root.querySelector("[data-preference-status]").textContent="Preferences were not saved: "+error.message;}
  });
  if(location.hash==="#notifications"){window.switchSettingsCategory?.("account");requestAnimationFrame(()=>root.scrollIntoView({block:"start"}));}
}
