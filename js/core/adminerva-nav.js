/** Shared, role-aware navigation. Page guards remain responsible for access. */
if(!document.getElementById("adminerva-analytics-script")){
  const analytics=document.createElement("script");
  analytics.id="adminerva-analytics-script";
  analytics.src="js/core/adminerva-analytics.js?v=1.4.16";
  analytics.defer=true;
  document.head.append(analytics);
}
// HTML navigation prefetch is strictly intent-triggered and never reads school data.
if(!document.getElementById("adminerva-navigation-prefetch")){
  const prefetch=document.createElement("script");
  prefetch.id="adminerva-navigation-prefetch";
  prefetch.src="js/core/navigation-prefetch.js?v=4.0.0";
  prefetch.defer=true;
  document.head.append(prefetch);
}
if(!document.getElementById("adminerva-loading-polish")){
  const loaderPolish=document.createElement("script");
  loaderPolish.id="adminerva-loading-polish";
  loaderPolish.src="js/core/loading-polish.js?v=4.0.0";
  loaderPolish.defer=true;
  document.head.append(loaderPolish);
}
document.addEventListener("DOMContentLoaded", () => {
  try{
    document.documentElement.dataset.adminervaDensity=localStorage.getItem("Adminerva_interface_density")||"comfortable";
    document.documentElement.dataset.adminervaReduceMotion=String(localStorage.getItem("Adminerva_reduce_motion")==="1");
  }catch{}
  if(!document.querySelector('link[rel="manifest"]')){
    const manifest=document.createElement("link");manifest.rel="manifest";manifest.href="manifest.webmanifest";document.head.append(manifest);
  }
  if(!document.querySelector('link[rel="apple-touch-icon"]')){
    const icon=document.createElement("link");icon.rel="apple-touch-icon";icon.sizes="180x180";icon.href="assets/adminerva-touch-icon-180.png";document.head.append(icon);
  }
  if(!document.querySelector('link[rel="icon"]')){
    const icon=document.createElement("link");icon.rel="icon";icon.type="image/png";icon.sizes="32x32";icon.href="assets/adminerva-favicon-32.png";document.head.append(icon);
  }
  const removePassiveLegacyNotices = scope => {
    const candidates = [];
    if (scope?.matches?.(".av-scope-notice,.av-teacher-scope-note,[data-av-scope-notice],[role='note']")) candidates.push(scope);
    scope?.querySelectorAll?.(".av-scope-notice,.av-teacher-scope-note,[data-av-scope-notice],[role='note']").forEach(node=>candidates.push(node));
    for (const node of candidates) {
      const text = String(node.textContent||"").replace(/\s+/g," ").trim();
      if (node.matches(".av-scope-notice,.av-teacher-scope-note,[data-av-scope-notice]") ||
          (text.length < 320 && text.startsWith("Assigned-section access is enforced."))) {
        node.remove();
      }
    }
  };
  removePassiveLegacyNotices(document);
  if (document.body && typeof MutationObserver !== "undefined") {
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node.nodeType === 1) removePassiveLegacyNotices(node);
      }
    }).observe(document.body,{childList:true,subtree:true});
  }

  const root = document.getElementById("adminerva-nav");
  if (!root) return;
  let currentRole, disclosures = [], utilitiesMounted = false;
  const renderNavigation = async userRole => {
  // Retain mounted account utilities and their listeners during a verified-role
  // refresh. Only links and menus are rebuilt; notifications subscribe once.
  const accountControls = root.querySelector("#av-account-controls");
  const informationPanel = root.querySelector("#av-information-panel");
  const activeModule = root.getAttribute("data-module") || "lesson";
  const activePage = root.getAttribute("data-page") || "planner";
  const isStudent = userRole === "student" || (!userRole && activeModule.startsWith("student"));
  const isSuperAdmin = userRole === "superadmin";
  const isSchoolAdmin = userRole === "schooladmin" || root.dataset.schoolAdmin === "true";
  const isPlatformOwner = userRole === "platformowner" || root.dataset.platformAdmin === "true";
  const hasSchoolTeacher = root.dataset.schoolTeacher === "true";
  const hasSchoolStudent = root.dataset.schoolStudent === "true";
  const v4OnlyTeacher = root.dataset.v4OnlyTeacher === "true";
  const v4OnlyStudent = root.dataset.v4OnlyStudent === "true";
  const {buildNavigationIA}=await import("./navigation-ia.mjs?v=d63b76e9606a");
  const ia=buildNavigationIA({
    isStudent,isSuperAdmin,isSchoolAdmin,isPlatformOwner,
    hasSchoolTeacher,hasSchoolStudent,v4OnlyTeacher,v4OnlyStudent
  });
  const {groups,currentArea,currentPage,currentRoute,workspaceRoute,homeRoute,homeLabel,roleLabel,
    workspaceSections,activeWorkspaceId}=ia;
  currentRole=ia.systemDefault?"platformowner":ia.studentView?"student":ia.schoolAdminView?"schooladmin":"teacher";
  const escapeHTML = value => String(value??"").replace(/[&<>"']/g, char =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const workspaceHealth=item=>{
    const metas=item.groups.flatMap(group=>group.items).map(entry=>entry[3]||{});
    const allFuture=metas.length>0&&metas.every(meta=>meta.future||meta.status==="future");
    const allOld=metas.length>0&&metas.filter(meta=>!meta.future).length>0&&
      metas.filter(meta=>!meta.future).every(meta=>meta.old===true);
    const needsWork=metas.some(meta=>meta.status==="needs_work"||meta.old===true)||
      (!allFuture&&metas.some(meta=>meta.future||meta.status==="future"));
    return {
      status:allFuture?"future":needsWork?"needs_work":"stable",
      old:allOld,
      tip:allFuture
        ?"Future development: this workspace is reserved in Adminerva but its operational tools are not implemented yet."
        :needsWork
          ?"Needs further development or enhancement. Some tools are active now while other workflow/UI work remains."
          :"Operational workspace."
    };
  };
  const indicatorMarkup=(status,tip)=>status==="stable"?"":
    `<span class="av-dev-indicator av-dev-indicator--${status==="future"?"future":"needs"}" title="${escapeHTML(tip)}" aria-label="${escapeHTML(tip)}"></span>`;
  const oldBadgeMarkup=tip=>`<span class="av-old-badge" title="${escapeHTML(tip||"Older workflow retained for current users.")}">OLD</span>`;
  const workspaceLinkMarkup = item => {
    const active=item.id===activeWorkspaceId,health=workspaceHealth(item);
    return `<a href="${item.route}" class="av-workspace-card${active?" is-active":""}"${active?' aria-current="location"':""}>
      <span class="av-workspace-card-heading">
        <span class="av-workspace-card-title">${escapeHTML(item.label)}</span>
        <span class="av-nav-status-cluster">${health.old?oldBadgeMarkup("OLD workspace retained because existing classes or records still use it."):""}${indicatorMarkup(health.status,health.tip)}</span>
      </span>
      <span class="av-workspace-card-description">${escapeHTML(item.description)}</span>
    </a>`;
  };
  const workspaceGridMarkup=(workspaceSections||[]).map(section=>`
    <section class="av-workspace-section" aria-labelledby="av-workspace-section-${escapeHTML(section.id)}">
      <h3 id="av-workspace-section-${escapeHTML(section.id)}" class="av-workspace-section-title">${escapeHTML(section.label)}</h3>
      <div class="av-workspace-section-grid">
        ${section.items.map(workspaceLinkMarkup).join("")}
      </div>
    </section>`).join("");
  const workspaceAccordionMarkup=(workspaceSections||[]).map(section=>{
    const containsActive=section.items.some(item=>item.id===activeWorkspaceId);
    return `<details class="av-workspace-accordion-section"${containsActive?" open":""}>
      <summary>
        <span>${escapeHTML(section.label)}</span>
        <span class="av-workspace-section-count">${section.items.length}</span>
      </summary>
      <div class="av-workspace-accordion-links">
        ${section.items.map(workspaceLinkMarkup).join("")}
      </div>
    </details>`;
  }).join("");

  root.innerHTML = `
    <nav aria-label="Adminerva main navigation" class="bg-gray-900/95 backdrop-blur-md text-white shadow-lg relative z-50 border-b border-cyan-900/50 sticky top-0">
      <div class="max-w-screen-2xl mx-auto">
        <div class="av-nav-top flex justify-between items-center min-h-14 px-4 sm:px-6 lg:px-8">
          <div class="av-nav-brand flex items-center gap-3 min-w-0">
            <a href="${homeRoute}" class="av-nav-home flex items-center gap-2 min-h-10 rounded-lg" aria-label="Adminerva · ${homeLabel}"${activePage === "home" ? ' aria-current="page"' : ""}>
              <span class="av-brand-mark"><img src="assets/adminerva-owl.png" alt="" width="32" height="32" class="h-8 w-8 object-contain"></span>
              <span class="av-nav-wordmark hidden sm:inline font-extrabold tracking-wide">ADMINERVA</span>
              <span class="av-nav-home-label text-sm font-semibold text-cyan-100">${escapeHTML(homeLabel)}</span>
            </a>
            <details class="av-module-switcher relative group">
              <summary class="av-module-label flex items-center gap-2 list-none cursor-pointer rounded-lg px-3 py-2 min-h-10 text-sm font-bold text-cyan-100 border border-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400" aria-label="Switch workspace">
                <span>Workspaces</span><span aria-hidden="true">▾</span>
              </summary>
              <div class="av-nav-menu-panel av-workspace-menu absolute left-0 top-full mt-2 z-[110] rounded-xl bg-slate-900 border border-slate-600 shadow-2xl">
                <div class="av-workspace-menu-head">
                  <div>
                    <p class="av-workspace-menu-eyebrow">Workspaces</p>
                    <p class="av-workspace-menu-caption">Choose a major Adminerva area.</p>
                  </div>
                </div>
                <div class="av-workspace-grid-view">
                  ${workspaceGridMarkup}
                </div>
                <div class="av-workspace-accordion-view">
                  ${workspaceAccordionMarkup}
                </div>
              </div>
            </details>
          </div>
          <div class="hidden xl:flex items-center gap-1 min-w-0">
            <span class="av-active-workspace px-3 py-2 text-sm font-extrabold text-cyan-300 whitespace-nowrap">${escapeHTML(currentArea)}</span>
            <div id="av-desktop-nav" class="flex gap-1 items-center"></div>
          </div>
          <div id="av-account-controls" class="av-nav-tools flex items-center gap-2">
            <button type="button" title="Report Issue" aria-label="Help and updates" class="min-h-10 min-w-10 rounded-lg border border-slate-600 text-base font-bold hover:bg-slate-800" onclick="const m=document.getElementById('bug-modal');if(m){m.hidden=false;m.classList.remove('hidden')}">?</button>
            <a href="${isStudent ? "student-settings.html" : "settings.html"}" title="Account settings" aria-label="Account settings" class="min-h-10 min-w-10 flex items-center justify-center rounded-lg border border-slate-600 hover:bg-slate-800"><span aria-hidden="true">⚙</span></a>
            <div class="flex flex-col items-end border-l border-slate-600 pl-3 min-w-0">
              <button type="button" id="signOutBtn" class="min-h-6 text-[11px] sm:text-xs text-slate-200 hover:text-white font-bold">Sign out</button>
              <details class="av-account-menu relative">
                <summary class="list-none cursor-pointer text-right rounded px-1 py-0.5 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400" aria-label="Account menu">
                  <span id="userEmailDisplay" class="block text-[10px] text-slate-400 truncate max-w-[150px]"></span>
                  <span class="av-nav-role block text-[10px] text-cyan-300">${roleLabel} ▾</span>
                </summary>
                <div class="av-nav-menu-panel absolute right-0 top-full mt-2 w-56 z-[120] rounded-xl bg-slate-900 border border-slate-600 shadow-2xl p-2 text-left">
                  <a href="issues.html" class="block rounded-lg px-3 py-2 text-sm text-slate-100 hover:bg-slate-800">My reports & support</a>
                  <a href="wiki.html#privacy" class="block rounded-lg px-3 py-2 text-sm text-slate-100 hover:bg-slate-800">Privacy</a>
                  <a data-account-settings href="${isStudent ? "student-settings.html" : "settings.html"}" class="block rounded-lg px-3 py-2 text-sm text-slate-100 hover:bg-slate-800">Settings</a>
                </div>
              </details>
            </div>
          </div>
        </div>
        <div id="av-mobile-nav" class="xl:hidden border-t border-slate-700"></div>
      </div>
    </nav>`;
  if (accountControls) {
    root.querySelector("#av-account-controls").replaceWith(accountControls);
    const roleDisplay = accountControls.querySelector(".av-nav-role");
    if (roleDisplay) roleDisplay.textContent = roleLabel;
    const settings = accountControls.querySelector('a[title="Account settings"]');
    if (settings) settings.href = isStudent ? "student-settings.html" : "settings.html";
    const accountSettings=accountControls.querySelector("[data-account-settings]");
    if(accountSettings)accountSettings.href=isStudent?"student-settings.html":"settings.html";
  }
  if (informationPanel) root.append(informationPanel);
  const emailDisplay = root.querySelector("#userEmailDisplay");
  if (emailDisplay && root.dataset.accountEmail) emailDisplay.textContent = root.dataset.accountEmail;
  const informationSettings = root.querySelector("[data-information-settings]");
  if (informationSettings) informationSettings.href = isStudent ? "student-settings.html" : "settings.html";

  const appendStatus=(row,meta)=>{
    const cluster=document.createElement("span");cluster.className="av-nav-status-cluster";
    if(meta.old){
      const badge=document.createElement("span");badge.className="av-old-badge";badge.textContent="OLD";
      badge.title="Older Adminerva workflow retained because it is still in use.";
      cluster.append(badge);
    }
    const status=meta.future||meta.status==="future"?"future":
      meta.status==="needs_work"||meta.old?"needs_work":"stable";
    if(status!=="stable"){
      const dot=document.createElement("span");
      dot.className="av-dev-indicator av-dev-indicator--"+(status==="future"?"future":"needs");
      dot.title=meta.tip||(status==="future"?"Future development":"Needs further development or enhancement");
      dot.setAttribute("aria-label",dot.title);
      cluster.append(dot);
    }
    if(cluster.childNodes.length)row.append(cluster);
  };
  const makeLink = (item, mobile) => {
    const meta=item[3]||{};
    if(!item[2]||meta.future){
      const disabled=document.createElement("span");
      disabled.className="av-nav-future block rounded-lg px-3 py-2.5 text-sm text-slate-500 cursor-not-allowed"+
        (mobile?" min-h-11 flex items-center":"");
      disabled.setAttribute("aria-disabled","true");
      const row=document.createElement("span");row.className="flex items-center justify-between gap-2 w-full";
      const label=document.createElement("span");label.textContent=item[1];row.append(label);
      appendStatus(row,{...meta,future:true,status:"future"});
      disabled.append(row);return disabled;
    }
    const link=document.createElement("a");
    link.href=item[2];
    if(meta.tip)link.title=meta.tip;
    link.className="av-nav-task-link block rounded-lg px-3 py-2.5 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400 "+
      (item[2]===currentRoute?"bg-cyan-900/50 text-cyan-100 border-l-2 border-cyan-400":"text-slate-200 hover:bg-slate-700 hover:text-white")+
      (mobile?" min-h-11":"");
    const row=document.createElement("span");row.className="flex items-center justify-between gap-2 w-full";
    const label=document.createElement("span");label.textContent=item[1];row.append(label);appendStatus(row,meta);link.append(row);
    if(item[2]===currentRoute)link.setAttribute("aria-current","page");
    return link;
  };
  const isActiveGroup = group => group.items.some(item => item[2]&&item[2]===currentRoute);
  const makeGroup = (group, mobile) => {
    const details=document.createElement("details");
    details.dataset.navGroup=mobile?"mobile":"desktop";
    details.className=mobile?"rounded-lg border border-slate-700/80":"relative";
    const summary=document.createElement("summary");
    summary.className="list-none cursor-pointer select-none font-bold rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400 "+
      (mobile?"text-slate-100 text-sm px-3 py-3 min-h-11":"text-sm px-3 py-2.5 min-h-11 "+
      (isActiveGroup(group)?"text-cyan-300 bg-slate-800":"text-slate-200 hover:text-cyan-300 hover:bg-slate-800"));
    const groupMetas=group.items.map(item=>item[3]||{});
    const groupAllFuture=groupMetas.length>0&&groupMetas.every(meta=>meta.future||meta.status==="future");
    const groupNeeds=groupMetas.some(meta=>meta.status==="needs_work"||meta.old)||
      (!groupAllFuture&&groupMetas.some(meta=>meta.future||meta.status==="future"));
    const summaryLabel=document.createElement("span");summaryLabel.textContent=group.name+" ▾";summary.append(summaryLabel);
    if(groupAllFuture||groupNeeds){
      const dot=document.createElement("span");
      dot.className="av-dev-indicator av-dev-indicator--"+(groupAllFuture?"future":"needs");
      dot.title=groupAllFuture?"Future development":"Contains tools that need further development or enhancement.";
      dot.setAttribute("aria-label",dot.title);summary.append(dot);
    }
    summary.setAttribute("aria-label",group.name+" pages");
    details.append(summary);
    const panel=document.createElement("div");
    panel.className=mobile?"p-2 space-y-1":"av-nav-menu-panel absolute left-1/2 -translate-x-1/2 top-full mt-2 w-64 z-[110] bg-slate-900 border border-slate-600 shadow-2xl rounded-xl p-2 max-h-[70dvh] overflow-y-auto";
    for(const item of group.items)panel.append(makeLink(item,mobile));
    details.append(panel);
    if(mobile&&isActiveGroup(group))details.open=true;
    return details;
  };
  const desktop=root.querySelector("#av-desktop-nav"),mobile=root.querySelector("#av-mobile-nav");
  if(desktop)desktop.replaceChildren(...groups.map(group=>makeGroup(group,false)));
  if(mobile){
    mobile.replaceChildren();
    if(groups.length){
      const details=document.createElement("details");details.id="av-mobile-staff-menu";
      const summary=document.createElement("summary");
      summary.className="flex items-center justify-between px-4 sm:px-6 py-3 font-bold text-sm text-cyan-100 min-h-11 cursor-pointer";
      summary.textContent=currentPage+" · Menu ▾";details.append(summary);
      const panel=document.createElement("div");
      panel.className="av-nav-mobile-panel bg-slate-900 border-t border-slate-700 px-3 py-3 max-h-[65dvh] overflow-y-auto overscroll-contain space-y-2";
      panel.append(...groups.map(group=>makeGroup(group,true)));
      details.append(panel);mobile.append(details);
    }else mobile.hidden=true;
  }

  // Native disclosures support touch and keyboard. Peer menus close each other;
  // nested mobile groups keep the parent menu open.
  disclosures = [...root.querySelectorAll("details")];
  for (const details of disclosures) details.addEventListener("toggle", () => {
    if (!details.open) return;
    for (const other of disclosures) if (other !== details && !other.contains(details) && !details.contains(other)) other.open = false;
  });
  if (utilitiesMounted) return;
  utilitiesMounted = true;
  const reportButton = root.querySelector('button[title="Report Issue"]');
  if (reportButton) import("./information-menu.mjs?v=1.4.0")
    .then(module => {
      module.mountInformationMenu(reportButton, root);
      // The shared support page has data-module="global" for both roles.
      // Its account shortcut must still lead students to student settings.
      const settingsLink = root.querySelector("[data-information-settings]");
      if (settingsLink) settingsLink.href = currentRole === "student" ? "student-settings.html" : "settings.html";
    })
    .catch(() => {
      reportButton.title = "Report Issue";
      reportButton.setAttribute("aria-label", "Report a problem");
    });
  if (reportButton && !document.getElementById("adminerva-notifications")) {
    const mountPoint = document.createElement("div");
    mountPoint.id = "adminerva-notifications";
    reportButton.parentNode.insertBefore(mountPoint, reportButton);
    import("./notifications.mjs?v=1.4.19").then(module => module.mountNotificationCenter())
      .catch(error => console.warn("Notification center unavailable:", error));
  }
  import("./account-context-switcher.mjs?v=1.0.0")
    .then(module=>module.mountAccountContextSwitcher(root))
    .catch(error=>console.warn("Account context switcher unavailable:",error));
  };

  let initialRole = root.dataset.verifiedRole;
  if (!initialRole) try { initialRole = localStorage.getItem("Adminerva_Role"); } catch { /* Presentation only; guards verify access. */ }
  renderNavigation(initialRole);
  // The guard emits this only after verified admission and page routing checks.
  // This event changes presentation; it does not authorize any data operation.
  document.addEventListener("adminerva:role-ready", event => {
    const role = event.detail?.role;
    if (!["student", "teacher", "superadmin", "schooladmin", "platformowner"].includes(role)) return;
    // V4 school/platform flags are written to the nav dataset by the verified
    // auth guard immediately before this event. Always rebuild once so newly
    // granted pilot controls are visible without requiring a reload.
    renderNavigation(role);
  });
  document.addEventListener("click", event => {
    for (const details of disclosures) if (details.open && !details.contains(event.target)) details.open = false;
  });
  const visibleOverlay = element => {
    if (!element || element.hidden || element.classList.contains("hidden")) return false;
    if (element.matches?.('#manualReviewModal[data-inline-review="true"]')) return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  };
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    const overlays = [...document.querySelectorAll(
      'dialog[open], [role="dialog"], [aria-modal="true"], [id$="Modal"], [id$="-modal"]'
    )].filter(visibleOverlay);
    const overlay = overlays.at(-1);
    if (overlay) {
      if (overlay.matches("dialog[open]") && typeof overlay.close === "function") overlay.close();
      else {
        const preferred = overlay.querySelector(
          'button[data-close],button[data-dismiss],button[aria-label*="close" i],button[id*="close" i],button[id*="cancel" i],[data-modal-close]'
        );
        const textual = [...overlay.querySelectorAll("button")].find(button =>
          ["×","✕","close","cancel","dismiss"].includes(button.textContent.trim().toLowerCase())
        );
        const control = preferred || textual;
        if (control) control.click();
        else {
          overlay.classList.add("hidden");
          overlay.hidden = true;
        }
      }
      event.preventDefault();
      return;
    }
    const details = [...disclosures].reverse().find(item => item.open);
    if (!details) return;
    details.open = false;
    details.querySelector("summary")?.focus();
    event.preventDefault();
  }, true);
  import("./site-updates.mjs?v=1.3.0").then(module => module.mountSiteUpdates())
    .catch(error => console.warn("Site update checks unavailable:", error));
  import("./push-notifications.mjs?v=1.4.1").then(module => module.startPushSync())
    .catch(error => console.warn("Device notification sync unavailable:", error));

  root.addEventListener("click", async event => {
    if (event.defaultPrevented) return;
    const button = event.target.closest("#signOutBtn");
    if (!button) return;
    event.preventDefault(); button.textContent = "Signing out…"; button.disabled = true;
    try {
      const [{ getAuth, signOut }] = await Promise.all([
        import("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js"),
        import("./connection-cache.mjs?v=1.3.0").then(module => module.clearConnectionPreferences())
      ]);
      try{const push=await import("./push-notifications.mjs?v=1.4.1");await push.departPushAccount();}catch{}
      await signOut(getAuth());
    } catch (error) { console.warn("Sign out background process skipped or failed.", error); }
    finally {
      try { for (const key of ["Adminerva_Role", "Adminerva_Mock_Role", "Adminerva_Impersonate"]) localStorage.removeItem(key); } catch { /* Continue to login if storage is disabled. */ }
      window.location.href = "login.html";
    }
  });
});