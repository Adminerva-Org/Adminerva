import {lessonStorage} from "./workspace-session.mjs?v=1.3.0";
import {
  activePlanningSchool,saveSchoolPlanning,mountSchoolPlanningLibraryButton
} from "./school-planning.mjs?v=4.0.0";

function field(id){return String(document.getElementById(id)?.value||"").trim();}
async function lessonPayload(){
  window.syncOutputToData?.();
  if(!Array.isArray(window.currentPlan)||!window.currentPlan.length||!window.currentWeeklyOverview)
    throw Error("Generate or load a lesson plan before saving a school copy.");
  const schoolYear=field("lpSchoolYear"),academicTerm=field("lpAcademicTerm"),
    courseWeek=field("lpCourseWeek"),dateRange=field("lpDateRange");
  const grade=String(window.currentTargetGrade||"").trim()||"Grade";
  const subject=String(window.currentPlanSubject||
    lessonStorage.getItem("Adminerva_defaultSubject")||"Subject").trim();
  const teacher=String(window.currentPlanTeacher||
    lessonStorage.getItem("Adminerva_defaultTeacher")||"Unassigned").trim();
  if(!schoolYear||!academicTerm||!courseWeek)
    throw Error("Set school year, academic term and course week before saving a school copy.");
  const clientKey=JSON.stringify([schoolYear,grade,subject,academicTerm,courseWeek]);
  const schedule=typeof window.fetchScheduleForLesson==="function"?
    await window.fetchScheduleForLesson(schoolYear,academicTerm,grade,subject):"";
  const plan={
    teacher_name:teacher,program_name:field("lpProgram"),subject_title:subject,
    school_year:schoolYear,academic_term:academicTerm,course_week:courseWeek,
    date_range:dateRange,grade_level:grade,
    custom_instructions:field("lpCustomInstructions"),schedule,
    reference_folders:[...document.querySelectorAll(".folder-checkbox:checked")].map(input=>input.value),
    weekly_overview:structuredClone(window.currentWeeklyOverview),
    sessions:structuredClone(window.currentPlan)
  };
  return {clientKey,title:grade+" · "+subject+" · "+courseWeek,
    content:{schema:"adminerva-school-lesson-v1",plan}};
}
async function mount(){
  const legacySave=document.querySelector('button[onclick="saveLessonPlan()"]');
  if(!legacySave||document.getElementById("v4LessonSave"))return;
  try{await activePlanningSchool();}
  catch{return;}
  const schoolSave=document.createElement("button");
  schoolSave.id="v4LessonSave";schoolSave.type="button";
  schoolSave.className=legacySave.className.replace("bg-gray-200","bg-indigo-700").replace("text-gray-700","text-white");
  schoolSave.innerHTML="<span>🏫</span> Save school copy";
  schoolSave.title="Save this editor draft to the active verified school's private teacher planning repository.";
  schoolSave.addEventListener("click",()=>void (async()=>{
    if(schoolSave.disabled)return;
    schoolSave.disabled=true;
    const end=window.beginLoading?.("Saving private verified-school lesson copy…")||(()=>{});
    try{
      const payload=await lessonPayload();
      const result=await saveSchoolPlanning({kind:"lesson",...payload});
      alert(result.unchanged?
        "The verified-school lesson copy already matches this editor draft.":
        "Lesson saved privately to "+(result.schoolName||result.schoolId)+" · revision "+result.revision+". The legacy personal Save Draft remains separate during migration.");
    }catch(error){
      alert("School lesson copy was not saved: "+(error?.message||"check your verified school access."));
    }finally{end();schoolSave.disabled=false;}
  })());
  legacySave.after(schoolSave);
  mountSchoolPlanningLibraryButton({kind:"lesson",anchor:schoolSave,label:"School copies"});
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>void mount(),{once:true});
else void mount();
