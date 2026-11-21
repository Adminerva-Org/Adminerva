"use strict";
/**
 * V4 school-scoped assessment deployments and student assignment discovery.
 * Deployments freeze student-facing blueprint content and the assigned offering.
 * This does NOT write grades, approve evidence or accept Studio/GitHub submissions.
 */
const {createHash}=require("node:crypto");
const {Timestamp,FieldValue,FieldPath}=require("firebase-admin/firestore");
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");
const {rowKey,checkId}=require("./school-academics.js");
const {digestProject,digestSource}=require("./school-studio-projects.js");
const {writeSchoolNotification}=require("./school-notifications.js");
const {blueprintFingerprint,personalizationContent,PERSONALIZATION_MODE}=require("./teacher-blueprints.js");
const {planPersonalizationForOfferings}=require("./assessment-personalization-planning.js");
function deny(code,message){throw new TenantAccessError(code,message)}
function timestamp(value,label){
 if(typeof value!=="string"||!/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(value)||
   !/(Z|[+-]\d\d:\d\d)$/.test(value))deny("invalid-argument",label+" must include a timezone.");
 const millis=Date.parse(value);
 if(!Number.isFinite(millis))deny("invalid-argument",label+" is invalid.");
 return Timestamp.fromMillis(millis);
}
// The same offering roster serves open/close fanout and historical fallbacks.
// Paginate school enrollment records rather than silently truncating after
// 100 documents; keep all account/person checks tenant scoped.
async function activeOfferingPeople(db,prefix,offeringId){
 const base=db.collection(prefix+"enrollments")
   .where("offeringId","==",offeringId).orderBy(FieldPath.documentId());
 const personIds=new Set();
 let cursor=null;
 for(;;){
  let query=base.limit(200);
  if(cursor)query=query.startAfter(cursor);
  const page=await query.get();
  for(const row of page.docs){
   const data=row.data();
   if(data.schoolId===prefix.split("/")[1]&&data.status==="active"&&
      typeof data.personId==="string"&&data.personId)
    {try{personIds.add(checkId(data.personId,"Student person",128));}
     catch(error){console.warn("Skipping malformed school enrollment person ID",{schoolId:prefix.split("/")[1],code:error.code||"invalid"});}}
  }
  if(personIds.size>1500)
   deny("resource-exhausted","This class roster exceeds the supported 1,500-student session fanout.");
  if(page.size<200)break;
  cursor=page.docs[page.docs.length-1];
 }
 const ids=[...personIds];
 const people=[];
 for(let offset=0;offset<ids.length;offset+=80){
  const refs=ids.slice(offset,offset+80).map(id=>db.doc(prefix+"people/"+id));
  const batch=await db.getAll(...refs);
  people.push(...batch.filter(person=>person.exists&&
    person.data().schoolId===prefix.split("/")[1]&&
    person.data().status==="active"&&person.data().kind==="student"));
 }
 return people;
}

function createSchoolAssessmentService({db}){
 return async request=>{
  const input=request.data||{},ctx=await getSchoolContext({db,request,schoolId:input.schoolId});
  const prefix="schools/"+ctx.schoolId+"/";
  const schoolRef=db.doc("platform_schools/"+ctx.schoolId);
  const membershipRef=db.doc(prefix+"memberships/"+ctx.uid);
  const tasks=db.collection(prefix+"assessments");
  if(input.action==="deploy"){
   if(!ctx.roles.includes("teacher"))deny("permission-denied","An authorized teacher must deploy the assessment.");
   const blueprintId=checkId(input.blueprintId,"Blueprint ID",128);
   const offeringId=checkId(input.offeringId,"Course offering ID",330);
   const key=checkId(input.requestKey,"Request key",100);
   const source=input.submissionSource;
   if(!["studio","github","text","link"].includes(source))
    deny("invalid-argument","Choose a supported assessment submission method.");
   const manualOpenRequired=input.manualOpenRequired===true;
   if(manualOpenRequired&&source!=="studio")
    deny("invalid-argument","Teacher-controlled opening is available only for Adminerva Studio assessments.");
   const start=timestamp(input.opensAt,"Opening time");
   const end=timestamp(input.dueAt,"Deadline");
   const allowLateSubmissions=input.allowLateSubmissions===true;
   if(end.toMillis()<=start.toMillis())
    deny("invalid-argument","The deadline must follow the opening time.");
   const taskId=createHash("sha256")
    .update(JSON.stringify([ctx.schoolId,ctx.uid,blueprintId,offeringId,key]))
    .digest("hex");
   const taskRef=tasks.doc(taskId);
   const privateTaskRef=db.doc(prefix+"assessment_private/"+taskId);
   const offeringRef=db.doc(prefix+"course_offerings/"+offeringId);
   const grantRef=db.doc(prefix+"staff_assignments/"+rowKey(ctx.uid,offeringId));
   const blueprintRef=db.doc(prefix+"assessment_blueprints/"+blueprintId);
   const auditRef=db.collection(prefix+"assessment_audit").doc();
   let result=null;
   await db.runTransaction(async tx=>{
    const [school,membership,offering,grant,blueprint,existing]=await Promise.all([
     tx.get(schoolRef),tx.get(membershipRef),tx.get(offeringRef),tx.get(grantRef),
     tx.get(blueprintRef),tx.get(taskRef)
    ]);
    if(!ctx.platformOverride&&(!school.exists||!["active","pilot"].includes(school.data().state)||!membership.exists||
       membership.data().status!=="active"||membership.data().schoolId!==ctx.schoolId||
       !Array.isArray(membership.data().roles)||!membership.data().roles.includes("teacher")))
      deny("permission-denied","Your school teaching access is no longer active.");
    if(!offering.exists||offering.data().schoolId!==ctx.schoolId||
       offering.data().status!=="active")
      deny("failed-precondition","Select an active school course offering.");
    if(!ctx.platformOverride&&(!grant.exists||grant.data().schoolId!==ctx.schoolId||
       grant.data().teacherUid!==ctx.uid||grant.data().offeringId!==offeringId||
       grant.data().status!=="active"))
      deny("permission-denied","You are not assigned to teach this course offering.");
    if(!blueprint.exists||blueprint.data().schoolId!==ctx.schoolId||
       blueprint.data().ownerUid!==ctx.uid||blueprint.data().status!=="draft")
      deny("permission-denied","Deploy only your own active assessment blueprint or independent copy.");
    const original=blueprint.data();
    if(existing.exists){
      const prior=existing.data();
      if(prior.schoolId===ctx.schoolId&&prior.ownerUid===ctx.uid&&
        prior.blueprintId===blueprintId&&prior.offeringId===offeringId&&
        prior.requestKey===key&&prior.submissionSource===source&&
        prior.opensAt.toMillis()===start.toMillis()&&prior.dueAt.toMillis()===end.toMillis()&&
        Boolean(prior.allowLateSubmissions)===allowLateSubmissions&&
        Boolean(prior.manualOpenRequired)===manualOpenRequired)
       {result={taskId,status:"deployed",published:prior.published===true,alreadyExisted:true};return;}
      deny("already-exists","This deployment request was already used with different details.");
    }
    // Only non-confidential blueprint fields; copy by value, never reference mutable
    // private answer keys or share grants in a student-visible deployment.
    const personalization=personalizationContent(original.personalization);
    if(personalization.enabled&&source!=="studio")
      deny("failed-precondition","Personalized assessments currently require Adminerva Studio submission.");
    let personalizedTask={enabled:false,mode:"standard"};
    if(personalization.enabled){
      // A pool is reusable between independently scoped class deployments.
      // Capacity is checked against the authoritative current class roster,
      // not the teacher's original draft-stage target estimate.
      const rosterPlan=await planPersonalizationForOfferings({
        db,schoolId:ctx.schoolId,teacherUid:ctx.uid,offeringIds:[offeringId],
        platformOverride:ctx.platformOverride
      });
      const requiredVariants=rosterPlan.requiredVariants;
      const fingerprint=blueprintFingerprint(original),
        poolRef=db.doc(prefix+"assessment_blueprint_private/"+blueprintId+"/pools/"+fingerprint),
        pool=await tx.get(poolRef),
        poolData=pool.exists?pool.data():{},
        variantIds=Array.isArray(poolData.variantIds)?poolData.variantIds:[];
      if(!pool.exists||poolData.schoolId!==ctx.schoolId||poolData.ownerUid!==ctx.uid||
         poolData.blueprintId!==blueprintId||
         poolData.fingerprint!==fingerprint||poolData.ready!==true||
         variantIds.length<requiredVariants||variantIds.length>600)
        deny("failed-precondition","Activate a private personalization pool with enough variants for this class roster before deployment.");
      personalizedTask={
        enabled:true,mode:PERSONALIZATION_MODE,regeneration:"new_attempt",
        uniqueWithinAssessment:true,poolFingerprint:fingerprint,
        poolSize:variantIds.length,poolTarget:requiredVariants,
        variantIds:[...variantIds]
      };
    }
    const frozen={
     title:original.title,description:original.description||"",
     instructions:original.instructions||"",
     subject:original.subject||offering.data().subjectId||"General",
     assessmentType:original.assessmentType||"Assessment",
     defaultSubmissionSource:original.defaultSubmissionSource||source,
     studioProjectProfile:String(original.studioProjectProfile||"auto"),
     rubric:Array.isArray(original.rubric)?original.rubric:[],
     rubricMax:Array.isArray(original.rubric)?
       original.rubric.reduce((sum,row)=>sum+Number(row.points||0),0):0
    };
    if(!frozen.title||!frozen.rubric.length||frozen.rubricMax<=0||frozen.rubricMax>2000)
      deny("failed-precondition","The blueprint must have a valid title and rubric.");
    const now=FieldValue.serverTimestamp();
    tx.create(taskRef,{
     ...frozen,schoolId:ctx.schoolId,ownerUid:ctx.uid,reviewerUid:ctx.uid,
     blueprintId,blueprintRevision:original.contentRevision,
     offeringId,yearId:offering.data().yearId,termId:offering.data().termId,
     subjectId:offering.data().subjectId,sectionId:offering.data().sectionId,
     submissionSource:source,personalizedTask,opensAt:start,dueAt:end,allowLateSubmissions,
     manualOpenRequired,manualAccessState:manualOpenRequired?"waiting":"scheduled",manualSessionEpoch:0,
     requestKey:key,status:"deployed",published:false,lifecycle:"active",revision:1,
     createdAt:now,updatedAt:now
    });
    tx.create(privateTaskRef,{
     schoolId:ctx.schoolId,taskId,blueprintId,ownerUid:ctx.uid,reviewerUid:ctx.uid,
     checkingInstructions:String(original.checkingInstructions||"").slice(0,8000),
     blueprintRevision:original.contentRevision,createdAt:now,updatedAt:now
    });
    tx.create(auditRef,{schoolId:ctx.schoolId,taskId,actorUid:ctx.uid,
     action:"assessment_deployed",offeringId,source,allowLateSubmissions,manualOpenRequired,createdAt:now});
    result={taskId,status:"deployed",published:false,alreadyExisted:false};
   });
   return result;
  }

  if(["open_exam","close_exam","hold_exam"].includes(input.action)){
   if(!ctx.roles.includes("teacher"))
    deny("permission-denied","Only the responsible teacher may control this Studio examination.");
   const taskId=checkId(input.taskId,"Assessment task",128),
    expectedRevision=Number(input.expectedRevision),taskRef=tasks.doc(taskId),
    opening=input.action==="open_exam";
   if(!Number.isInteger(expectedRevision)||expectedRevision<1)
    deny("invalid-argument","The current assessment revision is required.");
   const auditRef=db.collection(prefix+"assessment_audit").doc();
   let result;
   await db.runTransaction(async tx=>{
    const [school,membership,task]=await Promise.all([
      tx.get(schoolRef),tx.get(membershipRef),tx.get(taskRef)
    ]);
    if(!ctx.platformOverride&&(!school.exists||!["active","pilot"].includes(school.data().state)||
       !membership.exists||membership.data().schoolId!==ctx.schoolId||
       membership.data().status!=="active"||
       !Array.isArray(membership.data().roles)||!membership.data().roles.includes("teacher")))
      deny("permission-denied","Your school teaching access changed.");
    if(!task.exists||task.data().schoolId!==ctx.schoolId||
       (!ctx.platformOverride&&(task.data().reviewerUid||task.data().ownerUid)!==ctx.uid))
      deny("permission-denied","Only this deployment's responsible teacher may open or hold its exam.");
    const data=task.data(),revision=data.revision||1,
      grant=await tx.get(db.doc(prefix+"staff_assignments/"+rowKey(ctx.uid,data.offeringId)));
    if(!ctx.platformOverride&&(!grant.exists||grant.data().schoolId!==ctx.schoolId||
       grant.data().teacherUid!==ctx.uid||grant.data().offeringId!==data.offeringId||
       grant.data().status!=="active"))
      deny("permission-denied","You must still be assigned to this course offering.");
    if(revision!==expectedRevision)
      deny("failed-precondition","This assessment changed. Refresh before controlling exam access.");
    if(data.submissionSource!=="studio"||data.manualOpenRequired!==true)
      deny("failed-precondition","This deployment is not configured for teacher-controlled Studio opening.");
    if((data.lifecycle||"active")!=="active")
      deny("failed-precondition","Restore or reopen this assessment before opening its Studio exam.");
    if(opening&&(data.published!==true||
       (data.dueAt.toMillis()<=Date.now()&&data.allowLateSubmissions!==true)))
      deny("failed-precondition","Publish this assessment and set a future deadline, or explicitly allow late submissions, before opening the exam.");
    const before=data.manualAccessState||"waiting",
      closeGraceUntil=data.manualCloseGraceUntil?.toMillis?.()||0;
    if(opening&&["closed","closing"].includes(before)&&Date.now()<closeGraceUntil)
      deny("failed-precondition","The previous session is still saving. Open the next class session after the closing grace period.");
    const next=opening?"open":"closed",epoch=Number(data.manualSessionEpoch||0);
    if(before===next){
      result={taskId,manualAccessState:next,sessionEpoch:epoch,revision,alreadyCurrent:true,
        offeringId:data.offeringId,title:data.title||"Practical exam"};return;
    }
    if(!opening&&before!=="open")
      deny("failed-precondition","This examination session is not currently open.");
    const now=FieldValue.serverTimestamp(),
      graceUntil=Timestamp.fromMillis(Date.now()+60000),
      sessionEpoch=opening?epoch+1:epoch;
    tx.update(taskRef,{manualAccessState:next,manualSessionEpoch:sessionEpoch,
      revision:revision+1,updatedAt:now,
      ...(opening?{manualOpenedAt:now,manualOpenedByUid:ctx.uid,manualCloseGraceUntil:FieldValue.delete()}:
        {manualClosedAt:now,manualClosedByUid:ctx.uid,manualClosedSessionEpoch:sessionEpoch,
         manualCloseGraceUntil:graceUntil})});
    tx.create(auditRef,{schoolId:ctx.schoolId,taskId,actorUid:ctx.uid,
      action:opening?"assessment_exam_opened":"assessment_exam_closed",
      beforeState:before,afterState:next,sessionEpoch,beforeRevision:revision,
      afterRevision:revision+1,createdAt:now});
    // Durable outbox: this transaction changes access immediately. A separate
    // retryable trigger handles roster capture and student notifications.
    const kind=opening?"opened":"closed";
    tx.create(db.doc(prefix+"studio_exam_session_events/"+kind+"_"+taskId+"_"+sessionEpoch),{
      schoolId:ctx.schoolId,taskId,offeringId:data.offeringId,sessionEpoch,
      kind,title:data.title||"Practical exam",actorUid:ctx.uid,createdAt:now
    });
    result={taskId,manualAccessState:next,sessionEpoch,
      revision:revision+1,alreadyCurrent:false,
      offeringId:data.offeringId,title:data.title||"Practical exam"};
   });
   return result;
  }

  if(["exam_close_report","exam_close_project"].includes(input.action)){
   if(!ctx.roles.includes("teacher"))deny("permission-denied","Teacher access is required.");
   const taskId=checkId(input.taskId,"Assessment task",128),
     task=await tasks.doc(taskId).get();
   if(!task.exists||task.data().schoolId!==ctx.schoolId||
      task.data().submissionSource!=="studio"||
      (task.data().manualOpenRequired!==true&&Number(task.data().manualSessionEpoch||0)<1)||
      (!ctx.platformOverride&&(task.data().reviewerUid||task.data().ownerUid)!==ctx.uid))
    deny("permission-denied","This exam is not assigned to you.");
   if(!ctx.platformOverride){
     const grant=await db.doc(prefix+"staff_assignments/"+
       rowKey(ctx.uid,task.data().offeringId)).get();
     if(!grant.exists||grant.data().schoolId!==ctx.schoolId||
        grant.data().teacherUid!==ctx.uid||grant.data().status!=="active")
      deny("permission-denied","Your teaching assignment is not active.");
   }
   const currentEpoch=Number(task.data().manualSessionEpoch||0),
     epoch=input.sessionEpoch===undefined?currentEpoch:Number(input.sessionEpoch);
   if(!Number.isSafeInteger(epoch)||epoch<1||epoch>currentEpoch)
     deny("invalid-argument","Choose a valid practical-exam class session.");
   if(input.action==="exam_close_project"){
    const studentUid=checkId(input.studentUid,"Student account",128),
      receipt=await db.doc(prefix+"studio_exam_close_receipts/"+taskId+
        "/sessions/"+epoch+"/studio_exam_final_checkpoints/"+studentUid).get();
    if(!receipt.exists||receipt.data().schoolId!==ctx.schoolId||
       receipt.data().taskId!==taskId||receipt.data().studentUid!==studentUid||
       receipt.data().closingEpoch!==epoch)
     deny("not-found","No verified final save exists for this student and class session.");
    const frozen=receipt.data();
    if(!Array.isArray(frozen.files))
     deny("failed-precondition","This historical checkpoint contains a digest but predates source snapshot capture.");
    if(frozen.sourceDigest&&frozen.sourceDigest!==digestSource(frozen.files,frozen.language))
     deny("data-loss","The saved source digest does not match the immutable exam checkpoint.");
    if(frozen.artifacts&&frozen.contentDigest&&
       frozen.contentDigest!==digestProject(frozen.files,frozen.artifacts))
     deny("data-loss","The saved project digest does not match the immutable exam checkpoint.");
    return {taskId,sessionEpoch:epoch,studentUid,
      projectId:frozen.projectId,projectRevision:frozen.projectRevision,
      payloadBytes:Number(frozen.payloadBytes||0),
      title:frozen.title||"Saved Studio project",language:frozen.language||"text",
      files:frozen.files,artifacts:frozen.artifacts||{},sourceDigest:frozen.sourceDigest||"",
      contentDigest:frozen.contentDigest||"",
      savedAt:frozen.savedAt?.toMillis?.()||null};
   }
   // Project source and database/design payloads can be hundreds of KB per
   // student. Only retrieve checkpoint metadata for the class roster report.
   // Fetch the full immutable code only when the teacher selects View code.
   const receiptQuery=db.collection(prefix+"studio_exam_close_receipts/"+taskId+
     "/sessions/"+epoch+"/studio_exam_final_checkpoints")
     .select("schoolId","closingEpoch","studentUid","personId","projectId","projectRevision",
       "contentDigest","sourceDigest","payloadBytes","savedAt")
     .orderBy(FieldPath.documentId());
   const receipts=[];
   let receiptCursor=null;
   for(;;){
    let pageQuery=receiptQuery.limit(200);
    if(receiptCursor)pageQuery=pageQuery.startAfter(receiptCursor);
    const page=await pageQuery.get();
    for(const doc of page.docs){
     const data=doc.data();
     if(data.schoolId!==ctx.schoolId||data.closingEpoch!==epoch)continue;
     receipts.push({studentUid:data.studentUid,personId:data.personId||null,
       projectId:data.projectId,projectRevision:data.projectRevision,
       contentDigest:data.contentDigest||"",sourceDigest:data.sourceDigest||"",
       payloadBytes:Number(data.payloadBytes||0),
       savedAt:data.savedAt?.toMillis?.()||null});
    }
    if(receipts.length>1500)
     deny("resource-exhausted","This exam's checkpoint history exceeds the supported class report size.");
    if(page.size<200)break;
    receiptCursor=page.docs[page.docs.length-1];
   }
   const rosterDoc=await db.doc(prefix+"studio_exam_session_rosters/"+taskId+
     "/sessions/"+epoch).get();
   const hasCapturedRoster=rosterDoc.exists&&rosterDoc.data().schoolId===ctx.schoolId&&
      rosterDoc.data().taskId===taskId&&Array.isArray(rosterDoc.data().students);
   const closeEvent=hasCapturedRoster?null:await db.doc(prefix+
     "studio_exam_session_events/closed_"+taskId+"_"+epoch).get();
   let roster=[];
   if(hasCapturedRoster){
    roster=rosterDoc.data().students;
   }else{
    // Compatibility fallback for pre-roster sessions or a partial fanout
    // failure. Label this as a current roster instead of historical evidence.
    const people=await activeOfferingPeople(db,prefix,task.data().offeringId);
    roster=[...new Map(people.filter(person=>person.exists&&person.data().schoolId===ctx.schoolId&&
      person.data().status==="active"&&person.data().kind==="student")
      .map(person=>[person.id,{personId:person.id,
        displayName:String(person.data().displayName||"Student").slice(0,140),
        studentUid:person.data().authUid||null}])).values()];
   }
   const byUid=new Map(receipts.map(row=>[row.studentUid,row]));
   const byPersonId=new Map(receipts.filter(row=>row.personId).map(row=>[row.personId,row]));
   const students=roster.map(person=>{
     const uid=person.studentUid||null,
       receipt=(uid?byUid.get(uid):null)||(person.personId?byPersonId.get(person.personId):null);
     return {displayName:String(person.displayName||"Student").slice(0,140),
       studentUid:uid,receiptStudentUid:receipt?.studentUid||null,
       checkpointConfirmed:Boolean(receipt),
       projectRevision:receipt?.projectRevision||null,
       contentDigest:receipt?.contentDigest||"",sourceDigest:receipt?.sourceDigest||"",
       payloadBytes:receipt?.payloadBytes||0,
       savedAt:receipt?.savedAt||null};
   }).sort((a,b)=>a.displayName.localeCompare(b.displayName));
   const confirmed=students.filter(row=>row.checkpointConfirmed).length;
   const sessionClosed=epoch<currentEpoch||
     (epoch===currentEpoch&&(["closed","closing","held"].includes(task.data().manualAccessState)||
       Number(task.data().manualClosedSessionEpoch||0)===epoch&&
       task.data().manualAccessState!=="open"));
   return {taskId,sessionEpoch:epoch,currentSessionEpoch:currentEpoch,
     sessionClosed,rosterSource:hasCapturedRoster?"close_snapshot":
       (closeEvent?.exists&&closeEvent.data()?.status!=="processed"?"capture_pending":"current_fallback"),
     confirmed,enrolledStudents:students.length,
     confirmedPayloadBytes:students.reduce((sum,row)=>sum+Number(row.payloadBytes||0),0),
     students};
  }

  if(["exam_session","exam_close_status"].includes(input.action)){
   if(!ctx.roles.includes("student"))deny("permission-denied","Student access is required.");
   const taskId=checkId(input.taskId,"Assessment task",128);
   const [member,task]=await Promise.all([
     membershipRef.get(),tasks.doc(taskId).get()
   ]);
   if(!member.exists||member.data().schoolId!==ctx.schoolId||member.data().status!=="active"||
      !member.data().roles?.includes("student")||!member.data().personId)
    deny("permission-denied","Active student membership is required.");
   if(!task.exists||task.data().schoolId!==ctx.schoolId||task.data().submissionSource!=="studio"||
      (task.data().manualOpenRequired!==true&&Number(task.data().manualSessionEpoch||0)<1))
    deny("not-found","This teacher-controlled Studio examination is unavailable.");
   const personId=checkId(member.data().personId,"Student person",128),
     personRef=db.doc(prefix+"people/"+personId),
     enrollmentRef=db.doc(prefix+"enrollments/"+rowKey(personId,task.data().offeringId));
   const person=await personRef.get();
   if(!person.exists||person.data().schoolId!==ctx.schoolId||
      person.data().authUid!==ctx.uid||person.data().status!=="active"||
      person.data().kind!=="student")
    deny("permission-denied","This exam history is not assigned to your school student identity.");
   if(input.action==="exam_close_status"){
    const epoch=Number(input.sessionEpoch);
    if(!Number.isSafeInteger(epoch)||epoch<1||epoch>Number(task.data().manualSessionEpoch||0))
     deny("invalid-argument","Choose a valid class session for the exam save receipt.");
    const receipt=await db.doc(prefix+"studio_exam_close_receipts/"+taskId+
      "/sessions/"+epoch+"/studio_exam_final_checkpoints/"+ctx.uid).get();
    const row=receipt.exists?receipt.data():null;
    return {taskId,sessionEpoch:epoch,confirmed:Boolean(row&&row.schoolId===ctx.schoolId&&
      row.taskId===taskId&&row.studentUid===ctx.uid&&row.closingEpoch===epoch),
      projectRevision:row?.projectRevision||null,
      savedAt:row?.savedAt?.toMillis?.()||null};
   }
   // Historical receipts above survive section transfers, but access to a
   // presently open editor still requires enrollment in this offering.
   const enrollment=await enrollmentRef.get();
   if(task.data().manualOpenRequired!==true||
      !enrollment.exists||enrollment.data().schoolId!==ctx.schoolId||
      enrollment.data().personId!==personId||enrollment.data().status!=="active"||
      enrollment.data().offeringId!==task.data().offeringId)
    deny("permission-denied","This examination is not assigned to your active enrollment.");
   const data=task.data();
   return {taskId,manualAccessState:data.manualAccessState||"waiting",
     sessionEpoch:Number(data.manualSessionEpoch||0),
     manualCloseGraceUntil:data.manualCloseGraceUntil?.toMillis?.()||0,
     published:data.published===true,lifecycle:data.lifecycle||"active",
     serverNow:Date.now()};
  }

  if(["publish","unpublish"].includes(input.action)){
   if(!ctx.roles.includes("teacher"))
    deny("permission-denied","Only an authorized teacher may change student visibility.");
   const taskId=checkId(input.taskId,"Assessment task",128),
    taskRef=tasks.doc(taskId),expectedRevision=Number(input.expectedRevision),
    publish=input.action==="publish";
   if(!Number.isInteger(expectedRevision)||expectedRevision<1)
    deny("invalid-argument","The current assessment revision is required.");
   const auditRef=db.collection(prefix+"assessment_audit").doc();
   let result;
   await db.runTransaction(async tx=>{
    const [school,membership,task]=await Promise.all([
      tx.get(schoolRef),tx.get(membershipRef),tx.get(taskRef)
    ]);
    if(!ctx.platformOverride&&(!school.exists||!["active","pilot"].includes(school.data().state)||!membership.exists||
       membership.data().schoolId!==ctx.schoolId||membership.data().status!=="active"||
       !Array.isArray(membership.data().roles)||!membership.data().roles.includes("teacher")))
      deny("permission-denied","Your school teaching access changed.");
    if(!task.exists||task.data().schoolId!==ctx.schoolId||
       (!ctx.platformOverride&&(task.data().reviewerUid||task.data().ownerUid)!==ctx.uid))
      deny("permission-denied","Only the currently responsible teacher may change publication.");
    const data=task.data(),revision=data.revision||1,lifecycle=data.lifecycle||"active",
      grantRef=db.doc(prefix+"staff_assignments/"+rowKey(ctx.uid,data.offeringId)),
      grant=await tx.get(grantRef);
    if(!ctx.platformOverride&&(!grant.exists||grant.data().schoolId!==ctx.schoolId||
       grant.data().teacherUid!==ctx.uid||grant.data().offeringId!==data.offeringId||
       grant.data().status!=="active"))
      deny("permission-denied","You must still be assigned to this course offering.");
    if(revision!==expectedRevision)
      deny("failed-precondition","This assessment changed. Reload before changing publication.");
    if(["archived","cancelled"].includes(lifecycle))
      deny("failed-precondition","Restore this assessment before changing publication.");
    if((data.published===true)===publish){
      result={taskId,published:publish,revision,alreadyCurrent:true,
        offeringId:data.offeringId,title:data.title||"Assessment"};return;
    }
    const now=FieldValue.serverTimestamp(),nextRevision=revision+1;
    tx.update(taskRef,{published:publish,revision:nextRevision,updatedAt:now,
      ...(publish?{publishedAt:now,publishedByUid:ctx.uid}:
        {unpublishedAt:now,unpublishedByUid:ctx.uid}),
      ...(!publish&&data.manualOpenRequired===true&&data.manualAccessState==="open"?
        {manualAccessState:"closed",manualClosedAt:now,manualClosedByUid:ctx.uid,
         manualClosedSessionEpoch:Number(data.manualSessionEpoch||0),
         manualCloseGraceUntil:Timestamp.fromMillis(Date.now()+60000)}:{})});
    tx.create(auditRef,{schoolId:ctx.schoolId,taskId,actorUid:ctx.uid,
      action:publish?"assessment_published":"assessment_unpublished",
      beforeRevision:revision,afterRevision:nextRevision,createdAt:now});
    if(!publish&&data.manualOpenRequired===true&&data.manualAccessState==="open"){
      const epoch=Number(data.manualSessionEpoch||0);
      tx.create(db.doc(prefix+"studio_exam_session_events/closed_"+taskId+"_"+epoch),{
        schoolId:ctx.schoolId,taskId,offeringId:data.offeringId,sessionEpoch:epoch,
        kind:"closed",title:data.title||"Practical exam",actorUid:ctx.uid,
        sourceAction:"assessment_unpublished",createdAt:now
      });
    }
    result={taskId,published:publish,revision:nextRevision,alreadyCurrent:false,
      offeringId:data.offeringId,title:data.title||"Assessment"};
   });
   if(publish&&!result.alreadyCurrent){
    const enrolled=await db.collection(prefix+"enrollments")
      .where("offeringId","==",result.offeringId).limit(101).get().catch(()=>null);
    if(enrolled&&enrolled.size<=100){
      const active=enrolled.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&doc.data().status==="active"),
        people=await Promise.all(active.map(doc=>db.doc(prefix+"people/"+doc.data().personId).get()));
      await Promise.allSettled(people.map(person=>{
        const uid=person.exists&&person.data().schoolId===ctx.schoolId&&person.data().status==="active"?
          person.data().authUid:null;
        return uid?writeSchoolNotification({
          db,schoolId:ctx.schoolId,uid,id:"assessment_published_"+taskId+"_"+result.revision,
          title:"New assessment assigned",
          body:result.title+" · open Adminerva to review the task and submission method.",
          type:"assessment",sourceId:taskId,target:"student-assessments.html"
        }):Promise.resolve();
      }));
    }
   }
   return result;
  }

  if(input.action==="update_settings"){
   if(!ctx.roles.includes("teacher"))
    deny("permission-denied","Only an authorized teacher may update assessment deployment settings.");
   const taskId=checkId(input.taskId,"Assessment task",128),
    taskRef=tasks.doc(taskId),expectedRevision=Number(input.expectedRevision),
    reason=String(input.reason||"").trim(),
    start=timestamp(input.opensAt,"Opening time"),end=timestamp(input.dueAt,"Deadline"),
    allowLateSubmissions=input.allowLateSubmissions===true,
    manualOpenRequired=input.manualOpenRequired===true;
   if(!Number.isInteger(expectedRevision)||expectedRevision<1)
    deny("invalid-argument","The current assessment revision is required.");
   if(reason.length<12||reason.length>1000)
    deny("invalid-argument","Explain the deployment change in 12–1,000 characters.");
   if(end.toMillis()<=start.toMillis())
    deny("invalid-argument","The deadline must follow the opening time.");
   const auditRef=db.collection(prefix+"assessment_audit").doc();
   let result;
   await db.runTransaction(async tx=>{
    const [school,membership,task]=await Promise.all([
      tx.get(schoolRef),tx.get(membershipRef),tx.get(taskRef)
    ]);
    if(!ctx.platformOverride&&(!school.exists||!["active","pilot"].includes(school.data().state)||!membership.exists||
       membership.data().schoolId!==ctx.schoolId||membership.data().status!=="active"||
       !Array.isArray(membership.data().roles)||!membership.data().roles.includes("teacher")))
      deny("permission-denied","Your school teaching access changed.");
    if(!task.exists||task.data().schoolId!==ctx.schoolId||
       (!ctx.platformOverride&&(task.data().reviewerUid||task.data().ownerUid)!==ctx.uid))
      deny("permission-denied","Only the currently responsible teacher may edit this deployment.");
    const data=task.data(),revision=data.revision||1,lifecycle=data.lifecycle||"active",
      grantRef=db.doc(prefix+"staff_assignments/"+rowKey(ctx.uid,data.offeringId)),
      grant=await tx.get(grantRef);
    if(!ctx.platformOverride&&(!grant.exists||grant.data().schoolId!==ctx.schoolId||
       grant.data().teacherUid!==ctx.uid||grant.data().offeringId!==data.offeringId||
       grant.data().status!=="active"))
      deny("permission-denied","You must still be assigned to this course offering.");
    if(revision!==expectedRevision)
      deny("failed-precondition","This assessment changed. Reload it before saving deployment settings.");
    if(["archived","cancelled"].includes(lifecycle))
      deny("failed-precondition","Restore this assessment before editing its deployment settings.");
    if(manualOpenRequired&&data.submissionSource!=="studio")
      deny("invalid-argument","Teacher-controlled opening requires an Adminerva Studio deployment.");
    if(data.manualOpenRequired===true&&!manualOpenRequired&&
       ["open","closed","closing"].includes(data.manualAccessState)&&
       (data.manualAccessState==="open"||Date.now()<(data.manualCloseGraceUntil?.toMillis?.()||0)))
      deny("failed-precondition","Close the current exam session and allow its final saves to finish before disabling manual opening.");
    const accessChanged=(data.manualOpenRequired===true)!==manualOpenRequired;
    const now=FieldValue.serverTimestamp(),nextRevision=revision+1;
    tx.update(taskRef,{opensAt:start,dueAt:end,allowLateSubmissions,manualOpenRequired,
      ...(accessChanged?{manualAccessState:manualOpenRequired?"waiting":"scheduled"}:{}),
      revision:nextRevision,updatedAt:now,
      lastSettingsReason:reason,lastSettingsByUid:ctx.uid});
    tx.create(auditRef,{schoolId:ctx.schoolId,taskId,actorUid:ctx.uid,
      action:"assessment_settings_updated",beforeRevision:revision,afterRevision:nextRevision,reason,
      before:{opensAt:data.opensAt,dueAt:data.dueAt,allowLateSubmissions:data.allowLateSubmissions===true,
        manualOpenRequired:data.manualOpenRequired===true,manualAccessState:data.manualAccessState||"scheduled"},
      after:{opensAt:start,dueAt:end,allowLateSubmissions,manualOpenRequired,
        manualAccessState:accessChanged?(manualOpenRequired?"waiting":"scheduled"):(data.manualAccessState||"scheduled")},
      createdAt:now});
    result={taskId,revision:nextRevision,opensAt:start.toMillis(),dueAt:end.toMillis(),
      allowLateSubmissions,manualOpenRequired,lifecycle,title:data.title||"Assessment"};
   });
   return result;
  }

  if(["close","reopen","archive","restore_archive","cancel"].includes(input.action)){
   if(!ctx.roles.includes("teacher"))
    deny("permission-denied","Only an authorized teacher may change an assessment lifecycle.");
   const taskId=checkId(input.taskId,"Assessment task",128),
    taskRef=tasks.doc(taskId),reason=String(input.reason||"").trim(),
    expectedRevision=Number(input.expectedRevision);
   if(reason.length<12||reason.length>1000)
    deny("invalid-argument","Explain the assessment lifecycle change in 12–1,000 characters.");
   if(!Number.isInteger(expectedRevision)||expectedRevision<1)
    deny("invalid-argument","The current assessment revision is required.");
   let newDueAt=null;
   if(input.action==="reopen"&&input.newDueAt){
    newDueAt=timestamp(input.newDueAt,"Reopened deadline");
    if(newDueAt.toMillis()<=Date.now()||newDueAt.toMillis()>Date.now()+90*86400000)
     deny("invalid-argument","Choose a reopened deadline within the next 90 days.");
   }
   const auditRef=db.collection(prefix+"assessment_audit").doc();
   let result;
   await db.runTransaction(async tx=>{
    const [school,membership,task]=await Promise.all([
     tx.get(schoolRef),tx.get(membershipRef),tx.get(taskRef)
    ]);
    if(!ctx.platformOverride&&(!school.exists||!["active","pilot"].includes(school.data().state)||!membership.exists||
       membership.data().schoolId!==ctx.schoolId||membership.data().status!=="active"||
       !Array.isArray(membership.data().roles)||!membership.data().roles.includes("teacher")))
      deny("permission-denied","Your school teaching access changed.");
    if(!task.exists||task.data().schoolId!==ctx.schoolId||
       (!ctx.platformOverride&&(task.data().reviewerUid||task.data().ownerUid)!==ctx.uid))
      deny("permission-denied","Only the currently responsible teacher may change this deployment.");
    const data=task.data(),revision=data.revision||1,lifecycle=data.lifecycle||"active",
      grantRef=db.doc(prefix+"staff_assignments/"+rowKey(ctx.uid,data.offeringId)),
      grant=await tx.get(grantRef);
    if(!ctx.platformOverride&&(!grant.exists||grant.data().schoolId!==ctx.schoolId||
       grant.data().teacherUid!==ctx.uid||grant.data().offeringId!==data.offeringId||
       grant.data().status!=="active"))
      deny("permission-denied","You must still be assigned to this course offering.");
    if(revision!==expectedRevision)
      deny("failed-precondition","This assessment changed. Reload it before saving the lifecycle change.");
    let next=lifecycle,extra={};
    if(input.action==="close"){
      if(lifecycle!=="active")deny("failed-precondition","Only an active assessment can be closed.");
      next="closed";
    }else if(input.action==="reopen"){
      if(lifecycle!=="closed")deny("failed-precondition","Only a closed assessment can be reopened.");
      if(data.dueAt.toMillis()<=Date.now()&&!newDueAt)
       deny("failed-precondition","The original deadline passed. Set a new deadline before reopening.");
      next="active";if(newDueAt)extra.dueAt=newDueAt;
    }else if(input.action==="archive"){
      if(!["active","closed"].includes(lifecycle))
       deny("failed-precondition","Only an active or closed assessment can be archived.");
      next="archived";extra.preArchiveLifecycle=lifecycle;
    }else if(input.action==="restore_archive"){
      if(lifecycle!=="archived")
       deny("failed-precondition","Only an archived assessment can be restored.");
      next=["active","closed"].includes(data.preArchiveLifecycle)?data.preArchiveLifecycle:"closed";
      extra.preArchiveLifecycle=FieldValue.delete();
    }else if(input.action==="cancel"){
      if(!["active","closed"].includes(lifecycle))
       deny("failed-precondition","Only an active or closed assessment can be cancelled.");
      const [studio,github,general,grades]=await Promise.all([
       tx.get(db.collection(prefix+"studio_submissions").where("taskId","==",taskId).limit(1)),
       tx.get(db.collection(prefix+"github_evidence").where("taskId","==",taskId).limit(1)),
       tx.get(db.collection(prefix+"assessment_submissions").where("taskId","==",taskId).limit(1)),
       tx.get(db.collection(prefix+"student_grades").where("taskId","==",taskId).limit(1))
      ]);
      if(!studio.empty||!github.empty||!general.empty||!grades.empty)
       deny("failed-precondition","This assessment already has submission or grade history. Close or archive it instead of cancelling.");
      next="cancelled";
    }
    const now=FieldValue.serverTimestamp(),nextRevision=revision+1;
    tx.update(taskRef,{lifecycle:next,revision:nextRevision,updatedAt:now,
      lastLifecycleReason:reason,lastLifecycleByUid:ctx.uid,...extra,
      ...(data.manualOpenRequired===true&&data.manualAccessState==="open"&&
         ["close","archive","cancel"].includes(input.action)?
        {manualAccessState:"closed",manualClosedAt:now,manualClosedByUid:ctx.uid,
         manualClosedSessionEpoch:Number(data.manualSessionEpoch||0),
         manualCloseGraceUntil:Timestamp.fromMillis(Date.now()+60000)}:{})});
    tx.create(auditRef,{schoolId:ctx.schoolId,taskId,actorUid:ctx.uid,
      action:"assessment_"+input.action,beforeLifecycle:lifecycle,afterLifecycle:next,
      beforeRevision:revision,afterRevision:nextRevision,reason,
      ...(newDueAt?{newDueAt}:{}),createdAt:now});
    if(data.manualOpenRequired===true&&data.manualAccessState==="open"&&
       ["close","archive","cancel"].includes(input.action)){
      const epoch=Number(data.manualSessionEpoch||0);
      tx.create(db.doc(prefix+"studio_exam_session_events/closed_"+taskId+"_"+epoch),{
        schoolId:ctx.schoolId,taskId,offeringId:data.offeringId,sessionEpoch:epoch,
        kind:"closed",title:data.title||"Practical exam",actorUid:ctx.uid,
        sourceAction:"assessment_"+input.action,createdAt:now
      });
    }
    result={taskId,lifecycle:next,revision:nextRevision,offeringId:data.offeringId,
      title:data.title||"Assessment",dueAt:(newDueAt||data.dueAt).toMillis()};
   });
   const enrolled=await db.collection(prefix+"enrollments")
    .where("offeringId","==",result.offeringId).limit(101).get().catch(()=>null);
   if(enrolled&&enrolled.size<=100&&["close","reopen","cancel"].includes(input.action)){
    const active=enrolled.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&doc.data().status==="active"),
     people=await Promise.all(active.map(doc=>db.doc(prefix+"people/"+doc.data().personId).get()));
    const label=input.action==="close"?"Assessment closed":
      input.action==="reopen"?"Assessment reopened":"Assessment cancelled";
    await Promise.allSettled(people.map(person=>{
     const uid=person.exists&&person.data().schoolId===ctx.schoolId&&person.data().status==="active"?
      person.data().authUid:null;
     return uid?writeSchoolNotification({
      db,schoolId:ctx.schoolId,uid,
      id:"assessment_lifecycle_"+taskId+"_"+result.revision,
      title:label,body:result.title+" · "+(input.action==="reopen"?
       "review the updated deadline in Adminerva.":"your teacher updated this task."),
      type:"assessment",sourceId:taskId,target:"student-assessments.html"
     }):Promise.resolve();
    }));
   }
   return result;
  }

  if(input.action==="get_private"){
   if(!ctx.roles.includes("teacher"))deny("permission-denied","Teacher access is required.");
   const taskId=checkId(input.taskId,"Assessment task",128),taskRef=tasks.doc(taskId);
   const task=await taskRef.get();
   if(!task.exists||task.data().schoolId!==ctx.schoolId||
      (!ctx.platformOverride&&(task.data().reviewerUid||task.data().ownerUid)!==ctx.uid))
     deny("permission-denied","This assessment is not assigned to you.");
   if(!ctx.platformOverride){
    const grant=await db.doc(prefix+"staff_assignments/"+rowKey(ctx.uid,task.data().offeringId)).get();
    if(!grant.exists||grant.data().schoolId!==ctx.schoolId||grant.data().teacherUid!==ctx.uid||
       grant.data().offeringId!==task.data().offeringId||grant.data().status!=="active")
      deny("permission-denied","This assessment's teacher assignment is no longer active.");
   }
   const privateTask=await db.doc(prefix+"assessment_private/"+taskId).get();
   if(!privateTask.exists)return {taskId,checkingInstructions:""};
   const data=privateTask.data();
   if(data.schoolId!==ctx.schoolId||data.taskId!==taskId)
     deny("failed-precondition","Private assessment configuration is invalid.");
   return {taskId,checkingInstructions:String(data.checkingInstructions||"").slice(0,8000)};
  }

  if(input.action==="list_teacher"){
   if(!ctx.roles.includes("teacher"))deny("permission-denied","Teacher access is required.");
   let docs;
   if(ctx.platformOverride){
    const all=await tasks.limit(201).get();
    if(all.size===201)deny("resource-exhausted","Assessment deployment list requires pagination.");
    docs=all.docs.filter(doc=>doc.data().schoolId===ctx.schoolId);
   }else{
    const [owned,responsible]=await Promise.all([
      tasks.where("ownerUid","==",ctx.uid).limit(101).get(),
      tasks.where("reviewerUid","==",ctx.uid).limit(101).get()
    ]);
    if(owned.size===101||responsible.size===101)
      deny("resource-exhausted","Assessment deployment list requires pagination.");
    const unique=new Map();
    for(const doc of [...owned.docs,...responsible.docs])
      if(doc.data().schoolId===ctx.schoolId&&(doc.data().reviewerUid||doc.data().ownerUid)===ctx.uid)
        unique.set(doc.id,doc);
    docs=[...unique.values()];
   }
   return {assessments:docs.map(doc=>({
      taskId:doc.id,title:doc.data().title,description:doc.data().description||"",
      instructions:doc.data().instructions||"",subject:doc.data().subject||doc.data().subjectId||"General",
      assessmentType:doc.data().assessmentType||"Assessment",
      rubric:doc.data().rubric||[],
      rubricMax:doc.data().rubricMax||0,offeringId:doc.data().offeringId,
      yearId:doc.data().yearId,termId:doc.data().termId,
      subjectId:doc.data().subjectId,sectionId:doc.data().sectionId,
      ownerUid:doc.data().ownerUid,reviewerUid:doc.data().reviewerUid||doc.data().ownerUid,
      opensAt:doc.data().opensAt?.toMillis(),dueAt:doc.data().dueAt?.toMillis(),
      allowLateSubmissions:doc.data().allowLateSubmissions===true,
      manualOpenRequired:doc.data().manualOpenRequired===true,
      manualAccessState:doc.data().manualOpenRequired===true?(doc.data().manualAccessState||"waiting"):"scheduled",
      manualSessionEpoch:Number(doc.data().manualSessionEpoch||0),
      manualCloseGraceUntil:doc.data().manualCloseGraceUntil?.toMillis?.()||0,
      submissionSource:doc.data().submissionSource,
      studioProjectProfile:doc.data().studioProjectProfile||"auto",
      personalizedTask:doc.data().personalizedTask?.enabled===true?{
        enabled:true,mode:doc.data().personalizedTask.mode,
        poolFingerprint:doc.data().personalizedTask.poolFingerprint,
        poolSize:doc.data().personalizedTask.poolSize,
        poolTarget:doc.data().personalizedTask.poolTarget
      }:{enabled:false,mode:"standard"},
      status:doc.data().status,published:doc.data().published===true,
      lifecycle:doc.data().lifecycle||"active",revision:doc.data().revision||1
    })).sort((a,b)=>(b.dueAt||0)-(a.dueAt||0))};
  }
  if(input.action==="list_student"){
   if(!ctx.roles.includes("student"))deny("permission-denied","Student access is required.");
   const member=await membershipRef.get();
   const personId=member.data()?.personId;
   if(!personId||member.data()?.status!=="active")
    deny("failed-precondition","Your verified school person record must be linked before assignments are available.");
   checkId(personId,"Student person ID",128);
   const person=await db.doc(prefix+"people/"+personId).get();
   if(!person.exists||person.data().schoolId!==ctx.schoolId||
     person.data().kind!=="student"||person.data().authUid!==ctx.uid)
    deny("permission-denied","Student identity and school membership do not match.");
   const enrollments=await db.collection(prefix+"enrollments")
     .where("personId","==",personId).limit(101).get();
   if(enrollments.size===101)deny("resource-exhausted","Your enrollment history needs pagination.");
   const offered=[...new Set(enrollments.docs.filter(doc=>
    doc.data().schoolId===ctx.schoolId&&doc.data().status==="active")
     .map(doc=>doc.data().offeringId))];
   const results=[];
   for(let offset=0;offset<offered.length;offset+=30) {
    const ids=offered.slice(offset,offset+30);
    if(!ids.length)continue;
    const snap=await tasks.where("offeringId","in",ids).limit(100).get();
    if(snap.size===100)deny("resource-exhausted","Too many assigned assessments. A paginated class view is required.");
    for(const doc of snap.docs){
     const task=doc.data();
     const lifecycle=task.lifecycle||"active";
     if(task.schoolId!==ctx.schoolId||task.status!=="deployed"||task.published!==true||
        ["archived","cancelled"].includes(lifecycle)||!offered.includes(task.offeringId))continue;
     const now=Date.now(),open=task.opensAt.toMillis(),due=task.dueAt.toMillis();
     const manualExam=task.submissionSource==="studio"&&task.manualOpenRequired===true;
     const waiting=manualExam&&task.manualAccessState!=="open";
     results.push({taskId:doc.id,title:task.title,description:waiting?"":task.description||"",
      instructions:waiting?"":task.instructions||"",subject:task.subject||task.subjectId||"General",
      assessmentType:task.assessmentType||"Assessment",rubric:waiting?[]:task.rubric||[],
      rubricMax:waiting?0:task.rubricMax,offeringId:task.offeringId,
      submissionSource:task.submissionSource,
      studioProjectProfile:task.studioProjectProfile||"auto",
      personalizedTask:task.personalizedTask?.enabled===true?{
        enabled:true,mode:task.personalizedTask.mode,
        poolSize:Number(task.personalizedTask.poolSize||0)
      }:{enabled:false,mode:"standard"},
      opensAt:open,dueAt:due,postedAt:task.createdAt?.toMillis?.()||open,
      manualOpenRequired:manualExam,manualAccessState:manualExam?(task.manualAccessState||"waiting"):"scheduled",
      manualSessionEpoch:manualExam?Number(task.manualSessionEpoch||0):0,
      allowLateSubmissions:task.allowLateSubmissions===true,
      late:task.allowLateSubmissions===true&&now>due,
      lifecycle,submissionDeadlinePassed:now>due&&task.allowLateSubmissions!==true,
      windowStatus:lifecycle==="closed"?"closed":
       waiting?"waiting_for_teacher":(!manualExam&&now<open)?"upcoming":
       (!manualExam&&now>due&&task.allowLateSubmissions!==true)?"closed":"open"});
    }
   }
   return {assignments:results.sort((a,b)=>a.dueAt-b.dueAt)};
  }
  deny("invalid-argument","Unknown school assessment operation.");
 };
}
module.exports={createSchoolAssessmentService,timestamp,activeOfferingPeople};
