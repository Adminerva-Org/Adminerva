"use strict";
/**
 * Read-only MCS lesson/presentation canonical migration planner.
 *
 * Prefers current teacher-owned staff_workspace records and their retained
 * revisions. Older global records are used only when not represented by a
 * recovered personal copy. Ownership is never inferred from teacher names.
 */
const {initializeApp,getApps,applicationDefault}=require("firebase-admin/app");
const {getFirestore,FieldPath}=require("firebase-admin/firestore");
const {readFileSync,writeFileSync}=require("node:fs");
const {createHash}=require("node:crypto");
const {readMirrorRoot,SCHOOL_ID}=require("./mcs-canonical-foundation-plan.js");
const {validatePlan,validateApproval}=require("./mcs-canonical-foundation-apply.js");
const {validateContent,deterministicId}=require("./school-planning.js");

const SCHEMA="adminerva-v4-mcs-canonical-planning-plan-v1";
const sha=value=>createHash("sha256").update(value).digest("hex");
function clean(value,max=20000){return typeof value==="string"?value.trim().slice(0,max):"";}
function ownerEmailHash(value){
 const email=clean(value,254).toLowerCase();
 return email?sha(email):null;
}
function teacherIdentityMap(identity){
 if(identity?.schema!=="adminerva-v4-mcs-identity-candidates-v1"||
    identity.schoolId!==SCHOOL_ID||identity.readOnly!==true||identity.grantsCreated!==false)
  throw Error("Use a current read-only MCS identity-candidate report.");
 const byEmailHash=new Map();
 for(const candidate of identity.candidates||[]){
  if(candidate.emailHash){
   if(byEmailHash.has(candidate.emailHash)&&byEmailHash.get(candidate.emailHash)!==candidate.uid)
    throw Error("One verified email hash maps to multiple identity candidates.");
   byEmailHash.set(candidate.emailHash,candidate.uid);
  }
 }
 return byEmailHash;
}
function approvedTeachers(foundationPlan,foundationPlanRaw,foundationApproval){
 const approved=validateApproval(validatePlan(foundationPlan),foundationPlanRaw,foundationApproval);
 const map=new Map();
 for(const member of approved.memberships){
  if(!member.roles.includes("teacher"))continue;
  const person=approved.people.find(row=>row.uid===member.uid);
  if(person)map.set(member.uid,{uid:member.uid,personId:person.personId,
    displayName:person.displayName,status:member.status});
 }
 return map;
}
function lessonClientKey(data){
 const fields=[data.school_year,data.grade_level,data.subject_title,data.academic_term,data.course_week]
  .map(value=>clean(value,180));
 return fields.every(Boolean)?JSON.stringify(fields):null;
}
function presentationClientKey(data){
 const planId=clean(data.plan_id,1200),session=Number(data.session_index);
 return planId&&Number.isInteger(session)&&session>=0?JSON.stringify([planId,String(session)]):null;
}
function safeDeck(deck){
 if(!Array.isArray(deck)||!deck.length||deck.length>300)
  return {ok:false,reason:"presentation_deck_invalid"};
 const danger=/<\s*(?:script|iframe|object|embed|link|meta)\b|javascript\s*:|\son[a-z]+\s*=/i;
 for(let index=0;index<deck.length;index++){
  const slide=deck[index];
  if(!slide||typeof slide!=="object"||Array.isArray(slide))
   return {ok:false,reason:"presentation_slide_invalid",index};
  for(const key of ["content","contentLeft","contentRight"]){
   const html=typeof slide[key]==="string"?slide[key]:"";
   if(html.length>120000||danger.test(html))
    return {ok:false,reason:"presentation_html_requires_review",index,key};
  }
 }
 return {ok:true,deck};
}
function lessonContent(data){
 if(!Array.isArray(data.sessions)||!data.sessions.length||data.sessions.length>30)
  return {ok:false,reason:"lesson_sessions_invalid"};
 const plan={
  teacher_name:clean(data.teacher_name,180),
  program_name:clean(data.program_name,180),
  subject_title:clean(data.subject_title,180),
  school_year:clean(data.school_year,80),
  academic_term:clean(data.academic_term||data.semester||data.quarter,80),
  course_week:clean(data.course_week||data.week,80),
  date_range:clean(data.date_range,180),
  grade_level:clean(data.grade_level,120),
  document_settings:data.document_settings&&typeof data.document_settings==="object"?data.document_settings:{},
  custom_instructions:clean(data.custom_instructions,120000),
  schedule:clean(data.schedule,120000),
  reference_folders:Array.isArray(data.reference_folders)?data.reference_folders.filter(value=>typeof value==="string").slice(0,100):[],
  weekly_overview:data.weekly_overview&&typeof data.weekly_overview==="object"?data.weekly_overview:{},
  sessions:data.sessions
 };
 try{return {ok:true,content:validateContent({schema:"adminerva-school-lesson-v1",plan})};}
 catch(error){return {ok:false,reason:"lesson_content_exceeds_v4_contract",message:error.message};}
}
function presentationContent(data,canonicalLessonResourceId=null,sessionLabel=null){
 const checked=safeDeck(data.deck);if(!checked.ok)return checked;
 const session=Number(data.session_index);
 const content={schema:"adminerva-school-presentation-v1",
  sourceLesson:{legacyPlanId:clean(data.plan_id,1200),
   sourceLessonVersion:Number.isInteger(Number(data.source_lesson_version))?Number(data.source_lesson_version):null,
   sessionIndex:Number.isInteger(session)?session:null,
   ...(canonicalLessonResourceId?{canonicalLessonResourceId}:{})},
  subject:clean(data.subject,180),grade:clean(data.grade,120),
  sessionLabel:clean(sessionLabel,180)||("Session "+(Number.isInteger(session)?session+1:"")),
  deck:checked.deck};
 try{return {ok:true,content:validateContent(content)};}
 catch(error){return {ok:false,reason:"presentation_content_exceeds_v4_contract",message:error.message};}
}
function explicitOwner(data,teachers,emailHashes){
 const uids=[data?.ownerUid,data?.owner_uid].filter(value=>typeof value==="string"&&value);
 const unique=[...new Set(uids)];
 if(unique.length>1)return {ok:false,reason:"planning_owner_uid_conflict",uids:unique};
 if(unique.length===1)return teachers.has(unique[0])?
  {ok:true,uid:unique[0],source:"saved_owner_uid"}:
  {ok:false,reason:"planning_owner_uid_unapproved",uid:unique[0]};
 const emails=[data?.ownerEmail,data?.owner_email,data?.teacherEmail,data?.teacher_email]
  .filter(value=>typeof value==="string"&&value.trim()).map(ownerEmailHash);
 const mapped=[...new Set(emails.map(hash=>emailHashes.get(hash)).filter(Boolean))];
 if(mapped.length>1)return {ok:false,reason:"planning_owner_email_conflict",uids:mapped};
 if(mapped.length===1)return teachers.has(mapped[0])?
  {ok:true,uid:mapped[0],source:"verified_owner_email"}:
  {ok:false,reason:"planning_owner_email_unapproved",uid:mapped[0]};
 return {ok:false,reason:"planning_owner_unresolved"};
}
async function mirrorCollection(db,path,max=2500){
 const collection=db.collection(path),rows=[];let cursor=null;
 while(rows.length<max){
  let q=collection.orderBy(FieldPath.documentId()).limit(Math.min(200,max-rows.length));
  if(cursor)q=q.startAfter(cursor);
  const snap=await q.get();
  for(const doc of snap.docs)rows.push({id:doc.id,path:doc.ref.path,data:doc.data()});
  if(snap.size<200)return rows;
  cursor=snap.docs.at(-1);
 }
 throw Error("Planning mirror collection exceeded the migration planner cap: "+path);
}
async function workspaceRows(db,uid,kind){
 const base="schools/"+SCHOOL_ID+"/legacy_roots/staff_workspaces/documents/"+uid+"/"+kind;
 const heads=await mirrorCollection(db,base);
 for(const row of heads){
  row.revisions=await mirrorCollection(db,base+"/"+row.id+"/revisions").catch(()=>[]);
 }
 return heads;
}
async function globalRows(db,root){
 const heads=await readMirrorRoot(db,root);
 for(const row of heads){
  row.revisions=await mirrorCollection(db,row.path+"/revisions").catch(()=>[]);
 }
 return heads;
}
function revisionList(row,converter){
 const headVersion=Math.max(1,Number(row.data.version)||1),all=[];
 for(const revision of row.revisions||[]){
  const version=Number(revision.data.version)||Number(revision.id);
  if(!Number.isInteger(version)||version<1||version>=headVersion)
   return {ok:false,reason:"planning_revision_sequence_invalid",sourcePath:revision.path};
  const converted=converter(revision.data);
  if(!converted.ok)return converted;
  all.push({version,title:null,content:converted.content,
   archivedRevisionAt:revision.data.archivedRevisionAt?.toMillis?.()||null,
   migration:{sourcePath:revision.path}});
 }
 all.sort((a,b)=>a.version-b.version);
 for(let i=1;i<all.length;i++)if(all[i].version===all[i-1].version)
  return {ok:false,reason:"planning_duplicate_revision_number"};
 const current=converter(row.data);if(!current.ok)return current;
 return {ok:true,currentVersion:headVersion,current:current.content,revisions:all};
}
function titleForLesson(data){
 return [clean(data.grade_level,120)||"Grade",clean(data.subject_title,180)||"Subject",
  clean(data.course_week||data.week,80)||"Lesson"].join(" · ");
}
function titleForPresentation(data,sessionLabel){
 return [clean(data.grade,120)||"Grade",clean(data.subject,180)||"Subject",
  sessionLabel||("Session "+(Number(data.session_index)+1))].join(" · ");
}
async function buildPlanningPlan(db,{foundationPlan,foundationPlanRaw,foundationApproval,identity,identitySha256}){
 const teachers=approvedTeachers(foundationPlan,foundationPlanRaw,foundationApproval),
  emailHashes=teacherIdentityMap(identity);
 const [globalLessons,globalPresentations]=await Promise.all([
  globalRows(db,"lesson_plans"),globalRows(db,"presentations")
 ]);
 const personalLessons=[],personalPresentations=[];
 for(const uid of teachers.keys()){
  const [lessons,presentations]=await Promise.all([
   workspaceRows(db,uid,"lesson_plans"),workspaceRows(db,uid,"presentations")
  ]);
  lessons.forEach(row=>personalLessons.push({...row,workspaceUid:uid}));
  presentations.forEach(row=>personalPresentations.push({...row,workspaceUid:uid}));
 }

 const resources=[],blockers=[],reviewItems=[],lessonByLegacyKey=new Map(),targetIds=new Map();
 const representedGlobalLessons=new Set(personalLessons.map(row=>clean(row.data.source_legacy_plan,128)).filter(Boolean));
 function addResource(resource){
  const prior=targetIds.get(resource.resourceId);
  if(prior){
   blockers.push({type:"planning_target_collision",resourceId:resource.resourceId,
    sourcePaths:[prior.sourcePath,resource.migration.sourcePath]});return false;
  }
  targetIds.set(resource.resourceId,{sourcePath:resource.migration.sourcePath});resources.push(resource);return true;
 }
 function lessonCandidate(row,uid,ownershipSource,sourceKind){
  const key=lessonClientKey(row.data);
  if(!key){blockers.push({type:"lesson_identity_fields_missing",sourcePath:row.path});return null;}
  const converted=revisionList(row,lessonContent);
  if(!converted.ok){blockers.push({type:converted.reason,sourcePath:row.path,message:converted.message||""});return null;}
  const resourceId=deterministicId({schoolId:SCHOOL_ID,uid},"lesson",key);
  const status=row.data.is_archived===true?"archived":"active";
  const candidate={resourceId,targetPath:"schools/"+SCHOOL_ID+"/teaching_resources/"+resourceId,
   kind:"lesson",ownerUid:uid,creatorUid:uid,clientKey:key,title:titleForLesson(row.data),
   content:converted.current,status,visibility:"private",sharedWithUids:[],
   revision:converted.currentVersion,revisions:converted.revisions,
   migration:{sourcePath:row.path,sourceKind,legacyId:row.id,ownershipSource,
    sourceLegacyPlan:clean(row.data.source_legacy_plan,128)||null}};
  if(addResource(candidate)){
   lessonByLegacyKey.set(uid+"|"+row.id,candidate);
   if(candidate.migration.sourceLegacyPlan)lessonByLegacyKey.set(uid+"|"+candidate.migration.sourceLegacyPlan,candidate);
   return candidate;
  }
  return null;
 }
 for(const row of personalLessons){
  if(!teachers.has(row.workspaceUid)){
   blockers.push({type:"lesson_workspace_owner_unapproved",sourcePath:row.path,uid:row.workspaceUid});continue;
  }
  lessonCandidate(row,row.workspaceUid,"verified_workspace_uid","staff_workspace");
 }
 for(const row of globalLessons){
  if(representedGlobalLessons.has(row.id))continue;
  const owner=explicitOwner(row.data,teachers,emailHashes);
  if(!owner.ok){blockers.push({type:owner.reason,sourcePath:row.path,legacyId:row.id});continue;}
  lessonCandidate(row,owner.uid,owner.source,"global_legacy");
 }

 const representedGlobalPresentations=new Set(personalPresentations.map(row=>row.id));
 function presentationCandidate(row,uid,ownershipSource,sourceKind){
  const key=presentationClientKey(row.data);
  if(!key){blockers.push({type:"presentation_identity_fields_missing",sourcePath:row.path});return;}
  const sourceLesson=lessonByLegacyKey.get(uid+"|"+clean(row.data.plan_id,128))||null;
  const session=Number(row.data.session_index);
  const sessionLabel=sourceLesson?.content?.plan?.sessions?.[session]?.session_name||null;
  const converter=data=>presentationContent(data,sourceLesson?.resourceId||null,sessionLabel);
  const converted=revisionList(row,converter);
  if(!converted.ok){blockers.push({type:converted.reason,sourcePath:row.path,message:converted.message||""});return;}
  const resourceId=deterministicId({schoolId:SCHOOL_ID,uid},"presentation",key);
  const candidate={resourceId,targetPath:"schools/"+SCHOOL_ID+"/teaching_resources/"+resourceId,
   kind:"presentation",ownerUid:uid,creatorUid:uid,clientKey:key,
   title:titleForPresentation(row.data,sessionLabel),content:converted.current,
   status:row.data.is_archived===true?"archived":"active",visibility:"private",sharedWithUids:[],
   revision:converted.currentVersion,revisions:converted.revisions,
   source:sourceLesson?{schoolId:SCHOOL_ID,resourceId:sourceLesson.resourceId,revision:sourceLesson.revision}:null,
   migration:{sourcePath:row.path,sourceKind,legacyId:row.id,ownershipSource,
    legacyPlanId:clean(row.data.plan_id,1200),sourceLessonResolved:Boolean(sourceLesson)}};
  if(!sourceLesson)reviewItems.push({type:"presentation_source_lesson_unresolved",
    sourcePath:row.path,resourceId,legacyPlanId:candidate.migration.legacyPlanId,
    resolution:"Presentation can remain private/independent; review whether its source lesson should be linked later."});
  addResource(candidate);
 }
 for(const row of personalPresentations){
  if(!teachers.has(row.workspaceUid)){
   blockers.push({type:"presentation_workspace_owner_unapproved",sourcePath:row.path,uid:row.workspaceUid});continue;
  }
  presentationCandidate(row,row.workspaceUid,"verified_workspace_uid","staff_workspace");
 }
 for(const row of globalPresentations){
  if(representedGlobalPresentations.has(row.id))continue;
  let owner=explicitOwner(row.data,teachers,emailHashes);
  if(!owner.ok){
   const possible=[...teachers.keys()].filter(uid=>lessonByLegacyKey.has(uid+"|"+clean(row.data.plan_id,128)));
   if(possible.length===1)owner={ok:true,uid:possible[0],source:"exact_source_lesson_owner"};
  }
  if(!owner.ok){blockers.push({type:owner.reason,sourcePath:row.path,legacyId:row.id});continue;}
  presentationCandidate(row,owner.uid,owner.source,"global_legacy");
 }

 return {schema:SCHEMA,schoolId:SCHOOL_ID,readOnly:true,generatedAt:new Date().toISOString(),
  source:{foundationPlanSha256:sha(foundationPlanRaw),identitySha256},
  resources,blockers,reviewItems,readyForApply:false,
  summary:{personalLessons:personalLessons.length,globalLessons:globalLessons.length,
   personalPresentations:personalPresentations.length,globalPresentations:globalPresentations.length,
   lessonCandidates:resources.filter(row=>row.kind==="lesson").length,
   presentationCandidates:resources.filter(row=>row.kind==="presentation").length,
   blockers:blockers.length,reviewItems:reviewItems.length},
  nextRequiredReview:[
   "Every migrated planning resource remains private to its approved teacher owner by default.",
   "Do not infer ownership from teacher_name, subject, section or file title.",
   "Review unresolved presentation→lesson provenance without making the presentation school-wide.",
   "Archived legacy planning resources stay archived; migration does not restore them.",
   "Retained legacy revisions are imported as owner-only planning history before the current revision."
  ]};
}
function arg(args,name){
 const value=args.find(item=>item.startsWith("--"+name+"="))?.slice(name.length+3);
 if(!value||!value.startsWith("/")||value.includes("\0"))throw Error("Provide --"+name+" as a restricted absolute path.");
 return value;
}
function read(path){const raw=readFileSync(path),data=JSON.parse(raw.toString("utf8"));return {raw,data};}
async function main(){
 const args=process.argv.slice(2),foundation=read(arg(args,"foundation-plan")),
  approval=read(arg(args,"foundation-approval")),identity=read(arg(args,"identity")),
  output=arg(args,"output");
 if(!getApps().length)initializeApp({credential:applicationDefault()});
 const plan=await buildPlanningPlan(getFirestore(),{
  foundationPlan:foundation.data,foundationPlanRaw:foundation.raw,foundationApproval:approval.data,
  identity:identity.data,identitySha256:sha(identity.raw)
 });
 writeFileSync(output,JSON.stringify(plan,null,2)+"\n",{flag:"wx",mode:0o600});
 console.info(JSON.stringify({planningPlanCreated:true,schoolId:SCHOOL_ID,summary:plan.summary,readyForApply:false}));
}
if(require.main===module)main().catch(error=>{
 console.error("MCS canonical planning migration failed:",error.code||error.message);process.exitCode=1;
});
module.exports={SCHEMA,ownerEmailHash,teacherIdentityMap,approvedTeachers,lessonClientKey,
 presentationClientKey,safeDeck,lessonContent,presentationContent,explicitOwner,mirrorCollection,
 workspaceRows,globalRows,revisionList,buildPlanningPlan};
