"use strict";
/**
 * School-authoritative daily advisory / homeroom attendance.
 * This is not derived from Classroom activity and does not change grades.
 */
const {FieldValue}=require("firebase-admin/firestore");
const {createHash}=require("node:crypto");
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");
const {checkId,rowKey}=require("./school-academics.js");

const STATUSES=new Set(["unmarked","present","late","absent","excused"]);
function deny(code,message){throw new TenantAccessError(code,message)}
function attendanceDate(value){
 const text=String(value||"").trim();
 if(!/^\d{4}-\d{2}-\d{2}$/.test(text))deny("invalid-argument","Attendance date must use YYYY-MM-DD.");
 const parsed=new Date(text+"T00:00:00Z");
 if(Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==text)
  deny("invalid-argument","Attendance date is invalid.");
 return text;
}
function short(value,max=300){return String(value??"").trim().slice(0,max)}
function dayId(yearId,sectionId,date){
 return createHash("sha256").update(JSON.stringify([yearId,sectionId,date])).digest("hex");
}
function cleanEntries(raw,allowed){
 if(!Array.isArray(raw)||raw.length>220)deny("invalid-argument","Attendance entries exceed the supported section size.");
 const seen=new Set(),out={};
 for(const item of raw){
  const personId=checkId(String(item?.personId||""),"Student person ID",128);
  if(seen.has(personId))deny("invalid-argument","A student appears more than once in this attendance save.");
  seen.add(personId);
  if(!allowed.has(personId))deny("permission-denied","Attendance includes a student outside this official advisory roster.");
  const status=String(item?.status||"unmarked").trim().toLowerCase();
  if(!STATUSES.has(status))deny("invalid-argument","Choose a supported attendance status.");
  const note=short(item?.note,240);
  out[personId]={status,note};
 }
 return out;
}
function createSchoolAttendanceService({db}){
 return async request=>{
  const input=request.data||{},ctx=await getSchoolContext({
   db,request,schoolId:input.schoolId,roles:["teacher","school_admin"],allowDraftAdmin:true
  });
  const prefix="schools/"+ctx.schoolId+"/",teacher=ctx.roles.includes("teacher"),admin=ctx.roles.includes("school_admin");
  const sectionId=checkId(String(input.sectionId||""),"Section ID"),yearId=checkId(String(input.yearId||""),"Academic year ID"),
   date=attendanceDate(input.date);
  const sectionRef=db.doc(prefix+"sections/"+sectionId),yearRef=db.doc(prefix+"academic_years/"+yearId),
   dayRef=db.doc(prefix+"attendance_days/"+dayId(yearId,sectionId,date));

  async function authority(){
   const [section,year]=await Promise.all([sectionRef.get(),yearRef.get()]);
   if(!section.exists||section.data().schoolId!==ctx.schoolId||section.data().status!=="active")
    deny("not-found","This advisory section is unavailable.");
   if(!year.exists||year.data().schoolId!==ctx.schoolId||year.data().status!=="active")
    deny("not-found","This academic year is unavailable.");
   const start=String(year.data().startDate||""),end=String(year.data().endDate||"");
   if(start&&date<start||end&&date>end)deny("failed-precondition","Attendance date is outside this academic year.");
   if(!admin){
    if(!teacher)deny("permission-denied","Teacher access is required.");
    const adviser=await db.doc(prefix+"section_advisers/"+rowKey(yearId,sectionId,ctx.uid)).get();
    if(!adviser.exists||adviser.data().schoolId!==ctx.schoolId||adviser.data().status!=="active"||
       adviser.data().teacherUid!==ctx.uid||adviser.data().sectionId!==sectionId||adviser.data().yearId!==yearId)
     deny("permission-denied","Only the active adviser / homeroom teacher may manage this section's daily attendance.");
   }
   return {section:section.data(),year:year.data()};
  }

  async function roster(){
   const [registrationSnap,enrollmentSnap]=await Promise.all([
    db.collection(prefix+"student_registrations").where("sectionId","==",sectionId).limit(201).get(),
    db.collection(prefix+"enrollments").where("sectionId","==",sectionId).limit(501).get()
   ]);
   if(registrationSnap.size===201||enrollmentSnap.size===501)
    deny("resource-exhausted","This advisory roster requires pagination before attendance can be saved.");
   const registrations=registrationSnap.docs.filter(doc=>{
    const row=doc.data();return row.schoolId===ctx.schoolId&&row.status==="active"&&row.yearId===yearId;
   });
   const regByPerson=new Map(registrations.map(doc=>[doc.data().personId,doc.data()]));
   const fallback=new Set(enrollmentSnap.docs.filter(doc=>{
    const row=doc.data();return row.schoolId===ctx.schoolId&&row.status==="active"&&row.yearId===yearId;
   }).map(doc=>doc.data().personId).filter(Boolean));
   const ids=regByPerson.size?[...regByPerson.keys()]:[...fallback];
   if(ids.length>200)deny("resource-exhausted","This advisory roster exceeds 200 students.");
   const people=await Promise.all(ids.map(id=>db.doc(prefix+"people/"+checkId(id,"Person ID",128)).get()));
   return people.map((person,index)=>{
    const personId=ids[index],reg=regByPerson.get(personId)||{},data=person.exists?person.data():null;
    return {
     personId,name:data&&data.schoolId===ctx.schoolId?String(data.displayName||reg.displayName||"Student"):String(reg.displayName||"Student"),
     studentNumber:String(reg.studentNumber||"")
    };
   }).sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:"base"}));
  }

  const scope=await authority(),students=await roster();
  if(input.action==="section_day"){
   const day=await dayRef.get(),data=day.exists&&day.data().schoolId===ctx.schoolId?day.data():null,
    stored=data&&data.entries&&typeof data.entries==="object"?data.entries:{};
   return {
    schoolId:ctx.schoolId,sectionId,sectionName:String(scope.section.name||sectionId),
    yearId,yearName:String(scope.year.name||yearId),date,revision:data?Number(data.revision)||1:0,
    students:students.map(student=>({
     ...student,status:STATUSES.has(stored[student.personId]?.status)?stored[student.personId].status:"unmarked",
     note:short(stored[student.personId]?.note,240)
    })),
    updatedAt:data?.updatedAt?.toMillis?.()||null,updatedByUid:data?.updatedByUid||null
   };
  }

  if(input.action==="save_section_day"){
   const expected=Number(input.expectedRevision);
   if(!Number.isInteger(expected)||expected<0)deny("invalid-argument","Current attendance revision is required.");
   const allowed=new Set(students.map(row=>row.personId)),entries=cleanEntries(input.entries,allowed);
   const auditRef=db.collection(prefix+"attendance_audit").doc();let result;
   await db.runTransaction(async tx=>{
    // Re-check institutional and adviser authority inside the write transaction.
    const [section,year,current]=await Promise.all([tx.get(sectionRef),tx.get(yearRef),tx.get(dayRef)]);
    if(!section.exists||section.data().schoolId!==ctx.schoolId||section.data().status!=="active"||
       !year.exists||year.data().schoolId!==ctx.schoolId||year.data().status!=="active")
     deny("failed-precondition","The advisory section or school year changed before attendance was saved.");
    if(!admin){
     const adviser=await tx.get(db.doc(prefix+"section_advisers/"+rowKey(yearId,sectionId,ctx.uid)));
     if(!adviser.exists||adviser.data().schoolId!==ctx.schoolId||adviser.data().status!=="active"||
        adviser.data().teacherUid!==ctx.uid)
      deny("permission-denied","Your adviser assignment changed before attendance was saved.");
    }
    const prior=current.exists?current.data():null,revision=prior?Number(prior.revision)||1:0;
    if(revision!==expected)deny("failed-precondition","A newer attendance revision exists. Reload the day before saving.");
    const now=FieldValue.serverTimestamp(),nextRevision=revision+1;
    const values={schoolId:ctx.schoolId,sectionId,yearId,date,entries,revision:nextRevision,
     updatedByUid:ctx.uid,updatedAt:now,status:"active"};
    if(current.exists){
     if(prior.schoolId!==ctx.schoolId||prior.sectionId!==sectionId||prior.yearId!==yearId||prior.date!==date)
      deny("permission-denied","Attendance record ownership changed.");
     tx.create(dayRef.collection("revisions").doc(String(revision)),{...prior,archivedRevisionAt:now});
     tx.update(dayRef,values);
    }else tx.create(dayRef,{...values,createdByUid:ctx.uid,createdAt:now});
    const counts={present:0,late:0,absent:0,excused:0,unmarked:0};
    for(const student of students){
     const state=entries[student.personId]?.status||"unmarked";counts[state]++;
    }
    tx.create(auditRef,{schoolId:ctx.schoolId,actorUid:ctx.uid,action:"advisory_attendance_saved",
     sectionId,yearId,date,revision:nextRevision,counts,createdAt:now});
    result={sectionId,yearId,date,revision:nextRevision,counts};
   });
   return result;
  }

  deny("invalid-argument","Unknown attendance operation.");
 };
}
module.exports={createSchoolAttendanceService};
