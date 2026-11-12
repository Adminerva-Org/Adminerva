"use strict";
/** Read-only MCS SHS pilot snapshot. Aggregate logs only, never prints personal data or writes. */
const {initializeApp,applicationDefault}=require("firebase-admin/app");
const {getFirestore}=require("firebase-admin/firestore");
const {getAuth}=require("firebase-admin/auth");
const {PILOT_SECTIONS,EXPECTED_TOTAL,sectionFor}=require("../functions/mcs-pilot-control.js");
const SCHOOL_ID="mcs-manila";
const PROJECT="reporeview-e7ca4";
function fail(code){const error=new Error(code);error.safeCode=code;throw error}
function email(v){const x=typeof v==="string"?v.trim().toLowerCase():"";return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)?x:null}
function active(v){return !["archived","suspended","inactive","disabled","deleted"].includes(String(v||"active").toLowerCase())}
async function main(){
  const app=initializeApp({credential:applicationDefault(),projectId:PROJECT});
  const db=getFirestore(app),auth=getAuth(app);
  const [schoolSnap,studentsSnap,reviewsSnap,exclusionsSnap,peopleCount,membersCount,offeringsCount,enrollmentsCount,assignmentsCount]=await Promise.all([
    db.doc("platform_schools/"+SCHOOL_ID).get(),
    db.collection("students").get(),
    db.collection("schools/"+SCHOOL_ID+"/pilot_identity_reviews").limit(1000).get(),
    db.collection("schools/"+SCHOOL_ID+"/pilot_roster_exclusions").limit(1000).get(),
    db.collection("schools/"+SCHOOL_ID+"/people").count().get(),
    db.collection("schools/"+SCHOOL_ID+"/memberships").count().get(),
    db.collection("schools/"+SCHOOL_ID+"/course_offerings").count().get(),
    db.collection("schools/"+SCHOOL_ID+"/enrollments").count().get(),
    db.collection("schools/"+SCHOOL_ID+"/staff_assignments").count().get()
  ]);
  const school=schoolSnap.exists?schoolSnap.data():null;
  const firstAdmin=school?.firstAdminUid?await db.doc("schools/"+SCHOOL_ID+"/memberships/"+school.firstAdminUid).get():null;
  const validAdmin=Boolean(firstAdmin?.exists&&firstAdmin.data()?.status==="active"&&
    Array.isArray(firstAdmin.data()?.roles)&&firstAdmin.data().roles.includes("teacher")&&
    firstAdmin.data().roles.includes("school_admin"));
  const reviews=new Map(reviewsSnap.docs.filter(d=>d.data()?.status==="approved").map(d=>[d.id,d.data()]));
  const exclusions=new Set(exclusionsSnap.docs.filter(d=>d.data()?.status==="excluded").map(d=>d.id));
  const records=[];
  for(const doc of studentsSnap.docs){
    const row=doc.data(),section=sectionFor(row);
    if(!section||!active(row.status))continue;
    records.push({id:doc.id,section,email:email(row.email),reviewed:reviews.get(doc.id),excluded:exclusions.has(doc.id)});
  }
  const included=records.filter(r=>!r.excluded);
  const sections=PILOT_SECTIONS.map(s=>({
    sectionId:s.sectionId,expected:s.expected,
    observed:records.filter(r=>r.section.sectionId===s.sectionId).length,
    included:included.filter(r=>r.section.sectionId===s.sectionId).length
  }));
  const emails=[...new Set(included.map(r=>r.email).filter(Boolean))];
  const authMatches=new Map();
  for(let i=0;i<emails.length;i+=100){
    const batch=await auth.getUsers(emails.slice(i,i+100).map(value=>({email:value})));
    for(const user of batch.users)if(user.email)
      authMatches.set(String(user.email).trim().toLowerCase(),user);
  }
  const uids=[],linkedRows=[],unresolved=[];
  for(const row of included){
    const candidate=row.email?authMatches.get(row.email):null;
    const verified=candidate&&candidate.emailVerified&&!candidate.disabled?candidate.uid:null;
    const uid=row.reviewed?.authUid||verified;
    if(uid){uids.push(uid);linkedRows.push({uid,sectionId:row.section.sectionId});}
    else unresolved.push(row.id);
  }
  const [membersSnapshot,peopleSnapshot]=await Promise.all([
    db.collection("schools/"+SCHOOL_ID+"/memberships").get(),
    db.collection("schools/"+SCHOOL_ID+"/people").get()
  ]);
  const candidateUids=new Set(uids);
  const extra=membersSnapshot.docs.filter(d=>!candidateUids.has(d.id)&&d.id!==school?.firstAdminUid);
  const extras={
    count:extra.length,
    active:extra.filter(d=>d.data()?.status==="active").length,
    teacherOnly:extra.filter(d=>d.data()?.roles?.includes("teacher")&&!d.data()?.roles?.includes("student")).length,
    schoolAdmin:extra.filter(d=>d.data()?.roles?.includes("school_admin")).length,
    student:extra.filter(d=>d.data()?.roles?.includes("student")).length,
    wrongSchool:extra.filter(d=>d.data()?.schoolId!==SCHOOL_ID).length,
    hasCanonicalPerson:extra.filter(d=>peopleSnapshot.docs.some(p=>p.data()?.authUid===d.id)).length
  };
  const missingPilotMemberships=uids.filter(uid=>!membersSnapshot.docs.some(m=>
    m.id===uid&&m.data()?.schoolId===SCHOOL_ID&&m.data()?.status==="active"&&
    m.data()?.roles?.includes("student"))).length;
  console.log("MCS_PILOT_MEMBERSHIP_SHAPE extras="+extras.count+
    " activeExtras="+extras.active+" extraTeachers="+extras.teacherOnly+
    " extraAdmins="+extras.schoolAdmin+" extraStudents="+extras.student+
    " wrongSchool="+extras.wrongSchool+" extraWithPerson="+extras.hasCanonicalPerson+
    " missingPilotStudentMemberships="+missingPilotMemberships);
  const [offeringsSnap,enrollmentsSnap,assignmentsSnap]=await Promise.all([
    db.collection("schools/"+SCHOOL_ID+"/course_offerings").get(),
    db.collection("schools/"+SCHOOL_ID+"/enrollments").get(),
    db.collection("schools/"+SCHOOL_ID+"/staff_assignments").get()
  ]);
  const personByUid=new Map();
  for(const person of peopleSnapshot.docs){
    const uid=person.data()?.authUid;
    if(uid)personByUid.set(uid,[...(personByUid.get(uid)||[]),person]);
  }
  const offerings=offeringsSnap.docs.map(doc=>({id:doc.id,...doc.data()}));
  const offeringsBySection=new Map();
  for(const section of PILOT_SECTIONS)
    offeringsBySection.set(section.sectionId,offerings.filter(row=>
      row.sectionId===section.sectionId&&row.schoolId===SCHOOL_ID&&row.status==="active"));
  const enrollmentDocs=enrollmentsSnap.docs.map(doc=>doc.data());
  const assignments=assignmentsSnap.docs.map(doc=>doc.data());
  const academicLinks={
    missingStudentPeople:0,wrongStudentPeople:0,
    invalidOfferings:0,incorrectStudentEnrollmentSets:0,invalidTeacherAssignments:0
  };
  for(const section of PILOT_SECTIONS){
    const selected=offeringsBySection.get(section.sectionId)||[];
    if(selected.length!==2||new Set(selected.map(o=>o.termId)).size!==2)
      academicLinks.invalidOfferings++;
  }
  for(const row of linkedRows){
    const matches=personByUid.get(row.uid)||[];
    if(matches.length!==1){academicLinks.missingStudentPeople++;continue;}
    const person=matches[0],data=person.data();
    if(data.kind!=="student"||data.status!=="active"||data.schoolId!==SCHOOL_ID){
      academicLinks.wrongStudentPeople++;continue;
    }
    const expected=new Set((offeringsBySection.get(row.sectionId)||[]).map(o=>o.id));
    const assigned=enrollmentDocs.filter(e=>e.personId===person.id&&e.status==="active");
    const actual=new Set(assigned.map(e=>e.offeringId));
    if(expected.size!==2||assigned.length!==2||actual.size!==2||
       [...expected].some(id=>!actual.has(id))||
       assigned.some(e=>e.sectionId!==row.sectionId||e.schoolId!==SCHOOL_ID))
      academicLinks.incorrectStudentEnrollmentSets++;
  }
  const wantedOfferings=new Set(offerings.map(o=>o.id));
  if(assignments.length!==8||
    assignments.some(a=>a.teacherUid!==school?.firstAdminUid||
      a.status!=="active"||a.schoolId!==SCHOOL_ID||!wantedOfferings.has(a.offeringId))||
    new Set(assignments.map(a=>a.offeringId)).size!==8)
    academicLinks.invalidTeacherAssignments++;
  const academicLinkageReady=Object.values(academicLinks).every(value=>value===0)&&linkedRows.length===EXPECTED_TOTAL;
  console.log("MCS_PILOT_ACADEMIC_LINKAGE complete="+academicLinkageReady+
    " missingStudentPeople="+academicLinks.missingStudentPeople+
    " wrongStudentPeople="+academicLinks.wrongStudentPeople+
    " invalidOfferings="+academicLinks.invalidOfferings+
    " incorrectStudentEnrollmentSets="+academicLinks.incorrectStudentEnrollmentSets+
    " invalidTeacherAssignments="+academicLinks.invalidTeacherAssignments);
  const canonical={
    people:peopleCount.data().count,memberships:membersCount.data().count,
    offerings:offeringsCount.data().count,enrollments:enrollmentsCount.data().count,
    teacherAssignments:assignmentsCount.data().count
  };
  const canonicalCountMatch=canonical.people===EXPECTED_TOTAL+1&&
    canonical.memberships===EXPECTED_TOTAL+1&&canonical.offerings===8&&
    canonical.enrollments===EXPECTED_TOTAL*2&&canonical.teacherAssignments===8;
  const blockers=[];
  if(!school)blockers.push("draft_school_missing");
  else {
    if(school.state!=="draft")blockers.push("school_not_draft");
    if((school.compatibilityMode||"legacy_allowed")!=="legacy_allowed")blockers.push("legacy_compatibility_disabled");
    if(school.productionAuthorized===true)blockers.push("production_authorization_unexpected");
  }
  if(!validAdmin)blockers.push("dual_role_first_school_admin_pending");
  if(included.length!==EXPECTED_TOTAL||sections.some(s=>s.included!==s.expected))
    blockers.push("pilot_roster_review_pending");
  if(unresolved.length)blockers.push("verified_identity_links_pending");
  if(new Set(uids).size!==uids.length)blockers.push("duplicate_auth_links");
  if(!canonicalCountMatch)blockers.push("canonical_people_and_academics_pending");
  if(!academicLinkageReady)blockers.push("pilot_academic_relationship_review_pending");
  const report={
    readOnly:true,productionAuthorized:school?.productionAuthorized===true,
    schoolState:school?.state||"missing",compatibilityMode:school?.compatibilityMode||"missing",
    firstAdminDualRoleReady:validAdmin,expectedPilotStudents:EXPECTED_TOTAL,
    observedPilotStudents:records.length,includedPilotStudents:included.length,
    excludedLegacyRows:records.length-included.length,
    emailVerifiedOrReviewedLinked:uids.length,unresolvedStudentLinks:unresolved.length,
    duplicateAuthLinks:uids.length-new Set(uids).size,
    sections,canonical,canonicalCountMatch,academicLinks,academicLinkageReady,blockers,
    status:!blockers.length?"ready_for_protected_operator_review":"blocked",
    limitations:"Aggregated counts do not prove approved source provenance, enrollment/teacher relationship correctness, protected backup or live pilot acceptance."
  };
  console.log("MCS_PILOT_READINESS_SUMMARY "+JSON.stringify(report));
  // Readiness blockers are expected during setup. Emit report without failing or exposing PII.
}
main().catch(error=>{
  console.error("::error::PILOT_READINESS_FAILURE:"+String(error?.safeCode||"read_only_query_failed"));
  process.exitCode=2;
});
