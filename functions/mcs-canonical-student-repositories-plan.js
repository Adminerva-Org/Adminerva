"use strict";
/**
 * Read-only MCS student repository configuration migration planner.
 *
 * Legacy GitHub OAuth tokens are never copied. Repository URLs/usernames are
 * proposed per approved active course enrollment and require explicit review.
 */
const {initializeApp,getApps,applicationDefault}=require("firebase-admin/app");
const {getFirestore}=require("firebase-admin/firestore");
const {readFileSync,writeFileSync}=require("node:fs");
const {createHash}=require("node:crypto");
const {canonicalDigest}=require("./mcs-migration-ledger.js");
const {SCHOOL_ID}=require("./mcs-canonical-foundation-plan.js");
const {validatePlan:validateAccessPlan,validateApproval:validateAccessApproval}=
 require("./mcs-canonical-academic-access-apply.js");
const {rowKey}=require("./school-academics.js");
const {repository,username}=require("./school-student-profile.js");

const SCHEMA="adminerva-v4-mcs-canonical-student-repositories-plan-v1";
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
async function sourceStudent(db,legacyStudentId){
 const ref=db.doc("schools/"+SCHOOL_ID+"/legacy_roots/students/documents/"+legacyStudentId),
  doc=await ref.get();
 return doc.exists?{id:doc.id,path:doc.ref.path,data:doc.data(),digest:canonicalDigest(doc.data())}:null;
}
function repoCandidate(source,enrollment){
 const raw=source.data||{},url=String(raw.repoUrl||raw.repositoryUrl||"").trim(),
  rawUsername=String(raw.githubUsername||"").trim();
 if(!url)return {empty:true};
 let parsed;
 try{parsed=repository(url);}catch(error){
  return {error:"legacy_repository_url_invalid",message:error.message};
 }
 let githubUsername="";
 try{githubUsername=username(rawUsername);}catch(error){
  return {error:"legacy_github_username_invalid",message:error.message};
 }
 return {
  configId:rowKey(enrollment.personId,enrollment.offeringId),
  targetPath:"schools/"+SCHOOL_ID+"/student_repository_configs/"+
    rowKey(enrollment.personId,enrollment.offeringId),
  personId:enrollment.personId,studentUid:enrollment.studentUid,
  offeringId:enrollment.offeringId,repository:parsed.repository,
  repositoryUrl:parsed.url,githubUsername,
  source:{
   legacyStudentId:source.id,sourcePath:source.path,sourceDigest:source.digest,
   legacyTokenPresent:Boolean(String(raw.githubToken||"").trim())
  },
  requiresApproval:true
 };
}
async function buildPlan(db,{accessPlan,accessPlanRaw,accessApproval}){
 const approved=validateAccessApproval(validateAccessPlan(accessPlan),accessPlanRaw,accessApproval),
  enrollments=approved.enrollments.filter(row=>row.status==="active"),
  sourceIds=[...new Set(enrollments.map(row=>row.source?.legacyStudentId).filter(Boolean))],
  sources=new Map();
 for(const id of sourceIds){
  const source=await sourceStudent(db,id);
  if(source)sources.set(id,source);
 }
 const candidates=[],blockers=[],reviewItems=[],byStudent=new Map();
 for(const enrollment of enrollments){
  const legacyStudentId=enrollment.source?.legacyStudentId;
  if(!legacyStudentId){
   blockers.push({type:"repository_source_student_missing",enrollmentId:enrollment.enrollmentId,
    personId:enrollment.personId,offeringId:enrollment.offeringId});continue;
  }
  const source=sources.get(legacyStudentId);
  if(!source){
   blockers.push({type:"repository_source_mirror_missing",legacyStudentId,
    enrollmentId:enrollment.enrollmentId});continue;
  }
  const candidate=repoCandidate(source,enrollment);
  if(candidate.error){
   blockers.push({type:candidate.error,legacyStudentId,enrollmentId:enrollment.enrollmentId,
    sourcePath:source.path,message:candidate.message});continue;
  }
  if(candidate.empty)continue;
  candidates.push(candidate);
  const list=byStudent.get(enrollment.studentUid)||[];
  list.push(candidate);byStudent.set(enrollment.studentUid,list);
  if(candidate.source.legacyTokenPresent)
   reviewItems.push({
    type:"legacy_github_token_intentionally_excluded",
    studentUid:enrollment.studentUid,personId:enrollment.personId,
    legacyStudentId,sourcePath:source.path,
    resolution:"Do not migrate the OAuth token. Student may authorize GitHub temporarily in V4 when private repository access is required."
   });
 }
 for(const [uid,rows] of byStudent){
  if(rows.length>1&&new Set(rows.map(row=>row.repository)).size===1)
   reviewItems.push({
    type:"legacy_single_repository_replicated_to_multiple_offerings",
    studentUid:uid,repository:rows[0].repository,
    offerings:rows.map(row=>row.offeringId),
    resolution:"Approve only the course offerings that should use this legacy repository. Exclude unrelated offerings."
   });
 }
 return {
  schema:SCHEMA,schoolId:SCHOOL_ID,readOnly:true,readyForApply:false,
  generatedAt:new Date().toISOString(),academicAccessPlanSha256:sha(accessPlanRaw),
  candidates,blockers,reviewItems,
  summary:{
   activeEnrollmentSources:enrollments.length,candidates:candidates.length,
   studentsWithRepository:byStudent.size,
   legacyTokensExcluded:candidates.filter(row=>row.source.legacyTokenPresent).length,
   blockers:blockers.length,reviewItems:reviewItems.length
  },
  credentialPolicy:{
   oauthTokensMigrated:false,
   durableFields:["repository","repositoryUrl","githubUsername"],
   privateRepositoryAccess:"session-only OAuth authorization in V4"
  },
  nextRequiredReview:[
   "Resolve every invalid or missing mirrored repository source.",
   "Approve or exclude each repository-to-course-offering mapping.",
   "Review students whose one legacy repository would map to multiple offerings.",
   "Confirm legacy GitHub OAuth tokens are intentionally excluded and must not be copied."
  ]
 };
}
async function main(){
 const args=process.argv.slice(2),access=read(arg(args,"academic-access-plan"),"Academic access plan"),
  approval=read(arg(args,"academic-access-approval"),"Academic access approval"),
  output=arg(args,"output");
 if(!getApps().length)initializeApp({credential:applicationDefault()});
 const plan=await buildPlan(getFirestore(),{
  accessPlan:access.data,accessPlanRaw:access.raw,accessApproval:approval.data
 });
 writeFileSync(output,JSON.stringify(plan,null,2)+"\n",{flag:"wx",mode:0o600});
 console.info(JSON.stringify({studentRepositoryPlanCreated:true,schoolId:SCHOOL_ID,
  summary:plan.summary,oauthTokensMigrated:false,readyForApply:false}));
}
if(require.main===module)main().catch(error=>{
 console.error("MCS student repository planning failed:",error.message);process.exitCode=1;
});
module.exports={SCHEMA,sourceStudent,repoCandidate,buildPlan};
