/** School-scoped staff view of current Practice season progress. */
import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {COURSES} from "./practice-courses.mjs?v=1.5.0";

const field=id=>document.getElementById(id),
 element=(tag,text,className="")=>{const node=document.createElement(tag);node.textContent=text;node.className=className;return node;},
 TOTAL_MISSIONS=COURSES.reduce((sum,course)=>sum+course.missions.length,0),
 functions=getFunctions(app,"asia-southeast1"),
 analyticsApi=httpsCallable(functions,"schoolPracticeAnalytics"),
 tenantApi=httpsCallable(functions,"tenantSchools"),
 schoolKey=uid=>"Adminerva_last_verified_school_"+uid;

let rows=[],sections=[],epoch=0,uid="",busy=false,schoolId="",season="";

function sessionValue(key){try{return sessionStorage.getItem(key)||"";}catch{return "";}}
function status(message,error=false){field("seasonAnalyticsStatus").textContent=message;field("seasonAnalyticsStatus").dataset.tone=error?"error":"info";}
function setBusy(value){
 busy=value;
 field("seasonAnalyticsPanel").setAttribute("aria-busy",String(value));
 field("seasonAnalyticsRefresh").disabled=value;
 field("seasonAnalyticsSection").disabled=value||!field("seasonAnalyticsSection").options.length;
}
function clear(){rows=[];field("seasonAnalyticsRows").replaceChildren();field("seasonAnalyticsSummary").replaceChildren();}
async function resolveSchool(user){
 const preferred=sessionValue(schoolKey(user.uid))||null,payload=(await tenantApi({preferredSchoolId:preferred})).data||{},
  schools=(Array.isArray(payload.schools)?payload.schools:[]).filter(item=>
   item?.platformOverride===true||item?.roles?.some(role=>["teacher","school_admin"].includes(role))),
  selected=schools.find(item=>item.schoolId===preferred)||
   schools.find(item=>item.schoolId===payload.selection?.schoolId)||
   (schools.length===1?schools[0]:null);
 if(!selected)throw Error(schools.length?"Choose your active school from the account menu.":"No active teaching school is linked to this account.");
 schoolId=selected.schoolId;
 return selected;
}
function render(){
 const body=field("seasonAnalyticsRows");body.replaceChildren();
 const sort=field("seasonAnalyticsSort").value,
  ordered=[...rows].sort(sort==="name"?(a,b)=>a.name.localeCompare(b.name):(a,b)=>(b.points??-1)-(a.points??-1)||a.name.localeCompare(b.name));
 if(!ordered.length){
  const row=element("tr",""),cell=element("td","No students or current-season Practice records are available for this section yet.","p-5 text-sm text-slate-500");
  cell.colSpan=5;row.append(cell);body.append(row);
 }
 let rank=0,previousPoints=null;
 const ranks=new Map();
 [...rows].filter(row=>row.points!==null).sort((a,b)=>b.points-a.points||a.name.localeCompare(b.name)).forEach((row,index)=>{
  if(row.points!==previousPoints)rank=index+1;previousPoints=row.points;ranks.set(row.personId,rank);
 });
 for(const item of ordered){
  const row=element("tr","","border-t border-slate-100");
  row.append(element("td",item.points===null?"—":"#"+ranks.get(item.personId),"px-4 py-4 text-sm text-slate-500"));
  const identity=element("td","","px-4 py-4");
  identity.append(element("strong",item.name,"block text-sm font-bold text-slate-800"),
   element("span",item.accountLinked?(item.alias||"No season alias yet"):"Account not linked","block text-xs text-slate-500 mt-1"));
  row.append(identity);
  row.append(
   element("td",item.points===null?"No season record":item.points.toLocaleString(),"px-4 py-4 text-sm font-bold text-blue-800 whitespace-nowrap"),
   element("td",item.points===null?"—":item.completedCount+" / "+TOTAL_MISSIONS,"px-4 py-4 text-sm text-slate-700 whitespace-nowrap")
  );
  const progressCell=element("td","","px-4 py-4 min-w-[140px]"),progress=document.createElement("progress");
  progress.max=TOTAL_MISSIONS;progress.value=item.completedCount;progress.className="w-full h-2 accent-cyan-700";
  progress.setAttribute("aria-label",item.name+": "+item.completedCount+" of "+TOTAL_MISSIONS+" current-season missions completed");
  progressCell.append(progress);row.append(progressCell);body.append(row);
 }
 const recorded=rows.filter(row=>row.points!==null),
  points=recorded.reduce((total,row)=>total+(row.points||0),0),
  missions=recorded.reduce((total,row)=>total+row.completedCount,0);
 field("seasonAnalyticsSummary").replaceChildren(...[
  [String(rows.length),"Students in this view"],
  [points.toLocaleString(),"Class Practice Points"],
  [String(missions),"Completed missions"]
 ].map(([value,label])=>{const card=element("div","","rounded-xl border border-slate-200 bg-slate-50 p-4");card.append(element("strong",value,"block text-xl font-extrabold text-slate-800"),element("span",label,"text-xs text-slate-500"));return card;}));
}
async function loadSeason(){
 const sectionId=field("seasonAnalyticsSection").value,sequence=++epoch,currentUid=uid;
 clear();
 const section=sections.find(item=>item.sectionId===sectionId);
 if(!sectionId){status("No assigned class is available. Ask your administrator to check teaching assignments and active course offerings.");setBusy(false);render();return;}
 setBusy(true);status("Loading current-season Practice Points for "+(section?.name||sectionId)+"…");
 try{
  const response=(await analyticsApi({action:"section",schoolId,sectionId})).data||{};
  if(sequence!==epoch||auth.currentUser?.uid!==currentUid)return;
  season=response.season||"";
  rows=(Array.isArray(response.rows)?response.rows:[]).map(item=>({
   personId:item.personId,name:item.displayName||"Student",accountLinked:item.accountLinked===true,
   alias:item.alias||"",points:Number.isFinite(item.points)?item.points:null,
   completedCount:Number.isInteger(item.completedCount)?item.completedCount:0
  }));
  render();
  const recorded=rows.filter(row=>row.points!==null).length;
  status((season?season+" · ":"")+recorded+" saved Practice records for "+(response.section?.name||section?.name||sectionId)+". Practice Points are engagement/progress signals and never change assessment grades.");
 }catch(error){
  if(sequence===epoch&&auth.currentUser?.uid===currentUid){
   status(error?.message||"Current-season Practice analytics could not load. Refresh to retry.",true);render();
  }
 }finally{if(sequence===epoch)setBusy(false);}
}
async function initialize(user=auth.currentUser){
 const sequence=++epoch,previous=field("seasonAnalyticsSection").value;
 uid=user?.uid||"";schoolId="";season="";sections=[];clear();setBusy(true);
 if(!user){status("A verified teacher or administrator account is required.",true);setBusy(false);return;}
 try{
  await resolveSchool(user);if(sequence!==epoch||auth.currentUser?.uid!==uid)return;
  const response=(await analyticsApi({action:"sections",schoolId})).data||{};
  if(sequence!==epoch||auth.currentUser?.uid!==uid)return;
  sections=Array.isArray(response.sections)?response.sections:[];
  const selector=field("seasonAnalyticsSection");
  selector.replaceChildren(...sections.map(item=>new Option(item.name||item.sectionId,item.sectionId)));
  selector.value=sections.some(item=>item.sectionId===previous)?previous:sections[0]?.sectionId||"";
  setBusy(false);
  if(sections.length)await loadSeason();
  else{status("No active Practice sections are assigned to this account.");render();}
 }catch(error){
  if(sequence===epoch){status(error?.message||"Your school Practice analytics scope could not load. Refresh to retry.",true);render();}
 }finally{if(sequence===epoch)setBusy(false);}
}
field("seasonAnalyticsSection").addEventListener("change",()=>void loadSeason());
field("seasonAnalyticsRefresh").addEventListener("click",()=>{if(!busy)void initialize();});
field("seasonAnalyticsSort").addEventListener("change",render);
onAuthStateChanged(auth,user=>void initialize(user));
