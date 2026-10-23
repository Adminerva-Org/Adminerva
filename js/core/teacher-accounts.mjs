/** Audited administrator-managed teacher admission, section assignments and read-only legacy recovery. */
import {auth,db} from "./firebase-core.js?v=1.3.0";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {collection,doc,getDocs,getDoc,query,limit,runTransaction,serverTimestamp} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {resolveStaffRole} from "./staff-session.mjs?v=1.3.0";
import {ADMIN_EMAIL,TEACHER_EMAIL} from "./staff-role.mjs?v=1.3.0";
import {mountLegacyRecovery,restoreOriginalTeacherSections,legacyLessonRecovery} from "./legacy-lesson-recovery.mjs?v=1.3.2";
const field=id=>document.getElementById(id);
let epoch=0,opened=null,busy=false,selectionEpoch=0,sectionCounts=new Map();
mountLegacyRecovery();
let preparingOriginal=false;
async function prepareOriginalTeacher(){
  if(preparingOriginal)return;preparingOriginal=true;field("staff-legacy-setup").disabled=true;
  field("original-teacher-status").textContent="Checking the original teacher’s legacy roster connection…";
  try{
    const result=await restoreOriginalTeacherSections();field("original-teacher-status").textContent=result.message;if(result.changed&&!opened)await refresh();
    if(!result.disabled){
      const preview=await legacyLessonRecovery({action:"preview"});let recovered=0;
      for(let index=0;index<(preview.eligible||[]).length;index+=100){
        const batch=preview.eligible.slice(index,index+100);field("original-teacher-status").textContent="Restoring lessons whose saved owner matches the verified original teacher…";
        const response=await legacyLessonRecovery({action:"recover",recordIds:batch.map(record=>record.id),sourceVersions:Object.fromEntries(batch.map(record=>[record.id,record.sourceVersion])),reason:"Automatic recovery: saved owner identity matches the verified original teacher.",attestOriginalOwner:false});recovered+=response.recovered||0;
      }
      field("original-teacher-status").textContent=result.message+" "+recovered+" metadata-attributed lesson(s) recovered."+((preview.unattributed||[]).length?" "+preview.unattributed.length+" lessons have unverified ownership; review them in Recover older school lesson plans below.":"");
    }
  }
  catch(error){field("original-teacher-status").textContent="Legacy class setup could not finish: "+error.message+". Existing student records and explicit teacher assignments were preserved.";}
  finally{preparingOriginal=false;field("staff-legacy-setup").disabled=false;}
}
field("staff-legacy-setup").addEventListener("click",prepareOriginalTeacher);
function status(message,tone="info"){for(const id of ["staff-account-status","staff-form-status"]){field(id).textContent=message;field(id).dataset.tone=tone;}}
function renderSectionPicker(){
  const picker=field("staff-section-picker");picker.replaceChildren();
  for(const option of field("staff-sections").options){
    const label=document.createElement("label"),checkbox=document.createElement("input"),text=document.createElement("span"),name=document.createElement("strong"),hint=document.createElement("small");
    label.className="av-section-option";checkbox.type="checkbox";checkbox.value=option.value;checkbox.checked=option.selected;
    checkbox.addEventListener("change",()=>{option.selected=checkbox.checked;updateSectionSummary();});
    name.textContent=option.value;const count=sectionCounts.get(option.value)||0;hint.textContent=count?count+" student record"+(count===1?"":"s"):"No enrolled student records";
    text.append(name,hint);label.append(checkbox,text);picker.append(label);
  }
  if(!picker.children.length){const hint=document.createElement("p");hint.textContent="No sections yet. Add a section or import your student roster first.";picker.append(hint);}
  field("staff-sections").hidden=true;picker.hidden=false;updateSectionSummary();
}
function updateSectionSummary(){const count=field("staff-sections").selectedOptions.length;field("staff-sections-summary").textContent=count+" section"+(count===1?"":"s")+" selected (up to 40).";}
function reset(){selectionEpoch++;field("staff-account-form").reset();field("staff-email").readOnly=false;opened=null;field("staff-form-title").textContent="Add teacher access";for(const option of field("staff-sections").options)option.selected=false;renderSectionPicker();}
async function refresh(){
  const current=epoch;
  const loaded=await Promise.allSettled([
    getDocs(query(collection(db,"staff_access"),limit(100))),
    getDocs(query(collection(db,"students"),limit(1000))),
    getDocs(query(collection(db,"lesson_plans"),limit(25))),
    getDocs(query(collection(db,"school_catalog","sections","records"),limit(200))),
  ]);
  if(current!==epoch)return;
  if(loaded[0].status!=="fulfilled")throw loaded[0].reason;
  const accounts=loaded[0].value,students=loaded[1].status==="fulfilled"?loaded[1].value:{docs:[]},legacy=loaded[2].status==="fulfilled"?loaded[2].value:{docs:[],empty:true},catalog=loaded[3].status==="fulfilled"?loaded[3].value:{docs:[]};
  field("staff-directory").replaceChildren();field("staff-sections").replaceChildren();field("legacy-lesson-list").replaceChildren();
  sectionCounts=new Map();for(const record of students.docs){const section=record.data().section;if(typeof section==="string"&&section.trim())sectionCounts.set(section,(sectionCounts.get(section)||0)+1);}
  for(const section of [...new Set([...sectionCounts.keys(),...catalog.docs.filter(record=>record.data().status==="active").map(record=>record.data().name)].filter(name=>typeof name==="string"&&name.trim()))].sort())field("staff-sections").add(new Option(section,section));
  const profiles=accounts.docs.map(record=>record.data());
  if(!profiles.some(profile=>profile.email===TEACHER_EMAIL))profiles.unshift({email:TEACHER_EMAIL,displayName:"Original instructor",status:"active",revision:0});
  for(const profile of profiles){
    const button=document.createElement("button");button.type="button";button.className="av-directory-card";
    const title=document.createElement("strong");title.textContent=profile.displayName;
    const detail=document.createElement("span");detail.textContent=profile.email;
    const assignment=document.createElement("span");assignment.textContent=Array.isArray(profile.sections)&&profile.sections.length?profile.sections.join(" · "):"No explicit section assignments";
    const badge=document.createElement("span");badge.className="av-badge";badge.dataset.tone=profile.status==="active"?"success":"neutral";badge.textContent=profile.status==="active"?"Active teacher":"Disabled";
    button.append(title,detail,badge,assignment);button.addEventListener("click",async()=>{
      if(busy)return;
      const selection=++selectionEpoch;
      if(current!==epoch||selection!==selectionEpoch)return;
      opened={...profile};field("staff-email").value=profile.email;field("staff-email").readOnly=true;
      field("staff-name").value=profile.displayName;field("staff-status").value=profile.status;field("staff-reason").value="";
      const sections=Array.isArray(profile.sections)?profile.sections:[];
      for(const section of sections)if(![...field("staff-sections").options].some(option=>option.value===section))field("staff-sections").add(new Option(section,section));
      for(const option of field("staff-sections").options)option.selected=sections.includes(option.value);
      renderSectionPicker();field("staff-form-title").textContent="Edit teacher access";field("staff-name").focus();field("staff-account-form").scrollIntoView({behavior:"auto",block:"nearest"});
      status("Editing "+profile.email+". Explain the change before saving.");
    });field("staff-directory").append(button);
  }
  for(const record of legacy.docs){
    const link=document.createElement("a");link.href="lesson-planner.html?legacyPlan="+encodeURIComponent(record.id);link.className="av-directory-card";
    link.textContent=[record.data().subject_title,record.data().course_week,record.data().teacher_name||"Owner unverified"].filter(Boolean).join(" · ");field("legacy-lesson-list").append(link);
  }
  if(legacy.empty)field("legacy-lesson-list").textContent=loaded[2].status==="fulfilled"?"No older shared lessons found.":"Older lessons could not load. Teacher access is still available.";
  field("staff-directory-count").textContent=profiles.length+" teacher"+(profiles.length===1?"":"s");renderSectionPicker();
  status("Teacher directory loaded. Select a teacher to edit their assigned sections."+(loaded[1].status!=="fulfilled"||loaded[3].status!=="fulfilled"?" Some section choices could not load; refresh to try again.":students.size===1000?" Section counts cover the first 1,000 student records.":""));
}
field("staff-reset").addEventListener("click",()=>{reset();field("staff-email").focus();status("Enter a teacher’s verified Google email to add access.");});
field("staff-refresh").addEventListener("click",async()=>{if(busy)return;field("staff-refresh").disabled=true;try{reset();await refresh();}catch{status("Teacher directory could not refresh. Check your connection and try again.","error");}finally{field("staff-refresh").disabled=false;}});
field("staff-account-form").addEventListener("submit",async event=>{
  event.preventDefault();if(busy)return;
  const actor=auth.currentUser,current=epoch;
  if(await resolveStaffRole(actor)!=="admin")return;
  const email=field("staff-email").value.trim().toLowerCase(),displayName=field("staff-name").value.trim(),reason=field("staff-reason").value.trim();
  const access=field("staff-status").value,sections=[...field("staff-sections").selectedOptions].map(option=>option.value);
  if(email===ADMIN_EMAIL||!/^([^/@\s]+)@([^/@\s]+)\.[^/@\s]+$/.test(email)||!displayName||reason.length<12||sections.length>40){status("Use a valid teacher email, name, up to 40 sections, and a reason of at least 12 characters. Administrator access is not managed here.");return;}
  if(access==="disabled"&&!confirm("Disable this teacher's staff access? Their records remain preserved. This does not delete their Google or Firebase account."))return;
  busy=true;const end=window.beginLoading?.("Saving audited teacher access…")||(()=>{});
  field("staff-account-form").querySelectorAll("button").forEach(button=>button.disabled=true);
  try{
    await runTransaction(db,async transaction=>{
      const ref=doc(db,"staff_access",email),snapshot=await transaction.get(ref),before=snapshot.exists()?snapshot.data():null;
      if((before?.revision||0)!==(opened?.email===email?opened.revision:0))throw Error("This account changed. Reload the directory before saving.");
      if(current!==epoch||auth.currentUser?.uid!==actor.uid)throw Error("Account changed. Reload before continuing.");
      const revision=(before?.revision||0)+1,after={email,displayName,role:"teacher",status:access,sections,revision,reason,updatedBy:actor.uid,updatedAt:serverTimestamp()};
      transaction.set(ref,after);
      transaction.set(doc(ref,"revisions",String(revision)),{before,after,actorUid:actor.uid,createdAt:serverTimestamp()});
      transaction.set(doc(db,"analytics_rosters",email),{teacherEmail:email,sections,updatedBy:actor.uid,updatedAt:serverTimestamp()});
    });reset();try{await refresh();status("Saved teacher access and "+sections.length+" section assignments. Ask the teacher to reload open pages. Refresh existing learning snapshots to update their contents.","success");}catch{status("Teacher access saved successfully. The directory could not refresh; select Refresh to try again.","success");}
  }catch(error){status("Not saved: "+error.message,"error");}finally{busy=false;end();field("staff-account-form").querySelectorAll("button").forEach(button=>button.disabled=false);}
});
onAuthStateChanged(auth,async user=>{
  const current=++epoch;field("staff-account-controls").hidden=true;
  if(await resolveStaffRole(user)!=="admin"){status("Administrator access is required.");return;}
  if(current!==epoch)return;field("staff-account-controls").hidden=false;
  const end=window.beginLoading?.("Loading teacher access…")||(()=>{});
  try{await refresh();void prepareOriginalTeacher();}catch{status("Teacher access could not load. Matching permission rules and a connection are required; no account was changed.");}finally{end();}
});
