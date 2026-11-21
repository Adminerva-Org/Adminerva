import {app,auth} from "./firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";

const el=id=>document.getElementById(id);
const api=httpsCallable(getFunctions(app,"asia-southeast1"),"platformUsers");
const list=el("pu-list"),status=el("pu-status"),dialog=el("pu-detail");
let items=[],currentToken=null,nextToken=null,history=[],busy=false,listRun=0,detailRun=0;

function node(tag,className="",text=""){
  const out=document.createElement(tag);if(className)out.className=className;if(text!==undefined)out.textContent=text;return out;
}
function setBusy(value,message=""){
  busy=value;
  el("pu-refresh").disabled=value;
  el("pu-find-exact").disabled=value;
  el("pu-prev").disabled=value||history.length===0;
  el("pu-next").disabled=value||!nextToken;
  if(message)status.textContent=message;
}
function accountState(item){
  if(item.disabled)return "Disabled";
  return item.emailVerified?"Enabled · verified":"Enabled · email unverified";
}
function when(value){
  if(!value)return "Never / unavailable";
  const date=new Date(value);return Number.isNaN(date.getTime())?String(value):date.toLocaleString();
}
function visible(item){
  const query=el("pu-search").value.trim().toLocaleLowerCase("en");
  const account=el("pu-account-filter").value,role=el("pu-role-filter").value;
  if(query&&![item.displayName,item.email,item.uid].some(value=>String(value||"").toLocaleLowerCase("en").includes(query)))return false;
  if(account==="enabled"&&item.disabled)return false;
  if(account==="disabled"&&!item.disabled)return false;
  if(account==="verified"&&!item.emailVerified)return false;
  if(account==="unverified"&&item.emailVerified)return false;
  if(role==="platform_admin"&&!item.platformAdmin)return false;
  if(role==="standard"&&item.platformAdmin)return false;
  return true;
}
function render(){
  list.replaceChildren();
  const rows=items.filter(visible);
  el("pu-count").textContent=rows.length+" shown · "+items.length+" loaded";
  if(!rows.length){
    list.append(node("p","text-sm text-slate-600 py-8 text-center",items.length?"No accounts match the loaded-page filters.":"No accounts were returned for this page."));
  }else for(const item of rows){
    const row=node("article","py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3");
    const info=node("div","min-w-0"),title=node("strong","block break-words",item.displayName||item.email||"Unnamed account");
    const meta=node("p","text-xs text-slate-600 mt-1 break-words",
      [item.email||"No email",accountState(item),item.platformAdmin?"Platform Admin":"Standard user"].join(" · "));
    const uid=node("p","text-[11px] text-slate-400 mt-1 break-all","Account ID: "+item.uid);
    info.append(title,meta,uid);
    const actions=node("div","flex items-center gap-2 shrink-0");
    if(item.platformAdmin)actions.append(node("span","pu-chip border-blue-200 bg-blue-50 text-blue-800","Platform Admin"));
    const open=node("button","pu-btn primary","View memberships");open.type="button";
    open.addEventListener("click",()=>void openDetail(item));actions.append(open);
    row.append(info,actions);list.append(row);
  }
  el("pu-prev").disabled=busy||history.length===0;el("pu-next").disabled=busy||!nextToken;
}
async function loadPage(token=currentToken){
  const run=++listRun;setBusy(true,"Loading platform accounts…");
  try{
    const result=(await api({action:"list",pageSize:25,...(token?{pageToken:token}:{})})).data;
    if(run!==listRun)return;
    items=result.items||[];currentToken=token||null;nextToken=result.nextPageToken||null;render();
    status.textContent=items.length+" account"+(items.length===1?"":"s")+" loaded for this page.";
  }catch(error){
    if(run!==listRun)return;
    items=[];nextToken=null;render();status.textContent=error?.message||"User directory could not be loaded.";
  }finally{if(run===listRun)setBusy(false);}
}
function detailTile(label,value){
  const box=node("div","rounded-xl border border-slate-200 bg-slate-50 p-3");
  box.append(node("span","text-xs text-slate-500",label),node("strong","block mt-1 break-words",value));return box;
}
async function findExact(){
  if(busy)return;
  const query=el("pu-search").value.trim();
  if(!query){status.textContent="Enter an exact verified email or account ID first.";el("pu-search").focus();return;}
  setBusy(true,"Looking up exact platform account…");
  try{
    const result=(await api({action:"lookup",query})).data;
    status.textContent="Exact account found.";
    await openDetail(result.account,{allowBusy:true});
  }catch(error){status.textContent=error?.message||"Exact account lookup failed.";}
  finally{setBusy(false);}
}
async function openDetail(item,{allowBusy=false}={}){
  if(busy&&!allowBusy)return;
  const run=++detailRun;
  el("pu-detail-title").textContent=item.displayName||item.email||"User account";
  el("pu-detail-meta").textContent=item.email||item.uid;
  el("pu-detail-account").replaceChildren(detailTile("Account","Loading…"));
  el("pu-memberships").replaceChildren();
  el("pu-detail-status").textContent="Loading school membership metadata…";
  dialog.showModal();
  try{
    const result=(await api({action:"get",uid:item.uid})).data;
    if(run!==detailRun||!dialog.open)return;
    const account=result.account;
    el("pu-detail-title").textContent=account.displayName||account.email||"User account";
    el("pu-detail-meta").textContent=(account.email||"No email")+" · "+account.uid;
    el("pu-detail-account").replaceChildren(
      detailTile("Account state",accountState(account)),
      detailTile("Platform role",account.platformAdmin?"Platform Administrator":"Standard user"),
      detailTile("Created",when(account.createdAt)),
      detailTile("Last sign-in",when(account.lastSignInAt)),
      detailTile("Providers",(account.providers||[]).join(", ")||"Unavailable")
    );
    const host=el("pu-memberships");host.replaceChildren();
    for(const membership of result.memberships||[]){
      const card=node("article","rounded-xl border border-slate-200 p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3");
      const info=node("div","min-w-0");
      info.append(node("strong","block break-words",membership.schoolName),
        node("p","text-xs text-slate-600 mt-1 break-words",
          membership.schoolId+" · "+membership.schoolState+" · "+membership.status+" · "+((membership.roles||[]).join(", ")||"no active school role")));
      const link=node("a","pu-btn","Open School Registry");link.href="owner-schools.html?schoolId="+encodeURIComponent(membership.schoolId);
      card.append(info,link);host.append(card);
    }
    if(!host.children.length)host.append(node("p","text-sm text-slate-600 py-4","No indexed school memberships are attached to this account."));
    el("pu-detail-status").textContent=(result.memberships||[]).length+" school membership"+((result.memberships||[]).length===1?"":"s")+" loaded.";
  }catch(error){
    if(run!==detailRun||!dialog.open)return;
    el("pu-detail-status").textContent=error?.message||"User details could not be loaded.";
  }
}
for(const id of ["pu-search","pu-account-filter","pu-role-filter"])el(id).addEventListener(id==="pu-search"?"input":"change",render);
el("pu-refresh").addEventListener("click",()=>void loadPage(currentToken));
el("pu-find-exact").addEventListener("click",()=>void findExact());
el("pu-search").addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();void findExact();}});
el("pu-next").addEventListener("click",()=>{if(!busy&&nextToken){history.push(currentToken);void loadPage(nextToken);}});
el("pu-prev").addEventListener("click",()=>{if(!busy&&history.length){const token=history.pop();void loadPage(token);}});
el("pu-detail-close").addEventListener("click",()=>{++detailRun;dialog.close();});
dialog.addEventListener("cancel",()=>{++detailRun;});

try{
  await auth.authStateReady();
  if(!auth.currentUser?.emailVerified)status.textContent="Sign in with a verified System Administrator account.";
  else await loadPage(null);
}catch(error){status.textContent=error?.message||"System Admin user directory could not be initialized.";}
