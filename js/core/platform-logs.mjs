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
  view:initialUid?"user":"global",global:[],globalNext:null,fingerprint:"",
  recent:[],events:[],audit:[],auditCapped:false,impact:null,impactBusy:false,loading:false,
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
  state.globalNext=null;state.global=[];state.impact=null;state.impactBusy=false;
  $("pl-impact").hidden=true;$("pl-impact-results").replaceChildren();
  if(clearRecent){state.recent=[];state.recentNext=null;}
  $("pl-more").hidden=true;$("pl-more").disabled=true;
  $("pl-refresh").disabled=!state.eligible;
  $("pl-audit-wrap").hidden=true;
  $("pl-audit-records").replaceChildren();
}
function updateHead(){
  const individual=state.view==="user",latest=state.view==="recent";
  $("pl-view-eyebrow").textContent=individual?"Account timeline":latest?"Latest account summaries":"All accounts · chronological";
  $("pl-view-title").textContent=individual?labelFor(state.selectedUid):latest
    ?"Latest event per account":"Global Event Stream";
  $("pl-view-description").textContent=individual
    ?"A paginated timeline of recorded browser activity and backend outcomes for this account."
    :latest?"One newest recorded event per account. Open a user for more history."
    :"Server-received browser, notification, and selected backend process events across accounts. Newest first; this stream covers events indexed since the global feed was enabled.";
  $("pl-show-recent").setAttribute("aria-pressed",String(latest));
  $("pl-show-global").setAttribute("aria-pressed",String(state.view==="global"));
  $("pl-window").disabled=state.view!=="global";
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
  $("pl-audit-wrap").hidden=state.view!=="user"||!state.events.length&&!state.audit.length;
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
    record.phase?"Phase: "+humanize(record.phase):"",
    record.errorCode?"Code: "+record.errorCode:"",
    Number.isInteger(record.durationMs)?"Duration: "+record.durationMs+" ms":"",
    record.service?"Service: "+record.service:"",
    record.route?"Page: "+record.route:"",
    record.source?"Source: "+record.source:""
  ].filter(Boolean);
  context.append(make("span","",pieces.join(" · ")||"No additional diagnostic metadata"));
  const details=make("details","pl-event-detail");
  details.append(make("summary","","Developer details"));
  const detailGrid=make("dl","pl-event-fields");
  for(const [label,value] of [
    ["Event ID",record.id],["Session ID",record.sessionId],
    ["Operation ID",record.operationId],["Cloud trace",record.traceId],
    ["Error signature",record.fingerprint],["Release",record.release],
    ["Module",record.module],["Source",record.source],
    ["Service",record.service],["Error code",record.errorCode],
    ["Phase",record.phase],["Duration (ms)",record.durationMs],
    ["Page path",record.route]
  ])if(value!==undefined&&value!==null&&value!==""){
    const item=make("div");item.append(make("dt","",label),make("dd","",value));
    detailGrid.append(item);
  }
  if(!detailGrid.childElementCount)detailGrid.append(make("p","","No further recorded metadata."));
  details.append(detailGrid);context.append(details);
  const color=make("td");color.append(flag(record.severity));
  tr.append(color,when,owner,event,context);
  return tr;
}
function renderEvents(){
  updateHead();
  const rows=state.view==="user"?state.events:state.view==="recent"?state.recent:state.global;
  const summary={normal:0,warning:0,failure:0,unknown:0};
  for(const row of rows)summary[severity(row.severity)]++;
  for(const key of flags)$(["pl",key,"count"].join("-")).textContent=summary[key];
  const level=$("pl-level").value,module=$("pl-module").value;
  const search=$("pl-event-search").value.trim().toLocaleLowerCase();
  const filtered=rows.filter(row=>(state.view==="global"||(!level||severity(row.severity)===level)&&(!module||row.module===module))&&
    (!search||[row.ownerUid,state.selectedUid,row.action,row.errorCode,row.fingerprint,
      row.traceId,row.service,row.sessionId,row.module].some(value=>String(value||"").toLowerCase().includes(search))));
  const host=$("pl-events");host.replaceChildren();
  for(const row of filtered)host.append(eventRow(row,state.view==="user"?state.selectedUid:row.ownerUid,state.view!=="user"));
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
  $("pl-show-global").disabled=!state.eligible||state.loading;
  $("pl-impact-refresh").disabled=!state.eligible||state.impactBusy||state.view!=="global";
}
async function loadRecent({older=false}={}){
  if(state.loading||!state.eligible||state.view!=="recent")return;
  const reason=requiredReason();if(!reason)return;
  if(older&&!state.recentNext)return;
  const token=++state.readEpoch,epoch=state.epoch,cursor=older?state.recentNext:null;
  state.loading=true;refreshEnabled();
  $("pl-log-status").textContent=older?"Loading older recent-account summaries…":"Loading most recent account activity…";
  try{
    const result=(await getLogs({action:"recent_accounts",reason,limit:LIMIT,...(cursor?{cursor}:{})})).data;
    if(epoch!==state.epoch||token!==state.readEpoch||state.view!=="recent")return;
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
  if(state.loading||!state.eligible||state.view!=="user"||!state.selectedUid)return;
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
  state.selectedUid=uid;state.view="user";state.fingerprint="";
  resetRead();renderAccounts();renderEvents();
  try{history.replaceState(null,"","platform-logs.html?uid="+encodeURIComponent(uid));}catch{}
  if($("pl-reason").value.trim().length>=12)void loadAccount();
  else $("pl-log-status").textContent="Account selected. Enter an investigation reason above, then select Refresh to view its timeline.";
}
function chooseOverview(){
  state.selectedUid="";state.view="recent";state.fingerprint="";
  resetRead({clearRecent:false});renderAccounts();renderEvents();
  try{history.replaceState(null,"","platform-logs.html");}catch{}
  if($("pl-reason").value.trim().length>=12)void loadRecent();
  else $("pl-log-status").textContent="Enter an investigation reason, then load recent account activity.";
}

function renderImpact(){
  const box=$("pl-impact"),host=$("pl-impact-results");
  box.hidden=state.view!=="global";
  if(box.hidden)return;
  host.replaceChildren();
  if(!state.impact){
    host.append(make("p","pl-empty",state.impactBusy?"Analyzing recent recorded activity…":
      "Load the Global Event Stream to inspect recurring problems across users."));
    return;
  }
  const data=state.impact;
  const summary=make("p","pl-impact-summary",
    "Newest "+data.eventsSampled+" indexed events of at most "+data.sampleCap+
    " · "+data.observedAccounts+" observed accounts · "+
    (data.truncated?"Sample capped; values underestimate wider impact.":"No sample truncation detected."));
  host.append(summary);
  if(!Array.isArray(data.clusters)||!data.clusters.length){
    host.append(make("p","pl-empty","No warning or failure patterns were observed within this sample."));
    return;
  }
  for(const item of data.clusters){
    const card=make("article","pl-cluster");
    const left=make("div");
    left.append(flag(item.severity),
      make("strong","",humanize(item.action||"operational failure")),
      make("p","",humanize(item.module)+" · "+(item.errorCode||"No error code")+
        " · "+item.observedEvents+" observed events across "+item.observedAccounts+
        " accounts · Last: "+time(item.lastAt)));
    const action=make("button","pl-button pl-secondary","Inspect matching events");
    action.type="button";action.addEventListener("click",()=>{
      state.fingerprint=item.key;
      $("pl-level").value="";$("pl-module").value="";$("pl-event-search").value="";
      resetRead(); // Reset previous window and page cursor before narrowing the server-side query.
      state.impact=data;renderImpact();renderEvents();
      void loadGlobal();
    });
    card.append(left,action);host.append(card);
  }
  if(state.fingerprint){
    const clear=make("button","pl-button pl-secondary","Clear error-signature filter");
    clear.type="button";clear.addEventListener("click",()=>{state.fingerprint="";void loadGlobal();});
    host.prepend(clear);
  }
}
async function loadImpact(reason,epoch,token){
  if(state.impactBusy||state.view!=="global")return;
  state.impactBusy=true;renderImpact();
  try{
    const result=(await getLogs({action:"global_impact",reason,
      windowHours:Number($("pl-window").value)})).data;
    if(epoch!==state.epoch||token!==state.readEpoch||state.view!=="global")return;
    state.impact=result;
  }catch(error){
    if(epoch===state.epoch&&token===state.readEpoch)
      $("pl-impact-description").textContent="Impact sample unavailable: "+permissionError(error);
  }finally{
    if(epoch===state.epoch&&token===state.readEpoch){
      state.impactBusy=false;renderImpact();
    }
  }
}
async function loadGlobal({older=false}={}){
  if(state.loading||!state.eligible||state.view!=="global")return;
  const reason=requiredReason();if(!reason)return;
  if(older&&!state.globalNext)return;
  const epoch=state.epoch,token=++state.readEpoch,cursor=older?state.globalNext:null;
  state.loading=true;refreshEnabled();
  $("pl-log-status").textContent=older?"Loading older events across accounts…":"Loading chronological events across the platform…";
  try{
    const filter={
      action:"global_feed",reason,windowHours:Number($("pl-window").value),
      severity:state.fingerprint?"":$("pl-level").value,
      module:state.fingerprint?"":$("pl-module").value,
      ...(state.fingerprint?{fingerprint:state.fingerprint}:{}),
      limit:LIMIT,...(cursor?{cursor}:{})
    };
    const result=(await getLogs(filter)).data;
    if(epoch!==state.epoch||token!==state.readEpoch||state.view!=="global")return;
    if(!older)state.global=[];
    for(const row of Array.isArray(result.events)?result.events:[])
      state.global.push({...row,severity:severity(row.severity)});
    state.globalNext=result.hasMore?result.cursor:null;
    state.canMore=Boolean(state.globalNext);
    $("pl-log-status").textContent=state.global.length
      ? "Showing "+state.global.length+" recorded events across users"+
        (state.fingerprint?" matching error signature "+state.fingerprint:"")+
        ". Sorted by server time; filters apply across available indexed events. Expand Developer details or open an account to investigate."
      : "No indexed events match these filters. Earlier events remain available under individual user histories.";
    $("pl-purpose-status").textContent="Global diagnostic read authorized and audited.";
    if(!older&&!state.impactBusy)void loadImpact(reason,epoch,token);
  }catch(error){
    if(epoch===state.epoch&&token===state.readEpoch)
      $("pl-log-status").textContent=permissionError(error);
  }finally{
    if(epoch===state.epoch&&token===state.readEpoch){
      state.loading=false;refreshEnabled();renderEvents();
    }
  }
}
function chooseGlobal(){
  state.view="global";state.selectedUid="";
  state.fingerprint="";
  resetRead();renderAccounts();renderEvents();renderImpact();
  try{history.replaceState(null,"","platform-logs.html");}catch{}
  if($("pl-reason").value.trim().length>=12)void loadGlobal();
  else $("pl-log-status").textContent="Enter an investigation reason, then load events across all accounts.";
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
    $("pl-search").disabled=false;$("pl-show-recent").disabled=false;$("pl-show-global").disabled=false;
    $("pl-load-recent").disabled=false;$("pl-refresh").disabled=false;
    $("pl-purpose-status").textContent="Platform Administrator directory ready. Enter a reason before requesting diagnostic records.";
    renderAccounts();updateHead();
    if(state.selectedUid)$("pl-log-status").textContent="Account selected from Platform Users. Enter an investigation reason and select Refresh to load the timeline.";
    else $("pl-log-status").textContent="Enter an investigation reason, then load events from across the platform.";
  }catch(error){
    if(epoch!==state.epoch)return;
    state.eligible=false;
    $("pl-purpose-status").textContent=permissionError(error);
    $("pl-log-status").textContent="Access denied or identity directory unavailable. No user logs were loaded.";
  }
}
$("pl-search").addEventListener("input",renderAccounts);
$("pl-level").addEventListener("change",()=>state.view==="global"&&$("pl-reason").value.trim().length>=12
  ? (resetRead(),void loadGlobal()) : renderEvents());
$("pl-module").addEventListener("change",()=>state.view==="global"&&$("pl-reason").value.trim().length>=12
  ? (resetRead(),void loadGlobal()) : renderEvents());
$("pl-show-recent").addEventListener("click",chooseOverview);
$("pl-show-global").addEventListener("click",chooseGlobal);
$("pl-event-search").addEventListener("input",renderEvents);
$("pl-window").addEventListener("change",()=>{if(state.view==="global"){
  resetRead();renderImpact();if($("pl-reason").value.trim().length>=12)void loadGlobal();
}});
$("pl-impact-refresh").addEventListener("click",()=>{if(state.view==="global"){
  const reason=requiredReason();if(reason)void loadImpact(reason,state.epoch,state.readEpoch);
}});
$("pl-load-recent").addEventListener("click",chooseGlobal);
$("pl-refresh").addEventListener("click",()=>state.view==="user"?loadAccount():state.view==="recent"?loadRecent():loadGlobal());
$("pl-more").addEventListener("click",()=>state.view==="user"?loadAccount({older:true}):state.view==="recent"?loadRecent({older:true}):loadGlobal({older:true}));
onAuthStateChanged(auth,user=>{
  state.epoch++;resetRead({clearRecent:true});
  state.accounts=[];state.byUid.clear();state.directoryReady=false;state.eligible=false;
  $("pl-search").disabled=true;$("pl-show-recent").disabled=true;$("pl-show-global").disabled=true;$("pl-load-recent").disabled=true;
  $("pl-refresh").disabled=true;$("pl-reason").value="";
  $("pl-purpose-status").textContent=user?"Checking Platform Administrator access…":"Sign in with an authorized Platform Administrator account.";
  renderAccounts();renderEvents();
  if(user)void loadDirectory(user,state.epoch);
});
