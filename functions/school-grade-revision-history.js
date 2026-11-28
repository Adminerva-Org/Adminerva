"use strict";
// Explicit allow-list: never return raw audit documents, private AI prompts,
// student code or unrelated account information.
const number=value=>typeof value==="number"&&Number.isFinite(value)?value:null;
const text=(value,max)=>typeof value==="string"?value.slice(0,max):"";
const timestamp=value=>{
 const n=value?.toMillis?.()??(typeof value==="string"?Date.parse(value):typeof value==="number"?value:NaN);
 return Number.isFinite(n)&&n>0?n:null;
};
function scoreState(value){
 if(!value||typeof value!=="object")return null;
 const status=value.status==="published"||value.published===true?"published":
   value.status==="draft"||value.published===false?"draft":null;
 return {awarded:number(value.awarded??value.score),total:number(value.total??value.maxScore),
   pending:number(value.pending),revision:number(value.revision??value.gradeVersion),
   status,feedback:typeof value.feedback==="string"?text(value.feedback,5000):null,
   criteria:Array.isArray(value.criteria)?value.criteria.slice(0,80).map(row=>({
     name:text(row?.name,300),maximum:number(row?.maximum??row?.maximumPoints),
     awarded:number(row?.awardedPoints),pending:number(row?.pendingPoints),comment:text(row?.comment,1000)
   })):null};
}
function legacyRevisionRows(docs,{schoolId,taskId,studentId,gradeId}){
 return docs.flatMap(doc=>{
   const row=doc.data();
   if(!row||row.gradeId!==gradeId||row.taskId!==taskId||row.studentId!==studentId||
     (row.schoolId&&row.schoolId!==schoolId))return [];
   const before=scoreState(row.before),after=scoreState(row.after);
   if(!before&&!after)return [];
   return [{id:doc.id,source:"historical",action:"historical_revision",at:timestamp(row.createdAt),
     actorUid:text(row.editorUid,128),note:text(row.reason,3000),
     before,after,evidenceVersion:number(row.evidenceRevision),
     checkpointReceiptId:text(row.checkpointReceiptId,500)}];
 }).sort((a,b)=>(b.at??0)-(a.at??0)||a.id.localeCompare(b.id));
}
function nativeRevisionRows(docs,{schoolId,taskId,studentUid,offeringId,personId}){
 const rows=docs.flatMap(doc=>{
   const row=doc.data();
   if(!row||row.schoolId!==schoolId||row.taskId!==taskId||row.studentUid!==studentUid||
      row.offeringId!==offeringId||row.personId!==personId||!Number.isInteger(row.revision)||row.revision<1||
      doc.id!==String(row.revision))return [];
   return [{id:doc.id,source:"native",action:text(row.action,80)||"grade_revision",at:timestamp(row.createdAt),
     actorUid:text(row.lastCorrectedByUid||row.publishedByUid||row.reviewerUid,128),
     note:text(row.correctionReason,2000),before:null,after:scoreState(row),
     evidenceVersion:number(row.submissionVersion),checkpointReceiptId:""}];
 }).sort((a,b)=>b.after.revision-a.after.revision);
 for(let i=0;i<rows.length-1;i++){
   if(rows[i].after.revision===rows[i+1].after.revision+1)rows[i].before=rows[i+1].after;
 }
 return rows;
}
async function readLegacyGradeHistory({db,schoolId,taskId,studentId,gradeId}){
 const page=await db.collection("grade_revisions").where("gradeId","==",gradeId).limit(201).get();
 if(page.size>=201)return {entries:[],limitReached:true};
 return {entries:legacyRevisionRows(page.docs,{schoolId,taskId,studentId,gradeId}),limitReached:false};
}
function activityRevisionRows(docs,{schoolId,taskId,studentId,gradeId}){
 const matches=value=>value&&value.taskId===taskId&&value.studentId===studentId&&(!value.schoolId||value.schoolId===schoolId);
 return docs.flatMap(doc=>{
   const row=doc.data();
   if(!row||!matches(row.after)||(row.schoolId&&row.schoolId!==schoolId)||
      (row.gradeId&&row.gradeId!==gradeId)||(row.taskId&&row.taskId!==taskId)||(row.studentId&&row.studentId!==studentId))return [];
   return [{id:doc.id,source:"historical",action:"activity_revision",at:timestamp(row.createdAt),
     actorUid:text(row.actorUid,128),note:"",before:matches(row.before)?scoreState(row.before):null,
     after:scoreState(row.after),evidenceVersion:null,checkpointReceiptId:""}];
 }).sort((a,b)=>(b.after.revision??0)-(a.after.revision??0)||(b.at??0)-(a.at??0));
}
module.exports={readLegacyGradeHistory,legacyRevisionRows,nativeRevisionRows,activityRevisionRows};
