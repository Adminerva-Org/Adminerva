import {resolveStaffRole} from "../core/staff-session.mjs?v=1.3.0";
/** Unified review inbox for legacy receipts and committed evidence. */
import {auth,db} from "../core/firebase-core.js?v=1.3.0";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {collection,getDocs,query,orderBy,limit,onSnapshot}
  from "../core/teaching-firestore.mjs?v=1.3.0";
import {parseRepository,validSha} from "./services/assessment-evidence.mjs?v=1.3.0";

// RepoBank can open this inbox scoped to one linked repository.
const initialRepo=new URLSearchParams(location.search).get("repo");
if(initialRepo){
  try{document.getElementById("submissionSearch").value=parseRepository(initialRepo).repo;}
  catch{/* Keep the ordinary unfiltered inbox when the link is invalid. */}
}
const el=id=>document.getElementById(id);
const make=(tag,style,text)=>{const n=document.createElement(tag);
  if(style)n.className=style;if(text!=null)n.textContent=String(text);return n;};
let unsubscribe=[],snapshots={legacy:[],v2:[]},documents=[],students=new Map(),assessments=new Map();
function hyperlink(parent,label,href){
  const a=make("a","text-xs sm:text-sm font-bold text-blue-700 hover:underline break-all",label);
  a.href=href;a.target=href.startsWith("http")?"_blank":"_self";
  if(a.target==="_blank")a.rel="noopener noreferrer";parent.append(a);
}
function asMillis(value){return value?.toMillis?.()||Date.parse(value||"")||0;}
function assessmentKey(item){
  return String(item.assessmentId||item.taskId||item.assessmentTitle||"");
}
function statusLabel(value){
  return ({submitted:"Submitted",approved:"Approved",reopened:"Reopened",needs_review:"Needs review",withdrawn:"Withdrawn"})[value]||
    String(value||"Unknown").replace(/_/g," ").replace(/\b\w/g,char=>char.toUpperCase());
}
function statusClass(value){
  return ({
    submitted:"bg-blue-50 text-blue-800 border-blue-200",
    approved:"bg-emerald-50 text-emerald-800 border-emerald-200",
    reopened:"bg-amber-50 text-amber-900 border-amber-200",
    needs_review:"bg-violet-50 text-violet-800 border-violet-200",
    withdrawn:"bg-slate-100 text-slate-700 border-slate-200"
  })[value]||"bg-slate-50 text-slate-700 border-slate-200";
}
function render(){
  const feed=el("submissionFeed"),term=el("submissionSearch").value.trim().toLowerCase();
  const section=el("submissionSection").value,status=el("submissionState").value,assessment=el("submissionAssessment").value;
  const filtered=documents.filter(item=>
    (section==="all"||item.section===section)&&
    (status==="all"||item.status===status)&&
    (assessment==="all"||assessmentKey(item)===assessment)&&
    [item.studentName,item.assessmentTitle,item.repoUrl,item.githubLogin,item.sourcePath,item.status,statusLabel(item.status)]
      .join(" ").toLowerCase().includes(term));
  feed.replaceChildren();
  el("submissionStatus").textContent=filtered.length+" of "+documents.length+
    " review item(s) shown · student receipts + V2 selected evidence";
  if(!filtered.length){
    feed.append(make("p","bg-white p-5 border rounded-xl text-slate-600 text-sm",
      "No review items match these filters."));return;
  }
  for(const item of filtered){
    const card=make("article","bg-white border rounded-xl shadow-sm p-4 sm:p-5");
    const header=make("div","flex flex-col sm:flex-row gap-2 justify-between sm:items-start");
    const title=make("div","");
    title.append(make("h2","text-base font-bold text-slate-900 break-words",item.studentName||"Student"));
    title.append(make("p","text-sm font-semibold text-blue-700 break-words",item.assessmentTitle||"Assessment"));
    header.append(title);
    const meta=make("div","flex flex-wrap sm:flex-col items-start sm:items-end gap-2");
    meta.append(make("span","inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold "+statusClass(item.status),statusLabel(item.status)));
    meta.append(make("span","text-xs text-slate-500",item.date?.toDate?.()?.toLocaleString()||"Date unavailable"));
    header.append(meta);
    card.append(header);
    card.append(make("p","text-xs text-slate-600 mt-2","Section: "+(item.section||"Unknown")+
      " · "+(item.kind==="v2"?"Selected commit evidence":"GitHub revision receipt")));
    const rev=String(item.revisionSha||"");
    card.append(make("p","font-mono text-xs break-all mt-2","Project revision: "+rev));
    if(item.sourcePath)card.append(make("p","text-xs mt-1 break-all","Source: "+item.sourcePath));
    const links=make("div","flex flex-wrap gap-4 mt-4");
    let repo=null;
    try{repo=parseRepository(item.repoUrl);}catch{}
    if(repo&&validSha(rev)){
      hyperlink(links,"View checkpoint commit ↗",repo.url+"/commit/"+rev);
      hyperlink(links,"Project at checkpoint ↗",repo.url+"/tree/"+rev);
    }
    if(item.kind==="v2"){
      hyperlink(links,"Review & Grade →","repofetch.html?section="+
        encodeURIComponent(item.section||"")+"&student="+encodeURIComponent(item.studentId)+
        "&assessment="+encodeURIComponent(item.assessmentId));
      card.append(make("p","text-xs text-slate-500 mt-2",
        item.source==="teacher_discovered"
          ?"Instructor-discovered historical evidence; not a student submission."
          :"Student-selected SHAs are unverified until checkpoint review."));
    }else{
      hyperlink(links,"Open RepoFetch →","repofetch.html");
    }
    card.append(links);feed.append(card);
  }
}
function refresh(){
  const oldSection=el("submissionSection").value,oldAssessment=el("submissionAssessment").value;
  documents=[
    ...snapshots.legacy.map(d=>({...d,kind:"legacy",date:d.submittedAt,
      revisionSha:d.revisionSha||"",status:"submitted"})),
    ...snapshots.v2.map(d=>{
      const student=students.get(d.studentId)||{},assessment=assessments.get(d.assessmentId)||{};
      return {...d,kind:"v2",date:d.updatedAt||d.recordedAt||d.submittedAt,revisionSha:d.checkpointSha,
        studentName:student.name||d.studentId,
        assessmentTitle:assessment.title||d.assessmentId,
        githubLogin:student.githubUsername||""};
    })
  ].sort((a,b)=>asMillis(b.date)-asMillis(a.date));
  const select=el("submissionSection"),sections=[...new Set(documents.map(x=>x.section).filter(Boolean))].sort();
  select.replaceChildren();const all=make("option","","All sections");all.value="all";select.append(all);
  for(const section of sections){const opt=make("option","",section);opt.value=section;select.append(opt);}
  select.value=sections.includes(oldSection)?oldSection:"all";

  const assessmentSelect=el("submissionAssessment"),assessmentOptions=new Map();
  for(const item of documents){
    const key=assessmentKey(item);if(!key)continue;
    if(!assessmentOptions.has(key))assessmentOptions.set(key,item.assessmentTitle||key);
  }
  assessmentSelect.replaceChildren();
  const everyAssessment=make("option","","All assessments");everyAssessment.value="all";assessmentSelect.append(everyAssessment);
  for(const [key,title] of [...assessmentOptions.entries()].sort((a,b)=>String(a[1]).localeCompare(String(b[1])))){
    const option=make("option","",title);option.value=key;assessmentSelect.append(option);
  }
  assessmentSelect.value=assessmentOptions.has(oldAssessment)?oldAssessment:"all";
  render();
}
onAuthStateChanged(auth,async user=>{
  const end = window.beginLoading?.("Loading review inbox…", el("submissionFeed")) || (() => {});
  for(const stop of unsubscribe)stop();unsubscribe=[];snapshots={legacy:[],v2:[]};
  if(!await resolveStaffRole(user)){
    el("submissionStatus").textContent="Authorized teacher sign-in required.";
    el("submissionFeed").replaceChildren();end();return;
  }
  try{
    const [roster,taskDocs]=await Promise.all([
      getDocs(collection(db,"students")),getDocs(collection(db,"assessments"))
    ]);
    if(auth.currentUser?.uid!==user.uid)return;
    students=new Map(roster.docs.map(d=>[d.id,d.data()]));
    assessments=new Map(taskDocs.docs.map(d=>[d.id,d.data()]));
    const request=(key,source,dateField)=>{
      const loaded = window.beginLoading?.("Loading submitted evidence…",el("submissionFeed")) || (() => {});
      const stop=onSnapshot(query(collection(db,source),orderBy(dateField,"desc"),limit(200)),
        snap=>{snapshots[key]=snap.docs.map(d=>({id:d.id,...d.data()}));refresh();loaded();},
        error=>{loaded();el("submissionStatus").textContent=source+" unavailable: "+error.message;});
      unsubscribe.push(()=>{loaded();stop();});
    };
    request("legacy","student_submissions","submittedAt");
    request("v2","assessment_evidence","updatedAt");
  }catch(error){el("submissionStatus").textContent="Could not load review inbox: "+error.message;}finally{end();}
});
el("submissionSearch").addEventListener("input",render);
for(const id of ["submissionSection","submissionState","submissionAssessment"])el(id).addEventListener("change",render);
