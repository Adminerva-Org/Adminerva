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
const LIMIT=35,LIVE_LIMIT=60,LIVE_INTERVAL_MS=3000,LIVE_MAX_LINES=240;
const flags=["normal","warning","failure","unknown"];
const deepLink=new URLSearchParams(location.search).get("uid")||"";
const initialUid=/^[A-Za-z0-9_-]{1,128}$/.test(deepLink)?deepLink:"";
const state={
  inspected:null,inspectorTrigger:null,inspectorSignature:"",accounts:[],byUid:new Map(),directoryReady:false,eligible:false,selectedUid:initialUid,
  view:initialUid?"user":"global",global:[],globalNext:null,fingerprint:"",
  recent:[],events:[],audit:[],auditCapped:false,impact:null,impactBusy:false,trends:null,trendsBusy:false,loading:false,
  recentNext:null,eventNext:null,canMore:false,epoch:0,readEpoch:0,
  live:{running:false,paused:false,busy:false,reason:"",cursor:"",baseline:false,
    generation:0,timer:null,rows:[],seen:new Set(),highlighted:new Map(),
    added:0,lastBatch:0,lastChecked:0,errors:0,status:"Enter a reason to start."}
};
const make=(tag,className="",value)=>{
  const element=document.createElement(tag);
  if(className)element.className=className;
  if(value!==undefined)element.textContent=String(value);
  return element;
};
const humanize=value=>String(value||"unknown").replaceAll("_"," ").replaceAll("-"," ");
// Only correlate the authorized loaded sample within the same account and session.
function relatedOperationRows(rows,selected,ownerUid){
  if(!selected.operationId||!selected.sessionId)return [];
  const scoped=rows.filter(row=>(row.ownerUid||ownerUid)===ownerUid&&row.sessionId===selected.sessionId);
  const ids=new Set([selected.operationId]);
  // Follow only explicit parent links. Active snapshots supply context but do not
  // merge separate operation trees. Cycles terminate because each ID is visited once.
  for(let changed=true;changed;){
    changed=false;
    for(const row of scoped){
      const op=row.operationId,parent=row.context?.parentOperationId;
      if(!op||!parent)continue;
      if(ids.has(op)&&!ids.has(parent)){ids.add(parent);changed=true;}
      if(ids.has(parent)&&!ids.has(op)){ids.add(op);changed=true;}
    }
  }
  return scoped.filter(row=>ids.has(row.operationId)||row.context?.active?.some(p=>ids.has(p.id)))
    .sort((a,b)=>a.at-b.at||String(a.id).localeCompare(String(b.id)));
}
function operationStatus(rows,operationId){
  const own=rows.filter(row=>row.operationId===operationId);
  const terminal=own.filter(row=>["process_finished","process_failed"].includes(row.action));
  if(terminal.length)return terminal.some(row=>row.action==="process_failed")?"Failure observed":"Completion observed";
  const backend=own.filter(row=>row.provenance==="server_confirmed"&&["api_succeeded","api_failed"].includes(row.action));
  if(backend.length)return backend.some(row=>row.action==="api_failed")?"Backend rejection recorded; browser completion not loaded":"Backend returned; browser completion not loaded";
  if(own.some(row=>row.action==="process_started")){
    const age=Math.max(0,...rows.flatMap(row=>(row.context?.active||[]).filter(p=>p.id===operationId).map(p=>p.ageMs||0)));
    if(age>=60000)return "Observed active for "+Math.floor(age/1000)+"s; no completion loaded";
    return "No completion in loaded sample";
  }
  return "No tracked lifecycle in loaded sample";
}
function loadedRows(){
  return state.view==="user"?state.events:state.view==="live"?state.live.rows:state.view==="global"?state.global:state.recent;
}
function closeInspector({restoreFocus=false}={}){
  const trigger=state.inspectorTrigger;
  state.inspected=null;state.inspectorTrigger=null;state.inspectorSignature="";
  $("pl-inspector").hidden=true;$("pl-inspector-body").replaceChildren();
  $("pl-investigation-grid").classList.remove("pl-inspecting");
  if(restoreFocus){if(trigger?.isConnected)trigger.focus();else $("pl-event-search").focus();}
}
function inspectEvent(row,ownerUid,trigger){
  if(!state.eligible||!row.id||!ownerUid)return;
  state.inspected={id:row.id,ownerUid};state.inspectorTrigger=trigger;state.inspectorSignature="";
  renderInspector();
  if(!$("pl-inspector").hidden)$("pl-inspector-title").focus();
}
function inspectButton(row,ownerUid){
  const b=make("button","pl-inspect-button","Inspect");b.type="button";
  b.setAttribute("aria-label","Inspect "+diagnosticActionLabel(row.action));
  b.addEventListener("click",()=>inspectEvent(row,ownerUid,b));return b;
}
function renderInspector(){
  if(!state.inspected||!state.eligible)return;
  const {id,ownerUid}=state.inspected,rows=loadedRows();
  const row=rows.find(r=>r.id===id&&(r.ownerUid||state.selectedUid)===ownerUid);
  if(!row){closeInspector();return;}
  const related=relatedOperationRows(rows,row,ownerUid);
  const signature=JSON.stringify([id,ownerUid,related.map(r=>r.id)]);
  if(signature===state.inspectorSignature)return;
  state.inspectorSignature=signature;
  const host=$("pl-inspector-body");host.replaceChildren();
  const top=make("div","pl-inspector-event");
  top.append(flag(row.severity),make("strong","",diagnosticActionLabel(row.action)),make("span","",labelFor(ownerUid)+" · "+time(row.at)));
  host.append(top);
  const data=make("dl","pl-inspector-fields");
  for(const [key,value] of [
    ["Page",row.route],["Module",row.module],["Phase",row.phase],["State",row.state],
    ["Provenance",row.provenance],["Service",row.service],["Error",row.errorCode],
    ["Duration (ms)",row.durationMs],["Account ID",ownerUid],["Event ID",row.id],["Session ID",row.sessionId],
    ["Operation ID",row.operationId],["Cloud trace",row.traceId],["Release",row.release],
    ["Device",[row.deviceClass,row.browserFamily,row.osFamily,row.viewport].filter(Boolean).join(" · ")],...contextFields(row)
  ])if(value!==undefined&&value!==null&&value!==""){
    const field=make("div");field.append(make("dt","",key),make("dd","",value));data.append(field);
  }
  host.append(data,make("h4","","Related operation · "+related.length+" loaded"));
  host.append(make("p","pl-inspector-note",operationStatus(related,row.operationId)+". Client-supplied links, same account/session. Server receipt order; missing completion is not proof of a stuck process."));
  const list=make("ol","pl-operation-timeline");
  for(const e of related){
    const item=make("li");item.dataset.severity=severity(e.severity);
    const b=make("button","pl-operation-event",diagnosticActionLabel(e.action));b.type="button";
    b.addEventListener("click",()=>inspectEvent(e,ownerUid,b));
    if(e.id===row.id)b.setAttribute("aria-current","true");
    item.append(make("time","",liveTime(e.at)),b,make("small","",e.operationId===row.operationId?(e.context?.process||e.service||e.phase||""):e.context?.parentOperationId===row.operationId?"Child · "+(e.context?.process||e.service||e.action):row.context?.parentOperationId===e.operationId?"Parent · "+(e.context?.process||e.service||e.action):e.context?.parentOperationId?"Linked operation · "+(e.context?.process||e.service||e.action):"Related operation or active snapshot"));list.append(item);
  }
  host.append(list);
  $("pl-inspector").hidden=false;$("pl-investigation-grid").classList.add("pl-inspecting");
}
function contextFields(record){
  const c=record.context;if(!c)return [];
  const active=Array.isArray(c.active)?c.active:[];
  return [["Control",c.control],["Tracked process",c.process],["Parent operation (client)",c.parentOperationId],["Client time (unverified)",Number.isSafeInteger(c.clientAt)?time(c.clientAt):""],
    ["Rejection reason",c.reasonCode],["Project category",c.projectCategory],["Recovery",c.recovery],["Device backup (client)",c.deviceBackup],["Retry",c.retryState],["Page state",[c.visibility,c.network,c.focus,c.ready,c.dialog==="open"?"dialog open":"",c.busy].filter(Boolean).join(" · ")],
    ["Elapsed (ms)",c.elapsedMs],["Tracked active processes",Array.isArray(c.active)?active.length+(c.overflow||0):null],
    ["Overlap (same tracked operation)",active.some((p,i)=>active.slice(0,i).some(q=>q.name===p.name))?"Observed; not proof of a duplicate write":""],
    ...active.map(p=>["Active "+p.name,p.id+" · "+p.ageMs+" ms"])];
}
function diagnosticActionLabel(action){
  if(action==="api_succeeded")return "Backend callable returned";
  if(action==="api_failed")return "Backend callable failed";
  if(action==="auth_session_observed")return "Authenticated session observed";
  return humanize(action||"unknown event");
}
function time(value){
  if(!Number.isFinite(value)||value<=0)return "Time unavailable";
  try{return new Intl.DateTimeFormat("en-PH",{timeZone:"Asia/Manila",dateStyle:"medium",timeStyle:"medium"}).format(new Date(value))+" PHT";}
  catch{return "Time unavailable";}
}
function permissionError(error){
  const code=String(error?.code||"");
  if(/permission-denied|unauthenticated/.test(code))return "Only an authorized Platform Administrator may inspect platform account activity.";
  if(/failed-precondition/.test(code))
    return "The log cursor expired or the required Firestore index is not ready. Refresh; if this continues, verify the backend/index deployment.";
  if(/resource-exhausted/.test(code))
    return "The log backend reached a safety limit. Retry later; previously recorded events have not been deleted.";
  if(/unavailable|deadline-exceeded/.test(code))
    return "The diagnostic backend is temporarily unavailable. Retry this view after connectivity is restored.";
  return "Could not load diagnostic records. Check the connection and backend availability; earlier records have not been changed.";
}
function requiredReason(){
  if(!state.eligible){$("pl-purpose-status").textContent="Verified Platform Administrator access is required.";return null;}
  const value=$("pl-reason").value.trim();
  if(value.length<12||value.length>300){
    $("pl-access-disclosure").open=true;$("pl-purpose-status").textContent="Enter a support or security reason of 12–300 characters to view logs.";
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
  stopLive();closeInspector();
  state.readEpoch++;state.loading=false;state.canMore=false;state.eventNext=null;
  state.events=[];state.audit=[];state.auditCapped=false;
  state.globalNext=null;state.global=[];state.impact=null;state.impactBusy=false;
  state.trends=null;state.trendsBusy=false;state.trendsRendered=undefined;
  $("pl-impact").hidden=true;$("pl-impact-results").replaceChildren();
  $("pl-trends").hidden=true;
  if(clearRecent){state.recent=[];state.recentNext=null;}
  $("pl-more").hidden=true;$("pl-more").disabled=true;
  $("pl-refresh").disabled=!state.eligible;
  $("pl-audit-wrap").hidden=true;
  $("pl-audit-records").replaceChildren();
}
function updateHead(){
  const individual=state.view==="user",latest=state.view==="recent",live=state.view==="live";
  $("pl-view-eyebrow").textContent=individual?"Account timeline":live?"Live · every 3 seconds":latest?"Latest account summaries":"All accounts · chronological";
  $("pl-view-title").textContent=individual?labelFor(state.selectedUid):live?"Platform Live Console":latest
    ?"Latest event per account":"Global Event Stream";
  $("pl-view-description").textContent=individual
    ?"A paginated timeline of recorded browser activity and backend outcomes for this account."
    :live?"Three-second near-live checks across accounts, presented in chronological console lines. Recorded diagnostic events only."
    :latest?"One newest recorded event per account. Open a user for more history."
    :"Server-received browser, notification, and selected backend process events across accounts. Newest first; this stream covers events indexed since the global feed was enabled.";
  $("pl-show-recent").setAttribute("aria-pressed",String(latest));
  $("pl-show-global").setAttribute("aria-pressed",String(state.view==="global"));
  $("pl-show-live").setAttribute("aria-pressed",String(live));
  $("pl-window").disabled=state.view!=="global";
  $("pl-live").hidden=!live;
  $("pl-analysis-drawer").hidden=state.view!=="global";
  document.querySelector(".pl-table-wrap").hidden=live;
  $("pl-more").hidden=live||!state.canMore;
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
    const actor=item.actorUid?labelFor(item.actorUid)+" ("+item.actorUid+")":"Not recorded";
    card.append(make("strong","",humanize(item.action)),
      make("span","", " · "+time(item.at)+" · Performed by: "+actor));
    host.append(card);
  }
  if(!state.audit.length)host.append(make("p","pl-empty","No account administration records found in the bounded audit sample."));
  if(state.auditCapped)host.append(make("p","pl-empty","The administrative audit sample is capped at 100 records."));
  $("pl-audit-wrap").hidden=state.view!=="user"||!state.events.length&&!state.audit.length;
}
function eventRow(record,ownerUid,overview){
  const tr=make("tr");
  const when=make("td");when.textContent=Number.isFinite(record.at)&&record.at>0?liveTime(record.at):"—";when.title=time(record.at);when.append(make("small","pl-event-date",record.at>0?new Intl.DateTimeFormat("en-PH",{timeZone:"Asia/Manila",month:"short",day:"numeric"}).format(new Date(record.at)):""));
  const owner=make("td");
  if(overview){
    const button=make("button","pl-inline-button",labelFor(ownerUid));
    button.type="button";button.addEventListener("click",()=>chooseAccount(ownerUid));
    owner.append(button);
  }else owner.append(make("strong","pl-primary-cell",labelFor(ownerUid)));
  owner.append(make("span","pl-muted",ownerUid));
  const event=make("td");
  event.append(make("strong","pl-primary-cell",record.action?diagnosticActionLabel(record.action):"No recent action classified"),
    make("span","pl-muted",humanize(record.module||"other")));
  const context=make("td");
  const pieces=[
    record.state?humanize(record.state):"",
    record.phase?"Phase: "+humanize(record.phase):"",
    record.errorCode?"Code: "+record.errorCode:"",
    Number.isInteger(record.durationMs)?"Duration: "+record.durationMs+" ms":"",
    record.service?"Service: "+record.service:"",
    record.route?"Page: "+record.route:"",
    record.context?.control?"Control: "+record.context.control:"",
    record.context?.process?"Process: "+record.context.process:"",
    record.context?.reasonCode||"",
    record.source?"Source: "+record.source:"",
    record.provenance?"Evidence: "+(record.provenance==="server_confirmed"?"Server-confirmed":"Client-observed"):""
  ].filter(Boolean);
  if(record.action==="api_succeeded")pieces.push("Callable returned without throwing; not proof of a committed record");
  context.append(make("span","",pieces.join(" · ")||"No additional diagnostic metadata"));
  if(record.id)context.append(inspectButton(record,ownerUid));
  const details=make("details","pl-event-detail");
  details.append(make("summary","","Developer details"));
  const detailGrid=make("dl","pl-event-fields");
  for(const [label,value] of [
    ["Account ID",ownerUid],["Event ID",record.id],["Session ID",record.sessionId],
    ["Operation ID",record.operationId],["Cloud trace",record.traceId],
    ["Error signature",record.fingerprint],["Release",record.release],
    ["Module",record.module],["Source",record.source],["Provenance",record.provenance],
    ["Service",record.service],["Error code",record.errorCode],
    ["Phase",record.phase],["Duration (ms)",record.durationMs],
    ["Device class",record.deviceClass],["Browser family",record.browserFamily],
    ["Operating system",record.osFamily],["Viewport category",record.viewport],
    ["Page path",record.route],...contextFields(record)
  ])if(value!==undefined&&value!==null&&value!==""){
    const item=make("div");item.append(make("dt","",label),make("dd","",value));
    detailGrid.append(item);
  }
  if(!detailGrid.childElementCount)detailGrid.append(make("p","","No further recorded metadata."));
  details.append(detailGrid);context.append(details);
  const color=make("td");color.append(flag(record.severity));
  // On narrow screens the same semantic table rows become compact cards.
  // Labels are explicit and developer details remain expandable.
  for(const [cell,label,cssName] of [
    [color,"Flag","pl-cell-flag"],[when,"Time","pl-cell-time"],
    [owner,"Account","pl-cell-account"],[event,"Event","pl-cell-event"],
    [context,"Context","pl-cell-context"]
  ]){
    cell.dataset.label=label;cell.classList.add(cssName);
  }
  tr.append(color,when,owner,event,context);
  return tr;
}

function markAudited(reason){
  if($("pl-reason").value.trim()!==reason)return;
  $("pl-access-summary").textContent="Audited · "+reason;
  $("pl-access-disclosure").open=false;
}
function renderFilterSummary(visibleCount,totalCount){
  const view=state.view;
  const severityFilter=$("pl-level").value,module=$("pl-module").value;
  const search=$("pl-event-search").value.trim(),fingerprint=state.fingerprint;
  const filters=[severityFilter&&"flag: "+severityFilter,module&&"module: "+module,
    search&&"text: "+search,(view==="global"&&fingerprint)&&"error signature: "+fingerprint].filter(Boolean);
  $("pl-clear-filters").disabled=!filters.length;
  for(const button of document.querySelectorAll(".pl-quick-filter"))button.setAttribute("aria-pressed",String(button.dataset.filter===severityFilter));
  const scope=view==="global"
    ?"Flag/module/error signature are queried on the server. Text search affects loaded rows only."
    :view==="live"
      ?"The watch still collects all events; filters affect visible console lines only."
      :"Filters affect loaded rows only; older events are available through pagination.";
  $("pl-filter-status").textContent=visibleCount+" visible / "+totalCount+
    " loaded · "+(filters.length?filters.join(" · "):"No filters active")+". "+scope;
}
function clearInvestigationFilters(){
  $("pl-level").value="";$("pl-module").value="";
  $("pl-event-search").value="";state.fingerprint="";
  if(state.view==="global"){
    resetRead();renderEvents();
    if($("pl-reason").value.trim().length>=12)void loadGlobal();
  }else if(state.view==="live")renderLive();
  else renderEvents();
}

function renderEvents(){
  updateHead();renderTrends();
  const rows=state.view==="user"?state.events:state.view==="recent"?state.recent:state.view==="live"?state.live.rows:state.global;
  const summary={normal:0,warning:0,failure:0,unknown:0};
  for(const row of rows)summary[severity(row.severity)]++;
  for(const key of flags)$(["pl",key,"count"].join("-")).textContent=summary[key];
  const level=$("pl-level").value,module=$("pl-module").value;
  const search=$("pl-event-search").value.trim().toLocaleLowerCase();
  const filtered=rows.filter(row=>(state.view==="global"||(!level||severity(row.severity)===level)&&(!module||row.module===module))&&
    (!search||[row.ownerUid,state.selectedUid,row.action,row.errorCode,row.fingerprint,
      row.traceId,row.service,row.sessionId,row.module,row.route,row.operationId,row.context?.control,row.context?.process,row.context?.reasonCode,row.context?.parentOperationId,...(row.context?.active||[]).flatMap(p=>[p.id,p.name])].some(value=>String(value||"").toLowerCase().includes(search))));
  if(state.view==="live"){
    $("pl-audit-wrap").hidden=true;$("pl-impact").hidden=true;
    renderLive();return;
  }
  renderFilterSummary(filtered.length,rows.length);
  const host=$("pl-events");host.replaceChildren();
  for(const row of filtered)host.append(eventRow(row,state.view==="user"?state.selectedUid:row.ownerUid,state.view!=="user"));
  if(!filtered.length){
    const empty=make("tr"),cell=make("td","pl-empty",
      rows.length?"No loaded events match these filters.":"No recorded activity loaded for this view.");
    cell.colSpan=5;empty.append(cell);host.append(empty);
  }
  $("pl-more").hidden=!state.canMore;$("pl-more").disabled=state.loading||!state.canMore;
  renderAudit();renderInspector();
}
function refreshEnabled(){
  $("pl-refresh").disabled=!state.eligible||state.loading;
  $("pl-load-recent").disabled=!state.eligible||state.loading;
  $("pl-more").disabled=state.loading||!state.canMore;
  // Mode navigation can interrupt a slow read: resetRead invalidates its token.
  $("pl-show-global").disabled=!state.eligible;
  $("pl-show-live").disabled=!state.eligible;
  $("pl-impact-refresh").disabled=!state.eligible||state.impactBusy||state.view!=="global";
  $("pl-trends-refresh").disabled=!state.eligible||state.trendsBusy||state.view!=="global";
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
    $("pl-purpose-status").textContent="Authorized log read completed. This inspection was audited.";markAudited(reason);
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
    $("pl-purpose-status").textContent="Authorized log read completed. This inspection was audited.";markAudited(reason);
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


function renderTrends(){
  const visible=state.view==="global";
  $("pl-trends").hidden=!visible;
  if(!visible)return;
  const data=state.trends;
  // Avoid rebuilding the sampled chart and collapsing its inspectable table
  // whenever a user types in the unrelated event text filter.
  if(state.trendsRendered===data)return;
  state.trendsRendered=data;
  const metricHost=$("pl-trends-metrics"),chart=$("pl-trends-chart");
  const services=$("pl-trends-services"),browsers=$("pl-trends-browsers");
  const table=$("pl-trends-table");
  metricHost.replaceChildren();chart.replaceChildren();services.replaceChildren();browsers.replaceChildren();
  table.replaceChildren();
  if(!data){
    if(!state.trendsBusy)$("pl-trends-status").textContent=
      "Select a time period, then choose Analyze recorded trends. Analysis is manual to control backend reads.";
    return;
  }
  const total=data.eventsSampled||0,summary=data.summary||{};
  const metricRows=[
    ["Observed events",total],
    ["Distinct observed accounts",data.observedAccounts||0],
    ["Recorded failures",summary.failure||0],
    ["Recorded warnings",summary.warning||0],
    ["Backend-recorded events",summary.serverConfirmed||0],
    ["Client-observed events",summary.clientObserved||0],
    ["Backend P50",data.backendDurationP50Ms===null?"Not recorded":data.backendDurationP50Ms+" ms"],
    ["Backend P95",data.backendDurationP95Ms===null?"Not recorded":data.backendDurationP95Ms+" ms"],
    ["Timed backend events",data.backendDurationSample||0]
  ];
  for(const [name,value] of metricRows){
    const card=make("div","pl-trend-metric");
    card.append(make("span","",name),make("strong","",value));
    metricHost.append(card);
  }
  const caveat=data.truncated
    ?"Sample capped at "+data.sampleCap+" newest events. Older buckets can be incomplete or absent; totals are lower bounds."
    :"Sample not capped. Missing telemetry and client reports still prevent exact fleet-wide counts.";
  const from=data.oldestSampleAt?time(data.oldestSampleAt):"None";
  $("pl-trends-status").textContent="Period: past "+data.windowHours+
    " hours · "+total+" recorded events · Oldest sampled: "+from+
    " · Backend duration sample: "+data.backendDurationSample+
    ". Time and module scope only; flag and text filters are excluded. "+caveat;
  const series=Array.isArray(data.series)?data.series:[];
  const maximum=Math.max(1,...series.map(item=>
    (Number(item.normal)||0)+(Number(item.warning)||0)+(Number(item.failure)||0)));
  for(const item of series){
    const bucket=make("div","pl-trend-bucket");
    const cutoff=data.truncated&&Number.isFinite(data.oldestSampleAt)?
      Number(data.oldestSampleAt):0;
    const bucketStart=Number(item.at)||0;
    const bucketEnd=bucketStart+(Number(data.bucketHours)||1)*3600000;
    const coverage=cutoff&&bucketEnd<=cutoff?"unsampled":
      cutoff&&bucketStart<cutoff?"partial":"sampled";
    bucket.dataset.coverage=coverage;
    const counts=[
      ["normal",Math.max(0,Number(item.normal)||0)],
      ["warning",Math.max(0,Number(item.warning)||0)],
      ["failure",Math.max(0,Number(item.failure)||0)]
    ];
    const sum=counts.reduce((acc,[,n])=>acc+n,0);
    bucket.title=time(item.at)+": "+(coverage==="unsampled"?"Not covered by latest sample":
      coverage==="partial"?"Partially covered by latest sample":
      sum+" sampled events")+"; normal "+counts[0][1]+
      ", warning "+counts[1][1]+", failure "+counts[2][1];
    bucket.setAttribute("aria-label",bucket.title);
    const stack=make("div","pl-trend-bar");
    stack.style.height=Math.max(sum?3:0,sum/maximum*108)+"px";
    for(const [level,n] of counts){
      if(!n)continue;
      const portion=make("span","pl-trend-segment");
      portion.dataset.level=level;portion.style.flexGrow=String(n);portion.title=level+": "+n;
      stack.append(portion);
    }
    bucket.append(stack,make("span","pl-trend-time",new Date(item.at).toLocaleString("en-PH",{
      timeZone:"Asia/Manila",month:"short",day:"numeric",hour:"2-digit",hour12:false})));
    chart.append(bucket);
    const tr=make("tr");tr.dataset.coverage=coverage;
    const values=[time(item.at),
      ...counts.map(([,value])=>coverage==="unsampled"?"—":value),
      coverage==="unsampled"?"—":sum,
      coverage==="unsampled"?"Not covered":coverage==="partial"?"Partial sample":"Sampled"];
    for(const value of values)tr.append(make("td","",value));
    table.append(tr);
  }
  const breakdown=(host,items,format)=>{
    if(!items?.length){host.append(make("p","pl-empty","No matching recorded outcomes in this bounded sample."));return;}
    for(const item of items){
      const line=make("div","pl-trend-breakdown");
      line.append(make("strong","",format(item)[0]),make("span","",format(item)[1]));
      host.append(line);
    }
  };
  breakdown(services,data.backendServices,item=>[
    item.service,(item.failure||0)+" failed · "+(item.success||0)+" returned without exception · "+
    (item.affectedAccounts||0)+" accounts"]);
  breakdown(browsers,data.clientErrorBrowsers,item=>[
    item.browser,(item.events||0)+" reported failures · "+(item.affectedAccounts||0)+" accounts"]);
}
async function loadTrends(){
  if(state.view!=="global"||state.trendsBusy)return;
  const reason=requiredReason();if(!reason)return;
  const epoch=state.epoch,token=state.readEpoch;
  state.trendsBusy=true;$("pl-trends-status").textContent="Analyzing bounded recent diagnostic records…";
  refreshEnabled();
  let failureText="";
  try{
    const data=(await getLogs({
      action:"global_trends",reason,windowHours:Number($("pl-window").value),
      module:$("pl-module").value||""
    })).data;
    if(epoch!==state.epoch||token!==state.readEpoch||state.view!=="global")return;
    if(data.scope!=="bounded_global_diagnostic_trends")
      throw Error("Unexpected trend analysis response");
    state.trends=data;
  }catch(error){
    if(epoch===state.epoch&&token===state.readEpoch)
      failureText=permissionError(error);
  }finally{
    if(epoch===state.epoch&&token===state.readEpoch){
      state.trendsBusy=false;renderTrends();
      if(failureText)$("pl-trends-status").textContent=failureText;
      refreshEnabled();
    }
  }
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
      make("strong","",diagnosticActionLabel(item.action||"operational failure")),
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
    $("pl-purpose-status").textContent="Global diagnostic read authorized and audited.";markAudited(reason);
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


// This is bounded near-live polling, not a new event store or a client
// Firestore listener. The callable verifies Platform Admin on every request.
function stopLive(){
  const live=state.live;
  if(live.timer!==null)clearTimeout(live.timer);
  live.timer=null;live.running=false;live.paused=false;live.busy=false;
  live.generation++;
}
function liveStatus(message,{error=false}={}){
  const live=state.live;
  live.status=message;
  $("pl-live-status").textContent=message;
  const lamp=$("pl-live-lamp");
  lamp.dataset.status=error?"error":!live.running?"idle":live.paused||document.hidden||navigator.onLine===false
    ?"paused":"watching";
  lamp.textContent=error?"Connection error":!live.running?"Stopped":live.paused
    ?"Paused":document.hidden?"Background pause":navigator.onLine===false
    ?"Offline":"Watching";
  $("pl-live-toggle").textContent=!live.running?"Start live watch":live.paused?"Resume live":"Pause live";
  $("pl-live-toggle").disabled=!state.eligible;
  $("pl-live-stop").disabled=!live.running;
}
function liveTime(at){
  if(!Number.isFinite(at)||at<=0)return "No timestamp";
  try{return new Intl.DateTimeFormat("en-PH",{timeZone:"Asia/Manila",
    hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false,...($("pl-milliseconds").checked?{fractionalSecondDigits:3}:{})}).format(new Date(at));}
  catch{return "Unknown time";}
}
function liveMatches(row){
  const level=$("pl-level").value,module=$("pl-module").value;
  const search=$("pl-event-search").value.trim().toLowerCase();
  return (!level||severity(row.severity)===level)&&(!module||row.module===module)&&
    (!search||[row.ownerUid,labelFor(row.ownerUid),row.action,row.module,
      row.errorCode,row.service,row.traceId,row.operationId,row.sessionId,
      row.fingerprint,row.route,row.context?.control,row.context?.process,row.context?.reasonCode,row.context?.parentOperationId,...(row.context?.active||[]).flatMap(p=>[p.id,p.name])].some(value=>String(value||"").toLowerCase().includes(search)));
}
function liveLine(row){
  const line=make("div","pl-live-line");
  line.dataset.severity=severity(row.severity);
  line.dataset.key=row.ownerUid+"|"+row.id;
  if((state.live.highlighted.get(line.dataset.key)||0)>Date.now()-7000)
    line.classList.add("pl-live-new");
  const when=make("time","",liveTime(row.at));
  if(Number.isFinite(row.at))when.dateTime=new Date(row.at).toISOString();
  const label=make("span","pl-live-severity",severity(row.severity)==="failure"?"FAIL":
    severity(row.severity)==="warning"?"WARN":severity(row.severity)==="normal"&&row.state==="ok"?"OK":"INFO");
  const actor=make("button","pl-live-actor",labelFor(row.ownerUid));
  actor.type="button";actor.title="Open this account's diagnostic timeline";
  actor.addEventListener("click",()=>chooseAccount(row.ownerUid));
  const content=make("div","pl-live-content");
  const title=make("div","pl-line-title");title.append(make("span","pl-live-action",diagnosticActionLabel(row.action)),inspectButton(row,row.ownerUid));content.append(title);
  const descriptors=[row.module||"other",row.phase||row.state||"observed",
    row.source||"",row.provenance==="server_confirmed"?"server-confirmed":"client-observed",
    row.route||"",row.context?.control||"",row.context?.process||"",row.context?.reasonCode||"",row.service||"",row.errorCode?"error: "+row.errorCode:"",
    Number.isInteger(row.durationMs)?row.durationMs+"ms":Number.isInteger(row.context?.elapsedMs)?row.context.elapsedMs+"ms":"",
    row.context?.active?.length?"active: "+(row.context.active.length+(row.context.overflow||0)):""].filter(Boolean);
  content.append(make("div","pl-live-meta",descriptors.join(" · ")));
  const details=make("details");
  details.append(make("summary","","Diagnostic context"));
  const fields=make("dl");
  const info=[
    ["Account ID",row.ownerUid],["Server timestamp",time(row.at)],
    ["Event ID",row.id],["Session ID",row.sessionId],
    ["Operation ID",row.operationId],["Cloud trace",row.traceId],
    ["Error signature",row.fingerprint],["Module",row.module],
    ["Action",row.action],["Phase",row.phase],["State",row.state],
    ["Service",row.service],["Error code",row.errorCode],
    ["Duration (ms)",row.durationMs],["Source",row.source],["Provenance",row.provenance],
    ["Page",row.route],["Release",row.release],
    ["Device class",row.deviceClass],["Browser",row.browserFamily],
    ["Operating system",row.osFamily],["Viewport",row.viewport],...contextFields(row)
  ];
  for(const [key,value] of info){
    if(value===null||value===undefined||value==="")continue;
    const field=make("div");field.append(make("dt","",key),make("dd","",value));
    fields.append(field);
  }
  details.append(fields);content.append(details);
  line.append(when,label,actor,content);
  return line;
}
function liveStats(){
  const counts={normal:0,warning:0,failure:0,unknown:0};
  for(const row of state.live.rows)counts[severity(row.severity)]++;
  for(const name of flags)$("pl-"+name+"-count").textContent=counts[name];
  $("pl-live-batch").textContent="+"+state.live.lastBatch;
  $("pl-live-batch").dataset.arrived=String(state.live.lastBatch>0);
  $("pl-live-total").textContent=state.live.added;
  $("pl-live-last").textContent=state.live.lastChecked?
    liveTime(state.live.lastChecked)+" PHT":"—";
}
function renderLive({append=[]}={}){
  if(state.view!=="live")return;
  const host=$("pl-live-console"),live=state.live;
  const shouldFollow=$("pl-live-follow").checked;
  // Append new entries without resetting expanded developer details.
  const hasFilters=Boolean($("pl-level").value||$("pl-module").value||
    $("pl-event-search").value.trim());
  if(!append.length){
    host.replaceChildren();
    for(const row of live.rows)if(liveMatches(row))host.append(liveLine(row));
  }else{
    if(host.querySelector(".pl-live-empty"))host.replaceChildren();
    for(const row of append)if(liveMatches(row))host.append(liveLine(row));
    // At most LIVE_MAX_LINES can remain in DOM; the history is not a permanent cache.
    const visibleIds=new Set(live.rows.map(row=>row.ownerUid+"|"+row.id));
    for(const child of [...host.children])if(child.dataset.key&&!visibleIds.has(child.dataset.key))
      child.remove();
    if(hasFilters&&host.querySelector(".pl-live-empty"))host.querySelector(".pl-live-empty").remove();
  }
  if(!host.children.length)host.append(make("p","pl-live-empty",live.running?
    "Waiting for matching recorded events. The watch remains active for all accounts.":
    "No watch running. Enter a reason and start live monitoring."));
  renderFilterSummary(live.rows.filter(liveMatches).length,live.rows.length);
  liveStats();renderInspector();
  if(shouldFollow&&!state.inspected)host.scrollTop=host.scrollHeight;
}
function scheduleLive(delay=LIVE_INTERVAL_MS){
  const live=state.live;
  if(live.timer!==null)clearTimeout(live.timer);
  live.timer=null;
  if(!live.running||live.paused||state.view!=="live")return;
  if(document.hidden){liveStatus("Live polling paused while this tab is in the background.");return;}
  if(navigator.onLine===false){liveStatus("Browser offline. Polling resumes after reconnection.");return;}
  const generation=live.generation;
  live.timer=setTimeout(()=>{
    live.timer=null;
    if(generation===live.generation)void pollLive(generation);
  },delay);
}
async function pollLive(generation){
  const live=state.live;
  if(generation!==live.generation||!live.running||live.paused||live.busy||
    state.view!=="live"||document.hidden||navigator.onLine===false)return;
  live.busy=true;
  let nextDelay=LIVE_INTERVAL_MS;
  try{
    const result=(await getLogs({action:"global_live",reason:live.reason,
      ...(live.cursor?{cursor:live.cursor}:{}),limit:LIVE_LIMIT})).data;
    if(generation!==live.generation||state.view!=="live"||!live.running||live.paused)return;
    if(result.scope!=="live_indexed_account_events")
      throw Error("Unexpected live feed response");
    markAudited(live.reason);
    const first=!live.baseline;
    const additions=[];
    for(const row of Array.isArray(result.events)?result.events:[]){
      if(typeof row.ownerUid!=="string"||typeof row.id!=="string")continue;
      const key=row.ownerUid+"|"+row.id;
      if(live.seen.has(key))continue;
      live.seen.add(key);
      const sanitized={...row,severity:severity(row.severity)};
      live.rows.push(sanitized);additions.push(sanitized);
      if(!first)live.highlighted.set(key,Date.now());
    }
    while(live.rows.length>LIVE_MAX_LINES){
      const removed=live.rows.shift();
      const key=removed.ownerUid+"|"+removed.id;
      live.seen.delete(key);live.highlighted.delete(key);
    }
    for(const [key,at] of live.highlighted)if(Date.now()-at>7000)live.highlighted.delete(key);
    live.cursor=typeof result.cursor==="string"?result.cursor:live.cursor;
    live.baseline=true;
    live.lastBatch=first?0:additions.length;
    if(!first)live.added+=additions.length;
    live.lastChecked=Number(result.serverAt)||Date.now();
    live.errors=0;
    if(additions.length)renderLive({append:additions});
    else liveStats();
    liveStatus(result.hasMore?"Catching up with queued events; more records are available.":
      additions.length&&!first?"+"+additions.length+" new recorded event"+
      (additions.length===1?"":"s")+" since the previous check.":
      first?"Loaded the latest recorded events. Watching for additions every 3 seconds.":
      "No new recorded events on the last check.");
    // Drain batches when the platform is busier than a single three-second page.
    nextDelay=result.hasMore?150:LIVE_INTERVAL_MS;
  }catch(error){
    if(generation!==live.generation||state.view!=="live")return;
    live.errors++;
    const code=String(error?.code||"");
    if(/permission-denied|unauthenticated|failed-precondition/.test(code)){
      stopLive();
      liveStatus(permissionError(error)+" Restart the watch after resolving access or cursor issues.",{error:true});
      return;
    }
    liveStatus("Live check failed: "+permissionError(error)+" Retrying automatically.",{error:true});
    nextDelay=Math.min(30000,LIVE_INTERVAL_MS*Math.pow(2,Math.min(live.errors,3)));
  }finally{
    if(generation===live.generation){
      live.busy=false;
      scheduleLive(nextDelay);
    }
  }
}
function startLive(){
  const reason=requiredReason();if(!reason)return;
  stopLive();
  const live=state.live;
  live.reason=reason;live.cursor="";live.baseline=false;
  closeInspector();live.seen.clear();live.rows=[];live.highlighted.clear();
  live.added=0;live.lastBatch=0;live.lastChecked=0;live.errors=0;
  live.running=true;live.paused=false;
  liveStatus("Connecting to the authorized global diagnostic stream…");
  renderLive();
  scheduleLive(0);
}
function toggleLive(){
  const live=state.live;
  if(!live.running){startLive();return;}
  if(live.paused){
    if(!requiredReason())return;
    live.reason=$("pl-reason").value.trim();
    live.paused=false;live.generation++;
    liveStatus("Resuming from the last recorded event…");scheduleLive(0);
  }else{
    live.paused=true;live.generation++;live.busy=false;
    if(live.timer!==null)clearTimeout(live.timer);
    live.timer=null;liveStatus("Paused by Platform Administrator. Resume to retrieve new events.");
  }
}
function chooseLive(){
  state.selectedUid="";state.view="live";state.fingerprint="";
  resetRead();renderAccounts();renderEvents();
  try{history.replaceState(null,"","platform-logs.html");}catch{}
  liveStatus("Enter a reason, then begin a three-second near-live watch.");
  if($("pl-reason").value.trim().length>=12)startLive();
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
    $("pl-search").disabled=false;$("pl-show-recent").disabled=false;$("pl-show-global").disabled=false;$("pl-show-live").disabled=false;
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
$("pl-clear-filters").addEventListener("click",clearInvestigationFilters);
$("pl-inspector-close").addEventListener("click",()=>closeInspector({restoreFocus:true}));
$("pl-reason").addEventListener("input",()=>{
  $("pl-access-summary").textContent="Reason changed · next read audited";
  if(state.live.running&&!state.live.paused)toggleLive();
});
for(const button of document.querySelectorAll(".pl-quick-filter"))button.addEventListener("click",()=>{
  const select=$("pl-level");select.value=select.value===button.dataset.filter?"":button.dataset.filter;
  select.dispatchEvent(new Event("change"));
});
$("pl-milliseconds").addEventListener("change",()=>{state.inspectorSignature="";state.view==="live"?renderLive():renderEvents();});
function syncDirectory(){
  const open=$("pl-directory-disclosure").open;
  $("pl-toggle-directory").setAttribute("aria-expanded",String(open));
  $("pl-workspace").classList.toggle("pl-directory-collapsed",!open);
}
$("pl-directory-disclosure").addEventListener("toggle",syncDirectory);
$("pl-toggle-directory").addEventListener("click",()=>{if($("pl-workspace").classList.contains("pl-focus-mode")){$("pl-workspace").classList.remove("pl-focus-mode");$("pl-focus-mode").setAttribute("aria-pressed","false");$("pl-directory-disclosure").open=true;}else $("pl-directory-disclosure").open=!$("pl-directory-disclosure").open;syncDirectory();});
$("pl-focus-mode").addEventListener("click",()=>{
  const focused=$("pl-workspace").classList.toggle("pl-focus-mode");
  $("pl-focus-mode").setAttribute("aria-pressed",String(focused));
});


// The account list and advanced filters are persistent on desktop, but
// compact disclosures on narrow screens. Only update on breakpoint changes
// so a manually opened mobile disclosure does not snap shut during use.
const compactViewport=window.matchMedia("(max-width: 780px)");
function syncCompactDisclosures(event=compactViewport){
  $("pl-directory-disclosure").open=!event.matches;
  $("pl-filter-disclosure").open=!event.matches;
}
syncCompactDisclosures();
compactViewport.addEventListener("change",syncCompactDisclosures);

$("pl-search").addEventListener("input",renderAccounts);
$("pl-level").addEventListener("change",()=>{
  state.fingerprint="";
  if(state.view==="global"&&$("pl-reason").value.trim().length>=12){
    resetRead();void loadGlobal();
  }else if(state.view==="live")renderLive();
  else renderEvents();
});
$("pl-module").addEventListener("change",()=>{
  state.fingerprint="";
  if(state.view==="global"&&$("pl-reason").value.trim().length>=12){
    resetRead();void loadGlobal();
  }else if(state.view==="live")renderLive();
  else renderEvents();
});
$("pl-show-recent").addEventListener("click",chooseOverview);
$("pl-show-global").addEventListener("click",chooseGlobal);
$("pl-show-live").addEventListener("click",chooseLive);
$("pl-live-toggle").addEventListener("click",toggleLive);
$("pl-live-stop").addEventListener("click",()=>{
  stopLive();liveStatus("Live watch stopped. Earlier events remain in Global event history.");
});
$("pl-event-search").addEventListener("input",()=>state.view==="live"?renderLive():renderEvents());
$("pl-window").addEventListener("change",()=>{if(state.view==="global"){
  resetRead();renderImpact();if($("pl-reason").value.trim().length>=12)void loadGlobal();
}});
$("pl-trends-refresh").addEventListener("click",()=>void loadTrends());
$("pl-impact-refresh").addEventListener("click",()=>{if(state.view==="global"){
  const reason=requiredReason();if(reason)void loadImpact(reason,state.epoch,state.readEpoch);
}});
$("pl-load-recent").addEventListener("click",chooseGlobal);
$("pl-refresh").addEventListener("click",()=>state.view==="user"?loadAccount():state.view==="recent"?loadRecent():state.view==="live"?(state.live.running&&!state.live.paused?scheduleLive(0):toggleLive()):loadGlobal());
$("pl-more").addEventListener("click",()=>state.view==="user"?loadAccount({older:true}):state.view==="recent"?loadRecent({older:true}):loadGlobal({older:true}));
document.addEventListener("visibilitychange",()=>{
  if(state.view!=="live"||!state.live.running||state.live.paused)return;
  if(document.hidden){
    if(state.live.timer!==null)clearTimeout(state.live.timer);
    state.live.timer=null;
    liveStatus("Live monitoring paused while the tab is hidden.");
  }else{liveStatus("Tab visible. Resuming the live stream.");scheduleLive(0);}
});
window.addEventListener("offline",()=>{
  if(state.view!=="live"||!state.live.running)return;
  if(state.live.timer!==null)clearTimeout(state.live.timer);
  state.live.timer=null;liveStatus("Offline. Listening resumes after reconnection.");
});
window.addEventListener("online",()=>{
  if(state.view==="live"&&state.live.running&&!state.live.paused)
    scheduleLive(0);
});
onAuthStateChanged(auth,user=>{
  state.epoch++;resetRead({clearRecent:true});
  state.live.rows=[];state.live.seen.clear();state.live.highlighted.clear();
  state.live.cursor="";state.live.reason="";state.live.baseline=false;
  state.accounts=[];state.byUid.clear();state.directoryReady=false;state.eligible=false;
  $("pl-search").disabled=true;$("pl-show-recent").disabled=true;$("pl-show-global").disabled=true;$("pl-show-live").disabled=true;$("pl-load-recent").disabled=true;
  $("pl-refresh").disabled=true;$("pl-reason").value="";$("pl-access-summary").textContent="Reason required";$("pl-access-disclosure").open=true;
  $("pl-purpose-status").textContent=user?"Checking Platform Administrator access…":"Sign in with an authorized Platform Administrator account.";
  liveStatus(user?"Monitoring stopped while Platform Administrator access is rechecked.":"Signed out. Live monitoring is stopped.");
  renderAccounts();renderEvents();
  if(user)void loadDirectory(user,state.epoch);
});
