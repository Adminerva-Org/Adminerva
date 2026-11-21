"use strict";
/**
 * School-scoped Enrollment & Registration.
 *
 * School Admin operates this during the current phase; the record model is
 * intentionally registrar-ready. Online applicants and onsite/manual entries
 * converge here before official student/person/class records are created.
 */
const {FieldValue}=require("firebase-admin/firestore");
const {createHash}=require("node:crypto");
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");
const {rosterEmailHash,normalizedRosterEmail}=require("./school-roster-identity.js");

const EMAIL_TYPES=new Set(["personal","institutional"]);
const APPLICATION_REVIEW_STATUSES=new Set(["needs_information","rejected"]);

function deny(code,message){throw new TenantAccessError(code,message)}
function checkId(value,label="Identifier",max=330){
  if(typeof value!=="string"||value.length>max||
    !new RegExp("^[A-Za-z0-9][A-Za-z0-9_-]{0,"+(max-1)+"}$").test(value))
    deny("invalid-argument",label+" is invalid.");
  return value;
}
function text(value,label,max=140){
  const out=typeof value==="string"?value.trim():"";
  if(!out||out.length>max)deny("invalid-argument",label+" is required and must be shorter.");
  return out;
}
function optionalText(value,max=80){
  const out=typeof value==="string"?value.trim():"";
  if(out.length>max)deny("invalid-argument","Optional student information is too long.");
  return out||null;
}
function normalizedEmail(value,label,required=true){
  const out=typeof value==="string"?value.trim().toLowerCase():"";
  if(!out&&!required)return null;
  if(!out||out.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out))
    deny("invalid-argument","Enter a valid "+label.toLowerCase()+".");
  return out;
}
function academicDate(value,label){
  const out=text(value,label,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(out))deny("invalid-argument",label+" must use YYYY-MM-DD.");
  const parsed=new Date(out+"T00:00:00Z");
  if(Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==out||parsed.getTime()>=Date.now())
    deny("invalid-argument","Enter a valid "+label.toLowerCase()+" in the past.");
  return out;
}
function gradeRequiresStudentEmail(level){
  const raw=String(level||"").trim().toLowerCase();
  if(raw==="sned_jhs")return true;
  return /^\d+$/.test(raw)&&Number(raw)>=7;
}
function key(...parts){
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}
function registrationOwnsEnrollment(registrationId,enrollment,offering){
  if(!enrollment||typeof enrollment!=="object")return false;
  if(enrollment.registrationId)return enrollment.registrationId===registrationId;
  return Boolean(offering&&offering.rosterMode!=="selective");
}
function legacyImportPersonId(email){
  const identity=createHash("sha256").update("student\0email:"+email).digest("hex");
  return "imp_"+identity.slice(0,40);
}
function standardSchool(data){
  return data?.compatibilityMode==="v4_only" &&
    (data?.provisioningMode||"standard")==="standard";
}
function publicReference(applicationId){
  return "APP-"+String(applicationId||"").slice(0,10).toUpperCase();
}
function applicationReference(doc){
  const stored=typeof doc.data().reference==="string"?doc.data().reference.trim():"";
  if(stored)return stored.slice(0,80);
  // Public applications created before references were persisted came only
  // from the historical MCS intake adapter. Preserve what those applicants saw.
  if(doc.data().source==="online")return "MCS-"+String(doc.id||"").slice(0,10).toUpperCase();
  return publicReference(doc.id);
}
function guardianPersonId({displayName,birthDate,guardianEmail}){
  return "reg_"+createHash("sha256")
    .update(["guardian-managed",displayName.toLowerCase(),birthDate,guardianEmail].join("\0"))
    .digest("hex").slice(0,40);
}

function createSchoolEnrollmentService({db}){
  return async request=>{
    const input=request.data||{};
    const ctx=await getSchoolContext({
      db,request,schoolId:input.schoolId,roles:["school_admin"],allowDraftAdmin:true
    });
    const root="schools/"+ctx.schoolId+"/";
    const schoolRef=db.doc("platform_schools/"+ctx.schoolId);
    const adminRef=db.doc(root+"memberships/"+ctx.uid);
    const school=await schoolRef.get();
    if(!school.exists||!["draft","pilot","active"].includes(school.data().state)||!standardSchool(school.data()))
      deny("failed-precondition",
        "Enrollment & Registration requires a standard canonical school workspace. This school's compatibility workflow remains unchanged.");

    async function requireCurrentAdmin(tx){
      if(ctx.platformOverride)return;
      const [currentSchool,member]=await Promise.all([tx.get(schoolRef),tx.get(adminRef)]);
      if(!currentSchool.exists||!["draft","pilot","active"].includes(currentSchool.data().state)||
         !standardSchool(currentSchool.data())||!member.exists||
         member.data().schoolId!==ctx.schoolId||member.data().status!=="active"||
         !Array.isArray(member.data().roles)||!member.data().roles.includes("school_admin"))
        deny("permission-denied","School enrollment authority changed. Refresh before saving.");
    }

    if(input.action==="catalog"){
      const names=["academic_years","academic_programs","terms","sections","subjects","course_offerings"];
      const snaps=await Promise.all(names.map(name=>db.collection(root+name).limit(250).get()));
      const by=Object.fromEntries(names.map((name,index)=>[name,snaps[index].docs
        .filter(doc=>doc.data().schoolId===ctx.schoolId&&doc.data().status==="active")
        .map(doc=>({id:doc.id,...doc.data()}))]));
      return {
        schoolId:ctx.schoolId,
        years:by.academic_years.map(row=>({id:row.id,name:row.name})),
        programs:by.academic_programs.map(row=>({id:row.id,name:row.name})),
        terms:by.terms.map(row=>({id:row.id,name:row.name,yearId:row.yearId,programId:row.programId,sequence:row.sequence||1})),
        sections:by.sections.map(row=>({id:row.id,name:row.name,programId:row.programId,gradeLevel:row.gradeLevel||null,pathway:row.pathway||null})),
        subjects:by.subjects.map(row=>({id:row.id,name:row.name})),
        offerings:by.course_offerings.map(row=>({
          offeringId:row.id,programId:row.programId,yearId:row.yearId,
          termId:row.termId,sectionId:row.sectionId,subjectId:row.subjectId,
          rosterMode:row.rosterMode||"legacy"
        }))
      };
    }

    if(input.action==="list_applications"){
      const snap=await db.collection(root+"enrollment_applications").limit(201).get();
      if(snap.size===201)deny("resource-exhausted","Enrollment application queue requires pagination.");
      const items=snap.docs.filter(doc=>doc.data().schoolId===ctx.schoolId).map(doc=>({
        applicationId:doc.id,reference:applicationReference(doc),
        personId:doc.data().personId||null,
        applicationType:doc.data().applicationType||"new",
        displayName:doc.data().displayName||"Student",
        birthDate:doc.data().birthDate||"",incomingLevel:doc.data().incomingLevel||"",
        yearId:doc.data().yearId||"",preferredProgramId:doc.data().preferredProgramId||"",
        guardianName:doc.data().guardianName||"",guardianRelationship:doc.data().guardianRelationship||"",
        guardianEmail:doc.data().guardianEmail||"",guardianMobile:doc.data().guardianMobile||"",
        studentEmail:doc.data().studentEmail||"",studentEmailType:doc.data().studentEmailType||"",
        studentEmailRequired:Boolean(doc.data().studentEmailRequired),
        source:doc.data().source||"online",status:doc.data().status||"submitted",
        reviewReason:doc.data().reviewReason||"",
        updatedAt:doc.data().updatedAt?.toMillis?.()||doc.data().createdAt?.toMillis?.()||0
      }));
      items.sort((a,b)=>b.updatedAt-a.updatedAt||a.displayName.localeCompare(b.displayName));
      return {items};
    }

    if(input.action==="review_application"){
      const applicationId=checkId(input.applicationId,"Application ID",128);
      const status=String(input.status||"").trim().toLowerCase();
      if(!APPLICATION_REVIEW_STATUSES.has(status))
        deny("invalid-argument","Choose Needs information or Rejected.");
      const reason=text(input.reason,"Review reason",500);
      if(reason.length<8)deny("invalid-argument","Explain the enrollment review decision.");
      const ref=db.doc(root+"enrollment_applications/"+applicationId);
      await db.runTransaction(async tx=>{
        await requireCurrentAdmin(tx);
        const application=await tx.get(ref);
        if(!application.exists||application.data().schoolId!==ctx.schoolId)
          deny("not-found","Enrollment application was not found.");
        if(["enrolled","withdrawn"].includes(application.data().status))
          deny("failed-precondition","This application already has a final enrollment state.");
        tx.update(ref,{status,reviewReason:reason,reviewedByUid:ctx.uid,
          reviewedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp(),
          revision:(Number(application.data().revision)||1)+1});
      });
      return {applicationId,status};
    }

    if(input.action==="student_candidate"){
      const personId=checkId(input.personId,"Person ID",128),
        personRef=db.doc(root+"people/"+personId);
      const [person,registrations]=await Promise.all([
        personRef.get(),
        db.collection(root+"student_registrations").where("personId","==",personId).limit(51).get()
      ]);
      if(!person.exists||person.data().schoolId!==ctx.schoolId)
        deny("not-found","The student is not in this school directory.");
      const data=person.data();
      if(data.kind!=="student"||data.status!=="active")
        deny("failed-precondition","Only an active student directory record can be placed through Enrollment & Registration.");
      if(registrations.size===51)
        deny("resource-exhausted","This student has too many registration records for a safe enrollment handoff.");
      const activeRegistrations=registrations.docs.filter(doc=>{
        const row=doc.data();
        return row.schoolId===ctx.schoolId&&row.status==="active";
      }).map(doc=>({
        registrationId:doc.id,yearId:doc.data().yearId||null,programId:doc.data().programId||null,
        termId:doc.data().termId||null,sectionId:doc.data().sectionId||null,
        gradeLevel:doc.data().gradeLevel||null,revision:Number(doc.data().revision)||1
      }));
      return {
        person:{
          personId,displayName:data.displayName||"Student",birthDate:data.birthDate||"",
          studentNumber:data.studentNumber||"",
          guardianName:data.primaryGuardianName||"",
          guardianRelationship:data.primaryGuardianRelationship||"",
          guardianEmail:data.primaryGuardianEmail||"",
          guardianMobile:data.primaryGuardianMobile||"",
          studentEmailType:data.studentEmailType||"personal",
          accountResponsibility:data.accountResponsibility||"student",
          accountLinked:Boolean(data.authUid),activationReady:Boolean(data.activationEmailHash),
          revision:Number(data.revision)||1
        },
        activeRegistrations
      };
    }

    if(input.action==="list_registrations"){
      const snap=await db.collection(root+"student_registrations").orderBy("displayName").limit(201).get();
      if(snap.size===201)deny("resource-exhausted","Enrollment list requires pagination.");
      return {items:snap.docs.filter(doc=>doc.data().schoolId===ctx.schoolId).map(doc=>({
        registrationId:doc.id,personId:doc.data().personId,
        displayName:doc.data().displayName||"Student",
        studentNumber:doc.data().studentNumber||"",
        status:doc.data().status||"active",
        yearId:doc.data().yearId,programId:doc.data().programId,
        termId:doc.data().termId,sectionId:doc.data().sectionId,
        gradeLevel:doc.data().gradeLevel||null,
        courseCount:Number(doc.data().courseCount)||0,
        accountLinked:Boolean(doc.data().accountLinked),
        accountResponsibility:doc.data().accountResponsibility||"student",
        guardianEmail:doc.data().guardianEmail||"",
        source:doc.data().source||"onsite",
        revision:Number(doc.data().revision)||1
      }))};
    }

    if(["end_registration","restore_registration"].includes(input.action)){
      const registrationId=checkId(input.registrationId,"Registration ID",128);
      const reason=text(input.reason,input.action==="end_registration"?"Registration end reason":"Registration restore reason",500);
      if(reason.length<12)deny("invalid-argument","Explain the registration change in at least 12 characters.");
      const registrationRef=db.doc(root+"student_registrations/"+registrationId);
      const initial=await registrationRef.get();
      if(!initial.exists||initial.data().schoolId!==ctx.schoolId)
        deny("not-found","The student registration was not found.");
      const initialData=initial.data();
      const enrollmentSnap=await db.collection(root+"enrollments")
        .where("personId","==",initialData.personId).limit(251).get();
      if(enrollmentSnap.size===251)
        deny("resource-exhausted","This student has too many enrollment records for a single registration change.");
      const relevantEnrollmentRefs=enrollmentSnap.docs
        .filter(doc=>{
          const row=doc.data();
          return row.schoolId===ctx.schoolId&&row.personId===initialData.personId&&
            row.yearId===initialData.yearId&&row.termId===initialData.termId&&
            row.sectionId===initialData.sectionId;
        }).map(doc=>doc.ref);
      const slotRef=db.doc(root+"student_registration_slots/"+
        key(initialData.personId,initialData.yearId,initialData.termId));
      const personRef=db.doc(root+"people/"+checkId(initialData.personId,"Person ID",128));
      const restoring=input.action==="restore_registration";
      const otherRegistrations=restoring
        ?await db.collection(root+"student_registrations").where("personId","==",initialData.personId).limit(51).get()
        :null;
      if(otherRegistrations?.size===51)
        deny("resource-exhausted","This student has too many registration records for safe restoration.");
      if(restoring){
        const conflict=otherRegistrations.docs.find(doc=>{
          const row=doc.data();
          return doc.id!==registrationId&&row.schoolId===ctx.schoolId&&row.status==="active"&&
            row.yearId===initialData.yearId&&row.termId===initialData.termId;
        });
        if(conflict)deny("failed-precondition",
          "This student already has another active official placement for the same academic period.");
      }

      let changedCourses=0;
      await db.runTransaction(async tx=>{
        await requireCurrentAdmin(tx);
        const registration=await tx.get(registrationRef);
        if(!registration.exists||registration.data().schoolId!==ctx.schoolId)
          deny("not-found","The student registration was not found.");
        const data=registration.data();
        if(restoring&&data.status!=="ended")
          deny("failed-precondition","Only an ended registration can be restored.");
        if(!restoring&&data.status!=="active")
          deny("failed-precondition","Only an active registration can be ended.");

        const [slot,person,...enrollments]=await Promise.all([
          tx.get(slotRef),tx.get(personRef),...relevantEnrollmentRefs.map(ref=>tx.get(ref))
        ]);
        if(restoring){
          if(!person.exists||person.data().schoolId!==ctx.schoolId||
             person.data().kind!=="student"||person.data().status!=="active")
            deny("failed-precondition","The student directory record must be active before restoring registration.");
          if(slot.exists&&slot.data().status==="active"&&slot.data().registrationId!==registrationId)
            deny("failed-precondition","Another official registration currently owns this academic-period placement.");

          const restorable=enrollments.filter(doc=>doc.exists&&doc.data().status==="ended"&&
            doc.data().endedByRegistrationId===registrationId);
          if(!restorable.length)
            deny("failed-precondition","No subject enrollments from this registration are available to restore.");
          const offerings=await Promise.all(restorable.map(doc=>
            tx.get(db.doc(root+"course_offerings/"+checkId(doc.data().offeringId,"Course offering ID",330)))));
          if(offerings.some(doc=>!doc.exists||doc.data().schoolId!==ctx.schoolId||doc.data().status!=="active"))
            deny("failed-precondition","One or more course offerings are no longer active. Create a new placement instead of restoring this registration.");
          const now=FieldValue.serverTimestamp();
          for(const doc of restorable){
            tx.update(doc.ref,{status:"active",restoredByUid:ctx.uid,restoredAt:now,
              restoreReason:reason,revision:(doc.data().revision||1)+1});
          }
          changedCourses=restorable.length;
          tx.update(registrationRef,{status:"active",restoredByUid:ctx.uid,restoredAt:now,
            restoreReason:reason,updatedByUid:ctx.uid,updatedAt:now,
            revision:(data.revision||1)+1});
          const slotData={schoolId:ctx.schoolId,personId:data.personId,yearId:data.yearId,
            programId:data.programId,termId:data.termId,sectionId:data.sectionId,
            registrationId,status:"active",updatedByUid:ctx.uid,updatedAt:now};
          if(slot.exists)tx.set(slotRef,{...slotData,revision:(slot.data().revision||1)+1},{merge:true});
          else tx.create(slotRef,{...slotData,revision:1,createdByUid:ctx.uid,createdAt:now});
        }else{
          const offeringDocs=await Promise.all(enrollments.map(doc=>doc.exists&&doc.data().offeringId
            ?tx.get(db.doc(root+"course_offerings/"+checkId(doc.data().offeringId,"Course offering ID",330)))
            :Promise.resolve(null)));
          const active=enrollments.filter((doc,index)=>{
            if(!doc.exists||doc.data().status!=="active")return false;
            const row=doc.data();
            const offering=offeringDocs[index];
            return registrationOwnsEnrollment(registrationId,row,
              offering?.exists&&offering.data().schoolId===ctx.schoolId?offering.data():null);
          });
          const now=FieldValue.serverTimestamp();
          for(const doc of active){
            tx.update(doc.ref,{status:"ended",endedByUid:ctx.uid,endedAt:now,endReason:reason,
              endedByRegistrationId:registrationId,revision:(doc.data().revision||1)+1});
          }
          changedCourses=active.length;
          tx.update(registrationRef,{status:"ended",endedByUid:ctx.uid,endedAt:now,
            endReason:reason,updatedByUid:ctx.uid,updatedAt:now,
            revision:(data.revision||1)+1});
          const slotData={schoolId:ctx.schoolId,personId:data.personId,yearId:data.yearId,
            programId:data.programId,termId:data.termId,sectionId:data.sectionId,
            registrationId,status:"ended",updatedByUid:ctx.uid,updatedAt:now};
          if(!slot.exists)tx.create(slotRef,{...slotData,revision:1,createdByUid:ctx.uid,createdAt:now});
          else if(slot.data().registrationId===registrationId||slot.data().status!=="active")
            tx.set(slotRef,{...slotData,revision:(slot.data().revision||1)+1},{merge:true});
        }
        const auditRef=db.collection(root+"directory_audit").doc();
        tx.create(auditRef,{schoolId:ctx.schoolId,actorUid:ctx.uid,personId:data.personId,
          registrationId,action:restoring?"student_registration_restored":"student_registration_ended",
          yearId:data.yearId,programId:data.programId,termId:data.termId,sectionId:data.sectionId,
          courseCount:changedCourses,reason,createdAt:FieldValue.serverTimestamp()});
      });
      return {registrationId,status:restoring?"active":"ended",courseCount:changedCourses};
    }

    if(input.action==="change_registration_section"){
      const registrationId=checkId(input.registrationId,"Registration ID",128),
        sectionId=checkId(input.sectionId,"Section"),
        expectedRevision=Number(input.expectedRevision),
        reason=text(input.reason,"Section change reason",500);
      if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)
        deny("invalid-argument","Refresh this registration before changing its section.");
      if(reason.length<12)
        deny("invalid-argument","Explain the section change in at least 12 characters.");

      const registrationRef=db.doc(root+"student_registrations/"+registrationId);
      const initial=await registrationRef.get();
      if(!initial.exists||initial.data().schoolId!==ctx.schoolId)
        deny("not-found","The student registration was not found.");
      const current=initial.data();
      if(current.status!=="active")
        deny("failed-precondition","Only an active registration can change section.");
      if(sectionId===current.sectionId)
        deny("invalid-argument","Choose a different section.");

      const personId=checkId(current.personId,"Person ID",128),
        yearId=checkId(current.yearId,"Academic year"),
        programId=checkId(current.programId,"Program"),
        termId=checkId(current.termId,"Academic period"),
        newRegistrationId=key(personId,yearId,termId,sectionId),
        newRegistrationRef=db.doc(root+"student_registrations/"+newRegistrationId),
        slotRef=db.doc(root+"student_registration_slots/"+key(personId,yearId,termId)),
        personRef=db.doc(root+"people/"+personId),
        sectionRef=db.doc(root+"sections/"+sectionId),
        yearRef=db.doc(root+"academic_years/"+yearId),
        programRef=db.doc(root+"academic_programs/"+programId),
        termRef=db.doc(root+"terms/"+termId),
        applicationRef=current.applicationId?
          db.doc(root+"enrollment_applications/"+checkId(current.applicationId,"Application ID",128)):null;

      const [section,year,program,term,offeringSnap,enrollmentSnap]=await Promise.all([
        sectionRef.get(),yearRef.get(),programRef.get(),termRef.get(),
        db.collection(root+"course_offerings").limit(250).get(),
        db.collection(root+"enrollments").where("personId","==",personId).limit(251).get()
      ]);
      for(const [record,label] of [[section,"section"],[year,"academic year"],[program,"program"],[term,"academic period"]]){
        if(!record.exists||record.data().schoolId!==ctx.schoolId||record.data().status!=="active")
          deny("failed-precondition","The selected "+label+" is not active in this school.");
      }
      if(section.data().programId!==programId)
        deny("failed-precondition","Choose a section in the registration's current program.");
      if(term.data().yearId!==yearId||term.data().programId!==programId)
        deny("failed-precondition","The registration's academic period no longer matches its program and school year.");
      const currentGrade=String(current.gradeLevel||"").trim().toLowerCase(),
        targetGrade=String(section.data().gradeLevel||"").trim().toLowerCase();
      if(currentGrade&&targetGrade&&currentGrade!==targetGrade)
        deny("failed-precondition","Section correction is limited to the same grade level. Use a new registration workflow for a grade-level or academic-period change.");
      if(enrollmentSnap.size===251)
        deny("resource-exhausted","This student has too many enrollment records for a safe section change.");

      const targetOfferings=offeringSnap.docs.filter(doc=>{
        const row=doc.data();
        return row.schoolId===ctx.schoolId&&row.status==="active"&&
          row.yearId===yearId&&row.programId===programId&&row.termId===termId&&
          row.sectionId===sectionId&&row.rosterMode!=="selective";
      });
      if(!targetOfferings.length)
        deny("failed-precondition","The target section has no active automatic-roster classes in this academic period.");
      if(targetOfferings.length>60)
        deny("resource-exhausted","The target section has too many classes for one placement change.");

      const currentCandidates=enrollmentSnap.docs.filter(doc=>{
        const row=doc.data();
        return row.schoolId===ctx.schoolId&&row.personId===personId&&row.status==="active"&&
          row.yearId===yearId&&row.termId===termId&&row.sectionId===current.sectionId;
      });
      const candidateOfferingIds=[...new Set(currentCandidates.map(doc=>doc.data().offeringId).filter(Boolean))];
      const candidateOfferings=await Promise.all(candidateOfferingIds.map(id=>
        db.doc(root+"course_offerings/"+checkId(id,"Course offering ID",330)).get()));
      const candidateOfferingMap=new Map(candidateOfferings.filter(doc=>doc.exists).map(doc=>[doc.id,doc.data()]));
      const currentOfficial=currentCandidates.filter(doc=>{
        const row=doc.data(),offering=candidateOfferingMap.get(row.offeringId);
        return registrationOwnsEnrollment(registrationId,row,
          offering&&offering.schoolId===ctx.schoolId?offering:null);
      });

      const currentEnrollmentRefs=currentOfficial.map(doc=>doc.ref),
        targetOfferingRefs=targetOfferings.map(doc=>doc.ref),
        targetEnrollmentRefs=targetOfferings.map(doc=>
          db.doc(root+"enrollments/"+key(personId,doc.id))),
        auditRef=db.collection(root+"directory_audit").doc();

      let result;
      await db.runTransaction(async tx=>{
        await requireCurrentAdmin(tx);
        const [registration,newRegistration,slot,person,targetSection,currentYear,currentProgram,currentTerm]=await Promise.all([
          tx.get(registrationRef),tx.get(newRegistrationRef),tx.get(slotRef),tx.get(personRef),
          tx.get(sectionRef),tx.get(yearRef),tx.get(programRef),tx.get(termRef)
        ]);
        if(!registration.exists||registration.data().schoolId!==ctx.schoolId)
          deny("not-found","The student registration was not found.");
        const data=registration.data(),actualRevision=Number(data.revision)||1;
        if(data.status!=="active")
          deny("failed-precondition","This registration is no longer active. Refresh the enrollment list.");
        if(actualRevision!==expectedRevision)
          deny("failed-precondition","This registration changed after you opened it. Refresh and review the latest placement.");
        if(data.personId!==personId||data.yearId!==yearId||data.programId!==programId||
           data.termId!==termId||data.sectionId!==current.sectionId)
          deny("failed-precondition","The registration placement changed. Refresh before trying again.");
        if(newRegistration.exists)
          deny("failed-precondition",newRegistration.data().status==="ended"
            ?"The target section already has ended registration history for this student. Review that history instead of silently reopening it."
            :"The target section already has a registration for this student.");
        if(slot.exists&&slot.data().status==="active"&&slot.data().registrationId!==registrationId)
          deny("failed-precondition","Another official registration currently owns this academic-period placement.");
        if(!person.exists||person.data().schoolId!==ctx.schoolId||
           person.data().kind!=="student"||person.data().status!=="active")
          deny("failed-precondition","The student directory record must be active before changing placement.");
        for(const [record,label] of [[targetSection,"section"],[currentYear,"academic year"],[currentProgram,"program"],[currentTerm,"academic period"]]){
          if(!record.exists||record.data().schoolId!==ctx.schoolId||record.data().status!=="active")
            deny("failed-precondition","The "+label+" changed while this placement was open. Refresh and retry.");
        }
        if(targetSection.data().programId!==programId||
           currentTerm.data().yearId!==yearId||currentTerm.data().programId!==programId)
          deny("failed-precondition","The target section no longer matches this academic period.");
        const application=applicationRef?await tx.get(applicationRef):null;
        if(application&&(!application.exists||application.data().schoolId!==ctx.schoolId||
           application.data().personId!==personId))
          deny("failed-precondition","The enrollment application link changed. Refresh before moving the student.");

        const oldEnrollments=await Promise.all(currentEnrollmentRefs.map(ref=>tx.get(ref)));
        const liveTargetOfferings=await Promise.all(targetOfferingRefs.map(ref=>tx.get(ref)));
        const targetEnrollments=await Promise.all(targetEnrollmentRefs.map(ref=>tx.get(ref)));
        if(liveTargetOfferings.some(doc=>!doc.exists||doc.data().schoolId!==ctx.schoolId||
          doc.data().status!=="active"||doc.data().yearId!==yearId||doc.data().programId!==programId||
          doc.data().termId!==termId||doc.data().sectionId!==sectionId||doc.data().rosterMode==="selective"))
          deny("failed-precondition","The target section's class roster configuration changed. Refresh before moving the student.");

        const endedTarget=targetEnrollments.find(doc=>doc.exists&&doc.data().status!=="active");
        if(endedTarget)
          deny("failed-precondition","The target section contains ended subject-enrollment history for this student. Review that history before changing the official placement.");

        const now=FieldValue.serverTimestamp();
        let endedCourses=0,createdCourses=0,adoptedCourses=0;
        for(const doc of oldEnrollments){
          if(!doc.exists||doc.data().status!=="active")continue;
          if(doc.data().registrationId&&doc.data().registrationId!==registrationId)
            deny("failed-precondition","An active class in the current section belongs to another registration. Review the student's enrollment history.");
          tx.update(doc.ref,{status:"ended",endedByUid:ctx.uid,endedAt:now,endReason:reason,
            endedByRegistrationId:registrationId,replacedByRegistrationId:newRegistrationId,
            revision:(Number(doc.data().revision)||1)+1});
          endedCourses++;
        }

        targetEnrollments.forEach((doc,index)=>{
          const offering=liveTargetOfferings[index],row=offering.data();
          if(doc.exists){
            const prior=doc.data();
            if(prior.schoolId!==ctx.schoolId||prior.personId!==personId||
               prior.offeringId!==offering.id)
              deny("failed-precondition","A target class enrollment key collision requires review.");
            if(prior.registrationId&&prior.registrationId!==newRegistrationId)
              deny("failed-precondition","A target class is already owned by another registration.");
            tx.update(doc.ref,{registrationId:newRegistrationId,programId:row.programId,
              yearId:row.yearId,termId:row.termId,sectionId:row.sectionId,subjectId:row.subjectId,
              placementAdoptedByUid:ctx.uid,placementAdoptedAt:now,
              revision:(Number(prior.revision)||1)+1});
            adoptedCourses++;
          }else{
            tx.create(doc.ref,{schoolId:ctx.schoolId,personId,offeringId:offering.id,
              registrationId:newRegistrationId,programId:row.programId,yearId:row.yearId,
              termId:row.termId,sectionId:row.sectionId,subjectId:row.subjectId,
              status:"active",revision:1,createdByUid:ctx.uid,createdAt:now});
            createdCourses++;
          }
        });

        tx.update(registrationRef,{status:"ended",endedByUid:ctx.uid,endedAt:now,
          endReason:reason,endReasonType:"section_change",replacedByRegistrationId:newRegistrationId,
          updatedByUid:ctx.uid,updatedAt:now,revision:actualRevision+1});

        const targetGradeValue=String(targetSection.data().gradeLevel||data.gradeLevel||"").trim().toLowerCase();
        const newRegistrationData={
          schoolId:ctx.schoolId,personId,displayName:data.displayName||person.data().displayName||"Student",
          studentNumber:data.studentNumber||person.data().studentNumber||null,birthDate:data.birthDate||person.data().birthDate||null,
          guardianName:data.guardianName||person.data().primaryGuardianName||null,
          guardianRelationship:data.guardianRelationship||person.data().primaryGuardianRelationship||null,
          guardianEmail:data.guardianEmail||person.data().primaryGuardianEmail||null,
          guardianMobile:data.guardianMobile||person.data().primaryGuardianMobile||null,
          studentEmailType:data.studentEmailType||person.data().studentEmailType||null,
          studentEmailRequired:data.studentEmailRequired===true,
          accountResponsibility:data.accountResponsibility||person.data().accountResponsibility||"student",
          yearId,programId,termId,sectionId,gradeLevel:targetGradeValue,status:"active",
          courseCount:targetOfferings.length,accountLinked:Boolean(data.accountLinked||person.data().authUid),
          source:data.source||"onsite",applicationId:data.applicationId||null,
          previousRegistrationId:registrationId,placementChangeReason:reason,
          revision:1,createdByUid:ctx.uid,createdAt:now,updatedByUid:ctx.uid,updatedAt:now
        };
        tx.create(newRegistrationRef,newRegistrationData);
        const placementData={schoolId:ctx.schoolId,personId,yearId,programId,termId,sectionId,
          registrationId:newRegistrationId,status:"active",updatedByUid:ctx.uid,updatedAt:now};
        if(slot.exists)
          tx.set(slotRef,{...placementData,revision:(Number(slot.data().revision)||1)+1},{merge:true});
        else
          tx.create(slotRef,{...placementData,revision:1,createdByUid:ctx.uid,createdAt:now});
        if(application){
          tx.update(applicationRef,{registrationId:newRegistrationId,
            previousRegistrationId:registrationId,officialProgramId:programId,
            officialTermId:termId,officialSectionId:sectionId,
            placementChangedByUid:ctx.uid,placementChangedAt:now,updatedAt:now,
            revision:(Number(application.data().revision)||1)+1});
        }

        tx.create(auditRef,{schoolId:ctx.schoolId,actorUid:ctx.uid,personId,
          registrationId:newRegistrationId,previousRegistrationId:registrationId,
          action:"student_registration_section_changed",yearId,programId,termId,
          fromSectionId:data.sectionId,toSectionId:sectionId,endedCourses,
          courseCount:targetOfferings.length,createdCourses,adoptedCourses,reason,createdAt:now});
        result={registrationId:newRegistrationId,previousRegistrationId:registrationId,
          sectionId,courseCount:targetOfferings.length,endedCourses,createdCourses,adoptedCourses};
      });
      return result;
    }

    if(input.action==="register_student"){
      const displayName=text(input.displayName,"Student name",140);
      const birthDate=academicDate(input.birthDate,"Birth date");
      const guardianName=text(input.guardianName,"Parent/guardian name",140);
      const guardianRelationship=text(input.guardianRelationship,"Parent/guardian relationship",60);
      const guardianEmail=normalizedEmail(input.guardianEmail,"Parent/guardian email",true);
      const guardianMobile=optionalText(input.guardianMobile,40);
      const studentNumber=optionalText(input.studentNumber,80);
      const yearId=checkId(input.yearId,"Academic year");
      const programId=checkId(input.programId,"Program");
      const termId=checkId(input.termId,"Academic period");
      const sectionId=checkId(input.sectionId,"Section");
      const applicationId=input.applicationId?checkId(input.applicationId,"Application ID",128):null;
      const explicitPersonId=input.personId?checkId(input.personId,"Person ID",128):null;
      const applicationRef=applicationId?db.doc(root+"enrollment_applications/"+applicationId):null;

      const [year,program,term,section,offeringSnap,application]=await Promise.all([
        db.doc(root+"academic_years/"+yearId).get(),
        db.doc(root+"academic_programs/"+programId).get(),
        db.doc(root+"terms/"+termId).get(),
        db.doc(root+"sections/"+sectionId).get(),
        db.collection(root+"course_offerings").limit(250).get(),
        applicationRef?applicationRef.get():Promise.resolve(null)
      ]);
      for(const [record,label] of [[year,"academic year"],[program,"program"],[term,"academic period"],[section,"section"]]){
        if(!record.exists||record.data().schoolId!==ctx.schoolId||record.data().status!=="active")
          deny("failed-precondition","The selected "+label+" is not active in this school.");
      }
      if(term.data().yearId!==yearId||term.data().programId!==programId)
        deny("failed-precondition","The academic period does not belong to the selected school year and program.");
      if(section.data().programId!==programId)
        deny("failed-precondition","The section does not belong to the selected program.");
      if(applicationRef&&(!application?.exists||application.data().schoolId!==ctx.schoolId))
        deny("failed-precondition","The selected online application is no longer available.");

      const gradeLevel=String(section.data().gradeLevel||"").trim().toLowerCase();
      const studentEmailRequired=gradeRequiresStudentEmail(gradeLevel);
      const rawStudentEmail=typeof input.studentEmail==="string"?input.studentEmail.trim():"";
      const studentEmail=rawStudentEmail?normalizedEmail(rawStudentEmail,"Student email",true):null;
      const studentEmailType=studentEmail?String(input.studentEmailType||"").trim().toLowerCase():null;
      if(studentEmailRequired&&!studentEmail)
        deny("invalid-argument","A student email is required for Grade 7 and above.");
      if(!studentEmailRequired&&studentEmail)
        deny("invalid-argument","Student email is not collected below Grade 7. Use the parent/guardian email.");
      if(studentEmail&&!EMAIL_TYPES.has(studentEmailType))
        deny("invalid-argument","Choose whether the student email is personal or institutional.");
      if(studentEmail&&studentEmail===guardianEmail)
        deny("invalid-argument","Student and parent/guardian email must be different.");

      if(application?.exists){
        const app=application.data();
        if(["rejected","withdrawn","enrolled"].includes(app.status))
          deny("failed-precondition","This online application already has a final decision.");
        if(app.yearId&&app.yearId!==yearId)
          deny("failed-precondition","The online application belongs to another school year.");
      }

      const offerings=offeringSnap.docs.filter(doc=>{
        const row=doc.data();
        return row.schoolId===ctx.schoolId&&row.status==="active"&&
          row.yearId===yearId&&row.programId===programId&&row.termId===termId&&row.sectionId===sectionId&&
          row.rosterMode!=="selective";
      });

      const activationEmailHash=studentEmail?rosterEmailHash(studentEmail):null;
      const lookups=[];
      if(activationEmailHash)
        lookups.push(db.collection(root+"people").where("activationEmailHash","==",activationEmailHash).limit(3).get());
      else lookups.push(Promise.resolve({docs:[]}));
      if(studentNumber)
        lookups.push(db.collection(root+"people").where("studentNumber","==",studentNumber).limit(3).get());
      else lookups.push(Promise.resolve({docs:[]}));
      const [emailMatches,numberMatches]=await Promise.all(lookups);
      const activeEmailMatches=emailMatches.docs.filter(doc=>{
        const row=doc.data();return row.schoolId===ctx.schoolId&&row.kind==="student"&&row.status==="active";
      });
      const activeNumberMatches=numberMatches.docs.filter(doc=>{
        const row=doc.data();return row.schoolId===ctx.schoolId&&row.kind==="student"&&row.status==="active";
      });
      if(activeEmailMatches.length>1||activeNumberMatches.length>1)
        deny("failed-precondition","Duplicate student identity records require People & Access review before enrollment.");

      const candidateIds=new Set();
      if(explicitPersonId)candidateIds.add(explicitPersonId);
      if(application?.exists&&application.data().personId)candidateIds.add(String(application.data().personId));
      if(activeEmailMatches[0])candidateIds.add(activeEmailMatches[0].id);
      if(activeNumberMatches[0])candidateIds.add(activeNumberMatches[0].id);
      if(candidateIds.size>1)
        deny("failed-precondition","The selected directory student, student email/number and online application point to different records. Resolve the identity before enrolling.");

      let personRef;
      const candidateId=[...candidateIds][0];
      if(candidateId)personRef=db.doc(root+"people/"+checkId(candidateId,"Person ID",128));
      else if(studentEmail){
        const legacyImported=await db.doc(root+"people/"+legacyImportPersonId(studentEmail)).get();
        personRef=legacyImported.exists&&legacyImported.data().schoolId===ctx.schoolId&&
          legacyImported.data().kind==="student"&&legacyImported.data().status==="active"
          ?legacyImported.ref
          :db.doc(root+"people/reg_"+activationEmailHash.slice(0,40));
      }else personRef=db.doc(root+"people/"+guardianPersonId({displayName,birthDate,guardianEmail}));

      const personId=personRef.id;
      const registrationId=key(personId,yearId,termId,sectionId);
      const registrationRef=db.doc(root+"student_registrations/"+registrationId);
      const placementSlotRef=db.doc(root+"student_registration_slots/"+key(personId,yearId,termId));
      const existingRegistrations=await db.collection(root+"student_registrations")
        .where("personId","==",personId).limit(51).get();
      if(existingRegistrations.size===51)
        deny("resource-exhausted","This student has too many registration records for safe placement.");
      const conflictingRegistration=existingRegistrations.docs.find(doc=>{
        const row=doc.data();
        return doc.id!==registrationId&&row.schoolId===ctx.schoolId&&row.status==="active"&&
          row.yearId===yearId&&row.termId===termId;
      });
      if(conflictingRegistration)
        deny("failed-precondition",
          "This student already has an active official section placement for the selected academic period. End or correct that registration before creating another.");
      const enrollmentRefs=offerings.map(offering=>
        db.doc(root+"enrollments/"+key(personId,offering.id)));
      const auditRef=db.collection(root+"directory_audit").doc();
      const source=applicationId?"online":"onsite";
      const accountResponsibility=studentEmailRequired?"student":"guardian";

      let result;
      await db.runTransaction(async tx=>{
        await requireCurrentAdmin(tx);
        const reads=[tx.get(personRef),tx.get(registrationRef),tx.get(placementSlotRef),...enrollmentRefs.map(ref=>tx.get(ref))];
        if(applicationRef)reads.push(tx.get(applicationRef));
        const records=await Promise.all(reads);
        const person=records[0],registration=records[1],placementSlot=records[2],
          enrollments=records.slice(3,3+enrollmentRefs.length),
          currentApplication=applicationRef?records.at(-1):null;
        if(placementSlot.exists&&placementSlot.data().status==="active"&&
           placementSlot.data().registrationId!==registrationId)
          deny("failed-precondition",
            "Another official registration currently owns this student's selected academic period.");

        if(currentApplication&&(!currentApplication.exists||currentApplication.data().schoolId!==ctx.schoolId||
          ["rejected","withdrawn","enrolled"].includes(currentApplication.data().status)))
          deny("failed-precondition","The online application changed before enrollment. Refresh and review it again.");

        if(person.exists){
          const row=person.data();
          if(row.schoolId!==ctx.schoolId||row.kind!=="student"||row.status!=="active")
            deny("failed-precondition","The matching person record cannot be used for student enrollment.");
          if(row.activationEmailHash&&activationEmailHash&&row.activationEmailHash!==activationEmailHash)
            deny("failed-precondition","The matching student record has a different sign-in identity.");
          const update={
            displayName,searchKey:displayName.toLocaleLowerCase("en")+"#"+personId,
            studentNumber:studentNumber||row.studentNumber||null,birthDate,
            primaryGuardianName:guardianName,primaryGuardianRelationship:guardianRelationship,
            primaryGuardianEmail:guardianEmail,primaryGuardianMobile:guardianMobile,
            accountResponsibility,updatedAt:FieldValue.serverTimestamp(),updatedByUid:ctx.uid,
            revision:(row.revision||0)+1
          };
          if(activationEmailHash)Object.assign(update,{activationEmailHash,studentEmailType});
          tx.update(personRef,update);
        }else{
          const now=FieldValue.serverTimestamp();
          tx.create(personRef,{
            schoolId:ctx.schoolId,displayName,
            searchKey:displayName.toLocaleLowerCase("en")+"#"+personId,
            kind:"student",status:"active",authUid:null,
            ...(activationEmailHash?{activationEmailHash,studentEmailType}:{}),
            studentNumber,birthDate,
            primaryGuardianName:guardianName,primaryGuardianRelationship:guardianRelationship,
            primaryGuardianEmail:guardianEmail,primaryGuardianMobile:guardianMobile,
            accountResponsibility,createdByUid:ctx.uid,createdAt:now,updatedAt:now,revision:1
          });
        }

        const priorRegistration=registration.exists?registration.data():null;
        if(priorRegistration&&priorRegistration.schoolId!==ctx.schoolId)
          deny("failed-precondition","Enrollment record collision requires review.");
        if(priorRegistration&&priorRegistration.status!=="active")
          deny("failed-precondition","A previous enrollment exists for this period. Restore or review it instead of silently recreating it.");

        const ended=enrollments.filter(doc=>doc.exists&&doc.data().status!=="active");
        if(ended.length)
          deny("failed-precondition",
            "One or more subject enrollments were previously ended. Review that history before re-enrolling the student.");

        const now=FieldValue.serverTimestamp();
        let createdCourses=0,activeCourses=0;
        offerings.forEach((offering,index)=>{
          const prior=enrollments[index];
          if(prior.exists){
            if(prior.data().schoolId!==ctx.schoolId||prior.data().personId!==personId||
               prior.data().offeringId!==offering.id)
              deny("failed-precondition","A course enrollment key collision requires review.");
            if(prior.data().registrationId&&prior.data().registrationId!==registrationId)
              deny("failed-precondition","This active subject enrollment belongs to another official registration.");
            if(!prior.data().registrationId)
              tx.update(prior.ref,{registrationId,placementAdoptedByUid:ctx.uid,
                placementAdoptedAt:now,revision:(Number(prior.data().revision)||1)+1});
            activeCourses++;return;
          }
          createdCourses++;activeCourses++;
          const row=offering.data();
          tx.create(enrollmentRefs[index],{
            schoolId:ctx.schoolId,personId,offeringId:offering.id,registrationId,
            programId:row.programId,yearId:row.yearId,termId:row.termId,
            sectionId:row.sectionId,subjectId:row.subjectId,
            status:"active",revision:1,createdByUid:ctx.uid,createdAt:now
          });
        });

        const accountLinked=person.exists&&Boolean(person.data().authUid);
        const registrationData={
          schoolId:ctx.schoolId,personId,displayName,studentNumber,birthDate,
          guardianName,guardianRelationship,guardianEmail,guardianMobile,
          studentEmailType,studentEmailRequired,accountResponsibility,
          yearId,programId,termId,sectionId,gradeLevel,status:"active",
          courseCount:activeCourses,accountLinked,source,applicationId,
          updatedByUid:ctx.uid,updatedAt:now
        };
        if(registration.exists)
          tx.set(registrationRef,{...registrationData,
            revision:(priorRegistration.revision||0)+1},{merge:true});
        else
          tx.create(registrationRef,{...registrationData,revision:1,
            createdByUid:ctx.uid,createdAt:now});
        const placementData={schoolId:ctx.schoolId,personId,yearId,programId,termId,sectionId,
          registrationId,status:"active",updatedByUid:ctx.uid,updatedAt:now};
        if(placementSlot.exists)
          tx.set(placementSlotRef,{...placementData,revision:(placementSlot.data().revision||1)+1},{merge:true});
        else
          tx.create(placementSlotRef,{...placementData,revision:1,createdByUid:ctx.uid,createdAt:now});

        if(currentApplication){
          tx.update(applicationRef,{
            status:"enrolled",personId,registrationId,officialProgramId:programId,
            officialTermId:termId,officialSectionId:sectionId,
            enrolledByUid:ctx.uid,enrolledAt:now,updatedAt:now,
            revision:(Number(currentApplication.data().revision)||1)+1
          });
        }

        tx.create(auditRef,{
          schoolId:ctx.schoolId,actorUid:ctx.uid,personId,registrationId,
          applicationId,source,action:"student_registered_and_enrolled",
          yearId,programId,termId,sectionId,gradeLevel,courseCount:activeCourses,
          createdCourses,createdAt:now
        });
        result={registrationId,personId,displayName,gradeLevel,studentEmailRequired,
          accountResponsibility,courseCount:activeCourses,createdCourses,accountLinked,source,
          reusedDirectoryPerson:Boolean(explicitPersonId)};
      });
      return result;
    }

    deny("invalid-argument","Unknown enrollment operation.");
  };
}

module.exports={
  createSchoolEnrollmentService,
  standardSchool,
  gradeRequiresStudentEmail,
  registrationOwnsEnrollment
};