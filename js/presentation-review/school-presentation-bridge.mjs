import {
  activePlanningSchool,saveSchoolPlanning,listSchoolPlanning,getSchoolPlanning,mountSchoolPlanningLibraryButton
} from "../lesson-review/school-planning.mjs?v=4.0.1";

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
      sourceLesson:{
        ...(selected.__schoolResourceId?{resourceId:selected.__schoolResourceId}:{legacyPlanId:plan}),
        sourceLessonVersion:window.presentationSourceLessonVersion||selected.version||null,
        sessionIndex:Number(session)
      },
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

async function waitForSelector(){
  for(let attempt=0;attempt<80;attempt++){
    const plan=document.getElementById("presentationPlanSelect"),
      session=document.getElementById("presentationSessionSelect");
    if(plan&&session)return {plan,session};
    await new Promise(resolve=>requestAnimationFrame(resolve));
  }
  throw Error("The presentation lesson selector did not initialize.");
}
async function activateV4LessonSource(){
  const {plan,session}=await waitForSelector();
  const summaries=(await listSchoolPlanning("lesson")).filter(item=>item.status!=="archived");
  window.availablePlans=[];
  plan.replaceChildren();
  const blank=document.createElement("option");blank.value="";blank.textContent="-- Choose a verified-school lesson --";
  plan.append(blank);
  for(const item of summaries){
    const option=document.createElement("option");
    option.value="school:"+item.resourceId;option.textContent=item.title;plan.append(option);
  }
  session.replaceChildren();
  const waiting=document.createElement("option");waiting.value="";waiting.textContent="Awaiting lesson…";
  session.append(waiting);session.disabled=true;
  const legacyHistory=document.querySelector('button[onclick="openPresentationHistory()"]');
  const legacyArchive=document.querySelector('button[onclick="openArchiveManager()"]');
  if(legacyHistory)legacyHistory.hidden=true;
  if(legacyArchive)legacyArchive.hidden=true;

  window.handlePlanSelection=async()=>{
    const planId=plan.value;
    if(window.adminervaPresentationDirty&&window.selectedPlanData?.id!==planId&&
       !confirm("Discard unsaved slide edits and choose another verified-school lesson?")){
      plan.value=window.selectedPlanData?.id||"";return;
    }
    window.adminervaLoadedSchoolPresentation=null;
    window.selectedSessionIndex=null;window.selectedSessionData=null;
    session.replaceChildren();
    const first=document.createElement("option");first.value="";
    first.textContent=planId?"Loading lesson…":"Awaiting lesson…";session.append(first);
    session.disabled=true;
    const generate=document.getElementById("btnGenerateSlides");
    if(generate){generate.disabled=true;generate.classList.add("opacity-50","cursor-not-allowed");}
    if(!planId){window.selectedPlanData=null;return;}
    try{
      const resourceId=planId.replace(/^school:/,""),resource=await getSchoolPlanning(resourceId);
      if(plan.value!==planId)return;
      if(resource?.content?.schema!=="adminerva-school-lesson-v1"||
         !Array.isArray(resource.content.plan?.sessions))
        throw Error("This verified-school lesson cannot be used by the current slide editor.");
      const data=structuredClone(resource.content.plan);
      window.selectedPlanData={
        ...data,id:planId,version:resource.revision,
        __schoolResourceId:resource.resourceId,__schoolClientKey:resource.clientKey
      };
      session.replaceChildren();
      const choose=document.createElement("option");choose.value="";choose.textContent="-- Choose a Session --";
      session.append(choose);
      data.sessions.forEach((entry,index)=>{
        const option=document.createElement("option");option.value=String(index);
        option.textContent=entry.session_name||("Session "+(index+1));session.append(option);
      });
      session.disabled=false;
      const source=document.getElementById("presentationSourceStatus");
      if(source)source.textContent="Verified-school lesson revision "+resource.revision+
        " loaded. Choose a session to create an editable slide draft.";
    }catch(error){
      if(plan.value===planId){
        plan.value="";window.selectedPlanData=null;
        session.replaceChildren();
        const failed=document.createElement("option");failed.value="";failed.textContent="Lesson unavailable";
        session.append(failed);session.disabled=true;
        const source=document.getElementById("presentationSourceStatus");
        if(source)source.textContent=error?.message||"Verified-school lesson could not be loaded.";
      }
    }
  };
  window.handleSessionSelection=async()=>{
    const value=session.value,generate=document.getElementById("btnGenerateSlides");
    if(value===""){
      window.selectedSessionIndex=null;window.selectedSessionData=null;
      if(generate){generate.disabled=true;generate.classList.add("opacity-50","cursor-not-allowed");}
      return;
    }
    if(window.adminervaPresentationDirty&&
       !confirm("You have unsaved slide edits. Continue to another lesson session without saving?")){
      session.value=window.selectedSessionIndex??"";return;
    }
    const index=Number(value),entry=window.selectedPlanData?.sessions?.[index];
    if(!entry){session.value="";return;}
    window.selectedSessionIndex=index;window.selectedSessionData=entry;
    window.presentationSourceLessonVersion=window.selectedPlanData.version||null;
    window.adminervaLoadedSchoolPresentation=null;
    window.currentPresentationDeck=[{
      layout:"standard",type:"blank",label:"New session draft",content:"",hidden:false
    }];
    window.activeSlideIndex=0;window.adminervaPresentationDirty=false;
    window.renderSlideBlocks?.();window.selectSlide?.(0);
    if(generate){generate.disabled=false;generate.classList.remove("opacity-50","cursor-not-allowed");}
    const source=document.getElementById("presentationSourceStatus");
    if(source)source.textContent="Verified-school lesson revision "+window.selectedPlanData.version+
      " selected. Build starter slides or generate a draft, then save explicitly.";
  };
  const source=document.getElementById("presentationSourceStatus");
  if(source)source.textContent=summaries.length?
    "Choose one of your verified-school lessons and a session.":"No verified-school lessons are available yet. Create or save a lesson first.";
}
async function mount(){
  const legacySave=document.getElementById("btnSavePresentation");
  if(!legacySave||document.getElementById("v4PresentationSave"))return;
  let school;
  try{school=await activePlanningSchool();}
  catch{return;}
  const v4Only=school.compatibilityMode==="v4_only";
  if(v4Only){
    try{await activateV4LessonSource();}
    catch(error){
      const source=document.getElementById("presentationSourceStatus");
      if(source)source.textContent=error?.message||"Verified-school lesson sources are unavailable.";
    }
  }
  const schoolSave=document.createElement("button");
  schoolSave.id="v4PresentationSave";schoolSave.type="button";
  schoolSave.className=legacySave.className.replace("bg-green-600","bg-indigo-700").replace("hover:bg-green-700","hover:bg-indigo-800");
  schoolSave.innerHTML=v4Only?"<span>💾</span> Save presentation":"<span>🏫</span> Save school copy";
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
        "The verified-school presentation already matches this editor draft.":
        "Presentation saved privately to "+(result.schoolName||result.schoolId)+" · revision "+result.revision+
          (v4Only?".":"; the legacy presentation remains separate during migration."));
    }catch(error){
      alert("School presentation copy was not saved: "+(error?.message||"check your verified school access."));
    }finally{end();schoolSave.disabled=false;}
  })());
  legacySave.after(schoolSave);
  const library=mountSchoolPlanningLibraryButton({
    kind:"presentation",anchor:schoolSave,label:v4Only?"My school presentations":"School copies",
    onOpen:openSchoolPresentation
  });
  const legacyPlan=document.getElementById("presentationPlanSelect");
  legacyPlan?.addEventListener("change",()=>{window.adminervaLoadedSchoolPresentation=null;});
  if(v4Only){
    legacySave.hidden=true;
    const legacyDelete=document.getElementById("btnDeletePresentation");
    if(legacyDelete)legacyDelete.hidden=true;
    if(library)library.title="Open presentations from this verified school's private planning repository.";
  }
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>void mount(),{once:true});
else void mount();
