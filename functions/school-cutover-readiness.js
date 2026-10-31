"use strict";
/**
 * Read-only Adminerva 4.0 school cutover readiness.
 *
 * This checks canonical referential/access integrity. It does not inspect
 * teacher-private content and does not itself change compatibility mode.
 */
const {checkedSchoolId,verifiedUid,getSchoolContext,platformAuthority,TenantAccessError}=
 require("./tenant-access.js");
const {EXPORT_SCHEMA}=require("./school-data-export.js");

function deny(code,message){throw new TenantAccessError(code,message)}
async function authorized({db,request,schoolId}){
 const uid=verifiedUid(request);
 try{
  const ctx=await getSchoolContext({db,request,schoolId,roles:["school_admin"]});
  return {uid,schoolId:ctx.schoolId,role:"school_admin"};
 }catch(error){
  if(!(error instanceof TenantAccessError)||error.code==="unauthenticated")throw error;
  const authority=await platformAuthority({db,request});
  if(!authority.platformAdmin)throw error;
  return {uid,schoolId:checkedSchoolId(schoolId),role:"platform_admin"};
 }
}
async function bounded(db,path,limit=501){
 const snap=await db.collection(path).limit(limit).get();
 if(snap.size===limit)throw new TenantAccessError("resource-exhausted",
  "Cutover readiness exceeded its bounded review limit for "+path+".");
 return snap.docs;
}
async function evaluateSchoolCutoverReadiness({db,schoolId}){
 const prefix="schools/"+schoolId+"/",school=await db.doc("platform_schools/"+schoolId).get();
 const checks=[],blockers=[],warnings=[],counts={};
 const check=(id,ok,label,detail,blocking=true)=>{
  const row={id,ok:Boolean(ok),label,detail:String(detail||"")};checks.push(row);
  if(!ok)(blocking?blockers:warnings).push(row);return row;
 };
 if(!school.exists){
  check("school_exists",false,"School record exists","No platform school record.");
  return {schoolId,ready:false,compatibilityMode:"legacy_allowed",counts,checks,blockers,warnings};
 }
 const schoolData=school.data(),compatibilityMode=schoolData.compatibilityMode||"legacy_allowed";
 check("school_active",schoolData.state==="active","School is active",
  "Current state: "+String(schoolData.state||"unknown"));

 const [members,years,terms,subjects,sections,offerings,enrollments,assignments,tasks,grades,
  practiceMarkers]=await Promise.all([
   bounded(db,prefix+"memberships"),bounded(db,prefix+"academic_years"),
   bounded(db,prefix+"terms"),bounded(db,prefix+"subjects"),bounded(db,prefix+"sections"),
   bounded(db,prefix+"course_offerings"),bounded(db,prefix+"enrollments"),
   bounded(db,prefix+"staff_assignments"),bounded(db,prefix+"assessments"),
   bounded(db,prefix+"student_grades",1001),bounded(db,prefix+"practice_migration_state")
 ]);
 const activeMembers=members.filter(doc=>doc.data().schoolId===schoolId&&doc.data().status==="active"),
  activeAdmins=activeMembers.filter(doc=>Array.isArray(doc.data().roles)&&doc.data().roles.includes("school_admin")),
  activeStudents=activeMembers.filter(doc=>Array.isArray(doc.data().roles)&&doc.data().roles.includes("student")),
  activeTeachers=activeMembers.filter(doc=>Array.isArray(doc.data().roles)&&doc.data().roles.includes("teacher")),
  activeOfferings=offerings.filter(doc=>doc.data().schoolId===schoolId&&doc.data().status==="active"),
  activeEnrollments=enrollments.filter(doc=>doc.data().schoolId===schoolId&&doc.data().status==="active"),
  activeAssignments=assignments.filter(doc=>doc.data().schoolId===schoolId&&doc.data().status==="active"),
  deployedTasks=tasks.filter(doc=>doc.data().schoolId===schoolId&&doc.data().status==="deployed"&&
    doc.data().lifecycle!=="cancelled"),
  publishedGrades=grades.filter(doc=>doc.data().schoolId===schoolId&&doc.data().status==="published");
 Object.assign(counts,{
  activeMemberships:activeMembers.length,activeAdmins:activeAdmins.length,
  activeStudents:activeStudents.length,activeTeachers:activeTeachers.length,
  academicYears:years.length,terms:terms.length,subjects:subjects.length,sections:sections.length,
  activeOfferings:activeOfferings.length,activeEnrollments:activeEnrollments.length,
  activeAssignments:activeAssignments.length,deployedAssessments:deployedTasks.length,
  publishedGrades:publishedGrades.length
 });
 check("active_admin",activeAdmins.length>0,"At least one active school administrator",
  activeAdmins.length+" active school administrator(s).");
 check("academic_catalog",years.length>0&&terms.length>0&&subjects.length>0&&sections.length>0,
  "Academic catalog is configured",
  years.length+" year(s), "+terms.length+" term(s), "+subjects.length+" subject(s), "+sections.length+" section(s).");
 check("course_offerings",activeOfferings.length>0,"At least one active course offering",
  activeOfferings.length+" active offering(s).");

 const peopleById=new Map(),people=await bounded(db,prefix+"people",1001);
 for(const doc of people)peopleById.set(doc.id,doc.data());
 counts.people=people.length;
 const memberByUid=new Map(activeMembers.map(doc=>[doc.id,doc.data()])),
  offeringById=new Map(activeOfferings.map(doc=>[doc.id,doc.data()])),
  assignmentKey=new Set(activeAssignments.map(doc=>doc.data().teacherUid+"|"+doc.data().offeringId)),
  taskById=new Map(deployedTasks.map(doc=>[doc.id,doc.data()]));

 const studentIdentityIssues=[];
 for(const member of activeStudents){
  const personId=member.data().personId,person=peopleById.get(personId);
  if(!personId||!person||person.schoolId!==schoolId||person.kind!=="student"||
     person.status!=="active"||person.authUid!==member.id)
   studentIdentityIssues.push(member.id);
 }
 check("student_identity_links",studentIdentityIssues.length===0,
  "Active student memberships have canonical person links",
  studentIdentityIssues.length?studentIdentityIssues.length+" student membership(s) need identity repair.":"All active student memberships reconcile.");

 const enrollmentIssues=[];
 for(const enrollment of activeEnrollments){
  const data=enrollment.data(),person=peopleById.get(data.personId),offering=offeringById.get(data.offeringId);
  if(!person||person.kind!=="student"||person.status!=="active"||!offering)
   enrollmentIssues.push(enrollment.id);
 }
 check("active_enrollments",enrollmentIssues.length===0,
  "Active enrollments resolve to active people and offerings",
  enrollmentIssues.length?enrollmentIssues.length+" active enrollment(s) are inconsistent.":"Active enrollment dependencies reconcile.");

 const assignmentIssues=[];
 for(const assignment of activeAssignments){
  const data=assignment.data(),member=memberByUid.get(data.teacherUid),offering=offeringById.get(data.offeringId);
  if(!member||!Array.isArray(member.roles)||!member.roles.includes("teacher")||!offering)
   assignmentIssues.push(assignment.id);
 }
 check("teaching_assignments",assignmentIssues.length===0,
  "Active teacher assignments resolve to active teacher memberships",
  assignmentIssues.length?assignmentIssues.length+" teaching assignment(s) are inconsistent.":"Active teaching assignments reconcile.");

 const taskIssues=[];
 for(const task of deployedTasks){
  const data=task.data(),reviewerUid=data.reviewerUid||data.ownerUid;
  if(!offeringById.has(data.offeringId)||!memberByUid.has(reviewerUid)||
     !memberByUid.get(reviewerUid).roles?.includes("teacher")||
     !assignmentKey.has(reviewerUid+"|"+data.offeringId))
   taskIssues.push(task.id);
 }
 check("assessment_responsibility",taskIssues.length===0,
  "Deployed assessments have an active responsible teacher",
  taskIssues.length?taskIssues.length+" deployment(s) would be stranded.":"Deployment responsibility reconciles.");

 const gradeIssues=[];
 for(const grade of publishedGrades){
  const data=grade.data(),person=peopleById.get(data.personId),member=memberByUid.get(data.studentUid),
    task=taskById.get(data.taskId)||tasks.find(doc=>doc.id===data.taskId)?.data();
  if(!task||!person||person.authUid!==data.studentUid||!member||
     !member.roles?.includes("student")||member.personId!==data.personId)
   gradeIssues.push(grade.id);
 }
 check("published_grade_links",gradeIssues.length===0,
  "Published grades retain task/student identity linkage",
  gradeIssues.length?gradeIssues.length+" published grade(s) need reconciliation.":"Published grade dependencies reconcile.");

 const incompletePractice=practiceMarkers.filter(doc=>doc.data().schoolId===schoolId&&doc.data().status==="in_progress");
 check("practice_migration_complete",incompletePractice.length===0,
  "No student Practice migration is left in progress",
  incompletePractice.length?incompletePractice.length+" Practice migration(s) are incomplete.":"No in-progress Practice migration markers.");

 if(schoolData.storageEnabled===true){
  const policy=await db.doc(prefix+"private_config/file_policy").get();
  check("file_policy",policy.exists&&policy.data().enabled===true&&
    policy.data().supportAttachmentsEnabled===true,
    "Enabled Storage has an explicit school file policy",
    policy.exists?"File policy record found.":"Storage is enabled without an active file-policy record.");
 }else{
  check("file_policy",true,"Storage remains fail-closed or explicitly governed",
    "School Storage is not enabled.",false);
 }
 const exportReceipt=await db.doc(prefix+"private_config/continuity_export").get();
 const preparedAt=exportReceipt.data()?.preparedAt?.toMillis?.()||0,
  receiptAge=preparedAt?Date.now()-preparedAt:Number.POSITIVE_INFINITY,
  receiptOkay=exportReceipt.exists&&exportReceipt.data().schoolId===schoolId&&
   exportReceipt.data().schema===EXPORT_SCHEMA&&
   /^[a-f0-9]{64}$/.test(String(exportReceipt.data().bundleSha256||""))&&
   receiptAge>=0&&receiptAge<=24*60*60*1000;
 check("continuity_export_receipt",receiptOkay,
  "Recent integrity-verified continuity export is prepared",
  receiptOkay?
   "Verified continuity export receipt recorded within the last 24 hours.":
   exportReceipt.exists?
    "The recorded continuity export is stale or not on the current export schema. Prepare a fresh verified export before cutover.":
    "No verified continuity export receipt is recorded. Prepare a school continuity export before cutover.");

 const readiness=schoolData.readiness||{};
 check("institutional_attestations",
  ["institutionalDataAuthority","provenanceVerified","calendarConfigured","privacyPolicyApproved"]
    .every(key=>readiness[key]===true),
  "Institutional activation attestations remain recorded",
  "Authority, provenance, calendar and privacy attestations must remain true.");

 return {
  schoolId,schoolDisplayName:String(schoolData.displayName||schoolId).slice(0,120),
  compatibilityMode,schoolState:schoolData.state||null,counts,checks,blockers,warnings,
  ready:blockers.length===0,
  note:"Technical readiness does not replace the protected migration ledger, continuity backup, institutional approval or operator rollback review."
 };
}
function createSchoolCutoverReadinessService({db}){
 return async request=>{
  const input=request.data||{},ctx=await authorized({db,request,schoolId:input.schoolId});
  if((input.action||"overview")!=="overview")
   deny("invalid-argument","Unknown cutover-readiness operation.");
  return {...await evaluateSchoolCutoverReadiness({db,schoolId:ctx.schoolId}),
    viewerRole:ctx.role};
 };
}
module.exports={evaluateSchoolCutoverReadiness,createSchoolCutoverReadinessService};
