"use strict";
/**
 * Read-only canonical foundation planner for the confirmed MCS pilot.
 *
 * Converts the reconciled legacy mirror into REVIEW CANDIDATES for:
 * - one school person per unambiguous verified identity,
 * - proposed school membership roles (never granted here),
 * - observed academic-year / section / subject / term labels.
 *
 * It intentionally does not create Firestore records. Assessments, grades,
 * submissions, lessons and Studio migration remain blocked until this
 * foundation has reviewed target IDs and offerings.
 */
const {initializeApp,getApps,applicationDefault}=require("firebase-admin/app");
const {getFirestore,FieldPath}=require("firebase-admin/firestore");
const {readFileSync,writeFileSync}=require("node:fs");
const {createHash}=require("node:crypto");
const {canonicalDigest}=require("./mcs-migration-ledger.js");

const SCHOOL_ID="mcs-manila";
const SCHEMA="adminerva-v4-mcs-canonical-foundation-plan-v1";
function sha256(value){return createHash("sha256").update(value).digest("hex");}
function absArg(args,name){
 const value=args.find(arg=>arg.startsWith("--"+name+"="))?.slice(name.length+3);
 if(!value||!value.startsWith("/")||value.includes("\0"))
  throw Error("Provide a restricted absolute --"+name+"=/secure/path.");
 return value;
}
function loadJson(path,label){
 const raw=readFileSync(path);let data;
 try{data=JSON.parse(raw.toString("utf8"));}catch{throw Error(label+" is not valid JSON.");}
 return {raw,data};
}
function cleanText(value,max=160){
 return typeof value==="string"?value.trim().replace(/\s+/g," ").slice(0,max):"";
}
function statusActive(value){
 return !["archived","suspended","inactive","disabled","deleted"].includes(cleanText(value,40).toLowerCase());
}
function stablePersonId(uid){
 if(typeof uid!=="string"||!uid)throw Error("Verified UID required for deterministic person ID.");
 return "mcs_"+sha256("person\0"+uid).slice(0,36);
}
function stableCatalogId(kind,label){
 const prefix={year:"yr",section:"sec",subject:"sub",term:"term"}[kind]||"cat";
 const slug=cleanText(label,80).toLowerCase().normalize("NFKD")
  .replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,38)||"legacy";
 return prefix+"_"+slug+"_"+sha256(kind+"\0"+label).slice(0,8);
}
function displayName(data,fallback){
 const direct=cleanText(data?.displayName||data?.name||data?.fullName||data?.studentName||data?.teacherName,140);
 if(direct)return direct;
 const first=cleanText(data?.firstName||data?.firstname||data?.first_name,70);
 const last=cleanText(data?.lastName||data?.lastname||data?.last_name,70);
 return cleanText([first,last].filter(Boolean).join(" "),140)||fallback;
}
function academicLabels(rows){
 const years=new Set(),sections=new Set(),subjects=new Set(),terms=new Set();
 const add=(set,value)=>{const text=cleanText(value,140);if(text)set.add(text);};
 for(const row of rows.students||[]){
  const d=row.data||{};add(years,d.schoolYear||d.school_year||d.academicYear||d.year);
  add(sections,d.section||d.sectionName||d.classSection);
 }
 for(const row of rows.assessments||[]){
  const d=row.data||{};add(years,d.schoolYear||d.school_year||d.academicYear);
  add(subjects,d.subject||d.subjectName);add(terms,d.term||d.quarter||d.academicTerm);
  if(Array.isArray(d.sectionIds))d.sectionIds.forEach(value=>add(sections,value));
  if(Array.isArray(d.deployments))for(const deployment of d.deployments||[]){
   add(sections,deployment?.section||deployment?.sectionId);
   add(terms,deployment?.term||deployment?.quarter);
  }
 }
 const map=(kind,set)=>[...set].sort((a,b)=>a.localeCompare(b)).map(label=>({
   legacyLabel:label,suggestedId:stableCatalogId(kind,label),requiresReview:true
 }));
 return {years:map("year",years),sections:map("section",sections),
   subjects:map("subject",subjects),terms:map("term",terms)};
}
function identityIndexes(identity){
 if(!identity||identity.schema!=="adminerva-v4-mcs-identity-candidates-v1"||
    identity.schoolId!==SCHOOL_ID||identity.readOnly!==true||identity.grantsCreated!==false)
  throw Error("Use the current read-only MCS identity-candidate report.");
 const student=new Map(),staff=new Map(),byUid=new Map();
 for(const candidate of identity.candidates||[]){
  if(typeof candidate.uid!=="string"||!candidate.uid)throw Error("Identity report contains an invalid UID.");
  if(byUid.has(candidate.uid))throw Error("Identity report contains duplicate UIDs.");
  byUid.set(candidate.uid,candidate);
  for(const row of candidate.legacyStudentIds||[]){
   if(student.has(row.studentId)&&student.get(row.studentId)!==candidate.uid)
    throw Error("One legacy student row maps to multiple verified UIDs.");
   student.set(row.studentId,candidate.uid);
  }
  for(const id of candidate.legacyStaffRecordIds||[]){
   if(staff.has(id)&&staff.get(id)!==candidate.uid)
    throw Error("One legacy staff row maps to multiple verified UIDs.");
   staff.set(id,candidate.uid);
  }
 }
 return {student,staff,byUid};
}
function teacherUidForRow(row,indexes){
 const d=row.data||{};
 for(const value of [d.uid,d.authUid,d.ownerUid]){
  if(typeof value==="string"&&indexes.byUid.has(value))return value;
 }
 if(indexes.staff.has(row.id))return indexes.staff.get(row.id);
 return null;
}
function buildFoundationPlan({identity,rows,reconciliationSha256,identitySha256}){
 const indexes=identityIndexes(identity),grouped=new Map(),blockers=[],reviewItems=[];
 function add(uid,kind,row,sourceKind){
  const existing=grouped.get(uid)||{uid,kinds:new Set(),rows:[],roles:new Set()};
  existing.kinds.add(kind);existing.rows.push({...row,sourceKind});
  const identityRow=indexes.byUid.get(uid);
  for(const role of identityRow?.rolesToReview||[])
   if(["student","teacher"].includes(role))existing.roles.add(role);
  grouped.set(uid,existing);
 }
 for(const row of rows.students||[]){
  const uid=indexes.student.get(row.id);
  if(!uid){blockers.push({type:"student_identity_unresolved",sourcePath:row.path});continue;}
  add(uid,"student",row,"students");
 }
 for(const row of rows.teachers||[]){
  const uid=teacherUidForRow(row,indexes);
  if(!uid){blockers.push({type:"teacher_identity_unresolved",sourcePath:row.path});continue;}
  add(uid,"staff",row,"teachers");
 }
 // Identity candidates with staff access but no teacher profile still remain
 // visible as blockers rather than inventing staff display names.
 for(const candidate of identity.candidates||[]){
  if((candidate.rolesToReview||[]).includes("teacher")&&!grouped.has(candidate.uid))
   blockers.push({type:"verified_teacher_profile_unresolved",uid:candidate.uid,
     legacyStaffRecordIds:candidate.legacyStaffRecordIds||[]});
 }
 const people=[],memberships=[];
 for(const group of [...grouped.values()].sort((a,b)=>a.uid.localeCompare(b.uid))){
  if(group.kinds.size!==1){
   blockers.push({type:"identity_kind_conflict",uid:group.uid,kinds:[...group.kinds].sort(),
     sourcePaths:group.rows.map(row=>row.path)});
   continue;
  }
  const kind=[...group.kinds][0],personId=stablePersonId(group.uid);
  const names=[...new Set(group.rows.map(row=>displayName(row.data,"")).filter(Boolean))];
  const name=names[0]||((kind==="student"?"Student ":"Staff ")+personId.slice(-8));
  if(names.length>1)reviewItems.push({type:"display_name_review",uid:group.uid,personId,names});
  const active=group.rows.some(row=>statusActive(row.data?.status));
  const sourceDigest=canonicalDigest(group.rows.map(row=>({
   sourcePath:row.path,sourceDigest:row.digest
  })).sort((a,b)=>a.sourcePath.localeCompare(b.sourcePath)));
  people.push({
   personId,targetPath:"schools/"+SCHOOL_ID+"/people/"+personId,
   uid:group.uid,kind,status:active?"active":"archived",displayName:name,
   sourcePaths:group.rows.map(row=>row.path).sort(),sourceDigest,
   proposedAuthLink:group.uid,requiresApproval:true
  });
  memberships.push({
   uid:group.uid,targetPath:"schools/"+SCHOOL_ID+"/memberships/"+group.uid,
   personId,roles:[...group.roles].sort(),status:active?"active":"suspended",
   requiresApproval:true,grantAutomatically:false
  });
 }
 const academic=academicLabels(rows);
 return {
  schema:SCHEMA,schoolId:SCHOOL_ID,readOnly:true,generatedAt:new Date().toISOString(),
  source:{reconciliationSha256,identitySha256},
  people,memberships,academicObservations:academic,blockers,reviewItems,
  summary:{
   mirroredStudents:(rows.students||[]).length,mirroredTeachers:(rows.teachers||[]).length,
   mirroredAssessments:(rows.assessments||[]).length,
   personCandidates:people.length,membershipCandidates:memberships.length,
   blockers:blockers.length,reviewItems:reviewItems.length,
   observedYears:academic.years.length,observedSections:academic.sections.length,
   observedSubjects:academic.subjects.length,observedTerms:academic.terms.length
  },
  readyForCanonicalApply:false,
  nextRequiredReview:[
   "Approve each person/account linkage and proposed membership role; no role may be inferred from email domain.",
   "Resolve every identity-kind/display-name blocker.",
   "Map observed academic labels to approved canonical academic year, term, section and subject IDs.",
   "Define explicit course offerings before producing enrollments, assessment deployments, grades or teacher assignments.",
   "Keep historical inactive rows as history; do not turn them into current enrollment automatically."
  ]
 };
}
async function readMirrorRoot(db,root,max=25000){
 const base=db.collection("schools/"+SCHOOL_ID+"/legacy_roots/"+root+"/documents");
 const rows=[];let cursor=null;
 while(rows.length<max){
  let q=base.orderBy(FieldPath.documentId()).limit(Math.min(200,max-rows.length));
  if(cursor)q=q.startAfter(cursor);
  const snap=await q.get();
  for(const doc of snap.docs)rows.push({id:doc.id,path:doc.ref.path,data:doc.data(),digest:canonicalDigest(doc.data())});
  if(snap.size<200)return rows;
  cursor=snap.docs.at(-1);
 }
 throw Error("Mirror root "+root+" exceeded the planner cap.");
}
async function generateFoundationPlan(db,{identity,reconciliationSha256,identitySha256}){
 const [students,teachers,assessments]=await Promise.all([
  readMirrorRoot(db,"students"),readMirrorRoot(db,"teachers"),readMirrorRoot(db,"assessments")
 ]);
 return buildFoundationPlan({identity,rows:{students,teachers,assessments},
   reconciliationSha256,identitySha256});
}
async function main(){
 const args=process.argv.slice(2),reconPath=absArg(args,"reconciliation"),
   identityPath=absArg(args,"identity"),outputPath=absArg(args,"output");
 const reconFile=loadJson(reconPath,"Reconciliation"),identityFile=loadJson(identityPath,"Identity report");
 const reconciliation=reconFile.data;
 if(reconciliation.schema!=="adminerva-v4-mcs-mirror-reconciliation-v1"||
    reconciliation.schoolId!==SCHOOL_ID||reconciliation.readOnly!==true||
    reconciliation.complete!==true||Array.isArray(reconciliation.blockers)&&reconciliation.blockers.length)
  throw Error("Canonical planning requires a complete blocker-free MCS mirror reconciliation.");
 if(!getApps().length)initializeApp({credential:applicationDefault()});
 const plan=await generateFoundationPlan(getFirestore(),{
  identity:identityFile.data,reconciliationSha256:sha256(reconFile.raw),
  identitySha256:sha256(identityFile.raw)
 });
 writeFileSync(outputPath,JSON.stringify(plan,null,2)+"\n",{flag:"wx",mode:0o600});
 console.info(JSON.stringify({canonicalPlanCreated:true,schoolId:SCHOOL_ID,
  summary:plan.summary,readyForCanonicalApply:false}));
}
if(require.main===module)main().catch(error=>{
 console.error("MCS canonical foundation planning failed:",error.code||error.message);
 process.exitCode=1;
});
module.exports={SCHEMA,SCHOOL_ID,stablePersonId,stableCatalogId,displayName,
 academicLabels,identityIndexes,teacherUidForRow,buildFoundationPlan,readMirrorRoot,
 generateFoundationPlan};
