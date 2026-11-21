import {app} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs?v=4.0.0";

const el=id=>document.getElementById(id);
const api=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolAcademics");
const status=el("ac-status");
let picker=null,busy=false,loading=false,catalogReady=false,currentStep=1,wizardInitialized=false,toastTimer=null;
let years=[],programs=[],terms=[],subjects=[],sections=[],offerings=[];
let allCatalog={academic_years:[],academic_programs:[],terms:[],subjects:[],sections:[]},
  editingCatalog=null,lifecycleChange=null;
const WIZARD=[
  {key:"years",title:"School year"},
  {key:"programs",title:"Division / program"},
  {key:"terms",title:"Academic periods"},
  {key:"subjects",title:"Subjects"},
  {key:"sections",title:"Sections"},
  {key:"offerings",title:"Course offering"}
];

const MONTHS=["January","February","March","April","May","June","July","August","September","October","November","December"];
const periodSize={semester:2,term:3,quarter:4,trimester:3};

function say(message){status.textContent=message;}
function inSystemAdminPreview(){
  try{
    return sessionStorage.getItem("Adminerva_platform_test_mode")==="1"||
      document.getElementById("adminerva-nav")?.dataset.platformTestMode==="true";
  }catch{return false;}
}
function friendlyError(error,fallback="The action could not be completed."){
  const message=String(error?.message||fallback);
  if(/System Admin role test is temporary|school changes are not saved/i.test(message))
    return "System Admin preview is temporary, so this change was not saved. Exit role test and use an actual School Administrator session to save school configuration.";
  return message;
}
function notify(message,tone="info"){
  const host=el("ac-action-message");if(!host)return;
  clearTimeout(toastTimer);host.textContent=message;host.dataset.tone=tone;host.hidden=false;
  toastTimer=setTimeout(()=>{host.hidden=true;},tone==="error"?7000:3500);
}
function platformModePayload(){
  try{
    return sessionStorage.getItem("Adminerva_platform_school_mode")==="assist"?{platformMode:"assist"}:{};
  }catch{return {};}
}
function scoped(action,details={}){
  if(!picker?.scope.current)return Promise.reject(new Error("Choose a verified school first."));
  const lease=picker.scope.lease();
  return api({schoolId:lease.schoolId,action,...platformModePayload(),...details}).then(response=>{
    picker.scope.assertLease(lease);
    return response.data;
  });
}
function setBusy(value,message=""){
  busy=value;
  document.querySelectorAll("form button,#ac-refresh,#ac-wizard-back,#ac-wizard-next,[data-wizard-go]")
    .forEach(button=>button.disabled=value);
  document.querySelectorAll("form button[type=submit]").forEach(button=>button.disabled=value||!catalogReady);
  if(message)say(message);
  if(!value)syncWizard();
}
function slug(value){
  return String(value||"").trim().toLowerCase().normalize("NFKD")
    .replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"").slice(0,72);
}
function codeJoin(parts){
  return parts.filter(Boolean).map(slug).join("_").replace(/_+/g,"_").slice(0,80).replace(/_+$/,"");
}
function dateText(value){
  if(!value)return "";
  const date=new Date(value+"T00:00:00");
  return Number.isNaN(date.getTime())?value:date.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"});
}
function lastDay(year,month){
  return new Date(Date.UTC(year,month,0)).getUTCDate();
}
function isoDate(year,month,day){
  return [String(year).padStart(4,"0"),String(month).padStart(2,"0"),String(day).padStart(2,"0")].join("-");
}
function deriveYearRange(startYear,startMonth=7,endMonth=5){
  const endYear=endMonth<startMonth?startYear+1:startYear;
  return {
    startDate:isoDate(startYear,startMonth,1),
    endDate:isoDate(endYear,endMonth,lastDay(endYear,endMonth)),
    name:"SY "+startYear+"–"+endYear,
    recordId:"sy_"+startYear+"_"+endYear,
    startYear,endYear
  };
}
function itemStartYear(item){
  if(item?.startDate&&/^\d{4}/.test(item.startDate))return Number(item.startDate.slice(0,4));
  const match=String(item?.name||item?.id||"").match(/(20\d{2})/);
  return match?Number(match[1]):null;
}
function suggestedYear(){
  const now=new Date(),startMonth=7,endMonth=5;
  let startYear=now.getMonth()+1>=startMonth?now.getFullYear():now.getFullYear()-1;
  const used=new Set((allCatalog.academic_years.length?allCatalog.academic_years:years)
    .map(itemStartYear).filter(Number.isInteger));
  while(used.has(startYear))startYear++;
  return deriveYearRange(startYear,startMonth,endMonth);
}
function optionLabel(item){return item?.name||item?.id||"";}
function currentYearId(){
  const today=new Date().toISOString().slice(0,10);
  const exact=years.find(item=>item.startDate&&item.endDate&&item.startDate<=today&&item.endDate>=today);
  if(exact)return exact.id;
  const ordered=[...years].sort((a,b)=>(itemStartYear(b)||0)-(itemStartYear(a)||0));
  return ordered[0]?.id||"";
}
function fillSelect(select,items,{placeholder="Choose…",filter=()=>true,preferred="",label=optionLabel}={}){
  const available=items.filter(filter);
  const previous=select.value;
  select.replaceChildren(new Option(placeholder,""));
  for(const item of available)select.add(new Option(label(item),item.id));
  const next=available.some(item=>item.id===previous)?previous:
    available.some(item=>item.id===preferred)?preferred:
    available.length===1?available[0].id:"";
  select.value=next;
}
function catalogLabel(kind){
  return {academic_years:"Academic year",academic_programs:"Program / division",terms:"Academic period",
    subjects:"Subject",sections:"Section"}[kind]||"Academic record";
}
function catalogForm(kind){
  return {
    academic_years:el("ac-year-form"),academic_programs:el("ac-program-form"),
    terms:el("ac-term-form"),subjects:el("ac-subject-form"),sections:el("ac-section-form")
  }[kind]||null;
}
function ensureCancelEditButton(form){
  let button=form?.querySelector("[data-cancel-catalog-edit]");
  if(button)return button;
  button=document.createElement("button");button.type="button";button.className="ac-btn";
  button.dataset.cancelCatalogEdit="true";button.textContent="Cancel edit";button.hidden=true;
  form?.append(button);button.addEventListener("click",cancelCatalogEdit);return button;
}
function renderList(host,items,meta,kind){
  host.replaceChildren();
  if(!items.length){
    const empty=document.createElement("p");empty.className="ac-muted py-2";empty.textContent="No records yet.";host.append(empty);return;
  }
  for(const item of items){
    const row=document.createElement("div");row.className="ac-row";
    const left=document.createElement("div");
    const name=document.createElement("strong");name.textContent=item.name||item.id;
    const detail=document.createElement("p");detail.className="ac-muted";detail.textContent=meta(item);
    left.append(name,detail);
    const actions=document.createElement("div");actions.className="ac-row-actions";
    const state=document.createElement("span");state.className="ac-state";
    state.dataset.state=item.status||"active";state.textContent=item.status||"active";actions.append(state);
    if(item.status==="active"){
      const edit=document.createElement("button");edit.type="button";edit.className="ac-btn";
      edit.textContent="Edit";edit.addEventListener("click",()=>beginCatalogEdit(kind,item));actions.append(edit);
      const archive=document.createElement("button");archive.type="button";archive.className="ac-btn danger";
      archive.textContent="Archive";archive.addEventListener("click",()=>openLifecycle({
        type:"catalog",mode:"archive",kind,item
      }));actions.append(archive);
    }else if(item.status==="archived"){
      const restore=document.createElement("button");restore.type="button";restore.className="ac-btn success";
      restore.textContent="Restore";restore.addEventListener("click",()=>openLifecycle({
        type:"catalog",mode:"restore",kind,item
      }));actions.append(restore);
    }
    row.append(left,actions);host.append(row);
  }
}
function defaultSubmitLabel(kind){
  return {academic_years:"Add academic year",academic_programs:"Add program / division",
    terms:"Add academic period",subjects:"Add subject",sections:"Add section"}[kind]||"Save";
}
function catalogKindForForm(form){
  return new Map([
    [el("ac-year-form"),"academic_years"],[el("ac-program-form"),"academic_programs"],
    [el("ac-term-form"),"terms"],[el("ac-subject-form"),"subjects"],[el("ac-section-form"),"sections"]
  ]).get(form)||"";
}
function findCatalog(kind,id){
  return (allCatalog[kind]||[]).find(item=>item.id===id)||null;
}
function syncActiveCatalog(){
  years=allCatalog.academic_years.filter(item=>item.status==="active");
  programs=allCatalog.academic_programs.filter(item=>item.status==="active");
  terms=allCatalog.terms.filter(item=>item.status==="active");
  subjects=allCatalog.subjects.filter(item=>item.status==="active");
  sections=allCatalog.sections.filter(item=>item.status==="active");
}
function cancelCatalogEdit(){
  if(!editingCatalog)return;
  const {kind}=editingCatalog,form=catalogForm(kind);
  editingCatalog=null;
  if(form){
    form.reset();clearManual(form);
    if(form.elements.recordId){form.elements.recordId.readOnly=false;form.elements.recordId.dataset.manual="false";}
    const submit=form.querySelector('button[type="submit"]');if(submit)submit.textContent=defaultSubmitLabel(kind);
    const cancel=form.querySelector("[data-cancel-catalog-edit]");if(cancel)cancel.hidden=true;
  }
  renderCatalog();
  notify("Edit cancelled.","info");
}
function beginCatalogEdit(kind,item){
  if(busy||item.status!=="active")return;
  if(editingCatalog)cancelCatalogEdit();
  const form=catalogForm(kind);if(!form)return;
  editingCatalog={kind,item:{...item}};
  form.reset();clearManual(form);
  if(form.elements.recordId){
    form.elements.recordId.value=item.id;form.elements.recordId.readOnly=true;
    form.elements.recordId.dataset.manual="true";
  }
  if(form.elements.name)form.elements.name.value=item.name||"";
  if(kind==="academic_years"){
    form.elements.startDate.value=item.startDate||"";
    form.elements.endDate.value=item.endDate||"";
  }else if(kind==="terms"){
    form.elements.yearId.value=item.yearId||"";
    form.elements.programId.value=item.programId||"";
    form.elements.periodType.value=item.periodType||"term";
    form.elements.sequence.value=String(item.sequence||1);
    form.elements.startDate.value=item.startDate||"";
    form.elements.endDate.value=item.endDate||"";
  }else if(kind==="sections"){
    form.elements.programId.value=item.programId||"";
    updateSectionGradeOptions();
    form.elements.gradeLevel.value=item.gradeLevel||"";
    form.elements.pathway.value=item.pathway||"";
    updateSectionPathwayVisibility();
  }
  const submit=form.querySelector('button[type="submit"]');if(submit)submit.textContent="Save changes";
  ensureCancelEditButton(form).hidden=false;
  form.scrollIntoView({behavior:"smooth",block:"start"});
  setTimeout(()=>form.elements.name?.focus?.(),180);
  notify("Editing "+catalogLabel(kind)+". The system code stays fixed so historical references remain intact.","info");
}
function openLifecycle(change){
  if(busy)return;
  lifecycleChange=change;
  const {type,mode,item}=change,restoring=mode==="restore",
    title=el("ac-lifecycle-title"),target=el("ac-lifecycle-target"),
    help=el("ac-lifecycle-help"),confirm=el("ac-lifecycle-confirm"),form=el("ac-lifecycle-form");
  form.reset();
  title.textContent=(restoring?"Restore ":"Archive ")+(type==="offering"?"class offering":catalogLabel(change.kind).toLowerCase());
  target.textContent=type==="offering"?
    ((findCatalog("subjects",item.subjectId)?.name||item.subjectId)+" · "+
      (findCatalog("sections",item.sectionId)?.name||item.sectionId)):
    (item.name||item.id)+" · "+item.id;
  const dependencyActions=el("ac-lifecycle-actions"),
    classLink=el("ac-lifecycle-open-classes"),enrollmentLink=el("ac-lifecycle-open-enrollment");
  dependencyActions.hidden=true;classLink.hidden=false;enrollmentLink.hidden=false;
  if(type==="offering"){
    help.textContent=restoring
      ?"Restoring reactivates the class record. Official-section rosters are rebuilt from current registrations, but teacher assignments and the old schedule stay ended/archived so staffing and conflicts can be reviewed again."
      :"Retiring the class ends its active class enrollments and teacher assignments, archives its official schedule, and preserves assessments, submissions, grades and history. An open or future published assessment blocks retirement.";
    if(!restoring){dependencyActions.hidden=false;enrollmentLink.hidden=true;}
  }else{
    help.textContent=restoring
      ?"Restoring makes this academic record selectable again. Required parent records must already be active."
      :"Archiving removes this record from normal setup choices without deleting history. Active dependent records must be ended or archived first.";
    if(!restoring){
      dependencyActions.hidden=false;
      if(change.kind==="subjects"){enrollmentLink.hidden=true;}
      if(change.kind==="academic_years"||change.kind==="academic_programs"||
         change.kind==="terms"||change.kind==="sections"){
        classLink.hidden=false;enrollmentLink.hidden=false;
      }
    }
  }
  confirm.textContent=restoring?"Restore":"Archive";
  confirm.className="ac-btn "+(restoring?"success":"danger");
  el("ac-lifecycle-dialog").showModal();
}
function closeLifecycle(){
  if(busy)return;
  lifecycleChange=null;el("ac-lifecycle-dialog").close();
}

function configuredCount(step){
  return [years,programs,terms,subjects,sections,offerings.filter(item=>item.status==="active")][step-1]?.length||0;
}
function stepReady(step){return configuredCount(step)>0;}
function firstIncompleteStep(){
  for(let step=1;step<=WIZARD.length;step++)if(!stepReady(step))return step;
  return WIZARD.length;
}
function canOpenStep(step){
  if(step<=1)return true;
  for(let prior=1;prior<step;prior++)if(!stepReady(prior))return false;
  return true;
}
function syncWizard(){
  if(!WIZARD[currentStep-1])currentStep=1;
  const completed=WIZARD.reduce((sum,_,index)=>sum+(stepReady(index+1)?1:0),0);
  WIZARD.forEach((step,index)=>{
    const number=index+1,count=configuredCount(number),label=el("ac-step-"+step.key),
      button=document.querySelector('[data-wizard-go="'+number+'"]');
    if(label)label.textContent=count?count+" configured":"Not configured";
    if(button){
      button.dataset.ready=String(Boolean(count));
      button.dataset.active=String(number===currentStep);
      button.disabled=busy||(!canOpenStep(number)&&number!==currentStep);
      button.setAttribute("aria-current",number===currentStep?"step":"false");
    }
  });
  const title=el("ac-wizard-title"),count=el("ac-wizard-count"),fill=el("ac-progress-fill"),
    back=el("ac-wizard-back"),next=el("ac-wizard-next"),navStatus=el("ac-wizard-nav-status");
  if(title)title.textContent="Step "+currentStep+" · "+WIZARD[currentStep-1].title;
  if(count)count.textContent=currentStep+" of "+WIZARD.length+" · "+completed+" completed";
  if(fill)fill.style.width=(currentStep/WIZARD.length*100)+"%";
  if(back)back.disabled=busy||currentStep===1;
  if(next){
    next.hidden=currentStep===WIZARD.length;
    next.disabled=busy||!stepReady(currentStep);
    next.textContent=currentStep===WIZARD.length-1?"Next: Course offering →":"Next →";
  }
  if(navStatus){
    navStatus.textContent=stepReady(currentStep)?
      (currentStep===WIZARD.length?"Academic structure has a course offering. You can review any completed step above.":"Step complete. Continue when ready."):
      "Save at least one "+WIZARD[currentStep-1].title.toLowerCase()+" record to continue.";
  }
}
function showWizardStep(step,{scroll=true,force=false}={}){
  const target=Math.max(1,Math.min(WIZARD.length,Number(step)||1));
  if(!force&&!canOpenStep(target)){
    const missing=firstIncompleteStep();
    notify("Complete Step "+missing+" ("+WIZARD[missing-1].title+") before moving forward.","error");
    return false;
  }
  currentStep=target;
  el("ac-catalog").hidden=target===6;
  for(const card of el("ac-catalog").querySelectorAll("[data-wizard-step]"))
    card.hidden=Number(card.dataset.wizardStep)!==target;
  el("ac-offerings").hidden=target!==6;
  syncWizard();
  if(scroll){
    const active=target===6?el("ac-offerings"):el("ac-catalog").querySelector('[data-wizard-step="'+target+'"]');
    active?.scrollIntoView({behavior:"smooth",block:"start"});
    setTimeout(()=>active?.querySelector("input,select,button")?.focus?.(),220);
  }
  return true;
}
function updateSteps(){syncWizard();}
function setAuto(form,key,value,force=false){
  const field=form?.elements?.[key];if(!field)return;
  if(force||field.dataset.manual!=="true")field.value=value||"";
}
function resetAuto(group){
  if(group==="year"){
    const form=el("ac-year-form");for(const key of ["name","recordId"])form.elements[key].dataset.manual="false";
    updateYearSuggestion(true);
  }else if(group==="program"){
    const form=el("ac-program-form");form.elements.recordId.dataset.manual="false";updateSimpleCode(form,true);
  }else if(group==="subject"){
    const form=el("ac-subject-form");form.elements.recordId.dataset.manual="false";updateSimpleCode(form,true);
  }else if(group==="section"){
    const form=el("ac-section-form");form.elements.recordId.dataset.manual="false";updateSectionGradeOptions();updateSectionCode(true);
  }else if(group==="term"){
    const form=el("ac-term-form");for(const key of ["name","recordId"])form.elements[key].dataset.manual="false";
    updateTermSuggestion(true);
  }
}
function updateYearSuggestion(force=false){
  const form=el("ac-year-form"),suggestion=suggestedYear();
  if(force||!form.elements.startDate.value)form.elements.startDate.value=suggestion.startDate;
  if(force||!form.elements.endDate.value)form.elements.endDate.value=suggestion.endDate;
  const start=form.elements.startDate.value,end=form.elements.endDate.value;
  if(start){
    const startYear=Number(start.slice(0,4)),startMonth=Number(start.slice(5,7));
    let endYear=end?Number(end.slice(0,4)):startYear+1;
    if(!end||end<=start){
      const endMonth=5;endYear=endMonth<startMonth?startYear+1:startYear;
      form.elements.endDate.value=isoDate(endYear,endMonth,lastDay(endYear,endMonth));
    }
    const finalEnd=form.elements.endDate.value;
    const finalEndYear=Number(finalEnd.slice(0,4));
    setAuto(form,"name","SY "+startYear+"–"+finalEndYear,force);
    setAuto(form,"recordId","sy_"+startYear+"_"+finalEndYear,force);
    el("ac-year-suggestion").textContent="Suggested: "+form.elements.name.value+" · "+
      dateText(start)+" to "+dateText(finalEnd)+". You can change the dates before saving.";
  }
}
function updateSimpleCode(form,force=false){
  setAuto(form,"recordId",slug(form.elements.name.value),force);
}
function programShortCode(programId){
  const program=programs.find(item=>item.id===programId),name=String(program?.name||programId||"").trim();
  const normalized=name.toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  if(/\bsenior high school\b|\bshs\b/.test(normalized))return "shs";
  if(/\bjunior high school\b|\bjhs\b/.test(normalized))return "jhs";
  if(/\bspecial needs education\b|\bsned\b/.test(normalized))return "sned";
  if(/\bearly childhood\b|\bece\b|\bkinder(?:garten)?\b|\bpreschool\b/.test(normalized))return "ece";
  if(/\bbasic education\b/.test(normalized))return "be";
  if(/\belementary\b|\bgrade school\b/.test(normalized))return "elem";
  if(/\bcollege\b|\btertiary\b/.test(normalized))return "college";
  const words=normalized.split(/\s+/).filter(word=>word&&!["of","the","and","for"].includes(word));
  const initials=words.map(word=>word[0]).join("").slice(0,6);
  return initials||slug(programId).slice(0,8)||"program";
}
function compactSectionToken(value){
  return String(value||"").normalize("NFKD").replace(/[^A-Za-z0-9]+/g," ").trim().split(/\s+/)
    .filter(Boolean).map(word=>word.charAt(0).toUpperCase()+word.slice(1)).join("").slice(0,48);
}
function levelOptionsForProgram(programId){
  const program=programs.find(item=>item.id===programId),name=String(program?.name||"").toLowerCase();
  if(/special needs education|\bsned\b|\bsne[d]?\b/.test(name))return [
    {value:"sned_elem",label:"SNED Elementary (Grades 1–6)",code:"elem"},
    {value:"sned_jhs",label:"SNED Junior High (Grades 7–10)",code:"jhs"}
  ];
  if(/early childhood|\bece\b|kinder|kindergarten|preschool|pre-school/.test(name))return [
    {value:"nursery_prep",label:"Nursery / Prep",code:"prep"},
    {value:"kinder_1",label:"Kinder 1",code:"k1"},
    {value:"kinder_2",label:"Kinder 2",code:"k2"}
  ];
  if(/senior high|\bshs\b/.test(name))return [11,12].map(n=>({value:String(n),label:"Grade "+n,code:String(n)}));
  if(/junior high|\bjhs\b/.test(name))return [7,8,9,10].map(n=>({value:String(n),label:"Grade "+n,code:String(n)}));
  if(/elementary|grade school/.test(name))return [1,2,3,4,5,6].map(n=>({value:String(n),label:"Grade "+n,code:String(n)}));
  return [1,2,3,4,5,6,7,8,9,10,11,12].map(n=>({value:String(n),label:"Grade "+n,code:String(n)}));
}
function levelMeta(programId,value){
  return levelOptionsForProgram(programId).find(item=>item.value===String(value||""))||null;
}
function levelLabel(programId,value){
  return levelMeta(programId,value)?.label||(
    /^\d+$/.test(String(value||""))?"Grade "+value:String(value||"")
  );
}
function updateSectionGradeOptions(){
  const form=el("ac-section-form"),select=form.elements.gradeLevel,previous=select.value;
  const levels=levelOptionsForProgram(form.elements.programId.value);
  select.replaceChildren(new Option("Choose grade / level",""));
  for(const level of levels)select.add(new Option(level.label,level.value));
  select.value=levels.some(level=>level.value===previous)?previous:"";
}
function isSeniorHighProgram(programId){
  const program=programs.find(item=>item.id===programId),name=String(program?.name||programId||"").toLowerCase();
  return /senior high|\bshs\b/.test(name);
}
function updateSectionPathwayVisibility(){
  const form=el("ac-section-form"),wrap=el("ac-section-pathway-wrap"),shs=isSeniorHighProgram(form.elements.programId.value);
  if(wrap)wrap.hidden=!shs;
  if(!shs&&form.elements.pathway)form.elements.pathway.value="";
}
function updateSectionCode(force=false){
  const form=el("ac-section-form"),program=programShortCode(form.elements.programId.value),
    level=levelMeta(form.elements.programId.value,form.elements.gradeLevel.value),
    levelCode=level?.code||String(form.elements.gradeLevel.value||"").trim(),
    pathway=isSeniorHighProgram(form.elements.programId.value)?compactSectionToken(form.elements.pathway?.value||""):"",
    name=compactSectionToken(form.elements.name.value);
  const generated=[program,levelCode,pathway,name].filter(Boolean).join("_").slice(0,80);
  setAuto(form,"recordId",generated,force);
}
function yearRange(item){
  if(!item)return null;
  if(item.startDate&&item.endDate)return {start:item.startDate,end:item.endDate};
  const startYear=itemStartYear(item);if(!startYear)return null;
  const startMonth=Number(item.startMonth)||7,endMonth=Number(item.endMonth)||5;
  const inferred=deriveYearRange(startYear,startMonth,endMonth);
  return {start:inferred.startDate,end:inferred.endDate};
}
function splitRange(start,end,index,total){
  const first=new Date(start+"T00:00:00Z"),last=new Date(end+"T00:00:00Z");
  const span=last.getTime()-first.getTime();
  if(span<0||!total)return null;
  const startMs=first.getTime()+Math.floor(span*index/total);
  const endMs=index===total-1?last.getTime():first.getTime()+Math.floor(span*(index+1)/total)-86400000;
  return {
    start:new Date(startMs).toISOString().slice(0,10),
    end:new Date(endMs).toISOString().slice(0,10)
  };
}
function termLabel(type,sequence){
  const label={semester:"Semester",term:"Term",quarter:"Quarter",trimester:"Trimester",custom:"Period"}[type]||"Period";
  return label+" "+sequence;
}
function updateTermSuggestion(force=false){
  const form=el("ac-term-form"),yearId=form.elements.yearId.value,programId=form.elements.programId.value,
    type=form.elements.periodType.value;
  const matching=terms.filter(item=>item.yearId===yearId&&item.programId===programId&&item.periodType===type);
  if(force||form.elements.sequence.dataset.manual!=="true"){
    const next=Math.max(0,...matching.map(item=>Number(item.sequence)||0))+1;
    form.elements.sequence.value=String(Math.min(12,next||1));
  }
  const sequence=Math.max(1,Number(form.elements.sequence.value)||1),name=termLabel(type,sequence);
  const short={semester:"sem",term:"term",quarter:"q",trimester:"tri",custom:"period"}[type]||"period";
  setAuto(form,"name",name,force);
  setAuto(form,"recordId",codeJoin([programId,yearId,short+sequence]),force);

  const year=years.find(item=>item.id===yearId),range=yearRange(year),total=periodSize[type];
  if(range&&total&&sequence<=total){
    const part=splitRange(range.start,range.end,sequence-1,total);
    if(part){
      if(force||form.elements.startDate.dataset.manual!=="true")form.elements.startDate.value=part.start;
      if(force||form.elements.endDate.dataset.manual!=="true")form.elements.endDate.value=part.end;
    }
  }else if(type==="custom"&&force){
    form.elements.startDate.value="";form.elements.endDate.value="";
  }
  const dates=form.elements.startDate.value&&form.elements.endDate.value?
    " · suggested dates "+dateText(form.elements.startDate.value)+" to "+dateText(form.elements.endDate.value):"";
  el("ac-term-suggestion").textContent=yearId&&programId?
    "Next suggested record: "+form.elements.name.value+dates+". Edit any suggestion if the official calendar differs.":
    "Choose a school year and program to calculate the next period.";
}
function defaultPeriodType(){
  const form=el("ac-term-form"),program=programs.find(item=>item.id===form.elements.programId.value);
  const text=(program?.name||program?.id||"").toLowerCase();
  if(/senior high|\bshs\b/.test(text))return "semester";
  if(/basic|junior high|\bjhs\b/.test(text))return "term";
  return form.elements.periodType.value||"semester";
}
function updateOfferingPreview(){
  const form=el("ac-offering-form");
  const get=(items,id)=>items.find(item=>item.id===id)?.name||"";
  const selected={
    program:get(programs,form.elements.programId.value),
    year:get(years,form.elements.yearId.value),
    term:get(terms,form.elements.termId.value),
    section:get(sections,form.elements.sectionId.value),
    subject:get(subjects,form.elements.subjectId.value)
  };
  const rosterLabel=form.elements.rosterMode.value==="selective"?"Selective / manual roster":"Official section placement";
  const ready=Object.values(selected).every(Boolean),host=el("ac-offering-preview");
  if(!ready){host.textContent="Choose the required fields to preview this course offering.";return;}
  host.replaceChildren();
  const title=document.createElement("strong");title.textContent=selected.subject+" · "+selected.section;
  const meta=document.createElement("span");meta.className="ac-muted";meta.textContent=[selected.program,selected.year,selected.term,rosterLabel].join(" · ");
  host.append(title,meta);
}
function renderCatalog(){
  renderList(el("ac-years"),allCatalog.academic_years,item=>{
    const dates=item.startDate&&item.endDate?dateText(item.startDate)+" → "+dateText(item.endDate):
      MONTHS[(Number(item.startMonth)||7)-1]+" → "+MONTHS[(Number(item.endMonth)||5)-1];
    return "ID: "+item.id+" · "+dates;
  },"academic_years");
  renderList(el("ac-programs"),allCatalog.academic_programs,item=>"ID: "+item.id,"academic_programs");
  renderList(el("ac-terms"),allCatalog.terms,item=>{
    const year=findCatalog("academic_years",item.yearId)?.name||item.yearId||"";
    const program=findCatalog("academic_programs",item.programId)?.name||item.programId||"";
    const dates=item.startDate&&item.endDate?dateText(item.startDate)+" → "+dateText(item.endDate):null;
    return [program,year,item.periodType,item.sequence?"#"+item.sequence:null,dates].filter(Boolean).join(" · ");
  },"terms");
  renderList(el("ac-subjects"),allCatalog.subjects,item=>"ID: "+item.id,"subjects");
  renderList(el("ac-sections"),allCatalog.sections,item=>{
    const program=findCatalog("academic_programs",item.programId)?.name||item.programId||"Unassigned program";
    const level=item.gradeLevel?levelLabel(item.programId,item.gradeLevel):null;
    return [program,level,item.pathway||null,"ID: "+item.id].filter(Boolean).join(" · ");
  },"sections");

  const termForm=el("ac-term-form"),sectionForm=el("ac-section-form"),offeringForm=el("ac-offering-form");
  const preferredYear=currentYearId();
  fillSelect(termForm.elements.programId,programs,{placeholder:"Choose program / division"});
  fillSelect(termForm.elements.yearId,years,{placeholder:"Choose academic year",preferred:preferredYear});
  fillSelect(sectionForm.elements.programId,programs,{placeholder:"Choose program / division"});
  updateSectionGradeOptions();
  updateSectionPathwayVisibility();

  fillSelect(offeringForm.elements.programId,programs,{placeholder:"Choose program / division"});
  fillSelect(offeringForm.elements.yearId,years,{placeholder:"Choose academic year",preferred:preferredYear});
  fillSelect(offeringForm.elements.subjectId,subjects,{placeholder:"Choose subject"});

  const offeringProgram=offeringForm.elements.programId.value,offeringYear=offeringForm.elements.yearId.value;
  fillSelect(offeringForm.elements.sectionId,sections,{
    placeholder:"Choose section",
    filter:item=>!offeringProgram||item.programId===offeringProgram,
    label:item=>(item.gradeLevel?levelLabel(item.programId,item.gradeLevel)+" · ":"")+(item.name||item.id)
  });
  const matchingTerms=terms.filter(item=>(!offeringProgram||item.programId===offeringProgram)&&(!offeringYear||item.yearId===offeringYear));
  let preferredTerm="";
  const today=new Date().toISOString().slice(0,10);
  preferredTerm=matchingTerms.find(item=>item.startDate&&item.endDate&&item.startDate<=today&&item.endDate>=today)?.id||
    [...matchingTerms].sort((a,b)=>(Number(a.sequence)||99)-(Number(b.sequence)||99))[0]?.id||"";
  fillSelect(offeringForm.elements.termId,terms,{placeholder:"Choose academic period",
    filter:item=>(!offeringProgram||item.programId===offeringProgram)&&(!offeringYear||item.yearId===offeringYear),
    preferred:preferredTerm});

  updateSteps();updateYearSuggestion();updateTermSuggestion();updateSectionCode();updateOfferingPreview();
  renderOfferings();
}
function renderOfferings(){
  const host=el("ac-offering-list");host.replaceChildren();
  const active=offerings.filter(item=>item.status==="active"),archived=offerings.filter(item=>item.status==="archived");
  el("ac-offering-count").textContent=active.length+" active"+(archived.length?" · "+archived.length+" archived":"");
  if(!offerings.length){
    const p=document.createElement("p");p.className="ac-muted py-3";p.textContent="No course offerings yet. Complete the setup steps, then create the first offering here.";host.append(p);return;
  }
  for(const item of [...active,...archived]){
    const row=document.createElement("div");row.className="ac-row";
    const left=document.createElement("div");
    const title=document.createElement("strong");
    title.textContent=(findCatalog("subjects",item.subjectId)?.name||item.subjectId)+" · "+
      (findCatalog("sections",item.sectionId)?.name||item.sectionId);
    const meta=document.createElement("p");meta.className="ac-muted";
    meta.textContent=[
      findCatalog("academic_programs",item.programId)?.name||item.programId,
      findCatalog("academic_years",item.yearId)?.name||item.yearId,
      findCatalog("terms",item.termId)?.name||item.termId,
      item.rosterMode==="selective"?"Selective roster":"Official section roster"
    ].filter(Boolean).join(" · ");
    left.append(title,meta);
    const actions=document.createElement("div");actions.className="ac-row-actions";
    const tag=document.createElement("span");tag.className="ac-state";tag.dataset.state=item.status||"active";
    tag.textContent=item.status||"active";actions.append(tag);
    const lifecycle=document.createElement("button");lifecycle.type="button";
    lifecycle.className="ac-btn "+(item.status==="archived"?"success":"danger");
    lifecycle.textContent=item.status==="archived"?"Restore":"Retire";
    lifecycle.addEventListener("click",()=>openLifecycle({
      type:"offering",mode:item.status==="archived"?"restore":"archive",item
    }));
    actions.append(lifecycle);row.append(left,actions);host.append(row);
  }
}
async function load({afterWrite=false}={}){
  if(loading||busy&&!afterWrite)return false;
  loading=true;catalogReady=false;
  setBusy(true,"Loading academic configuration…");
  try{
    const [y,p,t,s,sec,o]=await Promise.all([
      scoped("list_catalog",{kind:"academic_years"}),
      scoped("list_catalog",{kind:"academic_programs"}),
      scoped("list_catalog",{kind:"terms"}),
      scoped("list_catalog",{kind:"subjects"}),
      scoped("list_catalog",{kind:"sections"}),
      scoped("list_offerings")
    ]);
    allCatalog={
      academic_years:y.items||[],academic_programs:p.items||[],terms:t.items||[],
      subjects:s.items||[],sections:sec.items||[]
    };
    syncActiveCatalog();
    offerings=o.offerings||[];catalogReady=true;
    renderCatalog();
    if(!wizardInitialized){
      wizardInitialized=true;
      currentStep=firstIncompleteStep();
      showWizardStep(currentStep,{scroll:false,force:true});
    }else showWizardStep(currentStep,{scroll:false,force:true});
    say("Academic configuration loaded. Configure one step at a time; saved steps unlock the next step."+( [y,p,t,s,sec,o].some(result=>result.truncated)?" Some results reached their display limit.":""));
    return true;
  }catch(error){
    const message=friendlyError(error,"Academic configuration could not be loaded.");
    say(message);notify(message,"error");return false;
  }finally{loading=false;if(!afterWrite)setBusy(false);}
}
function payload(form){
  const data=new FormData(form),out={};
  for(const [key,value] of data.entries())out[key]=typeof value==="string"?value.trim():value;
  return out;
}
function clearManual(form){
  for(const field of form.querySelectorAll("input,select"))field.dataset.manual="false";
}
async function createCatalog(form,kind,extra=()=>({})){
  if(busy||!catalogReady)return false;
  if(!form.reportValidity()){
    notify("Complete the required fields in this step before saving.","error");
    return false;
  }
  const edit=editingCatalog?.kind===kind?editingCatalog:null,data=payload(form);
  if(edit)data.recordId=edit.item.id;
  const source=allCatalog[kind]||[];
  const nameKey=value=>String(value||"").trim().toLocaleLowerCase("en");
  const duplicate=source.find(item=>item.id!==edit?.item.id&&
    (item.id===data.recordId||(nameKey(item.name)===nameKey(data.name)&&
      (kind!=="terms"||(item.yearId===data.yearId&&item.programId===data.programId))&&
      (kind!=="sections"||(item.programId===data.programId&&String(item.gradeLevel)===String(data.gradeLevel))))));
  if(duplicate){
    const message="“"+data.name+"” already exists in this school"+(duplicate.status==="archived"?" as an archived record. Restore that record instead.":". Use the existing record instead of creating a duplicate.");
    say(message);notify(message,"error");form.elements.name?.focus();return false;
  }
  const details={kind,...data,...extra(data),...(edit?{expectedRevision:edit.item.revision}:{})},
    action=edit?"update_catalog":"create_catalog";
  if(inSystemAdminPreview()&&document.getElementById("adminerva-nav")?.dataset.platformAssistMode!=="true"){
    if(edit){
      const target=findCatalog(kind,edit.item.id);
      if(target)Object.assign(target,{...details,id:edit.item.id,status:"active",revision:(Number(edit.item.revision)||1)+1,preview:true});
    }else{
      const preview={...details,id:data.recordId,status:"active",revision:1,preview:true};
      delete preview.kind;delete preview.recordId;delete preview.expectedRevision;source.push(preview);
    }
    editingCatalog=null;
    form.reset();clearManual(form);
    if(form.elements.recordId){form.elements.recordId.readOnly=false;form.elements.recordId.dataset.manual="false";}
    const cancel=form.querySelector("[data-cancel-catalog-edit]");if(cancel)cancel.hidden=true;
    const submit=form.querySelector('button[type="submit"]');if(submit)submit.textContent=defaultSubmitLabel(kind);
    syncActiveCatalog();renderCatalog();
    const label=catalogLabel(kind),message=label+(edit?" updated":" created")+" for this temporary System Admin preview. It will disappear when you reload or exit role test.";
    say(message);notify(message,"success");syncWizard();
    return {preview:true};
  }
  const submit=form.querySelector('button[type="submit"]'),original=submit?.textContent||defaultSubmitLabel(kind);
  if(submit)submit.textContent="Saving…";
  setBusy(true,(edit?"Updating ":"Saving ")+catalogLabel(kind).toLowerCase()+"…");
  try{
    const result=await scoped(action,details),wasEditing=Boolean(edit);
    editingCatalog=null;
    form.reset();clearManual(form);
    if(form.elements.recordId){form.elements.recordId.readOnly=false;form.elements.recordId.dataset.manual="false";}
    const cancel=form.querySelector("[data-cancel-catalog-edit]");if(cancel)cancel.hidden=true;
    const refreshed=await load({afterWrite:true});
    const label=catalogLabel(kind),message=label+(wasEditing?" updated":" saved")+" successfully.";
    say(refreshed?message:message+" Refresh failed; reload before another change.");
    notify(message+(refreshed?"":" Refresh required."),refreshed?"success":"info");
    return result||true;
  }catch(error){
    const message=friendlyError(error,(edit?"Academic record was not updated.":"Academic record was not saved."));
    say(message);notify(message,"error");return false;
  }finally{
    if(submit)submit.textContent=editingCatalog?.kind===kind?"Save changes":defaultSubmitLabel(kind);
    setBusy(false);
  }
}

el("ac-year-form").addEventListener("submit",event=>{
  event.preventDefault();void createCatalog(event.currentTarget,"academic_years",data=>({
    startMonth:Number(data.startDate.slice(5,7)),endMonth:Number(data.endDate.slice(5,7)),
    startDate:data.startDate,endDate:data.endDate
  }));
});
el("ac-program-form").addEventListener("submit",event=>{
  event.preventDefault();void createCatalog(event.currentTarget,"academic_programs");
});
el("ac-term-form").addEventListener("submit",event=>{
  event.preventDefault();void createCatalog(event.currentTarget,"terms",data=>({
    sequence:Number(data.sequence),startDate:data.startDate||null,endDate:data.endDate||null
  }));
});
el("ac-subject-form").addEventListener("submit",event=>{
  event.preventDefault();void createCatalog(event.currentTarget,"subjects");
});
el("ac-section-form").addEventListener("submit",event=>{
  event.preventDefault();void createCatalog(event.currentTarget,"sections");
});
el("ac-offering-form").addEventListener("submit",event=>{
  event.preventDefault();
  const form=event.currentTarget;
  if(busy||!catalogReady)return;
  if(!form.reportValidity()){notify("Complete all course-offering fields before saving.","error");return;}
  const data=payload(form);
  const existing=offerings.find(item=>item.programId===data.programId&&item.yearId===data.yearId&&
    item.termId===data.termId&&item.sectionId===data.sectionId&&item.subjectId===data.subjectId);
  if(existing){
    const message=existing.status==="archived"
      ?"This class offering already exists as an archived record. Restore it instead of creating a duplicate."
      :"This class offering already exists. Open the existing class instead of creating a duplicate.";
    say(message);notify(message,"error");return;
  }
  if(inSystemAdminPreview()&&document.getElementById("adminerva-nav")?.dataset.platformAssistMode!=="true"){
    offerings.push({offeringId:"preview_"+Date.now(),...data,status:"active",preview:true});
    form.reset();clearManual(form);renderCatalog();
    const message="Course offering created for this temporary System Admin preview. It will disappear when you reload or exit role test.";
    say(message);notify(message,"success");syncWizard();return;
  }
  const submit=form.querySelector('button[type="submit"]'),original=submit?.textContent||"Create course offering";
  if(submit)submit.textContent="Saving…";
  setBusy(true,"Creating course offering…");
  void scoped("create_offering",data).then(async result=>{
    form.reset();clearManual(form);const refreshed=await load({afterWrite:true});
    const roster=Number(result?.officialRegistrationCount)||0,added=Number(result?.autoEnrolled)||0;
    const rosterMessage=result?.rosterMode==="selective"?
      " This class uses a selective/manual roster, so section-wide enrollment was not performed.":
      roster?
        " "+added+" officially placed student"+(added===1?" was":"s were")+" automatically added to the new class roster.":
        " No active official section placements needed roster synchronization.";
    const message="Class offering saved successfully."+rosterMessage+(refreshed?"":" Refresh failed; reload before creating another class.");
    say(message);notify(message,refreshed?"success":"info");
  }).catch(error=>{
    const message=friendlyError(error,"Course offering was not created.");
    say(message);notify(message,"error");
  }).finally(()=>{
    if(submit)submit.textContent=original;
    setBusy(false);
  });
});

for(const form of [el("ac-year-form"),el("ac-program-form"),el("ac-term-form"),el("ac-subject-form"),el("ac-section-form")]){
  for(const input of form.querySelectorAll("input")){
    input.addEventListener("input",()=>{
      if(["recordId","name","sequence","startDate","endDate"].includes(input.name))input.dataset.manual="true";
    });
  }
}
el("ac-year-form").elements.startDate.addEventListener("change",()=>updateYearSuggestion());
el("ac-year-form").elements.endDate.addEventListener("change",()=>updateYearSuggestion());
el("ac-program-form").elements.name.addEventListener("input",()=>updateSimpleCode(el("ac-program-form")));
el("ac-subject-form").elements.name.addEventListener("input",()=>updateSimpleCode(el("ac-subject-form")));
el("ac-section-form").elements.name.addEventListener("input",()=>updateSectionCode());
el("ac-section-form").elements.pathway.addEventListener("input",()=>updateSectionCode());
el("ac-section-form").elements.gradeLevel.addEventListener("change",()=>updateSectionCode());
el("ac-section-form").elements.programId.addEventListener("change",()=>{
  updateSectionGradeOptions();
  updateSectionPathwayVisibility();
  el("ac-section-form").elements.recordId.dataset.manual="false";
  updateSectionCode();
});
for(const name of ["yearId","programId","periodType"]){
  el("ac-term-form").elements[name].addEventListener("change",()=>{
    if(name==="programId"){
      const suggested=defaultPeriodType();
      if(!terms.some(item=>item.yearId===el("ac-term-form").elements.yearId.value&&item.programId===el("ac-term-form").elements.programId.value))
        el("ac-term-form").elements.periodType.value=suggested;
    }
    el("ac-term-form").elements.sequence.dataset.manual="false";
    el("ac-term-form").elements.startDate.dataset.manual="false";
    el("ac-term-form").elements.endDate.dataset.manual="false";
    updateTermSuggestion();
  });
}
el("ac-term-form").elements.sequence.addEventListener("input",()=>updateTermSuggestion());
el("ac-term-form").elements.startDate.addEventListener("change",()=>updateTermSuggestion());
el("ac-term-form").elements.endDate.addEventListener("change",()=>updateTermSuggestion());

for(const name of ["programId","yearId"]){
  el("ac-offering-form").elements[name].addEventListener("change",renderCatalog);
}
for(const name of ["termId","sectionId","subjectId","rosterMode"]){
  el("ac-offering-form").elements[name].addEventListener("change",updateOfferingPreview);
}
for(const button of document.querySelectorAll("[data-reset-auto]")){
  button.addEventListener("click",()=>resetAuto(button.dataset.resetAuto));
}
el("ac-lifecycle-close").addEventListener("click",closeLifecycle);
el("ac-lifecycle-cancel").addEventListener("click",closeLifecycle);
el("ac-lifecycle-dialog").addEventListener("cancel",event=>{if(busy)event.preventDefault();else lifecycleChange=null;});
el("ac-lifecycle-form").addEventListener("submit",event=>{
  event.preventDefault();
  if(busy||!lifecycleChange||!event.currentTarget.reportValidity())return;
  const change=lifecycleChange,reason=String(new FormData(event.currentTarget).get("reason")||"").trim(),
    restoring=change.mode==="restore",
    action=change.type==="offering"
      ?(restoring?"restore_offering":"archive_offering")
      :(restoring?"restore_catalog":"archive_catalog"),
    details=change.type==="offering"
      ?{offeringId:change.item.offeringId,expectedRevision:change.item.revision,reason}
      :{kind:change.kind,recordId:change.item.id,expectedRevision:change.item.revision,reason};
  if(inSystemAdminPreview()&&document.getElementById("adminerva-nav")?.dataset.platformAssistMode!=="true"){
    if(change.type==="offering"){
      const target=offerings.find(item=>item.offeringId===change.item.offeringId);
      if(target){target.status=restoring?"active":"archived";target.revision=(Number(target.revision)||1)+1;target.preview=true;}
    }else{
      const target=findCatalog(change.kind,change.item.id);
      if(target){target.status=restoring?"active":"archived";target.revision=(Number(target.revision)||1)+1;target.preview=true;}
      syncActiveCatalog();
    }
    lifecycleChange=null;el("ac-lifecycle-dialog").close();renderCatalog();
    const message=(restoring?"Restored ":"Archived ")+(change.type==="offering"?"class offering":catalogLabel(change.kind).toLowerCase())+
      " for this temporary System Admin preview. Reloading or exiting the preview will discard the change.";
    say(message);notify(message,"success");return;
  }
  setBusy(true,(restoring?"Restoring ":"Archiving ")+(change.type==="offering"?"class…":"academic record…"));
  void scoped(action,details).then(async result=>{
    lifecycleChange=null;el("ac-lifecycle-dialog").close();
    if(editingCatalog&&change.type==="catalog"&&editingCatalog.kind===change.kind&&editingCatalog.item.id===change.item.id)
      editingCatalog=null;
    const refreshed=await load({afterWrite:true});
    const message=change.type==="offering"
      ?restoring
        ?"Class offering restored. Current official-section registrations were synchronized where applicable. Reassign teachers and review the schedule before normal use."
        :"Class offering retired. Active class roster/teacher relationships and its schedule were ended or archived; assessments, submissions, grades and history were preserved."
      :(catalogLabel(change.kind)+" "+(restoring?"restored":"archived")+". Historical references were preserved.");
    say(refreshed?message:message+" Refresh failed; reload before another lifecycle change.");
    notify(message+(refreshed?"":" Refresh required."),refreshed?"success":"info");
  }).catch(error=>{
    const message=friendlyError(error,"The lifecycle change was not saved.");
    say(message);notify(message,"error");
  }).finally(()=>setBusy(false));
});

el("ac-refresh").addEventListener("click",()=>void load());

for(const button of document.querySelectorAll("[data-wizard-go]")){
  button.addEventListener("click",()=>showWizardStep(Number(button.dataset.wizardGo)));
}
for(const button of document.querySelectorAll("[data-open-offerings]")){
  button.addEventListener("click",()=>showWizardStep(6));
}
el("ac-wizard-back")?.addEventListener("click",()=>showWizardStep(currentStep-1));
el("ac-wizard-next")?.addEventListener("click",()=>{
  if(!stepReady(currentStep)){notify("Save this step before continuing.","error");return;}
  showWizardStep(currentStep+1);
});

picker=createTenantSchoolPicker({
  host:el("ac-school-switcher"),
  status,
  onBeforeChange:async()=>{
    if(busy||loading)throw Error("Finish the academic operation before switching schools.");
    catalogReady=false;years=[];programs=[];terms=[];subjects=[];sections=[];offerings=[];
    allCatalog={academic_years:[],academic_programs:[],terms:[],subjects:[],sections:[]};
    editingCatalog=null;lifecycleChange=null;currentStep=1;wizardInitialized=false;setBusy(false);
  },
  onReady:scope=>{
    if(!scope.current?.roles.includes("school_admin")){
      say("School administrator access is required to configure academics.");return;
    }
    void load();
  }
});
void picker.load().catch(error=>say(error?.message||"Verified school access could not be loaded."));
