"use strict";
/**
 * School-scoped teacher reference library.
 * Raw PDFs are never persisted in Firestore/Storage. Optional PDF ingestion is
 * transient through the school's server-side Gemini connection and stores only
 * extracted text/metadata.
 */
const {FieldValue}=require("firebase-admin/firestore");
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");

function deny(code,message){throw new TenantAccessError(code,message)}
function id(value,label="Reference ID"){
 if(typeof value!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(value))
  deny("invalid-argument","Invalid "+label.toLowerCase()+".");
 return value;
}
function clean(value,max,label,{required=true}={}){
 const text=typeof value==="string"?value.trim():"";
 if((required&&!text)||text.length>max)deny("invalid-argument",label+" is missing or too long.");
 return text;
}
function decodePdf(value){
 if(typeof value!=="string"||!value||value.length%4!==0||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value))
  deny("invalid-argument","The PDF payload is invalid.");
 const bytes=Buffer.from(value,"base64");
 if(bytes.length<5||bytes.length>4*1024*1024||bytes.subarray(0,5).toString("ascii")!=="%PDF-")
  deny("invalid-argument","Use a valid PDF no larger than 4 MB.");
 return bytes;
}
async function fetchJson(fetchImpl,url,options,message){
 const response=await fetchImpl(url,options);
 if(!response.ok){
  if(response.status===429)deny("resource-exhausted","This school's AI provider is busy. Retry the PDF later.");
  if([400,401,403,404].includes(response.status))
   deny("failed-precondition","This school's AI connection cannot process the PDF. Ask a school administrator to review the key/model.");
  deny("unavailable",message);
 }
 return response.json();
}
async function extractPdf({fetchImpl,apiKey,model,fileName,bytes}){
 const upload=await fetchJson(fetchImpl,
  "https://generativelanguage.googleapis.com/upload/v1beta/files",{
   method:"POST",
   headers:{
    "x-goog-api-key":apiKey,
    "X-Goog-Upload-Command":"start, upload, finalize",
    "X-Goog-Upload-Header-Content-Length":String(bytes.length),
    "X-Goog-Upload-Header-Content-Type":"application/pdf",
    "Content-Type":"application/pdf"
   },body:bytes,signal:AbortSignal.timeout(30000)
  },"The PDF upload service is temporarily unavailable.");
 const file=upload.file;
 if(!file?.name||!file.uri)deny("unavailable","The provider did not return a usable temporary PDF reference.");
 try{
  let state=String(file.state||"").toUpperCase(),uri=file.uri;
  for(let attempt=0;state&&state!=="ACTIVE"&&attempt<8;attempt++){
   if(state==="FAILED")deny("failed-precondition","The provider could not process this PDF.");
   await new Promise(resolve=>setTimeout(resolve,1500*(attempt+1)));
   const info=await fetchJson(fetchImpl,
    "https://generativelanguage.googleapis.com/v1beta/"+file.name,{
     headers:{"x-goog-api-key":apiKey},signal:AbortSignal.timeout(15000)
    },"PDF processing status is temporarily unavailable.");
   state=String(info.state||"").toUpperCase();uri=info.uri||uri;
  }
  if(state&&state!=="ACTIVE")deny("unavailable","PDF processing did not finish in the bounded import window.");
  const result=await fetchJson(fetchImpl,
   "https://generativelanguage.googleapis.com/v1beta/models/"+
    encodeURIComponent(model)+":generateContent",{
    method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":apiKey},
    body:JSON.stringify({contents:[{role:"user",parts:[
     {text:"Extract the educational text from this PDF faithfully. Include readable text from tables, diagrams, scanned pages, and images when possible. Return only the extracted text, with simple headings when useful. Do not add commentary."},
     {file_data:{mime_type:"application/pdf",file_uri:uri}}
    ]}],generationConfig:{temperature:0,maxOutputTokens:16384}}),
    signal:AbortSignal.timeout(85000)
   },"The PDF extraction service is temporarily unavailable.");
  const extracted=(result.candidates||[]).flatMap(candidate=>candidate.content?.parts||[])
   .map(part=>typeof part.text==="string"?part.text:"").join("\n").trim();
  if(!extracted)deny("failed-precondition","No usable text was extracted from this PDF.");
  if(Buffer.byteLength(extracted,"utf8")>650000)
   deny("failed-precondition","The extracted PDF text is too large. Split the PDF into smaller references.");
  return extracted;
 }finally{
  await fetchImpl("https://generativelanguage.googleapis.com/v1beta/"+file.name,{
   method:"DELETE",headers:{"x-goog-api-key":apiKey},signal:AbortSignal.timeout(10000)
  }).catch(()=>{});
 }
}
function createSchoolReferenceService({db,fetchImpl=fetch}){
 return async request=>{
  const input=request.data||{},ctx=await getSchoolContext({
   db,request,schoolId:input.schoolId,roles:["teacher"]
  });
  const prefix="schools/"+ctx.schoolId+"/";
  const folders=db.collection(prefix+"teacher_reference_folders");
  const schoolRef=db.doc("platform_schools/"+ctx.schoolId);
  const memberRef=db.doc(prefix+"memberships/"+ctx.uid);
  async function authority(tx){
   const [school,member]=await Promise.all([tx.get(schoolRef),tx.get(memberRef)]);
   if(!school.exists||school.data().state!=="active"||!member.exists||
      member.data().schoolId!==ctx.schoolId||member.data().status!=="active"||
      !Array.isArray(member.data().roles)||!member.data().roles.includes("teacher"))
    deny("permission-denied","Your teaching access changed. Refresh the reference library.");
  }
  const action=input.action;
  if(action==="list_folders"){
   const snap=await folders.where("ownerUid","==",ctx.uid).limit(101).get();
   if(snap.size===101)deny("resource-exhausted","Reference folders require pagination.");
   return {folders:snap.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&doc.data().status!=="archived")
    .map(doc=>({folderId:doc.id,name:doc.data().name,documentCount:doc.data().documentCount||0,
      revision:doc.data().revision||1,updatedAt:doc.data().updatedAt?.toMillis?.()||null}))
    .sort((a,b)=>a.name.localeCompare(b.name))};
  }
  if(action==="create_folder"){
   const name=clean(input.name,140,"Folder name"),ref=folders.doc(),now=FieldValue.serverTimestamp();
   await db.runTransaction(async tx=>{
    await authority(tx);
    tx.create(ref,{schoolId:ctx.schoolId,ownerUid:ctx.uid,name,status:"active",
      documentCount:0,revision:1,createdAt:now,updatedAt:now});
    tx.create(db.collection(prefix+"planning_audit").doc(),{
      schoolId:ctx.schoolId,actorUid:ctx.uid,resourceId:ref.id,
      action:"reference_folder_created",revision:1,createdAt:now});
   });
   return {folderId:ref.id,name,revision:1};
  }
  const folderId=id(input.folderId,"Folder ID"),folderRef=folders.doc(folderId);
  if(action==="list_documents"){
   const folder=await folderRef.get();
   if(!folder.exists||folder.data().schoolId!==ctx.schoolId||folder.data().ownerUid!==ctx.uid||
      folder.data().status==="archived")deny("not-found","Reference folder is unavailable.");
   const snap=await folderRef.collection("documents").where("status","==","active").limit(101).get();
   if(snap.size===101)deny("resource-exhausted","Reference documents require pagination.");
   return {folderId,documents:snap.docs.map(doc=>({
    documentId:doc.id,title:doc.data().title,sourceType:doc.data().sourceType||"text",
    text:doc.data().text,revision:doc.data().revision||1,
    updatedAt:doc.data().updatedAt?.toMillis?.()||null
   })).sort((a,b)=>a.title.localeCompare(b.title))};
  }
  if(action==="rename_folder"||action==="archive_folder"){
   const expected=input.expectedRevision;
   if(!Number.isInteger(expected)||expected<1)deny("invalid-argument","Current folder revision is required.");
   const name=action==="rename_folder"?clean(input.name,140,"Folder name"):null;
   let result;
   await db.runTransaction(async tx=>{
    await authority(tx);const current=await tx.get(folderRef);
    if(!current.exists||current.data().schoolId!==ctx.schoolId||current.data().ownerUid!==ctx.uid)
     deny("not-found","Owned reference folder is unavailable.");
    const data=current.data();
    if(data.status==="archived")deny("failed-precondition","This reference folder is already archived.");
    if((data.revision||1)!==expected)deny("failed-precondition","Reference folder changed. Reload it first.");
    const revision=expected+1,now=FieldValue.serverTimestamp();
    tx.update(folderRef,action==="rename_folder"?
      {name,revision,updatedAt:now}:{status:"archived",revision,archivedAt:now,updatedAt:now});
    tx.create(db.collection(prefix+"planning_audit").doc(),{
      schoolId:ctx.schoolId,actorUid:ctx.uid,resourceId:folderId,
      action:action==="rename_folder"?"reference_folder_renamed":"reference_folder_archived",
      revision,createdAt:now});
    result={folderId,revision,...(name?{name}:{}),status:action==="archive_folder"?"archived":"active"};
   });
   return result;
  }
  if(action==="add_text"||action==="import_pdf"){
   const title=clean(input.title,180,"Reference title");
   let extracted=null,sourceType="text";
   if(action==="add_text"){
    extracted=clean(input.text,650000,"Reference text");
    if(Buffer.byteLength(extracted,"utf8")>650000)deny("invalid-argument","Reference text is too large.");
   }else{
    const bytes=decodePdf(input.pdfBase64),fileName=clean(input.fileName||title,180,"PDF name");
    const config=await db.doc(prefix+"private_config/ai").get(),ai=config.exists?config.data():null;
    if(!ai?.enabled||!ai.apiKey)deny("failed-precondition","School AI must be configured before importing a PDF.");
    extracted=await extractPdf({fetchImpl,apiKey:ai.apiKey,model:ai.model||"gemini-3.8-flash",
      fileName,bytes});sourceType="pdf_extracted_text";
   }
   const docRef=folderRef.collection("documents").doc(),now=FieldValue.serverTimestamp();
   let folderRevision;
   await db.runTransaction(async tx=>{
    await authority(tx);const folder=await tx.get(folderRef);
    if(!folder.exists||folder.data().schoolId!==ctx.schoolId||folder.data().ownerUid!==ctx.uid||
       folder.data().status==="archived")deny("not-found","Reference folder is unavailable.");
    folderRevision=(folder.data().revision||1)+1;
    tx.create(docRef,{schoolId:ctx.schoolId,ownerUid:ctx.uid,folderId,title,text:extracted,
      sourceType,status:"active",revision:1,createdAt:now,updatedAt:now});
    tx.update(folderRef,{documentCount:(folder.data().documentCount||0)+1,
      revision:folderRevision,updatedAt:now});
    tx.create(db.collection(prefix+"planning_audit").doc(),{
      schoolId:ctx.schoolId,actorUid:ctx.uid,resourceId:docRef.id,parentResourceId:folderId,
      action:sourceType==="pdf_extracted_text"?"reference_pdf_text_imported":"reference_text_added",
      revision:1,createdAt:now});
   });
   return {folderId,documentId:docRef.id,title,sourceType,revision:1,folderRevision,text:extracted};
  }
  const documentId=id(input.documentId,"Document ID"),documentRef=folderRef.collection("documents").doc(documentId);
  if(action==="rename_document"||action==="archive_document"){
   const expected=input.expectedRevision;
   if(!Number.isInteger(expected)||expected<1)deny("invalid-argument","Current document revision is required.");
   const title=action==="rename_document"?clean(input.title,180,"Reference title"):null;
   let result;
   await db.runTransaction(async tx=>{
    await authority(tx);
    const [folder,doc]=await Promise.all([tx.get(folderRef),tx.get(documentRef)]);
    if(!folder.exists||folder.data().schoolId!==ctx.schoolId||folder.data().ownerUid!==ctx.uid||
       folder.data().status==="archived"||!doc.exists||doc.data().schoolId!==ctx.schoolId||
       doc.data().ownerUid!==ctx.uid||doc.data().folderId!==folderId||doc.data().status!=="active")
      deny("not-found","Owned reference document is unavailable.");
    if((doc.data().revision||1)!==expected)deny("failed-precondition","Reference document changed. Reload it first.");
    const revision=expected+1,folderRevision=(folder.data().revision||1)+1,now=FieldValue.serverTimestamp();
    tx.update(documentRef,action==="rename_document"?
      {title,revision,updatedAt:now}:{status:"archived",revision,archivedAt:now,updatedAt:now});
    tx.update(folderRef,{
      ...(action==="archive_document"?{documentCount:Math.max(0,(folder.data().documentCount||0)-1)}:{}),
      revision:folderRevision,updatedAt:now
    });
    tx.create(db.collection(prefix+"planning_audit").doc(),{
      schoolId:ctx.schoolId,actorUid:ctx.uid,resourceId:documentId,parentResourceId:folderId,
      action:action==="rename_document"?"reference_document_renamed":"reference_document_archived",
      revision,createdAt:now});
    result={folderId,documentId,revision,folderRevision,...(title?{title}:{}),
      status:action==="archive_document"?"archived":"active"};
   });
   return result;
  }
  deny("invalid-argument","Unknown school reference operation.");
 };
}
module.exports={createSchoolReferenceService,decodePdf,extractPdf};
