import {app} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs?v=4.0.1";
import {workspaceOnReady,lessonStorage} from "./workspace-session.mjs?v=1.3.0";
import {loadSchoolOptions,fillSchoolDatalist} from "../core/school-options.mjs?v=1.3.0";
import {isLegacyScheduleYear,legacyScheduleNotice} from "./legacy-schedule-compat.mjs?v=1.4.18";

const field=id=>document.getElementById(id);
const academicsApi=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolAcademics");
const requestedOfferingId=String(new URL(location.href).searchParams.get("offeringId")||"");
let serial=0,picker=null,offerings=[],sectionRecords=[],pendingOfferingId=requestedOfferingId||String(window.pendingPlannerOfferingId||"");

function classLabel(item){
  return [item.subjectName,item.sectionName,item.termName,item.yearName].filter(Boolean).join(" · ");
}
function fillList(id,values){
  const list=field(id);if(!list)return;
  const unique=[...new Set(values.filter(value=>typeof value==="string"&&value.trim()))].sort((a,b)=>a.localeCompare(b));
  list.replaceChildren(...unique.map(value=>new Option(value,value)));
}
function setIfOption(select,value){
  if(!select||!value)return false;
  const option=[...select.options].find(row=>row.value===value||row.textContent.trim()===value);
  if(!option)return false;select.value=option.value;return true;
}
function applyOffering(id,{announce=true}={}){
  const select=field("lpClassOffering"),status=field("plannerClassContextStatus");
  if(!id){
    window.currentPlannerOfferingId="";
    window.currentPlannerSchoolId=picker?.scope.current?.schoolId||"";
    window.currentPlannerClassContext=null;
    if(select)select.value="";
    if(status)status.textContent="Reusable preparation mode. Choose an assigned class when you want verified class context.";
    return true;
  }
  const item=offerings.find(row=>row.offeringId===id);if(!item){pendingOfferingId=id;return false;}
  pendingOfferingId="";
  window.currentPlannerOfferingId=item.offeringId;
  window.currentPlannerSchoolId=picker?.scope.current?.schoolId||"";
  window.currentPlannerClassContext={
    schoolId:window.currentPlannerSchoolId,offeringId:item.offeringId,
    programId:item.programId||"",programName:item.programName||"",
    sectionId:item.sectionId||"",sectionName:item.sectionName||"",
    subjectId:item.subjectId||"",subjectName:item.subjectName||"",
    yearId:item.yearId||"",yearName:item.yearName||"",
    termId:item.termId||"",termName:item.termName||""
  };
  if(select)select.value=item.offeringId;
  field("lpSubject").value=item.subjectName||field("lpSubject").value;
  field("lpProgram").value=item.programName||field("lpProgram").value;
  field("lpSchoolYear").value=item.yearName||field("lpSchoolYear").value;
  const section=sectionRecords.find(row=>row.sectionId===item.sectionId);
  if(section?.gradeLevel)setIfOption(field("lpGradeLevel"),section.gradeLevel);
  setIfOption(field("lpAcademicTerm"),item.termName);
  window.currentPlanSubject=field("lpSubject").value.trim()||window.currentPlanSubject;
  window.currentTargetGrade=field("lpGradeLevel").value||window.currentTargetGrade;
  if(status)status.textContent="Class context: "+classLabel(item)+
    ". Saving keeps this association for navigation, but the lesson remains reusable private preparation.";
  if(announce)document.dispatchEvent(new CustomEvent("adminerva:planner-class-context",{detail:{
    schoolId:window.currentPlannerSchoolId,offeringId:item.offeringId,sectionId:item.sectionId,
    subjectId:item.subjectId,yearId:item.yearId,termId:item.termId
  }}));
  return true;
}
window.setPlannerOfferingContext=id=>applyOffering(String(id||""),{announce:false});

async function canonicalRefresh(){
  if(!picker?.scope.current)throw Error("Choose a verified school to load assigned classes.");
  const turn=++serial,label=field("plannerCatalogStatus"),lease=picker.scope.lease();
  label.textContent="Loading verified teaching assignments…";
  const response=await academicsApi({schoolId:lease.schoolId,action:"planning_options",assignmentScope:"teacher"});
  picker.scope.assertLease(lease);if(turn!==serial)return;
  const choices=response.data||{};
  offerings=choices.offerings||[];sectionRecords=choices.sectionRecords||[];
  fillList("plannerSubjectChoices",[field("lpSubject").value,...(choices.subjects||[])]);
  fillList("plannerProgramChoices",[field("lpProgram").value,...(choices.programs||[])]);
  fillList("plannerSchoolYears",[field("lpSchoolYear").value,...(choices.schoolYears||[])]);
  const select=field("lpClassOffering"),previous=select.value||window.currentPlannerOfferingId||pendingOfferingId;
  select.replaceChildren(new Option("Reusable preparation · no single class selected",""));
  for(const item of [...offerings].sort((a,b)=>classLabel(a).localeCompare(classLabel(b))))
    select.add(new Option(classLabel(item),item.offeringId));
  if(previous&&offerings.some(item=>item.offeringId===previous))applyOffering(previous,{announce:false});
  else if(previous){pendingOfferingId=previous;applyOffering("",{announce:false});}
  label.textContent=offerings.length+
    " assigned class"+(offerings.length===1?"":"es")+" loaded from Classes & Scheduling. "+
    (offerings.length?"Choose one for class context or keep this lesson reusable.":"No active teaching assignments are available; School Admin must assign the class first.")+
    (isLegacyScheduleYear(field("lpSchoolYear").value.trim())?" "+legacyScheduleNotice():"");
}
async function legacyFallback(error){
  const turn=++serial,label=field("plannerCatalogStatus");
  const choices=await loadSchoolOptions({schoolYear:field("lpSchoolYear").value.trim(),gradeLevel:field("lpGradeLevel").value});
  if(turn!==serial)return;
  fillSchoolDatalist("plannerSubjectChoices",[field("lpSubject").value,...choices.subjects]);
  fillSchoolDatalist("plannerProgramChoices",[field("lpProgram").value,...choices.programs]);
  fillSchoolDatalist("plannerSchoolYears",[field("lpSchoolYear").value,...choices.schoolYears]);
  offerings=[];sectionRecords=[];field("lpClassOffering").replaceChildren(new Option("Legacy preparation · no canonical class context",""));
  window.currentPlannerOfferingId="";window.currentPlannerSchoolId="";window.currentPlannerClassContext=null;
  label.textContent="Canonical assigned classes are unavailable, so the planner is using legacy school choices for compatibility. "+
    (error?.message?"Reason: "+error.message+" ":"")+
    (choices.sections.length?"Legacy sections: "+choices.sections.join(", "):"No legacy sections found.")+
    (isLegacyScheduleYear(field("lpSchoolYear").value.trim())?" "+legacyScheduleNotice():"");
}
async function refresh(){
  try{await canonicalRefresh();}catch(error){try{await legacyFallback(error);}catch{field("plannerCatalogStatus").textContent="Teaching choices could not load. Existing saved values remain editable.";}}
}
window.refreshPlannerSchoolChoices=refresh;

workspaceOnReady(async()=>{
  if(!field("lpSubject").value)field("lpSubject").value=window.currentPlanSubject||lessonStorage.getItem("Adminerva_defaultSubject")||"";
  field("lpClassOffering").addEventListener("change",()=>applyOffering(field("lpClassOffering").value));
  for(const id of ["lpSchoolYear","lpGradeLevel"])field(id).addEventListener("change",()=>{
    if(window.currentPlannerOfferingId)applyOffering("",{announce:false});
    void refresh();
  });
  picker=createTenantSchoolPicker({
    host:field("plannerSchoolSwitcher"),status:null,
    onBeforeChange:async()=>{
      ++serial;offerings=[];sectionRecords=[];pendingOfferingId="";
      window.currentPlannerOfferingId="";window.currentPlannerSchoolId="";window.currentPlannerClassContext=null;
      field("lpClassOffering").replaceChildren(new Option("Reusable preparation · no single class selected",""));
    },
    onReady:()=>void refresh()
  });
  try{
    const state=await picker.load();
    if(state?.state==="choose_school")field("plannerCatalogStatus").textContent="Choose a verified school to load your assigned classes.";
    if(!picker.scope.current)await legacyFallback();
    else if(window.pendingPlannerOfferingId){
      pendingOfferingId=String(window.pendingPlannerOfferingId);window.pendingPlannerOfferingId="";
      if(offerings.some(item=>item.offeringId===pendingOfferingId))applyOffering(pendingOfferingId,{announce:false});
    }
  }catch(error){await legacyFallback(error);}
});
