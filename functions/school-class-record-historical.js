"use strict";
/**
 * Read-only historical Class Record projection. Root legacy data belongs to the
 * verified MCS migration origin; other tenants need an explicit provenance
 * mapping before root records may be exposed. No compatibility-mode write
 * access is restored by this adapter.
 */
const {legacyStudentRecordsForAccount,SCHOOL_ID}=require("./legacy-student-identity.js");
const HISTORICAL_SOURCE="legacy_historical";
const {originalActivityGrade}=require("./school-legacy-recovery-sources.js");
const {custodyId,custodyRef,validCustody,originalSections,identityOnlyCustody,custodyMaximum}=require("./school-legacy-custody.js");
const canonical=value=>String(value||"").trim().toLocaleLowerCase("en");
const courseName=value=>canonical(value).replace(/\s+/g," ").trim();
/**
 * Earlier Repository Management assessments were recorded under the generic
 * subject "Computer Programming", before the official SIS catalog split it
 * into Computer Programming 1 and Computer Programming 2. This is a *narrow*
 * historical catalog alias, not a prefix or fuzzy subject match. Ownership,
 * migration origin and original section still must match independently.
 */
function historicalSubjectMatches(originalSubject,offeringSubject){
  const source=courseName(originalSubject),target=courseName(offeringSubject);
  return !!source&&!!target&&(source===target||
    (source==="computer programming"&&/^computer programming (?:1|2|i|ii)$/.test(target)));
}
const validId=value=>typeof value==="string"&&value.length>0&&value.length<=220&&
  value!=="."&&value!==".."&&!/[\\/\u0000-\u001f\u007f]/.test(value)&&!/^__.*__$/.test(value);
const ms=value=>value?.toMillis?.()||(typeof value==="string"?Date.parse(value):Number(value))||0;
function validOrigin(task,schoolId){
  return schoolId===SCHOOL_ID&&task&&(!task.schoolId||task.schoolId===schoolId);
}
function historicalSections(task){
  const sections=originalSections(task);
  const distinct=new Map();
  for(const raw of sections){
    if(typeof raw!=="string"||raw.trim().length===0||raw.trim().length>160)continue;
    const value=raw.trim(),key=canonical(value);
    if(!distinct.has(key))distinct.set(key,value);
  }
  return [...distinct.values()];
}
function historicalMapping({task,taskId,schoolId,ownerUid,offering,offeringId,labels,
  sourceSectionName="",verifiedSection=false,verifiedSubject=false,custodyGrant=null}){
  const isOwner=task?.ownerUid===ownerUid;
  const delegated=!isOwner&&validCustody(custodyGrant,{
    schoolId,assessmentId:taskId,offeringId,teacherUid:ownerUid,task,
    section:sourceSectionName||custodyGrant?.originalSection||""
  });
  // A subject mismatch must be acknowledged against the exact original
  // assessment and independently verified through source student identities.
  // Caller-supplied flags alone never authorize a save.
  const matchesSubject=historicalSubjectMatches(task?.subject,labels?.subjectName);
  if(!validId(taskId)||!validOrigin(task,schoolId)||(!isOwner&&!delegated)||
     !labels.sectionName||!labels.subjectName||!labels.termName||!labels.yearName||
     !offering.termId||!offering.yearId||!offering.sectionId||!offering.subjectId||
     (!matchesSubject&&!delegated&&!(verifiedSubject===true&&typeof task.subject==="string"&&
       task.subject.trim().length>0&&task.subject.trim().length<=120)))return null;
  const sections=historicalSections(task),requested=String(sourceSectionName||labels.sectionName).trim();
  const identityOnly=delegated&&identityOnlyCustody(custodyGrant);
  const section=identityOnly?labels.sectionName:sections.find(s=>canonical(s)===canonical(requested));
  if(!section||canonical(section)!==canonical(labels.sectionName)&&verifiedSection!==true)return null;
  const maximum=custodyMaximum(task,delegated?custodyGrant:null);
  if(!Number.isFinite(maximum)||maximum<=0||maximum>10000)return null;
  return {schoolId,offeringId,yearId:offering.yearId,termId:offering.termId,
    sectionId:offering.sectionId,subjectId:offering.subjectId,
    sectionName:section,offeringSectionName:labels.sectionName,
    subjectName:labels.subjectName,ownerUid,
    ...(delegated?{custodyGrantId:custodyId(taskId,offeringId),taskId}:{}),
    ...(identityOnly?{sectionProof:"assessment_student_identity"}:{}),
    ...(matchesSubject?{}:{originalSubjectName:String(task.subject||"").trim()})};
}
/**
 * A historical section name can differ after SIS adoption or placement changes.
 * Never infer equivalence from similar labels. For a deliberate teacher-selected
 * original section, require verifiable current roster identities in the original
 * school students collection. Only the server can grant this mapping.
 */
async function verifiedHistoricalSectionMapping({db,schoolId,roster,resolveUsers,
  task,taskId,ownerUid,offering,offeringId,labels,sourceSectionName,
  confirmOriginalSubject="",custodyGrant=null}){
  const needsSubjectReview=!historicalSubjectMatches(task?.subject,labels?.subjectName);
  // The teacher must explicitly acknowledge the exact original subject before
  // attempting a different-subject source link; a guessed label cannot pass.
  if(needsSubjectReview&&(!task?.subject||confirmOriginalSubject!==task.subject.trim()))return null;
  const candidate=historicalMapping({task,taskId,schoolId,ownerUid,offering,offeringId,
    labels,sourceSectionName,verifiedSection:true,verifiedSubject:needsSubjectReview,
    custodyGrant});
  if(!candidate)return null;
  if(!needsSubjectReview&&canonical(candidate.sectionName)===canonical(labels.sectionName))
    return candidate;
  if(!Array.isArray(roster)||!roster.length)return null;
  const resolved=await resolveHistoricalRoster({db,schoolId,roster,resolveUsers});
  const studentIds=[...resolved.keys()];
  if(!studentIds.length||studentIds.length>300)return null;
  const matched=new Set();
  for(let offset=0;offset<studentIds.length;offset+=100){
    const ids=studentIds.slice(offset,offset+100);
    const docs=await db.getAll(...ids.map(id=>db.doc("students/"+id)));
    docs.forEach((doc,index)=>{
      if(!doc.exists)return;
      const data=doc.data();
      if(canonical(data?.section||data?.sectionName||data?.classSection)===canonical(candidate.sectionName))
        matched.add(resolved.get(ids[index]));
    });
  }
  const required=roster.length===1?1:Math.max(2,Math.ceil(roster.length/3));
  return matched.size>=required?{...candidate,identityVerifiedCount:matched.size,
    identityProof:"original_student_section",
    ...(needsSubjectReview?{subjectProof:"teacher_confirmed_original_subject_with_roster"}:{})}:null;
}
function mappingMatches(mapping,schoolId,offeringId,offering){
  return !!mapping&&mapping.schoolId===schoolId&&mapping.offeringId===offeringId&&
    mapping.yearId===offering.yearId&&mapping.termId===offering.termId&&
    mapping.sectionId===offering.sectionId&&mapping.subjectId===offering.subjectId&&
    !!mapping.sectionName&&!!mapping.subjectName&&validId(mapping.ownerUid)&&
    (!mapping.custodyGrantId||(validId(mapping.taskId)&&
      mapping.custodyGrantId===custodyId(mapping.taskId,offeringId)));
}
function legacySavedScoreEligible(data){
  // The school has accepted its saved legacy scores; a positive unresolved
  // points balance still cannot be treated as a completed numeric result.
  const pending=Number(data?.pending??0);
  return Number.isFinite(pending)&&pending===0;
}
function projectedGrade(data,{taskId,studentId,sectionName,allowDraft=false,originalMaximum=null,verifiedReceiptSection="",identityOnly=false}){
  if(!data||(!allowDraft&&data.published!==true)||data.taskId!==taskId||data.studentId!==studentId||
     (!identityOnly&&canonical(data.section||verifiedReceiptSection)!==canonical(sectionName)))return null;
  const maximum=data.maxScore??originalMaximum;
  if(data.score===null||data.score===undefined||data.score===""||maximum===null||maximum===undefined||maximum==="")return null;
  const awarded=Number(data.score),total=Number(maximum);
  if(!Number.isFinite(awarded)||!Number.isFinite(total)||total<=0||awarded<0||awarded>total)return null;
  return {awarded,total,revision:Number(data.gradeVersion)||1,
    publishedAt:ms(data.publishedAt)||ms(data.updatedAt)||ms(data.gradedAt)};
}
async function resolveHistoricalRoster({db,schoolId,roster,resolveUsers}){
  const mapped=new Map(),conflicts=new Set();
  if(schoolId!==SCHOOL_ID)return mapped;
  const pending=roster.filter(row=>row.authUid&&(!Array.isArray(row.legacyStudentIds)||!row.legacyStudentIds.some(validId)));
  let users=[];
  if(pending.length&&typeof resolveUsers==="function"){
    try{users=await resolveUsers([...new Set(pending.map(row=>row.authUid))]);}catch{
      // Direct canonical IDs remain valid; unresolved identities stay blank.
    }
  }
  const byUid=new Map(users.map(u=>[u.uid,u]));
  const resolveUser=typeof resolveUsers==="function"?async uid=>{
    const found=await resolveUsers([uid]);
    return found?.find(u=>u.uid===uid)||null;
  }:null;
  const resolved=await Promise.all(roster.map(async row=>{
    if(!row.personId||!row.authUid)return {row,ids:[]};
    let ids=Array.isArray(row.legacyStudentIds)?[...new Set(row.legacyStudentIds.filter(validId))]:[];
    if(!ids.length){
      const user=byUid.get(row.authUid);
      try{
        const result=await legacyStudentRecordsForAccount({db,schoolId,uid:row.authUid,
          email:user?.emailVerified===true?user.email:"",resolveUser,maxRecords:50});
        if(["canonical_person","canonical_previous_access","canonical_account_history"].includes(result.source)||
           (result.source==="canonical_email_fallback"&&result.records.length===1))
          ids=result.records.map(record=>record.id).filter(validId);
        // The existing server-owned access projection may retain legacy IDs
        // whose document names are not accepted by the older login resolver.
        // Require the exact active canonical membership and owner binding;
        // a recovered account cannot fall back to a current-email projection.
        if(!ids.length&&result.source.startsWith("canonical_")&&result.source!=="canonical_invalid"){
          const [membership,person,access]=await Promise.all([
            db.doc("schools/"+schoolId+"/memberships/"+row.authUid).get(),
            db.doc("schools/"+schoolId+"/people/"+row.personId).get(),
            db.doc("student_access/"+row.authUid).get()
          ]);
          const m=membership.exists?membership.data():null,p=person.exists?person.data():null,
            a=access.exists?access.data():null;
          const recovered=Array.isArray(p?.previousAuthUids)&&p.previousAuthUids.length>0;
          const recoverySafe=["canonical_person","canonical_previous_access","canonical_account_history"].includes(a?.identitySource);
          if(m?.schoolId===schoolId&&m.personId===row.personId&&m.status==="active"&&m.roles?.includes("student")&&
             p?.schoolId===schoolId&&p.kind==="student"&&p.status==="active"&&p.authUid===row.authUid&&
             a?.ownerUid===row.authUid&&(!a.schoolId||a.schoolId===schoolId)&&
             (recoverySafe||(!recovered&&a.identitySource==="canonical_email_fallback"&&
              user?.emailVerified===true&&canonical(a.email)===canonical(user.email)&&
              Array.isArray(a.studentIds)&&a.studentIds.length===1))){
            ids=Array.isArray(a.studentIds)?a.studentIds.filter(validId).slice(0,50):[];
          }
        }
      }catch{/* Unverified account history never creates a guessed grade. */}
    }
    return {row,ids};
  }));
  for(const {row,ids} of resolved){
    for(const id of new Set(ids)){
      if(mapped.has(id)&&mapped.get(id)!==row.personId)conflicts.add(id);
      else mapped.set(id,row.personId);
    }
  }
  for(const id of conflicts)mapped.delete(id);
  return mapped;
}
/**
 * Student views default to published grades. The teacher Class Record can
 * accept saved historical scores during legacy_allowed migration; that policy
 * is supplied only by the verified server-side school context, never a client.
 * The original grade publication flag is never changed.
 */
async function historicalPublishedGrades({db,schoolId,offeringId,offering,columns,roster,resolveUsers,
  diagnosticRows=null,viewerUid="",acceptSavedLegacy=false}){
  const linked=columns.filter(c=>c.kind==="assessment"&&c.assessmentSource===HISTORICAL_SOURCE);
  if(!linked.length||schoolId!==SCHOOL_ID)return [];
  const students=await resolveHistoricalRoster({db,schoolId,roster,resolveUsers});
  const mappedPeople=new Set(students.values()),output=[];
  for(const column of linked){
    const states=new Map(roster.map(person=>[person.personId,{
      columnId:column.columnId,personId:person.personId,status:mappedPeople.has(person.personId)?"missing_grade":"identity_unmapped"
    }]));
    const finish=()=>{if(Array.isArray(diagnosticRows))diagnosticRows.push(...states.values());};
    const mapping=column.historicalMapping;
    if(!validId(column.taskId)||!mappingMatches(mapping,schoolId,offeringId,offering)){
      for(const state of states.values())state.status="source_unavailable";
      finish();continue;
    }
    const task=await db.doc("assessments/"+column.taskId).get();
    const original=task.exists?task.data():null;
    const delegatedRef=mapping.custodyGrantId?
      custodyRef(db,schoolId,column.taskId,offeringId):null;
    const delegation=delegatedRef?await delegatedRef.get():null;
    const delegated=!!delegatedRef&&delegation?.exists&&
      validCustody(delegation.data(),{
        schoolId,assessmentId:column.taskId,offeringId,teacherUid:mapping.ownerUid,
        task:original,section:mapping.sectionName
      });
    const identityOnly=delegated&&identityOnlyCustody(delegation.data())&&mapping.sectionProof==="assessment_student_identity";
    const verifiedSubjectReview=!!original&&
      mapping.originalSubjectName===String(original.subject||"").trim()&&
      ((mapping.subjectProof==="teacher_confirmed_original_subject_with_roster"&&
        mapping.identityProof==="original_student_section"&&
        Number(mapping.identityVerifiedCount)>0)||delegated);
    if(!validOrigin(original,schoolId)||(!delegated&&original.ownerUid!==mapping.ownerUid)||
       (mapping.custodyGrantId&&!delegated)||
       (!identityOnly&&!historicalSections(original).some(section=>canonical(section)===canonical(mapping.sectionName)))||
       !(historicalSubjectMatches(original.subject,mapping.subjectName)||verifiedSubjectReview)){
      for(const state of states.values())state.status="source_unavailable";
      finish();continue;
    }
    const pairs=[...students.entries()],matches=new Map(),ambiguous=new Set(),missing=[],primaryPeople=new Set();
    const showDraft=Array.isArray(diagnosticRows)&&
      (viewerUid===original.ownerUid||delegated&&viewerUid===mapping.ownerUid);
    const assess=async (data,studentId,personId)=>{
      if(delegated&&!delegation.data().verifiedLegacyStudentIds.includes(studentId))return;
      const state=states.get(personId);
      if(!state)return;
      if(data?.taskId!==column.taskId||data?.studentId!==studentId){
        state.status="invalid_grade";return;
      }
      let verifiedReceiptSection="";
      // Early rows can omit their section. Only an exact original submission
      // receipt can supply it; never substitute a student's current section.
      if(!identityOnly&&!canonical(data.section)){
        const id=studentId+"_"+column.taskId;
        if(Buffer.byteLength(id,"utf8")<=1500){
          const collection=original.schemaVersion===3||original.submissionSource==="studio"||
            original.assessmentFormat==="studio_code"?"studio_submissions":"assessment_evidence";
          const receipt=await db.doc(collection+"/"+id).get();
          const evidence=receipt.exists?receipt.data():null;
          if(evidence?.assessmentId===column.taskId&&evidence.studentId===studentId)
            verifiedReceiptSection=String(evidence.section||"");
        }
      }
      if(!identityOnly&&canonical(data.section||verifiedReceiptSection)!==canonical(mapping.sectionName)){
        if(!matches.has(personId))state.status="section_mismatch";return;
      }
      const grade=projectedGrade(data,{taskId:column.taskId,studentId,sectionName:mapping.sectionName,
        allowDraft:true,originalMaximum:custodyMaximum(original,delegated?delegation.data():null),verifiedReceiptSection,identityOnly});
      if(!grade){if(!matches.has(personId))state.status="invalid_grade";return;}
      if(matches.has(personId)){ambiguous.add(personId);return;}
      matches.set(personId,{grade:{...grade,sourceType:HISTORICAL_SOURCE,taskId:column.taskId,personId},
        published:data.published===true,savedEligible:legacySavedScoreEligible(data)});
    };
    // Prefer the canonical original grade document. Historical Gradebook also
    // queries by taskId; use that same bounded lookup only for missing IDs.
    for(let i=0;i<pairs.length;i+=100){
      const batch=pairs.slice(i,i+100).filter(([id])=>Buffer.byteLength(id+"_"+column.taskId,"utf8")<=1500);
      if(!batch.length)continue;
      const snapshots=await db.getAll(...batch.map(([studentId])=>db.doc("student_grades/"+studentId+"_"+column.taskId)));
      for(let index=0;index<batch.length;index++){
        const [studentId,personId]=batch[index],snapshot=snapshots[index];
        if(snapshot?.exists){primaryPeople.add(personId);await assess(snapshot.data(),studentId,personId);}
        else missing.push([studentId,personId]);
      }
    }
    if(missing.length&&typeof db.collection==="function"){
      const fallback=await db.collection("student_grades").where("taskId","==",column.taskId).limit(1001).get();
      if(fallback.size>=1001){
        for(const [,personId] of missing)if(!matches.has(personId))states.get(personId).status="lookup_limit";
      }else{
        const missingIds=new Map(missing);
        for(const doc of fallback.docs){
          const data=doc.data(),personId=missingIds.get(data.studentId);
          if(personId){primaryPeople.add(personId);await assess(data,data.studentId,personId);}
        }
      }
    }
    // Exact-ID activity rows are a fallback, never a second grade. A primary
    // row (even invalid or unpublished) prevents an older activity from
    // replacing it. Title-only activity matches are deliberately excluded.
    if(missing.length&&typeof db.collection==="function"){
      const eligible=new Map(missing.filter(([,person])=>!primaryPeople.has(person)&&states.get(person)?.status!=="lookup_limit"));
      if(eligible.size){
        const activities=await db.collection("activity_grades").where("taskId","==",column.taskId).limit(1001).get();
        if(activities.size>=1001){
          for(const person of eligible.values())states.get(person).status="lookup_limit";
        }else{
          for(const doc of activities.docs){
            const data=originalActivityGrade(doc,column.taskId),personId=data&&eligible.get(data.studentId);
            if(personId)await assess(data,data.studentId,personId);
          }
        }
      }
    }
    for(const [personId,{grade,published,savedEligible}] of matches){
      const state=states.get(personId);
      if(ambiguous.has(personId)){state.status="ambiguous_grade";continue;}
      if(published){
        state.status=Math.abs(grade.total-Number(column.maxPoints))<0.0001?"published":"maximum_mismatch";
        output.push(grade);
      }else if(acceptSavedLegacy===true&&savedEligible){
        state.status=Math.abs(grade.total-Number(column.maxPoints))<0.0001?"legacy_accepted":"maximum_mismatch";
        output.push({...grade,legacyAccepted:true});
      }else if(showDraft){
        state.status=!savedEligible?"unresolved_points":Math.abs(grade.total-Number(column.maxPoints))<0.0001?"private_draft":"maximum_mismatch";
        if(state.status==="private_draft"){state.awarded=grade.awarded;state.total=grade.total;}
      }
    }
    finish();
  }
  return output;
}
module.exports={HISTORICAL_SOURCE,validOrigin,historicalSubjectMatches,historicalSections,historicalMapping,verifiedHistoricalSectionMapping,mappingMatches,projectedGrade,
  resolveHistoricalRoster,historicalPublishedGrades,legacySavedScoreEligible};
