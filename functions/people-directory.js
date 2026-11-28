"use strict";
const {getSchoolContext,TenantAccessError,checkedSchoolId,verifiedUid}=require("./tenant-access.js");
const {FieldValue,Timestamp}=require("firebase-admin/firestore");
const {createHash}=require("node:crypto");
const {rosterEmailHash}=require("./school-roster-identity.js");
const {legacyStudentRecordsForAccount}=require("./legacy-student-identity.js");
function invalid(message){throw new TenantAccessError("invalid-argument",message)}
function field(value,max,label) {
  if(typeof value!=="string"||!value.trim()||value.trim().length>max)invalid(label+" is required and must be shorter.");
  return value.trim();
}
function checkedBirthDate(value){
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))invalid("Enter a valid birth date.");
  const date=new Date(value+"T00:00:00Z");
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value||date.getTime()>Date.now()||date.getUTCFullYear()<1900)invalid("Enter a valid birth date.");
  return value;
}
function studentIdentityChange(current,details){
  const changes={};
  for(const key of ["displayName","studentNumber","birthDate"]){
    if(details[key]!==undefined&&(current[key]||"")!==(details[key]||""))changes[key]=details[key]||null;
  }
  return changes;
}
function invitationIsActivePending(data,now=Date.now()){
  if(!data||data.status!=="pending")return false;
  const expires=data.expiresAt?.toMillis?.();
  return !Number.isFinite(expires)||expires>now;
}
function id(value){
  if(typeof value!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(value))invalid("Invalid record identifier.");
  return value;
}
function importText(value,max=200){return typeof value==="string"?value.trim().slice(0,max):"";}
function importIdentity(row,index){
  if(!row||typeof row!=="object"||Array.isArray(row))
    return {index,valid:false,errors:["Row is not a record."]};
  const first=importText(row.firstName,80),last=importText(row.lastName,80);
  const displayName=importText(row.displayName,140)||[first,last].filter(Boolean).join(" ");
  const kind=importText(row.kind,20).toLowerCase()||"student";
  const email=importText(row.email,254).toLowerCase();
  const externalId=importText(row.externalId,120);
  const sectionHint=importText(row.section,140);
  const errors=[];
  if(!displayName)errors.push("Display name is required.");
  if(!["student","staff"].includes(kind))errors.push("Kind must be student or staff.");
  if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))errors.push("Email is invalid.");
  if(externalId&&!/^[A-Za-z0-9._-]{1,120}$/.test(externalId))errors.push("External ID contains unsupported characters.");
  if(!email&&!externalId)errors.push("Provide an email or externalId so the row can be imported idempotently.");
  const identitySource=externalId?"external:"+externalId.toLowerCase():"email:"+email;
  const identityHash=errors.length?null:createHash("sha256").update(kind+"\0"+identitySource).digest("hex");
  const activationEmailHash=kind==="student"&&email&&errors.length===0?rosterEmailHash(email):null;
  return {index,valid:errors.length===0,errors,displayName,kind,email,externalId,sectionHint,
    identityHash,activationEmailHash,personId:identityHash?"imp_"+identityHash.slice(0,40):null};
}
function normalizedImport(rows){
  if(!Array.isArray(rows)||!rows.length||rows.length>200)
    invalid("Import between 1 and 200 people at a time.");
  const normalized=rows.map((row,index)=>importIdentity(row,index));
  const seen=new Map();
  for(const row of normalized){
    if(!row.valid)continue;
    if(seen.has(row.identityHash)){
      row.valid=false;row.errors.push("Duplicate identity in this import file.");
      const first=normalized[seen.get(row.identityHash)];
      if(first?.valid){first.valid=false;first.errors.push("Duplicate identity in this import file.");}
    }else seen.set(row.identityHash,row.index);
  }
  const canonical=normalized.map(row=>({
    index:row.index,valid:row.valid,displayName:row.displayName,kind:row.kind,
    identityHash:row.identityHash,activationEmailHash:row.activationEmailHash||null,
    personId:row.personId,sectionHint:row.sectionHint||"",errors:row.errors
  }));
  const digest=createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
  return {rows:normalized,digest};
}

function createPeopleDirectoryService({db}) {
  return async request=>{
    const input=request.data||{};
    const ctx=await getSchoolContext({db,request,schoolId:input.schoolId,roles:["school_admin"],allowDraftAdmin:true});
    const base=db.collection("schools/"+ctx.schoolId+"/people");
    const schoolRef=db.doc("platform_schools/"+ctx.schoolId);
    const adminRef=db.doc("schools/"+ctx.schoolId+"/memberships/"+ctx.uid);
    async function requireCurrentAdmin(tx) {
      if(ctx.platformOverride)return;
      const school=await tx.get(schoolRef),member=await tx.get(adminRef);
      if(!school.exists||!["draft","active","pilot"].includes(school.data().state)||!member.exists||
         member.data().status!=="active"||member.data().schoolId!==ctx.schoolId||
         !Array.isArray(member.data().roles)||!member.data().roles.includes("school_admin"))
        throw new TenantAccessError("permission-denied","School administration access has changed.");
    }

    async function reviewStudentAccountRecovery(personId,replacementPersonId,tx=null) {
      if(personId===replacementPersonId)
        throw new TenantAccessError("invalid-argument","Choose a different linked student account for recovery.");
      const read=target=>tx?tx.get(target):target.get();
      const canonicalRef=base.doc(personId),replacementRef=base.doc(replacementPersonId);
      const [canonical,replacement]=await Promise.all([read(canonicalRef),read(replacementRef)]);
      if(!canonical.exists||canonical.data().schoolId!==ctx.schoolId||
         canonical.data().kind!=="student"||canonical.data().status!=="active")
        throw new TenantAccessError("failed-precondition","The canonical student record must be active.");
      if(!replacement.exists||replacement.data().schoolId!==ctx.schoolId||
         replacement.data().kind!=="student"||replacement.data().status!=="active")
        throw new TenantAccessError("failed-precondition","The replacement login must belong to an active student record.");
      const canonicalData=canonical.data(),replacementData=replacement.data(),
        replacementUid=id(replacementData.authUid),
        canonicalUid=typeof canonicalData.authUid==="string"&&canonicalData.authUid?
          id(canonicalData.authUid):null;
      if(canonicalUid===replacementUid)
        throw new TenantAccessError("failed-precondition","This login is already linked to the canonical student.");

      const replacementMemberRef=db.doc("schools/"+ctx.schoolId+"/memberships/"+replacementUid),
        canonicalMemberRef=canonicalUid?
          db.doc("schools/"+ctx.schoolId+"/memberships/"+canonicalUid):null;
      const queries=[
        db.collection("schools/"+ctx.schoolId+"/student_registrations").where("personId","==",replacementPersonId).limit(51),
        db.collection("schools/"+ctx.schoolId+"/enrollments").where("personId","==",replacementPersonId).limit(101),
        db.collection("schools/"+ctx.schoolId+"/student_grades").where("studentUid","==",replacementUid).limit(2),
        db.collection("schools/"+ctx.schoolId+"/studio_submissions").where("studentUid","==",replacementUid).limit(2),
        db.collection("schools/"+ctx.schoolId+"/assessment_submissions").where("studentUid","==",replacementUid).limit(2),
        db.collection("schools/"+ctx.schoolId+"/github_evidence").where("studentUid","==",replacementUid).limit(2),
        db.collection("schools/"+ctx.schoolId+"/student_repository_configs").where("personId","==",replacementPersonId).limit(2),
        db.collection("schools/"+ctx.schoolId+"/class_record_period_grades").where("personId","==",replacementPersonId).limit(2),
        db.collection("schools/"+ctx.schoolId+"/assessment_threads").where("studentPersonId","==",replacementPersonId).limit(2),
        base.where("authUid","==",replacementUid).limit(3)
      ];
      const reads=[
        read(replacementMemberRef),
        canonicalMemberRef?read(canonicalMemberRef):Promise.resolve(null),
        ...queries.map(query=>read(query))
      ];
      const registrarRoot="schools/"+ctx.schoolId+"/";
      const registrarEvidence=await Promise.all([
        read(db.doc(registrarRoot+"student_registrar_profiles/"+replacementPersonId)),
        ...["student_document_requests","student_external_academic_records","enrollment_applications","student_lrn_claims"].map(name=>read(db.collection(registrarRoot+name).where("personId","==",replacementPersonId).limit(1))),
        read(db.collection(registrarRoot+"guardian_relationships").where("studentPersonId","==",replacementPersonId).limit(1))
      ]);
      const [replacementMember,canonicalMember,registrations,enrollments,grades,studio,
        responses,githubEvidence,repositoryConfigs,classRecordGrades,assessmentThreads,linkedPeople]=
        await Promise.all(reads);
      const blockers=[],replacementRoles=Array.isArray(replacementMember?.data?.()?.roles)?
        replacementMember.data().roles:[];

      if(!replacementMember?.exists||replacementMember.data().schoolId!==ctx.schoolId||
         replacementMember.data().status!=="active"||
         replacementMember.data().personId!==replacementPersonId||
         !replacementRoles.includes("student"))
        blockers.push("The replacement login is not an active student membership linked to the selected duplicate record.");
      if(replacementRoles.some(role=>role!=="student"))
        blockers.push("The replacement login has another school role. Resolve that role before student account recovery.");
      if(linkedPeople.docs.filter(doc=>doc.data().schoolId===ctx.schoolId).length!==1)
        blockers.push("The replacement login is linked to more than one school person. Resolve the directory integrity issue first.");
      if(registrarEvidence[0].exists||registrarEvidence.slice(1).some(snapshot=>snapshot.size>0))blockers.push("The replacement student has Registrar identity, admission, guardian or institutional evidence. Manual reconciliation is required before account recovery.");
      if(registrations.size===51||enrollments.size===101)
        blockers.push("The duplicate student has too much academic history for automatic recovery.");
      if(registrations.docs.some(doc=>doc.data().schoolId===ctx.schoolId&&doc.data().status==="active"))
        blockers.push("The duplicate student has an active official registration. End or correct it in Enrollment & Registration first.");
      if(enrollments.docs.some(doc=>doc.data().schoolId===ctx.schoolId&&doc.data().status==="active"))
        blockers.push("The duplicate student has active class enrollment. End the reviewed duplicate placement through People & Access or Enrollment & Registration before recovery.");
      const substantive=[
        [grades,"grade history"],[studio,"Studio submissions"],[responses,"assessment submissions"],
        [githubEvidence,"GitHub evidence"],[repositoryConfigs,"repository configuration"],
        [classRecordGrades,"Class Record grades"],[assessmentThreads,"private assessment conversation history"]
      ];
      for(const [snapshot,label] of substantive)
        if(snapshot.docs.some(doc=>doc.data().schoolId===ctx.schoolId))
          blockers.push("The duplicate student already has "+label+". Manual identity reconciliation is required.");
      if(canonicalMember?.exists&&canonicalMember.data().schoolId!==ctx.schoolId)
        blockers.push("The canonical student's previous membership belongs to another school context.");
      if(canonicalMember?.exists){
        const canonicalRoles=Array.isArray(canonicalMember.data().roles)?canonicalMember.data().roles:[];
        if(canonicalRoles.some(role=>role!=="student"))
          blockers.push("The canonical student's previous account has another school role and requires manual recovery.");
      }

      return {
        refs:{canonicalRef,replacementRef,replacementMemberRef,canonicalMemberRef},
        docs:{canonical,replacement,replacementMember,canonicalMember},
        canonicalUid,replacementUid,replacementRoles,blockers,
        preview:{
          canonical:{personId,displayName:String(canonicalData.displayName||"Student").slice(0,140),
            revision:Number(canonicalData.revision||1),accountLinked:Boolean(canonicalUid)},
          replacement:{personId:replacementPersonId,
            displayName:String(replacementData.displayName||"Linked student").slice(0,140),
            revision:Number(replacementData.revision||1),accountLinked:true},
          previousAccountWillBeSuspended:Boolean(canonicalUid&&canonicalMember?.exists&&
            canonicalMember.data().status==="active"),
          blockers,
          expected:{
            canonicalRevision:Number(canonicalData.revision||1),
            replacementRevision:Number(replacementData.revision||1),
            replacementMembershipRevision:Number(replacementMember?.data?.()?.revision||0),
            canonicalMembershipRevision:Number(canonicalMember?.data?.()?.revision||0)
          }
        }
      };
    }

    if(input.action==="overview") {
      const scopes=["people","enrollments","staff_assignments","invitations"];
      const counts=await Promise.all(scopes.map(name=>db.collection("schools/"+ctx.schoolId+"/"+name).count().get()));
      return {schoolId:ctx.schoolId,counts:Object.fromEntries(scopes.map((name,i)=>[name,counts[i].data().count]))};
    }
    if(input.action==="reconcile_directory") {
      const names=["people","memberships","enrollments","student_registrations","staff_assignments","section_advisers","course_offerings","invitations"];
      const snapshots=await Promise.all(names.map(name=>
        db.collection("schools/"+ctx.schoolId+"/"+name).limit(501).get()));
      if(snapshots.some(snapshot=>snapshot.size===501))
        throw new TenantAccessError("resource-exhausted",
          "Directory reconciliation exceeded the 500-record pilot review limit for one or more school collections.");
      const byName=Object.fromEntries(names.map((name,index)=>[name,snapshots[index].docs]));
      const people=new Map(byName.people.filter(doc=>doc.data().schoolId===ctx.schoolId)
        .map(doc=>[doc.id,doc.data()]));
      const members=new Map(byName.memberships.filter(doc=>doc.data().schoolId===ctx.schoolId)
        .map(doc=>[doc.id,doc.data()]));
      const offerings=new Map(byName.course_offerings.filter(doc=>
        doc.data().schoolId===ctx.schoolId&&doc.data().status==="active").map(doc=>[doc.id,doc.data()]));
      const activeEnrollments=byName.enrollments.filter(doc=>
        doc.data().schoolId===ctx.schoolId&&doc.data().status==="active");
      const activeRegistrations=byName.student_registrations.filter(doc=>
        doc.data().schoolId===ctx.schoolId&&doc.data().status==="active");
      const activeAssignments=byName.staff_assignments.filter(doc=>
        doc.data().schoolId===ctx.schoolId&&doc.data().status==="active");
      const activeAdvisers=byName.section_advisers.filter(doc=>
        doc.data().schoolId===ctx.schoolId&&doc.data().status==="active");
      const enrollmentsByPerson=new Set(activeEnrollments.map(doc=>doc.data().personId)),
        registrationsByPerson=new Set(activeRegistrations.map(doc=>doc.data().personId));
      const assignmentsByTeacher=new Set(activeAssignments.map(doc=>doc.data().teacherUid)),
        advisersByTeacher=new Set(activeAdvisers.map(doc=>doc.data().teacherUid));
      const peopleByAuthUid=new Map();
      for(const [personId,person] of people){
        if(typeof person.authUid!=="string"||!person.authUid)continue;
        const linked=peopleByAuthUid.get(person.authUid)||[];
        linked.push(personId);peopleByAuthUid.set(person.authUid,linked);
      }
      const issues=[];
      const add=(type,severity,label,detail,extra={})=>issues.push({
        type,severity,label:String(label||"Record").slice(0,160),
        detail:String(detail||"").slice(0,300),...extra
      });

      for(const [uid,personIds] of peopleByAuthUid){
        if(personIds.length>1)
          add("duplicate_auth_person_link","integrity","Account linked to multiple people",
            "One verified account UID is linked to multiple school person records. Resolve the canonical person before cutover.",
            {targetUid:uid,personIds:personIds.slice(0,10),targetTab:"access"});
      }

      for(const [personId,person] of people){
        const label=String(person.displayName||"School person").slice(0,140);
        if(person.status!=="active"){
          if(person.authUid){
            const member=members.get(person.authUid);
            if(member?.status==="active"&&member.personId===personId)
              add("inactive_person_active_membership","integrity",label,
                "Inactive person still has an active school membership linked to this record.",
                {personId,targetUid:person.authUid,targetTab:"access"});
            if(assignmentsByTeacher.has(person.authUid))
              add("inactive_person_active_assignment","integrity",label,
                "Inactive staff person still has an active teaching assignment.",
                {personId,targetUid:person.authUid,targetTab:"classes"});
            if(advisersByTeacher.has(person.authUid))
              add("inactive_person_active_adviser_assignment","integrity",label,
                "Inactive staff person still has an active Section Adviser / Homeroom assignment.",
                {personId,targetUid:person.authUid,targetTab:"classes"});
          }
          if(enrollmentsByPerson.has(personId))
            add("inactive_person_active_enrollment","integrity",label,
              "Inactive student person still has an active course enrollment.",
              {personId,targetTab:"classes"});
          if(registrationsByPerson.has(personId))
            add("inactive_person_active_registration","integrity",label,
              "Inactive student person still has an active official registration.",
              {personId,targetTab:"classes"});
          continue;
        }
        if(person.kind==="student"){
          if(!person.authUid){
            add("student_account_unlinked","attention",label,
              "Active student person has no verified account link.",{personId,targetTab:"invites"});
          }else{
            const member=members.get(person.authUid),roles=Array.isArray(member?.roles)?member.roles:[];
            if(!member||member.status!=="active"||member.personId!==personId||!roles.includes("student"))
              add("student_access_missing","integrity",label,
                "Linked account does not have a matching active student membership.",{personId,targetUid:person.authUid,targetTab:"access"});
          }
          const officiallyPlaced=ctx.enrollmentMode==="canonical"
            ?registrationsByPerson.has(personId):enrollmentsByPerson.has(personId);
          if(!officiallyPlaced)
            add("student_no_enrollment","attention",label,
              ctx.enrollmentMode==="canonical"
                ?"Active student has no active official registration or section placement."
                :"Active student is not enrolled in any active course offering.",
              {personId,targetTab:"classes"});
          else if(ctx.enrollmentMode==="canonical"&&!enrollmentsByPerson.has(personId))
            add("student_registration_without_classes","attention",label,
              "Active official registration has no active class enrollments. Review the section's automatic roster configuration.",
              {personId,targetTab:"classes"});
        }else if(person.kind==="staff"&&!person.authUid){
          add("staff_account_unlinked","review",label,
            "Active staff person has no verified account link. This may be intentional for non-teaching staff.",{personId,targetTab:"invites"});
        }
      }

      for(const [uid,member] of members){
        if(member.status!=="active")continue;
        const roles=Array.isArray(member.roles)?member.roles:[],
          requiresPerson=roles.some(role=>["student","teacher","registrar"].includes(role));
        if(requiresPerson){
          const person=member.personId?people.get(member.personId):null;
          if(!person||person.status!=="active"||person.authUid!==uid)
            add("membership_person_mismatch","integrity",
              String(member.displayName||"School member").slice(0,140),
              "Active student/teacher membership does not reconcile to one active linked person record.",
              {targetUid:uid,personId:member.personId||null,targetTab:"access"});
          else{
            if(roles.includes("student")&&person.kind!=="student")
              add("student_role_person_kind_mismatch","integrity",
                String(person.displayName||"School member").slice(0,140),
                "Student access is linked to a person record that is not classified as a student.",
                {targetUid:uid,personId:member.personId,targetTab:"access"});
            if(roles.includes("teacher")&&person.kind!=="staff")
              add("teacher_role_person_kind_mismatch","integrity",
                String(person.displayName||"School member").slice(0,140),
                "Teacher access is linked to a person record that is not classified as staff.",
                {targetUid:uid,personId:member.personId,targetTab:"access"});
            if(roles.includes("registrar")&&person.kind!=="staff")
              add("registrar_role_person_kind_mismatch","integrity",
                String(person.displayName||"School member").slice(0,140),
                "Registrar access is linked to a person record that is not classified as staff.",
                {targetUid:uid,personId:member.personId,targetTab:"access"});
            if(roles.includes("student")&&roles.some(role=>["teacher","registrar"].includes(role)))
              add("student_teacher_role_conflict","integrity",
                String(person.displayName||"School member").slice(0,140),
                "One active membership carries both student and teacher roles, which cannot map cleanly to one canonical person kind.",
                {targetUid:uid,personId:member.personId,targetTab:"access"});
          }
        }
        if(!roles.length)
          add("active_membership_without_role","integrity",
            String(member.displayName||"School member").slice(0,140),
            "Active membership has no school role and should not remain active.",
            {targetUid:uid,personId:member.personId||null,targetTab:"access"});
        if(roles.includes("teacher")&&!assignmentsByTeacher.has(uid))
          add("teacher_no_assignment","attention",
            String(member.displayName||"Teacher").slice(0,140),
            "Active teacher membership has no active course assignment.",{targetUid:uid,targetTab:"classes"});
      }

      for(const enrollment of activeEnrollments){
        const data=enrollment.data(),person=people.get(data.personId);
        if(!person||person.kind!=="student"||person.status!=="active"||!offerings.has(data.offeringId))
          add("enrollment_dependency","integrity","Enrollment "+enrollment.id,
            "Active enrollment references a missing/inactive student or course offering.",
            {personId:data.personId||null,recordId:enrollment.id,targetTab:"classes"});
      }
      for(const assignment of activeAssignments){
        const data=assignment.data(),member=members.get(data.teacherUid),roles=Array.isArray(member?.roles)?member.roles:[];
        if(!member||member.status!=="active"||!roles.includes("teacher")||!offerings.has(data.offeringId))
          add("assignment_dependency","integrity","Teaching assignment "+assignment.id,
            "Active teaching assignment references a missing/inactive teacher membership or course offering.",
            {targetUid:data.teacherUid||null,recordId:assignment.id,targetTab:"classes"});
      }

      const now=Date.now();
      for(const invitation of byName.invitations){
        const data=invitation.data();
        if(data.schoolId!==ctx.schoolId||data.status!=="pending")continue;
        const expiresAt=data.expiresAt?.toMillis?.()||0;
        const invitePerson=data.personId?people.get(data.personId):null;
        if(data.personId&&(!invitePerson||invitePerson.status!=="active"))
          add("invitation_inactive_person","integrity","Invitation targets inactive person",
            "A pending invitation references a missing or inactive person record and must not be used for account linking.",
            {personId:data.personId,recordId:invitation.id,targetTab:"invites"});
        if(expiresAt&&expiresAt<=now)
          add("expired_invitation","attention","Expired pending invitation",
            "A pending school invitation has passed its expiry and should be renewed or left inactive.",
            {personId:data.personId||null,recordId:invitation.id,targetTab:"invites"});
      }

      const priority={integrity:0,attention:1,review:2};
      issues.sort((a,b)=>(priority[a.severity]??9)-(priority[b.severity]??9)||
        a.label.localeCompare(b.label));
      const counts={integrity:0,attention:0,review:0,total:issues.length};
      for(const issue of issues)if(Object.hasOwn(counts,issue.severity))counts[issue.severity]++;
      return {
        schoolId:ctx.schoolId,counts,
        issues:issues.slice(0,150),truncated:issues.length>150,
        note:"Reconciliation uses canonical student registrations for official placement in standard schools, plus directory, membership and active class relationships. Grades, evidence and private teacher resources are not inspected."
      };
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
          accountLinked:Boolean(person.data().authUid),
          activationReady:Boolean(person.data().activationEmailHash),schoolId:ctx.schoolId,
          revision:Number(person.data().revision)||1
        })),
        nextCursor:snap.docs.length>pageSize?(docs.at(-1)?.data().searchKey||null):null
      };
    }
    if(input.action==="preview_import_people"){
      const normalized=normalizedImport(input.rows);
      const existing=new Map();
      const valid=normalized.rows.filter(row=>row.valid);
      const docs=await Promise.all(valid.map(row=>base.doc(row.personId).get()));
      docs.forEach((doc,index)=>{if(doc.exists)existing.set(valid[index].personId,doc.data());});
      return {digest:normalized.digest,summary:{
        rows:normalized.rows.length,
        create:normalized.rows.filter(row=>row.valid&&!existing.has(row.personId)).length,
        existing:normalized.rows.filter(row=>row.valid&&existing.has(row.personId)).length,
        invalid:normalized.rows.filter(row=>!row.valid).length
      },rows:normalized.rows.map(row=>({
        index:row.index,displayName:row.displayName,kind:row.kind,email:row.email,
        externalId:row.externalId,sectionHint:row.sectionHint,personId:row.personId,
        activationReady:Boolean(row.activationEmailHash),
        status:!row.valid?"invalid":existing.has(row.personId)?"existing":"create",
        errors:row.errors,
        existingName:existing.get(row.personId)?.displayName||null
      }))};
    }
    if(input.action==="commit_import_people"){
      const normalized=normalizedImport(input.rows);
      if(typeof input.expectedDigest!=="string"||input.expectedDigest!==normalized.digest)
        throw new TenantAccessError("failed-precondition","Import preview changed. Preview this exact file again before committing.");
      if(normalized.rows.some(row=>!row.valid))
        throw new TenantAccessError("failed-precondition","Resolve invalid or duplicate import rows before committing.");
      const batchId=normalized.digest.slice(0,40);
      const batchRef=db.doc("schools/"+ctx.schoolId+"/directory_imports/"+batchId);
      const refs=normalized.rows.map(row=>base.doc(row.personId));
      const audits=normalized.rows.map(()=>db.collection("schools/"+ctx.schoolId+"/directory_audit").doc());
      let result;
      await db.runTransaction(async tx=>{
        await requireCurrentAdmin(tx);
        const [batch,...existing]=await Promise.all([tx.get(batchRef),...refs.map(ref=>tx.get(ref))]);
        if(batch.exists){
          const prior=batch.data();
          if(prior.schoolId===ctx.schoolId&&prior.digest===normalized.digest&&prior.status==="committed"){
            result={batchId,created:prior.created||0,skipped:prior.skipped||0,alreadyCommitted:true};return;
          }
          throw new TenantAccessError("failed-precondition","This import batch requires administrator review.");
        }
        const now=FieldValue.serverTimestamp();
        let created=0,skipped=0,activationPrepared=0;
        normalized.rows.forEach((row,index)=>{
          const prior=existing[index];
          if(prior.exists){
            const data=prior.data();
            if(data.schoolId!==ctx.schoolId||data.importIdentityHash!==row.identityHash)
              throw new TenantAccessError("failed-precondition","An import identity collision requires manual review.");
            if(row.activationEmailHash&&data.activationEmailHash!==row.activationEmailHash){
              tx.update(refs[index],{activationEmailHash:row.activationEmailHash,
                updatedAt:now,updatedByUid:ctx.uid,revision:(data.revision||0)+1});
              tx.create(audits[index],{schoolId:ctx.schoolId,actorUid:ctx.uid,
                personId:row.personId,action:"student_activation_email_prepared",batchId,createdAt:now});
              activationPrepared++;
            }
            skipped++;return;
          }
          created++;
          const activation=row.activationEmailHash?{activationEmailHash:row.activationEmailHash}:{};
          tx.create(refs[index],{
            schoolId:ctx.schoolId,displayName:row.displayName,
            searchKey:row.displayName.toLocaleLowerCase("en")+"#"+row.personId,
            kind:row.kind,status:"active",authUid:null,importIdentityHash:row.identityHash,
            ...activation,importBatchId:batchId,importSource:"csv",createdByUid:ctx.uid,
            createdAt:now,updatedAt:now,revision:1
          });
          tx.create(audits[index],{schoolId:ctx.schoolId,actorUid:ctx.uid,
            personId:row.personId,action:"person_imported",batchId,
            activationEmailPrepared:Boolean(row.activationEmailHash),
            sectionHintPresent:Boolean(row.sectionHint),createdAt:now});
          if(row.activationEmailHash)activationPrepared++;
        });
        tx.create(batchRef,{schoolId:ctx.schoolId,digest:normalized.digest,status:"committed",
          source:"csv",rowCount:normalized.rows.length,created,skipped,
          createdByUid:ctx.uid,createdAt:now,
          note:"People only; no account, membership, enrollment or teacher assignment was granted."});
        result={batchId,created,skipped,activationPrepared,alreadyCommitted:false};
      });
      return result;
    }
    if(input.action==="export_people"){
      const snap=await base.orderBy("searchKey").limit(2001).get();
      if(snap.size===2001)
        throw new TenantAccessError("resource-exhausted","Directory export exceeds 2,000 people. Use a reviewed paginated export.");
      const rows=[];
      for(const person of snap.docs){
        const data=person.data();
        if(data.schoolId!==ctx.schoolId)continue;
        let membership=null;
        if(typeof data.authUid==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(data.authUid)){
          const member=await db.doc("schools/"+ctx.schoolId+"/memberships/"+data.authUid).get();
          if(member.exists&&member.data().schoolId===ctx.schoolId)
            membership={status:member.data().status,
              roles:Array.isArray(member.data().roles)?member.data().roles:[]};
        }
        rows.push({
          personId:person.id,displayName:data.displayName||"",kind:data.kind||"",
          status:data.status||"",accountLinked:Boolean(data.authUid),
          membershipStatus:membership?.status||"",
          roles:membership?.roles||[],
          revision:data.revision||1
        });
      }
      return {schoolId:ctx.schoolId,generatedAt:Date.now(),rows};
    }
    if(input.action==="get_person"){
      const personId=id(input.personId),personRef=base.doc(personId);
      const person=await personRef.get();
      if(!person.exists||person.data().schoolId!==ctx.schoolId)
        throw new TenantAccessError("not-found","The person is not in this school directory.");
      const data=person.data(),authUid=typeof data.authUid==="string"?data.authUid:null;
      const queries=[
        db.collection("schools/"+ctx.schoolId+"/invitations").where("personId","==",personId).limit(50).get(),
        db.collection("schools/"+ctx.schoolId+"/directory_audit").where("personId","==",personId).limit(50).get()
      ];
      if(data.kind==="student")
        queries.push(db.collection("schools/"+ctx.schoolId+"/enrollments").where("personId","==",personId).limit(101).get());
      else if(authUid)
        queries.push(db.collection("schools/"+ctx.schoolId+"/staff_assignments").where("teacherUid","==",authUid).limit(101).get());
      else queries.push(Promise.resolve({docs:[],size:0}));
      const [invites,audits,relationships]=await Promise.all(queries);
      if(relationships.size===101)
        throw new TenantAccessError("resource-exhausted","This person's academic relationship history requires pagination.");
      const membership=authUid?await db.doc("schools/"+ctx.schoolId+"/memberships/"+id(authUid)).get():null;
      const recentAudit=audits.docs.filter(doc=>doc.data().schoolId===ctx.schoolId)
        .sort((a,b)=>(b.data().createdAt?.toMillis?.()||0)-(a.data().createdAt?.toMillis?.()||0))
        .slice(0,20).map(doc=>({
          action:doc.data().action||"change",reason:doc.data().reason||"",
          createdAt:doc.data().createdAt?.toMillis?.()||null,actorUid:doc.data().actorUid||""
        }));
      return {
        person:{
          personId,displayName:data.displayName,kind:data.kind,status:data.status,
          studentNumber:data.studentNumber||"",birthDate:data.birthDate||"",
          primaryGuardianName:data.primaryGuardianName||"",
          primaryGuardianEmail:data.primaryGuardianEmail||"",
          primaryGuardianMobile:data.primaryGuardianMobile||"",
          contactEmail:data.email||"",
          accountLinked:Boolean(authUid),activationReady:Boolean(data.activationEmailHash),
          legacyStudentIds:Array.isArray(data.legacyStudentIds)?data.legacyStudentIds.slice(0,50):[],
          revision:data.revision||1
        },
        membership:membership?.exists&&membership.data().schoolId===ctx.schoolId?{
          status:membership.data().status,
          roles:Array.isArray(membership.data().roles)?membership.data().roles:[],
          revision:membership.data().revision||1
        }:null,
        invitations:invites.docs.filter(doc=>doc.data().schoolId===ctx.schoolId).map(doc=>({
          invitationId:doc.id,status:doc.data().status,requestedRole:doc.data().requestedRole,
          expiresAt:doc.data().expiresAt?.toMillis?.()||null,
          acceptedAt:doc.data().acceptedAt?.toMillis?.()||null,
          revision:Number(doc.data().revision)||1
        })),
        relationships:relationships.docs.filter(doc=>doc.data().schoolId===ctx.schoolId).map(doc=>
          data.kind==="student"?{
            kind:"enrollment",id:doc.id,offeringId:doc.data().offeringId,
            status:doc.data().status,revision:doc.data().revision||1
          }:{
            kind:"teaching_assignment",id:doc.id,offeringId:doc.data().offeringId,
            status:doc.data().status,revision:doc.data().revision||1
          }),
        audit:recentAudit
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
      const byId=new Map(snap.docs.map(doc=>[doc.id,doc]));
      // Search the canonical student number/email as well as the display-name prefix.
      // Every result remains restricted to this verified school.
      if(raw){
        const additional=await Promise.all([
          base.where("studentNumber","==",raw).limit(10).get(),
          base.where("email","==",raw).limit(10).get(),
          base.where("personId","==",raw).limit(10).get()
        ]);
        for(const results of additional)for(const doc of results.docs)byId.set(doc.id,doc);
        const direct=await base.doc(raw.replace(/[^a-zA-Z0-9_-]/g,"")).get().catch(()=>null);
        if(direct?.exists)byId.set(direct.id,direct);
      }
      const matches=[...byId.values()].filter(person=>{
        const data=person.data();
        return data.schoolId===ctx.schoolId&&(kind==="all"||data.kind===kind)&&
          (status==="all"||data.status===status);
      });
      return {items:matches.slice(0,50).map(person=>({
        personId:person.id,displayName:person.data().displayName,
        studentNumber:person.data().studentNumber||"",
        kind:person.data().kind,status:person.data().status,
        accountLinked:Boolean(person.data().authUid),
        activationReady:Boolean(person.data().activationEmailHash),schoolId:ctx.schoolId,
        revision:Number(person.data().revision)||1
      })),truncated:snap.size===101||matches.length>50};
    }
    if(input.action==="activate_test_student_access"){
      if(!ctx.platformOverride)
        throw new TenantAccessError("permission-denied","Test-student cross-school access requires explicit System Admin Assist.");
      const targetUid=id(input.targetUid),reason=field(input.reason,500,"Test access reason");
      if(reason.length<12)invalid("Explain the test-student school access in at least 12 characters.");
      const {getAuth}=require("firebase-admin/auth");
      let account;
      try{account=await getAuth().getUser(targetUid);}
      catch(error){
        if(error?.code==="auth/user-not-found")
          throw new TenantAccessError("not-found","The test student login no longer exists.");
        throw new TenantAccessError("unavailable","The test student login could not be verified.");
      }
      if(account.disabled||!account.emailVerified)
        throw new TenantAccessError("failed-precondition","The test student login must be verified and enabled before school access is granted.");

      const testRef=db.doc("platform_test_accounts/"+targetUid),
        memberRef=db.doc("schools/"+ctx.schoolId+"/memberships/"+targetUid),
        indexRef=db.doc("platform_users/"+targetUid+"/memberships/"+ctx.schoolId),
        linkedQuery=base.where("authUid","==",targetUid).limit(3),
        deterministicId="test-"+createHash("sha256").update("platform-test-student\0"+targetUid).digest("hex").slice(0,28);
      let result;
      await db.runTransaction(async tx=>{
        await requireCurrentAdmin(tx);
        const [testAccount,school,member,linkedPeople]=await Promise.all([
          tx.get(testRef),tx.get(schoolRef),tx.get(memberRef),tx.get(linkedQuery)
        ]);
        if(!testAccount.exists||testAccount.data()?.kind!=="student"||testAccount.data()?.status!=="active")
          throw new TenantAccessError("failed-precondition","The login is not currently designated as a platform test student.");
        if(!school.exists||!["active","pilot"].includes(school.data()?.state))
          throw new TenantAccessError("failed-precondition","Test students can be added only to an active or pilot school.");
        if(linkedPeople.size>1)
          throw new TenantAccessError("failed-precondition","This account is linked to multiple people in the target school. Reconcile the directory before granting test access.");

        const prior=member.exists?member.data():null;
        let personRef;
        if(prior?.personId)personRef=base.doc(id(prior.personId));
        else if(linkedPeople.size===1)personRef=linkedPeople.docs[0].ref;
        else personRef=base.doc(deterministicId);
        const person=await tx.get(personRef);
        const now=FieldValue.serverTimestamp();
        let createdPerson=false;
        if(person.exists){
          const data=person.data()||{};
          if(data.schoolId!==ctx.schoolId||data.kind!=="student"||data.status!=="active"||data.authUid!==targetUid)
            throw new TenantAccessError("failed-precondition","The target school person link conflicts with another identity or inactive record.");
        }else{
          if(prior?.personId)
            throw new TenantAccessError("failed-precondition","The target membership references a missing school person. Repair that school directory before continuing.");
          const displayName=String(account.displayName||account.email||"Test student").slice(0,140);
          tx.create(personRef,{
            personId:personRef.id,schoolId:ctx.schoolId,displayName,
            searchKey:displayName.toLocaleLowerCase("en")+"#"+personRef.id,
            kind:"student",status:"active",authUid:targetUid,
            email:String(account.email||"").toLowerCase(),studentNumber:"",
            source:"platform_test_student",testAccount:true,revision:1,
            createdByUid:ctx.uid,createdAt:now,updatedByUid:ctx.uid,updatedAt:now
          });
          createdPerson=true;
        }

        const priorRoles=Array.isArray(prior?.roles)?prior.roles.filter(role=>
          ["student","teacher","registrar","school_admin"].includes(role)):[];
        if(prior&&prior.schoolId!==ctx.schoolId)
          throw new TenantAccessError("failed-precondition","The existing membership belongs to another school context.");
        if(priorRoles.some(role=>role!=="student"))
          throw new TenantAccessError("failed-precondition","This account already has a non-student role in the target school. Use the normal school access workflow.");
        if(prior?.personId&&prior.personId!==personRef.id)
          throw new TenantAccessError("failed-precondition","The target school membership is linked to another person record.");

        const revision=(Number(prior?.revision)||0)+1;
        tx.set(memberRef,{
          schoolId:ctx.schoolId,personId:personRef.id,status:"active",roles:["student"],
          displayName:String(account.displayName||account.email||"Test student").slice(0,140),
          testStudentAccess:true,revision,updatedByUid:ctx.uid,updatedAt:now,
          ...(member.exists?{}:{createdByUid:ctx.uid,createdAt:now})
        },{merge:true});
        tx.set(indexRef,{schoolId:ctx.schoolId,status:"active",roles:["student"],
          testStudentAccess:true,revision,updatedAt:now},{merge:true});
        tx.create(db.collection("schools/"+ctx.schoolId+"/directory_audit").doc(),{
          schoolId:ctx.schoolId,actorUid:ctx.uid,targetUid,personId:personRef.id,
          action:member.exists&&prior?.status==="suspended"?
            "platform_test_student_school_access_restored":"platform_test_student_school_access_granted",
          reason,source:"system_admin_assist_test_mobility",createdAt:now
        });
        result={schoolId:ctx.schoolId,personId:personRef.id,status:"active",revision,createdPerson};
      });
      return result;
    }

    if(input.action==="activate_linked_staff"){
      // Expedited, reviewed access grant for an existing identity-linked staff record.
      // No UID alone can confer access: a matching active canonical person is required.
      const personId=id(input.personId),expectedPersonRevision=Number(input.expectedPersonRevision),
        role=String(input.role||"teacher").trim().toLowerCase();
      if(!["teacher","registrar"].includes(role))
        invalid("Choose Teacher or Registrar staff access.");
      if(!Number.isSafeInteger(expectedPersonRevision)||expectedPersonRevision<1)
        invalid("Refresh the linked staff search before activating school access.");
      const reason=field(input.reason,500,"Activation reason");
      if(reason.length<12)invalid("Explain the reason for activating school access.");
      const personRef=base.doc(personId);
      const initial=await personRef.get();
      if(!initial.exists||initial.data().schoolId!==ctx.schoolId||
         initial.data().status!=="active"||initial.data().kind!=="staff"||
         !initial.data().authUid)
        throw new TenantAccessError("failed-precondition","Select an active staff record linked to a verified account.");
      if((Number(initial.data().revision)||1)!==expectedPersonRevision)
        throw new TenantAccessError("failed-precondition","This staff identity changed after you selected it. Refresh the search before activating access.");
      const targetUid=id(initial.data().authUid);
      const {getAuth}=require("firebase-admin/auth");
      const account=await getAuth().getUser(targetUid);
      if(account.disabled||!account.emailVerified)
        throw new TenantAccessError("failed-precondition","The linked account must be enabled with a verified email.");
      if(initial.data().email&&account.email?.toLowerCase()!==String(initial.data().email).toLowerCase())
        throw new TenantAccessError("failed-precondition","The linked account email does not match this staff record.");
      const memberRef=db.doc("schools/"+ctx.schoolId+"/memberships/"+targetUid);
      const indexRef=db.doc("platform_users/"+targetUid+"/memberships/"+ctx.schoolId);
      const auditRef=db.collection("schools/"+ctx.schoolId+"/directory_audit").doc();
      let outcome="active";
      await db.runTransaction(async tx=>{
        await requireCurrentAdmin(tx);
        const [person,member]=await Promise.all([tx.get(personRef),tx.get(memberRef)]);
        if(!person.exists||person.data().schoolId!==ctx.schoolId||
           person.data().status!=="active"||person.data().kind!=="staff"||
           person.data().authUid!==targetUid||
           (Number(person.data().revision)||1)!==expectedPersonRevision)
          throw new TenantAccessError("failed-precondition","The staff identity link changed. Refresh before granting access.");
        const prior=member.exists?member.data():null;
        if(prior&&prior.schoolId!==ctx.schoolId)
          throw new TenantAccessError("failed-precondition","The existing membership belongs to another school.");
        if(prior?.status==="suspended")
          throw new TenantAccessError("failed-precondition","Suspended membership requires the reviewed Restore access action.");
        if(prior?.status==="active"&&Array.isArray(prior.roles)&&prior.roles.includes(role)){
          outcome="already_active";return;
        }
        if(prior?.personId&&prior.personId!==personId)
          throw new TenantAccessError("failed-precondition","Existing membership is linked to another person record.");
        const roles=[...new Set([...(Array.isArray(prior?.roles)?prior.roles:[]),role])];
        const revision=(prior?.revision||0)+1,now=FieldValue.serverTimestamp();
        tx.set(memberRef,{schoolId:ctx.schoolId,personId,status:"active",roles,revision,
          displayName:String(person.data().displayName||"").slice(0,140),
          updatedAt:now,updatedByUid:ctx.uid},{merge:true});
        tx.set(indexRef,{schoolId:ctx.schoolId,status:"active",roles,revision,updatedAt:now});
        tx.create(auditRef,{schoolId:ctx.schoolId,actorUid:ctx.uid,targetUid,
          personId,action:"linked_staff_access_activated",role,reason,createdAt:now});
      });
      return {personId,targetUid,status:outcome,role};
    }
    if(input.action==="list_memberships"){
      const snapshot=await db.collection("schools/"+ctx.schoolId+"/memberships").limit(101).get();
      if(snapshot.size===101)throw new TenantAccessError("resource-exhausted","Member directory is too large for this pilot page.");
      return {members:snapshot.docs.filter(member=>member.data().schoolId===ctx.schoolId)
        .map(member=>({
          uid:member.id,status:member.data().status,
          roles:Array.isArray(member.data().roles)?member.data().roles:[],
          displayName:typeof member.data().displayName==="string"?member.data().displayName:"",
          revision:Number(member.data().revision)||1
        }))};
    }
    if(input.action==="suspend_access"){
      const targetUid=id(input.targetUid),expectedRevision=Number(input.expectedRevision);
      if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)
        invalid("Refresh this school access record before suspending it.");
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
        const currentRevision=Number(current.data().revision)||1;
        if(currentRevision!==expectedRevision)
          throw new TenantAccessError("failed-precondition","This school access record changed after you reviewed it. Refresh before suspending access.");
        if(Array.isArray(current.data().roles)&&current.data().roles.includes("school_admin"))
          throw new TenantAccessError("permission-denied","School administrator suspension requires platform-owner review.");
        const now=FieldValue.serverTimestamp(),revision=currentRevision+1;
        tx.update(targetRef,{status:"suspended",revision,updatedAt:now,updatedByUid:ctx.uid});
        tx.set(indexRef,{schoolId:ctx.schoolId,status:"suspended",
          roles:Array.isArray(current.data().roles)?current.data().roles:[],
          revision,updatedAt:now});
        tx.create(auditRef,{schoolId:ctx.schoolId,actorUid:ctx.uid,targetUid,
          action:"school_membership_suspended",reason,createdAt:now});
      });
      return {targetUid,status:"suspended",revision:expectedRevision+1};
    }
    if(input.action==="restore_access"){
      const targetUid=id(input.targetUid),expectedRevision=Number(input.expectedRevision);
      if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)
        invalid("Refresh this school access record before restoring it.");
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
        const currentRevision=Number(current.data().revision)||1;
        if(currentRevision!==expectedRevision)
          throw new TenantAccessError("failed-precondition","This school access record changed after you reviewed it. Refresh before restoring access.");
        if(Array.isArray(current.data().roles)&&current.data().roles.includes("school_admin"))
          throw new TenantAccessError("permission-denied","School administrator recovery requires platform-owner review.");
        if(current.data().personId){
          const person=await tx.get(base.doc(id(current.data().personId)));
          if(!person.exists||person.data().schoolId!==ctx.schoolId||person.data().status!=="active"||
             person.data().authUid!==targetUid)
            throw new TenantAccessError("failed-precondition","The linked person record must be active and bound to this account before access is restored.");
        }
        const roles=Array.isArray(current.data().roles)?current.data().roles:[];
        if(!roles.some(role=>["student","teacher","registrar"].includes(role)))
          throw new TenantAccessError("failed-precondition","This membership has no recoverable school role.");
        const now=FieldValue.serverTimestamp(),revision=currentRevision+1;
        tx.update(targetRef,{status:"active",revision,restoredAt:now,
          restoredByUid:ctx.uid,restoreReason:reason,updatedAt:now,updatedByUid:ctx.uid});
        tx.set(indexRef,{schoolId:ctx.schoolId,status:"active",roles,revision,updatedAt:now});
        tx.create(auditRef,{schoolId:ctx.schoolId,actorUid:ctx.uid,targetUid,
          action:"school_membership_restored",reason,createdAt:now});
      });
      return {targetUid,status:"active",revision:expectedRevision+1};
    }
    if(input.action==="preview_student_account_recovery"||input.action==="recover_student_account"){
      const personId=id(input.personId),replacementPersonId=id(input.replacementPersonId);
      if(input.action==="preview_student_account_recovery"){
        const review=await reviewStudentAccountRecovery(personId,replacementPersonId);
        return review.preview;
      }
      const reason=field(input.reason,500,"Account recovery reason");
      if(reason.length<20)
        invalid("Explain the student account replacement in at least 20 characters.");
      const expectedCanonicalRevision=Number(input.expectedCanonicalRevision),
        expectedReplacementRevision=Number(input.expectedReplacementRevision),
        expectedReplacementMembershipRevision=Number(input.expectedReplacementMembershipRevision),
        expectedCanonicalMembershipRevision=Number(input.expectedCanonicalMembershipRevision||0);
      for(const [value,label] of [
        [expectedCanonicalRevision,"canonical student"],
        [expectedReplacementRevision,"replacement student"],
        [expectedReplacementMembershipRevision,"replacement membership"]
      ])if(!Number.isSafeInteger(value)||value<1)
        invalid("Refresh the "+label+" recovery preview before saving.");
      if(!Number.isSafeInteger(expectedCanonicalMembershipRevision)||expectedCanonicalMembershipRevision<0)
        invalid("Refresh the previous-account recovery preview before saving.");

      const {getAuth}=require("firebase-admin/auth");
      const initial=await reviewStudentAccountRecovery(personId,replacementPersonId);
      if(initial.blockers.length)
        throw new TenantAccessError("failed-precondition",initial.blockers[0]);
      const replacementAccount=await getAuth().getUser(initial.replacementUid);
      if(replacementAccount.disabled)
        throw new TenantAccessError("failed-precondition","The replacement login is disabled. Restore the sign-in identity before recovery.");

      const canonicalAudit=db.collection("schools/"+ctx.schoolId+"/directory_audit").doc(),
        duplicateAudit=db.collection("schools/"+ctx.schoolId+"/directory_audit").doc();
      let result;
      await db.runTransaction(async tx=>{
        await requireCurrentAdmin(tx);
        const review=await reviewStudentAccountRecovery(personId,replacementPersonId,tx);
        if(review.blockers.length)
          throw new TenantAccessError("failed-precondition",review.blockers[0]);
        const {canonical,replacement,replacementMember,canonicalMember}=review.docs;
        if(Number(canonical.data().revision||1)!==expectedCanonicalRevision||
           Number(replacement.data().revision||1)!==expectedReplacementRevision||
           Number(replacementMember.data().revision||0)!==expectedReplacementMembershipRevision||
           Number(canonicalMember?.data?.()?.revision||0)!==expectedCanonicalMembershipRevision)
          throw new TenantAccessError("failed-precondition",
            "Student identity records changed after preview. Refresh and review the recovery again.");

        const now=FieldValue.serverTimestamp(),newUid=review.replacementUid,oldUid=review.canonicalUid,
          canonicalData=canonical.data(),replacementData=replacement.data(),
          previousAuthUids=[...new Set([
            ...(Array.isArray(canonicalData.previousAuthUids)?canonicalData.previousAuthUids:[]),
            ...(oldUid&&oldUid!==newUid?[oldUid]:[])
          ].filter(value=>typeof value==="string"&&value&&value!==newUid))].slice(-20),
          canonicalRevision=expectedCanonicalRevision+1,
          duplicateRevision=expectedReplacementRevision+1,
          replacementMembershipRevision=expectedReplacementMembershipRevision+1;

        tx.update(review.refs.canonicalRef,{
          authUid:newUid,previousAuthUids,revision:canonicalRevision,
          accountRecoveredAt:now,accountRecoveredByUid:ctx.uid,
          updatedAt:now,updatedByUid:ctx.uid
        });
        tx.update(review.refs.replacementRef,{
          status:"archived",authUid:null,
          previousAuthUids:[...new Set([
            ...(Array.isArray(replacementData.previousAuthUids)?replacementData.previousAuthUids:[]),newUid
          ])].slice(-20),
          mergedIntoPersonId:personId,mergedAt:now,mergedByUid:ctx.uid,
          mergeReason:reason,revision:duplicateRevision,updatedAt:now,updatedByUid:ctx.uid
        });
        tx.update(review.refs.replacementMemberRef,{
          personId,status:"active",roles:review.replacementRoles,
          displayName:String(canonicalData.displayName||"Student").slice(0,140),
          revision:replacementMembershipRevision,
          accountRecoveryFromPersonId:replacementPersonId,
          updatedAt:now,updatedByUid:ctx.uid
        });
        tx.set(db.doc("platform_users/"+newUid+"/memberships/"+ctx.schoolId),{
          schoolId:ctx.schoolId,status:"active",roles:review.replacementRoles,
          revision:replacementMembershipRevision,updatedAt:now
        });

        let previousAccountSuspended=false;
        if(oldUid&&review.refs.canonicalMemberRef&&canonicalMember?.exists&&
           canonicalMember.data().status==="active"){
          const oldData=canonicalMember.data(),
            oldRoles=Array.isArray(oldData.roles)?oldData.roles:["student"],
            oldRevision=expectedCanonicalMembershipRevision+1;
          tx.update(review.refs.canonicalMemberRef,{
            status:"suspended",revision:oldRevision,
            suspendedAt:now,suspendedByUid:ctx.uid,
            suspensionReason:"Student account replaced: "+reason,
            updatedAt:now,updatedByUid:ctx.uid
          });
          tx.set(db.doc("platform_users/"+oldUid+"/memberships/"+ctx.schoolId),{
            schoolId:ctx.schoolId,status:"suspended",roles:oldRoles,
            revision:oldRevision,updatedAt:now
          });
          previousAccountSuspended=true;
        }

        tx.create(canonicalAudit,{
          schoolId:ctx.schoolId,actorUid:ctx.uid,personId,targetUid:newUid,
          action:"student_account_recovered",reason,
          previousPersonId:replacementPersonId,previousAuthUid:oldUid||null,
          createdAt:now
        });
        tx.create(duplicateAudit,{
          schoolId:ctx.schoolId,actorUid:ctx.uid,personId:replacementPersonId,targetUid:newUid,
          action:"duplicate_student_person_archived",reason,mergedIntoPersonId:personId,createdAt:now
        });
        result={personId,replacementPersonId,status:"recovered",
          displayName:String(canonicalData.displayName||"Student").slice(0,140),
          previousAccountSuspended};
      });
      return result;
    }
    if(input.action==="search_legacy_student_candidates"){
      if(ctx.schoolId!=="mcs-manila")
        throw new TenantAccessError("failed-precondition",
          "Legacy identity reconciliation is available only while the MCS compatibility layer is active.");
      const personId=id(input.personId),raw=String(input.query||"").trim().toLocaleLowerCase("en");
      if(raw.length<2||raw.length>100)invalid("Search the legacy student directory with at least 2 characters.");
      const person=await base.doc(personId).get();
      if(!person.exists||person.data().schoolId!==ctx.schoolId||
         person.data().kind!=="student"||person.data().status!=="active")
        throw new TenantAccessError("failed-precondition","Choose an active canonical student record.");
      const canonical=person.data(),snap=await db.collection("students").limit(501).get();
      if(snap.size===501)
        throw new TenantAccessError("resource-exhausted",
          "Legacy identity reconciliation requires paginated search before this directory grows beyond the pilot limit.");
      const value=(data,key)=>String(data?.[key]||"").trim();
      const matches=snap.docs.map(doc=>{
        const data=doc.data()||{},name=value(data,"name")||value(data,"studentName"),
          email=value(data,"email").toLowerCase(),section=value(data,"section"),
          studentNumber=value(data,"studentNumber")||value(data,"studentNo")||value(data,"lrn");
        const fields=[doc.id,name,email,section,studentNumber].map(item=>String(item||"").toLocaleLowerCase("en"));
        const exact=fields.some(item=>item===raw);
        return {doc,data,name,email,section,studentNumber,exact,
          matched:fields.some(item=>item.includes(raw))};
      }).filter(row=>row.matched)
        .sort((a,b)=>Number(b.exact)-Number(a.exact)||a.name.localeCompare(b.name))
        .slice(0,20);
      const candidates=await Promise.all(matches.map(async row=>{
        const linked=await base.where("legacyStudentIds","array-contains",row.doc.id).limit(4).get();
        const linkedPersonIds=linked.docs.filter(doc=>doc.data().schoolId===ctx.schoolId).map(doc=>doc.id);
        return {
          legacyStudentId:row.doc.id,
          displayName:row.name||"Legacy student",
          email:row.email,
          section:row.section,
          studentNumber:row.studentNumber,
          status:String(row.data.status||"active"),
          exactMatch:row.exact,
          linkedPersonIds,
          alreadyLinkedHere:linkedPersonIds.includes(personId),
          nameMatchesCanonical:Boolean(row.name&&canonical.displayName&&
            row.name.toLocaleLowerCase("en")===String(canonical.displayName).toLocaleLowerCase("en")),
          studentNumberMatchesCanonical:Boolean(row.studentNumber&&canonical.studentNumber&&
            row.studentNumber===String(canonical.studentNumber))
        };
      }));
      return {
        person:{
          personId,displayName:String(canonical.displayName||"Student").slice(0,140),
          studentNumber:String(canonical.studentNumber||""),
          revision:Number(canonical.revision)||1,
          legacyStudentIds:Array.isArray(canonical.legacyStudentIds)?canonical.legacyStudentIds.slice(0,50):[]
        },
        candidates
      };
    }
    if(input.action==="link_legacy_student_identity"){
      if(ctx.schoolId!=="mcs-manila")
        throw new TenantAccessError("failed-precondition",
          "Legacy identity reconciliation is available only while the MCS compatibility layer is active.");
      const personId=id(input.personId),legacyStudentId=id(input.legacyStudentId),
        expectedRevision=Number(input.expectedRevision),
        reason=field(input.reason,500,"Identity reconciliation reason");
      if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)
        invalid("Refresh the canonical student before linking a legacy identity.");
      if(reason.length<20)
        invalid("Explain the legacy identity reconciliation in at least 20 characters.");
      const personRef=base.doc(personId),legacyRef=db.doc("students/"+legacyStudentId),
        auditRef=db.collection("schools/"+ctx.schoolId+"/directory_audit").doc();
      let authUid=null,legacySnapshot=null,newRevision=null;
      await db.runTransaction(async tx=>{
        await requireCurrentAdmin(tx);
        const [person,legacy,linked]=await Promise.all([
          tx.get(personRef),tx.get(legacyRef),
          tx.get(base.where("legacyStudentIds","array-contains",legacyStudentId).limit(4))
        ]);
        if(!person.exists||person.data().schoolId!==ctx.schoolId||
           person.data().kind!=="student"||person.data().status!=="active")
          throw new TenantAccessError("failed-precondition","The canonical student must still be active.");
        const data=person.data(),currentRevision=Number(data.revision)||1;
        if(currentRevision!==expectedRevision)
          throw new TenantAccessError("failed-precondition",
            "The canonical student changed after the reconciliation preview. Refresh and review the latest record.");
        if(!legacy.exists)
          throw new TenantAccessError("not-found","The selected legacy student record no longer exists.");
        const legacyData=legacy.data()||{},legacyStatus=String(legacyData.status||"active").toLowerCase();
        if(legacyData.active===false||
           ["disabled","archived","suspended","inactive","deleted","ended"].includes(legacyStatus))
          throw new TenantAccessError("failed-precondition",
            "The selected legacy student record is inactive and cannot drive current compatibility access.");
        const conflicts=linked.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&doc.id!==personId&&
          !(doc.data().status==="archived"&&doc.data().mergedIntoPersonId===personId));
        if(conflicts.length)
          throw new TenantAccessError("failed-precondition",
            "This legacy student identity is already linked to another school person. Resolve that identity conflict first.");
        authUid=typeof data.authUid==="string"&&data.authUid?id(data.authUid):null;
        legacySnapshot={
          displayName:String(legacyData.name||legacyData.studentName||"Legacy student").slice(0,140),
          email:String(legacyData.email||"").slice(0,254),
          section:String(legacyData.section||"").slice(0,140)
        };
        newRevision=currentRevision+1;
        const now=FieldValue.serverTimestamp();
        tx.update(personRef,{
          legacyStudentIds:FieldValue.arrayUnion(legacyStudentId),
          legacyIdentityReconciledAt:now,legacyIdentityReconciledByUid:ctx.uid,
          revision:newRevision,updatedAt:now,updatedByUid:ctx.uid
        });
        tx.create(auditRef,{
          schoolId:ctx.schoolId,actorUid:ctx.uid,personId,legacyStudentId,
          action:"legacy_student_identity_linked",reason,
          legacyDisplayName:legacySnapshot.displayName,
          legacySection:legacySnapshot.section,
          revision:newRevision,createdAt:now
        });
      });
      // Rebuild the server-owned compatibility projection immediately so the
      // learner can retry without another administrative step.
      if(authUid){
        const resolved=await legacyStudentRecordsForAccount({
          db,uid:authUid,email:"",schoolId:ctx.schoolId,maxRecords:50
        });
        const profiles=resolved.records.map(record=>({
          id:record.id,
          section:String(record.data?.section||"").trim(),
          name:String(record.data?.name||record.data?.studentName||"Student").slice(0,140)
        })).filter(record=>record.section);
        await db.doc("student_access/"+authUid).set({
          ownerUid:authUid,
          sections:[...new Set(profiles.map(record=>record.section))].slice(0,40),
          studentIds:resolved.records.map(record=>record.id).slice(0,50),
          profiles,identitySource:"admin_reconciled_legacy_id",
          updatedAt:FieldValue.serverTimestamp()
        },{merge:true});
      }
      return {personId,legacyStudentId,revision:newRevision,status:"linked",legacy:legacySnapshot};
    }
    if(input.action==="list_invitable_people") {
      const role=input.role;
      if(!["student","teacher","registrar"].includes(role))invalid("Choose a student, teacher or registrar invitation.");
      const kind=role==="student"?"student":"staff";
      const snap=await base.where("kind","==",kind).limit(201).get();
      if(snap.size===201)
        throw new TenantAccessError("resource-exhausted","The invitation picker requires paginated directory search.");
      return {people:snap.docs.filter(person=>person.data().schoolId===ctx.schoolId&&
          person.data().status==="active"&&!person.data().authUid)
        .map(person=>({personId:person.id,displayName:person.data().displayName,kind}))};
    }
    if(input.action==="update_person"){
      const personId=id(input.personId),displayName=field(input.displayName,140,"Person name"),
        expectedRevision=Number(input.expectedRevision);
      if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)
        invalid("Refresh this person record before saving profile changes.");
      const clean=(value,max,label)=>{
        const result=String(value??"").trim();
        if(result.length>max)invalid(label+" is too long.");
        return result;
      };
      const studentNumber=input.studentNumber===undefined?undefined:clean(input.studentNumber,80,"Student number");
      const birthDate=input.birthDate===undefined?undefined:checkedBirthDate(input.birthDate);
      const guardianName=input.primaryGuardianName===undefined?undefined:clean(input.primaryGuardianName,140,"Guardian name");
      const guardianEmail=input.primaryGuardianEmail===undefined?undefined:clean(input.primaryGuardianEmail,254,"Guardian email").toLowerCase();
      const guardianMobile=input.primaryGuardianMobile===undefined?undefined:clean(input.primaryGuardianMobile,40,"Guardian mobile");
      if(guardianEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guardianEmail))
        invalid("Enter a valid guardian email.");
      const ref=base.doc(personId),audit=db.collection("schools/"+ctx.schoolId+"/directory_audit").doc();
      await db.runTransaction(async tx=>{
        await requireCurrentAdmin(tx);
        const person=await tx.get(ref);
        if(!person.exists||person.data().schoolId!==ctx.schoolId)
          throw new TenantAccessError("not-found","The person is not in this school directory.");
        if(person.data().status!=="active")
          throw new TenantAccessError("failed-precondition","Restore this person record before editing its profile.");
        const currentRevision=Number(person.data().revision)||1;
        if(currentRevision!==expectedRevision)
          throw new TenantAccessError("failed-precondition","This person record changed after you opened it. Refresh the directory and review the latest profile before saving.");
        const current=person.data(),identityChanges=current.kind==="student"?studentIdentityChange(current,{displayName,studentNumber,birthDate}):{};
        const identityFields=Object.keys(identityChanges);
        let identityReason=null;
        if(identityFields.length){
          // Legal identity amendments require actual school authority, even during platform assist.
          const member=await tx.get(adminRef);
          if(!member.exists||member.data().schoolId!==ctx.schoolId||member.data().status!=="active"||!member.data().roles?.includes("school_admin"))throw new TenantAccessError("permission-denied","A verified School Administrator must review student identity corrections.");
          identityReason=field(input.reason,500,"Identity correction reason");if(identityReason.length<12)invalid("Document the identity correction reason in at least 12 characters.");
          if((identityFields.includes("displayName")||identityFields.includes("birthDate"))&&!current.activationEmailHash)
            throw new TenantAccessError("failed-precondition","Name or birth-date corrections without a stable activation identity require manual identity reconciliation. The guardian-derived admission key must not be changed implicitly.");
          if(identityChanges.studentNumber){
            const matches=await tx.get(base.where("studentNumber","==",identityChanges.studentNumber).limit(3));
            if(matches.size===3||matches.docs.some(doc=>doc.id!==personId&&!(doc.data().schoolId===ctx.schoolId&&doc.data().kind==="student"&&doc.data().status==="archived"&&!doc.data().authUid&&doc.data().mergedIntoPersonId===personId)))throw new TenantAccessError("already-exists","This student number belongs to another directory record. Review the duplicate; do not reuse it.");
          }
          const applications=await tx.get(db.collection("schools/"+ctx.schoolId+"/enrollment_applications").where("personId","==",personId).limit(101));
          if(applications.size===101||applications.docs.some(doc=>doc.data().schoolId!==ctx.schoolId||["submitted","needs_information","accepted"].includes(doc.data().status)))
            throw new TenantAccessError("failed-precondition","Resolve pending linked admissions before changing the student identity.");
        }
        const now=FieldValue.serverTimestamp(),revision=currentRevision+1;
        const change={displayName,searchKey:displayName.toLocaleLowerCase("en")+"#"+personId,
          revision,updatedAt:now,updatedByUid:ctx.uid};
        if(person.data().kind==="student"){
          if(studentNumber!==undefined)change.studentNumber=studentNumber||null;
          if(birthDate!==undefined)change.birthDate=birthDate;
          if(guardianName!==undefined)change.primaryGuardianName=guardianName||null;
          if(guardianEmail!==undefined)change.primaryGuardianEmail=guardianEmail||null;
          if(guardianMobile!==undefined)change.primaryGuardianMobile=guardianMobile||null;
        }
        // All transaction reads must happen before the first write.
        let memberRef=null,member=null;
        if(person.data().authUid){
          memberRef=db.doc("schools/"+ctx.schoolId+"/memberships/"+id(person.data().authUid));
          member=await tx.get(memberRef);
        }
        tx.update(ref,change);
        if(member?.exists&&member.data().schoolId===ctx.schoolId)
          tx.update(memberRef,{displayName,updatedAt:now});
        tx.create(audit,{schoolId:ctx.schoolId,actorUid:ctx.uid,personId,
          action:"person_profile_updated",revision,createdAt:now,...(identityFields.length?{reason:identityReason,identityFields}: {})});
        if(identityFields.length)tx.create(db.collection("schools/"+ctx.schoolId+"/student_records_audit").doc(),{schoolId:ctx.schoolId,personId,actorUid:ctx.uid,action:"student_identity_corrected",fields:identityFields,reason:identityReason,revision,createdAt:now});
      });
      return {personId,displayName};
    }
    if(input.action==="archive_person"||input.action==="restore_person"){
      const personId=id(input.personId),reason=field(input.reason,500,"Lifecycle reason"),
        expectedRevision=Number(input.expectedRevision);
      if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)
        invalid("Refresh this person record before changing its lifecycle.");
      if(reason.length<12)invalid("Explain the person record lifecycle change in at least 12 characters.");
      const ref=base.doc(personId),audit=db.collection("schools/"+ctx.schoolId+"/directory_audit").doc();
      const restoring=input.action==="restore_person";
      await db.runTransaction(async tx=>{
        await requireCurrentAdmin(tx);
        const person=await tx.get(ref);
        if(!person.exists||person.data().schoolId!==ctx.schoolId)
          throw new TenantAccessError("not-found","The person is not in this school directory.");
        const data=person.data(),currentRevision=Number(data.revision)||1;
        if(currentRevision!==expectedRevision)
          throw new TenantAccessError("failed-precondition","This person record changed after you opened it. Refresh before changing its lifecycle.");
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
          if(invitations.docs.some(doc=>doc.data().schoolId===ctx.schoolId&&invitationIsActivePending(doc.data())))
            throw new TenantAccessError("failed-precondition","Revoke this person's active pending invitation before archiving.");
          if(data.kind==="student"){
            const [enrollments,registrations]=await Promise.all([
              tx.get(db.collection("schools/"+ctx.schoolId+"/enrollments")
                .where("personId","==",personId).limit(101)),
              tx.get(db.collection("schools/"+ctx.schoolId+"/student_registrations")
                .where("personId","==",personId).limit(101))
            ]);
            if(enrollments.size===101||registrations.size===101)
              throw new TenantAccessError("resource-exhausted","Student academic history requires reviewed pagination before archiving.");
            if(registrations.docs.some(doc=>doc.data().schoolId===ctx.schoolId&&doc.data().status==="active"))
              throw new TenantAccessError("failed-precondition","End this student's active official registration before archiving the person record.");
            if(enrollments.docs.some(doc=>doc.data().schoolId===ctx.schoolId&&doc.data().status==="active"))
              throw new TenantAccessError("failed-precondition","End this student's remaining active course enrollments before archiving the person record.");
          }else if(data.kind==="staff"&&data.authUid){
            const teacherUid=id(data.authUid),[assignments,advisers]=await Promise.all([
              tx.get(db.collection("schools/"+ctx.schoolId+"/staff_assignments")
                .where("teacherUid","==",teacherUid).limit(101)),
              tx.get(db.collection("schools/"+ctx.schoolId+"/section_advisers")
                .where("teacherUid","==",teacherUid).limit(101))
            ]);
            if(assignments.size===101||advisers.size===101)
              throw new TenantAccessError("resource-exhausted","Teacher assignment history requires reviewed pagination before archiving.");
            if(assignments.docs.some(doc=>doc.data().schoolId===ctx.schoolId&&doc.data().status==="active"))
              throw new TenantAccessError("failed-precondition","End this teacher's active course assignments before archiving the person record.");
            if(advisers.docs.some(doc=>doc.data().schoolId===ctx.schoolId&&doc.data().status==="active"))
              throw new TenantAccessError("failed-precondition","End this teacher's active Section Adviser / Homeroom assignment before archiving the person record.");
          }
        }
        const now=FieldValue.serverTimestamp(),revision=currentRevision+1;
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
      const activationEmail=typeof person.activationEmail==="string"?person.activationEmail.trim().toLowerCase():"";
      if(activationEmail&&ctx.schoolId!=="manila-cathedral-school")
        throw new TenantAccessError("failed-precondition","Roster email activation is not enabled for this school.");
      if(activationEmail&&person.kind!=="student")
        invalid("Roster activation email is only for student records.");
      if(activationEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(activationEmail))
        invalid("Enter a valid student activation email.");
      const activationEmailHash=activationEmail?rosterEmailHash(activationEmail):null;
      const ref=base.doc(),audit=db.collection("schools/"+ctx.schoolId+"/directory_audit").doc();
      const now=FieldValue.serverTimestamp();
      await db.runTransaction(async tx=>{
        await requireCurrentAdmin(tx);
        tx.create(ref,{
          schoolId:ctx.schoolId,displayName,searchKey:displayName.toLocaleLowerCase("en")+"#"+ref.id,
          kind:person.kind,status:"active",authUid:null,
          ...(activationEmailHash?{activationEmailHash}:{}),createdByUid:ctx.uid,
          createdAt:now,updatedAt:now,revision:1
        });
        tx.create(audit,{schoolId:ctx.schoolId,actorUid:ctx.uid,personId:ref.id,
          action:"create_person",activationEmailPrepared:Boolean(activationEmailHash),createdAt:now});
      });
      return {personId:ref.id,accountLinked:false,activationReady:Boolean(activationEmailHash)};
    }
    if(input.action==="revoke_invitation"){
      const invitationId=id(input.invitationId),expectedRevision=Number(input.expectedRevision),
        reason=field(input.reason,500,"Invitation revoke reason"),
        ref=db.doc("schools/"+ctx.schoolId+"/invitations/"+invitationId),
        audit=db.collection("schools/"+ctx.schoolId+"/directory_audit").doc();
      if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)
        invalid("Refresh this invitation before revoking it.");
      if(reason.length<12)invalid("Explain why this invitation is being revoked in at least 12 characters.");
      let personId=null;
      await db.runTransaction(async tx=>{
        await requireCurrentAdmin(tx);
        const invitation=await tx.get(ref);
        if(!invitation.exists||invitation.data().schoolId!==ctx.schoolId)
          throw new TenantAccessError("not-found","The invitation is not in this school.");
        const data=invitation.data(),revision=Number(data.revision)||1;
        if(revision!==expectedRevision)
          throw new TenantAccessError("failed-precondition","This invitation changed after you opened it. Refresh the person details before revoking it.");
        if(data.status!=="pending")
          throw new TenantAccessError("failed-precondition","Only a pending invitation can be revoked.");
        personId=data.personId||null;
        const now=FieldValue.serverTimestamp();
        tx.update(ref,{status:"revoked",revokedByUid:ctx.uid,revokedAt:now,revokeReason:reason,
          revision:revision+1,updatedByUid:ctx.uid,updatedAt:now});
        tx.create(audit,{schoolId:ctx.schoolId,actorUid:ctx.uid,personId,
          invitationId,action:"invitation_revoked",reason,revision:revision+1,createdAt:now});
      });
      return {invitationId,personId,status:"revoked",revision:expectedRevision+1};
    }
    if(input.action==="invite") {
      const email=field(input.email,254,"Email").toLowerCase();
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))invalid("Enter a valid invitation email.");
      if(!["student","teacher","registrar"].includes(input.role))invalid("Choose a student, teacher or registrar invitation.");
      if(ctx.schoolId==="manila-cathedral-school"&&input.role==="student")
        throw new TenantAccessError("failed-precondition",
          "Manila Cathedral School students use verified roster activation instead of individual invitations.");
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
      if(!school.exists||!["active","pilot"].includes(school.data().state)||!invitation.exists)
        throw new TenantAccessError("permission-denied","This school invitation is unavailable.");
      const invited=invitation.data();
      if(invited.schoolId!==schoolId||invited.email!==email||
         !["teacher","student","registrar"].includes(invited.requestedRole))
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

module.exports={createPeopleDirectoryService,createInvitationAcceptanceService,importIdentity,normalizedImport,invitationIsActivePending,checkedBirthDate,studentIdentityChange};
