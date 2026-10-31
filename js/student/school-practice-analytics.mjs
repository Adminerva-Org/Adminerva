import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs?v=4.0.0";

const api=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolPracticeAnalytics");
const el=id=>document.getElementById(id);
let rows=[],currentSection=null,busy=false,epoch=0;

function say(message,error=false){
  el("practiceStatus").textContent=message;
  el("practiceStatus").className="text-sm mt-3 "+(error?"text-rose-700":"text-slate-600");
}
function make(tag,className,text){
  const node=document.createElement(tag);if(className)node.className=className;
  if(text!==undefined)node.textContent=String(text);return node;
}
function setBusy(value){
  busy=value;
  el("practiceRefresh").disabled=value;
  el("practiceSection").disabled=value||!el("practiceSection").options.length;
}
async function perform(action,details={}){
  const lease=picker.scope.lease();
  const result=(await api({schoolId:lease.schoolId,action,...details})).data;
  picker.scope.assertLease(lease);return result;
}
function renderSummary(summary){
  const host=el("practiceSummary");host.replaceChildren();
  for(const [value,label] of [
    [summary.students||0,"Students"],
    [summary.recorded||0,"With season record"],
    [summary.points||0,"Class Practice Points"],
    [summary.completedMissions||0,"Completed missions"]
  ]){
    const card=make("div","rounded-xl border border-slate-200 bg-white p-4 shadow-sm");
    card.append(make("strong","block text-2xl font-extrabold text-slate-900",Number(value).toLocaleString()),
      make("span","text-xs text-slate-500",label));
    host.append(card);
  }
}
function renderRows(){
  const host=el("practiceRows");host.replaceChildren();
  const ordered=[...rows].sort(el("practiceSort").value==="name"
    ?(a,b)=>a.displayName.localeCompare(b.displayName)
    :(a,b)=>(b.points??-1)-(a.points??-1)||a.displayName.localeCompare(b.displayName));
  if(!ordered.length){
    const tr=document.createElement("tr"),td=make("td","px-4 py-6 text-sm text-slate-500","No active students are currently enrolled in this section.");
    td.colSpan=5;tr.append(td);host.append(tr);return;
  }
  const ranked=[...rows].filter(row=>row.points!==null)
    .sort((a,b)=>b.points-a.points||a.displayName.localeCompare(b.displayName));
  const rankMap=new Map();let rank=0,previous=null;
  ranked.forEach((row,index)=>{if(row.points!==previous)rank=index+1;previous=row.points;rankMap.set(row.personId,rank);});
  for(const item of ordered){
    const tr=document.createElement("tr");tr.className="border-t border-slate-100";
    tr.append(make("td","px-4 py-4 text-sm text-slate-500",item.points===null?"—":"#"+rankMap.get(item.personId)));
    const identity=make("td","px-4 py-4","");
    identity.append(make("strong","block text-sm font-bold",item.displayName),
      make("span","block text-xs text-slate-500 mt-1",
        item.accountLinked?(item.alias||"No public Practice alias"):"School account not linked"));
    tr.append(identity);
    tr.append(make("td","px-4 py-4 text-sm font-bold text-cyan-800",
      item.points===null?"No season record":Number(item.points).toLocaleString()));
    tr.append(make("td","px-4 py-4 text-sm text-slate-700",
      item.points===null?"—":Number(item.completedCount||0).toLocaleString()));
    const cell=make("td","px-4 py-4 min-w-[150px]","");
    const progress=document.createElement("progress");
    progress.max=300;progress.value=Math.min(300,Math.max(0,Number(item.completedCount)||0));
    progress.className="w-full h-2 accent-cyan-700";
    progress.setAttribute("aria-label",item.displayName+": "+progress.value+" completed missions");
    cell.append(progress);tr.append(cell);host.append(tr);
  }
}
async function loadSections(){
  const result=await perform("sections");
  const select=el("practiceSection"),previous=select.value;
  select.replaceChildren();
  for(const section of result.sections||[]){
    const option=new Option(section.name,section.sectionId);select.add(option);
  }
  if((result.sections||[]).some(item=>item.sectionId===previous))select.value=previous;
  else if(select.options.length)select.selectedIndex=0;
  return result.sections||[];
}
async function loadSection(){
  if(busy)return;
  const sectionId=el("practiceSection").value;
  if(!sectionId){
    rows=[];renderRows();renderSummary({});
    el("practiceWorkspace").hidden=false;
    say("No assigned class is available for Practice analytics.");return;
  }
  const sequence=++epoch;setBusy(true);say("Loading school-scoped Practice progress…");
  try{
    const result=await perform("section",{sectionId});
    if(sequence!==epoch)return;
    currentSection=result.section;rows=result.rows||[];
    el("practiceHeading").textContent=(result.section?.name||"Class")+" · "+(result.season||"Current season");
    renderSummary(result.summary||{});renderRows();el("practiceWorkspace").hidden=false;
    say((result.summary?.recorded||0)+" of "+(result.summary?.students||0)+
      " students have current-season Practice records. Missing activity is not treated as zero mastery.");
  }catch(error){
    if(sequence===epoch){rows=[];renderRows();renderSummary({});el("practiceWorkspace").hidden=false;
      say(error?.message||"Practice analytics could not load.",true);}
  }finally{if(sequence===epoch)setBusy(false);}
}
const picker=createTenantSchoolPicker({
  host:el("practiceSchoolSwitcher"),status:el("practiceStatus"),
  onBeforeChange:async()=>{
    if(busy)throw new Error("Finish loading the current class before switching schools.");
    ++epoch;rows=[];currentSection=null;el("practiceRows").replaceChildren();
    el("practiceSummary").replaceChildren();el("practiceWorkspace").hidden=true;
  },
  onReady:scope=>{
    if(!scope.current){el("practiceWorkspace").hidden=true;return;}
    void (async()=>{
      setBusy(true);
      try{
        const sections=await loadSections();
        if(!sections.length){el("practiceWorkspace").hidden=false;renderSummary({});renderRows();
          say("No current teaching section is available for Practice analytics.");return;}
      }catch(error){say(error?.message||"Practice analytics scope is unavailable.",true);return;}
      finally{setBusy(false);}
      await loadSection();
    })();
  }
});

el("practiceSection").addEventListener("change",()=>void loadSection());
el("practiceRefresh").addEventListener("click",()=>void loadSection());
el("practiceSort").addEventListener("change",renderRows);

try{
  await picker.load();
  if(!auth.currentUser)say("Sign in with a verified school staff account.",true);
}catch(error){say(error?.message||"Unable to load verified school Practice analytics.",true);}
