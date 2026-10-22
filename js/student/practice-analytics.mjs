import {staffRole} from "../core/staff-role.mjs?v=1.3.0";
import {resolveStaffRole} from "../core/staff-session.mjs?v=1.3.0";
/** Student submissions, practice progress and isolated code workspaces: practice analytics. */
import {auth,db} from "../core/firebase-core.js?v=1.3.0";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {collection,doc,getDocs,query,where,limit,runTransaction,writeBatch,serverTimestamp} from "../core/teaching-firestore.mjs?v=1.3.0";
import {COURSES} from "./practice-courses.mjs?v=1.3.0";
import {practicePoints,classStandings} from "./practice-points.mjs?v=1.3.0";
const el=id=>document.getElementById(id);
const make=(tag,text)=>{const node=document.createElement(tag);node.textContent=text;return node;};
let roster=[],profiles=[],scores=[],active=null,generation=0,loadedSection="",reviewSequence=0,reviewLoading=false,reviewSaving=false;
const allowed=()=>!!staffRole(auth.currentUser);
const status=text=>{el("practiceAnalyticsStatus").textContent=text;};
function clearReview(){reviewSequence++;reviewLoading=false;active=null;el("practiceReview").classList.add("hidden");el("practiceAcceptPoints").disabled=true;}
async function load(){
  if(!allowed())return;
  const section=el("practiceAnalyticsSection").value,sequence=++generation;clearReview();loadedSection="";
  el("practiceReview").classList.add("hidden");el("practiceAnalyticsList").replaceChildren();
  try{
    const [registrations,reviewed,rankings]=await Promise.all([getDocs(query(collection(db,"practice_profiles"),where("section","==",section))),getDocs(query(collection(db,"practice_scores"),where("section","==",section))),getDocs(query(collection(db,"practice_rankings"),where("section","==",section),limit(500)))]);
    if(sequence!==generation||!allowed())return;
    profiles=registrations.docs.map(snapshot=>({uid:snapshot.id,...snapshot.data()}));scores=reviewed.docs.map(snapshot=>snapshot.data());
    const students=roster.filter(student=>student.section===section);
    for(const student of students){
      const profile=profiles.find(profile=>profile.studentId===student.id),score=scores.find(score=>score.studentId===student.id);
      const ranking=rankings.docs.find(record=>record.id===student.id)?.data();
      const card=make("article","");card.className="bg-white border rounded p-4";
      card.append(make("h2",student.name||student.id),make("p",ranking?ranking.points+" automatic practice XP · "+ranking.completedCount+" missions recorded":"Practice XP has not synchronized yet; missing activity is not zero mastery."),make("p",score?score.points+" independently reviewed points (separate record)":"No separate instructor review recorded"));
      const button=make("button","Review missions and reflections");button.type="button";button.className="text-blue-800 underline text-sm mt-2";button.addEventListener("click",()=>{void review(student,profile);});card.append(button);
      el("practiceAnalyticsList").append(card);
    }
    loadedSection=section;status(students.length+" students · "+rankings.size+" synchronized XP records"+(rankings.size===500?" (display capped at 500)":"")+" · "+scores.length+" separate instructor reviews. Student class rankings update automatically; no publication is required.");
  }catch{status("Class analytics unavailable. Check sign-in, connection and the approved class-points rules deployment.");}
}
async function review(student,profile){
  const sequence=generation,selection=++reviewSequence,uid=auth.currentUser?.uid;
  const current=()=>selection===reviewSequence&&sequence===generation&&auth.currentUser?.uid===uid&&allowed();
  active=null;reviewLoading=true;el("practiceAcceptPoints").disabled=true;el("practiceReview").classList.add("hidden");
  status("Loading practice for "+(student.name||student.id)+"…");
  try{
    const records=await getDocs(collection(db,"practice_class_progress",student.id,"courses"));
    if(!current())return;
    active={student,profile};el("practiceReviewName").textContent=student.name||student.id;el("practiceReviewMissions").replaceChildren();
    const prior=scores.find(score=>score.studentId===student.id);
    el("practicePointsNote").value=typeof prior?.reviewNote==="string"?prior.reviewNote:"";
    for(const course of COURSES){
      const progress=records.docs.find(snapshot=>snapshot.id===course.id)?.data();
      for(const mission of course.missions){
        const row=make("details","");row.className="border rounded p-3";
        const label=make("label","");label.className="flex gap-2 text-sm";
        const check=document.createElement("input");check.type="checkbox";check.value=mission.id;check.dataset.reviewedMission="1";check.checked=prior?.verifiedMissionIds?.includes(mission.id)||false;
        label.append(check,make("span",course.name+" · "+mission.title+" · "+(progress?.completed?.includes(mission.id)?"completion claimed":"not completed")));
        const summary=make("summary","Read private reflection and inspect mission");summary.className="cursor-pointer text-xs mt-2";
        const reflection=make("pre",JSON.stringify(progress?.reflections?.[mission.id]||"No reflection recorded",null,2));reflection.className="whitespace-pre-wrap break-words text-xs mt-2";
        row.append(summary,reflection);const wrapper=make("div","");wrapper.append(label,row);el("practiceReviewMissions").append(wrapper);
      }
    }
    el("practiceReview").classList.remove("hidden");el("practiceReview").scrollIntoView();
    status("Showing practice for "+(student.name||student.id)+". Review the missions and reflection before saving independent points.");
  }catch{if(current())status("Private practice could not be loaded. Select Review missions and reflections to retry. No points changed.");}
  finally{if(current()){reviewLoading=false;el("practiceAcceptPoints").disabled=reviewSaving||!active;}}
}
el("practiceAcceptPoints").addEventListener("click",async()=>{
  if(reviewLoading||reviewSaving||!active||!allowed())return;
  const current=active,note=el("practicePointsNote").value.trim(),selection=reviewSequence,uid=auth.currentUser.uid;
  if(note.length<15||note.length>3000)return status("Document your independent review in 15–3,000 characters.");
  const total=practicePoints([...document.querySelectorAll("[data-reviewed-mission]:checked")].map(input=>input.value));
  if(!confirm("Save "+total.points+" teacher-reviewed practice points? This does not change assessment grades or publish class standings."))return;
  const button=el("practiceAcceptPoints");reviewSaving=true;button.disabled=true;
  try{
    const ref=doc(db,"practice_scores",current.student.id);
    await runTransaction(db,async transaction=>{
      const before=await transaction.get(ref),revision=(before.data()?.revision||0)+1;
      const after={studentId:current.student.id,section:current.student.section,verifiedMissionIds:total.missions,points:total.points,reviewedBy:auth.currentUser.uid,reviewNote:note,revision,updatedAt:serverTimestamp()};
      transaction.set(doc(ref,"revisions",String(revision)),{before:before.exists()?before.data():null,after,actorUid:auth.currentUser.uid,createdAt:serverTimestamp()});transaction.set(ref,after);
    });
    if(selection===reviewSequence&&auth.currentUser?.uid===uid){await load();status("Independent practice review saved privately. Automatic student XP and assessment grades are unchanged.");}
  }catch{if(selection===reviewSequence&&auth.currentUser?.uid===uid)status("Points were not saved. Check permissions and the class-points rules deployment.");}
  finally{reviewSaving=false;button.disabled=reviewLoading||!active;}
});
el("practicePublishStandings").addEventListener("click",async()=>{
  const section=el("practiceAnalyticsSection").value;
  if(!allowed()||!loadedSection||loadedSection!==section)return status("Load this class before publishing.");
  if(!confirm("Publish an alias-only snapshot of teacher-reviewed practice points to this class? No reflections, names, emails or account identifiers will be included."))return;
  const button=el("practicePublishStandings");button.disabled=true;
  try{
    const [latestProfiles,latestScores]=await Promise.all([getDocs(query(collection(db,"practice_profiles"),where("section","==",section))),getDocs(query(collection(db,"practice_scores"),where("section","==",section)))]);
    const rows=classStandings(latestProfiles.docs.map(snapshot=>snapshot.data()),latestScores.docs.map(snapshot=>snapshot.data()),section),students=roster.filter(student=>student.section===section);
    if(students.length>200)throw Error("Class snapshot limit exceeded");
    const batch=writeBatch(db);
    for(const student of students)batch.set(doc(db,"practice_boards",student.id),{section,rows,publishedBy:auth.currentUser.uid,publishedAt:serverTimestamp()});
    await batch.commit();status("Class snapshot published. Only opted-in aliases and teacher-reviewed points were included.");
  }catch{status("Class snapshot was not published. Reload the class and check permissions.");}
  finally{button.disabled=false;}
});
el("practiceAnalyticsLoad").addEventListener("click",()=>{void load();});
el("practiceAnalyticsSection").addEventListener("change",()=>{generation++;clearReview();loadedSection="";el("practiceAnalyticsList").replaceChildren();});
onAuthStateChanged(auth,async()=>{
  await resolveStaffRole(auth.currentUser);
  generation++;clearReview();loadedSection="";el("practiceAnalyticsList").replaceChildren();
  if(!allowed())return status("A verified instructor sign-in is required.");
  try{const records=await getDocs(collection(db,"students"));if(!allowed())return;roster=records.docs.map(snapshot=>({id:snapshot.id,...snapshot.data()}));el("practiceAnalyticsSection").replaceChildren();for(const section of [...new Set(roster.map(student=>student.section))].filter(Boolean).sort()){const option=make("option",section);option.value=section;el("practiceAnalyticsSection").append(option);}status("Choose a section and load its private practice analytics.");}
  catch{status("Unable to load class directory.");}
});
