"use strict";
/**
 * Compatibility bridge from legacy Repository Management assessments into
 * school-scoped general Assessment Library blueprints.
 *
 * Only academic blueprint metadata is copied. Legacy deployments, submissions,
 * evidence, grades and publication state remain untouched and authoritative.
 */
const {FieldValue}=require("firebase-admin/firestore");
const {createHash}=require("node:crypto");
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");
const {createSchoolLegacyStudioReview}=require("./school-legacy-studio-review.js");
const {createSchoolLegacyGithubReview}=require("./school-legacy-github-review.js");
const {authorizedTeacherCustody,custodyMaximum}=require("./school-legacy-custody.js");
const {previewLegacyEvidenceMigration}=require("./school-legacy-migration-readiness.js");

function deny(code,message){throw new TenantAccessError(code,message)}
function clean(value,max=20000){return String(value??"").trim().slice(0,max)}
function legacyId(value){
  const id=String(value||"");
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(id))deny("invalid-argument","Invalid legacy assessment identifier.");
  return id;
}
function targetId(schoolId,uid,id){
  return "legacy_"+createHash("sha256").update(JSON.stringify([schoolId,uid,id])).digest("hex").slice(0,48);
}
function normalizeLine(value){
  return String(value||"").replace(/^[\s>*#-]+/,"").replace(/[*_\x60]/g,"").trim();
}
function fallbackRubric(maxScore){
  let remaining=Math.max(1,Math.min(2000,Number(maxScore)||20)),index=1,rows=[];
  while(remaining>0&&rows.length<20){
    const points=Math.min(100,remaining);
    rows.push({name:rows.length?"Legacy score segment "+index:"Legacy assessment score",points});
    remaining-=points;index++;
  }
  if(remaining>0)deny("failed-precondition","This legacy score maximum is too large for the general rubric model.");
  return rows;
}
function parseLegacyRubric(value,maxScore){
  const lines=String(value||"").split(/\r?\n/).map(normalizeLine).filter(Boolean);
  const rows=[];
  for(const line of lines){
    const match=line.match(/^(.*?)(?:\s*\|\s*|\s*[:–—-]\s*|\s*\()\s*(\d+(?:\.\d+)?)\s*(?:pts?|points?)?\)?\s*$/i);
    if(!match)continue;
    const name=clean(match[1].replace(/[.:;-]+$/,""),160),points=Number(match[2]);
    if(name&&Number.isFinite(points)&&points>0&&points<=100)rows.push({name,points});
  }
  const maximum=Number(maxScore)||0,sum=rows.reduce((total,row)=>total+row.points,0);
  if(rows.length&&rows.length<=20&&maximum>0&&Math.abs(sum-maximum)<0.001)return rows;
  return fallbackRubric(maximum||20);
}
function legacySubmissionSource(data={}){
  return data.schemaVersion===3||data.submissionSource==="studio"||data.assessmentFormat==="studio_code"
    ?"studio":"github";
}
function legacySummary(doc,imported=false){
  const data=doc.data();
  return {
    legacyAssessmentId:doc.id,title:clean(data.title||"Untitled legacy assessment",140),
    type:clean(data.type||"",80),subject:clean(data.subject||"",120),
    maxScore:Number(data.maxScore||0),assessmentFormat:clean(data.assessmentFormat||"",80),
    schemaVersion:Number(data.schemaVersion||0)||null,
    personalized:data.assessmentMode==="personalized"||data.personalizedTask?.enabled===true,
    deploymentCount:Array.isArray(data.deployments)?data.deployments.length:0,
    published:data.published===true,submissionSource:legacySubmissionSource(data),
    deployments:Array.isArray(data.deployments)?data.deployments.slice(0,40).map(item=>({
      id:clean(item?.id||"",120),section:clean(item?.section||"",160),
      deadline:item?.deadline||null,deadlineEnabled:item?.deadlineEnabled!==false,
      allowLateSubmissions:item?.allowLateSubmissions===true
    })):[],alreadyImported:imported
  };
}
function createSchoolAssessmentMigrationService({db}){
 const legacyStudioReview=createSchoolLegacyStudioReview({db,parseLegacyRubric});
 const legacyGithubReview=createSchoolLegacyGithubReview({db,parseLegacyRubric});
 return async request=>{
  const input=request.data||{},ctx=await getSchoolContext({db,request,schoolId:input.schoolId,roles:["teacher"]});
  if(/^legacy_review_(?:inbox|inspect|save_draft|publish|bulk_publish)$/.test(String(input.action||"")))
   return legacyStudioReview({ctx,input});
  if(/^legacy_github_(?:inbox|inspect|save_draft|publish|bulk_publish)$/.test(String(input.action||"")))
   return legacyGithubReview({ctx,input});
  if(input.action==="preview_evidence_migration")
   return previewLegacyEvidenceMigration({db,ctx,legacyAssessmentId:String(input.legacyAssessmentId||"")});
  const prefix="schools/"+ctx.schoolId+"/";
  const blueprints=db.collection(prefix+"assessment_blueprints");
  if(input.action==="list_legacy"){
    const snap=await db.collection("assessments").where("ownerUid","==",ctx.uid).limit(101).get();
    if(snap.size===101)deny("resource-exhausted","Legacy assessment import requires pagination.");
    const docs=snap.docs.filter(doc=>doc.data()?.title);
    const imported=await Promise.all(docs.map(doc=>blueprints.doc(targetId(ctx.schoolId,ctx.uid,doc.id)).get()));
    return {items:docs.map((doc,index)=>{
      const migrated=imported[index],data=migrated.exists?migrated.data():{};
      const expectedSource=legacySubmissionSource(doc.data());
      const complete=migrated.exists&&data.subject==="Computer Programming"&&data.defaultSubmissionSource===expectedSource;
      return legacySummary(doc,complete);
    }).sort((a,b)=>a.title.localeCompare(b.title))};
  }
  if(input.action==="list_legacy_deployments"){
    const snap=await db.collection("assessments").where("ownerUid","==",ctx.uid).limit(101).get();
    if(snap.size===101)deny("resource-exhausted","Legacy deployment list requires pagination.");
    const owned=snap.docs.filter(doc=>Array.isArray(doc.data()?.deployments)&&doc.data().deployments.length>0)
      .map(doc=>legacySummary(doc,true));
    // Delegated original assessments remain the historical source of truth.
    // Only the active Primary Teacher of a School Admin-verified offering may
    // see the original grades and submissions; no grade duplication.
    const grants=await db.collection(prefix+"legacy_assessment_custody")
      .where("teacherUid","==",ctx.uid).limit(51).get();
    if(grants.size>=51)
      deny("resource-exhausted","Historical custody sources require pagination.");
    const delegated=[];
    for(const ref of grants.docs){
      const grant=ref.data();
      if(grant.status!=="active"||grant.schoolId!==ctx.schoolId)continue;
      const source=await db.doc("assessments/"+grant.assessmentId).get();
      if(!source.exists)continue;
      const authorized=await authorizedTeacherCustody({
        db,schoolId:ctx.schoolId,teacherUid:ctx.uid,
        assessmentId:grant.assessmentId,offeringId:grant.offeringId,task:source.data()
      });
      if(!authorized||legacySubmissionSource(source.data())!=="github")continue;
      delegated.push({...legacySummary(source,true),maxScore:custodyMaximum(source.data(),authorized.grant),legacyOfferingId:grant.offeringId,
        custodyApproved:true,originalSection:grant.originalSection,deploymentCount:1});
    }
    return {items:[...owned,...delegated].sort((a,b)=>a.title.localeCompare(b.title))};
  }
  if(input.action==="import_legacy"){
    const id=legacyId(input.legacyAssessmentId),sourceRef=db.doc("assessments/"+id),
      targetRef=blueprints.doc(targetId(ctx.schoolId,ctx.uid,id)),
      privateRef=db.doc("assessment_private/"+id),
      auditRef=db.collection(prefix+"resource_audit").doc();
    const [source,privateDoc]=await Promise.all([sourceRef.get(),privateRef.get()]);
    if(!source.exists||source.data().ownerUid!==ctx.uid)
      deny("permission-denied","Only your own legacy repository assessments can be imported.");
    const legacy=source.data(),title=clean(legacy.title,140),submissionSource=legacySubmissionSource(legacy);
    if(!title)deny("failed-precondition","The legacy assessment has no usable title.");
    const maximum=Number(legacy.maxScore||20);
    if(!Number.isFinite(maximum)||maximum<=0||maximum>2000)
      deny("failed-precondition","The legacy assessment maximum score cannot be represented safely.");
    const rubric=parseLegacyRubric(legacy.evalCriteria,maximum);
    const taskContext=clean(legacy.taskContext||legacy.description||"",16000);
    const rubricReference=clean(legacy.evalCriteria||"",3500);
    const instructions=clean(taskContext+
      (rubricReference?"\n\nLegacy published rubric reference:\n"+rubricReference:""),20000);
    const description=clean(
      "Imported from Repository Management"+(legacy.subject?" · "+legacy.subject:"")+
      (legacy.type?" · "+legacy.type:"")+
      ". Historical deployments, evidence and grades remain in the legacy workflow.",2000);
    const personalized=legacy.assessmentMode==="personalized"||legacy.personalizedTask?.enabled===true;
    const rawTarget=Number(legacy.personalizedTask?.poolTarget||legacy.personalizedTask?.poolSize||45);
    const target=Math.max(10,Math.min(600,Number.isFinite(rawTarget)?Math.round(rawTarget):45));
    const privateData=privateDoc.exists&&privateDoc.data().ownerUid===ctx.uid?privateDoc.data():{};
    const guidance=clean(privateData.personalization?.guidance||"",3000);
    const legacyRules=Array.isArray(privateData.rules)?privateData.rules.slice(0,40).map(rule=>
      clean((rule?.type?rule.type+": ":"")+String(rule?.value||""),400)).filter(Boolean):[];
    const checkingInstructions=clean([
      clean(privateData.systemPersona||legacy.systemPersona||"",6000),
      legacyRules.length?"Legacy checking rules:\n"+legacyRules.map(rule=>"- "+rule).join("\n"):""
    ].filter(Boolean).join("\n\n"),8000);
    let result;
    await db.runTransaction(async tx=>{
      const now=FieldValue.serverTimestamp();
      const existing=await tx.get(targetRef);
      if(existing.exists){
        const current=existing.data();
        const patch={};
        if(current.subject!=="Computer Programming")patch.subject="Computer Programming";
        if(current.defaultSubmissionSource!==submissionSource)patch.defaultSubmissionSource=submissionSource;
        if(!current.assessmentType)patch.assessmentType=clean(legacy.type||"Assessment",80);
        if(!current.legacyImport)patch.legacyImport={
          assessmentId:id,assessmentFormat:clean(legacy.assessmentFormat||"",80),
          schemaVersion:Number(legacy.schemaVersion||0)||null,
          origin:"repository_management",subject:"Computer Programming",defaultSubmissionSource:submissionSource
        };
        if(Object.keys(patch).length){
          patch.updatedAt=now;
          tx.update(targetRef,patch);
          tx.create(auditRef,{schoolId:ctx.schoolId,resourceId:targetRef.id,actorUid:ctx.uid,
            action:"legacy_assessment_consolidated",legacyAssessmentId:id,createdAt:now});
        }
        result={id:targetRef.id,alreadyImported:Object.keys(patch).length===0,title:current.title||title};return;
      }
      tx.create(targetRef,{
        title,description,instructions,rubric,checkingInstructions,
        subject:"Computer Programming",assessmentType:clean(legacy.type||"Assessment",80),
        defaultSubmissionSource:submissionSource,
        personalization:personalized?{
          enabled:true,mode:"ai_blueprint_pool_v1",variantTarget:target,variationGuidance:guidance
        }:{enabled:false,mode:"standard",variantTarget:0,variationGuidance:""},
        schoolId:ctx.schoolId,creatorUid:ctx.uid,ownerUid:ctx.uid,
        visibility:"private",sharedWithUids:[],status:"draft",
        contentRevision:1,aclRevision:1,
        legacyImport:{
          assessmentId:id,assessmentFormat:clean(legacy.assessmentFormat||"",80),
          schemaVersion:Number(legacy.schemaVersion||0)||null,
          origin:"repository_management",subject:"Computer Programming",defaultSubmissionSource:submissionSource
        },
        createdAt:now,updatedAt:now
      });
      tx.create(auditRef,{schoolId:ctx.schoolId,resourceId:targetRef.id,actorUid:ctx.uid,
        action:"legacy_assessment_imported",legacyAssessmentId:id,createdAt:now});
      result={id:targetRef.id,alreadyImported:false,title};
    });
    return result;
  }
  deny("invalid-argument","Unknown legacy assessment migration operation.");
 };
}
module.exports={createSchoolAssessmentMigrationService,parseLegacyRubric,targetId};
