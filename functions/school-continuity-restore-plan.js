"use strict";
/**
 * Read-only restore planner for Adminerva school continuity exports.
 *
 * Memberships/roles are never proposed for automatic restore. The planner
 * validates bundle integrity, binds restoration to the same school ID, and
 * classifies existing canonical targets as ready/identical/conflict.
 */
const {initializeApp,getApps,applicationDefault}=require("firebase-admin/app");
const {getFirestore}=require("firebase-admin/firestore");
const {readFileSync,writeFileSync}=require("node:fs");
const {createHash}=require("node:crypto");
const {EXPORT_SCHEMA,definitions}=require("./school-data-export.js");

const PLAN_SCHEMA="adminerva-school-continuity-restore-plan-v1";
const AUTO_CATEGORIES=[
 "people","academic_years","terms","subjects","sections","course_offerings",
 "enrollments","staff_assignments","assessments","student_grades","support_reports"
];
const sha=value=>createHash("sha256").update(value).digest("hex");
function arg(args,name){
 const value=args.find(item=>item.startsWith("--"+name+"="))?.slice(name.length+3);
 if(!value||!value.startsWith("/")||value.includes("\0"))
  throw Error("Provide --"+name+" as a restricted absolute path.");
 return value;
}
function read(path,label){
 const raw=readFileSync(path);let data;
 try{data=JSON.parse(raw.toString("utf8"));}catch{throw Error(label+" is not valid JSON.");}
 return {raw,data};
}
function exportPayload(bundle){
 const {sha256:_,...payload}=bundle||{};return payload;
}
function verifyBundle(bundle){
 if(!bundle||bundle.schema!==EXPORT_SCHEMA||typeof bundle.schoolId!=="string"||
    !/^[a-z0-9][a-z0-9_-]{1,63}$/.test(bundle.schoolId))
  throw Error("Use a valid Adminerva school continuity export.");
 if(typeof bundle.sha256!=="string"||!/^[a-f0-9]{64}$/.test(bundle.sha256))
  throw Error("Continuity export has no valid SHA-256 integrity value.");
 const digest=sha(JSON.stringify(exportPayload(bundle)));
 if(digest!==bundle.sha256)throw Error("Continuity export integrity check failed.");
 if(!bundle.categories||typeof bundle.categories!=="object"||Array.isArray(bundle.categories))
  throw Error("Continuity export categories are missing.");
 for(const category of Object.keys(definitions)){
  if(!Array.isArray(bundle.categories[category]))
   throw Error("Continuity export category is missing: "+category);
 }
 return {schoolId:bundle.schoolId,digest};
}
function normalize(value){
 if(value?.toMillis)return new Date(value.toMillis()).toISOString();
 if(Array.isArray(value))return value.map(normalize);
 if(value&&typeof value==="object"){
  const result={};for(const [key,item] of Object.entries(value))result[key]=normalize(item);return result;
 }
 return value===undefined?null:value;
}
function comparable(category,row){
 const def=definitions[category],data={};
 for(const key of def.fields)if(row[key]!==undefined)data[key]=normalize(row[key]);
 return data;
}
function validateId(value,label){
 if(typeof value!=="string"||!/^[A-Za-z0-9_.:@+-]{1,330}$/.test(value))
  throw Error("Invalid "+label+" in continuity export.");
 return value;
}
function validateRows(bundle){
 const blockers=[],reviewItems=[],seen=new Set();
 for(const category of Object.keys(definitions)){
  for(const row of bundle.categories[category]){
   try{
    validateId(row.id,category+" record ID");
    const key=category+"/"+row.id;
    if(seen.has(key))throw Error("Duplicate continuity record ID.");
    seen.add(key);
    if(category==="student_grades"&&row.status!=="published")
     throw Error("Continuity restore accepts published grades only.");
    if(category==="memberships"){
     reviewItems.push({type:"membership_access_restore_required",recordId:row.id,
       roles:Array.isArray(row.roles)?row.roles:[],status:row.status||"",
       resolution:"Restore school access through verified invitations/platform school-admin recovery, not through continuity apply."});
    }
   }catch(error){blockers.push({category,recordId:row?.id||null,type:"invalid_export_record",message:error.message});}
  }
 }
 return {blockers,reviewItems};
}
async function targetState(db,schoolId,category,row){
 const ref=db.doc("schools/"+schoolId+"/"+definitions[category].path+"/"+row.id),
  current=await ref.get();
 if(!current.exists)return {category,recordId:row.id,targetPath:ref.path,state:"ready"};
 const existing=comparable(category,current.data()),expected=comparable(category,row);
 return {category,recordId:row.id,targetPath:ref.path,
  state:JSON.stringify(existing)===JSON.stringify(expected)?"identical":"target_conflict"};
}
async function dependencyReview(db,bundle,states){
 const schoolId=bundle.schoolId,issues=[];
 const stateMap=new Map(states.map(row=>[row.category+"/"+row.recordId,row.state]));
 const existsOrPlanned=async(category,id)=>{
  const state=stateMap.get(category+"/"+id);
  if(["ready","identical"].includes(state))return true;
  return (await db.doc("schools/"+schoolId+"/"+definitions[category].path+"/"+id).get()).exists;
 };
 for(const row of bundle.categories.course_offerings){
  for(const [category,id] of [["academic_years",row.yearId],["terms",row.termId],["subjects",row.subjectId],["sections",row.sectionId]])
   if(!await existsOrPlanned(category,id))
    issues.push({type:"restore_dependency_missing",category:"course_offerings",recordId:row.id,dependsOn:category+"/"+id});
 }
 for(const row of bundle.categories.enrollments){
  if(!await existsOrPlanned("people",row.personId))
   issues.push({type:"restore_dependency_missing",category:"enrollments",recordId:row.id,dependsOn:"people/"+row.personId});
  if(!await existsOrPlanned("course_offerings",row.offeringId))
   issues.push({type:"restore_dependency_missing",category:"enrollments",recordId:row.id,dependsOn:"course_offerings/"+row.offeringId});
 }
 for(const row of bundle.categories.staff_assignments)
  if(!await existsOrPlanned("course_offerings",row.offeringId))
   issues.push({type:"restore_dependency_missing",category:"staff_assignments",recordId:row.id,dependsOn:"course_offerings/"+row.offeringId});
 for(const row of bundle.categories.assessments)
  if(!await existsOrPlanned("course_offerings",row.offeringId))
   issues.push({type:"restore_dependency_missing",category:"assessments",recordId:row.id,dependsOn:"course_offerings/"+row.offeringId});
 for(const row of bundle.categories.student_grades){
  if(!await existsOrPlanned("assessments",row.taskId))
   issues.push({type:"restore_dependency_missing",category:"student_grades",recordId:row.id,dependsOn:"assessments/"+row.taskId});
  if(!await existsOrPlanned("people",row.personId))
   issues.push({type:"restore_dependency_missing",category:"student_grades",recordId:row.id,dependsOn:"people/"+row.personId});
 }
 return issues;
}
async function buildRestorePlan(db,bundle){
 const verified=verifyBundle(bundle),validation=validateRows(bundle),
  school=await db.doc("platform_schools/"+bundle.schoolId).get();
 const blockers=[...validation.blockers],states=[];
 if(!school.exists||!["draft","active","suspended"].includes(school.data().state))
  blockers.push({type:"target_school_missing_or_unavailable",schoolId:bundle.schoolId});
 for(const category of AUTO_CATEGORIES)
  for(const row of bundle.categories[category])
   states.push(await targetState(db,bundle.schoolId,category,row));
 blockers.push(...states.filter(row=>row.state==="target_conflict"));
 const dependencyIssues=await dependencyReview(db,bundle,states);
 blockers.push(...dependencyIssues);
 const categories={};
 for(const category of AUTO_CATEGORIES){
  const rows=states.filter(row=>row.category===category);
  categories[category]={
   records:bundle.categories[category].length,
   ready:rows.filter(row=>row.state==="ready").length,
   identical:rows.filter(row=>row.state==="identical").length,
   conflicts:rows.filter(row=>row.state==="target_conflict").length
  };
 }
 return {
  schema:PLAN_SCHEMA,schoolId:bundle.schoolId,readOnly:true,readyForApply:false,
  generatedAt:new Date().toISOString(),exportSha256:verified.digest,
  exportGeneratedAt:bundle.generatedAt||null,
  categories,states,blockers,reviewItems:validation.reviewItems,
  membershipRecords:(bundle.categories.memberships||[]).map(row=>({
   uid:row.id,status:row.status,roles:row.roles||[],personId:row.personId||null
  })),
  autoRestoreCategories:AUTO_CATEGORIES,
  excludedFromAutomaticRestore:["memberships"],
  nextRequiredReview:[
   "Resolve every target conflict and missing dependency.",
   "Recover/verify school memberships and roles separately; continuity apply never grants access.",
   "Review person-to-auth UID links before restoring records that depend on active student/teacher accounts.",
   "Approve the exact export hash and create-only restore plan before any writes."
  ]
 };
}
async function main(){
 const args=process.argv.slice(2),bundle=read(arg(args,"export"),"Continuity export").data,
  output=arg(args,"output");
 if(!getApps().length)initializeApp({credential:applicationDefault()});
 const plan=await buildRestorePlan(getFirestore(),bundle);
 writeFileSync(output,JSON.stringify(plan,null,2)+"\n",{flag:"wx",mode:0o600});
 console.info(JSON.stringify({restorePlanCreated:true,schoolId:plan.schoolId,
  exportSha256:plan.exportSha256,blockers:plan.blockers.length,
  membershipAccessRecords:plan.membershipRecords.length,readyForApply:false}));
}
if(require.main===module)main().catch(error=>{
 console.error("School continuity restore planning failed:",error.message);process.exitCode=1;
});
module.exports={PLAN_SCHEMA,AUTO_CATEGORIES,verifyBundle,normalize,comparable,
 validateRows,targetState,dependencyReview,buildRestorePlan};
