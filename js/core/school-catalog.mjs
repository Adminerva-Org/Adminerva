import {auth,db} from "./firebase-core.js";
import {collection,doc,getDocs,query,limit,runTransaction,serverTimestamp} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {resolveStaffRole} from "./staff-session.mjs?v=1.1.0";
const field=id=>document.getElementById(id),kind=document.querySelector("[data-catalog-kind]").dataset.catalogKind;
const input=key=>field(key==="status"?"catalog-status-field":"catalog-"+key);
let opened=null,busy=false;
const status=message=>{field("catalog-status").textContent=message;};
async function refresh(){
  const records=await getDocs(query(collection(db,"school_catalog",kind,"records"),limit(200)));
  field("catalog-list").replaceChildren();
  for(const record of records.docs.sort((first,second)=>first.data().name.localeCompare(second.data().name))){
    const data=record.data(),button=document.createElement("button");button.type="button";button.className="av-directory-card";button.textContent=data.name+" · "+data.type+" · "+data.scheme+" · "+data.status;
    button.onclick=()=>{if(busy)return;opened={id:record.id,...data};for(const key of ["name","scheme","type","gradeLevel","schoolYear","notes","status"])input(key).value=data[key]||"";status("Editing revision "+data.revision+". Existing rosters are not renamed.");};
    field("catalog-list").append(button);
  }
  if(records.size===200)status("Showing the first 200 catalog records. Narrow the catalog before adding more.");
  else if(records.empty)status("No catalog records yet. Existing roster section names remain unchanged.");
}
field("catalog-new").onclick=()=>{if(busy)return;opened=null;field("catalog-form").reset();status("New catalog entry. Existing student records will not be modified.");};
field("catalog-form").onsubmit=async event=>{
  event.preventDefault();if(busy)return;busy=true;field("catalog-save").disabled=true;
  try{
    const actor=auth.currentUser;if(await resolveStaffRole(actor)!=="admin")throw Error("Administrator access is required.");
    const ref=opened?doc(db,"school_catalog",kind,"records",opened.id):doc(collection(db,"school_catalog",kind,"records"));
    const data=Object.fromEntries(["name","scheme","type","gradeLevel","schoolYear","notes","status"].map(key=>[key,input(key).value.trim()]));
    await runTransaction(db,async transaction=>{
      const record=await transaction.get(ref),before=record.exists()?record.data():null;
      if((before?.revision||0)!==(opened?.revision||0))throw Error("This entry changed. Refresh before saving.");
      if(auth.currentUser?.uid!==actor.uid)throw Error("Account changed. Reload before continuing.");
      const after={...data,revision:(before?.revision||0)+1,updatedBy:actor.uid,updatedAt:serverTimestamp()};
      transaction.set(ref,after);transaction.set(doc(ref,"revisions",String(after.revision)),{before,after,actorUid:actor.uid,createdAt:serverTimestamp()});
    });
    opened=null;field("catalog-form").reset();await refresh();status("Saved with an immutable revision. Student rosters and existing lessons are unchanged.");
  }catch(error){status(error.message||"Save failed. No roster changes were made.");}finally{busy=false;field("catalog-save").disabled=false;}
};
await auth.authStateReady();
if(await resolveStaffRole(auth.currentUser)!=="admin"){location.replace("teacher-home.html");}
else try{await refresh();}catch{status("Catalog could not load. Check your connection and permissions.");}
