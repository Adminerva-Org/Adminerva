/** Assigns server-owned personalized Adminerva Studio variants from a teacher-approved private pool. */
const {randomBytes}=require("node:crypto");

const PERSONALIZATION_MODE="ai_blueprint_pool_v1";
const deny=(code,message)=>{const error=Error(message);error.code=code;throw error;};
const cleanId=(value,label)=>{
  const text=String(value||"");
  if(!/^[A-Za-z0-9_-]{1,160}$/.test(text))deny("invalid-argument",label+" is invalid.");
  return text;
};
const activeStudent=data=>data&&data.active!==false&&!["disabled","archived","suspended"].includes(String(data.status||"active"));
const millis=value=>value?.toMillis?.()||0;
const chooseIndex=max=>max>1?randomBytes(4).readUInt32BE(0)%max:0;

function validPool(privateData,assessment){
  const personalization=privateData?.personalization;
  if(!personalization||personalization.mode!==PERSONALIZATION_MODE)
    deny("failed-precondition","This personalized assessment has no generated task pool.");
  if(typeof personalization.fingerprint!=="string"||!personalization.fingerprint||
     personalization.fingerprint!==assessment.personalizedTask?.poolFingerprint)
    deny("failed-precondition","The personalized task pool is stale. Ask your teacher to regenerate it.");
  const variants=Array.isArray(personalization.variants)?personalization.variants:[];
  const clean=variants.filter(item=>item&&typeof item.variantId==="string"&&
    /^[a-f0-9]{16,64}$/.test(item.variantId)&&typeof item.prompt==="string"&&
    item.prompt.trim().length>=20&&item.prompt.length<=12000&&
    typeof item.evaluationNotes==="string"&&item.evaluationNotes.length<=8000);
  if(clean.length!==variants.length||clean.length<1)
    deny("failed-precondition","The personalized task pool is incomplete. Ask your teacher to regenerate it.");
  if(new Set(clean.map(item=>item.variantId)).size!==clean.length)
    deny("failed-precondition","The personalized task pool contains duplicate variant IDs.");
  return clean;
}

function createStudioAssessmentVariantService({db,Timestamp}){
  async function assessmentRecord(assessmentId){
    const record=await db.doc("assessments/"+assessmentId).get();
    if(!record.exists)deny("not-found","This assessment is unavailable.");
    const data=record.data();
    if(data.schemaVersion!==3||data.submissionSource!=="studio"||
       data.personalizedTask?.enabled!==true||
       data.personalizedTask?.mode!==PERSONALIZATION_MODE)
      deny("failed-precondition","This assessment does not use personalized Studio tasks.");
    const privateRecord=await db.doc("assessment_private/"+assessmentId).get();
    if(!privateRecord.exists)deny("failed-precondition","This assessment's private personalization configuration is unavailable.");
    const pool=validPool(privateRecord.data(),data);
    return {data,pool};
  }

  async function studentFor(actor,assessment){
    const email=String(actor.token?.email||"").toLowerCase().trim();
    if(!actor.uid||actor.token?.email_verified!==true||!email)
      deny("unauthenticated","Use a verified school account before opening a personalized task.");
    const snap=await db.collection("students").where("email","==",email).limit(20).get();
    const matches=snap.docs.filter(record=>{
      const data=record.data();
      return activeStudent(data)&&Array.isArray(assessment.sectionIds)&&assessment.sectionIds.includes(data.section);
    });
    if(!matches.length)deny("permission-denied","This assessment is not assigned to your verified class.");
    if(matches.length>1){
      const distinct=[...new Set(matches.map(record=>record.data().section))];
      if(distinct.length>1)deny("failed-precondition","This account has multiple matching class records. Open the assignment from My Assessments.");
    }
    const record=matches[0];
    return {id:record.id,...record.data()};
  }

  function windowOpen(assessment,section,now){
    const entry=assessment.studioWindows?.[section];
    return Boolean(entry)&&now>=millis(entry.opensAt)&&now<=millis(entry.closesAt);
  }

  async function authorizeTeacher(actor,assessment,student){
    const email=String(actor.token?.email||"").toLowerCase().trim();
    if(!actor.uid||actor.token?.email_verified!==true||!email)
      deny("unauthenticated","Use a verified staff account.");
    if(assessment.ownerUid===actor.uid)return;
    const access=await db.doc("staff_access/"+email).get();
    const data=access.exists?access.data():null;
    if(data?.status==="active"&&data.role==="admin")return;
    if(data?.status==="active"&&data.role==="teacher"&&Array.isArray(data.sections)&&data.sections.includes(student.section))return;
    deny("permission-denied","You are not authorized to inspect this learner's personalized task.");
  }

  return async request=>{
    const actor=request.auth||{},input=request.data||{},
      assessmentId=cleanId(input.assessmentId,"Assessment"),
      {data:assessment,pool}=await assessmentRecord(assessmentId);

    if(input.action==="inspect"){
      const studentId=cleanId(input.studentId,"Student"),attempt=Number(input.attempt);
      if(!Number.isInteger(attempt)||attempt<1||attempt>30)deny("invalid-argument","Attempt number is invalid.");
      const studentRecord=await db.doc("students/"+studentId).get();
      if(!studentRecord.exists)deny("not-found","Student record unavailable.");
      const student={id:studentRecord.id,...studentRecord.data()};
      await authorizeTeacher(actor,assessment,student);
      const variant=await db.doc("studio_assessment_variants/"+studentId+"_"+assessmentId+"/attempts/"+attempt).get();
      if(!variant.exists)deny("not-found","No personalized task was recorded for this submitted revision.");
      const data=variant.data();
      return {assessmentId,studentId,attempt,variantId:data.variantId,prompt:data.prompt,
        evaluationNotes:data.evaluationNotes||"",createdAt:millis(data.createdAt),readOnly:true};
    }

    const student=await studentFor(actor,assessment),now=Date.now(),
      headRef=db.doc("studio_submissions/"+student.id+"_"+assessmentId),
      head=await headRef.get(),headData=head.exists?head.data():null;
    let attempt=1,readOnly=false;
    if(headData){
      const revision=Number(headData.revision)||1;
      if(headData.status==="revision_requested")attempt=revision+1;
      else {attempt=revision;readOnly=["submitted","reviewed"].includes(headData.status);}
    }
    if(attempt>30)deny("failed-precondition","The Studio revision limit was reached.");

    const rootRef=db.doc("studio_assessment_variants/"+student.id+"_"+assessmentId),
      variantRef=db.doc(rootRef.path+"/attempts/"+attempt),
      existing=await variantRef.get();
    if(existing.exists){
      const data=existing.data();
      if(data.poolFingerprint!==assessment.personalizedTask.poolFingerprint)
        deny("failed-precondition","The task pool changed after this attempt was issued. Ask your teacher to review the assessment.");
      return {assessmentId,studentId:student.id,attempt,variantId:data.variantId,prompt:data.prompt,
        createdAt:millis(data.createdAt),readOnly};
    }
    if(readOnly)deny("failed-precondition","The submitted revision has no recorded personalized task.");
    if(!windowOpen(assessment,student.section,now))
      deny("failed-precondition","This personalized task cannot start outside the Studio submission window.");

    const registryRef=db.doc("studio_assessment_variant_registry/"+assessmentId);
    let result;
    await db.runTransaction(async tx=>{
      const [latestHead,current,registry]=await Promise.all([
        tx.get(headRef),tx.get(variantRef),tx.get(registryRef)
      ]);
      let currentAttempt=1;
      if(latestHead.exists){
        const data=latestHead.data(),revision=Number(data.revision)||1;
        currentAttempt=data.status==="revision_requested"?revision+1:revision;
      }
      if(currentAttempt!==attempt)
        deny("failed-precondition","Submission status changed. Reload the assignment before starting a new task.");
      if(current.exists){result=current.data();return;}

      const used=new Set(Array.isArray(registry.data()?.usedVariantIds)?registry.data().usedVariantIds:[]);
      const available=pool.filter(item=>!used.has(item.variantId));
      if(!available.length)
        deny("resource-exhausted","All personalized task variants are already assigned. Ask your teacher to add more variants.");
      const chosen=available[chooseIndex(available.length)],createdAt=Timestamp.fromMillis(now);
      result={
        assessmentId,studentId:student.id,ownerUid:actor.uid,section:student.section,attempt,
        variantId:chosen.variantId,prompt:chosen.prompt,evaluationNotes:chosen.evaluationNotes||"",
        poolFingerprint:assessment.personalizedTask.poolFingerprint,createdAt
      };
      tx.create(variantRef,result);
      tx.set(registryRef,{
        assessmentId,poolFingerprint:assessment.personalizedTask.poolFingerprint,
        usedVariantIds:[...used,chosen.variantId],updatedAt:createdAt
      },{merge:false});
    });
    return {assessmentId,studentId:student.id,attempt,variantId:result.variantId,prompt:result.prompt,
      createdAt:millis(result.createdAt),readOnly:false};
  };
}

module.exports={createStudioAssessmentVariantService,PERSONALIZATION_MODE,validPool};
