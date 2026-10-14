import {auth,db} from "../core/firebase-core.js";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {collection,query,orderBy,limit,onSnapshot} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const staff=new Set(["babaynike2013@gmail.com","josephsixson@mcstayuman.edu.ph"]);
const el=id=>document.getElementById(id);
const make=(tag,style,text)=>{const e=document.createElement(tag);if(style)e.className=style;if(text!=null)e.textContent=String(text);return e};
let documents=[],stop=null;
function repo(value){
 try{
  const u=new URL(value);
  const p=u.pathname.replace(/\.git$/i,"").replace(/\/$/,"").split("/").filter(Boolean);
  if(u.protocol==="https:"&&u.hostname.toLowerCase()==="github.com"&&p.length===2&&
   p.every(part=>/^[A-Za-z0-9_.-]+$/.test(part)))return "https://github.com/"+p.map(encodeURIComponent).join("/");
 }catch{}
 return null;
}
function hyperlink(parent,label,href){
 const a=make("a","text-xs sm:text-sm font-bold text-blue-700 hover:underline break-all",label);
 a.href=href;a.target="_blank";a.rel="noopener noreferrer";parent.append(a);
}
function render(){
 const feed=el("submissionFeed"),term=el("submissionSearch").value.trim().toLowerCase(),section=el("submissionSection").value;
 const filtered=documents.filter(d=>(section==="all"||d.section===section)&&
    [d.studentName,d.assessmentTitle,d.repoUrl,d.githubLogin,d.sourcePath].join(" ").toLowerCase().includes(term));
 feed.replaceChildren();
 el("submissionStatus").textContent=filtered.length+" submission receipt(s) shown · "+documents.length+" loaded";
 if(!filtered.length){feed.append(make("p","bg-white p-5 border border-slate-200 rounded-xl text-slate-600 text-sm","No submissions match these filters."));return;}
 for(const item of filtered){
  const card=make("article","bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5");
  const header=make("div","flex flex-col sm:flex-row gap-2 justify-between sm:items-start");
  const title=make("div","");
  title.append(make("h2","text-base sm:text-lg font-bold text-slate-900 break-words",item.studentName||"Student"));
  title.append(make("p","text-sm font-semibold text-blue-700 break-words",item.assessmentTitle||"Assessment"));
  header.append(title);
  const date=item.submittedAt?.toDate?.();
  header.append(make("span","text-xs text-slate-500",date?date.toLocaleString():"Submitted recently"));
  card.append(header);
  card.append(make("p","text-xs text-slate-600 mt-2 break-words","Section: "+(item.section||"Unknown")+
    " · GitHub: "+(item.githubLogin||"Not linked")));
  const rev=String(item.revisionSha||"");
  card.append(make("p","text-xs text-slate-700 font-mono mt-2 break-all","Revision: "+rev));
  if(item.sourcePath)card.append(make("p","text-xs text-slate-600 font-mono mt-1 break-all","Source: "+item.sourcePath));
  const urls=make("div","flex flex-wrap gap-x-5 gap-y-3 mt-4");
  const base=repo(item.repoUrl);
  if(base&&/^[a-f0-9]{40}$/i.test(rev)){
    hyperlink(urls,"View submitted commit ↗",base+"/commit/"+encodeURIComponent(rev));
    hyperlink(urls,"Repository at submission ↗",base+"/tree/"+encodeURIComponent(rev));
    const source=String(item.sourcePath||"").split("/").filter(Boolean);
    if(source.length&&!source.includes(".."))
      hyperlink(urls,"Open submitted source ↗",base+"/tree/"+encodeURIComponent(rev)+"/"+
        source.map(encodeURIComponent).join("/"));
  }
  const internal=make("a","text-xs sm:text-sm text-blue-700 font-bold hover:underline","Open RepoFetch →");
  internal.href="repofetch.html";urls.append(internal);card.append(urls);
  feed.append(card);
 }
}
function populateSections(){
 const select=el("submissionSection"),old=select.value;
 const sections=[...new Set(documents.map(x=>x.section).filter(Boolean))].sort();
 select.replaceChildren();
 const all=make("option","","All sections");all.value="all";select.append(all);
 for(const section of sections){const op=make("option","",section);op.value=section;select.append(op);}
 select.value=sections.includes(old)?old:"all";
}
onAuthStateChanged(auth,user=>{
 if(stop){stop();stop=null;}
 if(!user)return;
 if(!staff.has((user.email||"").toLowerCase())){
  el("submissionStatus").textContent="This inbox is available only to authorized instructors.";
  el("submissionFeed").replaceChildren();return;
 }
 stop=onSnapshot(query(collection(db,"student_submissions"),
   orderBy("submittedAt","desc"),limit(200)),
   result=>{documents=result.docs.map(d=>({id:d.id,...d.data()}));populateSections();render();},
   error=>{el("submissionStatus").textContent="Unable to load submissions: "+error.message;
     el("submissionFeed").replaceChildren();}
 );
});
el("submissionSearch").addEventListener("input",render);
el("submissionSection").addEventListener("change",render);
