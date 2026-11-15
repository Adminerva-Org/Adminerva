"use strict";
/**
 * Course-offering classroom stream for announcements and teacher posts.
 * Students may read only active enrolled offerings. Teachers may write only to
 * offerings they are actively assigned to; school administrators retain school scope.
 */
const {FieldValue}=require("firebase-admin/firestore");
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");
const {rowKey,checkId}=require("./school-academics.js");
const {writeSchoolNotification}=require("./school-notifications.js");

function deny(code,message){throw new TenantAccessError(code,message)}
function clean(value,max=4000){return String(value??"").trim().slice(0,max)}
function safeUrl(value){
  const text=clean(value,1000);if(!text)return "";
  try{const url=new URL(text);if(!["http:","https:"].includes(url.protocol))throw Error();return url.toString();}
  catch{deny("invalid-argument","Classroom links must use http or https.");}
}
function millis(value){return value?.toMillis?.()||null}
function createSchoolClassroomStreamService({db}){
 return async request=>{
  const input=request.data||{};
  const ctx=await getSchoolContext({db,request,schoolId:input.schoolId,roles:["student","teacher","school_admin"]});
  const prefix="schools/"+ctx.schoolId+"/",offeringId=checkId(input.offeringId,"Course offering ID",330);
  const offeringRef=db.doc(prefix+"course_offerings/"+offeringId);
  const memberRef=db.doc(prefix+"memberships/"+ctx.uid);
  const posts=db.collection(prefix+"classroom_posts");

  async function access(){
    const [member,offering]=await Promise.all([memberRef.get(),offeringRef.get()]);
    if(!member.exists||member.data().schoolId!==ctx.schoolId||member.data().status!=="active")
      deny("permission-denied","Your school access changed. Refresh before continuing.");
    if(!offering.exists||offering.data().schoolId!==ctx.schoolId||offering.data().status!=="active")
      deny("not-found","This classroom is not active.");
    const roles=Array.isArray(member.data().roles)?member.data().roles:[];
    const admin=roles.includes("school_admin"),teacher=roles.includes("teacher"),student=roles.includes("student");
    let canTeach=admin,canRead=admin;
    if(teacher&&!admin){
      const grant=await db.doc(prefix+"staff_assignments/"+rowKey(ctx.uid,offeringId)).get();
      canTeach=grant.exists&&grant.data().schoolId===ctx.schoolId&&grant.data().teacherUid===ctx.uid&&
        grant.data().offeringId===offeringId&&grant.data().status==="active";
      canRead=canRead||canTeach;
    }
    let personId="";
    if(student){
      personId=String(member.data().personId||"");
      if(personId){
        const enrollment=await db.doc(prefix+"enrollments/"+rowKey(personId,offeringId)).get();
        canRead=canRead||(enrollment.exists&&enrollment.data().schoolId===ctx.schoolId&&
          enrollment.data().personId===personId&&enrollment.data().offeringId===offeringId&&
          enrollment.data().status==="active");
      }
    }
    if(!canRead)deny("permission-denied","You do not have access to this classroom.");
    return {member:member.data(),offering:offering.data(),canTeach,personId};
  }

  const authority=await access();
  const action=input.action||"list";

  if(action==="list"){
    const snap=await posts.where("offeringId","==",offeringId).limit(101).get();
    if(snap.size===101)deny("resource-exhausted","This classroom stream requires pagination.");
    const items=snap.docs.map(doc=>({id:doc.id,...doc.data()}))
      .filter(item=>item.schoolId===ctx.schoolId&&item.status==="active")
      .sort((a,b)=>(millis(b.createdAt)||0)-(millis(a.createdAt)||0))
      .map(item=>({
        postId:item.id,kind:item.kind||"announcement",title:item.title||"",
        body:item.body||"",linkUrl:item.linkUrl||"",pinned:item.pinned===true,
        authorName:item.authorName||"Teacher",createdAt:millis(item.createdAt),
        updatedAt:millis(item.updatedAt),revision:Number(item.revision||1)
      }));
    const grantSnap=await db.collection(prefix+"staff_assignments").where("offeringId","==",offeringId).limit(31).get();
    const activeTeachers=grantSnap.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&doc.data().status==="active");
    const members=await Promise.all(activeTeachers.map(doc=>db.doc(prefix+"memberships/"+doc.data().teacherUid).get()));
    const teachers=members.map((member,index)=>{
      const grant=activeTeachers[index].data(),data=member.exists?member.data():null;
      return {uid:grant.teacherUid,name:data&&data.schoolId===ctx.schoolId?
        clean(data.displayName||data.name||"Teacher",140):"Teacher"};
    });
    return {offeringId,canPost:authority.canTeach,teachers,posts:items};
  }

  if(!authority.canTeach)
    deny("permission-denied","Only an assigned teacher or school administrator can publish classroom posts.");

  if(action==="create"){
    const kind=["announcement","post","material"].includes(input.kind)?input.kind:"announcement";
    const title=clean(input.title,160),body=clean(input.body,6000),linkUrl=safeUrl(input.linkUrl);
    if(!body&& !title)deny("invalid-argument","Write an announcement or post before publishing.");
    const postRef=posts.doc(),now=FieldValue.serverTimestamp(),authorName=
      clean(authority.member.displayName||authority.member.name||"Teacher",140)||"Teacher";
    await postRef.create({
      schoolId:ctx.schoolId,offeringId,authorUid:ctx.uid,authorName,kind,title,body,linkUrl,
      pinned:input.pinned===true,status:"active",revision:1,createdAt:now,updatedAt:now
    });
    const enrollmentSnap=await db.collection(prefix+"enrollments").where("offeringId","==",offeringId).limit(101).get();
    const enrollments=enrollmentSnap.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&doc.data().status==="active");
    const people=await Promise.all(enrollments.map(row=>db.doc(prefix+"people/"+row.data().personId).get()));
    await Promise.allSettled(people.map((person,index)=>{
      const data=person.data();if(!person.exists||data.schoolId!==ctx.schoolId||!data.authUid)return Promise.resolve();
      return writeSchoolNotification({
        db,schoolId:ctx.schoolId,uid:data.authUid,
        id:"classroom_post_"+postRef.id,
        title:title||"New classroom announcement",
        body:body.slice(0,260),type:"announcement",sourceId:postRef.id,
        target:"student-subject.html?offeringId="+encodeURIComponent(offeringId)
      });
    }));
    return {postId:postRef.id,status:"active"};
  }

  const postId=checkId(input.postId,"Classroom post ID",128),ref=posts.doc(postId);
  if(action==="update"){
    const current=await ref.get();
    if(!current.exists||current.data().schoolId!==ctx.schoolId||current.data().offeringId!==offeringId||
      current.data().status!=="active")deny("not-found","Classroom post not found.");
    const data=current.data();
    if(!ctx.roles.includes("school_admin")&&data.authorUid!==ctx.uid)
      deny("permission-denied","Only the author or a school administrator can edit this post.");
    const title=clean(input.title,160),body=clean(input.body,6000),linkUrl=safeUrl(input.linkUrl);
    if(!body&&!title)deny("invalid-argument","A classroom post cannot be empty.");
    const revision=Number(data.revision||1)+1;
    await ref.update({title,body,linkUrl,pinned:input.pinned===true,revision,updatedAt:FieldValue.serverTimestamp()});
    return {postId,revision,status:"active"};
  }

  if(action==="archive"){
    const current=await ref.get();
    if(!current.exists||current.data().schoolId!==ctx.schoolId||current.data().offeringId!==offeringId)
      deny("not-found","Classroom post not found.");
    if(!ctx.roles.includes("school_admin")&&current.data().authorUid!==ctx.uid)
      deny("permission-denied","Only the author or a school administrator can remove this post.");
    await ref.update({status:"archived",archivedAt:FieldValue.serverTimestamp(),archivedByUid:ctx.uid,
      updatedAt:FieldValue.serverTimestamp(),revision:Number(current.data().revision||1)+1});
    return {postId,status:"archived"};
  }

  deny("invalid-argument","Unknown classroom stream operation.");
 };
}
module.exports={createSchoolClassroomStreamService};