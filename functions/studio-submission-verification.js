"use strict";
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");
const {rowKey,checkId}=require("./school-academics.js");
const {verifyFrozenSubmission}=require("./studio-auto-verification.js");
function deny(code,message){throw new TenantAccessError(code,message)}
function safeLegacyId(value,label){
 const text=String(value??"").trim();
 if(!text||text.length>512||text==="."||text===".."||text.includes("/")||/[\u0000-\u001f\u007f]/.test(text))
  deny("invalid-argument",label+" is invalid.");
 return text;
}
async function legacyAuthorized({db,request,assessment,submission}){
 const uid=request.auth?.uid,email=String(request.auth?.token?.email||"").toLowerCase().trim();
 if(!uid||request.auth?.token?.email_verified!==true||!email)
  deny("unauthenticated","Use a verified staff account.");
 if(assessment.ownerUid===uid)return true;
 const access=await db.doc("staff_access/"+email).get(),data=access.exists?access.data():null;
 if(data?.status==="active"&&data.role==="admin")return true;
 if(data?.status==="active"&&data.role==="teacher"&&Array.isArray(data.sections)&&
    data.sections.includes(submission.section))return true;
 deny("permission-denied","You are not authorized to verify this historical Studio submission.");
}
function createStudioSubmissionVerificationService({db}){
 return async request=>{
  const input=request.data||{};
  if(input.action==="verify_legacy"){
   const submissionId=safeLegacyId(input.submissionId,"Submission"),
    revision=Number(input.revision);
   if(!Number.isInteger(revision)||revision<1||revision>30)
    deny("invalid-argument","Submission revision is invalid.");
   const headRef=db.doc("studio_submissions/"+submissionId),head=await headRef.get();
   if(!head.exists)deny("not-found","Historical Studio submission unavailable.");
   const submission=head.data()||{},assessmentId=safeLegacyId(submission.assessmentId,"Assessment"),
    assessment=await db.doc("assessments/"+assessmentId).get();
   if(!assessment.exists)deny("not-found","Historical assessment unavailable.");
   await legacyAuthorized({db,request,assessment:assessment.data(),submission});
   if(Number(submission.revision)<revision)
    deny("failed-precondition","That frozen revision is not available.");
   const versionRef=headRef.collection("versions").doc(String(revision)),version=await versionRef.get();
   if(!version.exists)deny("not-found","Frozen Studio revision unavailable.");
   const data=version.data()||{};
   let snapshot;try{snapshot=JSON.parse(String(data.snapshotJson||""));}catch{
    deny("failed-precondition","Frozen Studio snapshot is malformed.");
   }
   if(data.assessmentId!==assessmentId||data.studentId!==submission.studentId||
      Number(data.revision)!==revision||data.snapshotHash!==submission.snapshotHash&&revision===Number(submission.revision))
    deny("failed-precondition","Historical submission metadata does not match its frozen revision.");
   const verification=await verifyFrozenSubmission({
    snapshot:{...snapshot,sourceLanguage:snapshot.lang},task:assessment.data()
   });
   await versionRef.set({verification},{merge:true});
   return {submissionId,revision,verification};
  }
  if(input.action==="verify_school"){
   const ctx=await getSchoolContext({db,request,schoolId:input.schoolId,roles:["teacher"]}),
    taskId=checkId(input.taskId,"Assessment task",128),
    submissionId=checkId(input.submissionId,"Studio submission",128),
    version=Number(input.version),prefix="schools/"+ctx.schoolId+"/";
   if(!Number.isInteger(version)||version<1||version>100)
    deny("invalid-argument","Submission version is invalid.");
   const [task,submission]=await Promise.all([
    db.doc(prefix+"assessments/"+taskId).get(),
    db.doc(prefix+"studio_submissions/"+submissionId).get()
   ]);
   if(!task.exists||task.data().schoolId!==ctx.schoolId||
      (!ctx.platformOverride&&(task.data().reviewerUid||task.data().ownerUid)!==ctx.uid))
    deny("permission-denied","Only the responsible teacher may verify this assessment submission.");
   if(!submission.exists||submission.data().schoolId!==ctx.schoolId||
      submission.data().taskId!==taskId)
    deny("not-found","Studio submission unavailable.");
   if(!ctx.platformOverride){
    const grant=await db.doc(prefix+"staff_assignments/"+rowKey(ctx.uid,task.data().offeringId)).get();
    if(!grant.exists||grant.data().status!=="active"||grant.data().teacherUid!==ctx.uid)
     deny("permission-denied","Your active teaching assignment is required.");
   }
   const versionRef=db.doc(prefix+"studio_submissions/"+submissionId+"/versions/"+version),
    snapshot=await versionRef.get();
   if(!snapshot.exists)deny("not-found","Frozen Studio version unavailable.");
   const data=snapshot.data()||{};
   if(data.taskId!==taskId||Number(data.version)!==version)
    deny("failed-precondition","Frozen Studio version does not match this assessment.");
   const verification=await verifyFrozenSubmission({snapshot:data,task:task.data()});
   await versionRef.set({verification},{merge:true});
   return {submissionId,version,verification};
  }
  deny("invalid-argument","Unknown Studio verification action.");
 };
}
module.exports={createStudioSubmissionVerificationService};
