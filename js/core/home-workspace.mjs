import {auth} from "./firebase-core.js?v=1.3.0";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {sessionDestination} from "./session-destination.mjs?v=1.3.0";
const main=document.querySelector("main"),navigation=document.getElementById("adminerva-nav");
let mounted=false;
function mount(){
  const role=navigation?.dataset.verifiedRole,user=auth.currentUser;
  if(!main||!role||!user||mounted)return;mounted=true;
  if(role==="superadmin"){const title=document.getElementById("staffTitle");if(title)title.textContent="Your school workspace, organized.";}
  const hero=main.querySelector(".av-home-hero");hero?.classList.add("av-home-entrance");
  const controls=document.createElement("section");controls.className="av-home-controls";controls.setAttribute("aria-label","Find a workspace tool");
  controls.innerHTML='<label for="home-tool-search">What do you need to do?</label><input id="home-tool-search" type="search" placeholder="Search tools, practice, feedback, lessons…" autocomplete="off"><p class="av-home-search-status" role="status">Find a tool by name or task.</p>';
  hero?.after(controls);
  const cards=[...main.querySelectorAll("a.av-home-task")];
  const search=controls.querySelector("input"),status=controls.querySelector("[role=status]");
  search.addEventListener("input",()=>{const terms=search.value.toLowerCase().trim().split(/\s+/).filter(Boolean);let shown=0;for(const card of cards){card.hidden=!terms.every(term=>card.textContent.toLowerCase().includes(term));if(!card.hidden)shown++;}status.textContent=terms.length?shown+" matching tools. Clear search to see all tools.":"Find a tool by name or task.";});
  let candidate;try{candidate=sessionStorage.getItem("Adminerva_last_workspace_"+user.uid);}catch{}
  if(candidate){
    const destination=sessionDestination(candidate,{role:role==="superadmin"?"admin":role==="teacher"?"teacher":null,students:role==="student"?[{}]:[]});
    if(!destination.endsWith("-home.html")){
      const resume=document.createElement("section");resume.className="av-home-resume";
      const text=document.createElement("div"),title=document.createElement("strong"),detail=document.createElement("p"),link=document.createElement("a");
      title.textContent="Continue where you left off";detail.textContent="Return to your most recent workspace in this tab.";detail.className="text-sm";text.append(title,detail);
      link.href=destination;link.className="av-primary-button";link.textContent="Continue →";resume.append(text,link);controls.before(resume);
    }
  }
}
onAuthStateChanged(auth,user=>{try{document.documentElement.dataset.motion=user?localStorage.getItem("Adminerva_motion_"+user.uid)||"system":"system";}catch{}mount();});
document.addEventListener("adminerva:role-ready",mount);
mount();
