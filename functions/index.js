/** Cloud Functions v2 notifications and opt-in monitoring maintenance; deployment requires explicit separate approval. */
// Firebase Cloud Functions v2. Requires separate Firebase deployment.
const {initializeApp}=require("firebase-admin/app");
const {getFirestore,FieldValue,Timestamp}=require("firebase-admin/firestore");
const {getAuth}=require("firebase-admin/auth");
const {getMessaging}=require("firebase-admin/messaging");
const {onDocumentCreated,onDocumentUpdated,onDocumentWritten}=require("firebase-functions/v2/firestore");
const {onSchedule}=require("firebase-functions/v2/scheduler");
const {onCall,HttpsError}=require("firebase-functions/v2/https");
const {setGlobalOptions}=require("firebase-functions/v2");
setGlobalOptions({region:"asia-southeast1"});
const {createPracticeService,PracticeError}=require("./practice-service.js");
const {createTeachingAccessService}=require("./teaching-access-service.js");
const {createMonitoringService}=require("./monitoring-service.js");
initializeApp();
const db=getFirestore();
const messaging=getMessaging();
const practice=createPracticeService({db,Timestamp,resolveUser:uid=>getAuth().getUser(uid)});
const teachingAccess=createTeachingAccessService({db,Timestamp});
const {createSchoolAI}=require("./school-ai-service.js");
const schoolAI=createSchoolAI({db,FieldValue,Timestamp,resolveUser:uid=>getAuth().getUser(uid)});
const {createLegacyLessonRecovery,createLegacySchoolSetup}=require("./legacy-lessons.js");
const legacyRecovery=createLegacyLessonRecovery({db,FieldValue,resolveUserByEmail:email=>getAuth().getUserByEmail(email)});
const legacySetup=createLegacySchoolSetup({db,FieldValue,resolveUserByEmail:email=>getAuth().getUserByEmail(email)});
const callOptions={region:"asia-southeast1",maxInstances:3,concurrency:10,timeoutSeconds:120,cors:["https://adminerva-org.github.io","https://reporeview-e7ca4.web.app","https://reporeview-e7ca4.firebaseapp.com"]};
function safeCallable(handler){return async request=>{try{return await handler(request);}catch(error){const allowed=["unauthenticated","permission-denied","invalid-argument","failed-precondition","resource-exhausted","unavailable","not-found","already-exists"];if(allowed.includes(error.code))throw new HttpsError(error.code,error.message);console.error("Staff request failed",{code:error.code||"internal"});throw new HttpsError("unavailable","This request could not finish. Your existing work is preserved; retry shortly.");}};}
exports.schoolAI=onCall(callOptions,safeCallable(schoolAI));
exports.legacyLessonRecovery=onCall(callOptions,safeCallable(legacyRecovery));
exports.legacySchoolSetup=onCall(callOptions,safeCallable(legacySetup));
exports.pushTestPing=onCall(callOptions,async request=>{
  const uid=request.auth?.uid;
  if(!uid)throw new HttpsError("unauthenticated","Sign in before sending a test notification.");
  const devices=await db.collection("push_devices").where("ownerUid","==",uid).limit(12).get();
  const active=devices.docs.filter(device=>device.data()?.enabled===true&&typeof device.data()?.token==="string"&&device.data().token);
  if(!active.length)throw new HttpsError("failed-precondition","No enabled Adminerva push devices are registered for this account.");
  let sent=0;
  await Promise.all(active.map(async device=>{
    try{
      await messaging.send({
        token:device.data().token,
        data:{
          adminervaKind:"test_ping",
          title:"Adminerva test notification",
          body:"Push notifications are working on this device.",
          target:pushBaseUrl+"student-settings.html#notifications",
          autoCloseMs:"15000"
        },
        webpush:{headers:{TTL:"60",Urgency:"high"}}
      });
      sent++;
    }catch(error){
      if(["messaging/registration-token-not-registered","messaging/invalid-registration-token"].includes(error.code))
        await device.ref.delete().catch(()=>{});
      else console.warn("Test push delivery failed",{uid,code:error.code||"unknown"});
    }
  }));
  if(!sent)throw new HttpsError("unavailable","No registered device accepted the test notification. Re-enable notifications on a device and try again.");
  return {sent};
});
exports.teachingRosterChanged=onDocumentWritten({document:"students/{studentId}",region:"asia-southeast1",maxInstances:2,concurrency:10},event=>teachingAccess.synchronize(event.params.studentId));
const practiceOptions={region:"asia-southeast1",maxInstances:3,concurrency:20,timeoutSeconds:30,
  cors:["https://adminerva-org.github.io","https://reporeview-e7ca4.web.app","https://reporeview-e7ca4.firebaseapp.com"]};
for(const [name,action] of Object.entries({practiceSession:"acquire",practiceStart:"start",practicePredict:"predict",practiceComplete:"complete",practiceHub:"hub",practiceSeasonSession:"acquireSeason",practiceMissionStart:"startSeason",practiceMissionSubmit:"submitSeason",practicePreferences:"preferences"}))
  exports[name]=onCall(practiceOptions,async request=>{
    try{return await practice[action](request);}
    catch(error){
      if(error instanceof PracticeError)throw new HttpsError(error.code,error.message,error.details);
      console.error("Practice request failed",{action,code:error.code||"internal"});
      throw new HttpsError("unavailable","Practice could not complete this request. Your score has not been published; retry the same challenge safely.");
    }
  });
const monitoring=createMonitoringService({db,Timestamp,FieldValue,resolveUsers:async uids=>(await getAuth().getUsers(uids.map(uid=>({uid})))).users});
exports.monitoringMaintenance=onSchedule({region:"asia-southeast1",schedule:"every 60 minutes",timeZone:"Etc/UTC",timeoutSeconds:240,maxInstances:1,concurrency:1,retryCount:0},()=>monitoring.runScheduled());
exports.activityConsentChanged=onDocumentWritten({document:"activity_preferences/{ownerUid}",region:"asia-southeast1",maxInstances:1,concurrency:1,timeoutSeconds:120},event=>monitoring.applyConsentChange(event.params.ownerUid,event.data?.before.data()?.studentId));
const staffEmails=["babaynike2013@gmail.com","josephsixson@mcstayuman.edu.ph"];
// Bug reports are always administrator-directed. Legacy reports have admin scope.
const reportAudience=issue=>issue.category==="Bug"?"admin":issue.audience==="teacher"?"teacher":"admin";
const isBugReport=issue=>issue.category==="Bug";
const cleanId=value=>String(value||"").replace(/[^a-zA-Z0-9_-]/g,"_").slice(0,150);
async function byEmail(email){
  if(typeof email!=="string"||!email)return null;
  try{return (await getAuth().getUserByEmail(email.toLowerCase())).uid}
  catch(error){if(error.code!=="auth/user-not-found")console.warn("User resolution failed",error.code);return null}
}
async function teacherIds(section){
  const administrator=await byEmail(staffEmails[0]);
  if(typeof section!=="string"||!section)return [administrator].filter(Boolean);
  const records=await db.collection("staff_access").where("sections","array-contains",section).get();
  const emails=records.docs.map(record=>record.data()).filter(record=>record.role==="teacher"&&record.status==="active").map(record=>record.email);
  return [...new Set([administrator,...await Promise.all(emails.map(byEmail))].filter(Boolean))];
}
async function audienceIds(issue){
  return reportAudience(issue)==="admin"?[await byEmail(staffEmails[0])].filter(Boolean):teacherIds(issue.section);
}
const pushTypes=new Set(["assessment","submission","grade"]);
const pushBaseUrl="https://adminerva-org.github.io/Adminerva/";
function pushTarget(target){
  const value=String(target||"").trim();
  return /^[A-Za-z0-9_.-]+[.]html(?:[?][^#\\s]*)?$/.test(value)?pushBaseUrl+value:pushBaseUrl+"student-home.html";
}
async function pushAllowed(uid,type){
  if(!pushTypes.has(String(type||"")))return false;
  const snapshot=await db.doc("push_preferences/"+uid).get();
  if(!snapshot.exists)return true;
  const data=snapshot.data()||{};
  return data.enabled!==false&&data[type]!==false;
}
async function pushToUser(uid,item){
  if(!uid||item.push!==true||!await pushAllowed(uid,item.type))return;
  const devices=await db.collection("push_devices").where("ownerUid","==",uid).limit(12).get();
  if(devices.empty)return;
  await Promise.all(devices.docs.map(async device=>{
    const data=device.data(),token=String(data.token||"");
    if(data.enabled!==true||!token)return;
    try{
      await messaging.send({
        token,
        notification:{title:String(item.title||"Adminerva").slice(0,160),body:String(item.body||"").slice(0,300)},
        webpush:{
          notification:{
            icon:pushBaseUrl+"assets/New%20Adminerva%20logo.png",
            badge:pushBaseUrl+"assets/adminerva-notification-badge.png"
          },
          fcmOptions:{link:pushTarget(item.target)}
        }
      });
    }catch(error){
      if(["messaging/registration-token-not-registered","messaging/invalid-registration-token"].includes(error.code)){
        await device.ref.delete().catch(()=>{});
        return;
      }
      console.warn("Push delivery failed",{uid,code:error.code||"unknown"});
    }
  }));
}
async function notify(uid,id,item){
  if(!uid)return;
  const ref=db.doc("notifications/"+uid+"/items/"+cleanId(id));
  let created=false;
  try{
    await ref.create({
      title:String(item.title||"Notification").slice(0,160),
      body:String(item.body||"").slice(0,300),type:item.type,
      sourceId:item.sourceId||null,target:item.target||"issues.html",
      ...(item.reportCategory?{reportCategory:item.reportCategory}:{}),
      ...(item.reportAudience?{reportAudience:item.reportAudience}:{}),
      createdAt:FieldValue.serverTimestamp(),readAt:null
    });
    created=true;
  }catch(error){if(error.code!==6&&error.code!=="already-exists")throw error}
  if(created)await pushToUser(uid,item).catch(error=>console.warn("Push fan-out skipped",{uid,code:error.code||"unknown"}));
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
  await notifyMany(await teacherIds(item.section),"evidence_new_"+event.params.evidenceId,{
    type:"submission",title:"Assessment evidence submitted",
    body:"Selected Git commits are awaiting checkpoint verification.",
    sourceId:event.params.evidenceId,target:"submissions.html"
  });
});
exports.assessmentEvidenceUpdated=onDocumentUpdated("assessment_evidence/{evidenceId}",async event=>{
  const before=event.data?.before.data(),after=event.data?.after.data();
  if(!before||!after)return;
  if(before.status!=="reopened"&&after.status==="reopened"){
    if(!after.studentId)return;
    const [student,assessment]=await Promise.all([
      db.doc("students/"+after.studentId).get(),
      after.assessmentId?db.doc("assessments/"+after.assessmentId).get():Promise.resolve(null)
    ]);
    if(!student.exists)return;
    const uid=await byEmail(student.data().email);
    const assessmentTitle=assessment?.exists?(assessment.data().title||"Assessment"):"Assessment";
    const reason=String(after.reopenReason||"Your teacher requested a new evidence selection.").trim();
    await notify(uid,"evidence_reopened_"+event.params.evidenceId+"_"+String(after.revision||0),{
      type:"submission",push:true,title:"Submission returned — changes required",
      body:(assessmentTitle+" · "+reason+" Update your evidence and resubmit.").slice(0,300),
      sourceId:event.params.evidenceId,target:"student-assessments.html"
    });
  }else if(before.status!=="approved"&&after.status==="approved"){
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
    await notifyMany(await teacherIds(after.section),"evidence_resubmitted_"+event.id,{
      type:"submission",title:"Assessment evidence updated",
      body:"A student selected a new revision for assessment review.",
      sourceId:event.params.evidenceId,target:"submissions.html"
    });
  }
});

exports.submissionReceived=onDocumentCreated("student_submissions/{submissionId}",async event=>{
  const item=event.data?.data();if(!item)return;
  await notifyMany(await teacherIds(item.section),"submission_"+event.params.submissionId,{
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
    type:"grade",push:true,title:"A reviewed grade is available",
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
      type:"assessment",push:true,title:"New assessment assigned",
      body:now.title||"New assessment",sourceId:event.params.assessmentId,
      target:"student-assessments.html"
    });
  }
});

exports.gradingNeedsReview=onDocumentCreated("grading_alerts/{alertId}",async event=>{
  const item=event.data?.data();if(!item)return;
  await notifyMany(await teacherIds(item.section),"grading_"+event.params.alertId,{
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
      type:"assessment",push:true,title:"New assessment assigned",
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
    type:"grade",push:true,title:"A reviewed grade is available",
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
    type:"grade",push:true,title:"Your published grade was updated",
    body:"Open Assessments to see the latest score and feedback.",
    sourceId:event.params.gradeId,target:"student-assessments.html"
  });
});
