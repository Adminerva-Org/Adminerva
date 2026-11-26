"use strict";
/**
 * Firebase callable wire adapter for an UNSHIPPED native sign-in experiment.
 * The only accepted endpoint is Adminerva's existing Firebase project.
 */
const FUNCTION_URL="https://asia-southeast1-reporeview-e7ca4.cloudfunctions.net/nativeClientHandoff";
const VALID_ACTIONS=new Set(["begin","redeem","cancel"]);
async function sendHandoff(action,pairing,{fetchImpl=fetch,signal}={}){
 if(!VALID_ACTIONS.has(action))throw Error("Unsupported desktop pairing action.");
 if(!pairing||typeof pairing.flowId!=="string")throw Error("Missing desktop pairing.");
 const data={action,flowId:pairing.flowId};
 if(action==="begin")Object.assign(data,{
  clientKind:"desktop",challenge:pairing.challenge,confirmationCode:pairing.confirmationCode
 });
 else data.verifier=pairing.verifier;
 const response=await fetchImpl(FUNCTION_URL,{
  method:"POST",headers:{"Content-Type":"application/json"},
  body:JSON.stringify({data}),redirect:"error",signal
 });
 if(!response.ok){
  // Do not log response payloads: a future server may include sensitive context.
  throw Error(response.status===404?"Native handoff callable is not deployed.":
   "Native sign-in unavailable (HTTP "+response.status+").");
 }
 const payload=await response.json();
 if(payload?.error){
  // Never stringify / log a backend error object. Keep it generic.
  throw Error("Native sign-in is unavailable or could not be completed.");
 }
 const result=payload?.result;
 if(!result||typeof result!=="object"||!["waiting","authorized","expired","unavailable","canceled"].includes(result.state))
  throw Error("Invalid native handoff response.");
 if(result.state==="authorized"&&
  (typeof result.customToken!=="string"||result.customToken.length<32||
   typeof result.uid!=="string"||!result.uid||result.uid.length>128))
  throw Error("Invalid native sign-in credential.");
 return result;
}
module.exports={FUNCTION_URL,sendHandoff};
