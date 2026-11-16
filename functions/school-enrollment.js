"use strict";
/**
 * Standard student enrollment / registration service.
 *
 * Phase 1 is intentionally School Administrator operated. The records and
 * actions are school-scoped so a future Registrar role can assume this module
 * without changing the student identity or academic enrollment model.
 *
 * This service is enabled only for Manila Cathedral School standard v4
 * provisioning. It does not touch the legacy-compatible mcs-manila pilot.
 */
const {FieldValue}=require("firebase-admin/firestore");
const {createHash}=require("node:crypto");
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");
const {rosterEmailHash,normalizedRosterEmail}=require("./school-roster-identity.js");

const STANDARD_MCS_SCHOOL_ID="manila-cathedral-school";

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
function key(...parts){
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}
function legacyImportPersonId(email){
  const identity=createHash("sha256").update("student\0email:"+email).digest("hex");
  return "imp_"+identity.slice(0,40);
}
function standardSchool(data){
  return data?.compatibilityMode==="v4_only" &&
    (data?.provisioningMode||"standard")==="standard";
}

function createSchoolEnrollmentService({db}){
  return async request=>{
    const input=request.data||{};
    const ctx=await getSchoolContext({
      db,request,schoolId:input.schoolId,roles:["school_admin"],allowDraftAdmin:true
    });
    if(ctx.schoolId!==STANDARD_MCS_SCHOOL_ID)
      deny("failed-precondition",
        "This Enrollment workspace is currently enabled only for Manila Cathedral School standard onboarding.");

    const root="schools/"+ctx.schoolId+"/";
    const schoolRef=db.doc("platform_schools/"+ctx.schoolId);
    const adminRef=db.doc(root+"memberships/"+ctx.uid);
    const school=await schoolRef.get();
    if(!school.exists||!["draft","pilot","active"].includes(school.data().state)||!standardSchool(school.data()))
      deny("failed-precondition",
        "Enrollment requires the Manila Cathedral School standard v4 tenant. The legacy-compatible pilot is unchanged.");

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
      const names=["academic_years","academic_programs","terms","sections","course_offerings"];
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
        offerings:by.course_offerings.map(row=>({
          offeringId:row.id,programId:row.programId,yearId:row.yearId,
          termId:row.termId,sectionId:row.sectionId,subjectId:row.subjectId
        }))
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
        courseCount:Number(doc.data().courseCount)||0,
        accountLinked:Boolean(doc.data().accountLinked)
      }))};
    }

    if(input.action==="register_student"){
      const displayName=text(input.displayName,"Student name",140);
      const email=normalizedRosterEmail(input.activationEmail);
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        deny("invalid-argument","Enter the verified email the student will use to sign in.");
      const studentNumber=optionalText(input.studentNumber,80);
      const yearId=checkId(input.yearId,"Academic year");
      const programId=checkId(input.programId,"Program");
      const termId=checkId(input.termId,"Academic period");
      const sectionId=checkId(input.sectionId,"Section");
      const activationEmailHash=rosterEmailHash(email);

      const [year,program,term,section,offeringSnap,emailMatches,legacyImported]=await Promise.all([
        db.doc(root+"academic_years/"+yearId).get(),
        db.doc(root+"academic_programs/"+programId).get(),
        db.doc(root+"terms/"+termId).get(),
        db.doc(root+"sections/"+sectionId).get(),
        db.collection(root+"course_offerings").limit(250).get(),
        db.collection(root+"people").where("activationEmailHash","==",activationEmailHash).limit(3).get(),
        db.doc(root+"people/"+legacyImportPersonId(email)).get()
      ]);
      for(const [record,label] of [[year,"academic year"],[program,"program"],[term,"academic period"],[section,"section"]]){
        if(!record.exists||record.data().schoolId!==ctx.schoolId||record.data().status!=="active")
          deny("failed-precondition","The selected "+label+" is not active in this school.");
      }
      if(term.data().yearId!==yearId||term.data().programId!==programId)
        deny("failed-precondition","The academic period does not belong to the selected school year and program.");
      if(section.data().programId!==programId)
        deny("failed-precondition","The section does not belong to the selected program.");

      const offerings=offeringSnap.docs.filter(doc=>{
        const row=doc.data();
        return row.schoolId===ctx.schoolId&&row.status==="active"&&
          row.yearId===yearId&&row.programId===programId&&row.termId===termId&&row.sectionId===sectionId;
      });
      if(!offerings.length)
        deny("failed-precondition",
          "This section has no active course offerings for the selected period. Configure the section subjects first.");

      const matched=emailMatches.docs.filter(doc=>{
        const row=doc.data();
        return row.schoolId===ctx.schoolId&&row.kind==="student"&&row.status==="active";
      });
      if(matched.length>1)
        deny("failed-precondition","More than one active student record uses this activation identity. Resolve the duplicate in People & Access.");

      let personRef;
      if(matched.length===1)personRef=matched[0].ref;
      else if(legacyImported.exists&&legacyImported.data().schoolId===ctx.schoolId&&
        legacyImported.data().kind==="student"&&legacyImported.data().status==="active")
        personRef=legacyImported.ref;
      else personRef=db.doc(root+"people/reg_"+activationEmailHash.slice(0,40));

      const personId=personRef.id;
      const registrationId=key(personId,yearId,termId,sectionId);
      const registrationRef=db.doc(root+"student_registrations/"+registrationId);
      const enrollmentRefs=offerings.map(offering=>
        db.doc(root+"enrollments/"+key(personId,offering.id)));
      const auditRef=db.collection(root+"directory_audit").doc();

      let result;
      await db.runTransaction(async tx=>{
        await requireCurrentAdmin(tx);
        const [person,registration,...enrollments]=await Promise.all([
          tx.get(personRef),tx.get(registrationRef),...enrollmentRefs.map(ref=>tx.get(ref))
        ]);
        if(person.exists){
          const row=person.data();
          if(row.schoolId!==ctx.schoolId||row.kind!=="student"||row.status!=="active")
            deny("failed-precondition","The matching person record cannot be used for student enrollment.");
          if(row.activationEmailHash&&row.activationEmailHash!==activationEmailHash)
            deny("failed-precondition","The matching student record has a different activation identity.");
          if(row.authUid&&registration.exists&&registration.data().personId!==personId)
            deny("failed-precondition","The student identity is linked to another enrollment record.");
          tx.update(personRef,{
            displayName,searchKey:displayName.toLocaleLowerCase("en")+"#"+personId,
            activationEmailHash,studentNumber:studentNumber||row.studentNumber||null,
            updatedAt:FieldValue.serverTimestamp(),updatedByUid:ctx.uid,
            revision:(row.revision||0)+1
          });
        }else{
          const now=FieldValue.serverTimestamp();
          tx.create(personRef,{
            schoolId:ctx.schoolId,displayName,
            searchKey:displayName.toLocaleLowerCase("en")+"#"+personId,
            kind:"student",status:"active",authUid:null,
            activationEmailHash,studentNumber,
            createdByUid:ctx.uid,createdAt:now,updatedAt:now,revision:1
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
            activeCourses++;return;
          }
          createdCourses++;activeCourses++;
          const row=offering.data();
          tx.create(enrollmentRefs[index],{
            schoolId:ctx.schoolId,personId,offeringId:offering.id,
            programId:row.programId,yearId:row.yearId,termId:row.termId,
            sectionId:row.sectionId,subjectId:row.subjectId,
            status:"active",revision:1,createdByUid:ctx.uid,createdAt:now
          });
        });

        const registrationData={
          schoolId:ctx.schoolId,personId,displayName,studentNumber,
          yearId,programId,termId,sectionId,status:"active",
          courseCount:activeCourses,accountLinked:Boolean(person.data()?.authUid),
          updatedByUid:ctx.uid,updatedAt:now
        };
        if(registration.exists)
          tx.set(registrationRef,{...registrationData,
            revision:(priorRegistration.revision||0)+1},{merge:true});
        else
          tx.create(registrationRef,{...registrationData,revision:1,
            createdByUid:ctx.uid,createdAt:now});

        tx.create(auditRef,{
          schoolId:ctx.schoolId,actorUid:ctx.uid,personId,registrationId,
          action:"student_registered_and_enrolled",yearId,programId,termId,sectionId,
          courseCount:activeCourses,createdCourses,createdAt:now
        });
        result={registrationId,personId,displayName,courseCount:activeCourses,
          createdCourses,accountLinked:Boolean(person.data()?.authUid)};
      });
      return result;
    }

    deny("invalid-argument","Unknown enrollment operation.");
  };
}

module.exports={createSchoolEnrollmentService,STANDARD_MCS_SCHOOL_ID,standardSchool};
