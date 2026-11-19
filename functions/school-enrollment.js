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

const STANDARD_MCS_SCHOOL_ID="manila-cathedral-school";
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
function legacyImportPersonId(email){
  const identity=createHash("sha256").update("student\0email:"+email).digest("hex");
  return "imp_"+identity.slice(0,40);
}
function standardSchool(data){
  return data?.compatibilityMode==="v4_only" &&
    (data?.provisioningMode||"standard")==="standard";
}
function publicReference(applicationId){
  return "MCS-"+String(applicationId||"").slice(0,10).toUpperCase();
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
          termId:row.termId,sectionId:row.sectionId,subjectId:row.subjectId
        }))
      };
    }

    if(input.action==="list_applications"){
      const snap=await db.collection(root+"enrollment_applications").limit(201).get();
      if(snap.size===201)deny("resource-exhausted","Enrollment application queue requires pagination.");
      const items=snap.docs.filter(doc=>doc.data().schoolId===ctx.schoolId).map(doc=>({
        applicationId:doc.id,reference:publicReference(doc.id),
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
        source:doc.data().source||"onsite"
      }))};
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
          row.yearId===yearId&&row.programId===programId&&row.termId===termId&&row.sectionId===sectionId;
      });
      if(!offerings.length)
        deny("failed-precondition",
          "This section has no active course offerings for the selected period. Configure the section subjects first.");

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
      if(application?.exists&&application.data().personId)candidateIds.add(String(application.data().personId));
      if(activeEmailMatches[0])candidateIds.add(activeEmailMatches[0].id);
      if(activeNumberMatches[0])candidateIds.add(activeNumberMatches[0].id);
      if(candidateIds.size>1)
        deny("failed-precondition","Student email, number and application point to different records. Resolve the identity before enrolling.");

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
      const enrollmentRefs=offerings.map(offering=>
        db.doc(root+"enrollments/"+key(personId,offering.id)));
      const auditRef=db.collection(root+"directory_audit").doc();
      const source=applicationId?"online":"onsite";
      const accountResponsibility=studentEmailRequired?"student":"guardian";

      let result;
      await db.runTransaction(async tx=>{
        await requireCurrentAdmin(tx);
        const reads=[tx.get(personRef),tx.get(registrationRef),...enrollmentRefs.map(ref=>tx.get(ref))];
        if(applicationRef)reads.push(tx.get(applicationRef));
        const records=await Promise.all(reads);
        const person=records[0],registration=records[1],
          enrollments=records.slice(2,2+enrollmentRefs.length),
          currentApplication=applicationRef?records.at(-1):null;

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
          accountResponsibility,courseCount:activeCourses,createdCourses,accountLinked,source};
      });
      return result;
    }

    deny("invalid-argument","Unknown enrollment operation.");
  };
}

module.exports={
  createSchoolEnrollmentService,
  STANDARD_MCS_SCHOOL_ID,
  standardSchool,
  gradeRequiresStudentEmail
};