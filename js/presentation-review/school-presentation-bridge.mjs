import {
  activePlanningSchool,saveSchoolPlanning,mountSchoolPlanningLibraryButton
} from "../lesson-review/school-planning.mjs?v=4.0.0";

function cleanSlide(slide){
  const copy={...slide};
  for(const key of ["content","contentLeft","contentRight"]){
    if(key in copy)copy[key]=window.sanitizePresentationHtml?.(copy[key])??String(copy[key]||"");
  }
  return copy;
}
function presentationPayload(){
  const loaded=window.adminervaLoadedSchoolPresentation;
  if(loaded){
    if(!Array.isArray(window.currentPresentationDeck)||!window.currentPresentationDeck.length)
      throw Error("There are no presentation slides to save.");
    const source=loaded.content||{};
    return {clientKey:loaded.clientKey,title:loaded.title,
      content:{...source,deck:window.currentPresentationDeck.map(cleanSlide)}};
  }
  const plan=document.getElementById("presentationPlanSelect")?.value||"";
  const session=window.selectedSessionIndex;
  if(!plan||session===null||session===undefined)
    throw Error("Select a saved lesson and session before saving a school presentation copy.");
  if(!Array.isArray(window.currentPresentationDeck)||!window.currentPresentationDeck.length)
    throw Error("There are no presentation slides to save.");
  const selected=window.selectedPlanData||{},sessionData=window.selectedSessionData||{};
  const clientKey=JSON.stringify([plan,String(session)]);
  const sessionLabel=String(sessionData.session_name||("Session "+(Number(session)+1))).trim();
  const subject=String(selected.subject_title||"Subject"),grade=String(selected.grade_level||"Grade");
  return {
    clientKey,title:grade+" · "+subject+" · "+sessionLabel,
    content:{
      schema:"adminerva-school-presentation-v1",
      sourceLesson:{legacyPlanId:plan,sourceLessonVersion:window.presentationSourceLessonVersion||selected.version||null,
        sessionIndex:Number(session)},
      subject,grade,sessionLabel,
      deck:window.currentPresentationDeck.map(cleanSlide)
    }
  };
}
async function openSchoolPresentation(resource){
  if(resource?.kind!=="presentation"||
     resource?.content?.schema!=="adminerva-school-presentation-v1"||
     !Array.isArray(resource.content.deck))
    throw Error("This school presentation copy is not compatible with the current editor.");
  if(window.adminervaPresentationDirty&&
     !confirm("Discard unsaved slide edits and open the selected verified-school presentation?"))return;
  window.adminervaLoadedSchoolPresentation={
    resourceId:resource.resourceId,clientKey:resource.clientKey,
    revision:resource.revision,title:resource.title,content:structuredClone(resource.content)
  };
  window.currentPresentationDeck=resource.content.deck.map(cleanSlide);
  window.activeSlideIndex=0;window.adminervaPresentationDirty=false;
  window.presentationSourceLessonVersion=resource.content.sourceLesson?.sourceLessonVersion||null;
  window.renderSlideBlocks?.();window.selectSlide?.(0);
  const source=document.getElementById("presentationSourceStatus");
  if(source)source.textContent="Verified-school presentation · revision "+resource.revision+
    ". Save school copy updates this resource; legacy cloud Save remains separate during migration.";
}

async function mount(){
  const legacySave=document.getElementById("btnSavePresentation");
  if(!legacySave||document.getElementById("v4PresentationSave"))return;
  try{await activePlanningSchool();}
  catch{return;}
  const schoolSave=document.createElement("button");
  schoolSave.id="v4PresentationSave";schoolSave.type="button";
  schoolSave.className=legacySave.className.replace("bg-green-600","bg-indigo-700").replace("hover:bg-green-700","hover:bg-indigo-800");
  schoolSave.innerHTML="<span>🏫</span> Save school copy";
  schoolSave.title="Save this editable deck privately in the active verified school's teacher planning repository.";
  schoolSave.addEventListener("click",()=>void (async()=>{
    if(schoolSave.disabled)return;
    schoolSave.disabled=true;
    const end=window.beginLoading?.("Saving private verified-school presentation copy…")||(()=>{});
    try{
      const payload=presentationPayload();
      const result=await saveSchoolPlanning({kind:"presentation",...payload});
      window.adminervaLoadedSchoolPresentation={
        ...(window.adminervaLoadedSchoolPresentation||{}),
        resourceId:result.resourceId,clientKey:payload.clientKey,
        revision:result.revision,title:payload.title,content:structuredClone(payload.content)
      };
      alert(result.unchanged?
        "The verified-school presentation copy already matches this editor draft.":
        "Presentation saved privately to "+(result.schoolName||result.schoolId)+" · revision "+result.revision+". The legacy Save remains separate during migration.");
    }catch(error){
      alert("School presentation copy was not saved: "+(error?.message||"check your verified school access."));
    }finally{end();schoolSave.disabled=false;}
  })());
  legacySave.after(schoolSave);
  mountSchoolPlanningLibraryButton({kind:"presentation",anchor:schoolSave,label:"School copies",onOpen:openSchoolPresentation});
  const legacyPlan=document.getElementById("presentationPlanSelect");
  legacyPlan?.addEventListener("change",()=>{window.adminervaLoadedSchoolPresentation=null;});
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>void mount(),{once:true});
else void mount();
