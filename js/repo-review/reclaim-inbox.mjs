/** Role-scoped attribution review inbox. Staff claims are not proof of authorship. */
import {auth,db} from "../core/firebase-core.js?v=1.3.0";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {collection,doc,getDoc,getDocs,query,where} from "../core/teaching-firestore.mjs?v=1.3.0";
import {resolveStaffRole} from "../core/staff-session.mjs?v=1.3.10";
import {decideReclaim} from "./services/reclaim-decision.mjs?v=1.3.2";
import {parseRepository,validSha} from "./services/assessment-evidence.mjs?v=1.3.2";

const field=id=>document.getElementById(id);
let items=[],role="",uid="",busy=false,generation=0;
const status=text=>{field("reclaimStatus").textContent=text;};
const add=(parent,tag,text,classes="")=>{const n=document.createElement(tag);n.textContent=String(text??"");if(classes)n.className=classes;parent.append(n);return n;};
function reviewLink(claim){
 const params=new URLSearchParams({section:String(claim.section||""),student:String(claim.studentId||""),
   assessment:String(claim.assessmentId||""),view:"grade",mode:"individual"});
 return "repofetch.html?"+params.toString();
}
function render(){
 const list=field("reclaimItems");list.replaceChildren();
 const filter=field("reclaimFilter").value;
 const visible=items.filter(claim=>filter==="all"||claim.status===filter);
 status(visible.length+" of "+items.length+" attribution request(s) shown. "+
   (role==="admin"?"Administrators can record a decision.":"Only an administrator can adjudicate disputed identities; teachers can inspect and verify the evidence."));
 if(!visible.length){add(list,"p","No requests match this filter.","av-panel text-sm text-slate-600");return;}
 for(const claim of visible){
   const box=add(list,"article","","av-panel");
   const head=add(box,"div","","flex flex-wrap items-center justify-between gap-2");
   add(head,"strong","Commit "+String(claim.sha||"").slice(0,12),"font-mono text-sm text-slate-900");
   add(head,"span",String(claim.status||"unknown").toUpperCase(),"text-xs font-bold tracking-wide text-cyan-800");
   add(box,"p","Student record: "+String(claim.studentId||"")+" · Class: "+String(claim.section||""),
     "mt-2 text-xs text-slate-700 break-words");
   add(box,"p","Detected author: "+String(claim.detectedAuthorName||"Unknown")+
     (claim.detectedAuthorLogin?" (@"+claim.detectedAuthorLogin+")":""),"text-xs text-slate-600");
   const explanation=add(box,"div","","bg-slate-50 rounded-lg border border-slate-200 p-3 mt-2");
   add(explanation,"strong","Student explanation","text-xs");
   add(explanation,"p",claim.explanation||"No explanation supplied.","text-sm whitespace-pre-wrap mt-1");
   if(claim.reviewNote)add(box,"p","Decision note: "+claim.reviewNote,"text-sm text-slate-700 whitespace-pre-wrap mt-2");
   const actions=add(box,"div","","flex flex-wrap items-center gap-3 mt-3");
   const open=add(actions,"a","Open evidence in Review & Grade →","av-secondary-link text-sm");
   open.href=reviewLink(claim);
   try{
     const repo=parseRepository(claim.repository);
     if(validSha(claim.sha)){
       const github=add(actions,"a","Inspect commit diff on GitHub ↗","av-secondary-link text-sm");
       github.href=repo.url+"/commit/"+encodeURIComponent(claim.sha);
       github.target="_blank";github.rel="noopener noreferrer";
     }
   }catch{/* Bad repository metadata never becomes a browser link. */}
   if(claim.status!=="pending"||role!=="admin")continue;
   add(box,"p","Check the actual diff and any other students claiming this SHA before deciding. Approval only confirms the attribution claim; teacher evidence approval is still required.","text-xs text-amber-900 mt-3");
   const form=add(box,"form","","border-t border-slate-200 mt-3 pt-3 grid gap-2");
   const label=add(form,"label","Decision explanation (10–2,000 characters)","font-bold text-sm");
   const reason=add(label,"textarea","","block w-full border border-slate-300 rounded-lg p-3 mt-2 text-sm");
   reason.rows=3;reason.maxLength=2000;reason.minLength=10;reason.required=true;
   reason.placeholder="Describe the inspected files, contribution evidence and reason for this decision.";
   const buttons=add(form,"div","","flex flex-wrap gap-2");
   for(const [decision,text] of [["approved","Approve attribution"],["shared","Shared contribution"],["rejected","Reject request"]]){
     const button=add(buttons,"button",text,"av-secondary-button text-sm");
     button.type="button";
     button.addEventListener("click",async()=>{
       if(busy)return;
       const note=reason.value.trim();
       if(note.length<10){reason.focus();return status("Enter a decision explanation of at least 10 characters.");}
       if(!confirm("Record "+decision+" for commit "+claim.sha.slice(0,12)+"? The decision will be audited. It does not publish a grade."))return;
       busy=true;button.disabled=true;const end=window.beginLoading?.("Recording attribution review…",box)||(()=>{});
       try{
         await decideReclaim({claimId:claim.id,decision,reason:note});
         status("Decision recorded. Open the student's evidence, verify their selected commits and approve the checkpoint before evaluation.");
         await load();
       }catch(error){status("Unable to save decision: "+error.message);}
       finally{busy=false;button.disabled=false;end();}
     });
   }
 }
}
async function load(){
 const user=auth.currentUser,token=++generation;
 if(!user?.uid)return;
 busy=true;field("reclaimRefresh").disabled=true;
 const end=window.beginLoading?.("Loading commit attribution requests…",field("reclaimItems"))||(()=>{});
 status("Checking authorized class requests…");
 try{
   const result=await resolveStaffRole(user);
   if(auth.currentUser?.uid!==user.uid||token!==generation)return;
   if(!["admin","teacher"].includes(result))throw Error("An authorized instructor or administrator is required.");
   role=result;uid=user.uid;
   let snaps=[];
   if(role==="admin")snaps=[await getDocs(collection(db,"commit_reclaims"))];
   else{
     const access=await getDoc(doc(db,"staff_access",String(user.email||"").toLowerCase()));
     if(!access.exists()||access.data().status!=="active")throw Error("Your staff access is unavailable.");
     const sections=[...new Set((access.data().sections||[]).filter(x=>typeof x==="string"&&x))];
     snaps=await Promise.all(sections.map(section=>
       getDocs(query(collection(db,"commit_reclaims"),where("section","==",section)))));
   }
   if(auth.currentUser?.uid!==user.uid||token!==generation)return;
   const found=new Map();for(const snapshot of snaps)for(const record of snapshot.docs)found.set(record.id,{id:record.id,...record.data()});
   items=[...found.values()].sort((a,b)=>(b.createdAt?.toMillis?.()||0)-(a.createdAt?.toMillis?.()||0));
   render();
 }catch(error){if(auth.currentUser?.uid===user?.uid&&token===generation){field("reclaimItems").replaceChildren();status("Could not load attribution requests: "+error.message);}}
 finally{if(token===generation){busy=false;field("reclaimRefresh").disabled=false;end();}else end();}
}
field("reclaimRefresh").addEventListener("click",()=>{if(!busy)void load();});
field("reclaimFilter").addEventListener("change",render);
onAuthStateChanged(auth,user=>{if(!user){generation++;items=[];role="";uid="";field("reclaimItems").replaceChildren();return;}void load();});
