import {auth,db} from "../core/firebase-core.js";
import {collection,getDocs,query,where,doc,getDoc,runTransaction,serverTimestamp} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {resolveStaffRole} from "../core/staff-session.mjs?v=2026.10.20.1";
import {createReviewRequests} from "./services/review-requests.mjs?v=2026.10.20.1";
import {createBackoffClient,evaluationJSON} from "./services/request-backoff.mjs?v=2026.10.20.1";
import {repositoryKey,verifiedMemberEvidence,validateOverview,overviewPrompt,overviewFingerprint,collectOverview} from "./services/repobank-model.mjs?v=2026.10.21.1-dev.1";
const field=id=>document.getElementById(id);
let epoch=0,controller=null;
const active=()=>auth.currentUser?.uid;
function add(parent,tag,text,className=""){const node=document.createElement(tag);node.textContent=text;node.className=className;parent.append(node);return node;}
function status(message){field("repobankStatus").textContent=message;}
window.loadRepobankData=async function(){
  const section=field("sectionSelect").value,current=++epoch,uid=active();controller?.abort();controller=new AbortController();const signal=controller.signal;
  if(!section)return;
  field("repobankContainer").replaceChildren();status("Loading group context and approved individual evidence…");
  try{
    const [students,evidence]=await Promise.all([getDocs(query(collection(db,"students"),where("section","==",section))),getDocs(query(collection(db,"assessment_evidence"),where("section","==",section)))]);
    if(current!==epoch||active()!==uid)return;
    const groups=new Map();
    for(const record of students.docs){const student={id:record.id,...record.data()};try{const key=repositoryKey(student.repoUrl);if(!groups.has(key))groups.set(key,{repository:student.repoUrl,members:[]});groups.get(key).members.push(student);}catch{}}
    const records=evidence.docs.map(record=>record.data());
    await Promise.all([...groups].map(async([key,group])=>{
      const card=add(field("repobankContainer"),"article","","bg-white rounded-xl border border-slate-200 p-5 flex flex-col gap-3");
      add(card,"h3",key,"text-lg font-bold");const link=add(card,"a","Open repository","underline text-blue-700");link.href="https://github.com/"+key;link.target="_blank";link.rel="noopener noreferrer";
      const message=add(card,"p","Loading saved context…","text-sm text-slate-500"),ref=doc(db,"repobank","review:"+encodeURIComponent(key));
      let opened=null,draft=null;
      const concept=add(card,"textarea","","border rounded p-3 w-full");concept.rows=3;concept.setAttribute("aria-label","Project concept");
      const feedback=add(card,"textarea","","border rounded p-3 w-full");feedback.rows=4;feedback.setAttribute("aria-label","Group feedback");
      const actions=add(card,"div","","flex flex-wrap gap-2"),evaluate=add(actions,"button","Refresh system overview","av-btn"),save=add(actions,"button","Save reviewed overview","av-btn");
      save.disabled=true;
      const manual=add(actions,"button","Edit manually","av-btn");
      manual.onclick=()=>{if(!signal.aborted){draft=null;save.disabled=false;message.textContent="Manual overview. Review source limitations before saving. Individual contribution records remain separate.";concept.focus();}};
      function stale(){return signal.aborted||epoch!==current||active()!==uid;}
      try{
        const [saved,legacy]=await Promise.all([getDoc(ref),getDoc(doc(db,"repobank",key.replace("/","_")))]);if(stale())return;
        opened=saved.data()?.overview||null;concept.value=opened?.concept||legacy.data()?.concept||"";feedback.value=opened?.feedback||legacy.data()?.feedback||"";
        message.textContent=opened?"Reviewed overview · revision "+opened.revision+" · checkpoint "+(opened.checkpoint?.slice(0,12)||"not recorded"):"Earlier or unverified context. No individual roles are inferred from these notes.";
      }catch{message.textContent="Saved overview could not load. Reload before replacing it.";evaluate.disabled=true;manual.disabled=true;}
      evaluate.onclick=async()=>{
        if(stale())return;evaluate.disabled=true;save.disabled=true;
        const model=localStorage.getItem("Adminerva_ai_model")||"gemini-2.5-flash",keyValue=localStorage.getItem("Adminerva_gemini_token");
        try{
          if(!keyValue)throw Error("Configure an evaluation provider in Settings, or use Edit manually.");
          if(!/^[a-zA-Z0-9._-]+$/.test(model))throw Error("Choose a valid evaluation model.");
          if(!confirm("Send a bounded source sample to the configured evaluation provider for a project overview? No individual contributions or grades will be inferred, saved or published automatically."))return;
          message.textContent="Pinning the current project revision and reading a bounded source sample…";
          const sample=await collectOverview(createReviewRequests({token:localStorage.getItem("Adminerva_github_token"),signal}),group.repository);
          if(stale())return;
          const fingerprint=overviewFingerprint(sample.checkpoint,model);
          if(opened?.fingerprint===fingerprint){message.textContent="Checkpoint and evaluator unchanged. Reusing the reviewed overview; no provider request was sent.";return;}
          const client=createBackoffClient({scope:"evaluation",signal});
          const response=await client.fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent?key="+encodeURIComponent(keyValue),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:overviewPrompt(sample.files)}]}],generationConfig:{responseMimeType:"application/json",temperature:0.2}})});
          const result=validateOverview(await evaluationJSON(response));if(stale())return;
          draft={checkpoint:sample.checkpoint,coverage:sample.coverage,fingerprint,model,origin:"automated-assistance"};concept.value=result.concept;feedback.value=result.feedback;save.disabled=false;
          message.textContent="System overview draft · "+sample.checkpoint.slice(0,12)+" · "+sample.coverage.read+"/"+sample.coverage.eligible+" eligible files sampled; "+sample.coverage.failed+" unavailable"+(sample.coverage.truncated?"; Git tree truncated":"")+". Not a completeness or authorship assessment. Review and save deliberately.";
        }catch(error){if(stale())return;message.textContent=error.message+" Your fields are preserved. Retry after any cooldown or select Edit manually.";evaluate.textContent="Retry with backoff";}
        finally{if(!stale())evaluate.disabled=false;}
      };
      save.onclick=async()=>{
        if(stale())return;save.disabled=true;
        try{
          const content=validateOverview({concept:concept.value,feedback:feedback.value});
          if(!confirm("Save this reviewed project overview? This will not grade students or change evidence approvals."))return;
          const savedOverview=await runTransaction(db,async transaction=>{
            const record=await transaction.get(ref),prior=record.data()?.overview||null;
            if((prior?.revision||0)!==(opened?.revision||0))throw Error("Another reviewer changed this overview. Reload before replacing it.");
            if(stale())throw Error("Account or section changed; reload before saving.");
            const after={...content,...(draft||{origin:"teacher",checkpoint:null,coverage:null,fingerprint:null,model:null}),revision:(prior?.revision||0)+1,reviewedBy:uid,reviewedAt:serverTimestamp()};
            transaction.set(ref,{overview:after},{merge:true});
            return after;
          });
          if(!stale()){opened=savedOverview;draft=null;message.textContent="Reviewed overview saved · revision "+opened.revision+". No evidence or grades changed.";save.disabled=true;}
        }catch(error){if(!stale())message.textContent=error.message;}
        finally{if(!stale())save.disabled=false;}
      };
      add(card,"h4","Verified individual evidence (not inferred roles)","font-bold border-t pt-3");
      for(const student of group.members){
        const detail=add(card,"details"),summary=add(detail,"summary",student.name,"font-semibold cursor-pointer");
        const verified=verifiedMemberEvidence(records,student.id,group.repository);
        if(!verified.length)add(detail,"p","No approved individual verification is available. This is not a zero score or proof of no work.");
        for(const item of verified){add(detail,"p",item.commits.length+" verified contributing commits · assessment "+item.assessmentId+" · checkpoint "+item.checkpoint.slice(0,12)+" · evidence revision "+item.revision);add(detail,"p","Instructor-recorded scope: "+item.scope);if(!item.commits.length)add(detail,"p","No contribution was verified at this checkpoint; shared screens do not confer individual credit.");}
        summary.title="Different assessments and members may have different pinned checkpoints.";
      }
    }));
    if(current===epoch)status(groups.size+" linked groups loaded. Project samples and individually approved evidence are separate; nothing publishes automatically.");
  }catch{if(current===epoch)status("Group context could not load. Retry after checking your access and connection.");}
};
await auth.authStateReady();
if(!await resolveStaffRole(auth.currentUser)){location.replace("login.html");}
else try{
  const students=await getDocs(collection(db,"students"));
  const sections=[...new Set(students.docs.map(record=>record.data().section).filter(Boolean))].sort();
  field("sectionSelect").replaceChildren(...sections.map(section=>new Option(section,section)));
  if(sections.length)await window.loadRepobankData();else status("No linked sections yet.");
}catch{status("Sections could not load. Check your connection and staff permissions.");}
window.addEventListener("pagehide",()=>controller?.abort());
