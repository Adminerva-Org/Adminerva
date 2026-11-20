"use strict";
/**
 * Private assessment conversation between one enrolled learner and the teacher
 * currently responsible for an assessment deployment. Messages are separate
 * from public classroom discussion and from grade/feedback records.
 */
const {FieldValue}=require("firebase-admin/firestore");
const {createHash}=require("node:crypto");
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");
const {rowKey,checkId}=require("./school-academics.js");
const {writeSchoolNotification}=require("./school-notifications.js");

function deny(code,message){throw new TenantAccessError(code,message)}
function clean(value,max=4000){return String(value??"").trim().slice(0,max)}
function threadKey(schoolId,taskId,studentUid){
  return createHash("sha256").update(JSON.stringify([schoolId,taskId,studentUid])).digest("hex");
}
function millis(value){return value?.toMillis?.()||null}

function createSchoolAssessmentConversationService({db}){
 return async request=>{
  const input=request.data||{};
  const ctx=await getSchoolContext({db,request,schoolId:input.schoolId,roles:["student","teacher"]});
  if(ctx.platformOverride)
    deny("permission-denied","Private learner-teacher assessment conversations are not available in System Admin context.");
  const prefix="schools/"+ctx.schoolId+"/",taskId=checkId(input.taskId,"Assessment task",128),
    taskRef=db.doc(prefix+"assessments/"+taskId),memberRef=db.doc(prefix+"memberships/"+ctx.uid);
  const [task,member]=await Promise.all([taskRef.get(),memberRef.get()]);
  if(!task.exists||task.data().schoolId!==ctx.schoolId||task.data().status!=="deployed")
    deny("not-found","Assessment conversation is unavailable.");
  if(!member.exists||member.data().schoolId!==ctx.schoolId||member.data().status!=="active")
    deny("permission-denied","Your school access changed. Refresh before continuing.");
  const taskData=task.data(),offeringId=checkId(taskData.offeringId,"Course offering ID",330),
    roles=Array.isArray(member.data().roles)?member.data().roles:[],
    isTeacher=roles.includes("teacher"),isStudent=roles.includes("student");
  let studentUid="",studentPersonId="",studentName="",teacherUid=String(taskData.reviewerUid||taskData.ownerUid||""),
    teacherName="Teacher",viewerRole="";

  if(isTeacher&&(taskData.reviewerUid||taskData.ownerUid)===ctx.uid){
    const grant=await db.doc(prefix+"staff_assignments/"+rowKey(ctx.uid,offeringId)).get();
    if(!grant.exists||grant.data().schoolId!==ctx.schoolId||grant.data().teacherUid!==ctx.uid||
      grant.data().offeringId!==offeringId||grant.data().status!=="active")
      deny("permission-denied","Assessment conversation access is no longer assigned to you.");
    studentUid=checkId(input.studentUid,"Student account UID",128);
    const studentMember=await db.doc(prefix+"memberships/"+studentUid).get();
    studentPersonId=studentMember.exists&&studentMember.data().schoolId===ctx.schoolId?
      String(studentMember.data().personId||""):"";
    if(!studentMember.exists||studentMember.data().status!=="active"||
      !Array.isArray(studentMember.data().roles)||!studentMember.data().roles.includes("student")||!studentPersonId)
      deny("failed-precondition","The learner is not an active student in this school.");
    checkId(studentPersonId,"Student person ID",128);
    const [person,enrollment]=await Promise.all([
      db.doc(prefix+"people/"+studentPersonId).get(),
      db.doc(prefix+"enrollments/"+rowKey(studentPersonId,offeringId)).get()
    ]);
    if(!person.exists||person.data().schoolId!==ctx.schoolId||person.data().kind!=="student"||
      person.data().status!=="active"||person.data().authUid!==studentUid||
      !enrollment.exists||enrollment.data().schoolId!==ctx.schoolId||
      enrollment.data().personId!==studentPersonId||enrollment.data().offeringId!==offeringId||
      enrollment.data().status!=="active")
      deny("failed-precondition","The learner is not actively enrolled in this assessment's class.");
    studentName=clean(person.data().displayName||"Student",140)||"Student";
    teacherName=clean(member.data().displayName||member.data().name||"Teacher",140)||"Teacher";
    viewerRole="teacher";
  }else if(isStudent){
    studentUid=ctx.uid;studentPersonId=String(member.data().personId||"");
    if(!studentPersonId)deny("failed-precondition","Link your verified school identity before using private assessment messages.");
    checkId(studentPersonId,"Student person ID",128);
    const [person,enrollment,teacherMember]=await Promise.all([
      db.doc(prefix+"people/"+studentPersonId).get(),
      db.doc(prefix+"enrollments/"+rowKey(studentPersonId,offeringId)).get(),
      teacherUid?db.doc(prefix+"memberships/"+teacherUid).get():Promise.resolve(null)
    ]);
    if(!taskData.published||["archived","cancelled"].includes(taskData.lifecycle||"active")||
      !person.exists||person.data().schoolId!==ctx.schoolId||person.data().kind!=="student"||
      person.data().status!=="active"||person.data().authUid!==ctx.uid||
      !enrollment.exists||enrollment.data().schoolId!==ctx.schoolId||
      enrollment.data().personId!==studentPersonId||enrollment.data().offeringId!==offeringId||
      enrollment.data().status!=="active")
      deny("permission-denied","This assessment conversation is not available to your account.");
    studentName=clean(person.data().displayName||member.data().displayName||"Student",140)||"Student";
    teacherName=teacherMember?.exists&&teacherMember.data().schoolId===ctx.schoolId?
      clean(teacherMember.data().displayName||teacherMember.data().name||"Teacher",140)||"Teacher":"Teacher";
    viewerRole="student";
  }else deny("permission-denied","Assessment conversation access is restricted to the learner and assigned teacher.");

  if(!teacherUid)deny("failed-precondition","This assessment has no responsible teacher.");
  const id=threadKey(ctx.schoolId,taskId,studentUid),
    threadRef=db.doc(prefix+"assessment_threads/"+id),
    messages=db.collection(prefix+"assessment_messages");

  if((input.action||"list")==="list"){
    const snap=await messages.where("threadId","==",id).limit(101).get();
    if(snap.size===101)deny("resource-exhausted","This assessment conversation requires pagination.");
    const items=snap.docs.map(doc=>({id:doc.id,...doc.data()}))
      .filter(row=>row.schoolId===ctx.schoolId&&row.taskId===taskId&&row.studentUid===studentUid&&row.status==="active")
      .sort((a,b)=>(millis(a.createdAt)||0)-(millis(b.createdAt)||0))
      .map(row=>({
        messageId:row.id,body:row.body||"",authorUid:row.authorUid||"",
        authorRole:row.authorRole||"student",authorName:row.authorName||"Class member",
        createdAt:millis(row.createdAt)
      }));
    return {
      threadId:id,taskId,studentUid,studentName,teacherUid,teacherName,viewerRole,
      taskTitle:taskData.title||"Assessment",offeringId,messages:items,
      canSend:(taskData.lifecycle||"active")!=="cancelled"
    };
  }

  if(input.action==="create_message"){
    if((taskData.lifecycle||"active")==="cancelled")
      deny("failed-precondition","Messages are closed because this assessment was cancelled.");
    const body=clean(input.body,4000);if(!body)deny("invalid-argument","Write a private assessment message before sending.");
    const messageRef=messages.doc(),now=FieldValue.serverTimestamp(),
      authorRole=viewerRole,authorName=viewerRole==="teacher"?teacherName:studentName;
    await db.runTransaction(async tx=>{
      const existing=await tx.get(threadRef);
      const threadData={
        schoolId:ctx.schoolId,threadId:id,taskId,offeringId,studentUid,studentPersonId,
        teacherUid,studentName,teacherName,lastMessageAt:now,lastMessageByUid:ctx.uid,
        updatedAt:now
      };
      if(existing.exists)tx.update(threadRef,threadData);
      else tx.create(threadRef,{...threadData,createdAt:now});
      tx.create(messageRef,{
        schoolId:ctx.schoolId,threadId:id,taskId,offeringId,studentUid,studentPersonId,teacherUid,
        authorUid:ctx.uid,authorRole,authorName,body,status:"active",createdAt:now
      });
    });
    const recipientUid=viewerRole==="teacher"?studentUid:teacherUid,
      target=viewerRole==="teacher"?
        "student-assessments.html?offeringId="+encodeURIComponent(offeringId)+"&conversation="+encodeURIComponent(taskId)+"#"+encodeURIComponent(taskId):
        "school-gradebook.html?view=review&offeringId="+encodeURIComponent(offeringId)+"&task="+encodeURIComponent(taskId)+"&studentUid="+encodeURIComponent(studentUid);
    await writeSchoolNotification({
      db,schoolId:ctx.schoolId,uid:recipientUid,id:"assessment_message_"+messageRef.id,
      title:"Private assessment message · "+String(taskData.title||"Assessment").slice(0,100),
      body:authorName+": "+body.slice(0,220),type:"submission",sourceId:taskId,target
    }).catch(()=>{});
    return {messageId:messageRef.id,threadId:id,created:true};
  }

  deny("invalid-argument","Unknown private assessment conversation operation.");
 };
}
module.exports={createSchoolAssessmentConversationService,threadKey};
