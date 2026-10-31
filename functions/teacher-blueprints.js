"use strict";
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");
const {FieldValue}=require("firebase-admin/firestore");
const deny=(code,message)=>{throw new TenantAccessError(code,message)};
function documentId(value) {
  if(typeof value!=="string"||!/^[a-zA-Z0-9_-]{1,128}$/.test(value))deny("invalid-argument","Invalid assessment identifier.");
  return value;
}
function cleanText(value,max,label,{required=false}={}) {
  if(typeof value!=="string" || value.length>max || (required&&!value.trim()))
    deny("invalid-argument",label+" is missing or too long.");
  return value.trim();
}
function reusableContent(input) {
  if(!input||typeof input!=="object"||Array.isArray(input))deny("invalid-argument","Assessment details are required.");
  const title=cleanText(input.title,140,"Title",{required:true});
  const description=cleanText(input.description||"",2000,"Description");
  const instructions=cleanText(input.instructions||"",20000,"Instructions");
  const rubric=Array.isArray(input.rubric)?input.rubric:[];
  if(rubric.length>20)deny("invalid-argument","Limit the assessment rubric to 20 criteria.");
  const criteria=rubric.map(item=>{
    if(!item||typeof item!=="object")deny("invalid-argument","Invalid rubric criterion.");
    const name=cleanText(item.name,160,"Criterion",{required:true});
    const points=item.points;
    if(typeof points!=="number"||!Number.isFinite(points)||points<=0||points>100)
      deny("invalid-argument","Each criterion must have between 0 and 100 points.");
    return {name,points};
  });
  return {title,description,instructions,rubric:criteria};
}
function serialize(doc,access) {
  const data=doc.data();
  return {
    id:doc.id,schoolId:data.schoolId,ownerUid:data.ownerUid,
    creatorUid:data.creatorUid,visibility:data.visibility,
    title:data.title,description:data.description,instructions:data.instructions,
    rubric:data.rubric,contentRevision:data.contentRevision,aclRevision:data.aclRevision,
    copiedFrom:data.copiedFrom||null,
    canShare:access.uid===data.ownerUid,
    updatedAt:data.updatedAt?.toMillis?.()||null
  };
}
function canReadBlueprint(data,uid) {
  return data.ownerUid===uid||data.visibility==="school_teachers"||
    (data.visibility==="selected_teachers"&&Array.isArray(data.sharedWithUids)&&data.sharedWithUids.includes(uid));
}
function createTeacherBlueprintService({db}) {
  return async request=>{
    const input=request.data||{};
    const schoolId=input.schoolId;
    const ctx=await getSchoolContext({db,request,schoolId,roles:["teacher"]});
    const collection=db.collection("schools/"+ctx.schoolId+"/assessment_blueprints");
    const selfMemberRef=db.doc("schools/"+ctx.schoolId+"/memberships/"+ctx.uid);
    const schoolRef=db.doc("platform_schools/"+ctx.schoolId);
    const assertCurrentSchool=school=>{
      if(!school.exists||school.data().state!=="active")
        deny("permission-denied","This school is not currently active.");
    };
    const assertCurrentTeacher=member=>{
      if(!member.exists||member.data().schoolId!==ctx.schoolId||member.data().status!=="active"||
         !Array.isArray(member.data().roles)||!member.data().roles.includes("teacher"))
        deny("permission-denied","Your teaching access changed. Refresh and try again.");
    };
    const action=input.action;
    if(action==="recipients") {
      const snap=await db.collection("schools/"+ctx.schoolId+"/memberships")
        .where("roles","array-contains","teacher").limit(101).get();
      const teachers=snap.docs.filter(doc=>doc.id!==ctx.uid&&doc.data().status==="active"&&
        doc.data().schoolId===ctx.schoolId).slice(0,100).map(doc=>({
          uid:doc.id,
          name:typeof doc.data().displayName==="string"&&doc.data().displayName.trim()
            ?doc.data().displayName.trim().slice(0,120):"Teacher "+doc.id.slice(0,8)
        }));
      return {teachers,truncated:snap.size===101};
    }
    if(action==="create") {
      const fields=reusableContent(input.blueprint);
      const ref=collection.doc();
      const now=FieldValue.serverTimestamp();
      await db.runTransaction(async tx=>{
        assertCurrentTeacher(await tx.get(selfMemberRef));
        assertCurrentSchool(await tx.get(schoolRef));
        tx.create(ref,{
          ...fields,schoolId:ctx.schoolId,creatorUid:ctx.uid,ownerUid:ctx.uid,
          visibility:"private",sharedWithUids:[],status:"draft",
          contentRevision:1,aclRevision:1,createdAt:now,updatedAt:now
        });
      });
      return {id:ref.id,visibility:"private",contentRevision:1};
    }
    if(action==="list") {
      const [owned,schoolShared,individual]=await Promise.all([
        collection.where("ownerUid","==",ctx.uid).limit(50).get(),
        collection.where("visibility","==","school_teachers").limit(50).get(),
        collection.where("sharedWithUids","array-contains",ctx.uid).limit(50).get()
      ]);
      const records=new Map();
      for(const snap of [owned,schoolShared,individual]) for(const doc of snap.docs) {
        const value=doc.data();
        if(value.schoolId===ctx.schoolId && canReadBlueprint(value,ctx.uid) && value.status!=="archived")
          records.set(doc.id,serialize(doc,ctx));
      }
      return {items:[...records.values()].slice(0,150),truncated:owned.size===50||schoolShared.size===50||individual.size===50};
    }
    if(action==="update" || action==="archive") {
      const id=documentId(input.resourceId),ref=collection.doc(id);
      const expectedRevision=input.expectedRevision;
      if(!Number.isInteger(expectedRevision)||expectedRevision<1)
        deny("invalid-argument","The current assessment revision is required.");
      const fields=action==="update"?reusableContent(input.blueprint):null;
      const auditRef=db.collection("schools/"+ctx.schoolId+"/resource_audit").doc();
      await db.runTransaction(async tx=>{
        const original=await tx.get(ref);
        assertCurrentTeacher(await tx.get(selfMemberRef));
        assertCurrentSchool(await tx.get(schoolRef));
        if(!original.exists||original.data().schoolId!==ctx.schoolId||original.data().ownerUid!==ctx.uid)
          deny("permission-denied","Only the creator's authorized owner can change this blueprint.");
        if(original.data().status!=="draft")
          deny("failed-precondition","Only an undeployed draft blueprint may be changed.");
        if(original.data().contentRevision!==expectedRevision)
          deny("failed-precondition","This assessment has changed. Reload it before saving.");
        const now=FieldValue.serverTimestamp();
        tx.update(ref,fields?{...fields,contentRevision:expectedRevision+1,updatedAt:now}
          :{status:"archived",contentRevision:expectedRevision+1,updatedAt:now});
        tx.create(auditRef,{schoolId:ctx.schoolId,resourceId:id,actorUid:ctx.uid,
          action,contentRevision:expectedRevision+1,createdAt:now});
      });
      return {id,status:action==="archive"?"archived":"draft",contentRevision:expectedRevision+1};
    }
    if(action==="share") {
      const id=documentId(input.resourceId),ref=collection.doc(id);
      const visibility=input.visibility;
      if(!["private","selected_teachers","school_teachers"].includes(visibility))
        deny("invalid-argument","Choose a valid sharing audience.");
      if(visibility!=="selected_teachers"&&Array.isArray(input.teacherUids)&&input.teacherUids.length)
        deny("invalid-argument","Specific recipients are only valid for selected-teacher sharing.");
      const recipients=visibility==="selected_teachers" ? input.teacherUids : [];
      if(!Array.isArray(recipients)||recipients.length>30 ||
         recipients.some(uid=>typeof uid!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(uid)||uid===ctx.uid))
        deny("invalid-argument","Select up to 30 other teachers from this school.");
      const selected=[...new Set(recipients)].sort();
      if(visibility==="selected_teachers" && !selected.length)
        deny("invalid-argument","Choose at least one teacher or make the resource private.");
      const memberRefs=selected.map(uid=>db.doc("schools/"+ctx.schoolId+"/memberships/"+uid));
      const auditRef=db.collection("schools/"+ctx.schoolId+"/resource_audit").doc();
      await db.runTransaction(async tx=>{
        const original=await tx.get(ref);
        assertCurrentTeacher(await tx.get(selfMemberRef));
        assertCurrentSchool(await tx.get(schoolRef));
        if(!original.exists||original.data().schoolId!==ctx.schoolId||original.data().ownerUid!==ctx.uid)
          deny("permission-denied","Only the assessment owner can change sharing.");
        if(original.data().status==="archived")deny("failed-precondition","Archived work cannot be shared.");
        // All participant membership reads happen before writes.
        const membership=await Promise.all(memberRefs.map(m=>tx.get(m)));
        if(membership.some(m=>!m.exists||m.data().status!=="active"||m.data().schoolId!==ctx.schoolId||
          !Array.isArray(m.data().roles)||!m.data().roles.includes("teacher")))
          deny("permission-denied","A selected recipient is not an active teacher at this school.");
        const nextRevision=(original.data().aclRevision||0)+1;
        tx.update(ref,{visibility,sharedWithUids:selected,aclRevision:nextRevision,updatedAt:FieldValue.serverTimestamp()});
        tx.create(auditRef,{schoolId:ctx.schoolId,resourceId:id,actorUid:ctx.uid,action:"share",
          previousAudience:original.data().visibility||"private",audience:visibility,recipientCount:selected.length,
          aclRevision:nextRevision,createdAt:FieldValue.serverTimestamp()});
      });
      return {id,visibility,recipientCount:selected.length};
    }
    if(action==="copy") {
      const id=documentId(input.resourceId),source=collection.doc(id),target=collection.doc();
      await db.runTransaction(async tx=>{
        const original=await tx.get(source);
        assertCurrentTeacher(await tx.get(selfMemberRef));
        if(!original.exists||original.data().schoolId!==ctx.schoolId ||
          original.data().status==="archived"||!canReadBlueprint(original.data(),ctx.uid))
          deny("permission-denied","This assessment is not shared with you.");
        const value=original.data();
        // Explicit allowlist: never inherit enrolments, grades, answers, student data, review grants or secrets.
        tx.create(target,{
          ...reusableContent(value),schoolId:ctx.schoolId,creatorUid:ctx.uid,ownerUid:ctx.uid,
          visibility:"private",sharedWithUids:[],status:"draft",contentRevision:1,aclRevision:1,
          copiedFrom:{schoolId:ctx.schoolId,resourceId:id,revision:value.contentRevision||1},
          createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()
        });
      });
      return {id:target.id,visibility:"private",copiedFrom:id};
    }
    deny("invalid-argument","Unknown assessment library action.");
  };
}
module.exports={createTeacherBlueprintService,reusableContent,canReadBlueprint};
