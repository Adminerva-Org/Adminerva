"use strict";
// Transcribed previous-school evidence is not a local Class Record and must
// never create or modify local grades, placements, or enrollment records.
const {FieldValue,FieldPath}=require("firebase-admin/firestore");
const {createHash}=require("node:crypto");
const {TenantAccessError}=require("./tenant-access.js");
const ACTIONS=new Set(["list_external_academic_records","save_external_academic_record","review_external_academic_record"]);
function deny(code,message){throw new TenantAccessError(code,message);}
function id(value){if(typeof value!=="string"||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value))deny("invalid-argument","Invalid record identifier.");return value;}
function text(value,label,max,required=true){
  const out=typeof value==="string"?value.trim():"";
  if((required&&!out)||out.length>max)deny("invalid-argument","Review "+label+".");
  return out;
}
function externalRecordDetails(input){
  const sourceSchool=text(input.sourceSchool,"previous school",180),schoolYear=text(input.schoolYear,"source academic year",80),
    gradeLevel=text(input.gradeLevel,"source grade level",60),period=text(input.period,"source academic period",80),
    sourceReference=text(input.sourceReference,"external source reference",150);
  if(!Array.isArray(input.results)||!input.results.length||input.results.length>30)deny("invalid-argument","Record 1 to 30 subject results exactly as shown on the source record.");
  const seen=new Set();
  const results=input.results.map(row=>{
    const subject=text(row?.subject,"source subject",150),result=text(row?.result,"source result",40),key=subject.toLowerCase();
    if(seen.has(key))deny("invalid-argument","Source subject names must be unique within the selected source period.");
    seen.add(key);return {subject,result};
  });
  return {sourceSchool,schoolYear,gradeLevel,period,sourceReference,results};
}
function externalKey(personId,details){
  return createHash("sha256").update(JSON.stringify([personId,...["sourceSchool","schoolYear","gradeLevel","period"].map(field=>details[field].trim().toLowerCase())])).digest("hex");
}
function externalView(doc){
  const row=doc.data();return {recordId:doc.id,personId:row.personId,sourceSchool:row.sourceSchool,schoolYear:row.schoolYear,
    gradeLevel:row.gradeLevel,period:row.period,sourceReference:row.sourceReference,results:row.results||[],
    state:row.state||"recorded",revision:Number(row.revision)||1,reviewReason:row.reviewReason||"",
    updatedAt:row.updatedAt?.toMillis?.()||null};
}
async function externalAcademicAction({db,ctx,input,requireMembership,student}){
  await requireMembership(ref=>ref.get());
  const root="schools/"+ctx.schoolId+"/",personId=id(input.personId),person=await student(personId),
    collection=db.collection(root+"student_external_academic_records");
  if(input.action==="list_external_academic_records"){
    const cursor=input.cursor?id(input.cursor):null,pageSize=20;
    let query=collection.where("personId","==",personId).orderBy(FieldPath.documentId()).limit(pageSize+1);
    if(cursor)query=query.startAfter(cursor);
    const snap=await query.get(),page=snap.docs.slice(0,pageSize);
    return {items:page.filter(doc=>doc.data().schoolId===ctx.schoolId&&doc.data().personId===personId).map(externalView),
      nextCursor:snap.size>pageSize?page.at(-1).id:null};
  }
  const reason=text(input.reason,"review or correction reason",500),expected=input.expectedRevision;
  if(reason.length<8||!Number.isSafeInteger(expected)||expected<0)deny("invalid-argument","Refresh the record and enter a review reason.");
  const details=input.action==="save_external_academic_record"?externalRecordDetails(input.details||{}):null;
  const recordId=details?externalKey(personId,details):id(input.recordId),ref=collection.doc(recordId);
  if(details&&input.recordId&&input.recordId!==recordId)deny("failed-precondition","Source school, year, grade and period identify this evidence. Record corrections to a different source as a new record; archive the incorrect record.");
  let result;
  await db.runTransaction(async tx=>{
    await requireMembership(r=>tx.get(r));
    const [currentStudent,current]=await Promise.all([tx.get(person.ref),tx.get(ref)]);
    if(!currentStudent.exists||currentStudent.data().schoolId!==ctx.schoolId||currentStudent.data().kind!=="student"||
       !["active","archived"].includes(currentStudent.data().status))deny("failed-precondition","The student record changed.");
    const prior=current.exists?current.data():null;
    if(prior&&(prior.schoolId!==ctx.schoolId||prior.personId!==personId))deny("data-loss","External evidence ownership mismatch.");
    if((Number(prior?.revision)||0)!==expected)deny("failed-precondition","External academic record changed. Refresh before saving.");
    const now=FieldValue.serverTimestamp(),revision=expected+1;
    let update,action;
    if(input.action==="save_external_academic_record"){
      if(prior?.state==="archived")deny("failed-precondition","Restore the archived evidence before correcting it.");
      update={...details,state:"recorded",reviewReason:null,verifiedAt:null,verifiedByUid:null};
      action=prior?"external_academic_record_corrected":"external_academic_record_created";
    }else if(input.action==="review_external_academic_record"){
      if(!prior)deny("not-found","External academic record not found.");
      const next=String(input.state||""),transitions={recorded:["verified","archived"],verified:["recorded","archived"],archived:["recorded"]};
      if(!transitions[prior.state]?.includes(next))deny("failed-precondition","The external record cannot move to that state.");
      if(next==="verified"&&input.confirmSourceReviewed!==true)deny("invalid-argument","Confirm that an authentic previous-school source was reviewed.");
      update={state:next,reviewReason:reason,verifiedAt:next==="verified"?now:null,verifiedByUid:next==="verified"?ctx.uid:null};
      action="external_academic_record_"+next;
    }else deny("invalid-argument","Unknown external academic record action.");
    const payload={...update,schoolId:ctx.schoolId,personId,revision,updatedAt:now,updatedByUid:ctx.uid};
    if(prior)tx.update(ref,payload);else tx.create(ref,{...payload,createdAt:now,createdByUid:ctx.uid});
    // Immutable institutional evidence history; local grades are never touched.
    const historical={...(prior||{}),...payload};
    delete historical.createdAt;delete historical.updatedAt;delete historical.verifiedAt;
    tx.create(ref.collection("revisions").doc(String(revision)),{...historical,actorUid:ctx.uid,changeReason:reason,createdAt:now});
    tx.create(db.collection(root+"student_records_audit").doc(),{schoolId:ctx.schoolId,personId,actorUid:ctx.uid,
      action,externalRecordId:recordId,revision,reason,createdAt:now});
    result={recordId,revision,state:update.state};
  });
  return result;
}
module.exports={ACTIONS,externalAcademicAction,externalRecordDetails,externalKey,externalView};
