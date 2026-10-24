/** Adminerva opt-in device push registration. In-app notifications remain authoritative. */
import {app,auth,db} from "./firebase-core.js?v=1.3.0";
import {doc,getDoc,setDoc,deleteDoc,serverTimestamp} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {initializeApp as initializePushApp} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import {getMessaging,isSupported,getToken,onMessage} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-messaging.js";

const FIREBASE_CONFIG={
  apiKey:"AIzaSyDQsL9O5YlizeFA2iFJLt_5hY5V7xfM_qU",
  authDomain:"reporeview-e7ca4.firebaseapp.com",
  projectId:"reporeview-e7ca4",
  storageBucket:"reporeview-e7ca4.firebasestorage.app",
  messagingSenderId:"902176956124",
  appId:"1:902176956124:web:46d07f47ccbab034e15e19",
  measurementId:"G-XPXLNGZCY2"
};
const DEFAULTS=Object.freeze({enabled:true,assessment:true,submission:true,grade:true});
let configPromise=null,messagingPromise=null,syncStarted=false,foregroundBound=false,functionsInstance=null;

function configUrl(){return new URL("../../push-config.json",import.meta.url);}
function swUrl(){return new URL("../../firebase-messaging-sw.js",import.meta.url);}
function swScope(){return new URL("../../",import.meta.url).pathname;}
function localDeviceKey(uid){return "Adminerva_push_device_"+uid;}
function localOptOutKey(uid){return "Adminerva_push_optout_"+uid;}
function deviceOptedOut(uid){try{return localStorage.getItem(localOptOutKey(uid))==="1";}catch{return false;}}
function setDeviceOptOut(uid,value){try{if(value)localStorage.setItem(localOptOutKey(uid),"1");else localStorage.removeItem(localOptOutKey(uid));}catch{}}

export async function loadPushConfig(){
  if(!configPromise)configPromise=fetch(configUrl(),{cache:"no-store"}).then(async response=>{
    if(!response.ok)throw Error("Push configuration could not load.");
    const data=await response.json();
    return {
      enabled:data?.enabled===true,
      vapidPublicKey:String(data?.vapidPublicKey||"").trim(),
      defaultCategories:{...DEFAULTS,...(data?.defaultCategories||{})}
    };
  }).catch(error=>({enabled:false,vapidPublicKey:"",defaultCategories:{...DEFAULTS},error:error.message}));
  return configPromise;
}
export async function pushSupported(){
  return Boolean(window.isSecureContext&&"Notification" in window&&"serviceWorker" in navigator&&await isSupported().catch(()=>false));
}
async function messaging(){
  if(!messagingPromise)messagingPromise=(async()=>{
    if(!await pushSupported())throw Error("Device notifications are not supported by this browser.");
    const app=initializePushApp(FIREBASE_CONFIG,"adminerva-push");
    return getMessaging(app);
  })();
  return messagingPromise;
}
async function worker(){
  return navigator.serviceWorker.register(swUrl(),{scope:swScope()});
}
async function deviceId(token){
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,"0")).join("").slice(0,40);
}
function devicePlatform(){
  return String(navigator.userAgentData?.platform||navigator.platform||"Web").slice(0,80);
}
function remember(uid,id){try{localStorage.setItem(localDeviceKey(uid),id);}catch{}}
function remembered(uid){try{return localStorage.getItem(localDeviceKey(uid))||"";}catch{return "";}}
function forget(uid){try{localStorage.removeItem(localDeviceKey(uid));}catch{}}
function functions(){return functionsInstance||(functionsInstance=getFunctions(app,"asia-southeast1"));}
async function showForegroundTestPing(data){
  const registration=await worker(),tag="adminerva-test-ping";
  const closeAfter=Math.min(30000,Math.max(5000,Number(data?.autoCloseMs)||15000));
  await registration.showNotification(data?.title||"Adminerva test notification",{
    body:data?.body||"Push notifications are working on this device.",
    icon:"assets/New%20Adminerva%20logo.png",badge:"assets/adminerva-notification-badge.png",
    tag,renotify:true,data:{target:data?.target||"student-settings.html#notifications",adminervaKind:"test_ping"}
  });
  setTimeout(()=>{void registration.getNotifications({tag}).then(items=>items.forEach(item=>item.close())).catch(()=>{});},closeAfter);
}

export async function getPushPreferences(uid=auth.currentUser?.uid){
  if(!uid)return {...DEFAULTS};
  try{
    const snapshot=await getDoc(doc(db,"push_preferences",uid));
    return snapshot.exists()?{...DEFAULTS,...snapshot.data()}:{...DEFAULTS};
  }catch{return {...DEFAULTS};}
}
export async function savePushPreferences(values,uid=auth.currentUser?.uid){
  if(!uid||auth.currentUser?.uid!==uid)throw Error("Sign in before changing notification preferences.");
  const data={
    ownerUid:uid,
    enabled:values?.enabled!==false,
    assessment:values?.assessment!==false,
    submission:values?.submission!==false,
    grade:values?.grade!==false,
    updatedAt:serverTimestamp()
  };
  await setDoc(doc(db,"push_preferences",uid),data,{merge:true});
  document.dispatchEvent(new CustomEvent("adminerva-push-preferences",{detail:{uid}}));
  return data;
}
export async function getDevicePushState(){
  const config=await loadPushConfig(),supported=await pushSupported();
  const permission=typeof Notification==="undefined"?"unsupported":Notification.permission;
  const uid=auth.currentUser?.uid||"";
  return {
    supported,configured:Boolean(config.enabled&&config.vapidPublicKey),
    permission,
    registered:Boolean(uid&&remembered(uid)),
    deviceOptedOut:Boolean(uid&&deviceOptedOut(uid)),
    setupError:config.error||""
  };
}
export async function enableDevicePush({requestPermission=true,explicit=true}={}){
  const user=auth.currentUser;if(!user)throw Error("Sign in before enabling device notifications.");
  const uid=user.uid;
  if(!explicit&&deviceOptedOut(uid))return {enabled:false,permission:typeof Notification==="undefined"?"unsupported":Notification.permission,reason:"device-opted-out"};
  if(explicit)setDeviceOptOut(uid,false);
  const config=await loadPushConfig();
  if(!config.enabled||!config.vapidPublicKey)throw Error("Device notifications are not configured for this Adminerva deployment yet.");
  if(!await pushSupported())throw Error("This browser does not support Adminerva device notifications.");
  let permission=Notification.permission;
  if(permission==="default"&&requestPermission)permission=await Notification.requestPermission();
  if(permission!=="granted"){
    if(permission==="denied")throw Error("Notifications are blocked in this browser. Allow them in the browser or device site settings, then try again.");
    return {enabled:false,permission};
  }
  const registration=await worker();
  const pushMessaging=await messaging();
  const token=await getToken(pushMessaging,{vapidKey:config.vapidPublicKey,serviceWorkerRegistration:registration});
  if(auth.currentUser?.uid!==uid)throw Error("Account changed before device notification setup finished.");
  if(!token)throw Error("Firebase did not return a device registration. Retry after checking the browser notification permission.");
  const id=await deviceId(token),ref=doc(db,"push_devices",id);
  if(auth.currentUser?.uid!==uid)throw Error("Account changed before device notification setup finished.");
  try{
    await setDoc(ref,{
      ownerUid:uid,token,enabled:true,platform:devicePlatform(),
      userAgent:String(navigator.userAgent||"").slice(0,500),updatedAt:serverTimestamp()
    },{merge:true});
  }catch(error){
    if(error?.code==="permission-denied")
      throw Error("This browser may already be linked to another Adminerva account for device alerts. Sign in to that account and disable device notifications first.");
    throw error;
  }
  if(auth.currentUser?.uid!==uid)throw Error("Account changed before device notification setup finished.");
  remember(uid,id);
  const preferences=await getPushPreferences(uid);
  if(preferences.enabled===false&&explicit)await savePushPreferences({...preferences,enabled:true},uid);
  if(!foregroundBound){
    foregroundBound=true;
    onMessage(pushMessaging,payload=>{
      if(payload?.data?.adminervaKind==="test_ping")void showForegroundTestPing(payload.data);
      document.dispatchEvent(new CustomEvent("adminerva-push-message",{detail:payload}));
    });
  }
  document.dispatchEvent(new CustomEvent("adminerva-push-device",{detail:{uid,enabled:true}}));
  return {enabled:true,permission:"granted",deviceId:id};
}
async function currentDeviceId(uid){
  let id=remembered(uid);
  if(id)return id;
  const config=await loadPushConfig();
  if(config.enabled&&config.vapidPublicKey&&await pushSupported()&&Notification.permission==="granted"){
    try{
      const token=await getToken(await messaging(),{vapidKey:config.vapidPublicKey,serviceWorkerRegistration:await worker()});
      if(auth.currentUser?.uid!==uid)return "";
      if(token)id=await deviceId(token);
    }catch{}
  }
  return id;
}
export async function departPushAccount(uid=auth.currentUser?.uid){
  if(!uid||auth.currentUser?.uid!==uid)return {removed:false};
  const id=await currentDeviceId(uid);
  if(auth.currentUser?.uid!==uid)return {removed:false};
  if(id)await deleteDoc(doc(db,"push_devices",id));
  forget(uid);
  document.dispatchEvent(new CustomEvent("adminerva-push-device",{detail:{uid,enabled:false,departing:true}}));
  return {removed:Boolean(id)};
}
export async function disableDevicePush(){
  const user=auth.currentUser;if(!user)throw Error("Sign in before changing device notifications.");
  const uid=user.uid;
  setDeviceOptOut(uid,true);
  const id=await currentDeviceId(uid);
  if(auth.currentUser?.uid!==uid)throw Error("Account changed before device notifications were disabled.");
  if(id)await deleteDoc(doc(db,"push_devices",id));
  forget(uid);
  document.dispatchEvent(new CustomEvent("adminerva-push-device",{detail:{uid,enabled:false}}));
  return {enabled:false};
}
export async function sendTestPush(){
  const user=auth.currentUser;if(!user)throw Error("Sign in before sending a test notification.");
  const state=await getDevicePushState();
  if(!state.supported||!state.configured)throw Error("Device notifications are not ready on this browser.");
  if(state.permission!=="granted")throw Error("Enable notifications on this device before sending a test ping.");
  if(!state.registered){
    const synced=await syncDevicePush();
    if(!synced?.enabled)throw Error(synced?.reason==="device-opted-out"?"Notifications are disabled on this device. Select Enable notifications first.":"This device could not be reconnected for push notifications.");
  }
  const call=httpsCallable(functions(),"pushTestPing");
  const result=await call({});
  const sent=Number(result.data?.sent||0);
  if(sent<1)throw Error("No registered device accepted the test ping.");
  return {sent};
}

export async function syncDevicePush(){
  const user=auth.currentUser;
  if(!user)return {enabled:false,reason:"signed-out"};
  const uid=user.uid;
  if(typeof Notification==="undefined"||Notification.permission!=="granted")return {enabled:false,reason:"permission-not-granted"};
  if(deviceOptedOut(uid))return {enabled:false,reason:"device-opted-out"};
  const preferences=await getPushPreferences(uid);
  if(auth.currentUser?.uid!==uid)return {enabled:false,reason:"account-changed"};
  if(preferences.enabled===false)return {enabled:false,reason:"account-disabled"};
  try{return await enableDevicePush({requestPermission:false,explicit:false});}
  catch(error){console.warn("Device notification sync skipped:",error.message);return {enabled:false,reason:"registration-error",error:error.message};}
}
export function startPushSync(){
  if(syncStarted)return;syncStarted=true;
  onAuthStateChanged(auth,user=>{if(user)void syncDevicePush();});
}
