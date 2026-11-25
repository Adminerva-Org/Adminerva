"use strict";
/**
 * Server-owned quotas for unreleased native device handoff.
 *
 * These quotas reduce accidental/automated abuse; they are NOT a replacement
 * for Cloud Armor / platform-edge throttling and native client attestation.
 * The IP comes only from the Firebase/Express raw request, never request.data,
 * X-Forwarded-For supplied in JSON, or a renderer-provided fingerprint.
 */
const {createHmac}=require("node:crypto");
const {isIP}=require("node:net");
const WINDOW_MS=10*60*1000;
const TTL_AFTER_WINDOW_MS=60*60*1000;
const LIMITS=Object.freeze({
 begin:Object.freeze({source:120}),
 authorize:Object.freeze({source:180,account:12}),
 redeem:Object.freeze({source:4800}),
 cancel:Object.freeze({source:240})
});
class HandoffLimitError extends Error{
 constructor(code,message){super(message);this.code=code;this.name="HandoffLimitError";}
}
function refuse(code,message){throw new HandoffLimitError(code,message);}
function key(secret,scope,action,identity,bucket){
 return scope+"_"+action+"_"+createHmac("sha256",secret)
  .update(scope+"\n"+action+"\n"+identity+"\n"+bucket).digest("hex").slice(0,48);
}
function createNativeHandoffLimiter({db,Timestamp,secret}){
 if(!db||!Timestamp)throw Error("Native handoff quota requires Firestore.");
 return async function checkNativeHandoffQuota(request,action,clock){
  // No weak default salt: without deployment-specific protection, fail closed.
  if(typeof secret!=="string"||Buffer.byteLength(secret,"utf8")<32)
   refuse("failed-precondition","Native sign-in rate controls are not configured.");
  if(!Number.isSafeInteger(clock)||clock<0||!Object.hasOwn(LIMITS,action))
   refuse("invalid-argument","Invalid device sign-in rate context.");
  const remote=request?.rawRequest?.ip;
  // req.ip depends on infrastructure proxy configuration. Production
  // readiness must independently validate that it cannot be spoofed.
  if(typeof remote!=="string"||isIP(remote)===0)
   refuse("failed-precondition","Device sign-in source could not be verified.");
  const bucket=Math.floor(clock/WINDOW_MS);
  const specs=[{scope:"source",identity:remote,limit:LIMITS[action].source}];
  if(action==="authorize"){
   const uid=request?.auth?.uid;
   if(typeof uid!=="string"||!uid)
    refuse("unauthenticated","Sign in to approve an application.");
   specs.push({scope:"account",identity:uid,limit:LIMITS.authorize.account});
  }
  const quotas=specs.map(spec=>({
   ...spec,
   ref:db.doc("native_client_handoff_rate_limits/"+
    key(secret,spec.scope,action,spec.identity,bucket))
  }));
  await db.runTransaction(async tx=>{
   // Read all documents before making any writes for Firestore transaction
   // correctness across multiple instances and classroom/lab concurrency.
   const snapshots=[];
   for(const row of quotas)snapshots.push(await tx.get(row.ref));
   if(snapshots.some((s,i)=>
    s.exists&&Number(s.data()?.count||0)>=quotas[i].limit))
    refuse("resource-exhausted","Too many device sign-in requests. Retry later.");
   for(let i=0;i<quotas.length;i++){
    const existing=snapshots[i].exists?Number(snapshots[i].data()?.count||0):0;
    tx.set(quotas[i].ref,{
     action,scope:quotas[i].scope,
     windowStartMs:bucket*WINDOW_MS,count:existing+1,
     expiresAt:Timestamp.fromMillis((bucket+1)*WINDOW_MS+TTL_AFTER_WINDOW_MS)
    });
   }
  });
  return true;
 };
}
module.exports={createNativeHandoffLimiter,HandoffLimitError,LIMITS,WINDOW_MS};
