"use strict";
/**
 * Public enrollment application intake for Manila Cathedral School.
 *
 * This callable accepts unauthenticated applications, but it never creates a
 * school membership, person record, class enrollment or login authority.
 * Registrar/School Admin review remains the authority boundary.
 */
const {FieldValue}=require("firebase-admin/firestore");
const {createHash}=require("node:crypto");
const {TenantAccessError}=require("./tenant-access.js");
const {standardSchool}=require("./school-enrollment.js");
// Current public intake remains an MCS pilot adapter. Keep this pilot selector
// local so the canonical Enrollment & Registration service stays school-neutral.
const PUBLIC_PILOT_SCHOOL_ID="manila-cathedral-school";

const LEVELS=new Set([
  "nursery_prep","kinder_1","kinder_2",
  "1","2","3","4","5","6","7","8","9","10","11","12",
  "sned_elem","sned_jhs"
]);
const APPLICATION_TYPES=new Set(["new","returning","transferee"]);
const EMAIL_TYPES=new Set(["personal","institutional"]);

function deny(code,message){throw new TenantAccessError(code,message)}
function required(value,label,max=160){
  const out=typeof value==="string"?value.trim():"";
  if(!out||out.length>max)deny("invalid-argument",label+" is required.");
  return out;
}
function optional(value,max=160){
  const out=typeof value==="string"?value.trim():"";
  if(out.length>max)deny("invalid-argument","One of the optional fields is too long.");
  return out||null;
}
function email(value,label){
  const out=required(value,label,254).toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out))
    deny("invalid-argument","Enter a valid "+label.toLowerCase()+".");
  return out;
}
function date(value,label){
  const out=required(value,label,10);
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
function publicReference(applicationId){
  return "MCS-"+applicationId.slice(0,10).toUpperCase();
}
function applicationIdFor({yearId,displayName,birthDate,guardianEmail}){
  return createHash("sha256")
    .update([PUBLIC_PILOT_SCHOOL_ID,yearId,displayName.toLowerCase(),birthDate,guardianEmail].join("\0"))
    .digest("hex").slice(0,48);
}

function createPublicSchoolEnrollmentService({db}){
  return async request=>{
    const input=request.data||{},action=String(input.action||"");
    if(String(input.schoolId||PUBLIC_PILOT_SCHOOL_ID)!==PUBLIC_PILOT_SCHOOL_ID)
      deny("failed-precondition","Public enrollment is not enabled for this school.");

    const schoolRef=db.doc("platform_schools/"+PUBLIC_PILOT_SCHOOL_ID);
    const school=await schoolRef.get();
    if(!school.exists||school.data().state!=="active"||!standardSchool(school.data()))
      deny("failed-precondition","Online enrollment is not currently open for this school.");

    const root="schools/"+PUBLIC_PILOT_SCHOOL_ID+"/";

    if(action==="catalog"){
      const [years,programs]=await Promise.all([
        db.collection(root+"academic_years").limit(50).get(),
        db.collection(root+"academic_programs").limit(50).get()
      ]);
      return {
        schoolId:PUBLIC_PILOT_SCHOOL_ID,
        schoolName:typeof school.data().name==="string"&&school.data().name.trim()
          ?school.data().name.trim().slice(0,140):"Manila Cathedral School",
        years:years.docs.filter(doc=>doc.data().schoolId===PUBLIC_PILOT_SCHOOL_ID&&doc.data().status==="active")
          .map(doc=>({id:doc.id,name:doc.data().name})),
        programs:programs.docs.filter(doc=>doc.data().schoolId===PUBLIC_PILOT_SCHOOL_ID&&doc.data().status==="active")
          .map(doc=>({id:doc.id,name:doc.data().name}))
      };
    }

    if(action==="submit_application"){
      // Honeypot is intentionally undocumented in the visible form.
      if(typeof input.website==="string"&&input.website.trim())
        deny("invalid-argument","This enrollment submission could not be accepted.");

      const applicationType=String(input.applicationType||"").trim().toLowerCase();
      if(!APPLICATION_TYPES.has(applicationType))
        deny("invalid-argument","Choose whether the learner is new, returning or transferring.");
      const displayName=required(input.displayName,"Student name",140);
      const birthDate=date(input.birthDate,"Birth date");
      const incomingLevel=String(input.incomingLevel||"").trim().toLowerCase();
      if(!LEVELS.has(incomingLevel))deny("invalid-argument","Choose a valid incoming grade or school level.");

      const guardianName=required(input.guardianName,"Parent/guardian name",140);
      const guardianRelationship=required(input.guardianRelationship,"Parent/guardian relationship",60);
      const guardianEmail=email(input.guardianEmail,"Parent/guardian email");
      const guardianMobile=optional(input.guardianMobile,40);

      const studentEmailRequired=gradeRequiresStudentEmail(incomingLevel);
      const rawStudentEmail=typeof input.studentEmail==="string"?input.studentEmail.trim():"";
      const studentEmail=rawStudentEmail?email(rawStudentEmail,"Student email"):null;
      const studentEmailType=studentEmail?String(input.studentEmailType||"").trim().toLowerCase():null;
      if(studentEmailRequired&&!studentEmail)
        deny("invalid-argument","A student email is required for Grade 7 and above.");
      if(!studentEmailRequired&&studentEmail)
        deny("invalid-argument","Student email is not collected below Grade 7. Use the parent/guardian email for enrollment communication.");
      if(studentEmail&&!EMAIL_TYPES.has(studentEmailType))
        deny("invalid-argument","Choose whether the student email is personal or institutional.");
      if(studentEmail&&studentEmail===guardianEmail)
        deny("invalid-argument","Student and parent/guardian email must be different.");

      const yearId=required(input.yearId,"School year",80);
      const year=await db.doc(root+"academic_years/"+yearId).get();
      if(!year.exists||year.data().schoolId!==PUBLIC_PILOT_SCHOOL_ID||year.data().status!=="active")
        deny("failed-precondition","The selected school year is not open for enrollment.");

      const preferredProgramId=optional(input.preferredProgramId,80);
      if(preferredProgramId){
        const program=await db.doc(root+"academic_programs/"+preferredProgramId).get();
        if(!program.exists||program.data().schoolId!==PUBLIC_PILOT_SCHOOL_ID||program.data().status!=="active")
          deny("failed-precondition","The selected program/division is not available.");
      }

      if(input.consent!==true)
        deny("invalid-argument","Parent/guardian acknowledgment is required before submitting enrollment.");

      const applicationId=applicationIdFor({yearId,displayName,birthDate,guardianEmail});
      const ref=db.doc(root+"enrollment_applications/"+applicationId);
      const now=FieldValue.serverTimestamp();
      let status="submitted",revision=1;
      await db.runTransaction(async tx=>{
        const current=await tx.get(ref);
        if(current.exists){
          const prior=current.data();
          if(prior.schoolId!==PUBLIC_PILOT_SCHOOL_ID)
            deny("failed-precondition","Enrollment application identity collision requires school review.");
          if(["accepted","enrolled","rejected","withdrawn"].includes(prior.status))
            deny("failed-precondition","This application is locked for school review. Contact the Registrar if corrections are needed.");
          revision=(Number(prior.revision)||1)+1;
          status=prior.status==="needs_information"?"submitted":(prior.status||"submitted");
          tx.set(ref,{
            schoolId:PUBLIC_PILOT_SCHOOL_ID,applicationType,displayName,birthDate,incomingLevel,
            yearId,preferredProgramId,guardianName,guardianRelationship,guardianEmail,guardianMobile,
            studentEmail,studentEmailType,studentEmailRequired,source:"online",status,
            reference:publicReference(applicationId),consentAcknowledged:true,revision,updatedAt:now,lastSubmittedAt:now
          },{merge:true});
        }else{
          tx.create(ref,{
            schoolId:PUBLIC_PILOT_SCHOOL_ID,applicationType,displayName,birthDate,incomingLevel,
            yearId,preferredProgramId,guardianName,guardianRelationship,guardianEmail,guardianMobile,
            studentEmail,studentEmailType,studentEmailRequired,source:"online",status:"submitted",
            reference:publicReference(applicationId),consentAcknowledged:true,revision:1,createdAt:now,updatedAt:now,lastSubmittedAt:now
          });
        }
      });
      return {
        applicationId,
        reference:publicReference(applicationId),
        status,
        studentEmailRequired,
        message:"Enrollment application submitted for school review."
      };
    }

    deny("invalid-argument","Unknown public enrollment operation.");
  };
}

module.exports={
  createPublicSchoolEnrollmentService,
  gradeRequiresStudentEmail,
  LEVELS
};
