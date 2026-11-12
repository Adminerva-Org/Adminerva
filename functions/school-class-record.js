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
  return {categoryWeights,gradeComputation};
}
function cleanColumns(raw,assessmentMap){
  if(!Array.isArray(raw)||raw.length>MAX_COLUMNS)
    deny("invalid-argument","A class record supports up to "+MAX_COLUMNS+" columns.");
  const ids=new Set(),linkedTasks=new Set();
  return raw.map((item,index)=>{
    const columnId=checkId(String(item?.columnId||""),"Column ID",64);
    if(ids.has(columnId))deny("invalid-argument","Column IDs must be unique.");
    ids.add(columnId);
    const label=text(item?.label,"Column "+(index+1)+" label",80);
    const category=optionalText(item?.category,60);
    const kind=String(item?.kind||"");
    if(!["manual","assessment"].includes(kind))
      deny("invalid-argument","Column "+label+" must be manual or assessment-linked.");
    if(kind==="manual"){
      const maxPoints=Number(item?.maxPoints);
      if(!Number.isFinite(maxPoints)||maxPoints<=0||maxPoints>MAX_SCORE)
        deny("invalid-argument","Manual column "+label+" needs a maximum score above 0 and no more than "+MAX_SCORE+".");
      return {columnId,label,category,kind,maxPoints};
    }
    const taskId=checkId(String(item?.taskId||""),"Assessment task ID",160);
    const assessmentSource=[SCHOOL_SOURCE,LEGACY_PERSONALIZED_SOURCE].includes(item?.assessmentSource)
      ?item.assessmentSource:SCHOOL_SOURCE;
    const unique=assessmentKey(assessmentSource,taskId);
    if(linkedTasks.has(unique))
      deny("invalid-argument","The same assessment cannot be linked to the class record twice.");
    linkedTasks.add(unique);
    const task=assessmentMap.get(unique);
    if(!task)
      deny("permission-denied","A linked assessment is unavailable or is no longer assigned to you.");
    const maxPoints=Number(task.maxPoints);
    if(!Number.isFinite(maxPoints)||maxPoints<=0)
      deny("failed-precondition","The linked assessment has no gradeable maximum score.");
    return {columnId,label,category,kind,taskId,assessmentSource,maxPoints};
  });
}

function createSchoolClassRecordService({db,resolveUsers=null}){
  return async request=>{
    const input=request.data||{};
    const ctx=await getSchoolContext({db,request,schoolId:input.schoolId});
    if(!ctx.roles.includes("teacher"))
      deny("permission-denied","Class Record access requires an active teacher role.");

    const prefix="schools/"+ctx.schoolId+"/";
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
          (data.reviewerUid||data.ownerUid)===ctx.uid&&
          data.status==="deployed"&&data.lifecycle!=="cancelled";
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
      const permitted=new Set(available.filter(task=>task.sourceType===LEGACY_PERSONALIZED_SOURCE)
        .map(task=>task.taskId));
      if(linked.some(column=>!permitted.has(column.taskId)))
        deny("permission-denied","A linked Personalized assessment is no longer available to this teacher.");
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

    if(input.action==="workspace"){
      const offering=await verifyOffering();
      const labels=await offeringLabels(offering);
      const [roster,assessments,sheet,gradeSnap,manualSnap]=await Promise.all([
        classRoster(),
        availableAssessments(offering,labels),
        sheetRef.get(),
        db.collection(prefix+"student_grades").where("offeringId","==",offeringId).limit(2001).get(),
        db.collection(prefix+"class_record_scores").where("offeringId","==",offeringId).limit(1001).get()
      ]);
      if(gradeSnap.size===2001)
        deny("resource-exhausted","Published school grade history is too large for the current Class Record view.");
      if(manualSnap.size===1001)
        deny("resource-exhausted","Manual Class Record history is too large for the current view.");

      const columns=sheet.exists&&sheet.data().schoolId===ctx.schoolId&&Array.isArray(sheet.data().columns)
        ?sheet.data().columns.map(column=>column.kind==="assessment"&&!column.assessmentSource
          ?{...column,assessmentSource:SCHOOL_SOURCE}:column):[];
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

      return {
        offering:{offeringId,programId:offering.programId,yearId:offering.yearId,
          termId:offering.termId,subjectId:offering.subjectId,sectionId:offering.sectionId,
          sectionName:labels.sectionName,subjectName:labels.subjectName},
        roster:roster.map(({authUid,...row})=>row),
        assessments,columns,settings,manualScores,
        publishedGrades:[...schoolGrades,...legacyGrades],
        sheetRevision:sheet.exists&&sheet.data().schoolId===ctx.schoolId?
          Number(sheet.data().revision)||0:0
      };
    }

    if(input.action==="save_layout"){
      const offering=await verifyOffering(),labels=await offeringLabels(offering);
      const assessmentRows=await availableAssessments(offering,labels);
      const assessmentMap=new Map(assessmentRows.map(task=>[
        assessmentKey(task.sourceType,task.taskId),task
      ]));
      const columns=cleanColumns(input.columns,assessmentMap);
      const settings=cleanSettings(input.settings);
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
