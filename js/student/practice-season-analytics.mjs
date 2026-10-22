/** Staff-only view of current season points, mapped to the assigned credential-free roster. */
import {auth,db} from "../core/firebase-core.js?v=1.3.0";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {collection,getDocs,query,where} from "../core/teaching-firestore.mjs?v=1.3.0";
import {resolveStaffRole} from "../core/staff-session.mjs?v=1.3.0";
import {staffSections} from "../core/staff-role.mjs?v=1.3.0";
import {PRACTICE_SEASON} from "./practice-season.mjs?v=1.3.0";
const field=id=>document.getElementById(id),element=(tag,text,className="")=>{const node=document.createElement(tag);node.textContent=text;node.className=className;return node;};
let roster=[],rows=[],epoch=0,role=null,uid="",busy=false;
function status(message,error=false){field("seasonAnalyticsStatus").textContent=message;field("seasonAnalyticsStatus").dataset.tone=error?"error":"info";}
function setBusy(value){busy=value;field("seasonAnalyticsPanel").setAttribute("aria-busy",String(value));field("seasonAnalyticsRefresh").disabled=value;field("seasonAnalyticsSection").disabled=value||!field("seasonAnalyticsSection").options.length;}
function clear(){rows=[];field("seasonAnalyticsRows").replaceChildren();field("seasonAnalyticsSummary").replaceChildren();}
function render(){
  const body=field("seasonAnalyticsRows");body.replaceChildren();
  const sort=field("seasonAnalyticsSort").value,ordered=[...rows].sort(sort==="name"?(a,b)=>a.name.localeCompare(b.name):(a,b)=>(b.points??-1)-(a.points??-1)||a.name.localeCompare(b.name));
  if(!ordered.length){const row=element("tr",""),cell=element("td","No students or season records are linked to this section yet.","p-5 text-sm text-slate-500");cell.colSpan=5;row.append(cell);body.append(row);}
  let rank=0,previousPoints=null;const ranks=new Map();[...rows].filter(row=>row.points!==null).sort((a,b)=>b.points-a.points).forEach((row,index)=>{if(row.points!==previousPoints)rank=index+1;previousPoints=row.points;ranks.set(row.studentId,rank);});
  for(const item of ordered){
    const row=element("tr","","border-t border-slate-100");
    row.append(element("td",item.points===null?"—":"#"+ranks.get(item.studentId),"px-4 py-4 text-sm text-slate-500"));
    const identity=element("td","","px-4 py-4");identity.append(element("strong",item.name,"block text-sm font-bold text-slate-800"),element("span",item.alias||"No season alias yet","block text-xs text-slate-500 mt-1"));row.append(identity);
    row.append(element("td",item.points===null?"No season record":item.points.toLocaleString(),"px-4 py-4 text-sm font-bold text-blue-800 whitespace-nowrap"),element("td",item.points===null?"—":item.completedCount+" / 300","px-4 py-4 text-sm text-slate-700 whitespace-nowrap"));
    const progressCell=element("td","","px-4 py-4 min-w-[140px]"),progress=document.createElement("progress");progress.max=300;progress.value=item.completedCount;progress.className="w-full h-2 accent-cyan-700";progress.setAttribute("aria-label",item.name+": "+item.completedCount+" of 300 current-season missions completed");progressCell.append(progress);row.append(progressCell);body.append(row);
  }
  const recorded=rows.filter(row=>row.points!==null),points=recorded.reduce((total,row)=>total+row.points,0),missions=recorded.reduce((total,row)=>total+row.completedCount,0);
  field("seasonAnalyticsSummary").replaceChildren(...[[String(rows.length),"Students in this view"],[points.toLocaleString(),"Class Practice Points"],[String(missions),"Completed missions"]].map(([value,label])=>{const card=element("div","","rounded-xl border border-slate-200 bg-slate-50 p-4");card.append(element("strong",value,"block text-xl font-extrabold text-slate-800"),element("span",label,"text-xs text-slate-500"));return card;}));
}
async function loadSeason(){
  const section=field("seasonAnalyticsSection").value,sequence=++epoch,currentUid=uid;clear();
  if(!section){status("No assigned class is available. Ask your administrator to check Teacher assignments and roster section names.");setBusy(false);render();return;}
  setBusy(true);status("Loading current-season Practice Points for "+section+"…");
  try{
    const snapshot=await getDocs(query(collection(db,"practice_class_season_rankings"),where("section","==",section)));
    if(sequence!==epoch||auth.currentUser?.uid!==currentUid)return;
    const records=new Map(snapshot.docs.filter(record=>record.data().season===PRACTICE_SEASON).map(record=>[record.id,record.data()])),members=roster.filter(student=>student.section===section);
    rows=members.map(student=>{const score=records.get(student.id);records.delete(student.id);return {studentId:student.id,name:student.name||"Student",alias:score?.alias||"",points:score&&Number.isFinite(score.points)?score.points:null,completedCount:score?.completedCount||0};});
    for(const [studentId,score] of records)rows.push({studentId,name:"Roster record unavailable",alias:score.alias||"Learner",points:Number.isFinite(score.points)?score.points:null,completedCount:score.completedCount||0});
    render();status("Current season · "+rows.filter(row=>row.points!==null).length+" saved point records for "+section+". Names are private to authorized staff; these points never change school grades.");
  }catch{if(sequence===epoch&&auth.currentUser?.uid===currentUid){status("Current-season points could not load. Check your connection and select Refresh season data. Earlier history remains separate below.",true);render();}}
  finally{if(sequence===epoch)setBusy(false);}
}
async function initialize(user=auth.currentUser){
  const sequence=++epoch,previous=field("seasonAnalyticsSection").value;uid=user?.uid||"";roster=[];clear();setBusy(true);
  try{
    role=await resolveStaffRole(user);if(sequence!==epoch||auth.currentUser?.uid!==uid)return;
    if(!role){status("A verified teacher or administrator account is required.",true);return;}
    const snapshot=await getDocs(collection(db,"students"));if(sequence!==epoch||auth.currentUser?.uid!==uid)return;
    roster=snapshot.docs.map(record=>({id:record.id,...record.data()}));
    const sections=[...new Set([...(role==="teacher"?staffSections(user):[]),...roster.map(student=>student.section)].filter(section=>typeof section==="string"&&section.trim()))].sort();
    const selector=field("seasonAnalyticsSection");selector.replaceChildren(...sections.map(section=>new Option(section,section)));selector.value=sections.includes(previous)?previous:sections[0]||"";
    setBusy(false);await loadSeason();
  }catch{if(sequence===epoch){status("Your assigned class list could not load. Refresh season data to retry.",true);}}
  finally{if(sequence===epoch)setBusy(false);}
}
field("seasonAnalyticsSection").addEventListener("change",()=>void loadSeason());field("seasonAnalyticsRefresh").addEventListener("click",()=>{if(!busy)void initialize();});field("seasonAnalyticsSort").addEventListener("change",render);
onAuthStateChanged(auth,user=>void initialize(user));
