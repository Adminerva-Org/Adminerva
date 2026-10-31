"use strict";
/**
 * Adminerva 4.0 school continuity export.
 *
 * This is an administrator recovery/export surface, not a privacy bypass.
 * Teacher-private resources, student source code/evidence payloads, secrets and
 * transient runtime/session data are deliberately excluded.
 */
const {FieldPath}=require("firebase-admin/firestore");
const {createHash}=require("node:crypto");
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");

const EXPORT_SCHEMA="adminerva-school-continuity-export-v2";
function deny(code,message){throw new TenantAccessError(code,message)}
function scalar(value){
 if(value?.toMillis)return new Date(value.toMillis()).toISOString();
 if(Array.isArray(value))return value.map(scalar);
 if(value&&typeof value==="object"){
  const out={};for(const [key,item] of Object.entries(value))out[key]=scalar(item);return out;
 }
 return value===undefined?null:value;
}
const pick=(data,keys)=>Object.fromEntries(keys.filter(key=>data[key]!==undefined)
 .map(key=>[key,scalar(data[key])]));
const definitions={
 people:{path:"people",fields:["displayName","kind","status","authUid","externalId","revision","createdAt","updatedAt"]},
 memberships:{path:"memberships",fields:["schoolId","status","roles","personId","displayName","revision","createdAt","updatedAt"]},
 academic_years:{path:"academic_years",fields:["name","status","revision","createdByUid","createdAt","updatedAt"]},
 terms:{path:"terms",fields:["name","yearId","status","revision","createdByUid","createdAt","updatedAt"]},
 subjects:{path:"subjects",fields:["name","status","revision","createdByUid","createdAt","updatedAt"]},
 sections:{path:"sections",fields:["name","status","revision","createdByUid","createdAt","updatedAt"]},
 course_offerings:{path:"course_offerings",fields:["yearId","termId","subjectId","sectionId","status","createdByUid","createdAt"]},
 enrollments:{path:"enrollments",fields:["personId","offeringId","yearId","termId","subjectId","sectionId","status","revision","createdByUid","createdAt","endedAt","endReason","restoredAt","restoreReason"]},
 staff_assignments:{path:"staff_assignments",fields:["teacherUid","offeringId","yearId","termId","subjectId","sectionId","status","revision","createdByUid","createdAt","endedAt","endReason","restoredAt","restoreReason"]},
 student_repository_configs:{path:"student_repository_configs",fields:["personId","studentUid","offeringId","repository","repositoryUrl","githubUsername","revision","createdAt","updatedAt"]},
 assessments:{path:"assessments",fields:["ownerUid","reviewerUid","blueprintId","blueprintRevision","offeringId","yearId","termId","subjectId","sectionId","title","description","instructions","rubric","rubricMax","submissionSource","opensAt","dueAt","requestKey","status","lifecycle","revision","preArchiveLifecycle","handoverFromUid","handoverByUid","handoverAt","handoverReason","createdAt","updatedAt"]},
 student_grades:{path:"student_grades",publishedOnly:true,fields:["taskId","offeringId","personId","studentUid","reviewerUid","evidenceType","submissionId","submissionVersion","submissionDigest","gradeSchema","criteria","awarded","pending","total","feedback","status","revision","publishedAt","publishedByUid","updatedAt","createdAt"]},
 support_reports:{path:"support_reports",fields:["reporterUid","reporterDisplayName","reporterRole","title","description","category","module","audience","status","priority","locked","revision","createdAt","updatedAt","triagedByUid","lastDecisionReason"]}
};
const CATEGORY_NAMES=Object.keys(definitions);
const categoryDigest=rows=>createHash("sha256").update(JSON.stringify(rows)).digest("hex");
async function readCategoryRows(db,prefix,category,{limit=20001}={}){
 const def=definitions[category];
 if(!def)deny("invalid-argument","Choose a supported continuity-export category.");
 const rows=[];let cursor=null;
 while(rows.length<limit){
  const batchLimit=Math.min(200,limit-rows.length);
  let query=db.collection(prefix+def.path);
  if(def.publishedOnly)query=query.where("status","==","published");
  query=query.orderBy(FieldPath.documentId()).limit(batchLimit);
  if(cursor)query=query.startAfter(cursor);
  const snap=await query.get();
  for(const doc of snap.docs)rows.push({id:doc.id,...pick(doc.data(),def.fields)});
  if(snap.size<batchLimit)break;
  cursor=snap.docs.at(-1)?.id||null;
  if(!cursor)break;
 }
 if(rows.length>=limit)
  deny("resource-exhausted","This continuity-export category exceeds the 20,000-record safety boundary.");
 return rows;
}
function createSchoolDataExportService({db}){
 return async request=>{
  const input=request.data||{};
  const ctx=await getSchoolContext({db,request,schoolId:input.schoolId,roles:["school_admin"]});
  const prefix="schools/"+ctx.schoolId+"/",
   memberRef=db.doc(prefix+"memberships/"+ctx.uid),
   schoolRef=db.doc("platform_schools/"+ctx.schoolId);
  async function authority(){
   const [member,school]=await Promise.all([memberRef.get(),schoolRef.get()]);
   if(!school.exists||school.data().state!=="active"||!member.exists||
      member.data().schoolId!==ctx.schoolId||member.data().status!=="active"||
      !Array.isArray(member.data().roles)||!member.data().roles.includes("school_admin"))
    deny("permission-denied","Your school administration access changed. Refresh before exporting.");
   return school;
  }
  if((input.action||"manifest")==="manifest"){
   const school=await authority(),counts={};
   await Promise.all(CATEGORY_NAMES.map(async category=>{
    const def=definitions[category],collection=db.collection(prefix+def.path);
    if(def.publishedOnly){
      const result=await collection.where("status","==","published").count().get();
      counts[category]=result.data().count||0;
    }else{
      const result=await collection.count().get();counts[category]=result.data().count||0;
    }
   }));
   return {
    schema:EXPORT_SCHEMA,schoolId:ctx.schoolId,
    schoolDisplayName:String(school.data().displayName||ctx.schoolId).slice(0,120),
    generatedAt:new Date().toISOString(),categories:CATEGORY_NAMES,counts,
    pageSize:100,
    includes:[
     "canonical people and membership linkage",
     "academic catalog, offerings, enrollments, teaching assignments and school-scoped student repository configuration",
     "deployed assessment snapshots",
     "published grade records",
     "school support report records"
    ],
    excludes:[
     "Firebase credentials, email-domain authorization and provider secrets",
     "teacher-private assessment blueprints and planning/reference resources",
     "student Studio source code, GitHub evidence payloads and repository caches",
     "unpublished teacher grade drafts",
     "Practice attempts, sessions and public leaderboard state",
     "support attachment binary files and nested comments",
     "audit/event streams and transient notification/session records"
    ],
    privacyNotice:"This export contains school personal and academic records. Store it only in an institutionally approved protected location."
   };
  }
  if(input.action==="page"){
   await authority();
   const category=String(input.category||""),def=definitions[category];
   if(!def)deny("invalid-argument","Choose a supported continuity-export category.");
   const cursor=typeof input.cursor==="string"&&input.cursor?input.cursor:null,
    limit=Math.min(100,Math.max(1,Number.isInteger(input.limit)?input.limit:100));
   let query=db.collection(prefix+def.path);
   if(def.publishedOnly)query=query.where("status","==","published");
   query=query.orderBy(FieldPath.documentId()).limit(limit+1);
   if(cursor)query=query.startAfter(cursor);
   const snap=await query.get(),page=snap.docs.slice(0,limit),
    rows=page.map(doc=>({id:doc.id,...pick(doc.data(),def.fields)})),
    last=page.at(-1)?.id||null,hasMore=snap.size>limit;
   return {schema:EXPORT_SCHEMA,schoolId:ctx.schoolId,category,rows,
    nextCursor:hasMore&&last?last:null};
  }
  if(input.action==="integrity"){
   await authority();
   const category=String(input.category||"");
   const rows=await readCategoryRows(db,prefix,category);
   return {schema:EXPORT_SCHEMA,schoolId:ctx.schoolId,category,
    count:rows.length,sha256:categoryDigest(rows)};
  }
  if(input.action==="record_receipt"){
   await authority();
   const bundleSha256=String(input.bundleSha256||""),
    categoryIntegrity=input.categoryIntegrity;
   if(!/^[a-f0-9]{64}$/.test(bundleSha256))
    deny("invalid-argument","Continuity bundle SHA-256 is invalid.");
   if(!categoryIntegrity||typeof categoryIntegrity!=="object"||Array.isArray(categoryIntegrity))
    deny("invalid-argument","Continuity category integrity is missing.");
   const verified={};
   for(const category of CATEGORY_NAMES){
    const supplied=categoryIntegrity[category];
    if(!supplied||!Number.isInteger(supplied.count)||supplied.count<0||
       typeof supplied.sha256!=="string"||!/^[a-f0-9]{64}$/.test(supplied.sha256))
      deny("invalid-argument","Continuity category integrity is invalid: "+category);
    const rows=await readCategoryRows(db,prefix,category),
      actual={count:rows.length,sha256:categoryDigest(rows)};
    if(actual.count!==supplied.count||actual.sha256!==supplied.sha256)
      deny("failed-precondition","School data changed before the continuity export receipt was recorded. Recreate the export.");
    verified[category]=actual;
   }
   const receiptRef=db.doc(prefix+"private_config/continuity_export"),
    auditRef=db.collection(prefix+"continuity_export_audit").doc(),
    now=require("firebase-admin/firestore").FieldValue.serverTimestamp();
   await db.runTransaction(async tx=>{
    const [member,school]=await Promise.all([tx.get(memberRef),tx.get(schoolRef)]);
    if(!school.exists||school.data().state!=="active"||!member.exists||
       member.data().schoolId!==ctx.schoolId||member.data().status!=="active"||
       !Array.isArray(member.data().roles)||!member.data().roles.includes("school_admin"))
      deny("permission-denied","Your school administration access changed before the export receipt was recorded.");
    const prior=await tx.get(receiptRef),revision=(prior.data()?.revision||0)+1;
    tx.set(receiptRef,{
      schema:EXPORT_SCHEMA,schoolId:ctx.schoolId,bundleSha256,
      categoryIntegrity:verified,revision,preparedByUid:ctx.uid,preparedAt:now
    });
    tx.create(auditRef,{
      schoolId:ctx.schoolId,actorUid:ctx.uid,action:"continuity_export_receipt_recorded",
      schema:EXPORT_SCHEMA,bundleSha256,revision,
      counts:Object.fromEntries(Object.entries(verified).map(([name,row])=>[name,row.count])),
      createdAt:now
    });
   });
   return {schoolId:ctx.schoolId,schema:EXPORT_SCHEMA,bundleSha256,
    recorded:true,categoryIntegrity:verified};
  }
  deny("invalid-argument","Unknown school continuity-export operation.");
 };
}
module.exports={EXPORT_SCHEMA,CATEGORY_NAMES,definitions,scalar,categoryDigest,readCategoryRows,createSchoolDataExportService};
