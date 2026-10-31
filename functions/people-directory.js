"use strict";
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");
const {FieldValue}=require("firebase-admin/firestore");
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
      const batch=db.batch();
      batch.create(ref,{
        schoolId:ctx.schoolId,displayName,searchKey:displayName.toLocaleLowerCase("en")+"#"+ref.id,
        kind:person.kind,status:"active",authUid:null,createdByUid:ctx.uid,
        createdAt:now,updatedAt:now,revision:1
      });
      batch.create(audit,{schoolId:ctx.schoolId,actorUid:ctx.uid,personId:ref.id,
        action:"create_person",createdAt:now});
      await batch.commit();
      return {personId:ref.id,accountLinked:false};
    }
    if(input.action==="invite") {
      const email=field(input.email,254,"Email").toLowerCase();
      if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email))invalid("Enter a valid invitation email.");
      if(!["student","teacher"].includes(input.role))invalid("Choose a student or teacher invitation.");
      const ref=db.collection("schools/"+ctx.schoolId+"/invitations").doc();
      const audit=db.collection("schools/"+ctx.schoolId+"/directory_audit").doc();
      const batch=db.batch(),now=FieldValue.serverTimestamp();
      batch.create(ref,{schoolId:ctx.schoolId,email,requestedRole:input.role,
        personId:input.personId?id(input.personId):null,
        status:"pending",createdByUid:ctx.uid,createdAt:now,
        // This is a request only: NEVER creates an active membership/privilege.
        acceptedByUid:null,revision:1});
      batch.create(audit,{schoolId:ctx.schoolId,actorUid:ctx.uid,
        action:"create_invitation",invitationId:ref.id,createdAt:now});
      await batch.commit();
      return {invitationId:ref.id,status:"pending"};
    }
    invalid("Unknown People & Access operation.");
  };
}
module.exports={createPeopleDirectoryService};
