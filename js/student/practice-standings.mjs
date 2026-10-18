/** Student submissions, practice progress and isolated code workspaces: practice standings. */
import {auth,db} from "../core/firebase-core.js";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {doc,getDoc,getDocs,setDoc,collection,query,where,serverTimestamp} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
const el=id=>document.getElementById(id);
let user=null,profiles=[];
const status=text=>{el("practiceClassStatus").textContent=text;};
async function showBoard(){
  const current=user,profile=profiles.find(profile=>profile.id===el("practiceClass").value);
  el("practiceStandings").replaceChildren();el("practiceReviewedPoints").textContent="Not reviewed yet";
  if(!current||!profile)return;
  try{
    const [score,board]=await Promise.all([getDoc(doc(db,"practice_scores",profile.id)),getDoc(doc(db,"practice_boards",profile.id))]);
    if(user?.uid!==current.uid||el("practiceClass").value!==profile.id)return;
    if(score.exists())el("practiceReviewedPoints").textContent=score.data().points+" teacher-reviewed practice points";
    if(!board.exists()||board.data().section!==profile.section){status("No class standings published yet. Your teacher reviews practice before publishing points.");return;}
    for(const row of board.data().rows||[]){const item=document.createElement("li");item.textContent=row.rank+". "+row.alias+" — "+row.points+" points";el("practiceStandings").append(item);}
    status("Class snapshot published "+(board.data().publishedAt?.toDate?.().toLocaleString()||"recently")+". Only opted-in aliases and teacher-reviewed points are shown.");
  }catch{status("Class standings are unavailable. Your personal practice and private drafts are unaffected.");}
}
el("practiceClass").addEventListener("change",()=>{void showBoard();});
el("practiceSavePreferences").addEventListener("click",async()=>{
  const current=user,profile=profiles.find(profile=>profile.id===el("practiceClass").value),alias=el("practiceAlias").value.trim();
  if(!current||!profile)return;
  if(!/^[-\w ]{3,24}$/.test(alias))return status("Use a 3–24 character class alias: letters, numbers, spaces, hyphens or underscores. Do not enter an email.");
  const button=el("practiceSavePreferences");button.disabled=true;
  try{await setDoc(doc(db,"practice_profiles",current.uid),{ownerUid:current.uid,studentId:profile.id,section:profile.section,alias,leaderboardOptIn:el("practiceOptIn").checked,updatedAt:serverTimestamp()});if(user?.uid===current.uid)status("Practice class preferences saved. Opt-in changes apply to the next teacher-published snapshot; ask your teacher to refresh an older snapshot.");}
  catch{status("Preferences could not be saved. The new class-points rules must be activated before using this feature.");}
  finally{button.disabled=false;}
});
onAuthStateChanged(auth,async current=>{
  user=current;profiles=[];el("practiceClass").replaceChildren();el("practiceStandings").replaceChildren();el("practiceOptIn").checked=false;
  if(!current)return;
  try{
    const records=await getDocs(query(collection(db,"students"),where("email","==",current.email)));
    if(user?.uid!==current.uid)return;
    profiles=records.docs.map(snapshot=>({id:snapshot.id,...snapshot.data()}));
    for(const profile of profiles){const option=document.createElement("option");option.value=profile.id;option.textContent=profile.section;el("practiceClass").append(option);}
    el("practiceAlias").value="Learner-"+Math.floor(1000+Math.random()*9000);
    const preferences=await getDoc(doc(db,"practice_profiles",current.uid));
    if(user?.uid!==current.uid)return;
    if(preferences.exists()){
      const saved=preferences.data();el("practiceAlias").value=saved.alias;el("practiceOptIn").checked=saved.leaderboardOptIn;
      if(profiles.some(profile=>profile.id===saved.studentId))el("practiceClass").value=saved.studentId;
    }
    await showBoard();
  }catch{status("Choose a linked class once class-points access is available. Practice completion remains available.");}
});
