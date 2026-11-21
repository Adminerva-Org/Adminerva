"use strict";
/**
 * Resolve legacy MCS student rows for a signed-in account.
 * Canonical person legacyStudentIds are authoritative after account recovery.
 * Email lookup remains a fallback for legacy-only students.
 */
const SCHOOL_ID="mcs-manila";

function normalizeEmail(value){
  const email=String(value||"").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:"";
}
function activeLegacyStudent(data){
  return data&&data.active!==false&&
    !["disabled","archived","suspended","inactive","deleted","ended"].includes(
      String(data.status||"active").toLowerCase()
    );
}
function cleanLegacyIds(value,maxRecords){
  return [...new Set((Array.isArray(value)?value:[])
    .map(item=>String(item||"").trim())
    .filter(item=>/^[A-Za-z0-9_-]{1,128}$/.test(item)))].slice(0,maxRecords);
}
async function canonicalLegacyRows({db,uid,schoolId,maxRecords}){
  if(!uid)return null;
  const member=await db.doc("schools/"+schoolId+"/memberships/"+uid).get();
  if(!member.exists)return null;
  const membership=member.data()||{};
  if(membership.schoolId!==schoolId||membership.status!=="active"||
     !Array.isArray(membership.roles)||!membership.roles.includes("student"))
    return null;
  const personId=String(membership.personId||"").trim();
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(personId))
    return {source:"canonical_invalid",records:[]};
  const person=await db.doc("schools/"+schoolId+"/people/"+personId).get();
  if(!person.exists)return {source:"canonical_invalid",records:[]};
  const data=person.data()||{};
  if(data.schoolId!==schoolId||data.kind!=="student"||data.status!=="active"||data.authUid!==uid)
    return {source:"canonical_invalid",records:[]};
  const ids=cleanLegacyIds(data.legacyStudentIds,maxRecords);
  if(!ids.length)return null;
  const docs=await db.getAll(...ids.map(id=>db.doc("students/"+id)));
  return {
    source:"canonical_person",
    records:docs.filter(doc=>doc.exists&&activeLegacyStudent(doc.data()))
      .map(doc=>({id:doc.id,data:doc.data()}))
  };
}
async function legacyStudentRecordsForAccount({
  db,uid,email,schoolId=SCHOOL_ID,maxRecords=50
}){
  if(!db)throw Error("Firestore is required.");
  const bounded=Math.max(1,Math.min(Number(maxRecords)||50,100));
  const canonical=await canonicalLegacyRows({db,uid,schoolId,maxRecords:bounded});
  if(canonical)return canonical;
  const normalized=normalizeEmail(email);
  if(!normalized)return {source:"none",records:[]};
  const snap=await db.collection("students").where("email","==",normalized).limit(bounded).get();
  return {
    source:"email_fallback",
    records:snap.docs.filter(doc=>activeLegacyStudent(doc.data()))
      .map(doc=>({id:doc.id,data:doc.data()}))
  };
}

module.exports={
  SCHOOL_ID,normalizeEmail,activeLegacyStudent,legacyStudentRecordsForAccount
};
