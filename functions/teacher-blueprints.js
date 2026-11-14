"use strict";
const {createHash}=require("node:crypto");
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
const PERSONALIZATION_MODE="ai_blueprint_pool_v1";
const MAX_PERSONALIZED_POOL=600;
function personalizationContent(input={}) {
  const raw=input&&typeof input==="object"&&!Array.isArray(input)?input:{};
  const enabled=raw.enabled===true||raw.mode===PERSONALIZATION_MODE;
  if(!enabled)return {enabled:false,mode:"standard",variantTarget:0,variationGuidance:""};
  const variantTarget=Number(raw.variantTarget||raw.poolTarget||30);
  if(!Number.isInteger(variantTarget)||variantTarget<10||variantTarget>MAX_PERSONALIZED_POOL)
    deny("invalid-argument","Personalized assessments need a target of 10–600 variants.");
  return {
    enabled:true,mode:PERSONALIZATION_MODE,variantTarget,
    variationGuidance:cleanText(raw.variationGuidance||raw.guidance||"",3000,"Variation guidance")
  };
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
      deny("invalid-argument","Each criterion must have between 1 and 100 points.");
    return {name,points};
  });
  return {title,description,instructions,rubric:criteria,
    personalization:personalizationContent(input.personalization)};
}
function blueprintFingerprint(data){
  const value=reusableContent(data),personalization=value.personalization||{};
  const stable={...value,personalization:{
    enabled:personalization.enabled===true,mode:personalization.mode||"standard",
    variationGuidance:personalization.variationGuidance||""
  }};
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}
function normalizeScenarioKey(value){
  return String(value||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"").replace(/_+/g,"_").slice(0,80);
}
function normalizeScenarioTitle(value){
  return String(value||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase().replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ").slice(0,140);
}
function cleanPersonalizedVariant(item,index){
  if(!item||typeof item!=="object"||Array.isArray(item))
    deny("invalid-argument","Variant "+(index+1)+" is malformed.");
  const prompt=cleanText(item.prompt||"",12000,"Variant prompt",{required:true}),
    evaluationNotes=cleanText(item.evaluationNotes||"",8000,"Variant evaluation notes",{required:true}),
    summary=cleanText(item.summary||"",300,"Variant summary",{required:true}),
    scenarioTitle=cleanText(item.scenarioTitle||item.title||"",120,"Variant scenario title",{required:true}),
    scenarioKey=normalizeScenarioKey(item.scenarioKey||scenarioTitle);
  if(prompt.length<80||evaluationNotes.length<10||scenarioKey.length<3)
    deny("invalid-argument","Variant "+(index+1)+" is incomplete.");
  const variantId=createHash("sha256").update(prompt).digest("hex").slice(0,24);
  return {variantId,scenarioKey,scenarioTitle,prompt,evaluationNotes,summary};
}
function serialize(doc,access) {
  const data=doc.data();
  return {
    id:doc.id,schoolId:data.schoolId,ownerUid:data.ownerUid,
    creatorUid:data.creatorUid,visibility:data.visibility,
    title:data.title,description:data.description,instructions:data.instructions,
    rubric:data.rubric,personalization:personalizationContent(data.personalization),
    contentRevision:data.contentRevision,aclRevision:data.aclRevision,
    copiedFrom:data.copiedFrom||null,
    sharedWithUids:(access.uid===data.ownerUid||access.platformOverride===true)?
      (Array.isArray(data.sharedWithUids)?data.sharedWithUids:[]):[],
    canShare:access.uid===data.ownerUid||access.platformOverride===true,
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
      if(!school.exists||!["active","pilot"].includes(school.data().state))
        deny("permission-denied","This school is not currently available for teacher work.");
    };
    const assertCurrentTeacher=member=>{
      if(ctx.platformOverride)return;
      if(!member.exists||member.data().schoolId!==ctx.schoolId||member.data().status!=="active"||
         !Array.isArray(member.data().roles)||!member.data().roles.includes("teacher"))
        deny("permission-denied","Your teaching access changed. Refresh and try again.");
    };
    const action=input.action;
    if(["personalization_status","personalization_import","personalization_activate"].includes(action)){
      const id=documentId(input.resourceId),ref=collection.doc(id);
      const blueprint=await ref.get();
      if(!blueprint.exists||blueprint.data().schoolId!==ctx.schoolId||
         (!ctx.platformOverride&&blueprint.data().ownerUid!==ctx.uid))
        deny("permission-denied","Only the assessment owner can manage its private personalization pool.");
      if(blueprint.data().status!=="draft")
        deny("failed-precondition","Only a draft blueprint can manage a personalization pool.");
      const current=blueprint.data(),blueprintOwner=current.ownerUid,
        config=personalizationContent(current.personalization);
      if(!config.enabled)
        deny("failed-precondition","Enable Personalized mode on this blueprint before managing variants.");
      const fingerprint=blueprintFingerprint(current);
      const poolRef=db.doc("schools/"+ctx.schoolId+"/assessment_blueprint_private/"+id+"/pools/"+fingerprint);
      if(action==="personalization_status"){
        const pool=await poolRef.get(),data=pool.exists?pool.data():{};
        const variantIds=Array.isArray(data.variantIds)?data.variantIds:[],
          registry=Array.isArray(data.scenarioRegistry)?data.scenarioRegistry:[];
        const samples=[];
        for(const variantId of variantIds.slice(0,3)){
          const sample=await poolRef.collection("variants").doc(variantId).get();
          if(sample.exists){
            const value=sample.data();
            samples.push({variantId,scenarioTitle:value.scenarioTitle||"",summary:value.summary||"",
              prompt:value.prompt||"",evaluationNotes:value.evaluationNotes||""});
          }
        }
        return {resourceId:id,fingerprint,variantTarget:config.variantTarget,
          count:variantIds.length,ready:data.ready===true&&variantIds.length>=config.variantTarget,
          scenarioRegistry:registry,samples};
      }
      const expectedRevision=Number(input.expectedRevision);
      if(!Number.isInteger(expectedRevision)||expectedRevision!==current.contentRevision)
        deny("failed-precondition","This assessment changed. Reload it before updating personalization.");
      if(action==="personalization_import"){
        const incoming=Array.isArray(input.variants)?input.variants:[];
        if(!incoming.length||incoming.length>45)
          deny("invalid-argument","Import 1–45 personalized variants per batch.");
        const clean=incoming.map(cleanPersonalizedVariant);
        await db.runTransaction(async tx=>{
          const [latest,pool]=await Promise.all([tx.get(ref),tx.get(poolRef)]);
          if(!latest.exists||(!ctx.platformOverride&&latest.data().ownerUid!==ctx.uid)||
             latest.data().contentRevision!==expectedRevision||
             blueprintFingerprint(latest.data())!==fingerprint)
            deny("failed-precondition","The blueprint changed while importing variants.");
          const stored=pool.exists?pool.data():{},
            ids=Array.isArray(stored.variantIds)?stored.variantIds.slice():[],
            registry=Array.isArray(stored.scenarioRegistry)?stored.scenarioRegistry.slice():[],
            idSet=new Set(ids),keySet=new Set(registry.map(row=>row.scenarioKey)),
            titleSet=new Set(registry.map(row=>normalizeScenarioTitle(row.scenarioTitle)));
          for(const [index,variant] of clean.entries()){
            const titleKey=normalizeScenarioTitle(variant.scenarioTitle);
            if(idSet.has(variant.variantId)||keySet.has(variant.scenarioKey)||titleSet.has(titleKey))
              deny("already-exists","Variant "+(index+1)+" repeats an existing scenario or prompt.");
            if(ids.length>=MAX_PERSONALIZED_POOL)
              deny("resource-exhausted","This personalization pool already reached 600 variants.");
            idSet.add(variant.variantId);keySet.add(variant.scenarioKey);titleSet.add(titleKey);
            ids.push(variant.variantId);
            registry.push({scenarioKey:variant.scenarioKey,scenarioTitle:variant.scenarioTitle,summary:variant.summary});
            tx.create(poolRef.collection("variants").doc(variant.variantId),{
              ...variant,schoolId:ctx.schoolId,ownerUid:blueprintOwner,blueprintId:id,
              fingerprint,createdAt:FieldValue.serverTimestamp()
            });
          }
          const payload={schoolId:ctx.schoolId,ownerUid:blueprintOwner,blueprintId:id,
            blueprintRevision:expectedRevision,fingerprint,variantIds:ids,scenarioRegistry:registry,
            count:ids.length,target:config.variantTarget,ready:false,updatedAt:FieldValue.serverTimestamp()};
          if(pool.exists)tx.update(poolRef,payload);else tx.create(poolRef,{...payload,createdAt:FieldValue.serverTimestamp()});
        });
        const updated=await poolRef.get();
        return {resourceId:id,fingerprint,count:updated.data().variantIds.length,
          variantTarget:config.variantTarget,ready:updated.data().ready===true};
      }
      await db.runTransaction(async tx=>{
        const [latest,pool]=await Promise.all([tx.get(ref),tx.get(poolRef)]);
        if(!latest.exists||latest.data().ownerUid!==ctx.uid||
           latest.data().contentRevision!==expectedRevision||
           blueprintFingerprint(latest.data())!==fingerprint)
          deny("failed-precondition","The blueprint changed before pool activation.");
        if(!pool.exists)deny("failed-precondition","Import personalized variants before activation.");
        const ids=Array.isArray(pool.data().variantIds)?pool.data().variantIds:[];
        if(ids.length<config.variantTarget)
          deny("failed-precondition","The private pool has "+ids.length+" of "+config.variantTarget+" required variants.");
        tx.update(poolRef,{ready:true,target:config.variantTarget,blueprintRevision:expectedRevision,
          activatedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
      });
      return {resourceId:id,fingerprint,variantTarget:config.variantTarget,ready:true};
    }
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
      if(ctx.platformOverride){
        const all=await collection.limit(151).get();
        return {items:all.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&doc.data().status!=="archived")
          .slice(0,150).map(doc=>serialize(doc,ctx)),truncated:all.size===151};
      }
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
        if(!original.exists||original.data().schoolId!==ctx.schoolId||
           (!ctx.platformOverride&&original.data().ownerUid!==ctx.uid))
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
        if(!original.exists||original.data().schoolId!==ctx.schoolId||
           (!ctx.platformOverride&&original.data().ownerUid!==ctx.uid))
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
          original.data().status==="archived"||(!ctx.platformOverride&&!canReadBlueprint(original.data(),ctx.uid)))
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
module.exports={createTeacherBlueprintService,reusableContent,canReadBlueprint,blueprintFingerprint,
  personalizationContent,PERSONALIZATION_MODE,MAX_PERSONALIZED_POOL};
