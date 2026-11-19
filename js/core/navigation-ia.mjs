export function buildNavigationIA(ctx){
  const live=(id,label,route,tip="",status="stable")=>[id,label,route,{future:false,tip,status}];
  const needs=(id,label,route,tip="Usable now, but this area needs further development or UX enhancement.")=>
    [id,label,route,{future:false,tip,status:"needs_work"}];
  const old=(id,label,route,tip="Older Adminerva workflow retained because it is still in use.")=>
    [id,label,route,{future:false,tip,status:"needs_work",old:true}];
  const future=(id,label,tip="Future development")=>[id,label,null,{future:true,tip,status:"future"}];
  const group=(name,items)=>({name,items});
  const ws=(id,label,route,description,groups)=>({id,label,route,description,groups});

  const student=scope=>{
    const currentParams=new URLSearchParams(location.search);
    const subjectParams=new URLSearchParams();
    for(const key of ["subjectId","subject","offeringId","legacy"]){
      const value=currentParams.get(key);if(value)subjectParams.set(key,value);
    }
    const withSubject=route=>{
      const query=subjectParams.toString();if(!query)return route;
      return route+(route.includes("?")?"&":"?")+query;
    };
    const hasSubjectContext=subjectParams.has("subjectId")||subjectParams.has("subject")||subjectParams.has("offeringId");
    const streamRoute=hasSubjectContext||currentParams.get("legacy")==="1"
      ?withSubject("student-subject.html")
      :"student-classroom.html";
    const assignments=withSubject("student-assessments.html");
    const grades=scope.hasSchoolStudent?withSubject("school-student-grades.html"):null;
    const projectHub=scope.hasSchoolStudent?withSubject("school-student-projects.html"):"student-dashboard.html";
    const settings=scope.hasSchoolStudent?"school-student-settings.html":"student-settings.html";
    return [
      ws("classroom","Classroom","student-classroom.html","Choose a subject, follow its stream, complete classwork and review results",[
        group("Classroom",[
          needs("subject-stream","Stream",streamRoute,"Subject announcements, newly deployed work, feedback and classroom activity."),
          future("calendar","Calendar","Subject and school deadlines · Future development")
        ]),
        group("Classwork",[
          needs("assignments","Assignments",assignments,"Unified student assignment workspace for current school tasks and existing programming assignments."),
          ...(grades?[live("my-grades","My Grades",grades,"Teacher-released school grades")]:[]),
          future("materials","Materials","Class materials, presentations and e-books · Future development")
        ]),
        group("Projects & Tools",[
          scope.hasSchoolStudent
            ?needs("project-hub","Project Hub",projectHub,"School-scoped projects, repository activity and Adminerva Studio projects.")
            :old("project-hub","Project Hub",projectHub,"Existing repository project workflow retained for current programming classes."),
          ...(!scope.platformTestMode?[
            old("repo-settings","Repository Settings","student-settings.html","Repository/GitHub settings retained for programming assignments that still use GitHub evidence.")
          ]:[])
        ])
      ]),
      ws("games","Games","student-practice.html","Practice challenges and subject learning games",[
        group("Practice",[
          needs("programming","Computer Programming Games","student-practice.html","Active programming arcade with themed games, mission progress, rankings and skill-path filters."),
          future("other-subject-games","Other Subject Games","Science, English, AP, Mathematics, Values and Filipino · Future development"),
          future("quiz-bee","Quiz Bee","General subject quiz competition · Future development")
        ])
      ]),
      ws("laboratory","Laboratory","student-playground.html","Interactive subject laboratories and creation workspaces",[
        group("Create & Experiment",[
          needs("studio","Adminerva Studio","student-playground.html","Browser-based programming IDE and assignment workspace."),
          old("xml-lab","XML Layout Lab","student-xml-lab.html","Older specialized layout laboratory retained for existing activities."),
          future("future-labs","Other Laboratories","Science, AP and language laboratories · Future development")
        ])
      ]),
      ws("student-services","Student Services",settings,"Student information, requests, documents, finance and welfare services",[
        group("My Record",[
          live("student-profile","Profile & School Account",settings),
          future("attendance","Attendance Record"),future("conduct","Conduct Record"),
          future("student-documents","Documents & Certificates","Student records, certificates and credentials · Future development"),
          future("student-clearance","Clearance","School clearance workflow · Future development")
        ]),
        group("Requests & Services",[
          future("document-requests","Document Requests","Certificates, records and registrar requests · Future development"),
          future("student-forms","Forms & Requests","School forms and student service requests · Future development"),
          future("guidance","Guidance & Counseling","Guidance appointments and records · Future development")
        ])
      ]),
      ws("student-other","Other","student-support.html","Support, documentation and policies",[
        group("Support & Information",[
          live("bug","Bug Report","issues.html"),live("help","Help / Wiki","wiki.html"),
          live("policy","Terms, Conditions & Policy","wiki.html#privacy")
        ])
      ])
    ];
  };

  const repository=()=>ws("repository","Repository Management","repository-assessment-studio.html","Existing repository assessment and GitHub workflows",[
    group("Assessment",[
      old("repo-studio","Repository Assessment Studio","repository-assessment-studio.html","OLD repository assessment authoring workflow; retained for current repository-based classes."),
      old("repo-submissions","Submission Inbox","submissions.html","OLD repository submission inbox retained for active repository assignments."),
      old("repo-reclaims","Commit Attribution Requests","reclaim-inbox.html","OLD repository attribution workflow retained for active classes.")
    ]),
    group("Review & Grade",[
      old("repo-review","Review & Grade","repofetch.html","OLD repository review workflow; still operational and in active use."),
      old("repo-gradebook","Gradebook","gradebook.html","OLD repository gradebook retained for active repository assessments."),
      old("repo-investigation","Repository Investigation","repobank.html","OLD repository investigation workflow retained for repository troubleshooting.")
    ]),
    group("OLD Advanced Tools",[
      old("activity-grader","Activity Grader","activity-grader.html","OLD repository activity grader; retained for current grading workflows."),
      old("auto-grader","AutoGrader","grading.html","OLD automated grading interface retained for compatibility."),
      old("learning-follow-up","Learning Follow-up","learning-follow-up.html","OLD repository learning follow-up workflow retained for current records.")
    ])
  ]);

  const personnelWorkspace=scope=>ws("personnel-self-service","Personnel","settings.html","Employment profile, personnel documents and staff self-service",[
    group("My Personnel Record",[
      live("staff-profile","Profile & Account","settings.html"),
      future("employment-record","Employment Record"),future("personnel-documents","My Documents"),
      future("staff-clearance","Clearance"),future("dtr","Attendance / DTR"),
      future("leave","Leave & Requests"),future("workload","Faculty Workload")
    ]),
    group("Compensation & Development",[
      future("payslips","Payslips / Payroll"),future("benefits","Benefits"),
      future("performance","Performance Appraisal"),future("training","Training & Professional Development")
    ])
  ]);

  const schoolAdminWorkspaces=()=>[
    ws("school-admin","School Administration","school-admin.html","School operations, access, academic configuration and policy",[
      group("Operations",[
        live("school-operations","Operations Dashboard","school-admin.html"),
        live("people-access","People & Access","people-access.html"),
        live("academic-config","Academic Configuration","school-academic-configuration.html","Initial setup and new-year academic configuration"),
        live("academic-structure","Manage Academic Structure","school-academic-structure.html","Edit existing years, programs, periods, subjects and sections without changing their stable IDs")
      ]),
      group("Academic Policy",[
        live("grading-policies","Grading Policies","school-grading-schemes.html","School-controlled weights, transmutation and program/subject/section applicability"),
        live("class-record-oversight","Class Record Oversight","school-class-records.html"),
        needs("school-calendar-admin","School Calendar","school-academic-structure.html#academic-calendar","Review school years, academic periods and date conflicts."),
        future("grade-approval","Grade Approval"),future("promotion-policy","Promotion / Retention Policy")
      ]),
      group("School Profile",[
        future("school-profile","School Profile & Campuses"),future("departments","Departments / Faculties"),
        future("school-policies","Policies & Handbooks"),future("school-integrations","Integrations")
      ])
    ]),
    ws("registrar","Registrar & SIS","school-enrollment.html","Student information, enrollment, records and credentials",[
      group("Student Information",[
        live("enrollment","Enrollment & Registration","school-enrollment.html","Standard student registration, section placement and verified account activation."),
        live("student-directory","Student Directory","people-access.html#people"),
        future("student-records","Student Records / 201 Files"),
        future("student-tags","Student Tags / Statuses","Enrollment status, learner classifications and registrar-managed student tags · Future development"),
        future("guardians","Parents / Guardians"),future("admissions","Admissions")
      ]),
      group("Academic Records",[
        future("curriculum","Curriculum Assignment"),future("promotion","Promotion / Retention"),
        future("transcripts","Report Cards / Transcripts"),future("credentials","Certificates & Credentials"),
        future("registrar-clearance","Student Clearance"),future("alumni","Alumni Records")
      ]),
      group("Requests",[
        future("registrar-requests","Document Requests"),future("records-release","Records Release"),
        future("verification","Student Verification / Enrollment Certification")
      ])
    ]),
    ws("finance","Finance","future-workspace.html?workspace=finance","Billing, cashiering, budgets, accounting and school financial operations",[
      group("Student Finance",[
        future("fee-setup","Fee Setup"),future("billing-ledger","Billing & Student Ledgers"),
        future("cashier","Cashier / Payments"),future("receipts","Official Receipts"),
        future("refunds","Refunds / Adjustments"),future("scholarships-admin","Scholarships / Discounts")
      ]),
      group("Accounting & Budget",[
        future("budget","Budgeting"),future("expenses","Expenses / Disbursements"),
        future("accounting","Accounting / General Ledger"),future("collections","Collections"),
        future("finance-reports","Financial Reports")
      ]),
      group("Payroll",[
        future("payroll","Payroll"),future("compensation","Compensation & Benefits")
      ])
    ]),
    ws("hr","HR & Personnel","people-access.html?workspace=hr","Personnel directory, employment records, documents and staff services",[
      group("Personnel",[
        live("staff-directory","Staff Directory / Access","people-access.html"),
        future("employment-files","Personnel 201 Files"),future("contracts","Contracts & Appointments"),
        future("hr-documents","Personnel Documents"),future("staff-clearance-admin","Staff Clearance")
      ]),
      group("Time & Performance",[
        future("staff-dtr","Attendance / DTR"),future("leave-admin","Leave Management"),
        future("faculty-load","Faculty Workload"),future("performance-admin","Performance Appraisal"),
        future("training-admin","Training & Development")
      ]),
      group("Recruitment",[
        future("recruitment","Recruitment / Applicants"),future("onboarding","Staff Onboarding"),
        future("offboarding","Separation / Offboarding")
      ])
    ]),
    ws("health-services","Health & Student Services","future-workspace.html?workspace=health-services","Clinic, guidance, discipline and learner welfare",[
      group("Clinic",[
        future("clinic-dashboard","Clinic Dashboard"),future("health-records","Health Records"),
        future("consultations","Consultations / Visits"),future("medications","Medication Log"),
        future("incidents","Accidents / Incidents"),future("medical-clearance","Medical Clearance")
      ]),
      group("Student Welfare",[
        future("guidance-admin","Guidance & Counseling"),future("discipline","Discipline / Case Records"),
        future("special-needs","Learning Support / Special Needs"),future("emergency","Emergency Contacts")
      ])
    ]),
    ws("operations","Facilities & Services","future-workspace.html?workspace=operations","Facilities, assets, inventory and campus services",[
      group("Facilities",[
        future("rooms","Rooms & Facilities"),future("reservations","Facility Reservations"),
        future("maintenance","Maintenance Requests"),future("utilities","Utilities")
      ]),
      group("Assets & Inventory",[
        future("inventory","Inventory"),future("assets","Asset Management"),
        future("procurement","Procurement / Purchasing"),future("suppliers","Suppliers")
      ]),
      group("Campus Services",[
        future("library-system","Library System"),future("cafeteria","Cafeteria / Canteen"),
        future("transport-admin","Transportation"),future("security","Security / Visitor Management"),
        future("lost-found","Lost & Found")
      ])
    ]),
    ws("communications","Communications","future-workspace.html?workspace=communications","School announcements, messaging, forms and community communications",[
      group("School Communications",[
        future("school-announcements","School Announcements"),future("class-bulletins","Class Bulletin Management"),
        future("messaging","Messaging"),future("email-sms","Email / SMS Broadcast"),
        future("emergency-broadcast","Emergency Broadcast")
      ]),
      group("Engagement",[
        future("forms-surveys","Forms & Surveys"),future("events","Events"),
        future("parent-portal","Parent / Guardian Portal"),future("website-content","School Website Content")
      ])
    ]),
    ws("documents-compliance","Documents & Compliance","future-workspace.html?workspace=documents-compliance","Institutional documents, governance, compliance and audit",[
      group("Documents",[
        future("school-documents","School Document Repository"),future("department-documents","Department Files"),
        future("templates","Document Templates"),future("letters-admin","Letters / Memoranda"),
        future("approvals","Document Approval / Routing")
      ]),
      group("Compliance",[
        future("permits","Permits / Accreditation"),future("government-reports","Government / Regulatory Reports"),
        future("privacy","Data Privacy"),future("audit","Audit Trail / Compliance Review"),
        future("retention","Records Retention")
      ])
    ])
  ];

  const teacher=scope=>{
    const out=[
      ws("analytics","Analytics","teacher-analytics.html","Teaching, class and learning analytics",[
        group("Analytics Dashboard",[
          needs("analytics","Analytics Dashboard","teacher-analytics.html","Active analytics dashboard; broader school analytics and drill-downs still need development."),
          future("class-standing","Class Standing"),
          future("games-analytics","Adminerva Games Analytics"),future("lab-analytics","Adminerva Laboratory Analytics")
        ]),
        group("General Analytics",[
          future("general-analytics","General Analytics"),
          ...(scope.isSchoolAdmin?[future("staff-analytics","Staff Analytics","Admin role · Future development")]:[])
        ])
      ]),
      ws("assessment","Assessment","assessment-studio.html","General assessment authoring, submissions, grading and results",[
        group("Assessment",[
          needs("classroom-stream","Classroom Stream","teacher-classroom.html","Post announcements and class updates to verified subject/section streams."),
          needs("assessment-library","Assessment Studio","assessment-studio.html","Canonical school assessment authoring, sharing, personalization and deployment workspace."),
          needs("assessment-submissions","Submissions","school-gradebook.html?view=submissions","Unified submission inbox for written responses, links, Adminerva Studio projects and GitHub evidence."),
          needs("assessment-review","Review & Grade","school-gradebook.html?view=review","Unified rubric review workflow with private drafts, revision requests and deliberate publication."),
          needs("assessment-results","Assessment Results","school-gradebook.html?view=results","Per-assessment results and published outcomes that can feed the Class Record.")
        ]),
        ...(scope.platformTestMode?[]:[group("Technology / Repository Tools",[
          old("repo-submissions","GitHub Submission Inbox","submissions.html","Specialized repository evidence inbox retained for existing GitHub-based assessments."),
          old("repo-review","GitHub Evidence Review","repofetch.html","Specialized commit and repository evidence inspection for GitHub-based assessments."),
          old("repo-reclaims","Commit Attribution","reclaim-inbox.html","Resolve individual contribution attribution for GitHub evidence."),
          old("repo-investigation","Repository Investigation","repobank.html","Investigate repository history and evidence when needed."),
          old("repo-gradebook","Legacy Repository Gradebook","gradebook.html","Historical repository grading surface retained for existing records."),
          old("activity-grader","Activity Grader","activity-grader.html","Specialized repository activity grading utility."),
          old("auto-grader","AutoGrader","grading.html","Legacy automated repository grading utility."),
          old("learning-follow-up","Learning Follow-up","learning-follow-up.html","Legacy repository learning follow-up records.")
        ])])
      ]),
      ws("grading","Grading","class-record.html","Class records, advisory records and grade administration",[
        group("Grades",[
          needs("class-record","Class Record","class-record.html","Active Class Record; school policy ownership, approval and grade-release workflows are still being expanded."),
          ...(scope.isSchoolAdmin?[
            live("grading-policy","Grading Policies","school-grading-schemes.html","School-controlled weights, transmutation and applicability"),
            live("record-oversight","Class Record Oversight","school-class-records.html")
          ]:[])
        ]),
        group("Advisory",[
          future("attendance","Attendance"),future("conduct","Conduct"),future("advisory-summary","Summary of Grades")
        ]),
        ...(scope.isSchoolAdmin?[group("School Approval",[
          future("grade-approval","Grade Approval","Admin role · Future development"),
          future("school-summary","Summary of Grades","All levels and sections · Admin role · Future development")
        ])]:[])
      ]),
      ws("preparation","Preparation","lesson-planner.html","Teaching plans, materials, schedules and faculty preparation",[
        group("Teaching Preparation",[
          needs("learning-plan","C-map / Learning Plan","lesson-planner.html","Active planning workflow; generation and curriculum alignment continue to be refined."),
          needs("slides","Slides Editor","presentation.html","Active slide workflow; editing and presentation UX still need enhancement."),
          needs("library","Reference Library","library.html","Active reference library; ingestion and organization continue to be improved."),
          needs("schedule","Teaching Timetable","schedule.html","Manage weekly schedules using verified school teaching assignments; legacy schedules remain available where permitted."),future("scope-sequence","Scope and Sequence"),
          future("department-files","Department Files"),future("letters","Letters"),
          ...(scope.isSchoolAdmin?[future("faculty-scheduling","Faculty Scheduling","Admin role · Future development")]:[])
        ])
      ]),
      personnelWorkspace(scope),
      ws("staff-other","Others","issues.html","Staff support and reserved non-teaching modules",[
        group("Staff & Support",[
          future("staff-concerns","Faculty / Staff Concerns"),live("support","Bug Report / Support","issues.html"),
          live("wiki","Help / Wiki","wiki.html"),live("settings","Account & Integrations","settings.html")
        ])
      ])
    ];
    if(scope.isSchoolAdmin)out.push(...schoolAdminWorkspaces());
    return out;
  };

  const system=()=>[
    ws("system-analytics","Analytics","owner-schools.html","Platform-wide analytics and operational intelligence",[
      group("Platform Analytics",[
        needs("users-analytics","Users","admin-analytics.html","Existing administration analytics; needs expansion into the full platform analytics model."),
        live("schools-analytics","Schools","owner-schools.html"),
        future("games-analytics","Games"),future("laboratory-analytics","Laboratory"),
        future("assessment-analytics","Assessments"),future("finance-analytics","Finance"),
        future("usage-analytics","Usage & Performance")
      ])
    ]),
    ws("directory","Directory","system-users.html","Users, schools and platform directory administration",[
      group("Users",[
        live("system-users","Users","system-users.html","Read-only platform account directory with on-demand school membership metadata")
      ]),
      group("Schools",[
        live("system-schools","Schools","owner-schools.html"),live("school-details","School Details","owner-schools.html"),
        future("school-announcement","School Announcement"),future("school-integration","School Integration"),
        future("school-configuration","Configuration")
      ])
    ]),
    ws("system","System","patch-notes.html","Platform operations, configuration and releases",[
      group("Operations",[
        future("alerts","Alerts & Warnings"),live("updates","Updates & Releases","patch-notes.html"),
        future("service-health","Service Health"),future("background-jobs","Background Jobs"),
        future("migrations","Data Migrations"),future("backups","Backups / Recovery")
      ]),
      group("Configuration",[
        future("system-config","Configurations"),future("feature-flags","Feature Flags"),
        future("system-announcement","Announcement"),future("email-templates","Notification Templates")
      ])
    ]),
    ws("platform-governance","Governance & Security","future-workspace.html?workspace=platform-governance","Platform roles, permissions, privacy, audit and compliance",[
      group("Access & Security",[
        future("platform-roles","Roles & Permissions"),future("security-events","Security Events"),
        future("sessions","Sessions / Access Review"),future("audit-log","Platform Audit Log")
      ]),
      group("Governance",[
        future("privacy-governance","Privacy & Data Governance"),future("retention-governance","Retention Policies"),
        future("compliance","Compliance"),future("incident-response","Incident Management")
      ])
    ]),
    ws("platform-integrations","Integrations","future-workspace.html?workspace=platform-integrations","Platform services, connectors and external systems",[
      group("Core Integrations",[
        future("identity","Identity / SSO"),future("github","GitHub"),future("ai","AI Providers"),
        future("email-sms-platform","Email / SMS"),future("payments","Payment Gateways"),
        future("storage","Storage / Backup"),future("api","API / Webhooks")
      ])
    ]),
    ws("platform-support","Support","issues.html","Platform reports, documentation and support operations",[
      group("Support",[
        live("reports","Reports & Support","issues.html"),live("wiki","Help / Wiki","wiki.html"),
        future("knowledge-base","Knowledge Base Management"),future("support-queue","Support Queue")
      ])
    ])
  ];

  let viewRole="";
  try{viewRole=sessionStorage.getItem("Adminerva_platform_view_role")||"";}catch{}
  const platformAdmin=ctx.isPlatformOwner||ctx.isSuperAdmin;
  const systemDefault=platformAdmin&&!viewRole;
  const studentView=ctx.isStudent||viewRole==="student";
  const schoolAdminView=ctx.isSchoolAdmin||viewRole==="schooladmin";
  const teacherView=ctx.hasSchoolTeacher||viewRole==="teacher"||schoolAdminView;
  const modelCtx={...ctx,isSchoolAdmin:schoolAdminView,hasSchoolTeacher:teacherView,
    hasSchoolStudent:ctx.hasSchoolStudent||studentView};

  const workspaces=systemDefault?system():studentView?student(modelCtx):teacher(modelCtx);
  const route=(location.pathname.split("/").pop()||"").toLowerCase();
  const requestedWorkspace=new URLSearchParams(location.search).get("workspace")||"";
  const routePath=value=>String(value||"").split("#")[0].split("?")[0].toLowerCase();
  const routeQueryMatches=value=>{
    const raw=String(value||""),query=raw.includes("?")?raw.split("?")[1].split("#")[0]:"";
    if(!query)return true;
    const expected=new URLSearchParams(query),actual=new URLSearchParams(location.search);
    for(const [key,value] of expected){
      if(key==="view"&&!actual.has("view")&&value==="review")continue;
      if(actual.get(key)!==value)return false;
    }
    return true;
  };
  const itemMatches=item=>item[2]&&routePath(item[2])===route&&routeQueryMatches(item[2]);
  const workspaceMatches=w=>
    (routePath(w.route)===route&&routeQueryMatches(w.route))||w.groups.some(g=>g.items.some(itemMatches));
  const homeRoute=systemDefault?"owner-schools.html":studentView?"student-home.html":
    schoolAdminView?"school-admin.html":"teacher-home.html";
  // School Administration is both the administrator landing page and a real
  // workspace with its own Operations / Academic Policy / School Profile nav.
  // Keep student/teacher home pages as Home, but do not collapse the admin
  // workspace into a generic Home state.
  const isHome=!systemDefault&&routePath(homeRoute)===route&&!requestedWorkspace&&!schoolAdminView;
  const activeWorkspace=isHome?null:(workspaces.find(w=>w.id===requestedWorkspace)||
    workspaces.find(workspaceMatches)||workspaces[0]||null);
  const groups=activeWorkspace?.groups||[];
  const sectionize=definitions=>{
    const byId=new Map(workspaces.map(item=>[item.id,item]));
    const used=new Set(),sections=[];
    for(const definition of definitions){
      const items=definition.ids.map(id=>byId.get(id)).filter(Boolean);
      items.forEach(item=>used.add(item.id));
      if(items.length)sections.push({id:definition.id,label:definition.label,items});
    }
    const remaining=workspaces.filter(item=>!used.has(item.id));
    if(remaining.length)sections.push({id:"other",label:"Other",items:remaining});
    return sections;
  };
  const workspaceSections=systemDefault?sectionize([
      {id:"intelligence",label:"Platform Intelligence",ids:["system-analytics"]},
      {id:"administration",label:"Administration",ids:["directory","system"]},
      {id:"governance",label:"Governance & Ecosystem",ids:["platform-governance","platform-integrations"]},
      {id:"support",label:"Support",ids:["platform-support"]}
    ]):studentView?sectionize([
      {id:"learning",label:"Learning",ids:["classroom","games","laboratory"]},
      {id:"services",label:"Student Services",ids:["student-services"]},
      {id:"support",label:"Support & Information",ids:["student-other"]}
    ]):sectionize([
      {id:"teaching",label:"Teaching",ids:["analytics","assessment","grading","preparation"]},
      {id:"technology",label:"Technology",ids:["repository"]},
      {id:"personnel",label:"My Personnel",ids:["personnel-self-service"]},
      {id:"support",label:"Support",ids:["staff-other"]},
      {id:"school-core",label:"School Operations",ids:["school-admin","registrar","finance","hr"]},
      {id:"school-services",label:"Campus & Student Services",ids:["health-services","operations","communications","documents-compliance"]}
    ]);
  const allItems=workspaces.flatMap(w=>w.groups.flatMap(g=>g.items));
  const currentItem=groups.flatMap(g=>g.items).find(itemMatches)||allItems.find(itemMatches)||null;

  return {
    workspaces,workspaceSections,activeWorkspaceId:activeWorkspace?.id||null,groups,currentItem,
    currentPage:isHome?"Home":currentItem?.[1]||activeWorkspace?.label||"Adminerva",
    currentArea:isHome?"Home":activeWorkspace?.label||"Adminerva",
    currentRoute:isHome?homeRoute:(currentItem?.[2]||activeWorkspace?.route||null),
    workspaceRoute:activeWorkspace?.route||null,
    homeRoute,
    homeLabel:systemDefault?"System Admin":"Home",
    roleLabel:systemDefault?"System administrator":studentView?"Student":
      schoolAdminView?(teacherView?"School administrator · Teacher":"School administrator"):"Teacher",
    systemDefault,studentView,schoolAdminView,platformAdmin
  };
}
