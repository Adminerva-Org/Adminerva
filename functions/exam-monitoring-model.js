"use strict";
/** Non-persisting, non-grading event contract. Server will bind identity and session. */
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const BROWSER_KINDS=Object.freeze(["exam_started","page_hidden","page_visible","window_blurred","window_focused","network_offline","network_online","exam_stopped"]);
const COMPANION_KINDS=Object.freeze(["companion_started","companion_stopped","foreground_application","running_applications","capture_started","capture_stopped","capture_interrupted"]);
const MAX_EVENTS=20;
function normalizeBrowserBatch(input){
 if(!input||typeof input!=="object"||typeof input.taskId!=="string"||!ID.test(input.taskId)||
  !Number.isSafeInteger(input.sessionEpoch)||input.sessionEpoch<1)throw TypeError("Invalid exam session.");
 if(!Array.isArray(input.events)||input.events.length<1||input.events.length>MAX_EVENTS)
  throw TypeError("Exam event batch must be bounded.");
 return {taskId:input.taskId,sessionEpoch:input.sessionEpoch,source:"browser",events:input.events.map(event=>{
  if(!event||!BROWSER_KINDS.includes(event.kind)||!Number.isSafeInteger(event.clientAt)||event.clientAt<0)
   throw TypeError("Invalid browser activity event.");
  return {kind:event.kind,clientAt:event.clientAt};
 })};
}
function cleanApp(value){
 if(typeof value!=="string")throw TypeError("Invalid application name.");
 const label=value.trim();
 if(!label||label.length>80||/[\u0000-\u001f/\\]/.test(label))
  throw TypeError("Application names must not contain paths or control characters.");
 return label;
}
function normalizeCompanionObservation(input){
 if(!input||!COMPANION_KINDS.includes(input.kind))throw TypeError("Invalid Companion event.");
 const result={kind:input.kind};
 if(input.kind==="foreground_application")result.application=cleanApp(input.application);
 if(input.kind==="running_applications"){
  if(!Array.isArray(input.applications)||input.applications.length>40)throw TypeError("Too many applications.");
  result.applications=[...new Set(input.applications.map(cleanApp))].sort();
 }
 return result;
}
module.exports={BROWSER_KINDS,COMPANION_KINDS,MAX_EVENTS,normalizeBrowserBatch,normalizeCompanionObservation};
