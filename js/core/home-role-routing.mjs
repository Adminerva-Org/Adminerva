/** Presentation-only staff home routing. Auth Guard remains authoritative. */
function applyRole(detail={}){
  const navigation=document.getElementById("adminerva-nav");
  const role=detail.role||navigation?.dataset.verifiedRole||"";
  const schoolTeacher=detail.schoolTeacher===true||
    navigation?.dataset.schoolTeacher==="true";
  const v4OnlyTeacher=detail.v4OnlyTeacher===true;
  if(v4OnlyTeacher){
    const title=document.getElementById("staffTitle"),intro=document.getElementById("staffIntro");
    const primary=document.getElementById("staffPrimaryAction"),secondary=document.getElementById("staffSecondaryAction");
    if(title)title.textContent="Your verified school teaching workspace.";
    if(intro)intro.textContent="Create school-owned assessments, review frozen submissions, and publish grades through tenant-scoped workflows.";
    if(primary){primary.href="school-gradebook.html";primary.textContent="Review & Grade →";}
    if(secondary){secondary.href="teacher-assessment-library.html";secondary.textContent="Assessment library";}
    const workflow=document.getElementById("teacherWorkflowSection");
    if(workflow){
      const links=[...workflow.querySelectorAll("li a")];
      if(links[0]){links[0].href="teacher-assessment-library.html";links[0].querySelector("strong").textContent="1. Prepare an assessment";links[0].querySelector("span").textContent="Create a private blueprint and deploy it only to a class you teach.";}
      if(links[1]){links[1].href="school-gradebook.html";links[1].querySelector("strong").textContent="2. Review frozen evidence";links[1].querySelector("span").textContent="Inspect the exact Studio or GitHub version submitted by each learner.";}
      if(links[2]){links[2].href="school-gradebook.html";links[2].querySelector("strong").textContent="3. Publish reviewed feedback";links[2].querySelector("span").textContent="Save a private rubric draft, then publish the verified result.";}
    }
    const quick=document.getElementById("teacherQuickAccess");
    if(quick){
      const row=quick.querySelector(".av-button-row");
      if(row){
        row.replaceChildren();
        for(const [href,label] of [
          ["teacher-assessment-library.html","Assessment library"],
          ["school-gradebook.html","Review & Grade"],
          ["reclaim-inbox.html","Commit attribution requests"],
          ["school-support.html","School support"]
        ]){
          const link=document.createElement("a");link.href=href;link.className="av-secondary-link";link.textContent=label;row.append(link);
        }
      }
    }
  }
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
