/** Server-issued personalized Adminerva Studio assessment variants. */
const {randomBytes,createHash}=require("node:crypto");

const GENERATOR_ID="java_logic_written_work_v1";
const hash=value=>createHash("sha256").update(value).digest("hex");
const deny=(code,message)=>{const error=Error(message);error.code=code;throw error;};
const cleanId=(value,label)=>{
  const text=String(value||"");
  if(!/^[A-Za-z0-9_-]{1,160}$/.test(text))deny("invalid-argument",label+" is invalid.");
  return text;
};
const activeStudent=data=>data&&data.active!==false&&!["disabled","archived","suspended"].includes(String(data.status||"active"));

const nameSets=[
  ["emberCount","signalLimit","finalScore"],
  ["orbitPoints","boostValue","missionTotal"],
  ["cedarStock","orderSize","stockResult"],
  ["pixelScore","bonusStep","displayTotal"],
  ["riverLevel","changeValue","levelResult"],
  ["novaCredits","costValue","creditResult"],
  ["maplePoints","roundValue","gameTotal"],
  ["atlasCount","stepValue","countResult"]
];
const passLabels=["READY","PASS","GO","ACCEPT","LEVEL-UP","VALID"];
const failLabels=["RETRY","HOLD","WAIT","CHECK","REVISE","NOT-YET"];

function byte(entropy,index){return entropy[index%entropy.length];}
function between(entropy,index,min,max){return min+(byte(entropy,index)%(max-min+1));}
function pick(list,entropy,index){return list[byte(entropy,index)%list.length];}

function buildJavaLogicVariant(entropy){
  if(!Buffer.isBuffer(entropy)||entropy.length<16)throw Error("Variant entropy must contain at least 16 bytes.");
  const names=pick(nameSets,entropy,0),first=between(entropy,1,8,24),second=between(entropy,2,3,12),
    factor=between(entropy,3,2,4),adjust=between(entropy,4,2,9),
    pass=pick(passLabels,entropy,5),fail=pick(failLabels,entropy,6),family=byte(entropy,7)%4;
  const [left,right,result]=names;
  let expression,threshold,scenario;
  if(family===0){
    expression=left+" + "+right+" * "+factor;
    threshold=first+second*factor-between(entropy,8,0,5);
    scenario="Compute a weighted total, then make a decision.";
  }else if(family===1){
    expression=left+" * "+factor+" - "+right;
    threshold=first*factor-second-between(entropy,8,0,4);
    scenario="Compute an adjusted total, then make a decision.";
  }else if(family===2){
    expression=left+" + "+right+" + "+adjust;
    threshold=first+second+adjust-between(entropy,8,0,5);
    scenario="Apply a fixed adjustment, then make a decision.";
  }else{
    expression="("+left+" - "+right+") * "+factor;
    threshold=(first-second)*factor-between(entropy,8,0,4);
    scenario="Compute a difference-based total, then make a decision.";
  }
  threshold=Math.max(4,threshold);
  const prompt=[
    "PERSONALIZED JAVA LOGIC WRITTEN WORK",
    "",
    scenario,
    "",
    "Create a Java console program that follows ALL of these requirements:",
    "1. Declare an int variable named `"+left+"` and assign it the value "+first+".",
    "2. Declare an int variable named `"+right+"` and assign it the value "+second+".",
    "3. Declare an int variable named `"+result+"` and compute it using this exact expression:",
    "   "+result+" = "+expression+";",
    "4. Use an if/else statement to test whether `"+result+" >= "+threshold+"`.",
    "5. If the condition is true, print exactly: "+pass+": <value of "+result+">",
    "6. Otherwise, print exactly: "+fail+": <value of "+result+">",
    "7. Do not hard-code the final numeric result in the print statement. Print the variable.",
    "8. Keep the program readable and properly indented.",
    "",
    "Use the exact variable names and values shown above. Your assigned version is different from other learners' versions."
  ].join("\n");
  return {
    generatorId:GENERATOR_ID,
    prompt,
    publicSpec:{language:"java",variableNames:[left,right,result],values:[first,second],threshold,passLabel:pass,failLabel:fail},
    teacherSpec:{expression,family}
  };
}
function candidate(){
  const variant=buildJavaLogicVariant(randomBytes(24));
  const variantKey=hash(variant.prompt);
  return {...variant,variantKey,variantId:variantKey.slice(0,16)};
}
function timeMillis(value){return value?.toMillis?.()||0;}

function createStudioAssessmentVariantService({db,Timestamp}){
  async function assessmentRecord(assessmentId){
    const record=await db.doc("assessments/"+assessmentId).get();
    if(!record.exists)deny("not-found","This assessment is unavailable.");
    const data=record.data();
    if(data.schemaVersion!==3||data.submissionSource!=="studio"||data.personalizedTask?.enabled!==true)
      deny("failed-precondition","This assessment does not use personalized Studio tasks.");
    if(data.personalizedTask?.generator!==GENERATOR_ID)
      deny("failed-precondition","This personalized task generator is not supported.");
    return {ref:record.ref,data};
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
    if(!entry)return false;
    return now>=timeMillis(entry.opensAt)&&now<=timeMillis(entry.closesAt);
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
    const actor=request.auth||{},input=request.data||{},assessmentId=cleanId(input.assessmentId,"Assessment");
    const {data:assessment}=await assessmentRecord(assessmentId);
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
        generatorId:data.generatorId,createdAt:timeMillis(data.createdAt),publicSpec:data.publicSpec||null};
    }
    const student=await studentFor(actor,assessment),now=Date.now(),headRef=db.doc("studio_submissions/"+student.id+"_"+assessmentId),
      head=await headRef.get(),headData=head.exists?head.data():null;
    let attempt=1,readOnly=false;
    if(headData){
      const revision=Number(headData.revision)||1;
      if(headData.status==="revision_requested")attempt=revision+1;
      else {attempt=revision;readOnly=["submitted","reviewed"].includes(headData.status);}
    }
    if(attempt>30)deny("failed-precondition","The Studio revision limit was reached.");
    const variantRef=db.doc("studio_assessment_variants/"+student.id+"_"+assessmentId+"/attempts/"+attempt),
      existing=await variantRef.get();
    if(existing.exists){
      const data=existing.data();
      return {assessmentId,studentId:student.id,attempt,variantId:data.variantId,prompt:data.prompt,
        generatorId:data.generatorId,createdAt:timeMillis(data.createdAt),readOnly,publicSpec:data.publicSpec||null};
    }
    if(readOnly)deny("failed-precondition","The submitted revision has no recorded personalized task.");
    if(!windowOpen(assessment,student.section,now))
      deny("failed-precondition","This personalized task cannot start outside the Studio submission window.");
    const candidates=Array.from({length:8},candidate);
    const root=db.doc("studio_assessment_variants/"+student.id+"_"+assessmentId);
    let result;
    await db.runTransaction(async tx=>{
      const latestHead=await tx.get(headRef);
      let currentAttempt=1;
      if(latestHead.exists){
        const data=latestHead.data(),revision=Number(data.revision)||1;
        currentAttempt=data.status==="revision_requested"?revision+1:revision;
      }
      if(currentAttempt!==attempt)deny("failed-precondition","Submission status changed. Reload the assignment before starting a new task.");
      const current=await tx.get(variantRef);
      if(current.exists){result=current.data();return;}
      const registryRefs=candidates.map(item=>db.doc("studio_assessment_variant_registry/"+assessmentId+"/keys/"+item.variantKey));
      const registry=await Promise.all(registryRefs.map(ref=>tx.get(ref)));
      const previous=attempt>1?await tx.get(db.doc(root.path+"/attempts/"+(attempt-1))):null;
      const previousKey=previous?.exists?previous.data().variantKey:null;
      let index=registry.findIndex((record,i)=>!record.exists&&candidates[i].variantKey!==previousKey);
      if(index<0)deny("resource-exhausted","Could not allocate a unique task variant. Reload and try again.");
      const chosen=candidates[index],createdAt=Timestamp.fromMillis(now);
      result={assessmentId,studentId:student.id,ownerUid:actor.uid,section:student.section,attempt,
        variantId:chosen.variantId,variantKey:chosen.variantKey,generatorId:chosen.generatorId,
        prompt:chosen.prompt,publicSpec:chosen.publicSpec,teacherSpec:chosen.teacherSpec,createdAt};
      tx.create(registryRefs[index],{studentId:student.id,attempt,variantId:chosen.variantId,createdAt});
      tx.create(variantRef,result);
    });
    return {assessmentId,studentId:student.id,attempt,variantId:result.variantId,prompt:result.prompt,
      generatorId:result.generatorId,createdAt:timeMillis(result.createdAt),readOnly:false,publicSpec:result.publicSpec||null};
  };
}
module.exports={createStudioAssessmentVariantService,buildJavaLogicVariant,GENERATOR_ID};
