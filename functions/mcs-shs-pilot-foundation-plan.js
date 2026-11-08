"use strict";
/**
 * Read-only subset planner for the teacher-led MCS Senior High ICT controlled pilot.
 * It deliberately excludes unrelated school rows from canonical foundation blockers.
 */
const {readFileSync,writeFileSync}=require("node:fs");
const {createHash}=require("node:crypto");
const {join}=require("node:path");
const {initializeApp,getApps,applicationDefault}=require("firebase-admin/app");
const {getFirestore}=require("firebase-admin/firestore");
const {SCHEMA:OPERATOR_SCHEMA}=require("./mcs-shs-pilot-operator-template.js");
const {SCHOOL_ID,buildFoundationPlan,readMirrorRoot,identityIndexes,teacherUidForRow}=
 require("./mcs-canonical-foundation-plan.js");

const DEFAULTS_PATH=join(__dirname,"..","docs","adminerva-4-mcs-pilot-academic-defaults.json");
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
function clean(value,max=160){
 return typeof value==="string"?value.trim().replace(/\s+/g," ").slice(0,max):"";
}
function sectionTokens(value){
 return clean(value,300).split(/[,;]+/).map(item=>item.trim().toLocaleLowerCase("en")).filter(Boolean);
}
function validateOperator(operator,defaults){
 if(operator?.schema!==OPERATOR_SCHEMA||operator.schoolId!==SCHOOL_ID||
    operator.scope!=="senior_high_ict_limited_pilot"||operator.productionAuthorized!==false||
    operator.compatibilityMode!=="legacy_allowed")
  throw Error("Use the current restricted MCS SHS pilot operator file.");
 if(typeof operator.teacherUid!=="string"||!/^[A-Za-z0-9_-]{8,128}$/.test(operator.teacherUid))
  throw Error("Enter the verified pilot teacher UID in the protected operator file.");
 for(const key of ["limitedScopeReviewed","rosterReferenceReviewed","productionNotAuthorized"])
  if(operator.acknowledgements?.[key]!==true)throw Error("Missing pilot acknowledgement: "+key);
 if(!operator.academicYear||!/^[A-Za-z0-9_-]{3,80}$/.test(operator.academicYear.yearId||""))
  throw Error("Pilot academic year is invalid.");
 const known=new Set((defaults.sections||[]).map(row=>row.sectionId)),
  pending=new Set(operator.pendingSectionIds||[]);
 if(!Array.isArray(operator.activeSectionIds)||!operator.activeSectionIds.length)
  throw Error("Choose at least one active pilot section.");
 for(const id of operator.activeSectionIds)
  if(!known.has(id)||pending.has(id))throw Error("Active pilot section is unknown or pending: "+id);
 return operator;
}
function rowSection(row){
 const data=row.data||{};
 return clean(data.section||data.sectionName||data.classSection,300);
}
function matchSection(row,sections){
 const tokens=new Set(sectionTokens(rowSection(row)));
 for(const section of sections){
  const labels=(section.legacyLabels||[]).map(value=>clean(value).toLocaleLowerCase("en"));
  if(labels.some(label=>tokens.has(label)))return section;
 }
 return null;
}
function filteredIdentityReport(identity,selectedStudentIds,teacherUid){
 const candidates=[];
 for(const candidate of identity.candidates||[]){
  const studentRows=(candidate.legacyStudentIds||[]).filter(row=>selectedStudentIds.has(row.studentId)),
   teacher=candidate.uid===teacherUid;
  if(!studentRows.length&&!teacher)continue;
  const roles=[];
  if(studentRows.length)roles.push("student");
  if(teacher)roles.push("teacher");
  candidates.push({...candidate,legacyStudentIds:studentRows,
   legacyStaffRecordIds:teacher?(candidate.legacyStaffRecordIds||[]):[],
   legacyStaffScopes:teacher?(candidate.legacyStaffScopes||[]):[],
   rolesToReview:roles,requiresManualSchoolApproval:true});
 }
 return {...identity,candidates,reconciliation:[],
  summary:{...(identity.summary||{}),pilotCandidateAccounts:candidates.length}};
}
async function generate(db,{identity,reconciliation,operator,defaults,reconciliationRaw,identityRaw}){
 if(reconciliation.schema!=="adminerva-v4-mcs-mirror-reconciliation-v1"||
    reconciliation.schoolId!==SCHOOL_ID||reconciliation.readOnly!==true||
    reconciliation.complete!==true||(reconciliation.blockers||[]).length)
  throw Error("Pilot planning requires a complete blocker-free MCS mirror reconciliation.");
 validateOperator(operator,defaults);
 if(identity.schema!=="adminerva-v4-mcs-identity-candidates-v1"||
    identity.schoolId!==SCHOOL_ID||identity.readOnly!==true||identity.grantsCreated!==false)
  throw Error("Use the current read-only MCS identity-candidate report.");

 const activeIds=new Set(operator.activeSectionIds),
  activeSections=(defaults.sections||[]).filter(section=>activeIds.has(section.sectionId)),
  [allStudents,allTeachers]=await Promise.all([readMirrorRoot(db,"students"),readMirrorRoot(db,"teachers")]),
  selectedStudents=[],sectionCounts=Object.fromEntries(activeSections.map(section=>[section.sectionId,0]));
 for(const row of allStudents){
  const section=matchSection(row,activeSections);
  if(!section)continue;
  selectedStudents.push(row);sectionCounts[section.sectionId]++;
 }
 const selectedIds=new Set(selectedStudents.map(row=>row.id)),indexes=identityIndexes(identity),
  selectedTeachers=allTeachers.filter(row=>teacherUidForRow(row,indexes)===operator.teacherUid),
  filteredIdentity=filteredIdentityReport(identity,selectedIds,operator.teacherUid),
  plan=buildFoundationPlan({
   identity:filteredIdentity,
   rows:{students:selectedStudents,teachers:selectedTeachers,assessments:[]},
   reconciliationSha256:sha(reconciliationRaw),identitySha256:sha(identityRaw)
  }),
  expected=defaults.rosterReference?.pilotSectionCounts||{},countReview=[];
 for(const section of activeSections){
  const observed=sectionCounts[section.sectionId]||0,reference=Number(expected[section.sectionId]);
  if(Number.isFinite(reference)&&observed!==reference)
   countReview.push({type:"pilot_roster_count_review",sectionId:section.sectionId,
    sectionName:section.name,referenceCount:reference,observedLegacyRows:observed,
    note:"Protected roster counts are a cross-check, not authoritative enrollment. Review the difference before approval."});
 }
 plan.reviewItems.push(...countReview);
 plan.pilotScope={
  schema:"adminerva-v4-mcs-shs-pilot-plan-scope-v1",productionAuthorized:false,
  compatibilityMode:"legacy_allowed",teacherUid:operator.teacherUid,
  academicYear:operator.academicYear,activeSectionIds:[...operator.activeSectionIds],
  pendingSectionIds:[...(operator.pendingSectionIds||[])],
  deferredHistory:true
 };
 plan.summary={...plan.summary,pilotStudentRows:selectedStudents.length,
  pilotTeacherRows:selectedTeachers.length,pilotSectionCounts:sectionCounts,
  rosterCountReviews:countReview.length};
 plan.nextRequiredReview=[
  "Resolve every selected student identity blocker; unrelated MCS sections are intentionally outside this plan.",
  "Review any protected-roster count difference without treating the spreadsheet as authoritative enrollment.",
  "Approve the designated pilot teacher as Teacher while preserving any separately granted School Admin role.",
  "Use the pilot approval template to define the Senior High program, academic year, two semesters, four Computer Programming subjects and active-section offerings.",
  "Do not migrate historical assessments, evidence, grades, planning or Practice as part of this limited pilot."
 ];
 return plan;
}
async function main(){
 const args=process.argv.slice(2),recon=read(arg(args,"reconciliation"),"Reconciliation"),
  identity=read(arg(args,"identity"),"Identity report"),operator=read(arg(args,"operator"),"Operator file"),
  defaults=JSON.parse(readFileSync(DEFAULTS_PATH,"utf8")),output=arg(args,"output");
 if(!getApps().length)initializeApp({credential:applicationDefault()});
 const plan=await generate(getFirestore(),{identity:identity.data,reconciliation:recon.data,
  operator:operator.data,defaults,reconciliationRaw:recon.raw,identityRaw:identity.raw});
 writeFileSync(output,JSON.stringify(plan,null,2)+"\n",{flag:"wx",mode:0o600});
 console.info(JSON.stringify({pilotFoundationPlanCreated:true,schoolId:SCHOOL_ID,
  summary:plan.summary,productionAuthorized:false}));
}
if(require.main===module)main().catch(error=>{
 console.error("MCS SHS pilot foundation planning failed:",error.code||error.message);process.exitCode=1;
});
module.exports={validateOperator,sectionTokens,matchSection,filteredIdentityReport,generate};
