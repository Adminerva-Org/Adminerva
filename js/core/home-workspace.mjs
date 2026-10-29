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
  // Students have a filterable tool gallery; teachers use the shared Ctrl/Cmd+K
  // finder rather than a search form that has no matching cards.
  const cards=[...main.querySelectorAll("a.av-home-task")];
  let controls=null;
  if(cards.length){
    controls=document.createElement("section");controls.className="av-home-controls";controls.setAttribute("aria-label","Find a workspace tool");
    controls.innerHTML='<label for="home-tool-search">Filter your learning tools</label><input id="home-tool-search" type="search" placeholder="Search projects, assignments, practice…" autocomplete="off"><p class="av-home-search-status" role="status" aria-live="polite">Search your learning workspace cards or use Ctrl + K to jump to any linked tool.</p>';
    hero?.after(controls);
    const search=controls.querySelector("input"),status=controls.querySelector("[role=status]");
    search.addEventListener("input",()=>{
      const terms=search.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
      let shown=0;
      for(const card of cards){card.hidden=!terms.every(term=>card.textContent.toLowerCase().includes(term));if(!card.hidden)shown++;}
      status.textContent=terms.length?shown+" matching tools. Clear search to see all tools.":"Search your learning workspace cards or use Ctrl + K to jump to any linked tool.";
    });
  }
  let candidate;try{candidate=sessionStorage.getItem("Adminerva_last_workspace_"+user.uid);}catch{}
  if(candidate){
    const destination=sessionDestination(candidate,{role:role==="superadmin"?"admin":role==="teacher"?"teacher":null,students:role==="student"?[{}]:[]});
    if(!destination.endsWith("-home.html")){
      const resume=document.createElement("section");resume.className="av-home-resume";
      const text=document.createElement("div"),title=document.createElement("strong"),detail=document.createElement("p"),link=document.createElement("a");
      const page=destination.split(/[?#]/)[0];
      const names={
        "student-playground.html":"Adminerva Studio","student-assessments.html":"Assignments","student-dashboard.html":"Project Hub",
        "student-practice.html":"Practice Lab","student-xml-lab.html":"XML Layout Lab",
        "lesson-planner.html":"Lesson Planner","repofetch.html":"Review & Grade",
        "gradebook.html":"Gradebook","assessment-studio.html":"Assessment Studio",
        "submissions.html":"Review Inbox","teacher-analytics.html":"Teaching Analytics",
        "presentation.html":"Presentation Workspace","schedule.html":"Schedule"
      };
      const name=names[page]||"your last workspace";
      title.textContent="Continue: "+name;
      detail.textContent="Pick up where you left off in this browser tab.";detail.className="text-sm";text.append(title,detail);
      link.href=destination;link.className="av-primary-button";link.textContent="Resume →";resume.append(text,link);
      if(controls)controls.before(resume);else hero?.after(resume);
    }
  }
}
onAuthStateChanged(auth,user=>{try{document.documentElement.dataset.motion=user?localStorage.getItem("Adminerva_motion_"+user.uid)||"system":"system";}catch{}mount();});
document.addEventListener("adminerva:role-ready",mount);
mount();
