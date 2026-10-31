"use strict";
/**
 * Deterministic, read-only MCS migration ledger.
 * This is a source-of-truth *planning* artifact, not a production data copier.
 * No Firestore writes, notifications, changes to grades, or automatic memberships.
 */
const {createHash}=require("node:crypto");

const SCHOOL_ROOTS=new Set([
 "students","teachers","school_catalog","assessments","assessment_private",
 "assessment_evidence","studio_submissions","student_grades","grade_revisions",
 "student_submissions","commit_reclaims","commit_claim_decisions","commit_claim_conflicts",
 "student_code_projects","student_playground_workspaces","playground_snapshots",
 "student_projects","student_submissions","student_grade_drafts","repositories",
 "staff_workspaces","teacher_materials","lesson_plans","presentations","reference_folders",
 "library_folders","practice_profiles","practice_scores","practice_boards",
 "practice_rankings","practice_verified_progress","practice_class_progress",
 "practice_awards","practice_sessions","practice_browser_sessions",
 "practice_attempts","practice_security_events","practice_season_scores",
 "practice_season_progress","practice_season_awards","practice_season_attempts",
 "practice_class_season_rankings","student_practice_progress",
 "activity_preferences","activity_events","analytics_rosters","analytics_views",
 "issues","notifications","notification_history","grading_alerts","teaching_roster",
 "academic_access_preparations","student_access","student_playground_projects"
]);
const IDENTITY_ROOTS=new Set(["staff_access","account_requests"]);
const PLATFORM_ROOTS=new Set([
 "app_config","global_settings","monitoring_control","monitoring_status",
 "push_devices","push_preferences","system_private","school_ai_results",
 "school_ai_usage","platform_schools","platform_users","platform_admins",
 "platform_audit","provisioning_jobs","migration_runs","system_health",
 "practice_public_rankings","site_releases","patch_history"
]);
function classification(root){
 if(SCHOOL_ROOTS.has(root))return "school_candidate";
 if(IDENTITY_ROOTS.has(root))return "identity_review";
 if(PLATFORM_ROOTS.has(root))return "platform_or_secret_review";
 return "unclassified_review";
}
/** Canonical typed representation retaining nanoseconds and binary bytes. */
function normalize(value,visited=new Set()){
 if(value===null)return null;
 if(value===undefined)return {$type:"undefined"};
 if(typeof value==="string"||typeof value==="boolean")return value;
 if(typeof value==="number"){
  if(Number.isNaN(value))return {$type:"nan"};
  if(value===Infinity)return {$type:"positive_infinity"};
  if(value===-Infinity)return {$type:"negative_infinity"};
  if(Object.is(value,-0))return {$type:"negative_zero"};
  return value;
 }
 if(typeof value==="bigint")return {$type:"bigint",value:String(value)};
 if(typeof value!=="object")throw Error("Cannot canonicalize unsupported value.");
 if(visited.has(value))throw Error("Circular value in Firestore document.");
 visited.add(value);
 try{
  if(value instanceof Date)return {$type:"date",value:value.toISOString()};
  if(Buffer.isBuffer(value)||value instanceof Uint8Array)
   return {$type:"bytes",base64:Buffer.from(value).toString("base64")};
  if(Number.isInteger(value.seconds)&&Number.isInteger(value.nanoseconds)&&
     typeof value.toDate==="function")
   return {$type:"timestamp",seconds:value.seconds,nanoseconds:value.nanoseconds};
  if(typeof value.path==="string"&&value.firestore&&typeof value.id==="string")
   return {$type:"reference",path:value.path};
  if(typeof value.latitude==="number"&&typeof value.longitude==="number"&&
     value.constructor?.name==="GeoPoint")
   return {$type:"geopoint",latitude:value.latitude,longitude:value.longitude};
  if(Array.isArray(value))return value.map(item=>normalize(item,visited));
  if(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)
   throw Error("Unsupported Firestore object type: "+String(value.constructor?.name||"unknown"));
  const record={};
  for(const key of Object.keys(value).sort())record[key]=normalize(value[key],visited);
  return record;
 }finally{visited.delete(value);}
}
function canonicalDigest(value) {
 return createHash("sha256").update(JSON.stringify(normalize(value))).digest("hex");
}
function mapPath(sourcePath,schoolId="mcs-manila"){
 if(typeof sourcePath!=="string"||sourcePath.startsWith("/")||sourcePath.endsWith("/"))
  throw Error("A valid Firestore document path is required.");
 const segments=sourcePath.split("/");
 if(segments.length%2!==0||segments.some(s=>!s))throw Error("Invalid document path.");
 const kind=classification(segments[0]);
 return {sourcePath,classification:kind,
  targetPath:kind==="school_candidate"?"schools/"+schoolId+"/"+sourcePath:null};
}
function candidateEntry({sourcePath,data,updateTime,schoolId="mcs-manila",destination=null}){
 const mapping=mapPath(sourcePath,schoolId);
 const labeledSchoolId=typeof data?.schoolId==="string"?data.schoolId:"";
 const conflictingSchool=Boolean(labeledSchoolId&&labeledSchoolId!==schoolId);
 const owner=typeof data?.ownerUid==="string"&&data.ownerUid.length>0 ||
  typeof data?.creatorUid==="string"&&data.creatorUid.length>0;
 const sourceDigest=canonicalDigest(data);
 const destinationDigest=destination?.exists?canonicalDigest(destination.data):null;
 let decision="manual_review";
 if(conflictingSchool)decision="school_conflict";
 else if(mapping.classification==="school_candidate"&&destination?.exists)
  decision=destinationDigest===sourceDigest?"identical_destination":"destination_conflict";
 else if(mapping.classification==="school_candidate")decision="eligible_for_approved_copy";
 return {...mapping,decision,sourceDigest,destinationDigest,
  sourceUpdateTime:updateTime||null,hasOwnerAttribution:Boolean(owner),
  schoolIdConflict:conflictingSchool,destinationExists:Boolean(destination?.exists)};
}
module.exports={SCHOOL_ROOTS,IDENTITY_ROOTS,PLATFORM_ROOTS,classification,normalize,canonicalDigest,mapPath,candidateEntry};
