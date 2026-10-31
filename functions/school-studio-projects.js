"use strict";
/** School-owned Adminerva Studio project persistence for V4 students. */
const {FieldValue}=require("firebase-admin/firestore");
const {createHash}=require("node:crypto");
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");
const {checkId}=require("./school-academics.js");
function deny(code,message){throw new TenantAccessError(code,message)}
function safeTitle(value){
 if(typeof value!=="string"||!value.trim()||value.trim().length>120)
  deny("invalid-argument","Provide a project name of 1–120 characters.");
 return value.trim();
}
function validateFiles(files){
 if(!Array.isArray(files)||files.length>30)
  deny("invalid-argument","A Studio project may contain up to 30 text files.");
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
  if(size>50000)deny("invalid-argument","A single source file exceeds 50 KB.");
  total+=size;
  if(total>150000)deny("invalid-argument","The project exceeds the 150 KB save limit.");
  paths.add(path);checked.push({path,content});
 }
 return checked.sort((a,b)=>a.path.localeCompare(b.path));
}
function digestFiles(files){
 return createHash("sha256").update(JSON.stringify(files)).digest("hex");
}
function createSchoolStudioProjectService({db}){
 return async request=>{
  const input=request.data||{},ctx=await getSchoolContext({
   db,request,schoolId:input.schoolId,roles:["student"]
  });
  const prefix="schools/"+ctx.schoolId+"/";
  const projectCollection=db.collection(prefix+"student_code_projects/"+ctx.uid+"/projects");
  const membershipRef=db.doc(prefix+"memberships/"+ctx.uid);
  const schoolRef=db.doc("platform_schools/"+ctx.schoolId);
  async function authorizeTransaction(tx) {
   const [school,member]=await Promise.all([tx.get(schoolRef),tx.get(membershipRef)]);
   if(!school.exists||school.data().state!=="active"||!member.exists||
      member.data().schoolId!==ctx.schoolId||member.data().status!=="active"||
      !Array.isArray(member.data().roles)||!member.data().roles.includes("student"))
    deny("permission-denied","Your school student membership is no longer active.");
  }
  const action=input.action;
  if(action==="list"){
   const snap=await projectCollection.limit(100).get();
   return {projects:snap.docs.filter(d=>d.data().schoolId===ctx.schoolId&&d.data().ownerUid===ctx.uid)
    .map(d=>({projectId:d.id,title:d.data().title,language:d.data().language,
      revision:d.data().revision,updatedAt:d.data().updatedAt?.toMillis?.()||null}))};
  }
  if(action==="create"){
   const title=safeTitle(input.title),files=validateFiles(input.files||[]);
   const language=input.language;
   if(!["java","web","python","text"].includes(language))
    deny("invalid-argument","Choose a supported Studio project language.");
   const ref=projectCollection.doc(),now=FieldValue.serverTimestamp();
   await db.runTransaction(async tx=>{
    await authorizeTransaction(tx);
    tx.create(ref,{schoolId:ctx.schoolId,ownerUid:ctx.uid,title,
      language,files,contentDigest:digestFiles(files),revision:1,
      createdAt:now,updatedAt:now});
   });
   return {projectId:ref.id,revision:1,contentDigest:digestFiles(files)};
  }
  const projectId=checkId(input.projectId,"Project ID",128);
  const ref=projectCollection.doc(projectId);
  if(action==="get"){
   const doc=await ref.get();
   if(!doc.exists||doc.data().ownerUid!==ctx.uid||doc.data().schoolId!==ctx.schoolId)
    deny("not-found","Project is unavailable.");
   const data=doc.data();
   return {projectId,title:data.title,language:data.language,
    revision:data.revision,files:data.files,contentDigest:data.contentDigest};
  }
  if(action==="save"){
   const title=safeTitle(input.title),files=validateFiles(input.files);
   const revision=input.expectedRevision;
   if(!Number.isInteger(revision)||revision<1)
    deny("invalid-argument","The existing saved project revision is required.");
   const digest=digestFiles(files);
   await db.runTransaction(async tx=>{
    await authorizeTransaction(tx);
    const doc=await tx.get(ref);
    if(!doc.exists||doc.data().schoolId!==ctx.schoolId||doc.data().ownerUid!==ctx.uid)
     deny("permission-denied","This project is not yours in this school.");
    if(doc.data().revision!==revision)
     deny("failed-precondition","Project changed elsewhere. Load the latest version before saving.");
    tx.update(ref,{title,files,contentDigest:digest,revision:revision+1,
      updatedAt:FieldValue.serverTimestamp()});
   });
   return {projectId,revision:revision+1,contentDigest:digest};
  }
  deny("invalid-argument","Unknown school Studio project action.");
 };
}
module.exports={createSchoolStudioProjectService,validateFiles,digestFiles};
