"use strict";
/**
 * Adminerva 4.0 school onboarding/setup readiness.
 *
 * This is an operational setup checklist for active school administrators.
 * It intentionally does not replace migration/cutover readiness and never
 * grants roles, changes school state or exposes private teacher/student data.
 */
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");

function deny(code,message){throw new TenantAccessError(code,message)}
async function bounded(db,path,limit=1001){
  const snapshot=await db.collection(path).limit(limit).get();
  if(snapshot.size===limit)
    deny("resource-exhausted","School setup readiness exceeded its bounded review limit for "+path+".");
  return snapshot.docs;
}
function row(id,label,ok,detail,{blocking=true,optional=false,count=null}={}){
  return {
    id,label,status:ok?"complete":optional?"optional":"attention",
    blocking:Boolean(blocking),detail:String(detail||""),
    ...(Number.isInteger(count)?{count}: {})
  };
}
async function evaluateSchoolOnboardingReadiness({db,schoolId}){
  const prefix="schools/"+schoolId+"/";
  const school=await db.doc("platform_schools/"+schoolId).get();
  if(!school.exists)deny("not-found","The verified school record is unavailable.");

  const [
    memberships,people,years,terms,subjects,sections,offerings,enrollments,
    assignments,invitations,filePolicy,aiConfig
  ]=await Promise.all([
    bounded(db,prefix+"memberships"),
    bounded(db,prefix+"people"),
    bounded(db,prefix+"academic_years"),
    bounded(db,prefix+"terms"),
    bounded(db,prefix+"subjects"),
    bounded(db,prefix+"sections"),
    bounded(db,prefix+"course_offerings"),
    bounded(db,prefix+"enrollments"),
    bounded(db,prefix+"staff_assignments"),
    bounded(db,prefix+"invitations"),
    db.doc(prefix+"private_config/file_policy").get(),
    db.doc(prefix+"private_config/ai").get()
  ]);

  const schoolData=school.data();
  const activeMemberships=memberships.filter(doc=>
    doc.data().schoolId===schoolId&&doc.data().status==="active");
  const hasRole=role=>activeMemberships.filter(doc=>
    Array.isArray(doc.data().roles)&&doc.data().roles.includes(role));
  const admins=hasRole("school_admin"),teachers=hasRole("teacher"),students=hasRole("student");
  const activePeople=people.filter(doc=>doc.data().schoolId===schoolId&&doc.data().status==="active");
  const activeOfferings=offerings.filter(doc=>doc.data().schoolId===schoolId&&doc.data().status==="active");
  const activeEnrollments=enrollments.filter(doc=>doc.data().schoolId===schoolId&&doc.data().status==="active");
  const activeAssignments=assignments.filter(doc=>doc.data().schoolId===schoolId&&doc.data().status==="active");
  const pendingInvitations=invitations.filter(doc=>doc.data().schoolId===schoolId&&doc.data().status==="pending");
  const readiness=schoolData.readiness||{};
  const institutionalReady=[
    "institutionalDataAuthority","provenanceVerified","calendarConfigured","privacyPolicyApproved"
  ].every(key=>readiness[key]===true);
  const catalogReady=years.length>0&&terms.length>0&&subjects.length>0&&sections.length>0;
  const fileData=filePolicy.exists?filePolicy.data():null;
  const aiData=aiConfig.exists?aiConfig.data():null;

  const steps=[
    row("institution","Institution verification",schoolData.state==="active"&&institutionalReady,
      schoolData.state!=="active"
        ?"The institution is not active."
        :institutionalReady
          ?"Institution authority, provenance, calendar and privacy attestations are recorded."
          :"One or more owner-reviewed institutional attestations are still missing."),
    row("school_admin","School administration",admins.length>0,
      admins.length+" active school administrator account(s).",{count:admins.length}),
    row("people","People directory",activePeople.length>0,
      activePeople.length+" active person record(s) are available.",{count:activePeople.length}),
    row("teacher_access","Teacher access",teachers.length>0,
      teachers.length+" active teacher membership(s).",{count:teachers.length}),
    row("student_access","Student access",students.length>0,
      students.length+" active student membership(s).",{count:students.length}),
    row("academic_catalog","Academic catalog",catalogReady,
      years.length+" year(s), "+terms.length+" term(s), "+subjects.length+
      " subject(s), "+sections.length+" section(s)."),
    row("course_offerings","Course offerings",activeOfferings.length>0,
      activeOfferings.length+" active course offering(s).",{count:activeOfferings.length}),
    row("teaching_assignments","Teaching assignments",activeAssignments.length>0,
      activeAssignments.length+" active teacher-course assignment(s).",{count:activeAssignments.length}),
    row("student_enrollments","Student enrollments",activeEnrollments.length>0,
      activeEnrollments.length+" active course enrollment(s).",{count:activeEnrollments.length}),
    row("file_policy","School file policy",
      Boolean(fileData?.enabled&&fileData?.supportAttachmentsEnabled),
      fileData?.enabled
        ?"School file retention is configured; support attachments are "+
          (fileData.supportAttachmentsEnabled===true?"enabled.":"still disabled.")
        :"School file uploads remain fail-closed until an administrator enables a retention policy.",
      {blocking:false,optional:true}),
    row("school_ai","School AI",
      Boolean(aiData?.enabled&&aiData?.apiKey),
      aiData?.enabled&&aiData?.apiKey
        ?"A school-scoped AI connection is configured."
        :"School AI is optional and remains unavailable until a school administrator configures it.",
      {blocking:false,optional:true})
  ];

  const blocking=steps.filter(item=>item.blocking);
  const completedRequired=blocking.filter(item=>item.status==="complete").length;
  return {
    schoolId,
    schoolDisplayName:String(schoolData.displayName||schoolId).slice(0,120),
    operationalReady:completedRequired===blocking.length,
    progress:{completedRequired,totalRequired:blocking.length},
    counts:{
      activeMemberships:activeMemberships.length,
      activePeople:activePeople.length,
      activeAdmins:admins.length,
      activeTeachers:teachers.length,
      activeStudents:students.length,
      activeOfferings:activeOfferings.length,
      activeEnrollments:activeEnrollments.length,
      activeAssignments:activeAssignments.length,
      pendingInvitations:pendingInvitations.length
    },
    steps,
    note:"School setup readiness covers ordinary V4 operation only. Migration reconciliation, continuity backup and legacy retirement are checked separately by 4.0 cutover readiness."
  };
}
function createSchoolOnboardingReadinessService({db}){
  return async request=>{
    const input=request.data||{};
    const ctx=await getSchoolContext({
      db,request,schoolId:input.schoolId,roles:["school_admin"]
    });
    if((input.action||"overview")!=="overview")
      deny("invalid-argument","Unknown school setup-readiness operation.");
    return evaluateSchoolOnboardingReadiness({db,schoolId:ctx.schoolId});
  };
}
module.exports={evaluateSchoolOnboardingReadiness,createSchoolOnboardingReadinessService};
