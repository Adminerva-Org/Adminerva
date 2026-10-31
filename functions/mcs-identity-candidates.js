"use strict";
/**
 * MCS-only legacy identity candidate map. Read-only and non-authoritative:
 * a verified Firebase Auth match is NOT the same as a school permission grant.
 * Preserves distinct student enrollment rows and refuses email-only grade moves.
 */
const {initializeApp,getApps,applicationDefault}=require("firebase-admin/app");
const {getFirestore,FieldPath}=require("firebase-admin/firestore");
const {getAuth}=require("firebase-admin/auth");
const {writeFileSync}=require("node:fs");
const {createHash}=require("node:crypto");
function normalizeEmail(value) {
 const email=typeof value==="string"?value.trim().toLowerCase():"";
 return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:null;
}
function fingerprint(email){
 return createHash("sha256").update(email).digest("hex");
}
async function readAll(db,collectionName,max=20000){
 const rows=[];let cursor=null;
 while(rows.length<max){
  let q=db.collection(collectionName).orderBy(FieldPath.documentId()).limit(Math.min(200,max-rows.length));
  if(cursor)q=q.startAfter(cursor);
  const page=await q.get();
  for(const doc of page.docs)rows.push({id:doc.id,data:doc.data()});
  if(page.size<200)break;
  cursor=page.docs.at(-1);
 }
 if(rows.length===max)throw Error("Mapping stopped at document cap; create a larger reviewed inventory before proceeding.");
 return rows;
}
async function identityCandidates({db,resolveUserByEmail,schoolId="mcs-manila"}){
 if(schoolId!=="mcs-manila")throw Error("The owner confirmation is specific to the MCS pilot.");
 const [students,staff]=await Promise.all([
  readAll(db,"students"),readAll(db,"staff_access")
 ]);
 const emails=[...new Set([...students,...staff].map(row=>normalizeEmail(row.data.email)).filter(Boolean))];
 const resolved=new Map();
 for(const email of emails) {
  try{
   const user=await resolveUserByEmail(email);
   resolved.set(email,user&&user.emailVerified&&!user.disabled?user:null);
  }catch(error){
   if(error?.code==="auth/user-not-found")resolved.set(email,null);
   else throw error;
  }
 }
 const records=new Map();
 const notes=[];
 for(const row of students){
  const email=normalizeEmail(row.data.email);
  const user=email?resolved.get(email):null;
  if(!email||!user){notes.push({source:"students/"+row.id,issue:!email?"missing_or_invalid_email":"no_verified_active_auth_link"});continue;}
  const current=records.get(user.uid)||{
   uid:user.uid,schoolId,legacyStudentIds:[],legacyStaffRecordIds:[],rolesToReview:[],
   requiresManualSchoolApproval:true
  };
  current.legacyStudentIds.push({
   studentId:row.id,year:typeof row.data.schoolYear==="string"?row.data.schoolYear:null,
   section:typeof row.data.section==="string"?row.data.section:null,
   status:typeof row.data.status==="string"?row.data.status:"active"
  });
  if(!current.rolesToReview.includes("student"))current.rolesToReview.push("student");
  records.set(user.uid,current);
 }
 for(const row of staff){
  const email=normalizeEmail(row.data.email||row.id),user=email?resolved.get(email):null;
  if(!email||!user){notes.push({source:"staff_access/"+row.id,issue:!email?"missing_or_invalid_email":"no_verified_active_auth_link"});continue;}
  const current=records.get(user.uid)||{
   uid:user.uid,schoolId,legacyStudentIds:[],legacyStaffRecordIds:[],rolesToReview:[],
   requiresManualSchoolApproval:true
  };
  current.legacyStaffRecordIds.push(row.id);
  if(row.data.status!=="active"){notes.push({source:"staff_access/"+row.id,issue:"inactive_staff_grant"});continue;}
  if(row.data.role==="teacher") {
   if(!current.rolesToReview.includes("teacher"))current.rolesToReview.push("teacher");
  }else if(row.data.role==="admin"){
   // An old global admin is not automatically the first MCS school admin or platform owner.
   notes.push({source:"staff_access/"+row.id,issue:"legacy_admin_requires_owner_approval"});
  }
  records.set(user.uid,current);
 }
 return {
  schema:"adminerva-v4-mcs-identity-candidates-v1",schoolId,readOnly:true,
  ownerConfirmedMcsOnly:true,grantsCreated:false,
  generatedAt:new Date().toISOString(),
  candidates:[...records.values()].sort((a,b)=>a.uid.localeCompare(b.uid)),
  reconciliation:notes,
  summary:{legacyStudentRows:students.length,legacyStaffRows:staff.length,
   matchedVerifiedAccounts:records.size,unresolvedRows:notes.length},
  warnings:[
   "Preserve every historical studentId and schoolYear/section relationship; multiple rows may map to one UID.",
   "A verified Auth UID does not establish a school person record, enrollment or active membership.",
   "Suspended/archived students must retain history without automatic current enrollment.",
   "Legacy admin grants, teacher assignment scopes and private resource owner UIDs require review.",
   "No school grants, grades, evidence or personal resources are changed by this report."
  ]
 };
}
async function main(){
 const output=process.argv.find(arg=>arg.startsWith("--output="))?.slice(9);
 if(!output||!output.startsWith("/"))throw Error("Provide an absolute --output=/restricted/path for a private identity report.");
 if(!getApps().length)initializeApp({credential:applicationDefault()});
 const report=await identityCandidates({db:getFirestore(),resolveUserByEmail:email=>getAuth().getUserByEmail(email)});
 writeFileSync(output,JSON.stringify(report,null,2)+"\n",{flag:"wx",mode:0o600});
 console.info(JSON.stringify({reportCreated:true,summary:report.summary,grantsCreated:false}));
}
if(require.main===module)main().catch(error=>{console.error(error.code||error.message);process.exitCode=1;});
module.exports={identityCandidates,normalizeEmail,fingerprint};
