"use strict";
const {getSchoolContext,TenantAccessError,checkedSchoolId,verifiedUid}=require("./tenant-access.js");
const {FieldValue,Timestamp}=require("firebase-admin/firestore");
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
    if(input.action==="search_people"){
      const raw=typeof input.query==="string"?input.query.trim().toLocaleLowerCase("en"):"";
      if(raw.length>80)invalid("Directory search is too long.");
      const kind=input.kind||"all",status=input.status||"all";
      if(!["all","student","staff"].includes(kind))invalid("Invalid person type filter.");
      if(!["all","active","archived"].includes(status))invalid("Invalid person status filter.");
      let query=base.orderBy("searchKey").limit(101);
      if(raw)query=query.startAt(raw).endAt(raw+"\uf8ff");
      const snap=await query.get();
      const matches=snap.docs.filter(person=>{
        const data=person.data();
        return data.schoolId===ctx.schoolId&&(kind==="all"||data.kind===kind)&&
          (status==="all"||data.status===status);
      });
      return {items:matches.slice(0,50).map(person=>({
        personId:person.id,displayName:person.data().displayName,
        kind:person.data().kind,status:person.data().status,
        accountLinked:Boolean(person.data().authUid),schoolId:ctx.schoolId
      })),truncated:snap.size===101||matches.length>50};
    }
    if(input.action==="list_memberships"){
      const snapshot=await db.collection("schools/"+ctx.schoolId+"/memberships").limit(101).get();
      if(snapshot.size===101)throw new TenantAccessError("resource-exhausted","Member directory is too large for this pilot page.");
      return {members:snapshot.docs.filter(member=>member.data().schoolId===ctx.schoolId)
        .map(member=>({
          uid:member.id,status:member.data().status,
          roles:Array.isArray(member.data().roles)?member.data().roles:[],
          displayName:typeof member.data().displayName==="string"?member.data().displayName:""
        }))};
    }
    if(input.action==="suspend_access"){
      const targetUid=id(input.targetUid);
      const reason=field(input.reason,500,"Suspension reason");
      if(reason.length<12)invalid("Suspension reason must explain the institutional decision.");
      if(targetUid===ctx.uid)
        throw new TenantAccessError("failed-precondition","You cannot suspend your own school administrator account.");
      const targetRef=db.doc("schools/"+ctx.schoolId+"/memberships/"+targetUid);
      const indexRef=db.doc("platform_users/"+targetUid+"/memberships/"+ctx.schoolId);
      const auditRef=db.collection("schools/"+ctx.schoolId+"/directory_audit").doc();
      await db.runTransaction(async tx=>{
        await requireCurrentAdmin(tx);
        const current=await tx.get(targetRef);
        if(!current.exists||current.data().schoolId!==ctx.schoolId||
          current.data().status!=="active")
          throw new TenantAccessError("failed-precondition","The school membership is not active.");
        if(Array.isArray(current.data().roles)&&current.data().roles.includes("school_admin"))
          throw new TenantAccessError("permission-denied","School administrator suspension requires platform-owner review.");
        const now=FieldValue.serverTimestamp(),revision=(current.data().revision||0)+1;
        tx.update(targetRef,{status:"suspended",revision,updatedAt:now,updatedByUid:ctx.uid});
        tx.set(indexRef,{schoolId:ctx.schoolId,status:"suspended",
          roles:Array.isArray(current.data().roles)?current.data().roles:[],
          revision,updatedAt:now});
        tx.create(auditRef,{schoolId:ctx.schoolId,actorUid:ctx.uid,targetUid,
          action:"school_membership_suspended",reason,createdAt:now});
      });
      return {targetUid,status:"suspended"};
    }
    if(input.action==="restore_access"){
      const targetUid=id(input.targetUid);
      const reason=field(input.reason,500,"Restore reason");
      if(reason.length<12)invalid("Restore reason must explain the institutional decision.");
      const targetRef=db.doc("schools/"+ctx.schoolId+"/memberships/"+targetUid);
      const indexRef=db.doc("platform_users/"+targetUid+"/memberships/"+ctx.schoolId);
      const auditRef=db.collection("schools/"+ctx.schoolId+"/directory_audit").doc();
      await db.runTransaction(async tx=>{
        await requireCurrentAdmin(tx);
        const current=await tx.get(targetRef);
        if(!current.exists||current.data().schoolId!==ctx.schoolId||
          current.data().status!=="suspended")
          throw new TenantAccessError("failed-precondition","The school membership is not suspended.");
        if(Array.isArray(current.data().roles)&&current.data().roles.includes("school_admin"))
          throw new TenantAccessError("permission-denied","School administrator recovery requires platform-owner review.");
        if(current.data().personId){
          const person=await tx.get(base.doc(id(current.data().personId)));
          if(!person.exists||person.data().schoolId!==ctx.schoolId||person.data().status!=="active"||
             person.data().authUid!==targetUid)
            throw new TenantAccessError("failed-precondition","The linked person record must be active and bound to this account before access is restored.");
        }
        const roles=Array.isArray(current.data().roles)?current.data().roles:[];
        if(!roles.some(role=>["student","teacher"].includes(role)))
          throw new TenantAccessError("failed-precondition","This membership has no recoverable school role.");
        const now=FieldValue.serverTimestamp(),revision=(current.data().revision||0)+1;
        tx.update(targetRef,{status:"active",revision,restoredAt:now,
          restoredByUid:ctx.uid,restoreReason:reason,updatedAt:now,updatedByUid:ctx.uid});
        tx.set(indexRef,{schoolId:ctx.schoolId,status:"active",roles,revision,updatedAt:now});
        tx.create(auditRef,{schoolId:ctx.schoolId,actorUid:ctx.uid,targetUid,
          action:"school_membership_restored",reason,createdAt:now});
      });
      return {targetUid,status:"active"};
    }
    if(input.action==="list_invitable_people") {
      const role=input.role;
      if(!["student","teacher"].includes(role))invalid("Choose a student or teacher invitation.");
      const kind=role==="student"?"student":"staff";
      const snap=await base.where("kind","==",kind).limit(201).get();
      if(snap.size===201)
        throw new TenantAccessError("resource-exhausted","The invitation picker requires paginated directory search.");
      return {people:snap.docs.filter(person=>person.data().schoolId===ctx.schoolId&&
          person.data().status==="active"&&!person.data().authUid)
        .map(person=>({personId:person.id,displayName:person.data().displayName,kind}))};
    }
    if(input.action==="update_person"){
      const personId=id(input.personId),displayName=field(input.displayName,140,"Person name");
      const ref=base.doc(personId),audit=db.collection("schools/"+ctx.schoolId+"/directory_audit").doc();
      await db.runTransaction(async tx=>{
        await requireCurrentAdmin(tx);
        const person=await tx.get(ref);
        if(!person.exists||person.data().schoolId!==ctx.schoolId)
          throw new TenantAccessError("not-found","The person is not in this school directory.");
        const now=FieldValue.serverTimestamp(),revision=(person.data().revision||0)+1;
        tx.update(ref,{displayName,searchKey:displayName.toLocaleLowerCase("en")+"#"+personId,
          revision,updatedAt:now,updatedByUid:ctx.uid});
        if(person.data().authUid){
          const memberRef=db.doc("schools/"+ctx.schoolId+"/memberships/"+id(person.data().authUid));
          const member=await tx.get(memberRef);
          if(member.exists&&member.data().schoolId===ctx.schoolId)
            tx.update(memberRef,{displayName,updatedAt:now});
        }
        tx.create(audit,{schoolId:ctx.schoolId,actorUid:ctx.uid,personId,
          action:"person_name_updated",revision,createdAt:now});
      });
      return {personId,displayName};
    }
    if(input.action==="archive_person"||input.action==="restore_person"){
      const personId=id(input.personId),reason=field(input.reason,500,"Lifecycle reason");
      if(reason.length<12)invalid("Explain the person record lifecycle change in at least 12 characters.");
      const ref=base.doc(personId),audit=db.collection("schools/"+ctx.schoolId+"/directory_audit").doc();
      const restoring=input.action==="restore_person";
      await db.runTransaction(async tx=>{
        await requireCurrentAdmin(tx);
        const person=await tx.get(ref);
        if(!person.exists||person.data().schoolId!==ctx.schoolId)
          throw new TenantAccessError("not-found","The person is not in this school directory.");
        const data=person.data();
        if(restoring&&data.status!=="archived")
          throw new TenantAccessError("failed-precondition","Only an archived person record can be restored.");
        if(!restoring&&data.status!=="active")
          throw new TenantAccessError("failed-precondition","Only an active person record can be archived.");
        if(!restoring){
          if(data.authUid){
            const membership=await tx.get(db.doc("schools/"+ctx.schoolId+"/memberships/"+id(data.authUid)));
            if(membership.exists&&membership.data().schoolId===ctx.schoolId&&membership.data().status==="active")
              throw new TenantAccessError("failed-precondition","Suspend this person's active school membership before archiving the directory record.");
          }
          const invitations=await tx.get(db.collection("schools/"+ctx.schoolId+"/invitations")
            .where("personId","==",personId).limit(101));
          if(invitations.size===101)
            throw new TenantAccessError("resource-exhausted","Invitation history requires reviewed pagination before archiving.");
          if(invitations.docs.some(doc=>doc.data().status==="pending"))
            throw new TenantAccessError("failed-precondition","Resolve or expire this person's pending invitation before archiving.");
          if(data.kind==="student"){
            const enrollments=await tx.get(db.collection("schools/"+ctx.schoolId+"/enrollments")
              .where("personId","==",personId).limit(101));
            if(enrollments.size===101)
              throw new TenantAccessError("resource-exhausted","Enrollment history requires reviewed pagination before archiving.");
            if(enrollments.docs.some(doc=>doc.data().status==="active"))
              throw new TenantAccessError("failed-precondition","End this student's active course enrollments before archiving the person record.");
          }else if(data.kind==="staff"&&data.authUid){
            const assignments=await tx.get(db.collection("schools/"+ctx.schoolId+"/staff_assignments")
              .where("teacherUid","==",id(data.authUid)).limit(101));
            if(assignments.size===101)
              throw new TenantAccessError("resource-exhausted","Teaching assignment history requires reviewed pagination before archiving.");
            if(assignments.docs.some(doc=>doc.data().status==="active"))
              throw new TenantAccessError("failed-precondition","End this teacher's active course assignments before archiving the person record.");
          }
        }
        const now=FieldValue.serverTimestamp(),revision=(data.revision||0)+1;
        tx.update(ref,restoring?
          {status:"active",revision,restoredAt:now,restoredByUid:ctx.uid,restoreReason:reason,updatedAt:now}:
          {status:"archived",revision,archivedAt:now,archivedByUid:ctx.uid,archiveReason:reason,updatedAt:now});
        tx.create(audit,{schoolId:ctx.schoolId,actorUid:ctx.uid,personId,
          action:restoring?"person_restored":"person_archived",reason,revision,createdAt:now});
      });
      return {personId,status:restoring?"active":"archived"};
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
      const linkedPersonId=id(input.personId);
      const invitationId=createHash("sha256").update(input.role+"\0"+email).digest("hex").slice(0,48);
      const ref=db.collection("schools/"+ctx.schoolId+"/invitations").doc(invitationId);
      const audit=db.collection("schools/"+ctx.schoolId+"/directory_audit").doc();
      const personRef=linkedPersonId?base.doc(linkedPersonId):null;
      await db.runTransaction(async tx=>{
        await requireCurrentAdmin(tx);
        const existing=await tx.get(ref);
        const person=await tx.get(personRef);
        if(!person.exists||person.data().schoolId!==ctx.schoolId||person.data().status!=="active")
          throw new TenantAccessError("failed-precondition","Choose an active person in this school directory.");
        const expectedKind=input.role==="student"?"student":"staff";
        if(person.data().kind!==expectedKind)
          throw new TenantAccessError("failed-precondition","The selected person record does not match the invitation role.");
        if(person.data().authUid)
          throw new TenantAccessError("failed-precondition","This person already has a linked account. Use role or access recovery instead of another invitation.");
        if(existing.exists) {
          const prior=existing.data();
          if(prior.status==="pending"&&prior.email===email&&prior.requestedRole===input.role){
            if((prior.personId||null)!==linkedPersonId)
              throw new TenantAccessError("failed-precondition","The linked person changed. Review the original invitation.");
            if(prior.expiresAt?.toMillis?.() && prior.expiresAt.toMillis()>Date.now())return;
            const now=FieldValue.serverTimestamp();
            tx.update(ref,{expiresAt:Timestamp.fromMillis(Date.now()+7*24*60*60*1000),
              revision:(prior.revision||1)+1,updatedAt:now,updatedByUid:ctx.uid});
            tx.create(audit,{schoolId:ctx.schoolId,actorUid:ctx.uid,
              action:"invitation_renewed",invitationId,createdAt:now});
            return;
          }
          throw new TenantAccessError("already-exists","This invitation has already been processed. Use the recovery workflow.");
        }
        const now=FieldValue.serverTimestamp();
        tx.create(ref,{schoolId:ctx.schoolId,email,requestedRole:input.role,
          personId:linkedPersonId,status:"pending",createdByUid:ctx.uid,createdAt:now,
          expiresAt:Timestamp.fromMillis(Date.now()+7*24*60*60*1000),
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

/**
 * Accept an explicitly issued same-school invitation. A verified email match
 * is mandatory; a guessed school ID or an existing roster row is not authority.
 * The invitation is a prior administrator approval, never an open self-join.
 */
function createInvitationAcceptanceService({db}) {
  return async request=>{
    const uid=verifiedUid(request),input=request.data||{};
    const schoolId=checkedSchoolId(input.schoolId);
    const email=String(request.auth?.token?.email||"").trim().toLowerCase();
    if(!email)throw new TenantAccessError("unauthenticated","A verified email is required.");
    const inviteId=id(input.invitationId);
    const schoolRef=db.doc("platform_schools/"+schoolId);
    const inviteRef=db.doc("schools/"+schoolId+"/invitations/"+inviteId);
    const memberRef=db.doc("schools/"+schoolId+"/memberships/"+uid);
    const indexRef=db.doc("platform_users/"+uid+"/memberships/"+schoolId);
    const auditRef=db.collection("schools/"+schoolId+"/directory_audit").doc();
    let acceptedRole=null;
    await db.runTransaction(async tx=>{
      const school=await tx.get(schoolRef),invitation=await tx.get(inviteRef);
      if(!school.exists||school.data().state!=="active"||!invitation.exists)
        throw new TenantAccessError("permission-denied","This school invitation is unavailable.");
      const invited=invitation.data();
      if(invited.schoolId!==schoolId||invited.email!==email||
         !["teacher","student"].includes(invited.requestedRole))
        throw new TenantAccessError("permission-denied","This invitation does not match your verified account.");
      const member=await tx.get(memberRef);
      if(member.exists && !["active"].includes(member.data().status))
        throw new TenantAccessError("failed-precondition","Your previous school access needs administrator recovery.");
      const personRef=invited.personId?db.doc("schools/"+schoolId+"/people/"+id(invited.personId)):null;
      const person=personRef?await tx.get(personRef):null;
      if(personRef&&person.exists&&
        (invited.requestedRole==="student"?person.data().kind!=="student":person.data().kind!=="staff"))
        throw new TenantAccessError("failed-precondition","The invitation role does not match the school person record.");
      if(personRef&&(!person.exists||person.data().schoolId!==schoolId||
        (person.data().authUid&&person.data().authUid!==uid)))
        throw new TenantAccessError("failed-precondition","The invitation's person link requires administrator review.");
      if(invited.status==="accepted"&&invited.acceptedByUid===uid) {
        if(member.exists&&member.data().status==="active"&&
          Array.isArray(member.data().roles)&&member.data().roles.includes(invited.requestedRole)){
          acceptedRole=invited.requestedRole;return;
        }
        throw new TenantAccessError("failed-precondition","Invitation and school role records need recovery.");
      }
      if(invited.status!=="pending")
        throw new TenantAccessError("failed-precondition","This invitation is no longer pending.");
      if(!invited.expiresAt?.toMillis||invited.expiresAt.toMillis()<=Date.now())
        throw new TenantAccessError("failed-precondition","This invitation has expired. Ask your school administrator for a new invitation.");
      const roles=[...new Set([...(Array.isArray(member.exists?member.data().roles:null)?member.data().roles:[]),invited.requestedRole])];
      const revision=(member.exists?member.data().revision||0:0)+1;
      const now=FieldValue.serverTimestamp();
      tx.set(memberRef,{schoolId,status:"active",roles,revision,
        ...(person?.exists?{personId:invited.personId,displayName:String(person.data().displayName||"").slice(0,140)}:{}),
        updatedByUid:uid,updatedAt:now},{merge:true});
      tx.set(indexRef,{schoolId,status:"active",roles,revision,updatedAt:now});
      tx.update(inviteRef,{status:"accepted",acceptedByUid:uid,acceptedAt:now,revision:(invited.revision||1)+1});
      if(personRef)tx.update(personRef,{authUid:uid,updatedAt:now,revision:(person.data().revision||1)+1});
      tx.create(auditRef,{schoolId,actorUid:uid,invitationId:inviteId,
        action:"invitation_accepted",role:invited.requestedRole,createdAt:now});
      acceptedRole=invited.requestedRole;
    });
    return {schoolId,status:"active",role:acceptedRole};
  };
}

module.exports={createPeopleDirectoryService,createInvitationAcceptanceService};
