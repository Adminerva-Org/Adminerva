"use strict";
/**
 * Scheduled cleanup for registered school support attachments.
 * Pending reservations expire after one hour; finalized attachments use the
 * administrator-selected school retention period stored on each record.
 */
function safePath(data,doc){
 const schoolId=data.schoolId,reportId=data.reportId,fileId=data.attachmentId,
  uploaderUid=data.uploaderUid;
 if(!schoolId||!reportId||!fileId||!uploaderUid)return null;
 const expected="schools/"+schoolId+"/support/"+reportId+"/"+uploaderUid+"/"+fileId;
 return data.storagePath===expected?expected:null;
}
function createSchoolFileRetentionJob({db,bucket,Timestamp,FieldValue}){
 return async ()=>{
  const now=Timestamp.now();
  const snapshot=await db.collectionGroup("attachments")
    .where("expiresAt","<=",now).limit(100).get();
  let expired=0,skipped=0,failed=0;
  for(const doc of snapshot.docs){
   const data=doc.data(),path=safePath(data,doc);
   if(!path||!["pending","active"].includes(data.state)){skipped++;continue;}
   try{
    await bucket().file(path).delete({ignoreNotFound:true});
    await db.runTransaction(async tx=>{
     const current=await tx.get(doc.ref);
     if(!current.exists)return;
     const row=current.data();
     if(!["pending","active"].includes(row.state)||!row.expiresAt||
        row.expiresAt.toMillis()>Date.now())return;
     const auditRef=db.collection("schools/"+row.schoolId+"/file_audit").doc(),
      stamp=FieldValue.serverTimestamp();
     tx.update(doc.ref,{state:"expired",expiredAt:stamp,updatedAt:stamp,
       revision:(row.revision||1)+1});
     tx.create(auditRef,{schoolId:row.schoolId,reportId:row.reportId,
       attachmentId:row.attachmentId,actorUid:"system",
       action:row.state==="pending"?"support_attachment_reservation_expired":
        "support_attachment_retention_expired",
       storagePath:row.storagePath,createdAt:stamp});
    });
    expired++;
   }catch(error){
    failed++;
    console.warn("School file retention cleanup failed",{
     path:doc.ref.path,code:error?.code||"unknown"
    });
   }
  }
  return {examined:snapshot.size,expired,skipped,failed};
 };
}
module.exports={safePath,createSchoolFileRetentionJob};
