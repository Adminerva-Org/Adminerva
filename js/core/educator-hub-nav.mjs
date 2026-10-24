/** Compact task-based navigation for the educator workspace. */
const root=document.querySelector("[data-educator-hub-nav]");
if(root){
  const current=root.dataset.current||"";
  const groups=[
    ["Teaching",[
      ["home","Overview","teacher-home.html"],
      ["lessons","Lesson planning","lesson-planner.html"],
      ["studio","Assessment studio","assessment-studio.html"]
    ]],
    ["Review & grade",[
      ["submissions","Submission inbox","submissions.html"],
      ["review","Review & grade","repofetch.html"],
      ["gradebook","Gradebook","gradebook.html"]
    ]],
    ["Insights",[
      ["analytics","Analytics","teacher-analytics.html"]
    ]],
    ["Resources",[
      ["schedule","Schedule","schedule.html"],
      ["repobank","Repository bank","repobank.html"],
      ["library","Reference library","library.html"]
    ]]
  ];
  const links=groups.map(([label,items])=>`
    <section class="av-educator-nav-group">
      <h2>${label}</h2>
      ${items.map(([key,title,href])=>`<a href="${href}"${key===current?' aria-current="page"':""}>${title}</a>`).join("")}
    </section>`).join("");
  root.innerHTML=`
    <details class="av-educator-nav-mobile">
      <summary>Teacher workspace</summary>
      <div class="av-educator-nav-links">${links}</div>
    </details>
    <div class="av-educator-nav-desktop" aria-label="Teacher workspace sections">${links}</div>`;
}