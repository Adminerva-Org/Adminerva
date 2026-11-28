import {app,auth} from "./firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";

const el=id=>document.getElementById(id);
const functions=getFunctions(app,"asia-southeast1");
const api=httpsCallable(functions,"platformUsers");
const schoolAccessApi=httpsCallable(functions,"peopleDirectory");
const list=el("pu-list"),status=el("pu-status"),dialog=el("pu-detail"),createDialog=el("pu-create-dialog");
let items=[],busy=false,listRun=0,detailRun=0,currentAccount=null,currentMemberships=[],currentTestAccount={active:false,status:"none",revision:0},testSchoolTargets=null;

function node(tag,className="",text=""){
  const out=document.createElement(tag);
  if(className)out.className=className;
  if(text!==undefined)out.textContent=text;
  return out;
}
function accountState(item){
  if(item.disabled)return "Disabled";
  return item.emailVerified?"Enabled · verified":"Enabled · email unverified";
}
function when(value){
  if(!value)return "Never / unavailable";
  const date=new Date(value);
  return Number.isNaN(date.getTime())?String(value):date.toLocaleString();
}
function setBusy(value,message=""){
  busy=value;
  for(const id of ["pu-refresh","pu-create","pu-consent-open","pu-save-profile","pu-reset-password","pu-platform-authority","pu-lifecycle","pu-create-submit","pu-test-toggle","pu-test-grant"]){
    const target=el(id);if(target)target.disabled=value;
  }
  if(message)status.textContent=message;
}
function sortItems(){
  items.sort((a,b)=>(a.displayName||a.email||a.uid).localeCompare(b.displayName||b.email||b.uid));
}
function replaceItem(account){
  const index=items.findIndex(item=>item.uid===account.uid);
  if(index>=0)items[index]=account;else items.push(account);
  sortItems();
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
  if(role==="platform_admin_archived"&&item.platformAdminStatus!=="archived")return false;
  if(role==="standard"&&item.platformAdminStatus!=="none")return false;
  return true;
}
function render(){
  list.replaceChildren();
  const rows=items.filter(visible);
  el("pu-count").textContent=rows.length+" shown · "+items.length+" total";
  if(!rows.length){
    list.append(node("p","text-sm text-slate-600 py-8 text-center",items.length?
      "No accounts match the current search and filters.":"No Firebase Auth accounts were returned."));
    return;
  }
  for(const item of rows){
    const row=node("article","py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3");
    const info=node("div","min-w-0");
    info.append(
      node("strong","block break-words",item.displayName||item.email||"Unnamed account"),
      node("p","text-xs text-slate-600 mt-1 break-words",
        [item.email||"No email",accountState(item),
          item.platformAdminStatus==="active"?"Platform Admin":
          item.platformAdminStatus==="archived"?"Platform Admin retired":"Standard user"].join(" · ")),
      node("p","text-[11px] text-slate-400 mt-1 break-all","Account ID: "+item.uid)
    );
    const actions=node("div","flex items-center gap-2 shrink-0");
    if(item.platformAdmin)actions.append(node("span","pu-chip border-blue-200 bg-blue-50 text-blue-800","Platform Admin"));
    const open=node("button","pu-btn primary","View & manage");open.type="button";
    open.addEventListener("click",()=>void openDetail(item));
    actions.append(open);row.append(info,actions);list.append(row);
  }
}
async function loadAll(){
  const run=++listRun;setBusy(true,"Loading the complete platform account directory…");
  try{
    const result=(await api({action:"list_all"})).data;
    if(run!==listRun)return;
    items=Array.isArray(result.items)?result.items:[];
    sortItems();render();
    status.textContent=items.length+" platform account"+(items.length===1?"":"s")+" loaded. Search and filters apply to the complete directory.";
  }catch(error){
    if(run!==listRun)return;
    items=[];render();status.textContent=error?.message||"The complete user directory could not be loaded.";
  }finally{if(run===listRun)setBusy(false);}
}
function detailTile(label,value){
  const box=node("div","rounded-xl border border-slate-200 bg-slate-50 p-3");
  box.append(node("span","text-xs text-slate-500",label),node("strong","block mt-1 break-words",value));
  return box;
}

function enterSchoolAssist({schoolId,personId,enrollmentMode}){
  if(!schoolId||!personId)return;
  try{
    sessionStorage.setItem("Adminerva_platform_view_school",schoolId);
    sessionStorage.setItem("Adminerva_platform_view_role","schooladmin");
    sessionStorage.setItem("Adminerva_platform_test_mode","1");
    sessionStorage.setItem("Adminerva_platform_school_mode","assist");
  }catch{}
  const target=enrollmentMode==="canonical"?"school-enrollment.html":"people-access.html";
  const url=new URL(target,location.href);
  url.searchParams.set("schoolId",schoolId);
  url.searchParams.set("personId",personId);
  if(enrollmentMode!=="canonical")url.hash="classes";
  location.href=url.href;
}
function selectedTestSchool(){
  return testSchoolTargets?.find(item=>item.schoolId===el("pu-test-school")?.value)||null;
}
async function suspendTestSchoolAccess(membership){
  if(busy||!currentAccount||!membership?.testStudentAccess||membership.status!=="active")return;
  const reason=testStudentReason();if(!reason)return;
  if(!confirm("Suspend this test student's access to “"+membership.schoolName+"”? Historical school records and the test person will be preserved."))return;
  const uid=currentAccount.uid;
  setBusy(true,"Suspending test student school access…");
  el("pu-test-status").textContent="Suspending the reviewed school membership through System Admin Assist…";
  try{
    await schoolAccessApi({
      schoolId:membership.schoolId,action:"suspend_access",
      targetUid:uid,expectedRevision:membership.revision,reason,platformMode:"assist"
    });
    await fetchDetail(uid);
    el("pu-test-status").textContent="Test student access suspended for "+membership.schoolName+
      ". Historical school records were preserved.";
  }catch(error){el("pu-test-status").textContent=error?.message||"Test student school access could not be suspended.";}
  finally{setBusy(false);renderTestControls();}
}
function renderTestControls(){
  const active=currentTestAccount?.active===true,account=currentAccount;
  const state=el("pu-test-state"),toggle=el("pu-test-toggle"),grant=el("pu-test-grant"),
    select=el("pu-test-school"),note=el("pu-test-school-note");
  if(!state||!toggle||!grant||!select||!note)return;
  state.textContent=active
    ?"Test student designation active · revision "+(currentTestAccount.revision||1)
    :"Not designated as a test student";
  toggle.textContent=active?"Retire test designation":"Designate as test student";
  toggle.className="pu-btn "+(active?"warn":"");
  toggle.disabled=busy||Boolean(account?.disabled)||Boolean(account?.platformAdmin)||(!active&&!account?.emailVerified);
  if(!active&&!account?.emailVerified)state.textContent+=" · Verify the login email before designation.";
  if(account?.disabled)state.textContent+=" · Restore the login account first.";
  if(account?.platformAdmin)state.textContent+=" · Platform Administrator accounts are ineligible.";

  const previous=select.value;
  select.replaceChildren(new Option(testSchoolTargets?"Choose target school":"Loading schools…",""));
  for(const school of testSchoolTargets||[]){
    const label=school.name+" · "+(school.enrollmentMode==="canonical"?"canonical":"legacy-compatible")+
      (school.productionAuthorized?" · production":"");
    select.add(new Option(label,school.schoolId));
  }
  if((testSchoolTargets||[]).some(item=>item.schoolId===previous))select.value=previous;
  const target=selectedTestSchool();
  const existing=target?currentMemberships.find(item=>item.schoolId===target.schoolId):null;
  if(!target){
    note.textContent="Choose an active or pilot school. Existing school history is never moved or deleted.";
  }else if(existing?.status==="active"&&(existing.roles||[]).includes("student")){
    note.textContent="This test student already has active student access to "+target.name+". Use Manage placement below to change its section.";
  }else{
    note.textContent=(target.productionAuthorized
      ?"Production school selected. This action is audited and should be used only for an explicitly designated test account. "
      :"")+(target.enrollmentMode==="canonical"
      ?"After access is added, use Enrollment & Registration for official section placement."
      :"After access is added, use People & Access compatibility placement to choose the section.");
  }
  grant.textContent=existing?.status==="suspended"?"Restore student access":"Add student access";
  grant.disabled=busy||!active||!target||Boolean(account?.disabled)||Boolean(account?.platformAdmin)||
    Boolean(existing?.status==="active"&&(existing.roles||[]).includes("student"));
}
async function ensureTestSchoolTargets(){
  if(testSchoolTargets){renderTestControls();return testSchoolTargets;}
  try{
    const result=(await api({action:"list_test_school_targets"})).data;
    testSchoolTargets=Array.isArray(result.schools)?result.schools:[];
  }catch(error){
    el("pu-test-status").textContent=error?.message||"School targets could not be loaded.";
    testSchoolTargets=[];
  }
  renderTestControls();return testSchoolTargets;
}
function populateDetail(result){
  const account=result.account;currentAccount=account;
  currentMemberships=Array.isArray(result.memberships)?result.memberships:[];
  currentTestAccount=result.testAccount&&typeof result.testAccount==="object"?result.testAccount:{active:false,status:"none",revision:0};
  el("pu-detail-title").textContent=account.displayName||account.email||"User account";
  el("pu-detail-meta").textContent=(account.email||"No email")+" · "+account.uid;
  el("pu-open-logs").href="platform-logs.html?uid="+encodeURIComponent(account.uid);
  el("pu-detail-account").replaceChildren(
    detailTile("Account state",accountState(account)),
    detailTile("Platform role",account.platformAdminStatus==="active"?"Platform Administrator":
      account.platformAdminStatus==="archived"?"Platform Administrator · retired":"Standard user"),
    detailTile("Created",when(account.createdAt)),
    detailTile("Last sign-in",when(account.lastSignInAt)),
    detailTile("Providers",(account.providers||[]).join(", ")||"Unavailable")
  );
  el("pu-profile-name").value=account.displayName||"";
  el("pu-reason").value="";
  el("pu-reset-output").hidden=true;
  el("pu-reset-link").value="";
  el("pu-action-status").textContent="";
  const authority=el("pu-platform-authority");
  authority.textContent=account.platformAdminStatus==="active"?"Retire Platform Admin":
    account.platformAdminStatus==="archived"?"Restore Platform Admin":"Grant Platform Admin";
  authority.className="pu-btn "+(account.platformAdminStatus==="active"?"warn":"");
  authority.disabled=busy||account.disabled;

  const lifecycle=el("pu-lifecycle");
  lifecycle.textContent=account.disabled?"Restore account":"Disable account";
  lifecycle.className="pu-btn "+(account.disabled?"success":"warn");
  lifecycle.disabled=busy||(!account.disabled&&account.platformAdmin);

  renderTestControls();
  void ensureTestSchoolTargets();
  const host=el("pu-memberships");host.replaceChildren();
  for(const membership of result.memberships||[]){
    const card=node("article","rounded-xl border border-slate-200 p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3");
    const info=node("div","min-w-0");
    info.append(
      node("strong","block break-words",membership.schoolName),
      node("p","text-xs text-slate-600 mt-1 break-words",
        membership.schoolId+" · "+membership.schoolState+" · "+membership.status+" · "+((membership.roles||[]).join(", ")||"no active school role"))
    );
    const actions=node("div","flex flex-wrap gap-2 shrink-0");
    const link=node("a","pu-btn","Open School Registry");link.href="owner-schools.html?schoolId="+encodeURIComponent(membership.schoolId);
    actions.append(link);
    if(currentTestAccount.active&&membership.status==="active"&&(membership.roles||[]).includes("student")&&membership.personId){
      const placement=node("button","pu-btn primary","Manage placement");placement.type="button";
      placement.addEventListener("click",()=>enterSchoolAssist(membership));
      actions.append(placement);
    }
    if(currentTestAccount.active&&membership.testStudentAccess===true&&membership.status==="active"){
      const suspend=node("button","pu-btn warn","Suspend test access");suspend.type="button";
      suspend.addEventListener("click",()=>void suspendTestSchoolAccess(membership));
      actions.append(suspend);
    }
    card.append(info,actions);host.append(card);
  }
  if(!host.children.length)host.append(node("p","text-sm text-slate-600 py-4","No indexed school memberships are attached to this account."));
  el("pu-detail-status").textContent=(result.memberships||[]).length+" school membership"+((result.memberships||[]).length===1?"":"s")+" loaded.";
  el("pu-test-status").textContent="";
}
async function fetchDetail(uid){
  const result=(await api({action:"get",uid})).data;
  populateDetail(result);replaceItem(result.account);render();
  return result;
}
async function openDetail(item){
  if(busy)return;
  const run=++detailRun;
  currentAccount=null;currentMemberships=[];currentTestAccount={active:false,status:"none",revision:0};
  el("pu-test-reason").value="";
  el("pu-test-status").textContent="";
  el("pu-detail-title").textContent=item.displayName||item.email||"User account";
  el("pu-detail-meta").textContent=item.email||item.uid;
  el("pu-detail-account").replaceChildren(detailTile("Account","Loading…"));
  el("pu-memberships").replaceChildren();
  el("pu-detail-status").textContent="Loading school membership metadata…";
  dialog.showModal();
  try{
    const result=(await api({action:"get",uid:item.uid})).data;
    if(run!==detailRun||!dialog.open)return;
    populateDetail(result);replaceItem(result.account);render();
  }catch(error){
    if(run!==detailRun||!dialog.open)return;
    el("pu-detail-status").textContent=error?.message||"User details could not be loaded.";
  }
}
function administrativeReason(){
  const value=el("pu-reason").value.trim();
  if(value.length<12){
    el("pu-action-status").textContent="Enter an administrative reason of at least 12 characters.";
    el("pu-reason").focus();return null;
  }
  return value;
}
function testStudentReason(){
  const input=el("pu-test-reason"),value=input.value.trim();
  if(value.length<12){
    el("pu-test-status").textContent="Enter a reason of at least 12 characters in Test student mobility before making this change.";
    input.focus();
    return null;
  }
  return value;
}
async function runDetailAction(action,payload,message){
  if(busy||!currentAccount)return;
  const reason=administrativeReason();if(!reason)return;
  const uid=currentAccount.uid;
  setBusy(true,message);
  el("pu-action-status").textContent=message;
  try{
    const result=(await api({action,uid,reason,...payload})).data;
    if(result.account){replaceItem(result.account);render();}
    if(result.resetLink){
      el("pu-reset-link").value=result.resetLink;el("pu-reset-output").hidden=false;
    }
    if(action!=="reset_password")await fetchDetail(uid);
    el("pu-action-status").textContent=
      action==="update_profile"?"Account profile updated.":
      action==="disable"?"Account disabled. Historical school records were not deleted.":
      action==="restore"?"Account restored and may sign in again.":
      action==="grant_platform_admin"?"Platform Administrator authority granted.":
      action==="archive_platform_admin"?"Platform Administrator authority retired. The login account was not deleted.":
      action==="restore_platform_admin"?"Platform Administrator authority restored.":
      "Password reset link generated. Share it only through a trusted channel.";
  }catch(error){
    el("pu-action-status").textContent=error?.message||"The account operation could not be completed.";
  }finally{
    setBusy(false);
    if(currentAccount){
      el("pu-lifecycle").disabled=busy||(!currentAccount.disabled&&currentAccount.platformAdmin);
      el("pu-platform-authority").disabled=busy||currentAccount.disabled;
      renderTestControls();
    }
  }
}
async function copyInput(input,statusTarget){
  const value=input.value;if(!value)return;
  try{await navigator.clipboard.writeText(value);statusTarget.textContent="Link copied to clipboard.";}
  catch{
    input.focus();input.select();document.execCommand("copy");
    statusTarget.textContent="Link copied to clipboard.";
  }
}

for(const id of ["pu-search","pu-account-filter","pu-role-filter"])el(id).addEventListener(id==="pu-search"?"input":"change",render);
el("pu-refresh").addEventListener("click",()=>void loadAll());
const consentDialog=el("pu-consent-dialog"),consentPreview=el("pu-consent-preview"),consentApply=el("pu-consent-apply"),consentInput=el("pu-consent-accounts"),consentConfirm=el("pu-consent-confirm"),consentResult=el("pu-consent-result");
let eligibleConsent=[],consentRowsSnapshot=[],consentBusy=false,consentVersion=0;
function invalidateConsent(){++consentVersion;eligibleConsent=[];consentRowsSnapshot=[];consentConfirm.checked=false;consentApply.disabled=true;consentResult.replaceChildren();}
function consentRows(rows){
  const labels={eligible:"Ready to initialize",initialized:"Enabled",already_enabled:"Already enabled",existing_choice_preserved:"Saved choice preserved",v4_only_legacy_unavailable:"V4 only · legacy collector unavailable",no_active_legacy_student:"No eligible legacy student",account_ineligible:"Not eligible",account_missing:"Account no longer exists"};
  consentResult.replaceChildren();
  const counts=new Map();for(const row of rows)counts.set(row.status,(counts.get(row.status)||0)+1);
  consentResult.append(node("p","font-semibold text-sm", [...counts].map(([key,count])=>count+" "+(labels[key]||key)).join(" · ")));
  const browserLabels={on:"On",default_on:"Default on",off:"Off"};
  const researchLabels={on_if_school_eligible:"On if school eligible",off:"Off",not_designated:"Not designated"};
  const browserCounts=new Map();for(const row of rows)if(row.browserPreference)browserCounts.set(row.browserPreference,(browserCounts.get(row.browserPreference)||0)+1);
  if(browserCounts.size)consentResult.append(node("p","text-xs text-slate-600","Browser diagnostics: "+[...browserCounts].map(([key,count])=>count+" "+browserLabels[key]).join(" · ")));
  const listing=node("div","max-h-60 overflow-auto divide-y");
  for(const row of rows){
    const item=items.find(x=>x.uid===row.uid),entry=node("div","py-2");
    entry.append(node("p","text-xs font-semibold break-all",(item?.email||row.uid)+" — "+(labels[row.status]||row.status)));
    if(row.browserPreference)entry.append(node("p","text-xs text-slate-600","Browser: "+browserLabels[row.browserPreference]+" · Studio research: "+researchLabels[row.researchPreference]));
    listing.append(entry);
  }
  consentResult.append(listing);
}
async function runConsent(apply){
 if(consentBusy||!auth.currentUser)return;
 const owner=auth.currentUser.uid,turn=++consentVersion;
 if(!apply){
   eligibleConsent=[];consentRowsSnapshot=[];consentConfirm.checked=false;consentApply.disabled=true;
   const tokens=[...new Set(consentInput.value.split(/[\s,;]+/).map(x=>x.trim()).filter(Boolean))];
   if(!tokens.length){consentResult.textContent="Enter the account emails or IDs from the consented cohort.";return;}
   const found=tokens.map(token=>items.filter(item=>item.uid===token||item.email?.toLowerCase()===token.toLowerCase()));
   if(found.some(matches=>matches.length!==1)){consentResult.textContent="Some entries are missing or ambiguous. Reload the directory and check the account list.";return;}
   eligibleConsent=[...new Set(found.map(matches=>matches[0].uid))];
 }else if(!consentConfirm.checked||!eligibleConsent.length)return;
 const targets=[...eligibleConsent],rows=apply?consentRowsSnapshot.map(row=>({...row})):[];
 consentBusy=true;consentInput.disabled=true;consentPreview.disabled=true;consentApply.disabled=true;consentConfirm.disabled=true;
 try{
   for(let offset=0;offset<targets.length;offset+=25){
     if(turn!==consentVersion||auth.currentUser?.uid!==owner)return;
     const result=(await api({action:apply?"initialize_activity_consent":"preview_activity_consent",uids:targets.slice(offset,offset+25),...(apply?{consentConfirmed:true}:{})})).data;
     if(turn!==consentVersion||auth.currentUser?.uid!==owner)return;
     for(const row of result.rows||[]){const index=rows.findIndex(value=>value.uid===row.uid);if(index<0)rows.push(row);else rows[index]={...rows[index],...row};}
     consentRows(rows);
   }
   consentRowsSnapshot=rows;eligibleConsent=apply?[]:rows.filter(row=>row.status==="eligible").map(row=>row.uid);
   consentConfirm.checked=false;
 }catch(error){
   eligibleConsent=[];consentRows(rows);
   consentResult.append(node("p","text-sm text-red-700","Batch stopped. Completed results above remain valid; preview again before retrying."));
 }finally{
   consentBusy=false;consentInput.disabled=false;consentPreview.disabled=false;consentConfirm.disabled=false;
   consentApply.disabled=!eligibleConsent.length||!consentConfirm.checked;
 }
}
el("pu-consent-open").addEventListener("click",()=>{if(busy||!items.length)return;consentInput.value="";invalidateConsent();consentDialog.showModal();});
el("pu-consent-close").addEventListener("click",()=>{if(!consentBusy)consentDialog.close();});
consentDialog.addEventListener("cancel",event=>{if(consentBusy)event.preventDefault();else invalidateConsent();});
consentInput.addEventListener("input",invalidateConsent);
consentPreview.addEventListener("click",()=>void runConsent(false));
consentConfirm.addEventListener("change",()=>{consentApply.disabled=consentBusy||!eligibleConsent.length||!consentConfirm.checked;});
consentApply.addEventListener("click",()=>void runConsent(true));

el("pu-create").addEventListener("click",()=>{
  if(busy)return;
  el("pu-create-form").reset();el("pu-create-output").hidden=true;el("pu-create-link").value="";el("pu-create-status").textContent="";
  createDialog.showModal();
});
el("pu-detail-close").addEventListener("click",()=>{++detailRun;currentAccount=null;currentMemberships=[];currentTestAccount={active:false,status:"none",revision:0};dialog.close();});
dialog.addEventListener("cancel",()=>{++detailRun;currentAccount=null;currentMemberships=[];currentTestAccount={active:false,status:"none",revision:0};});
el("pu-create-close").addEventListener("click",()=>createDialog.close());
el("pu-test-school").addEventListener("change",renderTestControls);
el("pu-test-toggle").addEventListener("click",async()=>{
  if(busy||!currentAccount)return;
  const reason=testStudentReason();if(!reason)return;
  const action=currentTestAccount.active?"retire_test_student":"mark_test_student",uid=currentAccount.uid;
  if(!currentTestAccount.active&&!confirm("Designate this login as a TEST STUDENT? Use this only for a controlled test account. Existing school history will remain intact."))return;
  setBusy(true,currentTestAccount.active?"Retiring test-student designation…":"Designating test student…");
  el("pu-test-status").textContent=currentTestAccount.active?
    "Checking active test school access before retiring the designation…":"Saving audited test-student designation…";
  try{
    await api({action,uid,reason});
    await fetchDetail(uid);
    el("pu-test-status").textContent=action==="mark_test_student"?
      "Test-student controls enabled for this login.":"Test-student designation retired.";
  }catch(error){el("pu-test-status").textContent=error?.message||"The test-student designation could not be changed.";}
  finally{setBusy(false);renderTestControls();}
});
el("pu-test-grant").addEventListener("click",async()=>{
  if(busy||!currentAccount||!currentTestAccount.active)return;
  const target=selectedTestSchool();
  if(!target){el("pu-test-status").textContent="Select a target school first.";el("pu-test-school").focus();return;}
  const reason=testStudentReason();if(!reason)return;
  if(target.productionAuthorized&&!confirm("Add this explicitly designated test student to the production school “"+target.name+"”? The action is audited and existing school history is preserved."))return;
  const uid=currentAccount.uid;
  setBusy(true,"Adding test student school access…");
  el("pu-test-status").textContent="Creating or restoring the target school's student identity and membership…";
  try{
    const result=(await schoolAccessApi({
      schoolId:target.schoolId,action:"activate_test_student_access",
      targetUid:uid,reason,platformMode:"assist"
    })).data;
    await fetchDetail(uid);
    el("pu-test-school").value=target.schoolId;renderTestControls();
    el("pu-test-status").textContent="Student access active in "+target.name+
      ". Use Manage placement to choose or change the section.";
    if(result?.createdPerson)el("pu-test-status").textContent+=" A school-scoped test student person was created; no source-school record was moved.";
  }catch(error){el("pu-test-status").textContent=error?.message||"Target school access could not be granted.";}
  finally{setBusy(false);renderTestControls();}
});

el("pu-save-profile").addEventListener("click",()=>{
  const displayName=el("pu-profile-name").value.trim();
  if(displayName.length<2){el("pu-action-status").textContent="Enter a display name of at least 2 characters.";return;}
  void runDetailAction("update_profile",{displayName},"Saving account profile…");
});
el("pu-reset-password").addEventListener("click",()=>void runDetailAction("reset_password",{},"Generating password reset link…"));
el("pu-platform-authority").addEventListener("click",()=>{
  if(!currentAccount)return;
  const action=currentAccount.platformAdminStatus==="active"?"archive_platform_admin":
    currentAccount.platformAdminStatus==="archived"?"restore_platform_admin":"grant_platform_admin";
  void runDetailAction(action,{},action==="archive_platform_admin"?
    "Retiring Platform Administrator authority…":
    action==="restore_platform_admin"?"Restoring Platform Administrator authority…":
    "Granting Platform Administrator authority…");
});

el("pu-lifecycle").addEventListener("click",()=>{
  if(!currentAccount)return;
  const action=currentAccount.disabled?"restore":"disable";
  void runDetailAction(action,{},currentAccount.disabled?"Restoring account…":"Disabling account…");
});
el("pu-copy-reset").addEventListener("click",()=>void copyInput(el("pu-reset-link"),el("pu-action-status")));
el("pu-copy-create-link").addEventListener("click",()=>void copyInput(el("pu-create-link"),el("pu-create-status")));
el("pu-create-form").addEventListener("submit",async event=>{
  event.preventDefault();if(busy)return;
  const displayName=el("pu-create-name").value.trim(),email=el("pu-create-email").value.trim(),
    reason=el("pu-create-reason").value.trim();
  if(displayName.length<2||!email||reason.length<12){
    el("pu-create-status").textContent="Enter a display name, valid email, and administrative reason of at least 12 characters.";return;
  }
  setBusy(true,"Creating login account…");el("pu-create-status").textContent="Creating login account…";
  try{
    const result=(await api({action:"create",displayName,email,reason})).data;
    replaceItem(result.account);render();
    if(result.setupLink){
      el("pu-create-link").value=result.setupLink;el("pu-create-output").hidden=false;
      el("pu-create-status").textContent="Account created. Copy the setup link and share it only through a trusted channel.";
    }else{
      el("pu-create-status").textContent="Account created. A setup link could not be generated; use the account detail reset action.";
    }
    status.textContent=items.length+" platform accounts loaded, including the newly created account.";
  }catch(error){el("pu-create-status").textContent=error?.message||"The login account could not be created.";}
  finally{setBusy(false);}
});

try{
  await auth.authStateReady();
  if(!auth.currentUser?.emailVerified)status.textContent="Sign in with a verified System Administrator account.";
  else await loadAll();
}catch(error){status.textContent=error?.message||"System Admin user directory could not be initialized.";}
