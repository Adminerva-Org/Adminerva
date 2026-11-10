import {app,auth} from "./firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";

const api=httpsCallable(getFunctions(app,"asia-southeast1"),"mcsPilotControl");
const byId=id=>document.getElementById(id);
let state=null,busy=false,pendingException=null,refreshEpoch=0;

function escapeText(value){return String(value??"");}
function say(message,tone="neutral"){
  const node=byId("pilot-status");node.textContent=message;
  node.dataset.tone=tone;
}
async function call(action,details={}){
  const result=await api({action,...details});
  return result.data;
}
function chip(label,value,tone=""){
  const item=document.createElement("div");item.className="pilot-stat"+(tone?" "+tone:"");
  const name=document.createElement("span");name.textContent=label;
  const number=document.createElement("strong");number.textContent=value;
  item.append(name,number);return item;
}
function renderSummary(data){
  const host=byId("pilot-summary");host.replaceChildren(
    chip("School state",data.schoolState),
    chip("Compatibility",String(data.compatibilityMode||"legacy_allowed").replaceAll("_"," "),"safe"),
    chip("Pilot roster",data.includedTotal+" / "+data.expectedTotal,data.includedTotal===data.expectedTotal?"safe":"warn"),
    chip("Identity reviews",data.unresolved.length,data.unresolved.length?"warn":"safe"),
    chip("V4 migration",data.canonical?.ready?"Ready":"Pending",data.canonical?.ready?"safe":"warn"),
    chip("Additional school staff",String(data.canonical?.extraStaffMemberships??0),
      data.canonical?.invalidExtraMemberships?"warn":"safe")
  );
  byId("pilot-history-boundary").textContent=data.deferredHistory?
    "Historical assessments, grades, evidence, planning and Practice remain deferred and unchanged.":
    "Historical migration state requires review.";
  const badge=byId("pilot-state-badge");
  badge.textContent=data.schoolState==="draft"?"Not started":data.schoolState==="pilot"?"Pilot active":data.schoolState;
  badge.dataset.state=data.schoolState;
}
function renderBlockers(data){
  const host=byId("pilot-blockers");host.replaceChildren();
  if(!data.blockers.length){
    const clear=document.createElement("div");clear.className="pilot-clear";
    clear.innerHTML="<strong>Pre-pilot review clear.</strong><span>The controlled pilot can be started when you are ready.</span>";
    host.append(clear);return;
  }
  const title=document.createElement("h2");title.textContent="Before Start Controlled Pilot";host.append(title);
  for(const blocker of data.blockers){
    const row=document.createElement("div");row.className="pilot-blocker";
    const mark=document.createElement("span");mark.textContent="!";
    const text=document.createElement("div");const strong=document.createElement("strong");strong.textContent=blocker.label;
    const note=document.createElement("p");
    note.textContent=blocker.code==="identity_unresolved"?
      "Review only the student records shown under Identity exceptions below.":
      blocker.code==="roster_count_mismatch"?
      "Review the over-count sections and exclude only records that are not part of the protected current roster.":
      blocker.code==="canonical_migration_pending"?
      "The pilot needs the reviewed student membership and academic relationships. Additional authorized school staff do not count as pilot students.":
      blocker.code==="pilot_teacher_role_missing"?
      "The designated teacher must retain an active school-admin and teacher grant together.":
      blocker.code==="pilot_compatibility_invalid"?
      "The controlled pilot requires legacy_allowed so existing grades and assessments remain available.":
      blocker.code==="pilot_production_state_invalid"?
      "Only the designated owner can resolve production authorization. This teacher-led pilot cannot approve cutover.":
      blocker.code==="duplicate_identity"?
      "One verified account appears linked to more than one current pilot record.":
      "Review the current school's verified access configuration before continuing.";
    text.append(strong,note);row.append(mark,text);host.append(row);
  }
}
function renderCounts(data){
  byId("pilot-roster-target").textContent="The protected roster target is "+data.expectedTotal+" approved students across four Senior High ICT sections.";

  const host=byId("pilot-section-counts");host.replaceChildren();
  for(const section of data.counts){
    const card=document.createElement("article");card.className="pilot-section-card";
    const top=document.createElement("div");top.className="pilot-row";
    const title=document.createElement("strong");title.textContent=section.name;
    const count=document.createElement("span");count.className="pilot-count "+(section.delta===0?"ok":"bad");
    count.textContent=section.included+" / "+section.expected;
    top.append(title,count);
    const meta=document.createElement("p");
    meta.textContent=section.observed+" live legacy records · "+(section.observed-section.included)+" excluded from pilot";
    card.append(top,meta);
    if(section.delta!==0){
      const hint=document.createElement("p");hint.className="pilot-warning";
      hint.textContent=(section.delta>0?section.delta+" extra included record":"Missing "+Math.abs(section.delta)+" included record")+
        " compared with the protected roster.";
      card.append(hint);
    }
    host.append(card);
  }
}
function identityForm(item){
  const card=document.createElement("article");card.className="pilot-exception";
  const info=document.createElement("div");info.className="pilot-exception-info";
  const title=document.createElement("strong");title.textContent=item.displayName;
  const meta=document.createElement("p");meta.textContent=item.sectionName+" · legacy record "+item.legacyStudentId;
  const note=document.createElement("p");note.className="pilot-muted";note.textContent=item.issue;
  info.append(title,meta,note);
  const form=document.createElement("form");form.className="pilot-link-form";
  form.innerHTML=`
    <label>Verified account email
      <input name="accountEmail" type="email" autocomplete="off" required placeholder="student@example.com">
    </label>
    <label>Review reason
      <input name="reason" minlength="12" maxlength="500" required value="Matched against protected MCS roster">
    </label>
    <button type="submit">Confirm identity match</button>`;
  form.addEventListener("submit",event=>{
    event.preventDefault();if(busy)return;
    const values=new FormData(form);
    const accountEmail=String(values.get("accountEmail")||"").trim();
    const reason=String(values.get("reason")||"").trim();
    if(!confirm("Link "+item.displayName+" to the verified Firebase account "+accountEmail+"? Existing legacy grades and submissions will not be moved or edited."))return;
    void mutate("resolve_identity",{legacyStudentId:item.legacyStudentId,accountEmail,reason},
      "Identity match saved. Legacy grading records were left unchanged.");
  });
  card.append(info,form);return card;
}
function renderIdentities(data){
  const host=byId("pilot-identity-list");host.replaceChildren();
  byId("pilot-identity-count").textContent=data.unresolved.length;
  if(!data.unresolved.length){
    const clear=document.createElement("div");clear.className="pilot-clear";
    clear.innerHTML="<strong>No unresolved pilot identities.</strong><span>Every included pilot record has a verified Firebase account link.</span>";
    host.append(clear);return;
  }
  for(const item of data.unresolved)host.append(identityForm(item));
}
function openException(record,action){
  pendingException={record,action};
  const dialog=byId("pilot-exception-dialog");
  byId("pilot-exception-title").textContent=action==="exclude_legacy_record"?"Exclude record from V4 pilot":"Restore record to V4 pilot";
  byId("pilot-exception-target").textContent=record.displayName+" · "+record.sectionName+" · "+record.legacyStudentId;
  byId("pilot-exception-explanation").textContent=action==="exclude_legacy_record"?
    "This excludes only the V4 pilot enrollment candidate. It does not delete the legacy student or any assessment, grade, evidence or submission.":
    "This returns the preserved legacy record to the V4 pilot candidate roster.";
  const form=byId("pilot-exception-form");form.reset();
  form.elements.reason.value=action==="exclude_legacy_record"?
    "Not part of protected current SHS pilot roster":"Restoring reviewed current pilot roster record";
  dialog.showModal();
}
function renderMismatchRecords(data){
  const host=byId("pilot-roster-review");host.replaceChildren();
  const mismatches=data.counts.filter(section=>section.delta!==0);
  byId("pilot-roster-review-wrap").hidden=!mismatches.length;
  if(!mismatches.length)return;
  for(const section of mismatches){
    const details=document.createElement("details");details.className="pilot-details";
    const summary=document.createElement("summary");
    summary.textContent=section.name+" — review "+section.observed+" legacy records ("+section.included+" currently included)";
    details.append(summary);
    const intro=document.createElement("p");intro.className="pilot-muted";
    intro.textContent="Compare these names with the protected current roster. Exclude only a duplicate, test, old or otherwise out-of-scope record.";
    details.append(intro);
    const sectionRecords=data.sectionRecords.filter(row=>row.sectionId===section.sectionId)
      .sort((a,b)=>Number(Boolean(b.rosterReviewHint))-Number(Boolean(a.rosterReviewHint))||
        String(a.displayName).localeCompare(String(b.displayName)));
    for(const record of sectionRecords){
      const row=document.createElement("div");row.className="pilot-roster-row";
      const info=document.createElement("div");const name=document.createElement("strong");name.textContent=record.displayName;
      const meta=document.createElement("p");meta.textContent=(record.linked?"Account linked":"Identity unresolved")+" · "+record.legacyStudentId+
        (record.excluded?" · excluded from pilot":"");
      info.append(name,meta);
      if(record.rosterReviewHint==="protected_roster_no_name_match"){
        const hint=document.createElement("p");
        hint.style.cssText="margin:.35rem 0 0;color:#9a3412;font-weight:800;font-size:.82rem";
        hint.textContent="Likely extra/duplicate: this live record has no matching student name in the protected current roster.";
        info.append(hint);
        row.style.cssText="border:2px solid #fb923c;background:#fff7ed;border-radius:10px;padding:.75rem;margin:.5rem 0";
      }
      const button=document.createElement("button");button.type="button";
      button.className=record.excluded?"secondary":"danger";
      button.textContent=record.excluded?"Restore to pilot":"Exclude from pilot";
      button.addEventListener("click",()=>openException(record,record.excluded?"restore_legacy_record":"exclude_legacy_record"));
      row.append(info,button);details.append(row);
    }
    host.append(details);
  }
}
function renderStart(data){
  const form=byId("pilot-start-form"),button=byId("pilot-start-button"),
    note=byId("pilot-start-note");
  const isDraft=data.schoolState==="draft";
  form.hidden=!isDraft;
  byId("pilot-active-note").hidden=data.schoolState!=="pilot";
  button.disabled=busy||!data.readyToStart;
  if(!isDraft)return;
  note.textContent=data.readyToStart?
    "All current pre-pilot gates are clear. Starting keeps legacy compatibility enabled and does not authorize production cutover.":
    "Start is intentionally disabled until the identity and roster exceptions above are resolved.";
}
function render(data){
  state=data;renderSummary(data);renderBlockers(data);renderCounts(data);
  renderIdentities(data);renderMismatchRecords(data);renderStart(data);
  byId("pilot-workspace").hidden=false;
}
async function refresh({internal=false}={}){
  if(busy&&!internal)return false;
  const sequence=++refreshEpoch;
  say("Loading MCS controlled-pilot status…");
  try{
    const next=await call("overview");
    if(sequence!==refreshEpoch||!auth.currentUser)return false;
    render(next);say("Controlled-pilot status loaded.","ok");return true;
  }catch(error){
    if(sequence!==refreshEpoch)return false;
    byId("pilot-workspace").hidden=true;
    say(error?.message||"Pilot status is unavailable. Choose Refresh status to retry.","error");
    return false;
  }
}
async function mutate(action,details,success){
  if(busy)return;
  busy=true;++refreshEpoch;
  document.body.dataset.busy="true";
  byId("pilot-workspace").setAttribute("aria-busy","true");
  byId("pilot-refresh").disabled=true;
  byId("pilot-start-button").disabled=true;
  say("Saving reviewed pilot decision…");
  try{
    await call(action,details);
    const updated=await refresh({internal:true});
    if(updated)say(success,"ok");
    else say("Decision submitted, but the updated pilot status could not be confirmed. Refresh status before taking another action.","error");
  }catch(error){say(error?.message||"The pilot decision was not saved.","error");}
  finally{
    busy=false;delete document.body.dataset.busy;
    byId("pilot-workspace").removeAttribute("aria-busy");
    byId("pilot-refresh").disabled=false;
    if(state)renderStart(state);
  }
}
byId("pilot-refresh").addEventListener("click",()=>void refresh());
let activeUid=auth.currentUser?.uid||null;
auth.onAuthStateChanged(user=>{
  const nextUid=user?.uid||null;
  if(nextUid===activeUid)return;
  activeUid=nextUid;++refreshEpoch;state=null;
  byId("pilot-workspace").hidden=true;
  if(user)void refresh();
  else say("Sign in with the verified MCS school-administrator account.","error");
});
byId("pilot-exception-cancel").addEventListener("click",()=>{pendingException=null;byId("pilot-exception-dialog").close();});
byId("pilot-exception-form").addEventListener("submit",event=>{
  event.preventDefault();if(!pendingException||busy)return;
  const reason=String(new FormData(event.currentTarget).get("reason")||"").trim(),
    {record,action}=pendingException;
  if(action==="exclude_legacy_record"&&!confirm("Exclude "+record.displayName+" from the V4 pilot only? All legacy academic history remains preserved."))return;
  byId("pilot-exception-dialog").close();pendingException=null;
  void mutate(action,{legacyStudentId:record.legacyStudentId,reason},
    action==="exclude_legacy_record"?"Record excluded from the V4 pilot only. Legacy data was preserved.":"Record restored to the V4 pilot candidate roster.");
});
byId("pilot-start-form").addEventListener("submit",event=>{
  event.preventDefault();if(busy||!state?.readyToStart)return;
  const form=event.currentTarget,d=new FormData(form),acknowledgements={
    limitedScopeReviewed:d.get("limitedScopeReviewed")==="on",
    legacyCompatibilityRequired:d.get("legacyCompatibilityRequired")==="on",
    productionNotAuthorized:d.get("productionNotAuthorized")==="on"
  };
  if(!Object.values(acknowledgements).every(Boolean)){say("Confirm all three pilot safeguards before starting.","error");return;}
  if(!confirm("Start the limited MCS SHS Adminerva 4.0 controlled pilot? Legacy compatibility will remain enabled; this will not migrate historical grades or switch to V4-only."))return;
  void mutate("start_pilot",{
    acknowledgements,scopeReference:String(d.get("scopeReference")||"").trim(),
    reason:String(d.get("reason")||"").trim()
  },"Controlled pilot started. Legacy compatibility remains enabled.");
});
await auth.authStateReady();
if(auth.currentUser)void refresh();else say("Sign in with the verified MCS school-administrator account.","error");
