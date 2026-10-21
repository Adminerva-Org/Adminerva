import {auth,db} from "../core/firebase-core.js";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {doc,getDoc,setDoc,collection,query,where,limit,onSnapshot,serverTimestamp} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {practiceMemberships} from "./practice-memberships.mjs?v=2026.10.21.2-dev.1";
import {practiceAlias,automaticStandings,PRACTICE_MAXIMUM} from "./practice-ranking-model.mjs?v=2026.10.21.2-dev.1";
const field=id=>document.getElementById(id);
let user=null,profiles=[],stop=()=>{},epoch=0;
const status=message=>{field("practiceClassStatus").textContent=message;};
function element(tag,text,classes=""){const node=document.createElement(tag);node.textContent=text;node.className=classes;return node;}
async function selectClass(){
  const current=user,profile=profiles.find(item=>item.id===field("practiceClass").value),selection=++epoch;
  stop();field("practiceStandings").replaceChildren();field("practicePodium").replaceChildren();
  if(!current||!profile)return;
  field("practiceAlias").textContent=practiceAlias(profile.id);
  status("Loading your class-only rankings…");
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
      field("practiceReviewedPoints").textContent=own?own.points+" practice XP · "+own.completedCount+"/"+PRACTICE_MAXIMUM+" server-checked missions":"No server-checked practice XP recorded yet. Earlier self-recorded points are not ranked.";
      for(const row of rows.filter(row=>row.points>0).slice(0,3))field("practicePodium").append(element("div","#"+row.rank+" · "+row.alias+" · "+row.points+" XP","av-podium-place"));
      for(const row of rows){
        const item=element("li","","av-rank-row"+(row.isCurrent?" av-rank-current":""));
        item.append(element("strong",row.points>0?"#"+row.rank:"—"),element("span",row.alias+(row.isCurrent?" · You":"")),element("strong",row.points+" XP"));
        const progress=document.createElement("progress");progress.max=PRACTICE_MAXIMUM;progress.value=row.completedCount;progress.setAttribute("aria-label",row.alias+" recorded course completion");item.append(progress);field("practiceStandings").append(item);
      }
      status(snapshot.size===500?"Showing up to 500 class records; positions describe this displayed subset only.":"Live class-only, server-checked practice XP. Equal totals share a rank. Replays do not add duplicate XP. This does not prove who answered and is not a school grade.");
    },()=>status("Class rankings are unavailable. Your private progress saves independently; check your membership and connection."));
  }catch{status("Class access could not initialize. Your private practice progress remains separate; retry when connected.");}
}
field("practiceClass").addEventListener("change",()=>void selectClass());
onAuthStateChanged(auth,async current=>{
  user=current;profiles=[];epoch++;stop();field("practiceClass").replaceChildren();field("practiceStandings").replaceChildren();
  if(!current?.emailVerified)return;
  try{
    const memberships=await practiceMemberships(db,current);
    if(user?.uid!==current.uid)return;
    profiles=memberships;for(const profile of profiles)field("practiceClass").add(new Option(profile.section,profile.id));
    if(!profiles.length){status("An enrolled student profile is required for saved class progress. Guests can explore their separate local practice area.");return;}
    const saved=await getDoc(doc(db,"practice_profiles",current.uid));
    if(user?.uid!==current.uid)return;
    if(profiles.some(profile=>profile.id===saved.data()?.studentId))field("practiceClass").value=saved.data().studentId;
    await selectClass();
  }catch{status("Class membership could not load. Private practice and pending local saves are preserved.");}
});
window.addEventListener("pagehide",()=>{epoch++;stop();});
