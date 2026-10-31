/** Presentation-only staff home routing. Auth Guard remains authoritative. */
function applyRole(detail={}){
  const role=detail.role||document.getElementById("adminerva-nav")?.dataset.verifiedRole||"";
  const schoolTeacher=detail.schoolTeacher===true||
    document.getElementById("adminerva-nav")?.dataset.schoolTeacher==="true";
  if(role!=="schooladmin")return;
  const adminPanel=document.getElementById("schoolAdminHomePanel");
  adminPanel?.classList.remove("hidden");
  if(schoolTeacher)return;
  const title=document.getElementById("staffTitle");
  const intro=document.getElementById("staffIntro");
  const primary=document.getElementById("staffPrimaryAction");
  const secondary=document.getElementById("staffSecondaryAction");
  if(title)title.textContent="Keep your school workspace organized.";
  if(intro)intro.textContent="Manage people, access, class offerings and teaching assignments for your verified school.";
  if(primary){primary.href="people-access.html";primary.textContent="People & Access →";}
  if(secondary){secondary.href="school-admin.html";secondary.textContent="School overview";}
  document.getElementById("teacherWorkflowSection")?.classList.add("hidden");
  document.getElementById("teacherQuickAccess")?.classList.add("hidden");
}
document.addEventListener("adminerva:role-ready",event=>applyRole(event.detail||{}));
queueMicrotask(()=>applyRole());
