// Firebase Cloud Functions v2. Requires separate Firebase deployment.
const {initializeApp}=require("firebase-admin/app");
const {getFirestore,FieldValue}=require("firebase-admin/firestore");
const {getAuth}=require("firebase-admin/auth");
const {onDocumentCreated,onDocumentUpdated}=require("firebase-functions/v2/firestore");
initializeApp();
const db=getFirestore();
const staffEmails=["babaynike2013@gmail.com","josephsixson@mcstayuman.edu.ph"];
// Bug reports are always administrator-directed. Legacy reports have admin scope.
const reportAudience=issue=>issue.category==="Bug"?"admin":issue.audience==="teacher"?"teacher":"admin";
const isBugReport=issue=>issue.category==="Bug";
const audienceEmails=issue=>reportAudience(issue)==="admin"?[staffEmails[0]]:[staffEmails[1]];
const cleanId=value=>String(value||"").replace(/[^a-zA-Z0-9_-]/g,"_").slice(0,150);
async function byEmail(email){
  if(typeof email!=="string"||!email)return null;
  try{return (await getAuth().getUserByEmail(email.toLowerCase())).uid}
  catch(error){if(error.code!=="auth/user-not-found")console.warn("User resolution failed",error.code);return null}
}
async function teacherIds(){return [...new Set((await Promise.all(staffEmails.map(byEmail))).filter(Boolean))]}
async function audienceIds(issue){
  return [...new Set((await Promise.all(audienceEmails(issue).map(byEmail))).filter(Boolean))];
}
async function notify(uid,id,item){
  if(!uid)return;
  const ref=db.doc("notifications/"+uid+"/items/"+cleanId(id));
  try{await ref.create({
    title:String(item.title||"Notification").slice(0,160),
    body:String(item.body||"").slice(0,300),type:item.type,
    sourceId:item.sourceId||null,target:item.target||"issues.html",
    ...(item.reportCategory?{reportCategory:item.reportCategory}:{}),
    ...(item.reportAudience?{reportAudience:item.reportAudience}:{}),
    createdAt:FieldValue.serverTimestamp(),readAt:null
  })}
  catch(error){if(error.code!==6&&error.code!=="already-exists")throw error}
}
async function notifyMany(uids,id,payload){
  await Promise.all([...new Set(uids.filter(Boolean))].map(uid=>notify(uid,id,payload)));
}
exports.issueOpened=onDocumentCreated("issues/{issueId}",async event=>{
  const data=event.data?.data();if(!data)return;
  await notifyMany(await audienceIds(data),"report_new_"+event.params.issueId,{
    type:"issue",title:"New issue report",body:data.title||"Untitled report",
    sourceId:event.params.issueId,target:"issues.html?issue="+event.params.issueId,
    reportCategory:data.category,reportAudience:reportAudience(data)
  });
});
exports.issueStatusUpdated=onDocumentUpdated("issues/{issueId}",async event=>{
  const old=event.data?.before.data(),now=event.data?.after.data();
  if(!old||!now||old.status===now.status&&old.priority===now.priority)return;
  if(isBugReport(now))return;
  const uid=now.reporterUid||await byEmail(now.reporterEmail);
  await notify(uid,"report_update_"+event.id,{
    type:"issue",title:"Your report was updated",
    body:(now.title||"Issue")+" · "+(now.status||"Open"),
    sourceId:event.params.issueId,target:"issues.html?issue="+event.params.issueId,
    reportCategory:now.category,reportAudience:reportAudience(now)
  });
});
exports.issueCommentAdded=onDocumentCreated("issues/{issueId}/comments/{commentId}",async event=>{
  const comment=event.data?.data();if(!comment)return;
  const issue=await db.doc("issues/"+event.params.issueId).get();if(!issue.exists)return;
  const item=issue.data(),reporter=item.reporterUid||await byEmail(item.reporterEmail);
  const actor=comment.authorUid||await byEmail(comment.authorEmail);
  const recipients=(isBugReport(item)?await audienceIds(item):(await audienceIds(item)).concat([reporter])).filter(uid=>uid!==actor);
  await notifyMany(recipients,"report_comment_"+event.params.commentId,{
    type:"issue",title:"New comment on a report",
    body:item.title||"Support report",sourceId:event.params.issueId,
    target:"issues.html?issue="+event.params.issueId,
    reportCategory:item.category,reportAudience:reportAudience(item)
  });
});
// A reclaim never changes Git's recorded author. Administrators receive a
// private review alert; overlapping claims on the same SHA are flagged once.
exports.commitReclaimRequested=onDocumentCreated("commit_reclaims/{claimId}",async event=>{
  const claim=event.data?.data();if(!claim||claim.status!=="pending")return;
  const adminId=await byEmail(staffEmails[0]);
  if(!adminId)return;
  await notify(adminId,"reclaim_request_"+event.params.claimId,{
    type:"reclaim",title:"Commit reclaim requires verification",
    body:"Review an attribution correction for a student Git commit.",
    sourceId:event.params.claimId,target:"assessment-evidence-review.html?student="+
      encodeURIComponent(claim.studentId)+"&assessment="+encodeURIComponent(claim.assessmentId)
  });
  const claims=await db.collection("commit_reclaims").where("sha","==",claim.sha).get();
  const relevant=claims.docs.filter(d=>{
    const x=d.data();return x.repository===claim.repository&&
      ["pending","approved","shared"].includes(x.status);
  });
  // The Git-detected author is a provisional first attribution. If another
  // linked student currently uses that login, a new reclaim is potentially
  // disputed even when the detected author did not file an explicit claim.
  const detectedLogin=String(claim.detectedAuthorLogin||"").replace(/^@/,"").trim();
  let possibleOriginalStudents=[];
  if(detectedLogin&&/^[A-Za-z0-9-]{1,39}$/.test(detectedLogin)){
    const matches=await db.collection("students").where("githubUsername","==",detectedLogin)
      .limit(10).get();
    const canonical=value=>{
      let normalized=String(value||"").toLowerCase().trim();
      if(normalized.endsWith("/"))normalized=normalized.slice(0,-1);
      if(normalized.endsWith(".git"))normalized=normalized.slice(0,-4);
      return normalized;
    };
    possibleOriginalStudents=matches.docs.filter(d=>d.id!==claim.studentId&&
      canonical(d.data().repoUrl)===canonical(claim.repository)).map(d=>d.id);
  }
  if(relevant.length<2&&!possibleOriginalStudents.length)return;
  await db.doc("commit_claim_conflicts/"+claim.sha).set({
    sha:claim.sha,repository:claim.repository,
    claimIds:relevant.map(d=>d.id),claimCount:relevant.length,
    detectedAuthorLogin:detectedLogin,
    possibleOriginalStudentIds:possibleOriginalStudents,
    updatedAt:FieldValue.serverTimestamp()
  },{merge:true});
  await notify(adminId,"reclaim_conflict_"+claim.sha,{
    type:"reclaim",title:"Commit attribution dispute",
    body:"A reclaim overlaps another request or challenges a student linked to the detected Git author. Verify attribution before crediting.",
    sourceId:claim.sha,target:"assessment-evidence-review.html?student="+
      encodeURIComponent(claim.studentId)+"&assessment="+encodeURIComponent(claim.assessmentId)
  });
});

// V2 evidence receipts are distinct from legacy submission receipts.
exports.assessmentEvidenceSubmitted=onDocumentCreated("assessment_evidence/{evidenceId}",async event=>{
  const item=event.data?.data();
  if(!item||item.status!=="submitted"||item.source==="teacher_discovered")return;
  await notifyMany(await teacherIds(),"evidence_new_"+event.params.evidenceId,{
    type:"submission",title:"Assessment evidence submitted",
    body:"Selected Git commits are awaiting checkpoint verification.",
    sourceId:event.params.evidenceId,target:"submissions.html"
  });
});
exports.assessmentEvidenceUpdated=onDocumentUpdated("assessment_evidence/{evidenceId}",async event=>{
  const before=event.data?.before.data(),after=event.data?.after.data();
  if(!before||!after)return;
  if(before.status!=="approved"&&after.status==="approved"){
    if(!after.studentId)return;
    const student=await db.doc("students/"+after.studentId).get();
    if(!student.exists)return;
    const uid=await byEmail(student.data().email);
    await notify(uid,"evidence_review_"+event.id,{
      type:"submission",title:"Assessment checkpoint approved",
      body:"Your selected project revision has been verified. Grade publication is separate.",
      sourceId:event.params.evidenceId,target:"student-assessments.html"
    });
  }else if(before.status==="submitted"&&after.status==="submitted"&&
    before.submittedAt?.toMillis?.()!==after.submittedAt?.toMillis?.()){
    await notifyMany(await teacherIds(),"evidence_resubmitted_"+event.id,{
      type:"submission",title:"Assessment evidence updated",
      body:"A student selected a new revision for assessment review.",
      sourceId:event.params.evidenceId,target:"submissions.html"
    });
  }
});

exports.submissionReceived=onDocumentCreated("student_submissions/{submissionId}",async event=>{
  const item=event.data?.data();if(!item)return;
  await notifyMany(await teacherIds(),"submission_"+event.params.submissionId,{
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
  await notifyMany(await teacherIds(),"grading_"+event.params.alertId,{
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
