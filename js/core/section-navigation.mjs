/** Section shortcuts for long document pages; code editors keep their own layout. */
export function mountSectionNavigation(){
  const main=document.querySelector("main");
  if(!main||document.querySelector("[data-wiki-toc],.av-page-jumps")||/playground|presentation|lesson-planner|repofetch|grading\.html/.test(location.pathname))return;
  const headings=[...main.querySelectorAll("h2[id],section > h2,section > header h2")].filter(heading=>!heading.closest("dialog,[role=dialog],.hidden,[hidden]")&&heading.textContent.trim()).slice(0,12);
  if(headings.length<3)return;
  const navigation=document.createElement("nav");navigation.className="av-page-jumps";navigation.setAttribute("aria-label","Sections on this page");
  const title=document.createElement("strong");title.textContent="On this page";navigation.append(title);
  headings.forEach((heading,index)=>{if(!heading.id)heading.id="page-section-"+(index+1);const link=document.createElement("a");link.href="#"+heading.id;link.textContent=heading.textContent.trim();link.addEventListener("click",()=>{heading.tabIndex=-1;heading.focus({preventScroll:true});});navigation.append(link);});
  const hero=main.querySelector(".av-home-hero,.av-doc-hero,header");if(hero)hero.after(navigation);else main.prepend(navigation);
}
