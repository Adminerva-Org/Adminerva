"use strict";
// Registrar custody, server-mediated only. Never use the default Firebase
// client bucket or issue bearer download URLs for student documents.
const {FieldValue}=require("firebase-admin/firestore");
const {getStorage}=require("firebase-admin/storage");
const {createHash}=require("node:crypto");
const {TenantAccessError}=require("./tenant-access.js");
const ACTIONS=new Set(["list_admission_documents","save_admission_document","download_admission_document"]);
const MAX_BYTES=2*1024*1024,MAX_DOCUMENTS=48;
function deny(code,message){throw new TenantAccessError(code,message);}
function id(raw){if(typeof raw!=="string"||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(raw))deny("invalid-argument","Invalid record identifier.");return raw;}
function sha(bytes){return createHash("sha256").update(bytes).digest("hex");}
function fileBytes(raw,type){
  if(typeof raw!=="string"||raw.length>Math.ceil(MAX_BYTES/3)*4||!raw.length||
     !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)||raw.length%4!==0)
    deny("invalid-argument","Choose a PDF, JPEG or PNG up to 2 MB.");
  const bytes=Buffer.from(raw,"base64");
  if(bytes.length>MAX_BYTES||bytes.toString("base64")!==raw)deny("invalid-argument","Invalid file encoding or size.");
  const valid=type==="application/pdf"?bytes.subarray(0,5).toString()==="%PDF-":
    type==="image/jpeg"?bytes.subarray(0,3).equals(Buffer.from([255,216,255])):
    type==="image/png"?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):false;
  if(!valid)deny("invalid-argument","The file does not match an allowed PDF, JPEG or PNG format.");
  return bytes;
}
function documentPath(schoolId,applicationId,documentId){
  return "registrar/"+id(schoolId)+"/applications/"+id(applicationId)+"/"+id(documentId);
}
function safeRow(row,schoolId,applicationId){
  return row&&row.schoolId===schoolId&&row.applicationId===applicationId&&
    /^[a-f0-9]{64}$/.test(row.documentId||"")&&
    row.storagePath===documentPath(schoolId,applicationId,row.documentId);
}
function describe(row){
  return {documentId:row.documentId,applicationId:row.applicationId,label:row.label,
    contentType:row.contentType,size:row.size,state:row.state,
    createdAt:row.createdAt?.toMillis?.()||0};
}
async function privateBucket(schoolId){
  const name=String(process.env.ADMINERVA_REGISTRAR_DOCUMENT_BUCKET||"").trim();
  const allowed=String(process.env.ADMINERVA_REGISTRAR_DOCUMENT_SCHOOLS||"").split(",").map(s=>s.trim());
  if(!name||!allowed.includes(schoolId)||name.endsWith(".appspot.com")||name.endsWith(".firebasestorage.app"))
    deny("failed-precondition","Private admissions document storage has not been enabled for this school.");
  const bucket=getStorage().bucket(name),[metadata]=await bucket.getMetadata();
  const iam=metadata.iamConfiguration||{};
  if(iam.publicAccessPrevention!=="enforced"||iam.uniformBucketLevelAccess?.enabled!==true)
    deny("failed-precondition","Private records bucket security is not configured.");
  return bucket;
}
async function admissionDocumentAction({db,ctx,input,studentView=false,bucketFor=privateBucket}){
  const root="schools/"+ctx.schoolId+"/",schoolRef=db.doc("platform_schools/"+ctx.schoolId),
    memberRef=db.doc(root+"memberships/"+ctx.uid);
  async function authority(read){
    const [school,member]=await Promise.all([read(schoolRef),read(memberRef)]);
    if(!school.exists||!["pilot","active"].includes(school.data().state)||!member.exists||
       member.data().schoolId!==ctx.schoolId||member.data().status!=="active"||
       !Array.isArray(member.data().roles)||!member.data().roles.some(role=>["school_admin","registrar"].includes(role)))
      deny("permission-denied","Verified Registrar or School Administrator membership is required.");
  }
  await authority(ref=>ref.get());
  const personId=studentView?id(input.personId):null;
  if(studentView){
    const person=await db.doc(root+"people/"+personId).get();
    if(!person.exists||person.data().schoolId!==ctx.schoolId||person.data().kind!=="student")deny("not-found","Student not found.");
    if(input.action==="save_admission_document")deny("permission-denied","Upload from the admissions application.");
  }
  function checkApplication(doc){
    if(!doc.exists||doc.data().schoolId!==ctx.schoolId||
       (studentView&&(doc.data().personId!==personId||doc.data().status!=="enrolled")))
      deny("not-found","Admission application not found.");
    return doc.data();
  }
  if(input.action==="list_admission_documents"){
    let docs;
    if(studentView){
      const snap=await db.collection(root+"enrollment_applications").where("personId","==",personId).limit(51).get();
      if(snap.size===51)deny("resource-exhausted","Admission document history requires pagination.");
      docs=snap.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&doc.data().status==="enrolled");
    }else docs=[await db.doc(root+"enrollment_applications/"+id(input.applicationId)).get()];
    return {items:docs.flatMap(doc=>{
      const app=checkApplication(doc);
      return (app.admissionDocuments||[]).filter(row=>safeRow(row,ctx.schoolId,doc.id)&&row.state==="stored").map(describe);
    })};
  }
  const applicationId=id(input.applicationId),ref=db.doc(root+"enrollment_applications/"+applicationId),
    auditRef=db.collection(root+"directory_audit").doc();
  const app=checkApplication(await ref.get());
  if(input.action==="download_admission_document"){
    const documentId=id(input.documentId),row=(app.admissionDocuments||[]).find(item=>item.documentId===documentId);
    if(!safeRow(row,ctx.schoolId,applicationId)||row.state!=="stored")deny("not-found","Document not found.");
    const bucket=await bucketFor(ctx.schoolId),file=bucket.file(row.storagePath,{generation:row.generation});
    const [bytes]=await file.download();
    if(bytes.length!==row.size||bytes.length>MAX_BYTES||sha(bytes)!==row.sha256)deny("data-loss","Document integrity check failed.");
    await db.runTransaction(async tx=>{
      await authority(r=>tx.get(r));const current=checkApplication(await tx.get(ref));
      if(!(current.admissionDocuments||[]).some(item=>item.documentId===documentId&&item.state==="stored"&&item.generation===row.generation))
        deny("failed-precondition","Document access changed.");
      tx.create(auditRef,{schoolId:ctx.schoolId,actorUid:ctx.uid,applicationId,documentId,
        action:"admission_document_downloaded",createdAt:FieldValue.serverTimestamp()});
    });
    return {contentType:row.contentType,base64:bytes.toString("base64"),documentId};
  }
  if(input.action!=="save_admission_document")deny("invalid-argument","Unknown document action.");
  const revision=input.expectedRevision,label=String(input.label||"").trim(),type=input.contentType;
  if(!Number.isSafeInteger(revision)||revision<1||!label||label.length>100)deny("invalid-argument","Choose a saved requirement and refresh the application.");
  const bytes=fileBytes(input.base64,type),digest=sha(bytes),
    documentId=sha(Buffer.from(JSON.stringify([label,type,digest]))),path=documentPath(ctx.schoolId,applicationId,documentId);
  const bucket=await bucketFor(ctx.schoolId);
  // Reserve immutable custody metadata first. A failed upload remains pending
  // and can be retried with the same file; acceptance is blocked until resolved.
  await db.runTransaction(async tx=>{
    await authority(r=>tx.get(r));const current=checkApplication(await tx.get(ref));
    if(!["submitted","needs_information"].includes(current.status)||Number(current.revision)!==revision)
      deny("failed-precondition","Application changed. Refresh before uploading.");
    if(!(current.requirements||[]).some(item=>item.label===label))deny("failed-precondition","Save the requirement checklist first.");
    const rows=current.admissionDocuments||[],existing=rows.find(row=>row.documentId===documentId);
    if(existing){
      if(!safeRow(existing,ctx.schoolId,applicationId)||existing.sha256!==digest)deny("data-loss","Document reservation mismatch.");
      return;
    }
    if(rows.length>=MAX_DOCUMENTS)deny("resource-exhausted","This application has reached its document history limit.");
    const now=FieldValue.serverTimestamp();
    // Firestore does not allow server timestamps inside array elements.
    tx.update(ref,{admissionDocuments:[...rows,{schoolId:ctx.schoolId,applicationId,documentId,label,contentType:type,
      size:bytes.length,sha256:digest,storagePath:path,state:"pending",createdAt:new Date(),uploaderUid:ctx.uid}],
      requirementsReviewed:false,revision:revision+1,updatedAt:now});
    tx.create(auditRef,{schoolId:ctx.schoolId,actorUid:ctx.uid,applicationId,documentId,
      action:"admission_document_reserved",createdAt:now});
  });
  const file=bucket.file(path);
  try{await file.save(bytes,{resumable:false,preconditionOpts:{ifGenerationMatch:0},
    metadata:{contentType:type,cacheControl:"private, no-store",metadata:{sha256:digest}}});}
  catch(error){if(Number(error?.code)!==412)throw error;}
  const [metadata]=await file.getMetadata();
  if(metadata.name!==path||Number(metadata.size)!==bytes.length||metadata.contentType!==type||metadata.metadata?.sha256!==digest)
    deny("data-loss","Stored document metadata does not match reservation.");
  const generation=String(metadata.generation||"");
  if(!/^\d+$/.test(generation))deny("data-loss","Stored document generation is missing.");
  const [stored]=await bucket.file(path,{generation}).download();
  if(stored.length!==bytes.length||sha(stored)!==digest)deny("data-loss","Stored document integrity check failed.");
  const finalAudit=db.collection(root+"directory_audit").doc();
  await db.runTransaction(async tx=>{
    await authority(r=>tx.get(r));const current=checkApplication(await tx.get(ref));
    if(!["submitted","needs_information"].includes(current.status)||!(current.requirements||[]).some(item=>item.label===label))
      deny("failed-precondition","Application changed before document confirmation.");
    const rows=current.admissionDocuments||[],row=rows.find(item=>item.documentId===documentId);
    if(!safeRow(row,ctx.schoolId,applicationId)||row.sha256!==digest)deny("data-loss","Document reservation is missing.");
    if(row.state==="stored")return;
    if(row.state!=="pending")deny("failed-precondition","Document reservation is no longer active.");
    const now=FieldValue.serverTimestamp();
    tx.update(ref,{admissionDocuments:rows.map(item=>item.documentId===documentId?{...item,state:"stored",generation}:item),
      requirements:(current.requirements||[]).map(item=>item.label===label?{...item,status:"received"}:item),
      requirementsReviewed:false,revision:(Number(current.revision)||1)+1,updatedAt:now});
    tx.create(finalAudit,{schoolId:ctx.schoolId,actorUid:ctx.uid,applicationId,documentId,
      action:"admission_document_stored",createdAt:now});
  });
  return {documentId,state:"stored"};
}
module.exports={ACTIONS,admissionDocumentAction,fileBytes,documentPath};
