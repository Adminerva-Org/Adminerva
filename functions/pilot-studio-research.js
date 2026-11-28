"use strict";
/**
 * First-party pilot research telemetry. Only explicitly designated test students
 * with a verified, active school membership can contribute observations.
 * Raw source, editor text, clipboard, filenames, terminal output and grades
 * are never accepted. Events are observational and never grading evidence.
 */
const {getSchoolContext,platformAuthority,TenantAccessError}=require("./tenant-access.js");

const EVENT_TYPES=Object.freeze(["project_open","editor_activity","run_finished","cloud_saved"]);
const RUN_MODES=Object.freeze(["console","desktop","web","python","other"]);
const RUN_OUTCOMES=Object.freeze(["success","compile_error","runtime_error","cancelled","unknown"]);
const MAX_EVENTS_PER_DAY=600;
const RETENTION_DAYS=90;
const MAX_SCHOOLS=30;
const SAMPLE_LIMIT=500;
const DAY_MS=86400000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function deny(code,message){throw new TenantAccessError(code,message);}
function validUuid(value){return typeof value==="string"&&UUID.test(value);}
function checkedEvent(value){
  if(!value||typeof value!=="object"||Array.isArray(value))deny("invalid-argument","Research event is invalid.");
  const keys=Object.keys(value);
  if(keys.some(key=>!["eventId","sessionId","projectId","type","mode","outcome","editCount"].includes(key)))
    deny("invalid-argument","Research events accept only approved metadata.");
  if(!validUuid(value.eventId)||!validUuid(value.sessionId))
    deny("invalid-argument","Research event identifiers are invalid.");
  const projectId=String(value.projectId||"");
  if(!/^[A-Za-z0-9_-]{1,160}$/.test(projectId))
    deny("invalid-argument","Research project reference is invalid.");
  if(!EVENT_TYPES.includes(value.type))deny("invalid-argument","Research event category is invalid.");
  if(value.type==="editor_activity"){
    if(!Number.isInteger(value.editCount)||value.editCount<1||value.editCount>250||
      value.mode!==undefined||value.outcome!==undefined)
      deny("invalid-argument","Editor observations must contain only a bounded change count.");
  }else if(value.type==="run_finished"){
    if(!RUN_MODES.includes(value.mode)||!RUN_OUTCOMES.includes(value.outcome)||value.editCount!==undefined)
      deny("invalid-argument","Execution observations must contain only approved run categories.");
  }else if(value.mode!==undefined||value.outcome!==undefined||value.editCount!==undefined){
    deny("invalid-argument","This research event contains unrelated details.");
  }
  return {
    schemaVersion:1,eventId:value.eventId.toLowerCase(),sessionId:value.sessionId.toLowerCase(),
    projectId,type:value.type,
    ...(value.type==="editor_activity"?{editCount:value.editCount}:{}),
    ...(value.type==="run_finished"?{mode:value.mode,outcome:value.outcome}:{})
  };
}

function createPilotStudioResearchService({db,FieldValue,Timestamp,now=Date.now}){
  if(!db||!FieldValue||!Timestamp)throw Error("Pilot research requires Firestore dependencies.");
  const designated=data=>data?.kind==="student"&&data?.status==="active";
  async function ownPrivacy(request,input,action){
    const owner=request?.auth?.uid;
    if(request?.auth?.token?.email_verified!==true||typeof owner!=="string"||!owner||owner.includes("/"))deny("unauthenticated","Sign in with a verified account.");
    if(Object.keys(input).some(key=>!(action==="privacy_status"?["action"]:["action","enabled"]).includes(key)))deny("invalid-argument","Choose your own research preference.");
    const ref=db.doc("platform_test_accounts/"+owner);
    if(action==="privacy_status"){
      const data=(await ref.get()).data();return {designated:designated(data),enabled:designated(data)&&data.researchOptOut!==true};
    }
    if(typeof input.enabled!=="boolean")deny("invalid-argument","Choose a research preference.");
    return db.runTransaction(async tx=>{
      const current=(await tx.get(ref)).data();
      if(!designated(current))deny("permission-denied","Only active designated test accounts can change this preference.");
      // The preference does not grant, retire or change the test designation.
      tx.set(ref,{...current,researchOptOut:!input.enabled,researchPreferenceUpdatedAt:FieldValue.serverTimestamp()});
      return {designated:true,enabled:input.enabled};
    });
  }
  async function eligible(request,schoolId){
    const context=await getSchoolContext({db,request,schoolId,roles:["student"]});
    if(context.platformOverride||!context.roles.includes("student"))return {context,enabled:false};
    const designation=await db.doc("platform_test_accounts/"+context.uid).get();
    const data=designation.exists?designation.data():null;
    return {context,enabled:designated(data)&&data.researchOptOut!==true,optedOut:designated(data)&&data.researchOptOut===true};
  }
  async function record(request){
    const input=request.data||{};
    const {context,enabled,optedOut}=await eligible(request,input.schoolId);
    if(optedOut)return {recorded:false,disabled:true};
    if(!enabled)deny("permission-denied","Pilot research is restricted to designated test accounts.");
    const event=checkedEvent(input.event),day=new Date(now()).toISOString().slice(0,10),
      prefix="schools/"+context.schoolId+"/",
      eventRef=db.doc(prefix+"pilot_research_events/"+context.uid+"_"+event.eventId),
      quotaRef=db.doc(prefix+"pilot_research_quotas/"+context.uid+"_"+day);
    return db.runTransaction(async tx=>{
      const designation=(await tx.get(db.doc("platform_test_accounts/"+context.uid))).data();
      if(!designated(designation))deny("permission-denied","Pilot research is restricted to designated test accounts.");
      if(designation.researchOptOut===true)return {recorded:false,disabled:true};
      const existing=await tx.get(eventRef);
      if(existing.exists)return {recorded:true,duplicate:true};
      const quota=await tx.get(quotaRef),count=Number(quota.data()?.count)||0;
      if(count>=MAX_EVENTS_PER_DAY)deny("resource-exhausted","Pilot activity recording reached its daily safety limit.");
      const at=now();
      tx.set(quotaRef,{ownerUid:context.uid,day,count:count+1,
        updatedAt:FieldValue.serverTimestamp(),expiresAt:Timestamp.fromMillis(at+RETENTION_DAYS*DAY_MS)});
      tx.create(eventRef,{
        ...event,ownerUid:context.uid,schoolId:context.schoolId,
        collectionSource:"designated_test_account",createdAt:FieldValue.serverTimestamp(),
        expiresAt:Timestamp.fromMillis(at+RETENTION_DAYS*DAY_MS)
      });
      return {recorded:true,duplicate:false};
    });
  }
  return async request=>{
    const input=request.data||{},action=String(input.action||"status");
    if(action==="privacy_status"||action==="set_research_collection")return ownPrivacy(request,input,action);
    if(action==="status"){
      const {enabled}=await eligible(request,input.schoolId);
      return {enabled,pilotOnly:true,consentPromptRequired:false};
    }
    if(action==="record")return record(request);
    deny("invalid-argument","Unknown pilot research operation.");
  };
}

/**
 * Summarize only sanitized metadata from the bounded event sample.
 * Distinct accounts, sessions and projects here are sample coverage, never
 * whole-cohort population counts. Do not return their raw identifiers.
 */
function summarizePilotEvents(events,{now=Date.now(),since=now-30*DAY_MS}={}){
  const types={},outcomes={},modes={},participants=new Set(),sessions=new Set(),projects=new Set(),days=new Map();
  let editChanges=0,firstAt=null,lastAt=null,valid=0;
  for(const event of events){
    const row=typeof event?.data==="function"?event.data():event;
    const stamp=row?.createdAt;
    const ms=typeof stamp?.toMillis==="function"?stamp.toMillis():
      stamp instanceof Date?stamp.getTime():NaN;
    if(!Number.isFinite(ms)||ms<since||ms>now||!EVENT_TYPES.includes(row?.type))continue;
    valid++;
    types[row.type]=(types[row.type]||0)+1;
    if(typeof row.ownerUid==="string")participants.add(row.ownerUid);
    if(typeof row.sessionId==="string"&&typeof row.ownerUid==="string")
      sessions.add(row.ownerUid+":"+row.sessionId);
    if(typeof row.projectId==="string"&&typeof row.ownerUid==="string")
      projects.add(row.ownerUid+":"+row.projectId);
    if(row.type==="editor_activity"&&Number.isInteger(row.editCount))
      editChanges+=Math.max(0,Math.min(250,row.editCount));
    if(row.type==="run_finished"){
      if(RUN_OUTCOMES.includes(row.outcome))outcomes[row.outcome]=(outcomes[row.outcome]||0)+1;
      if(RUN_MODES.includes(row.mode))modes[row.mode]=(modes[row.mode]||0)+1;
    }
    const day=new Date(ms).toISOString().slice(0,10);
    days.set(day,(days.get(day)||0)+1);
    firstAt=firstAt===null?ms:Math.min(firstAt,ms);
    lastAt=lastAt===null?ms:Math.max(lastAt,ms);
  }
  return {
    events:valid,observedAccounts:participants.size,observedSessions:sessions.size,
    observedProjects:projects.size,editorChanges:editChanges,
    eventsByType:types,runsByOutcome:outcomes,runsByMode:modes,
    dailyEvents:[...days].sort(([a],[b])=>a.localeCompare(b)).map(([day,count])=>({day,count})),
    firstObservedAt:firstAt,lastObservedAt:lastAt
  };
}

async function platformPilotResearchOverview({db,request,now=Date.now}){
  const authority=await platformAuthority({db,request});
  if(!authority.platformAdmin)deny("permission-denied","Platform Administrator access is required.");
  const schools=await db.collection("platform_schools").limit(MAX_SCHOOLS+1).get();
  if(schools.size>MAX_SCHOOLS)
    deny("resource-exhausted","The school registry exceeds pilot overview limits; add pagination before reporting.");
  const visible=schools.docs.filter(doc=>["draft","pilot","active"].includes(doc.data()?.state));
  const cutoff=now(),since=cutoff-30*DAY_MS;
  const results=[];
  for(const school of visible){
    const prefix="schools/"+school.id+"/";
    const names=["people","memberships","enrollments","assessments","studio_submissions","github_evidence","student_grades"];
    const counts=await Promise.all(names.map(async name=>{
      const result=await db.collection(prefix+name).count().get();
      return Number(result.data()?.count)||0;
    }));
    // The total is an exact count of the 30-day event window. Detailed process
    // statistics use a bounded recent sample and expose its coverage explicitly.
    const events=db.collection(prefix+"pilot_research_events")
      .where("createdAt",">=",new Date(since))
      .where("createdAt","<=",new Date(cutoff));
    const [totalSnap,sampleSnap]=await Promise.all([
      events.count().get(),
      events.orderBy("createdAt","desc").limit(SAMPLE_LIMIT+1).get()
    ]);
    const totalEvents=Number(totalSnap.data()?.count)||0;
    const sample=summarizePilotEvents(sampleSnap.docs.slice(0,SAMPLE_LIMIT),{since,now:cutoff});
    const truncated=totalEvents>sample.events;
    results.push({
      schoolId:school.id,schoolName:String(school.data()?.displayName||school.id).slice(0,120),
      schoolState:school.data()?.state,counts:Object.fromEntries(names.map((name,index)=>[name,counts[index]])),
      pilotSample:{
        windowDays:30,limit:SAMPLE_LIMIT,truncated,totalEvents,
        coveragePercent:totalEvents>0?Math.round(sample.events/totalEvents*10000)/100:100,
        ...sample
      }
    });
  }
  // Legacy flat collections predate canonical school records. Report them
  // separately: some identities and assessments already project into V4.
  const legacyNames=["students","assessments","student_grades","student_submissions","assessment_evidence","activity_events"];
  const legacyValues=await Promise.all(legacyNames.map(async name=>{
    const result=await db.collection(name).count().get();
    return Number(result.data()?.count)||0;
  }));
  return {generatedAt:cutoff,schools:results,scope:"aggregate_only",
    legacySourceCounts:Object.fromEntries(legacyNames.map((name,index)=>[name,legacyValues[index]])),
    note:"School and legacy source totals are counted separately because historical data can overlap with canonical projections. Pilot event totals use exact 30-day counts. Detailed process distributions are bounded to a recent 500-event sample per school with explicit coverage. No code, grades, names or participant identifiers are returned."};
}

async function cleanupPilotResearch({db,Timestamp,now=Date.now,maxPerSchool=400}){
  let removed=0,truncated=false,lastSchool=null;
  do{
    let schoolQuery=db.collection("platform_schools").orderBy("__name__").limit(MAX_SCHOOLS);
    if(lastSchool)schoolQuery=schoolQuery.startAfter(lastSchool);
    const schools=await schoolQuery.get();
    for(const school of schools.docs){
      for(const collectionName of ["pilot_research_events","pilot_research_quotas"]){
        const query=db.collection("schools/"+school.id+"/"+collectionName)
          .where("expiresAt","<=",Timestamp.fromMillis(now())).limit(maxPerSchool);
        const expired=await query.get();
        if(!expired.empty){
          for(let offset=0;offset<expired.docs.length;offset+=400){
            const batch=db.batch();
            for(const item of expired.docs.slice(offset,offset+400))batch.delete(item.ref);
            await batch.commit();
          }
          removed+=expired.size;
          if(expired.size===maxPerSchool)truncated=true;
        }
      }
    }
    if(schools.size<MAX_SCHOOLS)break;
    lastSchool=schools.docs.at(-1);
  }while(lastSchool);
  return {removed,truncated};
}

module.exports={
  EVENT_TYPES,RUN_MODES,RUN_OUTCOMES,MAX_EVENTS_PER_DAY,RETENTION_DAYS,checkedEvent,summarizePilotEvents,
  createPilotStudioResearchService,platformPilotResearchOverview,cleanupPilotResearch
};
