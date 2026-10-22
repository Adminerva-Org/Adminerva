import {auth} from "../core/firebase-core.js?v=1.3.0";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
const root=document.querySelector("[data-account-preferences]");
if(root){
  const staff=root.dataset.accountPreferences==="staff";
  root.innerHTML='<h2 id="notifications" class="text-xl font-bold">Notifications &amp; display</h2><p class="av-form-hint">Choose which items appear in your notification inbox on this browser. These choices are private to your signed-in account and do not change school records or email delivery.</p><form data-notification-form><fieldset><legend class="font-bold mb-3">Show in my inbox</legend><div class="av-preference-options" data-notification-options></div></fieldset><fieldset class="mt-6"><legend class="font-bold">Motion</legend><label class="av-preference-option"><input type="checkbox" data-reduce-motion> Reduce decorative motion</label><p class="av-form-hint">Your device’s reduced-motion preference is always respected.</p></fieldset><button type="submit" class="av-primary-button mt-4">Save my preferences</button><p data-preference-status role="status" class="av-form-hint"></p></form>';
  const categories=[["issue","Reports & replies"],["grade","Published grades"],["assessment","Assignments"],["release","Website updates"],...(staff?[["submission","Student submissions"],["grading","Grading alerts"]]:[])];
  const options=root.querySelector("[data-notification-options]");
  for(const [value,title]of categories){const label=document.createElement("label"),input=document.createElement("input");label.className="av-preference-option";input.type="checkbox";input.value=value;input.name="notificationCategory";label.append(input,document.createTextNode(title));options.append(label);}
  let owner="",muted=new Set();
  onAuthStateChanged(auth,user=>{
    owner=user?.uid||"";root.querySelector("button[type=submit]").disabled=!owner;
    try{const saved=JSON.parse(localStorage.getItem("Adminerva_notif_preferences_"+owner)||"[]");muted=new Set(Array.isArray(saved)?saved:[]);}catch{muted=new Set();}
    for(const input of options.querySelectorAll("input"))input.checked=!muted.has(input.value);
    try{root.querySelector("[data-reduce-motion]").checked=localStorage.getItem("Adminerva_motion_"+owner)==="reduce";}catch{}
    root.querySelector("[data-preference-status]").textContent=owner?"Your choices are loaded. Changes apply when you save.":"Sign in to save your preferences.";
  });
  root.querySelector("form").addEventListener("submit",event=>{
    event.preventDefault();if(!owner||auth.currentUser?.uid!==owner)return;
    try{
      for(const input of options.querySelectorAll("input")){if(input.checked)muted.delete(input.value);else muted.add(input.value);}
      const reduced=root.querySelector("[data-reduce-motion]").checked;
      localStorage.setItem("Adminerva_notif_preferences_"+owner,JSON.stringify([...muted]));localStorage.setItem("Adminerva_motion_"+owner,reduced?"reduce":"system");
      document.documentElement.dataset.motion=reduced?"reduce":"system";
      document.dispatchEvent(new CustomEvent("adminerva-notification-preferences",{detail:{uid:owner}}));
      root.querySelector("[data-preference-status]").textContent="Saved for your account on this browser. Your inbox and display are updated.";
    }catch{root.querySelector("[data-preference-status]").textContent="Browser storage is unavailable. Your preferences were not saved.";}
  });
  if(location.hash==="#notifications"){window.switchSettingsCategory?.("account");requestAnimationFrame(()=>root.scrollIntoView({block:"start"}));}
}
