"use strict";
/**
 * School-scoped commit attribution claims.
 * Administrator decisions resolve identity disputes only; they never approve
 * assessment evidence, publish grades, or infer authorship from Git metadata.
 */
const {FieldValue}=require("firebase-admin/firestore");
const {createHash}=require("node:crypto");
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");
const {rowKey,checkId}=require("./school-academics.js");
const {writeSchoolNotification}=require("./school-notifications.js");

function deny(code,message){throw new TenantAccessError(code,message)}
const hash=(...values)=>createHash("sha256").update(JSON.stringify(values)).digest("hex");
function fullSha(value){
 const text=String(value||"").trim().toLowerCase();
 if(!/^[a-f0-9]{40}$/.test(text))deny("invalid-argument","A full 40-character Git commit SHA is required.");
 return text;
}
function bounded(value,min,max,label){
 const text=String(value||"").trim();
 if(text.length<min||text.length>max)deny("invalid-argument",label+" must be "+min+"–"+max+" characters.");
 return text;
}
function createSchoolReclaimService({db}){
 return async request=>{
  const input=request.data||{},ctx=await getSchoolContext({db,request,schoolId:input.schoolId});
  const prefix="schools/"+ctx.schoolId+"/",claims=db.collection(prefix+"commit_reclaims");
  const schoolRef=db.doc("platform_schools/"+ctx.schoolId),memberRef=db.doc(prefix+"memberships/"+ctx.uid);
  async function verifyRole(tx,role){
   const [school,member]=await Promise.all([tx.get(schoolRef),tx.get(memberRef)]);
   if(!school.exists||school.data().state!=="active"||!member.exists||
      member.data().schoolId!==ctx.schoolId||member.data().status!=="active"||
      !Array.isArray(member.data().roles)||!member.data().roles.includes(role))
    deny("permission-denied","Your school permission changed. Refresh before continuing.");
   return member.data();
  }
  if(input.action==="mine"){
   if(!ctx.roles.includes("student"))deny("permission-denied","Student attribution access is required.");
   const taskId=checkId(input.taskId,"Task ID",128);
   const snap=await claims.where("studentUid","==",ctx.uid).limit(101).get();
   if(snap.size===101)deny("resource-exhausted","Attribution history requires pagination.");
   return {claims:snap.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&doc.data().taskId===taskId)
     .map(doc=>({claimId:doc.id,sha:doc.data().sha,status:doc.data().status,
       explanation:doc.data().explanation,decisionReason:doc.data().decisionReason||"",
       evidenceVersion:doc.data().evidenceVersion,updatedAt:doc.data().updatedAt?.toMillis?.()||null}))};
  }
  if(input.action==="request"){
   if(!ctx.roles.includes("student"))deny("permission-denied","Student attribution access is required.");
   const taskId=checkId(input.taskId,"Task ID",128),
     evidenceId=checkId(input.evidenceId,"Evidence ID",128),sha=fullSha(input.sha);
   const explanation=bounded(input.explanation,10,1500,"Attribution explanation");
   const detectedAuthorName=String(input.detectedAuthorName||"").trim().slice(0,120);
   const detectedAuthorLogin=String(input.detectedAuthorLogin||"").trim().replace(/^@/,"").slice(0,80);
   const evidenceRef=db.doc(prefix+"github_evidence/"+evidenceId),taskRef=db.doc(prefix+"assessments/"+taskId);
   const claimId=hash(taskId,ctx.uid,sha),claimRef=claims.doc(claimId);
   const auditRef=db.collection(prefix+"submission_audit").doc();
   let result;
   await db.runTransaction(async tx=>{
    await verifyRole(tx,"student");
    const [evidence,task,prior]=await Promise.all([tx.get(evidenceRef),tx.get(taskRef),tx.get(claimRef)]);
    if(!task.exists||task.data().schoolId!==ctx.schoolId||task.data().submissionSource!=="github"||
       !evidence.exists||evidence.data().schoolId!==ctx.schoolId||evidence.data().taskId!==taskId||
       evidence.data().studentUid!==ctx.uid||evidence.data().status!=="submitted"||
       !Array.isArray(evidence.data().selectedCommitShas)||!evidence.data().selectedCommitShas.includes(sha))
      deny("permission-denied","Attribution can be requested only for a commit in your currently submitted evidence before teacher approval.");
    const now=FieldValue.serverTimestamp(),version=evidence.data().currentVersion;
    if(prior.exists){
      const data=prior.data();
      if(data.schoolId!==ctx.schoolId||data.studentUid!==ctx.uid||data.taskId!==taskId||data.sha!==sha)
        deny("permission-denied","This attribution claim belongs to another context.");
      if(data.status!=="withdrawn")
        deny("already-exists","This commit already has an attribution claim in review or decision history.");
      const revision=(data.revision||1)+1;
      tx.update(claimRef,{status:"pending",evidenceId,evidenceVersion:version,explanation,
        detectedAuthorName,detectedAuthorLogin,decision:null,decisionReason:null,
        decidedByUid:null,decidedAt:null,revision,updatedAt:now});
      tx.create(auditRef,{schoolId:ctx.schoolId,actorUid:ctx.uid,taskId,evidenceId,
        claimId,sha,action:"commit_reclaim_resubmitted",revision,createdAt:now});
      result={claimId,status:"pending",revision};return;
    }
    tx.create(claimRef,{schoolId:ctx.schoolId,taskId,evidenceId,evidenceVersion:version,
      studentUid:ctx.uid,personId:evidence.data().personId,sha,explanation,
      detectedAuthorName,detectedAuthorLogin,status:"pending",decision:null,
      decisionReason:null,revision:1,createdAt:now,updatedAt:now});
    tx.create(auditRef,{schoolId:ctx.schoolId,actorUid:ctx.uid,taskId,evidenceId,
      claimId,sha,action:"commit_reclaim_requested",revision:1,createdAt:now});
    result={claimId,status:"pending",revision:1};
   });
   const admins=await db.collection(prefix+"memberships")
     .where("roles","array-contains","school_admin").limit(50).get().catch(()=>null);
   if(admins)await Promise.allSettled(admins.docs.filter(doc=>
     doc.id!==ctx.uid&&doc.data().schoolId===ctx.schoolId&&doc.data().status==="active")
     .map(doc=>writeSchoolNotification({
       db,schoolId:ctx.schoolId,uid:doc.id,id:"reclaim_pending_"+result.claimId+"_"+result.revision,
       title:"Commit attribution request",
       body:"A student submitted a commit attribution claim that needs school review.",
       type:"reclaim",sourceId:result.claimId,target:"reclaim-inbox.html"
     })));
   return result;
  }
  if(input.action==="withdraw"){
   if(!ctx.roles.includes("student"))deny("permission-denied","Student attribution access is required.");
   const claimId=checkId(input.claimId,"Claim ID",128),ref=claims.doc(claimId);
   const auditRef=db.collection(prefix+"submission_audit").doc();
   await db.runTransaction(async tx=>{
    await verifyRole(tx,"student");
    const claim=await tx.get(ref);
    if(!claim.exists||claim.data().schoolId!==ctx.schoolId||claim.data().studentUid!==ctx.uid||
       claim.data().status!=="pending")
      deny("failed-precondition","Only your pending attribution request can be withdrawn.");
    const now=FieldValue.serverTimestamp(),revision=(claim.data().revision||1)+1;
    tx.update(ref,{status:"withdrawn",withdrawnByUid:ctx.uid,withdrawnAt:now,updatedAt:now,revision});
    tx.create(auditRef,{schoolId:ctx.schoolId,actorUid:ctx.uid,taskId:claim.data().taskId,
      evidenceId:claim.data().evidenceId,claimId,sha:claim.data().sha,
      action:"commit_reclaim_withdrawn",revision,createdAt:now});
   });
   return {claimId,status:"withdrawn"};
  }
  if(input.action==="inbox"){
   if(!ctx.roles.includes("school_admin"))deny("permission-denied","School administrator access is required.");
   const snap=await claims.where("status","==","pending").limit(101).get();
   if(snap.size===101)deny("resource-exhausted","Attribution inbox requires pagination.");
   const rows=snap.docs.filter(doc=>doc.data().schoolId===ctx.schoolId);
   const [people,evidence]=await Promise.all([
    Promise.all(rows.map(doc=>db.doc(prefix+"people/"+doc.data().personId).get())),
    Promise.all(rows.map(doc=>db.doc(prefix+"github_evidence/"+doc.data().evidenceId).get()))
   ]);
   return {claims:rows.map((doc,index)=>({claimId:doc.id,taskId:doc.data().taskId,
     evidenceId:doc.data().evidenceId,evidenceVersion:doc.data().evidenceVersion,
     studentUid:doc.data().studentUid,personId:doc.data().personId,
     studentName:people[index].exists&&people[index].data().schoolId===ctx.schoolId?
       people[index].data().displayName:"Student",
     repository:evidence[index].exists&&evidence[index].data().schoolId===ctx.schoolId?
       evidence[index].data().repository?.fullName||"":"",
     sha:doc.data().sha,explanation:doc.data().explanation,
     detectedAuthorName:doc.data().detectedAuthorName||"",
     detectedAuthorLogin:doc.data().detectedAuthorLogin||"",status:doc.data().status,
     updatedAt:doc.data().updatedAt?.toMillis?.()||null}))};
  }
  if(input.action==="decide"){
   if(!ctx.roles.includes("school_admin"))deny("permission-denied","School administrator access is required.");
   const claimId=checkId(input.claimId,"Claim ID",128),decision=input.decision;
   if(!["approved","shared","rejected"].includes(decision))
    deny("invalid-argument","Choose approved, shared contribution, or rejected.");
   const reason=bounded(input.reason,12,2000,"Decision reason");
   const ref=claims.doc(claimId),auditRef=db.collection(prefix+"submission_audit").doc();
   let result;
   await db.runTransaction(async tx=>{
    await verifyRole(tx,"school_admin");
    const claim=await tx.get(ref);
    if(!claim.exists||claim.data().schoolId!==ctx.schoolId||claim.data().status!=="pending")
      deny("failed-precondition","This attribution request is no longer pending.");
    const data=claim.data(),evidenceRef=db.doc(prefix+"github_evidence/"+data.evidenceId);
    const evidence=await tx.get(evidenceRef);
    if(!evidence.exists||evidence.data().schoolId!==ctx.schoolId||
       evidence.data().taskId!==data.taskId||evidence.data().studentUid!==data.studentUid||
       !Array.isArray(evidence.data().selectedCommitShas)||!evidence.data().selectedCommitShas.includes(data.sha))
      deny("failed-precondition","The linked frozen evidence no longer contains this commit.");
    const now=FieldValue.serverTimestamp(),revision=(data.revision||1)+1;
    tx.update(ref,{status:decision,decision,decisionReason:reason,decidedByUid:ctx.uid,
      decidedAt:now,updatedAt:now,revision});
    tx.create(auditRef,{schoolId:ctx.schoolId,actorUid:ctx.uid,taskId:data.taskId,
      evidenceId:data.evidenceId,claimId,sha:data.sha,action:"commit_reclaim_decided",
      decision,reason,revision,createdAt:now});
    result={claimId,status:decision,revision};
   });
   const decided=await claims.doc(claimId).get().catch(()=>null);
   const studentUid=decided?.exists?decided.data().studentUid:null;
   if(studentUid)await writeSchoolNotification({
     db,schoolId:ctx.schoolId,uid:studentUid,
     id:"reclaim_decision_"+claimId+"_"+result.revision,
     title:"Commit attribution request decided",
     body:"Your attribution claim was marked "+result.status+".",
     type:"reclaim",sourceId:claimId,target:"student-assessments.html"
   }).catch(()=>{});
   return result;
  }
  if(input.action==="for_evidence"){
   if(!ctx.roles.includes("teacher"))deny("permission-denied","Teacher attribution review is required.");
   const taskId=checkId(input.taskId,"Task ID",128),evidenceId=checkId(input.evidenceId,"Evidence ID",128);
   const [task,evidence]=await Promise.all([
    db.doc(prefix+"assessments/"+taskId).get(),db.doc(prefix+"github_evidence/"+evidenceId).get()
   ]);
   if(!task.exists||task.data().schoolId!==ctx.schoolId||task.data().ownerUid!==ctx.uid||
      task.data().submissionSource!=="github"||!evidence.exists||
      evidence.data().schoolId!==ctx.schoolId||evidence.data().taskId!==taskId)
    deny("permission-denied","This evidence is not assigned to your assessment.");
   const grant=await db.doc(prefix+"staff_assignments/"+rowKey(ctx.uid,task.data().offeringId)).get();
   if(!grant.exists||grant.data().schoolId!==ctx.schoolId||grant.data().teacherUid!==ctx.uid||
      grant.data().status!=="active")
    deny("permission-denied","Your teaching assignment does not include this evidence.");
   const snap=await claims.where("evidenceId","==",evidenceId).limit(101).get();
   if(snap.size===101)deny("resource-exhausted","Attribution history requires pagination.");
   return {claims:snap.docs.filter(doc=>doc.data().schoolId===ctx.schoolId)
     .map(doc=>({claimId:doc.id,sha:doc.data().sha,status:doc.data().status,
       explanation:doc.data().explanation,decisionReason:doc.data().decisionReason||""}))};
  }
  deny("invalid-argument","Unknown attribution operation.");
 };
}
module.exports={createSchoolReclaimService};
