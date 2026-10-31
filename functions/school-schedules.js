"use strict";
/** Verified-school teacher-owned timetable persistence for Adminerva 4.0. */
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
function scheduleId(uid,year,term){
 return createHash("sha256").update(JSON.stringify([uid,year,term])).digest("hex");
}
async function assignedPairs(db,prefix,uid){
 const grants=await db.collection(prefix+"staff_assignments").where("teacherUid","==",uid).limit(101).get();
 if(grants.size===101)deny("resource-exhausted","Teaching assignments require pagination before schedule validation.");
 const active=grants.docs.filter(doc=>doc.data().status==="active"&&doc.data().schoolId===prefix.split("/")[1]);
 const offeringRefs=active.map(doc=>db.doc(prefix+"course_offerings/"+doc.data().offeringId));
 const offerings=await Promise.all(offeringRefs.map(ref=>ref.get()));
 const valid=offerings.filter(doc=>doc.exists&&doc.data().status==="active");
 const sectionIds=[...new Set(valid.map(doc=>doc.data().sectionId))],
   subjectIds=[...new Set(valid.map(doc=>doc.data().subjectId))];
 const [sections,subjects]=await Promise.all([
   Promise.all(sectionIds.map(id=>db.doc(prefix+"sections/"+id).get())),
   Promise.all(subjectIds.map(id=>db.doc(prefix+"subjects/"+id).get()))
 ]);
 const sectionNames=new Map(sections.filter(doc=>doc.exists&&doc.data().status==="active")
   .map(doc=>[doc.id,String(doc.data().name||"").trim()])),
  subjectNames=new Map(subjects.filter(doc=>doc.exists&&doc.data().status==="active")
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
  const input=request.data||{},ctx=await getSchoolContext({db,request,schoolId:input.schoolId,roles:["teacher"]});
  const year=schoolYear(input.schoolYear),term=semester(input.semester),prefix="schools/"+ctx.schoolId+"/";
  const id=scheduleId(ctx.uid,year,term),ref=db.doc(prefix+"teacher_schedules/"+id);
  const memberRef=db.doc(prefix+"memberships/"+ctx.uid),schoolRef=db.doc("platform_schools/"+ctx.schoolId);
  if(input.action==="get"){
   const doc=await ref.get();
   if(!doc.exists)return {scheduleId:id,schoolYear:year,semester:term,rows:[],rawText:"",revision:0};
   const data=doc.data();
   if(data.schoolId!==ctx.schoolId||data.ownerUid!==ctx.uid)
    deny("permission-denied","This school schedule belongs to a different teacher or school.");
   return {scheduleId:id,schoolYear:year,semester:term,rows:data.rows||[],
    rawText:data.rawText||"",revision:data.revision||1,updatedAt:data.updatedAt?.toMillis?.()||null};
  }
  if(input.action!=="save")deny("invalid-argument","Unknown school schedule operation.");
  const pairs=await assignedPairs(db,prefix,ctx.uid),rows=normalizeRows(input.rows,pairs);
  const expected=input.expectedRevision;
  if(!Number.isInteger(expected)||expected<0)deny("invalid-argument","Current schedule revision is required.");
  let result;
  await db.runTransaction(async tx=>{
   const [school,member,current]=await Promise.all([tx.get(schoolRef),tx.get(memberRef),tx.get(ref)]);
   if(!school.exists||school.data().state!=="active"||!member.exists||
      member.data().schoolId!==ctx.schoolId||member.data().status!=="active"||
      !Array.isArray(member.data().roles)||!member.data().roles.includes("teacher"))
    deny("permission-denied","Your teaching access changed before the schedule was saved.");
   const prior=current.exists?current.data():null,currentRevision=prior?.revision||0;
   if(currentRevision!==expected)deny("failed-precondition","A newer school schedule exists. Reload before replacing it.");
   const rawText=rowsToText(rows),revision=currentRevision+1,now=FieldValue.serverTimestamp();
   if(current.exists){
     tx.create(ref.collection("revisions").doc(String(currentRevision)),{
      ...prior,archivedRevisionAt:now
     });
     tx.update(ref,{rows,rawText,revision,updatedAt:now});
   }else{
     tx.create(ref,{schoolId:ctx.schoolId,ownerUid:ctx.uid,schoolYear:year,semester:term,
      rows,rawText,revision,createdAt:now,updatedAt:now});
   }
   tx.create(db.collection(prefix+"planning_audit").doc(),{
    schoolId:ctx.schoolId,actorUid:ctx.uid,resourceId:id,
    action:"teacher_schedule_saved",schoolYear:year,semester:term,revision,createdAt:now
   });
   result={scheduleId:id,revision,rawText};
  });
  return result;
 };
}
module.exports={createSchoolScheduleService,normalizeRows,rowsToText,scheduleId,assignedPairs};
