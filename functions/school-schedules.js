"use strict";
/** School-owned class scheduling plus legacy teacher-owned timetable persistence for Adminerva 4.0. */
const {FieldValue}=require("firebase-admin/firestore");
const {createHash}=require("node:crypto");
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");

function deny(code,message){throw new TenantAccessError(code,message)}
function schoolYear(value){
 const text=String(value||"").trim(),match=/^([0-9]{4})-([0-9]{4})$/.exec(text);
 if(!match||Number(match[2])!==Number(match[1])+1)deny("invalid-argument","Use a school year such as 2026-2027.");
 return text;
}
function semester(value){
 const text=String(value||"").trim().toUpperCase();
 if(!["S1","S2"].includes(text))deny("invalid-argument","Choose first or second semester.");
 return text;
}
function clock(value,label){
 const text=String(value||"").trim(),match=/^([0-9]{2}):([0-9]{2})$/.exec(text);
 if(!match||Number(match[1])>23||Number(match[2])>59)deny("invalid-argument",label+" must use 24-hour HH:MM.");
 return {text,minutes:Number(match[1])*60+Number(match[2])};
}
function short(value,max,label,{required=false}={}){
 const text=typeof value==="string"?value.trim():"";
 if((required&&!text)||text.length>max)deny("invalid-argument",label+" is missing or too long.");
 return text;
}
function scheduleId(uid,yearOrPeriod,legacyTerm=null){
 const parts=legacyTerm===null?[uid,"period",yearOrPeriod]:[uid,"legacy",yearOrPeriod,legacyTerm];
 return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}
function periodId(value){
 const text=String(value||"").trim();
 if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(text))
  deny("invalid-argument","Choose a valid academic period.");
 return text;
}
async function assignedPairs(db,prefix,uid,{periodId:scopePeriodId=null,programId=null,transaction=null}={}){
 const schoolId=prefix.split("/")[1],read=ref=>transaction?transaction.get(ref):ref.get();
 const grants=await read(db.collection(prefix+"staff_assignments").where("teacherUid","==",uid).limit(101));
 if(grants.size===101)deny("resource-exhausted","Teaching assignments require pagination before schedule validation.");
 const active=grants.docs.filter(doc=>doc.data().status==="active"&&doc.data().schoolId===prefix.split("/")[1]);
 const offeringRefs=active.map(doc=>db.doc(prefix+"course_offerings/"+doc.data().offeringId));
 const offerings=await Promise.all(offeringRefs.map(read));
 const valid=offerings.filter((doc,index)=>doc.exists&&doc.data().schoolId===schoolId&&doc.data().status==="active"&&
   (!scopePeriodId||doc.data().termId===scopePeriodId)&&(!programId||doc.data().programId===programId)&&
   ["termId","yearId","sectionId","subjectId","programId"].every(key=>!active[index].data()[key]||active[index].data()[key]===doc.data()[key]));
 const sectionIds=[...new Set(valid.map(doc=>doc.data().sectionId))],
   subjectIds=[...new Set(valid.map(doc=>doc.data().subjectId))];
 const [sections,subjects]=await Promise.all([
   Promise.all(sectionIds.map(id=>read(db.doc(prefix+"sections/"+id)))),
   Promise.all(subjectIds.map(id=>read(db.doc(prefix+"subjects/"+id))))
 ]);
 const sectionNames=new Map(sections.filter(doc=>doc.exists&&doc.data().schoolId===schoolId&&doc.data().status==="active")
   .map(doc=>[doc.id,String(doc.data().name||"").trim()])),
  subjectNames=new Map(subjects.filter(doc=>doc.exists&&doc.data().schoolId===schoolId&&doc.data().status==="active")
   .map(doc=>[doc.id,String(doc.data().name||"").trim()]));
 const pairs=new Set();
 for(const offering of valid){
   const sec=sectionNames.get(offering.data().sectionId),sub=subjectNames.get(offering.data().subjectId);
   if(sec&&sub)pairs.add(sec.toLocaleLowerCase("en")+"\0"+sub.toLocaleLowerCase("en"));
 }
 return pairs;
}
function normalizeRows(rows,allowedPairs){
 if(!Array.isArray(rows)||rows.length>40)deny("invalid-argument","A teacher schedule may contain up to 40 rows.");
 const intervals=[],days=["mon","tue","wed","thu","fri"];
 const result=rows.map((row,index)=>{
   if(!row||typeof row!=="object"||Array.isArray(row))deny("invalid-argument","Schedule row "+(index+1)+" is invalid.");
   const start=clock(row.startTime,"Row "+(index+1)+" start"),end=clock(row.endTime,"Row "+(index+1)+" end");
   if(start.minutes>=end.minutes)deny("invalid-argument","Schedule row "+(index+1)+" must end after it starts.");
   intervals.push({start:start.minutes,end:end.minutes,index});
   if(row.type==="constant"){
     return {type:"constant",startTime:start.text,endTime:end.text,
       eventName:short(row.eventName,120,"Event name",{required:true})};
   }
   if(row.type!=="class")deny("invalid-argument","Schedule rows must be class or constant events.");
   const output={type:"class",startTime:start.text,endTime:end.text};
   for(const day of days){
     const cell=row[day]&&typeof row[day]==="object"?row[day]:{};
     const sec=short(cell.sec,140,day+" section"),sub=short(cell.sub,140,day+" subject"),
       evt=short(cell.evt,120,day+" event"),grade=short(cell.grade,80,day+" grade");
     if(Boolean(sec)!==Boolean(sub))
       deny("invalid-argument","Row "+(index+1)+" "+day+" needs both section and subject.");
     if(sec&&sub&&!allowedPairs.has(sec.toLocaleLowerCase("en")+"\0"+sub.toLocaleLowerCase("en")))
       deny("permission-denied","Row "+(index+1)+" "+day+" is not one of your active school teaching assignments.");
     output[day]={sec,sub,evt,...(grade?{grade}:{})};
   }
   return output;
 });
 intervals.sort((a,b)=>a.start-b.start||a.end-b.end);
 for(let i=0;i<intervals.length-1;i++)
   if(intervals[i].end>intervals[i+1].start)
     deny("invalid-argument","Schedule rows "+(intervals[i].index+1)+" and "+(intervals[i+1].index+1)+" overlap.");
 return result;
}
const CLASS_DAYS=new Set(["mon","tue","wed","thu","fri","sat"]);
function offeringId(value){return periodId(value)}
function normalizeRoom(value){return short(value,120,"Room").replace(/\s+/g," ")}
function normalizeClassMeetings(value){
 if(!Array.isArray(value)||value.length>18)
  deny("invalid-argument","A class may contain up to 18 weekly meeting slots.");
 const meetings=value.map((meeting,index)=>{
  if(!meeting||typeof meeting!=="object"||Array.isArray(meeting))
   deny("invalid-argument","Class meeting "+(index+1)+" is invalid.");
  const day=String(meeting.day||"").trim().toLowerCase();
  if(!CLASS_DAYS.has(day))deny("invalid-argument","Class meeting "+(index+1)+" needs a valid weekday.");
  const start=clock(meeting.startTime,"Class meeting "+(index+1)+" start"),
   end=clock(meeting.endTime,"Class meeting "+(index+1)+" end");
  if(start.minutes>=end.minutes)deny("invalid-argument","Class meeting "+(index+1)+" must end after it starts.");
  return {day,startTime:start.text,endTime:end.text,room:normalizeRoom(meeting.room)};
 });
 const seen=new Set();
 meetings.forEach((meeting,index)=>{
  const key=[meeting.day,meeting.startTime,meeting.endTime,meeting.room.toLocaleLowerCase("en")].join("\0");
  if(seen.has(key))deny("invalid-argument","Class meeting "+(index+1)+" duplicates another meeting.");
  seen.add(key);
 });
 for(let i=0;i<meetings.length;i++)for(let j=i+1;j<meetings.length;j++){
  if(meetings[i].day!==meetings[j].day)continue;
  const aStart=clock(meetings[i].startTime,"Meeting start").minutes,aEnd=clock(meetings[i].endTime,"Meeting end").minutes,
   bStart=clock(meetings[j].startTime,"Meeting start").minutes,bEnd=clock(meetings[j].endTime,"Meeting end").minutes;
  if(aStart<bEnd&&bStart<aEnd)
   deny("invalid-argument","This class has overlapping "+meetings[i].day+" meeting times.");
 }
 return meetings;
}
function meetingsOverlap(first,second){
 if(first.day!==second.day)return false;
 const aStart=clock(first.startTime,"Meeting start").minutes,aEnd=clock(first.endTime,"Meeting end").minutes,
  bStart=clock(second.startTime,"Meeting start").minutes,bEnd=clock(second.endTime,"Meeting end").minutes;
 return aStart<bEnd&&bStart<aEnd;
}
function roomKey(value){return String(value||"").trim().replace(/\s+/g," ").toLocaleLowerCase("en")}
function classScheduleView(doc){
 const data=doc.data();
 return {offeringId:data.offeringId||doc.id,yearId:data.yearId||"",termId:data.termId||"",
  programId:data.programId||"",sectionId:data.sectionId||"",subjectId:data.subjectId||"",
  meetings:Array.isArray(data.meetings)?data.meetings:[],revision:Number(data.revision)||1,
  updatedAt:data.updatedAt?.toMillis?.()||null};
}
function rowsToText(rows){
 const days=["Monday","Tuesday","Wednesday","Thursday","Friday"],
   keys=["mon","tue","wed","thu","fri"],lines=[];
 for(const row of rows){
   const time=row.startTime+"-"+row.endTime;
   if(row.type==="constant"){lines.push(time+" · "+row.eventName);continue;}
   keys.forEach((key,index)=>{
     const cell=row[key]||{};
     if(cell.evt)lines.push(days[index]+" "+time+" · "+cell.evt);
     else if(cell.sec&&cell.sub)lines.push(days[index]+" "+time+" · "+cell.sec+" · "+cell.sub);
   });
 }
 return lines.join("\n");
}
function createSchoolScheduleService({db}){
 return async request=>{
  const input=request.data||{},action=String(input.action||""),
   ctx=await getSchoolContext({db,request,schoolId:input.schoolId,roles:["teacher","school_admin"],allowDraftAdmin:true}),
   prefix="schools/"+ctx.schoolId+"/",memberRef=db.doc(prefix+"memberships/"+ctx.uid),
   schoolRef=db.doc("platform_schools/"+ctx.schoolId),
   admin=ctx.roles.includes("school_admin"),teacher=ctx.roles.includes("teacher");

  async function requireAdminWrite(tx){
   if(!admin)deny("permission-denied","School administration is required for the official class schedule.");
   if(ctx.platformOverride)return;
   const [school,member]=await Promise.all([tx.get(schoolRef),tx.get(memberRef)]);
   if(!school.exists||!["draft","active","pilot"].includes(school.data().state)||!member.exists||
      member.data().schoolId!==ctx.schoolId||member.data().status!=="active"||
      !Array.isArray(member.data().roles)||!member.data().roles.includes("school_admin"))
    deny("permission-denied","School administration access changed before the class schedule was saved.");
  }

  if(action==="admin_overview"){
   if(!admin)deny("permission-denied","School administration is required to review official class schedules.");
   const snap=await db.collection(prefix+"class_schedules").limit(1001).get();
   if(snap.size===1001)deny("resource-exhausted","Official class schedules require pagination.");
   return {schoolId:ctx.schoolId,schedules:snap.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&
    doc.data().status!=="archived").map(classScheduleView)};
  }

  if(["get_class_schedule","save_class_schedule"].includes(action)){
   const targetOfferingId=offeringId(input.offeringId),offeringRef=db.doc(prefix+"course_offerings/"+targetOfferingId),
    scheduleRef=db.doc(prefix+"class_schedules/"+targetOfferingId);
   const offering=await offeringRef.get();
   if(!offering.exists||offering.data().schoolId!==ctx.schoolId||offering.data().status!=="active")
    deny("not-found","This active class offering is unavailable.");
   if(!admin){
    if(!teacher)deny("permission-denied","Teaching access is required to view this class schedule.");
    const grant=await db.doc(prefix+"staff_assignments/"+
      createHash("sha256").update(JSON.stringify([ctx.uid,targetOfferingId])).digest("hex")).get();
    if(!grant.exists||grant.data().schoolId!==ctx.schoolId||grant.data().teacherUid!==ctx.uid||
       grant.data().offeringId!==targetOfferingId||grant.data().status!=="active")
     deny("permission-denied","You are not assigned to this class.");
   }
   if(action==="get_class_schedule"){
    const schedule=await scheduleRef.get();
    return {schoolId:ctx.schoolId,offeringId:targetOfferingId,
     yearId:offering.data().yearId,termId:offering.data().termId,programId:offering.data().programId,
     sectionId:offering.data().sectionId,subjectId:offering.data().subjectId,
     meetings:schedule.exists&&schedule.data().schoolId===ctx.schoolId&&schedule.data().status!=="archived"?
      (schedule.data().meetings||[]):[],
     revision:schedule.exists&&schedule.data().schoolId===ctx.schoolId?Number(schedule.data().revision)||1:0};
   }
   if(!admin)deny("permission-denied","Only School Administration may change the official class schedule.");
   const expected=Number(input.expectedRevision),reason=short(input.reason,500,"Schedule change reason",{required:true});
   if(!Number.isInteger(expected)||expected<0)deny("invalid-argument","Current class schedule revision is required.");
   if(reason.length<12)deny("invalid-argument","Explain the official schedule change in at least 12 characters.");
   const meetings=normalizeClassMeetings(input.meetings);
   let result;
   await db.runTransaction(async tx=>{
    await requireAdminWrite(tx);
    const [liveOffering,current,termSchedules,grants]=await Promise.all([
     tx.get(offeringRef),tx.get(scheduleRef),
     tx.get(db.collection(prefix+"class_schedules").where("termId","==",offering.data().termId).limit(501)),
     tx.get(db.collection(prefix+"staff_assignments").where("status","==","active").limit(2001))
    ]);
    if(!liveOffering.exists||liveOffering.data().schoolId!==ctx.schoolId||liveOffering.data().status!=="active")
     deny("failed-precondition","The class offering changed before its schedule was saved.");
    const live=liveOffering.data();
    if(["yearId","termId","programId","sectionId","subjectId"].some(key=>live[key]!==offering.data()[key]))
     deny("failed-precondition","The class offering structure changed. Reload before scheduling it.");
    if(termSchedules.size===501||grants.size===2001)
     deny("resource-exhausted","Schedule conflict review exceeds the current school limit.");
    const currentRevision=current.exists?Number(current.data().revision)||1:0;
    if(currentRevision!==expected)deny("failed-precondition","A newer official class schedule exists. Reload before replacing it.");
    const byOffering=new Map();
    for(const grant of grants.docs){
     const data=grant.data();if(data.schoolId!==ctx.schoolId||data.status!=="active")continue;
     const list=byOffering.get(data.offeringId)||[];list.push(data.teacherUid);byOffering.set(data.offeringId,list);
    }
    const targetTeachers=new Set(byOffering.get(targetOfferingId)||[]);
    for(const other of termSchedules.docs){
     if(other.id===targetOfferingId||other.data().schoolId!==ctx.schoolId||other.data().status==="archived")continue;
     const data=other.data(),otherMeetings=Array.isArray(data.meetings)?data.meetings:[],
      sharedTeacher=(byOffering.get(other.id)||[]).some(uid=>targetTeachers.has(uid)),
      sameSection=data.sectionId===live.sectionId;
     for(const candidate of meetings)for(const existing of otherMeetings){
      if(!meetingsOverlap(candidate,existing))continue;
      if(sameSection)
       deny("failed-precondition","Schedule conflict: this section already has another class at "+candidate.day+" "+candidate.startTime+"–"+candidate.endTime+".");
      if(sharedTeacher)
       deny("failed-precondition","Schedule conflict: an assigned teacher already teaches another class at "+candidate.day+" "+candidate.startTime+"–"+candidate.endTime+".");
      if(roomKey(candidate.room)&&roomKey(candidate.room)===roomKey(existing.room))
       deny("failed-precondition","Schedule conflict: room "+candidate.room+" is already used at "+candidate.day+" "+candidate.startTime+"–"+candidate.endTime+".");
     }
    }
    const now=FieldValue.serverTimestamp(),revision=currentRevision+1,
     next={schoolId:ctx.schoolId,offeringId:targetOfferingId,yearId:live.yearId,termId:live.termId,
      programId:live.programId,sectionId:live.sectionId,subjectId:live.subjectId,
      meetings,status:"active",revision,updatedByUid:ctx.uid,updatedAt:now};
    if(current.exists){
     const prior=current.data();
     if(prior.schoolId!==ctx.schoolId||prior.offeringId!==targetOfferingId)
      deny("permission-denied","Official schedule ownership changed.");
     tx.create(scheduleRef.collection("revisions").doc(String(currentRevision)),{...prior,archivedRevisionAt:now});
     tx.update(scheduleRef,next);
    }else tx.create(scheduleRef,{...next,createdByUid:ctx.uid,createdAt:now});
    tx.create(db.collection(prefix+"planning_audit").doc(),{
     schoolId:ctx.schoolId,actorUid:ctx.uid,resourceId:targetOfferingId,action:"class_schedule_saved",
     offeringId:targetOfferingId,yearId:live.yearId,termId:live.termId,sectionId:live.sectionId,
     subjectId:live.subjectId,reason,revision,createdAt:now
    });
    result={offeringId:targetOfferingId,meetings,revision};
   });
   return result;
  }

  if(action==="my_official_schedule"){
   if(!teacher)deny("permission-denied","Teacher access is required.");
   const grants=await db.collection(prefix+"staff_assignments").where("teacherUid","==",ctx.uid).limit(201).get();
   if(grants.size===201)deny("resource-exhausted","Teaching assignments require pagination.");
   const ids=[...new Set(grants.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&doc.data().status==="active")
    .map(doc=>doc.data().offeringId))];
   const docs=await Promise.all(ids.map(id=>db.doc(prefix+"class_schedules/"+id).get()));
   return {schoolId:ctx.schoolId,schedules:docs.filter(doc=>doc.exists&&doc.data().schoolId===ctx.schoolId&&
    doc.data().status!=="archived").map(classScheduleView)};
  }

  if(!teacher)deny("permission-denied","Teacher access is required for the personal timetable.");
  const canonicalPeriod=input.periodId?periodId(input.periodId):null;
  let year=null,term=null,period=null,programId=null,yearId=null,periodName=null,periodType=null,sequence=null,id;
  if(canonicalPeriod){
   period=await db.doc(prefix+"terms/"+canonicalPeriod).get();
   if(!period.exists||period.data().schoolId!==ctx.schoolId||period.data().status!=="active")
    deny("failed-precondition","The selected academic period is not active in this school.");
   programId=period.data().programId;yearId=period.data().yearId;
   const yearDoc=await db.doc(prefix+"academic_years/"+yearId).get();
   if(!yearDoc.exists||yearDoc.data().schoolId!==ctx.schoolId||yearDoc.data().status!=="active")
    deny("failed-precondition","The academic year for this period is not active.");
   year=schoolYear(yearDoc.data().name);periodName=String(period.data().name||canonicalPeriod).slice(0,140);
   periodType=period.data().periodType||"term";sequence=Number(period.data().sequence)||1;
   const pairs=await assignedPairs(db,prefix,ctx.uid,{periodId:canonicalPeriod,programId});
   if(!pairs.size)
    deny("permission-denied","You have no active teaching assignment in this academic period.");
   id=scheduleId(ctx.uid,canonicalPeriod);
  }else{
   year=schoolYear(input.schoolYear);term=semester(input.semester);id=scheduleId(ctx.uid,year,term);
  }
  const ref=db.doc(prefix+"teacher_schedules/"+id);
  if(input.action==="get"){
   const doc=await ref.get();
   if(!doc.exists)return {scheduleId:id,schoolYear:year,semester:term,periodId:canonicalPeriod,
    programId,yearId,periodName,periodType,sequence,rows:[],rawText:"",revision:0};
   const data=doc.data();
   if(data.schoolId!==ctx.schoolId||data.ownerUid!==ctx.uid)
    deny("permission-denied","This school schedule belongs to a different teacher or school.");
   if(canonicalPeriod&&data.periodId!==canonicalPeriod)
    deny("failed-precondition","The saved timetable belongs to another academic period.");
   return {scheduleId:id,schoolYear:year,semester:term,periodId:canonicalPeriod,
    programId,yearId,periodName,periodType,sequence,rows:data.rows||[],
    rawText:data.rawText||"",revision:data.revision||1,updatedAt:data.updatedAt?.toMillis?.()||null};
  }
  if(input.action!=="save")deny("invalid-argument","Unknown school schedule operation.");
  // Validate the live assignment and catalog inside the save transaction.
  const expected=input.expectedRevision;
  if(!Number.isInteger(expected)||expected<0)deny("invalid-argument","Current schedule revision is required.");
  let result;
  await db.runTransaction(async tx=>{
   const [school,member,current]=await Promise.all([tx.get(schoolRef),tx.get(memberRef),tx.get(ref)]);
   if(!school.exists||!["active","pilot"].includes(school.data().state)||!member.exists||
      member.data().schoolId!==ctx.schoolId||member.data().status!=="active"||
      !Array.isArray(member.data().roles)||!member.data().roles.includes("teacher"))
    deny("permission-denied","Your teaching access changed before the schedule was saved.");
   if(canonicalPeriod){
     const [livePeriod,liveYear]=await Promise.all([tx.get(db.doc(prefix+"terms/"+canonicalPeriod)),tx.get(db.doc(prefix+"academic_years/"+yearId))]);
     if(!livePeriod.exists||livePeriod.data().schoolId!==ctx.schoolId||livePeriod.data().status!=="active"||livePeriod.data().programId!==programId||livePeriod.data().yearId!==yearId||!liveYear.exists||liveYear.data().schoolId!==ctx.schoolId||liveYear.data().status!=="active")deny("failed-precondition","The academic period changed before saving.");
   }
   const pairs=await assignedPairs(db,prefix,ctx.uid,{periodId:canonicalPeriod,programId,transaction:tx});
   if(canonicalPeriod&&!pairs.size)deny("permission-denied","No active teaching assignments remain in this period.");
   const rows=normalizeRows(input.rows,pairs);
   const prior=current.exists?current.data():null,currentRevision=prior?.revision||0;
   if(prior&&(prior.schoolId!==ctx.schoolId||prior.ownerUid!==ctx.uid))deny("permission-denied","Schedule ownership changed.");
   if(currentRevision!==expected)deny("failed-precondition","A newer school schedule exists. Reload before replacing it.");
   const rawText=rowsToText(rows),revision=currentRevision+1,now=FieldValue.serverTimestamp();
   if(current.exists){
     tx.create(ref.collection("revisions").doc(String(currentRevision)),{
      ...prior,archivedRevisionAt:now
     });
     tx.update(ref,{rows,rawText,revision,updatedAt:now});
   }else{
     tx.create(ref,{schoolId:ctx.schoolId,ownerUid:ctx.uid,schoolYear:year,
      ...(canonicalPeriod?{periodId:canonicalPeriod,programId,yearId,periodName,periodType,sequence}:{semester:term}),
      rows,rawText,revision,createdAt:now,updatedAt:now});
   }
   tx.create(db.collection(prefix+"planning_audit").doc(),{
    schoolId:ctx.schoolId,actorUid:ctx.uid,resourceId:id,
    action:"teacher_schedule_saved",schoolYear:year,
    ...(canonicalPeriod?{periodId:canonicalPeriod,programId,yearId}:{semester:term}),
    revision,createdAt:now
   });
   result={scheduleId:id,revision,rawText};
  });
  return result;
 };
}
module.exports={createSchoolScheduleService,normalizeRows,rowsToText,scheduleId,assignedPairs};
