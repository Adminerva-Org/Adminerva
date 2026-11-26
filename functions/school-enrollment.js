"use strict";
/**
 * School-scoped Enrollment & Registration.
 *
 * School Admin operates this during the current phase; the record model is
 * intentionally registrar-ready. Online applicants and onsite/manual entries
 * converge here before official student/person/class records are created.
 */
const {FieldValue,FieldPath}=require("firebase-admin/firestore");
const {createHash}=require("node:crypto");
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");
const {ACTIONS:ADMISSION_DOCUMENT_ACTIONS,admissionDocumentAction}=require("./school-admission-documents.js");
const {rosterEmailHash,normalizedRosterEmail}=require("./school-roster-identity.js");
const {guardianContactIdForEmail,guardianRelationshipId}=require("./school-guardian-identity.js");

const EMAIL_TYPES=new Set(["personal","institutional"]);
const APPLICATION_REVIEW_TRANSITIONS={
  submitted:new Set(["needs_information","accepted","rejected"]),
  needs_information:new Set(["submitted","accepted","rejected"]),
  accepted:new Set(["needs_information","rejected"]),
  rejected:new Set(),
  withdrawn:new Set(),
  enrolled:new Set()
};
function canReviewApplication(from,to){
  return Object.hasOwn(APPLICATION_REVIEW_TRANSITIONS,from)&&APPLICATION_REVIEW_TRANSITIONS[from].has(to);
}
const REQUIREMENT_STATES=new Set(["missing","received","verified"]);
const ADMISSION_TYPES=["new","returning","transferee"];
function admissionType(value){
  if(!ADMISSION_TYPES.includes(value))deny("invalid-argument","Choose a valid applicant type.");
  return value;
}
function normalizeRequirementTemplate(value){
  if(!Array.isArray(value)||value.length>24)deny("invalid-argument","Enter up to 24 required document names.");
  const seen=new Set();
  return value.map(raw=>{
    const label=text(raw,"Requirement name",100),key=label.toLocaleLowerCase("en");
    if(seen.has(key))deny("invalid-argument","Requirement names must be unique.");
    seen.add(key);return label;
  });
}
function templateCovered(rows,labels){
  if(!Array.isArray(rows)||!Array.isArray(labels))return false;
  const names=new Set(rows.map(row=>String(row?.label||"").trim().toLocaleLowerCase("en")));
  return labels.every(label=>names.has(label.toLocaleLowerCase("en")));
}
function pendingRequirementsReady(row,template){
  return admissionRequirementsReady(row)&&Number(row.requirementsTemplateRevision||0)===template.revision&&
    templateCovered(row.requirements,template.labels);
}
function normalizeAdmissionRequirements(value,noRequirements){
  if(!Array.isArray(value)||value.length>24)
    deny("invalid-argument","Enter up to 24 admission requirements.");
  if(typeof noRequirements!=="boolean"||(!value.length&&!noRequirements)||(value.length&&noRequirements))
    deny("invalid-argument","List the applicable requirements or explicitly confirm none apply.");
  const seen=new Set();
  return value.map(item=>{
    const label=text(item?.label,"Requirement name",100),state=item?.status;
    const normalized=label.toLocaleLowerCase("en");
    if(seen.has(normalized)||!REQUIREMENT_STATES.has(state))
      deny("invalid-argument","Requirements must have unique names and valid statuses.");
    seen.add(normalized);return {label,status:state};
  });
}
function admissionRequirementsReady(row){
  if(row?.requirementsReviewed!==true||!Array.isArray(row.requirements)||
    (row.admissionDocuments||[]).some(item=>item.state==="pending"))return false;
  if(!row.requirements.length)return row.noRequirements===true;
  return row.noRequirements===false&&row.requirements.length<=24&&
    row.requirements.every(item=>typeof item?.label==="string"&&item.label.trim()&&item.status==="verified");
}
function isReviewedApplicationRevision(row,revision){
  return row?.status==="accepted"&&admissionRequirementsReady(row)&&Number.isSafeInteger(revision)&&revision>=1&&
    (Number(row.revision)||1)===revision;
}
const REGISTRATION_END_TYPES=new Set(["withdrawal","transfer_out","registration_cancelled","other"]);
const PROGRESSION_TYPES=new Set(["promotion","retention","graduation"]);

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
function millis(value){
  if(!value)return null;
  if(typeof value.toMillis==="function")return value.toMillis();
  const numeric=Number(value);
  return Number.isFinite(numeric)?numeric:null;
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
function progressionGradeValid(type,sourceLevel,targetLevel){
  const source=String(sourceLevel||"").trim().toLowerCase(),
    target=String(targetLevel||"").trim().toLowerCase();
  if(type==="graduation")return true;
  if(!source||!target)return false;
  if(type==="retention")return source===target;
  if(type!=="promotion"||source===target)return false;
  if(/^\d+$/.test(source)&&/^\d+$/.test(target))
    return Number(target)===Number(source)+1;
  return true;
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
function admissionApplicationId({schoolId,yearId,displayName,birthDate,guardianEmail}){
  // Retain the public intake key so an identical walk-in and online submission converge.
  return createHash("sha256").update([schoolId,yearId,displayName.toLowerCase(),birthDate,guardianEmail].join("\0")).digest("hex").slice(0,48);
}
function acceptedIdentityMatches(app,details){
  return ["displayName","birthDate","guardianName","guardianRelationship","guardianEmail","guardianMobile","studentEmail","studentEmailType"]
    .every(field=>String(app[field]||"").trim()===String(details[field]||"").trim())&&
    (!app.studentNumber||app.studentNumber===details.studentNumber)&&
    (!app.personId||app.personId===details.personId);
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
      db,request,schoolId:input.schoolId,roles:["school_admin","registrar"],allowDraftAdmin:true
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
         !Array.isArray(member.data().roles)||
         !member.data().roles.some(role=>["school_admin","registrar"].includes(role)))
        deny("permission-denied","School enrollment authority changed. Refresh before saving.");
    }

    if(ADMISSION_DOCUMENT_ACTIONS.has(input.action))return admissionDocumentAction({db,ctx,input});
    if(ctx.platformOverride&&["register_student","bind_returning_application","correct_application"].includes(input.action)&&String(input.platformMode||"").toLowerCase()!=="assist")
      deny("failed-precondition","System Admin preview is read-only. Choose Assist school for audited changes.");
    const templateRef=type=>db.doc(root+"configuration/admission_requirements_"+admissionType(type));
    function readTemplate(doc,type){
      if(!doc.exists)return {type,revision:0,labels:[]};
      const row=doc.data();
      if(row.schoolId!==ctx.schoolId||row.type!==type||!Number.isSafeInteger(row.revision)||row.revision<1)
        deny("failed-precondition","Admission requirements configuration needs administrator review.");
      return {type,revision:row.revision,labels:normalizeRequirementTemplate(row.labels)};
    }
    async function requireTemplateAdmin(tx){
      // A platform-wide grant is not a school membership for institutional policy changes.
      const [currentSchool,member]=await Promise.all([tx.get(schoolRef),tx.get(adminRef)]);
      if(!currentSchool.exists||!["draft","pilot","active"].includes(currentSchool.data().state)||
         !standardSchool(currentSchool.data())||!member.exists||member.data().schoolId!==ctx.schoolId||
         member.data().status!=="active"||!Array.isArray(member.data().roles)||
         !member.data().roles.includes("school_admin"))
        deny("permission-denied","A verified School Administrator membership is required to change admission templates.");
    }

    if(input.action==="get_admission_templates"){
      const docs=await Promise.all(ADMISSION_TYPES.map(type=>templateRef(type).get()));
      return {templates:ADMISSION_TYPES.map((type,index)=>readTemplate(docs[index],type))};
    }
    if(input.action==="save_admission_template"){
      const type=admissionType(input.type),labels=normalizeRequirementTemplate(input.labels),
        expectedRevision=input.expectedRevision,reason=text(input.reason,"Change reason",500);
      if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||reason.length<8)
        deny("invalid-argument","Review the template revision and record a change reason.");
      const ref=templateRef(type),auditRef=db.collection(root+"directory_audit").doc();
      await db.runTransaction(async tx=>{
        await requireTemplateAdmin(tx);
        const current=await tx.get(ref),previous=readTemplate(current,type);
        if(previous.revision!==expectedRevision)
          deny("failed-precondition","The admission template changed. Refresh before saving.");
        const revision=previous.revision+1,now=FieldValue.serverTimestamp();
        const payload={schoolId:ctx.schoolId,type,labels,revision,updatedByUid:ctx.uid,updatedAt:now};
        if(current.exists)tx.update(ref,payload);else tx.create(ref,{...payload,createdAt:now,createdByUid:ctx.uid});
        tx.create(auditRef,{schoolId:ctx.schoolId,actorUid:ctx.uid,action:"admission_template_saved",
          applicationType:type,previousLabels:previous.labels,labels,reason,revision,createdAt:now});
      });
      return {type,labels,revision:expectedRevision+1};
    }

    async function reviewProgression(raw,tx=null){
      const read=ref=>tx?tx.get(ref):ref.get(),
        registrationId=checkId(raw.registrationId,"Registration ID",128),
        expectedRevision=Number(raw.expectedRevision),
        progressionType=String(raw.progressionType||"").trim().toLowerCase();
      if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)
        deny("invalid-argument","Refresh this registration before reviewing progression.");
      if(!PROGRESSION_TYPES.has(progressionType))
        deny("invalid-argument","Choose promotion, retention or graduation.");
      const registrationRef=db.doc(root+"student_registrations/"+registrationId),
        registration=await read(registrationRef);
      if(!registration.exists||registration.data().schoolId!==ctx.schoolId)
        deny("not-found","The student registration was not found.");
      const source=registration.data(),sourceRevision=Number(source.revision)||1;
      if(sourceRevision!==expectedRevision)
        deny("failed-precondition","This registration changed after you opened it. Refresh before reviewing progression.");
      if(source.status!=="active")
        deny("failed-precondition","Only an active registration can be progressed.");
      const personId=checkId(source.personId,"Person ID",128),
        personRef=db.doc(root+"people/"+personId),
        enrollmentQuery=db.collection(root+"enrollments").where("personId","==",personId).where("status","==","active").limit(251),
        offeringQuery=db.collection(root+"course_offerings").where("sectionId","==",source.sectionId).where("yearId","==",source.yearId).where("termId","==",source.termId).limit(251),
        termQuery=db.collection(root+"terms").where("yearId","==",source.yearId).limit(51),
        [person,enrollmentSnap,offeringSnap,termSnap]=await Promise.all([
          read(personRef),read(enrollmentQuery),read(offeringQuery),read(termQuery)
        ]);
      if(!person.exists||person.data().schoolId!==ctx.schoolId||person.data().kind!=="student"||
         person.data().status!=="active")
        deny("failed-precondition","The student directory record must be active before progression.");
      if(enrollmentSnap.size===251||offeringSnap.size===251||termSnap.size===51)
        deny("resource-exhausted","Progression review requires pagination before this student can be processed safely.");
      const offeringMap=new Map(offeringSnap.docs.filter(doc=>doc.data().schoolId===ctx.schoolId)
        .map(doc=>[doc.id,doc])),
        sourceEnrollments=enrollmentSnap.docs.filter(doc=>{
          const row=doc.data(),offering=offeringMap.get(row.offeringId);
          return row.schoolId===ctx.schoolId&&row.personId===personId&&row.status==="active"&&
            row.yearId===source.yearId&&row.termId===source.termId&&row.sectionId===source.sectionId&&
            registrationOwnsEnrollment(registrationId,row,offering?.data());
        });
      const blockers=[],
        sourceTerms=termSnap.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&
          doc.data().status==="active"&&doc.data().programId===source.programId),
        sourceTerm=sourceTerms.find(doc=>doc.id===source.termId)||null,
        sourceSequence=Number(sourceTerm?.data().sequence)||0,
        finalSequence=sourceTerms.reduce((max,doc)=>Math.max(max,Number(doc.data().sequence)||0),0),
        sourceCourseCount=Number(source.courseCount)||0,
        misplacedOwned=enrollmentSnap.docs.filter(doc=>{
          const row=doc.data();
          return row.schoolId===ctx.schoolId&&row.personId===personId&&row.status==="active"&&
            row.registrationId===registrationId&&
            !sourceEnrollments.some(owned=>owned.id===doc.id);
        });
      if(!sourceTerm)
        blockers.push({type:"source_period_unavailable",
          message:"The registration's academic period is no longer an active configured period for its year and program."});
      else if(finalSequence>0&&sourceSequence<finalSequence)
        blockers.push({type:"source_period_not_final",
          message:"Year-end progression is available only from the last active academic period configured for this year and program."});
      if(misplacedOwned.length)
        blockers.push({type:"registration_roster_mismatch",
          message:"One or more active class enrollments owned by this registration no longer match its official placement. Reconcile the class roster before progression."});
      if(sourceEnrollments.length!==sourceCourseCount)
        blockers.push({type:"registration_course_count_mismatch",
          message:"The registration course count does not match its active official class enrollments. Refresh or reconcile the registration before progression."});
      if(!sourceEnrollments.length)
        blockers.push({type:"no_active_classes",message:"This registration has no active registration-owned classes to complete."});
      const finalizationRefs=sourceEnrollments.map(doc=>
        db.doc(root+"class_record_finalizations/"+checkId(doc.data().offeringId,"Course offering ID",330))),
        gradeRefs=sourceEnrollments.map(doc=>
        db.doc(root+"class_record_period_grades/"+key(doc.data().offeringId,personId))),
        finalizations=await Promise.all(finalizationRefs.map(read)),
        grades=await Promise.all(gradeRefs.map(read));
      const completion=sourceEnrollments.map((enrollment,index)=>{
        const offering=offeringMap.get(enrollment.data().offeringId),finalization=finalizations[index],
          grade=grades[index],releasedRevision=finalization.exists&&finalization.data().schoolId===ctx.schoolId?
            Number(finalization.data().releasedRevision)||0:0,
          gradeData=grade.exists&&grade.data().schoolId===ctx.schoolId?grade.data():null,
          ready=releasedRevision>0&&gradeData&&gradeData.status==="finalized"&&
            gradeData.personId===personId&&gradeData.offeringId===enrollment.data().offeringId&&
            Number(gradeData.finalizationRevision)===releasedRevision;
        if(!ready)blockers.push({
          type:"final_grade_not_released",offeringId:enrollment.data().offeringId,
          subjectId:offering?.data().subjectId||null,
          message:"A registration-owned class does not yet have the student's released Final Grade."
        });
        return {offeringId:enrollment.data().offeringId,subjectId:offering?.data().subjectId||null,
          releasedRevision,ready};
      });

      let admissionApplication=null,admissionRef=null;
      let target=null,targetRegistrationRef=null,targetSlotRef=null,targetOfferings=[],targetEnrollmentRefs=[],
        targetEnrollmentDocs=[],targetRegistration=null,targetSlot=null;
      if(progressionType!=="graduation"){
        const yearId=checkId(raw.targetYearId,"Target academic year"),
          programId=checkId(raw.targetProgramId,"Target program"),
          termId=checkId(raw.targetTermId,"Target academic period"),
          sectionId=checkId(raw.targetSectionId,"Target section");
        if(yearId===source.yearId)
          blockers.push({type:"target_year_not_new","message":"Promotion and retention must move into a different academic year."});
        const refs=[
          db.doc(root+"academic_years/"+yearId),db.doc(root+"academic_programs/"+programId),
          db.doc(root+"terms/"+termId),db.doc(root+"sections/"+sectionId)
        ],catalogDocs=await Promise.all(refs.map(read));
        for(const [doc,label] of catalogDocs.map((doc,index)=>[doc,["academic year","program","academic period","section"][index]]))
          if(!doc.exists||doc.data().schoolId!==ctx.schoolId||doc.data().status!=="active")
            blockers.push({type:"inactive_target",message:"The target "+label+" is unavailable or inactive."});
        const [year,program,term,section]=catalogDocs;
        if(term.exists&&(term.data().yearId!==yearId||term.data().programId!==programId))
          blockers.push({type:"target_period_mismatch",message:"The target academic period does not belong to the selected year and program."});
        if(section.exists&&section.data().programId!==programId)
          blockers.push({type:"target_section_mismatch",message:"The target section does not belong to the selected program."});
        if(year.exists){
          const sourceYear=await read(db.doc(root+"academic_years/"+checkId(source.yearId,"Source academic year")));
          const sourceStart=String(sourceYear.exists?sourceYear.data().startDate||"":""),
            targetStart=String(year.data().startDate||"");
          if(sourceStart&&targetStart&&targetStart<=sourceStart)
            blockers.push({type:"target_year_not_future",message:"Choose an academic year after the current registration year."});
        }
        const targetGrade=section.exists?section.data().gradeLevel:null,
          targetStudentEmailRequired=gradeRequiresStudentEmail(targetGrade);
        const admissions=await read(db.collection(root+"enrollment_applications").where("personId","==",personId).limit(101));
        if(admissions.size===101)deny("resource-exhausted","Returning admission history requires pagination.");
        const pending=admissions.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&doc.data().yearId===yearId&&doc.data().applicationType==="returning"&&["submitted","needs_information","accepted"].includes(doc.data().status));
        if(pending.length>1)blockers.push({type:"duplicate_returning_applications",message:"Resolve duplicate returning applications for the target year."});
        if(pending.length===1){
          const app=pending[0],data=app.data();
          if(!isReviewedApplicationRevision(data,Number(data.revision)||1))blockers.push({type:"returning_application_not_ready",message:"Complete returning admission requirements and acceptance before progression."});
          else if(String(data.incomingLevel||"")!==String(targetGrade||"")||(data.preferredProgramId&&data.preferredProgramId!==programId)||(data.preferredTermId&&data.preferredTermId!==termId)||(data.preferredSectionId&&data.preferredSectionId!==sectionId))blockers.push({type:"returning_placement_mismatch",message:"The target does not match the accepted returning application. Correct the application first."});
          else if(data.displayName!==person.data().displayName||(person.data().birthDate&&data.birthDate!==person.data().birthDate)||(data.studentNumber&&data.studentNumber!==person.data().studentNumber)||(targetStudentEmailRequired&&(!data.studentEmail||(!person.data().activationEmailHash&&!person.data().authUid)||(person.data().activationEmailHash&&person.data().activationEmailHash!==rosterEmailHash(data.studentEmail)))))blockers.push({type:"returning_identity_mismatch",message:"The accepted returning application no longer matches the existing student identity."});
          else {admissionRef=app.ref;admissionApplication={applicationId:app.id,revision:Number(data.revision)||1,reference:applicationReference(app)};}
        }
        if(!progressionGradeValid(progressionType,source.gradeLevel,targetGrade))
          blockers.push({type:"grade_progression_mismatch",message:progressionType==="retention"
            ?"Retention must keep the learner in the same grade level."
            :"Promotion must move the learner to the next numeric grade level, or to a different configured non-numeric level."});
        if(targetStudentEmailRequired&&!person.data().authUid&&!person.data().activationEmailHash)
          blockers.push({type:"student_identity_required",
            message:"The target grade requires a student sign-in identity. Prepare the student's activation email or link their verified account in People & Access before progression."});
        const targetOfferingSnap=await read(db.collection(root+"course_offerings").where("sectionId","==",sectionId).where("yearId","==",yearId).where("termId","==",termId).limit(251));
        if(targetOfferingSnap.size===251)deny("resource-exhausted","Target section offering history requires pagination.");
        targetOfferings=targetOfferingSnap.docs.filter(doc=>{
          const row=doc.data();
          return row.schoolId===ctx.schoolId&&row.status==="active"&&row.yearId===yearId&&
            row.programId===programId&&row.termId===termId&&row.sectionId===sectionId&&
            row.rosterMode!=="selective";
        });
        if(!targetOfferings.length)
          blockers.push({type:"no_target_classes",message:"The target placement has no active automatic-roster classes."});
        if(targetOfferings.length>60)
          deny("resource-exhausted","The target placement has too many automatic classes for one progression transaction.");
        const targetRegistrationId=key(personId,yearId,termId,sectionId);
        targetRegistrationRef=db.doc(root+"student_registrations/"+targetRegistrationId);
        targetSlotRef=db.doc(root+"student_registration_slots/"+key(personId,yearId,termId));
        [targetRegistration,targetSlot]=await Promise.all([read(targetRegistrationRef),read(targetSlotRef)]);
        if(targetRegistration.exists)
          blockers.push({type:"target_registration_exists",message:"This learner already has registration history for the selected target placement."});
        if(targetSlot.exists&&targetSlot.data().status==="active")
          blockers.push({type:"target_slot_occupied",message:"This learner already has an active official placement in the target academic period."});
        targetEnrollmentRefs=targetOfferings.map(doc=>db.doc(root+"enrollments/"+key(personId,doc.id)));
        targetEnrollmentDocs=await Promise.all(targetEnrollmentRefs.map(read));
        if(targetEnrollmentDocs.some(doc=>doc.exists))
          blockers.push({type:"target_enrollment_history_exists",message:"One or more target classes already contain enrollment history for this learner. Review those records before progression."});
        target={yearId,programId,termId,sectionId,gradeLevel:targetGrade,
          studentEmailRequired:targetStudentEmailRequired,
          accountResponsibility:targetStudentEmailRequired?"student":"guardian",
          courseCount:targetOfferings.length,registrationId:targetRegistrationId};
      }
      return {registrationId,registrationRef,registration,source,personId,personRef,person,progressionType,
        completion,sourceEnrollments,offeringMap,blockers,target,targetRegistrationRef,targetSlotRef,
        targetOfferings,targetEnrollmentRefs,targetEnrollmentDocs,targetRegistration,targetSlot,admissionApplication,admissionRef,
        canApply:blockers.length===0};
    }

    if(input.action==="registrar_summary"){
      const yearId=checkId(input.yearId,"Academic year"),termId=input.termId?checkId(input.termId,"Academic period"):null;
      const year=await db.doc(root+"academic_years/"+yearId).get();
      if(!year.exists||year.data().schoolId!==ctx.schoolId)deny("not-found","Academic year not found.");
      if(termId){const term=await db.doc(root+"terms/"+termId).get();if(!term.exists||term.data().schoolId!==ctx.schoolId||term.data().yearId!==yearId)deny("failed-precondition","Choose a period in the selected year.");}
      const applications=db.collection(root+"enrollment_applications").where("schoolId","==",ctx.schoolId).where("yearId","==",yearId);
      let registrations=db.collection(root+"student_registrations").where("schoolId","==",ctx.schoolId).where("yearId","==",yearId);
      if(termId)registrations=registrations.where("termId","==",termId);
      const requests=db.collection(root+"student_document_requests").where("schoolId","==",ctx.schoolId);
      const count=async query=>Number((await query.count().get()).data().count)||0;
      const groups=[
        {key:"applications",query:applications,values:["submitted","needs_information","accepted","enrolled","rejected","withdrawn"]},
        {key:"registrations",query:registrations,values:["active","ended"]},
        {key:"documentRequests",query:requests,values:["requested","in_review","ready","released","cancelled"]}
      ];
      const rows=await Promise.all(groups.map(async group=>{
        const counts=await Promise.all([count(group.query),...group.values.map(value=>count(group.query.where("status","==",value)))]);
        return [group.key,{total:counts[0],statuses:Object.fromEntries(group.values.map((value,index)=>[value,counts[index+1]]))}];
      }));
      return {yearId,termId,asOf:Date.now(),...Object.fromEntries(rows)};
    }
    if(input.action==="catalog"){
      const names=["academic_years","academic_programs","terms","sections","subjects","course_offerings"];
      const caps=names.map(name=>name==="course_offerings"?2000:500);
      const snaps=await Promise.all(names.map((name,index)=>db.collection(root+name).where("status","==","active").limit(caps[index]+1).get()));
      if(snaps.some((snap,index)=>snap.size>caps[index]))deny("resource-exhausted","Active academic configuration is too large for this workspace. Placement-specific catalog loading is required.");
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

    if(input.action==="create_onsite_application"){
      const applicationType=admissionType(input.applicationType),personId=input.personId?checkId(input.personId,"Person ID",128):null,
        displayName=text(input.displayName,"Student name",140),birthDate=academicDate(input.birthDate,"Birth date"),
        studentNumber=optionalText(input.studentNumber,80),
        guardianName=text(input.guardianName,"Parent/guardian name",140),
        guardianRelationship=text(input.guardianRelationship,"Parent/guardian relationship",60),
        guardianEmail=normalizedEmail(input.guardianEmail,"Parent/guardian email"),
        guardianMobile=optionalText(input.guardianMobile,40),
        yearId=checkId(input.yearId,"School year"),programId=checkId(input.programId,"Program"),
        termId=checkId(input.termId,"Academic period"),sectionId=checkId(input.sectionId,"Section");
      if(applicationType==="returning"&&!personId)
        deny("failed-precondition","Select the existing student from Student Records before starting returning enrollment.");
      const sectionRef=db.doc(root+"sections/"+sectionId),yearRef=db.doc(root+"academic_years/"+yearId),
        programRef=db.doc(root+"academic_programs/"+programId),termRef=db.doc(root+"terms/"+termId);
      const applicationId=admissionApplicationId({schoolId:ctx.schoolId,yearId,displayName,birthDate,guardianEmail}),
        ref=db.doc(root+"enrollment_applications/"+applicationId),auditRef=db.collection(root+"directory_audit").doc();
      await db.runTransaction(async tx=>{
        await requireCurrentAdmin(tx);
        const [current,year,program,term,section,person]=await Promise.all([
          tx.get(ref),tx.get(yearRef),tx.get(programRef),tx.get(termRef),tx.get(sectionRef),
          personId?tx.get(db.doc(root+"people/"+personId)):Promise.resolve(null)
        ]);
        for(const record of [year,program,term,section])if(!record.exists||record.data().schoolId!==ctx.schoolId||record.data().status!=="active")
          deny("failed-precondition","Choose active school placement options.");
        if(section.data().programId!==programId||term.data().programId!==programId||term.data().yearId!==yearId)
          deny("failed-precondition","The selected placement is inconsistent.");
        if(personId&&(!person?.exists||person.data().schoolId!==ctx.schoolId||person.data().kind!=="student"||person.data().status!=="active"||
          person.data().displayName!==displayName||(person.data().birthDate&&person.data().birthDate!==birthDate)||
          (person.data().studentNumber&&person.data().studentNumber!==studentNumber)))
          deny("failed-precondition","The existing student identity changed. Reopen Student Records.");
        if(personId){
          const placements=await tx.get(db.collection(root+"student_registrations").where("personId","==",personId).limit(101));
          if(placements.size===101)deny("resource-exhausted","Review student registration history before starting another application.");
          if(placements.docs.some(doc=>doc.data().schoolId===ctx.schoolId&&doc.data().yearId===yearId&&doc.data().termId===termId&&doc.data().status==="active"))
            deny("failed-precondition","The student is already enrolled for this academic period.");
          const history=await tx.get(db.collection(root+"enrollment_applications").where("personId","==",personId).limit(101));
          if(history.size===101)deny("resource-exhausted","Review existing applications before creating another.");
          if(history.docs.some(doc=>doc.id!==applicationId&&doc.data().schoolId===ctx.schoolId&&doc.data().yearId===yearId&&
            !["rejected","withdrawn","enrolled"].includes(doc.data().status)))
            deny("already-exists","This student has an open application for this school year. Review the existing application.");
        }
        if(current.exists)deny("already-exists","An application already exists for this learner and school year. Open it in Admissions.");
        const incomingLevel=String(section.data().gradeLevel||"").trim().toLowerCase();
        if(!incomingLevel)deny("failed-precondition","The selected section has no grade level.");
        const studentEmailRequired=gradeRequiresStudentEmail(incomingLevel),
          studentEmail=normalizedEmail(input.studentEmail,"Student email",studentEmailRequired),
          studentEmailType=studentEmail?String(input.studentEmailType||"").trim():null;
        if((!studentEmailRequired&&studentEmail)||(studentEmail&&(studentEmail===guardianEmail||!EMAIL_TYPES.has(studentEmailType))))
          deny("invalid-argument","Review the student sign-in email and account type.");
        if(person?.exists&&person.data().activationEmailHash&&studentEmail&&person.data().activationEmailHash!==rosterEmailHash(studentEmail))
          deny("failed-precondition","The student's existing sign-in identity does not match.");
        const now=FieldValue.serverTimestamp();
        tx.create(ref,{schoolId:ctx.schoolId,applicationType,personId,displayName,birthDate,studentNumber,
          guardianName,guardianRelationship,guardianEmail,guardianMobile,studentEmail,studentEmailType,studentEmailRequired,
          yearId,preferredProgramId:programId,preferredTermId:termId,preferredSectionId:sectionId,incomingLevel,
          source:"onsite",status:"submitted",reference:publicReference(applicationId),
          requirementsReviewed:false,revision:1,createdByUid:ctx.uid,createdAt:now,updatedAt:now});
        tx.create(auditRef,{schoolId:ctx.schoolId,actorUid:ctx.uid,applicationId,personId,action:"onsite_application_created",createdAt:now});
      });
      return {applicationId,reference:publicReference(applicationId),status:"submitted"};
    }
    if(input.action==="bind_returning_application"){
      const applicationId=checkId(input.applicationId,"Application ID",128),expectedRevision=input.expectedRevision,
        studentNumber=text(input.studentNumber,"Student number",80);
      if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)deny("invalid-argument","Refresh the application.");
      const ref=db.doc(root+"enrollment_applications/"+applicationId),auditRef=db.collection(root+"directory_audit").doc();
      await db.runTransaction(async tx=>{
        await requireCurrentAdmin(tx);
        const app=await tx.get(ref);
        if(!app.exists||app.data().schoolId!==ctx.schoolId||app.data().applicationType!=="returning"||
          !["submitted","needs_information"].includes(app.data().status)||Number(app.data().revision)!==expectedRevision)
          deny("failed-precondition","The returning application changed or is not ready for linking.");
        const matches=await tx.get(db.collection(root+"people").where("studentNumber","==",studentNumber).limit(3));
        const people=matches.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&doc.data().kind==="student"&&doc.data().status==="active");
        if(matches.size>=3||people.length!==1)deny("failed-precondition","Find a unique active student number in Student Records.");
        const person=people[0],row=person.data(),a=app.data();
        if(row.displayName!==a.displayName||row.birthDate!==a.birthDate||(a.personId&&a.personId!==person.id)||
          (row.activationEmailHash&&a.studentEmail&&row.activationEmailHash!==rosterEmailHash(a.studentEmail)))
          deny("failed-precondition","Applicant name, birth date or sign-in identity does not match the existing student. Resolve it before linking.");
        const now=FieldValue.serverTimestamp();
        tx.update(ref,{personId:person.id,studentNumber,requirementsReviewed:false,revision:expectedRevision+1,updatedAt:now});
        tx.create(auditRef,{schoolId:ctx.schoolId,actorUid:ctx.uid,applicationId,personId:person.id,action:"returning_application_linked",createdAt:now});
      });
      return {applicationId,revision:expectedRevision+1};
    }

    if(input.action==="correct_application"){
      const applicationId=checkId(input.applicationId,"Application ID",128),expectedRevision=input.expectedRevision,
        guardianName=text(input.guardianName,"Guardian name",140),guardianRelationship=text(input.guardianRelationship,"Relationship",60),
        guardianMobile=optionalText(input.guardianMobile,40),reason=text(input.reason,"Correction reason",500),
        preferredProgramId=input.preferredProgramId?checkId(input.preferredProgramId,"Program"):null;
      if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1||reason.length<8)deny("invalid-argument","Refresh the application and enter a correction reason.");
      const ref=db.doc(root+"enrollment_applications/"+applicationId),auditRef=db.collection(root+"directory_audit").doc();
      await db.runTransaction(async tx=>{
        await requireCurrentAdmin(tx);const doc=await tx.get(ref);
        if(!doc.exists||doc.data().schoolId!==ctx.schoolId)deny("not-found","Application not found.");
        const row=doc.data();
        if(Number(row.revision)!==expectedRevision||!["submitted","needs_information"].includes(row.status))deny("failed-precondition","Reopen the application for corrections and refresh.");
        if((row.admissionDocuments||[]).some(item=>item.state==="pending"))deny("failed-precondition","Resolve pending document uploads before correcting the application.");
        const studentEmail=normalizedEmail(input.studentEmail,"Student email",gradeRequiresStudentEmail(row.incomingLevel)),
          studentEmailType=studentEmail?String(input.studentEmailType||"").trim():null;
        if((!gradeRequiresStudentEmail(row.incomingLevel)&&studentEmail)||(studentEmail&&(studentEmail===row.guardianEmail||!EMAIL_TYPES.has(studentEmailType))))deny("invalid-argument","Review the student email.");
        if(row.personId){const person=await tx.get(db.doc(root+"people/"+checkId(row.personId,"Person ID",128)));
          if(!person.exists||person.data().schoolId!==ctx.schoolId||person.data().kind!=="student"||person.data().status!=="active"||
             (person.data().activationEmailHash&&studentEmail&&person.data().activationEmailHash!==rosterEmailHash(studentEmail)))deny("failed-precondition","The linked student or sign-in identity must be reviewed first.");}
        if(preferredProgramId){const program=await tx.get(db.doc(root+"academic_programs/"+preferredProgramId));if(!program.exists||program.data().schoolId!==ctx.schoolId||program.data().status!=="active")deny("failed-precondition","Choose an active program.");}
        const now=FieldValue.serverTimestamp(),changes={guardianName,guardianRelationship,guardianMobile,studentEmail,studentEmailType,preferredProgramId};
        if(preferredProgramId!==row.preferredProgramId)Object.assign(changes,{preferredTermId:null,preferredSectionId:null});
        tx.update(ref,{...changes,staffCorrected:true,status:"submitted",requirementsReviewed:false,requirements:(row.requirements||[]).map(item=>({...item,status:item.status==="verified"?"received":item.status})),revision:expectedRevision+1,updatedAt:now});
        tx.create(auditRef,{schoolId:ctx.schoolId,actorUid:ctx.uid,applicationId,action:"admission_application_corrected",fields:Object.keys(changes),reason,revision:expectedRevision+1,createdAt:now});
      });
      return {applicationId,revision:expectedRevision+1};
    }

    if(input.action==="list_applications"){
      const cursor=input.cursor?checkId(input.cursor,"Application cursor",128):null,pageSize=80;
      let scan=db.collection(root+"enrollment_applications").orderBy(FieldPath.documentId()).limit(pageSize+1);
      if(cursor)scan=scan.startAfter(cursor);
      const exactId=input.applicationId?checkId(input.applicationId,"Application ID",128):null;
      const [snap,...templateDocs]=await Promise.all([exactId?db.doc(root+"enrollment_applications/"+exactId).get():scan.get(),...ADMISSION_TYPES.map(type=>templateRef(type).get())]);
      const templates=Object.fromEntries(ADMISSION_TYPES.map((type,index)=>[type,readTemplate(templateDocs[index],type)]));
      if(exactId&&(!snap.exists||snap.data().schoolId!==ctx.schoolId))deny("not-found","Application not found.");
      const page=exactId?[snap]:snap.docs.slice(0,pageSize),nextCursor=!exactId&&snap.size>pageSize?page.at(-1).id:null;
      const items=page.filter(doc=>doc.data().schoolId===ctx.schoolId).map(doc=>{
        const row=doc.data(),type=ADMISSION_TYPES.includes(row.applicationType)?row.applicationType:"new",template=templates[type];
        return ({
        applicationId:doc.id,reference:applicationReference(doc),
        personId:doc.data().personId||null,
        studentNumber:row.studentNumber||"",preferredTermId:row.preferredTermId||"",preferredSectionId:row.preferredSectionId||"",
        applicationType:type,
        displayName:doc.data().displayName||"Student",
        birthDate:doc.data().birthDate||"",incomingLevel:doc.data().incomingLevel||"",
        yearId:doc.data().yearId||"",preferredProgramId:doc.data().preferredProgramId||"",
        guardianName:doc.data().guardianName||"",guardianRelationship:doc.data().guardianRelationship||"",
        guardianEmail:doc.data().guardianEmail||"",guardianMobile:doc.data().guardianMobile||"",
        studentEmail:doc.data().studentEmail||"",studentEmailType:doc.data().studentEmailType||"",
        studentEmailRequired:Boolean(doc.data().studentEmailRequired),
        source:doc.data().source||"online",status:doc.data().status||"submitted",
        reviewReason:doc.data().reviewReason||"",
        requirements:Array.isArray(doc.data().requirements)?doc.data().requirements:[],
        requirementsReviewed:doc.data().requirementsReviewed===true,
        noRequirements:doc.data().noRequirements===true,
        requirementsReady:row.status==="accepted"?admissionRequirementsReady(row):pendingRequirementsReady(row,template),
        templateLabels:template.labels,templateRevision:template.revision,
        reviewedTemplateRevision:Number(row.requirementsTemplateRevision)||0,
        revision:Number(doc.data().revision)||1,
        updatedAt:doc.data().updatedAt?.toMillis?.()||doc.data().createdAt?.toMillis?.()||0
      });});
      items.sort((a,b)=>b.updatedAt-a.updatedAt||a.displayName.localeCompare(b.displayName));
      return {items,nextCursor};
    }

    if(input.action==="save_application_requirements"){
      const applicationId=checkId(input.applicationId,"Application ID",128),
        expectedRevision=Number(input.expectedRevision);
      if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)
        deny("invalid-argument","Refresh this application before saving requirements.");
      const requirements=normalizeAdmissionRequirements(input.requirements,input.noRequirements),expectedTemplateRevision=input.expectedTemplateRevision;
      if(!Number.isSafeInteger(expectedTemplateRevision)||expectedTemplateRevision<0)
        deny("invalid-argument","Refresh the applicable admissions template.");
      const reason=text(input.reason,"Review reason",500);
      if(reason.length<8)deny("invalid-argument","Record the basis for the requirements review.");
      const ref=db.doc(root+"enrollment_applications/"+applicationId),
        auditRef=db.collection(root+"directory_audit").doc();
      await db.runTransaction(async tx=>{
        await requireCurrentAdmin(tx);
        const application=await tx.get(ref);
        if(!application.exists||application.data().schoolId!==ctx.schoolId)
          deny("not-found","Enrollment application was not found.");
        const prior=application.data(),currentRevision=Number(prior.revision)||1;
        if(currentRevision!==expectedRevision)
          deny("failed-precondition","The application changed. Refresh before saving requirements.");
        if(!["submitted","needs_information"].includes(prior.status||"submitted"))
          deny("failed-precondition","Reopen the application for corrections before editing its requirements.");
        const type=ADMISSION_TYPES.includes(prior.applicationType)?prior.applicationType:"new",template=readTemplate(await tx.get(templateRef(type)),type);
        if(template.revision!==expectedTemplateRevision)deny("failed-precondition","Admission requirements changed. Reopen the checklist.");
        if((prior.admissionDocuments||[]).some(item=>item.state==="pending"&&!requirements.some(row=>row.label===item.label)))
          deny("failed-precondition","Resolve pending document uploads before removing their requirements.");
        if(!templateCovered(requirements,template.labels))deny("failed-precondition","Include every required item from the school template.");
        const now=FieldValue.serverTimestamp(),revision=currentRevision+1;
        tx.update(ref,{requirements,noRequirements:input.noRequirements,requirementsReviewed:true,requirementsTemplateRevision:template.revision,
          requirementsReviewedByUid:ctx.uid,requirementsReviewedAt:now,revision,updatedAt:now});
        tx.create(auditRef,{schoolId:ctx.schoolId,actorUid:ctx.uid,applicationId,
          action:"admissions_requirements_review",previousRequirements:prior.requirements||[],
          previousNoRequirements:prior.noRequirements===true,requirements,noRequirements:input.noRequirements,
          templateRevision:template.revision,templateLabels:template.labels,reason,revision,createdAt:now});
      });
      return {applicationId,revision:expectedRevision+1,
        requirementsReady:admissionRequirementsReady({requirements,noRequirements:input.noRequirements,requirementsReviewed:true})};
    }

    if(input.action==="review_application"){
      const applicationId=checkId(input.applicationId,"Application ID",128),
        expectedRevision=Number(input.expectedRevision);
      if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)
        deny("invalid-argument","Refresh this application before saving a review decision.");
      const status=String(input.status||"").trim().toLowerCase();
      if(!["submitted","needs_information","accepted","rejected"].includes(status))
        deny("invalid-argument","Choose a valid admissions decision.");
      const reason=text(input.reason,"Review reason",500);
      if(reason.length<8)deny("invalid-argument","Explain the enrollment review decision.");
      const ref=db.doc(root+"enrollment_applications/"+applicationId),auditRef=db.collection(root+"directory_audit").doc();
      await db.runTransaction(async tx=>{
        await requireCurrentAdmin(tx);
        const application=await tx.get(ref);
        if(!application.exists||application.data().schoolId!==ctx.schoolId)
          deny("not-found","Enrollment application was not found.");
        const currentRevision=Number(application.data().revision)||1;
        if(currentRevision!==expectedRevision)
          deny("failed-precondition","This enrollment application changed after you opened it. Refresh before saving the review.");
        const previousStatus=application.data().status||"submitted";
        if(!canReviewApplication(previousStatus,status))
          deny("failed-precondition","This admissions decision is no longer available. Refresh the application.");
        if(status==="accepted"){
          const type=ADMISSION_TYPES.includes(application.data().applicationType)?application.data().applicationType:"new";
          if(type==="returning"&&!application.data().personId)deny("failed-precondition","Link the existing returning student before acceptance.");
          const template=readTemplate(await tx.get(templateRef(type)),type);
          if(!pendingRequirementsReady(application.data(),template))
            deny("failed-precondition","Verify the current school admission requirements before accepting.");
        }
        const now=FieldValue.serverTimestamp();
        tx.update(ref,{status,reviewReason:reason,reviewedByUid:ctx.uid,
          ...(status==="needs_information"?{requirementsReviewed:false}:{}),
          reviewedAt:now,updatedAt:now,revision:currentRevision+1});
        tx.create(auditRef,{schoolId:ctx.schoolId,actorUid:ctx.uid,applicationId,
          action:"admissions_review",previousStatus,status,reason,revision:currentRevision+1,createdAt:now});
      });
      return {applicationId,status,revision:expectedRevision+1};
    }

    if(input.action==="student_candidate"){
      const personId=checkId(input.personId,"Person ID",128),
        personRef=db.doc(root+"people/"+personId);
      const [person,registrations,enrollments]=await Promise.all([
        personRef.get(),
        db.collection(root+"student_registrations").where("personId","==",personId).limit(51).get(),
        db.collection(root+"enrollments").where("personId","==",personId).limit(101).get()
      ]);
      if(!person.exists||person.data().schoolId!==ctx.schoolId)
        deny("not-found","The student is not in this school directory.");
      const data=person.data();
      if(data.kind!=="student"||data.status!=="active")
        deny("failed-precondition","Only an active student directory record can be placed through Enrollment & Registration.");
      if(registrations.size===51||enrollments.size===101)
        deny("resource-exhausted","This student has too much registration or class-enrollment history for a safe enrollment handoff.");
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
        activeRegistrations,
        activeLegacyEnrollments:enrollments.docs.filter(doc=>{
          const row=doc.data();
          return row.schoolId===ctx.schoolId&&row.status==="active";
        }).map(doc=>({
          enrollmentId:doc.id,expectedRevision:Number(doc.data().revision)||1,
          offeringId:doc.data().offeringId||null,yearId:doc.data().yearId||null,
          termId:doc.data().termId||null,sectionId:doc.data().sectionId||null,
          subjectId:doc.data().subjectId||null,registrationId:doc.data().registrationId||null
        }))
      };
    }

    if(input.action==="student_history"){
      const personId=checkId(input.personId,"Person ID",128),
        personRef=db.doc(root+"people/"+personId),
        [person,registrationSnap,auditSnap]=await Promise.all([
          personRef.get(),
          db.collection(root+"student_registrations").where("personId","==",personId).limit(101).get(),
          db.collection(root+"directory_audit").where("personId","==",personId).limit(101).get()
        ]);
      if(!person.exists||person.data().schoolId!==ctx.schoolId||person.data().kind!=="student")
        deny("not-found","The student record was not found in this school.");
      if(registrationSnap.size===101||auditSnap.size===101)
        deny("resource-exhausted","Student placement history requires pagination before it can be shown safely.");
      const registrations=registrationSnap.docs.filter(doc=>doc.data().schoolId===ctx.schoolId)
        .map(doc=>{
          const row=doc.data();
          return {
            registrationId:doc.id,status:row.status||"active",revision:Number(row.revision)||1,
            yearId:row.yearId,programId:row.programId,termId:row.termId,sectionId:row.sectionId,
            gradeLevel:row.gradeLevel||null,courseCount:Number(row.courseCount)||0,
            source:row.source||"onsite",endReasonType:row.endReasonType||null,
            progressionType:row.progressionType||null,
            previousRegistrationId:row.previousRegistrationId||null,
            progressedToRegistrationId:row.progressedToRegistrationId||null,
            createdAt:millis(row.createdAt),endedAt:millis(row.endedAt),
            progressedAt:millis(row.progressedAt),restoredAt:millis(row.restoredAt)
          };
        }).sort((a,b)=>(b.createdAt||b.progressedAt||0)-(a.createdAt||a.progressedAt||0));
      const registrationIds=new Set(registrations.map(row=>row.registrationId));
      const events=auditSnap.docs.map(doc=>({auditId:doc.id,...doc.data()}))
        .filter(row=>row.schoolId===ctx.schoolId&&(
          registrationIds.has(row.registrationId)||
          registrationIds.has(row.previousRegistrationId)||
          registrationIds.has(row.targetRegistrationId)))
        .filter(row=>/^student_(?:registration_|registered_)/.test(String(row.action||"")))
        .map(row=>({
          auditId:row.auditId,action:String(row.action||"registration_change").slice(0,120),
          registrationId:row.registrationId||null,previousRegistrationId:row.previousRegistrationId||null,
          targetRegistrationId:row.targetRegistrationId||null,
          progressionType:row.progressionType||null,endReasonType:row.endReasonType||null,
          fromSectionId:row.fromSectionId||null,toSectionId:row.toSectionId||null,
          reason:String(row.reason||"").slice(0,500),createdAt:millis(row.createdAt)
        })).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
      return {
        person:{personId,displayName:person.data().displayName||"Student",
          studentNumber:person.data().studentNumber||"",status:person.data().status||"active"},
        registrations,events,
        activeRegistrationCount:registrations.filter(row=>row.status==="active").length
      };
    }

    function registrationRows(docs){
      const registrationDocs=docs.filter(doc=>doc.data().schoolId===ctx.schoolId);
      return registrationDocs.map(doc=>({
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
          endReasonType:doc.data().endReasonType||null,
          progressionType:doc.data().progressionType||null,
          progressedToRegistrationId:doc.data().progressedToRegistrationId||null,
          previousRegistrationId:doc.data().previousRegistrationId||null,
          revision:Number(doc.data().revision)||1
        }));
    }

    if(input.action==="list_registrations"){
      const pageSize=80,cursor=input.cursor?checkId(input.cursor,"Registration cursor",128):null;
      let query=db.collection(root+"student_registrations").orderBy(FieldPath.documentId()).limit(pageSize+1);
      if(cursor)query=query.startAfter(cursor);
      const snap=await query.get(),page=snap.docs.slice(0,pageSize);
      return {items:registrationRows(page),nextCursor:snap.size>pageSize?page.at(-1).id:null};
    }

    if(input.action==="list_progression_cohort"){
      const yearId=checkId(input.yearId,"Academic year"),termId=checkId(input.termId,"Academic period"),sectionId=checkId(input.sectionId,"Section");
      const snap=await db.collection(root+"student_registrations").where("yearId","==",yearId).where("termId","==",termId).where("sectionId","==",sectionId).where("status","==","active").limit(61).get();
      if(snap.size===61)deny("resource-exhausted","This cohort exceeds 60 active registrations. Use individual progression for larger cohorts.");
      return {items:registrationRows(snap.docs)};
    }

    if(input.action==="list_legacy_candidates"){
      const cursor=input.cursor?checkId(input.cursor,"Legacy scan cursor",128):null,pageSize=30;
      let query=db.collection(root+"enrollments").where("status","==","active").orderBy(FieldPath.documentId()).limit(pageSize+1);
      if(cursor)query=query.startAfter(cursor);
      const snap=await query.get(),page=snap.docs.slice(0,pageSize),peopleIds=[...new Set(page.filter(doc=>doc.data().schoolId===ctx.schoolId&&typeof doc.data().personId==="string").map(doc=>doc.data().personId))];
      let blockedCount=0;
      const candidates=await Promise.all(peopleIds.map(async personId=>{
        checkId(personId,"Person ID",128);
        const [person,registrations]=await Promise.all([db.doc(root+"people/"+personId).get(),db.collection(root+"student_registrations").where("personId","==",personId).limit(51).get()]);
        if(!person.exists||person.data().schoolId!==ctx.schoolId||person.data().kind!=="student")return null;
        if(registrations.size===51){blockedCount++;return null;}
        if(registrations.docs.some(doc=>doc.data().schoolId===ctx.schoolId&&(doc.data().status||"active")==="active"))return null;
        const all=await db.collection(root+"enrollments").where("personId","==",personId).limit(101).get();
        if(all.size===101){blockedCount++;return null;}
        const enrollments=all.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&doc.data().personId===personId&&doc.data().status==="active").map(doc=>({
          enrollmentId:doc.id,expectedRevision:Number(doc.data().revision)||1,offeringId:doc.data().offeringId||null,
          yearId:doc.data().yearId||null,termId:doc.data().termId||null,sectionId:doc.data().sectionId||null,
          subjectId:doc.data().subjectId||null,registrationId:doc.data().registrationId||null
        }));
        if(!enrollments.length)return null;
        const row=person.data();
        return {personId,displayName:row.displayName||"Student",studentNumber:row.studentNumber||"",personStatus:row.status||"active",
          courseCount:enrollments.length,sectionIds:[...new Set(enrollments.map(item=>item.sectionId).filter(Boolean))],
          yearIds:[...new Set(enrollments.map(item=>item.yearId).filter(Boolean))],termIds:[...new Set(enrollments.map(item=>item.termId).filter(Boolean))],
          hasRegistrationLinkedEnrollment:enrollments.some(item=>Boolean(item.registrationId)),manualReview:enrollments.length>80,enrollments};
      }));
      return {items:candidates.filter(Boolean),nextCursor:snap.size>pageSize?page.at(-1).id:null,blockedCount};
    }

    if(input.action==="end_orphan_enrollments"){
      const personId=checkId(input.personId,"Person ID",128),
        reason=text(input.reason,"Legacy enrollment reconciliation reason",500),
        expected=Array.isArray(input.enrollments)?input.enrollments.map(item=>({
          enrollmentId:checkId(item?.enrollmentId,"Enrollment ID",128),
          expectedRevision:Number(item?.expectedRevision)
        })):[];
      if(reason.length<12)deny("invalid-argument","Explain the enrollment reconciliation in at least 12 characters.");
      if(!expected.length||expected.length>80)
        deny("invalid-argument","Review between 1 and 80 active legacy enrollments before reconciling.");
      if(expected.some(item=>!Number.isSafeInteger(item.expectedRevision)||item.expectedRevision<1))
        deny("invalid-argument","Refresh the legacy enrollment review before saving.");
      if(new Set(expected.map(item=>item.enrollmentId)).size!==expected.length)
        deny("invalid-argument","Legacy enrollment review contains duplicate records.");
      const [currentEnrollments,currentRegistrations]=await Promise.all([
        db.collection(root+"enrollments").where("personId","==",personId).limit(101).get(),
        db.collection(root+"student_registrations").where("personId","==",personId).limit(51).get()
      ]);
      if(currentEnrollments.size===101||currentRegistrations.size===51)
        deny("resource-exhausted","This student has too much enrollment history for automatic legacy reconciliation.");
      if(currentRegistrations.docs.some(doc=>doc.data().schoolId===ctx.schoolId&&
        (doc.data().status||"active")==="active"))
        deny("failed-precondition",
          "This student now has an active official registration. Use the registration lifecycle instead of legacy cleanup.");
      const active=currentEnrollments.docs.filter(doc=>
        doc.data().schoolId===ctx.schoolId&&doc.data().status==="active");
      const activeIds=active.map(doc=>doc.id).sort(),
        expectedIds=expected.map(item=>item.enrollmentId).sort();
      if(activeIds.length!==expectedIds.length||activeIds.some((value,index)=>value!==expectedIds[index]))
        deny("failed-precondition","The student's active class enrollments changed. Refresh the reconciliation list before saving.");
      if(active.some(doc=>doc.data().registrationId))
        deny("failed-precondition",
          "An active class enrollment is linked to registration history. Review that registration before legacy cleanup.");
      const personRef=db.doc(root+"people/"+personId),
        refs=expected.map(item=>db.doc(root+"enrollments/"+item.enrollmentId)),
        auditRef=db.collection(root+"directory_audit").doc();
      await db.runTransaction(async tx=>{
        await requireCurrentAdmin(tx);
        const [person,registrationCheck,liveEnrollments,...records]=await Promise.all([
          tx.get(personRef),
          tx.get(db.collection(root+"student_registrations").where("personId","==",personId).limit(51)),
          tx.get(db.collection(root+"enrollments").where("personId","==",personId).limit(101)),
          ...refs.map(ref=>tx.get(ref))
        ]);
        if(!person.exists||person.data().schoolId!==ctx.schoolId||person.data().kind!=="student"||
           person.data().status!=="active")
          deny("failed-precondition","The student directory record must remain active during reconciliation.");
        if(registrationCheck.size===51)
          deny("resource-exhausted","This student has too much registration history for automatic reconciliation.");
        if(registrationCheck.docs.some(doc=>doc.data().schoolId===ctx.schoolId&&
          (doc.data().status||"active")==="active"))
          deny("failed-precondition",
            "An official registration was created after preview. Refresh before changing legacy enrollments.");
        if(liveEnrollments.size===101||JSON.stringify(liveEnrollments.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&doc.data().status==="active").map(doc=>doc.id).sort())!==JSON.stringify(expectedIds))
          deny("failed-precondition","Active legacy enrollments changed after preview. Refresh before reconciling.");
        const now=FieldValue.serverTimestamp();
        records.forEach((record,index)=>{
          const reviewed=expected[index];
          if(!record.exists||record.data().schoolId!==ctx.schoolId||
             record.data().personId!==personId||record.data().status!=="active")
            deny("failed-precondition","A reviewed legacy enrollment changed. Refresh before saving.");
          const currentRevision=Number(record.data().revision)||1;
          if(currentRevision!==reviewed.expectedRevision)
            deny("failed-precondition","A reviewed legacy enrollment changed. Refresh before saving.");
          if(record.data().registrationId)
            deny("failed-precondition",
              "A reviewed class enrollment is now linked to registration history. Refresh before saving.");
          tx.update(record.ref,{
            status:"ended",endedByUid:ctx.uid,endedAt:now,endReason:reason,
            endedByReconciliation:true,reconciliationType:"pre_canonical_orphan",
            revision:currentRevision+1
          });
        });
        tx.create(auditRef,{
          schoolId:ctx.schoolId,actorUid:ctx.uid,personId,
          action:"pre_canonical_student_enrollments_ended",reason,
          enrollmentIds:expected.map(item=>item.enrollmentId),
          enrollmentCount:expected.length,createdAt:now
        });
      });
      return {personId,status:"ended",courseCount:expected.length};
    }

    if(["end_registration","restore_registration"].includes(input.action)){
      const registrationId=checkId(input.registrationId,"Registration ID",128),
        expectedRevision=Number(input.expectedRevision);
      if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)
        deny("invalid-argument","Refresh this registration before changing its lifecycle.");
      const reason=text(input.reason,input.action==="end_registration"?"Registration end reason":"Registration restore reason",500);
      if(reason.length<12)deny("invalid-argument","Explain the registration change in at least 12 characters.");
      const endReasonType=input.action==="end_registration"?String(input.endReasonType||"").trim().toLowerCase():null;
      if(input.action==="end_registration"&&!REGISTRATION_END_TYPES.has(endReasonType))
        deny("invalid-argument","Choose whether this registration ended by withdrawal, transfer out, cancellation or another institutional reason.");
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
        const data=registration.data(),currentRevision=Number(data.revision)||1;
        if(currentRevision!==expectedRevision)
          deny("failed-precondition","This registration changed after you opened it. Refresh and review the latest status.");
        if(restoring&&data.status!=="ended")
          deny("failed-precondition","Only an ended registration can be restored.");
        if(restoring&&data.progressionType)
          deny("failed-precondition","A progressed or graduated registration cannot be restored directly. Review the progression history and create a corrected official placement instead.");
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
            revision:currentRevision+1});
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
              endReasonType,endedByRegistrationId:registrationId,revision:(doc.data().revision||1)+1});
          }
          changedCourses=active.length;
          tx.update(registrationRef,{status:"ended",endedByUid:ctx.uid,endedAt:now,
            endReason:reason,endReasonType,updatedByUid:ctx.uid,updatedAt:now,
            revision:currentRevision+1});
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
          courseCount:changedCourses,reason,...(!restoring?{endReasonType}:{}),createdAt:FieldValue.serverTimestamp()});
      });
      return {registrationId,status:restoring?"active":"ended",courseCount:changedCourses,
        revision:expectedRevision+1,...(!restoring?{endReasonType}:{})};
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

    if(input.action==="preview_progression"){
      const review=await reviewProgression(input);
      return {
        registrationId:review.registrationId,progressionType:review.progressionType,
        canApply:review.canApply,blockers:review.blockers,completion:review.completion,
        target:review.target,admissionApplication:review.admissionApplication,source:{
          yearId:review.source.yearId,programId:review.source.programId,termId:review.source.termId,
          sectionId:review.source.sectionId,gradeLevel:review.source.gradeLevel||null,
          courseCount:review.sourceEnrollments.length
        }
      };
    }

    if(input.action==="progress_registration"){
      const reason=text(input.reason,"Progression reason",500);
      if(reason.length<12)deny("invalid-argument","Explain the promotion, retention or graduation decision in at least 12 characters.");
      let result;
      await db.runTransaction(async tx=>{
        await requireCurrentAdmin(tx);
        const review=await reviewProgression(input,tx);
        if(!review.canApply)
          deny("failed-precondition",review.blockers[0]?.message||"This student is not ready for progression.");
        if((input.expectedAdmissionApplicationId||null)!==(review.admissionApplication?.applicationId||null)||
          (input.expectedAdmissionRevision||null)!==(review.admissionApplication?.revision||null))
          deny("failed-precondition","Returning admission changed. Run progression preview again.");
        const {source,registrationRef,registrationId,personId,personRef,person,progressionType}=review;
        const sourceSlotRef=db.doc(root+"student_registration_slots/"+key(personId,source.yearId,source.termId)),
          sourceSlot=await tx.get(sourceSlotRef),now=FieldValue.serverTimestamp(),
          targetRegistrationId=review.target?.registrationId||null;
        for(const enrollment of review.sourceEnrollments)
          tx.update(enrollment.ref,{status:"ended",endedByUid:ctx.uid,endedAt:now,
            endReason:reason,endReasonType:"progression",progressionType,
            endedByRegistrationId:registrationId,
            ...(targetRegistrationId?{replacedByRegistrationId:targetRegistrationId}:{}),
            revision:(Number(enrollment.data().revision)||1)+1});
        tx.update(registrationRef,{status:"ended",endedByUid:ctx.uid,endedAt:now,
          endReason:reason,endReasonType:"progression",progressionType,
          progressedAt:now,progressedByUid:ctx.uid,progressionReason:reason,
          ...(targetRegistrationId?{progressedToRegistrationId:targetRegistrationId}:{graduated:true}),
          updatedByUid:ctx.uid,updatedAt:now,
          revision:(Number(source.revision)||1)+1});
        const endedSlot={schoolId:ctx.schoolId,personId,yearId:source.yearId,
          programId:source.programId,termId:source.termId,sectionId:source.sectionId,
          registrationId,status:"ended",updatedByUid:ctx.uid,updatedAt:now};
        if(sourceSlot.exists&&sourceSlot.data().registrationId===registrationId)
          tx.set(sourceSlotRef,{...endedSlot,revision:(Number(sourceSlot.data().revision)||1)+1},{merge:true});
        else if(!sourceSlot.exists)
          tx.create(sourceSlotRef,{...endedSlot,revision:1,createdByUid:ctx.uid,createdAt:now});

        let createdCourses=0;
        if(review.target){
          const target=review.target,targetData={
            schoolId:ctx.schoolId,personId,displayName:source.displayName||person.data().displayName||"Student",
            studentNumber:source.studentNumber||person.data().studentNumber||null,
            birthDate:source.birthDate||person.data().birthDate||null,
            guardianName:source.guardianName||person.data().primaryGuardianName||null,
            guardianRelationship:source.guardianRelationship||person.data().primaryGuardianRelationship||null,
            guardianEmail:source.guardianEmail||person.data().primaryGuardianEmail||null,
            guardianMobile:source.guardianMobile||person.data().primaryGuardianMobile||null,
            studentEmailType:source.studentEmailType||person.data().studentEmailType||null,
            studentEmailRequired:target.studentEmailRequired===true,
            accountResponsibility:target.accountResponsibility,
            yearId:target.yearId,programId:target.programId,termId:target.termId,
            sectionId:target.sectionId,gradeLevel:target.gradeLevel||null,status:"active",
            courseCount:review.targetOfferings.length,accountLinked:Boolean(source.accountLinked||person.data().authUid),
            source:"progression",applicationId:review.admissionApplication?.applicationId||null,
            previousRegistrationId:registrationId,progressionType,progressionReason:reason,
            revision:1,createdByUid:ctx.uid,createdAt:now,updatedByUid:ctx.uid,updatedAt:now
          };
          tx.create(review.targetRegistrationRef,targetData);
          if(review.admissionRef)tx.update(review.admissionRef,{status:"enrolled",personId,registrationId:target.registrationId,
            officialProgramId:target.programId,officialTermId:target.termId,officialSectionId:target.sectionId,
            enrolledByUid:ctx.uid,enrolledAt:now,updatedAt:now,revision:review.admissionApplication.revision+1});
          if(person.data().accountResponsibility!==target.accountResponsibility)
            tx.update(personRef,{accountResponsibility:target.accountResponsibility,
              updatedByUid:ctx.uid,updatedAt:now,revision:(Number(person.data().revision)||1)+1});
          const placement={schoolId:ctx.schoolId,personId,yearId:target.yearId,
            programId:target.programId,termId:target.termId,sectionId:target.sectionId,
            registrationId:target.registrationId,status:"active",updatedByUid:ctx.uid,updatedAt:now};
          if(review.targetSlot.exists)
            tx.set(review.targetSlotRef,{...placement,revision:(Number(review.targetSlot.data().revision)||1)+1},{merge:true});
          else tx.create(review.targetSlotRef,{...placement,revision:1,createdByUid:ctx.uid,createdAt:now});
          review.targetOfferings.forEach((offering,index)=>{
            const row=offering.data();
            tx.create(review.targetEnrollmentRefs[index],{schoolId:ctx.schoolId,personId,
              offeringId:offering.id,registrationId:target.registrationId,
              programId:row.programId,yearId:row.yearId,termId:row.termId,
              sectionId:row.sectionId,subjectId:row.subjectId,status:"active",revision:1,
              enrollmentSource:"official_progression",createdByUid:ctx.uid,createdAt:now});
            createdCourses++;
          });
        }
        const auditRef=db.collection(root+"directory_audit").doc();
        tx.create(auditRef,{schoolId:ctx.schoolId,actorUid:ctx.uid,personId,
          registrationId,targetRegistrationId,applicationId:review.admissionApplication?.applicationId||null,action:"student_registration_progressed",
          progressionType,fromYearId:source.yearId,fromProgramId:source.programId,
          fromTermId:source.termId,fromSectionId:source.sectionId,
          ...(review.target?{toYearId:review.target.yearId,toProgramId:review.target.programId,
            toTermId:review.target.termId,toSectionId:review.target.sectionId,
            toGradeLevel:review.target.gradeLevel||null}:{}),
          completedCourseCount:review.sourceEnrollments.length,createdCourseCount:createdCourses,
          reason,createdAt:now});
        result={registrationId,targetRegistrationId,progressionType,
          completedCourseCount:review.sourceEnrollments.length,createdCourseCount:createdCourses,
          target:review.target,revision:(Number(source.revision)||1)+1};
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
      const applicationRevision=Number(input.applicationRevision);
      if(!applicationId||!Number.isSafeInteger(applicationRevision)||applicationRevision<1)
        deny("failed-precondition","Reopen the accepted application before enrolling.");
      const explicitPersonId=input.personId?checkId(input.personId,"Person ID",128):null;
      const applicationRef=applicationId?db.doc(root+"enrollment_applications/"+applicationId):null;

      const [year,program,term,section,offeringSnap,application]=await Promise.all([
        db.doc(root+"academic_years/"+yearId).get(),
        db.doc(root+"academic_programs/"+programId).get(),
        db.doc(root+"terms/"+termId).get(),
        db.doc(root+"sections/"+sectionId).get(),
        db.collection(root+"course_offerings").where("sectionId","==",sectionId).where("yearId","==",yearId).where("termId","==",termId).limit(251).get(),
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
        if(!isReviewedApplicationRevision(app,applicationRevision))
          deny("failed-precondition","Accept the current application revision before enrolling.");
        if(app.incomingLevel&&String(app.incomingLevel).toLowerCase()!==gradeLevel)
          deny("failed-precondition","The official section must match the accepted incoming grade level.");
        if(app.yearId&&app.yearId!==yearId)
          deny("failed-precondition","The application belongs to another school year.");
        if(app.applicationType==="returning"&&!app.personId)deny("failed-precondition","Link the existing returning student before enrollment.");
        if(!acceptedIdentityMatches(app,{displayName,birthDate,guardianName,guardianRelationship,guardianEmail,guardianMobile,studentEmail,studentEmailType,studentNumber,personId:explicitPersonId}))
          deny("failed-precondition","Accepted applicant details changed. Reopen admissions review before enrollment.");
      }

      if(offeringSnap.size===251)deny("resource-exhausted","Section offering history requires pagination before enrollment.");
      const offerings=offeringSnap.docs.filter(doc=>{
        const row=doc.data();
        return row.schoolId===ctx.schoolId&&row.status==="active"&&
          row.yearId===yearId&&row.programId===programId&&row.termId===termId&&row.sectionId===sectionId&&
          row.rosterMode!=="selective";
      });

      if(!offerings.length||offerings.length>60)deny("failed-precondition","Configure between 1 and 60 active automatic class offerings for this placement.");
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
      const guardianContactId=guardianContactIdForEmail(guardianEmail),
        guardianRelationshipKey=guardianRelationshipId(personId,guardianContactId),
        guardianContactRef=db.doc(root+"guardian_contacts/"+guardianContactId),
        guardianRelationshipRef=db.doc(root+"guardian_relationships/"+guardianRelationshipKey);
      const auditRef=db.collection(root+"directory_audit").doc(),
        guardianAuditRef=db.collection(root+"student_records_audit").doc();
      const source=application.data().source==="onsite"?"onsite":"online";
      const accountResponsibility=studentEmailRequired?"student":"guardian";

      let result;
      await db.runTransaction(async tx=>{
        await requireCurrentAdmin(tx);
        const guardianOffset=3+enrollmentRefs.length,
          reads=[
            tx.get(personRef),tx.get(registrationRef),tx.get(placementSlotRef),
            ...enrollmentRefs.map(ref=>tx.get(ref)),
            tx.get(guardianContactRef),tx.get(guardianRelationshipRef)
          ];
        if(applicationRef)reads.push(tx.get(applicationRef));
        const records=await Promise.all(reads);
        const [liveYear,liveProgram,liveTerm,liveSection,liveOfferings]=await Promise.all([tx.get(year.ref),tx.get(program.ref),tx.get(term.ref),tx.get(section.ref),tx.get(db.collection(root+"course_offerings").where("sectionId","==",sectionId).where("yearId","==",yearId).where("termId","==",termId).limit(251))]);
        if([liveYear,liveProgram,liveTerm,liveSection].some(doc=>!doc.exists||doc.data().schoolId!==ctx.schoolId||doc.data().status!=="active")||liveTerm.data().yearId!==yearId||liveTerm.data().programId!==programId||liveSection.data().programId!==programId||String(liveSection.data().gradeLevel||"").trim().toLowerCase()!==gradeLevel||liveOfferings.size===251)
          deny("failed-precondition","Academic placement changed. Refresh before enrolling.");
        const liveIds=liveOfferings.docs.filter(doc=>{const row=doc.data();return row.schoolId===ctx.schoolId&&row.status==="active"&&row.yearId===yearId&&row.programId===programId&&row.termId===termId&&row.sectionId===sectionId&&row.rosterMode!=="selective";}).map(doc=>doc.id).sort();
        if(JSON.stringify(liveIds)!==JSON.stringify(offerings.map(doc=>doc.id).sort())||offerings.some(doc=>liveOfferings.docs.find(item=>item.id===doc.id)?.data().subjectId!==doc.data().subjectId))
          deny("failed-precondition","The automatic class roster changed. Refresh before enrolling.");
        const placementHistory=await tx.get(db.collection(root+"student_registrations").where("personId","==",personId).limit(101));
        if(placementHistory.size===101)deny("resource-exhausted","Review the full registration history before enrolling.");
        const schoolHistory=placementHistory.docs.filter(doc=>doc.data().schoolId===ctx.schoolId).map(doc=>doc.data());
        if(schoolHistory.some(row=>row.status==="active"&&row.yearId!==yearId&&!schoolHistory.some(done=>done.yearId===row.yearId&&done.endReasonType==="progression"&&done.status==="ended")))
          deny("failed-precondition","A prior academic year still has an active registration. Use year-end Progression to complete released-grade review and enroll the accepted returning application.");
        const guardianRelationships=await tx.get(db.collection(root+"guardian_relationships")
          .where("studentPersonId","==",personId).limit(51));
        if(guardianRelationships.size===51)
          deny("resource-exhausted","This student has too many guardian relationship records for safe enrollment.");
        const person=records[0],registration=records[1],placementSlot=records[2],
          enrollments=records.slice(3,3+enrollmentRefs.length),
          guardianContact=records[guardianOffset],
          guardianLink=records[guardianOffset+1],
          otherGuardians=guardianRelationships.docs.filter(doc=>
            doc.id!==guardianRelationshipKey&&doc.data().schoolId===ctx.schoolId),
          currentApplication=applicationRef?records.at(-1):null;
        if(placementSlot.exists&&placementSlot.data().status==="active"&&
           placementSlot.data().registrationId!==registrationId)
          deny("failed-precondition",
            "Another official registration currently owns this student's selected academic period.");

        if(currentApplication&&(!currentApplication.exists||currentApplication.data().schoolId!==ctx.schoolId||
          !isReviewedApplicationRevision(currentApplication.data(),applicationRevision)))
          deny("failed-precondition","The online application changed before enrollment. Refresh and review it again.");

        if((explicitPersonId||currentApplication?.data().personId)&&!person.exists)
          deny("failed-precondition","The linked student no longer exists. Review Student Records.");
        if(person.exists){
          const row=person.data();
          if(row.schoolId!==ctx.schoolId||row.kind!=="student"||row.status!=="active")
            deny("failed-precondition","The matching person record cannot be used for student enrollment.");
          if((explicitPersonId||currentApplication?.data().personId)&&((row.birthDate&&row.birthDate!==birthDate)||(row.studentNumber&&studentNumber!==row.studentNumber)))
            deny("failed-precondition","The linked student birth date or student number changed. Review Student Records.");
          if(String(row.displayName||"").trim()!==displayName||(row.birthDate&&row.birthDate!==birthDate))
            deny("failed-precondition","The reviewed directory student's name changed or does not match this enrollment form. Correct the identity in People & Access, then reopen Enrollment.");
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

        if(guardianContact.exists&&guardianContact.data().schoolId!==ctx.schoolId)
          deny("failed-precondition","Guardian contact identity collision requires Student Records review.");
        if(guardianContact.exists&&guardianContact.data().status!=="active")
          deny("failed-precondition","The matching guardian contact is inactive. Review it in Student Records before enrolling.");
        if(guardianLink.exists&&(guardianLink.data().schoolId!==ctx.schoolId||
           guardianLink.data().studentPersonId!==personId||
           guardianLink.data().guardianContactId!==guardianContactId))
          deny("failed-precondition","Guardian relationship identity collision requires Student Records review.");

        const priorRegistration=registration.exists?registration.data():null;
        if(priorRegistration&&priorRegistration.schoolId!==ctx.schoolId)
          deny("failed-precondition","Enrollment record collision requires review.");
        if(priorRegistration&&priorRegistration.status==="active")
          deny("failed-precondition","An official registration already exists for this placement. Use Registrations to review it instead of replacing its application link.");
        if(priorRegistration&&priorRegistration.status!=="active")
          deny("failed-precondition","A previous enrollment exists for this period. Restore or review it instead of silently recreating it.");

        const ended=enrollments.filter(doc=>doc.exists&&doc.data().status!=="active");
        if(ended.length)
          deny("failed-precondition",
            "One or more subject enrollments were previously ended. Review that history before re-enrolling the student.");

        const now=FieldValue.serverTimestamp();
        if(!guardianContact.exists){
          tx.create(guardianContactRef,{
            schoolId:ctx.schoolId,displayName:guardianName,email:guardianEmail,mobile:guardianMobile||"",
            status:"active",linkedUid:null,revision:1,createdByUid:ctx.uid,createdAt:now,updatedAt:now
          });
        }
        for(const other of otherGuardians){
          if(!other.exists||other.data().schoolId!==ctx.schoolId||other.data().status!=="active"||
             other.data().isPrimary!==true)continue;
          tx.update(other.ref,{isPrimary:false,revision:(Number(other.data().revision)||1)+1,
            updatedByUid:ctx.uid,updatedAt:now});
        }
        const guardianRevision=guardianLink.exists?(Number(guardianLink.data().revision)||1)+1:1;
        if(guardianLink.exists){
          tx.set(guardianRelationshipRef,{
            status:"active",isPrimary:true,
            relationship:String(guardianLink.data().relationship||guardianRelationship||"Guardian").slice(0,60),
            revision:guardianRevision,updatedByUid:ctx.uid,updatedAt:now,
            ...(guardianLink.data().status==="ended"?{
              restoredByUid:ctx.uid,restoredAt:now,restoreReason:"Official enrollment confirmed this guardian relationship."
            }:{})
          },{merge:true});
        }else{
          tx.create(guardianRelationshipRef,{
            schoolId:ctx.schoolId,studentPersonId:personId,guardianContactId,
            relationship:guardianRelationship,isPrimary:true,status:"active",revision:1,
            createdByUid:ctx.uid,createdAt:now,updatedAt:now
          });
        }
        tx.create(guardianAuditRef,{
          schoolId:ctx.schoolId,personId,actorUid:ctx.uid,
          guardianContactId,relationshipId:guardianRelationshipKey,
          action:guardianLink.exists?"guardian_relationship_confirmed_by_enrollment":"guardian_relationship_created_from_enrollment",
          revision:guardianRevision,createdAt:now
        });

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
          schoolId:ctx.schoolId,personId,displayName,studentNumber:studentNumber||(person.exists?person.data().studentNumber||null:null),birthDate,
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
          reusedDirectoryPerson:Boolean(explicitPersonId),
          guardianRelationshipId:guardianRelationshipKey};
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
  registrationOwnsEnrollment,
  progressionGradeValid,
  canReviewApplication,
  isReviewedApplicationRevision,
  normalizeAdmissionRequirements,
  admissionRequirementsReady,
  normalizeRequirementTemplate,
  templateCovered,
  pendingRequirementsReady,
  admissionApplicationId,
  acceptedIdentityMatches
};