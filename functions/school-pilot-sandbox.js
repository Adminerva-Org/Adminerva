"use strict";
/**
 * V4 private pilot sandbox and explicitly granted, read-only teacher preview.
 *
 * Sandboxed writes go ONLY to schools/{schoolId}/pilot_sandboxes/{uid}/records.
 * They never touch official assessments, student grades, rosters, schedules,
 * evidence, notifications or teacher-owned production resources.
 * Firestore browser rules already deny direct writes to schools/**.
 */
const {getAuth}=require("firebase-admin/auth");
const {createHash}=require("node:crypto");
const {runPilotExperience}=require("./pilot-sandbox-experience.js");
const {FieldValue}=require("firebase-admin/firestore");
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");

function deny(code,message){throw new TenantAccessError(code,message);}
const KINDS=new Set(["schedule","assessment","grade","lesson","admin_demo"]);
const RECORD_LIMIT=100;
function cleanText(input,max,label,required=true){
  if(typeof input!=="string"||input.length>max||(required&&!input.trim()))
    deny("invalid-argument",label+" is missing or too long.");
  return input.trim();
}
function uidValue(value){
  if(typeof value!=="string"||! /^[A-Za-z0-9_-]{1,128}$/.test(value))
    deny("invalid-argument","Invalid account identifier.");
  return value;
}
function recordId(value){
  if(typeof value!=="string"||! /^[A-Za-z0-9_-]{1,128}$/.test(value))
    deny("invalid-argument","Invalid sandbox record.");
  return value;
}
function grantId(ownerUid,viewerUid){
  return createHash("sha256").update(uidValue(ownerUid)+"|"+uidValue(viewerUid)).digest("hex");
}
function normalEmail(value){
  const email=cleanText(value,254,"Recipient email").toLowerCase();
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    deny("invalid-argument","Enter a valid teacher email.");
  return email;
}
function item(doc){
  const d=doc.data()||{};
  return {id:doc.id,kind:d.kind,title:d.title,details:d.details||"",
    createdAt:d.createdAt||null,updatedAt:d.updatedAt||null,
    version:d.version||1,payload:d.payload||null};
}
function activeMember(data){return data?.status==="active"&&Array.isArray(data.roles)&&data.roles.includes("teacher");}
function grantSummary(doc){
  const d=doc.data()||{};
  return {ownerUid:d.ownerUid,viewerUid:d.viewerUid,viewerEmail:d.viewerEmail,
    ownerLabel:d.ownerLabel||"Teacher workspace",expiresAt:d.expiresAt,active:d.active===true};
}
function createSchoolPilotSandboxService({db}){
  return async request=>{
    const input=request.data||{};
    const ctx=await getSchoolContext({db,request,schoolId:input.schoolId,roles:["teacher"]});
    const action=String(input.action||"overview");
    const prefix="schools/"+ctx.schoolId+"/";
    const records=db.collection(prefix+"pilot_sandboxes/"+ctx.uid+"/records");
    const grants=db.collection(prefix+"pilot_preview_grants");
    const time=new Date().toISOString();
    if(["preview_dashboard","seed_demo","create_demo_assessment","clone_preview",
      "sim_submit","sim_grade_draft","sim_grade_publish","sim_reopen",
      "save_demo_schedule","save_demo_lesson","sim_admin"].includes(action))
      return runPilotExperience({db,auth:getAuth(),ctx,input});

    if(action==="overview"){
      const [mine,shared,personal]=await Promise.all([
        grants.where("ownerUid","==",ctx.uid).limit(51).get(),
        grants.where("viewerUid","==",ctx.uid).limit(51).get(),
        records.orderBy("updatedAt","desc").limit(RECORD_LIMIT+1).get()
      ]);
      return {schoolId:ctx.schoolId,records:personal.docs.map(item),
        grantedByMe:mine.docs.map(grantSummary).filter(g=>g.active&&Date.parse(g.expiresAt)>Date.now()),
        sharedWithMe:shared.docs.map(grantSummary).filter(g=>g.active&&Date.parse(g.expiresAt)>Date.now()),
        recordLimit:RECORD_LIMIT};
    }
    if(action==="save_record"){
      const kind=cleanText(input.kind,30,"Record type");
      if(!KINDS.has(kind))deny("invalid-argument","Choose a supported sandbox record type.");
      const title=cleanText(input.title,140,"Title");
      const details=cleanText(input.details||"",12000,"Details",false);
      // Deliberately store free-form demonstration notes, not official data links.
      // No privileged collection or grading API is called from this operation.
      const givenId=input.recordId?recordId(input.recordId):null;
      let ref=givenId?records.doc(givenId):records.doc();
      if(givenId){
        const existing=await ref.get();
        if(!existing.exists||existing.data()?.ownerUid!==ctx.uid||existing.data()?.schoolId!==ctx.schoolId)
          deny("permission-denied","This sandbox record does not belong to you.");
        await ref.update({kind,title,details,updatedAt:time});
      }else{
        const count=await records.limit(RECORD_LIMIT).get();
        if(count.size>=RECORD_LIMIT)deny("resource-exhausted","Your private sandbox has reached the record limit.");
        await ref.create({schoolId:ctx.schoolId,ownerUid:ctx.uid,kind,title,details,createdAt:time,updatedAt:time});
      }
      return {record:item(await ref.get())};
    }
    if(action==="delete_record"){
      const ref=records.doc(recordId(input.recordId)),existing=await ref.get();
      if(!existing.exists||existing.data()?.ownerUid!==ctx.uid||existing.data()?.schoolId!==ctx.schoolId)
        deny("not-found","Your sandbox record was not found.");
      await ref.delete();
      return {deleted:true};
    }
    if(action==="grant_preview"){
      const email=normalEmail(input.viewerEmail);
      const viewer=await getAuth().getUserByEmail(email).catch(()=>null);
      if(!viewer?.emailVerified||viewer.disabled===true||viewer.uid===ctx.uid)
        deny("failed-precondition","The recipient must have a separate verified school account.");
      uidValue(viewer.uid);
      const member=await db.doc(prefix+"memberships/"+viewer.uid).get();
      if(!activeMember(member.data())||member.data()?.schoolId!==ctx.schoolId)
        deny("permission-denied","The recipient must be an active teacher in this school.");
      const expiry=new Date(Date.now()+30*86400000).toISOString();
      const ownerLabel=cleanText(input.ownerLabel||"Shared teacher preview",100,"Workspace label");
      const ref=grants.doc(grantId(ctx.uid,viewer.uid));
      const batch=db.batch();
      batch.set(ref,{schoolId:ctx.schoolId,ownerUid:ctx.uid,viewerUid:viewer.uid,
        viewerEmail:email,ownerLabel,active:true,expiresAt:expiry,
        updatedAt:FieldValue.serverTimestamp()},{merge:true});
      batch.create(db.collection(prefix+"pilot_preview_audit").doc(),{
        action:"preview_granted",schoolId:ctx.schoolId,ownerUid:ctx.uid,viewerUid:viewer.uid,
        actorUid:ctx.uid,createdAt:FieldValue.serverTimestamp()});
      await batch.commit();
      return {viewerEmail:email,expiresAt:expiry};
    }
    if(action==="revoke_preview"){
      const viewerUid=uidValue(input.viewerUid);
      const ref=grants.doc(grantId(ctx.uid,viewerUid));
      const previous=await ref.get();
      if(!previous.exists||previous.data()?.ownerUid!==ctx.uid)
        deny("not-found","Your preview grant was not found.");
      const batch=db.batch();
      batch.update(ref,{active:false,updatedAt:FieldValue.serverTimestamp()});
      batch.create(db.collection(prefix+"pilot_preview_audit").doc(),{
        action:"preview_revoked",schoolId:ctx.schoolId,ownerUid:ctx.uid,viewerUid,
        actorUid:ctx.uid,createdAt:FieldValue.serverTimestamp()});
      await batch.commit();
      return {revoked:true};
    }
    if(action==="preview"){
      const ownerUid=uidValue(input.ownerUid);
      if(ownerUid!==ctx.uid){
        const [grant,ownerMembership]=await Promise.all([
          grants.doc(grantId(ownerUid,ctx.uid)).get(),
          db.doc(prefix+"memberships/"+ownerUid).get()
        ]);
        const data=grant.data();
        if(!grant.exists||data?.schoolId!==ctx.schoolId||data?.active!==true||
           data?.viewerUid!==ctx.uid||data?.ownerUid!==ownerUid||
           !data.expiresAt||!Number.isFinite(Date.parse(data.expiresAt))||Date.parse(data.expiresAt)<=Date.now()||
           !activeMember(ownerMembership.data())||ownerMembership.data()?.schoolId!==ctx.schoolId)
          deny("permission-denied","Preview access is missing, expired, or revoked.");
      }
      // Metadata only: no student identities, grades, unpublished feedback,
      // evidence details, private connection tokens or raw planning content.
      const sources=[
        ["schedules","teacher_schedules"],
        ["assessmentBlueprints","assessment_blueprints"],
        ["assessments","assessments"],
        ["planning","teaching_resources"]
      ];
      const snapshots=await Promise.all(sources.map(async ([key,collection])=>
        [key,await db.collection(prefix+collection).where("ownerUid","==",ownerUid).limit(30).get()]));
      const preview={};
      for(const [key,snapshot] of snapshots)preview[key]=snapshot.docs.map(doc=>{
        const d=doc.data()||{};
        return {
          label:String(d.title||d.name||(key==="schedules"?"Teacher timetable":"Untitled")).slice(0,140),
          type:key,status:String(d.status||"").slice(0,30),
          schoolYear:String(d.schoolYear||"").slice(0,24),
          visibility:String(d.visibility||"").slice(0,28)
        };
      });
      return {readOnly:true,ownerUid,preview,scope:"teacher_owned_metadata_only"};
    }
    deny("invalid-argument","Unknown pilot sandbox operation.");
  };
}
module.exports={createSchoolPilotSandboxService};
