"use strict";
/**
 * Read-only school-administrator oversight for Class Record.
 * Teachers remain the owners of score corrections and finalization changes.
 */
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");
const {checkId,rowKey}=require("./school-academics.js");
const {resolveHistoricalRoster,validOrigin}=require("./school-class-record-historical.js");
const {custodyRef,originalSections,normalized,historicalCustodianRecord,custodySourceDigest}=require("./school-legacy-custody.js");
const {FieldValue}=require("firebase-admin/firestore");
const {schemeMatchesOffering,schemeSpecificity}=require("./school-class-record.js");

const MAX_RECORDS=200;
const MAX_AUDIT_EVENTS=500;
const MAX_ASSIGNMENTS=500;
const MAX_SCHEMES=50;

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

function createSchoolClassRecordAdminService({db,resolveUsers=null}){
  return async request=>{
    const input=request.data||{};
    const ctx=await getSchoolContext({db,request,schoolId:input.schoolId,roles:["school_admin"]});
    const prefix="schools/"+ctx.schoolId+"/";

    if(["preview_legacy_custody","approve_legacy_custody","revoke_legacy_custody"].includes(input.action)){
      // School Admin verifies original provenance; Platform/System Admin never
      // silently acquires School Admin authority over historical grading.
      if(ctx.platformOverride)
        deny("permission-denied","Use an active school-administrator membership to approve historical academic custody.");
      const assessmentId=checkId(String(input.assessmentId||""),"Original assessment ID",128),
        offeringId=checkId(String(input.offeringId||""),"Official class offering",330);
      const originalRef=db.doc("assessments/"+assessmentId),
        offeringRef=db.doc(prefix+"course_offerings/"+offeringId),
        grantRef=custodyRef(db,ctx.schoolId,assessmentId,offeringId);
      if(input.action==="revoke_legacy_custody"){
        const reason=String(input.reason||"").trim();
        if(reason.length<20||reason.length>500)
          deny("invalid-argument","Explain the historical custody revocation (20–500 characters).");
        await db.runTransaction(async tx=>{
          const [grant,original,approver]=await Promise.all([
            tx.get(grantRef),tx.get(originalRef),tx.get(db.doc(prefix+"memberships/"+ctx.uid))
          ]);
          if(!approver.exists||approver.data().schoolId!==ctx.schoolId||
             approver.data().status!=="active"||
             !approver.data().roles?.includes("school_admin"))
            deny("permission-denied","A current active School Administrator must authorize custody changes.");
          if(!grant.exists||grant.data().schoolId!==ctx.schoolId||
            grant.data().assessmentId!==assessmentId||grant.data().offeringId!==offeringId||
            grant.data().status!=="active")
            deny("failed-precondition","No active historical custody grant exists for this class and assessment.");
          tx.update(grantRef,{status:"revoked",revokedAt:FieldValue.serverTimestamp(),
            revokedBySchoolAdminUid:ctx.uid,revokedReason:reason});
          tx.create(db.collection(prefix+"class_record_audit").doc(),{
            schoolId:ctx.schoolId,offeringId,assessmentId,actorUid:ctx.uid,
            action:"legacy_assessment_custody_revoked",reason,
            priorTeacherUid:grant.data().teacherUid,createdAt:FieldValue.serverTimestamp()
          });
        });
        return {status:"revoked",assessmentId,offeringId};
      }
      const [original,offering]=await Promise.all([originalRef.get(),offeringRef.get()]);
      if(!original.exists||!validOrigin(original.data(),ctx.schoolId)||
         !offering.exists||offering.data().schoolId!==ctx.schoolId)
        deny("not-found","Original assessment and official class must belong to the verified legacy school.");
      if(!historicalCustodianRecord(original.data()))
        deny("permission-denied","This is a teacher-owned private assessment, not an administrator-held legacy custody source.");
      const data=original.data(),classData=offering.data(),
        teacherUid=String(classData.primaryTeacherUid||"");
      if(!teacherUid||teacherUid===ctx.uid||data.ownerUid===teacherUid)
        deny("failed-precondition","Select an official class with a different active Primary Teacher. Already-owned assessments do not need custody delegation.");
      const sections=originalSections(data),identityOnly=sections.length===0;
      const section=identityOnly?"":String(input.originalSection||"").trim();
      if(!identityOnly&&!sections.some(value=>normalized(value)===normalized(section)))
        deny("failed-precondition","Choose an original section: "+sections.slice(0,12).join(", "));
      if(identityOnly&&(data.schemaVersion===3||data.submissionSource==="studio"||data.assessmentFormat==="studio_code"))
        deny("failed-precondition","Sectionless custody currently supports original Repository Management GitHub assessments only.");
      const maximum=Number(data.maxScore);
      if(!Number.isFinite(maximum)||maximum<=0||maximum>10000)
        deny("failed-precondition","The original assessment maximum score is invalid.");
      const [assignment,membership,enrollments]=await Promise.all([
        db.doc(prefix+"staff_assignments/"+rowKey(teacherUid,offeringId)).get(),
        db.doc(prefix+"memberships/"+teacherUid).get(),
        db.collection(prefix+"enrollments").where("offeringId","==",offeringId).limit(101).get()
      ]);
      if(!assignment.exists||assignment.data().schoolId!==ctx.schoolId||
         assignment.data().teacherUid!==teacherUid||assignment.data().offeringId!==offeringId||
         assignment.data().status!=="active"||
         !membership.exists||membership.data().schoolId!==ctx.schoolId||
         membership.data().status!=="active"||!membership.data().roles?.includes("teacher"))
        deny("permission-denied","The current Primary Teacher must have an active school appointment to this class.");
      if(enrollments.size>=101)
        deny("resource-exhausted","This class roster needs pagination before historical custody can be approved.");
      const active=enrollments.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&
        doc.data().status==="active"&&doc.data().offeringId===offeringId);
      const people=await Promise.all(active.map(doc=>db.doc(prefix+"people/"+doc.data().personId).get()));
      const roster=active.map((row,i)=>{
        const person=people[i].exists&&people[i].data().schoolId===ctx.schoolId?people[i].data():null;
        return {personId:row.data().personId,authUid:person?.authUid||"",
          legacyStudentIds:Array.isArray(person?.legacyStudentIds)?person.legacyStudentIds:[]};
      });
      if(!roster.length)deny("failed-precondition","The selected class has no official active student roster.");
      const identities=await resolveHistoricalRoster({db,schoolId:ctx.schoolId,roster,resolveUsers});
      const ids=[...identities.keys()];
      if(ids.length>350)deny("resource-exhausted","Historic identity reconciliation exceeds safe class size.");
      const validStudentIds=[];
      if(identityOnly)validStudentIds.push(...ids);
      else for(let offset=0;offset<ids.length;offset+=100){
        const chunk=ids.slice(offset,offset+100);
        const snapshots=await db.getAll(...chunk.map(id=>db.doc("students/"+id)));
        for(let i=0;i<chunk.length;i++){
          const record=snapshots[i].exists?snapshots[i].data():null;
          if(normalized(record?.section||record?.sectionName||record?.classSection)===normalized(section))
            validStudentIds.push(chunk[i]);
        }
      }
      let verifiedPeople=new Set(validStudentIds.map(id=>identities.get(id)));
      // A targetSections list could be only a teacher's unpublished
      // preparation. Require assessment-specific original student evidence
      // (a real submission receipt, or an existing grade) before delegation.
      const verifiedIds=new Set(validStudentIds);
      const [receiptPage,gradePage]=await Promise.all([
        db.collection("assessment_evidence").where("assessmentId","==",assessmentId).limit(501).get(),
        db.collection("student_grades").where("taskId","==",assessmentId).limit(501).get()
      ]);
      if(receiptPage.size>=501||gradePage.size>=501)
        deny("resource-exhausted","Historical assessment source evidence requires paginated verification.");
      const sourceProof=new Set();
      for(const receipt of receiptPage.docs){
        const evidence=receipt.data();
        if(evidence.assessmentId===assessmentId&&verifiedIds.has(evidence.studentId)&&
           evidence.submittedAt)sourceProof.add(evidence.studentId);
      }
      for(const row of gradePage.docs){
        const grade=row.data();
        if(grade.taskId===assessmentId&&verifiedIds.has(grade.studentId)&&
           grade.score!==undefined&&grade.score!==null&&
           Number.isFinite(Number(grade.score)))
          sourceProof.add(grade.studentId);
      }
      if(identityOnly){
        validStudentIds.splice(0,validStudentIds.length,...validStudentIds.filter(id=>sourceProof.has(id)));
        verifiedPeople=new Set(validStudentIds.map(id=>identities.get(id)));
      }
      const required=roster.length===1?1:Math.max(2,Math.ceil(roster.length/3));
      const preview={assessmentId,offeringId,originalTitle:String(data.title||""),
        originalSubject:String(data.subject||""),originalSection:section,
        sectionProof:identityOnly?"assessment_student_identity":"original_deployed_section",
        originalMaxScore:maximum,teacherUid,originalOwnerUid:String(data.ownerUid||""),
        verifiedStudentCount:verifiedPeople.size,requiredStudentCount:required,
        rosterCount:roster.length,originalSourceRecordCount:sourceProof.size,
        eligible:verifiedPeople.size>=required&&sourceProof.size>0,
        status:verifiedPeople.size<required?"identity_reconciliation_required":
          sourceProof.size===0?"original_submission_or_grade_not_found":"ready_for_school_admin_approval"};
      if(input.action==="preview_legacy_custody")return preview;
      if(!preview.eligible)
        deny("failed-precondition","Verify original roster identities AND at least one assessment-specific student submission or saved original grade before approving custody.");
      const reason=String(input.reason||"").trim();
      if(reason.length<30||reason.length>1000)
        deny("invalid-argument","Document the original teacher and section custody proof (30–1000 characters).");
      if(input.confirmTitle!==preview.originalTitle)
        deny("failed-precondition","Confirm the exact original assessment title before delegating custody.");
      await db.runTransaction(async tx=>{
        const [current,task,classRecord,appointment,member,approver,priorCustody]=await Promise.all([
          tx.get(grantRef),tx.get(originalRef),tx.get(offeringRef),
          tx.get(db.doc(prefix+"staff_assignments/"+rowKey(teacherUid,offeringId))),
          tx.get(db.doc(prefix+"memberships/"+teacherUid)),
          tx.get(db.doc(prefix+"memberships/"+ctx.uid)),
          tx.get(db.collection(prefix+"legacy_assessment_custody").where("assessmentId","==",assessmentId).limit(101))
        ]);
        if(!approver.exists||approver.data().schoolId!==ctx.schoolId||
           approver.data().status!=="active"||
           !approver.data().roles?.includes("school_admin"))
          deny("permission-denied","A current active School Administrator must authorize custody changes.");
        if(current.exists&&current.data().status==="active")
          deny("already-exists","This legacy source is already verified for this offering.");
        if(priorCustody.size>=101)deny("resource-exhausted","Historical custody needs paginated reconciliation.");
        const selected=new Set(validStudentIds);
        if(priorCustody.docs.some(doc=>{
          const other=doc.data();
          return other.schoolId===ctx.schoolId&&other.offeringId!==offeringId&&
            (identityOnly||other.sectionProof==="assessment_student_identity")&&
            (other.verifiedLegacyStudentIds||[]).some(id=>selected.has(id));
        }))deny("failed-precondition","An original student record is already reserved for another official class. Reconcile the earlier custody before linking.");
        if(!task.exists||!historicalCustodianRecord(task.data())||
           task.data().schoolId&&task.data().schoolId!==ctx.schoolId||
           String(task.data().title||"")!==preview.originalTitle||
           String(task.data().ownerUid||"")!==preview.originalOwnerUid||
           String(task.data().subject||"")!==preview.originalSubject||
           custodySourceDigest(task.data())!==custodySourceDigest(data)||
           Number(task.data().maxScore)!==maximum||
           (identityOnly?originalSections(task.data()).length!==0:
             !originalSections(task.data()).some(x=>normalized(x)===normalized(section)))||
           !classRecord.exists||classRecord.data().schoolId!==ctx.schoolId||
           classRecord.data().primaryTeacherUid!==teacherUid||
           !appointment.exists||appointment.data().status!=="active"||
           appointment.data().teacherUid!==teacherUid||appointment.data().offeringId!==offeringId||
           !member.exists||member.data().status!=="active"||
           !member.data().roles?.includes("teacher"))
          deny("failed-precondition","Original assessment or official teacher assignment changed during custody review.");
        tx.set(grantRef,{schoolId:ctx.schoolId,assessmentId,offeringId,teacherUid,
          originalOwnerUid:preview.originalOwnerUid,originalTitle:preview.originalTitle,
          originalSubject:preview.originalSubject,originalSection:section,sectionProof:preview.sectionProof,
          originalMaxScore:maximum,sourceDigest:custodySourceDigest(data),
          verifiedLegacyStudentIds:[...new Set(validStudentIds)].sort(),
          verifiedPersonCount:verifiedPeople.size,rosterCount:roster.length,
          status:"active",reviewReason:reason,reviewedBySchoolAdminUid:ctx.uid,
          reviewedAt:FieldValue.serverTimestamp(),revision:Number(current.data()?.revision||0)+1});
        tx.create(db.collection(prefix+"class_record_audit").doc(),{
          schoolId:ctx.schoolId,offeringId,assessmentId,actorUid:ctx.uid,
          action:"legacy_assessment_custody_approved",teacherUid,
          originalSection:section,sectionProof:preview.sectionProof,verifiedPersonCount:verifiedPeople.size,reason,
          createdAt:FieldValue.serverTimestamp()
        });
      });
      return {...preview,status:"active",approved:true};
    }

    if(input.action==="overview"){
      const records=await db.collection(prefix+"class_records").limit(MAX_RECORDS+1).get();
      if(records.size>MAX_RECORDS)
        deny("resource-exhausted","Class Record oversight requires pagination for more than "+MAX_RECORDS+" records.");
      const rows=records.docs.filter(doc=>doc.data().schoolId===ctx.schoolId);
      const offeringIds=rows.map(doc=>doc.id);
      const [offeringDocs,finalizationDocs,assignments,schemes]=await Promise.all([
        Promise.all(offeringIds.map(id=>db.doc(prefix+"course_offerings/"+id).get())),
        Promise.all(offeringIds.map(id=>db.doc(prefix+"class_record_finalizations/"+id).get())),
        db.collection(prefix+"staff_assignments").where("status","==","active").limit(MAX_ASSIGNMENTS+1).get(),
        db.collection(prefix+"grading_schemes").where("status","==","active").limit(MAX_SCHEMES+1).get()
      ]);
      if(assignments.size>MAX_ASSIGNMENTS)
        deny("resource-exhausted","Active teacher assignments require pagination before Class Record oversight can load.");
      if(schemes.size>MAX_SCHEMES)
        deny("resource-exhausted","Active grading policies require pagination before Class Record oversight can load.");
      const activeSchemes=schemes.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&doc.data().status==="active");

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

      function gradingPolicyStatus(offering){
        if(!offering?.termId)return {state:"missing",label:"No grading policy",schemeId:null,schemeName:null};
        const periodType=String(terms.get(offering.termId)?.periodType||"term").trim().toLowerCase();
        const matches=activeSchemes.filter(doc=>
          schemeMatchesOffering(doc.data().applicability||{},offering,periodType))
          .map(doc=>({
            schemeId:doc.id,name:String(doc.data().name||"School grading policy"),
            revision:Number(doc.data().revision)||1,
            score:schemeSpecificity(doc.data().applicability||{})
          }))
          .sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name,undefined,{sensitivity:"base"}));
        if(!matches.length)return {state:"missing",label:"No grading policy",schemeId:null,schemeName:null};
        const topScore=matches[0].score,top=matches.filter(row=>row.score===topScore);
        if(top.length>1)return {
          state:"ambiguous",label:"Policy conflict",schemeId:null,schemeName:null,
          conflicts:top.map(row=>({schemeId:row.schemeId,name:row.name,revision:row.revision}))
        };
        return {state:"resolved",label:top[0].name,schemeId:top[0].schemeId,
          schemeName:top[0].name,revision:top[0].revision,specificity:top[0].score};
      }

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
          gradingPolicy:gradingPolicyStatus(offering),
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
