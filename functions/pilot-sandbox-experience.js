"use strict";
/**
 * Private pilot simulations + consent-based read-only educational preview.
 * Every write uses schools/{schoolId}/pilot_sandboxes/{request.auth.uid}/records.
 * No production grade/assessment/roster/schedule collection is writable here.
 */
const {randomUUID,createHash}=require("node:crypto");
const {TenantAccessError}=require("./tenant-access.js");

function deny(code,message){throw new TenantAccessError(code,message)}
const uid=value=>{
  if(typeof value!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(value))
    deny("invalid-argument","Invalid account.");
  return value;
};
const id=value=>{
  if(typeof value!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(value))
    deny("invalid-argument","Invalid sandbox record.");
  return value;
};
const brief=(value,max=160)=>String(value??"").trim().slice(0,max);
const scalar=(value,max=160)=>brief(value,max).replace(/[\u0000-\u001f]/g," ");
const hash=value=>createHash("sha256").update(value).digest("hex");
const syntheticNames=["Demo Learner 01","Demo Learner 02","Demo Learner 03","Demo Learner 04","Demo Learner 05"];
function grantId(owner,viewer){return hash(uid(owner)+"|"+uid(viewer))}
function teacher(member,schoolId){
 return member?.schoolId===schoolId&&member.status==="active"&&
   Array.isArray(member.roles)&&member.roles.includes("teacher");
}
function rubricOf(value){
  if(!Array.isArray(value)||!value.length||value.length>12)
    deny("invalid-argument","Choose 1–12 valid rubric criteria.");
  const rows=value.map((row,index)=>{
    const name=scalar(row?.name,100),points=Number(row?.points);
    if(!name||!Number.isFinite(points)||points<=0||points>200||Math.abs(Math.round(points*100)/100-points)>0.000001)
      deny("invalid-argument","Criterion "+(index+1)+" needs a name and a valid point maximum.");
    return {name,points};
  });
  const total=rows.reduce((sum,row)=>sum+row.points,0);
  if(total>1000)deny("invalid-argument","Rubric maximum cannot exceed 1,000.");
  return rows;
}
function initialLearners(){
  return syntheticNames.map((name,index)=>({
    key:"demo-"+String(index+1),name,status:index===0?"submitted":"assigned",
    evidence:index===0?"Sample project evidence submitted for review.":"",
    draft:null,published:null,revision:1
  }));
}
function defaultRubric(){return [{name:"Completeness",points:30},{name:"Correctness",points:40},{name:"Code quality",points:30}]}
function normalizeAssessment({title,instructions,section,rubric}){
  return {
    title:scalar(title,140)||"Pilot assessment",
    instructions:scalar(instructions,1800)||"Complete the sample activity and submit a fictional project.",
    section:scalar(section,100)||"Sample Class",
    rubric:rubricOf(rubric||defaultRubric()),
    learners:initialLearners(),lifecycle:"active"
  };
}
function safeRows(rows){
  if(!Array.isArray(rows))return [];
  return rows.slice(0,40).map(row=>({
    type:row?.type==="constant"?"constant":"class",
    startTime:scalar(row?.startTime||row?.start,5),
    endTime:scalar(row?.endTime||row?.end,5),
    eventName:scalar(row?.eventName,110),
    ...Object.fromEntries(["mon","tue","wed","thu","fri"].map(day=>{
      const cell=row?.[day]||{};
      return [day,{sec:scalar(cell?.sec,90),sub:scalar(cell?.sub,90),evt:scalar(cell?.evt,90)}]
    }))
  }));
}
function newDemoTemplates(){
  const now=new Date().toISOString();
  return [
   {id:"pilot-sample-assessment",kind:"assessment",title:"Java programming practical",details:"Full practice workflow: submissions, teacher review, and grade publication.",payload:normalizeAssessment({title:"Java programming practical",section:"Demo ICT – Section A",instructions:"Create a console-based Student Management System using classes, arrays, and input validation."})},
   {id:"pilot-sample-schedule",kind:"schedule",title:"Sample weekly teaching schedule",details:"Private timetable example for the MCS pilot.",payload:{schoolYear:"2026-2027",period:"Semester 1",rows:safeRows([
      {type:"class",startTime:"08:00",endTime:"09:00",mon:{sec:"Demo ICT – Section A",sub:"Computer Programming"},tue:{sec:"Demo ICT – Section A",sub:"Computer Programming"},wed:{sec:"Demo ICT – Section A",sub:"Computer Programming"}},
      {type:"class",startTime:"10:00",endTime:"11:00",thu:{sec:"Demo ICT – Section B",sub:"Computer Programming"},fri:{sec:"Demo ICT – Section B",sub:"Computer Programming"}}
   ])}},
   {id:"pilot-sample-lesson",kind:"lesson",title:"Object-oriented programming lesson",details:"Example lesson planning workspace.",payload:{objective:"Explain classes, objects and encapsulation.",activities:["Warm-up: identify object properties","Guided Java example","Independent console application","Exit ticket"],durationMinutes:60}},
   {id:"pilot-sample-admin",kind:"admin_demo",title:"Sample MCS administration",details:"A fictional school setup for exploring administrative workflows.",payload:{school:"Demo Campus",term:"Semester 1",sections:[{name:"Demo ICT – Section A",learners:5},{name:"Demo ICT – Section B",learners:5}],staff:[{name:"Demo Teacher",role:"Teacher"}]}}
  ].map(({id,kind,title,details,payload})=>({id,kind,title,details,payload,createdAt:now,updatedAt:now}));
}
function shapePreviewSummary(key,snap,source){
  const d=snap.data()||{};
  const title=scalar(d.title||d.name||(key==="schedules"?"Teaching schedule":"Untitled resource"),140);
  const rubric=Array.isArray(d.rubric)?d.rubric.slice(0,12).map(row=>({
    name:scalar(row?.name||row?.criterion,100),points:Number(row?.points||row?.maxPoints)||0
  })).filter(row=>row.name&&row.points>0&&row.points<=200):[];
  return {
    source,sourceId:snap.id,label:title,
    type:key,status:scalar(d.status||d.lifecycle,30),
    schoolYear:scalar(d.schoolYear||d.school_year,24),
    section:scalar(d.sectionId||d.section||d.sectionIds?.[0],100),
    rubric,rubricMax:rubric.reduce((sum,row)=>sum+row.points,0),
    submissionSource:scalar(d.submissionSource||d.type,24)
  };
}
function safeLegacySchedule(data,docId){
  let rows=[];
  try{const parsed=JSON.parse(String(data.json_data||"[]"));rows=safeRows(parsed)}catch{}
  return {
    source:"legacy",sourceId:docId,label:"MCS 2026–2027 "+scalar(data.semester||"")+" timetable",
    type:"schedules",schoolYear:scalar(data.school_year),section:"",
    status:"archived",rows
  };
}
async function authorizePreview({db,ctx,ownerUid}){
  uid(ownerUid);
  if(ctx.uid===ownerUid)return;
  const prefix="schools/"+ctx.schoolId+"/";
  const [grant,ownerMember]=await Promise.all([
    db.doc(prefix+"pilot_preview_grants/"+grantId(ownerUid,ctx.uid)).get(),
    db.doc(prefix+"memberships/"+ownerUid).get()
  ]);
  const g=grant.data();
  if(!grant.exists||g?.schoolId!==ctx.schoolId||g.ownerUid!==ownerUid||
     g.viewerUid!==ctx.uid||g.active!==true||!g.expiresAt||
     !Number.isFinite(Date.parse(g.expiresAt))||Date.parse(g.expiresAt)<=Date.now()||
     !teacher(ownerMember.data(),ctx.schoolId))
    deny("permission-denied","Your teacher preview grant has expired or is unavailable.");
}
function sanitizedGradeAggregate(grades){
  const size=grades.length,final=grades.filter(row=>row.published===true||row.status==="published").length;
  const reviewed=grades.filter(row=>row.reviewRequired===false||row.status==="draft"||row.status==="published").length;
  return {total:size,published:final,unpublished:size-final,reviewed};
}
function safeTitle(value){return scalar(value,140)}
async function readPreview({db,auth,ctx,input}){
  const ownerUid=uid(input.ownerUid||ctx.uid),prefix="schools/"+ctx.schoolId+"/";
  await authorizePreview({db,ctx,ownerUid});
  const buckets=[
    ["schedules","teacher_schedules","v4"],["assessmentBlueprints","assessment_blueprints","v4"],
    ["assessments","assessments","v4_assessment"],["planning","teaching_resources","v4"]
  ];
  const snapshots=await Promise.all(buckets.map(async ([key,path,source])=>{
    const snap=await db.collection(prefix+path).where("ownerUid","==",ownerUid).limit(40).get();
    return [key,snap.docs.filter(d=>d.data()?.schoolId===ctx.schoolId)
      .map(d=>shapePreviewSummary(key,d,source))];
  }));
  const model=Object.fromEntries(snapshots);
  const scheduleCollection=await db.collection("staff_workspaces/"+ownerUid+"/schedules").limit(16).get();
  const personal=scheduleCollection.docs
    .filter(doc=>doc.data()?.ownerUid===ownerUid)
    .map(doc=>safeLegacySchedule(doc.data(),doc.id));
  const legacy={schedules:personal,assessments:[],gradebook:[],sectionNames:[]};
  const v4Tasks=model.assessments.slice(0,15);
  const v4Gradebook=await Promise.all(v4Tasks.map(async task=>{
    const grades=await db.collection(prefix+"student_grades").where("taskId","==",task.sourceId).limit(100).get();
    return {assessmentTitle:task.label,...sanitizedGradeAggregate(grades.docs.map(doc=>doc.data()||{})),source:"v4"};
  }));
  if(ctx.schoolId==="mcs-manila"){
    // Scope legacy preview to the consenting teacher's owned assessments.
    // No fallback to school-wide sections and no unowned assessment enumeration.
    const [school,legacyTasks,userInfo]=await Promise.all([
      db.doc("platform_schools/mcs-manila").get(),
      db.collection("assessments").where("ownerUid","==",ownerUid).limit(35).get(),
      auth.getUser(ownerUid)
    ]);
    if(school.data()?.compatibilityMode!=="v4_only"){
      const ownerEmail=String(userInfo.email||"").toLowerCase();
      const staff=await db.doc("staff_access/"+ownerEmail).get();
      legacy.sectionNames=Array.isArray(staff.data()?.sections)?
        staff.data().sections.slice(0,20).map(x=>scalar(x,100)).filter(Boolean):[];
      const legacyAssessments=legacyTasks.docs.filter(doc=>doc.data()?.ownerUid===ownerUid);
      legacy.assessments=legacyAssessments.map(doc=>shapePreviewSummary("assessments",doc,"legacy"));
      // The shared MCS timetable has a legacy single-teacher permission rule.
      // This is not a general grant to another teacher's school timetable.
      if(ownerEmail==="josephsixson@mcstayuman.edu.ph"){
        const docs=await Promise.all(["master_schedule_SY20262027_S1","master_schedule_SY20262027_S2"]
          .map(id=>db.doc("app_config/"+id).get()));
        legacy.schedules.push(...docs.filter(doc=>doc.exists&&doc.data()?.school_year==="2026-2027")
          .map(doc=>safeLegacySchedule(doc.data(),doc.id)));
      }
      // Aggregate counts only. Never return real student IDs, per-student scores,
      // private feedback, GitHub identities, emails, or evidence payloads.
      const summaries=await Promise.all(legacyAssessments.slice(0,15).map(async task=>{
        const grades=await db.collection("student_grades").where("taskId","==",task.id).limit(100).get();
        return {assessmentTitle:safeTitle(task.data()?.title||"Assessment"),
          ...sanitizedGradeAggregate(grades.docs.map(doc=>doc.data()||{}))};
      }));
      legacy.gradebook=summaries;
    }
  }
  // Structured previews of teacher-owned curricula only. The returned rows
  // are public-facing schedule labels, not grades or individual learners.
  for(const schedule of model.schedules){
    const doc=await db.doc(prefix+"teacher_schedules/"+schedule.sourceId).get();
    schedule.rows=safeRows(doc.data()?.rows);
  }
  for(const schedule of legacy.schedules)if(!Array.isArray(schedule.rows))schedule.rows=[];
  const all={
    schedules:[...model.schedules,...legacy.schedules].slice(0,40),
    assessmentBlueprints:model.assessmentBlueprints,
    assessments:[...model.assessments,...legacy.assessments].slice(0,70),
    planning:model.planning,
    gradebook:[...v4Gradebook,...legacy.gradebook].slice(0,30),sectionNames:legacy.sectionNames
  };
  return {readOnly:true,ownerUid,preview:all,
    scope:"teacher_owned_authorized_read_only",grades:"aggregates_only",legacyIncluded:ctx.schoolId==="mcs-manila"};
}
async function seedDemo({db,ctx}){
  const records=db.collection("schools/"+ctx.schoolId+"/pilot_sandboxes/"+ctx.uid+"/records");
  const templates=newDemoTemplates();
  const targets=await Promise.all(templates.map(template=>records.doc(template.id).get()));
  const batch=db.batch(),created=[];
  for(let i=0;i<templates.length;i++){
    if(targets[i].exists)continue;
    const {id,kind,title,details,payload,createdAt,updatedAt}=templates[i];
    batch.create(records.doc(id),{schoolId:ctx.schoolId,ownerUid:ctx.uid,
      kind,title,details,payload,version:1,createdAt,updatedAt});
    created.push(id);
  }
  if(created.length)await batch.commit();
  return {created,alreadyPresent:templates.length-created.length};
}
async function createAssessment({db,ctx,input}){
  const records=db.collection("schools/"+ctx.schoolId+"/pilot_sandboxes/"+ctx.uid+"/records");
  const existing=await records.limit(100).get();
  if(existing.size>=100)deny("resource-exhausted","Your private sandbox holds 100 records.");
  const payload=normalizeAssessment(input);
  const ref=records.doc("assessment-"+randomUUID());
  const now=new Date().toISOString();
  await ref.create({schoolId:ctx.schoolId,ownerUid:ctx.uid,kind:"assessment",
    title:payload.title,details:"Private pilot assessment simulation.",payload,
    version:1,createdAt:now,updatedAt:now});
  return {recordId:ref.id};
}
async function clonePreview({db,auth,ctx,input}){
  const ownerUid=uid(input.ownerUid||ctx.uid),sourceId=id(input.sourceId);
  const type=String(input.source||"");
  const allowed={v4:"assessment_blueprints",v4_assessment:"assessments",legacy:"assessments"};
  const path=allowed[type];
  if(!path)deny("invalid-argument","This resource cannot be copied to a private sandbox.");
  await authorizePreview({db,ctx,ownerUid});
  if(type==="legacy"&&ctx.schoolId!=="mcs-manila")
    deny("permission-denied","Legacy preview is limited to the MCS school.");
  if(type==="legacy"){
    const school=await db.doc("platform_schools/mcs-manila").get();
    if(school.data()?.compatibilityMode==="v4_only")
      deny("failed-precondition","The legacy teacher preview is retired after school cutover.");
  }
  const ref=type==="legacy"?db.doc("assessments/"+sourceId):
    db.doc("schools/"+ctx.schoolId+"/"+path+"/"+sourceId);
  const original=await ref.get(),data=original.data();
  if(!original.exists||data?.ownerUid!==ownerUid||
    (type!=="legacy"&&data.schoolId!==ctx.schoolId))
    deny("permission-denied","The teacher-owned source is no longer available.");
  // Public rubric and assessment title only: never copy private answer keys,
  // teacher-only instructions, live scores, student identities, or real evidence.
  const rubric=Array.isArray(data.rubric)?data.rubric.map(r=>({name:r?.name,points:r?.points})):null;
  const normalized=normalizeAssessment({title:data.title,section:"Demo class",
    instructions:"Practice task copied from an authorized teacher-owned assessment title and rubric.",
    rubric:rubric?.length?rubric:defaultRubric()});
  const records=db.collection("schools/"+ctx.schoolId+"/pilot_sandboxes/"+ctx.uid+"/records");
  const count=await records.limit(100).get();
  if(count.size>=100)deny("resource-exhausted","Your private sandbox holds 100 records.");
  const next=records.doc("assessment-"+randomUUID()),now=new Date().toISOString();
  await next.create({schoolId:ctx.schoolId,ownerUid:ctx.uid,kind:"assessment",
    title:normalized.title,details:"Fictional independent assessment example copied from an authorized teacher preview.",
    payload:normalized,version:1,createdAt:now,updatedAt:now,
    source:{sourceKind:type,originalOwnedBy:ownerUid}});
  return {recordId:next.id};
}
async function updateLearner({db,ctx,input}){
  const records=db.collection("schools/"+ctx.schoolId+"/pilot_sandboxes/"+ctx.uid+"/records");
  const ref=records.doc(id(input.recordId));
  const action=String(input.action),learnerKey=String(input.learnerKey||"");
  const reason=scalar(input.feedback,1200);
  let outcome;
  await db.runTransaction(async tx=>{
    const current=await tx.get(ref),d=current.data();
    if(!current.exists||d.ownerUid!==ctx.uid||d.schoolId!==ctx.schoolId||
      d.kind!=="assessment"||!d.payload||!Array.isArray(d.payload.learners))
      deny("not-found","Your simulated assessment was not found.");
    const version=d.version||1;
    if(!Number.isInteger(input.expectedVersion)||input.expectedVersion!==version)
      deny("failed-precondition","This private assessment changed. Refresh before continuing.");
    const learners=d.payload.learners.map(row=>({...row})),index=learners.findIndex(row=>row.key===learnerKey);
    if(index<0)deny("invalid-argument","Choose a fictional demo learner.");
    const learner=learners[index];
    if(action==="sim_submit"){
      if(!["assigned","reopened"].includes(learner.status))
        deny("failed-precondition","Only assigned or reopened demo work can be submitted.");
      learner.status="submitted";
      learner.evidence=scalar(input.evidence||"Simulated project source submitted.",1000);
      learner.draft=null;learner.published=null;
    }else if(action==="sim_grade_draft"){
      if(!["submitted","draft"].includes(learner.status))
        deny("failed-precondition","Submit the fictional learner's work before grading.");
      const max=d.payload.rubric.reduce((sum,row)=>sum+Number(row.points),0);
      const score=Number(input.score);
      if(!Number.isFinite(score)||score<0||score>max||Math.abs(Math.round(score*100)/100-score)>0.000001)
        deny("invalid-argument","Grade must be between 0 and the rubric maximum.");
      if(reason.length<10)deny("invalid-argument","Provide at least 10 characters of practice feedback.");
      learner.draft={score,maxScore:max,feedback:reason};
      learner.status="draft";
    }else if(action==="sim_grade_publish"){
      if(learner.status!=="draft"||!learner.draft)
        deny("failed-precondition","Save a private simulated grading draft before publishing.");
      learner.published={...learner.draft};
      learner.status="published";
    }else if(action==="sim_reopen"){
      if(!["submitted","draft","published"].includes(learner.status))
        deny("failed-precondition","Only submitted or reviewed mock work can be reopened.");
      learner.status="reopened";learner.draft=null;learner.published=null;
    }else{
      deny("invalid-argument","Unknown sandbox simulation operation.");
    }
    learner.revision=(learner.revision||1)+1;
    const next={...d.payload,learners};
    tx.update(ref,{payload:next,version:version+1,updatedAt:new Date().toISOString()});
    outcome={recordId:ref.id,learnerKey,status:learner.status,version:version+1};
  });
  return outcome;
}

function clock(value){
  const s=String(value||"");
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(s))
    deny("invalid-argument","Use 24-hour HH:MM times.");
  return Number(s.slice(0,2))*60+Number(s.slice(3,5));
}
function sanitizedSchedule(input){
  const rows=input.rows;
  if(!Array.isArray(rows)||rows.length>35)deny("invalid-argument","A practice timetable can contain up to 35 rows.");
  const entries=safeRows(rows),occupied=[];
  for(const [index,row] of entries.entries()){
    const start=clock(row.startTime),end=clock(row.endTime);
    if(start>=end)deny("invalid-argument","Schedule row "+(index+1)+" must end after it starts.");
    occupied.push({start,end});
    if(row.type==="constant"&&!row.eventName)
      deny("invalid-argument","Constant schedule events require a name.");
    if(row.type==="class"&&!["mon","tue","wed","thu","fri"].some(day=>
      row[day]?.sec&&row[day]?.sub))
      deny("invalid-argument","Class schedule rows must have at least one day with subject and section.");
  }
  occupied.sort((a,b)=>a.start-b.start);
  for(let i=1;i<occupied.length;i++)if(occupied[i].start<occupied[i-1].end)
    deny("invalid-argument","Your practice schedule contains overlapping time blocks.");
  return {schoolYear:scalar(input.schoolYear,20)||"2026-2027",
    period:scalar(input.period,80)||"Semester 1",rows:entries};
}
async function updateModule({db,ctx,input}){
  const kind=({save_demo_schedule:"schedule",save_demo_lesson:"lesson",sim_admin:"admin_demo"})[String(input.action)];
  if(!kind)deny("invalid-argument","Unknown private module.");
  const ref=db.doc("schools/"+ctx.schoolId+"/pilot_sandboxes/"+ctx.uid+"/records/"+id(input.recordId));
  let result;
  await db.runTransaction(async tx=>{
    const doc=await tx.get(ref),data=doc.data();
    if(!doc.exists||data?.schoolId!==ctx.schoolId||data?.ownerUid!==ctx.uid||data?.kind!==kind)
      deny("not-found","This private module is not available.");
    const version=data.version||1;
    if(version!==input.expectedVersion)deny("failed-precondition","This example changed. Refresh before editing.");
    let payload;
    if(kind==="schedule"){
      payload=sanitizedSchedule(input);
    }else if(kind==="lesson"){
      const activities=input.activities;
      if(!Array.isArray(activities)||activities.length>12)
        deny("invalid-argument","Choose up to 12 lesson activities.");
      const objective=scalar(input.objective,600);
      if(!objective)deny("invalid-argument","Lesson objective is required.");
      payload={objective,activities:activities.map(x=>scalar(x,180)).filter(Boolean),
        durationMinutes:Number(input.durationMinutes)||60};
      if(payload.durationMinutes<10||payload.durationMinutes>240)
        deny("invalid-argument","Lesson duration must be 10–240 minutes.");
    }else{
      const previous=data.payload||{},command=String(input.command);
      payload={school:scalar(previous.school,120)||"Demo Campus",
        term:scalar(previous.term,80)||"Semester 1",
        sections:Array.isArray(previous.sections)?previous.sections.slice(0,20):[],
        staff:Array.isArray(previous.staff)?previous.staff.slice(0,20):[]};
      if(command==="add_section"){
        const name=scalar(input.name,100);
        if(!name||payload.sections.length>=20||payload.sections.some(row=>row.name===name))
          deny("invalid-argument","Choose a unique fictional section name (maximum 20).");
        payload.sections.push({name,learners:5});
      }else if(command==="add_staff"){
        const name=scalar(input.name,100);
        if(!name||payload.staff.length>=20||payload.staff.some(row=>row.name===name))
          deny("invalid-argument","Choose a unique fictional staff label (maximum 20).");
        payload.staff.push({name,role:"Teacher"});
      }else if(command==="set_term"){
        payload.term=scalar(input.name,80);
        if(!payload.term)deny("invalid-argument","Enter a fictional academic term.");
      }else deny("invalid-argument","Unknown administration demo operation.");
    }
    tx.update(ref,{payload,updatedAt:new Date().toISOString(),version:version+1});
    result={recordId:ref.id,kind,version:version+1};
  });
  return result;
}

async function runPilotExperience({db,auth,ctx,input}){
  const action=String(input.action);
  if(["save_demo_schedule","save_demo_lesson","sim_admin"].includes(action))
    return updateModule({db,ctx,input});
  if(action==="preview_dashboard")return readPreview({db,auth,ctx,input});
  if(action==="seed_demo")return seedDemo({db,ctx});
  if(action==="create_demo_assessment")return createAssessment({db,ctx,input});
  if(action==="clone_preview")return clonePreview({db,auth,ctx,input});
  if(["sim_submit","sim_grade_draft","sim_grade_publish","sim_reopen"].includes(action))
    return updateLearner({db,ctx,input});
  deny("invalid-argument","Unknown pilot experience operation.");
}
module.exports={runPilotExperience};
