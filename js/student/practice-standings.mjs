import {auth,db} from "../core/firebase-core.js?v=1.3.0";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {doc,getDoc,setDoc,collection,query,where,limit,onSnapshot,serverTimestamp} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {practiceMemberships} from "./practice-memberships.mjs?v=1.3.0";
import {practiceAlias,automaticStandings,PRACTICE_MAXIMUM} from "./practice-ranking-model.mjs?v=1.3.0";
const field=id=>document.getElementById(id);
let user=null,profiles=[],stop=()=>{},epoch=0;
const status=message=>{field("practiceClassStatus").textContent=message;};
function unavailable(message){status(message);field("practiceClassRetryBtn").classList.remove("hidden");}
function element(tag,text,classes=""){const node=document.createElement(tag);node.textContent=text;node.className=classes;return node;}
async function selectClass(){
  const current=user,profile=profiles.find(item=>item.id===field("practiceClass").value),selection=++epoch;
  stop();field("practiceStandings").replaceChildren();field("practicePodium").replaceChildren();
  field("practiceClassRetryBtn").classList.add("hidden");
  if(!current||!profile)return;
  field("practiceAlias").textContent=practiceAlias(profile.id);
  status("Loading your class leaderboard…");
  try{
    const ref=doc(db,"practice_profiles",current.uid),existing=await getDoc(ref),prior=existing.data();
    if(user?.uid!==current.uid||selection!==epoch)return;
    await setDoc(ref,{ownerUid:current.uid,studentId:profile.id,section:profile.section,alias:prior?.alias||practiceAlias(profile.id),leaderboardOptIn:prior?.leaderboardOptIn===true,updatedAt:serverTimestamp()});
    if(user?.uid!==current.uid||selection!==epoch)return;
    stop=onSnapshot(query(collection(db,"practice_rankings"),where("section","==",profile.section),where("verificationVersion","==",1),limit(500)),snapshot=>{
      if(user?.uid!==current.uid||selection!==epoch)return;
      const rows=automaticStandings(snapshot.docs.map(record=>record.data()),profile.id);
      field("practiceStandings").replaceChildren();field("practicePodium").replaceChildren();
      const own=rows.find(row=>row.isCurrent);
      field("practiceReviewedPoints").textContent=own?own.points+" XP · "+own.completedCount+" of "+PRACTICE_MAXIMUM+" missions completed":"No practice XP yet. Complete your first mission to get started.";
      for(const row of rows.filter(row=>row.points>0).slice(0,3))field("practicePodium").append(element("div","#"+row.rank+" · "+row.alias+" · "+row.points+" XP","av-podium-place"));
      for(const row of rows){
        const item=element("li","","av-rank-row"+(row.isCurrent?" av-rank-current":""));
        item.append(element("strong",row.points>0?"#"+row.rank:"—"),element("span",row.alias+(row.isCurrent?" · You":"")),element("strong",row.points+" XP"));
        const progress=document.createElement("progress");progress.max=PRACTICE_MAXIMUM;progress.value=row.completedCount;progress.setAttribute("aria-label",row.alias+" recorded course completion");item.append(progress);field("practiceStandings").append(item);
      }
      status(snapshot.size===500?"Showing up to 500 class records; positions apply to the displayed learners.":rows.length?"Updated live for your class. Equal XP shares a rank. Practice points do not affect school grades.":"Your class leaderboard is ready. Rankings appear as classmates complete missions.");
      field("practiceClassRetryBtn").classList.add("hidden");
    },()=>unavailable("Your class leaderboard could not load. Your saved missions are separate. Check your connection and retry."));
  }catch{unavailable("Your class connection could not load. Check your connection and retry.");}
}
field("practiceClass").addEventListener("change",()=>void selectClass());
field("practiceClassRetryBtn").addEventListener("click",()=>profiles.some(profile=>profile.id===field("practiceClass").value)?void selectClass():location.reload());
onAuthStateChanged(auth,async current=>{
  user=current;profiles=[];epoch++;stop();field("practiceClass").replaceChildren(new Option("Loading your class…",""));field("practiceClass").disabled=true;field("practiceStandings").replaceChildren();field("practicePodium").replaceChildren();
  field("practiceAlias").textContent="—";field("practiceReviewedPoints").textContent="";field("practiceClassRetryBtn").classList.add("hidden");
  if(!current?.emailVerified){field("practiceClass").replaceChildren(new Option("Verified student account required",""));status("Sign in with your verified student account to see your class.");return;}
  try{
    const memberships=await practiceMemberships(db,current);
    if(user?.uid!==current.uid)return;
    profiles=memberships;field("practiceClass").replaceChildren();for(const profile of profiles)field("practiceClass").add(new Option(profile.section,profile.id));
    if(!profiles.length){field("practiceClass").add(new Option("No student section linked",""));unavailable("No class is linked to this account. Ask your teacher to check your email and section in User Directory, then retry.");return;}
    field("practiceClass").disabled=false;
    const saved=await getDoc(doc(db,"practice_profiles",current.uid));
    if(user?.uid!==current.uid)return;
    if(profiles.some(profile=>profile.id===saved.data()?.studentId))field("practiceClass").value=saved.data().studentId;
    await selectClass();
  }catch{if(user?.uid===current.uid){field("practiceClass").replaceChildren(new Option("Class unavailable",""));unavailable("Your class could not load. Check your connection and retry. Your practice drafts are kept.");}}
});
window.addEventListener("pagehide",()=>{epoch++;stop();});
