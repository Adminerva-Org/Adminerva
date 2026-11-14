"use strict";
/**
 * Adminerva 4.0 school authority. Firebase Admin SDK only.
 * Never derive tenancy from an email domain, URL, cached role or a client-owned index.
 * This module does not migrate or modify legacy flat collections.
 */
class TenantAccessError extends Error {
  constructor(code, message) { super(message); this.code=code; this.name="TenantAccessError"; }
}
const VALID_ROLES=new Set(["student","teacher","school_admin"]);
function checkedSchoolId(value) {
  if(typeof value!=="string" || !/^[a-z][a-z0-9-]{1,63}$/.test(value))
    throw new TenantAccessError("invalid-argument","Select a valid school.");
  return value;
}
function verifiedUid(request) {
  const uid=request?.auth?.uid;
  if(typeof uid!=="string" || !uid || request?.auth?.token?.email_verified!==true)
    throw new TenantAccessError("unauthenticated","Sign in with a verified account.");
  return uid;
}
function activeRoles(membership) {
  if(membership?.status!=="active" || !Array.isArray(membership.roles)) return [];
  return [...new Set(membership.roles.filter(role=>VALID_ROLES.has(role)))];
}
async function getSchoolContext({db,request,schoolId,roles=[],allowDraftAdmin=false}) {
  const uid=verifiedUid(request), id=checkedSchoolId(schoolId);
  const schoolRef=db.doc("platform_schools/"+id);
  const memberRef=db.doc("schools/"+id+"/memberships/"+uid);
  const [school,member,platform]=await Promise.all([
    schoolRef.get(),memberRef.get(),db.doc("platform_admins/"+uid).get()
  ]);
  const data=school.exists?school.data():null;
  const grant=member.exists?member.data():null;
  const memberRoles=activeRoles(grant);
  const platformOverride=Boolean(platform.exists&&platform.data().status==="active"&&
    platform.data().role==="platform_admin"&&data&&["draft","pilot","active","suspended"].includes(data.state));
  if(platformOverride){
    const overrideRoles=["school_admin","teacher","student"];
    return Object.freeze({uid,schoolId:id,roles:overrideRoles,membershipRevision:0,
      schoolState:data.state,productionAuthorized:data.productionAuthorized===true,platformOverride:true});
  }
  const stateAllowed=["active","pilot"].includes(data?.state) ||
    (allowDraftAdmin===true&&data?.state==="draft"&&memberRoles.includes("school_admin"));
  if(!stateAllowed || grant?.schoolId!==id || memberRoles.length===0)
    throw new TenantAccessError("permission-denied","Your access to this school is not active.");
  if(roles.length && !roles.some(role=>memberRoles.includes(role)))
    throw new TenantAccessError("permission-denied","This action is not granted for your school role.");
  return Object.freeze({uid,schoolId:id,roles:memberRoles,membershipRevision:grant.revision||0,
    schoolState:data.state,productionAuthorized:data.productionAuthorized===true,platformOverride:false});
}
async function platformAuthority({db,request}) {
  const uid=verifiedUid(request);
  const snapshot=await db.doc("platform_admins/"+uid).get();
  const data=snapshot.exists?snapshot.data():null;
  return Object.freeze({uid,platformAdmin:Boolean(data?.status==="active"&&data?.role==="platform_admin")});
}
async function listVerifiedSchools({db,request}) {
  const uid=verifiedUid(request);
  const platform=await db.doc("platform_admins/"+uid).get();
  if(platform.exists&&platform.data().status==="active"&&platform.data().role==="platform_admin"){
    const schools=await db.collection("platform_schools").orderBy("displayName").limit(100).get();
    return schools.docs.filter(doc=>doc.data().state!=="archived").map(doc=>({
      schoolId:doc.id,
      name:typeof doc.data().displayName==="string"&&doc.data().displayName.trim()?
        doc.data().displayName.trim().slice(0,120):doc.id,
      roles:["school_admin","teacher","student"],
      schoolState:doc.data().state,
      productionAuthorized:doc.data().productionAuthorized===true,
      compatibilityMode:doc.data().compatibilityMode||"legacy_allowed",
      platformOverride:true
    })).sort((a,b)=>a.name.localeCompare(b.name)||a.schoolId.localeCompare(b.schoolId));
  }
  const snapshot=await db.collection("platform_users").doc(uid).collection("memberships").limit(50).get();
  const options=await Promise.all(snapshot.docs.map(async entry=>{
    try {
      const ctx=await getSchoolContext({db,request,schoolId:entry.id,allowDraftAdmin:true});
      const school=await db.doc("platform_schools/"+ctx.schoolId).get();
      const label=school.data()?.displayName;
      return {
        schoolId:ctx.schoolId,
        name:typeof label==="string"&&label.trim()?label.trim().slice(0,120):ctx.schoolId,
        roles:ctx.roles,schoolState:ctx.schoolState,
        productionAuthorized:ctx.productionAuthorized,
        compatibilityMode:school.data()?.compatibilityMode||"legacy_allowed",
        platformOverride:false
      };
    }catch(error) {
      if(error instanceof TenantAccessError)return null;
      throw error;
    }
  }));
  return options.filter(Boolean).sort((a,b)=>a.name.localeCompare(b.name)||a.schoolId.localeCompare(b.schoolId));
}
function selectVerifiedSchool(options,preferredId) {
  if(!Array.isArray(options) || options.length===0) return {state:"no_school",schoolId:null,showSwitcher:false};
  if(options.length===1) return {state:"ready",schoolId:options[0].schoolId,showSwitcher:false};
  const preferred=options.find(option=>option.schoolId===preferredId);
  return {state:preferred?"ready":"choose_school",schoolId:preferred?.schoolId||null,showSwitcher:true};
}
module.exports={TenantAccessError,checkedSchoolId,verifiedUid,activeRoles,getSchoolContext,listVerifiedSchools,selectVerifiedSchool,platformAuthority};
