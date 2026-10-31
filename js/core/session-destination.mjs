/** Same-origin destinations are navigation hints, never proof of access. */
const studentPages=new Set(["student-home.html","student-dashboard.html","student-assessments.html","student-settings.html","student-practice.html","student-playground.html","student-xml-lab.html","school-support.html"]);
const staffPages=new Set(["teacher-home.html","teacher-analytics.html","practice-analytics.html","lesson-planner.html","presentation.html","schedule.html","library.html","repofetch.html","repobank.html","gradebook.html","grading.html","activity-grader.html","group-inspector.html","contribution-inspector.html","assessment-studio.html","assessment-evidence-review.html","submissions.html","reclaim-inbox.html","studio-submissions.html","settings.html","school-support.html","school-gradebook.html"]);
const adminPages=new Set(["users.html","teacher-accounts.html","admin-analytics.html","manage-sections.html","manage-programs.html","manage-subjects.html","owner-schools.html"]);
const schoolAdminPages=new Set(["school-admin.html","people-access.html","reclaim-inbox.html","teacher-assessment-library.html","school-support.html","school-analytics.html"]);
const guestPages=new Set(["guest-home.html","guest-practice.html","guest-playground.html"]);
export function workspaceHome(access){return access.platformAdmin&&!access.role&&!access.schoolAdmin&&!access.schoolTeacher?"owner-schools.html":access.role||access.schoolAdmin||access.schoolTeacher?"teacher-home.html":access.schoolStudent||access.students?.length?"student-home.html":"guest-home.html";}
export function sessionDestination(candidate,access){
  const fallback=workspaceHome(access);
  if(!candidate)return fallback;
  try{
    const base=new URL(".",location.href),target=new URL(candidate,base),page=target.pathname.slice(base.pathname.length);
    if(target.origin!==base.origin||!target.pathname.startsWith(base.pathname)||page.includes("/"))return fallback;
    const allowed=page==="join-school.html"||page==="issues.html"||page==="owner-schools.html"&&(access.platformAdmin||access.role==="admin")||studentPages.has(page)&&(Boolean(access.role)||access.schoolAdmin||access.schoolStudent||access.students?.length)||staffPages.has(page)&&(Boolean(access.role)||access.schoolAdmin||access.schoolTeacher)||schoolAdminPages.has(page)&&(access.schoolAdmin||access.role==="admin")||adminPages.has(page)&&access.role==="admin"||guestPages.has(page)&&!access.role&&!access.platformAdmin&&!access.schoolAdmin&&!access.schoolStudent&&!access.students?.length;
    return allowed?page+target.search+target.hash:fallback;
  }catch{return fallback;}
}
export function rememberWorkspace(uid){
  if(!uid)return;
  if(/\/(student|teacher)-home\.html$/.test(location.pathname))return;
  try{sessionStorage.setItem("Adminerva_last_workspace_"+uid,location.pathname.split("/").pop()+location.search+location.hash);}catch{}
}

export function roleHome(role){
  return role==="student"?"student-home.html":
    role==="platformowner"?"owner-schools.html":
    role==="teacher"||role==="schooladmin"||role==="superadmin"?"teacher-home.html":
    role==="guest"?"guest-home.html":"";
}
function cachedRoleAllows(page,role){
  if(page==="issues.html")return ["student","teacher","schooladmin","superadmin"].includes(role);
  if(role==="student")return studentPages.has(page);
  if(role==="teacher")return staffPages.has(page);
  if(role==="schooladmin")return staffPages.has(page)||schoolAdminPages.has(page);
  if(role==="platformowner")return page==="owner-schools.html"||page==="issues.html"||page==="settings.html";
  if(role==="superadmin")return staffPages.has(page)||schoolAdminPages.has(page)||adminPages.has(page);
  if(role==="guest")return guestPages.has(page);
  return false;
}
/** Fast navigation hint for an already-authenticated session. Auth Guard still verifies access on protected pages. */
export function cachedWorkspaceDestination(user){
  if(!user?.uid)return "";
  let role="";
  try{role=localStorage.getItem("Adminerva_Role")||"";}catch{}
  const fallback=roleHome(role);
  if(!fallback)return "";
  let candidate="";
  try{candidate=sessionStorage.getItem("Adminerva_last_workspace_"+user.uid)||"";}catch{}
  if(!candidate)return fallback;
  try{
    const base=new URL(".",location.href),target=new URL(candidate,base),page=target.pathname.slice(base.pathname.length);
    if(target.origin!==base.origin||!target.pathname.startsWith(base.pathname)||page.includes("/")||!cachedRoleAllows(page,role))return fallback;
    return page+target.search+target.hash;
  }catch{return fallback;}
}
