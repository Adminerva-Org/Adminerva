import {app} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs?v=4.0.0";

const el=id=>document.getElementById(id);
const api=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolAcademics");
const status=el("ac-status");
let picker=null,busy=false;
let years=[],programs=[],terms=[],subjects=[],sections=[],offerings=[];

const MONTHS=["January","February","March","April","May","June","July","August","September","October","November","December"];
const periodSize={semester:2,term:3,quarter:4,trimester:3};

function say(message){status.textContent=message;}
function scoped(action,details={}){
  if(!picker?.scope.current)return Promise.reject(new Error("Choose a verified school first."));
  const lease=picker.scope.lease();
  return api({schoolId:lease.schoolId,action,...details}).then(response=>{
    picker.scope.assertLease(lease);
    return response.data;
  });
}
function setBusy(value,message=""){
  busy=value;
  document.querySelectorAll("form button,#ac-refresh").forEach(button=>button.disabled=value);
  if(message)say(message);
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
  const used=new Set(years.map(itemStartYear).filter(Number.isInteger));
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
function fillSelect(select,items,{placeholder="Choose…",filter=()=>true,preferred=""}={}){
  const available=items.filter(filter);
  const previous=select.value;
  select.replaceChildren(new Option(placeholder,""));
  for(const item of available)select.add(new Option(optionLabel(item),item.id));
  const next=available.some(item=>item.id===previous)?previous:
    available.some(item=>item.id===preferred)?preferred:
    available.length===1?available[0].id:"";
  select.value=next;
}
function renderList(host,items,meta){
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
    const state=document.createElement("span");state.className="ac-muted";state.textContent=item.status||"active";
    row.append(left,state);host.append(row);
  }
}
function updateSteps(){
  const values=[
    ["years",years.length],["programs",programs.length],["terms",terms.length],
    ["subjects",subjects.length],["sections",sections.length],["offerings",offerings.filter(x=>x.status==="active").length]
  ];
  for(const [key,count] of values){
    const label=el("ac-step-"+key);if(label)label.textContent=count?count+" configured":"Not configured";
    label?.closest(".ac-step")?.setAttribute("data-ready",String(Boolean(count)));
  }
}
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
    const form=el("ac-section-form");form.elements.recordId.dataset.manual="false";updateSectionCode(true);
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
function updateSectionCode(force=false){
  const form=el("ac-section-form"),program=slug(form.elements.programId.value),name=slug(form.elements.name.value);
  setAuto(form,"recordId",codeJoin([program,name]),force);
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
  const ready=Object.values(selected).every(Boolean),host=el("ac-offering-preview");
  if(!ready){host.textContent="Choose the required fields to preview this course offering.";return;}
  host.replaceChildren();
  const title=document.createElement("strong");title.textContent=selected.subject+" · "+selected.section;
  const meta=document.createElement("span");meta.className="ac-muted";meta.textContent=[selected.program,selected.year,selected.term].join(" · ");
  host.append(title,meta);
}
function renderCatalog(){
  renderList(el("ac-years"),years,item=>{
    const dates=item.startDate&&item.endDate?dateText(item.startDate)+" → "+dateText(item.endDate):
      MONTHS[(Number(item.startMonth)||7)-1]+" → "+MONTHS[(Number(item.endMonth)||5)-1];
    return "ID: "+item.id+" · "+dates;
  });
  renderList(el("ac-programs"),programs,item=>"ID: "+item.id);
  renderList(el("ac-terms"),terms,item=>{
    const year=years.find(x=>x.id===item.yearId)?.name||item.yearId||"";
    const program=programs.find(x=>x.id===item.programId)?.name||item.programId||"";
    const dates=item.startDate&&item.endDate?dateText(item.startDate)+" → "+dateText(item.endDate):null;
    return [program,year,item.periodType,item.sequence?"#"+item.sequence:null,dates].filter(Boolean).join(" · ");
  });
  renderList(el("ac-subjects"),subjects,item=>"ID: "+item.id);
  renderList(el("ac-sections"),sections,item=>{
    const program=programs.find(x=>x.id===item.programId)?.name||item.programId||"Unassigned program";
    return program+" · ID: "+item.id;
  });

  const termForm=el("ac-term-form"),sectionForm=el("ac-section-form"),offeringForm=el("ac-offering-form");
  const preferredYear=currentYearId();
  fillSelect(termForm.elements.programId,programs,{placeholder:"Choose program / division"});
  fillSelect(termForm.elements.yearId,years,{placeholder:"Choose academic year",preferred:preferredYear});
  fillSelect(sectionForm.elements.programId,programs,{placeholder:"Choose program / division"});

  fillSelect(offeringForm.elements.programId,programs,{placeholder:"Choose program / division"});
  fillSelect(offeringForm.elements.yearId,years,{placeholder:"Choose academic year",preferred:preferredYear});
  fillSelect(offeringForm.elements.subjectId,subjects,{placeholder:"Choose subject"});

  const offeringProgram=offeringForm.elements.programId.value,offeringYear=offeringForm.elements.yearId.value;
  fillSelect(offeringForm.elements.sectionId,sections,{placeholder:"Choose section",filter:item=>!offeringProgram||item.programId===offeringProgram});
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
  const active=offerings.filter(item=>item.status==="active");
  el("ac-offering-count").textContent=active.length+" active";
  if(!active.length){
    const p=document.createElement("p");p.className="ac-muted py-3";p.textContent="No course offerings yet. Complete the setup steps, then create the first offering here.";host.append(p);return;
  }
  for(const item of active){
    const row=document.createElement("div");row.className="ac-row";
    const left=document.createElement("div");
    const title=document.createElement("strong");
    title.textContent=(subjects.find(x=>x.id===item.subjectId)?.name||item.subjectId)+" · "+
      (sections.find(x=>x.id===item.sectionId)?.name||item.sectionId);
    const meta=document.createElement("p");meta.className="ac-muted";
    meta.textContent=[
      programs.find(x=>x.id===item.programId)?.name||item.programId,
      years.find(x=>x.id===item.yearId)?.name||item.yearId,
      terms.find(x=>x.id===item.termId)?.name||item.termId
    ].filter(Boolean).join(" · ");
    left.append(title,meta);
    const tag=document.createElement("span");tag.className="ac-muted";tag.textContent="Active";
    row.append(left,tag);host.append(row);
  }
}
async function load(){
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
    years=(y.items||[]).filter(x=>x.status==="active");
    programs=(p.items||[]).filter(x=>x.status==="active");
    terms=(t.items||[]).filter(x=>x.status==="active");
    subjects=(s.items||[]).filter(x=>x.status==="active");
    sections=(sec.items||[]).filter(x=>x.status==="active");
    offerings=o.offerings||[];
    renderCatalog();
    say("Academic configuration loaded. Suggested values are generated from the school calendar and existing records.");
  }catch(error){
    say(error?.message||"Academic configuration could not be loaded.");
  }finally{setBusy(false);}
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
  if(busy||!form.reportValidity())return;
  const data=payload(form);
  const source={academic_years:years,academic_programs:programs,terms,subjects,sections}[kind]||[];
  const duplicate=source.find(item=>String(item.name||"").trim().toLocaleLowerCase("en")===String(data.name||"").trim().toLocaleLowerCase("en"));
  if(duplicate){
    say("“"+data.name+"” already exists in this school. Use the existing record instead of creating a duplicate.");
    form.elements.name?.focus();return;
  }
  setBusy(true,"Saving academic record…");
  try{
    await scoped("create_catalog",{kind,...data,...extra(data)});
    form.reset();clearManual(form);
    await load();
  }catch(error){say(error?.message||"Academic record was not saved.");}
  finally{setBusy(false);}
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
  const form=event.currentTarget;if(busy||!form.reportValidity())return;
  setBusy(true,"Creating course offering…");
  void scoped("create_offering",payload(form)).then(async()=>{
    form.reset();clearManual(form);await load();
  }).catch(error=>say(error?.message||"Course offering was not created."))
    .finally(()=>setBusy(false));
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
el("ac-section-form").elements.programId.addEventListener("change",()=>updateSectionCode());
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
for(const name of ["termId","sectionId","subjectId"]){
  el("ac-offering-form").elements[name].addEventListener("change",updateOfferingPreview);
}
for(const button of document.querySelectorAll("[data-reset-auto]")){
  button.addEventListener("click",()=>resetAuto(button.dataset.resetAuto));
}
el("ac-refresh").addEventListener("click",()=>void load());

function showTab(tab){
  document.querySelectorAll("[data-tab]").forEach(item=>item.setAttribute("aria-selected",String(item.dataset.tab===tab)));
  el("ac-catalog").hidden=tab!=="catalog";
  el("ac-offerings").hidden=tab!=="offerings";
  if(tab==="offerings")updateOfferingPreview();
}
for(const button of document.querySelectorAll("[data-tab]")){
  button.addEventListener("click",()=>showTab(button.dataset.tab));
}
for(const button of document.querySelectorAll("[data-open-offerings]")){
  button.addEventListener("click",()=>{showTab("offerings");el("ac-offerings").scrollIntoView({behavior:"smooth",block:"start"});});
}
for(const button of document.querySelectorAll("[data-tab-return]")){
  button.addEventListener("click",()=>{showTab("catalog");el("ac-catalog").scrollIntoView({behavior:"smooth",block:"start"});});
}
for(const button of document.querySelectorAll("[data-jump]")){
  button.addEventListener("click",()=>{showTab("catalog");el(button.dataset.jump)?.scrollIntoView({behavior:"smooth",block:"start"});});
}

picker=createTenantSchoolPicker({
  host:el("ac-school-switcher"),
  status,
  onBeforeChange:async()=>{years=[];programs=[];terms=[];subjects=[];sections=[];offerings=[];},
  onReady:scope=>{
    if(!scope.current?.roles.includes("school_admin")){
      say("School administrator access is required to configure academics.");return;
    }
    void load();
  }
});
void picker.load().catch(error=>say(error?.message||"Verified school access could not be loaded."));
