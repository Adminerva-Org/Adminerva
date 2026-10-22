import {auth,db} from "./firebase-core.js";
import {collection,doc,getDocs,query,limit,runTransaction,serverTimestamp} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {resolveStaffRole} from "./staff-session.mjs?v=1.1.0";

const field=id=>document.getElementById(id),kind=document.querySelector("[data-catalog-kind]").dataset.catalogKind;
const input=key=>field(key==="status"?"catalog-status-field":"catalog-"+key);
const keys=["name","scheme","type","gradeLevel","schoolYear","notes","status"];
const schemeNames={"strengthened-shs":"Strengthened SHS","legacy-shs":"Legacy SHS","school-defined":"School-defined"};
let opened=null,busy=false,records=[];
function status(message,tone="info"){
  for(const id of ["catalog-status","catalog-form-status"]){const region=field(id);region.textContent=message;region.dataset.tone=tone;}
}
function setBusy(value){
  busy=value;field("catalog-form").setAttribute("aria-busy",String(value));
  for(const id of ["catalog-save","catalog-new","catalog-cancel","catalog-refresh"])field(id).disabled=value;
  field("catalog-save").textContent=value?"Saving…":opened?"Save changes":"Create entry";
}
function startEntry(record=null,focus=true){
  if(busy)return;opened=record;field("catalog-form").reset();
  if(record)for(const key of keys)input(key).value=record[key]||"";
  field("catalog-form-title").textContent=record?"Edit "+record.name:"Add a new entry";
  field("catalog-save").textContent=record?"Save changes":"Create entry";
  field("catalog-cancel").hidden=!record;render();
  if(focus){input("name").focus();field("catalog-form").scrollIntoView({behavior:"auto",block:"nearest"});}
}
function render(){
  const search=field("catalog-search").value.trim().toLowerCase(),filter=field("catalog-filter").value;
  const visible=records.filter(record=>(filter==="all"||record.status===filter)&&[record.name,record.type,record.gradeLevel,record.schoolYear].join(" ").toLowerCase().includes(search));
  field("catalog-list").replaceChildren();field("catalog-count").textContent=visible.length+" of "+records.length+" entries";
  if(!visible.length){
    const empty=document.createElement("div");empty.className="av-empty-state";
    const title=document.createElement("strong"),description=document.createElement("p");
    title.textContent=records.length?"No entries match":"Your catalog is ready to set up";
    description.textContent=records.length?"Try a different search or status filter.":kind==="sections"?"Add a section with the exact class name you use in student records. Current roster names are shown below.":"Use the form to add your school’s first entry.";
    empty.append(title,description);field("catalog-list").append(empty);return;
  }
  for(const record of visible){
    const button=document.createElement("button");button.type="button";button.className="av-directory-card";
    button.setAttribute("aria-label","Edit "+record.name);button.setAttribute("aria-pressed",String(opened?.id===record.id));
    const title=document.createElement("strong"),detail=document.createElement("span"),badge=document.createElement("span");
    title.textContent=record.name;detail.textContent=[record.type,schemeNames[record.scheme]||record.scheme,record.gradeLevel,record.schoolYear].filter(Boolean).join(" · ");
    badge.className="av-badge";badge.dataset.tone=record.status==="active"?"success":"neutral";badge.textContent=record.status==="active"?"Active":"Archived";
    button.append(title,detail,badge);button.onclick=()=>{startEntry(record);status("Editing “"+record.name+"”. Changes apply to this catalog entry.");};field("catalog-list").append(button);
  }
}
async function refresh(){
  const loaded=await getDocs(query(collection(db,"school_catalog",kind,"records"),limit(200)));
  records=loaded.docs.map(record=>({id:record.id,...record.data()})).sort((a,b)=>String(a.name).localeCompare(String(b.name)));render();
  let warning="";
  if(kind==="sections"){
    const list=field("catalog-roster-sections");list.replaceChildren();
    try{
      const roster=await getDocs(query(collection(db,"students"),limit(1000)));
      const names=[...new Set(roster.docs.map(record=>record.data().section).filter(name=>typeof name==="string"&&name.trim()))].sort((a,b)=>a.localeCompare(b));
      for(const name of names){const item=document.createElement("li");item.textContent=name+(records.some(record=>record.name===name&&record.status==="active")?"":" · not in the active catalog");list.append(item);}
      if(!names.length){const item=document.createElement("li");item.textContent="No sections are assigned to student records yet. Import a roster in the User Directory next.";list.append(item);}
      if(roster.size===1000)warning=" Roster names are limited to the first 1,000 student records.";
    }catch{const item=document.createElement("li");item.textContent="Roster names could not load. Refresh to try again. You can still manage the catalog.";list.append(item);warning=" Roster names are temporarily unavailable.";}
  }
  status((loaded.size===200?"Showing the first 200 catalog entries.":records.length?"Catalog loaded. Choose an entry to edit, or add a new one.":"No catalog entries yet. Add your first entry using the form.")+warning);
}
field("catalog-new").onclick=()=>{startEntry();status("Add an entry, then save. Fields marked * are required.");};
field("catalog-cancel").onclick=()=>{startEntry();status("Editing canceled. Your saved entry is unchanged.");};
field("catalog-search").addEventListener("input",render);field("catalog-filter").addEventListener("change",render);
field("catalog-refresh").onclick=async()=>{
  if(busy)return;field("catalog-refresh").disabled=true;
  try{await refresh();}catch{status("Catalog could not load. Check your connection and refresh to try again.","error");}finally{field("catalog-refresh").disabled=false;}
};
field("catalog-form").onsubmit=async event=>{
  event.preventDefault();if(busy)return;
  const data=Object.fromEntries(keys.map(key=>[key,input(key).value.trim()]));
  if(!data.name){input("name").focus();status("Enter a name before saving.","error");return;}
  if(records.some(record=>record.id!==opened?.id&&record.name.toLowerCase()===data.name.toLowerCase()&&record.scheme===data.scheme&&record.schoolYear===data.schoolYear)){
    status("An entry with this name, curriculum and school year already exists. Select it from the list to update it.","error");return;
  }
  setBusy(true);
  try{
    const actor=auth.currentUser;if(await resolveStaffRole(actor)!=="admin")throw Error("Administrator access is required.");
    const ref=opened?doc(db,"school_catalog",kind,"records",opened.id):doc(collection(db,"school_catalog",kind,"records"));
    await runTransaction(db,async transaction=>{
      const record=await transaction.get(ref),before=record.exists()?record.data():null;
      if((before?.revision||0)!==(opened?.revision||0))throw Error("This entry changed. Refresh the catalog, reopen the entry, then save again.");
      if(auth.currentUser?.uid!==actor.uid)throw Error("Account changed. Reload before continuing.");
      const after={...data,revision:(before?.revision||0)+1,updatedBy:actor.uid,updatedAt:serverTimestamp()};
      transaction.set(ref,after);transaction.set(doc(ref,"revisions",String(after.revision)),{before,after,actorUid:actor.uid,createdAt:serverTimestamp()});
    });
    setBusy(false);startEntry(null,false);
    try{await refresh();status("Saved. "+(kind==="sections"?"Next, use this exact section name in student records and teacher assignments.":"Your catalog entry is available to school staff."),"success");}
    catch{status("Saved successfully. The list could not refresh; use Refresh to see your entry.","success");}
  }catch(error){status(error.message||"Save failed. Please try again.","error");}finally{setBusy(false);}
};
await auth.authStateReady();
if(await resolveStaffRole(auth.currentUser)!=="admin"){location.replace("teacher-home.html");}
else try{await refresh();}catch{status("Catalog could not load. Check your connection and select Refresh to try again.","error");}
