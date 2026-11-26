"use strict";
/** Native PKCE pairing material. Never include verifier or code in a URL. */
const {randomBytes,randomInt,createHash}=require("node:crypto");
const {APP_ORIGIN,APP_PREFIX}=require("./navigation-policy.cjs");
const CONFIRMATION_LENGTH=8;
function generatePairing(){
 const flowId=randomBytes(32).toString("base64url");
 const bytes=randomBytes(32);
 const verifier=bytes.toString("base64url");
 const challenge=createHash("sha256").update(bytes).digest("base64url");
 const confirmationCode=String(randomInt(0,10**CONFIRMATION_LENGTH)).padStart(CONFIRMATION_LENGTH,"0");
 return Object.freeze({
  flowId,verifier,challenge,confirmationCode,
  browserUrl:APP_ORIGIN+APP_PREFIX+"native-connect.html?flow="+encodeURIComponent(flowId)
 });
}
function publicPairingView(pairing){
 return Object.freeze({confirmationCode:pairing.confirmationCode,browserUrl:pairing.browserUrl});
}
module.exports={generatePairing,publicPairingView};
