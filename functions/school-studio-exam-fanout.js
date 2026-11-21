"use strict";
/**
 * Durable, retryable student notification and historical roster fanout.
 * The teacher's Open/Close transaction creates a single outbox record;
 * this handler runs separately from the teacher request. Replays are safe:
 * roster and recipient notification IDs are deterministic create-only docs.
 */
const {FieldValue}=require("firebase-admin/firestore");
const {writeSchoolNotification}=require("./school-notifications.js");
const {activeOfferingPeople}=require("./school-assessments.js");

function createSchoolStudioExamSessionFanout({db}){
 return async event=>{
  const schoolId=String(event.params?.schoolId||""),
    eventId=String(event.params?.eventId||""),
    data=event.data?.data();
  if(!data||data.schoolId!==schoolId||
     !/^[A-Za-z0-9_-]{1,128}$/.test(schoolId)||
     !/^(opened|closed)_[A-Za-z0-9_-]+_\d+$/.test(eventId)||
     !["opened","closed"].includes(data.kind)||
     !Number.isSafeInteger(data.sessionEpoch)||data.sessionEpoch<1)
   throw Error("Invalid Studio exam session outbox record.");
  const taskId=String(data.taskId||""),offeringId=String(data.offeringId||"");
  if(eventId!==data.kind+"_"+taskId+"_"+data.sessionEpoch||
     !/^[A-Za-z0-9_-]{1,128}$/.test(taskId)||!offeringId)
   throw Error("Studio exam outbox identity mismatch.");
  const prefix="schools/"+schoolId+"/";
  const task=await db.doc(prefix+"assessments/"+taskId).get();
  if(!task.exists||task.data().schoolId!==schoolId||
     task.data().offeringId!==offeringId)
   throw Error("Studio exam outbox references an invalid school deployment.");
  const people=await activeOfferingPeople(db,prefix,offeringId);
  if(data.kind==="closed"){
   // Snapshot best-effort roster near the close event; do not rebuild
   // historical reports from mutable future enrollments.
   const roster=people.map(person=>({
     personId:person.id,displayName:String(person.data().displayName||"Student").slice(0,140),
     studentUid:person.data().authUid||null
   }));
   const ref=db.doc(prefix+"studio_exam_session_rosters/"+taskId+
     "/sessions/"+data.sessionEpoch);
   try{
    await ref.create({schoolId,taskId,offeringId,sessionEpoch:data.sessionEpoch,
      students:roster,capturedAt:FieldValue.serverTimestamp(),
      captureSource:"exam_close_outbox"});
   }catch(error){
    if(error.code!==6&&error.code!=="already-exists")throw error;
   }
  }
  // A delayed opening notification must not announce availability after a
  // teacher closed or advanced the exam. Closing may still be notified while
  // its same session is closed, but not once a newer meeting has started.
  const current=task.data();
  const stillCurrent=Number(current.manualSessionEpoch||0)===data.sessionEpoch;
  const notify=stillCurrent&&(data.kind==="opened"?
    current.manualAccessState==="open"&&current.published===true:
    current.manualAccessState!=="open");
  let notified=0;
  if(notify){
   const recipients=[...new Set(people.map(person=>person.data().authUid).filter(Boolean))];
   for(let offset=0;offset<recipients.length;offset+=25){
    const batch=recipients.slice(offset,offset+25);
    // Deterministic notification IDs make partial replay safe.
    const results=await Promise.allSettled(batch.map(uid=>writeSchoolNotification({
      db,schoolId,uid,
      id:"studio_exam_"+data.kind+"_"+taskId+"_"+data.sessionEpoch,
      title:data.kind==="opened"?"Studio practical exam is open":"Studio exam session closed",
      body:data.kind==="opened"?
        String(data.title||"Practical exam").slice(0,130)+" · your teacher opened your section's exam.":
        "Exam session "+data.sessionEpoch+" has ended. Your editor is locked and the final project save is starting.",
      type:"assessment",sourceId:taskId,target:"student-assessments.html"
    })));
    for(const result of results){
     if(result.status==="rejected")throw result.reason;
     notified++;
    }
   }
  }
  await event.data.ref.set({
    status:"processed",processedAt:FieldValue.serverTimestamp(),
    activeStudents:people.length,notificationRecipients:notified,
    rosterCaptured:data.kind==="closed",notificationsSkippedAsStale:!notify
  },{merge:true});
 };
}
module.exports={createSchoolStudioExamSessionFanout};
