"use strict";
/**
 * Resolve legacy MCS student rows for a signed-in account.
 *
 * Recovery-safe precedence:
 * 1. canonical person legacyStudentIds (newer adoption path);
 * 2. canonical person previousAuthUids -> historical Firebase Auth email
 *    -> legacy students row (older canonical-foundation migration);
 * 3. current verified email only for non-recovered/legacy-only accounts.
 *
 * Never match by display name or section.
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
function cleanUids(value,currentUid){
  return [...new Set((Array.isArray(value)?value:[])
    .map(item=>String(item||"").trim())
    .filter(item=>item&&item!==currentUid&&item.length<=128))].slice(-20);
}
async function canonicalStudentIdentity({db,uid,schoolId}){
  if(!uid)return null;
  const member=await db.doc("schools/"+schoolId+"/memberships/"+uid).get();
  if(!member.exists)return null;
  const membership=member.data()||{};
  if(membership.schoolId!==schoolId||membership.status!=="active"||
     !Array.isArray(membership.roles)||!membership.roles.includes("student"))
    return {invalid:true};
  const personId=String(membership.personId||"").trim();
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(personId))return {invalid:true};
  const person=await db.doc("schools/"+schoolId+"/people/"+personId).get();
  if(!person.exists)return {invalid:true};
  const data=person.data()||{};
  if(data.schoolId!==schoolId||data.kind!=="student"||data.status!=="active"||data.authUid!==uid)
    return {invalid:true};
  return {personId,data};
}
async function recordsForIds({db,ids,maxRecords}){
  const clean=cleanLegacyIds(ids,maxRecords);
  if(!clean.length)return [];
  const docs=await db.getAll(...clean.map(id=>db.doc("students/"+id)));
  return docs.filter(doc=>doc.exists&&activeLegacyStudent(doc.data()))
    .map(doc=>({id:doc.id,data:doc.data()}));
}
async function recordsForEmails({db,emails,maxRecords}){
  const unique=[...new Set(emails.map(normalizeEmail).filter(Boolean))];
  const found=new Map();
  for(const email of unique){
    const remaining=maxRecords-found.size;
    if(remaining<=0)break;
    const snap=await db.collection("students").where("email","==",email).limit(remaining).get();
    for(const doc of snap.docs){
      if(activeLegacyStudent(doc.data()))found.set(doc.id,{id:doc.id,data:doc.data()});
      if(found.size>=maxRecords)break;
    }
  }
  return [...found.values()];
}
async function historicalEmails({uids,resolveUser}){
  if(typeof resolveUser!=="function"||!uids.length)return [];
  const emails=[];
  for(const uid of uids){
    try{
      const user=await resolveUser(uid);
      const email=normalizeEmail(user?.email);
      if(email)emails.push(email);
    }catch(error){
      if(error?.code==="auth/user-not-found")continue;
      throw error;
    }
  }
  return [...new Set(emails)];
}
async function legacyStudentRecordsForAccount({
  db,uid,email,schoolId=SCHOOL_ID,maxRecords=50,resolveUser=null
}){
  if(!db)throw Error("Firestore is required.");
  const bounded=Math.max(1,Math.min(Number(maxRecords)||50,100));
  const canonical=await canonicalStudentIdentity({db,uid,schoolId});
  if(canonical?.invalid)return {source:"canonical_invalid",records:[]};

  if(canonical){
    const direct=await recordsForIds({
      db,ids:canonical.data.legacyStudentIds,maxRecords:bounded
    });
    if(direct.length)return {source:"canonical_person",records:direct};

    const previousUids=cleanUids(canonical.data.previousAuthUids,uid);
    if(previousUids.length){
      const emails=await historicalEmails({uids:previousUids,resolveUser});
      const historical=await recordsForEmails({db,emails,maxRecords:bounded});
      if(historical.length)return {source:"canonical_account_history",records:historical};
      // Recovered identities fail closed. Do not accidentally bind a replacement
      // account's current email to a different legacy student row.
      return {source:"canonical_history_unmapped",records:[]};
    }
  }

  const normalized=normalizeEmail(email);
  if(!normalized)return {source:canonical?"canonical_unmapped":"none",records:[]};
  const records=await recordsForEmails({db,emails:[normalized],maxRecords:bounded});
  return {
    source:canonical?"canonical_email_fallback":"email_fallback",
    records
  };
}

module.exports={
  SCHOOL_ID,normalizeEmail,activeLegacyStudent,legacyStudentRecordsForAccount
};
