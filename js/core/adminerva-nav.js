/** Shared, role-aware navigation. Page guards remain responsible for access. */
document.addEventListener("DOMContentLoaded", () => {
  if(!document.querySelector('link[rel="manifest"]')){
    const manifest=document.createElement("link");manifest.rel="manifest";manifest.href="manifest.webmanifest";document.head.append(manifest);
  }
  if(!document.querySelector('link[rel="apple-touch-icon"]')){
    const icon=document.createElement("link");icon.rel="apple-touch-icon";icon.href="assets/New%20Adminerva%20logo.png";document.head.append(icon);
  }
  const root = document.getElementById("adminerva-nav");
  if (!root) return;
  let currentRole, disclosures = [], utilitiesMounted = false;
  const renderNavigation = userRole => {
  // Retain mounted account utilities and their listeners during a verified-role
  // refresh. Only links and menus are rebuilt; notifications subscribe once.
  const accountControls = root.querySelector("#av-account-controls");
  const informationPanel = root.querySelector("#av-information-panel");
  const activeModule = root.getAttribute("data-module") || "lesson";
  const activePage = root.getAttribute("data-page") || "planner";
  const isStudent = userRole === "student" || (!userRole && activeModule.startsWith("student"));
  const isSuperAdmin = userRole === "superadmin";
  currentRole = isStudent ? "student" : isSuperAdmin ? "superadmin" : "teacher";
  const homeRoute = isStudent ? "student-home.html" : "teacher-home.html";
  const homeLabel = isStudent ? "Student Home" : "Staff Home";
  const roleLabel = isStudent ? "Student" : isSuperAdmin ? "Administrator" : "Teacher";

  // Destinations and page labels share one source, including bookmarked tools.
  const studentGroups = {
    student: { name: "Project Hub", items: [
      ["dashboard", "Projects", "student-dashboard.html"],
      ["assessments", "Assignments", "student-assessments.html"],
      ["settings", "Account settings", "student-settings.html"]
    ] },
    "student-practice": { name: "Practice Lab", items: [
      ["practice", "Practice courses", "student-practice.html"],
      ["xml", "XML Lab", "student-xml-lab.html"]
    ] },
    "student-playground": { name: "Code Playground", items: [
      ["ide", "Live editor", "student-playground.html"]
    ] }
  };
  const staffGroups = [
    { name: "Teaching", area: "educator", items: [
      ["dashboard", "Class analytics", "teacher-analytics.html"],
      ["gradebook", "Gradebook", "gradebook.html"],
      ["repofetch", "Review & grade", "repofetch.html"],
      ["studio", "Assessment Studio", "assessment-studio.html"],
      ["practice", "Practice analytics", "practice-analytics.html"]
    ] },
    { name: "Evidence", area: "educator", items: [
      ["submissions", "Submission inbox", "submissions.html"],
      ["evidence", "Assessment evidence", "assessment-evidence-review.html"],
      ["contributions", "Contribution inspector", "contribution-inspector.html"],
      ["group-inspector", "Group inspector", "group-inspector.html"],
      ["repobank", "Repository bank", "repobank.html"]
    ] },
    { name: "More tools", area: "educator", secondary: true, items: [
      ["activity-grader", "Manual activity grader", "activity-grader.html"],
      ["grader", "Repository grader", "grading.html"]
    ] },
    { name: "Planning", area: "lesson", items: [
      ["planner", "Lesson Planner", "lesson-planner.html"],
      ["presentation", "Slide editor", "presentation.html"],
      ["schedule", "Teacher schedule", "schedule.html"],
      ["library", "Reference library", "library.html"]
    ] },
    { name: "School setup", area: "admin", items: isSuperAdmin ? [
      ["analytics", "Administration analytics", "admin-analytics.html"],
      ["directory", "User directory", "users.html"],
      ["sections", "Sections", "manage-sections.html"],
      ["teachers", "Teacher assignments", "teacher-accounts.html"],
      ["programs", "Tracks & pathways", "manage-programs.html"],
      ["subjects", "Subjects", "manage-subjects.html"]
    ] : [] },
    { name: "Account", area: "settings", items: [
      ["settings", "Account & integrations", "settings.html"],
      ["issues", "Reports & support", "issues.html"]
    ] }
  ];
  const area = ["repo", "educator"].includes(activeModule) ? "educator" : activeModule;
  const groups = isStudent ? [] : staffGroups.filter(group => group.items.length &&
    (group.area === area || area === "admin" && group.area === "settings"));
  const studentGroup = studentGroups[activeModule];
  const areaNames = {
    educator: "Educator Hub", lesson: "Lesson Planner", admin: "School administration",
    settings: "Account settings", global: "Reports & support",
    "student-home": "Your workspace", "staff-home": "Your workspace"
  };
  const allItems = isStudent ? Object.values(studentGroups).flatMap(group => group.items)
    : staffGroups.flatMap(group => group.items);
  const currentItem = (studentGroup?.items || groups.flatMap(group => group.items))
    .find(item => item[0] === activePage) || allItems.find(item => item[0] === activePage);
  const currentArea = studentGroup?.name || areaNames[area] || "Adminerva";
  const currentPage = activePage === "home" ? homeLabel
    : activeModule === "global" ? "Reports & support" : currentItem?.[1] || currentArea;
  const currentRoute = activeModule.endsWith("home") ? homeRoute
    : activeModule === "global" ? "issues.html" : currentItem?.[2];
  const workspaceRoute = activeModule.endsWith("home") ? homeRoute
    : activeModule === "global" ? "issues.html"
    : isStudent ? studentGroup?.items[0]?.[2]
    : area === "lesson" ? "lesson-planner.html"
    : area === "admin" ? "users.html"
    : area === "educator" ? "teacher-analytics.html" : null;
  const escapeHTML = value => String(value).replace(/[&<>"']/g, char =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const modules = isStudent ? [
    [homeLabel, homeRoute, "Start here and continue your work"],
    ["Project Hub", "student-dashboard.html", "Projects and assignments"],
    ["Practice Lab", "student-practice.html", "Courses, challenges and XML Lab"],
    ["Code Playground", "student-playground.html", "Write and run code"],
    ["My reports", "issues.html", "Report a problem or follow an update"]
  ] : [
    [homeLabel, homeRoute, "Your teaching workspace"],
    ["Educator Hub", "teacher-analytics.html", "Assessments, evidence and grades"],
    ["Lesson Planner", "lesson-planner.html", "Lessons, slides, schedule and references"],
    ...(isSuperAdmin ? [["School administration", "users.html", "Students, sections and teacher assignments"]] : []),
    ["Reports & support", "issues.html", "Follow reports and get help"]
  ];
  root.innerHTML = `
    <nav aria-label="Adminerva main navigation" class="bg-gray-900/95 backdrop-blur-md text-white shadow-lg relative z-50 border-b border-cyan-900/50 sticky top-0">
      <div class="max-w-screen-2xl mx-auto">
        <div class="av-nav-top flex justify-between items-center min-h-16 px-4 sm:px-6 lg:px-8">
          <div class="av-nav-brand flex items-center gap-3 min-w-0">
            <a href="${homeRoute}" class="av-nav-home flex items-center gap-2 min-h-11 rounded-lg" aria-label="Adminerva · ${homeLabel}"${activePage === "home" ? ' aria-current="page"' : ""}>
              <img src="assets/New Adminerva logo.png" alt="" class="h-9 w-9 object-contain">
              <span class="av-nav-wordmark hidden sm:inline font-extrabold tracking-wide">ADMINERVA</span>
              <span class="av-nav-home-label text-sm font-semibold text-cyan-100">Home</span>
            </a>
            <details class="av-module-switcher relative group">
              <summary class="av-module-label flex items-center gap-2 list-none cursor-pointer rounded-lg px-3 py-2.5 min-h-11 text-sm font-bold text-cyan-100 border border-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400" aria-label="Switch workspace">
                <span>Workspaces</span><span aria-hidden="true">▾</span>
              </summary>
              <div class="av-nav-menu-panel absolute left-0 top-full mt-2 w-72 max-w-[85vw] max-h-[75dvh] overflow-y-auto z-[110] rounded-xl bg-slate-900 border border-slate-600 shadow-2xl p-2">
                <p class="px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-400">${isStudent ? "Student workspaces" : "Staff workspaces"}</p>
                ${modules.map(([label, route, description]) => `<a href="${route}" class="av-nav-workspace-link block rounded-lg px-3 py-3 hover:bg-slate-800 text-slate-100${route === workspaceRoute ? " bg-slate-800" : ""}"${route === workspaceRoute ? ' aria-current="location"' : ""}><strong class="block text-sm">${escapeHTML(label)}</strong><span class="block text-xs text-slate-400 mt-1">${escapeHTML(description)}</span></a>`).join("")}
              </div>
            </details>
          </div>
          <div id="av-desktop-nav" class="hidden xl:flex gap-1 items-center"></div>
          <div id="av-account-controls" class="av-nav-tools flex items-center gap-2">
            <button type="button" title="Report Issue" aria-label="Help and updates" class="min-h-11 min-w-11 rounded-lg border border-slate-600 text-lg font-bold hover:bg-slate-800" onclick="const m=document.getElementById('bug-modal');if(m){m.hidden=false;m.classList.remove('hidden')}">?</button>
            <a href="${isStudent ? "student-settings.html" : "settings.html"}" title="Account settings" aria-label="Account settings" class="min-h-11 min-w-11 flex items-center justify-center rounded-lg border border-slate-600 hover:bg-slate-800"><span aria-hidden="true">⚙</span></a>
            <div class="flex flex-col items-end border-l border-slate-600 pl-3 min-w-0">
              <button type="button" id="signOutBtn" class="min-h-8 text-xs sm:text-sm text-slate-100 hover:text-white font-bold">Sign out</button>
              <span id="userEmailDisplay" class="text-[10px] text-slate-400 truncate max-w-[130px]"></span>
              <span class="av-nav-role text-[10px] text-cyan-300">${roleLabel}</span>
            </div>
          </div>
        </div>
        <div class="av-nav-location flex items-center gap-2 px-4 sm:px-6 lg:px-8 py-2 border-t border-slate-700 text-sm" aria-label="Current location">
          <span class="av-nav-context text-slate-400">${escapeHTML(currentArea)}</span><span aria-hidden="true" class="text-slate-500">/</span>
          <span class="av-nav-page font-semibold text-slate-100">${escapeHTML(currentPage)}</span>
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
  }
  if (informationPanel) root.append(informationPanel);
  const emailDisplay = root.querySelector("#userEmailDisplay");
  if (emailDisplay && root.dataset.accountEmail) emailDisplay.textContent = root.dataset.accountEmail;
  const informationSettings = root.querySelector("[data-information-settings]");
  if (informationSettings) informationSettings.href = isStudent ? "student-settings.html" : "settings.html";

  const makeLink = (item, mobile) => {
    const link = document.createElement("a");
    link.href = item[2]; link.textContent = item[1];
    link.className = "av-nav-task-link block rounded-lg px-3 py-2.5 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400 " +
      (item[2] === currentRoute ? "bg-cyan-900/50 text-cyan-100 border-l-2 border-cyan-400" : "text-slate-200 hover:bg-slate-700 hover:text-white") +
      (mobile ? " min-h-11 flex items-center" : "");
    if (item[2] === currentRoute) link.setAttribute("aria-current", "page");
    return link;
  };
  const isActiveGroup = group => group.items.some(item => item[2] === currentRoute);
  const makeGroup = (group, mobile) => {
    const details = document.createElement("details");
    details.dataset.navGroup = mobile ? "mobile" : "desktop";
    details.className = (mobile ? "rounded-lg border border-slate-700/80" : "relative") + (group.secondary ? " av-nav-secondary" : "");
    const summary = document.createElement("summary");
    summary.className = "list-none cursor-pointer select-none font-bold rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400 " +
      (mobile ? "text-slate-100 text-sm px-3 py-3 min-h-11" : "text-sm px-3 py-2.5 min-h-11 " +
        (isActiveGroup(group) ? "text-cyan-300 bg-slate-800" : "text-slate-200 hover:text-cyan-300 hover:bg-slate-800"));
    summary.textContent = group.name + " ▾";
    summary.setAttribute("aria-label", group.name + " pages");
    details.append(summary);
    const panel = document.createElement("div");
    panel.className = mobile ? "p-2 space-y-1" : "av-nav-menu-panel absolute left-0 top-full mt-2 w-64 z-[110] bg-slate-900 border border-slate-600 shadow-2xl rounded-xl p-2 max-h-[70dvh] overflow-y-auto";
    for (const item of group.items) panel.append(makeLink(item, mobile));
    details.append(panel);
    if (mobile && isActiveGroup(group)) details.open = true;
    return details;
  };
  const desktop = root.querySelector("#av-desktop-nav"), mobile = root.querySelector("#av-mobile-nav");
  const taskItems = studentGroup?.items || [];
  if (desktop) desktop.replaceChildren(...(isStudent ? taskItems.map(item => makeLink(item, false)) : groups.map(group => makeGroup(group, false))));
  if (mobile) {
    mobile.replaceChildren();
    if (taskItems.length || groups.length) {
      const details = document.createElement("details");
      details.id = "av-mobile-staff-menu"; // Retained for existing integration hooks.
      const summary = document.createElement("summary");
      summary.className = "flex items-center justify-between px-4 sm:px-6 py-3 font-bold text-sm text-cyan-100 min-h-11 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400";
      summary.textContent = "Pages · " + currentPage + " ▾";
      details.append(summary);
      const panel = document.createElement("div");
      panel.className = "av-nav-mobile-panel bg-slate-900 border-t border-slate-700 px-3 py-3 max-h-[65dvh] overflow-y-auto overscroll-contain space-y-2";
      if (isStudent) panel.append(...taskItems.map(item => makeLink(item, true)));
      else panel.append(...groups.map(group => makeGroup(group, true)));
      details.append(panel); mobile.append(details);
    } else mobile.hidden = true;
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
  if (reportButton) import("./information-menu.mjs?v=1.3.0")
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
    import("./notifications.mjs?v=1.3.7").then(module => module.mountNotificationCenter())
      .catch(error => console.warn("Notification center unavailable:", error));
  }
  };

  let initialRole = root.dataset.verifiedRole;
  if (!initialRole) try { initialRole = localStorage.getItem("Adminerva_Role"); } catch { /* Presentation only; guards verify access. */ }
  renderNavigation(initialRole);
  // The guard emits this only after verified admission and page routing checks.
  // This event changes presentation; it does not authorize any data operation.
  document.addEventListener("adminerva:role-ready", event => {
    const role = event.detail?.role;
    if (!["student", "teacher", "superadmin"].includes(role)) return;
    if (role !== currentRole) renderNavigation(role);
  });
  document.addEventListener("click", event => {
    for (const details of disclosures) if (details.open && !details.contains(event.target)) details.open = false;
  });
  root.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    const details = event.target.closest?.("details[open]") || disclosures.find(item => item.open);
    if (!details) return;
    details.open = false;
    details.querySelector("summary")?.focus();
    event.preventDefault();
  });
  import("./site-updates.mjs?v=1.3.0").then(module => module.mountSiteUpdates())
    .catch(error => console.warn("Site update checks unavailable:", error));
  import("./push-notifications.mjs?v=1.3.7").then(module => module.startPushSync())
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
      try{const push=await import("./push-notifications.mjs?v=1.3.7");await push.departPushAccount();}catch{}
      await signOut(getAuth());
    } catch (error) { console.warn("Sign out background process skipped or failed.", error); }
    finally {
      try { for (const key of ["Adminerva_Role", "Adminerva_Mock_Role", "Adminerva_Impersonate"]) localStorage.removeItem(key); } catch { /* Continue to login if storage is disabled. */ }
      window.location.href = "login.html";
    }
  });
});
