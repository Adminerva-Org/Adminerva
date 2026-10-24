/** Adminerva opt-in device push registration. In-app notifications remain authoritative. */
import {auth,db} from "./firebase-core.js?v=1.3.0";
import {doc,getDoc,setDoc,deleteDoc,serverTimestamp} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
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
let configPromise=null,messagingPromise=null,syncStarted=false,foregroundBound=false;

function configUrl(){return new URL("../../push-config.json",import.meta.url);}
function swUrl(){return new URL("../../firebase-messaging-sw.js",import.meta.url);}
function swScope(){return new URL("../../",import.meta.url).pathname;}
function localDeviceKey(uid){return "Adminerva_push_device_"+uid;}

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
  return {
    supported,configured:Boolean(config.enabled&&config.vapidPublicKey),
    permission,
    registered:Boolean(auth.currentUser?.uid&&remembered(auth.currentUser.uid)),
    setupError:config.error||""
  };
}
export async function enableDevicePush({requestPermission=true}={}){
  const user=auth.currentUser;if(!user)throw Error("Sign in before enabling device notifications.");
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
  if(!token)throw Error("Firebase did not return a device registration. Retry after checking the browser notification permission.");
  const id=await deviceId(token),ref=doc(db,"push_devices",id);
  try{
    await setDoc(ref,{
      ownerUid:user.uid,token,enabled:true,platform:devicePlatform(),
      userAgent:String(navigator.userAgent||"").slice(0,500),updatedAt:serverTimestamp()
    },{merge:true});
  }catch(error){
    if(error?.code==="permission-denied")
      throw Error("This browser may already be linked to another Adminerva account for device alerts. Sign in to that account and disable device notifications first.");
    throw error;
  }
  remember(user.uid,id);
  const preferences=await getPushPreferences(user.uid);
  if(preferences.enabled===false)await savePushPreferences({...preferences,enabled:true},user.uid);
  if(!foregroundBound){
    foregroundBound=true;
    onMessage(pushMessaging,payload=>document.dispatchEvent(new CustomEvent("adminerva-push-message",{detail:payload})));
  }
  document.dispatchEvent(new CustomEvent("adminerva-push-device",{detail:{uid:user.uid,enabled:true}}));
  return {enabled:true,permission:"granted",deviceId:id};
}
export async function disableDevicePush(){
  const user=auth.currentUser;if(!user)throw Error("Sign in before changing device notifications.");
  let id=remembered(user.uid);
  if(!id){
    const config=await loadPushConfig();
    if(config.enabled&&config.vapidPublicKey&&await pushSupported()&&Notification.permission==="granted"){
      try{
        const token=await getToken(await messaging(),{vapidKey:config.vapidPublicKey,serviceWorkerRegistration:await worker()});
        if(token)id=await deviceId(token);
      }catch{}
    }
  }
  if(id)await deleteDoc(doc(db,"push_devices",id));
  forget(user.uid);
  document.dispatchEvent(new CustomEvent("adminerva-push-device",{detail:{uid:user.uid,enabled:false}}));
  return {enabled:false};
}
export async function syncDevicePush(){
  const user=auth.currentUser;if(!user||typeof Notification==="undefined"||Notification.permission!=="granted")return;
  const preferences=await getPushPreferences(user.uid);
  if(preferences.enabled===false)return;
  try{await enableDevicePush({requestPermission:false});}catch(error){console.warn("Device notification sync skipped:",error.message);}
}
export function startPushSync(){
  if(syncStarted)return;syncStarted=true;
  onAuthStateChanged(auth,user=>{if(user)void syncDevicePush();});
}
