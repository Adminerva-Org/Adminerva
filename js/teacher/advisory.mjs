import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs?v=4.0.1";

const el=id=>document.getElementById(id);
const api=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolAcademics");
const select=el("advisorySection"),status=el("advisoryStatus");
let picker=null,sections=[],current=null,busy=false,epoch=0;

function make(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;}
function say(message,error=false){status.textContent=message;status.className="text-sm mt-3 "+(error?"text-rose-700":"text-slate-600");}
function setBusy(value){busy=value;select.disabled=value||!sections.length;el("advisoryRefresh").disabled=value;}
async function scoped(action,details={}){
  if(!picker?.scope.current)throw Error("Choose a verified school first.");
  const lease=picker.scope.lease();
  const result=(await api({schoolId:lease.schoolId,action,...details})).data;
  picker.scope.assertLease(lease);return result;
}
function sectionLabel(item){return [item.sectionName,item.yearName,item.gradeLevel?("Grade "+item.gradeLevel):"",item.pathway].filter(Boolean).join(" · ");}
function renderRoster(){
  const body=el("advisoryRoster"),empty=el("advisoryRosterEmpty"),query=el("advisoryStudentSearch").value.trim().toLocaleLowerCase();
  body.replaceChildren();if(!current){empty.hidden=true;return;}
  const rows=(current.students||[]).filter(row=>!query||[row.name,row.studentNumber].some(value=>String(value||"").toLocaleLowerCase().includes(query)));
  empty.hidden=rows.length>0;
  for(const row of rows){
    const tr=make("tr","border-b border-slate-100");
    const name=make("td","px-4 py-3 font-semibold",row.name||"Student");
    const number=make("td","px-4 py-3 text-slate-600",row.studentNumber||"—");
    const account=make("td","px-4 py-3");
    account.append(make("span","rounded-full px-2 py-1 text-xs font-bold "+(row.accountLinked?"bg-emerald-50 text-emerald-800":"bg-amber-50 text-amber-800"),row.accountLinked?"Linked":"Not linked"));
    const source=make("td","px-4 py-3 text-xs text-slate-500",row.registrationSource==="registration"?"Official registration":"Active class enrollment");
    tr.append(name,number,account,source);body.append(tr);
  }
}
function renderClasses(){
  const host=el("advisoryClasses");host.replaceChildren();if(!current)return;
  const classes=current.classes||[];
  if(!classes.length){host.append(make("p","rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500","No active class offerings are attached to this advisory section for the selected school year."));return;}
  const byTerm=new Map();
  for(const row of classes){const list=byTerm.get(row.termName)||[];list.push(row);byTerm.set(row.termName,list);}
  for(const [term,rows] of byTerm){
    const group=make("section","rounded-xl border border-slate-200 overflow-hidden");
    group.append(make("h3","px-3 py-2 bg-slate-50 text-xs font-extrabold uppercase text-slate-600",term||"Academic period"));
    const list=make("div","divide-y divide-slate-100");
    for(const row of rows){
      const item=make("div","p-3"),teachers=(row.teacherNames||[]);
      item.append(make("strong","block text-sm",row.subjectName||"Subject"),
        make("span","block text-xs mt-1 "+(teachers.length?"text-slate-500":"text-amber-800 font-bold"),teachers.length?teachers.join(", "):"No active subject teacher"));
      list.append(item);
    }
    group.append(list);host.append(group);
  }
}
function render(){
  current=sections.find(row=>row.advisoryId===select.value)||sections[0]||null;
  el("advisoryWorkspace").hidden=!current;
  if(!current){
    el("advisoryStudentCount").textContent="—";el("advisoryClassCount").textContent="—";
    el("advisoryUnstaffedCount").textContent="—";el("advisoryAccountCount").textContent="—";return;
  }
  const students=current.students||[],classes=current.classes||[];
  el("advisoryStudentCount").textContent=students.length.toLocaleString();
  el("advisoryClassCount").textContent=classes.length.toLocaleString();
  el("advisoryUnstaffedCount").textContent=classes.filter(row=>!(row.teacherNames||[]).length).length.toLocaleString();
  el("advisoryAccountCount").textContent=students.filter(row=>row.accountLinked).length.toLocaleString();
  el("advisoryRosterTitle").textContent=current.sectionName+" · "+current.yearName;
  renderRoster();renderClasses();
}
async function load(){
  if(!picker?.scope.current||busy)return;const turn=++epoch;setBusy(true);say("Loading advisory assignments…");
  try{
    const result=await scoped("my_advisory_sections");if(turn!==epoch)return;
    sections=result.sections||[];const prior=select.value;select.replaceChildren();
    if(!sections.length){
      current=null;render();select.add(new Option("No active advisory section",""));say("No active adviser / homeroom assignment is linked to this teacher account.");return;
    }
    for(const row of sections)select.add(new Option(sectionLabel(row),row.advisoryId));
    if(sections.some(row=>row.advisoryId===prior))select.value=prior;
    render();say("Advisory overview ready. Official roster placement is read-only here.");
  }catch(error){sections=[];current=null;select.replaceChildren(new Option("Advisory unavailable",""));render();say(error?.message||"Advisory overview could not load.",true);}
  finally{setBusy(false);}
}
select.addEventListener("change",()=>{render();say("Showing "+sectionLabel(current)+".");});
el("advisoryStudentSearch").addEventListener("input",renderRoster);
el("advisoryRefresh").addEventListener("click",()=>void load());

picker=createTenantSchoolPicker({
 host:el("advisorySchoolSwitcher"),status:null,
 onBeforeChange:async()=>{if(busy)throw Error("Finish the current advisory refresh before switching schools.");++epoch;sections=[];current=null;select.replaceChildren();render();},
 onReady:scope=>{if(scope.current?.roles.includes("teacher"))void load();else say("Teacher access is required.",true);}
});
await auth.authStateReady();
try{
 const state=await picker.load();
 if(!auth.currentUser)say("Sign in with a verified teacher account.",true);
 else if(state?.state==="choose_school")say("Choose the school whose advisory section you want to view.");
}catch(error){say(error?.message||"Verified school access is unavailable.",true);}
