"use strict";
/**
 * School-scoped Class Record.
 *
 * The class record consolidates two score sources without becoming a second
 * grading engine:
 *   - manual columns are entered here;
 *   - assessment columns project only published school Gradebook results.
 *
 * Linked assessment results remain editable only through schoolGradebook.
 */
const {FieldValue}=require("firebase-admin/firestore");
const {createHash}=require("node:crypto");
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");
const {rowKey,checkId}=require("./school-academics.js");

const MAX_COLUMNS=80;
const MAX_CLASS_SIZE=100;
const MAX_SCORE=10000;
const hash=(...values)=>createHash("sha256").update(JSON.stringify(values)).digest("hex");
function deny(code,message){throw new TenantAccessError(code,message)}
function text(value,label,max){
  const clean=String(value||"").trim();
  if(!clean||clean.length>max)deny("invalid-argument",label+" is required and cannot exceed "+max+" characters.");
  return clean;
}
function optionalText(value,max){
  const clean=String(value||"").trim();
  if(clean.length>max)deny("invalid-argument","Category cannot exceed "+max+" characters.");
  return clean;
}
function millis(value){
  if(!value)return null;
  if(typeof value.toMillis==="function")return value.toMillis();
  const numeric=Number(value);
  return Number.isFinite(numeric)?numeric:null;
}
function rubricTotal(task){
  const rubric=Array.isArray(task?.rubric)?task.rubric:[];
  const total=rubric.reduce((sum,item)=>sum+Number(item?.points||0),0);
  return Number.isFinite(total)&&total>0?total:0;
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
        deny("invalid-argument","Manual column "+label+" needs a maximum score from 0 to "+MAX_SCORE+".");
      return {columnId,label,category,kind,maxPoints};
    }
    const taskId=checkId(String(item?.taskId||""),"Assessment task ID",128);
    if(linkedTasks.has(taskId))
      deny("invalid-argument","The same assessment cannot be linked to the class record twice.");
    linkedTasks.add(taskId);
    const task=assessmentMap.get(taskId);
    if(!task)deny("permission-denied","A linked assessment is unavailable or is no longer assigned to you.");
    const maxPoints=rubricTotal(task);
    if(!maxPoints)deny("failed-precondition","The linked assessment has no gradeable rubric total.");
    return {columnId,label,category,kind,taskId,maxPoints};
  });
}
function sourceKey(column){
  return column.kind==="assessment"?"assessment:"+column.taskId:"manual:"+String(column.maxPoints);
}

function createSchoolClassRecordService({db}){
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
    async function ownedAssessments(){
      const snap=await db.collection(prefix+"assessments")
        .where("offeringId","==",offeringId).limit(101).get();
      if(snap.size===101)deny("resource-exhausted","This class has too many assessment deployments for the current Class Record view.");
      return snap.docs.filter(doc=>{
        const data=doc.data();
        return data.schoolId===ctx.schoolId&&
          (data.reviewerUid||data.ownerUid)===ctx.uid&&
          data.status==="deployed"&&data.lifecycle!=="cancelled";
      }).map(doc=>({id:doc.id,...doc.data()}));
    }

    if(input.action==="workspace"){
      const offering=await verifyOffering();
      const [enrollments,assessmentRows,sheet,gradeSnap,manualSnap]=await Promise.all([
        db.collection(prefix+"enrollments").where("offeringId","==",offeringId).limit(MAX_CLASS_SIZE+1).get(),
        ownedAssessments(),
        sheetRef.get(),
        db.collection(prefix+"student_grades").where("offeringId","==",offeringId).limit(2001).get(),
        db.collection(prefix+"class_record_scores").where("offeringId","==",offeringId).limit(1001).get()
      ]);
      if(enrollments.size>MAX_CLASS_SIZE)
        deny("resource-exhausted","This class has more than "+MAX_CLASS_SIZE+" enrollment records. Pagination is required before Class Record can load it.");
      if(gradeSnap.size===2001)
        deny("resource-exhausted","Published grade history is too large for the current Class Record view.");
      if(manualSnap.size===1001)
        deny("resource-exhausted","Manual Class Record history is too large for the current view.");

      const active=enrollments.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&doc.data().status==="active");
      const people=await Promise.all(active.map(row=>db.doc(prefix+"people/"+row.data().personId).get()));
      const roster=active.map((row,index)=>{
        const person=people[index];
        return {
          enrollmentId:row.id,
          personId:row.data().personId,
          name:person.exists&&person.data().schoolId===ctx.schoolId?
            String(person.data().displayName||"Student"):"Unlinked student record"
        };
      }).sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:"base"}));

      const assessments=assessmentRows.map(task=>({
        taskId:task.id,title:String(task.title||"Untitled assessment"),
        submissionSource:task.submissionSource||"studio",
        lifecycle:task.lifecycle||"active",dueAt:millis(task.dueAt),
        maxPoints:rubricTotal(task)
      })).filter(task=>task.maxPoints>0)
        .sort((a,b)=>a.title.localeCompare(b.title,undefined,{sensitivity:"base"}));

      const taskIds=new Set(assessments.map(task=>task.taskId));
      const personIds=new Set(roster.map(row=>row.personId));
      const publishedGrades=gradeSnap.docs.map(doc=>doc.data()).filter(data=>
        data.schoolId===ctx.schoolId&&data.status==="published"&&
        taskIds.has(data.taskId)&&personIds.has(data.personId)
      ).map(data=>({
        taskId:data.taskId,personId:data.personId,
        awarded:Number(data.awarded)||0,total:Number(data.total)||0,
        revision:Number(data.revision)||1,publishedAt:millis(data.publishedAt)
      }));

      const columns=sheet.exists&&sheet.data().schoolId===ctx.schoolId&&
        Array.isArray(sheet.data().columns)?sheet.data().columns:[];
      const manualIds=new Set(columns.filter(column=>column.kind==="manual").map(column=>column.columnId));
      const manualScores=manualSnap.docs.map(doc=>doc.data()).filter(data=>
        data.schoolId===ctx.schoolId&&manualIds.has(data.columnId)&&personIds.has(data.personId)
      ).map(data=>({
        columnId:data.columnId,personId:data.personId,
        score:data.score===null?null:Number(data.score),
        revision:Number(data.revision)||1
      }));

      return {
        offering:{offeringId,programId:offering.programId,yearId:offering.yearId,
          termId:offering.termId,subjectId:offering.subjectId,sectionId:offering.sectionId},
        roster,assessments,columns,manualScores,publishedGrades,
        sheetRevision:sheet.exists&&sheet.data().schoolId===ctx.schoolId?
          Number(sheet.data().revision)||0:0
      };
    }

    if(input.action==="save_layout"){
      await verifyOffering();
      const assessmentRows=await ownedAssessments();
      const assessmentMap=new Map(assessmentRows.map(task=>[task.id,task]));
      const columns=cleanColumns(input.columns,assessmentMap);
      const expectedRevision=Number(input.expectedRevision);
      if(!Number.isInteger(expectedRevision)||expectedRevision<0)
        deny("invalid-argument","The Class Record layout revision is invalid.");
      const auditRef=db.collection(prefix+"class_record_audit").doc();
      let revision;
      await db.runTransaction(async tx=>{
        const [grant,offering,current]=await Promise.all([
          tx.get(grantRef),tx.get(offeringRef),tx.get(sheetRef)
        ]);
        if(!grant.exists||grant.data().schoolId!==ctx.schoolId||
           grant.data().teacherUid!==ctx.uid||grant.data().status!=="active"||
           !offering.exists||offering.data().schoolId!==ctx.schoolId)
          deny("permission-denied","Your class assignment changed. Reload Class Record before saving.");
        const previous=current.exists&&current.data().schoolId===ctx.schoolId?current.data():null;
        const priorRevision=previous?Number(previous.revision)||0:0;
        if(priorRevision!==expectedRevision)
          deny("failed-precondition","This Class Record layout changed. Reload it before saving your edit.");
        const oldColumns=Array.isArray(previous?.columns)?previous.columns:[];
        const nextById=new Map(columns.map(column=>[column.columnId,column]));
        for(const oldColumn of oldColumns){
          const next=nextById.get(oldColumn.columnId);
          if(!next)
            deny("failed-precondition","Existing Class Record columns cannot be deleted yet. Rename them or add a new column instead.");
          if(sourceKey(next)!==sourceKey(oldColumn))
            deny("failed-precondition","An existing column cannot change score source or maximum. Add a new column for a different source.");
        }
        revision=priorRevision+1;
        const values={schoolId:ctx.schoolId,offeringId,columns,revision,
          lastEditedByUid:ctx.uid,updatedAt:FieldValue.serverTimestamp()};
        if(previous)tx.update(sheetRef,values);
        else tx.create(sheetRef,{...values,createdByUid:ctx.uid,createdAt:FieldValue.serverTimestamp()});
        tx.create(auditRef,{schoolId:ctx.schoolId,offeringId,actorUid:ctx.uid,
          action:"class_record_layout_saved",revision,columnCount:columns.length,
          createdAt:FieldValue.serverTimestamp()});
      });
      return {offeringId,revision,columns};
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
      if(unique.size!==normalized.length)deny("invalid-argument","Each student may appear only once in a score save.");

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
module.exports={createSchoolClassRecordService,cleanColumns};
