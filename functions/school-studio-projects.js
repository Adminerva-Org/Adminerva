"use strict";
/** School-owned Adminerva Studio project persistence for V4 students. */
const {FieldValue}=require("firebase-admin/firestore");
const {createHash}=require("node:crypto");
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");
const {checkId,rowKey}=require("./school-academics.js");
const {studentAccountUids,studentRecordUidAllowed}=require("./student-account-history.js");
function deny(code,message){throw new TenantAccessError(code,message)}
function safeTitle(value){
 if(typeof value!=="string"||!value.trim()||value.trim().length>120)
  deny("invalid-argument","Provide a project name of 1–120 characters.");
 return value.trim();
}
function validateFiles(files){
 if(!Array.isArray(files)||files.length>100)
  deny("invalid-argument","A Studio project may contain up to 100 text files.");
 const checked=[],paths=new Set();let total=0;
 for(const row of files){
  const path=row?.path,content=row?.content;
  if(typeof path!=="string"||path.length>180||!path||
    path.startsWith("/")||path.includes("\\")||
    path.split("/").some(p=>!p||p==="."||p===".."||
      p===".git"||p==="node_modules")||
    /[\u0000-\u001f\u007f]/.test(path))
   deny("invalid-argument","A project contains an invalid file path.");
  if(paths.has(path))deny("invalid-argument","Duplicate file path: "+path);
  if(typeof content!=="string")deny("invalid-argument","Only text source files can be saved.");
  const size=Buffer.byteLength(content,"utf8");
  if(size>150000)deny("invalid-argument","A single source file exceeds 150 KB.");
  total+=size;
  if(total>600000)deny("invalid-argument","The project source exceeds the 600 KB save limit.");
  paths.add(path);checked.push({path,content});
 }
 return checked.sort((a,b)=>a.path.localeCompare(b.path));
}
function validateArtifacts(value){
 const source=value&&typeof value==="object"?value:{};
 let json;
 try{json=JSON.stringify(source);}
 catch{deny("invalid-argument","Project design/database artifacts must be JSON-serializable.");}
 if(Buffer.byteLength(json,"utf8")>180000)
  deny("invalid-argument","Project database/design artifacts exceed the 180 KB save limit.");
 const parsed=JSON.parse(json);
 function safe(node){
  if(!node||typeof node!=="object")return;
  for(const [key,child] of Object.entries(node)){
   if(["__proto__","prototype","constructor"].includes(key))
    deny("invalid-argument","Project artifacts contain a reserved field name.");
   safe(child);
  }
 }
 safe(parsed);return parsed;
}
function canonicalJson(value){
 function normalize(node){
  if(node===null||typeof node==="string"||typeof node==="boolean")return node;
  if(typeof node==="number"){
   if(!Number.isFinite(node))deny("invalid-argument","Project data contains a non-finite number.");
   return Object.is(node,-0)?0:node;
  }
  if(Array.isArray(node))return node.map(normalize);
  if(node&&typeof node==="object"){
   const result={};
   for(const key of Object.keys(node).sort())result[key]=normalize(node[key]);
   return result;
  }
  deny("invalid-argument","Project data contains an unsupported value.");
 }
 return JSON.stringify(normalize(value));
}
function digestProject(files,artifacts={}){
 return createHash("sha256").update(canonicalJson({files,artifacts})).digest("hex");
}
function digestSource(files,language=""){
 return createHash("sha256").update(canonicalJson({language:String(language||""),files})).digest("hex");
}
function digestFiles(files){return digestProject(files,{});}
function createSchoolStudioProjectService({db}){
 return async request=>{
  const input=request.data||{},ctx=await getSchoolContext({
   db,request,schoolId:input.schoolId,roles:["student"]
  });
  const prefix="schools/"+ctx.schoolId+"/";
  const projectCollection=db.collection(prefix+"student_code_projects/"+ctx.uid+"/projects");
  const membershipRef=db.doc(prefix+"memberships/"+ctx.uid);
  const schoolRef=db.doc("platform_schools/"+ctx.schoolId);
  async function loadStudentIdentity(tx=null){
   const read=ref=>tx?tx.get(ref):ref.get();
   const [school,member]=await Promise.all([read(schoolRef),read(membershipRef)]);
   if(!school.exists||!["active","pilot"].includes(school.data().state)||!member.exists||
      member.data().schoolId!==ctx.schoolId||member.data().status!=="active"||
      !Array.isArray(member.data().roles)||!member.data().roles.includes("student"))
    deny("permission-denied","Your school student membership is no longer active.");
   const personId=checkId(member.data().personId,"Student person",128),
     personRef=db.doc(prefix+"people/"+personId),person=await read(personRef);
   if(!person.exists||person.data().schoolId!==ctx.schoolId||person.data().kind!=="student"||
      person.data().status!=="active"||person.data().authUid!==ctx.uid)
    deny("permission-denied","Your verified school student identity is no longer active.");
   return {personId,person:person.data(),accountUids:studentAccountUids(person.data(),ctx.uid)};
  }
  async function findProject(identity,projectId,tx=null){
   const read=ref=>tx?tx.get(ref):ref.get(),
     candidates=identity.accountUids.map(uid=>({
       uid,ref:db.doc(prefix+"student_code_projects/"+uid+"/projects/"+projectId)
     })),
     docs=await Promise.all(candidates.map(row=>read(row.ref))),
     matches=candidates.map((row,index)=>({...row,doc:docs[index]})).filter(row=>row.doc.exists&&
       row.doc.data().schoolId===ctx.schoolId&&row.doc.data().ownerUid===row.uid&&
       studentRecordUidAllowed(identity.person,ctx.uid,row.doc.data().ownerUid));
   if(matches.length>1)
    deny("data-loss","Multiple cloud projects share this project ID across recovered account history.");
   const current=candidates[0],currentIndex=0;
   return matches[0]||{...current,doc:docs[currentIndex]};
  }
  async function listProjectHistory(identity){
   const pages=await Promise.all(identity.accountUids.map(uid=>
     db.collection(prefix+"student_code_projects/"+uid+"/projects").limit(101).get()));
   const rows=[];
   for(let index=0;index<pages.length;index++){
    const uid=identity.accountUids[index],page=pages[index];
    for(const doc of page.docs){
      const data=doc.data();
      if(data.schoolId===ctx.schoolId&&data.ownerUid===uid&&
         studentRecordUidAllowed(identity.person,ctx.uid,data.ownerUid))
        rows.push(doc);
    }
   }
   if(rows.length>100)
    deny("resource-exhausted","Project history requires pagination after account recovery.");
   return rows;
  }

  async function authorizeAssessmentProject(tx,artifacts,{closingEpoch=0}={}){
   const binding=artifacts?.assessment;
   if(binding?.provisionedBy!=="assessment-launch")return {finalSave:false};
   const taskId=checkId(binding.taskId||binding.assessmentId,"Assessment task",128);
   const task=await tx.get(db.doc(prefix+"assessments/"+taskId));
   if(!task.exists||task.data().schoolId!==ctx.schoolId||
      task.data().submissionSource!=="studio")
    deny("failed-precondition","This Studio assessment is no longer available.");
   const data=task.data();
   if(data.manualOpenRequired!==true)return {finalSave:false};
   // A project marked for another offering must not be accepted as evidence
   // for this task's class, even if an old browser supplies a valid task ID.
   if(binding.offeringId!==data.offeringId)
    deny("permission-denied","This assessment project is bound to a different course offering.");
   // Verify the student belongs to this exact section on every protected save,
   // including when a new class session reuses a previously saved project.
   const member=await tx.get(membershipRef),
     personId=checkId(member.data()?.personId,"Student person",128);
   const [person,enrollment]=await Promise.all([
     tx.get(db.doc(prefix+"people/"+personId)),
     tx.get(db.doc(prefix+"enrollments/"+rowKey(personId,data.offeringId)))
   ]);
   if(!person.exists||person.data().schoolId!==ctx.schoolId||
      person.data().kind!=="student"||person.data().status!=="active"||
      person.data().authUid!==ctx.uid)
    deny("permission-denied","Your school student identity is no longer verified for this exam.");
   if(!enrollment.exists||enrollment.data().schoolId!==ctx.schoolId||
      enrollment.data().personId!==personId||enrollment.data().offeringId!==data.offeringId||
      enrollment.data().status!=="active")
    deny("permission-denied","Your school enrollment is no longer active for this exam.");
   const epoch=Number(data.manualSessionEpoch||0);
   if(data.manualAccessState==="open") {
    if(closingEpoch)deny("failed-precondition","Exam closing state changed. Reload the assessment.");
    if(epoch<1||Number(binding.sessionEpoch||0)!==epoch)
      deny("failed-precondition","This project belongs to an earlier exam session. Reopen the assessment from My Assessments.");
    return {finalSave:false,taskId,personId};
   }
   if(["closed","closing"].includes(data.manualAccessState)&&closingEpoch>0&&
      Number(binding.sessionEpoch||0)===closingEpoch&&epoch===closingEpoch){
    // Expired closure permits a read-only replay of a checkpoint that was
    // already committed, never creation of a new checkpoint or project write.
    const graceEnd=data.manualCloseGraceUntil?.toMillis?.()||0;
    return {finalSave:true,taskId,closingEpoch,personId,
      receiptLookupOnly:Date.now()>graceEnd};
   }
   deny("failed-precondition","The Studio exam is closed to edits. Only an authorized final closing checkpoint may be saved.");
  }
  async function authorizeTransaction(tx) {
   return loadStudentIdentity(tx);
  }
  const action=input.action;
  if(action==="list"||action==="list_archived"){
   const identity=await loadStudentIdentity(),docs=await listProjectHistory(identity),
     archived=action==="list_archived";
   return {projects:docs.filter(d=>(d.data().status==="archived")===archived)
    .map(d=>({projectId:d.id,title:d.data().title,language:d.data().language,
      revision:d.data().revision,status:d.data().status||"active",
      updatedAt:d.data().updatedAt?.toMillis?.()||null,
      ...(archived?{archivedAt:d.data().archivedAt?.toMillis?.()||null}:{})}))
    .sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))};
  }
  if(action==="create"){
   const title=safeTitle(input.title),files=validateFiles(input.files||[]),artifacts=validateArtifacts(input.artifacts);
   const language=input.language;
   if(!["java","web","python","csharp","cpp","dart","text"].includes(language))
    deny("invalid-argument","Choose a supported Studio project language.");
   const ref=projectCollection.doc(),now=FieldValue.serverTimestamp();
   await db.runTransaction(async tx=>{
    await authorizeTransaction(tx);
    await authorizeAssessmentProject(tx,artifacts);
    tx.create(ref,{schoolId:ctx.schoolId,ownerUid:ctx.uid,title,
      language,files,artifacts,contentDigest:digestProject(files,artifacts),sourceDigest:digestSource(files,language),status:"active",revision:1,
      createdAt:now,updatedAt:now});
   });
   return {projectId:ref.id,revision:1,contentDigest:digestProject(files,artifacts)};
  }
  if(action==="sync"){
   const projectId=checkId(input.projectId,"Project ID",128);
   const title=safeTitle(input.title),files=validateFiles(input.files||[]);
   const artifacts=validateArtifacts(input.artifacts),language=input.language;
   if(!["java","web","python","csharp","cpp","dart","text"].includes(language))
    deny("invalid-argument","Choose a supported Studio project language.");
   const digest=digestProject(files,artifacts),
     closingEpoch=Number(input.closingSaveSessionEpoch||0);
   if(closingEpoch&&(!Number.isSafeInteger(closingEpoch)||closingEpoch<1))
    deny("invalid-argument","The closing exam session number is invalid.");
   let result;
   await db.runTransaction(async tx=>{
    const identity=await authorizeTransaction(tx),
      located=await findProject(identity,projectId,tx),ref=located.ref,current=located.doc;
    const access=await authorizeAssessmentProject(tx,artifacts,{closingEpoch});
    if(current.exists){
     const oldBinding=current.data().artifacts?.assessment,
       newBinding=artifacts.assessment;
     if(oldBinding?.provisionedBy==="assessment-launch"){
      if(newBinding?.provisionedBy!=="assessment-launch"||
         (oldBinding.taskId||oldBinding.assessmentId)!==(newBinding.taskId||newBinding.assessmentId))
       deny("permission-denied","An assessment project cannot be detached from, or reassigned to, another exam.");
      // The prior cloud project may be bound to the previous class epoch.
      // Authorize the current incoming epoch without rejecting valid resumes.
     }else if(closingEpoch)
      deny("failed-precondition","A final exam checkpoint must belong to an existing assessment project.");
    }
    const receiptRef=access.finalSave?
      db.doc(prefix+"studio_exam_close_receipts/"+access.taskId+
        "/sessions/"+closingEpoch+"/studio_exam_final_checkpoints/"+ctx.uid):null;
    const priorReceipt=receiptRef?await tx.get(receiptRef):null;
    if(priorReceipt?.exists){
      if(priorReceipt.data().projectId!==projectId||
         priorReceipt.data().contentDigest!==digest||
         priorReceipt.data().sourceDigest!==digestSource(files,language)||
         priorReceipt.data().title!==title)
       deny("failed-precondition","This exam session already has a different final saved checkpoint.");
      result={projectId,revision:priorReceipt.data().projectRevision,
        contentDigest:digest,created:false,unchanged:true,examFinalized:true};return;
    }
    if(access.receiptLookupOnly)
     deny("failed-precondition","The final save window expired without a confirmed checkpoint. Contact your teacher with your device draft.");
    const now=FieldValue.serverTimestamp();
    // Freeze the exact source files once per student/class session. The live
    // project may be edited next week; this immutable receipt is the evidence
    // for what the school actually received when the teacher closed this class.
    const frozenReceipt=receiptRef?{
      schemaVersion:1,retentionClass:"academic_assessment_evidence",
      schoolId:ctx.schoolId,taskId:access.taskId,studentUid:ctx.uid,
      personId:access.personId,projectId,title,language,files,artifacts,sourceDigest:digestSource(files,language),
      contentDigest:digest,closingEpoch,savedAt:now,
      // This is the UTF-8 JSON payload size, not Firestore billed storage
      // (which also includes document metadata and index overhead).
      payloadBytes:Buffer.byteLength(JSON.stringify({files,artifacts}),"utf8")
    }:null;
    if(!current.exists){
     tx.create(ref,{schoolId:ctx.schoolId,ownerUid:ctx.uid,title,language,files,artifacts,status:"active",
       contentDigest:digest,sourceDigest:digestSource(files,language),revision:1,createdAt:now,updatedAt:now});
     if(receiptRef)tx.create(receiptRef,{...frozenReceipt,projectRevision:1});
     result={projectId,revision:1,contentDigest:digest,created:true,examFinalized:Boolean(receiptRef)};return;
    }
    const data=current.data();
    if(data.schoolId!==ctx.schoolId||
       !studentRecordUidAllowed(identity.person,ctx.uid,data.ownerUid))
     deny("permission-denied","This project ID belongs to a different school student identity.");
    if(data.status==="archived")
     deny("failed-precondition","Restore this archived school project before synchronizing changes.");
    // Fail closed on an accidental empty editor snapshot. Without this guard,
    // a transient empty workspace may overwrite an existing student's source
    // using a valid same-device revision and leave no working copy to reopen.
    const hadSource=Array.isArray(data.files)&&data.files.some(row=>
      typeof row.content==="string"&&row.content.trim().length>0);
    const incomingEmpty=files.length===0||files.every(row=>!row.content.trim());
    if(hadSource&&incomingEmpty)
     deny("failed-precondition","The school project still contains source code. An empty editor snapshot cannot replace it. Reload the school copy or ask your teacher for recovery assistance.");
    // A matching payload already exists in the cloud. It is safe to confirm
    // the same code even when a new device has no local revision marker,
    // including when that device is creating a final-close receipt.
    if(data.contentDigest===digest&&data.title===title&&data.language===language){
     // Identical cloud content is safe even if another device has already
     // advanced the revision. This is especially important at exam close.
     if(receiptRef)tx.create(receiptRef,{...frozenReceipt,projectRevision:data.revision});
     result={projectId,revision:data.revision,contentDigest:digest,created:false,unchanged:true,
       examFinalized:Boolean(receiptRef)};return;
    }
    const expected=input.expectedRevision;
    if(!Number.isInteger(expected)||expected<1)
     deny("failed-precondition","This project already exists in school storage. Reload its school revision before saving.");
    if(data.revision!==expected)
     deny("failed-precondition","Project changed in school storage. Reload before overwriting it.");
    const revision=data.revision+1;
    tx.update(ref,{title,language,files,artifacts,contentDigest:digest,
      sourceDigest:digestSource(files,language),revision,updatedAt:now});
    if(receiptRef)tx.create(receiptRef,{...frozenReceipt,projectRevision:revision});
    result={projectId,revision,contentDigest:digest,created:false,unchanged:false,
      examFinalized:Boolean(receiptRef)};
   });
   return result;
  }
  const projectId=checkId(input.projectId,"Project ID",128);
  if(action==="get"){
   const identity=await loadStudentIdentity(),located=await findProject(identity,projectId),
     doc=located.doc;
   if(!doc.exists||doc.data().schoolId!==ctx.schoolId||
      !studentRecordUidAllowed(identity.person,ctx.uid,doc.data().ownerUid))
    deny("not-found","Project is unavailable.");
   const data=doc.data();
   const binding=data.artifacts?.assessment;
   if(binding?.provisionedBy==="assessment-launch"){
    const taskId=checkId(binding.taskId||binding.assessmentId,"Assessment task",128);
    const task=await db.doc(prefix+"assessments/"+taskId).get();
    if(!task.exists||task.data().schoolId!==ctx.schoolId)
      deny("failed-precondition","The assessment assigned to this school project is unavailable.");
    if(task.data().manualOpenRequired===true){
      if(task.data().manualAccessState!=="open"||task.data().published!==true||
         (task.data().lifecycle||"active")!=="active")
       deny("failed-precondition","Your teacher has not opened this section's Studio exam.");
      const member=await membershipRef.get(),
        personId=checkId(member.data()?.personId,"Student person",128);
      const [person,enrollment]=await Promise.all([
        db.doc(prefix+"people/"+personId).get(),
        db.doc(prefix+"enrollments/"+rowKey(personId,task.data().offeringId)).get()
      ]);
      if(member.data()?.status!=="active"||
         !person.exists||person.data().schoolId!==ctx.schoolId||
         person.data().authUid!==ctx.uid||person.data().kind!=="student"||
         person.data().status!=="active"||
         !enrollment.exists||enrollment.data().schoolId!==ctx.schoolId||
         enrollment.data().offeringId!==task.data().offeringId||
         enrollment.data().personId!==personId||enrollment.data().status!=="active")
        deny("permission-denied","Your enrollment in this Studio exam is no longer active.");
    }
   }
   if(data.status==="archived")deny("failed-precondition","This school project is archived. Restore it before opening.");
   return {projectId,title:data.title,language:data.language,status:data.status||"active",
    revision:data.revision,files:data.files,artifacts:data.artifacts||{},contentDigest:data.contentDigest,
    sourceDigest:data.sourceDigest||digestSource(data.files||[],data.language),
    createdAt:data.createdAt?.toMillis?.()||null,updatedAt:data.updatedAt?.toMillis?.()||null};
  }
  if(action==="archive"||action==="restore"){
   const expectedRevision=input.expectedRevision;
   if(!Number.isInteger(expectedRevision)||expectedRevision<1)
    deny("invalid-argument","The current school project revision is required.");
   const restoring=action==="restore";
   let result;
   await db.runTransaction(async tx=>{
    const identity=await authorizeTransaction(tx),
      located=await findProject(identity,projectId,tx),ref=located.ref,doc=located.doc;
    if(!doc.exists||doc.data().schoolId!==ctx.schoolId||
       !studentRecordUidAllowed(identity.person,ctx.uid,doc.data().ownerUid))
     deny("not-found","School project is unavailable.");
    const data=doc.data();
    if(data.revision!==expectedRevision)
     deny("failed-precondition","Project changed in school storage. Reload before changing its status.");
    // Exam projects remain part of the school's academic evidence chain.
    // Generic project archive/restore is not an authorized way to dispose
    // of an active teacher-controlled practical examination workspace.
    const binding=data.artifacts?.assessment;
    if(binding?.provisionedBy==="assessment-launch"){
      const taskId=checkId(binding.taskId||binding.assessmentId,"Assessment task",128),
        task=await tx.get(db.doc(prefix+"assessments/"+taskId));
      if(task.exists&&task.data().schoolId===ctx.schoolId&&
         task.data().manualOpenRequired===true)
       deny("failed-precondition","A teacher-assigned practical exam project cannot be archived or restored from the student project directory.");
    }
    const current=data.status||"active";
    if(restoring&&current!=="archived")deny("failed-precondition","Only an archived project can be restored.");
    if(!restoring&&current==="archived")deny("failed-precondition","This project is already archived.");
    const revision=expectedRevision+1,now=FieldValue.serverTimestamp();
    tx.update(ref,{status:restoring?"active":"archived",revision,updatedAt:now,
      ...(restoring?{restoredAt:now}:{archivedAt:now})});
    result={projectId,status:restoring?"active":"archived",revision};
   });
   return result;
  }
  if(action==="save"){
   const title=safeTitle(input.title),files=validateFiles(input.files),artifacts=validateArtifacts(input.artifacts);
   const revision=input.expectedRevision;
   if(!Number.isInteger(revision)||revision<1)
    deny("invalid-argument","The existing saved project revision is required.");
   const digest=digestProject(files,artifacts);
   await db.runTransaction(async tx=>{
    const identity=await authorizeTransaction(tx),
      located=await findProject(identity,projectId,tx),ref=located.ref,doc=located.doc;
    if(!doc.exists||doc.data().schoolId!==ctx.schoolId||
       !studentRecordUidAllowed(identity.person,ctx.uid,doc.data().ownerUid))
     deny("permission-denied","This project is not owned by your canonical student identity.");
    if(doc.data().status==="archived")
     deny("failed-precondition","Restore this archived school project before saving.");
    if(doc.data().revision!==revision)
     deny("failed-precondition","Project changed elsewhere. Load the latest version before saving.");
    const incoming=artifacts.assessment,previous=doc.data().artifacts?.assessment;
    if(previous?.provisionedBy==="assessment-launch"&&
       (incoming?.provisionedBy!=="assessment-launch"||
        (incoming.taskId||incoming.assessmentId)!==(previous.taskId||previous.assessmentId)))
     deny("permission-denied","An assessment project cannot be detached from or reassigned to another exam.");
    await authorizeAssessmentProject(tx,artifacts);
    tx.update(ref,{title,files,artifacts,contentDigest:digest,
      sourceDigest:digestSource(files,doc.data().language),revision:revision+1,
      updatedAt:FieldValue.serverTimestamp()});
   });
   return {projectId,revision:revision+1,contentDigest:digest};
  }
  deny("invalid-argument","Unknown school Studio project action.");
 };
}
module.exports={createSchoolStudioProjectService,validateFiles,validateArtifacts,digestFiles,digestProject,digestSource,canonicalJson};
