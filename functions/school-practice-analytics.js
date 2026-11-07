"use strict";
/**
 * Adminerva 4.0 teacher/admin Practice analytics.
 *
 * Reads canonical school roster/enrollment and school-scoped Practice season
 * records only. It never queries legacy global student/practice collections.
 */
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");

function deny(code,message){throw new TenantAccessError(code,message)}
function id(value,label="Identifier",max=128){
  if(typeof value!=="string"||!new RegExp("^[A-Za-z0-9_-]{1,"+max+"}$").test(value))
    deny("invalid-argument","Invalid "+label.toLowerCase()+".");
  return value;
}
async function seasonId(){
  const rules=await import("./practice-season.mjs");
  return rules.PRACTICE_SEASON;
}
function createSchoolPracticeAnalyticsService({db}){
 return async request=>{
  const input=request.data||{};
  const ctx=await getSchoolContext({db,request,schoolId:input.schoolId,roles:["teacher","school_admin"]});
  const prefix="schools/"+ctx.schoolId+"/";
  const teacher=ctx.roles.includes("teacher"),admin=ctx.roles.includes("school_admin");
  const schoolRef=db.doc("platform_schools/"+ctx.schoolId);
  const memberRef=db.doc(prefix+"memberships/"+ctx.uid);

  async function currentAuthority(){
    const [school,member]=await Promise.all([schoolRef.get(),memberRef.get()]);
    if(!school.exists||school.data().state!=="active"||!member.exists||
       member.data().schoolId!==ctx.schoolId||member.data().status!=="active")
      deny("permission-denied","Your school access changed. Refresh before continuing.");
    const roles=Array.isArray(member.data().roles)?member.data().roles:[];
    if(!roles.some(role=>["teacher","school_admin"].includes(role)))
      deny("permission-denied","Practice analytics requires active teaching or school administration access.");
    return roles;
  }
  async function allowedSections(){
    await currentAuthority();
    const offeringSnap=await db.collection(prefix+"course_offerings").limit(501).get();
    if(offeringSnap.size===501)
      deny("resource-exhausted","Course offering list requires pagination before Practice analytics can continue.");
    const activeOfferings=offeringSnap.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&
      doc.data().status==="active");
    let allowed=new Set();
    if(admin){
      for(const doc of activeOfferings)if(doc.data().sectionId)allowed.add(doc.data().sectionId);
    }else if(teacher){
      const grants=await db.collection(prefix+"staff_assignments")
        .where("teacherUid","==",ctx.uid).limit(201).get();
      if(grants.size===201)
        deny("resource-exhausted","Teaching assignment list requires pagination.");
      const activeOfferingIds=new Set(activeOfferings.map(doc=>doc.id));
      for(const grant of grants.docs){
        const data=grant.data();
        if(data.schoolId===ctx.schoolId&&data.status==="active"&&
           activeOfferingIds.has(data.offeringId)&&data.sectionId)allowed.add(data.sectionId);
      }
    }
    const sectionIds=[...allowed].sort();
    const docs=await Promise.all(sectionIds.map(sectionId=>db.doc(prefix+"sections/"+sectionId).get()));
    return sectionIds.map((sectionId,index)=>({
      sectionId,
      name:docs[index].exists&&docs[index].data().schoolId===ctx.schoolId?
        String(docs[index].data().name||sectionId).slice(0,140):sectionId
    }));
  }

  if((input.action||"sections")==="sections"){
    const sections=await allowedSections();
    return {schoolId:ctx.schoolId,sections};
  }

  if(input.action==="section"){
    const sectionId=id(input.sectionId,"Section ID",128);
    const sections=await allowedSections();
    const section=sections.find(item=>item.sectionId===sectionId);
    if(!section)deny("permission-denied","This class is not in your current school Practice analytics scope.");
    const currentSeason=await seasonId();
    const enrollments=await db.collection(prefix+"enrollments")
      .where("sectionId","==",sectionId).limit(501).get();
    if(enrollments.size===501)
      deny("resource-exhausted","This class roster requires pagination before Practice analytics can continue.");
    const active=enrollments.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&
      doc.data().status==="active");
    const byPerson=new Map();
    for(const row of active){
      const personId=row.data().personId;
      if(typeof personId==="string"&&!byPerson.has(personId))byPerson.set(personId,row.data());
    }
    const personIds=[...byPerson.keys()];
    const people=await Promise.all(personIds.map(personId=>db.doc(prefix+"people/"+personId).get()));
    const roster=[];
    people.forEach((person,index)=>{
      if(!person.exists)return;
      const data=person.data();
      if(data.schoolId!==ctx.schoolId||data.kind!=="student"||data.status!=="active")return;
      roster.push({
        personId:person.id,
        uid:typeof data.authUid==="string"?data.authUid:null,
        displayName:String(data.displayName||"Student").slice(0,140)
      });
    });
    const rankings=await db.collection(prefix+"practice_class_season_rankings")
      .where("sectionId","==",sectionId).limit(501).get();
    if(rankings.size===501)
      deny("resource-exhausted","Practice ranking data requires pagination.");
    const scoreByUid=new Map();
    for(const row of rankings.docs){
      const data=row.data();
      if(data.schoolId!==ctx.schoolId||data.sectionId!==sectionId||
         data.season!==currentSeason||typeof data.ownerUid!=="string")continue;
      scoreByUid.set(data.ownerUid,{
        alias:String(data.alias||"").slice(0,24),
        points:Number.isFinite(data.points)?data.points:0,
        completedCount:Number.isInteger(data.completedCount)?data.completedCount:0
      });
    }
    const rows=roster.map(student=>{
      const score=student.uid?scoreByUid.get(student.uid):null;
      return {
        personId:student.personId,displayName:student.displayName,
        accountLinked:Boolean(student.uid),
        alias:score?.alias||"",
        points:score?score.points:null,
        completedCount:score?score.completedCount:0,
        hasSeasonRecord:Boolean(score)
      };
    }).sort((a,b)=>a.displayName.localeCompare(b.displayName));
    const recorded=rows.filter(row=>row.hasSeasonRecord);
    return {
      schoolId:ctx.schoolId,section,season:currentSeason,rows,
      summary:{
        students:rows.length,
        recorded:recorded.length,
        points:recorded.reduce((sum,row)=>sum+(row.points||0),0),
        completedMissions:recorded.reduce((sum,row)=>sum+(row.completedCount||0),0)
      },
      note:"Practice Points are engagement/progress signals only and do not change assessment grades."
    };
  }
  deny("invalid-argument","Unknown school Practice analytics operation.");
 };
}
module.exports={createSchoolPracticeAnalyticsService};
