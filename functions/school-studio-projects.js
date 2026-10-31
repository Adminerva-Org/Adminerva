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
   return {projects:snap.docs.filter(d=>d.data().schoolId===ctx.schoolId&&d.data().ownerUid===ctx.uid&&d.data().status!=="archived")
    .map(d=>({projectId:d.id,title:d.data().title,language:d.data().language,
      revision:d.data().revision,status:d.data().status||"active",
      updatedAt:d.data().updatedAt?.toMillis?.()||null}))};
  }
  if(action==="create"){
   const title=safeTitle(input.title),files=validateFiles(input.files||[]),artifacts=validateArtifacts(input.artifacts);
   const language=input.language;
   if(!["java","web","python","csharp","cpp","dart","text"].includes(language))
    deny("invalid-argument","Choose a supported Studio project language.");
   const ref=projectCollection.doc(),now=FieldValue.serverTimestamp();
   await db.runTransaction(async tx=>{
    await authorizeTransaction(tx);
    tx.create(ref,{schoolId:ctx.schoolId,ownerUid:ctx.uid,title,
      language,files,artifacts,contentDigest:digestProject(files,artifacts),status:"active",revision:1,
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
   const ref=projectCollection.doc(projectId),digest=digestProject(files,artifacts);
   let result;
   await db.runTransaction(async tx=>{
    await authorizeTransaction(tx);
    const current=await tx.get(ref),now=FieldValue.serverTimestamp();
    if(!current.exists){
     tx.create(ref,{schoolId:ctx.schoolId,ownerUid:ctx.uid,title,language,files,artifacts,status:"active",
       contentDigest:digest,revision:1,createdAt:now,updatedAt:now});
     result={projectId,revision:1,contentDigest:digest,created:true};return;
    }
    const data=current.data();
    if(data.schoolId!==ctx.schoolId||data.ownerUid!==ctx.uid)
     deny("permission-denied","This project ID belongs to a different school account.");
    const expected=input.expectedRevision;
    if(!Number.isInteger(expected)||expected<1)
     deny("failed-precondition","This project already exists in school storage. Reload its school revision before saving.");
    if(data.revision!==expected)
     deny("failed-precondition","Project changed in school storage. Reload before overwriting it.");
    if(data.contentDigest===digest&&data.title===title&&data.language===language){
     result={projectId,revision:data.revision,contentDigest:digest,created:false,unchanged:true};return;
    }
    const revision=data.revision+1;
    tx.update(ref,{title,language,files,artifacts,contentDigest:digest,revision,updatedAt:now});
    result={projectId,revision,contentDigest:digest,created:false,unchanged:false};
   });
   return result;
  }
  const projectId=checkId(input.projectId,"Project ID",128);
  const ref=projectCollection.doc(projectId);
  if(action==="get"){
   const doc=await ref.get();
   if(!doc.exists||doc.data().ownerUid!==ctx.uid||doc.data().schoolId!==ctx.schoolId)
    deny("not-found","Project is unavailable.");
   const data=doc.data();
   if(data.status==="archived")deny("failed-precondition","This school project is archived. Restore it before opening.");
   return {projectId,title:data.title,language:data.language,status:data.status||"active",
    revision:data.revision,files:data.files,artifacts:data.artifacts||{},contentDigest:data.contentDigest,
    createdAt:data.createdAt?.toMillis?.()||null,updatedAt:data.updatedAt?.toMillis?.()||null};
  }
  if(action==="archive"||action==="restore"){
   const expectedRevision=input.expectedRevision;
   if(!Number.isInteger(expectedRevision)||expectedRevision<1)
    deny("invalid-argument","The current school project revision is required.");
   const restoring=action==="restore";
   let result;
   await db.runTransaction(async tx=>{
    await authorizeTransaction(tx);
    const doc=await tx.get(ref);
    if(!doc.exists||doc.data().schoolId!==ctx.schoolId||doc.data().ownerUid!==ctx.uid)
     deny("not-found","School project is unavailable.");
    const data=doc.data();
    if(data.revision!==expectedRevision)
     deny("failed-precondition","Project changed in school storage. Reload before changing its status.");
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
    await authorizeTransaction(tx);
    const doc=await tx.get(ref);
    if(!doc.exists||doc.data().schoolId!==ctx.schoolId||doc.data().ownerUid!==ctx.uid)
     deny("permission-denied","This project is not yours in this school.");
    if(doc.data().status==="archived")
     deny("failed-precondition","Restore this archived school project before saving.");
    if(doc.data().revision!==revision)
     deny("failed-precondition","Project changed elsewhere. Load the latest version before saving.");
    tx.update(ref,{title,files,artifacts,contentDigest:digest,revision:revision+1,
      updatedAt:FieldValue.serverTimestamp()});
   });
   return {projectId,revision:revision+1,contentDigest:digest};
  }
  deny("invalid-argument","Unknown school Studio project action.");
 };
}
module.exports={createSchoolStudioProjectService,validateFiles,validateArtifacts,digestFiles,digestProject,canonicalJson};
