"use strict";
/**
 * MCS-only, read/write-isolated pilot access bridge.
 * Recognizes an already approved legacy teacher for PILOT APIs only.
 * Does not create canonical V4 memberships or grant access to V4 grade writes.
 */
const {TenantAccessError,getSchoolContext}=require("./tenant-access.js");
const MCS="mcs-manila";
const ORIGINAL_MCS_TEACHER="josephsixson@mcstayuman.edu.ph";
const fail=(code,message)=>{throw new TenantAccessError(code,message)};
function verifiedEmail(user){
  return user?.emailVerified===true&&!user.disabled&&typeof user.email==="string"
    ?user.email.trim().toLowerCase():"";
}
async function approvedPilotTeacher({db,auth,schoolId,uid,userRecord}){
  if(typeof uid!=="string"||! /^[A-Za-z0-9_-]{1,128}$/.test(uid))return false;
  const user=userRecord||await auth.getUser(uid).catch(()=>null);
  const email=verifiedEmail(user);
  if(!email)return false;
  const memberRef=db.doc("schools/"+schoolId+"/memberships/"+uid);
  const member=await memberRef.get(),m=member.data();
  // Explicit canonical suspension or role restrictions always win over legacy.
  if(member.exists){
    return m?.schoolId===schoolId&&m.status==="active"&&
      Array.isArray(m.roles)&&m.roles.includes("teacher");
  }
  if(schoolId!==MCS)return false;
  const school=await db.doc("platform_schools/"+MCS).get();
  if(!school.exists||!["active","pilot"].includes(school.data()?.state)||
     school.data()?.compatibilityMode==="v4_only")return false;
  if(email===ORIGINAL_MCS_TEACHER)return true;
  const [staff,request]=await Promise.all([
    db.doc("staff_access/"+email).get(),
    db.doc("account_requests/"+uid).get()
  ]);
  const info=staff.data();
  if(!staff.exists||info?.role!=="teacher"||info.status!=="active"||
    String(info.email||"").trim().toLowerCase()!==email)return false;
  // A decided student or rejected request cannot be elevated by stale legacy staff data.
  if(request.exists && (request.data()?.status!=="approved"||
      request.data()?.approvedRole!=="teacher"||
      String(request.data()?.email||"").trim().toLowerCase()!==email))return false;
  return true;
}
async function pilotTeacherContext({db,auth,request,schoolId}){
  const uid=request?.auth?.uid;
  if(typeof uid!=="string"||!uid||request?.auth?.token?.email_verified!==true)
    fail("unauthenticated","Sign in with a verified teacher account.");
  if(schoolId!==MCS)
    fail("invalid-argument","The private pilot sandbox is currently available for MCS only.");
  const record=await auth.getUser(uid).catch(()=>null);
  const email=verifiedEmail(record);
  if(!email||email!==String(request.auth.token?.email||"").toLowerCase())
    fail("permission-denied","Refresh your verified school sign-in.");
  const school=await db.doc("platform_schools/"+MCS).get();
  if(!school.exists||!["active","pilot"].includes(school.data()?.state))
    fail("failed-precondition","MCS must be in controlled pilot or active state.");
  try{
    const canonical=await getSchoolContext({db,request,schoolId:MCS,roles:["teacher"]});
    return {...canonical,pilotAccess:"canonical"};
  }catch(error){
    if(error.code!=="permission-denied")throw error;
    // Explicit non-teacher or suspended canonical memberships may never
    // re-enter through the legacy teacher bridge.
    const membership=await db.doc("schools/"+MCS+"/memberships/"+uid).get();
    if(membership.exists)throw error;
    if(!await approvedPilotTeacher({db,auth,schoolId:MCS,uid,userRecord:record}))
      fail("permission-denied","This account needs approved MCS teacher access before using the private pilot.");
    return Object.freeze({uid,schoolId:MCS,roles:["teacher"],schoolState:school.data().state,
      pilotAccess:"verified_legacy_teacher",productionAuthorized:false});
  }
}
module.exports={pilotTeacherContext,approvedPilotTeacher,MCS};
