export function buildNavigationIA(ctx){
  const live=(id,label,route,tip="")=>[id,label,route,{future:false,tip}];
  const future=(id,label,tip="Future development")=>[id,label,null,{future:true,tip}];
  const group=(name,items)=>({name,items});
  const ws=(id,label,route,description,groups)=>({id,label,route,description,groups});
  const student=()=>{
    const assignments=ctx.hasSchoolStudent?"school-student-assessments.html":"student-assessments.html";
    return [
      ws("classroom","Adminerva Classroom",assignments,"Classroom activity, assignments, materials and school calendar",[
        group("Classroom",[
          future("bulletin","Classroom Bulletin Board","Class announcements and teacher posts · Future development"),
          live("assignments","Assignments",assignments,"School and teacher-assigned work"),
          future("ebooks","E-books","Class materials / presentations · Future development"),
          future("calendar","School Calendar","School events, deadlines and academic calendar · Future development")
        ]),
        group("Repository work",[
          live("repo-projects","Repository Projects","student-dashboard.html","Existing repository projects"),
          live("repo-assignments","Repository Assignments","student-assessments.html","Existing repository assignments")
        ])
      ]),
      ws("games","Adminerva Games","student-practice.html","Practice challenges and subject learning games",[
        group("Games",[
          live("programming","Programming Practice Challenges","student-practice.html"),
          future("science","Science Game"),future("english","English Game"),future("ap","AP Game"),future("math","Math Game"),
          future("values","Values Game"),future("filipino","Filipino Game"),future("quiz-bee","General Subject Quiz Bee")
        ])
      ]),
      ws("laboratory","Adminerva Laboratory","student-playground.html","Interactive subject laboratories and creation workspaces",[
        group("Laboratories",[
          live("studio","Adminerva Studio","student-playground.html","Browser-based Programming IDE"),
          future("adventure","Adminerva Adventure","Maps and history information for AP subjects · Future development"),
          future("experiments","Adminerva Experiments","Science laboratory activities · Future development"),
          future("language","Adminerva Language Workshop","English and Filipino language workshop · Future development"),
          future("lab-other","Other Laboratories")
        ])
      ]),
      ws("student-other","Other","issues.html","Support, documentation and policies",[
        group("Support & information",[
          live("bug","Bug Report","issues.html"),live("help","Help / Wiki","wiki.html"),
          live("policy","Terms, Conditions & Policy","wiki.html#privacy"),
          live("account","Account Settings",ctx.hasSchoolStudent?"school-student-settings.html":"student-settings.html")
        ])
      ])
    ];
  };
  const repository=()=>ws("repository","Repository Management","assessment-studio.html","Existing repository assessment and GitHub workflows",[
    group("Assessment",[live("repo-studio","Assessment Studio","assessment-studio.html"),live("repo-submissions","Submission Inbox","submissions.html"),live("repo-reclaims","Commit Attribution Requests","reclaim-inbox.html")]),
    group("Review & grade",[live("repo-review","Review & Grade","repofetch.html"),live("repo-gradebook","Gradebook","gradebook.html"),live("repo-investigation","Repository Investigation","repobank.html")])
  ]);
  const teacher=()=>{
    const out=[
      ws("analytics","Analytics","teacher-analytics.html","Teaching, class and learning analytics",[
        group("Analytics Dashboard",[live("analytics","Analytics Dashboard","teacher-analytics.html"),future("class-standing","Class Standing"),future("games-analytics","Adminerva Games Analytics"),future("lab-analytics","Adminerva Laboratory Analytics")]),
        group("General Analytics",[future("general-analytics","General Analytics"),...(ctx.isSchoolAdmin?[future("staff-analytics","Staff Analytics","Admin role · Future development")]:[])])
      ]),
      repository(),
      ws("assessment","Assessment","teacher-assessment-library.html","General-subject assessment and checking workflows",[
        group("Assessment",[live("assessment-studio","Assessment Studio","teacher-assessment-library.html","Assessment creation for all subjects"),future("assessment-inbox","Submission Inbox","General-subject submission inbox · Future development")]),
        group("Assessment Checking",[future("student-work","Review Students' Work","General-subject output review · Future development"),live("system-evaluation","System Evaluation","school-gradebook.html","Bulk/general assessment evaluation and grading")])
      ]),
      ws("grading","Grading","class-record.html","Class records, advisory records and grade administration",[
        group("Grades",[live("class-record","Class Record","class-record.html"),...(ctx.isSchoolAdmin?[live("grading-policy","Grading Policies","school-grading-schemes.html","School-controlled weights, transmutation and applicability"),live("record-oversight","Class Record Oversight","school-class-records.html")]:[])]),
        group("Advisory",[future("attendance","Attendance"),future("conduct","Conduct"),future("advisory-summary","Summary of Grades")]),
        ...(ctx.isSchoolAdmin?[group("School Approval",[future("grade-approval","Grade Approval","Admin role · Future development"),future("school-summary","Summary of Grades","All levels and sections · Admin role · Future development")])]:[])
      ]),
      ws("preparation","Preparation","lesson-planner.html","Teaching plans, materials, schedules and faculty preparation",[
        group("Teaching Preparation",[live("learning-plan","C-map / Learning Plan","lesson-planner.html"),live("slides","Slides Editor","presentation.html"),live("library","Reference Library","library.html"),live("schedule","Schedule","schedule.html"),future("scope-sequence","Scope and Sequence"),future("department-files","Department Files"),future("letters","Letters"),...(ctx.isSchoolAdmin?[future("faculty-scheduling","Faculty Scheduling","Admin role · Future development")]:[])])
      ]),
      ws("staff-other","Others","issues.html","Staff support and reserved non-teaching modules",[
        group("Staff & Support",[future("staff-concerns","Faculty / Staff Concerns"),live("support","Bug Report / Support","issues.html"),live("wiki","Help / Wiki","wiki.html"),live("settings","Account & Integrations","settings.html")])
      ])
    ];
    if(ctx.isSchoolAdmin)out.push(ws("school-admin","School Administration","school-admin.html","School operations, people, academic configuration and policy",[
      group("Operations",[live("school-operations","Operations Dashboard","school-admin.html"),live("people-access","People & Access","people-access.html"),live("academic-config","Academic Configuration","school-academic-configuration.html","Subjects, sections, periods and course offerings")]),
      group("Academic Policy",[live("grading-policies","Grading Policies","school-grading-schemes.html","Weights, transmutation and subject/section applicability"),live("class-record-oversight","Class Record Oversight","school-class-records.html"),future("school-grade-approval","Grade Approval","Admin role · Future development"),future("school-faculty-scheduling","Faculty Scheduling","Admin role · Future development")])
    ]));
    return out;
  };
  const system=()=>[
    ws("system-analytics","Analytics","admin-analytics.html","Platform-wide analytics and operational intelligence",[group("Platform Analytics",[live("users-analytics","Users","admin-analytics.html"),live("schools-analytics","Schools","owner-schools.html"),future("games-analytics","Games"),future("laboratory-analytics","Laboratory"),future("assessment-analytics","Assessments"),future("usage-analytics","Usage & Performance")])]),
    ws("directory","Directory","owner-schools.html","Users, schools and platform directory administration",[group("Users",[live("users","Users","users.html")]),group("Schools",[live("schools","Schools","owner-schools.html"),live("school-details","School Details","owner-schools.html"),future("school-announcement","School Announcement"),future("school-integration","School Integration"),future("school-configuration","Configuration")])]),
    ws("system","System","patch-notes.html","Platform operations, configuration and releases",[group("System",[future("alerts","Alerts & Warnings"),live("updates","Updates & Releases","patch-notes.html"),future("config","Configurations"),future("announcement","Announcement"),live("support","Reports & Support","issues.html")])])
  ];
  let viewRole="";try{viewRole=sessionStorage.getItem("Adminerva_platform_view_role")||"";}catch{}
  const platformAdmin=ctx.isPlatformOwner||ctx.isSuperAdmin,systemDefault=platformAdmin&&!viewRole;
  const studentView=ctx.isStudent||viewRole==="student",schoolAdminView=ctx.isSchoolAdmin||viewRole==="schooladmin";
  const teacherView=ctx.hasSchoolTeacher||viewRole==="teacher"||schoolAdminView;
  const modelCtx={...ctx,isSchoolAdmin:schoolAdminView,hasSchoolTeacher:teacherView,hasSchoolStudent:ctx.hasSchoolStudent||studentView};
  const workspaces=systemDefault?system():studentView?student.call(null,modelCtx):teacher.call(null,modelCtx);
  const route=(location.pathname.split("/").pop()||"").toLowerCase();
  const itemMatches=item=>item[2]&&item[2].split("#")[0].toLowerCase()===route;
  const workspaceMatches=w=>w.route.split("#")[0].toLowerCase()===route||w.groups.some(g=>g.items.some(itemMatches));
  const activeWorkspace=workspaces.find(workspaceMatches)||workspaces[0]||null,groups=activeWorkspace?.groups||[];
  const allItems=workspaces.flatMap(w=>w.groups.flatMap(g=>g.items));
  const currentItem=groups.flatMap(g=>g.items).find(itemMatches)||allItems.find(itemMatches)||null;
  return {workspaces,groups,currentItem,currentPage:currentItem?.[1]||activeWorkspace?.label||"Adminerva",currentArea:activeWorkspace?.label||"Adminerva",currentRoute:currentItem?.[2]||activeWorkspace?.route||null,workspaceRoute:activeWorkspace?.route||null,homeRoute:systemDefault?"owner-schools.html":studentView?"student-home.html":schoolAdminView?"school-admin.html":"teacher-home.html",homeLabel:systemDefault?"System Admin":"Home",roleLabel:systemDefault?"System administrator":studentView?"Student":schoolAdminView?(teacherView?"School administrator · Teacher":"School administrator"):"Teacher",systemDefault,studentView,schoolAdminView,platformAdmin};
}
