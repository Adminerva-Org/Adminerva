/** Compact task navigation for repository and assessment management. */
const root=document.querySelector("[data-educator-hub-nav]");
if(root){
  const current=root.dataset.current||"",layout=root.closest(".av-educator-layout");
  const groups=[
    ["Assessment",[["studio","Assessment studio","assessment-studio.html"],["submissions","Submission inbox","submissions.html"]]],
    ["Review & grade",[["review","Review & grade","repofetch.html"],["gradebook","Gradebook","gradebook.html"]]],
    ["Insights",[["analytics","Analytics","teacher-analytics.html"],["followup","Learning follow-up","learning-follow-up.html"]]]
  ];
  const links=groups.map(([label,items])=>`
    <section class="av-educator-nav-group">
      <h2>${label}</h2>
      ${items.map(([key,title,href])=>`<a href="${href}"${key===current?' aria-current="page"':""}>${title}</a>`).join("")}
    </section>`).join("");
  root.innerHTML=`
    <details class="av-educator-nav-mobile"><summary>Repository Management</summary><div class="av-educator-nav-links">${links}</div></details>
    <div class="av-educator-nav-desktop" aria-label="Repository Management sections">
      <button type="button" class="av-educator-nav-toggle" data-educator-nav-toggle aria-expanded="true">Collapse navigation</button>
      <div data-educator-nav-groups>${links}</div>
    </div>`;
  const toggle=root.querySelector("[data-educator-nav-toggle]");
  const setCollapsed=value=>{
    if(!layout||!toggle)return;
    layout.dataset.navCollapsed=String(Boolean(value));
    toggle.setAttribute("aria-expanded",String(!value));
    toggle.textContent=value?"Show navigation":"Collapse navigation";
    try{localStorage.setItem("Adminerva_repository_nav_collapsed",value?"1":"0");}catch{}
  };
  let collapsed=false;try{collapsed=localStorage.getItem("Adminerva_repository_nav_collapsed")==="1";}catch{}
  setCollapsed(collapsed);
  toggle?.addEventListener("click",()=>setCollapsed(layout?.dataset.navCollapsed!=="true"));
}
