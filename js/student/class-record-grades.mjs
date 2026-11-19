import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs?v=4.0.0";
const list=document.getElementById("student-grades-list"),status=document.getElementById("student-grades-status"),schoolHost=document.getElementById("student-grades-school-switcher");
const api=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolStudentClassRecord");
let picker=null,generation=0,classes=[],loaded=false;
const search=document.getElementById('student-grades-search'),filter=document.getElementById('student-grades-filter'),refresh=document.getElementById('student-grades-refresh'),filterStatus=document.getElementById('student-grades-filter-status');
const gradeParams=new URLSearchParams(location.search);
const requestedOfferingId=gradeParams.get("offeringId")||"";
const requestedSubjectName=gradeParams.get("subject")||"";
const subjectLabel=document.getElementById("studentGradesSubjectLabel");
if(subjectLabel&&requestedSubjectName){subjectLabel.textContent=requestedSubjectName;subjectLabel.classList.remove("hidden");}
function node(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n}
function numberText(v){if(v===null||v===undefined||v==="")return "—";const n=Number(v);return Number.isFinite(n)?(Number.isInteger(n)?String(n):String(Math.round((n+Number.EPSILON)*100)/100)):"—"}
function statusLabel(v){return ({incomplete:"INC · For completion",exempt:"EX · Exempt",not_applicable:"N/A · Not applicable"})[v]||""}
function sourceLabel(s){return s.kind==="manual"?"Teacher-entered":s.sourceType==="legacy_personalized"?"Personalized Studio":"Adminerva assessment"}
async function load(scope){const lease=scope.lease(),result=(await api({schoolId:lease.schoolId,action:"my_scores"})).data;scope.assertLease(lease);return result}
function scoreTable(item){
 const wrap=node("div","overflow-x-auto mt-4"),table=node("table","av-student-score-table w-full border-collapse text-sm"),thead=node("thead","bg-slate-50"),head=node("tr");
 for(const label of ["Activity","Category","Result","Source"]){const th=node("th","text-left px-3 py-2 border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500",label);th.scope="col";head.append(th)}
 thead.append(head);table.append(thead);const body=node("tbody");
 for(const score of item.scores||[]){const tr=node("tr"),result=node("td","px-3 py-3 border-b border-slate-100");
  const special=statusLabel(score.status);
  if(special)result.append(node("span","inline-flex rounded-full px-2.5 py-1 text-xs font-bold "+(score.status==="incomplete"?"bg-amber-100 text-amber-900":score.status==="exempt"?"bg-emerald-100 text-emerald-800":"bg-slate-200 text-slate-700"),special));
  else if(score.score==null)result.append(node("span","text-slate-500","Not yet graded"));
  else result.append(node("strong","text-slate-900",numberText(score.score)+" / "+numberText(score.maxPoints)));
  tr.append(node("td","px-3 py-3 border-b border-slate-100 font-semibold text-slate-900",score.label),
    node("td","px-3 py-3 border-b border-slate-100 text-slate-600",score.category||"Uncategorized"),result,
    node("td","px-3 py-3 border-b border-slate-100 text-slate-600",sourceLabel(score)));["Activity","Category","Result","Source"].forEach((label,index)=>tr.children[index].dataset.label=label);body.append(tr)
 }
 table.append(body);wrap.append(table);return wrap
}
function classCard(item){
 const card=node("article","rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden"),header=node("div","p-4 sm:p-5 border-b border-slate-200 flex flex-col md:flex-row md:items-start md:justify-between gap-4"),identity=node("div","min-w-0");
 identity.append(node("h2","text-xl font-extrabold text-slate-900",item.subjectName||"Subject"),node("p","text-sm text-slate-600 mt-1",[item.sectionName,item.termName,item.yearName].filter(Boolean).join(" · ")));
 const box=node("div","rounded-xl px-4 py-3 min-w-[190px] "+(item.finalGrade?"bg-emerald-50 border border-emerald-200":"bg-slate-50 border border-slate-200"));
 if(item.finalGrade)box.append(node("p","text-xs uppercase tracking-wider font-bold text-emerald-700","Released Final Grade"),node("p","text-3xl font-extrabold text-slate-900 mt-1",item.finalGrade.finalGrade),node("p","text-xs text-slate-500 mt-1","Frozen revision "+item.finalGrade.revision));
 else box.append(node("p","text-xs uppercase tracking-wider font-bold text-slate-500","Final Grade"),node("p","text-sm font-bold text-slate-700 mt-1","Not released"));
 header.append(identity,box);card.append(header);const body=node("div","p-4 sm:p-5");
 if(item.scores?.length){body.append(node("p","text-sm text-slate-600",item.scores.length+" teacher-released activit"+(item.scores.length===1?"y":"ies")+" in this Class Record."),scoreTable(item))}
 else body.append(node("div","rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600","No activity scores have been released for this class yet."));
 card.append(body);return card
}
function renderFiltered(){
 if(!loaded)return;
 const term=String(search?.value||"").trim().toLowerCase(),mode=filter?.value||"all";
 list.replaceChildren();let shown=0,total=0;
 for(const item of classes){
   const all=item.scores||[];total+=all.length;
   const matches=all.filter(row=>(!term||[item.subjectName,item.sectionName,item.termName,row.label,row.category].some(value=>String(value||"").toLowerCase().includes(term)))&&(mode==="all"||(mode==="graded"&&row.score!=null&&row.status==="normal")||(mode==="pending"&&row.score==null&&row.status==="normal")||(mode==="special"&&row.status!=="normal")));
   shown+=matches.length;
   if(matches.length||(!term&&mode==="all"))list.append(classCard({...item,scores:matches}));
 }
 if(filterStatus)filterStatus.textContent=shown+" of "+total+" released activities shown. Final Grades remain teacher-controlled.";
 if(!list.children.length&&classes.length)list.append(node("p","rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600","No released activities match these filters. Clear the search or choose All activities."));
}
search?.addEventListener("input",renderFiltered);filter?.addEventListener("change",renderFiltered);
refresh?.addEventListener("click",()=>{if(picker?.scope.current)void render(picker.scope);else void picker?.load().catch(error=>{status.textContent=error?.message||"School access unavailable.";});});
async function render(scope){
 const turn=++generation;loaded=false;classes=[];if(refresh)refresh.disabled=true;if(filterStatus)filterStatus.textContent="";status.textContent="Loading teacher-released Class Record results…";list.replaceChildren();
 try{const result=await load(scope);if(turn!==generation)return;const allClasses=result.classes||[];
  classes=allClasses.filter(item=>(!requestedOfferingId||item.offeringId===requestedOfferingId)&&(!requestedSubjectName||String(item.subjectName||"").toLowerCase()===requestedSubjectName.toLowerCase()));
  status.textContent=classes.length?classes.length+" active class"+(classes.length===1?"":"es")+" loaded. Only explicitly released results are shown.":"No active school classes are available for your verified student record.";
  loaded=true;renderFiltered();
 }catch(error){if(turn===generation)status.textContent=error?.message||"Your released Class Record results could not be loaded."}finally{if(turn===generation&&refresh)refresh.disabled=false;}
}
await auth.authStateReady();
if(auth.currentUser){picker=createTenantSchoolPicker({host:schoolHost,status:null,onReady:scope=>void render(scope),onBeforeChange:async()=>{generation++;loaded=false;classes=[];if(filterStatus)filterStatus.textContent="";list.replaceChildren();status.textContent="Switching verified school…"}});
 try{const state=await picker.load();if(state?.state==="choose_school")status.textContent="Choose your active school to load released grades."}catch(error){status.textContent=error?.message||"Verified school access is unavailable."}}
