document.addEventListener("DOMContentLoaded", () => {
  const navContainer = document.getElementById("adminerva-nav");
  if (!navContainer) return;

  const activeModule = navContainer.getAttribute("data-module") || "lesson";
  const activePage = navContainer.getAttribute("data-page") || "planner";

  // Identify Role
  const userRole = localStorage.getItem("Adminerva_Role") || "student";
  const isSuperAdmin = userRole === "superadmin";

  let centerLinks = "";
  let rightSide = "";
  let logoBlock = "";
  let navTabsHTML = "";

  const getStyle = (pageId) =>
    activePage === pageId
      ? "text-white border-b-2 border-cyan-400 pb-1.5 drop-shadow-[0_0_8px_rgba(6,182,212,0.8)] whitespace-nowrap"
      : "text-gray-400 hover:text-cyan-300 transition-colors duration-300 pb-1.5 whitespace-nowrap";

  const isSettingsPage = activePage === "settings";
  const settingsIconStyle = isSettingsPage
    ? "border-cyan-400 text-cyan-50 shadow-[0_0_15px_rgba(6,182,212,0.6)]"
    : "border-cyan-900 hover:border-cyan-400 text-gray-300 hover:text-cyan-50 hover:shadow-[0_0_15px_rgba(6,182,212,0.4)]";

  const settingsIcon = `
        <a href="settings.html" class="bg-gray-800/80 border ${settingsIconStyle} p-2 sm:p-2 rounded transition-all duration-300 flex items-center justify-center mr-2 sm:mr-4" title="Global Settings">
            <span class="text-lg sm:text-xl leading-none">⚙️</span>
        </a>`;

  // Global Report Issue Icon
  const reportIcon = `
        <button onclick="document.getElementById('bug-modal').classList.remove('hidden')" class="bg-gray-800/80 border border-gray-700 hover:border-rose-400 text-gray-400 hover:text-rose-400 p-2 sm:p-2 rounded transition-all duration-300 flex items-center justify-center mr-2 sm:mr-4" title="Report Issue">
            <span class="text-lg sm:text-xl leading-none">🐞</span>
        </button>`;

  // Conditionally add the Admin Hub link to the dropdown if the user is a super admin
  const adminDropdownLink = isSuperAdmin
    ? `
      <a href="users.html" class="block px-4 py-3 text-sm font-bold text-gray-300 hover:bg-cyan-900/30 hover:text-cyan-300 transition-all flex items-center gap-2">
          <span class="text-cyan-500">🛡️</span> Admin Hub
      </a>`
    : "";

  const adminLogoBlock = `
        <div class="relative group cursor-pointer py-1">
            <div class="flex items-center gap-2 sm:gap-3 font-bold transition">
                <img src="assets/New Adminerva logo.png" alt="Adminerva Logo" class="h-8 sm:h-10 w-auto object-contain mix-blend-lighten hover:scale-105 transition-transform duration-300 drop-shadow-[0_0_10px_rgba(6,182,212,0.3)]">
                <span class="tracking-widest font-extrabold text-lg sm:text-2xl bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-400 drop-shadow-md">ADMINERVA</span>
                <span class="text-[10px] text-cyan-500 ml-1 opacity-70 group-hover:opacity-100 transition-opacity hidden sm:inline">▼</span>
            </div>
            <div class="absolute left-0 top-full w-56 sm:w-64 hidden group-hover:block z-[100] pt-3">
                <div class="bg-gray-900/95 backdrop-blur-xl rounded-md shadow-[0_10px_30px_rgba(0,0,0,0.8)] border border-cyan-900/50 overflow-hidden">
                    <div class="px-4 py-2 bg-gray-800/50 border-b border-gray-700/50 text-[10px] font-bold text-cyan-500 uppercase tracking-widest">Adminerva Modules</div>
                    <a href="reporeviewDashboard.html" class="block px-4 py-3 text-sm font-bold text-gray-300 hover:bg-cyan-900/30 hover:text-cyan-300 border-b border-gray-800 transition-all flex items-center gap-2">
                        <span class="text-cyan-500">💻</span> Educator Hub
                    </a>
                    <a href="lesson-planner.html" class="block px-4 py-3 text-sm font-bold text-gray-300 hover:bg-cyan-900/30 hover:text-cyan-300 border-b border-gray-800 transition-all flex items-center gap-2">
                        <span class="text-cyan-500">📘</span> Lesson Planner
                    </a>
                    ${adminDropdownLink}
                </div>
            </div>
        </div>
    `;

  // Student Interactive Dropdown Block
  const studentLogoBlock = `
        <div class="relative group cursor-pointer py-1">
            <div class="flex items-center gap-2 sm:gap-3 font-bold transition">
                <img src="assets/New Adminerva logo.png" alt="Adminerva Logo" class="h-8 sm:h-10 w-auto object-contain mix-blend-lighten hover:scale-105 transition-transform duration-300 drop-shadow-[0_0_10px_rgba(6,182,212,0.3)]">
                <span class="tracking-widest font-extrabold text-lg sm:text-2xl bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-400 drop-shadow-md">ADMINERVA</span>
                <span class="text-[10px] text-cyan-500 ml-1 opacity-70 group-hover:opacity-100 transition-opacity hidden sm:inline">▼</span>
            </div>
            <div class="absolute left-0 top-full w-56 sm:w-64 hidden group-hover:block z-[100] pt-3">
                <div class="bg-gray-900/95 backdrop-blur-xl rounded-md shadow-[0_10px_30px_rgba(0,0,0,0.8)] border border-cyan-900/50 overflow-hidden">
                    <div class="px-4 py-2 bg-gray-800/50 border-b border-gray-700/50 text-[10px] font-bold text-cyan-500 uppercase tracking-widest">Student Modules</div>
                    <a href="student-dashboard.html" class="block px-4 py-3 text-sm font-bold text-gray-300 hover:bg-cyan-900/30 hover:text-cyan-300 border-b border-gray-800 transition-all flex items-center gap-2">
                        <span class="text-cyan-500">📂</span> Project Hub
                    </a>
                    <a href="student-playground.html" class="block px-4 py-3 text-sm font-bold text-gray-300 hover:bg-cyan-900/30 hover:text-cyan-300 transition-all flex items-center gap-2">
                        <span class="text-cyan-500">⚡</span> Code Playground
                    </a>
                </div>
            </div>
        </div>
    `;

  // Student Default Project Hub
  if (activeModule === "student") {
    centerLinks = `
            <a href="student-dashboard.html" class="${getStyle("dashboard")}">Dashboard</a>
            <a href="student-assessments.html" class="${getStyle("assessments")}">Assignments</a>
            <a href="student-settings.html" class="${getStyle("settings")}">Settings</a>
        `;
    rightSide = `
            <div class="flex items-center">
                ${reportIcon}
                <div class="flex flex-col items-end justify-center border-l border-gray-700 pl-3 sm:pl-4 py-1">
                    <button id="signOutBtn" class="text-xs sm:text-sm text-gray-300 hover:text-white font-bold transition leading-tight cursor-pointer">Sign Out</button>
                    <span id="userEmailDisplay" class="text-[9px] sm:text-[10px] text-slate-400 leading-tight truncate max-w-[130px] my-0.5"></span>
                    <span class="text-[8px] sm:text-[9px] font-bold text-cyan-500 uppercase tracking-widest leading-tight">Student</span>
                </div>
            </div>
        `;
    logoBlock = studentLogoBlock;
  }
  // Student Code Playground Module
  else if (activeModule === "student-playground") {
    centerLinks = `
            <a href="student-playground.html" class="${getStyle("ide")}">Live Editor</a>
            <a href="student-xml-sim.html" class="${getStyle("xml")}">Mobile XML Sim</a>
        `;
    rightSide = `
            <div class="flex items-center">
                ${reportIcon}
                <div class="flex flex-col items-end justify-center border-l border-gray-700 pl-3 sm:pl-4 py-1">
                    <button id="signOutBtn" class="text-xs sm:text-sm text-gray-300 hover:text-white font-bold transition leading-tight cursor-pointer">Sign Out</button>
                    <span id="userEmailDisplay" class="text-[9px] sm:text-[10px] text-slate-400 leading-tight truncate max-w-[130px] my-0.5"></span>
                    <span class="text-[8px] sm:text-[9px] font-bold text-cyan-500 uppercase tracking-widest leading-tight">Student</span>
                </div>
            </div>
        `;
    logoBlock = studentLogoBlock;
  }
  // Standard Educator Hub
  else if (
    activeModule === "educator" ||
    activeModule === "repo" ||
    activeModule === "settings"
  ) {
    centerLinks = `
            <a href="reporeviewDashboard.html" class="${getStyle("dashboard")}">Analytics</a>
            <a href="repobank.html" class="${getStyle("repobank")}">RepoBank</a>
            <a href="temp-grading.html" class="${getStyle("activity-grader")}">Manual Grader</a>
            <a href="repofetch.html" class="${getStyle("repofetch")}">RepoFetch</a>
            <a href="submissions.html" class="${getStyle("submissions")}">Submissions</a>
            <a href="contribution-inspector.html" class="${getStyle("contributions")}">Contributions</a>
            <a href="assessment-studio.html" class="${getStyle("studio")}">Assessment Studio</a>
            <a href="gradebook.html" class="${getStyle("gradebook")}">Gradebook</a>
        `;
    rightSide = `
            <div class="flex items-center">
                ${reportIcon}${settingsIcon}
                <div class="flex flex-col items-end justify-center border-l border-gray-700 pl-3 sm:pl-4 h-10">
                    <button id="signOutBtn" class="text-xs sm:text-sm text-gray-300 hover:text-white font-bold transition leading-none py-1 cursor-pointer">Sign Out</button>
                    <span class="text-[8px] sm:text-[10px] font-bold text-cyan-500 uppercase tracking-wider mt-1 leading-none">${isSuperAdmin ? "Super Admin" : "Teacher"}</span>
                </div>
            </div>
        `;
    logoBlock = adminLogoBlock;
  }
  // Dedicated Admin Hub
  else if (activeModule === "admin") {
    centerLinks = `
            <a href="users.html" class="${getStyle("directory")}">Directory</a>
            <a href="issues.html" class="${getStyle("issues")}">Reports</a>
        `;
    rightSide = `
            <div class="flex items-center">
                ${reportIcon}${settingsIcon}
                <div class="flex flex-col items-end justify-center border-l border-gray-700 pl-3 sm:pl-4 h-10">
                    <button id="signOutBtn" class="text-xs sm:text-sm text-gray-300 hover:text-white font-bold transition leading-none py-1 cursor-pointer">Sign Out</button>
                    <!-- Dynamically check role instead of hardcoding -->
                    <span class="text-[8px] sm:text-[10px] font-bold text-cyan-500 uppercase tracking-wider mt-1 leading-none">${isSuperAdmin ? "Super Admin" : "Teacher"}</span>
                </div>
            </div>
        `;
    logoBlock = adminLogoBlock;
  }
  // Lesson Planner Logic
  else if (activeModule === "lesson") {
    centerLinks = `
            <a href="lesson-planner.html" class="${getStyle("planner")}">Curriculum Planner</a>
            <a href="presentation.html" class="${getStyle("presentation")}">Slide Editor</a>
            <a href="schedule.html" class="${getStyle("schedule")}">Teacher's Schedule</a>
            <a href="library.html" class="${getStyle("library")}">Reference Library</a>
        `;
    rightSide = `
            <div class="flex items-center">
                ${reportIcon}${settingsIcon}
                <div class="flex flex-col items-end justify-center border-l border-gray-700 pl-3 sm:pl-4 h-10">
                    <button id="signOutBtn" class="text-xs sm:text-sm text-gray-300 hover:text-white font-bold transition leading-none py-1 cursor-pointer">Sign Out</button>
                    <span class="text-[8px] sm:text-[10px] font-bold text-cyan-500 uppercase tracking-wider mt-1 leading-none">${isSuperAdmin ? "Super Admin" : "Teacher"}</span>
                </div>
            </div>
        `;
    logoBlock = adminLogoBlock;
  } else if (activeModule === "global") {
    logoBlock = `
            <div class="flex items-center gap-2 sm:gap-3 font-bold">
                <img src="assets/New Adminerva logo.png" alt="Adminerva Logo" class="h-8 sm:h-10 w-auto object-contain mix-blend-lighten drop-shadow-[0_0_10px_rgba(6,182,212,0.3)]">
                <span class="tracking-widest font-extrabold text-lg sm:text-2xl bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-400 drop-shadow-md">ADMINERVA</span>
            </div>
        `;
    centerLinks = ``;
    rightSide = `
            <div class="flex items-center">
                ${reportIcon}
                <div class="flex flex-col items-end justify-center border-l border-gray-700 pl-3 sm:pl-4 py-1">
                    <button id="signOutBtn" class="text-xs sm:text-sm text-gray-300 hover:text-white font-bold transition leading-tight cursor-pointer mb-1">Sign Out</button>
                </div>
            </div>
    `;
    navTabsHTML = `
        <div class="bg-slate-800 border-t border-slate-700 px-4 sm:px-6 py-3 flex items-center shadow-md">
            <button onclick="window.history.back()" class="text-cyan-400 hover:text-cyan-300 text-sm font-bold flex items-center gap-2 transition">
                <span class="text-lg leading-none">←</span> Return to Previous Page
            </button>
            <span class="text-slate-500 text-xs font-bold uppercase tracking-widest ml-4 border-l border-slate-600 pl-4 hidden sm:inline-block">
                System Support
            </span>
        </div>
    `;
  }

  navContainer.innerHTML = `
    <nav aria-label="Adminerva main navigation" class="bg-gray-900/95 backdrop-blur-md text-white shadow-[0_4px_20px_rgba(0,0,0,0.5)] relative z-50 border-b border-cyan-900/50 sticky top-0">
        <div class="max-w-screen-2xl mx-auto">
            <!-- Top Row: Always visible -->
            <div class="flex justify-between items-center h-16 px-4 sm:px-6 lg:px-8">
                ${logoBlock}
                <div id="av-desktop-nav" class="hidden lg:flex gap-6 text-sm font-bold tracking-wide items-center">${centerLinks}</div>
                <div class="flex items-center">${rightSide}</div>
            </div>
            
            <!-- Bottom Row: Mobile / Tablet Only (Horizontal Scroll) -->
            ${
              centerLinks
                ? `
            <div id="av-mobile-nav" class="lg:hidden flex overflow-x-auto px-4 pb-3 pt-1 gap-5 text-xs font-bold whitespace-nowrap border-t border-gray-800 scroll-smooth [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                ${centerLinks}
            </div>`
                : ""
            }
        </div>
        ${navTabsHTML}
    </nav>`;


  // Unified teacher/admin information architecture. Student navigation is
  // unchanged. Native <details> supports pointer, keyboard and touch input.
  const groupModules = ["educator", "repo", "settings", "admin", "lesson"];
  if (groupModules.includes(activeModule)) {
    const staffGroups = [
      { name: "Grading", items: [
        ["gradebook", "Gradebook", "gradebook.html"],
        ["repofetch", "RepoFetch / Auto-Check", "repofetch.html"],
        ["submissions", "Submission Inbox", "submissions.html"],
        ["studio", "Assessment Studio", "assessment-studio.html"],
        ["contributions", "Contribution Inspector", "contribution-inspector.html"],
        ["activity-grader", "Manual Grader", "temp-grading.html"]
      ] },
      { name: "Repositories", items: [
        ["repobank", "RepoBank", "repobank.html"]
      ] },
      { name: "Planning", items: [
        ["planner", "Lesson Planner", "lesson-planner.html"],
        ["presentation", "Slide Editor", "presentation.html"],
        ["schedule", "Teacher Schedule", "schedule.html"],
        ["library", "Reference Library", "library.html"]
      ] },
      { name: "Manage", items: [
        ["issues", "Bug Reports", "issues.html"],
        ...(isSuperAdmin ? [["directory", "User Directory", "users.html"]] : []),
        ["settings", "Settings", "settings.html"]
      ] }
    ];
    const analytics = ["dashboard", "Analytics", "reporeviewDashboard.html"];
    const activeGroup = group => group.items.some(item => item[0] === activePage);
    const makeLink = (item, mobile) => {
      const a = document.createElement("a");
      a.href = item[2]; a.textContent = item[1];
      a.className = "block rounded-lg px-3 py-2.5 text-sm font-semibold " +
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400 " +
        (item[0] === activePage
          ? "bg-cyan-900/50 text-cyan-100 border-l-2 border-cyan-400"
          : "text-slate-200 hover:bg-slate-700 hover:text-white") +
        (mobile ? " min-h-11 flex items-center" : "");
      if (item[0] === activePage) a.setAttribute("aria-current","page");
      return a;
    };
    const makeGroup = (group, mobile) => {
      const details = document.createElement("details");
      details.dataset.navGroup = mobile ? "mobile" : "desktop";
      details.className = mobile
        ? "rounded-lg border border-slate-700/80"
        : "relative";
      const summary = document.createElement("summary");
      summary.className = "list-none cursor-pointer select-none font-bold " +
        "rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400 " +
        (mobile
          ? "text-slate-100 text-sm px-3 py-3 min-h-11"
          : "text-sm px-3 py-2 " +
            (activeGroup(group) ? "text-cyan-300 bg-slate-800"
              : "text-slate-200 hover:text-cyan-300 hover:bg-slate-800"));
      summary.textContent = group.name + " ▾";
      summary.setAttribute("aria-label",group.name + " menu");
      details.append(summary);
      const wrapper = document.createElement("div");
      wrapper.className = mobile
        ? "p-2 space-y-1"
        : "absolute left-0 top-full mt-2 w-64 z-[110] bg-slate-900 " +
          "border border-slate-700 shadow-2xl rounded-xl p-2 max-h-[70dvh] overflow-y-auto";
      for (const item of group.items) wrapper.append(makeLink(item,mobile));
      details.append(wrapper);
      if (mobile && activeGroup(group)) details.open = true;
      return details;
    };
    const desktop = navContainer.querySelector("#av-desktop-nav");
    const mobile = navContainer.querySelector("#av-mobile-nav");
    if (desktop) {
      desktop.className = "hidden xl:flex gap-1 items-center shrink-0";
      desktop.replaceChildren(makeLink(analytics,false));
      const menus = staffGroups.map(group => makeGroup(group,false));
      desktop.append(...menus);
      for(const menu of menus) {
        menu.addEventListener("toggle", () => {
          if (menu.open) for (const other of menus) if(other !== menu) other.open = false;
        });
      }
      document.addEventListener("click", event => {
        for(const menu of menus) if(menu.open && !menu.contains(event.target)) menu.open = false;
      });
    }
    if (mobile) {
      mobile.className = "xl:hidden border-t border-slate-700";
      mobile.replaceChildren();
      const details = document.createElement("details");
      details.id = "av-mobile-staff-menu";
      const summary = document.createElement("summary");
      summary.className = "flex items-center justify-between px-4 sm:px-6 py-3 " +
        "font-bold text-sm text-cyan-100 min-h-11 cursor-pointer " +
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400";
      const section = activePage === "dashboard" ? "Analytics" :
        staffGroups.find(group => activeGroup(group))?.name || "Modules";
      summary.textContent = "Menu · " + section + " ▾";
      details.append(summary);
      const panel = document.createElement("div");
      panel.className = "bg-slate-900 border-t border-slate-700 px-3 py-3 " +
        "max-h-[65dvh] overflow-y-auto overscroll-contain space-y-2";
      panel.append(makeLink(analytics,true));
      for(const group of staffGroups) panel.append(makeGroup(group,true));
      details.append(panel); mobile.append(details);
    }
    navContainer.addEventListener("keydown", event => {
      if(event.key !== "Escape") return;
      let closed = false;
      navContainer.querySelectorAll("details[open]").forEach(menu => {
        menu.open = false; closed = true;
      });
      if(closed) event.preventDefault();
    });
  }

  // A single responsive inbox for bug reports, grading alerts and submissions.
  const reportButton = navContainer.querySelector('button[title="Report Issue"]');
  if (reportButton && !document.getElementById("adminerva-notifications")) {
    const mountPoint = document.createElement("div");
    mountPoint.id = "adminerva-notifications";
    reportButton.parentNode.insertBefore(mountPoint, reportButton);
    import("./notifications.mjs")
      .then(module => module.mountNotificationCenter())
      .catch(error => console.warn("Notification center unavailable:", error));
  }

  // Announce active location to assistive technology and keep the selected
  // page visible in the horizontally scrolling mobile navigation.
  navContainer.querySelectorAll('a[class*="border-b-2"]').forEach(link => {
    link.setAttribute("aria-current", "page");
  });
  if (window.matchMedia?.("(max-width: 1023px)").matches) {
    const row = navContainer.querySelector('div[class*="overflow-x-auto"]');
    const active = row?.querySelector('[aria-current="page"]');
    if (row && active) {
      requestAnimationFrame(() => {
        row.scrollLeft = Math.max(0, active.offsetLeft - row.offsetLeft - row.clientWidth / 2 + active.clientWidth / 2);
      });
    }
  }

  document.addEventListener("click", async (e) => {
    const signOutTarget = e.target.closest("#signOutBtn");

    if (signOutTarget) {
      e.preventDefault();
      signOutTarget.textContent = "Signing out...";
      signOutTarget.classList.add("opacity-50", "pointer-events-none");

      try {
        const { getAuth, signOut } =
          await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js");
        const auth = getAuth();
        await signOut(auth);
      } catch (err) {
        console.warn("Sign out background process skipped or failed.", err);
      } finally {
        localStorage.removeItem("Adminerva_Role");
        localStorage.removeItem("Adminerva_Mock_Role");
        localStorage.removeItem("Adminerva_Impersonate");
        window.location.href = "login.html";
      }
    }
  });
});
