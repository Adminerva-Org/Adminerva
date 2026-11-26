"use strict";
/**
 * Adminerva Desktop development preview.
 * The existing public-only renderer remains the default.
 * Opt-in development sign-in is gated on BOTH native and backend rollout flags.
 * No signed release or Companion permissions are part of this workstream.
 */
const {app,BrowserWindow,shell,Menu,dialog,ipcMain}=require("electron");
const path=require("node:path");
const {APP_ORIGIN,APP_PREFIX,START_URL,classifyNavigation}=require("./navigation-policy.cjs");
const APP_TITLE="Adminerva — Desktop Public Preview";
// Public installer packages NEVER activate development authentication.
const DEV_SIGNIN=!app.isPackaged&&process.env.ADMINERVA_ENABLE_DESKTOP_SIGNIN_UI==="true";
const generatePairing=DEV_SIGNIN?require("./native-auth-protocol.cjs").generatePairing:null;
const sendHandoff=DEV_SIGNIN?require("./native-handoff-client.cjs").sendHandoff:null;
const {PUBLIC_PARTITION,schoolUserPartition}=DEV_SIGNIN?
 require("./session-partition.cjs"):
 {PUBLIC_PARTITION:"persist:adminerva-public-preview",schoolUserPartition:null};
const LOGIN_BOOTSTRAP=APP_ORIGIN+APP_PREFIX+"desktop-session.html";
app.enableSandbox();
const {checkUpdateStatus,DOWNLOAD_CENTER_URL}=require("./update-check.cjs");
let checking=false;
async function showUpdateStatus(){
 if(checking)return;
 const win=BrowserWindow.getFocusedWindow()||BrowserWindow.getAllWindows()[0];
 if(!win||win.isDestroyed())return;
 checking=true;
 try{
  const platform=process.platform==="win32"?"windows":
   process.platform==="darwin"?"macos":"unsupported";
  const currentVersion=app.getVersion();
  const result=await checkUpdateStatus({platform,currentVersion,signal:AbortSignal.timeout(8000)});
  const message=result.state==="newer-preview-listed"?
   "A newer public preview is listed: v"+result.latestVersion:
   result.state==="no-newer-version-listed"?
   "No newer preview version is listed. Installed: v"+currentVersion:
   result.state==="ahead-of-listing"?
   "This preview is newer than the published listing.":"No preview update listing exists for this device.";
  const choice=await dialog.showMessageBox(win,{
   type:"info",title:"Adminerva — Check for updates",message,
   detail:"Unsigned developer previews cannot update themselves. No school data was changed and no installer was downloaded. Official applications will use verified, signed updates.",
   buttons:["Close","Open test builds"],defaultId:0,cancelId:0
  });
  if(choice.response===1)void shell.openExternal(DOWNLOAD_CENTER_URL).catch(()=>{});
 }catch{
  if(!win.isDestroyed())await dialog.showMessageBox(win,{
   type:"warning",title:"Adminerva — Check for updates",
   message:"Unable to check the official preview listing.",
   detail:"Try again with an internet connection. No download or installation was started.",
   buttons:["Close"]
  }).catch(()=>{});
 }finally{checking=false;}
}
function installAppMenu(){
 Menu.setApplicationMenu(Menu.buildFromTemplate([
  {label:"Adminerva",submenu:[
   {label:"Check for updates…",click:()=>void showUpdateStatus()},
   {type:"separator"},{role:"quit"}
  ]},
  {role:"editMenu"},{role:"viewMenu"},{role:"windowMenu"}
 ]));
}
let activeWindow=null;
let pendingPairing=null;
let pendingToken=null;
let allowPrivate=false;
let pairingSequence=0;
let tokenConsumedForBootstrap=false;
function currentWindow(sender){
 return activeWindow&&!activeWindow.isDestroyed()&&sender===activeWindow.webContents;
}
function officialRenderer(event){
 if(!DEV_SIGNIN||!currentWindow(event.sender)||
    event.senderFrame!==event.sender.mainFrame)return false;
 try{
  const address=new URL(event.sender.getURL());
  return address.origin===APP_ORIGIN&&address.pathname.startsWith(APP_PREFIX);
 }catch{return false;}
}
function currentBootstrap(sender){
 return currentWindow(sender)&&activeWindow.webContents.getURL()===LOGIN_BOOTSTRAP;
}
ipcMain.handle("adminerva:consume-signin-token",event=>{
 if(!DEV_SIGNIN||!currentBootstrap(event.sender)||
    event.senderFrame!==event.sender.mainFrame||tokenConsumedForBootstrap)return null;
 const token=pendingToken;
 pendingToken=null;
 if(typeof token==="string")tokenConsumedForBootstrap=true;
 return typeof token==="string"?token:null;
});
ipcMain.handle("adminerva:confirm-signin",event=>{
 if(!DEV_SIGNIN||!currentBootstrap(event.sender)||
    event.senderFrame!==event.sender.mainFrame||!tokenConsumedForBootstrap)return false;
 tokenConsumedForBootstrap=false;
 allowPrivate=true;
 return true;
});
ipcMain.handle("adminerva:session-ended",event=>{
 // This is a revoke-only message. The renderer cannot request native login,
 // credentials, role elevation, capture, or access to another school.
 if(!officialRenderer(event))return false;
 const hadSession=allowPrivate;
 allowPrivate=false;
 tokenConsumedForBootstrap=false;
 pendingToken=null;
 ++pairingSequence;
 const pairing=pendingPairing;
 pendingPairing=null;
 if(pairing)void sendHandoff("cancel",pairing).catch(()=>{});
 if(hadSession&&activeWindow&&!activeWindow.isDestroyed()){
  // Public home opens in an entirely different partition. Keep UID-keyed
  // recovery drafts in the student's own partition for their next sign-in.
  const oldWindow=activeWindow;
  createWindow();
  oldWindow.close(); // honors the renderer's existing beforeunload protection
 }
 return hadSession;
});
function launchExternalIfAllowed(target){
 const decision=classifyNavigation(target,{allowPrivate});
 if(decision.action==="external")void shell.openExternal(decision.url).catch(()=>{});
 return decision;
}
function navigation(target){
 return classifyNavigation(target,{allowPrivate,allowBootstrap:DEV_SIGNIN&&pendingToken!==null});
}
async function startDesktopSignIn(){
 if(!DEV_SIGNIN||!activeWindow||activeWindow.isDestroyed())return;
 if(allowPrivate){
  // Do not switch school accounts while Studio might contain unsynced code
  // or an active teacher-controlled assessment; use the canonical safe
  // save/sign-out workflow before opening a new device authorization.
  void dialog.showMessageBox(activeWindow,{
   type:"info",title:"Finish your current Adminerva session",
   message:"You already have a connected school session.",
   detail:"Finish saving your Studio work, close any active examination appropriately, and sign out in Adminerva before connecting another school account.",
   buttons:["OK"]
  }).catch(()=>{});
  return;
 }
 const sequence=++pairingSequence;
 pendingPairing=null;
 pendingToken=null;
 tokenConsumedForBootstrap=false;
 const pairing=generatePairing();
 try{
  await sendHandoff("begin",pairing);
  if(sequence!==pairingSequence)return;
  pendingPairing=pairing;
  await shell.openExternal(pairing.browserUrl);
  if(sequence!==pairingSequence||!activeWindow||activeWindow.isDestroyed())return;
  void dialog.showMessageBox(activeWindow,{
   type:"info",title:"Adminerva Desktop sign-in",
   message:"Enter this code in the system browser: "+pairing.confirmationCode,
   detail:"Only authorize this desktop if you initiated this sign-in. The code expires after five minutes. Never share it with another person.",
   buttons:["Close"],noLink:true
  }).catch(()=>{});
  const deadline=Date.now()+5*60*1000;
  while(sequence===pairingSequence&&Date.now()<deadline&&
    activeWindow&&!activeWindow.isDestroyed()){
   await new Promise(resolve=>setTimeout(resolve,3500));
   if(sequence!==pairingSequence)break;
   let response;
   try{response=await sendHandoff("redeem",pairing);}
   catch{continue;} // transient offline/server errors do not destroy the pairing
   if(response.state==="authorized"){
    // Only native main process ever holds this token until the one-shot IPC
    // handoff into a single trusted desktop-session.html main frame.
    if(sequence!==pairingSequence)return;
    pendingToken=response.customToken;
    pendingPairing=null;
    // The authenticated account receives its own persistent draft namespace.
    // No other student can inherit that namespace through the guest preview.
    const previousWindow=activeWindow;
    createWindow({accountUid:response.uid,initialUrl:LOGIN_BOOTSTRAP});
    if(previousWindow&&!previousWindow.isDestroyed())previousWindow.close();
    return;
   }
   if(response.state==="expired"||response.state==="unavailable")break;
  }
  if(sequence===pairingSequence)pendingPairing=null;
 }catch{
  if(sequence===pairingSequence)pendingPairing=null;
  if(sequence===pairingSequence&&activeWindow&&!activeWindow.isDestroyed())
   void dialog.showMessageBox(activeWindow,{
   type:"warning",title:"Adminerva sign-in unavailable",
   message:"Native desktop account sign-in is not released yet.",
   detail:"Use Adminerva in your regular browser. This preview does not have access to private school records.",
   buttons:["OK"]
  }).catch(()=>{});
 }
}
function setupMenu(){
 if(!DEV_SIGNIN)return;
 Menu.setApplicationMenu(Menu.buildFromTemplate([
  {label:"Adminerva",submenu:[
   {label:"Connect school account…",click:()=>void startDesktopSignIn()},
   {label:"Cancel pending sign-in",click:()=>{
    ++pairingSequence;
    if(pendingPairing)void sendHandoff("cancel",pendingPairing).catch(()=>{});
    pendingPairing=null;pendingToken=null;tokenConsumedForBootstrap=false;
   }},
   {label:"Check for updates…",click:()=>void showUpdateStatus()},
   {type:"separator"},{role:"quit"}
  ]},
  {label:"View",submenu:[{role:"reload"},{role:"toggleDevTools"}]}
 ]));
}
function createWindow({accountUid=null,initialUrl=START_URL}={}){
 const partition=DEV_SIGNIN&&accountUid?
  schoolUserPartition(accountUid):PUBLIC_PARTITION;
 const win=new BrowserWindow({
  title:APP_TITLE,width:1160,height:790,minWidth:320,minHeight:480,
  show:false,webPreferences:{
   preload:path.join(__dirname,DEV_SIGNIN?"preload-auth-dev.cjs":"preload.cjs"),
   partition,
   sandbox:true,contextIsolation:true,nodeIntegration:false,
   webSecurity:true,allowRunningInsecureContent:false,webviewTag:false
  }
 });
 activeWindow=win;
 const contents=win.webContents;
 const ses=contents.session;
 // Clear unconfirmed pairing state whenever the main frame reloads or
 // leaves the protected one-shot Firebase bootstrap. A canceled flow cannot
 // later grant private navigation through a stale IPC confirmation.
 contents.on("did-start-navigation",details=>{
  if(details.isMainFrame&&!details.isSameDocument)
   tokenConsumedForBootstrap=false;
 });
 // No camera, microphone, desktop capture, notifications or other OS access.
 ses.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
 ses.setPermissionCheckHandler(()=>false);
 contents.setWindowOpenHandler(({url})=>{
  const decision=navigation(url);
  if(decision.action!=="internal")launchExternalIfAllowed(url);
  return {action:"deny"};
 });
 contents.on("will-navigate",details=>{
  const url=details.url;
  try{
   const target=new URL(url);
   if(target.origin===APP_ORIGIN&&target.pathname===APP_PREFIX+"login.html"){
    allowPrivate=false;tokenConsumedForBootstrap=false;
   }
  }catch{}
  const decision=navigation(url);
  if(decision.action==="internal")return;
  details.preventDefault();
  launchExternalIfAllowed(url);
 });
 win.on("page-title-updated",event=>event.preventDefault());
 contents.once("did-finish-load",()=>{if(!win.isDestroyed())win.show();});
 win.on("closed",()=>{if(activeWindow===win){++pairingSequence;pendingPairing=null;pendingToken=null;tokenConsumedForBootstrap=false;allowPrivate=false;activeWindow=null;}});
 void win.loadURL(initialUrl).catch(()=>{if(!win.isDestroyed())win.show();});
 return win;
}
app.on("web-contents-created",(_event,contents)=>{
 contents.on("will-attach-webview",event=>event.preventDefault());
});
app.whenReady().then(()=>{
 createWindow();
 if(DEV_SIGNIN)setupMenu();else installAppMenu();
 app.on("activate",()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
});
app.on("window-all-closed",()=>{if(process.platform!=="darwin")app.quit();});
