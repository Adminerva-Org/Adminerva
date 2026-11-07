import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs?v=4.0.0";

const api=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolTeacherAnalytics");
const el=id=>document.getElementById(id);
let busy=false,epoch=0,offerings=[],current=null;

function say(message,error=false){
  el("classAnalyticsStatus").textContent=message;
  el("classAnalyticsStatus").className="text-sm mt-3 "+(error?"text-rose-700":"text-slate-600");
}
function make(tag,className,text){
  const node=document.createElement(tag);if(className)node.className=className;
  if(text!==undefined)node.textContent=String(text);return node;
}
function setBusy(value){
  busy=value;el("classAnalyticsRefresh").disabled=value;
  el("classAnalyticsOffering").disabled=value||!el("classAnalyticsOffering").options.length;
  el("classAnalyticsIncludeDrafts").disabled=value;
}
async function perform(action,details={}){
  const lease=picker.scope.lease();
  const result=(await api({schoolId:lease.schoolId,action,...details})).data;
  picker.scope.assertLease(lease);return result;
}
function metric(value,label){
  const card=make("div","rounded-xl border border-slate-200 bg-white p-4 shadow-sm");
  card.append(make("strong","block text-2xl font-extrabold text-slate-900",value),
    make("span","text-xs text-slate-500",label));return card;
}
function renderSummary(summary){
  el("classAnalyticsSummary").replaceChildren(
    metric(String(summary.students||0),"Students"),
    metric(String(summary.assessments||0),"Assessments"),
    metric(String(summary.publishedGrades||0),"Published grades"),
    metric(String(summary.studentsWithPublishedGrade||0),"Students with published result"),
    metric(summary.averagePercentage===null||summary.averagePercentage===undefined?"—":
      Number(summary.averagePercentage).toFixed(1)+"%","Visible average")
  );
}
function renderAssessments(items){
  const host=el("classAnalyticsAssessments");host.replaceChildren();
  if(!items?.length){host.append(make("p","p-5 text-sm text-slate-500","No deployed assessments are in this analytics scope."));return;}
  for(const item of items){
    const row=make("article","p-4 sm:p-5");
    const top=make("div","flex flex-wrap gap-2 justify-between items-start");
    top.append(make("strong","text-sm text-slate-900",item.title),
      make("span","text-xs font-bold rounded-full bg-slate-100 px-2 py-1",
        item.averagePercentage===null?"No visible grades":Number(item.averagePercentage).toFixed(1)+"% average"));
    row.append(top,make("p","text-xs text-slate-500 mt-1",
      (item.submissionSource==="github"?"GitHub evidence":"Adminerva Studio")+" · "+
      item.publishedGrades+" published result"+(item.publishedGrades===1?"":"s")+
      (item.visibleGrades!==item.publishedGrades?" · "+(item.visibleGrades-item.publishedGrades)+" private draft(s) included":"")));
    host.append(row);
  }
}
function renderStudents(items){
  const host=el("classAnalyticsStudents");host.replaceChildren();
  if(!items?.length){
    const tr=document.createElement("tr"),td=make("td","px-4 py-6 text-sm text-slate-500","No active students are currently enrolled in this offering.");
    td.colSpan=4;tr.append(td);host.append(tr);return;
  }
  for(const item of items){
    const tr=document.createElement("tr");tr.className="border-t border-slate-100";
    const name=make("td","px-4 py-4","");
    name.append(make("strong","block text-sm",item.displayName),
      make("span","block text-xs text-slate-500 mt-1",item.studentUid?"Verified school account":"Account not linked"));
    tr.append(name,
      make("td","px-4 py-4 text-sm",item.publishedGrades),
      make("td","px-4 py-4 text-sm",item.draftGrades),
      make("td","px-4 py-4 text-sm font-bold",item.averagePercentage===null?"—":Number(item.averagePercentage).toFixed(1)+"%"));
    host.append(tr);
  }
}
async function loadScope(){
  const result=await perform("scope");offerings=result.offerings||[];
  const select=el("classAnalyticsOffering"),previous=select.value;select.replaceChildren();
  for(const item of offerings){
    const label=item.section+" · "+item.subject+" · "+item.term;
    select.add(new Option(label,item.offeringId));
  }
  if(offerings.some(item=>item.offeringId===previous))select.value=previous;
  else if(select.options.length)select.selectedIndex=0;
  return offerings;
}
async function loadClass(){
  if(busy)return;
  const offeringId=el("classAnalyticsOffering").value;
  if(!offeringId){
    current=null;el("classAnalyticsWorkspace").hidden=false;
    renderSummary({});renderAssessments([]);renderStudents([]);
    say("No authorized active course offering is available.");return;
  }
  const sequence=++epoch;setBusy(true);say("Loading canonical class results…");
  try{
    const result=await perform("class",{
      offeringId,includeDrafts:el("classAnalyticsIncludeDrafts").checked
    });
    if(sequence!==epoch)return;current=result;
    renderSummary(result.summary||{});renderAssessments(result.assessments||[]);
    renderStudents(result.students||[]);el("classAnalyticsWorkspace").hidden=false;
    const label=[result.offering?.section,result.offering?.subject,result.offering?.term].filter(Boolean).join(" · ");
    say(label+" · "+(result.scope==="published_and_my_drafts"?
      "published grades plus your private drafts":"published grades only")+
      ". Missing grades are excluded from averages.");
  }catch(error){
    if(sequence===epoch){
      current=null;renderSummary({});renderAssessments([]);renderStudents([]);
      el("classAnalyticsWorkspace").hidden=false;say(error?.message||"Class analytics could not load.",true);
    }
  }finally{if(sequence===epoch)setBusy(false);}
}
const picker=createTenantSchoolPicker({
  host:el("classAnalyticsSchoolSwitcher"),status:el("classAnalyticsStatus"),
  onBeforeChange:async()=>{
    if(busy)throw new Error("Finish loading the current class before switching schools.");
    ++epoch;offerings=[];current=null;el("classAnalyticsWorkspace").hidden=true;
    el("classAnalyticsOffering").replaceChildren();
  },
  onReady:scope=>{
    if(!scope.current){el("classAnalyticsWorkspace").hidden=true;return;}
    const canTeach=scope.current.roles.includes("teacher");
    el("classAnalyticsDraftScope").hidden=!canTeach;
    if(!canTeach)el("classAnalyticsIncludeDrafts").checked=false;
    void (async()=>{
      setBusy(true);
      try{
        const available=await loadScope();
        if(!available.length){
          el("classAnalyticsWorkspace").hidden=false;renderSummary({});renderAssessments([]);renderStudents([]);
          say("No active authorized course offering is available for class analytics.");return;
        }
      }catch(error){say(error?.message||"Class analytics scope is unavailable.",true);return;}
      finally{setBusy(false);}
      await loadClass();
    })();
  }
});
el("classAnalyticsOffering").addEventListener("change",()=>void loadClass());
el("classAnalyticsIncludeDrafts").addEventListener("change",()=>void loadClass());
el("classAnalyticsRefresh").addEventListener("click",()=>void loadClass());

try{
  await picker.load();
  if(!auth.currentUser)say("Sign in with a verified school staff account.",true);
}catch(error){say(error?.message||"Unable to load verified school Class Analytics.",true);}
