const search=document.getElementById("wikiSearch");
const status=document.getElementById("wikiSearchStatus");
const sections=[...document.querySelectorAll("main section[id]")];
const links=[...document.querySelectorAll("[data-wiki-toc] a")];
function filter(){
  const terms=search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let visible=0;
  for(const section of sections){
    section.hidden=!terms.every(term=>section.textContent.toLowerCase().includes(term));
    if(!section.hidden)visible++;
  }
  status.textContent=terms.length?visible+" matching guides. Clear search to see all topics.":"Choose a topic or search the guide.";
}
search.addEventListener("input",filter);
for(const link of links)link.addEventListener("click",()=>{search.value="";filter();});
document.getElementById("wikiClear")?.addEventListener("click",()=>{search.value="";filter();search.focus();});
filter();
