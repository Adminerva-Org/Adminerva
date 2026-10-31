"use strict";
/**
 * Read-only MCS planning-support migration planner.
 *
 * Scope:
 * - teacher-owned reference folders/documents
 * - teacher-owned schedules
 *
 * Legacy administrator-shared references and shared app_config timetables are
 * deliberately not copied into every teacher. They are reported separately so
 * a future school-shared policy can be reviewed explicitly.
 */
const {initializeApp,getApps,applicationDefault}=require("firebase-admin/app");
const {getFirestore,FieldPath}=require("firebase-admin/firestore");
const {readFileSync,writeFileSync}=require("node:fs");
const {createHash}=require("node:crypto");
const {SCHOOL_ID}=require("./mcs-canonical-foundation-plan.js");
const {validatePlan:validateFoundationPlan,validateApproval:validateFoundationApproval}=
 require("./mcs-canonical-foundation-apply.js");
const {validatePlan:validateAccessPlan,validateApproval:validateAccessApproval}=
 require("./mcs-canonical-academic-access-apply.js");
const {normalizeRows,rowsToText,scheduleId}=require("./school-schedules.js");

const SCHEMA="adminerva-v4-mcs-canonical-planning-support-plan-v1";
const sha=value=>createHash("sha256").update(value).digest("hex");
const safeId=value=>typeof value==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
function clean(value,max=650000){return typeof value==="string"?value.trim().slice(0,max):"";}
function stableId(prefix,...parts){return prefix+"_"+sha(parts.join("\0")).slice(0,40);}
function parseYearTerm(data,id){
 const year=clean(data?.school_year||data?.schoolYear,40);
 let semester=clean(data?.semester,20).toUpperCase();
 if(!semester){
  const match=String(id||"").match(/_SY(\d{4})(\d{4})_(S[12])$/);
  if(match)return {year:match[1]+"-"+match[2],semester:match[3]};
 }
 if(/^([0-9]{4})-([0-9]{4})$/.test(year)&&["S1","S2"].includes(semester))
  return {year,semester};
 return null;
}
function parseRows(data){
 let rows=data?.rows;
 if(!Array.isArray(rows)){
  try{rows=JSON.parse(typeof data?.json_data==="string"?data.json_data:"[]");}
  catch{return {ok:false,reason:"schedule_json_invalid"};}
 }
 return Array.isArray(rows)?{ok:true,rows}:{ok:false,reason:"schedule_rows_invalid"};
}
function academicNames(approval){
 const maps={sections:new Map(),subjects:new Map()};
 for(const [key,rows] of [["sections",approval.academic?.sections],["subjects",approval.academic?.subjects]])
  for(const row of rows||[])if(row.approved===true){
   const id=String(row.targetId||""),name=clean(row.targetName||row.legacyLabel,140);
   if(id&&name)maps[key].set(id,name);
  }
 return maps;
}
function allowedTeacherPairs(accessApproved,foundationApproval){
 const names=academicNames(foundationApproval),byUid=new Map();
 for(const row of accessApproved.assignments){
  const section=names.sections.get(row.sectionId),subject=names.subjects.get(row.subjectId);
  if(!section||!subject)throw Error("Approved teacher assignment references an academic label without an approved name.");
  const set=byUid.get(row.teacherUid)||new Set();
  set.add(section.toLocaleLowerCase("en")+"\0"+subject.toLocaleLowerCase("en"));
  byUid.set(row.teacherUid,set);
 }
 return byUid;
}
function referenceText(doc){
 const title=clean(doc?.title||doc?.name||doc?.fileName||doc?.filename,180)||"Untitled reference";
 const text=clean(doc?.text||doc?.content||doc?.extractedText||doc?.extracted_text,650000);
 if(!text)return {ok:false,reason:"reference_text_missing",title};
 if(Buffer.byteLength(text,"utf8")>650000)return {ok:false,reason:"reference_text_too_large",title};
 const hasRawPdf=typeof doc?.pdfBase64==="string"||typeof doc?.base64==="string"||
  Buffer.isBuffer(doc?.bytes)||doc?.rawPdf===true;
 if(hasRawPdf)return {ok:false,reason:"reference_raw_pdf_requires_review",title};
 const sourceType=String(doc?.sourceType||doc?.type||"").toLowerCase().includes("pdf")?
  "pdf_extracted_text":"text";
 return {ok:true,title,text,sourceType};
}
function documentDigest(value){
 return sha(JSON.stringify([value.title,value.text,value.sourceType]));
}
async function listCollection(db,path,max=5000){
 const out=[];let cursor=null;
 while(out.length<max){
  let query=db.collection(path).orderBy(FieldPath.documentId()).limit(Math.min(200,max-out.length));
  if(cursor)query=query.startAfter(cursor);
  const page=await query.get();
  for(const doc of page.docs)out.push({id:doc.id,path:doc.ref.path,data:doc.data()});
  if(page.size<200)return out;
  cursor=page.docs.at(-1);
 }
 throw Error("Migration collection exceeds planner cap: "+path);
}
async function teacherFolders(db,uid){
 const base="schools/"+SCHOOL_ID+"/legacy_roots/teacher_materials/documents/"+uid+"/reference_folders";
 const folders=await listCollection(db,base).catch(()=>[]);
 for(const folder of folders)
  folder.nestedDocuments=await listCollection(db,base+"/"+folder.id+"/documents").catch(()=>[]);
 return folders;
}
async function teacherSchedules(db,uid){
 const base="schools/"+SCHOOL_ID+"/legacy_roots/staff_workspaces/documents/"+uid+"/schedules";
 const schedules=await listCollection(db,base).catch(()=>[]);
 for(const row of schedules)
  row.revisions=await listCollection(db,base+"/"+row.id+"/revisions").catch(()=>[]);
 return schedules;
}
function convertReferenceFolder(folder,uid){
 const folderId=safeId(folder.id)?folder.id:stableId("mcsref",uid,folder.id),
  reviewItems=[];
 if(folderId!==folder.id)reviewItems.push({
  type:"reference_folder_id_remapped",uid,legacyFolderId:folder.id,folderId,
  resolution:"Update any migrated lesson reference_folders values that still point to the unsafe legacy ID."
 });
 const name=clean(folder.data?.name,140)||"Untitled folder";
 const candidates=[];
 const inline=Array.isArray(folder.data?.documents)?folder.data.documents:[];
 inline.forEach((doc,index)=>candidates.push({
  source:"inline",sourceId:String(index),sourcePath:folder.path+"#documents["+index+"]",data:doc
 }));
 for(const doc of folder.nestedDocuments||[])candidates.push({
  source:"nested",sourceId:doc.id,sourcePath:doc.path,data:doc.data
 });
 const documents=[],seen=new Map(),blockers=[];
 if(candidates.length>100)blockers.push({
  type:"reference_folder_document_count_exceeds_v4_list_contract",
  sourcePath:folder.path,count:candidates.length,maximum:100
 });
 for(const candidate of candidates){
  const converted=referenceText(candidate.data);
  if(!converted.ok){
   blockers.push({type:converted.reason,sourcePath:candidate.sourcePath,title:converted.title});continue;
  }
  const digest=documentDigest(converted),duplicate=seen.get(digest);
  if(duplicate){
   reviewItems.push({type:"reference_document_duplicate_content",uid,folderId,
    keptSourcePath:duplicate,duplicateSourcePath:candidate.sourcePath,
    resolution:"Keep one canonical text copy; legacy duplicate remains represented by migration provenance."});
   continue;
  }
  seen.set(digest,candidate.sourcePath);
  const documentId=candidate.source==="nested"&&safeId(candidate.sourceId)?
    candidate.sourceId:stableId("mcsdoc",uid,folder.id,candidate.source,candidate.sourceId,digest);
  documents.push({
   documentId,targetPath:"schools/"+SCHOOL_ID+"/teacher_reference_folders/"+folderId+
    "/documents/"+documentId,
   folderId,ownerUid:uid,title:converted.title,text:converted.text,
   sourceType:converted.sourceType,status:"active",revision:1,digest,
   migration:{sourcePath:candidate.sourcePath,source:candidate.source}
  });
 }
 return {folder:{
  folderId,targetPath:"schools/"+SCHOOL_ID+"/teacher_reference_folders/"+folderId,
  ownerUid:uid,name,status:"active",revision:1,documentCount:documents.length,
  documents,migration:{sourcePath:folder.path,legacyFolderId:folder.id}
 },blockers,reviewItems};
}
function scheduleVersion(data,id,allowedPairs){
 const scope=parseYearTerm(data,id);
 if(!scope)return {ok:false,reason:"schedule_scope_unresolved"};
 const parsed=parseRows(data);if(!parsed.ok)return parsed;
 let rows;
 try{rows=normalizeRows(parsed.rows,allowedPairs);}
 catch(error){return {ok:false,reason:"schedule_assignment_validation_failed",message:error.message};}
 return {ok:true,schoolYear:scope.year,semester:scope.semester,rows,
  rawText:rowsToText(rows)};
}
function convertSchedule(row,uid,allowedPairs){
 const currentVersion=Math.max(1,Number(row.data?.version)||1),
  current=scheduleVersion(row.data,row.id,allowedPairs);
 if(!current.ok)return current;
 const prior=[];
 for(const revision of row.revisions||[]){
  const version=Number(revision.data?.version)||Number(revision.id);
  if(!Number.isInteger(version)||version<1||version>=currentVersion)
   return {ok:false,reason:"schedule_revision_sequence_invalid"};
  const converted=scheduleVersion(revision.data,row.id,allowedPairs);
  if(!converted.ok)return converted;
  if(converted.schoolYear!==current.schoolYear||converted.semester!==current.semester)
   return {ok:false,reason:"schedule_revision_scope_changed"};
  prior.push({version,...converted,migration:{sourcePath:revision.path}});
 }
 prior.sort((a,b)=>a.version-b.version);
 if(prior.length!==currentVersion-1||prior.some((item,index)=>item.version!==index+1))
  return {ok:false,reason:"schedule_revision_history_incomplete",
   expectedPriorRevisions:currentVersion-1,foundRevisions:prior.map(item=>item.version)};
 if(prior.length>100)return {ok:false,reason:"schedule_revision_history_requires_paginated_migration"};
 const id=scheduleId(uid,current.schoolYear,current.semester);
 return {ok:true,schedule:{
  scheduleId:id,targetPath:"schools/"+SCHOOL_ID+"/teacher_schedules/"+id,
  ownerUid:uid,schoolYear:current.schoolYear,semester:current.semester,
  rows:current.rows,rawText:current.rawText,revision:currentVersion,revisions:prior,
  migration:{sourcePath:row.path,legacyScheduleId:row.id,
   legacyRawText:typeof row.data?.raw_text==="string"?row.data.raw_text:null}
 }};
}
function sharedLegacyObservations(ledger){
 if(!ledger||ledger.schema!=="adminerva-v4-mcs-dryrun-v1"||ledger.schoolId!==SCHOOL_ID)
  throw Error("Use the exact MCS dry-run ledger when planning shared legacy support sources.");
 const entries=Array.isArray(ledger.entries)?ledger.entries:[];
 const references=entries.filter(row=>String(row.sourcePath||"").startsWith("reference_folders/"));
 const schedules=entries.filter(row=>{
  const path=String(row.sourcePath||"");
  return path==="app_config/master_schedule"||
   /^app_config\/master_schedule_SY\d{8}_S[12]$/.test(path);
 });
 return {
  sharedReferenceDocuments:references.length,
  sharedScheduleDocuments:schedules.length,
  sourcePaths:[...references,...schedules].map(row=>row.sourcePath)
 };
}
async function buildPlanningSupportPlan(db,{foundationPlan,foundationPlanRaw,foundationApproval,
 academicAccessPlan,academicAccessPlanRaw,academicAccessApproval,ledger,ledgerSha256}){
 const foundationApproved=validateFoundationApproval(
   validateFoundationPlan(foundationPlan),foundationPlanRaw,foundationApproval);
 const accessApproved=validateAccessApproval(
   validateAccessPlan(academicAccessPlan),academicAccessPlanRaw,academicAccessApproval);
 const teachers=foundationApproved.memberships.filter(row=>row.roles.includes("teacher")),
  allowedPairs=allowedTeacherPairs(accessApproved,foundationApproval);
 const folders=[],schedules=[],blockers=[],reviewItems=[];
 for(const teacher of teachers){
  const [legacyFolders,legacySchedules]=await Promise.all([
   teacherFolders(db,teacher.uid),teacherSchedules(db,teacher.uid)
  ]);
  if(legacyFolders.length>100)blockers.push({
   type:"teacher_reference_folder_count_exceeds_v4_list_contract",
   uid:teacher.uid,count:legacyFolders.length,maximum:100
  });
  for(const folder of legacyFolders){
   const converted=convertReferenceFolder(folder,teacher.uid);
   folders.push(converted.folder);
   blockers.push(...converted.blockers);
   reviewItems.push(...converted.reviewItems);
  }
  for(const row of legacySchedules){
   const converted=convertSchedule(row,teacher.uid,allowedPairs.get(teacher.uid)||new Set());
   if(!converted.ok){
    blockers.push({type:converted.reason,uid:teacher.uid,sourcePath:row.path,
      message:converted.message||""});continue;
   }
   schedules.push(converted.schedule);
  }
 }
 const shared=sharedLegacyObservations(ledger);
 if(shared.sharedReferenceDocuments)reviewItems.push({
  type:"legacy_shared_reference_policy_required",
  count:shared.sharedReferenceDocuments,
  resolution:"Do not replicate the administrator-wide library into teacher-private folders. Define or approve a school-shared reference-library policy separately."
 });
 if(shared.sharedScheduleDocuments)reviewItems.push({
  type:"legacy_shared_schedule_policy_required",
  count:shared.sharedScheduleDocuments,
  resolution:"Do not copy the old shared timetable into every teacher. Map it to explicit teacher schedules or retain it as archived migration history."
 });
 return {
  schema:SCHEMA,schoolId:SCHOOL_ID,readOnly:true,generatedAt:new Date().toISOString(),
  source:{foundationPlanSha256:sha(foundationPlanRaw),
   academicAccessPlanSha256:sha(academicAccessPlanRaw),ledgerSha256},
  referenceFolders:folders,schedules,sharedLegacySources:shared,
  blockers,reviewItems,readyForApply:false,
  summary:{
   referenceFolders:folders.length,
   referenceDocuments:folders.reduce((sum,row)=>sum+row.documents.length,0),
   schedules:schedules.length,blockers:blockers.length,reviewItems:reviewItems.length,
   sharedLegacyReferenceDocuments:shared.sharedReferenceDocuments,
   sharedLegacyScheduleDocuments:shared.sharedScheduleDocuments
  },
  nextRequiredReview:[
   "Teacher-owned reference folders remain private to their verified owner.",
   "Raw PDFs are not migrated; only already-extracted bounded text is eligible.",
   "Preserved legacy folder IDs keep lesson reference links intact whenever the ID satisfies the V4 contract.",
   "Teacher schedules must validate against explicitly approved teacher-course assignments.",
   "Administrator-shared references/timetables need a separate school-shared policy and are not copied into every teacher account."
  ]
 };
}
function arg(args,name){
 const value=args.find(item=>item.startsWith("--"+name+"="))?.slice(name.length+3);
 if(!value||!value.startsWith("/")||value.includes("\0"))
  throw Error("Provide --"+name+" as a restricted absolute path.");
 return value;
}
function read(path){
 const raw=readFileSync(path),data=JSON.parse(raw.toString("utf8"));
 return {raw,data};
}
async function main(){
 const args=process.argv.slice(2),foundation=read(arg(args,"foundation-plan")),
  foundationApproval=read(arg(args,"foundation-approval")),
  access=read(arg(args,"academic-access-plan")),
  accessApproval=read(arg(args,"academic-access-approval")),
  ledger=read(arg(args,"ledger")),output=arg(args,"output");
 if(!getApps().length)initializeApp({credential:applicationDefault()});
 const plan=await buildPlanningSupportPlan(getFirestore(),{
  foundationPlan:foundation.data,foundationPlanRaw:foundation.raw,
  foundationApproval:foundationApproval.data,
  academicAccessPlan:access.data,academicAccessPlanRaw:access.raw,
  academicAccessApproval:accessApproval.data,
  ledger:ledger.data,ledgerSha256:sha(ledger.raw)
 });
 writeFileSync(output,JSON.stringify(plan,null,2)+"\n",{flag:"wx",mode:0o600});
 console.info(JSON.stringify({planningSupportPlanCreated:true,schoolId:SCHOOL_ID,
  summary:plan.summary,readyForApply:false}));
}
if(require.main===module)main().catch(error=>{
 console.error("MCS planning-support migration planning failed:",error.code||error.message);
 process.exitCode=1;
});
module.exports={SCHEMA,safeId,stableId,parseYearTerm,parseRows,academicNames,
 allowedTeacherPairs,referenceText,documentDigest,convertReferenceFolder,
 scheduleVersion,convertSchedule,sharedLegacyObservations,buildPlanningSupportPlan};
