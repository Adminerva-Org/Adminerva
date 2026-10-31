import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs?v=4.0.0";

const panel=document.getElementById("v4ReclaimPanel");
const host=document.getElementById("v4ReclaimSchoolSwitcher");
const list=document.getElementById("v4ReclaimItems");
const status=document.getElementById("v4ReclaimStatus");
const refresh=document.getElementById("v4ReclaimRefresh");
const legacyHeader=document.getElementById("legacyReclaimHeader");
const legacyStatus=document.getElementById("reclaimStatus");
const legacyItems=document.getElementById("reclaimItems");

function make(tag,className,text){
  const element=document.createElement(tag);
  if(className)element.className=className;
  if(text!==undefined)element.textContent=String(text);
  return element;
}
if(panel&&host&&list&&status&&refresh){
  const api=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolReclaims");
  let picker=null,busy=false,generation=0,items=[];

  async function scoped(action,details={}){
    if(!picker?.scope.current)throw Error("Choose a verified school first.");
    const lease=picker.scope.lease();
    const result=(await api({schoolId:lease.schoolId,action,...details})).data;
    picker.scope.assertLease(lease);
    return result;
  }
  function setBusy(value,message=""){
    busy=value;refresh.disabled=value;
    if(message)status.textContent=message;
    for(const button of list.querySelectorAll("button"))button.disabled=value;
  }
  function repositoryLink(claim){
    const repo=String(claim.repository||"").trim();
    const sha=String(claim.sha||"").trim().toLowerCase();
    if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)||!/^[a-f0-9]{40}$/.test(sha))return null;
    const link=make("a","text-sm font-bold text-indigo-700 underline","Inspect commit diff ↗");
    link.href="https://github.com/"+repo+"/commit/"+sha;
    link.target="_blank";link.rel="noopener noreferrer";
    return link;
  }
  function render(){
    list.replaceChildren();
    if(!items.length){
      list.append(make("p","rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600",
        "No pending attribution decisions for this verified school."));
      return;
    }
    for(const claim of items){
      const card=make("article","rounded-xl border border-slate-200 bg-white p-4 shadow-sm");
      const head=make("div","flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3");
      const identity=make("div","min-w-0");
      identity.append(
        make("h3","font-extrabold text-slate-900",claim.studentName||"Student"),
        make("p","font-mono text-xs text-indigo-800 mt-1","Commit "+String(claim.sha||"").slice(0,12)),
        make("p","text-xs text-slate-500 mt-1",
          (claim.repository||"Repository unavailable")+" · evidence version "+(claim.evidenceVersion||"—"))
      );
      const badge=make("span","self-start rounded-full bg-amber-100 text-amber-900 px-3 py-1 text-xs font-bold","Pending decision");
      head.append(identity,badge);card.append(head);

      const author=make("div","rounded-lg bg-slate-50 border border-slate-200 p-3 mt-3");
      author.append(
        make("strong","text-xs uppercase tracking-wide text-slate-600","Detected Git identity"),
        make("p","text-sm text-slate-800 mt-1",
          (claim.detectedAuthorName||"Unknown Git author")+
          (claim.detectedAuthorLogin?" (@"+claim.detectedAuthorLogin+")":""))
      );
      card.append(author);

      const explanation=make("div","rounded-lg bg-amber-50 border border-amber-200 p-3 mt-3");
      explanation.append(
        make("strong","text-xs uppercase tracking-wide text-amber-900","Student explanation"),
        make("p","text-sm whitespace-pre-wrap text-amber-950 mt-1",claim.explanation||"No explanation supplied.")
      );
      card.append(explanation);

      const actions=make("div","flex flex-wrap gap-3 items-center mt-3");
      const diff=repositoryLink(claim);
      if(diff)actions.append(diff);
      const grade=make("a","text-sm font-bold text-indigo-700 underline","Open V4 Gradebook →");
      grade.href="gradebook.html";actions.append(grade);card.append(actions);

      const noteLabel=make("label","block text-sm font-bold text-slate-700 mt-4",
        "Decision explanation (12–2,000 characters)");
      const reason=make("textarea","mt-1 w-full rounded-lg border border-slate-300 p-3 text-sm");
      reason.rows=3;reason.minLength=12;reason.maxLength=2000;reason.required=true;
      reason.placeholder="State what you inspected and why the attribution claim is approved, shared, or rejected.";
      noteLabel.append(reason);card.append(noteLabel);

      const decisions=make("div","flex flex-wrap gap-2 mt-3");
      for(const [decision,label,className] of [
        ["approved","Approve attribution","bg-emerald-700 text-white"],
        ["shared","Shared contribution","bg-indigo-700 text-white"],
        ["rejected","Reject request","border border-rose-300 bg-white text-rose-800"]
      ]){
        const button=make("button","rounded-lg px-4 py-2.5 text-sm font-bold "+className,label);
        button.type="button";
        button.addEventListener("click",()=>void decide(claim,decision,reason,button));
        decisions.append(button);
      }
      card.append(decisions,
        make("p","text-xs text-slate-500 mt-2",
          "This decision resolves the school identity dispute only. The assessment-owning teacher must still verify and approve the frozen evidence before grading."));
      list.append(card);
    }
  }
  async function decide(claim,decision,reasonField,button){
    if(busy)return;
    const reason=reasonField.value.trim();
    if(reason.length<12){
      reasonField.focus();status.textContent="Enter a decision explanation of at least 12 characters.";return;
    }
    const verb=decision==="approved"?"approve":decision==="shared"?"mark as shared contribution":"reject";
    if(!confirm("Record this school decision to "+verb+" commit "+String(claim.sha||"").slice(0,12)+"?"))return;
    setBusy(true,"Recording audited attribution decision…");button.disabled=true;
    try{
      await scoped("decide",{claimId:claim.claimId,decision,reason});
      status.textContent="Decision recorded. Teacher evidence approval remains a separate review step.";
      await load();
    }catch(error){
      status.textContent=error?.message||"Attribution decision was not saved.";
    }finally{setBusy(false);}
  }
  async function load(){
    const token=++generation;
    setBusy(true,"Loading pending school attribution requests…");
    try{
      const result=await scoped("inbox");
      if(token!==generation)return;
      items=result.claims||[];
      render();
      status.textContent=items.length+
        " pending attribution request"+(items.length===1?"":"s")+" for this verified school.";
    }catch(error){
      if(token!==generation)return;
      items=[];render();
      status.textContent=error?.message||"School attribution requests are unavailable.";
    }finally{if(token===generation)setBusy(false);}
  }
  function setSchoolAdminPresentation(detail={}){
    const role=detail.role||document.getElementById("adminerva-nav")?.dataset.verifiedRole||"";
    if(role!=="schooladmin")return;
    legacyHeader?.classList.add("hidden");
    legacyStatus?.classList.add("hidden");
    legacyItems?.classList.add("hidden");
    panel.classList.remove("hidden");
  }
  document.addEventListener("adminerva:role-ready",event=>setSchoolAdminPresentation(event.detail||{}));
  queueMicrotask(()=>setSchoolAdminPresentation());
  refresh.addEventListener("click",()=>{if(!busy)void load();});

  await auth.authStateReady();
  if(auth.currentUser){
    picker=createTenantSchoolPicker({
      host,status:null,
      onReady:()=>{panel.classList.remove("hidden");void load();},
      onBeforeChange:async()=>{
        if(busy)throw Error("Finish the current attribution decision before switching schools.");
        generation++;items=[];list.replaceChildren();status.textContent="Switching verified school…";
      }
    });
    try{
      const state=await picker.load();
      if(state?.state==="choose_school"){
        panel.classList.remove("hidden");
        status.textContent="Choose an active school to load attribution requests.";
      }
    }catch(error){
      console.warn("Verified school attribution inbox unavailable:",error?.message||error);
    }
  }
}
