"use strict";
const {createHash}=require("node:crypto");
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");
const {checkId}=require("./school-academics.js");
const MAX_CLASSES=100,MAX_COLUMNS=80,SCHOOL_SOURCE="school",LEGACY_PERSONALIZED_SOURCE="legacy_personalized",LEGACY_BRIDGE_SCHOOL="mcs-manila";
const CELL_STATUSES=new Set(["normal","incomplete","exempt","not_applicable"]);
const hash=(...values)=>createHash("sha256").update(JSON.stringify(values)).digest("hex");
function deny(code,message){throw new TenantAccessError(code,message)}
function millis(value){if(!value)return null;if(typeof value.toMillis==="function")return value.toMillis();const n=Number(value);return Number.isFinite(n)?n:null}
function email(value){const clean=String(value||"").trim().toLowerCase();return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)?clean:""}
function status(value){const clean=String(value||"normal").toLowerCase();return CELL_STATUSES.has(clean)?clean:"normal"}
function createSchoolStudentClassRecordService({db,resolveUsers=null}){
 return async request=>{
  const input=request.data||{};
  if((input.action||"my_scores")!=="my_scores")deny("invalid-argument","Unknown student Class Record operation.");
  const ctx=await getSchoolContext({db,request,schoolId:input.schoolId,roles:["student"]}),prefix="schools/"+ctx.schoolId+"/";
  const [school,member]=await Promise.all([db.doc("platform_schools/"+ctx.schoolId).get(),db.doc(prefix+"memberships/"+ctx.uid).get()]);
  if(!school.exists||!["active","pilot"].includes(school.data().state)||!member.exists||member.data().schoolId!==ctx.schoolId||
     member.data().status!=="active"||!member.data().roles?.includes("student"))deny("permission-denied","Your school student access changed.");
  const personId=checkId(String(member.data().personId||""),"Person ID",128),person=await db.doc(prefix+"people/"+personId).get();
  if(!person.exists||person.data().schoolId!==ctx.schoolId||person.data().kind!=="student"||person.data().status!=="active"||
     person.data().authUid!==ctx.uid)deny("permission-denied","Your linked student record is unavailable.");
  const enrollments=await db.collection(prefix+"enrollments").where("personId","==",personId).limit(MAX_CLASSES+1).get();
  if(enrollments.size>MAX_CLASSES)deny("resource-exhausted","Your active class list requires pagination.");
  const ids=[...new Set(enrollments.docs.filter(d=>d.data().schoolId===ctx.schoolId&&d.data().status==="active").map(d=>d.data().offeringId))];
  const offeringDocs=await Promise.all(ids.map(id=>db.doc(prefix+"course_offerings/"+checkId(id,"Course offering ID",330)).get()));
  const offerings=offeringDocs.filter(d=>d.exists&&d.data().schoolId===ctx.schoolId&&d.data().status==="active").map(d=>({offeringId:d.id,...d.data()}));
  async function names(o){
   const docs=await Promise.all([["academic_years",o.yearId],["terms",o.termId],["subjects",o.subjectId],["sections",o.sectionId]]
    .map(([c,id])=>db.doc(prefix+c+"/"+checkId(id,c+" ID",80)).get()));
   const n=d=>d.exists&&d.data().schoolId===ctx.schoolId?String(d.data().name||""):"";
   return {yearName:n(docs[0]),termName:n(docs[1]),subjectName:n(docs[2]),sectionName:n(docs[3])};
  }
  async function legacy(sectionName,taskIds){
   const map=new Map();if(!taskIds.size||ctx.schoolId!==LEGACY_BRIDGE_SCHOOL||typeof resolveUsers!=="function"||school.data().compatibilityMode==="v4_only")return map;
   let users=[];try{users=await resolveUsers([ctx.uid]);}catch{return map}
   const own=email(users?.[0]?.email);if(!own||!sectionName)return map;
   const students=await db.collection("students").where("section","==",sectionName).limit(201).get();
   if(students.size===201)deny("resource-exhausted","Legacy student lookup requires pagination.");
   const student=students.docs.find(d=>email(d.data().email)===own);if(!student)return map;
   const grades=await db.collection("student_grades").where("studentId","==",student.id).limit(201).get();
   if(grades.size===201)deny("resource-exhausted","Legacy grade history requires pagination.");
   for(const d of grades.docs){const x=d.data();if(x.published!==true||!taskIds.has(x.taskId))continue;
    const score=Number(x.score),total=Number(x.maxScore);if(!Number.isFinite(score)||!Number.isFinite(total)||total<=0)continue;
    const candidate={score,total,revision:Number(x.gradeVersion)||1,publishedAt:millis(x.publishedAt)||millis(x.updatedAt)||0},prior=map.get(x.taskId);
    if(!prior||candidate.revision>prior.revision||(candidate.revision===prior.revision&&candidate.publishedAt>prior.publishedAt))map.set(x.taskId,candidate);
   }return map;
  }
  const classes=[];
  for(const o of offerings){
   const offeringId=o.offeringId,[label,sheet,finalization]=await Promise.all([names(o),db.doc(prefix+"class_records/"+offeringId).get(),db.doc(prefix+"class_record_finalizations/"+offeringId).get()]);
   const cols=(sheet.exists&&sheet.data().schoolId===ctx.schoolId&&Array.isArray(sheet.data().columns)?sheet.data().columns:[])
    .filter(c=>c.archived!==true&&c.studentVisibility==="released").slice(0,MAX_COLUMNS);
   const states=await Promise.all(cols.map(c=>db.doc(prefix+"class_record_cell_states/"+hash(offeringId,c.columnId,personId)).get()));
   const manuals=await Promise.all(cols.map(c=>c.kind==="manual"?db.doc(prefix+"class_record_scores/"+hash(offeringId,c.columnId,personId)).get():Promise.resolve(null)));
   const schoolGrades=await Promise.all(cols.map(c=>c.kind==="assessment"&&(c.assessmentSource||SCHOOL_SOURCE)===SCHOOL_SOURCE?
    db.doc(prefix+"student_grades/"+hash(c.taskId,ctx.uid)).get():Promise.resolve(null)));
   const legacyIds=new Set(cols.filter(c=>c.kind==="assessment"&&c.assessmentSource===LEGACY_PERSONALIZED_SOURCE).map(c=>c.taskId));
   const legacyGrades=await legacy(label.sectionName,legacyIds);
   const scores=cols.map((c,i)=>{const s=states[i]?.exists&&states[i].data().schoolId===ctx.schoolId?status(states[i].data().status):"normal";
    let score=null,sourceType=c.kind==="manual"?"manual":(c.assessmentSource||SCHOOL_SOURCE);
    if(s==="normal"&&c.kind==="manual"){const d=manuals[i]?.exists?manuals[i].data():null;if(d&&d.schoolId===ctx.schoolId&&d.personId===personId&&d.score!==null&&Number.isFinite(Number(d.score)))score=Number(d.score);}
    else if(s==="normal"&&sourceType===SCHOOL_SOURCE){const d=schoolGrades[i]?.exists?schoolGrades[i].data():null;if(d&&d.schoolId===ctx.schoolId&&d.offeringId===offeringId&&d.personId===personId&&d.studentUid===ctx.uid&&d.status==="published"&&Number.isFinite(Number(d.awarded)))score=Number(d.awarded);}
    else if(s==="normal"){const d=legacyGrades.get(c.taskId);if(d)score=Number(d.score);}
    return {columnId:c.columnId,label:String(c.label||"Activity"),category:String(c.category||""),kind:c.kind,sourceType,maxPoints:Number(c.maxPoints)||0,status:s,score:Number.isFinite(score)?score:null};
   });
   let finalGrade=null;const releasedRevision=finalization.exists&&finalization.data().schoolId===ctx.schoolId?Number(finalization.data().releasedRevision)||0:0;
   if(releasedRevision>0){const g=await db.doc(prefix+"class_record_period_grades/"+hash(offeringId,personId)+"/revisions/"+releasedRevision).get(),d=g.exists?g.data():null;
    if(d&&d.schoolId===ctx.schoolId&&d.personId===personId&&Number(d.finalizationRevision)===releasedRevision&&Number.isFinite(Number(d.finalGrade)))
     finalGrade={revision:releasedRevision,finalGrade:Math.round(Number(d.finalGrade)),releasedAt:millis(finalization.data().releasedAt)};
   }
   classes.push({offeringId,...label,scores,finalGrade});
  }
  classes.sort((a,b)=>(a.subjectName+" "+a.sectionName+" "+a.termName).localeCompare(b.subjectName+" "+b.sectionName+" "+b.termName));
  return {schoolId:ctx.schoolId,displayName:String(person.data().displayName||"Student"),classes};
 };
}
module.exports={createSchoolStudentClassRecordService};
