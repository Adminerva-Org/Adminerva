"use strict";
/**
 * School-scoped Class Record.
 *
 * Class Record is a consolidation layer, not another grading engine:
 * - manual columns are entered here;
 * - school assessment columns project only published V4 Gradebook results;
 * - the MCS compatibility bridge can project published legacy/schema-v3
 *   Personalized Studio grades while that legacy assessment system is active.
 *
 * Linked grades are corrected/published in their owning grading workflow.
 */
const {FieldValue}=require("firebase-admin/firestore");
const {createHash}=require("node:crypto");
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");
const {rowKey,checkId}=require("./school-academics.js");

const MAX_COLUMNS=80;
const MAX_CLASS_SIZE=100;
const MAX_SCORE=10000;
const MAX_CATEGORIES=20;
const MAX_SCORE_CELLS=MAX_COLUMNS*MAX_CLASS_SIZE;
const LEGACY_BRIDGE_SCHOOL="mcs-manila";
const SCHOOL_SOURCE="school";
const LEGACY_PERSONALIZED_SOURCE="legacy_personalized";
const hash=(...values)=>createHash("sha256").update(JSON.stringify(values)).digest("hex");

function deny(code,message){throw new TenantAccessError(code,message)}
function text(value,label,max){
  const clean=String(value||"").trim();
  if(!clean||clean.length>max)
    deny("invalid-argument",label+" is required and cannot exceed "+max+" characters.");
  return clean;
}
function optionalText(value,max){
  const clean=String(value||"").trim();
  if(clean.length>max)deny("invalid-argument","Category cannot exceed "+max+" characters.");
  return clean;
}
function normalizeEmail(value){
  const email=String(value||"").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:"";
}
function millis(value){
  if(!value)return null;
  if(typeof value.toMillis==="function")return value.toMillis();
  if(value instanceof Date)return value.getTime();
  const numeric=Number(value);
  return Number.isFinite(numeric)?numeric:null;
}
function rubricTotal(task){
  const rubric=Array.isArray(task?.rubric)?task.rubric:[];
  const total=rubric.reduce((sum,item)=>sum+Number(item?.points||0),0);
  return Number.isFinite(total)&&total>0?total:0;
}
function assessmentKey(sourceType,taskId){
  return (sourceType||SCHOOL_SOURCE)+":"+taskId;
}
function sourceKey(column){
  return column.kind==="assessment"
    ?"assessment:"+assessmentKey(column.assessmentSource||SCHOOL_SOURCE,column.taskId)
    :"manual:"+String(column.maxPoints);
}
function cleanSettings(raw={}){
  const input=raw&&typeof raw==="object"&&!Array.isArray(raw)?raw:{};
  const gradeComputation=["raw_weighted","deped_60_100"].includes(input.gradeComputation)
    ?input.gradeComputation:"raw_weighted";
  const incoming=Array.isArray(input.categoryWeights)?input.categoryWeights:[];
  if(incoming.length>MAX_CATEGORIES)
    deny("invalid-argument","Class Record supports up to "+MAX_CATEGORIES+" weighted categories.");
  const seen=new Set(),categoryWeights=[];
  let total=0;
  for(const row of incoming){
    const category=text(row?.category,"Category",60);
    const key=category.toLocaleLowerCase("en");
    if(seen.has(key))deny("invalid-argument","Each grading category may appear only once.");
    seen.add(key);
    const weight=Number(row?.weight);
    if(!Number.isFinite(weight)||weight<0||weight>100)
      deny("invalid-argument","Category weights must be between 0 and 100 percent.");
    total+=weight;
    categoryWeights.push({category,weight:Math.round(weight*1000)/1000});
  }
  if(total>100.0001)
    deny("invalid-argument","Category weights cannot total more than 100 percent.");
  let appliedSchemeId=null,appliedSchemeRevision=null,appliedSchemeName="";
  if(input.appliedSchemeId!==undefined&&input.appliedSchemeId!==null&&input.appliedSchemeId!==""){
    appliedSchemeId=checkId(String(input.appliedSchemeId),"Applied grading scheme ID",80);
    appliedSchemeRevision=Number(input.appliedSchemeRevision);
    if(!Number.isInteger(appliedSchemeRevision)||appliedSchemeRevision<1)
      deny("invalid-argument","Applied grading scheme revision is invalid.");
    appliedSchemeName=String(input.appliedSchemeName||"").trim();
    if(!appliedSchemeName||appliedSchemeName.length>120)
      deny("invalid-argument","Applied grading scheme name is invalid.");
  }
  return {categoryWeights,gradeComputation,appliedSchemeId,appliedSchemeRevision,appliedSchemeName};
}
function settingsCoreKey(settings){
  return JSON.stringify({
    gradeComputation:settings.gradeComputation,
    categoryWeights:[...(settings.categoryWeights||[])].map(row=>({
      category:String(row.category||"").toLocaleLowerCase("en"),
      weight:Number(row.weight)||0
    })).sort((a,b)=>a.category.localeCompare(b.category))
  });
}
function roundGrade(value){
  return Math.round((Number(value)+Number.EPSILON)*10000)/10000;
}
function finalizationSourceDigest({columns,settings,roster,manualScores,publishedGrades}){
  const activeColumns=(columns||[]).filter(column=>column.archived!==true);
  const active=activeColumns.map(column=>({
    columnId:column.columnId,label:column.label,category:column.category||"",kind:column.kind,
    maxPoints:Number(column.maxPoints)||0,taskId:column.taskId||"",
    assessmentSource:column.assessmentSource||"",sourceTitle:column.sourceTitle||""
  }));
  const manualIds=new Set(activeColumns.filter(column=>column.kind==="manual").map(column=>column.columnId));
  const linkedKeys=new Set(activeColumns.filter(column=>column.kind==="assessment").map(column=>
    (column.assessmentSource||SCHOOL_SOURCE)+"::"+column.taskId));
  const rosterIds=new Set((roster||[]).map(row=>row.personId));
  const manual=[...(manualScores||[])].filter(row=>
    manualIds.has(row.columnId)&&rosterIds.has(row.personId)).map(row=>({
      columnId:row.columnId,personId:row.personId,score:row.score===null?null:Number(row.score),
      revision:Number(row.revision)||0
    })).sort((a,b)=>(a.columnId+"|"+a.personId).localeCompare(b.columnId+"|"+b.personId));
  const grades=[...(publishedGrades||[])].filter(row=>
    linkedKeys.has((row.sourceType||SCHOOL_SOURCE)+"::"+row.taskId)&&rosterIds.has(row.personId)).map(row=>({
      sourceType:row.sourceType||SCHOOL_SOURCE,taskId:row.taskId,personId:row.personId,
      awarded:Number(row.awarded),total:Number(row.total),revision:Number(row.revision)||0,
      publishedAt:Number(row.publishedAt)||0
    })).sort((a,b)=>(a.sourceType+"|"+a.taskId+"|"+a.personId)
      .localeCompare(b.sourceType+"|"+b.taskId+"|"+b.personId));
  return createHash("sha256").update(JSON.stringify({
    columns:active,settings:settingsCoreKey(settings),
    roster:[...rosterIds].sort(),manual,grades
  })).digest("hex");
}
function computePeriodSnapshot({columns,settings,roster,manualScores,publishedGrades}){
  const active=(columns||[]).filter(column=>column.archived!==true);
  const blockers=[];let blockerCount=0;
  const block=(type,message,extra={})=>{
    blockerCount++;
    if(blockers.length<30)blockers.push({type,message,...extra});
  };
  const categories=[],categoryKeys=new Set();
  for(const column of active){
    const category=String(column.category||"").trim(),key=category.toLocaleLowerCase("en");
    if(!category){block("uncategorized_column",column.label+" has no grading category.",{columnId:column.columnId});continue;}
    if(!categoryKeys.has(key)){categoryKeys.add(key);categories.push(category);}
  }
  if(!active.length)block("no_active_columns","Add or restore at least one active Class Record column.");
  const weights=new Map((settings.categoryWeights||[]).map(row=>[
    String(row.category||"").toLocaleLowerCase("en"),Number(row.weight)||0
  ]));
  let activeWeightTotal=0;
  for(const category of categories){
    const key=category.toLocaleLowerCase("en");
    if(!weights.has(key))block("missing_category_weight","No weight is configured for "+category+".",{category});
    activeWeightTotal+=weights.get(key)||0;
  }
  if(categories.length&&Math.abs(activeWeightTotal-100)>0.001)
    block("invalid_weight_total","Active category weights total "+roundGrade(activeWeightTotal)+"%, not 100%.");
  const manualMap=new Map((manualScores||[]).map(row=>[row.columnId+"::"+row.personId,row]));
  const gradeMap=new Map((publishedGrades||[]).map(row=>[
    (row.sourceType||SCHOOL_SOURCE)+"::"+row.taskId+"::"+row.personId,row
  ]));
  const grades=[];
  for(const student of roster||[]){
    const byCategory=new Map(categories.map(category=>[category,{earned:0,max:0,complete:true}]));
    let studentReady=true;
    for(const column of active){
      const category=String(column.category||"").trim();
      if(!category){studentReady=false;continue;}
      const bucket=byCategory.get(category)||{earned:0,max:0,complete:true};
      let score=null;
      if(column.kind==="manual"){
        const row=manualMap.get(column.columnId+"::"+student.personId);
        if(row&&row.score!==null&&row.score!==undefined)score=Number(row.score);
      }else{
        const source=column.assessmentSource||SCHOOL_SOURCE;
        const row=gradeMap.get(source+"::"+column.taskId+"::"+student.personId);
        if(row){
          if(Math.abs(Number(row.total)-Number(column.maxPoints))>0.000001){
            block("assessment_max_changed",student.name+" · "+column.label+
              " published maximum no longer matches this Class Record column.",{
                personId:student.personId,columnId:column.columnId
              });
            studentReady=false;bucket.complete=false;bucket.max+=Number(column.maxPoints)||0;
            byCategory.set(category,bucket);continue;
          }
          score=Number(row.awarded);
        }
      }
      bucket.max+=Number(column.maxPoints)||0;
      if(!Number.isFinite(score)){
        block("missing_score",student.name+" · "+column.label+" has no finalized score yet.",{
          personId:student.personId,columnId:column.columnId
        });
        bucket.complete=false;studentReady=false;
      }else if(score<0||score>Number(column.maxPoints)+0.000001){
        block("invalid_score",student.name+" · "+column.label+" is outside its allowed score range.",{
          personId:student.personId,columnId:column.columnId
        });
        bucket.complete=false;studentReady=false;
      }else bucket.earned+=score;
      byCategory.set(category,bucket);
    }
    if(!studentReady)continue;
    let initial=0;const categoryScores=[];let categoryReady=true;
    for(const category of categories){
      const bucket=byCategory.get(category),weight=weights.get(category.toLocaleLowerCase("en"));
      if(!bucket?.complete||!bucket.max||!Number.isFinite(weight)){categoryReady=false;break;}
      const percentage=bucket.earned/bucket.max*100,weightedContribution=percentage*weight/100;
      initial+=weightedContribution;
      categoryScores.push({
        category,earned:roundGrade(bucket.earned),max:roundGrade(bucket.max),
        percentage:roundGrade(percentage),weight:roundGrade(weight),
        weightedContribution:roundGrade(weightedContribution)
      });
    }
    if(!categoryReady)continue;
    initial=roundGrade(initial);
    const period=roundGrade(settings.gradeComputation==="deped_60_100"?60+(initial*0.4):initial);
    grades.push({
      personId:student.personId,name:student.name,
      initialGrade:initial,periodGrade:period,categoryScores
    });
  }
  const sourceDigest=finalizationSourceDigest({columns,settings,roster,manualScores,publishedGrades});
  return {
    ready:blockerCount===0&&grades.length===(roster||[]).length&&grades.length>0,
    blockerCount,blockers,grades,categories,activeColumnCount:active.length,
    sourceDigest
  };
}
function cleanColumns(raw,assessmentMap,previousColumns=[]){
  if(!Array.isArray(raw)||raw.length>MAX_COLUMNS)
    deny("invalid-argument","A class record supports up to "+MAX_COLUMNS+" columns.");
  const ids=new Set(),linkedTasks=new Set(),previousById=new Map(
    (Array.isArray(previousColumns)?previousColumns:[]).map(column=>[
      column.columnId,
      column.kind==="assessment"&&!column.assessmentSource
        ?{...column,assessmentSource:SCHOOL_SOURCE}:column
    ])
  );
  return raw.map((item,index)=>{
    const columnId=checkId(String(item?.columnId||""),"Column ID",64);
    if(ids.has(columnId))deny("invalid-argument","Column IDs must be unique.");
    ids.add(columnId);
    const label=text(item?.label,"Column "+(index+1)+" label",80);
    const category=optionalText(item?.category,60);
    const kind=String(item?.kind||"");
    const archived=item?.archived===true;
    if(!["manual","assessment"].includes(kind))
      deny("invalid-argument","Column "+label+" must be manual or assessment-linked.");
    if(kind==="manual"){
      const maxPoints=Number(item?.maxPoints);
      if(!Number.isFinite(maxPoints)||maxPoints<=0||maxPoints>MAX_SCORE)
        deny("invalid-argument","Manual column "+label+" needs a maximum score above 0 and no more than "+MAX_SCORE+".");
      return {columnId,label,category,kind,maxPoints,archived};
    }
    const taskId=checkId(String(item?.taskId||""),"Assessment task ID",160);
    const assessmentSource=[SCHOOL_SOURCE,LEGACY_PERSONALIZED_SOURCE].includes(item?.assessmentSource)
      ?item.assessmentSource:SCHOOL_SOURCE;
    const unique=assessmentKey(assessmentSource,taskId);
    if(linkedTasks.has(unique))
      deny("invalid-argument","The same assessment cannot be linked to the class record twice.");
    linkedTasks.add(unique);
    const task=assessmentMap.get(unique),previous=previousById.get(columnId);
    const sameHistoricalSource=previous&&previous.kind==="assessment"&&
      assessmentKey(previous.assessmentSource||SCHOOL_SOURCE,previous.taskId)===unique;
    if(!task&&!sameHistoricalSource)
      deny("permission-denied","A new linked assessment must still be available to this teacher.");
    if(task?.linkable===false&&!sameHistoricalSource)
      deny("failed-precondition","This assessment is historical and cannot be linked as a new Class Record column.");
    const maxPoints=Number(sameHistoricalSource?previous?.maxPoints:task?.maxPoints);
    if(!Number.isFinite(maxPoints)||maxPoints<=0)
      deny("failed-precondition","The linked assessment has no gradeable maximum score.");
    const sourceTitle=String(sameHistoricalSource?
      (previous?.sourceTitle||task?.title||label):(task?.title||label)).trim().slice(0,160);
    return {columnId,label,category,kind,taskId,assessmentSource,maxPoints,sourceTitle,archived};
  });
}

function createSchoolClassRecordService({db,resolveUsers=null}){
  return async request=>{
    const input=request.data||{};
    const ctx=await getSchoolContext({db,request,schoolId:input.schoolId});
    const teacher=ctx.roles.includes("teacher"),admin=ctx.roles.includes("school_admin");
    if(!teacher&&!admin)
      deny("permission-denied","Class Record access requires a school teacher or school administrator role.");

    const prefix="schools/"+ctx.schoolId+"/";
    const schoolRef=db.doc("platform_schools/"+ctx.schoolId);
    const membershipRef=db.doc(prefix+"memberships/"+ctx.uid);
    async function verifySchoolAdmin(tx){
      const [school,membership]=await Promise.all([tx.get(schoolRef),tx.get(membershipRef)]);
      if(!school.exists||!["active","pilot"].includes(school.data().state)||!membership.exists||
         membership.data().schoolId!==ctx.schoolId||membership.data().status!=="active"||
         !Array.isArray(membership.data().roles)||!membership.data().roles.includes("school_admin"))
        deny("permission-denied","Your school administration permission changed. Refresh before saving.");
    }
    if(input.action==="list_schemes"){
      const includeArchived=admin&&input.includeArchived===true;
      const snap=await db.collection(prefix+"grading_schemes").limit(51).get();
      if(snap.size===51)deny("resource-exhausted","Grading scheme list requires pagination.");
      return {schemes:snap.docs.map(doc=>({schemeId:doc.id,...doc.data()}))
        .filter(item=>item.schoolId===ctx.schoolId&&(includeArchived||item.status==="active"))
        .map(item=>({
          schemeId:item.schemeId,name:String(item.name||"Grading scheme"),
          description:String(item.description||""),status:item.status||"active",
          revision:Number(item.revision)||1,
          settings:cleanSettings(item.settings||{}),
          updatedAt:millis(item.updatedAt)
        })).sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:"base"}))};
    }
    if(["save_scheme","archive_scheme","restore_scheme"].includes(input.action)){
      if(!admin)deny("permission-denied","School administration is required to manage grading schemes.");
      const schemeId=checkId(String(input.schemeId||""),"Grading scheme ID",80);
      const schemeRef=db.doc(prefix+"grading_schemes/"+schemeId);
      const expectedRevision=Number(input.expectedRevision);
      if(!Number.isInteger(expectedRevision)||expectedRevision<0)
        deny("invalid-argument","Grading scheme revision is invalid.");
      const auditRef=db.collection(prefix+"grading_scheme_audit").doc();
      let result;
      await db.runTransaction(async tx=>{
        await verifySchoolAdmin(tx);
        const current=await tx.get(schemeRef),prior=current.exists?current.data():null;
        const priorRevision=prior?Number(prior.revision)||0:0;
        if(prior&&prior.schoolId!==ctx.schoolId)deny("permission-denied","Grading scheme belongs to another school.");
        if(priorRevision!==expectedRevision)
          deny("failed-precondition","This grading scheme changed. Reload it before saving.");
        const now=FieldValue.serverTimestamp();
        if(input.action==="save_scheme"){
          const name=text(input.name,"Grading scheme name",120);
          const description=String(input.description||"").trim();
          if(description.length>300)deny("invalid-argument","Grading scheme description cannot exceed 300 characters.");
          const schemeSettings=cleanSettings(input.settings||{});
          const total=schemeSettings.categoryWeights.reduce((sum,row)=>sum+row.weight,0);
          if(!schemeSettings.categoryWeights.length||Math.abs(total-100)>0.001)
            deny("invalid-argument","A school grading scheme must contain category weights totaling exactly 100 percent.");
          const storedSettings={
            categoryWeights:schemeSettings.categoryWeights,
            gradeComputation:schemeSettings.gradeComputation
          };
          const revision=priorRevision+1;
          const values={schoolId:ctx.schoolId,name,description,status:"active",
            settings:storedSettings,revision,updatedByUid:ctx.uid,updatedAt:now};
          if(prior)tx.update(schemeRef,values);
          else tx.create(schemeRef,{...values,createdByUid:ctx.uid,createdAt:now});
          tx.create(auditRef,{schoolId:ctx.schoolId,schemeId,actorUid:ctx.uid,
            action:prior?"grading_scheme_updated":"grading_scheme_created",
            revision,createdAt:now});
          result={schemeId,name,description,status:"active",settings:storedSettings,revision};
        }else{
          if(!prior)deny("not-found","Grading scheme does not exist.");
          const status=input.action==="archive_scheme"?"archived":"active";
          if(prior.status===status){result={schemeId,status,revision:priorRevision};return;}
          const revision=priorRevision+1;
          tx.update(schemeRef,{status,revision,updatedByUid:ctx.uid,updatedAt:now});
          tx.create(auditRef,{schoolId:ctx.schoolId,schemeId,actorUid:ctx.uid,
            action:status==="archived"?"grading_scheme_archived":"grading_scheme_restored",
            revision,createdAt:now});
          result={schemeId,status,revision};
        }
      });
      return result;
    }

    if(!teacher)
      deny("permission-denied","An active teacher assignment is required to open a Class Record.");
    const offeringId=checkId(String(input.offeringId||""),"Course offering ID",330);
    const offeringRef=db.doc(prefix+"course_offerings/"+offeringId);
    const grantRef=db.doc(prefix+"staff_assignments/"+rowKey(ctx.uid,offeringId));
    const sheetRef=db.doc(prefix+"class_records/"+offeringId);

    async function verifyOffering(){
      const [offering,grant]=await Promise.all([offeringRef.get(),grantRef.get()]);
      if(!offering.exists||offering.data().schoolId!==ctx.schoolId)
        deny("not-found","This course offering is unavailable.");
      if(!grant.exists||grant.data().schoolId!==ctx.schoolId||
         grant.data().teacherUid!==ctx.uid||grant.data().offeringId!==offeringId||
         grant.data().status!=="active")
        deny("permission-denied","Only an actively assigned teacher can use this class record.");
      return offering.data();
    }
    async function activeOfferingTeachers(){
      const snap=await db.collection(prefix+"staff_assignments")
        .where("offeringId","==",offeringId).limit(21).get();
      if(snap.size===21)
        deny("resource-exhausted","This offering has more than 20 teacher assignments. Paginated collaborator review is required.");
      const active=snap.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&
        doc.data().offeringId===offeringId&&doc.data().status==="active");
      const memberships=await Promise.all(active.map(doc=>
        db.doc(prefix+"memberships/"+doc.data().teacherUid).get()));
      return active.map((doc,index)=>({
        name:memberships[index].exists&&memberships[index].data().schoolId===ctx.schoolId?
          String(memberships[index].data().displayName||"Teacher"):"Teacher",
        current:doc.data().teacherUid===ctx.uid
      })).sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:"base"}));
    }
    async function offeringLabels(offering){
      const [section,subject]=await Promise.all([
        db.doc(prefix+"sections/"+checkId(offering.sectionId,"Section ID",80)).get(),
        db.doc(prefix+"subjects/"+checkId(offering.subjectId,"Subject ID",80)).get()
      ]);
      return {
        sectionName:section.exists&&section.data().schoolId===ctx.schoolId?String(section.data().name||"").trim():"",
        subjectName:subject.exists&&subject.data().schoolId===ctx.schoolId?String(subject.data().name||"").trim():""
      };
    }
    async function legacyBridgeAllowed(){
      if(ctx.schoolId!==LEGACY_BRIDGE_SCHOOL||typeof resolveUsers!=="function")return false;
      const school=await db.doc("platform_schools/"+ctx.schoolId).get();
      return !school.exists||school.data().compatibilityMode!=="v4_only";
    }
    async function ownedSchoolAssessments(){
      const snap=await db.collection(prefix+"assessments")
        .where("offeringId","==",offeringId).limit(101).get();
      if(snap.size===101)
        deny("resource-exhausted","This class has too many school assessment deployments for the current Class Record view.");
      return snap.docs.filter(doc=>{
        const data=doc.data();
        return data.schoolId===ctx.schoolId&&
          (data.reviewerUid||data.ownerUid)===ctx.uid;
      }).map(doc=>({
        sourceType:SCHOOL_SOURCE,
        taskId:doc.id,
        title:String(doc.data().title||"Untitled assessment"),
        submissionSource:doc.data().submissionSource||"studio",
        lifecycle:doc.data().lifecycle||"active",
        dueAt:millis(doc.data().dueAt),
        maxPoints:rubricTotal(doc.data()),
        categorySuggestion:"",
        published:true,
        linkable:doc.data().status==="deployed"&&doc.data().lifecycle!=="cancelled",
        historical:doc.data().status!=="deployed"||doc.data().lifecycle==="cancelled",
        gradeRoute:"school-gradebook.html?task="+encodeURIComponent(doc.id)
      })).filter(task=>task.maxPoints>0);
    }
    async function ownedLegacyPersonalizedAssessments(sectionName){
      if(!sectionName||!(await legacyBridgeAllowed()))return [];
      const snap=await db.collection("assessments").where("ownerUid","==",ctx.uid).limit(201).get();
      if(snap.size===201)
        deny("resource-exhausted","Your legacy assessment library requires pagination before all Personalized assessments can be shown.");
      return snap.docs.map(doc=>({id:doc.id,...doc.data()})).filter(task=>{
        const assigned=new Set([
          ...(Array.isArray(task.sectionIds)?task.sectionIds:[]),
          ...(Array.isArray(task.deployments)?task.deployments.map(item=>item?.section):[])
        ].filter(value=>typeof value==="string"&&value.trim()));
        return task.schemaVersion===3&&task.submissionSource==="studio"&&
          task.assessmentFormat==="studio_code"&&
          (task.assessmentMode==="personalized"||task.personalizedTask?.enabled===true)&&
          assigned.has(sectionName);
      }).map(task=>({
        sourceType:LEGACY_PERSONALIZED_SOURCE,
        taskId:task.id,
        title:String(task.title||"Untitled Personalized Studio assessment"),
        submissionSource:"studio",
        lifecycle:task.published===false?"unpublished":"active",
        dueAt:null,
        maxPoints:Number(task.maxScore),
        categorySuggestion:String(task.type||"").trim().slice(0,60),
        published:task.published!==false,
        linkable:true,
        historical:false,
        gradeRoute:"gradebook.html?"+new URLSearchParams({section:sectionName,assessment:task.id}).toString(),
        reviewRoute:"studio-submissions.html?"+new URLSearchParams({assessment:task.id,section:sectionName}).toString()
      })).filter(task=>Number.isFinite(task.maxPoints)&&task.maxPoints>0);
    }
    async function availableAssessments(offering,labels){
      const [school,legacy]=await Promise.all([
        ownedSchoolAssessments(),
        ownedLegacyPersonalizedAssessments(labels.sectionName)
      ]);
      return [...school,...legacy].sort((a,b)=>
        a.title.localeCompare(b.title,undefined,{sensitivity:"base"})||
        a.sourceType.localeCompare(b.sourceType));
    }
    async function classRoster(){
      const enrollments=await db.collection(prefix+"enrollments")
        .where("offeringId","==",offeringId).limit(MAX_CLASS_SIZE+1).get();
      if(enrollments.size>MAX_CLASS_SIZE)
        deny("resource-exhausted","This class has more than "+MAX_CLASS_SIZE+" enrollment records. Pagination is required before Class Record can load it.");
      const active=enrollments.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&doc.data().status==="active");
      const people=await Promise.all(active.map(row=>db.doc(prefix+"people/"+row.data().personId).get()));
      const internal=active.map((row,index)=>{
        const person=people[index],data=person.exists&&person.data().schoolId===ctx.schoolId?person.data():null;
        return {
          enrollmentId:row.id,personId:row.data().personId,
          name:data?String(data.displayName||"Student"):"Unlinked student record",
          authUid:data&&typeof data.authUid==="string"?data.authUid:""
        };
      }).sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:"base"}));
      return internal;
    }
    async function legacyStudentPersonMap(roster,sectionName){
      const mapping=new Map();
      if(!sectionName||!(await legacyBridgeAllowed()))return mapping;
      const uids=[...new Set(roster.map(row=>row.authUid).filter(Boolean))];
      if(!uids.length)return mapping;
      let users=[];
      try{users=await resolveUsers(uids);}
      catch{return mapping;}
      const emailToPerson=new Map();
      for(const user of users||[]){
        const email=normalizeEmail(user?.email);
        const row=roster.find(item=>item.authUid===user?.uid);
        if(email&&row)emailToPerson.set(email,row.personId);
      }
      if(!emailToPerson.size)return mapping;
      const legacy=await db.collection("students").where("section","==",sectionName).limit(201).get();
      if(legacy.size===201)
        deny("resource-exhausted","Legacy class identity mapping requires pagination before Personalized grades can be consolidated.");
      for(const doc of legacy.docs){
        const personId=emailToPerson.get(normalizeEmail(doc.data().email));
        if(personId)mapping.set(doc.id,personId);
      }
      return mapping;
    }
    async function legacyPublishedGrades(columns,roster,sectionName,available){
      const linked=columns.filter(column=>column.kind==="assessment"&&
        (column.assessmentSource||SCHOOL_SOURCE)===LEGACY_PERSONALIZED_SOURCE);
      if(!linked.length)return [];
      const studentToPerson=await legacyStudentPersonMap(roster,sectionName);
      if(!studentToPerson.size)return [];
      const taskIds=[...new Set(linked.map(column=>column.taskId))];
      const pages=await Promise.all(taskIds.map(taskId=>
        db.collection("student_grades").where("taskId","==",taskId).limit(201).get()));
      if(pages.some(page=>page.size===201))
        deny("resource-exhausted","A Personalized assessment grade set requires pagination before Class Record can consolidate it.");
      const latest=new Map();
      for(const page of pages)for(const doc of page.docs){
        const data=doc.data();
        if(data.published!==true)continue;
        const personId=studentToPerson.get(data.studentId);
        if(!personId)continue;
        const score=Number(data.score),total=Number(data.maxScore);
        if(!Number.isFinite(score)||!Number.isFinite(total)||total<=0)continue;
        const key=data.taskId+"::"+personId;
        const candidate={
          sourceType:LEGACY_PERSONALIZED_SOURCE,taskId:data.taskId,personId,
          awarded:score,total,revision:Number(data.gradeVersion)||1,
          publishedAt:millis(data.publishedAt)||millis(data.updatedAt)||millis(data.gradedAt)||0
        };
        const prior=latest.get(key);
        if(!prior||candidate.revision>prior.revision||
           (candidate.revision===prior.revision&&candidate.publishedAt>prior.publishedAt))
          latest.set(key,candidate);
      }
      return [...latest.values()];
    }

    async function buildWorkspaceData(){
      const offering=await verifyOffering();
      const labels=await offeringLabels(offering);
      const finalizationRef=db.doc(prefix+"class_record_finalizations/"+offeringId);
      const [roster,assessments,sheet,gradeSnap,manualSnap,finalizationDoc,collaborators]=await Promise.all([
        classRoster(),
        availableAssessments(offering,labels),
        sheetRef.get(),
        db.collection(prefix+"student_grades").where("offeringId","==",offeringId).limit(MAX_SCORE_CELLS+1).get(),
        db.collection(prefix+"class_record_scores").where("offeringId","==",offeringId).limit(MAX_SCORE_CELLS+1).get(),
        finalizationRef.get(),
        activeOfferingTeachers()
      ]);
      if(gradeSnap.size>MAX_SCORE_CELLS)
        deny("resource-exhausted","Published school grade cells exceed the bounded Class Record capacity.");
      if(manualSnap.size>MAX_SCORE_CELLS)
        deny("resource-exhausted","Manual score cells exceed the bounded Class Record capacity.");

      const columns=sheet.exists&&sheet.data().schoolId===ctx.schoolId&&Array.isArray(sheet.data().columns)
        ?sheet.data().columns.map(column=>{
          const normalized=column.kind==="assessment"&&!column.assessmentSource
            ?{...column,assessmentSource:SCHOOL_SOURCE}:column;
          return {...normalized,archived:normalized.archived===true};
        }):[];
      const knownAssessmentKeys=new Set(assessments.map(task=>assessmentKey(task.sourceType,task.taskId)));
      for(const column of columns.filter(item=>item.kind==="assessment")){
        const source=column.assessmentSource||SCHOOL_SOURCE,key=assessmentKey(source,column.taskId);
        if(knownAssessmentKeys.has(key))continue;
        assessments.push({
          sourceType:source,taskId:column.taskId,
          title:String(column.sourceTitle||column.label||"Historical assessment"),
          submissionSource:source===LEGACY_PERSONALIZED_SOURCE?"studio":"unknown",
          lifecycle:"historical",dueAt:null,maxPoints:Number(column.maxPoints)||0,
          categorySuggestion:column.category||"",published:true,linkable:false,historical:true,
          gradeRoute:null,reviewRoute:null
        });
        knownAssessmentKeys.add(key);
      }
      const settings=cleanSettings(sheet.exists&&sheet.data().schoolId===ctx.schoolId?sheet.data().settings:{});
      const schoolTaskIds=new Set(columns.filter(column=>column.kind==="assessment"&&
        (column.assessmentSource||SCHOOL_SOURCE)===SCHOOL_SOURCE).map(column=>column.taskId));
      const personIds=new Set(roster.map(row=>row.personId));
      const schoolGrades=gradeSnap.docs.map(doc=>doc.data()).filter(data=>
        data.schoolId===ctx.schoolId&&data.status==="published"&&
        schoolTaskIds.has(data.taskId)&&personIds.has(data.personId)
      ).map(data=>({
        sourceType:SCHOOL_SOURCE,taskId:data.taskId,personId:data.personId,
        awarded:Number(data.awarded)||0,total:Number(data.total)||0,
        revision:Number(data.revision)||1,publishedAt:millis(data.publishedAt)
      }));
      const legacyGrades=await legacyPublishedGrades(columns,roster,labels.sectionName,assessments);
      const manualIds=new Set(columns.filter(column=>column.kind==="manual").map(column=>column.columnId));
      const manualScores=manualSnap.docs.map(doc=>doc.data()).filter(data=>
        data.schoolId===ctx.schoolId&&manualIds.has(data.columnId)&&personIds.has(data.personId)
      ).map(data=>({
        columnId:data.columnId,personId:data.personId,
        score:data.score===null?null:Number(data.score),revision:Number(data.revision)||1
      }));
      const publishedGrades=[...schoolGrades,...legacyGrades];
      const snapshot=computePeriodSnapshot({columns,settings,roster,manualScores,publishedGrades});
      const finalization=finalizationDoc.exists&&finalizationDoc.data().schoolId===ctx.schoolId?{
        status:finalizationDoc.data().status||"finalized",
        revision:Number(finalizationDoc.data().revision)||1,
        sheetRevision:Number(finalizationDoc.data().sheetRevision)||0,
        sourceDigest:String(finalizationDoc.data().sourceDigest||""),
        finalizedAt:millis(finalizationDoc.data().finalizedAt),
        finalizedByUid:finalizationDoc.data().finalizedByUid||null,
        stale:String(finalizationDoc.data().sourceDigest||"")!==snapshot.sourceDigest
      }:null;
      return {
        offering,labels,roster,assessments,columns,settings,manualScores,publishedGrades,collaborators,
        sheetRevision:sheet.exists&&sheet.data().schoolId===ctx.schoolId?Number(sheet.data().revision)||0:0,
        finalization,snapshot
      };
    }

    if(input.action==="workspace"){
      const data=await buildWorkspaceData();
      return {
        offering:{offeringId,programId:data.offering.programId,yearId:data.offering.yearId,
          termId:data.offering.termId,subjectId:data.offering.subjectId,sectionId:data.offering.sectionId,
          sectionName:data.labels.sectionName,subjectName:data.labels.subjectName},
        roster:data.roster.map(({authUid,...row})=>row),
        assessments:data.assessments,columns:data.columns,settings:data.settings,
        manualScores:data.manualScores,publishedGrades:data.publishedGrades,
        collaborators:data.collaborators,
        sheetRevision:data.sheetRevision,finalization:data.finalization,
        periodReadiness:{
          ready:data.snapshot.ready,blockerCount:data.snapshot.blockerCount,
          activeColumnCount:data.snapshot.activeColumnCount
        }
      };
    }

    if(input.action==="finalization_preview"){
      const data=await buildWorkspaceData();
      return {
        offeringId,sheetRevision:data.sheetRevision,
        finalization:data.finalization,
        ready:data.snapshot.ready,blockerCount:data.snapshot.blockerCount,
        blockers:data.snapshot.blockers,sourceDigest:data.snapshot.sourceDigest,
        activeColumnCount:data.snapshot.activeColumnCount,
        grades:data.snapshot.ready?data.snapshot.grades:[]
      };
    }

    if(input.action==="finalization_history"){
      await verifyOffering();
      const finalizationRef=db.doc(prefix+"class_record_finalizations/"+offeringId);
      const current=await finalizationRef.get();
      if(!current.exists||current.data().schoolId!==ctx.schoolId)
        return {offeringId,revisions:[]};
      const snap=await finalizationRef.collection("revisions").limit(31).get();
      if(snap.size===31)
        deny("resource-exhausted","This period has more than 30 finalization revisions. Paginated history is required.");
      const revisions=snap.docs.map(doc=>doc.data()).filter(data=>
        data.schoolId===ctx.schoolId&&data.offeringId===offeringId
      ).map(data=>({
        revision:Number(data.revision)||0,sheetRevision:Number(data.sheetRevision)||0,
        sourceDigest:String(data.sourceDigest||""),studentCount:Number(data.studentCount)||0,
        gradeComputation:data.gradeComputation||"raw_weighted",
        categoryWeights:Array.isArray(data.categoryWeights)?data.categoryWeights:[],
        appliedSchemeId:data.appliedSchemeId||null,
        appliedSchemeRevision:Number(data.appliedSchemeRevision)||null,
        appliedSchemeName:String(data.appliedSchemeName||""),
        finalizedAt:millis(data.finalizedAt),finalizedByUid:data.finalizedByUid||null
      })).sort((a,b)=>b.revision-a.revision);
      return {offeringId,revisions};
    }

    if(input.action==="finalization_revision"){
      await verifyOffering();
      const revision=Number(input.revision);
      if(!Number.isInteger(revision)||revision<1||revision>100)
        deny("invalid-argument","Finalization revision is invalid.");
      const finalizationRef=db.doc(prefix+"class_record_finalizations/"+offeringId);
      const headerDoc=await finalizationRef.collection("revisions").doc(String(revision)).get();
      if(!headerDoc.exists||headerDoc.data().schoolId!==ctx.schoolId||
         headerDoc.data().offeringId!==offeringId)
        deny("not-found","This finalized period revision is unavailable.");
      const header=headerDoc.data();
      let personIds=Array.isArray(header.personIds)?
        header.personIds.filter(value=>typeof value==="string"&&value).slice(0,MAX_CLASS_SIZE):[];
      let gradeDocs=[];
      if(personIds.length){
        gradeDocs=await Promise.all(personIds.map(personId=>
          db.doc(prefix+"class_record_period_grades/"+hash(offeringId,personId)+
            "/revisions/"+revision).get()));
      }else{
        const currentGrades=await db.collection(prefix+"class_record_period_grades")
          .where("offeringId","==",offeringId).limit(MAX_CLASS_SIZE+1).get();
        if(currentGrades.size>MAX_CLASS_SIZE)
          deny("resource-exhausted","Finalized period history exceeds the bounded class size.");
        gradeDocs=await Promise.all(currentGrades.docs.map(doc=>
          doc.ref.collection("revisions").doc(String(revision)).get()));
      }
      const grades=gradeDocs.filter(doc=>doc.exists&&doc.data().schoolId===ctx.schoolId&&
        doc.data().offeringId===offeringId&&Number(doc.data().finalizationRevision)===revision)
        .map(doc=>({
          personId:doc.data().personId,name:String(doc.data().studentNameSnapshot||"Student"),
          initialGrade:Number(doc.data().initialGrade),
          periodGrade:Number(doc.data().periodGrade),
          categoryScores:Array.isArray(doc.data().categoryScores)?doc.data().categoryScores:[]
        })).sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:"base"}));
      if(grades.length!==Number(header.studentCount||0))
        deny("failed-precondition","The finalized revision grade set is incomplete. Preserve it for audit and contact an administrator before exporting.");
      return {
        offeringId,revision,
        finalizedAt:millis(header.finalizedAt),finalizedByUid:header.finalizedByUid||null,
        sheetRevision:Number(header.sheetRevision)||0,sourceDigest:String(header.sourceDigest||""),
        gradeComputation:header.gradeComputation||"raw_weighted",
        categoryWeights:Array.isArray(header.categoryWeights)?header.categoryWeights:[],
        appliedSchemeId:header.appliedSchemeId||null,
        appliedSchemeRevision:Number(header.appliedSchemeRevision)||null,
        appliedSchemeName:String(header.appliedSchemeName||""),
        columns:Array.isArray(header.columns)?header.columns:[],
        grades
      };
    }

    if(input.action==="finalize_period"){
      const expectedSheetRevision=Number(input.expectedSheetRevision);
      const expectedFinalizationRevision=Number(input.expectedFinalizationRevision||0);
      if(!Number.isInteger(expectedSheetRevision)||expectedSheetRevision<0||
         !Number.isInteger(expectedFinalizationRevision)||expectedFinalizationRevision<0)
        deny("invalid-argument","Finalization revision information is invalid.");
      const data=await buildWorkspaceData();
      if(data.sheetRevision!==expectedSheetRevision)
        deny("failed-precondition","The Class Record changed. Reload it before finalizing the period.");
      if(!data.snapshot.ready)
        deny("failed-precondition","Period grades are incomplete. Resolve every missing score and grading-setup blocker first.");
      const finalizationRef=db.doc(prefix+"class_record_finalizations/"+offeringId);
      const auditRef=db.collection(prefix+"class_record_audit").doc();
      const revision=expectedFinalizationRevision+1;
      const activeColumns=data.columns.filter(column=>column.archived!==true);
      await db.runTransaction(async tx=>{
        const [grant,currentSheet,currentFinalization]=await Promise.all([
          tx.get(grantRef),tx.get(sheetRef),tx.get(finalizationRef)
        ]);
        if(!grant.exists||grant.data().schoolId!==ctx.schoolId||
           grant.data().teacherUid!==ctx.uid||grant.data().status!=="active")
          deny("permission-denied","Your class assignment changed. Reload before finalizing.");
        if(!currentSheet.exists||currentSheet.data().schoolId!==ctx.schoolId||
           Number(currentSheet.data().revision||0)!==expectedSheetRevision)
          deny("failed-precondition","The Class Record layout changed while finalizing. Reload and review again.");
        const currentRevision=currentFinalization.exists?Number(currentFinalization.data().revision)||0:0;
        if(currentRevision!==expectedFinalizationRevision)
          deny("failed-precondition","Another period finalization was recorded. Reload before creating a new revision.");
        const now=FieldValue.serverTimestamp();
        const header={
          schoolId:ctx.schoolId,offeringId,
          yearId:data.offering.yearId,termId:data.offering.termId,
          subjectId:data.offering.subjectId,sectionId:data.offering.sectionId,
          status:"finalized",revision,sheetRevision:expectedSheetRevision,
          sourceDigest:data.snapshot.sourceDigest,
          gradeComputation:data.settings.gradeComputation,
          categoryWeights:data.settings.categoryWeights,
          appliedSchemeId:data.settings.appliedSchemeId||null,
          appliedSchemeRevision:data.settings.appliedSchemeRevision||null,
          appliedSchemeName:data.settings.appliedSchemeName||"",
          columns:activeColumns,studentCount:data.snapshot.grades.length,
          personIds:data.snapshot.grades.map(grade=>grade.personId),
          finalizedByUid:ctx.uid,finalizedAt:now,updatedAt:now
        };
        tx.set(finalizationRef,header,{merge:false});
        tx.create(finalizationRef.collection("revisions").doc(String(revision)),header);
        for(const grade of data.snapshot.grades){
          const gradeRef=db.doc(prefix+"class_record_period_grades/"+hash(offeringId,grade.personId));
          const gradeData={
            schoolId:ctx.schoolId,offeringId,personId:grade.personId,
            yearId:data.offering.yearId,termId:data.offering.termId,
            subjectId:data.offering.subjectId,sectionId:data.offering.sectionId,
            status:"finalized",finalizationRevision:revision,
            sheetRevision:expectedSheetRevision,sourceDigest:data.snapshot.sourceDigest,
            initialGrade:grade.initialGrade,periodGrade:grade.periodGrade,
            categoryScores:grade.categoryScores,studentNameSnapshot:grade.name,
            finalizedByUid:ctx.uid,finalizedAt:now,updatedAt:now
          };
          tx.set(gradeRef,gradeData,{merge:false});
          tx.create(gradeRef.collection("revisions").doc(String(revision)),gradeData);
        }
        tx.create(auditRef,{schoolId:ctx.schoolId,offeringId,actorUid:ctx.uid,
          action:"class_record_period_finalized",revision,sheetRevision:expectedSheetRevision,
          sourceDigest:data.snapshot.sourceDigest,studentCount:data.snapshot.grades.length,
          createdAt:now});
      });
      return {
        offeringId,status:"finalized",revision,sheetRevision:expectedSheetRevision,
        sourceDigest:data.snapshot.sourceDigest,studentCount:data.snapshot.grades.length
      };
    }

    if(input.action==="save_layout"){
      const offering=await verifyOffering(),labels=await offeringLabels(offering);
      const assessmentRows=await availableAssessments(offering,labels);
      const assessmentMap=new Map(assessmentRows.map(task=>[
        assessmentKey(task.sourceType,task.taskId),task
      ]));
      const beforeSheet=await sheetRef.get();
      const previousColumns=beforeSheet.exists&&beforeSheet.data().schoolId===ctx.schoolId&&
        Array.isArray(beforeSheet.data().columns)?beforeSheet.data().columns:[];
      const previousSettings=cleanSettings(beforeSheet.exists&&beforeSheet.data().schoolId===ctx.schoolId?
        beforeSheet.data().settings:{});
      const columns=cleanColumns(input.columns,assessmentMap,previousColumns);
      const settings=cleanSettings(input.settings);
      const schemeChanged=settings.appliedSchemeId&&(
        settings.appliedSchemeId!==previousSettings.appliedSchemeId||
        settings.appliedSchemeRevision!==previousSettings.appliedSchemeRevision||
        settingsCoreKey(settings)!==settingsCoreKey(previousSettings)
      );
      if(schemeChanged){
        const scheme=await db.doc(prefix+"grading_schemes/"+settings.appliedSchemeId).get();
        if(!scheme.exists||scheme.data().schoolId!==ctx.schoolId||scheme.data().status!=="active"||
           Number(scheme.data().revision)!==settings.appliedSchemeRevision)
          deny("failed-precondition","The selected school grading scheme changed. Reload grading setup and apply the current revision.");
        const schemeSettings=cleanSettings(scheme.data().settings||{});
        if(settingsCoreKey(schemeSettings)!==settingsCoreKey(settings))
          deny("failed-precondition","The applied grading scheme snapshot does not match the current school preset.");
      }
      const expectedRevision=Number(input.expectedRevision);
      if(!Number.isInteger(expectedRevision)||expectedRevision<0)
        deny("invalid-argument","The Class Record layout revision is invalid.");
      const auditRef=db.collection(prefix+"class_record_audit").doc();
      let revision;
      await db.runTransaction(async tx=>{
        const [grant,currentOffering,current]=await Promise.all([
          tx.get(grantRef),tx.get(offeringRef),tx.get(sheetRef)
        ]);
        if(!grant.exists||grant.data().schoolId!==ctx.schoolId||
           grant.data().teacherUid!==ctx.uid||grant.data().status!=="active"||
           !currentOffering.exists||currentOffering.data().schoolId!==ctx.schoolId)
          deny("permission-denied","Your class assignment changed. Reload Class Record before saving.");
        const previous=current.exists&&current.data().schoolId===ctx.schoolId?current.data():null;
        const priorRevision=previous?Number(previous.revision)||0:0;
        if(priorRevision!==expectedRevision)
          deny("failed-precondition","This Class Record layout changed. Reload it before saving your edit.");
        const oldColumns=Array.isArray(previous?.columns)?previous.columns:[];
        const nextById=new Map(columns.map(column=>[column.columnId,column]));
        for(const oldColumn of oldColumns){
          const normalizedOld=oldColumn.kind==="assessment"&&!oldColumn.assessmentSource
            ?{...oldColumn,assessmentSource:SCHOOL_SOURCE}:oldColumn;
          const next=nextById.get(normalizedOld.columnId);
          if(!next)
            deny("failed-precondition","Existing Class Record columns cannot be deleted yet. Rename or reorder them instead.");
          if(sourceKey(next)!==sourceKey(normalizedOld))
            deny("failed-precondition","An existing column cannot change score source or maximum. Add a new column for a different source.");
        }
        revision=priorRevision+1;
        const values={schoolId:ctx.schoolId,offeringId,columns,settings,revision,
          lastEditedByUid:ctx.uid,updatedAt:FieldValue.serverTimestamp()};
        if(previous)tx.update(sheetRef,values);
        else tx.create(sheetRef,{...values,createdByUid:ctx.uid,createdAt:FieldValue.serverTimestamp()});
        tx.create(auditRef,{schoolId:ctx.schoolId,offeringId,actorUid:ctx.uid,
          action:"class_record_layout_saved",revision,columnCount:columns.length,
          archivedColumnCount:columns.filter(column=>column.archived===true).length,
          categoryWeights:settings.categoryWeights,gradeComputation:settings.gradeComputation,
          createdAt:FieldValue.serverTimestamp()});
      });
      return {offeringId,revision,columns,settings};
    }

    if(input.action==="save_manual_scores"){
      await verifyOffering();
      const columnId=checkId(String(input.columnId||""),"Column ID",64);
      const values=Array.isArray(input.values)?input.values:[];
      if(!values.length||values.length>MAX_CLASS_SIZE)
        deny("invalid-argument","Save between 1 and "+MAX_CLASS_SIZE+" student scores at a time.");
      const normalized=values.map(item=>{
        const personId=checkId(String(item?.personId||""),"Person ID",128);
        const raw=item?.score;
        if(raw===null||raw===""||raw===undefined)return {personId,score:null};
        const score=Number(raw);
        if(!Number.isFinite(score)||score<0||score>MAX_SCORE)
          deny("invalid-argument","Manual scores must be blank or between 0 and "+MAX_SCORE+".");
        return {personId,score};
      });
      const unique=new Set(normalized.map(item=>item.personId));
      if(unique.size!==normalized.length)
        deny("invalid-argument","Each student may appear only once in a score save.");

      const [sheet,enrollments]=await Promise.all([
        sheetRef.get(),
        db.collection(prefix+"enrollments").where("offeringId","==",offeringId).limit(MAX_CLASS_SIZE+1).get()
      ]);
      if(!sheet.exists||sheet.data().schoolId!==ctx.schoolId)
        deny("failed-precondition","Create the Class Record column before entering scores.");
      const column=(Array.isArray(sheet.data().columns)?sheet.data().columns:[])
        .find(item=>item.columnId===columnId);
      if(!column||column.kind!=="manual")
        deny("failed-precondition","Only manual Class Record columns accept direct score entry.");
      if(column.archived===true)
        deny("failed-precondition","Restore this archived column before changing its scores.");
      const maxPoints=Number(column.maxPoints);
      if(normalized.some(item=>item.score!==null&&item.score>maxPoints))
        deny("invalid-argument","A score exceeds the "+maxPoints+"-point maximum for "+column.label+".");
      const activePeople=new Set(enrollments.docs.filter(doc=>
        doc.data().schoolId===ctx.schoolId&&doc.data().status==="active"
      ).map(doc=>doc.data().personId));
      if(normalized.some(item=>!activePeople.has(item.personId)))
        deny("permission-denied","One or more score rows no longer belong to this active class roster.");

      const refs=normalized.map(item=>db.doc(prefix+"class_record_scores/"+
        hash(offeringId,columnId,item.personId)));
      const auditRef=db.collection(prefix+"class_record_audit").doc();
      let changed=0;
      await db.runTransaction(async tx=>{
        const [grant,currentSheet,...priorScores]=await Promise.all([
          tx.get(grantRef),tx.get(sheetRef),...refs.map(ref=>tx.get(ref))
        ]);
        if(!grant.exists||grant.data().schoolId!==ctx.schoolId||
           grant.data().teacherUid!==ctx.uid||grant.data().status!=="active")
          deny("permission-denied","Your class assignment changed. Reload Class Record before saving.");
        const liveColumn=(Array.isArray(currentSheet.data()?.columns)?currentSheet.data().columns:[])
          .find(item=>item.columnId===columnId);
        if(!liveColumn||liveColumn.kind!=="manual"||Number(liveColumn.maxPoints)!==maxPoints)
          deny("failed-precondition","This manual column changed. Reload Class Record before saving scores.");
        const changes=[];
        normalized.forEach((item,index)=>{
          const prior=priorScores[index],before=prior.exists?prior.data().score:null;
          if(before===item.score||(before==null&&item.score===null))return;
          changed++;
          const revision=prior.exists?(Number(prior.data().revision)||0)+1:1;
          const data={schoolId:ctx.schoolId,offeringId,columnId,personId:item.personId,
            score:item.score,maxPoints,revision,updatedByUid:ctx.uid,
            updatedAt:FieldValue.serverTimestamp()};
          if(prior.exists)tx.update(refs[index],data);
          else tx.create(refs[index],{...data,createdAt:FieldValue.serverTimestamp()});
          changes.push({personId:item.personId,before:before==null?null:Number(before),after:item.score});
        });
        if(changes.length)tx.create(auditRef,{schoolId:ctx.schoolId,offeringId,columnId,
          actorUid:ctx.uid,action:"class_record_manual_scores_saved",changes,
          createdAt:FieldValue.serverTimestamp()});
      });
      return {offeringId,columnId,changed};
    }

    deny("invalid-argument","Unknown Class Record operation.");
  };
}
module.exports={
  createSchoolClassRecordService,cleanColumns,cleanSettings,
  SCHOOL_SOURCE,LEGACY_PERSONALIZED_SOURCE
};