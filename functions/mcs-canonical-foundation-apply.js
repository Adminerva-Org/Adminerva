"use strict";
/**
 * Controlled MCS canonical-foundation apply engine.
 *
 * Scope: reviewed people, student/teacher memberships, academic catalog and
 * explicit course offerings only. It does not migrate assessments, evidence,
 * grades, lessons or Studio content. Preflight is the default.
 */
const {initializeApp,getApps,applicationDefault}=require("firebase-admin/app");
const {getFirestore,FieldValue}=require("firebase-admin/firestore");
const {readFileSync,writeFileSync}=require("node:fs");
const {createHash}=require("node:crypto");
const {SCHEMA:PLAN_SCHEMA,SCHOOL_ID}=require("./mcs-canonical-foundation-plan.js");
const {APPROVAL_SCHEMA}=require("./mcs-canonical-foundation-approval-template.js");

const WRITE_ACK="YES_I_APPROVE_MCS_CANONICAL_FOUNDATION";
const RECEIPT_SCHEMA="adminerva-v4-mcs-canonical-foundation-receipt-v1";
const PERIOD_TYPES=new Set(["term","semester","quarter","trimester","custom"]);
function sha256(value){return createHash("sha256").update(value).digest("hex");}
function id(value,label,max=128){
 const text=String(value||"");
 if(text.length<1||text.length>max||!/^[A-Za-z0-9_-]+$/.test(text))
  throw Error(label+" has an invalid ID.");
 return text;
}
function load(path,label){
 let raw;try{raw=readFileSync(path);}catch{throw Error(label+" file could not be read.");}
 let data;try{data=JSON.parse(raw.toString("utf8"));}catch{throw Error(label+" is not valid JSON.");}
 return {raw,data};
}
function requiredArg(args,name){
 const value=args.find(item=>item.startsWith("--"+name+"="))?.slice(name.length+3);
 if(!value||!value.startsWith("/")||value.includes("\0"))
  throw Error("Provide a restricted absolute --"+name+"=/secure/path.");
 return value;
}
function intArg(args,name,fallback,min=1,max=100){
 const raw=args.find(item=>item.startsWith("--"+name+"="))?.slice(name.length+3);
 if(raw===undefined)return fallback;
 const value=Number(raw);if(!Number.isInteger(value)||value<min||value>max)
  throw Error("--"+name+" must be "+min+"-"+max+".");
 return value;
}
function validatePlan(plan){
 if(!plan||plan.schema!==PLAN_SCHEMA||plan.schoolId!==SCHOOL_ID||
    plan.readOnly!==true||plan.readyForCanonicalApply!==false)
  throw Error("Use a current MCS canonical foundation plan.");
 if(!Array.isArray(plan.people)||!Array.isArray(plan.memberships))
  throw Error("Canonical plan is incomplete.");
 return plan;
}
function approvedCatalog(approval){
 const out={programs:new Map(),years:new Map(),sections:new Map(),subjects:new Map(),terms:new Map()};
 for(const [key,kind] of [["programs","program"],["years","year"],["sections","section"],
  ["subjects","subject"],["terms","term"]]){
  for(const row of approval.academic?.[key]||[]){
   if(row.approved!==true)continue;
   const targetId=id(row.targetId,kind+" target",80),name=String(row.targetName||"").trim();
   if(!name||name.length>140)throw Error("Approved "+kind+" mapping needs a target name.");
   let value={targetId,name,legacyLabel:String(row.legacyLabel||"").trim()};
    if(key==="years"){
     const startMonth=Number(row.startMonth??7),endMonth=Number(row.endMonth??5);
     if(!Number.isInteger(startMonth)||startMonth<1||startMonth>12||
        !Number.isInteger(endMonth)||endMonth<1||endMonth>12)
      throw Error("Approved academic-year start/end months must be between 1 and 12.");
     value={...value,startMonth,endMonth};
    }
   if(key==="sections")value={...value,programId:id(row.programId,"Section academic program",80)};
   if(key==="terms"){
    const periodType=String(row.periodType||"").trim().toLowerCase(),sequence=Number(row.sequence);
    if(!PERIOD_TYPES.has(periodType))throw Error("Approved academic period type is invalid.");
    if(!Number.isInteger(sequence)||sequence<1||sequence>12)
     throw Error("Approved academic period sequence must be between 1 and 12.");
    value={...value,yearId:id(row.yearId,"Academic period year",80),
      programId:id(row.programId,"Academic period program",80),periodType,sequence};
   }
   const prior=out[key].get(targetId);
   if(prior&&JSON.stringify(prior)!==JSON.stringify(value))
    throw Error("Multiple approved academic labels map inconsistently to "+targetId+".");
   out[key].set(targetId,value);
  }
 }
 for(const section of out.sections.values())
  if(!out.programs.has(section.programId))
   throw Error("Approved section references an unapproved academic program.");
 for(const term of out.terms.values()){
  if(!out.years.has(term.yearId))throw Error("Approved academic period references an unapproved academic year.");
  if(!out.programs.has(term.programId))throw Error("Approved academic period references an unapproved academic program.");
 }
 return out;
}
function validateApproval(plan,planRaw,approval){
 if(!approval||approval.schema!==APPROVAL_SCHEMA||approval.schoolId!==SCHOOL_ID||
    approval.scope!=="canonical_foundation_only")
  throw Error("Approval file does not authorize the MCS canonical foundation.");
 const planSha256=sha256(planRaw);
 if(approval.planSha256!==planSha256)throw Error("Approval belongs to a different canonical plan.");
 if(typeof approval.approvedBy!=="string"||approval.approvedBy.trim().length<3||
    typeof approval.approvedAt!=="string"||!Number.isFinite(Date.parse(approval.approvedAt)))
  throw Error("Approval must identify the reviewer and timestamp.");
 for(const key of ["identityLinksReviewed","rolesReviewed","archivedStatusReviewed",
   "academicLabelsReviewed","courseOfferingsDefined","noAutomaticLegacyAdminGrant",
   "noEmailDomainAuthorization","backupsAndRollbackReviewed"])
  if(approval.acknowledgements?.[key]!==true)throw Error("Missing approval acknowledgement: "+key);
 if(Array.isArray(approval.unresolvedBlockers)&&approval.unresolvedBlockers.length)
  throw Error("Resolve canonical foundation blockers before apply.");
 if(Array.isArray(approval.reviewItems)&&approval.reviewItems.some(item=>item.resolved!==true))
  throw Error("Resolve every canonical foundation review item before apply.");
 const planPeople=new Map(plan.people.map(row=>[row.personId,row]));
 const planMembers=new Map(plan.memberships.map(row=>[row.uid,row]));
 const people=[];
 for(const row of approval.people||[]){
  if(row.approveIdentityLink!==true)continue;
  const proposed=planPeople.get(row.personId);
  if(!proposed||proposed.uid!==row.uid)throw Error("Approved person is not in the bound plan.");
  const displayName=String(row.approvedDisplayName||"").trim();
  if(displayName.length<1||displayName.length>140)throw Error("Approved person display name is invalid.");
  if(!["active","archived"].includes(row.approvedStatus))throw Error("Approved person status is invalid.");
  people.push({...proposed,displayName,status:row.approvedStatus});
 }
 const approvedPeople=new Map(people.map(row=>[row.uid,row]));
 const memberships=[];
 for(const row of approval.memberships||[]){
  if(row.approveMembership!==true)continue;
  const proposed=planMembers.get(row.uid),person=approvedPeople.get(row.uid);
  if(!proposed||!person||proposed.personId!==row.personId)
   throw Error("Membership requires an approved person from the same plan.");
  const roles=[...new Set(Array.isArray(row.approvedRoles)?row.approvedRoles:[])].sort();
  if(!roles.length||roles.some(role=>!["student","teacher"].includes(role)))
   throw Error("Canonical migration may approve student/teacher roles only.");
  if(roles.some(role=>!proposed.roles.includes(role)))
   throw Error("Approved membership role was not proposed by the identity report.");
  if(!["active","suspended"].includes(row.approvedStatus))
   throw Error("Approved membership status is invalid.");
  if(person.status!=="active"&&row.approvedStatus==="active")
   throw Error("An archived person cannot receive active school access.");
  memberships.push({...proposed,roles,status:row.approvedStatus,displayName:person.displayName});
 }
 // An approved auth link without a reviewed membership is deliberately refused:
 // the account/person binding is part of access reconciliation.
 if(people.some(person=>!memberships.some(member=>member.uid===person.uid)))
  throw Error("Every approved identity link needs an explicitly approved membership.");
 const catalog=approvedCatalog(approval);
 const offerings=[];
 for(const row of approval.courseOfferings||[]){
  if(row.approved!==true)continue;
  const offeringId=id(row.offeringId,"Course offering",330),
   programId=id(row.programId,"Academic program",80),
   yearId=id(row.yearId,"Academic year",80),termId=id(row.termId,"Academic period",80),
   subjectId=id(row.subjectId,"Subject",80),sectionId=id(row.sectionId,"Section",80);
  if(!catalog.programs.has(programId)||!catalog.years.has(yearId)||!catalog.terms.has(termId)||
     !catalog.subjects.has(subjectId)||!catalog.sections.has(sectionId))
   throw Error("Approved course offering references an unapproved academic mapping.");
  const period=catalog.terms.get(termId),section=catalog.sections.get(sectionId);
  if(period.yearId!==yearId||period.programId!==programId)
   throw Error("Course offering academic period belongs to another year or program.");
  if(section.programId!==programId)
   throw Error("Course offering section belongs to another academic program.");
  offerings.push({offeringId,programId,yearId,termId,subjectId,sectionId});
 }
 const duplicateOffering=new Set();
 for(const row of offerings){
  if(duplicateOffering.has(row.offeringId))throw Error("Duplicate approved course offering ID.");
  duplicateOffering.add(row.offeringId);
 }
 return {planSha256,people,memberships,catalog,offerings};
}
function sameMigration(data,planSha256,type,key){
 return data?.schoolId===SCHOOL_ID&&data?.migration?.planSha256===planSha256&&
  data?.migration?.type===type&&data?.migration?.key===key;
}
function adoptableFirstAdminGrant(data,school,uid){
 return school?.exists&&school.data().firstAdminUid===uid&&data?.schoolId===SCHOOL_ID&&
  data?.status==="active"&&Array.isArray(data.roles)&&data.roles.includes("school_admin")&&!data?.migration;
}
async function inspectTargets(db,approved){
 const rows=[];
 const school=await db.doc("platform_schools/"+SCHOOL_ID).get();
 if(!school.exists||!["draft","pilot","active"].includes(school.data().state))
  rows.push({state:"school_missing_or_unavailable",targetPath:"platform_schools/"+SCHOOL_ID});
 const personStates=new Map();
 for(const person of approved.people){
  const ref=db.doc(person.targetPath),doc=await ref.get();
  const state=!doc.exists?"ready":sameMigration(doc.data(),approved.planSha256,"person",person.personId)?"already_applied":"target_conflict";
  rows.push({kind:"person",key:person.personId,targetPath:ref.path,state});
  personStates.set(person.uid,state);
 }
 for(const member of approved.memberships){
  const memberRef=db.doc(member.targetPath),indexRef=db.doc("platform_users/"+member.uid+"/memberships/"+SCHOOL_ID);
  const [doc,index]=await Promise.all([memberRef.get(),indexRef.get()]);
  const personState=personStates.get(member.uid)||"target_conflict";
  const membershipState=!doc.exists?"ready":sameMigration(doc.data(),approved.planSha256,"membership",member.uid)?"already_applied":
    adoptableFirstAdminGrant(doc.data(),school,member.uid)?"adopt_first_admin_grant":"target_conflict";
  const indexState=!index.exists?"ready":sameMigration(index.data(),approved.planSha256,"membership_index",member.uid)?"already_applied":
    adoptableFirstAdminGrant(index.data(),school,member.uid)?"adopt_first_admin_grant":"target_conflict";
  rows.push({kind:"membership",key:member.uid,targetPath:memberRef.path,state:membershipState});
  rows.push({kind:"membership_index",key:member.uid,targetPath:indexRef.path,state:indexState});
  const unitStates=[personState,membershipState,indexState],
   compatible=new Set(["ready","already_applied","adopt_first_admin_grant"]);
  if(unitStates.every(state=>compatible.has(state))&&unitStates.includes("already_applied")&&
     unitStates.some(state=>state!=="already_applied"))
   rows.push({kind:"identity_unit",key:member.uid,targetPath:memberRef.path,state:"identity_partial_state"});
 }
 for(const [collection,kind,key] of [["academic_programs","program","programs"],["academic_years","year","years"],
  ["sections","section","sections"],["subjects","subject","subjects"],["terms","term","terms"]]){
  for(const row of approved.catalog[key].values()){
   const ref=db.doc("schools/"+SCHOOL_ID+"/"+collection+"/"+row.targetId),doc=await ref.get();
   rows.push({kind,key:row.targetId,targetPath:ref.path,
    state:!doc.exists?"ready":sameMigration(doc.data(),approved.planSha256,"catalog_"+kind,row.targetId)?"already_applied":"target_conflict"});
  }
 }
 for(const offering of approved.offerings){
  const ref=db.doc("schools/"+SCHOOL_ID+"/course_offerings/"+offering.offeringId),doc=await ref.get();
  rows.push({kind:"offering",key:offering.offeringId,targetPath:ref.path,
    state:!doc.exists?"ready":sameMigration(doc.data(),approved.planSha256,"offering",offering.offeringId)?"already_applied":"target_conflict"});
 }
 return rows;
}
function migrationMeta(planSha256,type,key){
 return {source:"mcs_legacy_v3",planSha256,type,key};
}
async function createPersonAndMembership(db,approved,member){
 const person=approved.people.find(row=>row.uid===member.uid);
 return db.runTransaction(async tx=>{
  const personRef=db.doc(person.targetPath),memberRef=db.doc(member.targetPath),
   indexRef=db.doc("platform_users/"+member.uid+"/memberships/"+SCHOOL_ID),
   schoolRef=db.doc("platform_schools/"+SCHOOL_ID);
  const [p,m,i,school]=await Promise.all([tx.get(personRef),tx.get(memberRef),tx.get(indexRef),tx.get(schoolRef)]);
  const states=[
   !p.exists?"ready":sameMigration(p.data(),approved.planSha256,"person",person.personId)?"same":"conflict",
   !m.exists?"ready":sameMigration(m.data(),approved.planSha256,"membership",member.uid)?"same":
    adoptableFirstAdminGrant(m.data(),school,member.uid)?"adopt":"conflict",
   !i.exists?"ready":sameMigration(i.data(),approved.planSha256,"membership_index",member.uid)?"same":
    adoptableFirstAdminGrant(i.data(),school,member.uid)?"adopt":"conflict"
  ];
  if(states.includes("conflict"))throw Error("Canonical identity target changed after preflight.");
  if(states.every(state=>state==="same"))return "already_applied";
  if(states.includes("same")&&states.some(state=>state!=="same"))
   throw Error("Canonical identity unit is only partially applied; reconcile before retrying.");
  const now=FieldValue.serverTimestamp(),
   preservedRoles=[...new Set([...(Array.isArray(m.data()?.roles)?m.data().roles:[]),...member.roles])].sort(),
   revision=Math.max(Number(m.data()?.revision)||0,Number(i.data()?.revision)||0)+1;
  tx.create(personRef,{schoolId:SCHOOL_ID,displayName:person.displayName,
   searchKey:person.displayName.toLocaleLowerCase("en")+"#"+person.personId,
   kind:person.kind,status:person.status,authUid:member.uid,revision:1,
   migration:migrationMeta(approved.planSha256,"person",person.personId),
   createdByUid:"migration",createdAt:now,updatedAt:now});
  tx.set(memberRef,{schoolId:SCHOOL_ID,personId:person.personId,displayName:person.displayName,
   status:member.status,roles:preservedRoles,revision,
   migration:migrationMeta(approved.planSha256,"membership",member.uid),
   updatedByUid:"migration",updatedAt:now},{merge:false});
  tx.set(indexRef,{schoolId:SCHOOL_ID,status:member.status,roles:preservedRoles,revision,
   migration:migrationMeta(approved.planSha256,"membership_index",member.uid),updatedAt:now},{merge:false});
  tx.create(db.collection("schools/"+SCHOOL_ID+"/directory_audit").doc(),{
   schoolId:SCHOOL_ID,actorUid:"migration",personId:person.personId,targetUid:member.uid,
   action:"mcs_canonical_identity_migrated",roles:preservedRoles,
   planSha256:approved.planSha256,createdAt:now});
  return "created";
 });
}
async function createCatalog(db,approved,collection,kind,row){
 const ref=db.doc("schools/"+SCHOOL_ID+"/"+collection+"/"+row.targetId);
 return db.runTransaction(async tx=>{
  const current=await tx.get(ref);
  if(current.exists){
   if(sameMigration(current.data(),approved.planSha256,"catalog_"+kind,row.targetId))return "already_applied";
   throw Error("Canonical catalog target changed after preflight.");
  }
  const now=FieldValue.serverTimestamp();
  tx.create(ref,{schoolId:SCHOOL_ID,name:row.name,status:"active",revision:1,
    ...(kind==="year"?{startMonth:row.startMonth,endMonth:row.endMonth}:{}),
   ...(kind==="section"?{programId:row.programId}:{}),
   ...(kind==="term"?{yearId:row.yearId,programId:row.programId,
     periodType:row.periodType,sequence:row.sequence}:{}),
   migration:migrationMeta(approved.planSha256,"catalog_"+kind,row.targetId),
   createdByUid:"migration",createdAt:now,updatedAt:now});
  tx.create(db.collection("schools/"+SCHOOL_ID+"/directory_audit").doc(),{
   schoolId:SCHOOL_ID,actorUid:"migration",action:"mcs_canonical_catalog_migrated",
   kind,recordId:row.targetId,planSha256:approved.planSha256,createdAt:now});
  return "created";
 });
}
async function createOffering(db,approved,row){
 const ref=db.doc("schools/"+SCHOOL_ID+"/course_offerings/"+row.offeringId);
 return db.runTransaction(async tx=>{
  const current=await tx.get(ref);
  if(current.exists){
   if(sameMigration(current.data(),approved.planSha256,"offering",row.offeringId))return "already_applied";
   throw Error("Canonical offering target changed after preflight.");
  }
  const refs=[
   db.doc("schools/"+SCHOOL_ID+"/academic_programs/"+row.programId),
   db.doc("schools/"+SCHOOL_ID+"/academic_years/"+row.yearId),
   db.doc("schools/"+SCHOOL_ID+"/terms/"+row.termId),
   db.doc("schools/"+SCHOOL_ID+"/subjects/"+row.subjectId),
   db.doc("schools/"+SCHOOL_ID+"/sections/"+row.sectionId)
  ],catalog=await Promise.all(refs.map(item=>tx.get(item)));
  if(catalog.some(doc=>!doc.exists||doc.data().schoolId!==SCHOOL_ID||doc.data().status!=="active"))
   throw Error("Course offering catalog prerequisites are missing.");
  if(catalog[2].data().yearId!==row.yearId||catalog[2].data().programId!==row.programId)
   throw Error("Course offering academic period/year/program mismatch.");
  if(catalog[4].data().programId!==row.programId)
   throw Error("Course offering section/program mismatch.");
  const now=FieldValue.serverTimestamp();
  tx.create(ref,{schoolId:SCHOOL_ID,...row,status:"active",revision:1,
   migration:migrationMeta(approved.planSha256,"offering",row.offeringId),
   createdByUid:"migration",createdAt:now});
  tx.create(db.collection("schools/"+SCHOOL_ID+"/directory_audit").doc(),{
   schoolId:SCHOOL_ID,actorUid:"migration",action:"mcs_canonical_offering_migrated",
   offeringId:row.offeringId,planSha256:approved.planSha256,createdAt:now});
  return "created";
 });
}
function workUnits(approved){
 const units=approved.memberships.map(member=>({kind:"identity",key:member.uid,member}));
 for(const [collection,kind,key] of [["academic_programs","program","programs"],
  ["academic_years","year","years"],["sections","section","sections"],
  ["subjects","subject","subjects"],["terms","term","terms"]])
  for(const row of approved.catalog[key].values())units.push({kind:"catalog",key:row.targetId,collection,catalogKind:kind,row});
 for(const row of approved.offerings)units.push({kind:"offering",key:row.offeringId,row});
 return units;
}
async function applyFoundation(db,approved,{apply=false,maxUnits=50}={}){
 const inspected=await inspectTargets(db,approved);
 const blockers=inspected.filter(row=>["target_conflict","school_missing_or_unavailable","identity_partial_state"].includes(row.state));
 const receipt={schema:RECEIPT_SCHEMA,schoolId:SCHOOL_ID,scope:"canonical_foundation_only",
  planSha256:approved.planSha256,mode:apply?"apply":"preflight",generatedAt:new Date().toISOString(),
  approvedPeople:approved.people.length,approvedMemberships:approved.memberships.length,
  approvedOfferings:approved.offerings.length,blocked:blockers.length>0,
  blockers,created:0,alreadyApplied:0,processedUnits:0,remainingUnits:workUnits(approved).length,
  complete:false,assessmentsMigrated:false,gradesMigrated:false,lessonsMigrated:false};
 if(blockers.length||!apply)return receipt;
 const units=workUnits(approved);let newlyCreated=0;
 for(const unit of units){
  if(newlyCreated>=maxUnits)break;
  const result=unit.kind==="identity"?await createPersonAndMembership(db,approved,unit.member):
   unit.kind==="catalog"?await createCatalog(db,approved,unit.collection,unit.catalogKind,unit.row):
   await createOffering(db,approved,unit.row);
  receipt.processedUnits++;
  if(result==="created"){receipt.created++;newlyCreated++;}else receipt.alreadyApplied++;
 }
 receipt.remainingUnits=Math.max(0,units.length-receipt.processedUnits);
 receipt.complete=receipt.remainingUnits===0;return receipt;
}
async function main(){
 const args=process.argv.slice(2),apply=args.includes("--apply");
 const planPath=requiredArg(args,"plan"),approvalPath=requiredArg(args,"approval"),
  receiptPath=requiredArg(args,"receipt"),maxUnits=intArg(args,"max-units",50,1,100);
 if(apply&&process.env.ADMINERVA_MCS_CANONICAL_WRITE!==WRITE_ACK)
  throw Error("Write mode requires the exact ADMINERVA_MCS_CANONICAL_WRITE acknowledgement.");
 const planFile=load(planPath,"Plan"),approvalFile=load(approvalPath,"Approval");
 const plan=validatePlan(planFile.data),approved=validateApproval(plan,planFile.raw,approvalFile.data);
 if(!getApps().length)initializeApp({credential:applicationDefault()});
 const receipt=await applyFoundation(getFirestore(),approved,{apply,maxUnits});
 writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+"\n",{flag:"wx",mode:0o600});
 console.info(JSON.stringify({mode:receipt.mode,schoolId:SCHOOL_ID,blocked:receipt.blocked,
  created:receipt.created,alreadyApplied:receipt.alreadyApplied,
  remainingUnits:receipt.remainingUnits,complete:receipt.complete}));
 if(receipt.blocked)process.exitCode=2;
}
if(require.main===module)main().catch(error=>{
 console.error("MCS canonical foundation apply failed:",error.code||error.message);process.exitCode=1;
});
module.exports={WRITE_ACK,RECEIPT_SCHEMA,validatePlan,validateApproval,approvedCatalog,
 sameMigration,inspectTargets,workUnits,applyFoundation};
