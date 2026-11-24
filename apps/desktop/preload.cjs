"use strict";
/** Scoped IPC methods; no Node, file-system, network, camera or capture API. */
const {contextBridge,ipcRenderer}=require("electron");
const descriptor=Object.freeze({
 kind:"desktop",
 channel:"public-preview",
 protocol:1,
 shellVersion:"0.1.0",
 capabilities:Object.freeze([]),
 consumeSignInToken:()=>ipcRenderer.invoke("adminerva:consume-signin-token"),
 confirmSignIn:()=>ipcRenderer.invoke("adminerva:confirm-signin")
});
contextBridge.exposeInMainWorld("adminervaClient",descriptor);
