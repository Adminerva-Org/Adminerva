/** Inline review panels share bounded reads, preload independently and never run other page applications. */
import {db} from "../core/firebase-core.js?v=1.3.0";
import {collection,getDocs,query,where} from "../core/teaching-firestore.mjs?v=1.3.0";
import {createEvidenceReview} from "./assessment-evidence-review.mjs?v=1.4.17";
import {evidenceReviewMarkup} from "./evidence-review-view.mjs?v=1.3.7";
import {parseRepository} from "./services/assessment-evidence.mjs?v=1.3.1";
import {analyzePatchSubstance} from "./services/commit-substance.mjs?v=1.3.0";
import {preloadReviewPanels} from "./services/review-requests.mjs?v=1.3.0";

function add(parent,tag,text){const node=document.createElement(tag);node.textContent=String(text??"");parent.append(node);return node;}
export function mountReviewPanels({root,student,assessment,evidence,requests,onEvidenceChange,signal}){
  const el=id=>root.querySelector("#"+id);
  const panel=el("integratedEvidencePanel");
  panel.innerHTML=evidenceReviewMarkup;
  const controller=createEvidenceReview({root:panel,inlineContext:{student,assessment},requests,onChange:onEvidenceChange,authoritativeInitialRecord:true});
  const repo=parseRepository(student.repoUrl),api="/repos/"+encodeURIComponent(repo.owner)+"/"+encodeURIComponent(repo.repo);
  let current=evidence,roster=[],records=new Map(),generation=0;
  function groupRows(){
    const box=el("integratedGroupSummary");box.replaceChildren();
    for(const member of roster){
      let same=false;try{same=parseRepository(member.repoUrl).url.toLowerCase()===repo.url.toLowerCase();}catch{}
      if(!same)continue;
      const record=records.get(member.id),verified=record?.verifiedContributionCommits;
      add(box,"p",(member.name||member.id)+": "+(record?.status||"No evidence submitted")+" · "+
        (Array.isArray(verified)?verified.length+" independently verified contributing commits":"Individual contribution not yet verified"));
    }
    add(box,"p","Members may have different checkpoints. Shared files and activity counts do not prove individual work; missing submissions do not prove no work.").className="text-xs text-amber-900";
  }
  async function group(){
    const [students,submissions]=await Promise.all([
      getDocs(query(collection(db,"students"),where("section","==",student.section))),
      getDocs(query(collection(db,"assessment_evidence"),where("assessmentId","==",assessment.id)))
    ]);
    if(signal.aborted)return;
    roster=students.docs.map(item=>({id:item.id,...item.data()}));
    records=new Map(submissions.docs.map(item=>[item.data().studentId,item.data()]));groupRows();
  }
  async function history(){
    const opened=current,sequence=generation;
    const ref=opened?.checkpointSha;
    const commits=await requests.json(api+"/commits?per_page=100&page=1"+(ref?"&sha="+encodeURIComponent(ref):""));
    if(signal.aborted||sequence!==generation)return;
    if(!Array.isArray(commits))throw Error("GitHub returned invalid history");
    const box=el("integratedGroupHistory");box.replaceChildren();
    add(box,"p",ref?"History pinned to checkpoint "+ref.slice(0,12)+". Up to 100 commits; not an authorship or completeness verdict.":"Recent repository history only; no student checkpoint has been submitted.");
    for(const commit of commits){
      const row=add(box,"details","");row.className="border rounded p-2 mt-2";
      add(row,"summary",String(commit.sha||"").slice(0,12)+" · "+String(commit.commit?.message||"No message").split("\n")[0]);
      add(row,"p","Detected Git identity: "+(commit.author?.login||commit.commit?.author?.name||"Unknown")+". Requires independent verification.");
    }
    if(commits.length===100)add(box,"p","History sample reached 100 commits. Older work is not absent; use the preserved standalone inspector for broader history.");
  }
  async function contributions(){
    const opened=current,sequence=generation;
    const results=await Promise.all((opened?.selectedCommits||[]).map(async sha=>{
      try{return {sha,detail:await requests.json(api+"/commits/"+sha+"?per_page=100")};}
      catch(error){return {sha,error:error.message};}
    }));
    if(signal.aborted||sequence!==generation)return;
    const box=el("integratedContributionSummary");box.replaceChildren();
    add(box,"p","Linked account: "+(student.githubUsername||"Not linked")+". Detected identity and diff substance are investigation aids, not verified authorship.");
    if(!results.length)add(box,"p","No selected commits yet. Historical discovery is available in evidence review.");
    for(const result of results){
      const row=add(box,"div","");row.className="border rounded p-3 mt-2";
      add(row,"strong",result.sha.slice(0,12)+" · "+((current?.verifiedContributionCommits||[]).includes(result.sha)?"Instructor verified":"Not independently verified"));
      if(result.error){add(row,"p","Diff unavailable: "+result.error);continue;}
      add(row,"p","Detected GitHub account: "+(result.detail.author?.login||"Unlinked")+"; Git author: "+(result.detail.commit?.author?.name||"Unknown"));
      const files=result.detail.files||[];
      add(row,"p",files.length+" changed files returned"+(files.length>=100?"; file list may be incomplete":"")+". Merge commits require manual attribution.");
      for(const file of files.slice(0,30)){
        const analysis=analyzePatchSubstance(file.patch||"",file.filename);
        add(row,"p",file.filename+" · "+analysis.reason+". This heuristic does not establish authorship.");
      }
    }
  }
  async function run(tasks){
    const ends=new Map();
    const boxes={evidence:panel,group:el("integratedGroupSummary"),history:el("integratedGroupHistory"),contributions:el("integratedContributionSummary")};
    const wrapped=Object.fromEntries(Object.entries(tasks).map(([name,load])=>[name,async()=>{
      boxes[name].setAttribute("aria-busy","true");ends.set(name,window.beginLoading?.("Loading review "+name+"…",boxes[name])||(()=>{}));
      try{return await load();}finally{ends.get(name)();boxes[name].setAttribute("aria-busy","false");}
    }]));
    return preloadReviewPanels(wrapped,{signal,onError:(name,error)=>{boxes[name].replaceChildren();add(boxes[name],"p","Could not load "+name+": "+error.message+". Other review panels remain available. Use Reload checkpoint / grade status to retry.");}});
  }
  const ready=run({evidence:()=>controller.load(evidence),group,history,contributions});
  return {ready,startAttributionOverride:()=>controller.startAttributionOverride(),focusReview:()=>controller.focusReview(),hasUnsavedReview:()=>controller.hasUnsavedChanges(),destroy:()=>controller.destroy(),updateEvidence(record){
    current=record;generation++;if(record)records.set(student.id,record);else records.delete(student.id);
    if(roster.length)groupRows();void run({history,contributions});
  }};
}
