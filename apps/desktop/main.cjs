"use strict";
/**
 * Adminerva desktop PUBLIC PREVIEW only.
 * No authenticated session handoff, native file access, exam monitoring,
 * unattended screen capture, update/install channel, or native permissions.
 */
const {app,BrowserWindow,shell}=require("electron");
const path=require("node:path");
const {START_URL,classifyNavigation}=require("./navigation-policy.cjs");
const APP_TITLE="Adminerva — Desktop Public Preview";

app.enableSandbox();
function launchExternalIfAllowed(target){
 const decision=classifyNavigation(target);
 if(decision.action==="external"){
  // Approved HTTPS origins only. Never pass arbitrary URLs or protocols to the OS.
  void shell.openExternal(decision.url).catch(()=>{});
 }
 return decision;
}
function createWindow(){
 const win=new BrowserWindow({
  title:APP_TITLE,width:1160,height:790,minWidth:320,minHeight:480,
  show:false,
  webPreferences:{
   preload:path.join(__dirname,"preload.cjs"),
   partition:"persist:adminerva-public-preview",
   sandbox:true,contextIsolation:true,nodeIntegration:false,
   webSecurity:true,allowRunningInsecureContent:false,webviewTag:false
  }
 });
 const contents=win.webContents;
 const ses=contents.session;
 // Default deny: screen, camera, microphone, notifications, location, etc.
 // Adding monitored exam permissions requires its own reviewed school/session flow.
 ses.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
 ses.setPermissionCheckHandler(()=>false);
 contents.setWindowOpenHandler(({url})=>{
  const decision=classifyNavigation(url);
  if(decision.action!=="internal")launchExternalIfAllowed(url);
  return {action:"deny"};
 });
 contents.on("will-navigate",details=>{
  const decision=classifyNavigation(details.url);
  if(decision.action==="internal")return;
  details.preventDefault();
  launchExternalIfAllowed(details.url);
 });
 win.on("page-title-updated",event=>event.preventDefault());
 contents.once("did-finish-load",()=>{if(!win.isDestroyed())win.show();});
 // If the network is unavailable, show Chromium's load error rather than
 // silently replacing the page with a stale or fabricated school workspace.
 void win.loadURL(START_URL).catch(()=>{if(!win.isDestroyed())win.show();});
 return win;
}
app.on("web-contents-created",(_event,contents)=>{
 contents.on("will-attach-webview",event=>event.preventDefault());
});
app.whenReady().then(()=>{
 createWindow();
 app.on("activate",()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
});
app.on("window-all-closed",()=>{if(process.platform!=="darwin")app.quit();});
