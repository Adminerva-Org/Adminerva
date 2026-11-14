export function buildNavigationIA(ctx){
  const live=(id,label,route,tip="")=>[id,label,route,{future:false,tip}];
  const future=(id,label,tip="Future development")=>[id,label,null,{future:true,tip}];
  const group=(name,items)=>({name,items});
  const ws=(id,label,route,description,groups)=>({id,label,route,description,groups});

  const student=scope=>{
    const assignments=scope.hasSchoolStudent?"school-student-assessments.html":"student-assessments.html";
    const grades=scope.hasSchoolStudent?"school-student-grades.html":null;
    const settings=scope.hasSchoolStudent?"school-student-settings.html":"student-settings.html";
    return [
      ws("classroom","Adminerva Classroom",assignments,"Classroom activity, assignments, materials, grades and school calendar",[
        group("Classroom",[
          future("bulletin","Classroom Bulletin Board","Class announcements and teacher posts · Future development"),
          live("assignments","Assignments",assignments,"School and teacher-assigned work"),
          ...(grades?[live("my-grades","My Grades",grades,"Teacher-released school grades")]:[]),
          future("ebooks","E-books","Class materials and presentations · Future development"),
          future("calendar","School Calendar","School events, deadlines and academic calendar · Future development")
        ]),
        group("Repository work",[
          live("repo-projects","Repository Projects","student-dashboard.html","Existing GitHub / repository projects"),
          live("repo-assignments","Repository Assignments","student-assessments.html","Existing repository-based assignments")
        ])
      ]),
      ws("games","Adminerva Games","student-practice.html","Practice challenges and subject learning games",[
        group("Games",[
          live("programming","Programming Practice Challenges","student-practice.html"),
          future("science","Science Game"),future("english","English Game"),future("ap","AP Game"),
          future("math","Math Game"),future("values","Values Game"),future("filipino","Filipino Game"),
          future("quiz-bee","General Subject Quiz Bee")
        ])
      ]),
      ws("laboratory","Adminerva Laboratory","student-playground.html","Interactive subject laboratories and creation workspaces",[
        group("Laboratories",[
          live("studio","Adminerva Studio","student-playground.html","Browser-based programming IDE"),
          future("adventure","Adminerva Adventure","Maps and history information for AP subjects · Future development"),
          future("experiments","Adminerva Experiments","Science subject experiments · Future development"),
          future("language","Adminerva Language Workshop","English and Filipino language workshop · Future development"),
          future("lab-other","Other Laboratories","Reserved for future subject laboratories")
        ])
      ]),
      ws("student-services","Student Services",settings,"Student information, requests, documents, finance and welfare services",[
        group("My Record",[
          live("student-profile","Profile & School Account",settings),
          future("attendance","Attendance Record"),future("conduct","Conduct Record"),
          future("student-documents","Documents & Certificates","Student records, certificates and credentials · Future development"),
          future("student-clearance","Clearance","School clearance workflow · Future development")
        ]),
        group("Requests",[
          future("document-requests","Document Requests","Certificates, records and registrar requests · Future development"),
          future("student-forms","Forms & Requests","School forms and student service requests · Future development"),
          future("guidance","Guidance & Counseling","Guidance appointments and records · Future development")
        ]),
        group("School Services",[
          future("billing","Billing & Payments","Student billing and payment history · Future development"),
          future("scholarships","Scholarships & Aid"),
          future("clinic","Clinic / Health Record","School clinic and health information · Future development"),
          future("library-account","Library Account"),
          future("canteen-account","Cafeteria / Canteen Account"),
          future("transport","Transportation")
        ])
      ]),
      ws("student-other","Other","issues.html","Support, documentation and policies",[
        group("Support & Information",[
          live("bug","Bug Report","issues.html"),live("help","Help / Wiki","wiki.html"),
          live("policy","Terms, Conditions & Policy","wiki.html#privacy")
        ])
      ])
    ];
  };

  const repository=()=>ws("repository","Repository Management","assessment-studio.html","Existing repository assessment and GitHub workflows",[
    group("Assessment",[
      live("repo-studio","Assessment Studio","assessment-studio.html"),
      live("repo-submissions","Submission Inbox","submissions.html"),
      live("repo-reclaims","Commit Attribution Requests","reclaim-inbox.html")
    ]),
    group("Review & Grade",[
      live("repo-review","Review & Grade","repofetch.html"),
      live("repo-gradebook","Gradebook","gradebook.html"),
      live("repo-investigation","Repository Investigation","repobank.html")
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
        live("academic-config","Academic Configuration","school-academic-configuration.html","Academic years, programs, periods, subjects, sections and course offerings")
      ]),
      group("Academic Policy",[
        live("grading-policies","Grading Policies","school-grading-schemes.html","School-controlled weights, transmutation and program/subject/section applicability"),
        live("class-record-oversight","Class Record Oversight","school-class-records.html"),
        future("school-calendar-admin","School Calendar Configuration"),
        future("grade-approval","Grade Approval"),future("promotion-policy","Promotion / Retention Policy")
      ]),
      group("School Profile",[
        future("school-profile","School Profile & Campuses"),future("departments","Departments / Faculties"),
        future("school-policies","Policies & Handbooks"),future("school-integrations","Integrations")
      ])
    ]),
    ws("registrar","Registrar & SIS","people-access.html?workspace=registrar","Student information, enrollment, records and credentials",[
      group("Student Information",[
        live("student-directory","Student Directory","people-access.html#people"),
        future("student-records","Student Records / 201 Files"),future("guardians","Parents / Guardians"),
        future("admissions","Admissions"),future("enrollment","Enrollment / Registration")
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
          live("analytics","Analytics Dashboard","teacher-analytics.html"),future("class-standing","Class Standing"),
          future("games-analytics","Adminerva Games Analytics"),future("lab-analytics","Adminerva Laboratory Analytics")
        ]),
        group("General Analytics",[
          future("general-analytics","General Analytics"),
          ...(scope.isSchoolAdmin?[future("staff-analytics","Staff Analytics","Admin role · Future development")]:[])
        ])
      ]),
      repository(),
      ws("assessment","Assessment","teacher-assessment-library.html","General-subject assessment and checking workflows",[
        group("Assessment",[
          live("assessment-studio","Assessment Studio","teacher-assessment-library.html","Assessment creation for all subjects"),
          future("assessment-inbox","Submission Inbox","General-subject submission inbox · Future development")
        ]),
        group("Assessment Checking",[
          future("student-work","Review Students' Work","General-subject output review · Future development"),
          live("system-evaluation","System Evaluation","school-gradebook.html","Bulk/general assessment evaluation and grading")
        ])
      ]),
      ws("grading","Grading","class-record.html","Class records, advisory records and grade administration",[
        group("Grades",[
          live("class-record","Class Record","class-record.html"),
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
          live("learning-plan","C-map / Learning Plan","lesson-planner.html"),
          live("slides","Slides Editor","presentation.html"),live("library","Reference Library","library.html"),
          live("schedule","Schedule","schedule.html"),future("scope-sequence","Scope and Sequence"),
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
        future("users-analytics","Users"),live("schools-analytics","Schools","owner-schools.html"),
        future("games-analytics","Games"),future("laboratory-analytics","Laboratory"),
        future("assessment-analytics","Assessments"),future("finance-analytics","Finance"),
        future("usage-analytics","Usage & Performance")
      ])
    ]),
    ws("directory","Directory","owner-schools.html","Users, schools and platform directory administration",[
      group("Users",[future("system-users","Users","Platform-wide user directory · Future development")]),
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
  const itemMatches=item=>item[2]&&routePath(item[2])===route;
  const workspaceMatches=w=>routePath(w.route)===route||w.groups.some(g=>g.items.some(itemMatches));
  const activeWorkspace=workspaces.find(w=>w.id===requestedWorkspace)||
    workspaces.find(workspaceMatches)||workspaces[0]||null;
  const groups=activeWorkspace?.groups||[];
  const allItems=workspaces.flatMap(w=>w.groups.flatMap(g=>g.items));
  const currentItem=groups.flatMap(g=>g.items).find(itemMatches)||allItems.find(itemMatches)||null;

  return {
    workspaces,groups,currentItem,
    currentPage:currentItem?.[1]||activeWorkspace?.label||"Adminerva",
    currentArea:activeWorkspace?.label||"Adminerva",
    currentRoute:currentItem?.[2]||activeWorkspace?.route||null,
    workspaceRoute:activeWorkspace?.route||null,
    homeRoute:systemDefault?"owner-schools.html":studentView?"student-home.html":schoolAdminView?"school-admin.html":"teacher-home.html",
    homeLabel:systemDefault?"System Admin":"Home",
    roleLabel:systemDefault?"System administrator":studentView?"Student":
      schoolAdminView?(teacherView?"School administrator · Teacher":"School administrator"):"Teacher",
    systemDefault,studentView,schoolAdminView,platformAdmin
  };
}
