"use strict";
/** Unprivileged, read-only shell descriptor. NOT authentication or authorization. */
const {contextBridge}=require("electron");
const descriptor=Object.freeze({
 kind:"desktop",
 channel:"public-preview",
 protocol:1,
 shellVersion:"0.1.0",
 capabilities:Object.freeze([])
});
contextBridge.exposeInMainWorld("adminervaClient",descriptor);
