"use strict";
/** Verified course-roster capacity for class-scoped Studio personalization. */
const {FieldPath}=require("firebase-admin/firestore");
const {checkId,rowKey}=require("./school-academics.js");

class PersonalizationPlanningError extends Error{
 constructor(code,message){super(message);this.code=code;}
}
const deny=(code,message)=>{throw new PersonalizationPlanningError(code,message);};
const MIN_VARIANTS=10,MAX_VARIANTS=600,MAX_DEPLOY_CLASSES=20;

async function planPersonalizationForOfferings({db,schoolId,teacherUid,offeringIds,platformOverride=false}){
 if(!Array.isArray(offeringIds)||!offeringIds.length||offeringIds.length>MAX_DEPLOY_CLASSES)
  deny("invalid-argument","Select between 1 and 20 classes to calculate personalized variants.");
 const ids=offeringIds.map(id=>checkId(id,"Course offering ID",330));
 if(new Set(ids).size!==ids.length)
  deny("invalid-argument","Select each class only once.");
 const prefix="schools/"+schoolId+"/",details=[];
 for(const offeringId of ids){
  const [offering,grant]=await Promise.all([
   db.doc(prefix+"course_offerings/"+offeringId).get(),
   platformOverride?Promise.resolve(null):db.doc(prefix+"staff_assignments/"+rowKey(teacherUid,offeringId)).get()
  ]);
  if(!offering.exists||offering.data().schoolId!==schoolId||offering.data().status!=="active")
   deny("failed-precondition","A selected class is no longer active.");
  if(!platformOverride&&(!grant.exists||grant.data().schoolId!==schoolId||
      grant.data().teacherUid!==teacherUid||grant.data().offeringId!==offeringId||
      grant.data().status!=="active"))
   deny("permission-denied","You are not assigned to a selected class.");
  const query=db.collection(prefix+"enrollments").where("offeringId","==",offeringId)
   .orderBy(FieldPath.documentId());
  const personIds=new Set();let cursor=null;
  for(;;){
   let pageQuery=query.limit(200);
   if(cursor)pageQuery=pageQuery.startAfter(cursor);
   const page=await pageQuery.get();
   for(const record of page.docs){
    const data=record.data();
    if(data.schoolId===schoolId&&data.offeringId===offeringId&&
       data.status==="active"&&typeof data.personId==="string"&&data.personId)
      personIds.add(checkId(data.personId,"Student person ID",128));
   }
   if(personIds.size>MAX_VARIANTS)
    deny("resource-exhausted","A selected class exceeds the 600-variant limit. Contact your school administrator.");
   if(page.size<200)break;
   cursor=page.docs[page.docs.length-1];
  }
  const people=[...personIds];let students=0;
  for(let start=0;start<people.length;start+=80){
   const refs=people.slice(start,start+80).map(id=>db.doc(prefix+"people/"+id));
   const records=await db.getAll(...refs);
   for(const record of records){
    const data=record.exists?record.data():null;
    if(data&&data.schoolId===schoolId&&data.kind==="student"&&data.status==="active")students++;
   }
  }
  details.push({offeringId,students});
 }
 const largestClass=Math.max(0,...details.map(row=>row.students));
 return {classes:details,totalStudents:details.reduce((total,row)=>total+row.students,0),
   largestClass,requiredVariants:Math.max(MIN_VARIANTS,largestClass),
   uniqueness:"within_deployment",minimumPool:MIN_VARIANTS};
}
module.exports={planPersonalizationForOfferings,MIN_VARIANTS,MAX_VARIANTS,MAX_DEPLOY_CLASSES};
