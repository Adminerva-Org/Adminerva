"use strict";
/**
 * Adminerva 4.0 school support reports.
 * School members may create/read their own reports; active school admins may
 * triage all reports for that school. No platform-owner or email-domain
 * shortcut grants access to private school reports.
 */
const {FieldValue,Timestamp}=require("firebase-admin/firestore");
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");
const {writeSchoolNotification}=require("./school-notifications.js");

function deny(code,message){throw new TenantAccessError(code,message)}
const CATEGORIES=new Set(["Bug","Feature","Access","UI","Other"]);
const STATUSES=new Set(["Open","Triaged","Waiting for Reporter","In Progress","Resolved","Closed"]);
const PRIORITIES=new Set(["Low","Medium","High","Critical"]);
const FILE_TYPES=new Set(["image/png","image/jpeg","image/webp","application/pdf","text/plain"]);
const MAX_ATTACHMENTS=12;

function text(value,max,label,{required=true,min=1}={}){
  const result=typeof value==="string"?value.trim():"";
  if((required&&result.length<min)||result.length>max)
    deny("invalid-argument",label+" is missing or outside the allowed length.");
  return result;
}
function recordId(value,label="Report ID"){
  if(typeof value!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(value))
    deny("invalid-argument","Invalid "+label.toLowerCase()+".");
  return value;
}
function serializeReport(doc,viewerUid,isAdmin){
  const data=doc.data();
  return {
    reportId:doc.id,schoolId:data.schoolId,title:data.title,description:data.description,
    category:data.category,module:data.module||"",status:data.status,priority:data.priority,
    locked:Boolean(data.locked),revision:data.revision||1,
    isMine:data.reporterUid===viewerUid,
    reporterLabel:data.reporterUid===viewerUid?"You":isAdmin?(data.reporterDisplayName||"School member"):"School member",
    reporterRole:data.reporterRole||"member",
    createdAt:data.createdAt?.toMillis?.()||null,updatedAt:data.updatedAt?.toMillis?.()||null
  };
}
function createSchoolSupportService({db,bucket}){
 return async request=>{
  const input=request.data||{};
  const ctx=await getSchoolContext({db,request,schoolId:input.schoolId});
  const prefix="schools/"+ctx.schoolId+"/";
  const reports=db.collection(prefix+"support_reports");
  const schoolRef=db.doc("platform_schools/"+ctx.schoolId);
  const memberRef=db.doc(prefix+"memberships/"+ctx.uid);
  const isAdmin=ctx.roles.includes("school_admin");

  async function currentAuthority(tx){
    const [school,member]=await Promise.all([tx.get(schoolRef),tx.get(memberRef)]);
    if(!school.exists||school.data().state!=="active"||!member.exists||
       member.data().schoolId!==ctx.schoolId||member.data().status!=="active")
      deny("permission-denied","Your school access changed. Refresh before continuing.");
    const roles=Array.isArray(member.data().roles)?member.data().roles:[];
    if(!roles.some(role=>["student","teacher","school_admin"].includes(role)))
      deny("permission-denied","Your school role cannot use support reports.");
    return {roles,displayName:String(member.data().displayName||"").slice(0,140)};
  }

  if(input.action==="overview"){
    if(!isAdmin)deny("permission-denied","School administration access is required for support counts.");
    const snap=await reports.limit(501).get();
    if(snap.size===501)deny("resource-exhausted","School support counts require a paginated aggregate.");
    const schoolRows=snap.docs.filter(doc=>doc.data().schoolId===ctx.schoolId);
    return {counts:{
      total:schoolRows.length,
      open:schoolRows.filter(doc=>!["Resolved","Closed"].includes(doc.data().status)).length,
      waiting:schoolRows.filter(doc=>doc.data().status==="Waiting for Reporter").length,
      critical:schoolRows.filter(doc=>doc.data().priority==="Critical"&&!["Resolved","Closed"].includes(doc.data().status)).length
    }};
  }

  if(input.action==="create"){
    const title=text(input.title,160,"Title",{min:4});
    const description=text(input.description,6000,"Description",{min:12});
    const category=text(input.category,20,"Category");
    if(!CATEGORIES.has(category))deny("invalid-argument","Choose a supported report category.");
    const module=text(input.module||"",80,"Module",{required:false});
    if(Array.isArray(input.attachments)&&input.attachments.length)
      deny("failed-precondition","School report attachments are disabled until the school file-storage policy is enabled.");
    const ref=reports.doc(),audit=db.collection(prefix+"support_audit").doc();
    let adminUids=[];
    await db.runTransaction(async tx=>{
      const authority=await currentAuthority(tx),now=FieldValue.serverTimestamp();
      const role=authority.roles.includes("school_admin")?"school_admin":
        authority.roles.includes("teacher")?"teacher":"student";
      tx.create(ref,{
        schoolId:ctx.schoolId,reporterUid:ctx.uid,reporterDisplayName:authority.displayName,
        reporterRole:role,title,description,category,module,
        audience:"school_admin",status:"Open",priority:"Medium",locked:false,
        revision:1,createdAt:now,updatedAt:now
      });
      tx.create(audit,{schoolId:ctx.schoolId,reportId:ref.id,actorUid:ctx.uid,
        action:"support_report_created",revision:1,createdAt:now});
    });
    const admins=await db.collection(prefix+"memberships")
      .where("roles","array-contains","school_admin").limit(50).get().catch(()=>null);
    if(admins)adminUids=admins.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&
      doc.data().status==="active"&&doc.id!==ctx.uid).map(doc=>doc.id);
    await Promise.allSettled(adminUids.map(uid=>writeSchoolNotification({
      db,schoolId:ctx.schoolId,uid,id:"support_report_"+ref.id,
      title:"New school support report",body:category+" · "+title,
      type:"issue",sourceId:ref.id,target:"school-support.html?report="+encodeURIComponent(ref.id)
    })));
    return {reportId:ref.id,status:"Open",revision:1};
  }

  if(input.action==="list"){
    const limit=Math.min(100,Math.max(1,Number.isInteger(input.limit)?input.limit:50));
    let snap;
    if(isAdmin) snap=await reports.orderBy("updatedAt","desc").limit(limit+1).get();
    else snap=await reports.where("reporterUid","==",ctx.uid).limit(limit+1).get();
    const docs=snap.docs.filter(doc=>doc.data().schoolId===ctx.schoolId)
      .sort((a,b)=>(b.data().updatedAt?.toMillis?.()||0)-(a.data().updatedAt?.toMillis?.()||0));
    return {reports:docs.slice(0,limit).map(doc=>serializeReport(doc,ctx.uid,isAdmin)),
      truncated:docs.length>limit};
  }

  const reportId=recordId(input.reportId),reportRef=reports.doc(reportId);

  if(input.action==="get"){
    const report=await reportRef.get();
    if(!report.exists||report.data().schoolId!==ctx.schoolId)
      deny("not-found","School support report is unavailable.");
    const data=report.data();
    if(data.reporterUid!==ctx.uid&&!isAdmin)
      deny("permission-denied","This private school support report is not assigned to you.");
    const comments=await reportRef.collection("comments").orderBy("createdAt","asc").limit(101).get();
    if(comments.size===101)deny("resource-exhausted","This discussion needs pagination before more comments are shown.");
    const attachments=await reportRef.collection("attachments").orderBy("createdAt","asc").limit(MAX_ATTACHMENTS+1).get();
    if(attachments.size>MAX_ATTACHMENTS)
      deny("resource-exhausted","This report has more attachments than the supported page limit.");
    return {report:serializeReport(report,ctx.uid,isAdmin),comments:comments.docs.map(doc=>({
      commentId:doc.id,text:doc.data().text,authorUid:doc.data().authorUid,
      authorLabel:doc.data().authorUid===ctx.uid?"You":
        isAdmin?(doc.data().authorDisplayName||"School member"):"School administrator",
      authorRole:doc.data().authorRole||"member",createdAt:doc.data().createdAt?.toMillis?.()||null
    })),attachments:attachments.docs.filter(doc=>doc.data().state==="active").map(doc=>({
      attachmentId:doc.id,originalName:doc.data().originalName,
      contentType:doc.data().contentType,size:doc.data().size,
      storagePath:doc.data().storagePath,
      createdAt:doc.data().createdAt?.toMillis?.()||null,
      expiresAt:doc.data().expiresAt?.toMillis?.()||null
    }))};
  }


  if(input.action==="prepare_attachment"){
    if(!bucket)deny("unavailable","School file storage is not available in this environment.");
    const fileId=recordId(input.fileId,"Attachment ID"),
      originalName=text(input.originalName,180,"File name",{min:1}),
      contentType=text(input.contentType,100,"Content type",{min:3}),
      size=Number(input.size);
    if(!/^[a-f0-9]{32,64}$/.test(fileId))
      deny("invalid-argument","Attachment ID must be a secure hexadecimal identifier.");
    if(!FILE_TYPES.has(contentType))
      deny("invalid-argument","This attachment type is not allowed.");
    if(!Number.isInteger(size)||size<1)
      deny("invalid-argument","Attachment size is invalid.");
    const policyRef=db.doc(prefix+"private_config/file_policy"),
      attachmentRef=reportRef.collection("attachments").doc(fileId),
      auditRef=db.collection(prefix+"support_audit").doc();
    let storagePath,maxBytes;
    await db.runTransaction(async tx=>{
      await currentAuthority(tx);
      const [report,policy,existing,attachments]=await Promise.all([
        tx.get(reportRef),tx.get(policyRef),tx.get(attachmentRef),
        tx.get(reportRef.collection("attachments").limit(MAX_ATTACHMENTS+1))
      ]);
      if(!report.exists||report.data().schoolId!==ctx.schoolId)
        deny("not-found","School support report is unavailable.");
      if(report.data().reporterUid!==ctx.uid)
        deny("permission-denied","Only the report owner can add an attachment.");
      if(report.data().locked||report.data().status==="Closed")
        deny("failed-precondition","Attachments cannot be added to a locked or closed report.");
      const filePolicy=policy.data();
      if(!policy.exists||filePolicy?.enabled!==true||filePolicy?.supportAttachmentsEnabled!==true)
        deny("failed-precondition","School support attachments are not enabled by the school file policy.");
      if(!Number.isInteger(filePolicy.maxBytes)||size>filePolicy.maxBytes)
        deny("invalid-argument","The attachment exceeds this school's per-file limit.");
      if(existing.exists)
        deny("already-exists","This attachment reservation already exists.");
      if(attachments.size>=MAX_ATTACHMENTS)
        deny("resource-exhausted","This report already has the maximum number of attachments.");
      maxBytes=filePolicy.maxBytes;
      storagePath="schools/"+ctx.schoolId+"/support/"+reportId+"/"+ctx.uid+"/"+fileId;
      const now=FieldValue.serverTimestamp();
      tx.create(attachmentRef,{
        schoolId:ctx.schoolId,reportId,attachmentId:fileId,uploaderUid:ctx.uid,
        originalName,contentType,size,storagePath,state:"pending",revision:1,
        createdAt:now,updatedAt:now,
        expiresAt:Timestamp.fromMillis(Date.now()+60*60*1000)
      });
      tx.create(auditRef,{schoolId:ctx.schoolId,reportId,actorUid:ctx.uid,
        action:"support_attachment_reserved",attachmentId:fileId,
        contentType,size,createdAt:now});
    });
    return {reportId,attachmentId:fileId,storagePath,contentType,size,maxBytes,
      requiredMetadata:{schoolId:ctx.schoolId,reportId,ownerUid:ctx.uid,
        fileId,kind:"support_attachment"}};
  }

  if(input.action==="finalize_attachment"){
    if(!bucket)deny("unavailable","School file storage is not available in this environment.");
    const fileId=recordId(input.fileId,"Attachment ID");
    if(!/^[a-f0-9]{32,64}$/.test(fileId))
      deny("invalid-argument","Attachment ID is invalid.");
    const attachmentRef=reportRef.collection("attachments").doc(fileId),
      policyRef=db.doc(prefix+"private_config/file_policy");
    const [report,attachment,policy]=await Promise.all([
      reportRef.get(),attachmentRef.get(),policyRef.get()
    ]);
    if(!report.exists||report.data().schoolId!==ctx.schoolId)
      deny("not-found","School support report is unavailable.");
    if(report.data().reporterUid!==ctx.uid)
      deny("permission-denied","Only the report owner can finalize an attachment.");
    if(!attachment.exists||attachment.data().schoolId!==ctx.schoolId||
       attachment.data().uploaderUid!==ctx.uid||attachment.data().state!=="pending")
      deny("failed-precondition","The attachment reservation is unavailable or already finalized.");
    const filePolicy=policy.data();
    if(!policy.exists||filePolicy?.enabled!==true||filePolicy?.supportAttachmentsEnabled!==true)
      deny("failed-precondition","School support attachments are not currently enabled.");
    const expected=attachment.data(),file=bucket().file(expected.storagePath);
    let metadata;
    try{[metadata]=await file.getMetadata();}catch(error){
      if(Number(error?.code)===404)deny("failed-precondition","Upload the reserved file before finalizing it.");
      throw error;
    }
    const custom=metadata.metadata||{},actualSize=Number(metadata.size);
    const valid=metadata.name===expected.storagePath&&
      metadata.contentType===expected.contentType&&actualSize===expected.size&&
      actualSize<=filePolicy.maxBytes&&FILE_TYPES.has(metadata.contentType)&&
      custom.schoolId===ctx.schoolId&&custom.reportId===reportId&&
      custom.ownerUid===ctx.uid&&custom.fileId===fileId&&
      custom.kind==="support_attachment";
    if(!valid){
      await file.delete({ignoreNotFound:true}).catch(()=>{});
      deny("failed-precondition","The uploaded file metadata does not match its secure reservation.");
    }
    const retentionDays=Number(filePolicy.retentionDays);
    if(![30,90,180,365].includes(retentionDays))
      deny("failed-precondition","The school file policy has an invalid retention period.");
    const expiresAt=Timestamp.fromMillis(Date.now()+retentionDays*86400000),
      auditRef=db.collection(prefix+"support_audit").doc();
    await db.runTransaction(async tx=>{
      await currentAuthority(tx);
      const [current,currentReport,currentPolicy]=await Promise.all([
        tx.get(attachmentRef),tx.get(reportRef),tx.get(policyRef)
      ]);
      if(!current.exists||current.data().state!=="pending"||
         current.data().storagePath!==expected.storagePath||
         current.data().uploaderUid!==ctx.uid)
        deny("failed-precondition","The attachment reservation changed before finalization.");
      if(!currentReport.exists||currentReport.data().reporterUid!==ctx.uid||
         currentReport.data().locked||currentReport.data().status==="Closed")
        deny("failed-precondition","This report can no longer accept the attachment.");
      if(!currentPolicy.exists||currentPolicy.data().enabled!==true||
         currentPolicy.data().supportAttachmentsEnabled!==true)
        deny("failed-precondition","The school file policy changed before finalization.");
      const now=FieldValue.serverTimestamp();
      tx.update(attachmentRef,{state:"active",revision:2,expiresAt,
        finalizedAt:now,updatedAt:now});
      tx.update(reportRef,{updatedAt:now});
      tx.create(auditRef,{schoolId:ctx.schoolId,reportId,actorUid:ctx.uid,
        action:"support_attachment_finalized",attachmentId:fileId,
        retentionDays,expiresAt,createdAt:now});
    });
    return {reportId,attachmentId:fileId,state:"active",
      expiresAt:expiresAt.toMillis()};
  }

  if(input.action==="comment"){
    const body=text(input.text,3000,"Comment",{min:1});
    const commentRef=reportRef.collection("comments").doc();
    let reportOwner=null,notifyAdmins=false,reportTitle="";
    await db.runTransaction(async tx=>{
      const authority=await currentAuthority(tx),report=await tx.get(reportRef);
      if(!report.exists||report.data().schoolId!==ctx.schoolId)
        deny("not-found","School support report is unavailable.");
      const data=report.data(),admin=authority.roles.includes("school_admin");
      if(data.reporterUid!==ctx.uid&&!admin)
        deny("permission-denied","You cannot comment on another member's private school report.");
      if(data.locked)deny("failed-precondition","This support discussion is locked.");
      if(["Closed"].includes(data.status))deny("failed-precondition","Closed support reports cannot receive new comments.");
      const role=admin?"school_admin":authority.roles.includes("teacher")?"teacher":"student";
      const now=FieldValue.serverTimestamp();
      tx.create(commentRef,{schoolId:ctx.schoolId,reportId,authorUid:ctx.uid,
        authorDisplayName:authority.displayName,authorRole:role,text:body,createdAt:now});
      tx.update(reportRef,{updatedAt:now});
      tx.create(db.collection(prefix+"support_audit").doc(),{
        schoolId:ctx.schoolId,reportId,actorUid:ctx.uid,action:"support_comment_added",
        createdAt:now});
      reportOwner=data.reporterUid;notifyAdmins=!admin;reportTitle=data.title;
    });
    if(reportOwner&&reportOwner!==ctx.uid)await writeSchoolNotification({
      db,schoolId:ctx.schoolId,uid:reportOwner,id:"support_comment_"+reportId+"_"+commentRef.id,
      title:"School support report updated",body:reportTitle+" · a school administrator replied.",
      type:"issue",sourceId:reportId,target:"school-support.html?report="+encodeURIComponent(reportId)
    }).catch(()=>{});
    if(notifyAdmins){
      const admins=await db.collection(prefix+"memberships").where("roles","array-contains","school_admin")
        .limit(50).get().catch(()=>null);
      if(admins)await Promise.allSettled(admins.docs.filter(doc=>doc.id!==ctx.uid&&
        doc.data().schoolId===ctx.schoolId&&doc.data().status==="active").map(doc=>
        writeSchoolNotification({db,schoolId:ctx.schoolId,uid:doc.id,
          id:"support_comment_"+reportId+"_"+commentRef.id,title:"School support report updated",
          body:reportTitle+" · reporter added a comment.",type:"issue",sourceId:reportId,
          target:"school-support.html?report="+encodeURIComponent(reportId)})));
    }
    return {reportId,commentId:commentRef.id};
  }

  if(input.action==="triage"){
    if(!isAdmin)deny("permission-denied","Only a school administrator may triage school support reports.");
    const status=text(input.status,40,"Status"),priority=text(input.priority,20,"Priority");
    if(!STATUSES.has(status)||!PRIORITIES.has(priority))
      deny("invalid-argument","Choose a supported support status and priority.");
    const locked=input.locked===true;
    const reason=text(input.reason,600,"Decision reason",{min:12});
    const expectedRevision=input.expectedRevision;
    if(!Number.isInteger(expectedRevision)||expectedRevision<1)
      deny("invalid-argument","The current report revision is required.");
    let reporterUid=null,reportTitle="",revision=null;
    await db.runTransaction(async tx=>{
      const authority=await currentAuthority(tx);
      if(!authority.roles.includes("school_admin"))
        deny("permission-denied","Your school administration access changed.");
      const report=await tx.get(reportRef);
      if(!report.exists||report.data().schoolId!==ctx.schoolId)
        deny("not-found","School support report is unavailable.");
      const data=report.data();
      if((data.revision||1)!==expectedRevision)
        deny("failed-precondition","This report changed. Reload it before saving a triage decision.");
      revision=expectedRevision+1;const now=FieldValue.serverTimestamp();
      tx.update(reportRef,{status,priority,locked,revision,updatedAt:now,
        triagedByUid:ctx.uid,lastDecisionReason:reason});
      tx.create(db.collection(prefix+"support_audit").doc(),{
        schoolId:ctx.schoolId,reportId,actorUid:ctx.uid,action:"support_report_triaged",
        before:{status:data.status,priority:data.priority,locked:Boolean(data.locked),revision:expectedRevision},
        after:{status,priority,locked,revision},reason,createdAt:now
      });
      reporterUid=data.reporterUid;reportTitle=data.title;
    });
    if(reporterUid&&reporterUid!==ctx.uid)await writeSchoolNotification({
      db,schoolId:ctx.schoolId,uid:reporterUid,id:"support_triage_"+reportId+"_"+revision,
      title:"School support report updated",body:reportTitle+" · status: "+status+".",
      type:"issue",sourceId:reportId,target:"school-support.html?report="+encodeURIComponent(reportId)
    }).catch(()=>{});
    return {reportId,status,priority,locked,revision};
  }

  deny("invalid-argument","Unknown school support operation.");
 };
}
module.exports={FILE_TYPES,MAX_ATTACHMENTS,createSchoolSupportService};
