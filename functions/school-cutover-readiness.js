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
const {SCHEMA:CUTOVER_DECISION_SCHEMA,evaluateCutoverDecisionRecord}=
 require("./school-cutover-policy.js");

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

 const decisionDoc=await db.doc("platform_schools/"+schoolId+"/private_config/cutover_decisions").get(),
  decisionState=evaluateCutoverDecisionRecord(decisionDoc.exists?decisionDoc.data():null,{
   schoolId,firstAdminUid:schoolData.firstAdminUid||null
  });
 check("owner_cutover_decisions",decisionState.ok,
  "Platform-owner cutover decisions are documented",
  decisionState.ok?
   "Authority, calendar, privacy, retention, backup, data-steward, AI and repository decisions are bound to the designated first school administrator.":
   "Missing or stale owner decision fields: "+decisionState.missing.join(", ")+".");
 const stewardRole=decisionDoc.data()?.dataStewardRole||null;
 let stewardRoleOkay=stewardRole==="school_admin",stewardDetail=
  stewardRole==="school_admin"?"School Admin is the default data steward.":"";
 if(stewardRole&&stewardRole!=="school_admin"){
  const [assignment,definition]=await Promise.all([
   db.doc("platform_schools/"+schoolId+"/governance_roles/"+stewardRole).get(),
   db.doc("platform_governance_roles/"+stewardRole).get()
  ]);
  stewardRoleOkay=assignment.exists&&assignment.data().status==="active"&&
   definition.exists&&definition.data().status==="active";
  stewardDetail=stewardRoleOkay?
   "Custom governance role "+stewardRole+" is active and assigned to this school.":
   "Custom data-steward role "+stewardRole+" is not an active assigned governance role.";
 }
 check("data_steward_governance",Boolean(stewardRole)&&stewardRoleOkay,
  "Data-steward governance role is valid",
  stewardRole?stewardDetail:"No data-steward role is recorded.");

 const [members,programs,years,terms,subjects,sections,offerings,enrollments,assignments,tasks,grades,
  practiceMarkers]=await Promise.all([
   bounded(db,prefix+"memberships"),bounded(db,prefix+"academic_programs"),
   bounded(db,prefix+"academic_years"),bounded(db,prefix+"terms"),
   bounded(db,prefix+"subjects"),bounded(db,prefix+"sections"),
   bounded(db,prefix+"course_offerings"),bounded(db,prefix+"enrollments"),
   bounded(db,prefix+"staff_assignments"),bounded(db,prefix+"assessments"),
   bounded(db,prefix+"student_grades",1001),bounded(db,prefix+"practice_migration_state")
 ]);
 const activeMembers=members.filter(doc=>doc.data().schoolId===schoolId&&doc.data().status==="active"),
  activeAdmins=activeMembers.filter(doc=>Array.isArray(doc.data().roles)&&doc.data().roles.includes("school_admin")),
  activeStudents=activeMembers.filter(doc=>Array.isArray(doc.data().roles)&&doc.data().roles.includes("student")),
  activeTeachers=activeMembers.filter(doc=>Array.isArray(doc.data().roles)&&doc.data().roles.includes("teacher")),
  activeCatalog=docs=>docs.filter(doc=>doc.data().schoolId===schoolId&&doc.data().status==="active"),
  activePrograms=activeCatalog(programs),activeYears=activeCatalog(years),activeTerms=activeCatalog(terms),
  activeSubjects=activeCatalog(subjects),activeSections=activeCatalog(sections),
  activeOfferings=offerings.filter(doc=>doc.data().schoolId===schoolId&&doc.data().status==="active"),
  activeEnrollments=enrollments.filter(doc=>doc.data().schoolId===schoolId&&doc.data().status==="active"),
  activeAssignments=assignments.filter(doc=>doc.data().schoolId===schoolId&&doc.data().status==="active"),
  deployedTasks=tasks.filter(doc=>doc.data().schoolId===schoolId&&doc.data().status==="deployed"&&
    doc.data().lifecycle!=="cancelled"),
  publishedGrades=grades.filter(doc=>doc.data().schoolId===schoolId&&doc.data().status==="published");
 Object.assign(counts,{
  activeMemberships:activeMembers.length,activeAdmins:activeAdmins.length,
  activeStudents:activeStudents.length,activeTeachers:activeTeachers.length,
  academicPrograms:activePrograms.length,academicYears:activeYears.length,
  terms:activeTerms.length,subjects:activeSubjects.length,sections:activeSections.length,
  activeOfferings:activeOfferings.length,activeEnrollments:activeEnrollments.length,
  activeAssignments:activeAssignments.length,deployedAssessments:deployedTasks.length,
  publishedGrades:publishedGrades.length
 });
 check("active_admin",activeAdmins.length>0,"At least one active school administrator",
  activeAdmins.length+" active school administrator(s).");
 const activeProgramIds=new Set(activePrograms.map(doc=>doc.id)),
  activeYearIds=new Set(activeYears.map(doc=>doc.id)),
  activeTermIds=new Set(activeTerms.map(doc=>doc.id)),
  activeSubjectIds=new Set(activeSubjects.map(doc=>doc.id)),
  activeSectionIds=new Set(activeSections.map(doc=>doc.id)),
  invalidTerms=activeTerms.filter(doc=>
   !activeYearIds.has(doc.data().yearId)||!activeProgramIds.has(doc.data().programId)||
   !["term","semester","quarter","trimester","custom"].includes(doc.data().periodType)||
   !Number.isInteger(doc.data().sequence)||doc.data().sequence<1||doc.data().sequence>12),
  invalidSections=activeSections.filter(doc=>!activeProgramIds.has(doc.data().programId)),
  invalidOfferings=activeOfferings.filter(doc=>{
   const data=doc.data(),term=activeTerms.find(item=>item.id===data.termId),
    section=activeSections.find(item=>item.id===data.sectionId);
   return !activeProgramIds.has(data.programId)||!activeYearIds.has(data.yearId)||
    !activeTermIds.has(data.termId)||!activeSubjectIds.has(data.subjectId)||
    !activeSectionIds.has(data.sectionId)||term?.data().yearId!==data.yearId||
    term?.data().programId!==data.programId||section?.data().programId!==data.programId;
  });
 check("academic_catalog",activePrograms.length>0&&activeYears.length>0&&activeTerms.length>0&&
   activeSubjects.length>0&&activeSections.length>0&&invalidTerms.length===0&&invalidSections.length===0,
  "Active academic catalog is coherent",
  activePrograms.length+" active program(s), "+activeYears.length+" active year(s), "+
  activeTerms.length+" active academic period(s), "+activeSubjects.length+" active subject(s), "+
  activeSections.length+" active section(s); "+(invalidTerms.length+invalidSections.length)+
  " invalid program/year/period relationship(s).");
 check("course_offerings",activeOfferings.length>0&&invalidOfferings.length===0,
  "Active course offerings resolve to the active catalog",
  activeOfferings.length+" active offering(s); "+invalidOfferings.length+
  " have inactive or mismatched catalog dependencies.");

 const peopleById=new Map(),people=await bounded(db,prefix+"people",1001),
  personIdsByAuthUid=new Map();
 for(const doc of people){
  peopleById.set(doc.id,doc.data());
  const uid=doc.data().authUid;
  if(typeof uid==="string"&&uid){
   const ids=personIdsByAuthUid.get(uid)||[];ids.push(doc.id);personIdsByAuthUid.set(uid,ids);
  }
 }
 counts.people=people.length;
 const duplicatePersonLinks=[...personIdsByAuthUid.entries()].filter(([,ids])=>ids.length>1);
 check("unique_person_account_links",duplicatePersonLinks.length===0,
  "Each verified account maps to at most one school person record",
  duplicatePersonLinks.length?duplicatePersonLinks.length+" account UID(s) are linked to multiple people.":"No duplicate person/account links.");
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
 const teacherIdentityIssues=[];
 for(const member of activeTeachers){
  const personId=member.data().personId,person=peopleById.get(personId);
  if(!personId||!person||person.schoolId!==schoolId||person.kind!=="staff"||
     person.status!=="active"||person.authUid!==member.id)
   teacherIdentityIssues.push(member.id);
 }
 check("teacher_identity_links",teacherIdentityIssues.length===0,
  "Active teacher memberships have canonical staff-person links",
  teacherIdentityIssues.length?teacherIdentityIssues.length+" teacher membership(s) need identity repair.":"All active teacher memberships reconcile.");
 const roleless=activeMembers.filter(doc=>!Array.isArray(doc.data().roles)||!doc.data().roles.length);
 check("membership_roles",roleless.length===0,
  "Active memberships carry at least one verified school role",
  roleless.length?roleless.length+" active membership(s) have no role.":"All active memberships have roles.");

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
