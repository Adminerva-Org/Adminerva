"use strict";
/**
 * Adminerva 4.0 offering-scoped teacher academic analytics.
 *
 * Authorization boundary is a canonical course offering, never a legacy section
 * string. Teachers may inspect only actively assigned offerings. School admins
 * may inspect published class results, but never another teacher's private drafts.
 */
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");
const {rowKey,checkId}=require("./school-academics.js");

function deny(code,message){throw new TenantAccessError(code,message)}
const millis=value=>value?.toMillis?.()||null;
function validNumber(value){return Number.isFinite(Number(value));}
function createSchoolTeacherAnalyticsService({db}){
 return async request=>{
  const input=request.data||{};
  const ctx=await getSchoolContext({db,request,schoolId:input.schoolId,roles:["teacher","school_admin"]});
  const prefix="schools/"+ctx.schoolId+"/";
  const isTeacher=ctx.roles.includes("teacher"),isAdmin=ctx.roles.includes("school_admin");
  const schoolRef=db.doc("platform_schools/"+ctx.schoolId);
  const memberRef=db.doc(prefix+"memberships/"+ctx.uid);

  async function authority(){
   const [school,member]=await Promise.all([schoolRef.get(),memberRef.get()]);
   if(!school.exists||school.data().state!=="active"||!member.exists||
      member.data().schoolId!==ctx.schoolId||member.data().status!=="active")
    deny("permission-denied","Your school access changed. Refresh before continuing.");
   const roles=Array.isArray(member.data().roles)?member.data().roles:[];
   if(!roles.some(role=>["teacher","school_admin"].includes(role)))
    deny("permission-denied","Class analytics requires active teaching or school administration access.");
   return roles;
  }
  async function offeringAccess(offeringId){
   await authority();
   const offering=await db.doc(prefix+"course_offerings/"+offeringId).get();
   if(!offering.exists||offering.data().schoolId!==ctx.schoolId||
      offering.data().status!=="active")
    deny("not-found","This course offering is not active in the selected school.");
   if(!isAdmin){
    const grant=await db.doc(prefix+"staff_assignments/"+rowKey(ctx.uid,offeringId)).get();
    if(!grant.exists||grant.data().schoolId!==ctx.schoolId||
       grant.data().teacherUid!==ctx.uid||grant.data().offeringId!==offeringId||
       grant.data().status!=="active")
     deny("permission-denied","You are not currently assigned to this course offering.");
   }
   return offering;
  }
  async function labels(offering){
   const data=offering.data();
   const refs=[
    ["academic_programs",data.programId],["academic_years",data.yearId],
    ["terms",data.termId],["subjects",data.subjectId],["sections",data.sectionId]
   ];
   const docs=await Promise.all(refs.map(([kind,id])=>db.doc(prefix+kind+"/"+id).get()));
   const value=index=>docs[index].exists&&docs[index].data().schoolId===ctx.schoolId?
    String(docs[index].data().name||refs[index][1]).slice(0,140):refs[index][1];
   return {program:value(0),year:value(1),term:value(2),subject:value(3),section:value(4)};
  }

  if((input.action||"scope")==="scope"){
   await authority();
   const offerings=await db.collection(prefix+"course_offerings").limit(501).get();
   if(offerings.size===501)deny("resource-exhausted","Course offerings require pagination before analytics can continue.");
   let allowedIds=null;
   if(!isAdmin){
    const grants=await db.collection(prefix+"staff_assignments")
      .where("teacherUid","==",ctx.uid).limit(201).get();
    if(grants.size===201)deny("resource-exhausted","Teaching assignments require pagination.");
    allowedIds=new Set(grants.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&
      doc.data().status==="active").map(doc=>doc.data().offeringId));
   }
   const rows=offerings.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&
     doc.data().status==="active"&&(isAdmin||allowedIds.has(doc.id)));
   const result=[];
   for(const offering of rows){
    result.push({
     offeringId:offering.id,programId:offering.data().programId,
     sectionId:offering.data().sectionId,subjectId:offering.data().subjectId,...await labels(offering)
    });
   }
   result.sort((a,b)=>(a.section+" "+a.subject).localeCompare(b.section+" "+b.subject));
   return {schoolId:ctx.schoolId,offerings:result};
  }

  if(input.action==="class"){
   const offeringId=checkId(input.offeringId,"Course offering ID",330);
   const includeDrafts=input.includeDrafts===true;
   const offering=await offeringAccess(offeringId),offeringLabels=await labels(offering);
   if(includeDrafts&&!isTeacher)
    deny("permission-denied","Private teacher drafts are unavailable to school-administrator-only accounts.");

   const [enrollments,assessmentSnap,gradeSnap,studioSnap,generalSnap,githubSnap,planSnap,classRecordDoc]=await Promise.all([
    db.collection(prefix+"enrollments").where("offeringId","==",offeringId).limit(501).get(),
    db.collection(prefix+"assessments").where("offeringId","==",offeringId).limit(201).get(),
    db.collection(prefix+"student_grades").where("offeringId","==",offeringId).limit(1001).get(),
    db.collection(prefix+"studio_submissions").where("offeringId","==",offeringId).limit(1001).get(),
    db.collection(prefix+"assessment_submissions").where("offeringId","==",offeringId).limit(1001).get(),
    db.collection(prefix+"github_evidence").where("offeringId","==",offeringId).limit(1001).get(),
    isTeacher?db.collection("staff_workspaces/"+ctx.uid+"/lesson_plans")
      .where("offering_id","==",offeringId).limit(51).get():Promise.resolve(null),
    isTeacher?db.doc(prefix+"class_records/"+offeringId).get():Promise.resolve(null)
   ]);
   if(enrollments.size===501||assessmentSnap.size===201||gradeSnap.size===1001||
      studioSnap.size===1001||generalSnap.size===1001||githubSnap.size===1001||planSnap?.size===51)
    deny("resource-exhausted","This class exceeds the current analytics page limits.");

   const activeEnrollments=enrollments.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&
     doc.data().status==="active");
   const personIds=[...new Set(activeEnrollments.map(doc=>doc.data().personId).filter(Boolean))];
   const people=await Promise.all(personIds.map(personId=>db.doc(prefix+"people/"+personId).get()));
   const personMap=new Map();
   people.forEach((doc,index)=>{
    if(doc.exists&&doc.data().schoolId===ctx.schoolId&&doc.data().kind==="student"&&
       doc.data().status==="active")
     personMap.set(personIds[index],{
      personId:personIds[index],uid:typeof doc.data().authUid==="string"?doc.data().authUid:null,
      displayName:String(doc.data().displayName||"Student").slice(0,140)
     });
   });

   // Teachers see analytics only for their own deployed tasks. School admins may
   // aggregate all deployed tasks but see published grades only.
   const tasks=assessmentSnap.docs.filter(doc=>{
    const data=doc.data();
    return data.schoolId===ctx.schoolId&&data.status==="deployed"&&
      (isAdmin||(data.reviewerUid||data.ownerUid)===ctx.uid);
   }).map(doc=>({taskId:doc.id,title:String(doc.data().title||"Assessment").slice(0,180),
     ownerUid:doc.data().ownerUid,reviewerUid:doc.data().reviewerUid||doc.data().ownerUid,
     rubricMax:Number(doc.data().rubricMax)||0,
     submissionSource:doc.data().submissionSource||"",dueAt:millis(doc.data().dueAt)}));
   const taskMap=new Map(tasks.map(task=>[task.taskId,task]));
   const classRecordLinks=new Map();
   if(isTeacher&&classRecordDoc?.exists&&classRecordDoc.data().schoolId===ctx.schoolId){
    const columns=Array.isArray(classRecordDoc.data().columns)?classRecordDoc.data().columns:[];
    for(const column of columns){
     if(column.kind!=="assessment"||(column.assessmentSource&&column.assessmentSource!=="school")||!column.taskId)continue;
     const prior=classRecordLinks.get(column.taskId);
     if(prior?.status==="linked")continue;
     classRecordLinks.set(column.taskId,{
      status:column.archived===true?"archived":"linked",
      linked:column.archived!==true,archived:column.archived===true,
      columnId:String(column.columnId||"").slice(0,64),
      label:String(column.label||"Assessment").slice(0,80),
      category:String(column.category||"").slice(0,60),
      studentVisibility:column.studentVisibility==="released"?"released":"hidden"
     });
    }
   }
   const rosterUids=new Set([...personMap.values()].map(person=>person.uid).filter(Boolean));
   const submissionRows=[];
   const addSubmissions=(snapshot,source)=>{
    for(const doc of snapshot.docs){
     const data=doc.data(),task=taskMap.get(data.taskId);
     if(!task||task.submissionSource!==source||data.schoolId!==ctx.schoolId||
        data.offeringId!==offeringId||!rosterUids.has(data.studentUid))continue;
     submissionRows.push({
      taskId:data.taskId,studentUid:data.studentUid,status:String(data.status||"submitted"),source
     });
    }
   };
   addSubmissions(studioSnap,"studio");
   addSubmissions(generalSnap,"text");
   addSubmissions(generalSnap,"link");
   addSubmissions(githubSnap,"github");
   const grades=[];
   for(const doc of gradeSnap.docs){
    const data=doc.data(),task=taskMap.get(data.taskId);
    if(!task||data.schoolId!==ctx.schoolId||!rosterUids.has(data.studentUid))continue;
    const ownDraft=isTeacher&&task.reviewerUid===ctx.uid&&data.reviewerUid===ctx.uid&&data.status==="draft";
    if(data.status!=="published"&&!(includeDrafts&&ownDraft))continue;
    const awarded=Number(data.awarded),total=Number(data.total);
    if(!Number.isFinite(awarded)||!Number.isFinite(total)||total<=0)continue;
    grades.push({
     gradeId:doc.id,taskId:data.taskId,studentUid:data.studentUid,
     personId:data.personId||null,status:data.status,
     awarded,total,percentage:Math.max(0,Math.min(100,awarded/total*100)),
     revision:Number(data.revision)||1,publishedAt:millis(data.publishedAt),
     updatedAt:millis(data.updatedAt)
    });
   }

   const byStudent=new Map();
   for(const person of personMap.values()){
    byStudent.set(person.uid||"person:"+person.personId,{
     personId:person.personId,studentUid:person.uid,displayName:person.displayName,
     publishedGrades:0,draftGrades:0,averagePercentage:null,sum:0,count:0
    });
   }
   for(const grade of grades){
    const row=byStudent.get(grade.studentUid);if(!row)continue;
    if(grade.status==="published")row.publishedGrades++;else row.draftGrades++;
    row.sum+=grade.percentage;row.count++;
   }
   const students=[...byStudent.values()].map(row=>({
    personId:row.personId,studentUid:row.studentUid,displayName:row.displayName,
    publishedGrades:row.publishedGrades,draftGrades:row.draftGrades,
    averagePercentage:row.count?Math.round(row.sum/row.count*10)/10:null
   })).sort((a,b)=>a.displayName.localeCompare(b.displayName));

   const assessments=tasks.map(task=>{
    const rows=grades.filter(grade=>grade.taskId===task.taskId),
     published=rows.filter(grade=>grade.status==="published"),
     visible=includeDrafts&&isTeacher?rows:published,
     submissions=submissionRows.filter(row=>row.taskId===task.taskId),
     submittedStudents=new Set(submissions.map(row=>row.studentUid)),
     revisionStudents=new Set(submissions.filter(row=>row.status==="reopened").map(row=>row.studentUid)),
     completedSubmissionStudents=new Set(submissions.filter(row=>row.status!=="reopened").map(row=>row.studentUid)),
     anyGradeStudents=new Set(rows.map(row=>row.studentUid)),
     draftGradeStudents=new Set(rows.filter(row=>row.status==="draft").map(row=>row.studentUid)),
     publishedGradeStudents=new Set(published.map(row=>row.studentUid)),
     awaitingGrade=[...completedSubmissionStudents].filter(uid=>!anyGradeStudents.has(uid)).length;
    return {
     taskId:task.taskId,title:task.title,submissionSource:task.submissionSource,
     dueAt:task.dueAt,rubricMax:task.rubricMax,
     rosterStudents:rosterUids.size,
     submittedStudents:submittedStudents.size,
     revisionRequested:revisionStudents.size,
     notSubmitted:Math.max(0,rosterUids.size-submittedStudents.size),
     awaitingGrade,
     draftGrades:draftGradeStudents.size,
     publishedGrades:publishedGradeStudents.size,
     visibleGrades:visible.length,
     classRecord:classRecordLinks.get(task.taskId)||{
      status:"unlinked",linked:false,archived:false,columnId:null,label:null,category:"",studentVisibility:"hidden"
     },
     averagePercentage:visible.length?
      Math.round(visible.reduce((sum,row)=>sum+row.percentage,0)/visible.length*10)/10:null
    };
   }).sort((a,b)=>(a.dueAt||0)-(b.dueAt||0));

   const preparation=isTeacher&&planSnap?planSnap.docs.map(doc=>({id:doc.id,...doc.data()}))
    .filter(plan=>!plan.is_archived&&plan.school_id===ctx.schoolId&&plan.offering_id===offeringId)
    .map(plan=>({
     planId:plan.id,subject:String(plan.subject_title||offeringLabels.subject||"Lesson plan").slice(0,180),
     gradeLevel:String(plan.grade_level||"").slice(0,80),
     academicTerm:String(plan.academic_term||"").slice(0,160),
     courseWeek:String(plan.course_week||"").slice(0,80),
     dateRange:String(plan.date_range||"").slice(0,180),
     version:Number(plan.version)||1,
     updatedAt:typeof plan.timestamp==="string"?plan.timestamp:""
    }))
    .sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0,12):[];
   const published=grades.filter(grade=>grade.status==="published");
   const visible=includeDrafts&&isTeacher?grades:published;
   const classworkSummary=assessments.reduce((sum,row)=>({
    notSubmitted:sum.notSubmitted+row.notSubmitted,
    revisionRequested:sum.revisionRequested+row.revisionRequested,
    awaitingGrade:sum.awaitingGrade+row.awaitingGrade,
    draftGrades:sum.draftGrades+row.draftGrades,
    publishedGrades:sum.publishedGrades+row.publishedGrades
   }),{notSubmitted:0,revisionRequested:0,awaitingGrade:0,draftGrades:0,publishedGrades:0});
   return {
    schoolId:ctx.schoolId,offeringId,offering:offeringLabels,
    scope:includeDrafts&&isTeacher?"published_and_my_drafts":"published",
    summary:{
     students:students.length,studentsWithAccounts:rosterUids.size,assessments:tasks.length,
     publishedGrades:published.length,
     visibleGrades:visible.length,
     averagePercentage:visible.length?
      Math.round(visible.reduce((sum,row)=>sum+row.percentage,0)/visible.length*10)/10:null,
     studentsWithPublishedGrade:new Set(published.map(row=>row.studentUid)).size,
     classwork:classworkSummary
    },
    assessments,students,preparation,
    note:"Not submitted counts only active enrolled students with linked accounts. Revision requests are tracked separately. Missing grades are excluded from averages and are not treated as zero. Repository commit counts are not used as mastery or effort metrics."
   };
  }
  deny("invalid-argument","Unknown school teacher analytics operation.");
 };
}
module.exports={createSchoolTeacherAnalyticsService};
