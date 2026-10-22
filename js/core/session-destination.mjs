/** Same-origin destinations are navigation hints, never proof of access. */
const studentPages=new Set(["student-home.html","student-dashboard.html","student-assessments.html","student-settings.html","student-practice.html","student-playground.html","student-xml-lab.html"]);
const staffPages=new Set(["teacher-home.html","teacher-analytics.html","practice-analytics.html","lesson-planner.html","presentation.html","schedule.html","library.html","repofetch.html","repobank.html","gradebook.html","grading.html","activity-grader.html","group-inspector.html","contribution-inspector.html","assessment-studio.html","assessment-evidence-review.html","submissions.html","settings.html"]);
const adminPages=new Set(["users.html","teacher-accounts.html","admin-analytics.html","manage-sections.html","manage-programs.html","manage-subjects.html"]);
const guestPages=new Set(["guest-home.html","guest-practice.html","guest-playground.html"]);
export function workspaceHome(access){return access.role?"teacher-home.html":access.students?.length?"student-home.html":"guest-home.html";}
export function sessionDestination(candidate,access){
  const fallback=workspaceHome(access);
  if(!candidate)return fallback;
  try{
    const base=new URL(".",location.href),target=new URL(candidate,base),page=target.pathname.slice(base.pathname.length);
    if(target.origin!==base.origin||!target.pathname.startsWith(base.pathname)||page.includes("/"))return fallback;
    const allowed=page==="issues.html"||studentPages.has(page)&&(Boolean(access.role)||access.students?.length)||staffPages.has(page)&&Boolean(access.role)||adminPages.has(page)&&access.role==="admin"||guestPages.has(page)&&!access.role&&!access.students?.length;
    return allowed?page+target.search+target.hash:fallback;
  }catch{return fallback;}
}
export function rememberWorkspace(uid){
  if(!uid)return;
  if(/\/(student|teacher)-home\.html$/.test(location.pathname))return;
  try{sessionStorage.setItem("Adminerva_last_workspace_"+uid,location.pathname.split("/").pop()+location.search+location.hash);}catch{}
}
