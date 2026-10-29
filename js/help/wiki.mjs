const search=document.getElementById("wikiSearch");
const status=document.getElementById("wikiSearchStatus");
const role=document.getElementById("wikiRole");
const jump=document.getElementById("wikiJump");
const sections=[...document.querySelectorAll(".av-guide-content > section[id]")];
const links=[...document.querySelectorAll("[data-wiki-toc] a")];
const audiences={
  "school-setup":["admin"],"assessment-steps":["student","teacher","admin"],
  "exam-rules":["student","teacher","admin"],evidence:["student","teacher"],
  review:["student","teacher","admin"],lessons:["teacher","admin"],
  analytics:["teacher","admin"],"teacher-workspaces":["teacher","admin"]
};
for(const link of links)jump.add(new Option(link.textContent,link.hash));
function filter(){
  const terms=search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const selected=role.value;
  let visible=0;
  for(const section of sections){
    const roles=audiences[section.id]||["all"];
    const allowed=selected==="all"||roles.includes("all")||roles.includes(selected);
    section.hidden=!allowed||!terms.every(term=>section.textContent.toLowerCase().includes(term));
    if(!section.hidden)visible++;
  }
  for(const link of links){
    const section=document.getElementById(decodeURIComponent(link.hash.slice(1)));
    link.hidden=Boolean(section?.hidden);
  }
  status.textContent=visible?visible+" guides shown. Select a topic or search for a step.":
    "No matching guides. Clear filters to browse every topic.";
}
search.addEventListener("input",filter);
role.addEventListener("change",filter);
const clear=()=>{search.value="";role.value="all";filter();};
for(const link of links)link.addEventListener("click",clear);
jump.addEventListener("change",()=>{
  if(!jump.value)return;
  clear();document.getElementById(jump.value.slice(1))?.scrollIntoView({block:"start"});
  history.replaceState(null,"",jump.value);
});
document.getElementById("wikiClear")?.addEventListener("click",()=>{clear();jump.value="";search.focus();});
filter();
