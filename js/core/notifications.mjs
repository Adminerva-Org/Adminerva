import { auth, db } from "./firebase-core.js";
import {notificationTarget,previewDestination} from "./notification-routing.mjs";
import {historyDocId,historyRecord,mergeNotificationHistory,NOTIFICATION_HISTORY_LIMIT} from "./notification-history.mjs";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { collection, query, where, orderBy, limit, onSnapshot, doc, updateDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const staffEmails = new Set(["babaynike2013@gmail.com", "josephsixson@mcstayuman.edu.ph"]);
const state = { user:null, notifications:[], issues:[], submissions:[], gradingAlerts:[], history:[], unsubscribe:[], read:new Set(), filter:"all", search:"", muted:new Set(), errors:new Set(), open:false };
const isAdmin = () => (state.user?.email||"").toLowerCase() === [...staffEmails][0];
const isTeacher = () => staffEmails.has((state.user?.email||"").toLowerCase()) && !isAdmin();
// Resolve older issue notifications against only those reports this account
// is authorized to read. Unresolvable legacy alerts stay hidden.
const visibleForRole = item => {
  if (item.type !== "issue" || isAdmin()) return true;
  const match = String(item.target||"").match(/^issues[.]html[?]issue=([^&#]+)/);
  const id = item.sourceId || (match ? match[1] : "");
  const issue = state.issues.find(x=>x.id===id);
  const category = item.reportCategory || issue?.category;
  const audience = item.reportAudience || issue?.audience || "admin";
  return Boolean(category && category !== "Bug" &&
    (!isTeacher() || audience === "teacher"));
};
const el = id => document.getElementById(id);
const make = (tag, className, text) => {
  const node=document.createElement(tag);
  if(className)node.className=className;
  if(text!==undefined)node.textContent=String(text);
  return node;
};
const timeOf = value => value && typeof value.toDate==="function" ? value.toDate().getTime() : (value?.seconds||0)*1000;
const keyName = () => "Adminerva_notif_seen_"+(state.user?.uid||"anonymous");
const settingsKey = () => "Adminerva_notif_preferences_"+(state.user?.uid||"anonymous");
const historyKey=()=> "Adminerva_notif_history_"+(state.user?.uid||"anonymous");
function localHistory(){try{const data=JSON.parse(localStorage.getItem(historyKey())||"[]");return Array.isArray(data)?data:[]}catch{return []}}
function rememberLocal(record){try{const items=localHistory().filter(x=>x.sourceKey!==record.sourceKey);items.unshift(record);localStorage.setItem(historyKey(),JSON.stringify(items.slice(0,NOTIFICATION_HISTORY_LIMIT)));}catch{}}
function restorePreferences(){try{return new Set(JSON.parse(localStorage.getItem(settingsKey())||"[]"))}catch{return new Set()}}
function storePreferences(){try{localStorage.setItem(settingsKey(),JSON.stringify([...state.muted]))}catch{}}
const targetUrl = notificationTarget;
function restoreRead(){try{return new Set(JSON.parse(localStorage.getItem(keyName())||"[]"))}catch{return new Set()}}
function storeRead(){try{localStorage.setItem(keyName(),JSON.stringify([...state.read].slice(-400)))}catch{}}
function unread(item){return !item.history && !item.readAt && !state.read.has(item.key)}
function collectionItems(){
  const rows=[],stored=new Set();
  for(const n of state.notifications){
    if(!n.title || !visibleForRole(n))continue;
    if(n.sourceId)stored.add(n.sourceId);
    rows.push({...n,key:"saved:"+n.id,at:timeOf(n.createdAt),target:targetUrl(n.target),saved:true});
  }
  for(const issue of state.issues){
    if(stored.has(issue.id) || (!isAdmin() && issue.category === "Bug"))continue;
    rows.push({key:"issue:"+issue.id,type:"issue",title:"Report: "+(issue.title||"Untitled"),
      body:(issue.status||"Open")+" · "+(issue.category||"Bug"),
      at:timeOf(issue.createdAt),target:"issues.html?issue="+encodeURIComponent(issue.id),saved:false,
      reportCategory:issue.category||"Bug",reportAudience:issue.audience||"admin"});
  }
  for(const alert of state.gradingAlerts){
    if(stored.has(alert.id))continue;
    rows.push({key:"grading:"+alert.id,type:"grading",title:"A grading check needs attention",
      body:(alert.repository||"Repository")+" · "+(alert.message||"Check failed"),
      at:timeOf(alert.createdAt),target:previewDestination("grading"),saved:false});
  }
  for(const sub of state.submissions){
    if(stored.has(sub.id))continue;
    rows.push({key:"submission:"+sub.id,type:"submission",title:"Work submitted for review",
      body:(sub.studentName||"Student")+" · "+(sub.assessmentTitle||"Assessment"),
      at:timeOf(sub.submittedAt),target:previewDestination("submission"),saved:false});
  }
  return mergeNotificationHistory(rows,state.history,state.read).filter(visibleForRole);
}
function render(){
  const list=el("av-alert-list"),badge=el("av-alert-count");if(!list||!badge)return;
  const items=collectionItems(),count=items.filter(item=>!state.muted.has(item.type)&&unread(item)).length;
  const degraded=state.errors.size>0;
  badge.textContent=count>99?"99+":(count>0?String(count):"!");
  badge.classList.toggle("hidden",count===0&&!degraded);
  badge.classList.toggle("bg-amber-600",degraded&&count===0);
  badge.classList.toggle("bg-blue-600",!(degraded&&count===0));
  el("av-alert-toggle").setAttribute("aria-label",
    count+" unread notifications"+(degraded?", some alerts are unavailable":""));
  list.replaceChildren();
  if(state.errors.size){
    list.append(make("p","p-3 text-xs font-semibold bg-amber-50 border-b border-amber-200 text-amber-900",
      "Some notification sources are unavailable. Reports or submissions may not appear until the Firebase connection is restored."));
  }
  const search=state.search.toLowerCase();
  const visible=items.filter(n=>!state.muted.has(n.type) &&
    (state.filter==="all"||state.filter==="unread"&&unread(n)||state.filter==="issues"&&n.type==="issue"||state.filter==="saved"&&n.pinned) &&
    (!search||(n.title+" "+(n.body||"")).toLowerCase().includes(search)));
  if(!visible.length){list.append(make("p","p-5 text-sm text-slate-600","No notifications to display."));return}
  for(const n of visible){
    const link=make("a","block p-3 sm:p-4 border-b border-slate-100 hover:bg-slate-50");
    link.href=targetUrl(n.target);
    const heading=make("div","flex gap-3 justify-between items-center");
    heading.append(make("strong","text-sm text-slate-900 break-words",n.title));
    if(unread(n))heading.append(make("span","text-xs text-blue-700 shrink-0","● New"));
    link.append(heading,make("p","text-xs text-slate-600 break-words mt-1",n.body||""));
    if(n.at)link.append(make("p","text-[11px] text-slate-500 mt-1",new Date(n.at).toLocaleString()));
    link.addEventListener("click",async event=>{
      event.preventDefault();
      // Read status persists locally immediately. Don't let a slow Firestore
      // read update prevent navigation to the linked item.
      void markRead(n);
      await Promise.race([remember(n,Boolean(n.pinned)),new Promise(resolve=>setTimeout(resolve,1300))]);
      window.location.assign(targetUrl(n.target));
    });
    const save=make("button","text-xs font-semibold underline text-indigo-700 px-3 py-2",
      n.pinned?"Remove reminder":"Save for later");
    save.type="button";
    save.addEventListener("click",event=>{
      event.preventDefault();event.stopPropagation();
      void remember(n,!n.pinned);
    });
    const wrapper=make("div","border-b border-slate-100");
    link.classList.remove("border-b","border-slate-100");
    wrapper.append(link,save);list.append(wrapper);
  }
}
async function remember(item,pinned){
  if(!state.user)return;
  const record=historyRecord(item,state.user.uid,pinned);
  const withTime={...record,openedAt:Date.now(),lastInteractedAt:Date.now()};
  rememberLocal(withTime);
  state.history=mergeCachedHistory(state.history,withTime);
  render();
  try{
    await setDoc(doc(db,"notification_history",state.user.uid,"items",historyDocId(item.key)),{
      ...record,openedAt:serverTimestamp(),lastInteractedAt:serverTimestamp()
    },{merge:true});
  }catch(error){console.warn("Notification history is saved on this device; cloud sync failed:",error);}
}
function mergeCachedHistory(items,record){
  return [record,...items.filter(x=>x.sourceKey!==record.sourceKey)]
    .slice(0,NOTIFICATION_HISTORY_LIMIT);
}
async function markRead(item){
  if(!unread(item))return;
  state.read.add(item.key);storeRead();render();
  if(item.saved&&state.user)try{
    await updateDoc(doc(db,"notifications",state.user.uid,"items",item.id),{readAt:serverTimestamp()});
  }catch(err){console.warn("Read state could not sync",err)}
}
async function markAllRead(){
  const pending=collectionItems().filter(unread);
  for(const item of pending)state.read.add(item.key);
  storeRead();render();
  await Promise.allSettled(pending.filter(n=>n.saved).map(n=>
    updateDoc(doc(db,"notifications",state.user.uid,"items",n.id),{readAt:serverTimestamp()})));
}
function listen(user){
  state.unsubscribe.forEach(stop=>stop());state.unsubscribe=[];
  state.user=user;state.notifications=[];state.issues=[];state.submissions=[];state.gradingAlerts=[];state.history=user?localHistory():[];
  state.errors.clear();
  state.read=restoreRead();state.muted=restorePreferences();
  document.querySelectorAll("#av-alert-panel input[data-alert-category]").forEach(input=>{
    input.checked=!state.muted.has(input.dataset.alertCategory);
  });
  render();
  if(!user)return;
  state.unsubscribe.push(onSnapshot(query(
    collection(db,"notification_history",user.uid,"items"),
    orderBy("lastInteractedAt","desc"),limit(NOTIFICATION_HISTORY_LIMIT)),
    snap=>{
      const records=snap.docs.map(d=>d.data());
      const merged=new Map(state.history.map(item=>[item.sourceKey,item]));
      for(const item of records)merged.set(item.sourceKey,item);
      state.history=[...merged.values()].slice(0,NOTIFICATION_HISTORY_LIMIT);
      state.errors.delete("History");render();
    },err=>{console.warn("Notification history unavailable:",err);state.errors.add("History");render();}));
  const error=name=>err=>{
    console.warn(name+" listener unavailable:",err.message);
    state.errors.add(name);render();
  };
  const success=name=>{state.errors.delete(name);render()};
  state.unsubscribe.push(onSnapshot(
    query(collection(db,"notifications",user.uid,"items"),orderBy("createdAt","desc"),limit(60)),
    snap=>{state.notifications=snap.docs.map(d=>({id:d.id,...d.data()}));success("Notifications")},error("Notifications")));
  const staff=staffEmails.has((user.email||"").toLowerCase());
  if(isAdmin() || isTeacher()){
    const request = isAdmin()
      ? query(collection(db,"issues"),orderBy("createdAt","desc"),limit(40))
      : query(collection(db,"issues"),where("audience","==","teacher"),limit(40));
    state.unsubscribe.push(onSnapshot(
      request,
      snap=>{state.issues=snap.docs.map(d=>({id:d.id,...d.data()}));success("Issue reports")},
      error("Issue reports")));
  }else{
    // New tickets use Firebase UID, legacy tickets may still have reporterEmail.
    // Keep both until old public report documents have been migrated.
    const issueSets={current:[],legacy:[]};
    const combineIssues=()=>{
      const merged=new Map();
      for(const item of [...issueSets.current,...issueSets.legacy])merged.set(item.id,item);
      state.issues=[...merged.values()].sort((a,b)=>timeOf(b.createdAt)-timeOf(a.createdAt)).slice(0,50);
      render();
    };
    for(const [kind,request] of [
      ["current",query(collection(db,"issues"),where("reporterUid","==",user.uid))],
      ["legacy",query(collection(db,"issues"),where("reporterEmail","==",(user.email||"").toLowerCase()))]
    ]){
      state.unsubscribe.push(onSnapshot(request,snap=>{
        issueSets[kind]=snap.docs.map(d=>({id:d.id,...d.data()}));
        state.errors.delete("Reporter issues");combineIssues();
      },error("Reporter issues")));
    }
  }
  if(staff)state.unsubscribe.push(onSnapshot(
    query(collection(db,"grading_alerts"),orderBy("createdAt","desc"),limit(30)),
    snap=>{state.gradingAlerts=snap.docs.map(d=>({id:d.id,...d.data()}));success("Grading alerts")},
    error("Grading alerts")));
  if(staff)state.unsubscribe.push(onSnapshot(
    query(collection(db,"student_submissions"),orderBy("submittedAt","desc"),limit(40)),
    snap=>{state.submissions=snap.docs.map(d=>({id:d.id,...d.data()}));success("Student submissions")},
    error("Student submissions")));
}
export function mountNotificationCenter(){
  const root=el("adminerva-notifications");if(!root||root.dataset.ready)return;
  root.dataset.ready="true";root.className="relative mr-2";
  const button=make("button","relative min-h-11 min-w-11 rounded-lg border border-slate-600 text-white hover:bg-slate-700","🔔");
  button.type="button";button.id="av-alert-toggle";button.setAttribute("aria-expanded","false");
  button.setAttribute("aria-label","Notifications");
  const badge=make("span","hidden absolute -right-1 -top-1 bg-blue-600 text-white text-[10px] rounded-full min-w-5 h-5 flex items-center justify-center","0");
  badge.id="av-alert-count";button.append(badge);root.append(button);
  const panel=make("section","hidden fixed right-2 sm:absolute sm:right-0 top-16 sm:top-12 w-[calc(100vw-16px)] sm:w-[390px] max-w-[95vw] rounded-xl bg-white border border-slate-200 shadow-2xl z-[130] overflow-hidden");
  panel.id="av-alert-panel";panel.setAttribute("aria-label","Notification center");
  const header=make("div","flex justify-between gap-2 items-center px-4 py-3 border-b");
  header.append(make("h2","font-bold text-base text-slate-900","Notifications"));
  const all=make("button","text-xs text-blue-700 font-bold underline","Mark all read");
  all.type="button";all.addEventListener("click",()=>{void markAllRead()});header.append(all);panel.append(header);
  const tabs=make("div","flex border-b");
  for(const [filter,label] of [["all","All"],["unread","Unread"],["saved","Saved"],["issues","Reports"]]){
    const tab=make("button","flex-1 py-3 text-xs text-slate-700 hover:bg-slate-50 font-semibold",label);
    tab.type="button";tab.addEventListener("click",()=>{state.filter=filter;render()});tabs.append(tab);
  }
  panel.append(tabs);
  const search=make("input","w-full border-0 border-b border-slate-200 bg-white px-4 py-3 text-sm text-slate-900");
  search.type="search";search.placeholder="Search notifications";
  search.setAttribute("aria-label","Search notifications");
  search.addEventListener("input",()=>{state.search=search.value.trim();render()});
  panel.append(search);
  const prefs=make("details","border-b px-4 py-2");
  prefs.append(make("summary","cursor-pointer text-xs font-bold text-slate-600","Notification preferences"));
  const controls=make("div","grid grid-cols-2 gap-2 py-3");
  for(const [type,label] of [["issue","Reports"],["grade","Grades"],["assessment","Assignments"],
    ["submission","Submissions"],["grading","Grading alerts"]]){
    const option=make("label","flex items-center gap-2 text-xs text-slate-700");
    const check=make("input","h-4 w-4");check.type="checkbox";
    check.dataset.alertCategory=type;check.checked=!state.muted.has(type);
    check.addEventListener("change",()=>{
      if(check.checked)state.muted.delete(type);else state.muted.add(type);
      storePreferences();render();
    });
    option.append(check,make("span","",label));controls.append(option);
  }
  prefs.append(controls);
  panel.append(prefs);
  const list=make("div","overflow-y-auto overscroll-contain max-h-[min(48dvh,335px)]");
  list.id="av-alert-list";list.setAttribute("aria-live","polite");panel.append(list);root.append(panel);
  button.addEventListener("click",()=>{state.open=!state.open;panel.classList.toggle("hidden",!state.open);
    button.setAttribute("aria-expanded",String(state.open))});
  document.addEventListener("click",e=>{if(state.open&&!root.contains(e.target)){
    state.open=false;panel.classList.add("hidden");button.setAttribute("aria-expanded","false")}});
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&state.open){
    state.open=false;panel.classList.add("hidden");button.focus()}});
  onAuthStateChanged(auth,listen);
}
