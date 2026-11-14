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
const PERIOD_TYPES=new Set(["term","semester","quarter","trimester","custom"]);
const LEGACY_BRIDGE_SCHOOL="mcs-manila";
const SCHOOL_SOURCE="school";
const LEGACY_PERSONALIZED_SOURCE="legacy_personalized";
const CELL_STATUSES=new Set(["normal","incomplete","exempt","not_applicable"]);
const STUDENT_VISIBILITIES=new Set(["hidden","released"]);
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
function cleanSchemeApplicability(raw={}){
  const input=raw&&typeof raw==="object"&&!Array.isArray(raw)?raw:{};
  const programId=input.programId?checkId(String(input.programId),"Grading scheme program ID",80):null;
  const subjectId=input.subjectId?checkId(String(input.subjectId),"Grading scheme subject ID",80):null;
  const sectionId=input.sectionId?checkId(String(input.sectionId),"Grading scheme section ID",80):null;
  const incoming=Array.isArray(input.periodTypes)?input.periodTypes:[];
  if(incoming.length>PERIOD_TYPES.size)
    deny("invalid-argument","A grading scheme has too many academic period types.");
  const periodTypes=[...new Set(incoming.map(value=>String(value||"").trim().toLowerCase()).filter(Boolean))];
  if(periodTypes.some(value=>!PERIOD_TYPES.has(value)))
    deny("invalid-argument","Grading scheme period type must be term, semester, quarter, trimester or custom.");
  return {programId,subjectId,sectionId,periodTypes};
}
function schemeMatchesOffering(applicability,offering,periodType){
  const scope=cleanSchemeApplicability(applicability);
  if(scope.programId&&scope.programId!==offering.programId)return false;
  if(scope.subjectId&&scope.subjectId!==offering.subjectId)return false;
  if(scope.sectionId&&scope.sectionId!==offering.sectionId)return false;
  if(scope.periodTypes.length&&!scope.periodTypes.includes(String(periodType||"term").toLowerCase()))return false;
  return true;
}
function schemeSpecificity(applicability={}){
  const scope=cleanSchemeApplicability(applicability);
  return Number(Boolean(scope.programId))+Number(Boolean(scope.subjectId))+
    Number(Boolean(scope.sectionId))+Number(Boolean(scope.periodTypes.length));
}
async function resolveSchoolGradingPolicy({db,prefix,schoolId,offering,periodType}){
  const snap=await db.collection(prefix+"grading_schemes").limit(51).get();
  if(snap.size===51)deny("resource-exhausted","School grading policies require pagination.");
  const matches=snap.docs.filter(doc=>doc.data().schoolId===schoolId&&
    doc.data().status==="active"&&schemeMatchesOffering(doc.data().applicability||{},offering,periodType))
    .map(doc=>({doc,score:schemeSpecificity(doc.data().applicability||{})}))
    .sort((a,b)=>b.score-a.score||
      String(a.doc.data().name||"").localeCompare(String(b.doc.data().name||""),undefined,{sensitivity:"base"}));
  if(!matches.length)return {
    settings:cleanSettings({}),
    policy:null
  };
  const topScore=matches[0].score,top=matches.filter(item=>item.score===topScore);
  if(top.length>1)
    deny("failed-precondition","Multiple active school grading policies match this class at the same specificity. A school administrator must resolve the policy overlap.");
  const selected=top[0].doc,data=selected.data(),base=cleanSettings(data.settings||{});
  return {
    settings:{...base,appliedSchemeId:selected.id,appliedSchemeRevision:Number(data.revision)||1,
      appliedSchemeName:String(data.name||"School grading policy")},
    policy:{
      schemeId:selected.id,name:String(data.name||"School grading policy"),
      revision:Number(data.revision)||1,
      applicability:cleanSchemeApplicability(data.applicability||{})
    }
  };
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
function roundTwo(value){
  return Math.round((Number(value)+Number.EPSILON)*100)/100;
}
function cleanCellStatus(value){
  const status=String(value||"normal").trim().toLowerCase();
  if(!CELL_STATUSES.has(status))
    deny("invalid-argument","Score status must be normal, incomplete, exempt or not applicable.");
  return status;
}
function cleanStudentVisibility(value){
  const visibility=String(value||"hidden").trim().toLowerCase();
  if(!STUDENT_VISIBILITIES.has(visibility))
    deny("invalid-argument","Student score visibility must be hidden or released.");
  return visibility;
}
function finalizationSourceDigest({columns,settings,roster,manualScores,publishedGrades,cellStates}){
  const activeColumns=(columns||[]).filter(column=>column.archived!==true);
  const active=activeColumns.map(column=>({
    columnId:column.columnId,label:column.label,category:column.category||"",kind:column.kind,
    maxPoints:Number(column.maxPoints)||0,taskId:column.taskId||"",
    assessmentSource:column.assessmentSource||"",sourceTitle:column.sourceTitle||""
  }));
  const activeColumnIds=new Set(activeColumns.map(column=>column.columnId));
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
  const statuses=[...(cellStates||[])].filter(row=>
    activeColumnIds.has(row.columnId)&&rosterIds.has(row.personId)).map(row=>({
      columnId:row.columnId,personId:row.personId,status:cleanCellStatus(row.status),
      revision:Number(row.revision)||0
    })).sort((a,b)=>(a.columnId+"|"+a.personId).localeCompare(b.columnId+"|"+b.personId));
  return createHash("sha256").update(JSON.stringify({
    columns:active,settings:settingsCoreKey(settings),
    roster:[...rosterIds].sort(),manual,grades,statuses
  })).digest("hex");
}
function computePeriodSnapshot({columns,settings,roster,manualScores,publishedGrades,cellStates}){
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
  const stateMap=new Map((cellStates||[]).map(row=>[
    row.columnId+"::"+row.personId,{...row,status:cleanCellStatus(row.status)}
  ]));
  const grades=[];
  for(const student of roster||[]){
    const byCategory=new Map(categories.map(category=>[category,{earned:0,max:0,complete:true}]));
    const studentCellStatuses=[];
    let studentReady=true;
    for(const column of active){
      const category=String(column.category||"").trim();
      if(!category){studentReady=false;continue;}
      const bucket=byCategory.get(category)||{earned:0,max:0,complete:true};
      const state=stateMap.get(column.columnId+"::"+student.personId);
      const status=state?.status||"normal";
      if(status!=="normal"){
        studentCellStatuses.push({columnId:column.columnId,status});
        if(status==="exempt"||status==="not_applicable"){
          byCategory.set(category,bucket);
          continue;
        }
        bucket.max+=Number(column.maxPoints)||0;
        bucket.complete=false;studentReady=false;
        block("incomplete_score",student.name+" · "+column.label+" is marked incomplete / for completion.",{
          personId:student.personId,columnId:column.columnId,status
        });
        byCategory.set(category,bucket);
        continue;
      }
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
    let initialRaw=0;const categoryScores=[];let categoryReady=true;
    for(const category of categories){
      const bucket=byCategory.get(category),weight=weights.get(category.toLocaleLowerCase("en"));
      if(!bucket?.complete||!Number.isFinite(weight)){categoryReady=false;break;}
      if(!bucket.max){
        block("empty_category_after_exclusions",student.name+" has no countable score in "+category+
          " after exemptions / not-applicable statuses.",{personId:student.personId,category});
        categoryReady=false;break;
      }
      const percentage=bucket.earned/bucket.max*100,weightedContribution=percentage*weight/100;
      initialRaw+=weightedContribution;
      categoryScores.push({
        category,earned:roundTwo(bucket.earned),max:roundTwo(bucket.max),
        percentage:roundTwo(percentage),weight:roundGrade(weight),
        weightedContribution:roundTwo(weightedContribution)
      });
    }
    if(!categoryReady)continue;
    const initial=roundTwo(initialRaw);
    const period=roundTwo(settings.gradeComputation==="deped_60_100"?60+(initialRaw*0.4):initialRaw);
    grades.push({
      personId:student.personId,name:student.name,
      initialGrade:initial,periodGrade:period,finalGrade:Math.round(period),
      categoryScores,cellStatuses:studentCellStatuses
    });
  }
  const sourceDigest=finalizationSourceDigest({columns,settings,roster,manualScores,publishedGrades,cellStates});
  return {
    ready:blockerCount===0&&grades.length===(roster||[]).length&&grades.length>0,
    blockerCount,blockers,grades,categories,activeColumnCount:active.length,
    sourceDigest
  };
}
function cleanColumns(raw,assessmentMap,previousColumns=[]){
  if(!Array.isArray(raw)||raw.length>MAX_COLUMNS)
    deny("invalid-argument","A class record supports up to "+MAX_COLUMNS+" columns.");
  const ids=new Set(),linkedActiveTasks=new Set(),previousById=new Map(
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
    const studentVisibility=cleanStudentVisibility(item?.studentVisibility);
    if(!["manual","assessment"].includes(kind))
      deny("invalid-argument","Column "+label+" must be manual or assessment-linked.");
    if(kind==="manual"){
      const maxPoints=Number(item?.maxPoints);
      if(!Number.isFinite(maxPoints)||maxPoints<=0||maxPoints>MAX_SCORE)
        deny("invalid-argument","Manual column "+label+" needs a maximum score above 0 and no more than "+MAX_SCORE+".");
      return {columnId,label,category,kind,maxPoints,archived,studentVisibility};
    }
    const taskId=checkId(String(item?.taskId||""),"Assessment task ID",160);
    const assessmentSource=[SCHOOL_SOURCE,LEGACY_PERSONALIZED_SOURCE].includes(item?.assessmentSource)
      ?item.assessmentSource:SCHOOL_SOURCE;
    const unique=assessmentKey(assessmentSource,taskId);
    if(!archived&&linkedActiveTasks.has(unique))
      deny("invalid-argument","The same assessment cannot appear in more than one active Class Record column.");
    if(!archived)linkedActiveTasks.add(unique);
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
    return {columnId,label,category,kind,taskId,assessmentSource,maxPoints,sourceTitle,archived,studentVisibility};
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
          applicability:cleanSchemeApplicability(item.applicability||{}),
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
      const requestedApplicability=input.action==="save_scheme"?
        cleanSchemeApplicability(input.applicability||{}):null;
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
          const [program,subject]=await Promise.all([
            requestedApplicability.programId?
              tx.get(db.doc(prefix+"academic_programs/"+requestedApplicability.programId)):Promise.resolve(null),
            requestedApplicability.subjectId?
              tx.get(db.doc(prefix+"subjects/"+requestedApplicability.subjectId)):Promise.resolve(null)
          ]);
          if(program&&(!program.exists||program.data().schoolId!==ctx.schoolId||program.data().status!=="active"))
            deny("failed-precondition","The grading scheme program/division is unavailable or inactive.");
          if(subject&&(!subject.exists||subject.data().schoolId!==ctx.schoolId||subject.data().status!=="active"))
            deny("failed-precondition","The grading scheme subject is unavailable or inactive.");
          const revision=priorRevision+1;
          const values={schoolId:ctx.schoolId,name,description,status:"active",
            settings:storedSettings,applicability:requestedApplicability,
            revision,updatedByUid:ctx.uid,updatedAt:now};
          if(prior)tx.update(schemeRef,values);
          else tx.create(schemeRef,{...values,createdByUid:ctx.uid,createdAt:now});
          tx.create(auditRef,{schoolId:ctx.schoolId,schemeId,actorUid:ctx.uid,
            action:prior?"grading_scheme_updated":"grading_scheme_created",
            revision,createdAt:now});
          result={schemeId,name,description,status:"active",settings:storedSettings,
            applicability:requestedApplicability,revision};
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
      if(!ctx.platformOverride&&(!grant.exists||grant.data().schoolId!==ctx.schoolId||
         grant.data().teacherUid!==ctx.uid||grant.data().offeringId!==offeringId||
         grant.data().status!=="active"))
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
      const [program,year,term,section,subject]=await Promise.all([
        db.doc(prefix+"academic_programs/"+checkId(offering.programId,"Academic program ID",80)).get(),
        db.doc(prefix+"academic_years/"+checkId(offering.yearId,"Academic year ID",80)).get(),
        db.doc(prefix+"terms/"+checkId(offering.termId,"Academic period ID",80)).get(),
        db.doc(prefix+"sections/"+checkId(offering.sectionId,"Section ID",80)).get(),
        db.doc(prefix+"subjects/"+checkId(offering.subjectId,"Subject ID",80)).get()
      ]);
      const name=doc=>doc.exists&&doc.data().schoolId===ctx.schoolId?
        String(doc.data().name||"").trim():"";
      return {
        programName:name(program),yearName:name(year),termName:name(term),
        periodType:term.exists&&term.data().schoolId===ctx.schoolId?
          String(term.data().periodType||"term").trim().toLowerCase():"term",
        sectionName:name(section),subjectName:name(subject)
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
          (ctx.platformOverride||(data.reviewerUid||data.ownerUid)===ctx.uid);
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
      const gradingPolicy=await resolveSchoolGradingPolicy({
        db,prefix,schoolId:ctx.schoolId,offering,periodType:labels.periodType
      });
      const finalizationRef=db.doc(prefix+"class_record_finalizations/"+offeringId);
      const [roster,assessments,sheet,gradeSnap,manualSnap,cellStateSnap,finalizationDoc,collaborators]=await Promise.all([
        classRoster(),
        availableAssessments(offering,labels),
        sheetRef.get(),
        db.collection(prefix+"student_grades").where("offeringId","==",offeringId).limit(MAX_SCORE_CELLS+1).get(),
        db.collection(prefix+"class_record_scores").where("offeringId","==",offeringId).limit(MAX_SCORE_CELLS+1).get(),
        db.collection(prefix+"class_record_cell_states").where("offeringId","==",offeringId).limit(MAX_SCORE_CELLS+1).get(),
        finalizationRef.get(),
        activeOfferingTeachers()
      ]);
      if(gradeSnap.size>MAX_SCORE_CELLS)
        deny("resource-exhausted","Published school grade cells exceed the bounded Class Record capacity.");
      if(manualSnap.size>MAX_SCORE_CELLS)
        deny("resource-exhausted","Manual score cells exceed the bounded Class Record capacity.");
      if(cellStateSnap.size>MAX_SCORE_CELLS)
        deny("resource-exhausted","Score-status cells exceed the bounded Class Record capacity.");

      const columns=sheet.exists&&sheet.data().schoolId===ctx.schoolId&&Array.isArray(sheet.data().columns)
        ?sheet.data().columns.map(column=>{
          const normalized=column.kind==="assessment"&&!column.assessmentSource
            ?{...column,assessmentSource:SCHOOL_SOURCE}:column;
          return {...normalized,archived:normalized.archived===true,
            studentVisibility:cleanStudentVisibility(normalized.studentVisibility)};
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
      const settings=gradingPolicy.settings;
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
        score:data.score===null?null:Number(data.score),revision:Number(data.revision)||1,
        previousScore:data.previousScore===null||data.previousScore===undefined?null:Number(data.previousScore),
        hasPreviousScore:Object.prototype.hasOwnProperty.call(data,"previousScore"),
        updatedAt:millis(data.updatedAt),updatedByUid:data.updatedByUid||null
      }));
      const columnIds=new Set(columns.map(column=>column.columnId));
      const cellStates=cellStateSnap.docs.map(doc=>doc.data()).filter(data=>
        data.schoolId===ctx.schoolId&&columnIds.has(data.columnId)&&personIds.has(data.personId)
      ).map(data=>({
        columnId:data.columnId,personId:data.personId,status:cleanCellStatus(data.status),
        previousStatus:CELL_STATUSES.has(String(data.previousStatus||""))?String(data.previousStatus):"normal",
        revision:Number(data.revision)||1,updatedAt:millis(data.updatedAt),updatedByUid:data.updatedByUid||null
      }));
      const publishedGrades=[...schoolGrades,...legacyGrades];
      const snapshot=computePeriodSnapshot({columns,settings,roster,manualScores,publishedGrades,cellStates});
      const finalization=finalizationDoc.exists&&finalizationDoc.data().schoolId===ctx.schoolId?{
        status:finalizationDoc.data().status||"finalized",
        revision:Number(finalizationDoc.data().revision)||1,
        sheetRevision:Number(finalizationDoc.data().sheetRevision)||0,
        sourceDigest:String(finalizationDoc.data().sourceDigest||""),
        finalizedAt:millis(finalizationDoc.data().finalizedAt),
        finalizedByUid:finalizationDoc.data().finalizedByUid||null,
        offeringSnapshot:finalizationDoc.data().offeringSnapshot||null,
        releasedRevision:Number(finalizationDoc.data().releasedRevision)||0,
        releasedAt:millis(finalizationDoc.data().releasedAt),
        releasedByUid:finalizationDoc.data().releasedByUid||null,
        stale:String(finalizationDoc.data().sourceDigest||"")!==snapshot.sourceDigest
      }:null;
      return {
        offering,labels,roster,assessments,columns,settings,gradingPolicy:gradingPolicy.policy,
        manualScores,publishedGrades,cellStates,collaborators,
        sheetRevision:sheet.exists&&sheet.data().schoolId===ctx.schoolId?Number(sheet.data().revision)||0:0,
        finalization,snapshot
      };
    }

    if(input.action==="workspace"){
      const data=await buildWorkspaceData();
      return {
        offering:{offeringId,programId:data.offering.programId,yearId:data.offering.yearId,
          termId:data.offering.termId,subjectId:data.offering.subjectId,sectionId:data.offering.sectionId,
          programName:data.labels.programName,yearName:data.labels.yearName,
          termName:data.labels.termName,periodType:data.labels.periodType,
          sectionName:data.labels.sectionName,subjectName:data.labels.subjectName},
        roster:data.roster.map(({authUid,...row})=>row),
        assessments:data.assessments,columns:data.columns,settings:data.settings,
        gradingPolicy:data.gradingPolicy,
        manualScores:data.manualScores,publishedGrades:data.publishedGrades,cellStates:data.cellStates,
        collaborators:data.collaborators,
        sheetRevision:data.sheetRevision,finalization:data.finalization,
        periodReadiness:{
          ready:data.snapshot.ready,blockerCount:data.snapshot.blockerCount,
          activeColumnCount:data.snapshot.activeColumnCount
        }
      };
    }

    if(input.action==="student_preview"){
      const data=await buildWorkspaceData();
      const personId=checkId(String(input.personId||""),"Person ID",128);
      const student=data.roster.find(row=>row.personId===personId);
      if(!student)
        deny("permission-denied","Student preview is limited to the active class roster.");
      const activeColumns=data.columns.filter(column=>column.archived!==true);
      const activeIds=new Set(activeColumns.map(column=>column.columnId));
      let requestedIds;
      if(input.columnIds===undefined||input.columnIds===null){
        requestedIds=activeColumns.filter(column=>column.studentVisibility==="released").map(column=>column.columnId);
      }else{
        if(!Array.isArray(input.columnIds)||input.columnIds.length>MAX_COLUMNS)
          deny("invalid-argument","Student preview column selection is invalid.");
        requestedIds=[...new Set(input.columnIds.map(value=>checkId(String(value||""),"Column ID",64)))];
        if(requestedIds.some(id=>!activeIds.has(id)))
          deny("failed-precondition","One or more preview columns are no longer active.");
      }
      const selected=new Set(requestedIds);
      const manualMap=new Map(data.manualScores.map(row=>[row.columnId+"::"+row.personId,row]));
      const gradeMap=new Map(data.publishedGrades.map(row=>[
        (row.sourceType||SCHOOL_SOURCE)+"::"+row.taskId+"::"+row.personId,row
      ]));
      const stateMap=new Map(data.cellStates.map(row=>[row.columnId+"::"+row.personId,row]));
      const scores=activeColumns.filter(column=>selected.has(column.columnId)).map(column=>{
        const state=stateMap.get(column.columnId+"::"+personId);
        const status=state?.status||"normal";
        let score=null;
        if(status==="normal"){
          if(column.kind==="manual"){
            const row=manualMap.get(column.columnId+"::"+personId);
            if(row&&row.score!==null&&row.score!==undefined&&Number.isFinite(Number(row.score)))
              score=Number(row.score);
          }else{
            const source=column.assessmentSource||SCHOOL_SOURCE;
            const row=gradeMap.get(source+"::"+column.taskId+"::"+personId);
            if(row&&Number.isFinite(Number(row.awarded)))score=Number(row.awarded);
          }
        }
        return {
          columnId:column.columnId,label:column.label,category:column.category||"",
          kind:column.kind,sourceType:column.kind==="manual"?"manual":(column.assessmentSource||SCHOOL_SOURCE),
          maxPoints:Number(column.maxPoints)||0,status,score:Number.isFinite(score)?score:null
        };
      });
      let finalGrade=null;
      const releasedRevision=Number(data.finalization?.releasedRevision)||0;
      if(releasedRevision>0){
        const gradeRef=db.doc(prefix+"class_record_period_grades/"+hash(offeringId,personId)+
          "/revisions/"+releasedRevision);
        const grade=await gradeRef.get(),row=grade.exists?grade.data():null;
        if(row&&row.schoolId===ctx.schoolId&&row.offeringId===offeringId&&row.personId===personId&&
           Number(row.finalizationRevision)===releasedRevision&&Number.isFinite(Number(row.finalGrade))){
          finalGrade={
            revision:releasedRevision,finalGrade:Math.round(Number(row.finalGrade)),
            releasedAt:data.finalization?.releasedAt||null
          };
        }
      }
      return {
        offeringId,personId,studentName:student.name,
        subjectName:data.labels.subjectName,sectionName:data.labels.sectionName,termName:data.labels.termName,
        scores,finalGrade
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
      const releasedRevision=Number(current.data().releasedRevision)||0;
      const releasedAt=millis(current.data().releasedAt);
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
        offeringSnapshot:data.offeringSnapshot||null,
        finalizedAt:millis(data.finalizedAt),finalizedByUid:data.finalizedByUid||null,
        released:(Number(data.revision)||0)===releasedRevision,
        releasedAt:(Number(data.revision)||0)===releasedRevision?releasedAt:null
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
          finalGrade:Number.isFinite(Number(doc.data().finalGrade))?
            Number(doc.data().finalGrade):Math.round(Number(doc.data().periodGrade)),
          categoryScores:Array.isArray(doc.data().categoryScores)?doc.data().categoryScores:[],
          cellStatuses:Array.isArray(doc.data().cellStatuses)?doc.data().cellStatuses:[]
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
        offeringSnapshot:header.offeringSnapshot||null,
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
        if(!ctx.platformOverride&&(!grant.exists||grant.data().schoolId!==ctx.schoolId||
           grant.data().teacherUid!==ctx.uid||grant.data().status!=="active"))
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
          offeringSnapshot:{
            programName:data.labels.programName,yearName:data.labels.yearName,
            termName:data.labels.termName,periodType:data.labels.periodType,
            subjectName:data.labels.subjectName,sectionName:data.labels.sectionName
          },
          columns:activeColumns,studentCount:data.snapshot.grades.length,
          personIds:data.snapshot.grades.map(grade=>grade.personId),
          finalizedByUid:ctx.uid,finalizedAt:now,updatedAt:now
        };
        const priorReleasedRevision=currentFinalization.exists?
          Number(currentFinalization.data().releasedRevision)||0:0;
        const priorReleasedAt=currentFinalization.exists?currentFinalization.data().releasedAt||null:null;
        const priorReleasedByUid=currentFinalization.exists?currentFinalization.data().releasedByUid||null:null;
        tx.set(finalizationRef,{
          ...header,
          ...(priorReleasedRevision>0?{
            releasedRevision:priorReleasedRevision,releasedAt:priorReleasedAt,
            releasedByUid:priorReleasedByUid
          }:{})
        },{merge:false});
        tx.create(finalizationRef.collection("revisions").doc(String(revision)),header);
        for(const grade of data.snapshot.grades){
          const gradeRef=db.doc(prefix+"class_record_period_grades/"+hash(offeringId,grade.personId));
          const gradeData={
            schoolId:ctx.schoolId,offeringId,personId:grade.personId,
            yearId:data.offering.yearId,termId:data.offering.termId,
            subjectId:data.offering.subjectId,sectionId:data.offering.sectionId,
            status:"finalized",finalizationRevision:revision,
            sheetRevision:expectedSheetRevision,sourceDigest:data.snapshot.sourceDigest,
            initialGrade:grade.initialGrade,periodGrade:grade.periodGrade,finalGrade:grade.finalGrade,
            categoryScores:grade.categoryScores,cellStatuses:grade.cellStatuses,
            studentNameSnapshot:grade.name,
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

    if(input.action==="release_final_grade"){
      const expectedFinalizationRevision=Number(input.expectedFinalizationRevision);
      if(!Number.isInteger(expectedFinalizationRevision)||expectedFinalizationRevision<1)
        deny("invalid-argument","Choose a finalized period revision to release.");
      const data=await buildWorkspaceData();
      if(!data.finalization||data.finalization.revision!==expectedFinalizationRevision)
        deny("failed-precondition","The finalized period revision changed. Reload before releasing Final Grade.");
      if(data.finalization.stale||!data.snapshot.ready||
         data.finalization.sourceDigest!==data.snapshot.sourceDigest)
        deny("failed-precondition","The live Class Record changed after finalization. Finalize a current revision before releasing Final Grade.");
      const finalizationRef=db.doc(prefix+"class_record_finalizations/"+offeringId);
      const auditRef=db.collection(prefix+"class_record_audit").doc();
      await db.runTransaction(async tx=>{
        const [grant,current]=await Promise.all([tx.get(grantRef),tx.get(finalizationRef)]);
        if(!ctx.platformOverride&&(!grant.exists||grant.data().schoolId!==ctx.schoolId||
           grant.data().teacherUid!==ctx.uid||grant.data().status!=="active"))
          deny("permission-denied","Your class assignment changed. Reload before releasing Final Grade.");
        if(!current.exists||current.data().schoolId!==ctx.schoolId||
           Number(current.data().revision)!==expectedFinalizationRevision||
           String(current.data().sourceDigest||"")!==data.snapshot.sourceDigest)
          deny("failed-precondition","The finalized period changed. Reload before releasing Final Grade.");
        const now=FieldValue.serverTimestamp();
        tx.update(finalizationRef,{
          releasedRevision:expectedFinalizationRevision,releasedAt:now,
          releasedByUid:ctx.uid,updatedAt:now
        });
        tx.create(auditRef,{schoolId:ctx.schoolId,offeringId,actorUid:ctx.uid,
          action:"class_record_final_grade_released",revision:expectedFinalizationRevision,
          sourceDigest:data.snapshot.sourceDigest,createdAt:now});
      });
      return {offeringId,status:"released",releasedRevision:expectedFinalizationRevision};
    }

    if(input.action==="withdraw_final_grade"){
      const expectedReleasedRevision=Number(input.expectedReleasedRevision);
      if(!Number.isInteger(expectedReleasedRevision)||expectedReleasedRevision<1)
        deny("invalid-argument","Choose the released Final Grade revision to withdraw.");
      const finalizationRef=db.doc(prefix+"class_record_finalizations/"+offeringId);
      const auditRef=db.collection(prefix+"class_record_audit").doc();
      await db.runTransaction(async tx=>{
        const [grant,current]=await Promise.all([tx.get(grantRef),tx.get(finalizationRef)]);
        if(!ctx.platformOverride&&(!grant.exists||grant.data().schoolId!==ctx.schoolId||
           grant.data().teacherUid!==ctx.uid||grant.data().status!=="active"))
          deny("permission-denied","Your class assignment changed. Reload before withdrawing Final Grade.");
        if(!current.exists||current.data().schoolId!==ctx.schoolId||
           Number(current.data().releasedRevision)!==expectedReleasedRevision)
          deny("failed-precondition","The released Final Grade changed. Reload before withdrawing it.");
        const now=FieldValue.serverTimestamp();
        tx.update(finalizationRef,{
          releasedRevision:0,releasedAt:null,releasedByUid:null,updatedAt:now
        });
        tx.create(auditRef,{schoolId:ctx.schoolId,offeringId,actorUid:ctx.uid,
          action:"class_record_final_grade_withdrawn",revision:expectedReleasedRevision,
          createdAt:now});
      });
      return {offeringId,status:"withdrawn",releasedRevision:0};
    }

    if(input.action==="save_layout"){
      const offering=await verifyOffering(),labels=await offeringLabels(offering);
      const gradingPolicy=await resolveSchoolGradingPolicy({
        db,prefix,schoolId:ctx.schoolId,offering,periodType:labels.periodType
      });
      const assessmentRows=await availableAssessments(offering,labels);
      const assessmentMap=new Map(assessmentRows.map(task=>[
        assessmentKey(task.sourceType,task.taskId),task
      ]));
      const beforeSheet=await sheetRef.get();
      const previousColumns=beforeSheet.exists&&beforeSheet.data().schoolId===ctx.schoolId&&
        Array.isArray(beforeSheet.data().columns)?beforeSheet.data().columns:[];
      const settings=gradingPolicy.settings;
      const expectedRevision=Number(input.expectedRevision);
      if(!Number.isInteger(expectedRevision)||expectedRevision<0)
        deny("invalid-argument","The Class Record layout revision is invalid.");
      const auditRef=db.collection(prefix+"class_record_audit").doc();
      let revision;
      await db.runTransaction(async tx=>{
        const [grant,currentOffering,current]=await Promise.all([
          tx.get(grantRef),tx.get(offeringRef),tx.get(sheetRef)
        ]);
        if(!ctx.platformOverride&&(!grant.exists||grant.data().schoolId!==ctx.schoolId||
           grant.data().teacherUid!==ctx.uid||grant.data().status!=="active")||
           !currentOffering.exists||currentOffering.data().schoolId!==ctx.schoolId)
          deny("permission-denied","Your class assignment changed. Reload Class Record before saving.");
        const previous=current.exists&&current.data().schoolId===ctx.schoolId?current.data():null;
        const priorRevision=previous?Number(previous.revision)||0:0;
        if(priorRevision!==expectedRevision)
          deny("failed-precondition","This Class Record layout changed. Reload it before saving your edit.");
        const oldColumns=Array.isArray(previous?.columns)?previous.columns:[];
        const normalizedOldColumns=oldColumns.map(column=>column.kind==="assessment"&&!column.assessmentSource
          ?{...column,assessmentSource:SCHOOL_SOURCE}:column);
        const oldById=new Map(normalizedOldColumns.map(column=>[column.columnId,column]));
        const nextById=new Map(columns.map(column=>[column.columnId,column]));
        const auditShape=column=>({
          label:String(column?.label||""),category:String(column?.category||""),
          archived:column?.archived===true,
          studentVisibility:cleanStudentVisibility(column?.studentVisibility),
          kind:String(column?.kind||"")
        });
        const columnChanges=[];
        for(const nextColumn of columns){
          const before=oldById.get(nextColumn.columnId);
          if(!before){
            columnChanges.push({columnId:nextColumn.columnId,type:"added",after:auditShape(nextColumn)});
            continue;
          }
          const beforeShape=auditShape(before),afterShape=auditShape(nextColumn);
          if(JSON.stringify(beforeShape)!==JSON.stringify(afterShape))
            columnChanges.push({columnId:nextColumn.columnId,type:"updated",before:beforeShape,after:afterShape});
        }
        for(const normalizedOld of normalizedOldColumns){
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
          activeColumnCount:columns.filter(column=>column.archived!==true).length,
          archivedColumnCount:columns.filter(column=>column.archived===true).length,
          releasedColumnCount:columns.filter(column=>column.archived!==true&&column.studentVisibility==="released").length,
          columnChanges,
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
        if(!ctx.platformOverride&&(!grant.exists||grant.data().schoolId!==ctx.schoolId||
           grant.data().teacherUid!==ctx.uid||grant.data().status!=="active"))
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
            score:item.score,maxPoints,revision,
            previousScore:prior.exists?(before==null?null:Number(before)):null,
            updatedByUid:ctx.uid,updatedAt:FieldValue.serverTimestamp()};
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

    if(input.action==="save_cell_status"){
      await verifyOffering();
      const columnId=checkId(String(input.columnId||""),"Column ID",64);
      const personId=checkId(String(input.personId||""),"Person ID",128);
      const nextStatus=cleanCellStatus(input.status);
      const [sheet,enrollments]=await Promise.all([
        sheetRef.get(),
        db.collection(prefix+"enrollments").where("offeringId","==",offeringId).limit(MAX_CLASS_SIZE+1).get()
      ]);
      if(!sheet.exists||sheet.data().schoolId!==ctx.schoolId)
        deny("failed-precondition","Create the Class Record before changing a score status.");
      const column=(Array.isArray(sheet.data().columns)?sheet.data().columns:[])
        .find(item=>item.columnId===columnId);
      if(!column||column.archived===true)
        deny("failed-precondition","Score status can only be changed for an active Class Record column.");
      const activePeople=new Set(enrollments.docs.filter(doc=>
        doc.data().schoolId===ctx.schoolId&&doc.data().status==="active"
      ).map(doc=>doc.data().personId));
      if(!activePeople.has(personId))
        deny("permission-denied","This learner no longer belongs to the active class roster.");
      const stateRef=db.doc(prefix+"class_record_cell_states/"+hash(offeringId,columnId,personId));
      const auditRef=db.collection(prefix+"class_record_audit").doc();
      let changed=false,resultState;
      await db.runTransaction(async tx=>{
        const [grant,currentSheet,prior]=await Promise.all([
          tx.get(grantRef),tx.get(sheetRef),tx.get(stateRef)
        ]);
        if(!ctx.platformOverride&&(!grant.exists||grant.data().schoolId!==ctx.schoolId||
           grant.data().teacherUid!==ctx.uid||grant.data().status!=="active"))
          deny("permission-denied","Your class assignment changed. Reload Class Record before saving.");
        const liveColumn=(Array.isArray(currentSheet.data()?.columns)?currentSheet.data().columns:[])
          .find(item=>item.columnId===columnId);
        if(!liveColumn||liveColumn.archived===true)
          deny("failed-precondition","This Class Record column changed. Reload before saving the score status.");
        const before=prior.exists?cleanCellStatus(prior.data().status):"normal";
        const priorRevision=prior.exists?Number(prior.data().revision)||1:0;
        if(before===nextStatus){
          resultState={
            columnId,personId,status:before,
            previousStatus:prior.exists&&CELL_STATUSES.has(String(prior.data().previousStatus||""))?
              String(prior.data().previousStatus):"normal",
            revision:priorRevision,updatedAt:millis(prior.data()?.updatedAt)||null
          };
          return;
        }
        changed=true;
        const revision=priorRevision+1,now=FieldValue.serverTimestamp();
        const data={
          schoolId:ctx.schoolId,offeringId,columnId,personId,status:nextStatus,
          previousStatus:before,revision,updatedByUid:ctx.uid,updatedAt:now
        };
        if(prior.exists)tx.update(stateRef,data);
        else tx.create(stateRef,{...data,createdAt:now});
        tx.create(auditRef,{
          schoolId:ctx.schoolId,offeringId,columnId,personId,actorUid:ctx.uid,
          action:"class_record_cell_status_saved",beforeStatus:before,afterStatus:nextStatus,
          revision,createdAt:now
        });
        resultState={columnId,personId,status:nextStatus,previousStatus:before,revision};
      });
      return {offeringId,changed,state:resultState};
    }

    deny("invalid-argument","Unknown Class Record operation.");
  };
}
module.exports={
  createSchoolClassRecordService,cleanColumns,cleanSettings,
  SCHOOL_SOURCE,LEGACY_PERSONALIZED_SOURCE
};