import {app} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {lessonStorage} from "./workspace-session.mjs?v=1.3.0";
import {filterScheduleRowsForLesson,scheduleRowsToText} from "./legacy-schedule-compat.mjs?v=1.4.18";
import {
  activePlanningSchool,saveSchoolPlanning,listSchoolPlanning,getSchoolPlanning,mountSchoolPlanningLibraryButton
} from "./school-planning.mjs?v=4.0.1";

const functions=getFunctions(app,"asia-southeast1");
const referenceApi=httpsCallable(functions,"schoolReferences");
const scheduleApi=httpsCallable(functions,"schoolSchedules");

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
  const clientKey=window.adminervaLoadedSchoolLesson?.clientKey||
    JSON.stringify([schoolYear,grade,subject,academicTerm,courseWeek]);
  const schedule=typeof window.fetchScheduleForLesson==="function"?
    await window.fetchScheduleForLesson(schoolYear,academicTerm,grade,subject):"";
  const plan={
    teacher_name:teacher,program_name:field("lpProgram"),subject_title:subject,
    school_year:schoolYear,academic_term:academicTerm,course_week:courseWeek,
    date_range:dateRange,grade_level:grade,
    document_settings:structuredClone(window.currentLessonSettings||{}),
    custom_instructions:field("lpCustomInstructions"),schedule,
    reference_folders:[...document.querySelectorAll(".folder-checkbox:checked")].map(input=>input.value),
    weekly_overview:structuredClone(window.currentWeeklyOverview),
    sessions:structuredClone(window.currentPlan)
  };
  return {clientKey,title:grade+" · "+subject+" · "+courseWeek,
    content:{schema:"adminerva-school-lesson-v1",plan}};
}
async function openSchoolLesson(resource){
  if(resource?.kind!=="lesson"||resource?.content?.schema!=="adminerva-school-lesson-v1"||
     !resource.content.plan||!Array.isArray(resource.content.plan.sessions))
    throw Error("This school lesson copy is not compatible with the current lesson editor.");
  if(typeof window.loadSpecificPlan!=="function")
    throw Error("The lesson editor is not ready yet.");
  const plan=structuredClone(resource.content.plan);
  window.loadSpecificPlan({...plan,id:"school:"+resource.resourceId,
    version:resource.revision,ownerUid:"__adminerva_school_resource__"});
  if(window.currentPlan!==plan.sessions)return;
  window.adminervaLoadedSchoolLesson={
    resourceId:resource.resourceId,clientKey:resource.clientKey,
    revision:resource.revision,title:resource.title
  };
  const badge=document.getElementById("lessonDraftStatusBadge");
  if(badge){
    badge.hidden=false;badge.textContent="School copy · revision "+resource.revision;
    badge.dataset.tone="info";badge.title="Save school copy updates this verified-school resource. Legacy Save Draft remains separate.";
  }
}

function semesterFromTerm(term){
  return /SECOND|\bS2\b|2ND/i.test(String(term||""))?"S2":"S1";
}
async function schoolCall(api,action,details={}){
  const school=await activePlanningSchool(),schoolId=school.schoolId;
  const result=(await api({schoolId,action,...details})).data;
  const current=await activePlanningSchool();
  if(current.schoolId!==schoolId)throw Error("School changed. Planning response ignored.");
  return result;
}
function renderV4ReferenceFolders(folders){
  const container=document.getElementById("libraryFolderContainer");
  if(!container)return;
  const selected=new Set(
    [...container.querySelectorAll(".folder-checkbox:checked")].map(input=>input.value)
      .concat(Array.isArray(window.currentLessonReferenceFolders)?window.currentLessonReferenceFolders:[])
  );
  container.replaceChildren();
  for(const folder of folders){
    const label=document.createElement("label");
    label.className="flex items-center gap-2 cursor-pointer group";
    const input=document.createElement("input");
    input.type="checkbox";input.value=folder.folderId;input.checked=selected.has(folder.folderId);
    input.className="folder-checkbox w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 bg-white";
    const name=document.createElement("span");
    name.className="text-sm font-bold text-blue-900 group-hover:text-blue-700 transition";
    name.textContent="📁 "+folder.name+" ("+Number(folder.documentCount||0)+" docs)";
    label.append(input,name);container.append(label);
  }
  if(!folders.length){
    const empty=document.createElement("div");empty.className="text-xs text-gray-500 italic";
    empty.textContent="No private verified-school reference folders yet. Open My Reference Library or copy a school-shared folder.";
    container.append(empty);
  }
  const save=()=>{window.currentLessonReferenceFolders=
    [...container.querySelectorAll(".folder-checkbox:checked")].map(input=>input.value);};
  container.onchange=save;save();
  const scope=document.getElementById("plannerLibraryScope");
  if(scope)scope.textContent="Verified-school private reference library";
}
async function activateV4LessonDependencies(){
  window.loadLibraryFolders=async()=>{
    const refresh=document.getElementById("refreshPlannerReferencesBtn");
    if(refresh)refresh.disabled=true;
    try{
      const result=await schoolCall(referenceApi,"list_folders");
      renderV4ReferenceFolders(result.folders||[]);
    }catch(error){
      const container=document.getElementById("libraryFolderContainer");
      if(container){
        container.replaceChildren();
        const message=document.createElement("div");message.className="text-xs text-red-600 italic";
        message.textContent=error?.message||"Verified-school references could not be loaded.";
        container.append(message);
      }
    }finally{if(refresh)refresh.disabled=false;}
  };
  window.fetchReferenceDocuments=async folderId=>
    (await schoolCall(referenceApi,"list_documents",{folderId})).documents||[];
  window.fetchScheduleForLesson=async(schoolYear,academicTerm,grade="",subject="")=>{
    const result=await schoolCall(scheduleApi,"get",{
      schoolYear,semester:semesterFromTerm(academicTerm)
    });
    const rows=filterScheduleRowsForLesson(result.rows||[],{grade,subject});
    return scheduleRowsToText(rows);
  };
  window.fetchPreviousPlan=async(grade,subject,academicTerm,currentCourseWeek,schoolYear)=>{
    const week=Number(String(currentCourseWeek||"").match(/\d+/)?.[0]||0);
    if(week<=1)return null;
    const target=JSON.stringify([schoolYear,grade,subject,academicTerm,"Week "+(week-1)]);
    const item=(await listSchoolPlanning("lesson")).find(resource=>resource.canEdit&&resource.clientKey===target);
    if(!item)return null;
    const full=await getSchoolPlanning(item.resourceId);
    return full?.content?.schema==="adminerva-school-lesson-v1"?full.content.plan:null;
  };
  await window.loadLibraryFolders?.();
}
async function mount(){
  const legacySave=document.querySelector('button[onclick="saveLessonPlan()"]');
  if(!legacySave||document.getElementById("v4LessonSave"))return;
  let school;
  try{school=await activePlanningSchool();}
  catch{return;}
  const v4Only=school.compatibilityMode==="v4_only";
  if(v4Only)await activateV4LessonDependencies();
  const schoolSave=document.createElement("button");
  schoolSave.id="v4LessonSave";schoolSave.type="button";
  schoolSave.className=legacySave.className.replace("bg-gray-200","bg-indigo-700").replace("text-gray-700","text-white");
  schoolSave.innerHTML=v4Only?"<span>💾</span> Save lesson":"<span>🏫</span> Save school copy";
  schoolSave.title="Save this editor draft to the active verified school's private teacher planning repository.";
  schoolSave.addEventListener("click",()=>void (async()=>{
    if(schoolSave.disabled)return;
    schoolSave.disabled=true;
    const end=window.beginLoading?.("Saving private verified-school lesson copy…")||(()=>{});
    try{
      const payload=await lessonPayload();
      const result=await saveSchoolPlanning({kind:"lesson",...payload});
      window.adminervaLoadedSchoolLesson={
        ...(window.adminervaLoadedSchoolLesson||{}),clientKey:payload.clientKey,
        resourceId:result.resourceId,revision:result.revision,title:payload.title
      };
      alert(result.unchanged?
        "The verified-school lesson already matches this editor draft.":
        "Lesson saved privately to "+(result.schoolName||result.schoolId)+" · revision "+result.revision+
          (v4Only?".":"; the legacy personal draft remains separate during migration."));
    }catch(error){
      alert("School lesson copy was not saved: "+(error?.message||"check your verified school access."));
    }finally{end();schoolSave.disabled=false;}
  })());
  legacySave.after(schoolSave);
  const libraryButton=mountSchoolPlanningLibraryButton({
    kind:"lesson",anchor:schoolSave,label:v4Only?"My school lessons":"School copies",onOpen:openSchoolLesson
  });
  if(v4Only){
    legacySave.hidden=true;
    const legacyLoad=document.querySelector('button[onclick="openLoadPlanModal()"]');
    if(legacyLoad){
      legacyLoad.hidden=true;
      const topLibrary=mountSchoolPlanningLibraryButton({
        kind:"lesson",anchor:legacyLoad,label:"📂 My school lessons",onOpen:openSchoolLesson
      });
      if(topLibrary){
        topLibrary.className=legacyLoad.className.replace("bg-purple-600","bg-indigo-700")
          .replace("hover:bg-purple-700","hover:bg-indigo-800");
      }
    }
    const savePrint=document.querySelector('button[onclick="saveAndPrint()"]');
    if(savePrint){
      savePrint.removeAttribute("onclick");
      savePrint.addEventListener("click",()=>void (async()=>{
        schoolSave.click();
        alert("Use Print / Save PDF after the verified-school save completes.");
      })());
      savePrint.hidden=true;
    }
    if(libraryButton)libraryButton.title="Open lessons from this verified school's private planning repository.";
    const badge=document.getElementById("lessonDraftStatusBadge");
    if(badge?.title)badge.title=badge.title.replace(" Legacy Save Draft remains separate.","");
  }
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>void mount(),{once:true});
else void mount();
