import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";

const api=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolLegacyDirectoryAdoption");
const get=id=>document.getElementById(id);
const panel=get("pa-legacy-panel");
const status=get("pa-legacy-status");
let schoolId=null,compatibilityMode=null,preview=null,busy=false,requestsLoading=false;

function say(message){if(status)status.textContent=message;}
function setBusy(value){
  busy=value;
  for(const id of ["pa-legacy-preview","pa-legacy-apply-identities","pa-legacy-apply-all"]){
    const button=get(id);if(button)button.disabled=value;
  }
}
function count(id,value){const node=get(id);if(node)node.textContent=String(value??0);}
function reset(){
  preview=null;
  for(const id of ["pa-legacy-students","pa-legacy-staff","pa-legacy-teachers","pa-legacy-verified","pa-legacy-unlinked",
    "pa-legacy-people","pa-legacy-memberships","pa-legacy-enrollments","pa-legacy-assignments","pa-legacy-issues"])count(id,"—");
  get("pa-legacy-results")?.replaceChildren();
  if(get("pa-legacy-apply-identities"))get("pa-legacy-apply-identities").disabled=true;
  if(get("pa-legacy-apply-all"))get("pa-legacy-apply-all").disabled=true;
}
function activate(detail){
  schoolId=detail?.schoolId||null;compatibilityMode=detail?.compatibilityMode||null;
  reset();
  const requestsPanel=get("pa-legacy-requests-panel");
  if(!panel)return;
  if(schoolId!=="mcs-manila"){
    panel.hidden=true;if(requestsPanel)requestsPanel.hidden=true;return;
  }
  panel.hidden=false;if(requestsPanel)requestsPanel.hidden=false;
  void loadLegacyRequests();
  if(compatibilityMode==="v4_only"){
    get("pa-legacy-preview").disabled=true;
    say("Legacy consolidation is closed because this school is already in school-wide-only mode.");
    return;
  }
  get("pa-legacy-preview").disabled=false;
  say("Preview the previous student roster and teacher access before adopting it into the school-wide directory.");
}
function render(result){
  preview=result;
  const s=result.summary||{};
  count("pa-legacy-students",s.legacyStudentRows);
  count("pa-legacy-staff",s.legacyStaffRows);
  count("pa-legacy-teachers",s.legacyTeacherProfiles);
  count("pa-legacy-verified",s.verifiedAccounts);
  count("pa-legacy-unlinked",s.unlinkedPeople);
  count("pa-legacy-people",s.peopleToCreate);
  count("pa-legacy-memberships",(s.membershipsToCreate||0)+(s.membershipsToUpdate||0));
  count("pa-legacy-enrollments",s.enrollmentCandidates);
  count("pa-legacy-assignments",s.teachingAssignmentCandidates);
  count("pa-legacy-issues",(s.integrityIssues||0)+(s.attentionItems||0)+(s.reviewItems||0));

  const host=get("pa-legacy-results");host.replaceChildren();
  for(const issue of result.issues||[]){
    const row=document.createElement("div");row.className="pa-row";row.setAttribute("role","listitem");
    const info=document.createElement("div"),title=document.createElement("strong"),detail=document.createElement("p");
    title.textContent=issue.label||"Legacy record";
    detail.className="pa-muted";detail.textContent=(issue.severity||"review")+" · "+(issue.detail||issue.type||"Needs review");
    if(issue.severity==="integrity")detail.style.color="#9f1239";
    else if(issue.severity==="attention")detail.style.color="#92400e";
    info.append(title,detail);row.append(info);host.append(row);
  }
  if(!(result.issues||[]).length){
    const ok=document.createElement("p");ok.className="pa-muted";ok.textContent="No unresolved legacy mapping issues were found.";host.append(ok);
  }
  const reason=String(get("pa-legacy-reason")?.value||"").trim();
  get("pa-legacy-apply-identities").disabled=!result.digest||reason.length<12;
  get("pa-legacy-apply-all").disabled=!result.digest||reason.length<12||!get("pa-legacy-confirm-academic").checked;
  say(
    (s.peopleToCreate||0)+" people to create · "+
    ((s.membershipsToCreate||0)+(s.membershipsToUpdate||0))+" account-access changes · "+
    (s.enrollmentCandidates||0)+" enrollment candidates · "+
    (s.teachingAssignmentCandidates||0)+" teaching assignments. "+
    "Existing canonical records are preserved."
  );
}
async function loadLegacyRequests(){
  const host=get("pa-legacy-requests-list"),state=get("pa-legacy-requests-status");
  if(!host||!state||!schoolId||requestsLoading)return;
  requestsLoading=true;state.textContent="Loading previous access requests…";
  try{
    const result=(await api({schoolId,action:"list_legacy_requests"})).data||{};
    host.replaceChildren();
    for(const item of result.items||[]){
      const card=document.createElement("div");card.className="pa-row";card.setAttribute("role","listitem");
      const info=document.createElement("div"),title=document.createElement("strong"),meta=document.createElement("p");
      title.textContent=item.displayName||"Unnamed account";
      meta.className="pa-muted";meta.textContent=[item.email,item.requestedRole?"requested "+item.requestedRole:null].filter(Boolean).join(" · ");
      info.append(title,meta);

      const controls=document.createElement("form");controls.className="pa-legacy-request-controls";
      controls.style.cssText="display:grid;grid-template-columns:minmax(120px,.5fr) minmax(180px,1fr) auto auto;gap:.5rem;width:100%;align-items:end";
      const roleLabel=document.createElement("label");roleLabel.textContent="Approve as";
      const role=document.createElement("select");role.className="pa-field";role.style.marginBottom="0";
      role.append(new Option("Student","student"),new Option("Teacher","teacher"));
      role.value=item.requestedRole==="teacher"?"teacher":"student";roleLabel.append(role);
      const reasonLabel=document.createElement("label");reasonLabel.textContent="Decision reason";
      const reason=document.createElement("input");reason.className="pa-field";reason.style.marginBottom="0";reason.minLength=12;reason.maxLength=500;
      reason.placeholder="Explain this access decision";reason.required=true;reasonLabel.append(reason);
      const approve=document.createElement("button");approve.type="button";approve.className="pa-action";approve.textContent="Approve";
      const reject=document.createElement("button");reject.type="button";reject.className="pa-action";reject.style.background="#9a3412";reject.textContent="Reject";
      async function decide(decision){
        const why=reason.value.trim();
        if(why.length<12){state.textContent="Enter a decision reason of at least 12 characters.";reason.focus();return;}
        if(!confirm((decision==="approved"?"Approve":"Reject")+" the previous access request for "+item.displayName+"?"))return;
        approve.disabled=true;reject.disabled=true;state.textContent="Saving "+item.displayName+" access decision…";
        try{
          await api({schoolId,action:"decide_legacy_request",targetUid:item.targetUid,
            expectedRevision:item.revision,decision,role:role.value,reason:why});
          await loadLegacyRequestsAfterDecision();
        }catch(error){
          state.textContent=error?.message||"The access request decision was not saved.";
          approve.disabled=false;reject.disabled=false;
        }
      }
      approve.addEventListener("click",()=>void decide("approved"));
      reject.addEventListener("click",()=>void decide("rejected"));
      controls.append(roleLabel,reasonLabel,approve,reject);
      card.append(info,controls);host.append(card);
    }
    if(!(result.items||[]).length){
      const empty=document.createElement("p");empty.className="pa-muted";empty.textContent="No pending requests remain in the previous directory.";host.append(empty);
    }
    state.textContent=(result.count||0)+" previous access request"+(result.count===1?"":"s")+" pending.";
  }catch(error){
    state.textContent=error?.message||"Previous access requests could not be loaded.";
  }finally{requestsLoading=false;}
}
async function loadLegacyRequestsAfterDecision(){
  requestsLoading=false;
  await loadLegacyRequests();
  document.dispatchEvent(new CustomEvent("adminerva:directory-changed"));
}
get("pa-legacy-requests-refresh")?.addEventListener("click",()=>void loadLegacyRequests());

async function runPreview(){
  if(!schoolId||busy)return;
  setBusy(true);say("Comparing legacy students and staff with the school-wide directory…");
  try{
    const result=(await api({schoolId,action:"preview"})).data;
    render(result);
  }catch(error){
    reset();say(error?.message||"Legacy directory preview could not be prepared.");
  }finally{
    busy=false;
    if(get("pa-legacy-preview"))get("pa-legacy-preview").disabled=false;
    if(preview){
      const reason=String(get("pa-legacy-reason")?.value||"").trim();
      get("pa-legacy-apply-identities").disabled=reason.length<12;
      get("pa-legacy-apply-all").disabled=reason.length<12||!get("pa-legacy-confirm-academic").checked;
    }
  }
}
async function apply(includeAcademic){
  if(!preview?.digest||!schoolId||busy)return;
  const reason=String(get("pa-legacy-reason")?.value||"").trim();
  if(reason.length<12){say("Enter a consolidation reason of at least 12 characters.");get("pa-legacy-reason")?.focus();return;}
  if(includeAcademic&&!get("pa-legacy-confirm-academic").checked){
    say("Confirm that you reviewed the section/subject mappings before applying class relationships.");return;
  }
  const message=includeAcademic?
    "Adopt the reviewed legacy people, account access, student enrollments and teacher course assignments into the school-wide model? Existing canonical records and suspensions will be preserved.":
    "Adopt the reviewed legacy people and account access into the school-wide model? Class relationships will remain unchanged.";
  if(!confirm(message))return;
  setBusy(true);say(includeAcademic?"Applying school-wide people, access and reviewed class relationships…":"Applying school-wide people and access…");
  try{
    const result=(await api({schoolId,action:"apply",expectedDigest:preview.digest,reason,
      includeAcademic,confirmAcademicMappings:includeAcademic})).data;
    const identity=result.identity||{},academic=result.academic||{};
    say("Legacy consolidation "+result.status+": "+(identity.created||0)+" people created · "+
      (identity.updated||0)+" existing records updated · "+(identity.existing||0)+" already current · "+
      (identity.failed||0)+" identity failures"+
      (includeAcademic?" · "+(academic.created||0)+" class relationships created · "+(academic.failed||0)+" relationship failures.":"."));
    preview=null;
    setTimeout(()=>location.reload(),900);
  }catch(error){
    say(error?.message||"Legacy consolidation did not finish. Existing applied records are preserved; preview again before retrying.");
    setBusy(false);
  }
}

get("pa-legacy-preview")?.addEventListener("click",()=>void runPreview());
get("pa-legacy-apply-identities")?.addEventListener("click",()=>void apply(false));
get("pa-legacy-apply-all")?.addEventListener("click",()=>void apply(true));
for(const id of ["pa-legacy-reason","pa-legacy-confirm-academic"]){
  get(id)?.addEventListener(id==="pa-legacy-reason"?"input":"change",()=>{
    if(!preview||busy)return;
    const reason=String(get("pa-legacy-reason")?.value||"").trim();
    get("pa-legacy-apply-identities").disabled=reason.length<12;
    get("pa-legacy-apply-all").disabled=reason.length<12||!get("pa-legacy-confirm-academic").checked;
  });
}
document.addEventListener("adminerva:school-ready",event=>activate(event.detail));
await auth.authStateReady();
try{
  const uid=auth.currentUser?.uid;
  const remembered=uid?sessionStorage.getItem("Adminerva_last_verified_school_"+uid):null;
  if(remembered&&!schoolId)activate({schoolId:remembered});
}catch{}
