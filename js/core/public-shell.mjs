/** Public-safe Adminerva header. Never reads school, role or private account data. */
const root=document.getElementById("adminerva-public-nav");
if(root){
  const page=root.dataset.page||"home";
  const guestControls=root.dataset.guestControls==="true";
  const links=[
    ["home","Home","index.html"],
    ["enrollment","Enrollment","enroll.html"],
    ["explore","Explore","guest-home.html"],
    ["opportunities","Opportunities","opportunities.html"],
    ["wiki","Help & guides","wiki.html"],
    ["updates","What's new","patch-notes.html"]
  ];
  const linkMarkup=links.map(([id,label,href])=>
    `<a href="${href}"${page===id?' aria-current="page"':""}>${label}</a>`
  ).join("");
  const guestButton=guestControls?'<button id="guest-signout" type="button" hidden>Sign out</button>':"";
  const action=page==="login"
    ?'<a href="index.html">Back to home</a>'
    :'<a class="av-public-shell__cta" href="login.html?continue=1" data-workspace-return>Sign in →</a>';
  root.innerHTML=`
    <header class="av-public-shell">
      <div class="av-public-shell__inner">
        <a class="av-public-shell__brand" href="index.html" aria-label="Adminerva home">
          <img src="assets/adminerva-owl.png" width="34" height="34" alt="">
          <span><span class="av-public-shell__wordmark">ADMINERVA</span><small>Learning workspace</small></span>
        </a>
        <nav class="av-public-shell__links" aria-label="Public navigation">${linkMarkup}</nav>
        <div class="av-public-shell__actions">${guestButton}${action}</div>
        <details class="av-public-shell__menu">
          <summary aria-label="Open navigation">☰</summary>
          <nav class="av-public-shell__menu-panel" aria-label="Mobile public navigation">
            ${linkMarkup}
            ${guestControls?'<button id="guest-signout-mobile" type="button" hidden>Sign out</button>':""}
            ${action}
          </nav>
        </details>
      </div>
    </header>`;
  const menu=root.querySelector(".av-public-shell__menu");
  document.addEventListener("click",event=>{if(menu?.open&&!menu.contains(event.target))menu.open=false;});
  document.addEventListener("keydown",event=>{if(event.key==="Escape"&&menu?.open&&!event.defaultPrevented){menu.open=false;menu.querySelector("summary")?.focus();event.preventDefault();}});
  menu?.addEventListener("click",event=>{if(event.target.closest("a"))menu.open=false;});
  if(guestControls){
    const desktop=root.querySelector("#guest-signout"),mobile=root.querySelector("#guest-signout-mobile");
    if(desktop&&mobile){
      const observer=new MutationObserver(()=>{mobile.hidden=desktop.hidden;});
      mobile.hidden=desktop.hidden;
      observer.observe(desktop,{attributes:true,attributeFilter:["hidden"]});
      mobile.addEventListener("click",()=>desktop.click());
    }
  }
}
