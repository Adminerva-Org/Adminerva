/**
 * Read-only Platform Administrator log viewing. The account identity directory
 * is canonical platformUsers; event/audit history stays in platformAccountDiagnostics.
 * Every server-side log read requires a reason and creates a platform audit entry.
 */
import {app,auth} from "./firebase-core.js?v=1.3.0";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";

const $=id=>document.getElementById(id);
const functions=getFunctions(app,"asia-southeast1");
const getUsers=httpsCallable(functions,"platformUsers");
const getLogs=httpsCallable(functions,"platformAccountDiagnostics");
const LIMIT=35;
const flags=["normal","warning","failure","unknown"];
const deepLink=new URLSearchParams(location.search).get("uid")||"";
const initialUid=/^[A-Za-z0-9_-]{1,128}$/.test(deepLink)?deepLink:"";
const state={
  accounts:[],byUid:new Map(),directoryReady:false,eligible:false,selectedUid:initialUid,
  recent:[],events:[],audit:[],auditCapped:false,loading:false,
  recentNext:null,eventNext:null,canMore:false,epoch:0,readEpoch:0
};
const make=(tag,className="",value)=>{
  const element=document.createElement(tag);
  if(className)element.className=className;
  if(value!==undefined)element.textContent=String(value);
  return element;
};
const humanize=value=>String(value||"unknown").replaceAll("_"," ").replaceAll("-"," ");
function time(value){
  if(!Number.isFinite(value)||value<=0)return "Time unavailable";
  try{return new Intl.DateTimeFormat("en-PH",{timeZone:"Asia/Manila",dateStyle:"medium",timeStyle:"medium"}).format(new Date(value))+" PHT";}
  catch{return "Time unavailable";}
}
function permissionError(error){
  const code=String(error?.code||"");
  if(/permission-denied|unauthenticated/.test(code))return "Only an authorized Platform Administrator may inspect platform account activity.";
  if(/failed-precondition/.test(code))return "The log page changed while loading. Refresh the current view and retry.";
  if(/resource-exhausted/.test(code))return "The log backend reached a safe request limit. Retry with a smaller page.";
  return "Could not load diagnostic records. Check the connection and backend availability; earlier records have not been changed.";
}
function requiredReason(){
  if(!state.eligible){$("pl-purpose-status").textContent="Verified Platform Administrator access is required.";return null;}
  const value=$("pl-reason").value.trim();
  if(value.length<12||value.length>300){
    $("pl-purpose-status").textContent="Enter a support or security reason of 12–300 characters to view logs.";
    $("pl-reason").focus();
    return null;
  }
  return value;
}
function account(uid){
  return state.byUid.get(uid)||{uid,displayName:"Account "+uid,email:""};
}
function labelFor(uid){
  const user=account(uid);
  return user.displayName||user.email||"Account "+uid;
}
function severity(value){
  return flags.includes(value)?value:"unknown";
}
function flag(level){
  const labels={normal:"Normal",warning:"Warning",failure:"Failure",unknown:"Unclassified"};
  const element=make("span","pl-flag",undefined);
  element.dataset.level=severity(level);
  const dot=make("span","pl-dot");
  dot.setAttribute("aria-hidden","true");
  element.append(dot,document.createTextNode(labels[severity(level)]));
  return element;
}
function resetRead({clearRecent=false}={}){
  state.readEpoch++;state.loading=false;state.canMore=false;state.eventNext=null;
  state.events=[];state.audit=[];state.auditCapped=false;
  if(clearRecent){state.recent=[];state.recentNext=null;}
  $("pl-more").hidden=true;$("pl-more").disabled=true;
  $("pl-refresh").disabled=!state.eligible;
  $("pl-audit-wrap").hidden=true;
  $("pl-audit-records").replaceChildren();
}
function updateHead(){
  const selected=Boolean(state.selectedUid);
  $("pl-view-eyebrow").textContent=selected?"Account timeline":"Recent account activity";
  $("pl-view-title").textContent=selected?labelFor(state.selectedUid):"All-account activity overview";
  $("pl-view-description").textContent=selected
    ?"Recorded events for this user, newest first. Pagination loads older entries; account administration history is separate."
    :"Most recent recorded action for each active account in the loaded index. Choose a user for a detailed, paginated event history.";
  $("pl-show-recent").setAttribute("aria-pressed",String(!selected));
}
function renderAccounts(){
  const host=$("pl-accounts");host.replaceChildren();
  const query=$("pl-search").value.trim().toLocaleLowerCase();
  const matching=state.accounts.filter(item=>!query||
    [item.displayName,item.email,item.uid].some(value=>String(value||"").toLocaleLowerCase().includes(query)));
  $("pl-account-count").textContent=matching.length+" / "+state.accounts.length;
  for(const item of matching.slice(0,2000)){
    const button=make("button","pl-account");
    button.type="button";button.setAttribute("aria-pressed",String(item.uid===state.selectedUid));
    button.append(make("strong","",item.displayName||item.email||"Unnamed account"),
      make("small","",item.email||"No email address"),make("small","",item.uid));
    button.addEventListener("click",()=>chooseAccount(item.uid));
    host.append(button);
  }
  if(!matching.length)host.append(make("p","pl-empty",state.accounts.length?
    "No accounts match your search.":"No accounts are available. Check your authorization or reload."));
  if(matching.length>2000)host.append(make("p","pl-empty","Showing the first 2,000 matching accounts. Narrow the search."));
}
function renderAudit(){
  const host=$("pl-audit-records");host.replaceChildren();
  for(const item of state.audit){
    const card=make("article");
    card.append(make("strong","",humanize(item.action)),
      make("span","", " · "+time(item.at)+" · Actor ID: "+(item.actorUid||"not recorded")));
    host.append(card);
  }
  if(!state.audit.length)host.append(make("p","pl-empty","No account administration records found in the bounded audit sample."));
  if(state.auditCapped)host.append(make("p","pl-empty","The administrative audit sample is capped at 100 records."));
  $("pl-audit-wrap").hidden=!state.selectedUid||!state.events.length&&!state.audit.length;
}
function eventRow(record,ownerUid,overview){
  const tr=make("tr");
  const when=make("td");when.textContent=time(record.at);
  const owner=make("td");
  if(overview){
    const button=make("button","pl-inline-button",labelFor(ownerUid));
    button.type="button";button.addEventListener("click",()=>chooseAccount(ownerUid));
    owner.append(button);
  }else owner.append(make("strong","pl-primary-cell",labelFor(ownerUid)));
  owner.append(make("span","pl-muted",ownerUid));
  const event=make("td");
  event.append(make("strong","pl-primary-cell",record.action?humanize(record.action):"No recent action classified"),
    make("span","pl-muted",humanize(record.module||"other")));
  const context=make("td");
  const pieces=[
    record.state?humanize(record.state):"",
    record.errorCode?"Code: "+record.errorCode:"",
    record.route?"Page: "+record.route:"",
    record.service?"Service: "+record.service:"",
    record.release?"Release: "+record.release:"",
    record.source?"Source: "+record.source:""
  ].filter(Boolean);
  context.textContent=pieces.join(" · ")||"No additional diagnostic metadata";
  const color=make("td");color.append(flag(record.severity));
  tr.append(color,when,owner,event,context);
  return tr;
}
function renderEvents(){
  updateHead();
  const rows=state.selectedUid?state.events:state.recent;
  const summary={normal:0,warning:0,failure:0,unknown:0};
  for(const row of rows)summary[severity(row.severity)]++;
  for(const key of flags)$(["pl",key,"count"].join("-")).textContent=summary[key];
  const level=$("pl-level").value,module=$("pl-module").value;
  const filtered=rows.filter(row=>(!level||severity(row.severity)===level)&&(!module||row.module===module));
  const host=$("pl-events");host.replaceChildren();
  for(const row of filtered)host.append(eventRow(row,state.selectedUid||row.ownerUid,!state.selectedUid));
  if(!filtered.length){
    const empty=make("tr"),cell=make("td","pl-empty",
      rows.length?"No loaded events match these filters.":"No recorded activity loaded for this view.");
    cell.colSpan=5;empty.append(cell);host.append(empty);
  }
  $("pl-more").hidden=!state.canMore;$("pl-more").disabled=state.loading||!state.canMore;
  renderAudit();
}
function refreshEnabled(){
  $("pl-refresh").disabled=!state.eligible||state.loading;
  $("pl-load-recent").disabled=!state.eligible||state.loading;
  $("pl-more").disabled=state.loading||!state.canMore;
}
async function loadRecent({older=false}={}){
  if(state.loading||!state.eligible)return;
  const reason=requiredReason();if(!reason)return;
  if(older&&!state.recentNext)return;
  const token=++state.readEpoch,epoch=state.epoch,cursor=older?state.recentNext:null;
  state.loading=true;refreshEnabled();
  $("pl-log-status").textContent=older?"Loading older recent-account summaries…":"Loading most recent account activity…";
  try{
    const result=(await getLogs({action:"recent_accounts",reason,limit:LIMIT,...(cursor?{cursor}:{})})).data;
    if(epoch!==state.epoch||token!==state.readEpoch||state.selectedUid)return;
    const fresh=Array.isArray(result.accounts)?result.accounts:[];
    if(!older)state.recent=[];
    const byId=new Map(state.recent.map(row=>[row.ownerUid,row]));
    for(const entry of fresh)if(typeof entry.ownerUid==="string"&&entry.ownerUid){
      byId.set(entry.ownerUid,{...entry,severity:severity(entry.severity)});
    }
    state.recent=[...byId.values()];
    state.recentNext=result.hasMore?result.cursor:null;
    state.canMore=Boolean(state.recentNext);
    $("pl-log-status").textContent=state.recent.length
      ?"Showing "+state.recent.length+" recently active accounts, with their last recorded event and flags. This is an account index, not every event; select any account for its complete available timeline."
      :"No accounts have recorded diagnostic events yet. The directory still lists available logins.";
    $("pl-purpose-status").textContent="Authorized log read completed. This inspection was audited.";
  }catch(error){
    if(epoch===state.epoch&&token===state.readEpoch)$("pl-log-status").textContent=permissionError(error);
  }finally{
    if(epoch===state.epoch&&token===state.readEpoch){
      state.loading=false;refreshEnabled();renderEvents();
    }
  }
}
async function loadAccount({older=false}={}){
  if(state.loading||!state.eligible||!state.selectedUid)return;
  const reason=requiredReason();if(!reason)return;
  if(older&&!state.eventNext)return;
  const selected=state.selectedUid,token=++state.readEpoch,epoch=state.epoch,cursor=older?state.eventNext:null;
  state.loading=true;refreshEnabled();
  $("pl-log-status").textContent=older?"Loading older account events…":"Loading the selected account's diagnostic timeline…";
  try{
    const result=(await getLogs({
      action:"list",targetUid:selected,reason,limit:LIMIT,...(cursor?{cursor}:{})
    })).data;
    if(epoch!==state.epoch||token!==state.readEpoch||state.selectedUid!==selected)return;
    if(!older){
      state.events=[];state.audit=Array.isArray(result.accountAudit)?result.accountAudit:[];
      state.auditCapped=result.auditSampleCapped===true;
    }
    for(const row of Array.isArray(result.events)?result.events:[]){
      state.events.push({...row,severity:severity(row.severity)});
    }
    state.eventNext=result.hasMore?result.cursor:null;
    state.canMore=Boolean(state.eventNext);
    $("pl-log-status").textContent=state.events.length
      ?"Showing "+state.events.length+" loaded events for "+labelFor(selected)+". Older events are available using pagination where supported. Every read is audited."
      :"No logged events were found for this account. That does not establish that no activity occurred.";
    $("pl-purpose-status").textContent="Authorized log read completed. This inspection was audited.";
  }catch(error){
    if(epoch===state.epoch&&token===state.readEpoch&&state.selectedUid===selected)
      $("pl-log-status").textContent=permissionError(error);
  }finally{
    if(epoch===state.epoch&&token===state.readEpoch){
      state.loading=false;refreshEnabled();renderEvents();
    }
  }
}
function chooseAccount(uid){
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(uid))return;
  state.selectedUid=uid;
  resetRead();renderAccounts();renderEvents();
  try{history.replaceState(null,"","platform-logs.html?uid="+encodeURIComponent(uid));}catch{}
  if($("pl-reason").value.trim().length>=12)void loadAccount();
  else $("pl-log-status").textContent="Account selected. Enter an investigation reason above, then select Refresh to view its timeline.";
}
function chooseOverview(){
  state.selectedUid="";resetRead({clearRecent:false});
  renderAccounts();renderEvents();
  try{history.replaceState(null,"","platform-logs.html");}catch{}
  if($("pl-reason").value.trim().length>=12)void loadRecent();
  else $("pl-log-status").textContent="Enter an investigation reason, then load recent account activity.";
}
async function loadDirectory(user,epoch){
  $("pl-purpose-status").textContent="Loading the authorized account directory…";
  try{
    const data=(await getUsers({action:"list_all"})).data;
    if(epoch!==state.epoch||auth.currentUser?.uid!==user.uid)return;
    state.accounts=Array.isArray(data.items)?data.items:[];
    state.accounts.sort((a,b)=>(a.displayName||a.email||a.uid||"").localeCompare(b.displayName||b.email||b.uid||""));
    state.byUid=new Map(state.accounts.filter(a=>a.uid).map(a=>[a.uid,a]));
    state.directoryReady=true;state.eligible=true;
    $("pl-search").disabled=false;$("pl-show-recent").disabled=false;
    $("pl-load-recent").disabled=false;$("pl-refresh").disabled=false;
    $("pl-purpose-status").textContent="Platform Administrator directory ready. Enter a reason before requesting diagnostic records.";
    renderAccounts();updateHead();
    if(state.selectedUid)$("pl-log-status").textContent="Account selected from Platform Users. Enter an investigation reason and select Refresh to load the timeline.";
  }catch(error){
    if(epoch!==state.epoch)return;
    state.eligible=false;
    $("pl-purpose-status").textContent=permissionError(error);
    $("pl-log-status").textContent="Access denied or identity directory unavailable. No user logs were loaded.";
  }
}
$("pl-search").addEventListener("input",renderAccounts);
$("pl-level").addEventListener("change",renderEvents);
$("pl-module").addEventListener("change",renderEvents);
$("pl-show-recent").addEventListener("click",chooseOverview);
$("pl-load-recent").addEventListener("click",chooseOverview);
$("pl-refresh").addEventListener("click",()=>state.selectedUid?loadAccount():loadRecent());
$("pl-more").addEventListener("click",()=>state.selectedUid?loadAccount({older:true}):loadRecent({older:true}));
onAuthStateChanged(auth,user=>{
  state.epoch++;resetRead({clearRecent:true});
  state.accounts=[];state.byUid.clear();state.directoryReady=false;state.eligible=false;
  $("pl-search").disabled=true;$("pl-show-recent").disabled=true;$("pl-load-recent").disabled=true;
  $("pl-refresh").disabled=true;$("pl-reason").value="";
  $("pl-purpose-status").textContent=user?"Checking Platform Administrator access…":"Sign in with an authorized Platform Administrator account.";
  renderAccounts();renderEvents();
  if(user)void loadDirectory(user,state.epoch);
});
