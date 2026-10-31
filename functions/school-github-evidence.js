"use strict";
/**
 * V4 GitHub evidence state machine.
 * Stores repository identifiers and immutable commit selections only.
 * Never stores GitHub access tokens and never treats commit author metadata as
 * proof of individual contribution. Teacher approval is an audited human
 * verification decision, not cryptographic authorship proof.
 */
const {FieldValue,Timestamp}=require("firebase-admin/firestore");
const {createHash}=require("node:crypto");
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");
const {rowKey,checkId}=require("./school-academics.js");

function deny(code,message){throw new TenantAccessError(code,message)}
const sha=value=>{
 const text=String(value||"").trim().toLowerCase();
 if(!/^[a-f0-9]{40}$/.test(text))deny("invalid-argument","Use full 40-character Git commit SHAs.");
 return text;
};
function repository(value){
 const input=String(value||"").trim();
 let owner="",repo="";
 if(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input)){
  [owner,repo]=input.split("/");
 }else{
  let url;
  try{url=new URL(input);}catch{deny("invalid-argument","Enter a valid GitHub repository URL or owner/repository.");}
  if(url.protocol!=="https:"||url.hostname.toLowerCase()!=="github.com")
   deny("invalid-argument","Only https://github.com repositories are supported.");
  const parts=url.pathname.replace(/\/$/,"").split("/").filter(Boolean);
  if(parts.length!==2)deny("invalid-argument","Use a repository URL, not a file, branch or subdirectory URL.");
  [owner,repo]=parts;
 }
 repo=repo.replace(/\.git$/i,"");
 if(!/^[A-Za-z0-9_.-]+$/.test(owner)||!/^[A-Za-z0-9_.-]+$/.test(repo)||
    [owner,repo].some(part=>part==="."||part===".."))
  deny("invalid-argument","Invalid GitHub repository owner or name.");
 return {owner,repo,fullName:owner+"/"+repo,url:"https://github.com/"+owner+"/"+repo};
}
function digestEvidence(repo,selected,checkpoint){
 return createHash("sha256").update(JSON.stringify({
  repository:repo.fullName.toLowerCase(),selectedCommitShas:[...selected].sort(),checkpointSha:checkpoint
 })).digest("hex");
}
const key=(...parts)=>createHash("sha256").update(JSON.stringify(parts)).digest("hex");
function extensionTimestamp(value){
 if(value===undefined||value===null||value==="")return null;
 if(typeof value!=="string"||!/(Z|[+-]\d\d:\d\d)$/.test(value))
  deny("invalid-argument","Revision extension must include an explicit timezone.");
 const millis=Date.parse(value);
 if(!Number.isFinite(millis)||millis<=Date.now()||millis>Date.now()+30*86400000)
  deny("invalid-argument","Choose a future revision deadline no more than 30 days from now.");
 return Timestamp.fromMillis(millis);
}
function createSchoolGithubEvidenceService({db}){
 return async request=>{
  const input=request.data||{},ctx=await getSchoolContext({db,request,schoolId:input.schoolId});
  if("token" in input||"accessToken" in input||"githubToken" in input)
   deny("invalid-argument","GitHub credentials must never be submitted to the evidence record.");
  const taskId=checkId(input.taskId,"Assessment task",128);
  const prefix="schools/"+ctx.schoolId+"/";
  const taskRef=db.doc(prefix+"assessments/"+taskId);
  const schoolRef=db.doc("platform_schools/"+ctx.schoolId);
  const memberRef=db.doc(prefix+"memberships/"+ctx.uid);
  const evidenceCollection=db.collection(prefix+"github_evidence");
  const task=await taskRef.get();
  if(!task.exists||task.data().schoolId!==ctx.schoolId||
     task.data().submissionSource!=="github"||task.data().status!=="deployed")
   deny("not-found","This school's GitHub evidence assessment is unavailable.");
  const taskData=task.data(),offeringId=taskData.offeringId;

  async function verifyMembership(tx,role){
   const [school,member]=await Promise.all([tx.get(schoolRef),tx.get(memberRef)]);
   if(!school.exists||school.data().state!=="active"||!member.exists||
      member.data().schoolId!==ctx.schoolId||member.data().status!=="active"||
      !Array.isArray(member.data().roles)||!member.data().roles.includes(role))
    deny("permission-denied","Your verified school permission changed. Refresh before continuing.");
   return member.data();
  }
  async function verifyStudentRead(){
   if(!ctx.roles.includes("student"))deny("permission-denied","Student evidence access is required.");
   const member=await memberRef.get(),personId=member.data()?.personId;
   if(typeof personId!=="string")deny("failed-precondition","Link your verified school person record first.");
   checkId(personId,"Person ID",128);
   const [person,enrollment]=await Promise.all([
    db.doc(prefix+"people/"+personId).get(),
    db.doc(prefix+"enrollments/"+rowKey(personId,offeringId)).get()
   ]);
   if(!person.exists||person.data().schoolId!==ctx.schoolId||person.data().authUid!==ctx.uid||
      person.data().kind!=="student"||person.data().status!=="active"||
      !enrollment.exists||enrollment.data().schoolId!==ctx.schoolId||
      enrollment.data().personId!==personId||enrollment.data().offeringId!==offeringId||
      enrollment.data().status!=="active")
    deny("permission-denied","You are not actively enrolled in this course offering.");
   return {member:member.data(),personId};
  }
  const evidenceId=key(ctx.schoolId,taskId,ctx.uid);
  const evidenceRef=evidenceCollection.doc(evidenceId);

  if(input.action==="my_status"){
   const {personId}=await verifyStudentRead();
   const current=await evidenceRef.get();
   if(!current.exists)return {taskId,submitted:false,status:"not_submitted",version:0};
   const data=current.data();
   if(data.schoolId!==ctx.schoolId||data.taskId!==taskId||data.studentUid!==ctx.uid||
      data.personId!==personId||data.offeringId!==offeringId)
    deny("permission-denied","Stored evidence belongs to a different school context.");
   return {taskId,evidenceId,currentVersion:data.currentVersion,submitted:true,status:data.status,version:data.currentVersion,
    repository:data.repository?.fullName||"",selectedCommitShas:Array.isArray(data.selectedCommitShas)?data.selectedCommitShas:[],selectedCount:Array.isArray(data.selectedCommitShas)?data.selectedCommitShas.length:0,
    checkpointSha:data.checkpointSha||"",reopenReason:data.status==="reopened"?data.reopenReason||"":"",
    revisionDueAt:data.status==="reopened"?data.revisionDueAt?.toMillis?.()||null:null,
    approvedAt:data.status==="approved"?data.approvedAt?.toMillis?.()||null:null};
  }

  if(input.action==="submit"){
   if(!ctx.roles.includes("student"))deny("permission-denied","Student evidence submission is required.");
   const repo=repository(input.repository);
   if(!Array.isArray(input.selectedCommitShas)||!input.selectedCommitShas.length||
      input.selectedCommitShas.length>100)
    deny("invalid-argument","Select between 1 and 100 evidence commits.");
   const selected=[...new Set(input.selectedCommitShas.map(sha))].sort();
   if(selected.length!==input.selectedCommitShas.length)
    deny("invalid-argument","Duplicate commit SHAs are not allowed in the evidence selection.");
   const checkpoint=sha(input.checkpointSha),digest=digestEvidence(repo,selected,checkpoint);
   const auditRef=db.collection(prefix+"submission_audit").doc();
   let receipt;
   await db.runTransaction(async tx=>{
    const activeMember=await verifyMembership(tx,"student");
    const personId=activeMember.personId;
    if(typeof personId!=="string")deny("failed-precondition","Link your verified school person record first.");
    checkId(personId,"Person ID",128);
    const personRef=db.doc(prefix+"people/"+personId);
    const enrollmentRef=db.doc(prefix+"enrollments/"+rowKey(personId,offeringId));
    const [currentTask,person,enrollment,current]=await Promise.all([
      tx.get(taskRef),tx.get(personRef),tx.get(enrollmentRef),tx.get(evidenceRef)
    ]);
    if(!currentTask.exists||currentTask.data().schoolId!==ctx.schoolId||
       currentTask.data().submissionSource!=="github"||currentTask.data().status!=="deployed"||
       currentTask.data().offeringId!==offeringId)
      deny("failed-precondition","The GitHub evidence assessment changed.");
    if(!person.exists||person.data().schoolId!==ctx.schoolId||person.data().authUid!==ctx.uid||
       person.data().kind!=="student"||person.data().status!=="active"||
       !enrollment.exists||enrollment.data().schoolId!==ctx.schoolId||
       enrollment.data().personId!==personId||enrollment.data().offeringId!==offeringId||
       enrollment.data().status!=="active")
      deny("permission-denied","Student identity or enrollment changed.");
    const now=Date.now(),assessment=currentTask.data();
    const revisionDeadline=current.exists&&current.data().status==="reopened"?
      current.data().revisionDueAt?.toMillis?.()||0:0;
    if(now<assessment.opensAt.toMillis()||
       (now>assessment.dueAt.toMillis()&&now>revisionDeadline))
      deny("failed-precondition","The GitHub evidence submission deadline is not open.");
    let version=1;
    if(current.exists){
      const prior=current.data();
      if(prior.schoolId!==ctx.schoolId||prior.taskId!==taskId||
         prior.studentUid!==ctx.uid||prior.offeringId!==offeringId)
        deny("permission-denied","Stored GitHub evidence belongs to another context.");
      if(prior.status==="submitted"&&prior.evidenceDigest===digest){
        receipt={evidenceId,version:prior.currentVersion,status:"submitted",alreadyExisted:true};return;
      }
      if(prior.status!=="reopened")
        deny("failed-precondition","Evidence is already submitted. Your teacher must request a revision before changes.");
      version=prior.currentVersion+1;
    }
    const versionRef=evidenceRef.collection("versions").doc(String(version));
    const when=FieldValue.serverTimestamp();
    const immutable={schoolId:ctx.schoolId,taskId,offeringId,studentUid:ctx.uid,personId,
      repository:repo,selectedCommitShas:selected,checkpointSha:checkpoint,
      evidenceDigest:digest,version,submittedAt:when};
    tx.create(versionRef,immutable);
    if(current.exists){
      tx.update(evidenceRef,{...immutable,status:"submitted",currentVersion:version,
        reopenReason:null,revisionDueAt:null,approvedAt:null,approvedByUid:null,
        verification:null,updatedAt:when});
    }else{
      tx.create(evidenceRef,{...immutable,status:"submitted",currentVersion:version,
        createdAt:when,updatedAt:when,approvedAt:null,approvedByUid:null,verification:null});
    }
    tx.create(auditRef,{schoolId:ctx.schoolId,taskId,evidenceId,studentUid:ctx.uid,
      action:version===1?"github_evidence_submitted":"github_evidence_resubmitted",
      version,evidenceDigest:digest,createdAt:when});
    receipt={evidenceId,version,status:"submitted",alreadyExisted:false};
   });
   return receipt;
  }

  if(!ctx.roles.includes("teacher"))deny("permission-denied","Teacher evidence review is required.");
  const assignmentRef=db.doc(prefix+"staff_assignments/"+rowKey(ctx.uid,offeringId));
  async function teacherReadAuthority(){
   const [member,grant,currentTask]=await Promise.all([
    memberRef.get(),assignmentRef.get(),taskRef.get()
   ]);
   if(!member.exists||member.data().status!=="active"||member.data().schoolId!==ctx.schoolId||
      !Array.isArray(member.data().roles)||!member.data().roles.includes("teacher")||
      !grant.exists||grant.data().schoolId!==ctx.schoolId||grant.data().teacherUid!==ctx.uid||
      grant.data().offeringId!==offeringId||grant.data().status!=="active"||
      !currentTask.exists||currentTask.data().schoolId!==ctx.schoolId||
      currentTask.data().ownerUid!==ctx.uid||currentTask.data().submissionSource!=="github")
    deny("permission-denied","Only the assessment-owning assigned teacher may review this evidence.");
  }
  async function teacherWriteAuthority(tx){
   await verifyMembership(tx,"teacher");
   const [grant,currentTask]=await Promise.all([tx.get(assignmentRef),tx.get(taskRef)]);
   if(!grant.exists||grant.data().schoolId!==ctx.schoolId||grant.data().teacherUid!==ctx.uid||
      grant.data().offeringId!==offeringId||grant.data().status!=="active"||
      !currentTask.exists||currentTask.data().schoolId!==ctx.schoolId||
      currentTask.data().ownerUid!==ctx.uid||currentTask.data().submissionSource!=="github")
    deny("permission-denied","Teacher review scope changed.");
   return currentTask.data();
  }
  await teacherReadAuthority();

  if(input.action==="inbox"){
   const snap=await evidenceCollection.where("taskId","==",taskId).limit(101).get();
   if(snap.size===101)deny("resource-exhausted","GitHub evidence inbox requires pagination.");
   const rows=snap.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&doc.data().offeringId===offeringId);
   const people=await Promise.all(rows.map(doc=>db.doc(prefix+"people/"+doc.data().personId).get()));
   return {taskId,evidence:rows.map((doc,index)=>({
    evidenceId:doc.id,studentUid:doc.data().studentUid,personId:doc.data().personId,
    studentName:people[index].exists&&people[index].data().schoolId===ctx.schoolId?
      people[index].data().displayName:"Student",
    status:doc.data().status,version:doc.data().currentVersion,
    repository:doc.data().repository?.fullName||"",selectedCount:doc.data().selectedCommitShas?.length||0,
    checkpointSha:doc.data().checkpointSha||"",updatedAt:doc.data().updatedAt?.toMillis?.()||null
   }))};
  }

  const targetId=checkId(input.evidenceId,"Evidence ID",128);
  const targetRef=evidenceCollection.doc(targetId);
  if(input.action==="inspect"){
   const record=await targetRef.get();
   if(!record.exists||record.data().schoolId!==ctx.schoolId||record.data().taskId!==taskId||
      record.data().offeringId!==offeringId)
    deny("not-found","GitHub evidence is unavailable.");
   const data=record.data();
   const version=await targetRef.collection("versions").doc(String(data.currentVersion)).get();
   if(!version.exists||version.data().schoolId!==ctx.schoolId||
      version.data().evidenceDigest!==data.evidenceDigest)
    deny("failed-precondition","The immutable GitHub evidence version could not be verified.");
   return {evidenceId:targetId,studentUid:data.studentUid,personId:data.personId,
    status:data.status,version:data.currentVersion,repository:data.repository,
    selectedCommitShas:data.selectedCommitShas,checkpointSha:data.checkpointSha,
    evidenceDigest:data.evidenceDigest,verification:data.verification||null,
    reopenReason:data.reopenReason||"",revisionDueAt:data.revisionDueAt?.toMillis?.()||null};
  }

  if(input.action==="approve"){
   const note=String(input.note||"").trim();
   if(note.length<12||note.length>2000)
    deny("invalid-argument","Document the evidence verification in 12–2000 characters.");
   const verifiedCheckpoint=sha(input.verifiedCheckpointSha);
   if(!Array.isArray(input.verifiedCommitShas)||input.verifiedCommitShas.length>100)
    deny("invalid-argument","Provide the verified commit SHA set.");
   const verified=[...new Set(input.verifiedCommitShas.map(sha))].sort();
   const auditRef=db.collection(prefix+"submission_audit").doc();
   await db.runTransaction(async tx=>{
    await teacherWriteAuthority(tx);
    const record=await tx.get(targetRef);
    if(!record.exists||record.data().schoolId!==ctx.schoolId||
       record.data().taskId!==taskId||record.data().offeringId!==offeringId||
       record.data().status!=="submitted")
      deny("failed-precondition","Only currently submitted evidence may be approved.");
    const data=record.data(),selected=[...(data.selectedCommitShas||[])].sort();
    const claimQuery=db.collection(prefix+"commit_reclaims").where("evidenceId","==",targetId).limit(101);
    const claims=await tx.get(claimQuery);
    if(claims.size===101)deny("resource-exhausted","Attribution history requires pagination before evidence approval.");
    const relevantClaims=claims.docs.map(doc=>doc.data()).filter(claim=>selected.includes(claim.sha));
    if(relevantClaims.some(claim=>claim.status==="pending"))
      deny("failed-precondition","A selected commit still has a pending school attribution decision.");
    if(relevantClaims.some(claim=>claim.status==="rejected"))
      deny("failed-precondition","A selected commit has a rejected attribution claim. Remove or resolve that evidence before approval.");
    if(verifiedCheckpoint!==data.checkpointSha||
       verified.length!==selected.length||verified.some((value,index)=>value!==selected[index]))
      deny("failed-precondition","Teacher verification must match the student's exact frozen commit selection and checkpoint.");
    const version=await tx.get(targetRef.collection("versions").doc(String(data.currentVersion)));
    if(!version.exists||version.data().evidenceDigest!==data.evidenceDigest)
      deny("failed-precondition","The immutable evidence version is unavailable.");
    const when=FieldValue.serverTimestamp();
    const verification={teacherUid:ctx.uid,note,verifiedCheckpointSha:verifiedCheckpoint,
      verifiedCommitShas:verified,version:data.currentVersion};
    tx.update(targetRef,{status:"approved",approvedAt:when,approvedByUid:ctx.uid,
      verification,updatedAt:when});
    tx.create(auditRef,{schoolId:ctx.schoolId,taskId,evidenceId:targetId,
      actorUid:ctx.uid,studentUid:data.studentUid,action:"github_evidence_approved",
      version:data.currentVersion,evidenceDigest:data.evidenceDigest,createdAt:when});
   });
   return {evidenceId:targetId,status:"approved"};
  }

  if(input.action==="request_revision"){
   const reason=String(input.reason||"").trim();
   if(reason.length<12||reason.length>2000)
    deny("invalid-argument","Explain the requested evidence revision in 12–2000 characters.");
   const extension=extensionTimestamp(input.extensionDueAt);
   if(Date.now()>taskData.dueAt.toMillis()&&!extension)
    deny("failed-precondition","The original deadline passed. Set an explicit revision extension.");
   const auditRef=db.collection(prefix+"submission_audit").doc();
   await db.runTransaction(async tx=>{
    await teacherWriteAuthority(tx);
    const record=await tx.get(targetRef);
    if(!record.exists||record.data().schoolId!==ctx.schoolId||
       record.data().taskId!==taskId||record.data().offeringId!==offeringId||
       !["submitted","approved"].includes(record.data().status))
      deny("failed-precondition","Only submitted or approved evidence can be reopened.");
    const data=record.data();
    const gradeRef=db.doc(prefix+"student_grades/"+key(taskId,data.studentUid));
    const grade=await tx.get(gradeRef);
    if(grade.exists&&grade.data().status==="published")
      deny("failed-precondition","Published grades require a grade correction workflow, not evidence reopening.");
    const when=FieldValue.serverTimestamp();
    tx.update(targetRef,{status:"reopened",reopenReason:reason,revisionDueAt:extension,
      reopenedByUid:ctx.uid,approvedAt:null,approvedByUid:null,verification:null,updatedAt:when});
    tx.create(auditRef,{schoolId:ctx.schoolId,taskId,evidenceId:targetId,
      actorUid:ctx.uid,studentUid:data.studentUid,action:"github_evidence_revision_requested",
      version:data.currentVersion,reason,createdAt:when});
   });
   return {evidenceId:targetId,status:"reopened"};
  }
  deny("invalid-argument","Unknown GitHub evidence operation.");
 };
}
module.exports={createSchoolGithubEvidenceService,repository,digestEvidence};
