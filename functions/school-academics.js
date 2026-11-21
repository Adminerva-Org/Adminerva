"use strict";
/**
 * School-specific academic catalog, enrollments and staff teaching grants.
 * Person !== auth user !== enrollment. School and subject/section/year offering
 * references are checked on the server for every mutation or class-roster read.
 */
const {FieldValue}=require("firebase-admin/firestore");
const {createHash}=require("node:crypto");
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");
const {writeSchoolNotification}=require("./school-notifications.js");
const CATALOG=new Set(["academic_years","academic_programs","terms","subjects","sections"]);
const PERIOD_TYPES=new Set(["term","semester","quarter","trimester","custom"]);
const ROSTER_MODES=new Set(["section","selective"]);
const DEFAULT_ACADEMIC_YEAR_START_MONTH=7;
const DEFAULT_ACADEMIC_YEAR_END_MONTH=5;
function deny(code,message){throw new TenantAccessError(code,message)}
function academicMonth(value,fallback,label){
 const resolved=value===undefined||value===null||value===""?fallback:Number(value);
 if(!Number.isInteger(resolved)||resolved<1||resolved>12)
  deny("invalid-argument",label+" must be a month number from 1 to 12.");
 return resolved;
}
function optionalAcademicDate(value,label){
 const text=typeof value==="string"?value.trim():"";
 if(!text)return null;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(text))deny("invalid-argument",label+" must use YYYY-MM-DD.");
 const date=new Date(text+"T00:00:00Z");
 if(Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==text)
  deny("invalid-argument",label+" is not a valid calendar date.");
 return text;
}
function checkId(value,label="Identifier",max=80){
 if(typeof value!=="string"||value.length>max||!new RegExp("^[A-Za-z0-9][A-Za-z0-9_-]{0,"+(max-1)+"}$").test(value))deny("invalid-argument",label+" must contain 1–80 letters, digits, underscores or hyphens.");
 return value;
}
function checkName(value,label="Name"){
 if(typeof value!=="string"||!value.trim()||value.trim().length>140)
  deny("invalid-argument",label+" is required and cannot exceed 140 characters.");
 return value.trim();
}
const SPECIAL_SECTION_LEVELS=new Set(["nursery_prep","kinder_1","kinder_2","sned_elem","sned_jhs"]);
function sectionLevel(value){
 const raw=String(value??"").trim().toLowerCase();
 if(/^([1-9]|1[0-2])$/.test(raw))return raw;
 if(SPECIAL_SECTION_LEVELS.has(raw))return raw;
 deny("invalid-argument","Choose a valid grade or school level for this section.");
}
function optionalShortText(value,label,max=80){
 const text=typeof value==="string"?value.trim():"";
 if(!text)return null;
 if(text.length>max)deny("invalid-argument",label+" cannot exceed "+max+" characters.");
 return text;
}
function isSeniorHighName(value){
 return /senior high|\bshs\b/i.test(String(value||""));
}
function rowKey(...values){
 const checked=values.map(v=>checkId(v,"Key segment",330));
 return createHash("sha256").update(JSON.stringify(checked)).digest("hex");
}
function scheduleMinute(value){
 const match=/^([0-9]{2}):([0-9]{2})$/.exec(String(value||""));
 return match?Number(match[1])*60+Number(match[2]):null;
}
function scheduleMeetingOverlap(first,second){
 if(!first||!second||first.day!==second.day)return false;
 const aStart=scheduleMinute(first.startTime),aEnd=scheduleMinute(first.endTime),
  bStart=scheduleMinute(second.startTime),bEnd=scheduleMinute(second.endTime);
 return [aStart,aEnd,bStart,bEnd].every(Number.isFinite)&&aStart<bEnd&&bStart<aEnd;
}
function teachingLead(configured,teacherUids){
 const ids=[...new Set((teacherUids||[]).filter(Boolean))],
  configuredUid=typeof configured==="string"?configured:"";
 if(configuredUid&&ids.includes(configuredUid))
  return {primaryTeacherUid:configuredUid,primarySource:"explicit",primaryNeedsReview:false};
 if(ids.length===1)
  return {primaryTeacherUid:ids[0],primarySource:configuredUid?"inferred_stale":"inferred",
   primaryNeedsReview:Boolean(configuredUid)};
 return {primaryTeacherUid:"",primarySource:configuredUid?"stale":ids.length?"missing":"none",
  primaryNeedsReview:ids.length>0||Boolean(configuredUid)};
}
function createSchoolAcademicsService({db}) {
 const root=id=>({doc:path=>db.doc("schools/"+id+"/"+path)});
 return async request=>{
  const input=request.data||{},ctx=await getSchoolContext({db,request,schoolId:input.schoolId,allowDraftAdmin:true});
  const schoolRoot=root(ctx.schoolId),uid=ctx.uid;
  const admin=ctx.roles.includes("school_admin"),teacher=ctx.roles.includes("teacher");
  const schoolRef=db.doc("platform_schools/"+ctx.schoolId);
  const memberRef=db.doc("schools/"+ctx.schoolId+"/memberships/"+uid);
  function requireAdmin(){if(!admin)deny("permission-denied","School administration is required.");}
  async function ensureTeacherScheduleAvailable(tx,teacherUid,offeringId){
   const targetScheduleRef=schoolRoot.doc("class_schedules/"+offeringId),
    grantsQuery=db.collection("schools/"+ctx.schoolId+"/staff_assignments").where("teacherUid","==",teacherUid).limit(201);
   const [targetSchedule,grants]=await Promise.all([tx.get(targetScheduleRef),tx.get(grantsQuery)]);
   if(grants.size===201)deny("resource-exhausted","Teacher schedule conflict review requires pagination.");
   if(!targetSchedule.exists||targetSchedule.data().schoolId!==ctx.schoolId||
      targetSchedule.data().status==="archived"||!Array.isArray(targetSchedule.data().meetings)||
      !targetSchedule.data().meetings.length)return;
   const otherIds=[...new Set(grants.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&
     doc.data().status==="active"&&doc.data().offeringId!==offeringId).map(doc=>doc.data().offeringId))];
   const schedules=await Promise.all(otherIds.map(id=>tx.get(schoolRoot.doc("class_schedules/"+id))));
   for(const schedule of schedules){
    if(!schedule.exists||schedule.data().schoolId!==ctx.schoolId||schedule.data().status==="archived")continue;
    const otherMeetings=Array.isArray(schedule.data().meetings)?schedule.data().meetings:[];
    for(const target of targetSchedule.data().meetings)for(const existing of otherMeetings)
     if(scheduleMeetingOverlap(target,existing))
      deny("failed-precondition","This teacher already has another official class at "+target.day+" "+target.startTime+"–"+target.endTime+". Change the class schedule or choose another teacher.");
   }
  }
  async function checkWriteAuthority(tx){
   if(ctx.platformOverride)return;
   const [school,membership]=await Promise.all([tx.get(schoolRef),tx.get(memberRef)]);
   if(!school.exists||!["draft","active","pilot"].includes(school.data().state)||!membership.exists||
    membership.data().schoolId!==ctx.schoolId||membership.data().status!=="active"||
    !Array.isArray(membership.data().roles)||!membership.data().roles.includes("school_admin"))
    deny("permission-denied","Your school administration permission has changed.");
  }
  const audit=(action,extra={})=>({schoolId:ctx.schoolId,actorUid:uid,action,
    actorMode:ctx.platformOverride&&String(input.platformMode||"").toLowerCase()==="assist"?
      "system_admin_assist":"school_admin",
    ...extra,createdAt:FieldValue.serverTimestamp()});
  if(input.action==="planning_options"){
   if(!admin&&!teacher)deny("permission-denied","Teaching access is required.");
   const assignmentScope=String(input.assignmentScope||"");
   if(assignmentScope&&assignmentScope!=="teacher")
    deny("invalid-argument","Planning assignment scope is invalid.");
   if(assignmentScope==="teacher"&&!teacher)
    deny("permission-denied","Teacher assignment scope requires an active teacher role.");
   let allowed=null;
   if(!ctx.platformOverride&&(!admin||assignmentScope==="teacher")){
    const grants=await db.collection("schools/"+ctx.schoolId+"/staff_assignments")
      .where("teacherUid","==",uid).limit(101).get();
    if(grants.size===101)deny("resource-exhausted","Teaching assignments require pagination before planning options can load.");
    allowed=new Set(grants.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&doc.data().status==="active")
      .map(doc=>doc.data().offeringId));
   }
   const offerings=await db.collection("schools/"+ctx.schoolId+"/course_offerings").limit(201).get();
   if(offerings.size===201)deny("resource-exhausted","Course offerings require pagination before planning options can load.");
   const active=offerings.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&doc.data().status==="active"&&
     (allowed===null||allowed.has(doc.id)));
   const sectionIds=[...new Set(active.map(doc=>doc.data().sectionId).filter(Boolean))],
     subjectIds=[...new Set(active.map(doc=>doc.data().subjectId).filter(Boolean))],
     yearIds=[...new Set(active.map(doc=>doc.data().yearId).filter(Boolean))],
     termIds=[...new Set(active.map(doc=>doc.data().termId).filter(Boolean))],
     programIds=[...new Set(active.map(doc=>doc.data().programId).filter(Boolean))];
   if(sectionIds.length+subjectIds.length+yearIds.length+termIds.length+programIds.length>500)
    deny("resource-exhausted","Planning option references exceed the bounded pilot review limit.");
   const [sections,subjects,years,terms,programs]=await Promise.all([
    Promise.all(sectionIds.map(id=>schoolRoot.doc("sections/"+id).get())),
    Promise.all(subjectIds.map(id=>schoolRoot.doc("subjects/"+id).get())),
    Promise.all(yearIds.map(id=>schoolRoot.doc("academic_years/"+id).get())),
    Promise.all(termIds.map(id=>schoolRoot.doc("terms/"+id).get())),
    Promise.all(programIds.map(id=>schoolRoot.doc("academic_programs/"+id).get()))
   ]);
   const named=docs=>new Map(docs.filter(doc=>doc.exists&&doc.data().schoolId===ctx.schoolId&&
      doc.data().status==="active"&&typeof doc.data().name==="string"&&doc.data().name.trim())
     .map(doc=>[doc.id,doc.data().name.trim().slice(0,140)]));
   const sectionNames=named(sections),subjectNames=named(subjects),yearNames=named(years),
    termNames=named(terms),programNames=named(programs);
   return {
    schoolId:ctx.schoolId,
    sections:[...sectionNames.values()].sort((a,b)=>a.localeCompare(b)),
    sectionRecords:sections.filter(doc=>doc.exists&&sectionNames.has(doc.id)).map(doc=>({
      sectionId:doc.id,name:sectionNames.get(doc.id),
      programId:doc.data().programId||null,
      gradeLevel:typeof doc.data().gradeLevel==="string"?doc.data().gradeLevel:"",
      pathway:typeof doc.data().pathway==="string"?doc.data().pathway:""
    })).sort((a,b)=>a.name.localeCompare(b.name)),
    subjects:[...subjectNames.values()].sort((a,b)=>a.localeCompare(b)),
    schoolYears:[...yearNames.values()].sort((a,b)=>a.localeCompare(b)),
    terms:[...termNames.values()].sort((a,b)=>a.localeCompare(b)),
    programs:[...programNames.values()].sort((a,b)=>a.localeCompare(b)),
    periodRecords:terms.filter(doc=>doc.exists&&termNames.has(doc.id)).map(doc=>({
      termId:doc.id,name:termNames.get(doc.id),yearId:doc.data().yearId,
      programId:doc.data().programId,periodType:doc.data().periodType||"term",
      sequence:Number(doc.data().sequence)||1
    })).sort((a,b)=>a.sequence-b.sequence||a.name.localeCompare(b.name)),
    programRecords:programs.filter(doc=>doc.exists&&programNames.has(doc.id)).map(doc=>({
      programId:doc.id,name:programNames.get(doc.id)
    })).sort((a,b)=>a.name.localeCompare(b.name)),
    offerings:active.map(doc=>({
      offeringId:doc.id,
      programId:doc.data().programId,programName:programNames.get(doc.data().programId)||null,
      sectionId:doc.data().sectionId,sectionName:sectionNames.get(doc.data().sectionId)||null,
      subjectId:doc.data().subjectId,subjectName:subjectNames.get(doc.data().subjectId)||null,
      yearId:doc.data().yearId,yearName:yearNames.get(doc.data().yearId)||null,
      termId:doc.data().termId,termName:termNames.get(doc.data().termId)||null
    })).filter(item=>item.programName&&item.sectionName&&item.subjectName)
   };
  }
  if(input.action==="my_advisory_sections"){
   if(!teacher)deny("permission-denied","Teacher access is required for advisory sections.");
   const adviserSnap=await db.collection("schools/"+ctx.schoolId+"/section_advisers")
    .where("teacherUid","==",uid).limit(51).get();
   if(adviserSnap.size===51)deny("resource-exhausted","Advisory assignments require pagination.");
   const advisers=adviserSnap.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&
    doc.data().status==="active"&&doc.data().sectionId&&doc.data().yearId);
   if(!advisers.length)return {schoolId:ctx.schoolId,sections:[]};

   const prefix="schools/"+ctx.schoolId+"/";
   const staffSnap=await db.collection(prefix+"staff_assignments").where("status","==","active").limit(2001).get();
   if(staffSnap.size===2001)deny("resource-exhausted","Advisory class staffing exceeds the current review limit.");
   const staff=staffSnap.docs.filter(doc=>doc.data().schoolId===ctx.schoolId);
   const teacherUids=[...new Set(staff.map(doc=>doc.data().teacherUid).filter(Boolean))];
   const teacherDocs=await Promise.all(teacherUids.map(id=>schoolRoot.doc("memberships/"+id).get()));
   const teacherNames=new Map(teacherDocs.map((doc,index)=>[
    teacherUids[index],doc.exists&&doc.data().schoolId===ctx.schoolId?
      String(doc.data().displayName||("Teacher "+teacherUids[index].slice(0,8))):"Teacher "+teacherUids[index].slice(0,8)
   ]));

   const results=[];
   for(const adviser of advisers){
    const data=adviser.data(),sectionId=checkId(data.sectionId,"Section ID"),
     yearId=checkId(data.yearId,"Academic year ID");
    const [section,year,registrationSnap,enrollmentSnap,offeringSnap]=await Promise.all([
     schoolRoot.doc("sections/"+sectionId).get(),
     schoolRoot.doc("academic_years/"+yearId).get(),
     db.collection(prefix+"student_registrations").where("sectionId","==",sectionId).limit(201).get(),
     db.collection(prefix+"enrollments").where("sectionId","==",sectionId).limit(501).get(),
     db.collection(prefix+"course_offerings").where("sectionId","==",sectionId).limit(201).get()
    ]);
    if(registrationSnap.size===201||enrollmentSnap.size===501||offeringSnap.size===201)
     deny("resource-exhausted","This advisory section exceeds the current overview limit.");
    if(!section.exists||section.data().schoolId!==ctx.schoolId||!year.exists||year.data().schoolId!==ctx.schoolId)
     continue;

    const registrations=registrationSnap.docs.filter(doc=>{
     const row=doc.data();
     return row.schoolId===ctx.schoolId&&row.status==="active"&&row.yearId===yearId;
    });
    const registrationByPerson=new Map(registrations.map(doc=>[doc.data().personId,doc.data()]));
    const fallbackPeople=new Set(enrollmentSnap.docs.filter(doc=>{
     const row=doc.data();
     return row.schoolId===ctx.schoolId&&row.status==="active"&&row.yearId===yearId;
    }).map(doc=>doc.data().personId).filter(Boolean));
    const personIds=registrationByPerson.size?[...registrationByPerson.keys()]:[...fallbackPeople];
    if(personIds.length>200)deny("resource-exhausted","This advisory roster requires pagination.");
    const people=await Promise.all(personIds.map(personId=>schoolRoot.doc("people/"+checkId(personId,"Person ID",128)).get()));
    const students=people.map((person,index)=>{
     const personId=personIds[index],row=registrationByPerson.get(personId)||{},personData=person.exists?person.data():null;
     return {
      personId,name:personData&&personData.schoolId===ctx.schoolId?
       String(personData.displayName||row.displayName||"Student"):String(row.displayName||"Student"),
      studentNumber:String(row.studentNumber||""),
      accountLinked:Boolean(personData&&personData.schoolId===ctx.schoolId&&personData.authUid),
      registrationSource:registrationByPerson.has(personId)?"registration":"class_enrollment"
     };
    }).sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:"base"}));

    const classDocs=offeringSnap.docs.filter(doc=>{
     const row=doc.data();
     return row.schoolId===ctx.schoolId&&row.status==="active"&&row.yearId===yearId;
    });
    const subjectIds=[...new Set(classDocs.map(doc=>doc.data().subjectId).filter(Boolean))],
     termIds=[...new Set(classDocs.map(doc=>doc.data().termId).filter(Boolean))];
    const [subjects,terms]=await Promise.all([
     Promise.all(subjectIds.map(id=>schoolRoot.doc("subjects/"+id).get())),
     Promise.all(termIds.map(id=>schoolRoot.doc("terms/"+id).get()))
    ]);
    const subjectNames=new Map(subjects.map((doc,index)=>[subjectIds[index],
      doc.exists&&doc.data().schoolId===ctx.schoolId?String(doc.data().name||subjectIds[index]):subjectIds[index]])),
     termNames=new Map(terms.map((doc,index)=>[termIds[index],
      doc.exists&&doc.data().schoolId===ctx.schoolId?String(doc.data().name||termIds[index]):termIds[index]]));
    const classes=classDocs.map(doc=>{
     const row=doc.data(),teachers=staff.filter(grant=>grant.data().offeringId===doc.id)
      .map(grant=>teacherNames.get(grant.data().teacherUid)||"Teacher");
     return {
      offeringId:doc.id,subjectId:row.subjectId,subjectName:subjectNames.get(row.subjectId)||row.subjectId||"Subject",
      termId:row.termId,termName:termNames.get(row.termId)||row.termId||"Period",
      teacherNames:[...new Set(teachers)]
     };
    }).sort((a,b)=>a.termName.localeCompare(b.termName)||a.subjectName.localeCompare(b.subjectName));

    results.push({
     advisoryId:adviser.id,sectionId,sectionName:String(section.data().name||sectionId),
     yearId,yearName:String(year.data().name||yearId),programId:section.data().programId||null,
     gradeLevel:section.data().gradeLevel||null,pathway:section.data().pathway||null,
     students,classes,revision:Number(data.revision)||1
    });
   }
   return {schoolId:ctx.schoolId,sections:results.sort((a,b)=>a.yearName.localeCompare(b.yearName)||a.sectionName.localeCompare(b.sectionName))};
  }

  if(input.action==="faculty_workload"){
   requireAdmin();
   const prefix="schools/"+ctx.schoolId+"/";
   // One bounded school-wide read. Only active course grants are used;
   // suspended accounts cannot make a course appear staffed.
   const [members,offerings,grants,adviserGrants]=await Promise.all([
    db.collection(prefix+"memberships").where("roles","array-contains","teacher").limit(501).get(),
    db.collection(prefix+"course_offerings").where("status","==","active").limit(1001).get(),
    db.collection(prefix+"staff_assignments").where("status","==","active").limit(2001).get(),
    db.collection(prefix+"section_advisers").where("status","==","active").limit(1001).get()
   ]);
   if(members.size===501||offerings.size===1001||grants.size===2001||adviserGrants.size===1001)
    deny("resource-exhausted","Faculty workload exceeds its current review limit. No partial staffing or advisory counts are displayed.");
   const teachers=members.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&doc.data().status==="active")
    .map(doc=>({uid:doc.id,name:typeof doc.data().displayName==="string"?doc.data().displayName:"Teacher "+doc.id.slice(0,8)}));
   const teacherIds=new Set(teachers.map(row=>row.uid));
   const classes=offerings.docs.filter(doc=>doc.data().schoolId===ctx.schoolId).map(doc=>{
    const row=doc.data();
    return {offeringId:doc.id,sectionId:row.sectionId||"",subjectId:row.subjectId||"",yearId:row.yearId||"",termId:row.termId||"",programId:row.programId||"",
      rosterMode:ROSTER_MODES.has(row.rosterMode)?row.rosterMode:"legacy",revision:Number(row.revision)||1,
      configuredPrimaryTeacherUid:typeof row.primaryTeacherUid==="string"?row.primaryTeacherUid:"",
      primaryTeacherUid:"",primarySource:"none",primaryNeedsReview:false,
      teacherUids:[],invalidGrantCount:0};
   });
   const byId=new Map(classes.map(row=>[row.offeringId,row]));
   let unmatchedGrants=0;
   for(const doc of grants.docs){
    const row=doc.data();if(row.schoolId!==ctx.schoolId)continue;
    const offering=byId.get(row.offeringId);
    if(!offering){unmatchedGrants++;continue;}
    if(!teacherIds.has(row.teacherUid)||["yearId","termId","sectionId","subjectId"].some(key=>row[key]&&row[key]!==offering[key])){
     offering.invalidGrantCount++;continue;
    }
    if(!offering.teacherUids.includes(row.teacherUid))offering.teacherUids.push(row.teacherUid);
   }
   for(const offering of classes){
    const lead=teachingLead(offering.configuredPrimaryTeacherUid,offering.teacherUids);
    offering.primaryTeacherUid=lead.primaryTeacherUid;
    offering.primarySource=lead.primarySource;
    offering.primaryNeedsReview=lead.primaryNeedsReview;
   }
   const catalogFields=[["sections","sectionId","sectionName"],["subjects","subjectId","subjectName"],["academic_years","yearId","yearName"],["terms","termId","termName"],["academic_programs","programId","programName"]];
   const refs=[];
   for(const [collection,field] of catalogFields){
    for(const id of new Set(classes.map(row=>row[field]).filter(id=>typeof id==="string"&&id&&!id.includes("/"))))
     refs.push({collection,id,ref:db.doc(prefix+collection+"/"+id)});
   }
   if(refs.length>1000)deny("resource-exhausted","Faculty workload catalog references exceed the current review limit.");
   const labels=new Map();
   for(let i=0;i<refs.length;i+=200){
    const batch=refs.slice(i,i+200),docs=await db.getAll(...batch.map(item=>item.ref));
    docs.forEach((doc,index)=>{
     if(doc.exists&&doc.data().schoolId===ctx.schoolId&&typeof doc.data().name==="string")
      labels.set(batch[index].collection+"/"+batch[index].id,doc.data().name);
    });
   }
   for(const row of classes)for(const [collection,field,label] of catalogFields)row[label]=labels.get(collection+"/"+row[field])||row[field]||"Unspecified";
   const advisories=adviserGrants.docs.filter(doc=>{
    const row=doc.data();
    return row.schoolId===ctx.schoolId&&teacherIds.has(row.teacherUid)&&row.sectionId&&row.yearId;
   }).map(doc=>({
    advisoryId:doc.id,teacherUid:doc.data().teacherUid,sectionId:doc.data().sectionId,
    yearId:doc.data().yearId,status:"active",revision:Number(doc.data().revision)||1
   }));
   return {schoolId:ctx.schoolId,teachers,offerings:classes,advisories,unmatchedGrants};
  }

  if(input.action==="set_primary_teacher"){
   requireAdmin();
   const offeringId=checkId(input.offeringId,"Course offering ID",330),
    teacherUid=checkId(input.teacherUid,"Primary teacher UID",128),
    expectedRevision=Number(input.expectedRevision),
    reason=checkName(input.reason,"Primary teacher reason");
   if(!Number.isInteger(expectedRevision)||expectedRevision<1)
    deny("invalid-argument","Current class revision is required.");
   if(reason.length<12)deny("invalid-argument","Explain the primary-teacher change in at least 12 characters.");
   const offeringRef=schoolRoot.doc("course_offerings/"+offeringId),
    assignmentRef=schoolRoot.doc("staff_assignments/"+rowKey(teacherUid,offeringId)),
    auditRef=db.collection("schools/"+ctx.schoolId+"/directory_audit").doc();
   let result;
   await db.runTransaction(async tx=>{
    await checkWriteAuthority(tx);
    const [offering,assignment]=await Promise.all([tx.get(offeringRef),tx.get(assignmentRef)]);
    if(!offering.exists||offering.data().schoolId!==ctx.schoolId||offering.data().status!=="active")
     deny("not-found","This active class offering is unavailable.");
    const data=offering.data(),revision=Number(data.revision)||1;
    if(revision!==expectedRevision)
     deny("failed-precondition","A newer class revision exists. Reload before changing the primary teacher.");
    if(!assignment.exists||assignment.data().schoolId!==ctx.schoolId||
       assignment.data().teacherUid!==teacherUid||assignment.data().offeringId!==offeringId||
       assignment.data().status!=="active")
     deny("failed-precondition","The primary teacher must already have an active teaching assignment in this class.");
    const prior=typeof data.primaryTeacherUid==="string"?data.primaryTeacherUid:"",now=FieldValue.serverTimestamp();
    if(prior===teacherUid){
     result={offeringId,teacherUid,revision,alreadyCurrent:true};return;
    }
    tx.update(offeringRef,{primaryTeacherUid:teacherUid,revision:revision+1,updatedByUid:uid,updatedAt:now});
    tx.create(auditRef,audit("class_primary_teacher_changed",{
     offeringId,fromTeacherUid:prior||null,toTeacherUid:teacherUid,reason,revision:revision+1
    }));
    result={offeringId,teacherUid,revision:revision+1,priorTeacherUid:prior||null,alreadyCurrent:false};
   });
   return result;
  }

  if(["set_section_adviser","end_section_adviser"].includes(input.action)){
   requireAdmin();
   const sectionId=checkId(input.sectionId,"Section ID"),
    yearId=checkId(input.yearId,"Academic year ID"),
    reason=checkName(input.reason,input.action==="set_section_adviser"?"Adviser assignment reason":"Adviser end reason");
   if(reason.length<12)deny("invalid-argument","Explain the advisory assignment change in at least 12 characters.");
   const sectionRef=schoolRoot.doc("sections/"+sectionId),
    yearRef=schoolRoot.doc("academic_years/"+yearId),
    query=db.collection("schools/"+ctx.schoolId+"/section_advisers").where("sectionId","==",sectionId).limit(101),
    auditRef=db.collection("schools/"+ctx.schoolId+"/directory_audit").doc();
   const setting=input.action==="set_section_adviser";
   const teacherUid=setting?checkId(input.teacherUid,"Adviser teacher UID",128):null;
   let result;
   await db.runTransaction(async tx=>{
    await checkWriteAuthority(tx);
    const reads=[tx.get(sectionRef),tx.get(yearRef),tx.get(query)];
    if(setting)reads.push(tx.get(schoolRoot.doc("memberships/"+teacherUid)));
    const records=await Promise.all(reads),section=records[0],year=records[1],assignments=records[2],teacherMember=setting?records[3]:null;
    if(!section.exists||section.data().schoolId!==ctx.schoolId||section.data().status!=="active")
     deny("failed-precondition","Choose an active section in this school.");
    if(!year.exists||year.data().schoolId!==ctx.schoolId||year.data().status!=="active")
     deny("failed-precondition","Choose an active academic year in this school.");
    if(assignments.size===101)
     deny("resource-exhausted","This section has too much adviser history for the current workflow.");
    if(setting&&(!teacherMember.exists||teacherMember.data().schoolId!==ctx.schoolId||
       teacherMember.data().status!=="active"||!Array.isArray(teacherMember.data().roles)||
       !teacherMember.data().roles.includes("teacher")))
     deny("permission-denied","The adviser must be an active teacher in this school.");
    const sameYear=assignments.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&doc.data().yearId===yearId);
    const active=sameYear.find(doc=>doc.data().status==="active")||null;
    const now=FieldValue.serverTimestamp();
    if(!setting){
     if(!active)deny("failed-precondition","This section has no active adviser for the selected school year.");
     tx.update(active.ref,{status:"ended",endedByUid:uid,endedAt:now,endReason:reason,
       revision:(Number(active.data().revision)||1)+1});
     tx.create(auditRef,audit("section_adviser_ended",{
      sectionId,yearId,teacherUid:active.data().teacherUid,reason
     }));
     result={sectionId,yearId,teacherUid:active.data().teacherUid,status:"ended"};
     return;
    }
    if(active?.data().teacherUid===teacherUid){
     result={sectionId,yearId,teacherUid,status:"active",alreadyCurrent:true};return;
    }
    const targetId=rowKey(yearId,sectionId,teacherUid),target=sameYear.find(doc=>doc.id===targetId)||null;
    if(active){
     tx.update(active.ref,{status:"ended",endedByUid:uid,endedAt:now,
       endReason:reason,revision:(Number(active.data().revision)||1)+1});
    }
    if(target){
     if(target.data().status!=="ended")
      deny("failed-precondition","The selected adviser history is in an unsupported state.");
     tx.update(target.ref,{status:"active",restoredByUid:uid,restoredAt:now,restoreReason:reason,
       revision:(Number(target.data().revision)||1)+1});
    }else{
     tx.create(db.doc("schools/"+ctx.schoolId+"/section_advisers/"+targetId),{
      schoolId:ctx.schoolId,sectionId,yearId,teacherUid,status:"active",revision:1,
      createdByUid:uid,createdAt:now
     });
    }
    tx.create(auditRef,audit(active?"section_adviser_changed":"section_adviser_assigned",{
     sectionId,yearId,fromTeacherUid:active?.data().teacherUid||null,toTeacherUid:teacherUid,reason
    }));
    result={sectionId,yearId,teacherUid,status:"active",replacedTeacherUid:active?.data().teacherUid||null};
   });
   return result;
  }

  if(input.action==="list_teachers"){
   requireAdmin();
   const snap=await db.collection("schools/"+ctx.schoolId+"/memberships")
     .where("roles","array-contains","teacher").limit(101).get();
   if(snap.size===101)deny("resource-exhausted","Teacher directory requires pagination.");
   return {teachers:snap.docs.filter(doc=>doc.data().status==="active"&&doc.data().schoolId===ctx.schoolId)
     .map(doc=>({uid:doc.id,name:typeof doc.data().displayName==="string"?
       doc.data().displayName:"Teacher "+doc.id.slice(0,8)}))};
  }
  if(input.action==="list_students"){
   requireAdmin();
   const snap=await db.collection("schools/"+ctx.schoolId+"/people")
     .where("kind","==","student").limit(101).get();
   if(snap.size===101)deny("resource-exhausted","Student picker requires paginated school directory search.");
   return {students:snap.docs.filter(doc=>doc.data().status==="active"&&doc.data().schoolId===ctx.schoolId)
     .map(doc=>({personId:doc.id,name:doc.data().displayName}))};
  }
  if(input.action==="search_students"){
   requireAdmin();
   const query=String(input.query||"").trim().toLocaleLowerCase("en");
   if(query.length<2)deny("invalid-argument","Enter at least 2 characters to search students.");
   if(query.length>120)deny("invalid-argument","Student search is too long.");
   const people=db.collection("schools/"+ctx.schoolId+"/people");
   const [nameSnap,numberSnap]=await Promise.all([
    people.orderBy("searchKey").startAt(query).endAt(query+"\uf8ff").limit(31).get(),
    people.where("studentNumber","==",String(input.query||"").trim()).limit(4).get()
   ]);
   const unique=new Map();
   for(const doc of [...numberSnap.docs,...nameSnap.docs]){
    const row=doc.data();
    if(row.schoolId!==ctx.schoolId||row.kind!=="student"||row.status!=="active")continue;
    unique.set(doc.id,{
     personId:doc.id,name:String(row.displayName||"Student").slice(0,140),
     studentNumber:String(row.studentNumber||"").slice(0,80),
     accountLinked:Boolean(row.authUid)
    });
    if(unique.size>=20)break;
   }
   return {students:[...unique.values()].sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:"base"}))};
  }
  if(input.action==="create_catalog"){
   requireAdmin();
   const kind=input.kind;
   if(!CATALOG.has(kind))deny("invalid-argument","Unknown academic catalog type.");
   const itemId=checkId(input.recordId),name=checkName(input.name),ref=schoolRoot.doc(kind+"/"+itemId);
   const auditRef=db.collection("schools/"+ctx.schoolId+"/directory_audit").doc();
   const parentYear=input.yearId?checkId(input.yearId,"Academic year ID"):null,
    parentProgram=input.programId?checkId(input.programId,"Academic program ID"):null,
    gradeLevel=kind==="sections"?sectionLevel(input.gradeLevel):null,
    pathway=kind==="sections"?optionalShortText(input.pathway,"Track / Strand / Pathway",80):null,
    periodType=kind==="terms"?String(input.periodType||"term").trim().toLowerCase():null,
    sequence=kind==="terms"?Number(input.sequence):null,
    startMonth=kind==="academic_years"?
      academicMonth(input.startMonth,DEFAULT_ACADEMIC_YEAR_START_MONTH,"Academic-year start month"):null,
    endMonth=kind==="academic_years"?
      academicMonth(input.endMonth,DEFAULT_ACADEMIC_YEAR_END_MONTH,"Academic-year end month"):null,
    startDate=["academic_years","terms"].includes(kind)?
      optionalAcademicDate(input.startDate,kind==="academic_years"?"Academic-year start date":"Academic period start date"):null,
    endDate=["academic_years","terms"].includes(kind)?
      optionalAcademicDate(input.endDate,kind==="academic_years"?"Academic-year end date":"Academic period end date"):null;
   if(kind==="terms"&&!PERIOD_TYPES.has(periodType))
    deny("invalid-argument","Academic period type must be term, semester, quarter, trimester or custom.");
   if(kind==="terms"&&(!Number.isInteger(sequence)||sequence<1||sequence>12))
    deny("invalid-argument","Academic period sequence must be between 1 and 12.");
   if(startDate&&endDate&&startDate>endDate)
    deny("invalid-argument",(kind==="academic_years"?"Academic year":"Academic period")+" end date must be after its start date.");
   await db.runTransaction(async tx=>{
    await checkWriteAuthority(tx);
    if((await tx.get(ref)).exists)deny("already-exists","An academic catalog record with this ID exists.");
    if(kind==="terms"||kind==="sections"){
     if(!parentProgram)deny("invalid-argument",(kind==="terms"?"Academic period":"Section")+" requires an academic program/division.");
     const program=await tx.get(schoolRoot.doc("academic_programs/"+parentProgram));
     if(!program.exists||program.data().schoolId!==ctx.schoolId||program.data().status!=="active")
      deny("failed-precondition","Academic program/division does not exist or is inactive.");
     if(kind==="sections"&&pathway&&!isSeniorHighName(program.data().name))
      deny("invalid-argument","Track / Strand / Pathway is only available for Senior High School sections.");
    }
    if(kind==="terms"){
     if(!parentYear)deny("invalid-argument","Academic period requires academic year ID.");
     const year=await tx.get(schoolRoot.doc("academic_years/"+parentYear));
     if(!year.exists||year.data().schoolId!==ctx.schoolId||year.data().status!=="active")
      deny("failed-precondition","Academic year does not exist or is inactive in this school.");
    }
    const now=FieldValue.serverTimestamp();
    tx.create(ref,{schoolId:ctx.schoolId,name,status:"active",
      yearId:kind==="terms"?parentYear:null,
      programId:["terms","sections"].includes(kind)?parentProgram:null,
      gradeLevel:kind==="sections"?gradeLevel:null,
      pathway:kind==="sections"?pathway:null,
      periodType:kind==="terms"?periodType:null,sequence:kind==="terms"?sequence:null,
      startMonth:kind==="academic_years"?startMonth:null,
      endMonth:kind==="academic_years"?endMonth:null,
      startDate:["academic_years","terms"].includes(kind)?startDate:null,
      endDate:["academic_years","terms"].includes(kind)?endDate:null,
      revision:1,createdByUid:uid,createdAt:now,updatedAt:now});
    tx.create(auditRef,audit("academic_catalog_created",{kind,recordId:itemId}));
   });
   return {recordId:itemId,kind,status:"active"};
  }
  if(input.action==="update_catalog"){
   requireAdmin();
   const kind=input.kind;
   if(!CATALOG.has(kind))deny("invalid-argument","Unknown academic catalog type.");
   const itemId=checkId(input.recordId),ref=schoolRoot.doc(kind+"/"+itemId);
   const expectedRevision=Number(input.expectedRevision);
   if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)
     deny("invalid-argument","Refresh this academic record before saving changes.");
   const name=checkName(input.name),parentYear=input.yearId?checkId(input.yearId,"Academic year ID"):null,
    parentProgram=input.programId?checkId(input.programId,"Academic program ID"):null,
    gradeLevel=kind==="sections"?sectionLevel(input.gradeLevel):null,
    pathway=kind==="sections"?optionalShortText(input.pathway,"Track / Strand / Pathway",80):null,
    periodType=kind==="terms"?String(input.periodType||"term").trim().toLowerCase():null,
    sequence=kind==="terms"?Number(input.sequence):null,
    startMonth=kind==="academic_years"?
      academicMonth(input.startMonth,DEFAULT_ACADEMIC_YEAR_START_MONTH,"Academic-year start month"):null,
    endMonth=kind==="academic_years"?
      academicMonth(input.endMonth,DEFAULT_ACADEMIC_YEAR_END_MONTH,"Academic-year end month"):null,
    startDate=["academic_years","terms"].includes(kind)?
      optionalAcademicDate(input.startDate,kind==="academic_years"?"Academic-year start date":"Academic period start date"):null,
    endDate=["academic_years","terms"].includes(kind)?
      optionalAcademicDate(input.endDate,kind==="academic_years"?"Academic-year end date":"Academic period end date"):null;
   if(kind==="terms"&&!PERIOD_TYPES.has(periodType))
    deny("invalid-argument","Academic period type must be term, semester, quarter, trimester or custom.");
   if(kind==="terms"&&(!Number.isInteger(sequence)||sequence<1||sequence>12))
    deny("invalid-argument","Academic period sequence must be between 1 and 12.");
   if(startDate&&endDate&&startDate>endDate)
    deny("invalid-argument",(kind==="academic_years"?"Academic year":"Academic period")+" end date must be after its start date.");
   const auditRef=db.collection("schools/"+ctx.schoolId+"/directory_audit").doc();
   await db.runTransaction(async tx=>{
    await checkWriteAuthority(tx);
    const current=await tx.get(ref);
    if(!current.exists||current.data().schoolId!==ctx.schoolId)
      deny("not-found","Academic record was not found in this school.");
    const currentRevision=Number(current.data().revision)||1;
    if(currentRevision!==expectedRevision)
      deny("failed-precondition","This academic record changed after you opened it. Refresh Academic Structure, review the latest values, then save again.");
    if(kind==="terms"||kind==="sections"){
      if(!parentProgram)deny("invalid-argument",(kind==="terms"?"Academic period":"Section")+" requires an academic program/division.");
      const program=await tx.get(schoolRoot.doc("academic_programs/"+parentProgram));
      if(!program.exists||program.data().schoolId!==ctx.schoolId||program.data().status!=="active")
        deny("failed-precondition","Academic program/division does not exist or is inactive.");
      if(kind==="sections"&&pathway&&!isSeniorHighName(program.data().name))
        deny("invalid-argument","Track / Strand / Pathway is only available for Senior High School sections.");
    }
    if(kind==="terms"){
      if(!parentYear)deny("invalid-argument","Academic period requires academic year ID.");
      const year=await tx.get(schoolRoot.doc("academic_years/"+parentYear));
      if(!year.exists||year.data().schoolId!==ctx.schoolId||year.data().status!=="active")
        deny("failed-precondition","Academic year does not exist or is inactive in this school.");
    }
    const now=FieldValue.serverTimestamp();
    tx.update(ref,{
      name,
      yearId:kind==="terms"?parentYear:null,
      programId:["terms","sections"].includes(kind)?parentProgram:null,
      gradeLevel:kind==="sections"?gradeLevel:null,
      pathway:kind==="sections"?pathway:null,
      periodType:kind==="terms"?periodType:null,sequence:kind==="terms"?sequence:null,
      startMonth:kind==="academic_years"?startMonth:null,
      endMonth:kind==="academic_years"?endMonth:null,
      startDate:["academic_years","terms"].includes(kind)?startDate:null,
      endDate:["academic_years","terms"].includes(kind)?endDate:null,
      revision:currentRevision+1,updatedByUid:uid,updatedAt:now
    });
    tx.create(auditRef,audit("academic_catalog_updated",{kind,recordId:itemId}));
   });
   return {recordId:itemId,kind,status:"active",revision:expectedRevision+1};
  }
  if(input.action==="list_catalog"){
   requireAdmin();
   const kind=input.kind;
   if(!CATALOG.has(kind))deny("invalid-argument","Unknown academic catalog type.");
   const snap=await db.collection("schools/"+ctx.schoolId+"/"+kind).orderBy("name").limit(200).get();
   return {items:snap.docs.map(doc=>({id:doc.id,name:doc.data().name,
    yearId:doc.data().yearId,programId:doc.data().programId,
    gradeLevel:kind==="sections"?(doc.data().gradeLevel||null):null,
    pathway:kind==="sections"?(doc.data().pathway||null):null,
    periodType:doc.data().periodType,sequence:doc.data().sequence,
    startMonth:kind==="academic_years"?
      academicMonth(doc.data().startMonth,DEFAULT_ACADEMIC_YEAR_START_MONTH,"Academic-year start month"):null,
    endMonth:kind==="academic_years"?
      academicMonth(doc.data().endMonth,DEFAULT_ACADEMIC_YEAR_END_MONTH,"Academic-year end month"):null,
    startDate:["academic_years","terms"].includes(kind)?(doc.data().startDate||null):null,
    endDate:["academic_years","terms"].includes(kind)?(doc.data().endDate||null):null,
    status:doc.data().status,revision:Number(doc.data().revision)||1})),truncated:snap.size===200};
  }
  if(input.action==="create_offering"){
   requireAdmin();
   const programId=checkId(input.programId,"Academic program/division"),
    yearId=checkId(input.yearId,"Academic year"),termId=checkId(input.termId,"Academic period"),
    subjectId=checkId(input.subjectId,"Subject"),sectionId=checkId(input.sectionId,"Section"),
    rosterMode=String(input.rosterMode||"section").trim().toLowerCase();
   if(!ROSTER_MODES.has(rosterMode))deny("invalid-argument","Choose Official section placement or Selective/manual roster.");
   const offeringId=rowKey(programId,yearId,termId,sectionId,subjectId);
   const ref=schoolRoot.doc("course_offerings/"+offeringId);
   const refs=[
    schoolRoot.doc("academic_programs/"+programId),
    schoolRoot.doc("academic_years/"+yearId),
    schoolRoot.doc("terms/"+termId),
    schoolRoot.doc("subjects/"+subjectId),
    schoolRoot.doc("sections/"+sectionId)
   ];
   const auditRef=db.collection("schools/"+ctx.schoolId+"/directory_audit").doc();
   let result;
   await db.runTransaction(async tx=>{
    await checkWriteAuthority(tx);
    const registrationQuery=db.collection("schools/"+ctx.schoolId+"/student_registrations")
      .where("sectionId","==",sectionId).limit(201);
    const [catalog,existingOffering,registrationSnap]=await Promise.all([
      Promise.all(refs.map(ref=>tx.get(ref))),tx.get(ref),
      rosterMode==="section"?tx.get(registrationQuery):Promise.resolve({docs:[],size:0})
    ]);
    if(catalog.some(doc=>!doc.exists||doc.data().schoolId!==ctx.schoolId||doc.data().status!=="active"))
      deny("failed-precondition","Offering references must be active catalog records at this school.");
    if(catalog[2].data().yearId!==yearId||catalog[2].data().programId!==programId)
      deny("failed-precondition","The selected academic period belongs to another year or program.");
    if(catalog[4].data().programId!==programId)
      deny("failed-precondition","The selected section belongs to another academic program/division.");
    if(existingOffering.exists)deny("already-exists","This school course offering already exists.");
    if(registrationSnap.size===201)
      deny("resource-exhausted","This section has more than 200 active/historical registrations. Create the class only after roster pagination support is available.");

    const registrations=registrationSnap.docs.filter(doc=>{
      const row=doc.data();
      return row.schoolId===ctx.schoolId&&row.status==="active"&&row.sectionId===sectionId&&
        row.yearId===yearId&&row.programId===programId&&row.termId===termId&&row.personId;
    });
    const enrollmentRefs=registrations.map(registration=>
      schoolRoot.doc("enrollments/"+rowKey(registration.data().personId,offeringId)));
    const existingEnrollments=await Promise.all(enrollmentRefs.map(enrollmentRef=>tx.get(enrollmentRef)));
    const ended=existingEnrollments.find(record=>record.exists&&record.data().status!=="active");
    if(ended)
      deny("failed-precondition","A student in this official section has historical enrollment for the new class key. Review that enrollment history before creating the class.");

    const now=FieldValue.serverTimestamp();let autoEnrolled=0,alreadyActive=0;
    tx.create(ref,{schoolId:ctx.schoolId,programId,yearId,termId,subjectId,sectionId,
      rosterMode,status:"active",revision:1,createdByUid:uid,createdAt:now});
    registrations.forEach((registration,index)=>{
      const personId=registration.data().personId,prior=existingEnrollments[index];
      if(prior.exists){
        if(prior.data().schoolId!==ctx.schoolId||prior.data().personId!==personId||
           prior.data().offeringId!==offeringId)
          deny("failed-precondition","A student enrollment key collision requires review.");
        alreadyActive++;return;
      }
      autoEnrolled++;
      tx.create(enrollmentRefs[index],{
        schoolId:ctx.schoolId,personId,offeringId,programId,yearId,termId,sectionId,subjectId,
        status:"active",revision:1,enrollmentSource:"official_section_placement",
        registrationId:registration.id,createdByUid:uid,createdAt:now
      });
      const registrationData=registration.data();
      tx.update(registration.ref,{
        courseCount:(Number(registrationData.courseCount)||0)+1,
        updatedByUid:uid,updatedAt:now,revision:(Number(registrationData.revision)||1)+1
      });
    });
    tx.create(auditRef,audit("course_offering_created",{
      offeringId,sectionId,yearId,termId,subjectId,rosterMode,
      officialRegistrationCount:registrations.length,autoEnrolled,alreadyActive
    }));
    result={offeringId,status:"active",rosterMode,officialRegistrationCount:registrations.length,autoEnrolled,alreadyActive};
   });
   return result;
  }
  if(input.action==="list_offerings"){
   if(!admin&&!teacher)deny("permission-denied","Teaching access is required.");
   let allowed=null;
   if(!admin) {
    const grants=await db.collection("schools/"+ctx.schoolId+"/staff_assignments")
      .where("teacherUid","==",uid).limit(101).get();
    allowed=new Set(grants.docs.filter(d=>d.data().status==="active").map(d=>d.data().offeringId));
    if(grants.size===101)deny("resource-exhausted","Too many teaching assignments. Contact the school administrator.");
   }
   const snap=await db.collection("schools/"+ctx.schoolId+"/course_offerings").limit(201).get();
   if(snap.size===201)deny("resource-exhausted","Offering list is too large. Refine the academic year before continuing.");
   return {offerings:snap.docs.filter(doc=>admin||allowed.has(doc.id))
    .map(doc=>({offeringId:doc.id,programId:doc.data().programId,
      yearId:doc.data().yearId,termId:doc.data().termId,
      subjectId:doc.data().subjectId,sectionId:doc.data().sectionId,status:doc.data().status,
      rosterMode:ROSTER_MODES.has(doc.data().rosterMode)?doc.data().rosterMode:"legacy",
      revision:Number(doc.data().revision)||1}))};
  }
  if(input.action==="set_offering_roster_mode"){
   requireAdmin();
   const offeringId=checkId(input.offeringId,"Course offering ID",330),
    requestedMode=String(input.rosterMode||"").trim().toLowerCase(),
    expectedRevision=Number(input.expectedRevision),
    reason=checkName(input.reason,"Roster source change reason");
   if(!ROSTER_MODES.has(requestedMode))deny("invalid-argument","Choose Official section placement or Selective/manual roster.");
   if(!Number.isInteger(expectedRevision)||expectedRevision<1)deny("invalid-argument","Current class revision is required.");
   if(reason.length<12)deny("invalid-argument","Explain the roster-source change in at least 12 characters.");
   const offeringRef=schoolRoot.doc("course_offerings/"+offeringId),
    auditRef=db.collection("schools/"+ctx.schoolId+"/directory_audit").doc();
   let result;
   await db.runTransaction(async tx=>{
    await checkWriteAuthority(tx);
    const offering=await tx.get(offeringRef);
    if(!offering.exists||offering.data().schoolId!==ctx.schoolId||offering.data().status!=="active")
     deny("not-found","This active class offering is unavailable.");
    const data=offering.data(),revision=Number(data.revision)||1;
    if(revision!==expectedRevision)deny("failed-precondition","A newer class revision exists. Reload before changing its roster source.");
    let registrations=[],enrollmentRefs=[],existing=[];
    if(requestedMode==="section"){
     const registrationQuery=db.collection("schools/"+ctx.schoolId+"/student_registrations")
      .where("sectionId","==",data.sectionId).limit(201);
     const registrationSnap=await tx.get(registrationQuery);
     if(registrationSnap.size===201)
      deny("resource-exhausted","This section has more than 200 active/historical registrations. Roster synchronization requires pagination.");
     registrations=registrationSnap.docs.filter(doc=>{
      const row=doc.data();return row.schoolId===ctx.schoolId&&row.status==="active"&&
       row.sectionId===data.sectionId&&row.yearId===data.yearId&&row.programId===data.programId&&
       row.termId===data.termId&&row.personId;
     });
     enrollmentRefs=registrations.map(registration=>
      schoolRoot.doc("enrollments/"+rowKey(registration.data().personId,offeringId)));
     existing=await Promise.all(enrollmentRefs.map(ref=>tx.get(ref)));
     const ended=existing.find(record=>record.exists&&record.data().status!=="active");
     if(ended)
      deny("failed-precondition","At least one officially placed student has ended enrollment history for this class. Review that history before adopting the official section roster.");
    }
    const now=FieldValue.serverTimestamp();let added=0,alreadyActive=0;
    registrations.forEach((registration,index)=>{
     const personId=registration.data().personId,prior=existing[index];
     if(prior.exists){
      if(prior.data().schoolId!==ctx.schoolId||prior.data().personId!==personId||
         prior.data().offeringId!==offeringId)
       deny("failed-precondition","A student enrollment key collision requires review.");
      alreadyActive++;return;
     }
     added++;
     tx.create(enrollmentRefs[index],{
      schoolId:ctx.schoolId,personId,offeringId,
      programId:data.programId,yearId:data.yearId,termId:data.termId,sectionId:data.sectionId,subjectId:data.subjectId,
      status:"active",revision:1,enrollmentSource:"official_section_placement",
      registrationId:registration.id,createdByUid:uid,createdAt:now
     });
     const registrationData=registration.data();
     tx.update(registration.ref,{
      courseCount:(Number(registrationData.courseCount)||0)+1,
      updatedByUid:uid,updatedAt:now,revision:(Number(registrationData.revision)||1)+1
     });
    });
    const currentMode=ROSTER_MODES.has(data.rosterMode)?data.rosterMode:"legacy",
     changed=currentMode!==requestedMode||added>0,
     nextRevision=changed?revision+1:revision;
    if(changed)tx.update(offeringRef,{rosterMode:requestedMode,revision:nextRevision,updatedByUid:uid,updatedAt:now});
    tx.create(auditRef,audit(currentMode===requestedMode?"class_roster_synchronized":"class_roster_mode_changed",{
     offeringId,fromRosterMode:currentMode,toRosterMode:requestedMode,reason,
     officialRegistrationCount:registrations.length,added,alreadyActive,revision:nextRevision
    }));
    result={offeringId,rosterMode:requestedMode,revision:nextRevision,
     officialRegistrationCount:registrations.length,added,alreadyActive,changed};
   });
   return result;
  }

  if(input.action==="bulk_enroll_students"){
   requireAdmin();
   const offeringId=checkId(input.offeringId,"Course offering ID",330);
   const personIds=Array.isArray(input.personIds)?[...new Set(input.personIds.map(value=>checkId(value,"Person ID",128)))]:[];
   if(!personIds.length||personIds.length>80)
    deny("invalid-argument","Select between 1 and 80 students for a bulk enrollment.");
   const reason=checkName(input.reason,"Bulk enrollment reason");
   if(reason.length<12)deny("invalid-argument","Explain the bulk enrollment in at least 12 characters.");
   const offeringRef=schoolRoot.doc("course_offerings/"+offeringId);
   const personRefs=personIds.map(personId=>schoolRoot.doc("people/"+personId));
   const enrollmentRefs=personIds.map(personId=>schoolRoot.doc("enrollments/"+rowKey(personId,offeringId)));
   const auditRefs=personIds.map(()=>db.collection("schools/"+ctx.schoolId+"/directory_audit").doc());
   let result;
   await db.runTransaction(async tx=>{
    await checkWriteAuthority(tx);
    const [offering,...records]=await Promise.all([
      tx.get(offeringRef),
      ...personRefs.map(ref=>tx.get(ref)),
      ...enrollmentRefs.map(ref=>tx.get(ref))
    ]);
    if(!offering.exists||offering.data().schoolId!==ctx.schoolId||offering.data().status!=="active")
      deny("failed-precondition","Select an active school course offering.");
    if(offering.data().rosterMode==="section")
      deny("failed-precondition","This class follows official section placement. Bulk class enrollment cannot override the official roster; change student registration instead.");
    const people=records.slice(0,personIds.length),existing=records.slice(personIds.length);
    if(people.some(person=>!person.exists||person.data().schoolId!==ctx.schoolId||
       person.data().kind!=="student"||person.data().status!=="active"))
      deny("failed-precondition","Every selected person must be an active student in this school.");
    const now=FieldValue.serverTimestamp();let created=0,alreadyActive=0,historyExists=0;
    personIds.forEach((personId,index)=>{
      const prior=existing[index];
      if(prior.exists){
        if(prior.data().schoolId!==ctx.schoolId||prior.data().personId!==personId||
           prior.data().offeringId!==offeringId)
          deny("failed-precondition","An enrollment key collision requires manual review.");
        if(prior.data().status==="active")alreadyActive++;
        else historyExists++;
        return;
      }
      created++;
      tx.create(enrollmentRefs[index],{schoolId:ctx.schoolId,personId,offeringId,
        programId:offering.data().programId,yearId:offering.data().yearId,termId:offering.data().termId,
        sectionId:offering.data().sectionId,subjectId:offering.data().subjectId,
        status:"active",revision:1,createdByUid:uid,createdAt:now});
      tx.create(auditRefs[index],audit("student_bulk_enrolled",{personId,offeringId,reason}));
    });
    result={offeringId,selected:personIds.length,created,alreadyActive,historyExists};
   });
   return result;
  }
  if(input.action==="assign_teacher_section"){
   requireAdmin();
   const teacherUid=checkId(input.teacherUid,"Teacher account UID",128),
    sectionId=checkId(input.sectionId,"Section ID");
   const offeringIds=Array.isArray(input.offeringIds)?[...new Set(input.offeringIds.map(value=>
     checkId(value,"Course offering ID",330)))]:[];
   if(!offeringIds.length||offeringIds.length>30)
    deny("invalid-argument","Select between 1 and 30 classes in the section.");
   const reason=checkName(input.reason,"Section teaching assignment reason");
   if(reason.length<12)deny("invalid-argument","Explain the section teaching assignment in at least 12 characters.");
   const sectionRef=schoolRoot.doc("sections/"+sectionId),
    memberRef=schoolRoot.doc("memberships/"+teacherUid),
    offeringRefs=offeringIds.map(offeringId=>schoolRoot.doc("course_offerings/"+offeringId)),
    assignmentRefs=offeringIds.map(offeringId=>schoolRoot.doc("staff_assignments/"+rowKey(teacherUid,offeringId))),
    auditRefs=offeringIds.map(()=>db.collection("schools/"+ctx.schoolId+"/directory_audit").doc());
   let result;
   await db.runTransaction(async tx=>{
    await checkWriteAuthority(tx);
    const records=await Promise.all([
     tx.get(sectionRef),tx.get(memberRef),
     ...offeringRefs.map(ref=>tx.get(ref)),
     ...assignmentRefs.map(ref=>tx.get(ref))
    ]);
    const section=records[0],member=records[1],
     offerings=records.slice(2,2+offeringIds.length),
     existing=records.slice(2+offeringIds.length);
    if(!section.exists||section.data().schoolId!==ctx.schoolId||section.data().status!=="active")
     deny("failed-precondition","Select an active section in this school.");
    if(!member.exists||member.data().schoolId!==ctx.schoolId||member.data().status!=="active"||
       !Array.isArray(member.data().roles)||!member.data().roles.includes("teacher"))
     deny("permission-denied","The selected account must be an active teacher in this school.");
    if(offerings.some(offering=>!offering.exists||offering.data().schoolId!==ctx.schoolId||
       offering.data().status!=="active"||offering.data().sectionId!==sectionId))
     deny("failed-precondition","Every selected class must be an active course offering in the selected section.");
    const candidateIds=offeringIds.filter((offeringId,index)=>!existing[index].exists);
    for(const offeringId of candidateIds)await ensureTeacherScheduleAvailable(tx,teacherUid,offeringId);
    const candidateSchedules=await Promise.all(candidateIds.map(offeringId=>tx.get(schoolRoot.doc("class_schedules/"+offeringId))));
    for(let i=0;i<candidateSchedules.length;i++)for(let j=i+1;j<candidateSchedules.length;j++){
     const first=candidateSchedules[i],second=candidateSchedules[j];
     if(!first.exists||!second.exists||first.data().schoolId!==ctx.schoolId||second.data().schoolId!==ctx.schoolId)continue;
     for(const a of first.data().meetings||[])for(const b of second.data().meetings||[])
      if(scheduleMeetingOverlap(a,b))
       deny("failed-precondition","The selected classes overlap in the official timetable. Assign them separately or correct the class schedules first.");
    }
    const now=FieldValue.serverTimestamp();let created=0,alreadyActive=0,historyExists=0;
    offeringIds.forEach((offeringId,index)=>{
     const prior=existing[index],offering=offerings[index];
     if(prior.exists){
      if(prior.data().schoolId!==ctx.schoolId||prior.data().teacherUid!==teacherUid||
         prior.data().offeringId!==offeringId)
       deny("failed-precondition","A teaching-assignment key collision requires manual review.");
      if(prior.data().status==="active")alreadyActive++;
      else historyExists++;
      return;
     }
     created++;
     tx.create(assignmentRefs[index],{schoolId:ctx.schoolId,teacherUid,offeringId,
      yearId:offering.data().yearId,termId:offering.data().termId,
      subjectId:offering.data().subjectId,sectionId:offering.data().sectionId,
      status:"active",revision:1,createdByUid:uid,createdAt:now});
     tx.create(auditRefs[index],audit("teacher_section_class_assigned",{
      teacherUid,sectionId,offeringId,reason
     }));
    });
    result={teacherUid,sectionId,selected:offeringIds.length,created,alreadyActive,historyExists};
   });
   return result;
  }

  if(input.action==="bulk_assign_teachers"){
   requireAdmin();
   const offeringId=checkId(input.offeringId,"Course offering ID",330);
   const teacherUids=Array.isArray(input.teacherUids)?[...new Set(input.teacherUids.map(value=>
     checkId(value,"Teacher account UID",128)))]:[];
   if(!teacherUids.length||teacherUids.length>30)
    deny("invalid-argument","Select between 1 and 30 teachers for a bulk class assignment.");
   const reason=checkName(input.reason,"Bulk teacher assignment reason");
   if(reason.length<12)deny("invalid-argument","Explain the bulk teacher assignment in at least 12 characters.");
   const offeringRef=schoolRoot.doc("course_offerings/"+offeringId);
   const memberRefs=teacherUids.map(teacherUid=>schoolRoot.doc("memberships/"+teacherUid));
   const assignmentRefs=teacherUids.map(teacherUid=>schoolRoot.doc("staff_assignments/"+rowKey(teacherUid,offeringId)));
   const auditRefs=teacherUids.map(()=>db.collection("schools/"+ctx.schoolId+"/directory_audit").doc());
   let result;
   await db.runTransaction(async tx=>{
    await checkWriteAuthority(tx);
    const [offering,...records]=await Promise.all([
      tx.get(offeringRef),
      ...memberRefs.map(ref=>tx.get(ref)),
      ...assignmentRefs.map(ref=>tx.get(ref))
    ]);
    if(!offering.exists||offering.data().schoolId!==ctx.schoolId||offering.data().status!=="active")
      deny("failed-precondition","Select an active school course offering.");
    const members=records.slice(0,teacherUids.length),existing=records.slice(teacherUids.length);
    if(members.some(member=>!member.exists||member.data().schoolId!==ctx.schoolId||
       member.data().status!=="active"||!Array.isArray(member.data().roles)||
       !member.data().roles.includes("teacher")))
      deny("permission-denied","Every selected account must be an active teacher in this school.");
    for(let index=0;index<teacherUids.length;index++)
      if(!existing[index].exists)await ensureTeacherScheduleAvailable(tx,teacherUids[index],offeringId);
    const now=FieldValue.serverTimestamp();let created=0,alreadyActive=0,historyExists=0;
    teacherUids.forEach((teacherUid,index)=>{
      const prior=existing[index];
      if(prior.exists){
        if(prior.data().schoolId!==ctx.schoolId||prior.data().teacherUid!==teacherUid||
           prior.data().offeringId!==offeringId)
          deny("failed-precondition","A teaching-assignment key collision requires manual review.");
        if(prior.data().status==="active")alreadyActive++;
        else historyExists++;
        return;
      }
      created++;
      tx.create(assignmentRefs[index],{schoolId:ctx.schoolId,teacherUid,offeringId,
        yearId:offering.data().yearId,termId:offering.data().termId,
        subjectId:offering.data().subjectId,sectionId:offering.data().sectionId,
        status:"active",revision:1,createdByUid:uid,createdAt:now});
      tx.create(auditRefs[index],audit("teacher_bulk_assigned",{teacherUid,offeringId,reason}));
    });
    result={offeringId,selected:teacherUids.length,created,alreadyActive,historyExists};
   });
   return result;
  }
  if(input.action==="enroll_student"){
   requireAdmin();
   const personId=checkId(input.personId,"Person ID"),
     offeringId=checkId(input.offeringId,"Course offering ID",330);
   const ref=schoolRoot.doc("enrollments/"+rowKey(personId,offeringId));
   const personRef=schoolRoot.doc("people/"+personId);
   const offeringRef=schoolRoot.doc("course_offerings/"+offeringId);
   const auditRef=db.collection("schools/"+ctx.schoolId+"/directory_audit").doc();
   await db.runTransaction(async tx=>{
    await checkWriteAuthority(tx);
    const [person,offering,prior]=await Promise.all([
      tx.get(personRef),tx.get(offeringRef),tx.get(ref)
    ]);
    if(!person.exists||person.data().schoolId!==ctx.schoolId||person.data().kind!=="student"||
       person.data().status!=="active")
      deny("failed-precondition","Select an active student person in this school.");
    if(!offering.exists||offering.data().schoolId!==ctx.schoolId||offering.data().status!=="active")
      deny("failed-precondition","Select an active school course offering.");
    if(offering.data().rosterMode==="section")
      deny("failed-precondition","This class follows official section placement. Change the student's official registration instead of manually adding them to the class.");
    if(prior.exists)deny("already-exists","The student already has enrollment history for this class. Restore an ended enrollment instead of recreating it.");
    tx.create(ref,{schoolId:ctx.schoolId,personId,offeringId,
      programId:offering.data().programId,yearId:offering.data().yearId,termId:offering.data().termId,
      sectionId:offering.data().sectionId,subjectId:offering.data().subjectId,
      status:"active",revision:1,createdByUid:uid,createdAt:FieldValue.serverTimestamp()});
    tx.create(auditRef,audit("student_enrolled",{personId,offeringId}));
   });
   return {personId,offeringId,status:"active"};
  }

  if(input.action==="handover_offering"){
   requireAdmin();
   const offeringId=checkId(input.offeringId,"Course offering ID",330),
    fromTeacherUid=checkId(input.fromTeacherUid,"Current teacher UID",128),
    toTeacherUid=checkId(input.toTeacherUid,"Replacement teacher UID",128),
    reason=checkName(input.reason,"Teacher handover reason");
   if(fromTeacherUid===toTeacherUid)
    deny("invalid-argument","Choose a different replacement teacher.");
   if(reason.length<12)
    deny("invalid-argument","Explain the teacher handover in at least 12 characters.");
   const offeringRef=schoolRoot.doc("course_offerings/"+offeringId),
    fromRef=schoolRoot.doc("staff_assignments/"+rowKey(fromTeacherUid,offeringId)),
    toRef=schoolRoot.doc("staff_assignments/"+rowKey(toTeacherUid,offeringId)),
    toMemberRef=schoolRoot.doc("memberships/"+toTeacherUid),
    directoryAudit=db.collection("schools/"+ctx.schoolId+"/directory_audit").doc(),
    assessmentAudit=db.collection("schools/"+ctx.schoolId+"/assessment_audit").doc();
   let result;
   await db.runTransaction(async tx=>{
    await checkWriteAuthority(tx);
    const taskQuery=db.collection("schools/"+ctx.schoolId+"/assessments")
      .where("offeringId","==",offeringId).limit(101);
    const [offering,fromAssignment,toAssignment,toMember,tasks]=await Promise.all([
      tx.get(offeringRef),tx.get(fromRef),tx.get(toRef),tx.get(toMemberRef),tx.get(taskQuery)
    ]);
    if(!offering.exists||offering.data().schoolId!==ctx.schoolId||
       offering.data().status!=="active")
      deny("failed-precondition","Teacher handover requires an active course offering.");
    if(!fromAssignment.exists||fromAssignment.data().schoolId!==ctx.schoolId||
       fromAssignment.data().teacherUid!==fromTeacherUid||
       fromAssignment.data().offeringId!==offeringId||
       fromAssignment.data().status!=="active")
      deny("failed-precondition","The current teacher does not have an active assignment for this offering.");
    if(!toMember.exists||toMember.data().schoolId!==ctx.schoolId||
       toMember.data().status!=="active"||!Array.isArray(toMember.data().roles)||
       !toMember.data().roles.includes("teacher"))
      deny("permission-denied","The replacement account must be an active verified teacher in this school.");
    if(tasks.size===101)
      deny("resource-exhausted","This offering has more than 100 assessment deployments. Use a paginated handover workflow.");
    if(toAssignment.exists&&
       (toAssignment.data().schoolId!==ctx.schoolId||
        toAssignment.data().teacherUid!==toTeacherUid||
        toAssignment.data().offeringId!==offeringId))
      deny("failed-precondition","The replacement teaching-assignment key conflicts with another record.");
    const applicable=tasks.docs.filter(doc=>{
      const data=doc.data(),reviewerUid=data.reviewerUid||data.ownerUid;
      return data.schoolId===ctx.schoolId&&reviewerUid===fromTeacherUid&&
        data.lifecycle!=="cancelled";
    });
    if(!toAssignment.exists||toAssignment.data().status!=="active")
      await ensureTeacherScheduleAvailable(tx,toTeacherUid,offeringId);
    const now=FieldValue.serverTimestamp();
    tx.update(fromRef,{status:"ended",endedByUid:uid,endedAt:now,
      endReason:reason,revision:(fromAssignment.data().revision||1)+1});
    let replacementAssignmentState;
    if(!toAssignment.exists){
      replacementAssignmentState="created";
      tx.create(toRef,{schoolId:ctx.schoolId,teacherUid:toTeacherUid,offeringId,
        yearId:offering.data().yearId,termId:offering.data().termId,
        subjectId:offering.data().subjectId,sectionId:offering.data().sectionId,
        status:"active",revision:1,createdByUid:uid,createdAt:now});
    }else if(toAssignment.data().status==="ended"){
      replacementAssignmentState="restored";
      tx.update(toRef,{status:"active",restoredByUid:uid,restoredAt:now,
        restoreReason:reason,revision:(toAssignment.data().revision||1)+1});
    }else if(toAssignment.data().status==="active"){
      replacementAssignmentState="already_active";
    }else{
      deny("failed-precondition","The replacement teacher assignment is in an unsupported state.");
    }
    for(const task of applicable){
      const data=task.data(),revision=data.revision||1;
      tx.update(task.ref,{
        reviewerUid:toTeacherUid,
        handoverFromUid:fromTeacherUid,
        handoverByUid:uid,
        handoverAt:now,
        handoverReason:reason,
        revision:revision+1,
        updatedAt:now
      });
    }
    tx.create(directoryAudit,audit("teacher_offering_handed_over",{
      offeringId,fromTeacherUid,toTeacherUid,reason,
      replacementAssignmentState,assessmentCount:applicable.length
    }));
    tx.create(assessmentAudit,{
      schoolId:ctx.schoolId,actorUid:uid,action:"assessment_review_responsibility_handover",
      offeringId,fromTeacherUid,toTeacherUid,taskIds:applicable.map(doc=>doc.id),
      assessmentCount:applicable.length,reason,createdAt:now
    });
    result={offeringId,fromTeacherUid,toTeacherUid,
      replacementAssignmentState,assessmentCount:applicable.length};
   });
   await writeSchoolNotification({
    db,schoolId:ctx.schoolId,uid:toTeacherUid,
    id:"teacher_handover_"+offeringId+"_"+fromTeacherUid+"_"+toTeacherUid,
    title:"Class responsibility assigned",
    body:"You are now responsible for this course offering and its existing deployed assessment reviews.",
    type:"assessment",sourceId:offeringId,target:"teacher-assessment-library.html"
   }).catch(()=>{});
   return result;
  }

  if(["assign_teacher","end_teacher_assignment","restore_teacher_assignment"].includes(input.action)){
   requireAdmin();
   const teacherUid=checkId(input.teacherUid,"Teacher account UID",128),
     offeringId=checkId(input.offeringId,"Course offering ID",330);
   const ref=schoolRoot.doc("staff_assignments/"+rowKey(teacherUid,offeringId));
   const offeringRef=schoolRoot.doc("course_offerings/"+offeringId),
    teacherMemberRef=schoolRoot.doc("memberships/"+teacherUid);
   const auditRef=db.collection("schools/"+ctx.schoolId+"/directory_audit").doc();
   const ending=input.action==="end_teacher_assignment";
   const restoring=input.action==="restore_teacher_assignment";
   const reason=(ending||restoring)?checkName(input.reason,restoring?"Restore reason":"Handover reason"):null;
   if(reason&&reason.length<12)deny("invalid-argument","Explain the teaching assignment change in at least 12 characters.");
   await db.runTransaction(async tx=>{
    await checkWriteAuthority(tx);
    const taskQuery=ending?db.collection("schools/"+ctx.schoolId+"/assessments")
      .where("offeringId","==",offeringId).limit(101):null;
    const [offering,staff,prior,responsibilities]=await Promise.all([
      tx.get(offeringRef),tx.get(teacherMemberRef),tx.get(ref),
      taskQuery?tx.get(taskQuery):Promise.resolve(null)
    ]);
    if(!offering.exists||offering.data().schoolId!==ctx.schoolId)
      deny("failed-precondition","Course offering is not in this school.");
    if(!ending&&(!staff.exists||staff.data().schoolId!==ctx.schoolId||
       staff.data().status!=="active"||!Array.isArray(staff.data().roles)||
       !staff.data().roles.includes("teacher")))
      deny("permission-denied","The account is not an active teacher of this school.");
    if(ending) {
      if(!prior.exists||prior.data().status!=="active")
        deny("failed-precondition","There is no active appointment to end.");
      if(responsibilities?.size===101)
        deny("resource-exhausted","This class has more than 100 assessment deployments. Review handover before ending the teacher assignment.");
      const outstanding=(responsibilities?.docs||[]).filter(doc=>{
        const data=doc.data();
        return data.schoolId===ctx.schoolId&&(data.reviewerUid||data.ownerUid)===teacherUid&&
          data.lifecycle!=="cancelled";
      });
      if(outstanding.length)
        deny("failed-precondition","This teacher still has review responsibility for deployed assessments. Use Teacher handover so submissions and Gradebook access are not stranded.");
      tx.update(ref,{status:"ended",endedByUid:uid,endedAt:FieldValue.serverTimestamp(),
        endReason:reason,revision:(prior.data().revision||1)+1});
    }else if(restoring){
      if(!prior.exists||prior.data().status!=="ended")
        deny("failed-precondition","Only an ended teaching assignment can be restored.");
      if(offering.data().status!=="active")
        deny("failed-precondition","A teacher cannot be restored to a closed course offering.");
      await ensureTeacherScheduleAvailable(tx,teacherUid,offeringId);
      tx.update(ref,{status:"active",restoredByUid:uid,restoredAt:FieldValue.serverTimestamp(),
        restoreReason:reason,revision:(prior.data().revision||1)+1});
    }else{
      if(prior.exists)deny("already-exists","A teaching assignment already has history. Restore an ended assignment instead of replacing it.");
      if(offering.data().status!=="active")deny("failed-precondition","Cannot assign a closed course offering.");
      await ensureTeacherScheduleAvailable(tx,teacherUid,offeringId);
      tx.create(ref,{schoolId:ctx.schoolId,teacherUid,offeringId,
        yearId:offering.data().yearId,termId:offering.data().termId,
        subjectId:offering.data().subjectId,sectionId:offering.data().sectionId,
        status:"active",revision:1,createdByUid:uid,createdAt:FieldValue.serverTimestamp()});
    }
    tx.create(auditRef,audit(ending?"teacher_assignment_ended":
      restoring?"teacher_assignment_restored":"teacher_assigned",{teacherUid,offeringId,reason}));
   });
   return {teacherUid,offeringId,status:ending?"ended":"active"};
  }
  if(["end_enrollment","restore_enrollment"].includes(input.action)){
   requireAdmin();
   const enrollmentId=checkId(input.enrollmentId,"Enrollment ID",128);
   const reason=checkName(input.reason,input.action==="end_enrollment"?"Enrollment end reason":"Enrollment restore reason");
   if(reason.length<12)deny("invalid-argument","Explain the enrollment change in at least 12 characters.");
   const ref=schoolRoot.doc("enrollments/"+enrollmentId);
   const auditRef=db.collection("schools/"+ctx.schoolId+"/directory_audit").doc();
   await db.runTransaction(async tx=>{
    await checkWriteAuthority(tx);
    const record=await tx.get(ref);
    if(!record.exists||record.data().schoolId!==ctx.schoolId)
      deny("not-found","The enrollment is not in this school.");
    const data=record.data(),ending=input.action==="end_enrollment",
     offering=await tx.get(schoolRoot.doc("course_offerings/"+data.offeringId));
    if(!offering.exists||offering.data().schoolId!==ctx.schoolId)
      deny("failed-precondition","The class offering no longer exists.");
    if(offering.data().rosterMode==="section")
      deny("failed-precondition","This class follows official section placement. Change the student's official registration instead of manually changing class enrollment.");

    if(ending&&data.status!=="active")
      deny("failed-precondition","Only an active enrollment can be ended.");
    if(!ending&&data.status!=="ended")
      deny("failed-precondition","Only an ended enrollment can be restored.");
    if(!ending){
      const person=await tx.get(schoolRoot.doc("people/"+data.personId));
      if(!person.exists||person.data().schoolId!==ctx.schoolId||
         person.data().kind!=="student"||person.data().status!=="active"||
         offering.data().status!=="active")
        deny("failed-precondition","The student and course offering must both be active before restoring enrollment.");
    }
    const now=FieldValue.serverTimestamp(),revision=(data.revision||1)+1;
    tx.update(ref,ending?
      {status:"ended",endedByUid:uid,endedAt:now,endReason:reason,revision}:
      {status:"active",restoredByUid:uid,restoredAt:now,restoreReason:reason,revision});
    tx.create(auditRef,audit(ending?"student_enrollment_ended":"student_enrollment_restored",{
      enrollmentId,personId:data.personId,offeringId:data.offeringId,reason
    }));
   });
   return {enrollmentId,status:input.action==="end_enrollment"?"ended":"active"};
  }
  if(input.action==="class_roster"){
   if(!admin&&!teacher)deny("permission-denied","Class roster access is restricted.");
   const offeringId=checkId(input.offeringId,"Course offering ID",330);
   const offeringRef=schoolRoot.doc("course_offerings/"+offeringId);
   const offering=await offeringRef.get();
   if(!offering.exists||offering.data().schoolId!==ctx.schoolId)
    deny("not-found","Course offering is unavailable.");
   if(!admin){
    const grant=await schoolRoot.doc("staff_assignments/"+rowKey(uid,offeringId)).get();
    if(!grant.exists||grant.data().status!=="active"||grant.data().schoolId!==ctx.schoolId||
      grant.data().teacherUid!==uid)
      deny("permission-denied","Only an assigned teacher can read this class roster.");
   }
   const [snap,staffSnap]=await Promise.all([
    db.collection("schools/"+ctx.schoolId+"/enrollments").where("offeringId","==",offeringId).limit(101).get(),
    admin?db.collection("schools/"+ctx.schoolId+"/staff_assignments").where("offeringId","==",offeringId).limit(101).get():Promise.resolve(null)
   ]);
   if(snap.size===101||staffSnap?.size===101)
    deny("resource-exhausted","Class roster exceeds the first page. Use paginated school roster.");
   const rows=snap.docs.filter(d=>d.data().schoolId===ctx.schoolId&&(admin||d.data().status==="active"));
   const people=await Promise.all(rows.map(record=>schoolRoot.doc("people/"+record.data().personId).get()));
   let staff=[];
   if(admin&&staffSnap){
    const grants=staffSnap.docs.filter(d=>d.data().schoolId===ctx.schoolId);
    const memberships=await Promise.all(grants.map(record=>schoolRoot.doc("memberships/"+record.data().teacherUid).get()));
    staff=grants.map((record,i)=>({
      assignmentId:record.id,teacherUid:record.data().teacherUid,status:record.data().status,
      name:memberships[i].exists&&memberships[i].data().schoolId===ctx.schoolId?
        memberships[i].data().displayName||("Teacher "+record.data().teacherUid.slice(0,8)):
        "Teacher "+record.data().teacherUid.slice(0,8)
    }));
   }
   return {offeringId,students:rows.map((record,i)=>({
     personId:record.data().personId,enrollmentId:record.id,status:record.data().status,
     name:people[i].exists&&people[i].data().schoolId===ctx.schoolId?
       people[i].data().displayName:"Unlinked student record",
     studentNumber:people[i].exists&&people[i].data().schoolId===ctx.schoolId?
       String(people[i].data().studentNumber||""):"",
     accountLinked:Boolean(people[i].exists&&people[i].data().schoolId===ctx.schoolId&&people[i].data().authUid)
   })),teachers:staff};
  }
  deny("invalid-argument","Unknown academic operation.");
 };
}
module.exports={createSchoolAcademicsService,checkId,rowKey};
