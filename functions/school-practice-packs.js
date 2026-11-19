"use strict";
/**
 * School-scoped teacher Practice Packs used by Student Games challenges.
 * Packs contain mission references only; mission scoring remains owned by the
 * school Practice season service.
 */
const {randomBytes}=require("node:crypto");
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");

function deny(code,message){throw new TenantAccessError(code,message);}
function clean(value,max=120){return typeof value==="string"?value.trim().slice(0,max):"";}
function checkedId(value,label="Identifier"){
  if(typeof value!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(value))
    deny("invalid-argument","Invalid "+label.toLowerCase()+".");
  return value;
}
function packId(){return "pp_"+randomBytes(12).toString("hex");}
function packView(doc,{id=doc.id,sectionIds=null,legacy=false}={}){
  const data=doc.data();
  return {
    id,title:clean(data.title,120),sectionIds:sectionIds||(
      Array.isArray(data.sectionIds)?data.sectionIds:[]),
    missionRefs:Array.isArray(data.missionRefs)?data.missionRefs:[],
    notes:clean(data.notes,1200),dueDate:clean(data.dueDate,10),
    status:data.status==="archived"?"archived":"active",legacy
  };
}
async function missionCatalog(){
  const library=await import("./practice-courses.mjs");
  return new Set(library.COURSES.flatMap(course=>course.missions.map(mission=>course.id+":"+mission.id)));
}
function createSchoolPracticePackService({db,Timestamp}){
  const prefix=schoolId=>"schools/"+schoolId+"/";
  async function studentSections(ctx){
    const base=prefix(ctx.schoolId),member=await db.doc(base+"memberships/"+ctx.uid).get(),
      personId=member.data()?.personId;
    if(typeof personId!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(personId))
      deny("permission-denied","Your student account is not linked to a school person record.");
    const person=await db.doc(base+"people/"+personId).get();
    if(!person.exists||person.data().schoolId!==ctx.schoolId||person.data().kind!=="student"||
       person.data().status!=="active"||person.data().authUid!==ctx.uid)
      deny("permission-denied","Your linked student record is inactive or changed.");
    const enrollmentSnap=await db.collection(base+"enrollments").where("personId","==",personId).limit(101).get();
    if(enrollmentSnap.size===101)deny("resource-exhausted","Your enrollment list needs school review.");
    const activeEnrollments=enrollmentSnap.docs.filter(row=>row.data().schoolId===ctx.schoolId&&row.data().status==="active");
    const offerings=await Promise.all(activeEnrollments.map(row=>db.doc(base+"course_offerings/"+row.data().offeringId).get()));
    return [...new Set(activeEnrollments.filter((row,index)=>offerings[index].exists&&
      offerings[index].data().schoolId===ctx.schoolId&&offerings[index].data().status==="active")
      .map(row=>row.data().sectionId).filter(Boolean))];
  }
  async function staffSections(ctx){
    const base=prefix(ctx.schoolId),offeringSnap=await db.collection(base+"course_offerings").limit(501).get();
    if(offeringSnap.size===501)deny("resource-exhausted","Course offering list requires pagination.");
    const active=offeringSnap.docs.filter(row=>row.data().schoolId===ctx.schoolId&&row.data().status==="active");
    const allowed=new Set();
    if(ctx.roles.includes("school_admin")||ctx.platformOverride){
      for(const row of active)if(row.data().sectionId)allowed.add(row.data().sectionId);
    }else{
      const grants=await db.collection(base+"staff_assignments").where("teacherUid","==",ctx.uid).limit(201).get();
      if(grants.size===201)deny("resource-exhausted","Teaching assignment list requires pagination.");
      const offeringIds=new Set(active.map(row=>row.id));
      for(const grant of grants.docs){
        const data=grant.data();
        if(data.schoolId===ctx.schoolId&&data.status==="active"&&offeringIds.has(data.offeringId)&&data.sectionId)
          allowed.add(data.sectionId);
      }
    }
    const ids=[...allowed].sort(),docs=await Promise.all(ids.map(sectionId=>db.doc(base+"sections/"+sectionId).get()));
    return ids.map((sectionId,index)=>({
      sectionId,
      name:docs[index].exists&&docs[index].data().schoolId===ctx.schoolId?
        clean(docs[index].data().name||sectionId,140):sectionId
    }));
  }
  async function listPacks(ctx,sectionIds,{includeArchived=false}={}){
    if(!sectionIds.length)return [];
    const base=prefix(ctx.schoolId),[snapshot,legacySnapshot,...sectionDocs]=await Promise.all([
      db.collection(base+"practice_packs").limit(501).get(),
      db.collection(base+"legacy_roots/practice_packs/documents").limit(501).get(),
      ...sectionIds.map(sectionId=>db.doc(base+"sections/"+sectionId).get())
    ]);
    if(snapshot.size===501||legacySnapshot.size===501)
      deny("resource-exhausted","Practice Pack list requires pagination.");
    const allowed=new Set(sectionIds),sectionNameById=new Map(sectionIds.map((id,index)=>[
      id,sectionDocs[index].exists?clean(sectionDocs[index].data().name||id,140):id
    ]));
    const canonical=snapshot.docs.filter(doc=>{
      const data=doc.data(),sections=Array.isArray(data.sectionIds)?data.sectionIds:[];
      return data.schoolId===ctx.schoolId&&sections.some(id=>allowed.has(id))&&
        (includeArchived||data.status==="active");
    }).map(doc=>packView(doc));
    const legacy=legacySnapshot.docs.flatMap(doc=>{
      const data=doc.data(),legacySections=Array.isArray(data.sectionIds)?data.sectionIds:[],
       matched=sectionIds.filter(id=>legacySections.includes(id)||legacySections.includes(sectionNameById.get(id)));
      if(!matched.length||(!includeArchived&&data.status!=="active"))return [];
      return [packView(doc,{id:"legacy_"+doc.id,sectionIds:matched,legacy:true})];
    });
    return [...canonical,...legacy].sort((a,b)=>String(a.dueDate||"9999").localeCompare(String(b.dueDate||"9999"))||a.title.localeCompare(b.title));
  }
  return async request=>{
    const input=request.data||{},action=clean(input.action||"student",40);
    if(action==="student"){
      const ctx=await getSchoolContext({db,request,schoolId:input.schoolId,roles:["student"]});
      const sectionIds=await studentSections(ctx),packs=await listPacks(ctx,sectionIds);
      return {schoolId:ctx.schoolId,sectionIds,packs};
    }
    const ctx=await getSchoolContext({db,request,schoolId:input.schoolId,roles:["teacher","school_admin"],allowDraftAdmin:true});
    const sections=await staffSections(ctx),allowed=new Set(sections.map(row=>row.sectionId));
    if(action==="sections")return {schoolId:ctx.schoolId,sections};
    const sectionId=checkedId(input.sectionId,"Section ID");
    if(!allowed.has(sectionId))deny("permission-denied","This section is outside your current Practice Pack scope.");
    if(action==="list")return {schoolId:ctx.schoolId,sectionId,packs:await listPacks(ctx,[sectionId],{includeArchived:true})};
    if(action==="save"){
      const title=clean(input.title,120),notes=clean(input.notes,1200),dueDate=clean(input.dueDate,10),
        missionRefs=[...new Set(Array.isArray(input.missionRefs)?input.missionRefs.map(value=>clean(value,180)).filter(Boolean):[])];
      if(!title)deny("invalid-argument","Add a Practice Pack title.");
      if(!missionRefs.length||missionRefs.length>120)deny("invalid-argument","Choose 1–120 Practice missions.");
      if(dueDate&&!/^\d{4}-\d{2}-\d{2}$/.test(dueDate))deny("invalid-argument","Use a valid due date.");
      const valid=await missionCatalog();
      if(missionRefs.some(ref=>!valid.has(ref)))deny("invalid-argument","One or more Practice missions are no longer in the current catalog.");
      const id=packId(),now=Timestamp.now();
      await db.doc(prefix(ctx.schoolId)+"practice_packs/"+id).create({
        id,schoolId:ctx.schoolId,ownerUid:ctx.uid,title,sectionIds:[sectionId],missionRefs,
        notes,dueDate,status:"active",createdAt:now,updatedAt:now
      });
      return {schoolId:ctx.schoolId,pack:{id,title,sectionIds:[sectionId],missionRefs,notes,dueDate,status:"active"}};
    }
    if(action==="archive"){
      const id=checkedId(input.packId,"Practice Pack ID"),ref=db.doc(prefix(ctx.schoolId)+"practice_packs/"+id),record=await ref.get();
      if(!record.exists||record.data().schoolId!==ctx.schoolId)deny("not-found","Practice Pack not found.");
      const sectionsOnPack=Array.isArray(record.data().sectionIds)?record.data().sectionIds:[];
      if(!sectionsOnPack.some(id=>allowed.has(id)))deny("permission-denied","This Practice Pack is outside your current scope.");
      await ref.update({status:"archived",updatedAt:Timestamp.now(),archivedBy:ctx.uid});
      return {schoolId:ctx.schoolId,packId:id,status:"archived"};
    }
    deny("invalid-argument","Unknown Practice Pack action.");
  };
}
module.exports={createSchoolPracticePackService};
