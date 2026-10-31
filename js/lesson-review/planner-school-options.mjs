import {workspaceOnReady,lessonStorage} from "./workspace-session.mjs?v=1.3.0";
import {loadSchoolOptions,fillSchoolDatalist} from "../core/school-options.mjs?v=1.3.0";
import {loadVerifiedSchoolPlanningOptions,verifiedPlanningMode} from "./school-academic-options.mjs?v=4.0.0";
import {isLegacyScheduleYear,legacyScheduleNotice} from "./legacy-schedule-compat.mjs?v=1.4.18";
const field=id=>document.getElementById(id);
let serial=0;
async function refresh(){
  const current=++serial,label=field("plannerCatalogStatus");
  try{
    const v4Only=await verifiedPlanningMode();
    const choices=v4Only
      ?await loadVerifiedSchoolPlanningOptions()
      :await loadSchoolOptions({schoolYear:field("lpSchoolYear").value.trim(),gradeLevel:field("lpGradeLevel").value});
    if(current!==serial)return;
    fillSchoolDatalist("plannerSubjectChoices",[field("lpSubject").value,...choices.subjects]);
    fillSchoolDatalist("plannerProgramChoices",[field("lpProgram").value,...choices.programs]);
    fillSchoolDatalist("plannerSchoolYears",[field("lpSchoolYear").value,...choices.schoolYears]);
    label.textContent=v4Only
      ?choices.subjects.length+" verified-school subject choice"+(choices.subjects.length===1?"":"s")+" loaded. "+
        (choices.sections.length?"Your assigned sections: "+choices.sections.join(", "):
          "No active teaching sections are assigned yet; ask the school administrator to assign a course offering.")
      :choices.subjects.length+" school subject choices loaded. "+(choices.sections.length?"Your sections: "+choices.sections.join(", "):"No teaching sections are assigned yet; ask the administrator to assign your roster sections.")+(choices.warnings.length?" Some catalogs could not load; you can keep existing saved values.":"")+(isLegacyScheduleYear(field("lpSchoolYear").value.trim())?" "+legacyScheduleNotice():"");
  }catch{if(current===serial)label.textContent="School choices could not load. You can enter the exact saved subject name or refresh the choices.";}
}
window.refreshPlannerSchoolChoices=refresh;
workspaceOnReady(async()=>{
  if(!field("lpSubject").value)field("lpSubject").value=window.currentPlanSubject||lessonStorage.getItem("Adminerva_defaultSubject")||"";
  for(const id of ["lpSchoolYear","lpGradeLevel"])field(id).addEventListener("change",refresh);
  await refresh();
});
