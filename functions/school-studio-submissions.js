"use strict";
/**
 * Student Studio assessment handoff with immutable server-frozen versions.
 * Independent of live 3.0 Studio/Gradebook until the tenant cutover.
 */
const {createHash}=require("node:crypto");
const {FieldValue,Timestamp}=require("firebase-admin/firestore");
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");
const {rowKey,checkId}=require("./school-academics.js");
const {digestProject,digestSource}=require("./school-studio-projects.js");
const {writeSchoolNotification}=require("./school-notifications.js");
const {studentAccountUids,studentRecordUidAllowed}=require("./student-account-history.js");
function deny(code,message){throw new TenantAccessError(code,message)}
const hash=(...values)=>createHash("sha256").update(JSON.stringify(values)).digest("hex");
function createSchoolStudioSubmissionService({db}){
 return async request=>{
  const input=request.data||{},ctx=await getSchoolContext({db,request,schoolId:input.schoolId});
  const taskId=checkId(input.taskId,"Assessment task",128);
  const prefix="schools/"+ctx.schoolId+"/";
  const taskRef=db.doc(prefix+"assessments/"+taskId);
  const schoolRef=db.doc("platform_schools/"+ctx.schoolId);
  const membershipRef=db.doc(prefix+"memberships/"+ctx.uid);
  const submissions=db.collection(prefix+"studio_submissions");
  async function verifySchool(tx,role){
   if(ctx.platformOverride&&role==="teacher")return {roles:["teacher"],status:"active"};
   const [school,member]=await Promise.all([tx.get(schoolRef),tx.get(membershipRef)]);
   if(!school.exists||!["active","pilot"].includes(school.data().state)||!member.exists||
      member.data().status!=="active"||member.data().schoolId!==ctx.schoolId||
      !Array.isArray(member.data().roles)||!member.data().roles.includes(role))
    deny("permission-denied","School membership changed. Refresh access before continuing.");
   return member.data();
  }
  const task=await taskRef.get();
  if(!task.exists||task.data().schoolId!==ctx.schoolId||
     task.data().submissionSource!=="studio"||task.data().status!=="deployed")
   deny("not-found","This school's Studio assessment is unavailable.");
  const offeringId=task.data().offeringId;
  if(["submit","my_status","my_snapshot"].includes(input.action)){
   if(!ctx.roles.includes("student"))deny("permission-denied","Student permission is required.");
   if(task.data().published!==true)
    deny("not-found","This Studio assessment is not published to students.");
   const membership=await membershipRef.get();
   const personId=membership.data()?.personId;
   if(typeof personId!=="string")deny("failed-precondition","Link your verified school person record before submitting.");
   checkId(personId,"Person ID",128);
   const personRef=db.doc(prefix+"people/"+personId);
   const enrollmentRef=db.doc(prefix+"enrollments/"+rowKey(personId,offeringId));
   const currentSubmissionId=hash(ctx.schoolId,taskId,ctx.uid),
     currentSubmissionRef=submissions.doc(currentSubmissionId);
   async function resolveStudentSubmission(personData,read=ref=>ref.get()){
    const candidates=studentAccountUids(personData,ctx.uid).map(uid=>{
      const submissionId=hash(ctx.schoolId,taskId,uid);
      return {uid,submissionId,ref:submissions.doc(submissionId)};
    }),docs=await Promise.all(candidates.map(row=>read(row.ref))),
      existing=candidates.map((row,index)=>({...row,doc:docs[index]})).filter(row=>row.doc.exists);
    for(const row of existing){
      const data=row.doc.data();
      if(data.schoolId!==ctx.schoolId||data.taskId!==taskId||data.offeringId!==offeringId||
         data.personId!==personId||!studentRecordUidAllowed(personData,ctx.uid,data.studentUid))
       deny("data-loss","A Studio submission in this recovered account history does not match the canonical student.");
    }
    if(existing.length>1)
     deny("failed-precondition","Multiple Studio submissions exist for this assessment across recovered accounts. Ask an administrator to reconcile them.");
    return existing[0]||{uid:ctx.uid,submissionId:currentSubmissionId,ref:currentSubmissionRef,doc:docs[0]};
   }
   async function resolveStudentProject(personData,projectId,read=ref=>ref.get()){
    const candidates=studentAccountUids(personData,ctx.uid).map(uid=>({
      uid,ref:db.doc(prefix+"student_code_projects/"+uid+"/projects/"+projectId)
    })),docs=await Promise.all(candidates.map(row=>read(row.ref))),
      existing=candidates.map((row,index)=>({...row,doc:docs[index]})).filter(row=>row.doc.exists);
    for(const row of existing){
      const data=row.doc.data();
      if(data.schoolId!==ctx.schoolId||data.ownerUid!==row.uid||
         !studentRecordUidAllowed(personData,ctx.uid,data.ownerUid))
       deny("data-loss","A Studio project in this recovered account history does not match the canonical student.");
    }
    if(existing.length>1)
     deny("data-loss","Multiple Studio projects share this project ID across recovered accounts.");
    return existing[0]||null;
   }
   if(input.action==="my_status"){
    const [person,enrollment]=await Promise.all([personRef.get(),enrollmentRef.get()]);
    if(!person.exists||person.data().schoolId!==ctx.schoolId||
      person.data().authUid!==ctx.uid||person.data().kind!=="student"||
      !enrollment.exists||enrollment.data().schoolId!==ctx.schoolId||
      enrollment.data().personId!==personId||enrollment.data().offeringId!==offeringId)
     deny("permission-denied","You do not have a verified enrollment in this course.");
    const located=await resolveStudentSubmission(person.data()),submission=located.doc;
    return {taskId,submitted:submission.exists,
      status:submission.exists?submission.data().status:"not_submitted",
      version:submission.exists?submission.data().currentVersion:0,
      variantId:submission.exists?submission.data().variantId||"":"" ,
      revisionRequested:submission.exists&&submission.data().status==="reopened",
      requestMessage:submission.exists&&submission.data().status==="reopened"?
       submission.data().revisionRequestMessage||"":"",
      revisionDueAt:submission.exists&&submission.data().status==="reopened"?
       submission.data().revisionDueAt?.toMillis?.()||null:null};
   }
   if(input.action==="my_snapshot"){
    // A student may retrieve only their own latest immutable submission after
    // verifying current school membership and enrollment. This is a recovery
    // source, never a substitute for or mutation of the working project.
    const [school,member,person,enrollment]=await Promise.all([
      schoolRef.get(),membershipRef.get(),personRef.get(),enrollmentRef.get()
    ]);
    if(!school.exists||!["active","pilot"].includes(school.data().state)||
       !member.exists||member.data().status!=="active"||
       member.data().schoolId!==ctx.schoolId||
       !Array.isArray(member.data().roles)||!member.data().roles.includes("student")||
       member.data().personId!==personId||
       !person.exists||person.data().schoolId!==ctx.schoolId||
       person.data().authUid!==ctx.uid||person.data().kind!=="student"||
       person.data().status!=="active"||
       !enrollment.exists||enrollment.data().schoolId!==ctx.schoolId||
       enrollment.data().personId!==personId||enrollment.data().offeringId!==offeringId||
       enrollment.data().status!=="active")
      deny("permission-denied","Student school membership or enrollment could not be verified for recovery.");
    const located=await resolveStudentSubmission(person.data()),submission=located.doc,
      submissionRef=located.ref;
    if(task.data().manualOpenRequired===true&&
       (task.data().manualAccessState!=="open"||
        (task.data().lifecycle||"active")!=="active"))
      deny("failed-precondition","Your teacher must open this section's exam before you can restore submitted project source.");
    if(!submission.exists)return {taskId,found:false};
    const current=submission.data(),version=Number(current.currentVersion);
    if(current.schoolId!==ctx.schoolId||
       !studentRecordUidAllowed(person.data(),ctx.uid,current.studentUid)||
       current.personId!==personId||current.offeringId!==offeringId||
       current.taskId!==taskId||!Number.isInteger(version)||version<1)
      deny("failed-precondition","The submitted project recovery reference is invalid.");
    const frozen=await submissionRef.collection("versions").doc(String(version)).get();
    const data=frozen.exists?frozen.data():null;
    if(!data||data.schoolId!==ctx.schoolId||
       !studentRecordUidAllowed(person.data(),ctx.uid,data.studentUid)||
       data.personId!==personId||data.taskId!==taskId||data.offeringId!==offeringId||
       data.version!==version||data.projectId!==current.projectId||
       !Array.isArray(data.files)||!data.files.length||
       data.contentDigest!==digestProject(data.files,data.artifacts||{})||
       current.contentDigest!==data.contentDigest)
      deny("failed-precondition","The submitted project recovery snapshot could not be verified.");
    // Do not expose private teacher evaluation notes or another learner's
    // scenario. Return only the student's submitted source and artifacts.
    return {taskId,found:true,version,projectId:data.projectId,
      language:data.sourceLanguage,files:data.files,artifacts:data.artifacts||{},
      contentDigest:data.contentDigest,submittedAt:data.submittedAt?.toMillis?.()||null};
   }
   const projectId=checkId(input.projectId,"Studio project",128);
   const revision=input.projectRevision;
   if(!Number.isInteger(revision)||revision<1)
    deny("invalid-argument","Save the current project revision before submitting.");
   const auditRef=db.collection(prefix+"submission_audit").doc();
   let receipt;
   await db.runTransaction(async tx=>{
    const [activeMember,person,enrollment,currentTask]=await Promise.all([
     verifySchool(tx,"student"),tx.get(personRef),tx.get(enrollmentRef),tx.get(taskRef)
    ]);
    const locatedSubmission=person.exists?
      await resolveStudentSubmission(person.data(),ref=>tx.get(ref)):
      {submissionId:currentSubmissionId,ref:currentSubmissionRef,doc:await tx.get(currentSubmissionRef)},
      submissionId=locatedSubmission.submissionId,submissionRef=locatedSubmission.ref,
      submission=locatedSubmission.doc,
      locatedProject=person.exists?
        await resolveStudentProject(person.data(),projectId,ref=>tx.get(ref)):null,
      projectRef=locatedProject?.ref,project=locatedProject?.doc;
    if(activeMember.personId!==personId||!person.exists||person.data().authUid!==ctx.uid||
       person.data().schoolId!==ctx.schoolId||person.data().status!=="active"||
       person.data().kind!=="student"||!enrollment.exists||
       enrollment.data().schoolId!==ctx.schoolId||enrollment.data().personId!==personId||
       enrollment.data().offeringId!==offeringId||enrollment.data().status!=="active")
     deny("permission-denied","Student enrollment or identity changed.");
    const assessment=currentTask.data();
    if(!currentTask.exists||assessment.schoolId!==ctx.schoolId||
       assessment.submissionSource!=="studio"||assessment.status!=="deployed"||
       assessment.published!==true||assessment.offeringId!==offeringId)
     deny("failed-precondition","The assigned Studio assessment is no longer available.");
    const lifecycle=assessment.lifecycle||"active",
      revisionOpen=submission.exists&&submission.data().status==="reopened";
    if(["archived","cancelled"].includes(lifecycle))
     deny("failed-precondition","This assessment is no longer accepting student submissions.");
    if(assessment.manualOpenRequired===true&&assessment.manualAccessState!=="open")
    deny("failed-precondition","Your teacher has not opened this Studio exam session, or has already closed it.");
   if(lifecycle==="closed"&&!revisionOpen)
     deny("failed-precondition","This assessment is closed to new submissions.");
    const now=Date.now();
    const revisionDeadline=revisionOpen?
      submission.data().revisionDueAt?.toMillis?.()||0:0;
    if((assessment.manualOpenRequired!==true&&now<assessment.opensAt.toMillis())||
       (assessment.allowLateSubmissions!==true&&now>assessment.dueAt.toMillis()&&now>revisionDeadline))
     deny("failed-precondition","The Studio submission deadline has passed. Ask your teacher for an explicit revision extension.");
    if(!project?.exists||project.data().schoolId!==ctx.schoolId||
       !studentRecordUidAllowed(person.data(),ctx.uid,project.data().ownerUid))
     deny("permission-denied","Choose a saved Studio project owned by your canonical student identity.");
    if(assessment.manualOpenRequired===true){
     const binding=project.data().artifacts?.assessment;
     if(binding?.provisionedBy!=="assessment-launch"||
        (binding.taskId||binding.assessmentId)!==taskId||
        binding.offeringId!==offeringId||
        Number(binding.sessionEpoch||0)!==Number(assessment.manualSessionEpoch||0))
      deny("failed-precondition","Submit the project opened from this examination's current class session.");
    }
    if(project.data().revision!==revision)
     deny("failed-precondition","Project changed. Save the latest revision before submitting.");
    const files=project.data().files;
    if(!Array.isArray(files)||project.data().contentDigest!==digestProject(files,project.data().artifacts||{}))
     deny("failed-precondition","The saved project checksum could not be verified.");
    let version=1;
    if(submission.exists){
     const prior=submission.data();
     if(prior.schoolId!==ctx.schoolId||prior.personId!==personId||
        !studentRecordUidAllowed(person.data(),ctx.uid,prior.studentUid)||
        prior.taskId!==taskId||prior.offeringId!==offeringId)
      deny("permission-denied","The stored submission belongs to a different student identity.");
     if(prior.status==="submitted"&&prior.projectId===projectId&&
       prior.projectRevision===revision){
      receipt={submissionId,version:prior.currentVersion,status:"submitted",alreadyExisted:true};return;
     }
     if(prior.status!=="reopened")
      deny("failed-precondition","This assessment is already submitted. Your teacher must request a revision first.");
     version=prior.currentVersion+1;
    }
    let variantId="",variantPrompt="",variantEvaluationNotes="";
    if(assessment.personalizedTask?.enabled===true){
      variantId=String(input.variantId||"");
      const variantAttempt=Number(input.variantAttempt);
      if(!/^[a-f0-9]{24}$/.test(variantId)||variantAttempt!==version)
        deny("failed-precondition","Open this personalized task from My Assignments before submitting.");
      const assignmentRef=db.doc(prefix+"studio_variant_assignments/"+submissionId+"/attempts/"+version),
        assigned=await tx.get(assignmentRef),data=assigned.exists?assigned.data():null;
      if(!assigned.exists||data.schoolId!==ctx.schoolId||data.taskId!==taskId||
         !studentRecordUidAllowed(person.data(),ctx.uid,data.studentUid)||
         data.personId!==personId||data.attempt!==version||
         data.variantId!==variantId||
         data.poolFingerprint!==assessment.personalizedTask.poolFingerprint||
         !Array.isArray(assessment.personalizedTask.variantIds)||
         !assessment.personalizedTask.variantIds.includes(variantId)||
         typeof data.prompt!=="string"||data.prompt.trim().length<20)
        deny("failed-precondition","The personalized task does not match this submission attempt.");
      variantPrompt=data.prompt;
      variantEvaluationNotes=typeof data.evaluationNotes==="string"?data.evaluationNotes:"";
    }
    const versionRef=submissionRef.collection("versions").doc(String(version));
    const artifacts=project.data().artifacts||{},frozenDigest=digestProject(files,artifacts),
      sourceDigest=digestSource(files,project.data().language),when=FieldValue.serverTimestamp();
    tx.create(versionRef,{schoolId:ctx.schoolId,taskId,offeringId,studentUid:ctx.uid,personId,
      projectId,projectRevision:revision,files,artifacts,contentDigest:frozenDigest,sourceDigest,
      sourceLanguage:project.data().language,variantId,variantPrompt,variantEvaluationNotes,submittedAt:when,version});
    if(submission.exists){
     const prior=submission.data(),previousStudentUids=[...new Set([
       ...(Array.isArray(prior.previousStudentUids)?prior.previousStudentUids:[]),
       ...(prior.studentUid&&prior.studentUid!==ctx.uid?[prior.studentUid]:[])
     ])].slice(-20);
     tx.update(submissionRef,{status:"submitted",currentVersion:version,
       studentUid:ctx.uid,personId,previousStudentUids,
       projectId,projectRevision:revision,variantId,contentDigest:frozenDigest,
       revisionRequestMessage:null,revisionDueAt:null,updatedAt:when});
    }else{
     tx.create(submissionRef,{schoolId:ctx.schoolId,taskId,offeringId,studentUid:ctx.uid,
       personId,projectId,projectRevision:revision,variantId,contentDigest:frozenDigest,
       status:"submitted",currentVersion:version,createdAt:when,updatedAt:when});
    }
    tx.create(auditRef,{schoolId:ctx.schoolId,taskId,submissionId,studentUid:ctx.uid,
      action:version===1?"studio_submitted":"studio_resubmitted",version,createdAt:when});
    receipt={submissionId,version,status:"submitted",alreadyExisted:false};
   });
   if(!receipt.alreadyExisted){
    await writeSchoolNotification({
      db,schoolId:ctx.schoolId,uid:task.data().reviewerUid||task.data().ownerUid,
      id:"studio_submission_"+taskId+"_"+ctx.uid+"_"+receipt.version,
      title:receipt.version>1?"Studio project resubmitted":"Studio project submitted",
      body:(task.data().title||"Assessment")+" · a student submission is ready for review.",
      type:"submission",sourceId:taskId,target:"school-gradebook.html"
    }).catch(()=>{});
   }
   return receipt;
  }
  if(!ctx.roles.includes("teacher"))
   deny("permission-denied","Teacher review access is required.");
  const assignmentRef=db.doc(prefix+"staff_assignments/"+rowKey(ctx.uid,offeringId));
  const isAuthorized=async tx=>{
   await verifySchool(tx,"teacher");
   const [currentTask,grant]=await Promise.all([tx.get(taskRef),tx.get(assignmentRef)]);
   if(!currentTask.exists||currentTask.data().schoolId!==ctx.schoolId||
      (!ctx.platformOverride&&((currentTask.data().reviewerUid||currentTask.data().ownerUid)!==ctx.uid||
       !grant.exists||grant.data().teacherUid!==ctx.uid||grant.data().offeringId!==offeringId||
       grant.data().schoolId!==ctx.schoolId||grant.data().status!=="active")))
    deny("permission-denied","Only the currently responsible assigned teacher may review this class task.");
   return currentTask.data();
  };
  // Verify course rights for reads as well, not only in mutation transactions.
  const [grant,member]=await Promise.all([assignmentRef.get(),membershipRef.get()]);
  if(!ctx.platformOverride&&((task.data().reviewerUid||task.data().ownerUid)!==ctx.uid||!grant.exists||
    grant.data().schoolId!==ctx.schoolId||grant.data().teacherUid!==ctx.uid||
    grant.data().offeringId!==offeringId||grant.data().status!=="active"||
    !member.exists||member.data().status!=="active"))
   deny("permission-denied","This task's review is not assigned to you.");
  if(input.action==="inbox"){
   const snap=await submissions.where("taskId","==",taskId).limit(101).get();
   if(snap.size===101)deny("resource-exhausted","Submission inbox requires pagination.");
   const rows=snap.docs.filter(d=>d.data().schoolId===ctx.schoolId&&d.data().offeringId===offeringId);
   const people=await Promise.all(rows.map(d=>db.doc(prefix+"people/"+d.data().personId).get()));
   return {taskId,submissions:rows.map((d,index)=>({
      submissionId:d.id,studentUid:d.data().studentUid,personId:d.data().personId,
      studentName:people[index].exists&&people[index].data().schoolId===ctx.schoolId?
        people[index].data().displayName:"Student",
      status:d.data().status,version:d.data().currentVersion,variantId:d.data().variantId||"",
      updatedAt:d.data().updatedAt?.toMillis?.()||null
    }))};
  }
  const submissionId=checkId(input.submissionId,"Submission ID",128);
  const submissionRef=submissions.doc(submissionId);
  if(input.action==="inspect"){
   const submission=await submissionRef.get();
   if(!submission.exists||submission.data().schoolId!==ctx.schoolId||
      submission.data().offeringId!==offeringId||submission.data().taskId!==taskId)
    deny("not-found","Submission unavailable.");
   const version=submission.data().currentVersion;
   const snapshot=await submissionRef.collection("versions").doc(String(version)).get();
   if(!snapshot.exists||snapshot.data().schoolId!==ctx.schoolId||
     snapshot.data().contentDigest!==digestProject(snapshot.data().files,snapshot.data().artifacts||{}))
    deny("failed-precondition","Frozen submission content is not verifiable.");
   let personalizedTask=null;
   const variantId=String(snapshot.data().variantId||"");
   if(variantId){
     const frozenPrompt=String(snapshot.data().variantPrompt||""),
       frozenNotes=String(snapshot.data().variantEvaluationNotes||"");
     if(frozenPrompt.trim().length>=20){
       personalizedTask={variantId,prompt:frozenPrompt,evaluationNotes:frozenNotes,source:"frozen_submission"};
     }else{
       const fingerprint=String(task.data().personalizedTask?.poolFingerprint||""),
         variant=await db.doc(prefix+"assessment_blueprint_private/"+task.data().blueprintId+
           "/pools/"+fingerprint+"/variants/"+variantId).get();
       if(!variant.exists||variant.data().schoolId!==ctx.schoolId||
          variant.data().blueprintId!==task.data().blueprintId||
          variant.data().fingerprint!==fingerprint||variant.data().variantId!==variantId||
          typeof variant.data().prompt!=="string"||variant.data().prompt.trim().length<20)
         deny("failed-precondition","The exact personalized task for this submitted version is unavailable.");
       personalizedTask={variantId,prompt:variant.data().prompt,
         evaluationNotes:variant.data().evaluationNotes||"",source:"verified_private_pool_fallback"};
     }
   }
   return {submissionId,taskId,status:submission.data().status,version,
     files:snapshot.data().files,artifacts:snapshot.data().artifacts||{},contentDigest:snapshot.data().contentDigest,
     sourceDigest:snapshot.data().sourceDigest||digestSource(snapshot.data().files,snapshot.data().sourceLanguage),
     language:snapshot.data().sourceLanguage,personalizedTask,
     automaticVerification:snapshot.data().verification||null};
  }
  if(input.action==="request_revision"){
   const reason=String(input.reason||"").trim();
   if(reason.length<12||reason.length>2000)
    deny("invalid-argument","Explain the requested revision in 12–2000 characters.");
   let extensionDueAt=null;
   if(input.extensionDueAt!==undefined&&input.extensionDueAt!==null&&input.extensionDueAt!==""){
    const raw=input.extensionDueAt;
    if(typeof raw!=="string"||!/(Z|[+-]\d\d:\d\d)$/.test(raw))
      deny("invalid-argument","Revision extension must include an explicit timezone.");
    const until=Date.parse(raw);
    if(!Number.isFinite(until)||until<=Date.now()||until>Date.now()+30*86400000)
      deny("invalid-argument","Choose a future revision deadline no more than 30 days from now.");
    extensionDueAt=Timestamp.fromMillis(until);
   }
   if(Date.now()>task.data().dueAt.toMillis()&&!extensionDueAt)
    deny("failed-precondition","The original deadline passed. Set an explicit revision extension before reopening.");
   const auditRef=db.collection(prefix+"submission_audit").doc();
   let revisionStudentUid=null,revisionNotificationUid=null;
   await db.runTransaction(async tx=>{
    const currentTask=await isAuthorized(tx),lifecycle=currentTask.lifecycle||"active";
    if(["archived","cancelled"].includes(lifecycle))
     deny("failed-precondition","Archived or cancelled assessments cannot request new student revisions.");
    const submission=await tx.get(submissionRef);
    if(!submission.exists||submission.data().schoolId!==ctx.schoolId||
       submission.data().taskId!==taskId||submission.data().offeringId!==offeringId||
       !["submitted","reviewed"].includes(submission.data().status))
     deny("failed-precondition","Only a submitted, unpublished revision can be reopened.");
    // Grade publication is a separate guarded service; if a published grade
    // exists, this operation must fail closed and require formal correction.
    revisionStudentUid=submission.data().studentUid;
    const gradeRef=db.doc(prefix+"student_grades/"+hash(taskId,submission.data().studentUid)),
      studentPersonRef=db.doc(prefix+"people/"+checkId(submission.data().personId,"Student person",128)),
      [grade,studentPerson]=await Promise.all([tx.get(gradeRef),tx.get(studentPersonRef)]);
    if(studentPerson.exists&&studentPerson.data().schoolId===ctx.schoolId&&
       studentPerson.data().kind==="student"&&studentPerson.data().status==="active"&&
       typeof studentPerson.data().authUid==="string")
      revisionNotificationUid=studentPerson.data().authUid;
    if(grade.exists&&grade.data().status==="published")
     deny("failed-precondition","Published grades cannot be reopened without the correction workflow.");
    const now=FieldValue.serverTimestamp();
    tx.update(submissionRef,{status:"reopened",revisionRequestMessage:reason,
      revisionDueAt:extensionDueAt,revisionRequestedByUid:ctx.uid,updatedAt:now});
    tx.create(auditRef,{schoolId:ctx.schoolId,taskId,submissionId,
      actorUid:ctx.uid,action:"studio_revision_requested",createdAt:now});
   });
   if(revisionNotificationUid)await writeSchoolNotification({
     db,schoolId:ctx.schoolId,uid:revisionNotificationUid,
     id:"studio_revision_"+taskId+"_"+submissionId,
     title:"Studio revision requested",
     body:(task.data().title||"Assessment")+" · your teacher requested changes before grading.",
     type:"submission",sourceId:taskId,target:"student-assessments.html"
   }).catch(()=>{});
   return {submissionId,status:"reopened"};
  }
  deny("invalid-argument","Unknown Studio submission operation.");
 };
}
module.exports={createSchoolStudioSubmissionService};
