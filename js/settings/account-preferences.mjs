import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getPushPreferences,savePushPreferences,getDevicePushState,
  enableDevicePush,disableDevicePush,syncDevicePush,sendTestPush
} from "../core/push-notifications.mjs?v=1.4.0";
import {resolveStaffRole} from "../core/staff-session.mjs?v=1.3.10";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";

const root=document.querySelector("[data-account-preferences]");
if(root){
  const staff=root.dataset.accountPreferences==="staff";
  root.innerHTML=\`
    <div class="av-settings-section-head">
      <div>
        <p class="av-eyebrow">Personal preferences</p>
        <h2 id="notifications">Notifications, display & privacy</h2>
        <p>These choices belong to your account and this browser. They do not change school records, grades, enrollments or role assignments.</p>
      </div>
    </div>
    <form data-notification-form>
      <section class="av-settings-card">
        <h3>Interface</h3>
        <p class="av-settings-muted">Choose how dense the interface feels and reduce decorative motion when preferred.</p>
        <div class="av-settings-grid mt-3">
          <label class="av-settings-preference-row">
            <span><strong>Interface density</strong><small>Compact shows more information; comfortable adds breathing room.</small></span>
            <select data-density class="border rounded px-2 py-2">
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </label>
          <label class="av-settings-preference-row">
            <span><strong>Reduce decorative motion</strong><small>Minimizes non-essential transitions and movement.</small></span>
            <input type="checkbox" data-reduce-motion>
          </label>
        </div>
      </section>

      <section class="av-settings-card">
        <h3>Inbox notifications</h3>
        <p class="av-settings-muted">Choose which supported notification categories appear in your Adminerva inbox.</p>
        <div class="av-settings-list mt-3" data-notification-options></div>
      </section>

      <fieldset class="av-settings-card" data-push-settings>
        <legend>Device notifications</legend>
        <p class="av-settings-muted">Push is controlled per account and per device. Browser permission may also be required.</p>
        <label class="av-settings-preference-row mt-3">
          <span><strong>\${staff?"Push important work alerts":"Push important student alerts"}</strong><small>Master switch for this account's supported push categories.</small></span>
          <input type="checkbox" data-push-master checked>
        </label>
        <div class="av-settings-list mt-3" data-push-options>
          \${pushChoices.map(([value,label])=>\`<label class="av-preference-option"><input type="checkbox" value="\${value}" checked> \${label}</label>\`).join('')}
        </div>
        <div class="av-settings-actions mt-3">
          <button type="button" data-enable-push class="av-primary-button">Enable on this device</button>
          <button type="button" data-test-push class="hidden av-secondary-button">Send test notification</button>
          <button type="button" data-disable-push class="hidden av-secondary-button">Disable on this device</button>
        </div>
        <p data-push-status role="status" class="av-settings-status mt-2"></p>
      </fieldset>

      <section data-release-admin hidden class="av-settings-card">
        <h3>Release announcement</h3>
        <p class="av-settings-muted">Notify enabled devices about the newest published Adminerva release. Duplicate sends for the same version are prevented.</p>
        <div class="av-settings-actions mt-3">
          <button type="button" data-send-release class="av-secondary-button">Notify devices about latest release</button>
        </div>
        <p data-release-status class="av-settings-status mt-2"></p>
      </section>

      <section class="av-settings-card">
        <h3>Privacy & local data</h3>
        <div class="space-y-3 mt-3">
          <label class="av-settings-preference-row">
            <span><strong>Anonymous product-usage analytics</strong><small>Excludes names, emails, student IDs, repository URLs, commit SHAs, grades, feedback and URL query parameters. Advertising signals are disabled.</small></span>
            <input type="checkbox" data-usage-analytics>
          </label>
          <div class="av-settings-preference-row">
            <span><strong>Activity sharing & diagnostics</strong><small>Optional activity sharing is off by default and never affects grades.</small></span>
            <button type="button" data-activity-preferences class="av-secondary-button">Manage</button>
          </div>
        </div>
        <div class="av-settings-actions mt-3">
          <a href="wiki.html#privacy" class="av-secondary-link">Privacy information</a>
          <a href="issues.html" class="av-secondary-link">My reports & support</a>
          <button type="button" data-clear-interface class="av-secondary-button">Reset local interface</button>
        </div>
        <p class="av-settings-muted mt-2">Resetting local interface preferences does not delete your account, grades, submissions, projects or cloud-saved work.</p>
      </section>

      <div class="av-settings-savebar">
        <p data-preference-status role="status" class="av-settings-status" hidden></p>
        <button type="submit" class="av-primary-button">Save preferences</button>
      </div>
    </form>\`;
  let settingsRole={role:staff?"staff":"student",canTeach:false};
  function supportedChoices(){
    if(!staff)return [["assessment","Assignments"],["submission","Submission updates"],["grade","Published grades"],["issue","Reports & replies"],["release","Website updates"]];
    if(settingsRole.canTeach)return [["submission","Student submissions"],["grading","Grading alerts"],["issue","Reports & replies"],["release","Website updates"]];
    return [["issue","Reports & replies"],["release","Website updates"]];
  }
  const options=root.querySelector("[data-notification-options]"),pushHost=root.querySelector("[data-push-options]");
  const pushMaster=root.querySelector("[data-push-master]");
  let pushOptions=[];
  function renderNotificationChoices(){
    const choices=supportedChoices();
    options.replaceChildren();pushHost.replaceChildren();
    for(const [value,title] of choices){
      const inboxLabel=document.createElement("label"),inbox=document.createElement("input");
      inboxLabel.className="av-preference-option";inbox.type="checkbox";inbox.value=value;inbox.name="notificationCategory";
      inbox.checked=!muted.has(value);inboxLabel.append(inbox,document.createTextNode(title));options.append(inboxLabel);
      const pushLabel=document.createElement("label"),push=document.createElement("input");
      pushLabel.className="av-preference-option";push.type="checkbox";push.value=value;push.checked=true;
      pushLabel.append(push,document.createTextNode(title));pushHost.append(pushLabel);
    }
    pushOptions=[...pushHost.querySelectorAll("input")];
  }
  const enablePush=root.querySelector("[data-enable-push]");
  const testPush=root.querySelector("[data-test-push]");
  const disablePush=root.querySelector("[data-disable-push]");
  const pushStatus=root.querySelector("[data-push-status]");
  let owner="",muted=new Set(),authVersion=0,savingPreferences=false,pushTurn=0;
  renderNotificationChoices();
  document.addEventListener("adminerva:settings-role-context",event=>{
    settingsRole={...settingsRole,...(event.detail||{})};
    renderNotificationChoices();
    if(owner)void refreshPush(authVersion);
  });

  function setPushBusy(value){
    if(enablePush)enablePush.disabled=value;
    if(testPush)testPush.disabled=value;
    if(disablePush)disablePush.disabled=value;
    if(pushMaster)pushMaster.disabled=value;
    for(const input of pushOptions)input.disabled=value;
  }
  async function refreshPush(version=authVersion){
    if(!owner||version!==authVersion)return;
    const uid=owner,turn=++pushTurn;
    const prefs=await getPushPreferences(uid);
    if(version!==authVersion||owner!==uid||turn!==pushTurn)return;
    pushMaster.checked=prefs.enabled!==false;
    for(const input of pushOptions)input.checked=prefs[input.value]!==false;
    let state=await getDevicePushState();
    if(version!==authVersion||owner!==uid||turn!==pushTurn)return;
    if(state.permission==="granted"&&!state.registered&&!state.deviceOptedOut&&prefs.enabled!==false&&state.supported&&state.configured){
      pushStatus.textContent="Reconnecting…";
      const result=await syncDevicePush();
      if(version!==authVersion||owner!==uid||turn!==pushTurn)return;
      state=await getDevicePushState();
      if(version!==authVersion||owner!==uid||turn!==pushTurn)return;
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
    try{
      root.querySelector("[data-reduce-motion]").checked=localStorage.getItem("Adminerva_reduce_motion")==="1";
      root.querySelector("[data-density]").value=localStorage.getItem("Adminerva_interface_density")||"comfortable";
      root.querySelector("[data-usage-analytics]").checked=localStorage.getItem("Adminerva_analytics_consent")==="granted";
    }catch{}
    if(staff){const admin=root.querySelector("[data-release-admin]");if(admin){admin.hidden=true;if(user)void resolveStaffRole(user).then(role=>{if(version===authVersion)admin.hidden=role!=="admin";}).catch(()=>{});}}
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
    event.preventDefault();if(savingPreferences||!owner||auth.currentUser?.uid!==owner)return;
    const uid=owner,version=authVersion,submit=root.querySelector("button[type=submit]");
    let localSaved=false;savingPreferences=true;submit.disabled=true;
    try{
      for(const input of options.querySelectorAll("input")){if(input.checked)muted.delete(input.value);else muted.add(input.value);}
      const reduced=root.querySelector("[data-reduce-motion]").checked,density=root.querySelector("[data-density]").value;
      localStorage.setItem("Adminerva_notif_preferences_"+owner,JSON.stringify([...muted]));
      localStorage.setItem("Adminerva_reduce_motion",reduced?"1":"0");localStorage.setItem("Adminerva_interface_density",density);
      window.AdminervaAnalytics?.consent(root.querySelector("[data-usage-analytics]").checked?"granted":"denied");
      document.documentElement.dataset.adminervaReduceMotion=String(reduced);document.documentElement.dataset.adminervaDensity=density;
      const values={enabled:pushMaster.checked};
      for(const input of pushOptions)values[input.value]=input.checked;
      localSaved=true;
      document.dispatchEvent(new CustomEvent("adminerva-notification-preferences",{detail:{uid}}));
      await savePushPreferences(values,uid);
      if(version!==authVersion||owner!==uid)return;
      if(values.enabled&&typeof Notification!=="undefined"&&Notification.permission==="granted")void syncDevicePush();
      const preferenceStatus=root.querySelector("[data-preference-status]");
      preferenceStatus.hidden=false;preferenceStatus.textContent="Saved.";
    }catch(error){
      const preferenceStatus=root.querySelector("[data-preference-status]");
      if(version===authVersion&&owner===uid){preferenceStatus.hidden=false;preferenceStatus.textContent=(localSaved?"Local preferences saved; cloud push settings not saved: ":"Couldn’t save: ")+error.message;}
    }finally{savingPreferences=false;submit.disabled=!owner;}
  });
  root.querySelector("[data-clear-interface]")?.addEventListener("click",()=>{
    if(savingPreferences||!owner)return;
    if(!confirm("Reset local display and notification-inbox preferences on this browser? Cloud academic records are not affected."))return;
    for(const key of ["Adminerva_interface_density","Adminerva_reduce_motion","Adminerva_notif_preferences_"+owner])localStorage.removeItem(key);
    document.documentElement.dataset.adminervaDensity="comfortable";document.documentElement.dataset.adminervaReduceMotion="false";
    root.querySelector("[data-density]").value="comfortable";root.querySelector("[data-reduce-motion]").checked=false;
    muted.clear();for(const input of options.querySelectorAll("input"))input.checked=true;
    document.dispatchEvent(new CustomEvent("adminerva-notification-preferences",{detail:{uid:owner}}));
    const preferenceStatus=root.querySelector("[data-preference-status]");preferenceStatus.hidden=false;preferenceStatus.textContent="Local interface preferences reset.";
  });
  root.querySelector("[data-send-release]")?.addEventListener("click",async event=>{
    const button=event.currentTarget,status=root.querySelector("[data-release-status]");button.disabled=true;status.textContent="Loading latest release…";
    try{
      const response=await fetch("patch-history.json",{cache:"no-store"}),data=await response.json(),release=(data.releases||[]).find(item=>item.public===true&&item.status==="published");
      if(!release)throw Error("No published release found.");
      const call=httpsCallable(getFunctions(app,"asia-southeast1"),"releaseAnnouncement");
      const result=await call({version:release.version,title:release.title,summary:release.summary});
      status.textContent="Release push delivered to "+(result.data?.delivered||0)+" account(s)"+((result.data?.recipients||0)!==(result.data?.delivered||0)?" · "+(result.data?.recipients||0)+" registered account(s) checked.":".");
    }catch(error){status.textContent=error.code==="functions/already-exists"?"This release has already been announced; duplicate sending was prevented.":"Release notification failed: "+error.message;}
    finally{button.disabled=false;}
  });
  if(location.hash==="#notifications"){window.switchSettingsCategory?.("account");requestAnimationFrame(()=>root.scrollIntoView({block:"start"}));}
}
