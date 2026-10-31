"use strict";
/**
 * Adminerva 4.0 student school profile and repository configuration.
 *
 * Durable repository configuration is school/offering scoped. OAuth access
 * tokens are never accepted or stored by this service.
 */
const {FieldValue}=require("firebase-admin/firestore");
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");
const {rowKey,checkId}=require("./school-academics.js");

function deny(code,message){throw new TenantAccessError(code,message)}
function repository(value){
 if(typeof value!=="string"||value.length>300)
  deny("invalid-argument","Enter a GitHub repository URL.");
 let parsed;
 try{parsed=new URL(value.trim());}catch{deny("invalid-argument","Enter a valid GitHub repository URL.");}
 if(parsed.protocol!=="https:"||parsed.hostname!=="github.com"||parsed.username||parsed.password||
    parsed.search||parsed.hash)
  deny("invalid-argument","Use an HTTPS github.com repository URL.");
 const parts=parsed.pathname.split("/").filter(Boolean);
 if(parts.length!==2||parts.some(part=>!/^[A-Za-z0-9_.-]{1,100}$/.test(part)))
  deny("invalid-argument","Use a GitHub repository URL in owner/repository form.");
 const owner=parts[0],name=parts[1].replace(/\.git$/i,"");
 if(!name||!/^[A-Za-z0-9_.-]{1,100}$/.test(name))
  deny("invalid-argument","The GitHub repository name is invalid.");
 return {repository:owner+"/"+name,url:"https://github.com/"+owner+"/"+name};
}
function username(value){
 const text=String(value||"").trim();
 if(!text)return "";
 if(!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(text))
  deny("invalid-argument","GitHub username is invalid.");
 return text;
}
function createSchoolStudentProfileService({db}){
 return async request=>{
  const input=request.data||{};
  if(Object.hasOwn(input,"githubToken")||Object.hasOwn(input,"accessToken")||Object.hasOwn(input,"token"))
   deny("invalid-argument","OAuth tokens are session credentials and cannot be stored in the school profile.");
  const ctx=await getSchoolContext({db,request,schoolId:input.schoolId,roles:["student"]),
   prefix="schools/"+ctx.schoolId+"/",
   memberRef=db.doc(prefix+"memberships/"+ctx.uid),
   schoolRef=db.doc("platform_schools/"+ctx.schoolId);

  async function actor(){
   const [school,member]=await Promise.all([schoolRef.get(),memberRef.get()]);
   if(!school.exists||school.data().state!=="active"||!member.exists||
      member.data().schoolId!==ctx.schoolId||member.data().status!=="active"||
      !Array.isArray(member.data().roles)||!member.data().roles.includes("student"))
    deny("permission-denied","Your school student access changed. Refresh before continuing.");
   const personId=member.data().personId;
   if(typeof personId!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(personId))
    deny("failed-precondition","Your school account is not linked to a student person record.");
   const person=await db.doc(prefix+"people/"+personId).get();
   if(!person.exists||person.data().schoolId!==ctx.schoolId||person.data().kind!=="student"||
      person.data().status!=="active"||person.data().authUid!==ctx.uid)
    deny("permission-denied","Your linked school student record is inactive or changed.");
   const enrollmentSnap=await db.collection(prefix+"enrollments")
    .where("personId","==",personId).limit(101).get();
   if(enrollmentSnap.size===101)
    deny("resource-exhausted","Your school enrollment history requires pagination.");
   const enrollments=enrollmentSnap.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&
     doc.data().status==="active");
   const offerings=await Promise.all(enrollments.map(row=>
    db.doc(prefix+"course_offerings/"+row.data().offeringId).get()));
   const active=enrollments.filter((row,index)=>offerings[index].exists&&
     offerings[index].data().schoolId===ctx.schoolId&&offerings[index].data().status==="active");
   return {personId,person,member,enrollments:active,offerings:
    active.map(row=>offerings[enrollments.indexOf(row)])};
  }
  async function classRows(a){
   const ids=[...new Set(a.enrollments.flatMap(row=>{
     const data=row.data();return [
      ["academic_years",data.yearId],["terms",data.termId],
      ["subjects",data.subjectId],["sections",data.sectionId]
     ];
   }).map(pair=>pair.join("/")))];
   const docs=await Promise.all(ids.map(path=>db.doc(prefix+path).get()));
   const labels=new Map(ids.map((id,index)=>[id,docs[index].exists&&docs[index].data().schoolId===ctx.schoolId?
    String(docs[index].data().name||id.split("/").at(-1)).slice(0,140):id.split("/").at(-1)]));
   const configs=await Promise.all(a.enrollments.map(row=>
    db.doc(prefix+"student_repository_configs/"+rowKey(a.personId,row.data().offeringId)).get()));
   return a.enrollments.map((row,index)=>{
    const data=row.data(),config=configs[index].data();
    return {
     enrollmentId:row.id,offeringId:data.offeringId,
     yearId:data.yearId,termId:data.termId,subjectId:data.subjectId,sectionId:data.sectionId,
     year:labels.get("academic_years/"+data.yearId),
     term:labels.get("terms/"+data.termId),
     subject:labels.get("subjects/"+data.subjectId),
     section:labels.get("sections/"+data.sectionId),
     repository:config?.schoolId===ctx.schoolId&&config?.studentUid===ctx.uid?
      String(config.repository||""):"",
     repositoryUrl:config?.schoolId===ctx.schoolId&&config?.studentUid===ctx.uid?
      String(config.repositoryUrl||""):"",
     githubUsername:config?.schoolId===ctx.schoolId&&config?.studentUid===ctx.uid?
      String(config.githubUsername||""):"",
     repositoryRevision:config?.revision||0
    };
   }).sort((a,b)=>(a.section+" "+a.subject).localeCompare(b.section+" "+b.subject));
  }

  if((input.action||"my_profile")==="my_profile"){
   const a=await actor();
   return {
    schoolId:ctx.schoolId,personId:a.personId,
    displayName:String(a.person.data().displayName||"Student").slice(0,140),
    classes:await classRows(a),
    credentialPolicy:"GitHub OAuth access tokens are never stored in canonical school records."
   };
  }

  if(input.action==="save_repository"||input.action==="clear_repository"){
   const a=await actor(),offeringId=checkId(input.offeringId,"Course offering ID",330),
    enrollment=a.enrollments.find(row=>row.data().offeringId===offeringId);
   if(!enrollment)deny("permission-denied","Repository configuration is limited to your active course offerings.");
   const configRef=db.doc(prefix+"student_repository_configs/"+rowKey(a.personId,offeringId)),
    auditRef=db.collection(prefix+"student_profile_audit").doc();
   let parsed=null,gh="";
   if(input.action==="save_repository"){
    parsed=repository(input.repositoryUrl);gh=username(input.githubUsername);
   }
   let result;
   await db.runTransaction(async tx=>{
    const [school,member,person,currentEnrollment,offering,current]=await Promise.all([
     tx.get(schoolRef),tx.get(memberRef),tx.get(a.person.ref),
     tx.get(enrollment.ref),tx.get(db.doc(prefix+"course_offerings/"+offeringId)),
     tx.get(configRef)
    ]);
    if(!school.exists||school.data().state!=="active"||!member.exists||
       member.data().status!=="active"||!member.data().roles?.includes("student")||
       member.data().personId!==a.personId||!person.exists||person.data().status!=="active"||
       person.data().authUid!==ctx.uid||!currentEnrollment.exists||
       currentEnrollment.data().status!=="active"||currentEnrollment.data().personId!==a.personId||
       currentEnrollment.data().offeringId!==offeringId||!offering.exists||
       offering.data().schoolId!==ctx.schoolId||offering.data().status!=="active")
      deny("permission-denied","Your school enrollment changed. Reload Student Settings.");
    const now=FieldValue.serverTimestamp(),revision=(current.data()?.revision||0)+1;
    if(input.action==="clear_repository"){
     if(current.exists)tx.delete(configRef);
     tx.create(auditRef,{schoolId:ctx.schoolId,actorUid:ctx.uid,personId:a.personId,
      offeringId,action:"student_repository_configuration_cleared",previousRevision:current.data()?.revision||0,
      createdAt:now});
     result={offeringId,repository:"",repositoryUrl:"",githubUsername:"",revision};
    }else{
     const data={schoolId:ctx.schoolId,personId:a.personId,studentUid:ctx.uid,offeringId,
      repository:parsed.repository,repositoryUrl:parsed.url,githubUsername:gh,
      revision,updatedAt:now};
     if(current.exists)tx.update(configRef,data);
     else tx.create(configRef,{...data,createdAt:now});
     tx.create(auditRef,{schoolId:ctx.schoolId,actorUid:ctx.uid,personId:a.personId,
      offeringId,action:"student_repository_configuration_saved",
      repository:parsed.repository,revision,createdAt:now});
     result={offeringId,repository:parsed.repository,repositoryUrl:parsed.url,
      githubUsername:gh,revision};
    }
   });
   return result;
  }

  deny("invalid-argument","Unknown school student-profile operation.");
 };
}
module.exports={repository,username,createSchoolStudentProfileService};
