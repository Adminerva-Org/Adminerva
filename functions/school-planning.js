"use strict";
/**
 * School-scoped teacher planning resources (lesson plans and presentations).
 * Private owner by default. Sharing grants read/copy only; no co-edit, student
 * data, grade rights or deployment rights are inherited.
 */
const {FieldValue}=require("firebase-admin/firestore");
const {createHash,randomUUID}=require("node:crypto");
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");

function deny(code,message){throw new TenantAccessError(code,message)}
const KINDS=new Set(["lesson","presentation"]);
function clean(value,max,label,{required=true}={}){
 const text=typeof value==="string"?value.trim():"";
 if((required&&!text)||text.length>max)deny("invalid-argument",label+" is missing or too long.");
 return text;
}
function resourceId(value){
 if(typeof value!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(value))
  deny("invalid-argument","Invalid planning resource identifier.");
 return value;
}
function validateContent(value){
 if(!value||typeof value!=="object"||Array.isArray(value))
  deny("invalid-argument","Planning content must be an object.");
 let nodes=0;
 function walk(node,depth){
  nodes++;if(nodes>12000||depth>14)deny("invalid-argument","Planning content is too complex.");
  if(node===null||typeof node==="boolean")return node;
  if(typeof node==="number"){
   if(!Number.isFinite(node))deny("invalid-argument","Planning content contains an invalid number.");
   return Object.is(node,-0)?0:node;
  }
  if(typeof node==="string"){
   if(node.length>120000)deny("invalid-argument","A planning text field is too large.");
   return node;
  }
  if(Array.isArray(node)){
   if(node.length>2000)deny("invalid-argument","A planning list is too large.");
   return node.map(item=>walk(item,depth+1));
  }
  if(typeof node!=="object")deny("invalid-argument","Planning content contains an unsupported value.");
  const output={};
  for(const [key,child] of Object.entries(node)){
   if(["__proto__","prototype","constructor"].includes(key))
    deny("invalid-argument","Planning content contains a reserved field.");
   if(key.length>120)deny("invalid-argument","A planning field name is too long.");
   output[key]=walk(child,depth+1);
  }
  return output;
 }
 const copy=walk(value,0),serialized=JSON.stringify(copy);
 if(Buffer.byteLength(serialized,"utf8")>650000)
  deny("invalid-argument","Planning content exceeds the 650 KB school save limit.");
 return copy;
}
function deterministicId(ctx,kind,clientKey){
 const key=clean(clientKey,1500,"Planning client key");
 return createHash("sha256").update(JSON.stringify([ctx.schoolId,ctx.uid,kind,key])).digest("hex");
}
function canRead(data,uid){
 return data.ownerUid===uid||data.visibility==="school_teachers"||
  (data.visibility==="selected_teachers"&&Array.isArray(data.sharedWithUids)&&data.sharedWithUids.includes(uid));
}
function summary(doc,uid){
 const data=doc.data();
 return {resourceId:doc.id,kind:data.kind,title:data.title,status:data.status,
  ownerUid:data.ownerUid,visibility:data.visibility,canEdit:data.ownerUid===uid,
  revision:data.revision||1,clientKey:data.ownerUid===uid?data.clientKey||null:null,
  source:data.source||null,updatedAt:data.updatedAt?.toMillis?.()||null};
}
function createSchoolPlanningService({db}){
 return async request=>{
  const input=request.data||{},ctx=await getSchoolContext({
   db,request,schoolId:input.schoolId,roles:["teacher"]
  });
  const prefix="schools/"+ctx.schoolId+"/";
  const resources=db.collection(prefix+"teaching_resources");
  const schoolRef=db.doc("platform_schools/"+ctx.schoolId);
  const memberRef=db.doc(prefix+"memberships/"+ctx.uid);
  async function currentTeacher(tx){
   const [school,member]=await Promise.all([tx.get(schoolRef),tx.get(memberRef)]);
   if(!school.exists||school.data().state!=="active"||!member.exists||
      member.data().schoolId!==ctx.schoolId||member.data().status!=="active"||
      !Array.isArray(member.data().roles)||!member.data().roles.includes("teacher"))
    deny("permission-denied","Your teaching access changed. Refresh before continuing.");
  }
  const action=input.action;

  if(action==="list"){
   const kind=input.kind;
   if(kind&&!KINDS.has(kind))deny("invalid-argument","Invalid planning resource kind.");
   const [owned,schoolShared,selected]=await Promise.all([
    resources.where("ownerUid","==",ctx.uid).limit(100).get(),
    resources.where("visibility","==","school_teachers").limit(100).get(),
    resources.where("sharedWithUids","array-contains",ctx.uid).limit(100).get()
   ]);
   const map=new Map();
   for(const snap of [owned,schoolShared,selected])for(const doc of snap.docs){
    const data=doc.data();
    if(data.schoolId===ctx.schoolId&&data.status!=="archived"&&canRead(data,ctx.uid)&&
       (!kind||data.kind===kind))map.set(doc.id,summary(doc,ctx.uid));
   }
   return {resources:[...map.values()].sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)),
    truncated:owned.size===100||schoolShared.size===100||selected.size===100};
  }

  if(action==="save"){
   const kind=clean(input.kind,20,"Planning kind");
   if(!KINDS.has(kind))deny("invalid-argument","Choose lesson or presentation.");
   const title=clean(input.title,180,"Planning title"),content=validateContent(input.content);
   const clientKey=clean(input.clientKey,1500,"Planning client key");
   const id=deterministicId(ctx,kind,clientKey),ref=resources.doc(id);
   const expected=input.expectedRevision;
   if(expected!==0&&(!Number.isInteger(expected)||expected<1))
    deny("invalid-argument","Expected revision must be zero for a first save or the current positive revision.");
   let result;
   await db.runTransaction(async tx=>{
    await currentTeacher(tx);
    const current=await tx.get(ref),now=FieldValue.serverTimestamp();
    if(!current.exists){
     if(expected!==0)deny("failed-precondition","The school planning resource does not exist at that revision.");
     tx.create(ref,{schoolId:ctx.schoolId,ownerUid:ctx.uid,creatorUid:ctx.uid,kind,title,clientKey,
       content,status:"active",visibility:"private",sharedWithUids:[],revision:1,
       createdAt:now,updatedAt:now});
     tx.create(db.collection(prefix+"planning_audit").doc(),{
       schoolId:ctx.schoolId,resourceId:id,actorUid:ctx.uid,action:"planning_resource_created",
       kind,revision:1,createdAt:now});
     result={resourceId:id,revision:1,created:true};return;
    }
    const data=current.data();
    if(data.schoolId!==ctx.schoolId||data.ownerUid!==ctx.uid||data.kind!==kind||data.clientKey!==clientKey)
      deny("permission-denied","This planning resource belongs to a different owner, school, or resource type.");
    if(data.status==="archived")deny("failed-precondition","Restore this planning resource before saving changes.");
    if((data.revision||1)!==expected)
      deny("failed-precondition","A newer school planning revision exists. Reload before replacing it.");
    if(JSON.stringify(data.content)===JSON.stringify(content)&&data.title===title){
      result={resourceId:id,revision:data.revision||1,created:false,unchanged:true};return;
    }
    const revision=(data.revision||1)+1;
    tx.create(ref.collection("revisions").doc(String(data.revision||1)),{
      schoolId:ctx.schoolId,resourceId:id,ownerUid:ctx.uid,kind:data.kind,title:data.title,
      content:data.content,revision:data.revision||1,archivedRevisionAt:now
    });
    tx.update(ref,{title,content,revision,updatedAt:now});
    tx.create(db.collection(prefix+"planning_audit").doc(),{
      schoolId:ctx.schoolId,resourceId:id,actorUid:ctx.uid,action:"planning_resource_saved",
      kind,revision,createdAt:now});
    result={resourceId:id,revision,created:false,unchanged:false};
   });
   return result;
  }

  const id=resourceId(input.resourceId),ref=resources.doc(id);

  if(action==="get"){
   const doc=await ref.get();
   if(!doc.exists||doc.data().schoolId!==ctx.schoolId||doc.data().status==="archived"||
      !canRead(doc.data(),ctx.uid))deny("not-found","Planning resource is unavailable.");
   const data=doc.data();
   return {...summary(doc,ctx.uid),content:data.content,
    sharedWithUids:data.ownerUid===ctx.uid?(data.sharedWithUids||[]):[]};
  }

  if(action==="history"){
   const current=await ref.get();
   if(!current.exists||current.data().schoolId!==ctx.schoolId||current.data().ownerUid!==ctx.uid)
    deny("permission-denied","Only the owner may inspect planning revision history.");
   const snapshots=await ref.collection("revisions").orderBy("revision","desc").limit(50).get();
   return {resourceId:id,currentRevision:current.data().revision||1,
    revisions:snapshots.docs.map(doc=>({revision:doc.data().revision,title:doc.data().title,
      archivedRevisionAt:doc.data().archivedRevisionAt?.toMillis?.()||null}))};
  }

  if(action==="archive"||action==="restore"){
   const expected=input.expectedRevision;
   if(!Number.isInteger(expected)||expected<1)deny("invalid-argument","Current planning revision is required.");
   const restoring=action==="restore";let result;
   await db.runTransaction(async tx=>{
    await currentTeacher(tx);
    const current=await tx.get(ref);
    if(!current.exists||current.data().schoolId!==ctx.schoolId||current.data().ownerUid!==ctx.uid)
      deny("not-found","Owned planning resource is unavailable.");
    const data=current.data();
    if((data.revision||1)!==expected)deny("failed-precondition","Planning resource changed. Reload first.");
    if(restoring&&data.status!=="archived")deny("failed-precondition","Only an archived resource can be restored.");
    if(!restoring&&data.status==="archived")deny("failed-precondition","Planning resource is already archived.");
    const revision=expected+1,now=FieldValue.serverTimestamp();
    tx.update(ref,{status:restoring?"active":"archived",revision,updatedAt:now,
      ...(restoring?{restoredAt:now}:{archivedAt:now})});
    tx.create(db.collection(prefix+"planning_audit").doc(),{
      schoolId:ctx.schoolId,resourceId:id,actorUid:ctx.uid,
      action:restoring?"planning_resource_restored":"planning_resource_archived",
      revision,createdAt:now});
    result={resourceId:id,status:restoring?"active":"archived",revision};
   });
   return result;
  }

  if(action==="share"){
   const visibility=input.visibility;
   if(!["private","selected_teachers","school_teachers"].includes(visibility))
    deny("invalid-argument","Choose a valid planning sharing audience.");
   const recipients=visibility==="selected_teachers"?input.teacherUids:[];
   if(!Array.isArray(recipients)||recipients.length>30||
      recipients.some(uid=>typeof uid!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(uid)||uid===ctx.uid))
    deny("invalid-argument","Choose up to 30 other teachers in this school.");
   const selected=[...new Set(recipients)].sort();
   if(visibility==="selected_teachers"&&!selected.length)
    deny("invalid-argument","Choose at least one teacher or make the resource private.");
   const memberRefs=selected.map(uid=>db.doc(prefix+"memberships/"+uid));
   await db.runTransaction(async tx=>{
    await currentTeacher(tx);
    const current=await tx.get(ref);
    if(!current.exists||current.data().schoolId!==ctx.schoolId||current.data().ownerUid!==ctx.uid||
       current.data().status==="archived")
      deny("permission-denied","Only the active resource owner may change sharing.");
    const memberships=await Promise.all(memberRefs.map(member=>tx.get(member)));
    if(memberships.some(member=>!member.exists||member.data().schoolId!==ctx.schoolId||
      member.data().status!=="active"||!Array.isArray(member.data().roles)||
      !member.data().roles.includes("teacher")))
      deny("permission-denied","A selected recipient is not an active teacher in this school.");
    const revision=(current.data().revision||1)+1,now=FieldValue.serverTimestamp();
    tx.update(ref,{visibility,sharedWithUids:selected,revision,updatedAt:now});
    tx.create(db.collection(prefix+"planning_audit").doc(),{
      schoolId:ctx.schoolId,resourceId:id,actorUid:ctx.uid,action:"planning_resource_shared",
      audience:visibility,recipientCount:selected.length,revision,createdAt:now});
   });
   return {resourceId:id,visibility,recipientCount:selected.length};
  }

  if(action==="copy"){
   const source=await ref.get();
   if(!source.exists||source.data().schoolId!==ctx.schoolId||source.data().status==="archived"||
      !canRead(source.data(),ctx.uid))deny("permission-denied","This planning resource is not shared with you.");
   const data=source.data(),copyKey="copy:"+id+":"+randomUUID();
   const copyId=deterministicId(ctx,data.kind,copyKey),target=resources.doc(copyId),now=FieldValue.serverTimestamp();
   await db.runTransaction(async tx=>{
    await currentTeacher(tx);
    const fresh=await tx.get(ref);
    if(!fresh.exists||fresh.data().schoolId!==ctx.schoolId||fresh.data().status==="archived"||
      !canRead(fresh.data(),ctx.uid))deny("permission-denied","Planning sharing changed before the copy was created.");
    tx.create(target,{schoolId:ctx.schoolId,ownerUid:ctx.uid,creatorUid:ctx.uid,
      kind:fresh.data().kind,title:fresh.data().title+" · Copy",clientKey:copyKey,
      content:fresh.data().content,status:"active",visibility:"private",sharedWithUids:[],
      revision:1,source:{schoolId:ctx.schoolId,resourceId:id,revision:fresh.data().revision||1},
      createdAt:now,updatedAt:now});
    tx.create(db.collection(prefix+"planning_audit").doc(),{
      schoolId:ctx.schoolId,resourceId:copyId,actorUid:ctx.uid,action:"planning_resource_copied",
      sourceResourceId:id,sourceRevision:fresh.data().revision||1,revision:1,createdAt:now});
   });
   return {resourceId:copyId,revision:1,visibility:"private"};
  }

  deny("invalid-argument","Unknown school planning operation.");
 };
}
module.exports={createSchoolPlanningService,validateContent,deterministicId};
