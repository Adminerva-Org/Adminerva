import {app,auth,db} from "./firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {collection,addDoc,getDocs,query,where,serverTimestamp,limit} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {createTenantSchoolPicker} from "./tenant-school-picker.mjs?v=4.0.1";

const get=id=>document.getElementById(id);
const functions=getFunctions(app,"asia-southeast1");
const supportApi=httpsCallable(functions,"schoolSupport");
const modal=get("issueDetailsModal");
const newModal=get("bug-modal");
const form=get("supportReportForm");
const feed=get("issuesFeed");
const feedSummary=get("issuesFeedSummary");
const pageStatus=feedSummary;
let picker=null,schoolMode=false,schoolAdmin=false,reports=[],activeReport=null,activeDetail=null,desiredLocked=false;
let legacyLoaded=false,legacyStudent=null;

function escapeHTML(value){
  return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch]));
}
function dateText(value){return value?new Date(value).toLocaleString():"—";}
function scoped(action,details={}){
  const lease=picker.scope.lease();
  return supportApi({schoolId:lease.schoolId,action,...details}).then(response=>{
    picker.scope.assertLease(lease);return response.data;
  });
}
function setSchoolModeUI(){
  for(const id of ["filterAudience","filterReportType","reportExportTools"])get(id)?.toggleAttribute("hidden",true);
  get("legacyReportAudienceWrap")?.classList.add("hidden");
  const vote=get("upvoteBtn")?.parentElement; if(vote)vote.classList.add("hidden");
  get("adminTestBtn")?.classList.add("hidden");
  get("copyIssuePacket")?.classList.add("hidden");
  get("adminDeleteBtn")?.classList.add("hidden");
}
function currentFilters(){
  return {
    category:get("filterCategory")?.value||"All",
    status:get("filterStatus")?.value||"All",
    search:String(get("filterSearch")?.value||"").trim().toLowerCase(),
    mine:Boolean(get("filterMine")?.checked),
    sort:get("filterSort")?.value||"newest"
  };
}
function filteredReports(){
  const filters=currentFilters();
  let rows=reports.filter(report=>{
    if(filters.category!=="All"&&report.category!==filters.category)return false;
    if(filters.status!=="All"&&report.status!==filters.status)return false;
    if(filters.mine&&!report.isMine)return false;
    if(filters.search){
      const hay=[report.title,report.description,report.module,report.category,report.status].join(" ").toLowerCase();
      if(!hay.includes(filters.search))return false;
    }
    return true;
  });
  rows.sort((a,b)=>{
    if(filters.sort==="oldest")return Number(a.updatedAt||a.createdAt||0)-Number(b.updatedAt||b.createdAt||0);
    if(filters.sort==="priority"){
      const rank={Critical:0,High:1,Medium:2,Low:3};
      return (rank[a.priority]??9)-(rank[b.priority]??9)||Number(b.updatedAt||0)-Number(a.updatedAt||0);
    }
    return Number(b.updatedAt||b.createdAt||0)-Number(a.updatedAt||a.createdAt||0);
  });
  return rows;
}
function statusTone(status){
  if(status==="Resolved")return "bg-emerald-100 text-emerald-800";
  if(status==="In Progress")return "bg-amber-100 text-amber-800";
  if(status==="Waiting for Reporter")return "bg-violet-100 text-violet-800";
  if(status==="Closed")return "bg-slate-200 text-slate-700";
  return "bg-blue-100 text-blue-800";
}
function renderSchoolReports(){
  const rows=filteredReports();
  feedSummary.textContent=rows.length+" report"+(rows.length===1?"":"s");
  feed.replaceChildren();
  if(!rows.length){
    feed.innerHTML='<div class="py-10 text-center text-slate-500 border border-dashed border-slate-300 rounded-xl bg-white">No reports match the current filters.</div>';
    return;
  }
  for(const report of rows){
    const card=document.createElement("button");
    card.type="button";
    card.className="w-full text-left bg-white p-4 rounded-xl border border-slate-200 hover:border-cyan-400 hover:shadow-sm transition";
    card.innerHTML='<div class="flex items-start justify-between gap-3"><div class="min-w-0">'+
      '<div class="flex flex-wrap items-center gap-2 mb-1">'+
      '<span class="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded '+statusTone(report.status)+'">'+escapeHTML(report.status)+'</span>'+
      '<span class="text-[10px] font-bold uppercase text-slate-500">'+escapeHTML(report.category)+'</span>'+
      (report.priority==="Critical"?'<span class="text-[10px] font-extrabold uppercase text-rose-700">Critical</span>':'')+
      '</div><h3 class="font-extrabold text-slate-900">'+escapeHTML(report.title)+'</h3>'+
      '<p class="text-xs text-slate-500 mt-1">'+escapeHTML(report.module||"General")+' · '+escapeHTML(report.reporterLabel||"School member")+'</p>'+
      '</div><span class="text-xs text-slate-400 shrink-0">'+escapeHTML(dateText(report.updatedAt||report.createdAt))+'</span></div>';
    card.addEventListener("click",()=>void openSchoolReport(report.reportId));
    feed.append(card);
  }
}
async function loadSchoolReports(){
  pageStatus.textContent="Loading reports…";
  const result=await scoped("list",{limit:100});
  reports=result.reports||[];
  renderSchoolReports();
  const deep=new URLSearchParams(location.search).get("report");
  if(deep&&reports.some(row=>row.reportId===deep)){
    history.replaceState(null,"",location.pathname);
    await openSchoolReport(deep);
  }
}
function renderComments(comments){
  const node=get("commentsFeed");
  node.replaceChildren();
  get("commentCount").textContent=String(comments.length);
  if(!comments.length){
    node.innerHTML='<div class="text-center py-6 text-xs text-slate-400">No comments yet.</div>';return;
  }
  for(const comment of comments){
    const item=document.createElement("div");
    item.className="bg-white p-3 rounded-lg border border-slate-200";
    item.innerHTML='<div class="flex justify-between gap-2"><strong class="text-xs">'+escapeHTML(comment.authorLabel||"School member")+'</strong>'+
      '<span class="text-[10px] text-slate-400">'+escapeHTML(dateText(comment.createdAt))+'</span></div>'+
      '<p class="text-sm text-slate-700 whitespace-pre-wrap mt-1">'+escapeHTML(comment.text||"")+'</p>';
    node.append(item);
  }
}
async function openSchoolReport(reportId){
  const result=await scoped("get",{reportId});
  activeDetail=result;activeReport=result.report;desiredLocked=Boolean(activeReport.locked);
  get("modalBadges").innerHTML=
    '<span class="text-[10px] font-bold px-2 py-0.5 rounded uppercase '+statusTone(activeReport.status)+'">'+escapeHTML(activeReport.status)+'</span>'+
    '<span class="text-[10px] font-bold text-slate-200 border border-slate-500 px-2 py-0.5 rounded uppercase">'+escapeHTML(activeReport.category)+'</span>'+
    '<span class="text-[10px] font-bold text-slate-200 border border-slate-500 px-2 py-0.5 rounded uppercase">'+escapeHTML(activeReport.priority)+'</span>';
  get("modalIssueTitle").textContent=activeReport.title;
  get("modalReporterData").textContent=activeReport.reporterLabel||"School member";
  get("modalDateData").textContent=dateText(activeReport.createdAt);
  get("modalIssueDescription").textContent=(activeReport.description||"")+(activeReport.module?"\n\nArea: "+activeReport.module:"");
  get("modalScreenshots").innerHTML='<span class="text-xs text-slate-400">Attachments are not enabled for this school.</span>';
  renderComments(result.comments||[]);

  get("adminControlPanel").classList.toggle("hidden",!schoolAdmin);
  if(schoolAdmin){
    get("adminControlLabel").textContent="School Admin";
    get("adminStatusSelect").value=activeReport.status||"Open";
    get("adminPrioritySelect").value=activeReport.priority||"Medium";
    get("adminDecisionReason").value="";
    get("adminLockBtn").textContent=desiredLocked?"Unlock discussion":"Lock discussion";
  }
  const locked=Boolean(activeReport.locked)||activeReport.status==="Closed";
  get("commentInputBox").classList.toggle("hidden",locked);
  get("lockedNotice").classList.toggle("hidden",!locked);
  modal.classList.remove("hidden");
}
window.openIssueModal=id=>void openSchoolReport(id);
window.closeIssueModal=()=>{modal.classList.add("hidden");activeReport=null;activeDetail=null;};
window.viewFullscreen=()=>{};

async function saveTriage(){
  if(!schoolAdmin||!activeReport)return;
  const reason=get("adminDecisionReason").value.trim();
  if(reason.length<12){
    alert("Enter a short reason for the change (at least 12 characters).");return;
  }
  const button=get("adminSaveTriage");button.disabled=true;
  try{
    const result=await scoped("triage",{
      reportId:activeReport.reportId,
      status:get("adminStatusSelect").value,
      priority:get("adminPrioritySelect").value,
      locked:desiredLocked,
      reason,
      expectedRevision:Number(activeReport.revision)
    });
    activeReport={...activeReport,...result};
    await loadSchoolReports();
    await openSchoolReport(result.reportId);
  }catch(error){alert(error?.message||"Report triage could not be saved.");}
  finally{button.disabled=false;}
}
get("adminSaveTriage")?.addEventListener("click",()=>void saveTriage());
get("adminLockBtn")?.addEventListener("click",()=>{
  if(!schoolMode)return;
  desiredLocked=!desiredLocked;
  get("adminLockBtn").textContent=desiredLocked?"Unlock discussion":"Lock discussion";
});

get("postCommentBtn")?.addEventListener("click",()=>void (async()=>{
  if(!schoolMode||!activeReport)return;
  const input=get("newCommentText"),text=input.value.trim();
  if(!text)return;
  const button=get("postCommentBtn");button.disabled=true;
  try{
    await scoped("comment",{reportId:activeReport.reportId,text});
    input.value="";
    await openSchoolReport(activeReport.reportId);
  }catch(error){alert(error?.message||"Comment could not be posted.");}
  finally{button.disabled=false;}
})());

function openNewReport(){
  form.reset();
  get("supportReportStatus").textContent="";
  get("legacyReportAudienceWrap").classList.toggle("hidden",schoolMode);
  newModal.classList.remove("hidden");
}
function closeNewReport(){newModal.classList.add("hidden");}
get("newReportButton")?.addEventListener("click",openNewReport);
get("supportReportClose")?.addEventListener("click",closeNewReport);
get("supportReportCancel")?.addEventListener("click",closeNewReport);

async function findLegacyStudent(){
  const user=auth.currentUser;
  if(!user?.email)return null;
  try{
    const snap=await getDocs(query(collection(db,"students"),where("email","==",user.email.toLowerCase()),limit(5)));
    const doc=snap.docs.find(item=>!["archived","suspended","inactive"].includes(String(item.data().status||"active")));
    return doc?{studentId:doc.id,section:doc.data().section||""}:null;
  }catch{return null;}
}
async function createLegacyReport(values){
  const user=auth.currentUser;
  if(!user?.uid)throw Error("Sign in before creating a report.");
  legacyStudent=legacyStudent||await findLegacyStudent();
  let audience=String(values.audience||"admin");
  if(values.category==="Bug")audience="admin";
  if(audience==="teacher"&&!legacyStudent)audience="admin";
  const payload={
    title:values.title,description:values.description,category:values.category,
    priority:"Medium",images:[],urlContext:location.href,
    reporterEmail:(user.email||"").toLowerCase(),reporterUid:user.uid,reporterRole:"reporter",
    status:"Open",upvotes:[],locked:false,createdAt:serverTimestamp(),
    module:values.module||"",expectedBehavior:"",actualBehavior:"",reproductionSteps:"",
    clientContext:{page:location.pathname,userAgent:navigator.userAgent.slice(0,300)},
    audience,studentId:legacyStudent?.studentId||"",section:legacyStudent?.section||""
  };
  await addDoc(collection(db,"issues"),payload);
}
form?.addEventListener("submit",event=>void (async()=>{
  event.preventDefault();
  if(!form.reportValidity())return;
  const submit=get("supportReportSubmit");submit.disabled=true;
  const data=new FormData(form);
  const values=Object.fromEntries(data.entries());
  get("supportReportStatus").textContent="Submitting…";
  try{
    if(schoolMode){
      await scoped("create",{title:values.title,description:values.description,category:values.category,module:values.module||""});
      closeNewReport();await loadSchoolReports();
    }else{
      await createLegacyReport(values);
      closeNewReport();
      if(legacyLoaded)location.reload();
    }
  }catch(error){
    get("supportReportStatus").textContent=error?.message||"Report could not be submitted.";
  }finally{submit.disabled=false;}
})());

for(const id of ["filterCategory","filterStatus","filterSort","filterMine"]){
  get(id)?.addEventListener("change",()=>{if(schoolMode)renderSchoolReports();});
}
get("filterSearch")?.addEventListener("input",()=>{if(schoolMode)renderSchoolReports();});
get("resetReportFilters")?.addEventListener("click",()=>{
  if(!schoolMode)return;
  get("filterCategory").value="All";get("filterStatus").value="All";get("filterSort").value="newest";
  get("filterSearch").value="";get("filterMine").checked=false;renderSchoolReports();
});

async function startLegacyFallback(){
  if(legacyLoaded)return;
  legacyLoaded=true;schoolMode=false;
  get("legacyReportAudienceWrap")?.classList.remove("hidden");
  get("supportSchoolPicker")?.setAttribute("hidden","");
  await import("./issues-legacy.js?v=1.4.4");
  // Old issue tracker did not have creation wiring; the shared form above supplies it.
}

picker=createTenantSchoolPicker({
  host:get("supportSchoolPicker"),status:pageStatus,
  onReady:scope=>{
    if(!scope.current){
      void startLegacyFallback();return;
    }
    schoolMode=true;
    schoolAdmin=scope.current.roles.includes("school_admin");
    setSchoolModeUI();
    void loadSchoolReports().catch(error=>{
      pageStatus.textContent=error?.message||"School reports could not be loaded.";
    });
  }
});
void auth.authStateReady().then(async()=>{
  try{
    const state=await picker.load();
    if(!picker.scope.current&&(state?.state==="no_school"||state?.state==="choose_school"===false))
      await startLegacyFallback();
  }catch{
    await startLegacyFallback();
  }
});
