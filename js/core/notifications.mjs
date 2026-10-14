import { auth, db } from "./firebase-core.js";
import {notificationTarget,previewDestination} from "./notification-routing.mjs";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { collection, query, where, orderBy, limit, onSnapshot, doc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const staffEmails = new Set(["babaynike2013@gmail.com", "josephsixson@mcstayuman.edu.ph"]);
const state = { user:null, notifications:[], issues:[], submissions:[], gradingAlerts:[], unsubscribe:[], read:new Set(), filter:"all", search:"", muted:new Set(), open:false };
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
function restorePreferences(){try{return new Set(JSON.parse(localStorage.getItem(settingsKey())||"[]"))}catch{return new Set()}}
function storePreferences(){try{localStorage.setItem(settingsKey(),JSON.stringify([...state.muted]))}catch{}}
const targetUrl = notificationTarget;
function restoreRead(){try{return new Set(JSON.parse(localStorage.getItem(keyName())||"[]"))}catch{return new Set()}}
function storeRead(){try{localStorage.setItem(keyName(),JSON.stringify([...state.read].slice(-400)))}catch{}}
function unread(item){return !item.readAt && !state.read.has(item.key)}
function collectionItems(){
  const rows=[],stored=new Set();
  for(const n of state.notifications){
    if(!n.title)continue;
    if(n.sourceId)stored.add(n.sourceId);
    rows.push({...n,key:"saved:"+n.id,at:timeOf(n.createdAt),target:targetUrl(n.target),saved:true});
  }
  for(const issue of state.issues){
    if(stored.has(issue.id))continue;
    rows.push({key:"issue:"+issue.id,type:"issue",title:"Report: "+(issue.title||"Untitled"),
      body:(issue.status||"Open")+" · "+(issue.category||"Bug"),
      at:timeOf(issue.createdAt),target:"issues.html?issue="+encodeURIComponent(issue.id),saved:false});
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
  return rows.sort((a,b)=>b.at-a.at).slice(0,100);
}
function render(){
  const list=el("av-alert-list"),badge=el("av-alert-count");if(!list||!badge)return;
  const items=collectionItems(),count=items.filter(item=>!state.muted.has(item.type)&&unread(item)).length;
  badge.textContent=count>99?"99+":String(count);
  badge.classList.toggle("hidden",count===0);
  el("av-alert-toggle").setAttribute("aria-label",count+" unread notifications");
  list.replaceChildren();
  const search=state.search.toLowerCase();
  const visible=items.filter(n=>!state.muted.has(n.type) &&
    (state.filter==="all"||state.filter==="unread"&&unread(n)||state.filter==="issues"&&n.type==="issue") &&
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
    link.addEventListener("click",()=>{void markRead(n)});
    list.append(link);
  }
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
  state.user=user;state.notifications=[];state.issues=[];state.submissions=[];state.gradingAlerts=[];
  state.read=restoreRead();state.muted=restorePreferences();
  document.querySelectorAll("#av-alert-panel input[data-alert-category]").forEach(input=>{
    input.checked=!state.muted.has(input.dataset.alertCategory);
  });
  render();
  if(!user)return;
  const error=name=>err=>console.warn(name+" listener unavailable:",err.message);
  state.unsubscribe.push(onSnapshot(
    query(collection(db,"notifications",user.uid,"items"),orderBy("createdAt","desc"),limit(60)),
    snap=>{state.notifications=snap.docs.map(d=>({id:d.id,...d.data()}));render()},error("Notifications")));
  const staff=staffEmails.has((user.email||"").toLowerCase());
  const iq=staff?query(collection(db,"issues"),orderBy("createdAt","desc"),limit(40)):
    query(collection(db,"issues"),where("reporterEmail","==",(user.email||"").toLowerCase()));
  state.unsubscribe.push(onSnapshot(iq,snap=>{
    state.issues=snap.docs.map(d=>({id:d.id,...d.data()}));render();
  },error("Issue reports")));
  if(staff)state.unsubscribe.push(onSnapshot(
    query(collection(db,"grading_alerts"),orderBy("createdAt","desc"),limit(30)),
    snap=>{state.gradingAlerts=snap.docs.map(d=>({id:d.id,...d.data()}));render()},
    error("Grading alerts")));
  if(staff)state.unsubscribe.push(onSnapshot(
    query(collection(db,"student_submissions"),orderBy("submittedAt","desc"),limit(40)),
    snap=>{state.submissions=snap.docs.map(d=>({id:d.id,...d.data()}));render()},
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
  for(const [filter,label] of [["all","All"],["unread","Unread"],["issues","Reports"]]){
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
