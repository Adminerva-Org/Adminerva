"use strict";
/**
 * Adminerva 4.0 school file policy.
 *
 * Storage stays fail-closed until a school administrator explicitly enables the
 * narrow support-attachment workflow and chooses a bounded retention period.
 */
const {FieldValue}=require("firebase-admin/firestore");
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");

const POLICY_SCHEMA="adminerva-school-file-policy-v1";
const RETENTION_DAYS=new Set([30,90,180,365]);
const MAX_BYTES=new Set([1048576,2097152,5242880]);
const ALLOWED_CONTENT_TYPES=[
 "image/png","image/jpeg","image/webp","application/pdf","text/plain"
];
function deny(code,message){throw new TenantAccessError(code,message)}
function createSchoolFilePolicyService({db}){
 return async request=>{
  const input=request.data||{};
  const ctx=await getSchoolContext({db,request,schoolId:input.schoolId});
  const prefix="schools/"+ctx.schoolId+"/",
   policyRef=db.doc(prefix+"private_config/file_policy"),
   schoolRef=db.doc("platform_schools/"+ctx.schoolId),
   memberRef=db.doc(prefix+"memberships/"+ctx.uid);
  const admin=ctx.roles.includes("school_admin");

  async function liveAuthority(tx){
   const [school,member]=await Promise.all([tx.get(schoolRef),tx.get(memberRef)]);
   if(!school.exists||school.data().state!=="active"||!member.exists||
      member.data().schoolId!==ctx.schoolId||member.data().status!=="active")
    deny("permission-denied","Your school access changed. Refresh before continuing.");
   const roles=Array.isArray(member.data().roles)?member.data().roles:[];
   if(!roles.some(role=>["student","teacher","school_admin"].includes(role)))
    deny("permission-denied","Your school role cannot use school files.");
   return {school,roles};
  }
  function publicPolicy(data){
   if(!data||data.schema!==POLICY_SCHEMA)return {
    configured:false,enabled:false,supportAttachmentsEnabled:false,
    retentionDays:null,maxBytes:null,allowedContentTypes:ALLOWED_CONTENT_TYPES
   };
   return {
    configured:true,enabled:data.enabled===true,
    supportAttachmentsEnabled:data.enabled===true&&data.supportAttachmentsEnabled===true,
    retentionDays:data.retentionDays,maxBytes:data.maxBytes,
    allowedContentTypes:ALLOWED_CONTENT_TYPES,
    revision:data.revision||1,updatedAt:data.updatedAt?.toMillis?.()||null
   };
  }

  if((input.action||"status")==="status"){
   await liveAuthority({get:ref=>ref.get()});
   const policy=await policyRef.get();
   return {schoolId:ctx.schoolId,policy:publicPolicy(policy.data()),
    canConfigure:admin};
  }

  if(input.action==="configure"){
   if(!admin)deny("permission-denied","Only a school administrator may configure file retention.");
   const enabled=input.enabled===true,
    supportAttachmentsEnabled=enabled&&input.supportAttachmentsEnabled===true,
    retentionDays=Number(input.retentionDays),maxBytes=Number(input.maxBytes),
    reason=String(input.reason||"").trim();
   if(!RETENTION_DAYS.has(retentionDays))
    deny("invalid-argument","Choose a supported retention period of 30, 90, 180 or 365 days.");
   if(!MAX_BYTES.has(maxBytes))
    deny("invalid-argument","Choose a supported per-file limit of 1 MB, 2 MB or 5 MB.");
   if(reason.length<12||reason.length>1000)
    deny("invalid-argument","Explain the file-policy decision in 12–1,000 characters.");
   const auditRef=db.collection(prefix+"file_audit").doc();
   let result;
   await db.runTransaction(async tx=>{
    const authority=await liveAuthority(tx);
    if(!authority.roles.includes("school_admin"))
     deny("permission-denied","Your school administration access changed.");
    const prior=await tx.get(policyRef),revision=(prior.data()?.revision||0)+1,
     now=FieldValue.serverTimestamp();
    const next={
     schema:POLICY_SCHEMA,schoolId:ctx.schoolId,enabled,
     supportAttachmentsEnabled,retentionDays,maxBytes,
     allowedContentTypes:ALLOWED_CONTENT_TYPES,
     revision,updatedByUid:ctx.uid,updatedAt:now
    };
    tx.set(policyRef,next);
    tx.update(schoolRef,{storageEnabled:enabled&&supportAttachmentsEnabled,
      updatedAt:now});
    tx.create(auditRef,{schoolId:ctx.schoolId,actorUid:ctx.uid,
     action:"school_file_policy_configured",revision,reason,
     before:prior.exists?publicPolicy(prior.data()):null,
     after:{enabled,supportAttachmentsEnabled,retentionDays,maxBytes},
     createdAt:now});
    result={...publicPolicy(next),updatedAt:null};
   });
   return {schoolId:ctx.schoolId,policy:result};
  }

  deny("invalid-argument","Unknown school file-policy operation.");
 };
}
module.exports={POLICY_SCHEMA,RETENTION_DAYS,MAX_BYTES,ALLOWED_CONTENT_TYPES,
 createSchoolFilePolicyService};
