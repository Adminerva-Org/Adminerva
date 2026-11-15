"use strict";
/**
 * School-wide adoption bridge for the MCS legacy people/access model.
 *
 * Converts legacy root students + staff_access into the canonical school model:
 * people -> memberships -> enrollments / staff_assignments.
 *
 * Safety invariants:
 * - MCS only while compatibilityMode is legacy_allowed.
 * - School-admin authority is checked server-side.
 * - Firebase Auth UID is used only after a verified, enabled email match.
 * - Unverified legacy rows may become person records, but never memberships.
 * - Legacy admin never becomes school_admin automatically.
 * - Existing suspensions and school_admin roles are preserved.
 * - Academic relationships are exact-label candidates and require a separate
 *   explicit acknowledgement from the school administrator.
 */
const {FieldValue,FieldPath}=require("firebase-admin/firestore");
const {createHash}=require("node:crypto");
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");

const SCHOOL_ID="mcs-manila";
function deny(code,message){throw new TenantAccessError(code,message)}
function clean(value,max=160){
  return typeof value==="string"?value.trim().replace(/\s+/g," ").slice(0,max):"";
}
function normalize(value){return clean(value,160).toLocaleLowerCase("en");}
function normalizeEmail(value){
  const email=clean(value,254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:null;
}
function activeStatus(value){
  return !["archived","suspended","inactive","disabled","deleted","ended"].includes(clean(value,40).toLowerCase());
}
function sha(value){return createHash("sha256").update(String(value)).digest("hex");}
function stablePersonId(uid){return "mcs_"+sha("person\0"+uid).slice(0,36);}
function legacyPersonId(kind,sourceId){return "mcs_legacy_"+sha(kind+"\0"+sourceId).slice(0,32);}
function rowKey(...values){return sha(JSON.stringify(values));}
function identifier(value,label="Identifier"){
  const text=clean(value,128);
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(text))deny("invalid-argument",label+" is invalid.");
  return text;
}
function displayName(data,fallback){
  const direct=clean(data?.displayName||data?.name||data?.fullName||data?.studentName||data?.teacherName,140);
  if(direct)return direct;
  const first=clean(data?.firstName||data?.firstname||data?.first_name,70);
  const last=clean(data?.lastName||data?.lastname||data?.last_name,70);
  return clean([first,last].filter(Boolean).join(" "),140)||fallback;
}
function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==="object"){
    return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  }
  return value;
}
async function readAll(query,max,label){
  const rows=[];let cursor=null;
  while(rows.length<max){
    let q=query.orderBy(FieldPath.documentId()).limit(Math.min(250,max-rows.length));
    if(cursor)q=q.startAfter(cursor);
    const page=await q.get();
    for(const doc of page.docs)rows.push({id:doc.id,data:doc.data()});
    if(page.size<250)return rows;
    cursor=page.docs.at(-1);
  }
  deny("resource-exhausted",label+" exceeds the migration review limit.");
}
async function mapLimit(values,limit,fn){
  const out=new Array(values.length);let next=0;
  async function worker(){
    while(true){
      const index=next++;
      if(index>=values.length)return;
      out[index]=await fn(values[index],index);
    }
  }
  await Promise.all(Array.from({length:Math.min(limit,values.length||1)},worker));
  return out;
}
function nameIndex(rows){
  const index=new Map();
  for(const row of rows){
    if(row.data?.status&&row.data.status!=="active")continue;
    const key=normalize(row.data?.name);
    if(!key)continue;
    const list=index.get(key)||[];list.push(row);index.set(key,list);
  }
  return index;
}
function addIssue(issues,type,severity,label,detail,extra={}){
  issues.push({type,severity,label:clean(label,160)||"Legacy record",
    detail:clean(detail,320),...extra});
}
async function buildModel({db,resolveUserByEmail,ctx}){
  const schoolRef=db.doc("platform_schools/"+ctx.schoolId);
  const [school,students,staff,teachers,people,memberships,years,sections,subjects,offerings,enrollments,assignments]=await Promise.all([
    schoolRef.get(),
    readAll(db.collection("students"),5000,"Legacy student roster"),
    readAll(db.collection("staff_access"),500,"Legacy staff access"),
    readAll(db.collection("teachers"),1000,"Legacy teacher profiles"),
    readAll(db.collection("schools/"+ctx.schoolId+"/people"),5000,"School people"),
    readAll(db.collection("schools/"+ctx.schoolId+"/memberships"),2000,"School memberships"),
    readAll(db.collection("schools/"+ctx.schoolId+"/academic_years"),250,"Academic years"),
    readAll(db.collection("schools/"+ctx.schoolId+"/sections"),500,"Sections"),
    readAll(db.collection("schools/"+ctx.schoolId+"/subjects"),500,"Subjects"),
    readAll(db.collection("schools/"+ctx.schoolId+"/course_offerings"),3000,"Course offerings"),
    readAll(db.collection("schools/"+ctx.schoolId+"/enrollments"),5000,"Enrollments"),
    readAll(db.collection("schools/"+ctx.schoolId+"/staff_assignments"),3000,"Teaching assignments")
  ]);
  if(!school.exists)deny("failed-precondition","The MCS school record is missing.");
  if(school.data().compatibilityMode==="v4_only")
    deny("failed-precondition","Legacy MCS adoption is closed after the school-wide cutover.");

  const emails=[...new Set([
    ...students.map(row=>normalizeEmail(row.data.email)),
    ...staff.map(row=>normalizeEmail(row.data.email||row.id)),
    ...teachers.map(row=>normalizeEmail(row.data.email))
  ].filter(Boolean))];
  const resolvedPairs=await mapLimit(emails,16,async email=>{
    try{
      const user=await resolveUserByEmail(email);
      return [email,user&&user.emailVerified&&!user.disabled?user:null];
    }catch(error){
      if(error?.code==="auth/user-not-found")return [email,null];
      throw error;
    }
  });
  const resolved=new Map(resolvedPairs);
  const verifiedEmailByUid=new Map([...resolved.values()].filter(Boolean)
    .map(user=>[user.uid,normalizeEmail(user.email)]).filter(([,email])=>Boolean(email)));

  const peopleById=new Map(people.map(row=>[row.id,row.data]));
  const peopleByUid=new Map();
  for(const row of people){
    const uid=clean(row.data.authUid,128);if(!uid)continue;
    const list=peopleByUid.get(uid)||[];list.push(row);peopleByUid.set(uid,list);
  }
  const memberByUid=new Map(memberships.map(row=>[row.id,row.data]));
  const groups=new Map(),sourceToGroup=new Map(),issues=[];
  function groupFor(key,kind,uid){
    if(!groups.has(key))groups.set(key,{key,kind,uid:uid||null,kinds:new Set(),roles:new Set(),
      sourceIds:[],studentRows:[],staffRows:[],names:[],active:false,legacyAdmin:false});
    const group=groups.get(key);group.kinds.add(kind);return group;
  }
  for(const row of students){
    const email=normalizeEmail(row.data.email),user=email?resolved.get(email):null;
    const key=user?"uid:"+user.uid:"student:"+row.id,group=groupFor(key,"student",user?.uid);
    group.sourceIds.push("students/"+row.id);group.studentRows.push(row);
    group.names.push(displayName(row.data,"Student "+row.id));
    group.active=group.active||activeStatus(row.data.status);
    if(user)group.roles.add("student");
    sourceToGroup.set("students/"+row.id,key);
  }
  for(const row of staff){
    const email=normalizeEmail(row.data.email||row.id),user=email?resolved.get(email):null;
    const key=user?"uid:"+user.uid:"staff:"+row.id,group=groupFor(key,"staff",user?.uid);
    group.sourceIds.push("staff_access/"+row.id);group.staffRows.push(row);
    group.names.push(displayName(row.data,"Staff "+row.id));
    group.active=group.active||activeStatus(row.data.status);
    if(row.data.role==="teacher"&&activeStatus(row.data.status)&&user)group.roles.add("teacher");
    if(row.data.role==="admin")group.legacyAdmin=true;
    sourceToGroup.set("staff_access/"+row.id,key);
  }
  for(const row of teachers){
    const email=normalizeEmail(row.data.email),user=email?resolved.get(email):null;
    const staffKey=sourceToGroup.get("staff_access/"+row.id);
    const key=staffKey||(user?"uid:"+user.uid:null);
    if(!key){
      addIssue(issues,"legacy_teacher_profile_unresolved","review",
        displayName(row.data,"Teacher "+row.id),
        "A previous teacher profile has no verified account or staff-access record. It remains preserved for manual reconciliation.",
        {recordId:row.id});
      continue;
    }
    const group=groups.get(key)||groupFor(key,"staff",user?.uid);
    group.kinds.add("staff");group.sourceIds.push("teachers/"+row.id);group.names.push(displayName(row.data,"Teacher "+row.id));
    group.active=group.active||activeStatus(row.data.status);
    sourceToGroup.set("teachers/"+row.id,key);
  }

  const candidates=[],candidateByGroup=new Map();
  for(const group of [...groups.values()].sort((a,b)=>a.key.localeCompare(b.key))){
    const kind=group.kinds.size===1?[...group.kinds][0]:null;
    let blocked=false,personId=null,existingPerson=null;
    if(!kind){
      blocked=true;addIssue(issues,"identity_kind_conflict","integrity",group.names[0],
        "One verified account appears in both legacy student and staff records. Review it manually before consolidation.",
        {targetUid:group.uid});
    }
    if(group.uid){
      const linked=peopleByUid.get(group.uid)||[];
      if(linked.length>1){
        blocked=true;addIssue(issues,"duplicate_canonical_auth_link","integrity",group.names[0],
          "This account is already linked to multiple school person records.",{targetUid:group.uid});
      }else if(linked.length===1){
        personId=linked[0].id;existingPerson=linked[0].data;
      }else if(kind){
        const stableId=stablePersonId(group.uid),email=verifiedEmailByUid.get(group.uid);
        const importedId=email?"imp_"+sha(kind+"\0email:"+email).slice(0,40):null;
        const stablePerson=peopleById.get(stableId)||null,importedPerson=importedId?peopleById.get(importedId)||null:null;
        if(stablePerson&&importedPerson&&stableId!==importedId){
          blocked=true;personId=stableId;existingPerson=stablePerson;
          addIssue(issues,"duplicate_person_identity_candidates","integrity",group.names[0],
            "Both a previous migration person and a roster-import person match this verified account. Merge/review them before granting access.",
            {personId:stableId,targetUid:group.uid,alternatePersonId:importedId});
        }else if(importedPerson){
          personId=importedId;existingPerson=importedPerson;
        }else{
          personId=stableId;existingPerson=stablePerson;
        }
      }
    }else if(kind){
      const sourceId=(kind==="student"?group.studentRows[0]?.id:group.staffRows[0]?.id)||group.key;
      personId=legacyPersonId(kind,sourceId);
    }
    if(personId&&!existingPerson)existingPerson=peopleById.get(personId)||null;
    if(existingPerson&&kind){
      if(existingPerson.schoolId!==ctx.schoolId||existingPerson.kind!==kind){
        blocked=true;addIssue(issues,"canonical_person_collision","integrity",group.names[0],
          "The deterministic school person record conflicts with another identity or person type.",{personId});
      }
      if(group.uid&&existingPerson.authUid&&existingPerson.authUid!==group.uid){
        blocked=true;addIssue(issues,"canonical_auth_collision","integrity",group.names[0],
          "The school person record is linked to a different account.",{personId,targetUid:group.uid});
      }
      if(group.uid&&!existingPerson.authUid&&existingPerson.migration?.source!=="mcs_legacy_v3"){
        blocked=true;addIssue(issues,"unverified_existing_person_link","integrity",group.names[0],
          "An existing school person occupies the deterministic identity record but has no verified legacy migration provenance. Link it through the reviewed invitation/recovery workflow instead.",
          {personId,targetUid:group.uid});
      }
    }
    const member=group.uid?memberByUid.get(group.uid)||null:null;
    if(member?.personId&&personId&&member.personId!==personId){
      blocked=true;addIssue(issues,"membership_person_collision","integrity",group.names[0],
        "The existing school membership is linked to a different person record.",{personId,targetUid:group.uid});
    }
    const names=[...new Set(group.names.filter(Boolean))],name=names[0]||"School person";
    if(names.length>1)addIssue(issues,"legacy_name_review","review",name,
      "Legacy records for the same verified account contain more than one display name.",
      {personId,targetUid:group.uid});
    if(group.legacyAdmin&&!member?.roles?.includes("school_admin"))
      addIssue(issues,"legacy_admin_not_promoted","review",name,
        "A legacy admin grant was preserved as history but was not converted into School Administrator access.",
        {personId,targetUid:group.uid});
    if(!group.uid)addIssue(issues,"legacy_account_unresolved","attention",name,
      "No enabled verified Firebase account matches this legacy record. The person can be adopted without school access and linked later by invitation.",
      {personId});
    const roles=[...group.roles].sort();
    const effectiveRoles=[...new Set([...(Array.isArray(member?.roles)?member.roles:[]),...roles])].sort();
    const memberStatus=member?.status||((group.active&&roles.length)?"active":"suspended");
    const personState=blocked?"blocked":existingPerson?"existing":"create";
    const membershipState=!group.uid||!roles.length?"none":blocked?"blocked":!member?"create":
      (effectiveRoles.join("|")!==(Array.isArray(member.roles)?[...new Set(member.roles)].sort():[]).join("|")||
       !member.personId)?"update":"existing";
    const candidate={key:group.key,kind,uid:group.uid,personId,displayName:name,
      status:group.active?"active":"archived",roles,effectiveRoles,memberStatus,
      sourceIds:[...new Set(group.sourceIds)].sort(),
      legacyStudentIds:group.studentRows.map(row=>row.id).sort(),
      legacyStaffRecordIds:group.staffRows.map(row=>row.id).sort(),
      studentRows:group.studentRows,staffRows:group.staffRows,
      personState,membershipState,blocked,existingPerson,member};
    candidates.push(candidate);candidateByGroup.set(group.key,candidate);
  }

  const sectionNames=nameIndex(sections),yearNames=nameIndex(years),subjectNames=nameIndex(subjects);
  const activeOfferings=offerings.filter(row=>row.data.schoolId===ctx.schoolId&&row.data.status==="active");
  const currentEnrollments=new Map(enrollments.map(row=>[row.id,row.data]));
  const currentAssignments=new Map(assignments.map(row=>[row.id,row.data]));
  const enrollmentMap=new Map(),assignmentMap=new Map();

  function exact(index,label,type,source,candidate){
    const rows=index.get(normalize(label))||[];
    if(rows.length===1)return rows[0];
    addIssue(issues,rows.length?"duplicate_"+type+"_label":type+"_unmapped","attention",
      candidate?.displayName||source,
      rows.length?"More than one active "+type+" matches the legacy label “"+clean(label,120)+"”.":
        "No active school-wide "+type+" exactly matches the legacy label “"+clean(label,120)+"”.",
      {personId:candidate?.personId||null});
    return null;
  }
  for(const row of students){
    const candidate=candidateByGroup.get(sourceToGroup.get("students/"+row.id));
    if(!candidate||candidate.blocked||candidate.kind!=="student")continue;
    const sectionLabel=clean(row.data.section||row.data.sectionName||row.data.classSection,140);
    const yearLabel=clean(row.data.schoolYear||row.data.school_year||row.data.academicYear||row.data.year,140);
    if(!sectionLabel){
      addIssue(issues,"student_section_missing","attention",candidate.displayName,
        "Legacy student record "+row.id+" has no section label.",{personId:candidate.personId});continue;
    }
    const section=exact(sectionNames,sectionLabel,"section","students/"+row.id,candidate);if(!section)continue;
    let matches=activeOfferings.filter(item=>item.data.sectionId===section.id);
    if(yearLabel){
      const year=exact(yearNames,yearLabel,"academic year","students/"+row.id,candidate);if(!year)continue;
      matches=matches.filter(item=>item.data.yearId===year.id);
    }else{
      const yearsInMatches=[...new Set(matches.map(item=>item.data.yearId).filter(Boolean))];
      if(yearsInMatches.length>1){
        addIssue(issues,"student_year_ambiguous","attention",candidate.displayName,
          "The legacy student row has no academic year and matches offerings from more than one year.",
          {personId:candidate.personId});continue;
      }
    }
    if(!matches.length){
      addIssue(issues,"student_section_has_no_offering","attention",candidate.displayName,
        "The matched section/year has no active school-wide course offering.",{personId:candidate.personId});continue;
    }
    for(const offering of matches){
      const enrollmentId=rowKey(candidate.personId,offering.id),prior=currentEnrollments.get(enrollmentId);
      const key=enrollmentId,existing=enrollmentMap.get(key);
      const status=activeStatus(row.data.status)?"active":"ended";
      if(existing){if(status==="active")existing.status="active";existing.sourceIds.push("students/"+row.id);continue;}
      let state="create";
      if(prior){
        state=prior.schoolId===ctx.schoolId&&prior.personId===candidate.personId&&prior.offeringId===offering.id?"existing":"blocked";
        if(state==="blocked")addIssue(issues,"enrollment_collision","integrity",candidate.displayName,
          "An existing enrollment uses the migration key for different records.",{personId:candidate.personId});
      }
      enrollmentMap.set(key,{enrollmentId,personId:candidate.personId,studentUid:candidate.uid||null,
        offeringId:offering.id,programId:offering.data.programId,yearId:offering.data.yearId,
        termId:offering.data.termId,sectionId:offering.data.sectionId,subjectId:offering.data.subjectId,
        status,state,sourceIds:["students/"+row.id],candidateKey:candidate.key});
    }
  }

  for(const row of staff){
    if(row.data.role!=="teacher"||!activeStatus(row.data.status))continue;
    const candidate=candidateByGroup.get(sourceToGroup.get("staff_access/"+row.id));
    if(!candidate||candidate.blocked||candidate.kind!=="staff"||!candidate.uid||!candidate.effectiveRoles.includes("teacher"))continue;
    const sectionLabels=Array.isArray(row.data.sections)?row.data.sections.map(value=>clean(value,140)).filter(Boolean):[];
    const subjectLabels=Array.isArray(row.data.subjects)?row.data.subjects.map(value=>clean(value,140)).filter(Boolean):[];
    if(!sectionLabels.length){
      addIssue(issues,"teacher_section_scope_missing","attention",candidate.displayName,
        "Legacy teacher access has no section scope to convert into course assignments.",{personId:candidate.personId});continue;
    }
    for(const sectionLabel of sectionLabels){
      const section=exact(sectionNames,sectionLabel,"section","staff_access/"+row.id,candidate);if(!section)continue;
      let subjectIds=[];
      for(const subjectLabel of subjectLabels){
        const subject=exact(subjectNames,subjectLabel,"subject","staff_access/"+row.id,candidate);
        if(subject)subjectIds.push(subject.id);
      }
      subjectIds=[...new Set(subjectIds)];
      if(subjectLabels.length&&!subjectIds.length)continue;
      let matches=activeOfferings.filter(item=>item.data.sectionId===section.id);
      if(subjectIds.length)matches=matches.filter(item=>subjectIds.includes(item.data.subjectId));
      if(!matches.length){
        addIssue(issues,"teacher_scope_has_no_offering","attention",candidate.displayName,
          "The legacy teacher section/subject scope has no matching active course offering.",
          {personId:candidate.personId});continue;
      }
      for(const offering of matches){
        const assignmentId=rowKey(candidate.uid,offering.id),prior=currentAssignments.get(assignmentId);
        if(assignmentMap.has(assignmentId))continue;
        let state="create";
        if(prior){
          state=prior.schoolId===ctx.schoolId&&prior.teacherUid===candidate.uid&&prior.offeringId===offering.id?"existing":"blocked";
          if(state==="blocked")addIssue(issues,"assignment_collision","integrity",candidate.displayName,
            "An existing teaching assignment uses the migration key for different records.",
            {personId:candidate.personId,targetUid:candidate.uid});
        }
        assignmentMap.set(assignmentId,{assignmentId,teacherUid:candidate.uid,personId:candidate.personId,
          offeringId:offering.id,programId:offering.data.programId,yearId:offering.data.yearId,
          termId:offering.data.termId,sectionId:offering.data.sectionId,subjectId:offering.data.subjectId,
          status:"active",state,sourceIds:["staff_access/"+row.id],candidateKey:candidate.key});
      }
    }
  }

  const enrollmentCandidates=[...enrollmentMap.values()].sort((a,b)=>a.enrollmentId.localeCompare(b.enrollmentId));
  const assignmentCandidates=[...assignmentMap.values()].sort((a,b)=>a.assignmentId.localeCompare(b.assignmentId));
  const digest=sha(JSON.stringify(canonical({
    candidates:candidates.map(row=>({key:row.key,kind:row.kind,uid:row.uid,personId:row.personId,
      status:row.status,roles:row.roles,personState:row.personState,membershipState:row.membershipState,
      memberStatus:row.memberStatus,sourceIds:row.sourceIds})),
    enrollments:enrollmentCandidates.map(row=>({enrollmentId:row.enrollmentId,status:row.status,state:row.state,sourceIds:row.sourceIds})),
    assignments:assignmentCandidates.map(row=>({assignmentId:row.assignmentId,state:row.state,sourceIds:row.sourceIds})),
    issues:issues.map(row=>({type:row.type,severity:row.severity,personId:row.personId||null,targetUid:row.targetUid||null}))
  })));
  return {school,students,staff,teachers,candidates,candidateByGroup,enrollmentCandidates,assignmentCandidates,issues,digest};
}
function publicPreview(model){
  const count=(items,predicate)=>items.filter(predicate).length;
  const issues=[...model.issues].sort((a,b)=>{
    const rank={integrity:0,attention:1,review:2};return (rank[a.severity]??9)-(rank[b.severity]??9)||a.label.localeCompare(b.label);
  });
  return {
    schoolId:SCHOOL_ID,digest:model.digest,
    summary:{
      legacyStudentRows:model.students.length,legacyStaffRows:model.staff.length,
      legacyTeacherProfiles:model.teachers.length,
      peopleToCreate:count(model.candidates,row=>row.personState==="create"),
      peopleExisting:count(model.candidates,row=>row.personState==="existing"),
      verifiedAccounts:count(model.candidates,row=>Boolean(row.uid)),
      unlinkedPeople:count(model.candidates,row=>!row.uid),
      membershipsToCreate:count(model.candidates,row=>row.membershipState==="create"),
      membershipsToUpdate:count(model.candidates,row=>row.membershipState==="update"),
      enrollmentCandidates:count(model.enrollmentCandidates,row=>row.state==="create"),
      teachingAssignmentCandidates:count(model.assignmentCandidates,row=>row.state==="create"),
      existingEnrollments:count(model.enrollmentCandidates,row=>row.state==="existing"),
      existingTeachingAssignments:count(model.assignmentCandidates,row=>row.state==="existing"),
      integrityIssues:issues.filter(row=>row.severity==="integrity").length,
      attentionItems:issues.filter(row=>row.severity==="attention").length,
      reviewItems:issues.filter(row=>row.severity==="review").length
    },
    people:model.candidates.slice(0,80).map(row=>({
      personId:row.personId,displayName:row.displayName,kind:row.kind,
      accountLinked:Boolean(row.uid),roles:row.roles,personState:row.personState,
      membershipState:row.membershipState,status:row.status
    })),
    issues:issues.slice(0,120),truncatedPeople:model.candidates.length>80,truncatedIssues:issues.length>120,
    notes:[
      "Legacy admin grants are never promoted to school_admin automatically.",
      "Unverified legacy records can become school people without receiving account access.",
      "Existing school suspensions are preserved.",
      "Class relationships are exact-label candidates and are applied only with separate administrator acknowledgement."
    ]
  };
}
async function applyIdentity({db,ctx,candidate,reason}){
  if(candidate.blocked||!candidate.personId)return {state:"blocked"};
  const personRef=db.doc("schools/"+ctx.schoolId+"/people/"+candidate.personId);
  const memberRef=candidate.uid?db.doc("schools/"+ctx.schoolId+"/memberships/"+candidate.uid):null;
  const indexRef=candidate.uid?db.doc("platform_users/"+candidate.uid+"/memberships/"+ctx.schoolId):null;
  const auditRef=db.collection("schools/"+ctx.schoolId+"/directory_audit").doc();
  return db.runTransaction(async tx=>{
    const [person,member,index]=await Promise.all([
      tx.get(personRef),memberRef?tx.get(memberRef):Promise.resolve(null),indexRef?tx.get(indexRef):Promise.resolve(null)
    ]);
    if(person.exists){
      const data=person.data();
      if(data.schoolId!==ctx.schoolId||data.kind!==candidate.kind||
         (data.authUid&&candidate.uid&&data.authUid!==candidate.uid))
        deny("failed-precondition","A school person changed during legacy consolidation. Preview again.");
      if(candidate.uid&&!data.authUid){
        tx.update(personRef,{authUid:candidate.uid,updatedAt:FieldValue.serverTimestamp(),
          revision:(data.revision||1)+1});
      }
    }else{
      const now=FieldValue.serverTimestamp();
      tx.create(personRef,{schoolId:ctx.schoolId,displayName:candidate.displayName,
        searchKey:candidate.displayName.toLocaleLowerCase("en")+"#"+candidate.personId,
        kind:candidate.kind,status:candidate.status,authUid:candidate.uid||null,
        legacyStudentIds:candidate.legacyStudentIds,legacyStaffRecordIds:candidate.legacyStaffRecordIds,
        migration:{source:"mcs_legacy_v3",scope:"people_access",sourceIds:candidate.sourceIds},
        createdByUid:ctx.uid,createdAt:now,updatedAt:now,revision:1});
    }
    if(candidate.uid&&candidate.roles.length){
      const prior=member?.exists?member.data():null;
      if(prior?.personId&&prior.personId!==candidate.personId)
        deny("failed-precondition","A school membership changed during legacy consolidation. Preview again.");
      const roles=[...new Set([...(Array.isArray(prior?.roles)?prior.roles:[]),...candidate.roles])].sort();
      const status=prior?.status||candidate.memberStatus;
      const revision=(prior?.revision||0)+1,now=FieldValue.serverTimestamp();
      tx.set(memberRef,{schoolId:ctx.schoolId,personId:candidate.personId,status,roles,revision,
        displayName:candidate.displayName,updatedAt:now,updatedByUid:ctx.uid},{merge:true});
      tx.set(indexRef,{schoolId:ctx.schoolId,status,roles,revision,updatedAt:now},{merge:true});
    }
    tx.create(auditRef,{schoolId:ctx.schoolId,actorUid:ctx.uid,personId:candidate.personId,
      targetUid:candidate.uid||null,action:"legacy_person_adopted",reason,
      sourceIds:candidate.sourceIds.slice(0,30),createdAt:FieldValue.serverTimestamp()});
    return {state:person.exists?"existing":"created"};
  });
}
async function applyAcademic({db,ctx,model,reason}){
  const writer=db.bulkWriter(),promises=[];let requested=0;
  writer.onWriteError(error=>error.failedAttempts<3);
  for(const row of model.enrollmentCandidates){
    if(row.state!=="create")continue;
    const candidate=model.candidateByGroup.get(row.candidateKey);
    if(!candidate||candidate.blocked)continue;
    requested++;
    promises.push(writer.create(db.doc("schools/"+ctx.schoolId+"/enrollments/"+row.enrollmentId),{
      schoolId:ctx.schoolId,personId:row.personId,offeringId:row.offeringId,
      programId:row.programId,yearId:row.yearId,termId:row.termId,
      sectionId:row.sectionId,subjectId:row.subjectId,status:row.status,revision:1,
      migration:{source:"mcs_legacy_v3",scope:"people_access",sourceIds:row.sourceIds},
      createdByUid:ctx.uid,createdAt:FieldValue.serverTimestamp()
    }));
  }
  for(const row of model.assignmentCandidates){
    if(row.state!=="create")continue;
    const candidate=model.candidateByGroup.get(row.candidateKey);
    if(!candidate||candidate.blocked||candidate.memberStatus!=="active")continue;
    requested++;
    promises.push(writer.create(db.doc("schools/"+ctx.schoolId+"/staff_assignments/"+row.assignmentId),{
      schoolId:ctx.schoolId,teacherUid:row.teacherUid,offeringId:row.offeringId,
      yearId:row.yearId,termId:row.termId,subjectId:row.subjectId,sectionId:row.sectionId,
      status:"active",revision:1,migration:{source:"mcs_legacy_v3",scope:"people_access",sourceIds:row.sourceIds},
      createdByUid:ctx.uid,createdAt:FieldValue.serverTimestamp()
    }));
  }
  await writer.close();
  const settled=await Promise.allSettled(promises);
  return {requested,created:settled.filter(row=>row.status==="fulfilled").length,
    failed:settled.filter(row=>row.status==="rejected").length,reason};
}
function createSchoolLegacyDirectoryAdoptionService({db,resolveUserByEmail}){
  if(typeof resolveUserByEmail!=="function")throw Error("resolveUserByEmail is required.");
  return async request=>{
    const input=request.data||{};
    const ctx=await getSchoolContext({db,request,schoolId:input.schoolId,roles:["school_admin"],allowDraftAdmin:true});
    if(ctx.schoolId!==SCHOOL_ID)
      deny("failed-precondition","Legacy directory adoption is available only for the MCS migration school.");

    if(input.action==="list_legacy_requests"){
      const snapshot=await db.collection("account_requests").limit(201).get();
      if(snapshot.size===201)deny("resource-exhausted","Legacy access requests exceed the review limit.");
      const items=snapshot.docs.map(doc=>({id:doc.id,...doc.data()}))
        .filter(row=>row.status==="pending")
        .map(row=>({
          targetUid:row.id,displayName:clean(row.displayName,140)||"Unnamed account",
          email:normalizeEmail(row.email)||"",requestedRole:clean(row.requestedRole,30)||"guest",
          revision:Number.isInteger(row.revision)?row.revision:1
        }))
        .sort((a,b)=>a.displayName.localeCompare(b.displayName)||a.email.localeCompare(b.email));
      return {schoolId:ctx.schoolId,items,count:items.length};
    }

    if(input.action==="decide_legacy_request"){
      const targetUid=identifier(input.targetUid,"Account UID");
      const decision=input.decision;
      if(!["approved","rejected"].includes(decision))
        deny("invalid-argument","Choose approve or reject.");
      const role=input.role;
      if(decision==="approved"&&!["student","teacher"].includes(role))
        deny("invalid-argument","Choose Student or Teacher access.");
      const reason=clean(input.reason,500);
      if(reason.length<12)deny("invalid-argument","Explain the access decision in at least 12 characters.");
      const requestRef=db.doc("account_requests/"+targetUid);
      const initial=await requestRef.get();
      if(!initial.exists||initial.data().status!=="pending")
        deny("failed-precondition","This legacy access request is no longer pending.");
      const initialEmail=normalizeEmail(initial.data().email);
      let account=null;
      if(decision==="approved"){
        if(!initialEmail)deny("failed-precondition","The legacy request has no valid verified email.");
        account=await resolveUserByEmail(initialEmail).catch(error=>{
          if(error?.code==="auth/user-not-found")return null;
          throw error;
        });
        if(!account||account.uid!==targetUid||account.disabled||!account.emailVerified||
           normalizeEmail(account.email)!==initialEmail)
          deny("failed-precondition","Approval requires the same enabled, verified Firebase account as the legacy request.");
      }
      let personId=null,personRef=null;
      if(decision==="approved"){
        const kind=role==="student"?"student":"staff";
        const stableId=stablePersonId(targetUid);
        const importedId="imp_"+sha(kind+"\0email:"+initialEmail).slice(0,40);
        const [stablePerson,importedPerson]=await Promise.all([
          db.doc("schools/"+ctx.schoolId+"/people/"+stableId).get(),
          db.doc("schools/"+ctx.schoolId+"/people/"+importedId).get()
        ]);
        if(stablePerson.exists&&importedPerson.exists&&stableId!==importedId)
          deny("failed-precondition","Both a migrated and imported school person match this account. Resolve the duplicate before approving access.");
        personId=importedPerson.exists?importedId:stableId;
        personRef=db.doc("schools/"+ctx.schoolId+"/people/"+personId);
      }
      const memberRef=personId?db.doc("schools/"+ctx.schoolId+"/memberships/"+targetUid):null;
      const indexRef=personId?db.doc("platform_users/"+targetUid+"/memberships/"+ctx.schoolId):null;
      const auditRef=db.collection("schools/"+ctx.schoolId+"/directory_audit").doc();
      await db.runTransaction(async tx=>{
        const current=await tx.get(requestRef);
        if(!current.exists||current.data().status!=="pending"||
           (Number.isInteger(input.expectedRevision)&&current.data().revision!==input.expectedRevision))
          deny("failed-precondition","This access request changed. Refresh before deciding.");
        const before=current.data(),now=FieldValue.serverTimestamp(),
          revision=(Number.isInteger(before.revision)?before.revision:0)+1;
        if(decision==="approved"){
          const [person,member]=await Promise.all([tx.get(personRef),tx.get(memberRef)]);
          const expectedKind=role==="student"?"student":"staff";
          if(person.exists&&(person.data().schoolId!==ctx.schoolId||person.data().kind!==expectedKind||
             (person.data().authUid&&person.data().authUid!==targetUid)))
            deny("failed-precondition","The verified account conflicts with an existing school person record.");
          if(member.exists){
            const prior=member.data();
            if(prior.schoolId!==ctx.schoolId||prior.status==="suspended")
              deny("failed-precondition","This account has suspended or conflicting school access. Use the reviewed recovery workflow.");
            if(prior.personId&&prior.personId!==personId)
              deny("failed-precondition","This school membership is linked to another person record.");
          }
          const display=displayName(before,role==="student"?"Student":"Staff");
          if(!person.exists){
            tx.create(personRef,{schoolId:ctx.schoolId,displayName:display,
              searchKey:display.toLocaleLowerCase("en")+"#"+personId,
              kind:expectedKind,status:"active",authUid:targetUid,
              migration:{source:"mcs_legacy_v3",scope:"legacy_access_request",sourceIds:["account_requests/"+targetUid]},
              createdByUid:ctx.uid,createdAt:now,updatedAt:now,revision:1});
          }else if(!person.data().authUid){
            tx.update(personRef,{authUid:targetUid,updatedAt:now,revision:(person.data().revision||1)+1});
          }
          const prior=member.exists?member.data():null;
          const roles=[...new Set([...(Array.isArray(prior?.roles)?prior.roles:[]),role])].sort();
          const memberRevision=(prior?.revision||0)+1;
          tx.set(memberRef,{schoolId:ctx.schoolId,personId,status:"active",roles,
            displayName:display,revision:memberRevision,updatedByUid:ctx.uid,updatedAt:now},{merge:true});
          tx.set(indexRef,{schoolId:ctx.schoolId,status:"active",roles,revision:memberRevision,updatedAt:now},{merge:true});
        }
        const after={...before,status:decision,approvedRole:decision==="approved"?role:null,
          reason,revision,decidedBy:ctx.uid,updatedAt:now,
          ...(personId?{schoolWideSchoolId:ctx.schoolId,schoolWidePersonId:personId,schoolWideMigratedAt:now}:{})};
        tx.set(requestRef,after);
        tx.create(requestRef.collection("revisions").doc(String(revision)),{
          before,after,actorUid:ctx.uid,createdAt:now
        });
        tx.create(auditRef,{schoolId:ctx.schoolId,actorUid:ctx.uid,targetUid,
          personId,action:decision==="approved"?"legacy_access_request_approved":"legacy_access_request_rejected",
          role:decision==="approved"?role:null,reason,createdAt:now});
      });
      return {schoolId:ctx.schoolId,targetUid,status:decision,role:decision==="approved"?role:null,personId};
    }

    const model=await buildModel({db,resolveUserByEmail,ctx});
    if(input.action==="preview")return publicPreview(model);
    if(input.action!=="apply")deny("invalid-argument","Unknown legacy directory adoption operation.");
    const reason=clean(input.reason,500);
    if(reason.length<12)deny("invalid-argument","Explain the school-wide legacy consolidation in at least 12 characters.");
    if(typeof input.expectedDigest!=="string"||input.expectedDigest!==model.digest)
      deny("failed-precondition","Legacy or school-wide directory data changed. Preview again before applying.");
    const includeAcademic=input.includeAcademic===true;
    if(includeAcademic&&input.confirmAcademicMappings!==true)
      deny("failed-precondition","Confirm the reviewed section/subject mapping before applying class relationships.");

    const results=await mapLimit(model.candidates,8,async candidate=>{
      try{return await applyIdentity({db,ctx,candidate,reason});}
      catch(error){return {state:"failed",message:error?.message||"Identity adoption failed."};}
    });
    const identity={
      created:results.filter(row=>row.state==="created").length,
      existing:results.filter(row=>row.state==="existing").length,
      blocked:results.filter(row=>row.state==="blocked").length,
      failed:results.filter(row=>row.state==="failed").length
    };
    const academic=includeAcademic?await applyAcademic({db,ctx,model,reason}):
      {requested:0,created:0,failed:0,skipped:true};
    await db.doc("schools/"+ctx.schoolId+"/directory_migrations/legacy-v3-people-access").set({
      schoolId:ctx.schoolId,source:"mcs_legacy_v3",scope:"people_access",digest:model.digest,
      status:identity.failed||academic.failed?"partial":"applied",
      identity,academic,includeAcademic,reason,updatedByUid:ctx.uid,updatedAt:FieldValue.serverTimestamp()
    },{merge:true});
    await db.collection("schools/"+ctx.schoolId+"/directory_audit").add({
      schoolId:ctx.schoolId,actorUid:ctx.uid,action:"legacy_directory_consolidation_applied",
      digest:model.digest,includeAcademic,identity,academic,reason,createdAt:FieldValue.serverTimestamp()
    });
    return {schoolId:ctx.schoolId,digest:model.digest,status:identity.failed||academic.failed?"partial":"applied",
      identity,academic,remainingIssues:model.issues.length};
  };
}
module.exports={createSchoolLegacyDirectoryAdoptionService,stablePersonId,legacyPersonId,rowKey};
