"use strict";
const {createHash}=require("node:crypto");

function normalizeGuardianEmail(value){
  const email=String(value||"").trim().toLowerCase();
  if(!email||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return "";
  return email;
}
function guardianContactIdForEmail(value){
  const email=normalizeGuardianEmail(value);
  if(!email)return "";
  return "g_"+createHash("sha256").update("guardian\0"+email).digest("hex").slice(0,40);
}
function guardianRelationshipId(studentPersonId,guardianContactId){
  const student=String(studentPersonId||"").trim(),contact=String(guardianContactId||"").trim();
  if(!student||!contact)return "";
  return "gr_"+createHash("sha256").update(student+"\0"+contact).digest("hex").slice(0,40);
}
module.exports={normalizeGuardianEmail,guardianContactIdForEmail,guardianRelationshipId};
