"use strict";
const {createHash}=require("node:crypto");

function normalizedRosterEmail(value){
  return typeof value==="string"?value.trim().toLowerCase():"";
}
function rosterEmailHash(value){
  const email=normalizedRosterEmail(value);
  if(!email)return null;
  return createHash("sha256").update("adminerva-roster-email\0"+email).digest("hex");
}
module.exports={normalizedRosterEmail,rosterEmailHash};
