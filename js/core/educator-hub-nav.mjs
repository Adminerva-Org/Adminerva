/** Compact task navigation for repository and assessment management. */
const root=document.querySelector("[data-educator-hub-nav]");
if(root){
  const current=root.dataset.current||"";
  const groups=[
    ["Assessment",[["studio","Assessment studio","assessment-studio.html"],["submissions","Submission inbox","submissions.html"]]],
    ["Review & grade",[["review","Review & grade","repofetch.html"],["gradebook","Gradebook","gradebook.html"]]],
    ["Repositories",[["repobank","Repository bank","repobank.html"]]],
    ["Insights",[["analytics","Analytics","teacher-analytics.html"],["followup","Learning follow-up","learning-follow-up.html"]]]
  ];
  const links=groups.map(([label,items])=>`
    <section class="av-educator-nav-group">
      <h2>${label}</h2>
      ${items.map(([key,title,href])=>`<a href="${href}"${key===current?' aria-current="page"':""}>${title}</a>`).join("")}
    </section>`).join("");
  root.innerHTML=`
    <details class="av-educator-nav-mobile"><summary>Repository Management</summary><div class="av-educator-nav-links">${links}</div></details>
    <div class="av-educator-nav-desktop" aria-label="Repository Management sections">${links}</div>`;
}
