import {app,auth} from "./firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
const functions=getFunctions(app,"asia-southeast1");
const api=httpsCallable(functions,"platformOperations");
const registry=httpsCallable(functions,"platformSchools");
const $=id=>document.getElementById(id);
const state={
  loaded:false,loading:false,schools:[],events:[],counts:null,maintenance:null,
  policy:null,features:[],incidents:[],alerts:[],samples:[],services:[],jobs:[],digests:[],
  costs:null,observations:null,push:null,pushSelfTest:null,observability:null,telemetryLoading:false,
  selectedId:"",selectionToken:0,limit:100,truncated:false,
  stale:true,fleetRows:[],nextFleet:0,fleetBusy:false
};
function el(tag,cls="",value){
  const n=document.createElement(tag);
  if(cls)n.className=cls;
  if(value!==undefined)n.textContent=String(value);
  return n;
}
function set(id,value){const node=$(id);if(node)node.textContent=String(value);}
function pill(title,status){
  const n=el("span","opc-pill",title);
  n.dataset.state=status||"unknown";return n;
}
function when(ms){
  if(!Number.isFinite(ms)||ms<=0)return "Time not recorded";
  try{return new Intl.DateTimeFormat("en-PH",{
    timeZone:"Asia/Manila",dateStyle:"medium",timeStyle:"short"
  }).format(new Date(ms))+" PHT";}
  catch{return "Time not recorded";}
}
function humanize(value){
  const word=String(value||"unknown").replace(/_/g," ");
  return word.charAt(0).toUpperCase()+word.slice(1);
}
function alertText(message){
  const alert=$("opc-alert");alert.hidden=!message;
  alert.textContent=message||"";
}
function errorText(error){
  const code=error?.code||"";
  if(code==="functions/permission-denied")return "Verified System Administrator access is required.";
  if(code==="functions/unauthenticated")return "Your session is no longer verified. Sign in again.";
  if(code==="functions/failed-precondition")return "The record changed or this action is not permitted in its current state. Refresh before retrying.";
  if(code==="functions/unavailable")return "The Operations Center backend is unavailable. Check whether its new Firebase functions are deployed.";
  return "This operation could not finish. Your existing data was not changed by the interface; refresh and retry.";
}
async function act(action,fields={}){
  const invoke=async traceId=>(await api({action,...fields,...(traceId?{_telemetryTraceId:traceId}:{})})).data;
  const track=window.AdminervaTelemetry?.trackOperation;
  return typeof track==="function"
    ?track("operations."+action,traceId=>invoke(traceId),{sampleRate:.20})
    :invoke();
}
async function perform(action,fields,{confirmText="",onSuccess}={}){
  if(confirmText&&!window.confirm(confirmText))return false;
  alertText("");
  set("opc-status","Saving "+humanize(action)+"…");
  try{
    const result=await act(action,fields);
    if(typeof onSuccess==="function")onSuccess(result);
    await refresh();
    set("opc-status",humanize(action)+" saved. Operations Center snapshot refreshed.");
    return true;
  }catch(e){
    alertText(errorText(e));set("opc-status","No confirmation received; review and retry if necessary.");
    return false;
  }
}
function selectTab(key,focus=false){
  const available=["overview","health","observability","incidents","automation","rollouts"];
  if(!available.includes(key))key="overview";
  for(const name of available){
    const tab=$("opc-tab-"+name),panel=$("opc-panel-"+name),current=name===key;
    tab.setAttribute("aria-selected",String(current));
    tab.tabIndex=current?0:-1;
    panel.hidden=!current;
  }
  if(key==="observability"&&!state.observability)void loadObservability();
  if(focus)$("opc-tab-"+key).focus();
}
for(const btn of document.querySelectorAll("[data-opc-tab]")){
  btn.addEventListener("click",()=>{selectTab(btn.dataset.opcTab);history.replaceState(null,"","#"+btn.dataset.opcTab);});
  btn.addEventListener("keydown",event=>{
    if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
    event.preventDefault();
    const tabs=["overview","health","observability","incidents","automation","rollouts"];
    const idx=tabs.indexOf(btn.dataset.opcTab);
    const next=event.key==="Home"?0:event.key==="End"?tabs.length-1:
      (idx+(event.key==="ArrowRight"?1:-1)+tabs.length)%tabs.length;
    selectTab(tabs[next],true);
  });
}
selectTab(location.hash.replace("#",""));

function feature(id){
  return state.features.find(x=>x.id===id)||{mode:id==="digest_schools"?"off":"all",schoolIds:[]};
}
function enabled(id,schoolId){
  const f=feature(id);
  return f.mode==="all"||(f.mode==="pilot"&&f.schoolIds.includes(schoolId));
}
function overviewStats(){
  const counts=state.counts||{};
  set("opc-total",counts.total??"—");
  set("opc-active",counts.active??"—");
  set("opc-preparing",(counts.draft??0)+(counts.pilot??0));
  set("opc-incident-count",state.incidents.filter(x=>x.status!=="resolved").length+
    (state.incidents.length===35?"*":""));
  set("opc-coverage",state.truncated?
    "Showing the first "+state.limit+" schools; registry totals are complete, but school and incident lists may be truncated.":
    "School totals are server-counted. Incident count represents the most recent 35 records if more exist.");
}
function visibleSchools(){
  const q=$("opc-search").value.toLocaleLowerCase().trim(),filter=$("opc-state").value;
  return state.schools.filter(s=>(filter==="all"||s.state===filter)&&
    (!q||s.name.toLocaleLowerCase().includes(q)||s.schoolId.toLocaleLowerCase().includes(q)));
}
function renderSchools(){
  const host=$("opc-school-list");host.replaceChildren();
  const schools=visibleSchools();set("opc-matches",schools.length+" shown");
  if(!schools.length){host.append(el("p","opc-empty","No registered schools match the current filter."));return;}
  for(const school of schools){
    const button=el("button","opc-school");button.type="button";
    button.setAttribute("aria-pressed",String(school.schoolId===state.selectedId));
    const name=el("span");
    name.append(el("span","opc-school-name",school.name),el("span","opc-school-id",school.schoolId));
    button.append(name,pill(humanize(school.state),school.state));
    button.addEventListener("click",()=>{void selectSchool(school.schoolId);});
    host.append(button);
  }
}
function tile(label,value){
  const item=el("div","opc-detail-tile");
  item.append(el("small","",label),el("strong","",value));return item;
}
function detailBlock(school,result){
  const wrap=el("div"),top=el("div","opc-detail-top"),title=el("div");
  title.append(el("p","opc-eyebrow","SELECTED INSTITUTION"),
    el("h3","",school.name),el("p","opc-detail-sub",school.schoolId+
    " · "+humanize(school.provisioningMode)+" · revision "+school.revision));
  top.append(title,pill(humanize(school.state),school.state));wrap.append(top);
  const supportAllowed=enabled("fleet_support",school.schoolId),support=result?.support;
  if(!supportAllowed){
    wrap.append(el("p","opc-detail-note","Support observation is disabled for this school by the platform rollout."));
  }else{
    const grid=el("div","opc-detail-grid");
    grid.append(tile("Support reports",support?.total??"—"),
      tile("Unresolved reports",support?.open??"—"),
      tile("Critical priority",support?.critical??"—"),
      tile("Resolved / closed",support?support.resolved+support.closed:"—"));
    wrap.append(grid);
    wrap.append(el("p","opc-detail-note",
      support?"These counts are support-report metadata, not verified outages.":
        "Support data is unavailable. A missing source does not imply zero reports."));
    if(support&&state.policy&&support.critical>=state.policy.criticalSupportThreshold)
      wrap.append(el("p","opc-alert","Critical support reports meet the configured observation threshold. Review school support before declaring an incident."));
  }
  const integration=el("section","opc-ready");
  integration.append(el("h4","","Integration readiness"));
  const integrationList=el("ul");
  if(result?.ai){
    integrationList.append(el("li","",
      "AI · "+(result.ai.configured?"Configured":result.ai.enabled?"Enabled but incomplete":"Not configured")+
      (result.ai.model?" · "+result.ai.model:"")+
      (result.ai.updatedAt?" · updated "+when(result.ai.updatedAt):"")));
    if(result.ai.lastTest?.checkedAt)integrationList.append(el("li","",
      "AI diagnostic · "+humanize(result.ai.lastTest.state||"unknown")+
      " · "+humanize(result.ai.lastTest.kind||"result")+" · "+when(result.ai.lastTest.checkedAt)+
      (Number.isFinite(result.ai.lastTest.latencyMs)?" · "+result.ai.lastTest.latencyMs+" ms":"")));
  }else integrationList.append(el("li","","AI · readiness unavailable"));
  integrationList.append(el("li","",
    "GitHub evidence · public repository evidence mode · no centrally managed school OAuth credential"));
  integration.append(integrationList);
  if(result?.ai?.configured){
    const testAI=el("button","opc-button opc-button--quiet","Test school AI connection");
    testAI.type="button";
    testAI.addEventListener("click",async()=>{
      if(!window.confirm("Run a fixed diagnostic prompt against this school's configured Gemini account? This uses a small amount of the school's provider quota and never sends student or lesson content."))return;
      testAI.disabled=true;alertText("");
      set("opc-status","Testing "+school.name+"'s configured Gemini connection…");
      try{
        const result=await act("test_school_ai",{schoolId:school.schoolId});
        set("opc-status","School AI diagnostic: "+humanize(result.state)+" · "+result.note);
        await selectSchool(school.schoolId);
      }catch(error){
        alertText(errorText(error));set("opc-status","School AI diagnostic did not complete.");
      }finally{testAI.disabled=false;}
    });
    integration.append(testAI);
  }
  wrap.append(integration);
  const actions=el("div","opc-detail-actions"),link=el("a","","Open school registry");
  link.href="owner-schools.html";actions.append(link);wrap.append(actions);
  return wrap;
}
function readyBlock(result){
  const section=el("section","opc-ready");
  const checks=Array.isArray(result?.checks)?result.checks:[];
  section.append(el("h4","",result?.ready===true?
    "Initial setup checklist complete":"Initial setup requires attention"));
  const list=el("ul");
  for(const check of checks)list.append(el("li","",(check.ok?"✓ ":"○ ")+
    String(check.label||"Setup item")+(check.ok?"":" — "+String(check.detail||"Pending"))));
  if(checks.length)section.append(list);
  else section.append(el("p","opc-helper","No setup checks were provided."));
  return section;
}
async function selectSchool(schoolId){
  const school=state.schools.find(x=>x.schoolId===schoolId);
  if(!school)return;
  const token=++state.selectionToken;state.selectedId=schoolId;renderSchools();
  const host=$("opc-school-detail");host.replaceChildren(detailBlock(school,null),
    el("p","opc-helper","Loading available school observations…"));
  const calls=[
    enabled("fleet_support",schoolId)?act("school",{schoolId}):Promise.resolve(null),
    school.provisioningMode==="standard"&&enabled("school_readiness",schoolId)?
      registry({action:"get_setup_status",schoolId}):Promise.resolve(null)
  ];
  const [support,setup]=await Promise.allSettled(calls);
  if(token!==state.selectionToken)return;
  const row=support.status==="fulfilled"?support.value:null;
  host.replaceChildren(detailBlock(school,row));
  if(setup.status==="fulfilled"&&setup.value?.data)host.append(readyBlock(setup.value.data));
  else if(school.provisioningMode!=="standard")
    host.append(el("p","opc-helper","Legacy/pilot readiness remains in the protected V4 workflow."));
  else if(!enabled("school_readiness",schoolId))
    host.append(el("p","opc-helper","Setup observations are disabled for this school by rollout."));
  else host.append(el("p","opc-helper","Setup readiness is currently unavailable."));
}
async function loadFleet(reset=false){
  if(state.fleetBusy)return;
  if(reset){state.fleetRows=[];state.nextFleet=0;}
  if(state.nextFleet==null)return;
  state.fleetBusy=true;
  const next=state.nextFleet,more=$("opc-fleet-more");
  more.disabled=true;
  const reload=$("opc-fleet-reload");reload.disabled=true;
  set("opc-status","Loading a bounded set of school support totals…");
  try{
    const result=await act("fleet_support",{offset:next});
    state.fleetRows.push(...(result.rows||[]));state.nextFleet=result.nextOffset;
    drawFleet();
    set("opc-status",result.truncated?
      "First 100 school entries reached; further schools require a later paginated registry extension.":
      "Fleet aggregates loaded for "+state.fleetRows.length+" schools.");
  }catch(error){alertText(errorText(error));set("opc-status","Fleet support data could not be loaded.");}
  finally{state.fleetBusy=false;more.disabled=false;reload.disabled=false;}
}
function drawFleet(){
  const host=$("opc-fleet");host.replaceChildren();
  if(!state.fleetRows.length)host.append(el("p","opc-empty","No fleet support records loaded."));
  for(const row of state.fleetRows){
    const line=el("div","opc-list-row"),main=el("div");
    main.append(el("strong","",row.name),el("small","",row.schoolId+" · "+humanize(row.state)));
    let statusText=row.availability==="disabled_by_rollout"?"Disabled":
      row.availability!=="available"?"Unavailable":
      row.support.open+" open · "+row.support.critical+" critical"+
      (state.policy&&row.support.critical>=state.policy.criticalSupportThreshold?
        " · attention threshold reached":"");
    line.append(main,el("span","opc-mini",statusText));host.append(line);
  }
  $("opc-fleet-more").hidden=state.nextFleet==null;
}
function drawEvents(){
  const host=$("opc-events");host.replaceChildren();
  if(!state.events.length){host.append(el("li","opc-empty","No recent registry changes."));return;}
  for(const entry of state.events){
    const school=state.schools.find(x=>x.schoolId===entry.schoolId);
    const item=el("li");item.append(el("strong","",humanize(entry.action)),
      el("small","",(school?.name||entry.schoolId||"Platform")+" · "+when(entry.at)));
    host.append(item);
  }
}
function drawHealth(){
  const host=$("opc-services");host.replaceChildren();
  const latest=state.samples[0];
  set("opc-probe-stamp",latest?(state.stale?"Stale · ":"Checked ")+when(latest.at):"No probes recorded");
  const checked=new Map((latest?.services||[]).map(x=>[x.id,x]));
  for(const service of state.services){
    let result=checked.get(service.id),row=el("div","opc-service"),info=el("div");
    if(service.id==="fcm_delivery"){
      const active=state.push?.active||0,self=state.pushSelfTest;
      result=self?{state:self.received?"healthy":"degraded",note:self.received?
        "Foreground browser receipt confirmed after Firebase accepted the self-test.":
        "Firebase accepted the self-test for "+self.sent+" registered device"+(self.sent===1?"":"s")+"; foreground browser receipt has not been observed."}:
        {state:"not_monitored",note:active?
          active+" enabled device"+(active===1?"":"s")+" registered for this System Admin. Run the self-test to check Firebase acceptance.":
          "No enabled push device is registered for this System Admin account."};
    }
    info.append(el("strong","",service.label),
      el("small","",result?.note||service.source));
    const observations=state.samples.map(sample=>
      sample.services.find(item=>item.id===service.id)).filter(Boolean);
    const checkedSamples=observations.filter(item=>item.state!=="not_monitored");
    if(checkedSamples.length)info.append(el("small","",
      checkedSamples.filter(item=>item.state==="healthy").length+"/"+checkedSamples.length+
      " healthy samples in this view · not an uptime SLA"));
    const status=service.id==="fcm_delivery"
      ?(result?.state||"not_monitored")
      :((!latest||state.stale)?"not_monitored":result?.state||"not_monitored");
    const label=!latest?"No checks":state.stale?"Stale":
      status==="healthy"?"Healthy":status==="degraded"?"Degraded":
      status==="unavailable"?"Unavailable":"Not monitored";
    row.append(info,pill(label,status));host.append(row);
  }
  const maint=$("opc-maintenance");maint.replaceChildren(el("h3","","Legacy monitoring maintenance"));
  const current=state.maintenance;
  if(!current?.configured)maint.append(el("p","","No legacy monitoring policy is configured."));
  else{
    maint.append(el("p","","Cleanup "+(current.cleanupEnabled?"enabled":"disabled")+
      " · Summary refresh "+(current.summaryRefreshEnabled?"enabled":"disabled")));
    maint.append(el("p","","Last recorded status: "+(current.lastState||"No result")+" · "+when(current.finishedAt)));
    if(current.cleanupCapped)maint.append(el("p","","Processing cap reached; backlog may remain."));
  }
  const history=$("opc-history");history.replaceChildren();
  if(!state.samples.length)history.append(el("p","opc-empty","Run a manual check or enable scheduled monitoring to begin the history."));
  for(const sample of state.samples){
    const statuses=sample.services.reduce((out,x)=>{out[x.state]=(out[x.state]||0)+1;return out;},{});
    const line=el("div","opc-list-row"),info=el("div");
    info.append(el("strong","",when(sample.at)),
      el("small","",humanize(sample.kind)+" · "+sample.services.length+" checks"));
    const description=Object.entries(statuses).map(([s,c])=>c+" "+s.replace("_"," ")).join(" · ");
    line.append(info,el("span","opc-mini",description));history.append(line);
  }
}
function transitions(incident){
  if(incident.status==="resolved")return [["reopen","Reopen"]];
  if(incident.status==="open")return [["acknowledge","Acknowledge"],["investigate","Investigate"],["resolve","Resolve"]];
  if(incident.status==="acknowledged")return [["investigate","Investigate"],["resolve","Resolve"]];
  return [["resolve","Resolve"],["acknowledge","Acknowledge"]];
}
function drawIncidents(){
  const host=$("opc-incidents");host.replaceChildren();
  if(!state.incidents.length)host.append(el("p","opc-empty","No incidents recorded. The create form above is available."));
  for(const incident of state.incidents){
    const wrap=el("article","opc-incident"),head=el("div","opc-detail-top"),title=el("div");
    title.append(el("strong","",incident.title),el("small","",
      humanize(incident.severity)+" severity · "+(incident.schoolId||"Platform-wide")+
      " · "+when(incident.updatedAt)));
    head.append(title,pill(humanize(incident.status),incident.status));
    wrap.append(head,el("p","opc-incident-description",incident.description));
    const choices=transitions(incident);
    const form=el("form","opc-inline-form");
    const select=el("select");select.name="transition";select.setAttribute("aria-label","Incident action");
    for(const [value,label]of choices){const option=el("option","",label);option.value=value;select.append(option);}
    const note=el("input");note.name="note";note.type="text";note.minLength=12;note.maxLength=500;
    note.required=true;note.placeholder="Action reason (12+ characters)";note.setAttribute("aria-label","Incident action reason");
    const submit=el("button","opc-button opc-button--quiet","Apply");submit.type="submit";
    form.append(select,note,submit);
    form.addEventListener("submit",async e=>{
      e.preventDefault();if(!form.reportValidity())return;
      submit.disabled=true;
      await perform("change_incident",{
        incidentId:incident.id,revision:incident.revision,transition:select.value,note:note.value
      },{confirmText:"Apply this incident status change? The action will be audited."});
      submit.disabled=false;
    });
    const history=el("details","opc-accordion");
    const summary=el("summary","","Transition history");
    const historyList=el("div","opc-list");
    history.append(summary,historyList);
    history.addEventListener("toggle",async()=>{
      if(!history.open||history.dataset.loaded==="true")return;
      historyList.replaceChildren(el("p","opc-helper","Loading incident history…"));
      try{
        const result=await act("incident_history",{incidentId:incident.id});
        historyList.replaceChildren();
        if(!result.history.length)historyList.append(el("p","opc-helper","No recorded transitions."));
        for(const entry of result.history){
          const row=el("div","opc-list-row"),detail=el("div");
          detail.append(el("strong","",humanize(entry.transition)+" · "+when(entry.at)),
            el("small","",entry.note||"No note"));
          row.append(detail);historyList.append(row);
        }
        history.dataset.loaded="true";
      }catch{historyList.replaceChildren(el("p","opc-helper","Incident history is unavailable. Retry opening this panel."));}
    });
    wrap.append(form,history);host.append(wrap);
  }
}
function drawAlerts(){
  const host=$("opc-alerts");host.replaceChildren();
  if(!state.alerts.length)host.append(el("p","opc-empty","No threshold-triggered alerts are recorded."));
  for(const alert of state.alerts){
    const row=el("article","opc-incident"),head=el("div","opc-detail-top"),info=el("div");
    info.append(el("strong","",humanize(alert.kind)+" · "+humanize(alert.serviceId)),
      el("small","","Observed "+alert.count+" time(s) · "+when(alert.updatedAt)+
        (alert.operation?" · "+humanize(alert.operation):"")));
    head.append(info,pill(humanize(alert.status),alert.status));row.append(head);
    if(alert.message)row.append(el("p","opc-incident-description",alert.message));
    if(alert.status==="active"){
      if(alert.acknowledgedAt)row.append(el("p","opc-helper","Acknowledged "+when(alert.acknowledgedAt)));
      else{
        const button=el("button","opc-button opc-button--quiet","Acknowledge alert");button.type="button";
        button.addEventListener("click",async()=>{
          button.disabled=true;await perform("acknowledge_alert",{alertId:alert.id});button.disabled=false;
        });row.append(button);
      }
    }
    host.append(row);
  }
}
function drawServiceOptions(){
  const serviceSelect=$("opc-incident-service");serviceSelect.replaceChildren();
  const empty=el("option","","General platform");empty.value="";serviceSelect.append(empty);
  for(const service of state.services){
    const item=el("option","",service.label);item.value=service.id;serviceSelect.append(item);
  }
  const schoolSelect=$("opc-incident-school");schoolSelect.replaceChildren();
  const none=el("option","","Platform-wide");none.value="";schoolSelect.append(none);
  for(const school of state.schools){
    const opt=el("option","",school.name);opt.value=school.schoolId;schoolSelect.append(opt);
  }
}
function drawPolicy(){
  const policy=state.policy;
  if(!policy)return;
  const f=$("opc-policy-form");
  for(const name of ["automatedChecks","automaticIncidents","dailyDigest"])
    f.elements.namedItem(name).checked=policy[name]===true;
  for(const name of ["failureThreshold","staleAfterMinutes","cooldownMinutes","criticalSupportThreshold"])
    f.elements.namedItem(name).value=policy[name];
  f.elements.namedItem("monthlyBudgetPHP").value=policy.monthlyBudgetPHP??"";
  f.elements.namedItem("reason").value="";
}
function formatCount(value){
  const n=Number(value)||0;
  return new Intl.NumberFormat("en-PH",{maximumFractionDigits:0}).format(Math.round(n));
}
function formatPercent(value){
  return Number.isFinite(Number(value))?(Number(value)*100).toFixed(Number(value)>=.1?1:2)+"%":"—";
}
function formatLatency(value){
  const n=Number(value)||0;
  return n>=1000?(n/1000).toFixed(n>=10000?0:1)+" s":Math.round(n)+" ms";
}
function drawObservability(){
  const data=state.observability;
  if(!data)return;
  const summary=data.summary||{};
  set("opc-telemetry-requests",formatCount(summary.requests));
  set("opc-telemetry-failures",formatCount(summary.failures));
  set("opc-telemetry-error-rate",formatPercent(summary.errorRate)+" estimated error rate");
  set("opc-telemetry-latency",formatLatency(summary.avgLatencyMs));
  set("opc-telemetry-p95",formatLatency(summary.p95LatencyMs));

  const anomalies=$("opc-anomalies");anomalies.replaceChildren();
  set("opc-anomaly-count",(data.anomalies||[]).length+" detected");
  if(!(data.anomalies||[]).length)anomalies.append(el("p","opc-empty","No recent error-rate or latency spike crossed the current baseline rules."));
  for(const item of data.anomalies||[]){
    const row=el("div","opc-list-row"),desc=el("div");
    desc.append(el("strong","",humanize(item.kind)+" · "+item.service),
      el("small","",item.operation+" · "+item.message));
    row.append(desc,pill(humanize(item.severity),item.severity));anomalies.append(row);
  }

  const services=$("opc-metric-services");services.replaceChildren();
  if(!(data.services||[]).length)services.append(el("p","opc-empty","No sampled service metrics are available yet."));
  for(const item of data.services||[]){
    const row=el("div","opc-list-row"),desc=el("div");
    desc.append(el("strong","",item.service+" · "+humanize(item.operation)),
      el("small","",formatCount(item.requests)+" estimated requests · "+formatCount(item.failures)+
        " failures · "+formatPercent(item.errorRate)+" · avg "+formatLatency(item.avgLatencyMs)+
        " · p95 ≤ "+formatLatency(item.p95LatencyMs)));
    row.append(desc,el("span","opc-mini",when(item.lastSeen)));services.append(row);
  }

  const errors=$("opc-error-groups");errors.replaceChildren();
  if(!(data.errors||[]).length)errors.append(el("p","opc-empty","No grouped operational errors have been recorded."));
  for(const item of data.errors||[]){
    const box=el("details","opc-trace"),head=el("summary");
    head.append(el("strong","",item.service+" · "+humanize(item.operation)),
      pill(formatCount(item.count)+"×",item.count>10?"high":"open"));
    const body=el("div","opc-trace-body");
    body.append(el("p","","Code: "+item.code+" · last seen "+when(item.lastSeen)),
      el("p","","Sample: "+(item.sampleMessage||"No message retained.")),
      el("p","","School contexts: "+item.schoolIds.length+(item.schoolsTruncated?"+":"")+
        " · release "+(item.lastRelease||"unknown")));
    box.append(head,body);errors.append(box);
  }

  const traces=$("opc-traces");traces.replaceChildren();
  if(!(data.traces||[]).length)traces.append(el("p","opc-empty","No recent sampled traces."));
  for(const item of data.traces||[]){
    const box=el("details","opc-trace"),head=el("summary"),title=el("span");
    title.append(el("strong","",item.service+" · "+humanize(item.operation)),
      el("small","",formatLatency(item.durationMs)+" · "+when(item.startedAt)+" · "+(item.release||"unknown")));
    head.append(title,pill(item.status==="error"?"Failed":"Completed",item.status==="error"?"failed":"completed"));
    const body=el("div","opc-trace-body");
    body.append(el("p","opc-trace-id","Trace "+item.traceId));
    if(item.schoolId)body.append(el("p","","School context: "+item.schoolId));
    if(item.errorFingerprint)body.append(el("p","","Error group: "+item.errorFingerprint));
    const spans=el("div","opc-span-list");
    if(!item.spans?.length)spans.append(el("p","opc-helper","No child spans were recorded for this sampled operation."));
    for(const span of item.spans||[]){
      const row=el("div","opc-span");
      row.append(el("span","",span.name),el("span","",formatLatency(span.durationMs)),
        pill(span.status==="error"?"Error":"OK",span.status==="error"?"failed":"healthy"));
      spans.append(row);
    }
    body.append(spans);box.append(head,body);traces.append(box);
  }

  const releases=$("opc-releases");releases.replaceChildren();
  if(!(data.releases||[]).length)releases.append(el("p","opc-empty","No release markers observed in recent traces."));
  for(const item of data.releases||[]){
    const row=el("div","opc-list-row"),desc=el("div");
    desc.append(el("strong","",item.release),
      el("small","",item.samples+" sampled traces · "+item.failures+" failures · "+item.sources.join(", ")+" · last "+when(item.lastSeen)));
    row.append(desc,pill(item.failures?"Review":"Observed",item.failures?"degraded":"healthy"));releases.append(row);
  }

  const timeline=$("opc-metric-timeline");timeline.replaceChildren();
  const points=data.timeline||[];
  if(!points.length)timeline.append(el("p","opc-empty","No recent aggregate metric buckets."));
  const max=Math.max(1,...points.map(point=>Number(point.requests)||0));
  for(const point of points){
    const bar=el("div","opc-bar"),label=el("span","opc-bar-label",new Intl.DateTimeFormat("en-PH",{timeZone:"Asia/Manila",hour:"2-digit",minute:"2-digit"}).format(new Date(point.at)));
    const track=el("div","opc-bar-track"),fill=el("div","opc-bar-fill");
    fill.style.width=Math.max(2,Math.round((Number(point.requests)||0)/max*100))+"%";
    fill.dataset.failures=String((Number(point.failures)||0)>0);
    track.append(fill);
    bar.append(label,track,el("span","opc-bar-value",formatCount(point.requests)+" / "+formatCount(point.failures)));
    timeline.append(bar);
  }
}
async function loadObservability(force=false){
  if(state.telemetryLoading||state.observability&&!force)return;
  state.telemetryLoading=true;alertText("");set("opc-status","Loading sampled Adminerva telemetry…");
  try{
    state.observability=await act("observability");
    drawObservability();
    set("opc-status","Adminerva telemetry loaded. Success traffic is sampled; failures are fully recorded within rate and retention limits.");
  }catch(error){
    alertText(errorText(error));set("opc-status","Observability data could not be loaded.");
  }finally{state.telemetryLoading=false;}
}
function drawJobs(){
  const host=$("opc-jobs");host.replaceChildren();
  if(!state.jobs.length)host.append(el("p","opc-empty","No instrumented platform pulse runs."));
  for(const job of state.jobs){
    const row=el("div","opc-list-row"),desc=el("div");
    const detail=[when(job.startedAt)];
    if(Number.isFinite(job.durationMs))detail.push(formatLatency(job.durationMs));
    if(job.source)detail.push(humanize(job.source));
    if(job.summary)detail.push(Object.entries(job.summary).map(([key,value])=>humanize(key)+" "+value).join(" · "));
    desc.append(el("strong","",humanize(job.kind)),el("small","",detail.join(" · ")));
    row.append(desc,pill(humanize(job.state),job.state));host.append(row);
  }
  const digests=$("opc-digests");digests.replaceChildren();
  if(!state.digests.length)digests.append(el("p","opc-empty","No daily operational digests have been generated."));
  for(const digest of state.digests){
    const row=el("div","opc-list-row"),desc=el("div");
    desc.append(el("strong","",digest.day),el("small","",
      (digest.counts?.registered??"—")+" schools in snapshot · "+
      digest.includedSchools+" selected for digest"));
    row.append(desc,pill(digest.coverageTruncated?"Partial coverage":"Saved",
      digest.coverageTruncated?"degraded":"healthy"));digests.append(row);
  }
  const runtime=$("opc-runtime");runtime.replaceChildren(el("h3","","Scheduler deployment"));
  runtime.append(el("p","","Policy switches describe desired behavior only. The hourly Cloud Scheduler function must be deployed separately to perform automatic checks. No deployed-job heartbeat means deployment cannot be confirmed."));
}
function drawCost(){
  const current=state.costs,policy=state.policy,host=$("opc-cost-summary");
  if(!current)host.textContent="No operator-reported spend for this month. Cloud charges and API quotas are not connected.";
  else{
    const limit=policy?.monthlyBudgetPHP;
    host.textContent="Reported "+current.month+": PHP "+current.reportedPHP.toLocaleString("en-PH")+
      " · source: "+current.sourceReference+
      (limit?" · budget: PHP "+limit.toLocaleString("en-PH")+
        (current.reportedPHP>=limit?" · reported amount meets/exceeds budget":""):" · no budget set");
  }
  const form=$("opc-cost-form");
  form.elements.namedItem("month").value=current?.month||new Date().toISOString().slice(0,7);
  form.elements.namedItem("reportedPHP").value=current?.reportedPHP??"";
  form.elements.namedItem("sourceReference").value=current?.sourceReference||"";
  form.elements.namedItem("reason").value="";
}
function drawRollouts(){
  const host=$("opc-rollouts");host.replaceChildren();
  if(!state.features.length){host.append(el("p","opc-empty","No Operations Center features available."));return;}
  for(const feature of state.features){
    const box=el("article","opc-rollout"),head=el("div");
    head.append(el("h3","",feature.label),el("p","opc-helper",feature.description));
    const form=el("form","opc-form"),two=el("div","opc-two");
    const modeLabel=el("label","", "Rollout");
    const mode=el("select");mode.name="mode";
    for(const [value,label] of [["off","Off"],["pilot","Selected schools"],["all","All schools"]]){
      const opt=el("option","",label);opt.value=value;mode.append(opt);
    }
    mode.value=feature.mode;modeLabel.append(mode);
    const schoolsLabel=el("label","", "Schools (Ctrl / Command to select several)");
    const select=el("select","opc-multi");select.multiple=true;select.name="schoolIds";
    select.size=Math.min(5,Math.max(3,state.schools.length));
    for(const school of state.schools){
      const option=el("option","",school.name);option.value=school.schoolId;
      option.selected=feature.schoolIds.includes(school.schoolId);select.append(option);
    }
    schoolsLabel.append(select);two.append(modeLabel,schoolsLabel);
    const toggle=()=>{schoolsLabel.hidden=mode.value!=="pilot";};
    mode.addEventListener("change",toggle);toggle();
    const reason=el("label","", "Rollout change reason");
    const input=el("input");input.name="reason";input.required=true;input.minLength=12;
    input.maxLength=300;input.placeholder="Reason for enabling or disabling this observation";
    reason.append(input);
    const submit=el("button","opc-button opc-button--quiet","Save rollout");
    submit.type="submit";
    form.append(two,reason,submit);
    form.addEventListener("submit",async e=>{
      e.preventDefault();if(!form.reportValidity())return;
      const ids=[...select.selectedOptions].map(opt=>opt.value);
      if(mode.value==="pilot"&&!ids.length){alertText("Choose at least one school for pilot rollout.");return;}
      submit.disabled=true;
      await perform("save_feature",{featureId:feature.id,revision:feature.revision,
        mode:mode.value,schoolIds:mode.value==="pilot"?ids:[],reason:input.value},{
        confirmText:"Change this Operations Center feature's school scope? This does not change LMS features."
      });
      submit.disabled=false;
    });
    box.append(head,form);host.append(box);
  }
}
async function refresh(){
  if(state.loading)return;
  state.loading=true;$("opc-refresh").disabled=true;
  alertText("");set("opc-status","Loading current platform operations…");
  try{
    await auth.authStateReady();
    if(!auth.currentUser?.emailVerified)throw {code:"functions/unauthenticated"};
    const result=await act("overview");
    if(!Array.isArray(result.schools))throw Error("Malformed platform overview");
    Object.assign(state,{
      loaded:true,schools:result.schools,counts:result.counts,events:result.events||[],
      maintenance:result.maintenance,policy:result.policy,
      features:result.features||[],incidents:result.incidents||[],alerts:result.alerts||[],
      samples:result.samples||[],services:result.services||[],jobs:result.jobs||[],
      digests:result.digests||[],costs:result.costs,observations:result.observations,
      push:result.push||null,
      truncated:result.truncated,limit:result.limit,stale:result.latestSampleStale
    });
    overviewStats();renderSchools();drawEvents();drawHealth();drawIncidents();drawAlerts();
    drawServiceOptions();drawPolicy();drawJobs();drawCost();drawRollouts();
    set("opc-updated","Snapshot "+when(result.generatedAt));
    set("opc-status","Platform observations loaded. Monitoring indicators include provenance and stale-state context.");
    const selected=state.schools.find(s=>s.schoolId===state.selectedId)?.schoolId||
      state.schools[0]?.schoolId||"";
    if(selected)void selectSchool(selected);
    else{++state.selectionToken;$("opc-school-detail").replaceChildren(
      el("p","opc-empty","No registered schools."));}
  }catch(error){
    alertText(errorText(error));
    set("opc-status","Operational information is temporarily unavailable.");
  }finally{state.loading=false;$("opc-refresh").disabled=false;}
}
$("opc-refresh").addEventListener("click",()=>void refresh());
$("opc-telemetry-refresh").addEventListener("click",()=>void loadObservability(true));
$("opc-telemetry-cleanup").addEventListener("click",async e=>{
  if(!window.confirm("Delete only telemetry traces older than 7 days, metric buckets older than 90 days, and expired browser rate-limit records? Error groups and operational incidents are retained."))return;
  const button=e.currentTarget;button.disabled=true;alertText("");
  try{
    const result=await act("cleanup_telemetry");
    state.observability=null;
    await loadObservability(true);
    set("opc-status","Telemetry retention cleanup removed "+(result.cleanup?.deleted||0)+" expired records in this bounded pass.");
  }catch(error){alertText(errorText(error));set("opc-status","Telemetry retention cleanup did not complete.");}
  finally{button.disabled=false;}
});
$("opc-search").addEventListener("input",renderSchools);
$("opc-state").addEventListener("change",renderSchools);
$("opc-fleet-reload").addEventListener("click",()=>void loadFleet(true));
$("opc-fleet-more").addEventListener("click",()=>void loadFleet());
$("opc-push-test").addEventListener("click",async e=>{
  const button=e.currentTarget;button.disabled=true;alertText("");
  set("opc-status","Connecting this browser and sending a push self-test…");
  try{
    const module=await import("./push-notifications.mjs?v=1.3.7");
    const synced=await module.syncDevicePush();
    if(!synced?.enabled)throw Error(synced?.reason||"This device is not ready for push notifications.");
    const response=await module.sendTestPush();
    const sent=Number(response.sent)||0;
    state.pushSelfTest={sent,at:Date.now(),received:false};
    drawHealth();
    set("opc-status","Firebase accepted the test for "+sent+" registered device"+(sent===1?"":"s")+". Keep this page in the foreground to confirm browser receipt.");
  }catch(error){
    alertText(errorText(error));
    set("opc-status","Push self-test could not complete on this browser. Enable or reconnect device notifications, then retry.");
  }finally{button.disabled=false;}
});
document.addEventListener("adminerva-push-message",event=>{
  if(event.detail?.data?.adminervaKind!=="test_ping")return;
  state.pushSelfTest={...(state.pushSelfTest||{}),sent:state.pushSelfTest?.sent||1,
    received:true,receivedAt:Date.now()};
  drawHealth();
  set("opc-status","Push self-test confirmed end-to-end on this foreground browser.");
});
$("opc-probe").addEventListener("click",async e=>{
  e.currentTarget.disabled=true;
  try{await perform("run_probes",{},{
    confirmText:"Run limited internal and public-provider checks now? This stores one operational sample."
  });}finally{e.currentTarget.disabled=false;}
});
$("opc-incident-form").addEventListener("submit",async e=>{
  e.preventDefault();const f=e.currentTarget;if(!f.reportValidity())return;
  const d=new FormData(f);
  const result=await perform("create_incident",{
    title:String(d.get("title")),description:String(d.get("description")),
    severity:String(d.get("severity")),serviceId:String(d.get("serviceId")||""),
    schoolId:String(d.get("schoolId")||"")
  },{confirmText:"Record this internal incident for System Admin review?"});
  if(result){f.reset();$("opc-incident-create").open=false;}
});
$("opc-policy-form").addEventListener("submit",async e=>{
  e.preventDefault();const f=e.currentTarget;if(!f.reportValidity()||!state.policy)return;
  const d=new FormData(f);
  const policy={
    automatedChecks:d.get("automatedChecks")==="on",
    automaticIncidents:d.get("automaticIncidents")==="on",
    dailyDigest:d.get("dailyDigest")==="on",
    failureThreshold:Number(d.get("failureThreshold")),
    staleAfterMinutes:Number(d.get("staleAfterMinutes")),
    cooldownMinutes:Number(d.get("cooldownMinutes")),
    criticalSupportThreshold:Number(d.get("criticalSupportThreshold")),
    monthlyBudgetPHP:d.get("monthlyBudgetPHP")?Number(d.get("monthlyBudgetPHP")):null
  };
  await perform("save_policy",{revision:state.policy.revision,policy,
    reason:String(d.get("reason")||"")},{
      confirmText:"Save this monitored policy? Scheduled execution requires a separately deployed Cloud Function. Enabling can incur cloud charges."
    });
});
$("opc-cost-form").addEventListener("submit",async e=>{
  e.preventDefault();const f=e.currentTarget;if(!f.reportValidity())return;
  const d=new FormData(f),month=String(d.get("month")||"");
  const revision=state.costs?.month===month?(state.costs.revision||0):0;
  await perform("record_cost",{month,reportedPHP:Number(d.get("reportedPHP")),
    sourceReference:String(d.get("sourceReference")),reason:String(d.get("reason")),revision},{
      confirmText:"Record this as a manually reported figure? This is not a verified Cloud Billing charge."
    });
});
void refresh();
