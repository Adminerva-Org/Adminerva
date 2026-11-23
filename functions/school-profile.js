"use strict";

const {FieldValue}=require("firebase-admin/firestore");
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");

function deny(code,message){throw new TenantAccessError(code,message)}
function requiredText(value,label,max=160){
  const out=typeof value==="string"?value.trim():"";
  if(out.length<2||out.length>max)deny("invalid-argument",label+" is required and must be shorter.");
  return out;
}
function optionalText(value,label,max=160){
  const out=typeof value==="string"?value.trim():"";
  if(out.length>max)deny("invalid-argument",label+" is too long.");
  return out||null;
}
function email(value){
  const out=optionalText(value,"Primary email",254);
  if(!out)return null;
  const normalized=out.toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))
    deny("invalid-argument","Enter a valid primary school email.");
  return normalized;
}
function website(value){
  const out=optionalText(value,"Website",300);
  if(!out)return null;
  let url;
  try{url=new URL(out);}catch{deny("invalid-argument","Enter a valid school website URL.");}
  if(!["http:","https:"].includes(url.protocol))
    deny("invalid-argument","School website must use http or https.");
  return url.href.slice(0,300);
}
function timezone(value){
  const out=requiredText(value,"Timezone",64);
  if(!/^(?:UTC|[A-Za-z_+-]+(?:\/[A-Za-z0-9_+.-]+)+)$/.test(out))
    deny("invalid-argument","Use an IANA timezone such as Asia/Manila or UTC.");
  try{new Intl.DateTimeFormat("en",{timeZone:out}).format(new Date());}
  catch{deny("invalid-argument","Use a valid IANA timezone such as Asia/Manila.");}
  return out;
}
function locale(value){
  const out=optionalText(value,"Locale",24)||"en-PH";
  if(!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(out))
    deny("invalid-argument","Locale must look like en-PH.");
  return out;
}
function revision(value,{allowZero=false}={}){
  const n=Number(value),min=allowZero?0:1;
  if(!Number.isSafeInteger(n)||n<min)deny("invalid-argument","Refresh this record before saving changes.");
  return n;
}
function campusId(value){
  const out=String(value||"").trim();
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(out))
    deny("invalid-argument","Campus identifier is invalid.");
  return out;
}
function institutionType(value){
  const out=String(value||"").trim().toLowerCase();
  const allowed=new Set(["basic_education","higher_education","training","mixed","other"]);
  if(!allowed.has(out))deny("invalid-argument","Choose a valid institution type.");
  return out;
}
function profilePayload(input){
  return {
    officialName:requiredText(input.officialName,"Official school name",160),
    shortName:optionalText(input.shortName,"Short name",60),
    institutionType:institutionType(input.institutionType),
    primaryEmail:email(input.primaryEmail),
    phone:optionalText(input.phone,"Phone",50),
    website:website(input.website),
    timezone:timezone(input.timezone),
    locale:locale(input.locale),
    addressLine1:optionalText(input.addressLine1,"Address line 1",180),
    addressLine2:optionalText(input.addressLine2,"Address line 2",180),
    city:optionalText(input.city,"City / municipality",100),
    region:optionalText(input.region,"Province / region",120),
    postalCode:optionalText(input.postalCode,"Postal code",30),
    country:optionalText(input.country,"Country",100)
  };
}
function campusPayload(input){
  return {
    name:requiredText(input.name,"Campus name",140),
    code:(optionalText(input.code,"Campus code",40)||"").toUpperCase()||null,
    addressLine1:optionalText(input.addressLine1,"Campus address",180),
    addressLine2:optionalText(input.addressLine2,"Campus address line 2",180),
    city:optionalText(input.city,"Campus city / municipality",100),
    region:optionalText(input.region,"Campus province / region",120),
    postalCode:optionalText(input.postalCode,"Campus postal code",30),
    country:optionalText(input.country,"Campus country",100),
    timezone:input.timezone?timezone(input.timezone):null
  };
}
function publicProfile(doc,school){
  const row=doc?.exists?doc.data():{};
  return {
    schoolId:school.id,
    platformDisplayName:String(school.data().displayName||school.id).slice(0,160),
    officialName:row.officialName||school.data().displayName||"",
    shortName:row.shortName||"",
    institutionType:row.institutionType||"basic_education",
    primaryEmail:row.primaryEmail||"",
    phone:row.phone||"",
    website:row.website||"",
    timezone:row.timezone||"Asia/Manila",
    locale:row.locale||"en-PH",
    addressLine1:row.addressLine1||"",
    addressLine2:row.addressLine2||"",
    city:row.city||"",
    region:row.region||"",
    postalCode:row.postalCode||"",
    country:row.country||"Philippines",
    revision:doc?.exists?(Number(row.revision)||1):0
  };
}

function createSchoolProfileService({db}){
  return async request=>{
    const input=request.data||{};
    const ctx=await getSchoolContext({
      db,request,schoolId:input.schoolId,roles:["school_admin"],allowDraftAdmin:true
    });
    const root="schools/"+ctx.schoolId+"/";
    const schoolRef=db.doc("platform_schools/"+ctx.schoolId);
    const adminRef=db.doc(root+"memberships/"+ctx.uid);
    const profileRef=db.doc(root+"configuration/profile");

    async function requireCurrentAdmin(tx){
      if(ctx.platformOverride)return;
      const [school,member]=await Promise.all([tx.get(schoolRef),tx.get(adminRef)]);
      if(!school.exists||!["draft","pilot","active"].includes(school.data().state)||
         !member.exists||member.data().schoolId!==ctx.schoolId||member.data().status!=="active"||
         !Array.isArray(member.data().roles)||!member.data().roles.includes("school_admin"))
        deny("permission-denied","School administration access changed. Refresh before saving.");
    }

    if(input.action==="get"){
      const [school,profile,campuses]=await Promise.all([
        schoolRef.get(),profileRef.get(),db.collection(root+"campuses").limit(101).get()
      ]);
      if(!school.exists)deny("not-found","School tenant was not found.");
      if(campuses.size===101)deny("resource-exhausted","Campus list requires pagination.");
      return {
        profile:publicProfile(profile,school),
        campuses:campuses.docs.filter(doc=>doc.data().schoolId===ctx.schoolId).map(doc=>({
          campusId:doc.id,
          name:doc.data().name||doc.id,
          code:doc.data().code||"",
          addressLine1:doc.data().addressLine1||"",
          addressLine2:doc.data().addressLine2||"",
          city:doc.data().city||"",
          region:doc.data().region||"",
          postalCode:doc.data().postalCode||"",
          country:doc.data().country||"",
          timezone:doc.data().timezone||"",
          status:doc.data().status||"active",
          revision:Number(doc.data().revision)||1
        })).sort((a,b)=>(a.status==="active"?0:1)-(b.status==="active"?0:1)||a.name.localeCompare(b.name))
      };
    }

    if(input.action==="save_profile"){
      const expectedRevision=revision(input.expectedRevision,{allowZero:true}),payload=profilePayload(input);
      const auditRef=db.collection(root+"directory_audit").doc();
      let nextRevision;
      await db.runTransaction(async tx=>{
        await requireCurrentAdmin(tx);
        const current=await tx.get(profileRef),currentRevision=current.exists?(Number(current.data().revision)||1):0;
        if(currentRevision!==expectedRevision)
          deny("failed-precondition","The school profile changed after you opened it. Refresh and review the latest values before saving.");
        const now=FieldValue.serverTimestamp();nextRevision=currentRevision+1;
        const data={schoolId:ctx.schoolId,...payload,revision:nextRevision,updatedByUid:ctx.uid,updatedAt:now};
        if(current.exists)tx.set(profileRef,data,{merge:true});
        else tx.create(profileRef,{...data,createdByUid:ctx.uid,createdAt:now});
        tx.create(auditRef,{schoolId:ctx.schoolId,actorUid:ctx.uid,action:"school_profile_saved",
          revision:nextRevision,createdAt:now});
      });
      return {schoolId:ctx.schoolId,revision:nextRevision};
    }

    if(input.action==="create_campus"){
      const payload=campusPayload(input),ref=db.collection(root+"campuses").doc(),
        auditRef=db.collection(root+"directory_audit").doc();
      await db.runTransaction(async tx=>{
        await requireCurrentAdmin(tx);
        if(payload.code){
          const sameCode=await tx.get(db.collection(root+"campuses").where("code","==",payload.code).limit(2));
          if(sameCode.docs.some(doc=>doc.data().schoolId===ctx.schoolId))
            deny("already-exists","Another campus already uses code "+payload.code+".");
        }
        const now=FieldValue.serverTimestamp();
        tx.create(ref,{schoolId:ctx.schoolId,...payload,status:"active",revision:1,
          createdByUid:ctx.uid,createdAt:now,updatedByUid:ctx.uid,updatedAt:now});
        tx.create(auditRef,{schoolId:ctx.schoolId,actorUid:ctx.uid,action:"school_campus_created",
          campusId:ref.id,campusName:payload.name,createdAt:now});
      });
      return {campusId:ref.id,status:"active",revision:1};
    }

    if(input.action==="update_campus"){
      const id=campusId(input.campusId),expectedRevision=revision(input.expectedRevision),
        payload=campusPayload(input),ref=db.doc(root+"campuses/"+id),
        auditRef=db.collection(root+"directory_audit").doc();
      let nextRevision;
      await db.runTransaction(async tx=>{
        await requireCurrentAdmin(tx);
        const current=await tx.get(ref);
        if(!current.exists||current.data().schoolId!==ctx.schoolId)deny("not-found","Campus was not found.");
        if(current.data().status!=="active")
          deny("failed-precondition","Restore this campus before editing its details.");
        if(payload.code){
          const sameCode=await tx.get(db.collection(root+"campuses").where("code","==",payload.code).limit(2));
          if(sameCode.docs.some(doc=>doc.id!==id&&doc.data().schoolId===ctx.schoolId))
            deny("already-exists","Another campus already uses code "+payload.code+".");
        }
        const currentRevision=Number(current.data().revision)||1;
        if(currentRevision!==expectedRevision)
          deny("failed-precondition","This campus changed after you opened it. Refresh and review the latest values before saving.");
        const now=FieldValue.serverTimestamp();nextRevision=currentRevision+1;
        tx.update(ref,{...payload,revision:nextRevision,updatedByUid:ctx.uid,updatedAt:now});
        tx.create(auditRef,{schoolId:ctx.schoolId,actorUid:ctx.uid,action:"school_campus_updated",
          campusId:id,campusName:payload.name,revision:nextRevision,createdAt:now});
      });
      return {campusId:id,status:"active",revision:nextRevision};
    }

    if(["archive_campus","restore_campus"].includes(input.action)){
      const id=campusId(input.campusId),expectedRevision=revision(input.expectedRevision),
        reason=requiredText(input.reason,input.action==="archive_campus"?"Archive reason":"Restore reason",500),
        ref=db.doc(root+"campuses/"+id),auditRef=db.collection(root+"directory_audit").doc(),
        restoring=input.action==="restore_campus";
      if(reason.length<12)deny("invalid-argument","Explain the campus status change in at least 12 characters.");
      let nextRevision;
      await db.runTransaction(async tx=>{
        await requireCurrentAdmin(tx);
        const current=await tx.get(ref);
        if(!current.exists||current.data().schoolId!==ctx.schoolId)deny("not-found","Campus was not found.");
        const row=current.data(),currentRevision=Number(row.revision)||1;
        if(currentRevision!==expectedRevision)
          deny("failed-precondition","This campus changed after you reviewed it. Refresh before changing its status.");
        if(restoring&&row.status!=="archived")deny("failed-precondition","Only an archived campus can be restored.");
        if(!restoring&&row.status!=="active")deny("failed-precondition","Only an active campus can be archived.");
        const now=FieldValue.serverTimestamp(),status=restoring?"active":"archived";nextRevision=currentRevision+1;
        tx.update(ref,{status,revision:nextRevision,updatedByUid:ctx.uid,updatedAt:now,
          ...(restoring?{restoredAt:now,restoredByUid:ctx.uid,restoreReason:reason}:
            {archivedAt:now,archivedByUid:ctx.uid,archiveReason:reason})});
        tx.create(auditRef,{schoolId:ctx.schoolId,actorUid:ctx.uid,
          action:restoring?"school_campus_restored":"school_campus_archived",
          campusId:id,campusName:String(row.name||id).slice(0,140),reason,revision:nextRevision,createdAt:now});
      });
      return {campusId:id,status:restoring?"active":"archived",revision:nextRevision};
    }

    deny("invalid-argument","Unknown School Profile operation.");
  };
}

module.exports={createSchoolProfileService};
