// Firebase Cloud Functions v2. Requires separate Firebase deployment.
const {initializeApp}=require("firebase-admin/app");
const {getFirestore,FieldValue}=require("firebase-admin/firestore");
const {getAuth}=require("firebase-admin/auth");
const {onDocumentCreated,onDocumentUpdated}=require("firebase-functions/v2/firestore");
initializeApp();
const db=getFirestore();
const adminEmails=["babaynike2013@gmail.com"];
const teacherEmails=["josephsixson@mcstayuman.edu.ph"];
const staffEmails=[...adminEmails,...teacherEmails];
const reportAudience=data=>data.category==="Bug"?"admin":(data.recipientRole==="teacher"?"teacher":"admin");
const cleanId=value=>String(value||"").replace(/[^a-zA-Z0-9_-]/g,"_").slice(0,150);
async function byEmail(email){
  if(typeof email!=="string"||!email)return null;
  try{return (await getAuth().getUserByEmail(email.toLowerCase())).uid}
  catch(error){if(error.code!=="auth/user-not-found")console.warn("User resolution failed",error.code);return null}
}
async function staffIds(){return [...new Set((await Promise.all(staffEmails.map(byEmail))).filter(Boolean))]}
async function reportRecipients(audience){
  const emails=audience==="teacher"?teacherEmails:adminEmails;
  return [...new Set((await Promise.all(emails.map(byEmail))).filter(Boolean))];
}
async function notify(uid,id,item){
  if(!uid)return;
  const ref=db.doc("notifications/"+uid+"/items/"+cleanId(id));
  try{await ref.create({
    title:String(item.title||"Notification").slice(0,160),
    body:String(item.body||"").slice(0,300),type:item.type,
    recipientRole:item.type==="issue"?(item.recipientRole||"admin"):"general",
    sourceId:item.sourceId||null,target:item.target||"issues.html",
    createdAt:FieldValue.serverTimestamp(),readAt:null
  })}
  catch(error){if(error.code!==6&&error.code!=="already-exists")throw error}
}
async function notifyMany(uids,id,payload){
  await Promise.all([...new Set(uids.filter(Boolean))].map(uid=>notify(uid,id,payload)));
}
exports.issueOpened=onDocumentCreated("issues/{issueId}",async event=>{
  const data=event.data?.data();if(!data)return;
  const recipientRole=reportAudience(data);
  await notifyMany(await reportRecipients(recipientRole),"report_new_"+event.params.issueId,{
    type:"issue",recipientRole,title:"New issue report",body:data.title||"Untitled report",
    sourceId:event.params.issueId,target:"issues.html?issue="+event.params.issueId
  });
});
exports.issueStatusUpdated=onDocumentUpdated("issues/{issueId}",async event=>{
  const old=event.data?.before.data(),now=event.data?.after.data();
  if(!old||!now||old.status===now.status&&old.priority===now.priority)return;
  const recipientRole=reportAudience(now);
  // Bug and system tickets are admin-only notifications, including updates.
  if(recipientRole==="admin")return;
  const uid=now.reporterUid||await byEmail(now.reporterEmail);
  await notify(uid,"report_update_"+event.id,{
    type:"issue",recipientRole,title:"Your report was updated",
    body:(now.title||"Issue")+" · "+(now.status||"Open"),
    sourceId:event.params.issueId,target:"issues.html?issue="+event.params.issueId
  });
});
exports.issueCommentAdded=onDocumentCreated("issues/{issueId}/comments/{commentId}",async event=>{
  const comment=event.data?.data();if(!comment)return;
  const issue=await db.doc("issues/"+event.params.issueId).get();if(!issue.exists)return;
  const item=issue.data(),reporter=item.reporterUid||await byEmail(item.reporterEmail);
  const actor=comment.authorUid||await byEmail(comment.authorEmail);
  const recipientRole=reportAudience(item);
  const staff=await reportRecipients(recipientRole);
  const recipients=(recipientRole==="teacher"?staff.concat([reporter]):staff)
    .filter(uid=>uid!==actor);
  await notifyMany(recipients,"report_comment_"+event.params.commentId,{
    type:"issue",recipientRole,title:"New comment on a report",
    body:item.title||"Support report",sourceId:event.params.issueId,
    target:"issues.html?issue="+event.params.issueId
  });
});
exports.submissionReceived=onDocumentCreated("student_submissions/{submissionId}",async event=>{
  const item=event.data?.data();if(!item)return;
  await notifyMany(await staffIds(),"submission_"+event.params.submissionId,{
    type:"submission",title:"Student submitted work",
    body:(item.studentName||"Student")+" · "+(item.assessmentTitle||"Assessment"),
    sourceId:event.params.submissionId,target:"submissions.html"
  });
});
exports.gradePublished=onDocumentUpdated("student_grades/{gradeId}",async event=>{
  const old=event.data?.before.data(),now=event.data?.after.data();
  if(!old||!now||now.published!==true||old.published===true||!now.studentId)return;
  const student=await db.doc("students/"+now.studentId).get();if(!student.exists)return;
  const uid=await byEmail(student.data().email);
  await notify(uid,"grade_published_"+event.id,{
    type:"grade",title:"A reviewed grade is available",
    body:"Open your assessments to read the published feedback.",
    sourceId:event.params.gradeId,target:"student-assessments.html"
  });
});
exports.assessmentAssigned=onDocumentUpdated("assessments/{assessmentId}",async event=>{
  const old=event.data?.before.data(),now=event.data?.after.data();
  if(!old||!now)return;
  const previous=new Set((old.deployments||[]).map(d=>d.section));
  const added=[...new Set((now.deployments||[]).map(d=>d.section))].filter(x=>x&&!previous.has(x));
  for(const section of added){
    const students=await db.collection("students").where("section","==",section).get();
    const uids=await Promise.all(students.docs.map(d=>byEmail(d.data().email)));
    await notifyMany(uids,"assignment_"+event.params.assessmentId+"_"+cleanId(section),{
      type:"assessment",title:"New assessment assigned",
      body:now.title||"New assessment",sourceId:event.params.assessmentId,
      target:"student-assessments.html"
    });
  }
});

exports.gradingNeedsReview=onDocumentCreated("grading_alerts/{alertId}",async event=>{
  const item=event.data?.data();if(!item)return;
  await notifyMany(await staffIds(),"grading_"+event.params.alertId,{
    type:"grading",title:"Grading requires attention",
    body:(item.repository||"Repository")+" · "+(item.message||"Check failed"),
    sourceId:event.params.alertId,target:"repofetch.html"
  });
});

// Cover blueprints deployed at creation time, including older targetSections.
exports.assessmentCreated=onDocumentCreated("assessments/{assessmentId}",async event=>{
  const data=event.data?.data();if(!data)return;
  const sections=[...new Set([
    ...(Array.isArray(data.deployments)?data.deployments.map(d=>d.section):[]),
    ...(Array.isArray(data.targetSections)?data.targetSections:[])
  ].filter(Boolean))];
  for(const section of sections){
    const students=await db.collection("students").where("section","==",section).get();
    const uids=await Promise.all(students.docs.map(d=>byEmail(d.data().email)));
    await notifyMany(uids,"assignment_"+event.params.assessmentId+"_"+cleanId(section),{
      type:"assessment",title:"New assessment assigned",
      body:data.title||"New assessment",sourceId:event.params.assessmentId,
      target:"student-assessments.html"
    });
  }
});
// A small number of older workflows can create a grade already published.
exports.gradeCreatedPublished=onDocumentCreated("student_grades/{gradeId}",async event=>{
  const grade=event.data?.data();
  if(!grade||grade.published!==true||!grade.studentId)return;
  const student=await db.doc("students/"+grade.studentId).get();
  if(!student.exists)return;
  const uid=await byEmail(student.data().email);
  await notify(uid,"grade_created_"+event.params.gradeId,{
    type:"grade",title:"A reviewed grade is available",
    body:"Open your assessments to read published feedback.",
    sourceId:event.params.gradeId,target:"student-assessments.html"
  });
});
// Notify only when an already-published grade is actually corrected.
exports.gradeCorrection=onDocumentUpdated("student_grades/{gradeId}",async event=>{
  const before=event.data?.before.data(),after=event.data?.after.data();
  if(!before||!after||before.published!==true||after.published!==true)return;
  if(before.score===after.score && before.feedback===after.feedback)return;
  const student=await db.doc("students/"+after.studentId).get();
  if(!student.exists)return;
  const uid=await byEmail(student.data().email);
  await notify(uid,"grade_correction_"+event.id,{
    type:"grade",title:"Your published grade was updated",
    body:"Open Assessments to see the latest score and feedback.",
    sourceId:event.params.gradeId,target:"student-assessments.html"
  });
});
