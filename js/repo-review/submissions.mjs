import {auth,db} from "../core/firebase-core.js";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {collection,getDocs,query,orderBy,limit,onSnapshot}
  from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {parseRepository,validSha} from "./services/assessment-evidence.mjs";

// RepoBank can open this inbox scoped to one linked repository.
const initialRepo=new URLSearchParams(location.search).get("repo");
if(initialRepo){
  try{document.getElementById("submissionSearch").value=parseRepository(initialRepo).repo;}
  catch{/* Keep the ordinary unfiltered inbox when the link is invalid. */}
}
const staff=new Set(["babaynike2013@gmail.com","josephsixson@mcstayuman.edu.ph"]);
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
function render(){
  const feed=el("submissionFeed"),term=el("submissionSearch").value.trim().toLowerCase();
  const section=el("submissionSection").value;
  const filtered=documents.filter(item=>(section==="all"||item.section===section)&&
    [item.studentName,item.assessmentTitle,item.repoUrl,item.githubLogin,item.sourcePath,item.status]
      .join(" ").toLowerCase().includes(term));
  feed.replaceChildren();
  el("submissionStatus").textContent=filtered.length+" review item(s) shown · "+documents.length+
    " loaded (student receipts + V2 selected evidence)";
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
    header.append(make("span","text-xs text-slate-500",item.date?.toDate?.()?.toLocaleString()||"Date unavailable"));
    card.append(header);
    card.append(make("p","text-xs text-slate-600 mt-2","Section: "+(item.section||"Unknown")+
      " · "+(item.kind==="v2"?"Selected commit evidence: "+item.status:"GitHub revision receipt")));
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
      hyperlink(links,"Review selected evidence →","assessment-evidence-review.html?student="+
        encodeURIComponent(item.studentId)+"&assessment="+encodeURIComponent(item.assessmentId));
      hyperlink(links,"Grade in RepoFetch →","repofetch.html?section="+
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
  const old=el("submissionSection").value;
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
  select.value=sections.includes(old)?old:"all";
  render();
}
onAuthStateChanged(auth,async user=>{
  for(const stop of unsubscribe)stop();unsubscribe=[];snapshots={legacy:[],v2:[]};
  if(!user||!staff.has(String(user.email||"").toLowerCase())){
    el("submissionStatus").textContent="Authorized teacher sign-in required.";
    el("submissionFeed").replaceChildren();return;
  }
  try{
    const [roster,taskDocs]=await Promise.all([
      getDocs(collection(db,"students")),getDocs(collection(db,"assessments"))
    ]);
    if(auth.currentUser?.uid!==user.uid)return;
    students=new Map(roster.docs.map(d=>[d.id,d.data()]));
    assessments=new Map(taskDocs.docs.map(d=>[d.id,d.data()]));
    const request=(key,source,dateField)=>{
      const stop=onSnapshot(query(collection(db,source),orderBy(dateField,"desc"),limit(200)),
        snap=>{snapshots[key]=snap.docs.map(d=>({id:d.id,...d.data()}));refresh();},
        error=>{el("submissionStatus").textContent=source+" unavailable: "+error.message;});
      unsubscribe.push(stop);
    };
    request("legacy","student_submissions","submittedAt");
    request("v2","assessment_evidence","updatedAt");
  }catch(error){el("submissionStatus").textContent="Could not load review inbox: "+error.message;}
});
el("submissionSearch").addEventListener("input",render);
el("submissionSection").addEventListener("change",render);
