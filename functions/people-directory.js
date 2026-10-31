"use strict";
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");
const {FieldValue}=require("firebase-admin/firestore");
const {createHash}=require("node:crypto");
function invalid(message){throw new TenantAccessError("invalid-argument",message)}
function field(value,max,label) {
  if(typeof value!=="string"||!value.trim()||value.trim().length>max)invalid(label+" is required and must be shorter.");
  return value.trim();
}
function id(value){
  if(typeof value!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(value))invalid("Invalid record identifier.");
  return value;
}
function createPeopleDirectoryService({db}) {
  return async request=>{
    const input=request.data||{};
    const ctx=await getSchoolContext({db,request,schoolId:input.schoolId,roles:["school_admin"]});
    const base=db.collection("schools/"+ctx.schoolId+"/people");
    const schoolRef=db.doc("platform_schools/"+ctx.schoolId);
    const adminRef=db.doc("schools/"+ctx.schoolId+"/memberships/"+ctx.uid);
    async function requireCurrentAdmin(tx) {
      const school=await tx.get(schoolRef),member=await tx.get(adminRef);
      if(!school.exists||school.data().state!=="active"||!member.exists||
         member.data().status!=="active"||member.data().schoolId!==ctx.schoolId||
         !Array.isArray(member.data().roles)||!member.data().roles.includes("school_admin"))
        throw new TenantAccessError("permission-denied","School administration access has changed.");
    }

    if(input.action==="overview") {
      const scopes=["people","enrollments","staff_assignments","invitations"];
      const counts=await Promise.all(scopes.map(name=>db.collection("schools/"+ctx.schoolId+"/"+name).count().get()));
      return {schoolId:ctx.schoolId,counts:Object.fromEntries(scopes.map((name,i)=>[name,counts[i].data().count]))};
    }
    if(input.action==="list_people") {
      const pageSize=Math.min(25,Math.max(1,Number.isInteger(input.limit)?input.limit:25));
      let query=base.orderBy("searchKey").limit(pageSize+1);
      if(input.after!==undefined&&input.after!==null) {
        const after=field(input.after,300,"Pagination cursor");
        query=query.startAfter(after);
      }
      const snap=await query.get(),docs=snap.docs.slice(0,pageSize);
      // Minimal school administrative summaries; private credentials and grades are never in this response.
      return {
        items:docs.map(person=>({
          personId:person.id,displayName:person.data().displayName,
          kind:person.data().kind,status:person.data().status,
          accountLinked:Boolean(person.data().authUid),schoolId:ctx.schoolId
        })),
        nextCursor:snap.docs.length>pageSize?(docs.at(-1)?.data().searchKey||null):null
      };
    }
    if(input.action==="create_person") {
      const person=input.person||{};
      const displayName=field(person.displayName,140,"Person name");
      if(!["student","staff"].includes(person.kind))invalid("Choose student or staff.");
      const ref=base.doc(),audit=db.collection("schools/"+ctx.schoolId+"/directory_audit").doc();
      const now=FieldValue.serverTimestamp();
      await db.runTransaction(async tx=>{
        await requireCurrentAdmin(tx);
        tx.create(ref,{
          schoolId:ctx.schoolId,displayName,searchKey:displayName.toLocaleLowerCase("en")+"#"+ref.id,
          kind:person.kind,status:"active",authUid:null,createdByUid:ctx.uid,
          createdAt:now,updatedAt:now,revision:1
        });
        tx.create(audit,{schoolId:ctx.schoolId,actorUid:ctx.uid,personId:ref.id,
          action:"create_person",createdAt:now});
      });
      return {personId:ref.id,accountLinked:false};
    }
    if(input.action==="invite") {
      const email=field(input.email,254,"Email").toLowerCase();
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))invalid("Enter a valid invitation email.");
      if(!["student","teacher"].includes(input.role))invalid("Choose a student or teacher invitation.");
      const linkedPersonId=input.personId?id(input.personId):null;
      const invitationId=createHash("sha256").update(input.role+"\0"+email).digest("hex").slice(0,48);
      const ref=db.collection("schools/"+ctx.schoolId+"/invitations").doc(invitationId);
      const audit=db.collection("schools/"+ctx.schoolId+"/directory_audit").doc();
      const personRef=linkedPersonId?base.doc(linkedPersonId):null;
      await db.runTransaction(async tx=>{
        await requireCurrentAdmin(tx);
        const existing=await tx.get(ref);
        const person=personRef?await tx.get(personRef):null;
        if(personRef&&(!person.exists||person.data().schoolId!==ctx.schoolId))
          throw new TenantAccessError("failed-precondition","The person is not in this school directory.");
        if(existing.exists) {
          if(existing.data().status==="pending"&&existing.data().email===email&&
            existing.data().requestedRole===input.role)return;
          throw new TenantAccessError("already-exists","This invitation has already been processed. Use the recovery workflow.");
        }
        const now=FieldValue.serverTimestamp();
        tx.create(ref,{schoolId:ctx.schoolId,email,requestedRole:input.role,
          personId:linkedPersonId,status:"pending",createdByUid:ctx.uid,createdAt:now,
          // Invitation does not confer active membership. Approval is a separate server action.
          acceptedByUid:null,revision:1});
        tx.create(audit,{schoolId:ctx.schoolId,actorUid:ctx.uid,
          action:"create_invitation",invitationId,createdAt:now});
      });
      return {invitationId,status:"pending"};
    }
    invalid("Unknown People & Access operation.");
  };
}
module.exports={createPeopleDirectoryService};
