"use strict";
/** Strict Electron navigation. Private pages need a locally completed session. */
const APP_ORIGIN="https://adminerva-org.github.io";
const APP_PREFIX="/Adminerva/";
const START_URL=APP_ORIGIN+APP_PREFIX+"guest-home.html";
const PUBLIC_PAGES=Object.freeze(new Set([
 "index.html","guest-home.html","guest-playground.html","guest-practice.html",
 "guest-xml-lab.html","guest-settings.html","wiki.html","downloads.html",
 "opportunities.html","pulse.html","patch-notes.html","issues.html"
]));
const EXTERNAL_ORIGINS=Object.freeze(new Set([
 APP_ORIGIN,"https://github.com","https://www.github.com"
]));
const PRIVATE_ROUTE_RE=/^[a-zA-Z0-9-]{1,100}\.html$/;
function classifyNavigation(raw,{allowPrivate=false,allowBootstrap=false}={}){
 // Reject path traversal before WHATWG URL canonicalization.
 if(typeof raw!=="string"||raw.includes("\\")||
    /(?:\/|%2f)(?:\.|%2e){1,2}(?:\/|%2f)/i.test(raw))return {action:"block"};
 let url;
 try{url=new URL(raw);}catch{return {action:"block"};}
 if(url.protocol!=="https:"||url.username||url.password)return {action:"block"};
 if(url.origin===APP_ORIGIN&&url.pathname.startsWith(APP_PREFIX)){
  const route=url.pathname.slice(APP_PREFIX.length);
  if(PUBLIC_PAGES.has(route))return {action:"internal",url:url.href};
  if(route==="desktop-session.html"&&allowBootstrap)return {action:"internal",url:url.href};
  // The existing verified Firebase backend and role guards still control
  // every protected route, regardless of this client-side navigation state.
  // The native shell never considers the renderer's "role" to be authority.
  if(allowPrivate&&PRIVATE_ROUTE_RE.test(route)&&route!=="login.html")
   return {action:"internal",url:url.href};
 }
 if(EXTERNAL_ORIGINS.has(url.origin))return {action:"external",url:url.href};
 return {action:"block"};
}
module.exports={APP_ORIGIN,APP_PREFIX,START_URL,PUBLIC_PAGES,EXTERNAL_ORIGINS,classifyNavigation};
