"use strict";
/**
 * Read-only school-administrator oversight for Class Record.
 * Teachers remain the owners of score corrections and finalization changes.
 */
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");
const {checkId}=require("./school-academics.js");

const MAX_RECORDS=200;
const MAX_AUDIT_EVENTS=500;
const MAX_ASSIGNMENTS=500;

function deny(code,message){throw new TenantAccessError(code,message)}
function millis(value){
  if(!value)return null;
  if(typeof value.toMillis==="function")return value.toMillis();
  if(value instanceof Date)return value.getTime();
  const numeric=Number(value);
  return Number.isFinite(numeric)?numeric:null;
}
function cleanVisibility(value){return value==="released"?"released":"hidden"}
async function docsById(db,prefix,collection,ids){
  const unique=[...new Set(ids.filter(Boolean))];
  const docs=await Promise.all(unique.map(id=>db.doc(prefix+collection+"/"+id).get()));
  return new Map(docs.filter(doc=>doc.exists).map(doc=>[doc.id,doc.data()]));
}
function catalogName(map,id,fallback){
  const row=map.get(id);
  return row&&typeof row.name==="string"&&row.name.trim()?row.name.trim():fallback;
}
function actionLabel(action){
  return ({
    class_record_layout_saved:"Layout / student visibility changed",
    class_record_manual_scores_saved:"Manual scores changed",
    class_record_cell_status_saved:"Learner score status changed",
    class_record_period_finalized:"Period grade finalized",
    class_record_final_grade_released:"Final Grade released",
    class_record_final_grade_withdrawn:"Final Grade release withdrawn"
  })[action]||String(action||"Class Record activity");
}

function createSchoolClassRecordAdminService({db}){
  return async request=>{
    const input=request.data||{};
    const ctx=await getSchoolContext({db,request,schoolId:input.schoolId,roles:["school_admin"]});
    const prefix="schools/"+ctx.schoolId+"/";

    if(input.action==="overview"){
      const records=await db.collection(prefix+"class_records").limit(MAX_RECORDS+1).get();
      if(records.size>MAX_RECORDS)
        deny("resource-exhausted","Class Record oversight requires pagination for more than "+MAX_RECORDS+" records.");
      const rows=records.docs.filter(doc=>doc.data().schoolId===ctx.schoolId);
      const offeringIds=rows.map(doc=>doc.id);
      const [offeringDocs,finalizationDocs,assignments]=await Promise.all([
        Promise.all(offeringIds.map(id=>db.doc(prefix+"course_offerings/"+id).get())),
        Promise.all(offeringIds.map(id=>db.doc(prefix+"class_record_finalizations/"+id).get())),
        db.collection(prefix+"staff_assignments").where("status","==","active").limit(MAX_ASSIGNMENTS+1).get()
      ]);
      if(assignments.size>MAX_ASSIGNMENTS)
        deny("resource-exhausted","Active teacher assignments require pagination before Class Record oversight can load.");

      const offerings=new Map(offeringDocs.filter(doc=>doc.exists&&doc.data().schoolId===ctx.schoolId)
        .map(doc=>[doc.id,doc.data()]));
      const finalizations=new Map(finalizationDocs.filter(doc=>doc.exists&&doc.data().schoolId===ctx.schoolId)
        .map(doc=>[doc.id,doc.data()]));
      const assignmentRows=assignments.docs.map(doc=>doc.data()).filter(data=>
        data.schoolId===ctx.schoolId&&offeringIds.includes(data.offeringId)&&
        data.status==="active"&&typeof data.teacherUid==="string");
      const teacherUids=[...new Set(assignmentRows.map(row=>row.teacherUid))];
      const teacherDocs=await Promise.all(teacherUids.map(uid=>db.doc(prefix+"memberships/"+uid).get()));
      const teachers=new Map(teacherDocs.filter(doc=>doc.exists&&doc.data().schoolId===ctx.schoolId)
        .map(doc=>[doc.id,String(doc.data().displayName||"Teacher")]));

      const offeringRows=[...offerings.values()];
      const [programs,years,terms,sections,subjects]=await Promise.all([
        docsById(db,prefix,"academic_programs",offeringRows.map(row=>row.programId)),
        docsById(db,prefix,"academic_years",offeringRows.map(row=>row.yearId)),
        docsById(db,prefix,"terms",offeringRows.map(row=>row.termId)),
        docsById(db,prefix,"sections",offeringRows.map(row=>row.sectionId)),
        docsById(db,prefix,"subjects",offeringRows.map(row=>row.subjectId))
      ]);

      const result=rows.map(doc=>{
        const sheet=doc.data(),offering=offerings.get(doc.id)||{},finalization=finalizations.get(doc.id)||null;
        const columns=Array.isArray(sheet.columns)?sheet.columns:[];
        const active=columns.filter(column=>column.archived!==true);
        const teacherNames=assignmentRows.filter(row=>row.offeringId===doc.id)
          .map(row=>teachers.get(row.teacherUid)||"Teacher")
          .sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:"base"}));
        return {
          offeringId:doc.id,offeringStatus:String(offering.status||"historical"),
          programName:catalogName(programs,offering.programId,"Program"),
          yearName:catalogName(years,offering.yearId,"School year"),
          termName:catalogName(terms,offering.termId,"Academic period"),
          sectionName:catalogName(sections,offering.sectionId,"Section"),
          subjectName:catalogName(subjects,offering.subjectId,"Subject"),
          teacherNames,
          sheetRevision:Number(sheet.revision)||0,
          updatedAt:millis(sheet.updatedAt),
          activeColumnCount:active.length,
          archivedColumnCount:columns.filter(column=>column.archived===true).length,
          manualColumnCount:active.filter(column=>column.kind==="manual").length,
          assessmentColumnCount:active.filter(column=>column.kind==="assessment").length,
          releasedColumnCount:active.filter(column=>cleanVisibility(column.studentVisibility)==="released").length,
          finalization:finalization?{
            revision:Number(finalization.revision)||0,
            sheetRevision:Number(finalization.sheetRevision)||0,
            finalizedAt:millis(finalization.finalizedAt),
            releasedRevision:Number(finalization.releasedRevision)||0,
            releasedAt:millis(finalization.releasedAt),
            layoutChangedSinceFinalization:(Number(finalization.sheetRevision)||0)!==(Number(sheet.revision)||0)
          }:null
        };
      }).sort((a,b)=>
        (a.subjectName+" "+a.sectionName+" "+a.termName).localeCompare(
          b.subjectName+" "+b.sectionName+" "+b.termName,undefined,{sensitivity:"base"}));
      return {records:result};
    }

    if(input.action==="audit"){
      const offeringId=checkId(String(input.offeringId||""),"Course offering ID",330);
      const [sheet,offering,audits]=await Promise.all([
        db.doc(prefix+"class_records/"+offeringId).get(),
        db.doc(prefix+"course_offerings/"+offeringId).get(),
        db.collection(prefix+"class_record_audit").where("offeringId","==",offeringId)
          .limit(MAX_AUDIT_EVENTS+1).get()
      ]);
      if(!sheet.exists||sheet.data().schoolId!==ctx.schoolId)
        deny("not-found","This Class Record is unavailable.");
      if(audits.size>MAX_AUDIT_EVENTS)
        deny("resource-exhausted","This Class Record has more than "+MAX_AUDIT_EVENTS+" audit events and requires pagination.");

      const offeringData=offering.exists&&offering.data().schoolId===ctx.schoolId?offering.data():{};
      const [programs,years,terms,sections,subjects]=await Promise.all([
        docsById(db,prefix,"academic_programs",[offeringData.programId]),
        docsById(db,prefix,"academic_years",[offeringData.yearId]),
        docsById(db,prefix,"terms",[offeringData.termId]),
        docsById(db,prefix,"sections",[offeringData.sectionId]),
        docsById(db,prefix,"subjects",[offeringData.subjectId])
      ]);

      const raw=audits.docs.map(doc=>({auditId:doc.id,...doc.data()}))
        .filter(row=>row.schoolId===ctx.schoolId&&row.offeringId===offeringId)
        .sort((a,b)=>(millis(b.createdAt)||0)-(millis(a.createdAt)||0));
      const actorUids=[...new Set(raw.map(row=>row.actorUid).filter(Boolean))];
      const actorDocs=await Promise.all(actorUids.map(uid=>db.doc(prefix+"memberships/"+uid).get()));
      const actorNames=new Map(actorDocs.filter(doc=>doc.exists&&doc.data().schoolId===ctx.schoolId)
        .map(doc=>[doc.id,String(doc.data().displayName||"School user")]));

      const personIds=[...new Set(raw.flatMap(row=>[
        row.personId,
        ...(Array.isArray(row.changes)?row.changes.map(change=>change?.personId):[])
      ]).filter(Boolean))];
      const peopleDocs=await Promise.all(personIds.map(id=>db.doc(prefix+"people/"+id).get()));
      const people=new Map(peopleDocs.filter(doc=>doc.exists&&doc.data().schoolId===ctx.schoolId)
        .map(doc=>[doc.id,String(doc.data().displayName||"Student")]));
      const columns=new Map((Array.isArray(sheet.data().columns)?sheet.data().columns:[])
        .map(column=>[column.columnId,column]));

      const events=raw.map(row=>({
        auditId:row.auditId,
        action:String(row.action||""),
        actionLabel:actionLabel(row.action),
        actorUid:row.actorUid||null,
        actorName:actorNames.get(row.actorUid)||"School user",
        createdAt:millis(row.createdAt),
        revision:Number(row.revision)||null,
        sheetRevision:Number(row.sheetRevision)||null,
        studentCount:Number(row.studentCount)||null,
        columnId:row.columnId||null,
        columnLabel:row.columnId?String(columns.get(row.columnId)?.label||"Class Record column"):null,
        personId:row.personId||null,
        personName:row.personId?people.get(row.personId)||"Student":null,
        beforeStatus:row.beforeStatus||null,
        afterStatus:row.afterStatus||null,
        gradeComputation:row.gradeComputation||null,
        categoryWeights:Array.isArray(row.categoryWeights)?row.categoryWeights:[],
        activeColumnCount:Number(row.activeColumnCount)||null,
        archivedColumnCount:Number(row.archivedColumnCount)||0,
        releasedColumnCount:Number(row.releasedColumnCount)||0,
        changes:Array.isArray(row.changes)?row.changes.map(change=>({
          personId:change.personId||null,
          personName:people.get(change.personId)||"Student",
          before:change.before===null||change.before===undefined?null:Number(change.before),
          after:change.after===null||change.after===undefined?null:Number(change.after)
        })):[],
        columnChanges:Array.isArray(row.columnChanges)?row.columnChanges.map(change=>({
          columnId:change.columnId||null,
          columnLabel:String(columns.get(change.columnId)?.label||change.after?.label||change.before?.label||"Class Record column"),
          type:change.type||"updated",
          before:change.before||null,after:change.after||null
        })):[]
      }));
      return {
        offering:{
          offeringId,
          programName:catalogName(programs,offeringData.programId,"Program"),
          yearName:catalogName(years,offeringData.yearId,"School year"),
          termName:catalogName(terms,offeringData.termId,"Academic period"),
          sectionName:catalogName(sections,offeringData.sectionId,"Section"),
          subjectName:catalogName(subjects,offeringData.subjectId,"Subject")
        },
        events
      };
    }

    deny("invalid-argument","Unknown Class Record administration operation.");
  };
}

module.exports={createSchoolClassRecordAdminService};
