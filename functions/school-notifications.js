"use strict";
/** Tenant-tagged per-user notification feed writer for V4 school workflows. */
const {FieldValue}=require("firebase-admin/firestore");
const allowedTypes=new Set(["assessment","submission","grade","grading","issue","reclaim"]);
const allowedPages=new Set([
  "student-assessments.html","gradebook.html","teacher-assessment-library.html",
  "reclaim-inbox.html","people-access.html","issues.html","student-playground.html",
  "school-support.html"
]);
function cleanId(value){return String(value||"event").replace(/[^A-Za-z0-9_-]/g,"_").slice(0,180);}
function safeTarget(value){
  const text=String(value||"student-assessments.html").trim();
  const match=text.match(/^([A-Za-z0-9_.-]+[.]html)(?:[?][A-Za-z0-9%_.=&-]+)?$/);
  return match&&allowedPages.has(match[1])?text:"student-assessments.html";
}
async function writeSchoolNotification({db,schoolId,uid,id,title,body,type,sourceId,target}){
  if(typeof schoolId!=="string"||!schoolId||typeof uid!=="string"||!uid)return {created:false};
  const eventId=cleanId(schoolId+"_"+id),ref=db.doc("notifications/"+uid+"/items/"+eventId);
  const payload={
    schoolId,title:String(title||"Adminerva").slice(0,160),
    body:String(body||"").slice(0,300),
    type:allowedTypes.has(type)?type:"assessment",
    sourceId:sourceId?String(sourceId).slice(0,150):null,
    target:safeTarget(target),createdAt:FieldValue.serverTimestamp(),readAt:null
  };
  try{await ref.create(payload);return {created:true,id:eventId};}
  catch(error){
    if(error.code===6||error.code==="already-exists")return {created:false,id:eventId};
    throw error;
  }
}
module.exports={writeSchoolNotification,safeTarget,cleanId};
