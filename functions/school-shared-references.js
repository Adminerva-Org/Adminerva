"use strict";
/**
 * Adminerva 4.0 school-shared reference library.
 *
 * School administrators manage shared originals. Active teachers may read and
 * copy an active shared folder into their private teacher library. Students and
 * platform-owner-only accounts receive no access through this service.
 *
 * Raw PDFs are never persisted. Optional PDF ingestion is transient through the
 * school's existing server-side AI connection and stores extracted text only.
 */
const {FieldValue}=require("firebase-admin/firestore");
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");
const {decodePdf,extractPdf}=require("./school-references.js");

function deny(code,message){throw new TenantAccessError(code,message)}
function id(value,label="Reference ID"){
 if(typeof value!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(value))
  deny("invalid-argument","Invalid "+label.toLowerCase()+".");
 return value;
}
function text(value,max,label,{required=true}={}){
 const result=typeof value==="string"?value.trim():"";
 if((required&&!result)||result.length>max)
  deny("invalid-argument",label+" is missing or too long.");
 return result;
}
function validStatus(value){
 if(!["active","archived"].includes(value))
  deny("invalid-argument","Choose active or archived status.");
 return value;
}
function createSchoolSharedReferenceService({db,fetchImpl=fetch}){
 return async request=>{
  const input=request.data||{},action=input.action||"list_folders";
  const ctx=await getSchoolContext({
   db,request,schoolId:input.schoolId,roles:["teacher","school_admin"]
  });
  const prefix="schools/"+ctx.schoolId+"/",
   folders=db.collection(prefix+"school_reference_folders"),
   schoolRef=db.doc("platform_schools/"+ctx.schoolId),
   memberRef=db.doc(prefix+"memberships/"+ctx.uid),
   admin=ctx.roles.includes("school_admin"),
   teacher=ctx.roles.includes("teacher");

  async function currentAuthority(tx,role){
   const [school,member]=await Promise.all([tx.get(schoolRef),tx.get(memberRef)]);
   if(!school.exists||school.data().state!=="active"||!member.exists||
      member.data().schoolId!==ctx.schoolId||member.data().status!=="active")
    deny("permission-denied","Your school access changed. Refresh before continuing.");
   const roles=Array.isArray(member.data().roles)?member.data().roles:[];
   if(!roles.includes(role))
    deny("permission-denied",role==="school_admin"?
     "School administration access is required to manage shared references.":
     "Active teacher access is required to copy shared references.");
   return member.data();
  }
  function requireAdmin(){
   if(!admin)deny("permission-denied","Only a school administrator can manage shared reference originals.");
  }
  function audit(action,extra={}){
   return {schoolId:ctx.schoolId,actorUid:ctx.uid,action,...extra,
    createdAt:FieldValue.serverTimestamp()};
  }

  if(action==="list_folders"){
   const includeArchived=admin&&input.includeArchived===true;
   const snap=await folders.limit(101).get();
   if(snap.size===101)
    deny("resource-exhausted","The school shared reference library requires pagination before adding more folders.");
   return {folders:snap.docs.filter(doc=>{
    const data=doc.data();
    return data.schoolId===ctx.schoolId&&(includeArchived||data.status==="active");
   }).map(doc=>({
    folderId:doc.id,name:doc.data().name,status:doc.data().status,
    documentCount:Number(doc.data().documentCount)||0,revision:doc.data().revision||1,
    updatedAt:doc.data().updatedAt?.toMillis?.()||null
   })).sort((a,b)=>a.name.localeCompare(b.name))};
  }

  if(action==="list_documents"){
   const folderId=id(input.folderId,"Folder ID"),folderRef=folders.doc(folderId),
    folder=await folderRef.get();
   if(!folder.exists||folder.data().schoolId!==ctx.schoolId||
      (!admin&&folder.data().status!=="active"))
    deny("not-found","This school reference folder is unavailable.");
   const includeArchived=admin&&input.includeArchived===true,
    snap=await folderRef.collection("documents").limit(101).get();
   if(snap.size===101)
    deny("resource-exhausted","This shared reference folder requires pagination before adding more documents.");
   return {
    folder:{folderId,name:folder.data().name,status:folder.data().status,
      revision:folder.data().revision||1},
    documents:snap.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&
      (includeArchived||doc.data().status==="active")).map(doc=>({
       documentId:doc.id,title:doc.data().title,text:doc.data().text,
       sourceType:doc.data().sourceType||"text",status:doc.data().status,
       revision:doc.data().revision||1,updatedAt:doc.data().updatedAt?.toMillis?.()||null
      })).sort((a,b)=>a.title.localeCompare(b.title))
   };
  }

  if(action==="create_folder"){
   requireAdmin();
   const name=text(input.name,140,"Folder name"),ref=folders.doc(),
    auditRef=db.collection(prefix+"planning_audit").doc();
   await db.runTransaction(async tx=>{
    await currentAuthority(tx,"school_admin");
    const existing=await tx.get(folders.limit(101));
    if(existing.size>=100)
     deny("resource-exhausted","A school shared library supports up to 100 folders until pagination is enabled.");
    const now=FieldValue.serverTimestamp();
    tx.create(ref,{schoolId:ctx.schoolId,name,status:"active",documentCount:0,revision:1,
      createdByUid:ctx.uid,updatedByUid:ctx.uid,createdAt:now,updatedAt:now});
    tx.create(auditRef,audit("school_reference_folder_created",{folderId:ref.id,name}));
   });
   return {folderId:ref.id,name,status:"active",revision:1};
  }

  if(action==="rename_folder"){
   requireAdmin();
   const folderId=id(input.folderId,"Folder ID"),name=text(input.name,140,"Folder name"),
    expectedRevision=input.expectedRevision,ref=folders.doc(folderId),
    auditRef=db.collection(prefix+"planning_audit").doc();
   if(!Number.isInteger(expectedRevision)||expectedRevision<1)
    deny("invalid-argument","The current folder revision is required.");
   let revision;
   await db.runTransaction(async tx=>{
    await currentAuthority(tx,"school_admin");
    const current=await tx.get(ref);
    if(!current.exists||current.data().schoolId!==ctx.schoolId)
     deny("not-found","The shared reference folder is unavailable.");
    if((current.data().revision||1)!==expectedRevision)
     deny("failed-precondition","This folder changed. Reload it before renaming.");
    revision=expectedRevision+1;const now=FieldValue.serverTimestamp();
    tx.update(ref,{name,revision,updatedByUid:ctx.uid,updatedAt:now});
    tx.create(auditRef,audit("school_reference_folder_renamed",{
      folderId,beforeName:current.data().name,afterName:name,revision
    }));
   });
   return {folderId,name,revision};
  }

  if(action==="set_folder_status"){
   requireAdmin();
   const folderId=id(input.folderId,"Folder ID"),status=validStatus(input.status),
    expectedRevision=input.expectedRevision,ref=folders.doc(folderId),
    auditRef=db.collection(prefix+"planning_audit").doc();
   if(!Number.isInteger(expectedRevision)||expectedRevision<1)
    deny("invalid-argument","The current folder revision is required.");
   let revision;
   await db.runTransaction(async tx=>{
    await currentAuthority(tx,"school_admin");
    const current=await tx.get(ref);
    if(!current.exists||current.data().schoolId!==ctx.schoolId)
     deny("not-found","The shared reference folder is unavailable.");
    if((current.data().revision||1)!==expectedRevision)
     deny("failed-precondition","This folder changed. Reload it before updating its status.");
    if(current.data().status===status)return;
    revision=expectedRevision+1;const now=FieldValue.serverTimestamp();
    tx.update(ref,{status,revision,updatedByUid:ctx.uid,updatedAt:now,
      ...(status==="archived"?{archivedByUid:ctx.uid,archivedAt:now}:
       {restoredByUid:ctx.uid,restoredAt:now})});
    tx.create(auditRef,audit(status==="archived"?
      "school_reference_folder_archived":"school_reference_folder_restored",{
       folderId,revision
      }));
   });
   return {folderId,status,revision:revision||expectedRevision};
  }

  async function saveTextDocument({folderId,title,body,sourceType,sourceMetadata=null}){
   const folderRef=folders.doc(folderId),docRef=folderRef.collection("documents").doc(),
    auditRef=db.collection(prefix+"planning_audit").doc();
   let result;
   await db.runTransaction(async tx=>{
    await currentAuthority(tx,"school_admin");
    const [folder,existing]=await Promise.all([
      tx.get(folderRef),tx.get(folderRef.collection("documents").limit(101))
    ]);
    if(!folder.exists||folder.data().schoolId!==ctx.schoolId||folder.data().status!=="active")
     deny("failed-precondition","Add documents only to an active school shared folder.");
    if(existing.size>=100)
     deny("resource-exhausted","A shared folder supports up to 100 documents until pagination is enabled.");
    const now=FieldValue.serverTimestamp(),folderRevision=(folder.data().revision||1)+1;
    tx.create(docRef,{schoolId:ctx.schoolId,folderId,createdByUid:ctx.uid,
      title,text:body,sourceType,status:"active",revision:1,
      ...(sourceMetadata?{sourceMetadata}:{}),createdAt:now,updatedAt:now});
    tx.update(folderRef,{documentCount:(Number(folder.data().documentCount)||0)+1,
      revision:folderRevision,updatedByUid:ctx.uid,updatedAt:now});
    tx.create(auditRef,audit("school_reference_document_created",{
      folderId,documentId:docRef.id,title,sourceType,folderRevision
    }));
    result={folderId,documentId:docRef.id,title,sourceType,status:"active",revision:1};
   });
   return result;
  }

  if(action==="add_text"){
   requireAdmin();
   const folderId=id(input.folderId,"Folder ID"),
    title=text(input.title,180,"Document title"),
    body=text(input.text,650000,"Reference text");
   return saveTextDocument({folderId,title,body,sourceType:"text"});
  }

  if(action==="import_pdf"){
   requireAdmin();
   const folderId=id(input.folderId,"Folder ID"),
    fileName=text(input.fileName,180,"PDF filename"),
    bytes=decodePdf(input.pdfBase64),
    ai=await db.doc(prefix+"private_config/ai").get(),config=ai.data();
   if(!ai.exists||config?.enabled!==true||!config.apiKey)
    deny("failed-precondition","Enable the school's AI connection before extracting PDF text.");
   const extracted=await extractPdf({
    fetchImpl,apiKey:config.apiKey,model:config.model||"gemini-3.8-flash",
    fileName,bytes
   });
   // Revalidation still occurs transactionally inside saveTextDocument.
   return saveTextDocument({
    folderId,title:extracted.title||fileName.replace(/[.]pdf$/i,""),
    body:extracted.text,sourceType:"pdf_extracted_text",
    sourceMetadata:{fileName,pageHint:extracted.pageHint||null,
      extractionModel:config.model||"gemini-3.8-flash"}
   });
  }

  if(action==="update_document"){
   requireAdmin();
   const folderId=id(input.folderId,"Folder ID"),documentId=id(input.documentId,"Document ID"),
    title=text(input.title,180,"Document title"),
    body=text(input.text,650000,"Reference text"),
    expectedRevision=input.expectedRevision,
    folderRef=folders.doc(folderId),docRef=folderRef.collection("documents").doc(documentId),
    auditRef=db.collection(prefix+"planning_audit").doc();
   if(!Number.isInteger(expectedRevision)||expectedRevision<1)
    deny("invalid-argument","The current document revision is required.");
   let revision;
   await db.runTransaction(async tx=>{
    await currentAuthority(tx,"school_admin");
    const [folder,current]=await Promise.all([tx.get(folderRef),tx.get(docRef)]);
    if(!folder.exists||folder.data().schoolId!==ctx.schoolId||folder.data().status!=="active"||
       !current.exists||current.data().schoolId!==ctx.schoolId)
     deny("not-found","This shared reference document is unavailable.");
    if((current.data().revision||1)!==expectedRevision)
     deny("failed-precondition","This document changed. Reload it before saving.");
    revision=expectedRevision+1;const now=FieldValue.serverTimestamp(),
     folderRevision=(folder.data().revision||1)+1;
    tx.update(docRef,{title,text:body,revision,updatedByUid:ctx.uid,updatedAt:now});
    tx.update(folderRef,{revision:folderRevision,updatedByUid:ctx.uid,updatedAt:now});
    tx.create(auditRef,audit("school_reference_document_updated",{
      folderId,documentId,revision,folderRevision
    }));
   });
   return {folderId,documentId,title,revision};
  }

  if(action==="set_document_status"){
   requireAdmin();
   const folderId=id(input.folderId,"Folder ID"),documentId=id(input.documentId,"Document ID"),
    status=validStatus(input.status),expectedRevision=input.expectedRevision,
    folderRef=folders.doc(folderId),docRef=folderRef.collection("documents").doc(documentId),
    auditRef=db.collection(prefix+"planning_audit").doc();
   if(!Number.isInteger(expectedRevision)||expectedRevision<1)
    deny("invalid-argument","The current document revision is required.");
   let revision;
   await db.runTransaction(async tx=>{
    await currentAuthority(tx,"school_admin");
    const [folder,current]=await Promise.all([tx.get(folderRef),tx.get(docRef)]);
    if(!folder.exists||folder.data().schoolId!==ctx.schoolId||
       !current.exists||current.data().schoolId!==ctx.schoolId)
     deny("not-found","This shared reference document is unavailable.");
    if((current.data().revision||1)!==expectedRevision)
     deny("failed-precondition","This document changed. Reload it before updating its status.");
    if(current.data().status===status)return;
    revision=expectedRevision+1;const now=FieldValue.serverTimestamp(),
     folderRevision=(folder.data().revision||1)+1;
    tx.update(docRef,{status,revision,updatedByUid:ctx.uid,updatedAt:now,
      ...(status==="archived"?{archivedByUid:ctx.uid,archivedAt:now}:
       {restoredByUid:ctx.uid,restoredAt:now})});
    tx.update(folderRef,{
      documentCount:Math.max(0,(Number(folder.data().documentCount)||0)+(status==="active"?1:-1)),
      revision:folderRevision,updatedByUid:ctx.uid,updatedAt:now
    });
    tx.create(auditRef,audit(status==="archived"?
      "school_reference_document_archived":"school_reference_document_restored",{
       folderId,documentId,revision,folderRevision
      }));
   });
   return {folderId,documentId,status,revision:revision||expectedRevision};
  }

  if(action==="copy_folder"){
   if(!teacher)deny("permission-denied","Active teacher access is required to copy a school reference folder.");
   const folderId=id(input.folderId,"Folder ID"),folderRef=folders.doc(folderId),
    sourceDocs=await folderRef.collection("documents").limit(101).get();
   if(sourceDocs.size===101)
    deny("resource-exhausted","This shared folder requires pagination before it can be copied safely.");
   const activeDocs=sourceDocs.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&
     doc.data().status==="active");
   const privateFolders=db.collection(prefix+"teacher_reference_folders"),
    destination=privateFolders.doc(),auditRef=db.collection(prefix+"planning_audit").doc();
   let result;
   await db.runTransaction(async tx=>{
    await currentAuthority(tx,"teacher");
    const [source,existingPrivate]=await Promise.all([
      tx.get(folderRef),tx.get(privateFolders.where("ownerUid","==",ctx.uid).limit(101))
    ]);
    if(!source.exists||source.data().schoolId!==ctx.schoolId||source.data().status!=="active")
     deny("failed-precondition","Only an active school shared folder can be copied.");
    if(existingPrivate.size>=100)
     deny("resource-exhausted","Your private reference library supports up to 100 folders until pagination is enabled.");
    const now=FieldValue.serverTimestamp(),name=text(source.data().name,140,"Folder name");
    tx.create(destination,{schoolId:ctx.schoolId,ownerUid:ctx.uid,name,status:"active",
      documentCount:activeDocs.length,revision:1,createdAt:now,updatedAt:now,
      copiedFrom:{scope:"school_shared",folderId,sourceRevision:source.data().revision||1,
       copiedAt:now}});
    for(const sourceDoc of activeDocs){
      const data=sourceDoc.data(),copyRef=destination.collection("documents").doc();
      tx.create(copyRef,{schoolId:ctx.schoolId,ownerUid:ctx.uid,folderId:destination.id,
        title:text(data.title,180,"Document title"),
        text:text(data.text,650000,"Reference text"),
        sourceType:["text","pdf_extracted_text"].includes(data.sourceType)?
          data.sourceType:"text",
        status:"active",revision:1,createdAt:now,updatedAt:now,
        copiedFrom:{scope:"school_shared",folderId,documentId:sourceDoc.id,
          sourceRevision:data.revision||1,copiedAt:now}});
    }
    tx.create(auditRef,audit("school_reference_folder_copied_private",{
      sourceFolderId:folderId,destinationFolderId:destination.id,
      documentCount:activeDocs.length
    }));
    result={sourceFolderId:folderId,folderId:destination.id,name,
      documentCount:activeDocs.length,status:"active"};
   });
   return result;
  }

  deny("invalid-argument","Unknown school shared reference operation.");
 };
}
module.exports={createSchoolSharedReferenceService};
