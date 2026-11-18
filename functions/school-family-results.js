"use strict";
const {checkedSchoolId,TenantAccessError}=require("./tenant-access.js");

function deny(code,message){throw new TenantAccessError(code,message)}
function verifiedEmail(request){
  const uid=request?.auth?.uid;
  const email=String(request?.auth?.token?.email||"").trim().toLowerCase();
  if(!uid||request?.auth?.token?.email_verified!==true||!email)
    deny("unauthenticated","Sign in with the verified parent/guardian email recorded by the school.");
  return {uid,email};
}
function millis(value){return value?.toMillis?.()||null;}

function createSchoolFamilyResultsService({db}){
  return async request=>{
    const input=request.data||{},identity=verifiedEmail(request);
    if(input.action==="schools"){
      const matches=await db.collectionGroup("people")
        .where("primaryGuardianEmail","==",identity.email).limit(101).get();
      if(matches.size===101)
        deny("resource-exhausted","Guardian access spans too many learner records. Contact the school.");
      const schoolIds=[...new Set(matches.docs.map(doc=>doc.data())
        .filter(data=>data.kind==="student"&&data.status==="active"&&typeof data.schoolId==="string")
        .map(data=>data.schoolId))];
      const schools=await Promise.all(schoolIds.map(id=>db.doc("platform_schools/"+id).get()));
      return {schools:schools.filter(doc=>doc.exists&&["active","pilot"].includes(doc.data().state))
        .map(doc=>({schoolId:doc.id,name:String(doc.data().name||doc.id).slice(0,140)}))
        .sort((a,b)=>a.name.localeCompare(b.name))};
    }

    if(input.action==="results"){
      const schoolId=checkedSchoolId(input.schoolId);
      const school=await db.doc("platform_schools/"+schoolId).get();
      if(!school.exists||!["active","pilot"].includes(school.data().state))
        deny("not-found","This school is not available for family results.");
      const root="schools/"+schoolId+"/";
      const learners=await db.collection(root+"people")
        .where("primaryGuardianEmail","==",identity.email).limit(101).get();
      if(learners.size===101)
        deny("resource-exhausted","Guardian access spans too many learner records. Contact the school.");
      const linked=learners.docs.filter(doc=>{
        const data=doc.data();
        return data.schoolId===schoolId&&data.kind==="student"&&data.status==="active"&&
          String(data.primaryGuardianEmail||"").toLowerCase()===identity.email;
      });
      if(!linked.length)
        deny("permission-denied","No active learner at this school is linked to your verified guardian email.");
      const rows=[];
      for(const learner of linked){
        const grades=await db.collection(root+"student_grades").where("personId","==",learner.id).limit(201).get();
        if(grades.size===201)
          deny("resource-exhausted","This learner's published grade history requires pagination.");
        const published=grades.docs.map(doc=>({id:doc.id,...doc.data()}))
          .filter(data=>data.schoolId===schoolId&&data.personId===learner.id&&data.status==="published");
        const tasks=await Promise.all(published.map(grade=>db.doc(root+"assessments/"+grade.taskId).get()));
        rows.push({
          personId:learner.id,
          studentName:String(learner.data().displayName||"Student").slice(0,140),
          grades:published.map((grade,index)=>({
            gradeId:grade.id,
            taskId:grade.taskId,
            title:tasks[index].exists?String(tasks[index].data().title||"Assessment").slice(0,240):"Assessment",
            subject:tasks[index].exists?String(tasks[index].data().subject||tasks[index].data().subjectId||"").slice(0,140):"",
            awarded:Number(grade.awarded||0),
            total:Number(grade.total||0),
            criteria:Array.isArray(grade.criteria)?grade.criteria:[],
            feedback:String(grade.feedback||"").slice(0,5000),
            publishedAt:millis(grade.publishedAt),
            lastCorrectedAt:millis(grade.lastCorrectedAt)
          })).sort((a,b)=>(b.publishedAt||0)-(a.publishedAt||0))
        });
      }
      return {schoolId,schoolName:String(school.data().name||schoolId).slice(0,140),learners:rows};
    }
    deny("invalid-argument","Unknown family results operation.");
  };
}
module.exports={createSchoolFamilyResultsService};
