"use strict";
/** Desktop PUBLIC PREVIEW navigation policy. Never use this as a native auth boundary. */
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
function classifyNavigation(raw){
 // Reject disguised path traversal before URL canonicalization removes dot segments.
 // The preview must not turn a traversed app route into a browser launch.
 if(typeof raw!=="string"||raw.includes("\\")||
    /(?:\/|%2f)(?:\.|%2e){1,2}(?:\/|%2f)/i.test(raw))return {action:"block"};
 let url;
 try{url=new URL(raw);}catch{return {action:"block"};}
 if(url.protocol!=="https:"||url.username||url.password)return {action:"block"};
 if(url.origin===APP_ORIGIN&&url.pathname.startsWith(APP_PREFIX)){
  const route=url.pathname.slice(APP_PREFIX.length);
  if(PUBLIC_PAGES.has(route))return {action:"internal",url:url.href};
 }
 if(EXTERNAL_ORIGINS.has(url.origin))return {action:"external",url:url.href};
 return {action:"block"};
}
module.exports={APP_ORIGIN,START_URL,PUBLIC_PAGES,EXTERNAL_ORIGINS,classifyNavigation};
