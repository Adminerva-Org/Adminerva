/** Audited administrator-managed teacher admission, section assignments and read-only legacy recovery. */
import {auth,db} from "./firebase-core.js";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {collection,doc,getDocs,getDoc,query,limit,runTransaction,serverTimestamp} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {resolveStaffRole} from "./staff-session.mjs?v=1.1.0";
import {ADMIN_EMAIL,TEACHER_EMAIL} from "./staff-role.mjs?v=1.1.0";
const field=id=>document.getElementById(id);
let epoch=0,opened=null,busy=false,selectionEpoch=0;
function status(message){field("staff-account-status").textContent=message;}
function reset(){selectionEpoch++;field("staff-account-form").reset();field("staff-email").readOnly=false;opened=null;}
async function refresh(){
  const current=epoch;
  const [accounts,students,legacy,catalog]=await Promise.all([
    getDocs(query(collection(db,"staff_access"),limit(100))),
    getDocs(query(collection(db,"students"),limit(1000))),
    getDocs(query(collection(db,"lesson_plans"),limit(25))),
    getDocs(query(collection(db,"school_catalog","sections","records"),limit(200))),
  ]);
  if(current!==epoch)return;
  field("staff-directory").replaceChildren();field("staff-sections").replaceChildren();field("legacy-lesson-list").replaceChildren();
  for(const section of [...new Set([...students.docs.map(record=>record.data().section),...catalog.docs.filter(record=>record.data().status==="active").map(record=>record.data().name)].filter(Boolean))].sort())field("staff-sections").add(new Option(section,section));
  const profiles=accounts.docs.map(record=>record.data());
  if(!profiles.some(profile=>profile.email===TEACHER_EMAIL))profiles.unshift({email:TEACHER_EMAIL,displayName:"Original instructor",status:"active",revision:0});
  for(const profile of profiles){
    const button=document.createElement("button");button.type="button";button.className="av-directory-card";
    const title=document.createElement("strong");title.textContent=profile.displayName;
    const detail=document.createElement("span");detail.textContent=profile.email+" · "+profile.status+" · revision "+profile.revision;
    button.append(title,detail);button.addEventListener("click",async()=>{
      if(busy)return;
      const selection=++selectionEpoch;
      if(current!==epoch||selection!==selectionEpoch)return;
      opened={...profile};field("staff-email").value=profile.email;field("staff-email").readOnly=true;
      field("staff-name").value=profile.displayName;field("staff-status").value=profile.status;field("staff-reason").value="";
      const sections=Array.isArray(profile.sections)?profile.sections:[];
      for(const section of sections)if(![...field("staff-sections").options].some(option=>option.value===section))field("staff-sections").add(new Option(section,section));
      for(const option of field("staff-sections").options)option.selected=sections.includes(option.value);
      status("Editing "+profile.email+". Explain the change before saving.");
    });field("staff-directory").append(button);
  }
  for(const record of legacy.docs){
    const link=document.createElement("a");link.href="lesson-planner.html?legacyPlan="+encodeURIComponent(record.id);link.className="av-directory-card";
    link.textContent=[record.data().subject_title,record.data().course_week,record.data().teacher_name||"Owner unverified"].filter(Boolean).join(" · ");field("legacy-lesson-list").append(link);
  }
  if(legacy.empty)field("legacy-lesson-list").textContent="No older shared lessons found.";
  status("Showing up to 100 accounts, 1,000 roster records and 25 legacy lessons. Account access and personal workspaces are separate from student grades.");
}
field("staff-reset").addEventListener("click",reset);
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
    });reset();await refresh();status("Teacher access and assigned sections saved with an audit record. The teacher can now sign in using that verified Google email. Existing learning snapshots need a separate refresh.");
  }catch(error){status("Not saved: "+error.message);}finally{busy=false;end();field("staff-account-form").querySelectorAll("button").forEach(button=>button.disabled=false);}
});
onAuthStateChanged(auth,async user=>{
  const current=++epoch;field("staff-account-controls").hidden=true;
  if(await resolveStaffRole(user)!=="admin"){status("Administrator access is required.");return;}
  if(current!==epoch)return;field("staff-account-controls").hidden=false;
  const end=window.beginLoading?.("Loading teacher access…")||(()=>{});
  try{await refresh();}catch{status("Teacher access could not load. Matching permission rules and a connection are required; no account was changed.");}finally{end();}
});
