"use strict";

/**
 * Protected MCS SHS controlled-pilot operator.
 * Runs only in an approved GitHub Actions environment with application-default
 * credentials. It never starts the pilot, enables v4_only, publishes a release,
 * or migrates historical assessments/grades/planning/Practice.
 *
 * Private identity and source details stay in memory. Logs are aggregate only.
 */
const {initializeApp,getApps,applicationDefault}=require("firebase-admin/app");
const {getFirestore,FieldValue}=require("firebase-admin/firestore");
const {getAuth}=require("firebase-admin/auth");
const {createHash}=require("node:crypto");

const defaults=require("../docs/adminerva-4-mcs-pilot-academic-defaults.json");
const {identityCandidates}=require("../functions/mcs-identity-candidates.js");
const {canonicalDigest}=require("../functions/mcs-migration-ledger.js");
const {buildFoundationPlan}=require("../functions/mcs-canonical-foundation-plan.js");
const {matchSection}=require("../functions/mcs-shs-pilot-foundation-plan.js");
const {createPilotTemplate}=require("../functions/mcs-shs-pilot-foundation-approval-template.js");
const {SCHEMA:OPERATOR_SCHEMA}=require("../functions/mcs-shs-pilot-operator-template.js");
const {
  validatePlan:validateFoundationPlan,
  validateApproval:validateFoundationApproval,
  applyFoundation
}=require("../functions/mcs-canonical-foundation-apply.js");
const {buildAcademicAccessPlan}=require("../functions/mcs-canonical-academic-access-plan.js");
const {createTemplate:createAccessTemplate}=require("../functions/mcs-canonical-academic-access-approval-template.js");
const {
  validatePlan:validateAccessPlan,
  validateApproval:validateAccessApproval,
  applyAccess
}=require("../functions/mcs-canonical-academic-access-apply.js");

const SCHOOL_ID="mcs-manila";
const SCHOOL_NAME="Manila Cathedral School";
const ACADEMIC_YEAR={yearId:"2026-2027",name:"2026-2027",startMonth:7,endMonth:5};
const ACTIVE_SECTION_IDS=[
 "shs-g11-techpro-ict-st-isidore-of-seville",
 "shs-g11-techpro-ict-st-carlo-acutis",
 "shs-g12-tvl-ict-st-philip-the-apostle",
 "shs-g12-tvl-ict-st-anselm-of-canterbury"
];
const PENDING_SECTION_IDS=["shs-g11-techpro-ict-st-sebastian"];
const OPERATOR_ACTOR="migration";

function fail(code){const error=new Error(code);error.pilotCode=code;throw error;}
function sha(value){return createHash("sha256").update(value).digest("hex");}
function rawJson(value){return Buffer.from(JSON.stringify(value,null,2)+"\n","utf8");}
function norm(value){return typeof value==="string"?value.trim().toLowerCase():"";}
function activeStatus(value){
 return !["archived","suspended","inactive","disabled","deleted"].includes(norm(value||"active"));
}
function maxIso(values){
 const millis=values.filter(Number.isFinite);
 return new Date(millis.length?Math.max(...millis):Date.parse("2026-11-08T00:00:00.000Z")).toISOString();
}
function updateMillis(doc){
 try{return doc.updateTime?.toDate?.().getTime?.()??NaN;}catch{return NaN;}
}
function exactSection(label,activeSections){
 const key=norm(label);
 return activeSections.find(section=>[section.name,...(section.legacyLabels||[])].some(value=>norm(value)===key))||null;
}
function projectedStudentPath(id){
 return "schools/"+SCHOOL_ID+"/legacy_roots/students/documents/"+id;
}
function projectedTeacherPath(id){
 return "schools/"+SCHOOL_ID+"/legacy_roots/teachers/documents/"+id;
}
function approveFoundation(template){
 template.approvedBy="controlled-pilot-operator";
 template.approvedAt=new Date().toISOString();
 for(const key of Object.keys(template.acknowledgements||{}))template.acknowledgements[key]=true;
 for(const row of template.people||[]){
   row.approveIdentityLink=true;
   row.approvedDisplayName=row.displayName;
   row.approvedStatus=row.status;
 }
 for(const row of template.memberships||[]){
   row.approveMembership=true;
   row.approvedRoles=[...(row.proposedRoles||[])];
   row.approvedStatus=row.approvedStatus||"active";
 }
 for(const group of Object.values(template.academic||{}))
   for(const row of group||[])row.approved=true;
 for(const row of template.courseOfferings||[])row.approved=true;
 template.reviewNotes="Scoped MCS SHS controlled pilot. Four populated ICT sections only; historical academic content and St. Sebastian remain deferred.";
 return template;
}
function approveAccess(template){
 template.approvedBy="controlled-pilot-operator";
 template.approvedAt=new Date().toISOString();
 for(const key of Object.keys(template.acknowledgements||{}))template.acknowledgements[key]=true;
 for(const row of template.enrollments||[]){row.decision="approve";row.exclusionReason="";}
 for(const row of template.assignments||[]){row.decision="approve";row.exclusionReason="";}
 template.reviewNotes="Current four-section MCS SHS controlled pilot relationships only.";
 return template;
}
async function bootstrapDraftAndAdmin(db,auth,teacherUid){
 const authUser=await auth.getUser(teacherUid);
 if(!authUser||authUser.disabled||authUser.emailVerified!==true)fail("pilot_teacher_auth_not_active_verified");
 const schoolRef=db.doc("platform_schools/"+SCHOOL_ID);
 const memberRef=db.doc("schools/"+SCHOOL_ID+"/memberships/"+teacherUid);
 const indexRef=db.doc("platform_users/"+teacherUid+"/memberships/"+SCHOOL_ID);
 await db.runTransaction(async tx=>{
   const [school,member,index]=await Promise.all([tx.get(schoolRef),tx.get(memberRef),tx.get(indexRef)]);
   if(school.exists){
     const data=school.data();
     if(data.state!=="draft")fail("school_not_draft");
     if(data.productionAuthorized===true)fail("school_already_production_authorized");
     if(data.firstAdminUid&&data.firstAdminUid!==teacherUid)fail("first_school_admin_conflict");
   }
   if(member.exists&&member.data().status==="suspended")fail("pilot_teacher_membership_suspended");
   if(index.exists&&index.data().status==="suspended")fail("pilot_teacher_index_suspended");
   const now=FieldValue.serverTimestamp();
   const existingRoles=member.exists&&Array.isArray(member.data().roles)?member.data().roles:[];
   const roles=[...new Set([...existingRoles,"school_admin"])].sort();
   const revision=Math.max(Number(member.data()?.revision)||0,Number(index.data()?.revision)||0)+1;
   if(!school.exists){
     tx.create(schoolRef,{
       displayName:SCHOOL_NAME,state:"draft",revision:1,compatibilityMode:"legacy_allowed",
       productionAuthorized:false,
       dataLocation:{type:"shared_firestore_namespace",database:"(default)",path:"schools/"+SCHOOL_ID},
       firstAdminUid:teacherUid,aiEnabled:false,storageEnabled:false,readiness:{},
       createdByUid:OPERATOR_ACTOR,createdAt:now,updatedAt:now
     });
   }else{
     tx.update(schoolRef,{
       firstAdminUid:teacherUid,compatibilityMode:"legacy_allowed",productionAuthorized:false,
       revision:(Number(school.data().revision)||0)+1,updatedAt:now
     });
   }
   tx.set(memberRef,{
     schoolId:SCHOOL_ID,status:"active",roles,revision,updatedAt:now,updatedByUid:OPERATOR_ACTOR
   },{merge:true});
   tx.set(indexRef,{
     schoolId:SCHOOL_ID,status:"active",roles,revision,updatedAt:now
   },{merge:true});
   const audit=db.collection("platform_audit").doc();
   tx.create(audit,{
     schoolId:SCHOOL_ID,actorUid:OPERATOR_ACTOR,targetUid:teacherUid,
     action:"mcs_shs_controlled_pilot_draft_bootstrapped",
     compatibilityMode:"legacy_allowed",productionAuthorized:false,createdAt:now
   });
 });
}
async function main(){
 if(!getApps().length)initializeApp({credential:applicationDefault()});
 const db=getFirestore(),auth=getAuth();
 const activeSet=new Set(ACTIVE_SECTION_IDS);
 const activeSections=(defaults.sections||[]).filter(section=>activeSet.has(section.sectionId));
 if(activeSections.length!==4)fail("pilot_defaults_section_count_invalid");
 const expected=defaults.rosterReference?.pilotSectionCounts||{};
 const expectedTotal=activeSections.reduce((sum,section)=>sum+Number(expected[section.sectionId]||0),0);
 if(expectedTotal!==167)fail("pilot_reference_total_changed");

 // Protected identity reconciliation. The report is kept only in memory.
 const identity=await identityCandidates({
   db,resolveUserByEmail:email=>auth.getUserByEmail(email),schoolId:SCHOOL_ID
 });

 const studentSnap=await db.collection("students").get();
 const selected=[],counts=Object.fromEntries(activeSections.map(section=>[section.sectionId,0]));
 const selectedSectionById=new Map(),sourceTimes=[];
 for(const doc of studentSnap.docs){
   const row={id:doc.id,path:projectedStudentPath(doc.id),data:doc.data(),digest:canonicalDigest(doc.data())};
   const section=matchSection({id:doc.id,data:doc.data()},activeSections);
   if(!section)continue;
   selected.push(row);selectedSectionById.set(doc.id,section);counts[section.sectionId]++;sourceTimes.push(updateMillis(doc));
 }
 const countMismatches=activeSections.filter(section=>counts[section.sectionId]!==Number(expected[section.sectionId]||0));
 if(selected.length!==expectedTotal||countMismatches.length){
   console.log("MCS_SHS_ROSTER_MISMATCH "+JSON.stringify({
     expectedTotal,observedTotal:selected.length,
     sections:activeSections.map(section=>({
       sectionId:section.sectionId,
       expected:Number(expected[section.sectionId]||0),
       observed:counts[section.sectionId]||0,
       delta:(counts[section.sectionId]||0)-Number(expected[section.sectionId]||0)
     }))
   }));
   fail("pilot_roster_count_mismatch");
 }

 const identityByStudent=new Map();
 for(const candidate of identity.candidates||[]){
   for(const row of candidate.legacyStudentIds||[]){
     if(!selectedSectionById.has(row.studentId))continue;
     if(identityByStudent.has(row.studentId)&&identityByStudent.get(row.studentId)!==candidate.uid)
       fail("student_identity_collision");
     identityByStudent.set(row.studentId,candidate.uid);
   }
 }
 const unresolvedStudents=selected.filter(row=>!identityByStudent.has(row.id));
 if(unresolvedStudents.length)fail("student_identity_unresolved");
 const duplicateCurrentAccounts=(identity.candidates||[]).filter(candidate=>
   (candidate.legacyStudentIds||[]).filter(row=>selectedSectionById.has(row.studentId)).length>1);
 if(duplicateCurrentAccounts.length)fail("duplicate_current_identity");

 const teacherCandidates=(identity.candidates||[]).filter(candidate=>
   (candidate.rolesToReview||[]).includes("teacher")&&
   (candidate.legacyStaffScopes||[]).some(scope=>scope.role==="teacher"&&scope.status==="active"));
 const fullCoverage=teacherCandidates.filter(candidate=>{
   const seen=new Set();
   for(const scope of candidate.legacyStaffScopes||[]){
     if(scope.role!=="teacher"||scope.status!=="active")continue;
     for(const label of scope.sections||[]){
       const section=activeSections.find(item=>[item.name,...(item.legacyLabels||[])].some(value=>norm(value)===norm(label)));
       if(section)seen.add(section.sectionId);
     }
   }
   return activeSections.every(section=>seen.has(section.sectionId));
 });
 if(fullCoverage.length!==1)fail("pilot_teacher_not_unique_full_scope");
 const teacherUid=fullCoverage[0].uid;
 if([...identityByStudent.values()].includes(teacherUid))fail("pilot_teacher_student_identity_conflict");

 const teacherAuth=await auth.getUser(teacherUid);
 if(!teacherAuth||teacherAuth.disabled||teacherAuth.emailVerified!==true)fail("pilot_teacher_auth_not_active_verified");
 let teacherRow=null;
 if(teacherAuth.email){
   const teacherDocs=await db.collection("teachers").where("email","==",String(teacherAuth.email).trim().toLowerCase()).limit(3).get();
   if(teacherDocs.size>1)fail("pilot_teacher_profile_ambiguous");
   if(teacherDocs.size===1){
     const doc=teacherDocs.docs[0];sourceTimes.push(updateMillis(doc));
     teacherRow={id:doc.id,path:projectedTeacherPath(doc.id),data:{...doc.data(),uid:teacherUid},digest:canonicalDigest(doc.data())};
   }
 }
 if(!teacherRow){
   const displayName=String(teacherAuth.displayName||"").trim();
   if(displayName.length<2)fail("pilot_teacher_display_name_missing");
   const source={displayName,status:"active",uid:teacherUid};
   teacherRow={id:"verified-pilot-teacher",path:projectedTeacherPath("verified-pilot-teacher"),data:source,digest:canonicalDigest(source)};
 }
 for(const staffId of fullCoverage[0].legacyStaffRecordIds||[]){
   try{const doc=await db.doc("staff_access/"+staffId).get();if(doc.exists)sourceTimes.push(updateMillis(doc));}catch{}
 }
 const sourceSnapshotAt=maxIso(sourceTimes);

 // Restrict the identity report to current pilot rows and normalize only the
 // explicitly approved multi-select section-token representation.
 const filteredCandidates=[];
 for(const candidate of identity.candidates||[]){
   const studentRows=(candidate.legacyStudentIds||[]).filter(row=>selectedSectionById.has(row.studentId)).map(row=>{
     const section=selectedSectionById.get(row.studentId);
     const year=String(row.year||"").trim();
     if(year&&year!==ACADEMIC_YEAR.name)fail("pilot_student_year_conflict");
     if(!activeStatus(row.status))fail("pilot_student_inactive_in_current_roster");
     return {...row,year:ACADEMIC_YEAR.name,section:(section.legacyLabels||[])[0]||section.name};
   });
   const isTeacher=candidate.uid===teacherUid;
   if(!studentRows.length&&!isTeacher)continue;
   const roles=[];if(studentRows.length)roles.push("student");if(isTeacher)roles.push("teacher");
   filteredCandidates.push({
     ...candidate,
     legacyStudentIds:studentRows,
     legacyStaffRecordIds:isTeacher?[...(candidate.legacyStaffRecordIds||[])]:[],
     legacyStaffScopes:isTeacher?[{
       recordId:"controlled-pilot-scope",role:"teacher",status:"active",
       sections:activeSections.map(section=>(section.legacyLabels||[])[0]||section.name),
       subjects:[]
     }]:[],
     rolesToReview:roles,
     requiresManualSchoolApproval:true
   });
 }
 const filteredIdentity={
   schema:"adminerva-v4-mcs-identity-candidates-v1",schoolId:SCHOOL_ID,readOnly:true,
   ownerConfirmedMcsOnly:true,grantsCreated:false,generatedAt:sourceSnapshotAt,
   candidates:filteredCandidates.sort((a,b)=>a.uid.localeCompare(b.uid)),
   reconciliation:[],summary:{pilotCandidateAccounts:filteredCandidates.length},
   warnings:["Controlled pilot subset; historical and unrelated rows remain deferred."]
 };
 const stableIdentitySha=canonicalDigest(filteredIdentity.candidates.map(candidate=>({
   uid:candidate.uid,legacyStudentIds:candidate.legacyStudentIds,
   legacyStaffRecordIds:candidate.legacyStaffRecordIds,
   legacyStaffScopes:candidate.legacyStaffScopes,rolesToReview:candidate.rolesToReview
 })));
 const sourceSha=canonicalDigest([
   ...selected.map(row=>({path:row.path,digest:row.digest})),
   {path:teacherRow.path,digest:teacherRow.digest}
 ].sort((a,b)=>a.path.localeCompare(b.path)));

 const foundation=buildFoundationPlan({
   identity:filteredIdentity,
   rows:{students:selected,teachers:[teacherRow],assessments:[]},
   reconciliationSha256:sourceSha,identitySha256:stableIdentitySha
 });
 foundation.generatedAt=sourceSnapshotAt;
 foundation.pilotScope={
   schema:"adminerva-v4-mcs-shs-pilot-plan-scope-v1",
   productionAuthorized:false,compatibilityMode:"legacy_allowed",
   teacherUid,academicYear:ACADEMIC_YEAR,
   activeSectionIds:[...ACTIVE_SECTION_IDS],pendingSectionIds:[...PENDING_SECTION_IDS],
   deferredHistory:true,sourceMode:"live_current_legacy_read_only",
   virtualLegacyPathProjection:true
 };
 foundation.summary={
   ...foundation.summary,pilotStudentRows:selected.length,pilotTeacherRows:1,
   pilotSectionCounts:counts,rosterCountReviews:0
 };
 if((foundation.blockers||[]).length)fail("foundation_identity_blocker");
 if((foundation.reviewItems||[]).length)fail("foundation_manual_review_required");
 if(foundation.people.length!==168||foundation.memberships.length!==168)fail("foundation_identity_count_changed");
 if(foundation.people.some(row=>row.status!=="active"))fail("foundation_contains_inactive_person");
 if(foundation.people.some(row=>/^(Student|Staff)\s+[A-Za-z0-9_-]+$/.test(row.displayName||"")))
   fail("foundation_display_name_requires_review");
 const foundationRaw=rawJson(foundation);

 const operator={
   schema:OPERATOR_SCHEMA,schoolId:SCHOOL_ID,scope:"senior_high_ict_limited_pilot",
   productionAuthorized:false,compatibilityMode:"legacy_allowed",teacherUid,
   academicYear:ACADEMIC_YEAR,activeSectionIds:[...ACTIVE_SECTION_IDS],
   pendingSectionIds:[...PENDING_SECTION_IDS],rosterReference:"protected_drive_snapshot_2026-11-08",
   acknowledgements:{limitedScopeReviewed:true,rosterReferenceReviewed:true,productionNotAuthorized:true},
   notes:"Four populated SHS ICT sections only. St. Sebastian and historical content remain deferred."
 };
 const foundationApproval=approveFoundation(createPilotTemplate(foundation,foundationRaw,operator,defaults));
 if((foundationApproval.unresolvedBlockers||[]).length)fail("foundation_approval_blocker");
 if((foundationApproval.reviewItems||[]).length)fail("foundation_approval_manual_review_required");
 if((foundationApproval.courseOfferings||[]).length!==8)fail("pilot_offering_count_changed");
 const approvedFoundation=validateFoundationApproval(
   validateFoundationPlan(foundation),foundationRaw,foundationApproval
 );

 const accessPlan=buildAcademicAccessPlan({
   foundationPlan:foundation,foundationPlanRaw:foundationRaw,
   foundationApproval,identity:filteredIdentity,identitySha256:stableIdentitySha
 });
 accessPlan.generatedAt=sourceSnapshotAt;
 if((accessPlan.blockers||[]).length)fail("academic_access_blocker");
 if((accessPlan.reviewItems||[]).length)fail("academic_access_manual_review_required");
 if(accessPlan.enrollments.length!==334)fail("pilot_enrollment_count_changed");
 if(accessPlan.assignments.length!==8)fail("pilot_teacher_assignment_count_changed");
 if(accessPlan.enrollments.some(row=>row.status!=="active"))fail("pilot_contains_ended_enrollment");
 const accessRaw=rawJson(accessPlan);
 const accessApproval=approveAccess(createAccessTemplate(accessPlan,accessRaw));
 const approvedAccess=validateAccessApproval(validateAccessPlan(accessPlan),accessRaw,accessApproval);

 const platformAdmins=await db.collection("platform_admins").get();
 const activePlatformAdmins=platformAdmins.docs.filter(doc=>{
   const data=doc.data();return data.status==="active"&&data.role==="platform_admin";
 });
 if(activePlatformAdmins.length<1)fail("platform_admin_missing");
 const teacherIsPlatformAdmin=activePlatformAdmins.some(doc=>doc.id===teacherUid);

 console.log("MCS_SHS_TARGET_DRYRUN "+JSON.stringify({
   expectedPilotStudents:expectedTotal,observedPilotStudents:selected.length,
   sectionCounts:counts,verifiedStudentIdentities:identityByStudent.size,
   pilotTeacherCandidates:fullCoverage.length,foundationPeople:foundation.people.length,
   offerings:foundationApproval.courseOfferings.length,enrollments:accessPlan.enrollments.length,
   teacherAssignments:accessPlan.assignments.length,blockers:0,manualReviewItems:0,
   productionAuthorized:false,compatibilityMode:"legacy_allowed"
 }));

 // All scope/identity/catalog/access decisions are deterministic and clean.
 // Only now create the draft school + first School Admin grant.
 await bootstrapDraftAndAdmin(db,auth,teacherUid);

 const foundationPreflight=await applyFoundation(db,approvedFoundation,{apply:false,maxUnits:1000});
 if(foundationPreflight.blocked)fail("foundation_target_conflict");
 const foundationReceipt=await applyFoundation(db,approvedFoundation,{apply:true,maxUnits:1000});
 if(foundationReceipt.blocked||!foundationReceipt.complete)fail("foundation_apply_incomplete");

 const accessPreflight=await applyAccess(db,approvedAccess,{apply:false,maxUnits:1000});
 if(accessPreflight.blocked)fail("academic_access_target_conflict");
 const accessReceipt=await applyAccess(db,approvedAccess,{apply:true,maxUnits:1000});
 if(accessReceipt.blocked||!accessReceipt.complete)fail("academic_access_apply_incomplete");

 const school=await db.doc("platform_schools/"+SCHOOL_ID).get();
 if(!school.exists||school.data().state!=="draft")fail("school_not_draft_after_migration");
 if((school.data().compatibilityMode||"legacy_allowed")!=="legacy_allowed")fail("school_not_legacy_compatible_after_migration");
 if(school.data().productionAuthorized===true)fail("school_production_authorized_unexpectedly");
 const firstAdminUid=school.data().firstAdminUid;
 const firstAdmin=firstAdminUid?await db.doc("schools/"+SCHOOL_ID+"/memberships/"+firstAdminUid).get():null;
 if(!firstAdmin?.exists||firstAdmin.data().status!=="active"||
    !Array.isArray(firstAdmin.data().roles)||!firstAdmin.data().roles.includes("school_admin")||
    !firstAdmin.data().roles.includes("teacher"))fail("first_admin_teacher_roles_not_ready");

 console.log("MCS_SHS_CONTROLLED_MIGRATION_READY "+JSON.stringify({
   schoolState:"draft",compatibilityMode:"legacy_allowed",productionAuthorized:false,
   pilotStarted:false,v4Only:false,
   people:foundation.people.length,memberships:foundation.memberships.length,
   offerings:foundationApproval.courseOfferings.length,
   enrollments:accessPlan.enrollments.length,teacherAssignments:accessPlan.assignments.length,
   foundationCreated:foundationReceipt.created,foundationAlreadyApplied:foundationReceipt.alreadyApplied,
   academicAccessCreated:accessReceipt.created,academicAccessAlreadyApplied:accessReceipt.alreadyApplied,
   activePlatformAdmins:activePlatformAdmins.length,teacherIsPlatformAdmin,
   historicalAssessmentsMigrated:false,historicalGradesMigrated:false,
   planningMigrated:false,practiceMigrated:false,
   readyForStartControlledPilot:true
 }));
}

main().catch(error=>{
 const code=error?.pilotCode||"unexpected_operator_error";
 console.error("::error::PILOT_EXCEPTION:"+code);
 process.exitCode=2;
});
