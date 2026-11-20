"use strict";
/**
 * Shared course-offering classroom stream.
 * Enrollment grants students read access. Teaching assignments grant teachers
 * classroom authority. Participation settings never change official enrollment,
 * academic access, submissions, grades, or Class Record data.
 */
const {FieldValue}=require("firebase-admin/firestore");
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");
const {rowKey,checkId}=require("./school-academics.js");
const {writeSchoolNotification}=require("./school-notifications.js");

const PARTICIPATION=new Set(["teacher_only","comments_only","posts_comments"]);
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
  const comments=db.collection(prefix+"classroom_comments");
  const settingsRef=db.doc(prefix+"classroom_settings/"+offeringId);

  async function access(){
    const [member,offering]=await Promise.all([memberRef.get(),offeringRef.get()]);
    if(!member.exists||member.data().schoolId!==ctx.schoolId||member.data().status!=="active")
      deny("permission-denied","Your school access changed. Refresh before continuing.");
    if(!offering.exists||offering.data().schoolId!==ctx.schoolId||offering.data().status!=="active")
      deny("not-found","This classroom is not active.");
    const roles=Array.isArray(member.data().roles)?member.data().roles:[],
      admin=roles.includes("school_admin"),teacher=roles.includes("teacher"),student=roles.includes("student");
    let canTeach=admin,canRead=admin,personId="",person=null;
    if(teacher&&!admin){
      const grant=await db.doc(prefix+"staff_assignments/"+rowKey(ctx.uid,offeringId)).get();
      canTeach=grant.exists&&grant.data().schoolId===ctx.schoolId&&grant.data().teacherUid===ctx.uid&&
        grant.data().offeringId===offeringId&&grant.data().status==="active";
      canRead=canRead||canTeach;
    }
    if(student){
      personId=String(member.data().personId||"");
      if(personId){
        checkId(personId,"Student person ID",128);
        const [enrollment,personDoc]=await Promise.all([
          db.doc(prefix+"enrollments/"+rowKey(personId,offeringId)).get(),
          db.doc(prefix+"people/"+personId).get()
        ]);
        const linked=personDoc.exists&&personDoc.data().schoolId===ctx.schoolId&&
          personDoc.data().kind==="student"&&personDoc.data().status==="active"&&
          personDoc.data().authUid===ctx.uid;
        canRead=canRead||(linked&&enrollment.exists&&enrollment.data().schoolId===ctx.schoolId&&
          enrollment.data().personId===personId&&enrollment.data().offeringId===offeringId&&
          enrollment.data().status==="active");
        if(linked)person=personDoc.data();
      }
    }
    if(!canRead)deny("permission-denied","You do not have access to this classroom.");
    const role=canTeach?"teacher":student?"student":"viewer";
    return {member:member.data(),offering:offering.data(),canTeach,personId,person,role,admin};
  }

  async function settings(authority){
    const doc=await settingsRef.get(),data=doc.exists?doc.data():{};
    const participationMode=PARTICIPATION.has(data.participationMode)?data.participationMode:"teacher_only";
    let muted=false;
    if(authority.personId){
      const mute=await db.doc(prefix+"classroom_mutes/"+rowKey(offeringId,authority.personId)).get();
      muted=mute.exists&&mute.data().schoolId===ctx.schoolId&&mute.data().offeringId===offeringId&&
        mute.data().personId===authority.personId&&mute.data().status==="active";
    }
    return {participationMode,revision:Number(data.revision||0),muted};
  }
  async function teacherRecipients(){
    const snap=await db.collection(prefix+"staff_assignments").where("offeringId","==",offeringId).limit(31).get();
    return [...new Set(snap.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&doc.data().status==="active")
      .map(doc=>doc.data().teacherUid).filter(Boolean))];
  }
  async function studentRecipients(){
    const enrollmentSnap=await db.collection(prefix+"enrollments").where("offeringId","==",offeringId).limit(101).get();
    if(enrollmentSnap.size===101)deny("resource-exhausted","Classroom notifications require paginated enrollment.");
    const enrollments=enrollmentSnap.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&doc.data().status==="active");
    const people=await Promise.all(enrollments.map(row=>db.doc(prefix+"people/"+row.data().personId).get()));
    return [...new Set(people.map(person=>person.exists&&person.data().schoolId===ctx.schoolId?
      person.data().authUid:null).filter(Boolean))];
  }
  async function notifyUids(uids,{id,title,body,type="announcement",sourceId,target}){
    await Promise.allSettled([...new Set(uids)].filter(uid=>uid&&uid!==ctx.uid).map(uid=>writeSchoolNotification({
      db,schoolId:ctx.schoolId,uid,id:id+"_"+uid.slice(0,16),title,body,type,sourceId,target
    })));
  }
  function authorName(authority){
    return clean(authority.person?.displayName||authority.member.displayName||authority.member.name||
      (authority.role==="student"?"Student":"Teacher"),140)||(authority.role==="student"?"Student":"Teacher");
  }
  function permissions(authority,config){
    return {
      canManage:authority.canTeach,
      canPost:authority.canTeach||(authority.role==="student"&&!config.muted&&config.participationMode==="posts_comments"),
      canComment:authority.canTeach||(authority.role==="student"&&!config.muted&&
        ["comments_only","posts_comments"].includes(config.participationMode))
    };
  }

  const authority=await access(),action=input.action||"list";

  if(action==="list"){
    const config=await settings(authority),perm=permissions(authority,config);
    const [postSnap,commentSnap,grantSnap,muteSnap]=await Promise.all([
      posts.where("offeringId","==",offeringId).limit(101).get(),
      comments.where("offeringId","==",offeringId).limit(301).get(),
      db.collection(prefix+"staff_assignments").where("offeringId","==",offeringId).limit(31).get(),
      authority.canTeach?db.collection(prefix+"classroom_mutes").where("offeringId","==",offeringId).limit(101).get():Promise.resolve(null)
    ]);
    if(postSnap.size===101)deny("resource-exhausted","This classroom stream requires pagination.");
    if(commentSnap.size===301)deny("resource-exhausted","Classroom comments require pagination.");
    if(muteSnap?.size===101)deny("resource-exhausted","Classroom mute records require pagination.");
    const activeComments=commentSnap.docs.map(doc=>({id:doc.id,...doc.data()}))
      .filter(item=>item.schoolId===ctx.schoolId&&item.status==="active");
    const commentsByPost=new Map();
    for(const item of activeComments){
      const list=commentsByPost.get(item.postId)||[];
      list.push({
        commentId:item.id,body:item.body||"",authorName:item.authorName||"Class member",
        authorRole:item.authorRole||"student",authorUid:item.authorUid||"",
        createdAt:millis(item.createdAt),updatedAt:millis(item.updatedAt),
        revision:Number(item.revision||1),
        canDelete:authority.canTeach||item.authorUid===ctx.uid
      });commentsByPost.set(item.postId,list);
    }
    for(const list of commentsByPost.values())list.sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
    const items=postSnap.docs.map(doc=>({id:doc.id,...doc.data()}))
      .filter(item=>item.schoolId===ctx.schoolId&&item.status==="active")
      .sort((a,b)=>(millis(b.createdAt)||0)-(millis(a.createdAt)||0))
      .map(item=>({
        postId:item.id,kind:item.kind||"announcement",title:item.title||"",
        body:item.body||"",linkUrl:item.linkUrl||"",pinned:item.pinned===true,
        authorName:item.authorName||"Teacher",authorRole:item.authorRole||"teacher",
        authorUid:item.authorUid||"",createdAt:millis(item.createdAt),updatedAt:millis(item.updatedAt),
        revision:Number(item.revision||1),comments:commentsByPost.get(item.id)||[],
        canEdit:item.authorUid===ctx.uid&&(item.authorRole!=="student"||perm.canPost),
        canModerate:authority.canTeach||item.authorUid===ctx.uid
      }));
    const activeTeachers=grantSnap.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&doc.data().status==="active");
    const members=await Promise.all(activeTeachers.map(doc=>db.doc(prefix+"memberships/"+doc.data().teacherUid).get()));
    const teachers=members.map((member,index)=>{
      const grant=activeTeachers[index].data(),data=member.exists?member.data():null;
      return {uid:grant.teacherUid,name:data&&data.schoolId===ctx.schoolId?
        clean(data.displayName||data.name||"Teacher",140):"Teacher"};
    });
    const mutedPersonIds=authority.canTeach&&muteSnap?muteSnap.docs.filter(doc=>{
      const row=doc.data();return row.schoolId===ctx.schoolId&&row.offeringId===offeringId&&row.status==="active";
    }).map(doc=>doc.data().personId).filter(Boolean):[];
    return {
      offeringId,teachers,posts:items,...perm,
      viewer:{role:authority.role,personId:authority.personId||null,muted:config.muted},
      settings:{participationMode:config.participationMode,revision:config.revision},
      mutedPersonIds
    };
  }

  if(action==="update_settings"){
    if(!authority.canTeach)deny("permission-denied","Only an assigned teacher or school administrator can change classroom participation.");
    const participationMode=String(input.participationMode||"");
    if(!PARTICIPATION.has(participationMode))deny("invalid-argument","Choose a supported classroom participation mode.");
    const expectedRevision=Number(input.expectedRevision);
    if(!Number.isInteger(expectedRevision)||expectedRevision<0)
      deny("invalid-argument","Refresh the classroom before changing participation settings.");
    const auditRef=db.collection(prefix+"classroom_audit").doc();
    let revision;
    await db.runTransaction(async tx=>{
      const current=await tx.get(settingsRef),data=current.exists?current.data():{},actual=Number(data.revision||0);
      if(actual!==expectedRevision)deny("failed-precondition","Classroom participation changed since you loaded it. Refresh and review the current setting.");
      revision=actual+1;
      const now=FieldValue.serverTimestamp(),payload={
        schoolId:ctx.schoolId,offeringId,participationMode,revision,
        updatedByUid:ctx.uid,updatedAt:now
      };
      if(current.exists)tx.update(settingsRef,payload);else tx.create(settingsRef,{...payload,createdByUid:ctx.uid,createdAt:now});
      tx.create(auditRef,{schoolId:ctx.schoolId,offeringId,actorUid:ctx.uid,
        action:"classroom_participation_updated",participationMode,revision,createdAt:now});
    });
    return {offeringId,participationMode,revision};
  }

  if(["mute_student","unmute_student"].includes(action)){
    if(!authority.canTeach)deny("permission-denied","Only an assigned teacher or school administrator can moderate classroom participation.");
    const personId=checkId(input.personId,"Student person ID",128),reason=clean(input.reason,500);
    if(reason.length<12)deny("invalid-argument","Explain the classroom moderation change in at least 12 characters.");
    const enrollmentRef=db.doc(prefix+"enrollments/"+rowKey(personId,offeringId)),
      personRef=db.doc(prefix+"people/"+personId),
      muteRef=db.doc(prefix+"classroom_mutes/"+rowKey(offeringId,personId)),
      auditRef=db.collection(prefix+"classroom_audit").doc(),
      muting=action==="mute_student";
    await db.runTransaction(async tx=>{
      const [enrollment,person,mute]=await Promise.all([tx.get(enrollmentRef),tx.get(personRef),tx.get(muteRef)]);
      if(!enrollment.exists||enrollment.data().schoolId!==ctx.schoolId||enrollment.data().offeringId!==offeringId||
        enrollment.data().personId!==personId||enrollment.data().status!=="active"||
        !person.exists||person.data().schoolId!==ctx.schoolId||person.data().kind!=="student"||person.data().status!=="active")
        deny("failed-precondition","Only an actively enrolled student can be moderated in this classroom.");
      const now=FieldValue.serverTimestamp(),prior=mute.exists?mute.data():null;
      if(muting){
        if(prior?.status==="active")return;
        const payload={schoolId:ctx.schoolId,offeringId,personId,status:"active",reason,
          revision:Number(prior?.revision||0)+1,updatedByUid:ctx.uid,updatedAt:now};
        if(mute.exists)tx.update(muteRef,{...payload,mutedByUid:ctx.uid,mutedAt:now});
        else tx.create(muteRef,{...payload,mutedByUid:ctx.uid,mutedAt:now,createdAt:now});
      }else{
        if(!mute.exists||prior?.status!=="active")deny("failed-precondition","This student is not currently muted.");
        tx.update(muteRef,{status:"ended",unmutedByUid:ctx.uid,unmutedAt:now,unmuteReason:reason,
          revision:Number(prior.revision||1)+1,updatedByUid:ctx.uid,updatedAt:now});
      }
      tx.create(auditRef,{schoolId:ctx.schoolId,offeringId,personId,actorUid:ctx.uid,
        action:muting?"classroom_student_muted":"classroom_student_unmuted",reason,createdAt:now});
    });
    return {offeringId,personId,muted:muting};
  }

  const config=await settings(authority),perm=permissions(authority,config);

  if(action==="create"){
    if(!perm.canPost)deny("permission-denied",config.muted?
      "Your classroom participation is muted. You can still read class activity.":
      "Students cannot create classroom posts in this class.");
    const student=authority.role==="student";
    const kind=student?"post":(["announcement","post","material"].includes(input.kind)?input.kind:"announcement");
    const title=clean(input.title,160),body=clean(input.body,6000),linkUrl=student?"":safeUrl(input.linkUrl);
    if(!body&&!title)deny("invalid-argument","Write a classroom post before publishing.");
    const postRef=posts.doc(),now=FieldValue.serverTimestamp(),name=authorName(authority);
    await postRef.create({
      schoolId:ctx.schoolId,offeringId,authorUid:ctx.uid,authorPersonId:authority.personId||null,
      authorName:name,authorRole:student?"student":"teacher",kind,title,body,linkUrl,
      pinned:student?false:input.pinned===true,status:"active",revision:1,createdAt:now,updatedAt:now
    });
    if(student){
      await notifyUids(await teacherRecipients(),{
        id:"classroom_student_post_"+postRef.id,title:"New student classroom post",
        body:name+": "+(title||body).slice(0,220),type:"classroom",sourceId:postRef.id,
        target:"teacher-classroom.html?offeringId="+encodeURIComponent(offeringId)+"#class-stream"
      });
    }else{
      await notifyUids(await studentRecipients(),{
        id:"classroom_post_"+postRef.id,title:title||"New classroom announcement",
        body:body.slice(0,260),type:"announcement",sourceId:postRef.id,
        target:"student-subject.html?offeringId="+encodeURIComponent(offeringId)
      });
    }
    return {postId:postRef.id,status:"active"};
  }

  if(action==="create_comment"){
    if(!perm.canComment)deny("permission-denied",config.muted?
      "Your classroom participation is muted. You can still read class activity.":
      "Student comments are disabled in this classroom.");
    const postId=checkId(input.postId,"Classroom post ID",128),postRef=posts.doc(postId),
      post=await postRef.get();
    if(!post.exists||post.data().schoolId!==ctx.schoolId||post.data().offeringId!==offeringId||post.data().status!=="active")
      deny("not-found","The classroom post is no longer available.");
    const body=clean(input.body,2000);if(!body)deny("invalid-argument","Write a comment before posting.");
    const commentRef=comments.doc(),now=FieldValue.serverTimestamp(),name=authorName(authority),student=authority.role==="student";
    await commentRef.create({
      schoolId:ctx.schoolId,offeringId,postId,authorUid:ctx.uid,authorPersonId:authority.personId||null,
      authorName:name,authorRole:student?"student":"teacher",body,status:"active",revision:1,createdAt:now,updatedAt:now
    });
    const recipient=post.data().authorUid;
    if(student){
      const teachers=await teacherRecipients();
      await notifyUids(teachers,{
        id:"classroom_comment_teacher_"+commentRef.id,title:"New student classroom comment",
        body:name+": "+body.slice(0,220),type:"classroom",sourceId:commentRef.id,
        target:"teacher-classroom.html?offeringId="+encodeURIComponent(offeringId)+"#class-stream"
      });
      if(recipient&&recipient!==ctx.uid&&!teachers.includes(recipient)){
        await notifyUids([recipient],{
          id:"classroom_comment_author_"+commentRef.id,title:"New comment on your classroom post",
          body:name+": "+body.slice(0,220),type:"classroom",sourceId:commentRef.id,
          target:"student-subject.html?offeringId="+encodeURIComponent(offeringId)+"#class-stream"
        });
      }
    }else if(recipient&&recipient!==ctx.uid){
      await notifyUids([recipient],{
        id:"classroom_comment_"+commentRef.id,title:"New teacher classroom comment",
        body:name+": "+body.slice(0,220),type:"classroom",sourceId:commentRef.id,
        target:"student-subject.html?offeringId="+encodeURIComponent(offeringId)+"#class-stream"
      });
    }
    return {commentId:commentRef.id,status:"active"};
  }

  if(action==="archive_comment"){
    const commentId=checkId(input.commentId,"Classroom comment ID",128),ref=comments.doc(commentId),current=await ref.get();
    if(!current.exists||current.data().schoolId!==ctx.schoolId||current.data().offeringId!==offeringId||
      current.data().status!=="active")deny("not-found","Classroom comment not found.");
    if(!authority.canTeach&&current.data().authorUid!==ctx.uid)
      deny("permission-denied","Only the comment author or a classroom teacher can remove this comment.");
    await ref.update({status:"archived",archivedAt:FieldValue.serverTimestamp(),archivedByUid:ctx.uid,
      updatedAt:FieldValue.serverTimestamp(),revision:Number(current.data().revision||1)+1});
    return {commentId,status:"archived"};
  }

  const postId=checkId(input.postId,"Classroom post ID",128),ref=posts.doc(postId);
  if(action==="update"){
    const current=await ref.get();
    if(!current.exists||current.data().schoolId!==ctx.schoolId||current.data().offeringId!==offeringId||
      current.data().status!=="active")deny("not-found","Classroom post not found.");
    const data=current.data(),studentPost=data.authorRole==="student";
    if(data.authorUid!==ctx.uid&&!authority.admin)
      deny("permission-denied","Only the post author can edit this classroom post.");
    if(studentPost&&!authority.admin&&!perm.canPost)
      deny("permission-denied","Student posting is no longer enabled for this classroom.");
    const title=clean(input.title,160),body=clean(input.body,6000),
      linkUrl=studentPost?"":safeUrl(input.linkUrl);
    if(!body&&!title)deny("invalid-argument","A classroom post cannot be empty.");
    const revision=Number(data.revision||1)+1;
    await ref.update({title,body,linkUrl,pinned:studentPost?false:input.pinned===true,
      revision,updatedAt:FieldValue.serverTimestamp()});
    return {postId,revision,status:"active"};
  }

  if(action==="archive"){
    const current=await ref.get();
    if(!current.exists||current.data().schoolId!==ctx.schoolId||current.data().offeringId!==offeringId)
      deny("not-found","Classroom post not found.");
    if(!authority.canTeach&&current.data().authorUid!==ctx.uid)
      deny("permission-denied","Only the post author or a classroom teacher can remove this post.");
    await ref.update({status:"archived",archivedAt:FieldValue.serverTimestamp(),archivedByUid:ctx.uid,
      updatedAt:FieldValue.serverTimestamp(),revision:Number(current.data().revision||1)+1});
    return {postId,status:"archived"};
  }

  deny("invalid-argument","Unknown classroom stream operation.");
 };
}
module.exports={createSchoolClassroomStreamService};
