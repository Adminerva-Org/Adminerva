/** Administrator-directed recovery; immutable originals, explicit provenance and bounded copies. */
const {createHash}=require("node:crypto");
const {teachingProfile}=require("./teaching-access-service.js");
const ADMIN_EMAIL="babaynike2013@gmail.com",ORIGINAL_EMAIL="josephsixson@mcstayuman.edu.ph";
function fail(code,message){const error=Error(message);error.code=code;throw error;}
function administrator(request){if(!request.auth?.uid||request.auth.token?.email_verified!==true||request.auth.token.email?.toLowerCase()!==ADMIN_EMAIL)fail("permission-denied","Verified administrator access is required.");return request.auth.uid;}
async function originalTeacher(resolveUserByEmail){
  let user;try{user=await resolveUserByEmail(ORIGINAL_EMAIL);}catch{fail("failed-precondition","The original teacher must sign in with the verified school account before recovery.");}
  if(!user?.uid||user.disabled||!user.emailVerified||user.email?.toLowerCase()!==ORIGINAL_EMAIL)fail("failed-precondition","The original teacher account must be active and its school email verified.");
  return user;
}
const copyId=id=>"legacy-"+createHash("sha256").update("lesson_plans/"+id).digest("hex").slice(0,40);
function attribution(data,user){
  const uids=[data.ownerUid,data.owner_uid].filter(value=>typeof value==="string"&&value);
  const emails=[data.ownerEmail,data.owner_email,data.teacherEmail,data.teacher_email].filter(value=>typeof value==="string"&&value).map(value=>value.toLowerCase());
  if(uids.some(uid=>uid!==user.uid)||emails.some(email=>email!==ORIGINAL_EMAIL))return "conflicting-owner";
  if(uids.includes(user.uid))return "saved-owner-uid";
  if(emails.includes(ORIGINAL_EMAIL))return "saved-owner-email";
  return "unverified";
}
function editable(data){return Array.isArray(data.sessions)&&data.sessions.length>0&&data.sessions.length<=12&&data.sessions.every(session=>session&&typeof session==="object"&&!Array.isArray(session));}
const planFields=["teacher_name","subject_title","school_year","academic_term","semester","quarter","course_week","absoluteWeek","date_range","grade_level","document_settings","custom_instructions","schedule","reference_folders","weekly_overview","sessions","timestamp","is_archived","archived_at","purge_at","program_name"];
function createLegacyLessonRecovery({db,FieldValue,resolveUserByEmail}){
  return async request=>{
    const actorUid=administrator(request),user=await originalTeacher(resolveUserByEmail),action=request.data?.action||"preview";
    if(action==="preview"){
      const records=await db.collection("lesson_plans").limit(501).get(),eligible=[],unattributed=[],alreadyRecovered=[],blocked=[];
      const selected=records.docs.slice(0,500),targets=selected.length?await db.getAll(...selected.map(record=>db.doc("staff_workspaces/"+user.uid+"/lesson_plans/"+copyId(record.id)))):[],receipts=selected.length?await db.getAll(...selected.map(record=>db.doc("academic_access_preparations/"+copyId(record.id)))):[];
      selected.forEach((record,index)=>{
        const data=record.data(),ownership=attribution(data,user),row={id:record.id,title:data.subject_title||record.id,schoolYear:data.school_year||"",teacherName:data.teacher_name||"",attribution:ownership,sourceVersion:record.updateTime?.toMillis?.()||0};
        if(targets[index]?.exists||receipts[index]?.exists){alreadyRecovered.push(record.id);return;}
        if(ownership==="conflicting-owner"||!editable(data)){blocked.push({...row,reason:ownership==="conflicting-owner"?"A different saved owner is recorded.":"No editable lesson sessions are stored."});return;}
        (ownership==="unverified"?unattributed:eligible).push(row);
      });
      return {ownerUid:user.uid,ownerEmail:ORIGINAL_EMAIL,eligible,unattributed,alreadyRecovered,blocked,hasMore:records.size>500};
    }
    if(action!=="recover")fail("invalid-argument","Choose preview or recover.");
    const ids=request.data?.recordIds,reason=String(request.data?.reason||"").trim(),attested=request.data?.attestOriginalOwner===true;
    if(!Array.isArray(ids)||!ids.length||ids.length>100||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=="string"||!id||id.includes("/")||id.length>1500))fail("invalid-argument","Select 1–100 distinct legacy lesson records.");
    if(reason.length<15||reason.length>1000)fail("invalid-argument","A recovery reason of 15–1,000 characters is required.");
    const outcomes=[];
    for(const id of ids){
      const source=db.doc("lesson_plans/"+id),target=db.doc("staff_workspaces/"+user.uid+"/lesson_plans/"+copyId(id)),audit=db.doc("academic_access_preparations/"+copyId(id));
      outcomes.push(await db.runTransaction(async tx=>{
        const [record,existing,receipt]=await Promise.all([tx.get(source),tx.get(target),tx.get(audit)]);
        if(existing.exists||receipt.exists)return {id,status:"already-recovered"};
        if(!record.exists)return {id,status:"missing"};
        const data=record.data(),ownership=attribution(data,user);
        if(ownership==="conflicting-owner"||!editable(data))return {id,status:"blocked"};
        if(ownership==="unverified"&&!attested)return {id,status:"ownership-confirmation-required"};
        const expected=request.data?.sourceVersions?.[id],sourceVersion=record.updateTime?.toMillis?.()||0;
        if(expected!=null&&expected!==sourceVersion)return {id,status:"source-changed"};
        const provenance={sourcePath:source.path,sourceVersion,attribution:ownership==="unverified"?"administrator-attestation":ownership,recoveredBy:actorUid,recoveredAt:FieldValue.serverTimestamp(),reason};
        const copied=Object.fromEntries(planFields.filter(key=>data[key]!==undefined).map(key=>[key,data[key]]));
        copied.subject_title=String(copied.subject_title||"Subject").slice(0,300);copied.weekly_overview=copied.weekly_overview&&typeof copied.weekly_overview==="object"&&!Array.isArray(copied.weekly_overview)?copied.weekly_overview:{};
        tx.create(target,{...copied,ownerUid:user.uid,version:1,source_legacy_plan:id,recovery_provenance:provenance});
        tx.create(audit,{kind:"legacy-lesson-recovery",ownerUid:user.uid,sourcePath:source.path,targetPath:target.path,provenance});
        return {id,status:"recovered",targetId:target.id};
      }));
    }
    const recovered=outcomes.filter(item=>item.status==="recovered").length,skipped=outcomes.length-recovered;
    return {ownerUid:user.uid,ownerEmail:ORIGINAL_EMAIL,recovered,skipped,outcomes,message:recovered+" lesson(s) recovered into the original teacher’s workspace; "+skipped+" skipped. Shared originals and existing personal copies were preserved."};
  };
}
function createLegacySchoolSetup({db,FieldValue,resolveUserByEmail}){
  return async request=>{
    const actorUid=administrator(request),user=await originalTeacher(resolveUserByEmail),records=await db.collection("students").limit(2001).get();
    if(records.size>2000)fail("failed-precondition","This roster exceeds the automatic recovery limit. Assign original-teacher sections explicitly in Teachers.");
    const sections=[...new Set(records.docs.map(record=>teachingProfile(record.data())?.section).filter(section=>typeof section==="string"&&section.trim()&&section.length<=120))].sort();
    if(sections.length>40)fail("failed-precondition","More than 40 roster sections exist. Select the original teacher’s sections explicitly in Teachers.");
    const ref=db.doc("staff_access/"+ORIGINAL_EMAIL),receipt=db.doc("academic_access_preparations/original-teacher-setup-v1");
    const setup=await db.runTransaction(async tx=>{
      const [snapshot,priorRun]=await Promise.all([tx.get(ref),tx.get(receipt)]),before=snapshot.exists?snapshot.data():null;
      if(before&&before.status!=="active")return {disabled:true,changed:false,project:false,sections:before.sections||[]};
      if(before&&before.role!=="teacher")fail("failed-precondition","Review the original account’s existing staff role before restoring sections.");
      const existing=Array.isArray(before?.sections)?before.sections:[],change=!existing.length&&sections.length>0;
      if(change){
        const after={email:ORIGINAL_EMAIL,displayName:before?.displayName||user.displayName||"Original teacher",role:"teacher",status:"active",sections,revision:(before?.revision||0)+1,reason:"Restore canonical existing school-roster sections for the verified original teacher.",updatedBy:actorUid,updatedAt:FieldValue.serverTimestamp()};
        tx.set(ref,after);tx.create(ref.collection("revisions").doc(String(after.revision)),{before,after,actorUid,createdAt:FieldValue.serverTimestamp()});
        tx.set(db.doc("analytics_rosters/"+ORIGINAL_EMAIL),{teacherEmail:ORIGINAL_EMAIL,sections,updatedBy:actorUid,updatedAt:FieldValue.serverTimestamp()});
      }
      return {disabled:false,changed:change,project:!priorRun.exists||priorRun.data().projectionComplete!==true,sections:existing.length?existing:sections};
    });
    let projected=0;
    if(setup.project&&!setup.disabled){
      for(let index=0;index<records.docs.length;index+=10){const results=await Promise.all(records.docs.slice(index,index+10).map(record=>db.runTransaction(async tx=>{
        const current=await tx.get(record.ref),profile=teachingProfile(current.data());
        if(profile)tx.set(db.doc("teaching_roster/"+record.id),profile);
        return Boolean(profile);
      })));projected+=results.filter(Boolean).length;}
      await receipt.set({kind:"original-teacher-setup",ownerUid:user.uid,ownerEmail:ORIGINAL_EMAIL,sections:setup.sections,projectionComplete:true,projectedCount:projected,preparedBy:actorUid,preparedAt:FieldValue.serverTimestamp()},{merge:true});
    }
    return {ownerUid:user.uid,ownerEmail:ORIGINAL_EMAIL,sections:setup.sections,changed:setup.changed,disabled:setup.disabled,projected,message:setup.disabled?"Original teacher access is disabled; no sections or access were changed.":setup.changed?"Original teacher’s existing roster sections restored. Student records were preserved.":"Original teacher’s explicit section assignments were preserved."};
  };
}
module.exports={createLegacyLessonRecovery,createLegacySchoolSetup};
