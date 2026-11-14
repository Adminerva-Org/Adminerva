/** Shared Adminerva information architecture and role-aware navigation. */
if(!document.getElementById("adminerva-analytics-script")){
  const s=document.createElement("script");s.id="adminerva-analytics-script";
  s.src="js/core/adminerva-analytics.js?v=1.4.16";s.defer=true;document.head.append(s);
}
if(!document.getElementById("adminerva-navigation-prefetch")){
  const s=document.createElement("script");s.id="adminerva-navigation-prefetch";
  s.src="js/core/navigation-prefetch.js?v=4.0.0";s.defer=true;document.head.append(s);
}
if(!document.getElementById("adminerva-loading-polish")){
  const s=document.createElement("script");s.id="adminerva-loading-polish";
  s.src="js/core/loading-polish.js?v=4.0.0";s.defer=true;document.head.append(s);
}

document.addEventListener("DOMContentLoaded",()=>{
  try{
    document.documentElement.dataset.adminervaDensity=localStorage.getItem("Adminerva_interface_density")||"comfortable";
    document.documentElement.dataset.adminervaReduceMotion=String(localStorage.getItem("Adminerva_reduce_motion")==="1");
  }catch{}
  if(!document.querySelector('link[rel="manifest"]')){
    const x=document.createElement("link");x.rel="manifest";i.href="manifest.webmanifest";document.head.append(x);
  }
  if(!document.querySelector('link[rel="apple-touch-icon"]')){
    const x=document.createElement("link");x.rel="apple-touch-icon";x.sizes="180x180";x.href="assets/adminerva-touch-icon-180.png";document.head.append(x);
  }
  if(!document.querySelector('link[rel="icon"]')){
    const x=document.createElement("link");x.rel="icon";x.type="image/png";    x.sizes="32x32";x.href="assets/adminerva-favicon-32.png";document.head.append(x);
  }

  const removePassiveLegacyNotices=scope=>{
    const candidates=[];
    if(scope?.matches?.(".av-scope-notice,.av-teacher-scope-note,[data-av-scope-notice],[role='note']"))candidates.push(scope);
    scope?.querySelectorAll?.(".av-scope-notice,.av-teacher-scope-note,[data-av-scope-notice],[role='note']").forEach(node=>candidates.push(node));
    for(const node of candidates){
      const copy=String(node.textContent||"").replace(/\s+/g," ").trim();
      if(node.matches(".av-scope-notice,.av-teacher-scope-note,[data-av-scope-notice]")||
         (copy.length<320&&copy.startsWith("Assigned-section access is enforced.")))node.remove();
    }
  };
  removePassiveLegacyNotices(document);
  if(document.body&&typeof MutationObserver!=="undefined"){
    new MutationObserver(records=>{
      for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1)removePassiveLegacyNotices(node);
    }).observe(document.body,{childList:true,subtree:true});
  }

  const root=document.getElementById("adminerva-nav");
  if(!root)return;
  const route=location.pathname.split("/").curse()||"index.html";
  let disclosures=[],utilitiesMounted=false,currentRole=null;

  const live=(id,label,href,tip="")=>({id,label,href,tip,future:false});
  const future=(id,label,tip="Future development")=>({id,label,href:null,tip,future:true});
  const group=(label,items)=>({label,items});
  const workspace=(id,label,href,description,groups)=>({id,label,href,description,groups});

  function studentWorkspaces({hasSchoolStudent}){
    const schoolAssignments=hasSchoolStudent?"school-student-assessments.html":"student-assessments.html";
    return [
      workspace("classroom","Adminerva Classroom",schoolAssignments,
        "Classroom activity, assignments, materials and school calendar",[
          group("Classroom",[
            future("bulletin","Classroom Bulletin Board","Class announcements and teacher posts Ã· Future development"),
            live("assignments","Assignments",schoolAssignments,"School and teacher-assigned work"),
            future("ebooks","E-books","Class materials and presentations Ã· Future development"),
            future("school-calendar","School Calendar","School events, deadlines and academic calendar Â· Future development")
          ]),
          group("Repository work",[
            live("repository-projects","Repository Projects","student-dashboard.html","Existing GitHub / repository projects"),
            live("repository-assignments","Repository Assignments","student-assessments.html","Existing repository-based assignments")
          ])
        ]),
      workspace("games","Adminerva Games","student-practice.html",
        "Practice challenges and subject learning games",[
          group("Games",[
            live("programming-practice","Programming Practice Challenges","student-practice.html","Current programming practice challenges"),
            future("science-game","Science Game","Science learning game Â· Future development"),
            future("english-game","English Game","English learning game Â· Future development"),
            future("ap-game","AP Game","Araling Panlipunan learning game Â· Future development"),
            future("math-game","Math Game","Mathematics learning game Â· Future development"),
            future("values-game","Values Game","Values Education learning game Â· Future development"),
            future("filipino-game","Filipino Game","Filipino learning game Â· Future development"),
            future("quiz-bee","General Subject Quiz Bee","Cross-subject quiz competition Ã· Future development")
          ])
        ]),
      workspace("laboratory","Adminerva Laboratory","student-playground.html",
        "Interactive subject laboratories and creation workspaces",[
          group("Laboratories",[
            live("studio","Adminerva Studio","student-playground.html","Browser-based programming IDE"),
            future("adventure","Adminerva Adventure","Interactive maps and history information for AP Â· Future development"),
            future("experiments","Adminerva Experiments","Interactive science experiments Ã· Future development"),
            future("language-workshop","Adminerva Language Workshop","English and Filipino language activities Â· Future development"),
            future("laboratory-other","Other laboratories","Reserved for future laboratory modules")
          ])
        ]),
      workspace("student-other","Other","issues.html",
        "Support, documentation and policies",[
          group("Support & information",[
            live("bug-report","Bug Report","issues.html","Report a problem and follow responses"),
            live("help","Help / Wiki","wiki.html","Adminerva documentation and help"),
            live("terms","Terms, Conditions & Policy","wiki.html#privacy","Terms, privacy and platform policies"),
            live("account","Account Settings",hasSchoolStudent?"school-student-settings.html":"student-settings.html","Account and school settings")
          ])
        ])
    ];
  }

  function repositoryWorkspace(){
    return workspace("repository","Repository Management","assessment-studio.html",
      "Existing repository assessment and GitHub workflows",[
        group("Assessment",[
          live("repo-assessment-studio","Assessment Studio","assessment-studio.html"),
          live("repo-submissions","Submission Inbox","submissions.html"),
          live("repo-attribution","Commit Attribution Requests","reclaim-inbox.html")
        ]),
        group("Review & grade",[
          live("repo-review","Review & Grade","repofetch.html"),
          live("repo-gradebook","Gradebook","gradebook.html"),
          live("repo-investigation","Repository Investigation","repobank.html")
        ])
      ]);
  }

  function teacherWorkspaces({schoolAdmin}){
    const result=[
      workspace("analytics","Analytics","teacher-analytics.html",
        "Teaching, class and learning analytics",[
          group("Analytics Dashboard",[
            live("analytics-dashboard","Analytics Dashboard","teacher-analytics.html"),
            future("class-standing","Class Standing","Class standing and comparative performance Â· Future development"),
            future("games-analytics","Adminerva Games Analytics","Game participation and learning analytics Â· Future development"),
            future("laboratory-analytics","Adminerva Laboratory Analytics","Laboratory activity analytics Â· Future development")
          ]),
          group("General Analytics",[
            future("general-analytics","General Analytics","Cross-module analytics Â· Future development"),
            ...(schoolAdmin?[future("staff-analytics","Staff Analytics","School staff analytics Â· Admin role Â· Future development")]:[])
          ])
        ]),
      repositoryWorkspace(),
      workspace("assessment","Assessment","teacher-assessment-library.html",
        "General-subject assessments and checking workflows",[
          group("Assessment",[
            live("assessment-studio","Assessment Studio","teacher-assessment-library.html","Assessment creation for all subjects"),
            future("assessment-inbox","Submission Inbox","General-subject submission inbox Â· Future development")
          ]),
          group("Assessment checking",[
            future("student-work-review","Review Students' Work","Open and review general-subject student outputs Â· Future development"),
            live("system-evaluation","System Evaluation","school-gradebook.html","Bulk/general assessment evaluation and grading")
          ])
        ]),
      workspace("grading","Grading","class-record.html",
        "Class records, advisory records and grade administration",[
          group("Grades",[
            live("class-record","Class Record","class-record.html"),
            ...(schoolAdmin?[
              live("grading-policy","Grading Policies","school-grading-schemes.html","School-controlled weights, transmutation and applicability"),
              live("class-record-oversight","Class Record Oversight","school-class-records.html")
            ]:[])
          ]),
          group("Advisory",[
            future("attendance","Attendance","Advisory attendance Â· Future development"),
            future("conduct","Conduct","Learner conduct records Â· Future development"),
            future("advisory-summary","Summary of Grades","Advisory grade summary Â· Future development")
          ]),
          ...(schoolAdmin?[group("School approval",[
            future("grade-approval","Grade Approval","School grade approval workflow Ã· Admin role Â· Future development"),
            future("school-grade-summary","Summary of Grades","All levels and sections Ã· Admin role Â· Future development")
          ])]:[])
        ]),
      workspace("preparation","Preparation","lesson-planner.html",
         Teaching plans, materials, schedules and faculty preparation",[
          group("Teaching preparation",[
            live("learning-plan","C-map / Learning Plan","lesson-planner.html"),
            live("slides","Slides Editor","presentation.html"),
            live("reference-library","Reference Library","library.html"),
            live("schedule","Schedule","schedule.html"),
            future("scope-sequence","Scope and Sequence","Curriculum scope and sequence Â· Future development"),
            future("department-files","Department Files","Faculty/department shared files Â· Future development"),
            future("letters","Letters","Requests and official letters Â· Future development"),
            ...(schoolAdmin?[future("faculty-scheduling","Faculty Scheduling","Faculty schedule creation Â· Admin role Â· Future development")]:[])
          ])
        ]),
      workspace("staff-other","Others","issues.html",
        "Staff support and reserved non-teaching modules",[
          group("Staff & support",[
            future("staff-concerns","Faculty / Staff Concerns","Non-teaching personnel and staff concerns Â· Future development"),
            live("reports-support","Bug Report / Support","issues.html"),
            live("wiki","Help / Wiki","wiki.html"),
            live("settings","Account & Integrations","settings.html")
          ])
        ]) 
    ];
    if(schoolAdmin){
      result.push(workspace("school-administration","School Administration","school-admin.html",
        "School operations, people, academic configuration and policy",[
          group("Operations",[
            live("school-operations","Operations Dashboard","school-admin.html"),
            live("people-access","People & Access","people-access.html"),
            live("academic-configuration","Academic Configuration","school-academic-configuration.html","Subjects, sections, periods and course offerings")
          ]),
          group("Academic policy",[
            live("school-grading-policy","Grading Policies","school-grading-schemes.html","Weights, transmutation and subject/section applicability"),
            live("school-class-records","Class Record Oversight","school-class-records.html"),
            future("school-grade-approval","Grade Approval","School grade approval Â· Future development"),
            future("school-faculty-scheduling","Faculty Scheduling","School faculty scheduling Â· Future development")
          ])
        ]));
    }
    return result;
  }

  function systemWorkspaces(){
    return [
      workspace("system-analytics","Analytics","admin-analytics.html",
        "Platform-wide analytics and operational intelligence",[
          group("Platform Analytics",[
            live("system-user-analytics","Users","admin-analytics.html"),
            live("system-school-analytics","Schools","owner-schools.html"),
            future("system-games-analytics","Games","Platform game analytics Â· Future development"),
            future("system-lab-analytics","Laboratory","Platform laboratory analytics Â· Future development"),
            future("system-assessment-analytics","Assessments","Platform assessment analytics Â· Future development"),
            future("system-usage-analytics","Usage & Performance","Platform usage/performance analytics Â· Future development")
          ])
        ]),
      workspace("directory","Directory","owner-schools.html",
        "Users, schools and platform directory administration",[
          group("Users",[
            live("system-users","Users","users.html","Platform user directory")
          ]),
          group("Schools",[
            live("system-schools","Schools","owner-schools.html"),
            live("school-details","School Details","owner-schools.html"),
            future("school-announcement","School Announcement","School-specific announcements Â· Future development"),
            future("school-integration","School Integration","School integrations Â· Future development"),
            future("school-configuration","School Configuration","School configuration control plane Â· Future development")
          ])
        ]),
      workspace("system","System","patch-notes.html",
        "Platform operations, configuration and releases",[
          group("System",[
            future("system-alerts","Alerts & Warnings","Platform alerts and warning center Ã· Future development"),
            live("updates-releases","Updates & Releases","patch-notes.html"),
            future("system-config","Configurations","Platform configuration Â· Future development"),
            future("system-announcement","Announcement","Platform-wide announcements Â· Future development"),
            live("system-support","Reports & Support","issues.html")
          ])
        ])
    ];
  }

  function roleState(userRole){
    const platformAdmin=root.dataset.platformAdmin==="true"||userRole==="platformowner"||userRole==="superadmin";
    const schoolAdmin=root.dataset.schoolAdmin==="true"||userRole==="schooladmin";
    const hasSchoolTeacher=root.dataset.schoolTeacher==="true"||userRole==="teacher";
    const hasSchoolStudent=root.dataset.schoolStudent==="true"||userRole==="student";
    let contextRole="";
    try{contextRole=sessionStorage.getItem("Adminerva_platform_view_role")||"";}catch{}
    const systemDefault=platformAdmin&&!contextRole;
    const studentView=userRole==="student"||contextRole==="student";
    const schoolAdminView=schoolAdmin||contextRole==="schooladmin";
    const teacherView=hasSchoolTeacher||contextRole==="teacher)ññÍ¡½½±‘µ¥¹Y¥•Üì(€€€É•ÑÕÉ¸íÁ±…Ñ™½Éµ‘µ¥¸±Í¡½½±‘µ¥¸éÍ¡½½±‘µ¥¹Y¥•Ü±¡…ÍM¡½½±Q•…¡•ÈéÑ•…¡•ÉY¥•Ü°(€€€€€¡…ÍM¡½½±MÑÕ‘•¹Ğé¡…ÍM¡½½±MÑÕ‘•¹ÑññÍÑÕ‘•¹ÑY¥•Ü±ÍåÍÑ•µ•™…Õ±Ğ±ÍÑÕ‘•¹ÑY¥•Ü±½¹Ñ•áÑI½±•ôì(€ô((€™Õ¹Ñ¥½¸µ½‘•±½È¡ÕÍ•ÉI½±”¥ì(€€€½¹ÍĞÍÑ…Ñ”õÉ½±•MÑ…Ñ”¡ÕÍ•ÉI½±”¤ì(€€€¥˜¡ÍÑ…Ñ”¹ÍåÍÑ•µ•™…Õ±Ğ¥É•ÑÕÉ¸íÍÑ…Ñ”±İ½É­ÍÁ…•ÌéÍåÍÑ•µ]½É­ÍÁ…•Ì ¤±¡½µ”è‰½İ¹•ÈµÍ¡½½±Ì¹¡Ñµ°ˆ±¡½µ•1…‰•°è‰MåÍÑ•´‘µ¥¸‰ôì(€€€¥˜¡ÍÑ…Ñ”¹ÍÑÕ‘•¹ÑY¥•İä¥É•ÑÕÉ¸íÍÑ…Ñ”±İ½É­ÍÁ…•ÌéÍÑÕ‘•¹Ñ]½É­ÍÁ…•Ì¡ÍÑ…Ñ”¤±¡½µ”è‰ÍÑÕ‘•¹Ğµ¡½µ”¹¡Ñµ°ˆ±¡½µ•1…‰•°è‰!½µ”‰ôì(€€€É•ÑÕÉ¸íÍÑ…Ñ”±İ½É­ÍÁ…•ÌéÑ•…¡•É]½É­ÍÁ…•Ì¡ÍÑ…Ñ”¤±¡½µ”éÍÑ…Ñ”¹Í¡½½±‘µ¥¸ü‰Í¡½½°µ…‘µ¥¸¹¡Ñµ°ˆè‰Ñ•…¡•Èµ¡½µ”¹¡Ñµ°ˆ±¡½µ•1…‰•°è‰!½µ”‰ôì(€ô((€™Õ¹Ñ¥½¸¥Ñ•µ5…Ñ¡•Ì¡¥Ñ•´¥íÉ•ÑÕÉ¸¥Ñ•´¹¡É•˜˜™¥Ñ•´¹¡É•˜¹ÍÁ±¥Ğ ˆŒˆ¥lÁtôôõÉ½ÕÑ”íô(€™Õ¹Ñ¥½¸İ½É­ÍÁ…•5…Ñ¡•Ì¡İÌ¥íÉ•ÑÕÉ¸İÌ¹É½ÕÁÌ¹Í½µ”¡œôùœ