import {app} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs?v=4.0.0";

const el=id=>document.getElementById(id);
const api=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolAcademics");
const status=el("as-status"),form=el("as-edit-form");
let picker=null,currentKind="academic_years",selectedId="",busy=false;
let years=[],programs=[],terms=[],subjects=[],sections=[];
const LABELS={
  academic_years:"School Years",academic_programs:"Programs / Divisions",
  terms:"Academic Periods",subjects:"Subjects",sections:"Sections"
};
function say(message){status.textContent=message;}
function platformModePayload(){
  try{return sessionStorage.getItem("Adminerva_platform_school_mode")==="assist"?{platformMode:"assist"}:{};}catch{return {};}
}
function inPreview(){
  try{return sessionStorage.getItem("Adminerva_platform_test_mode")==="1"&&
    sessionStorage.getItem("Adminerva_platform_school_mode")!=="assist";}catch{return false;}
}
function scoped(action,details={}){
  if(!picker?.scope.current)return Promise.reject(new Error("Choose a verified school first."));
  const lease=picker.scope.lease();
  return api({schoolId:lease.schoolId,action,...platformModePayload(),...details}).then(response=>{
    lease.assert();return response.data;
  });
}
function items(kind){
  return {academic_years:years,academic_programs:programs,terms,subjects,sections}[kind]||[];
}
function isShs(programId){
  const p=programs.find(x=>x.id===programId),name=String(p?.name||programId||"").toLowerCase();
  return /senior high|\bshs\b/.test(name);
}
function levelOptions(programId){
  const p=programs.find(x=>x.id===programId),name=String(p?.name||"").toLowerCase();
  if(/special needs education|\bsned\b|\bsne[d]?\b/.test(name))return [
    ["sned_elem","SNED Elementary (Grades 1–6)"],["sned_jhs","SNED Junior High (Grades 7–10)"]
  ];
  if(/early childhood|\bece\b|kinder|kindergarten|preschool|pre-school/.test(name))return [
    ["nursery_prep","Nursery / Prep"],["kinder_1","Kinder 1"],["kinder_2","Kinder 2"]
  ];
  if(/senior high|\bshs\b/.test(name))return [[11,"Grade 11"],[12,"Grade 12"]].map(x=>[String(x[0]),x[1]]);
  if(/junior high|\bjhs\b/.test(name))return [7,8,9,10].map(n=>[String(n),"Grade "+n]);
  if(/elementary|grade school/.test(name))return [1,2,3,4,5,6].map(n=>[String(n),"Grade "+n]);
  return [1,2,3,4,5,6,7,8,9,10,11,12].map(n=>[String(n),"Grade "+n]);
}
function levelLabel(programId,value){
  return levelOptions(programId).find(([v])=>v===String(value||""))?.[1]||String(value||"");
}
function fill(select,records,selected=""){
  select.replaceChildren(new Option("Choose…",""));
  for(const item of records)select.add(new Option(item.name||item.id,item.id));
  select.value=selected||"";
}
function updateLevelPicker(programId,selected=""){
  const select=form.elements.gradeLevel;
  select.replaceChildren(new Option("Choose grade / level",""));
  for(const [value,label] of levelOptions(programId))select.add(new Option(label,value));
  select.value=selected||"";
  el("as-pathway-wrap").hidden=!isShs(programId);
  if(!isShs(programId))form.elements.pathway.value="";
}
function displayMeta(kind,item){
  if(kind==="academic_years")return [item.startDate,item.endDate].filter(Boolean).join(" → ")||"Calendar dates not set";
  if(kind==="terms"){
    const y=years.find(x=>x.id===item.yearId)?.name||item.yearId;
    const p=programs.find(x=>x.id===item.programId)?.name||item.programId;
    return [p,y,item.periodType,item.sequence?"#"+item.sequence:null].filter(Boolean).join(" · ");
  }
  if(kind==="sections"){
    const p=programs.find(x=>x.id===item.programId)?.name||item.programId;
    return [p,item.gradeLevel?levelLabel(item.programId,item.gradeLevel):null,item.pathway||null,"ID: "+item.id].filter(Boolean).join(" · ");
  }
  return "ID: "+item.id;
}
function renderList(){
  el("as-list-title").textContent=LABELS[currentKind];
  for(const button of document.querySelectorAll("[data-kind]"))
    button.setAttribute("aria-selected",String(button.dataset.kind===currentKind));
  const host=el("as-list");host.replaceChildren();
  const records=items(currentKind);
  if(!records.length){
    const p=document.createElement("p");p.className="as-muted";p.textContent="No active records in this category.";host.append(p);return;
  }
  for(const item of records){
    const row=document.createElement("div");row.className="as-row";
    const left=document.createElement("div");
    const title=document.createElement("strong");title.textContent=item.name||item.id;
    const meta=document.createElement("p");meta.className="as-muted mt-1";meta.textContent=displayMeta(currentKind,item);
    left.append(title,meta);
    const edit=document.createElement("button");edit.type="button";edit.className="as-btn";edit.textContent="Edit";
    edit.addEventListener("click",()=>openEditor(item.id));
    row.append(left,edit);host.append(row);
  }
}
function showFields(kind){
  el("as-year-fields").hidden=kind!=="academic_years";
  el("as-term-fields").hidden=kind!=="terms";
  el("as-section-fields").hidden=kind!=="sections";
}
function openEditor(id){
  const item=items(currentKind).find(x=>x.id===id);if(!item)return;
  selectedId=id;showFields(currentKind);
  form.reset();form.elements.recordId.value=item.id;form.elements.name.value=item.name||"";
  fill(form.elements.yearId,years,item.yearId);
  fill(form.elements.programId,programs,item.programId);
  fill(form.elements.sectionProgramId,programs,item.programId);
  if(currentKind==="academic_years"){
    form.elements.startDate.value=item.startDate||"";form.elements.endDate.value=item.endDate||"";
  }
  if(currentKind==="terms"){
    form.elements.periodType.value=item.periodType||"term";
    form.elements.sequence.value=String(item.sequence||1);
    form.elements.termStartDate.value=item.startDate||"";
    form.elements.termEndDate.value=item.endDate||"";
  }
  if(currentKind==="sections"){
    updateLevelPicker(item.programId,item.gradeLevel);
    form.elements.pathway.value=item.pathway||"";
  }
  el("as-editor-title").textContent="Edit "+(item.name||item.id);
  el("as-save-status").hidden=true;el("as-editor-panel").hidden=false;
  el("as-editor-panel").scrollIntoView({behavior:"smooth",block:"start"});
}
async function load(){
  if(busy)return;busy=true;say("Loading academic structure…");
  try{
    const [y,p,t,s,sec]=await Promise.all([
      scoped("list_catalog",{kind:"academic_years"}),
      scoped("list_catalog",{kind:"academic_programs"}),
      scoped("list_catalog",{kind:"terms"}),
      scoped("list_catalog",{kind:"subjects"}),
      scoped("list_catalog",{kind:"sections"})
    ]);
    years=(y.items||[]).filter(x=>x.status==="active");
    programs=(p.items||[]).filter(x=>x.status==="active");
    terms=(t.items||[]).filter(x=>x.status==="active");
    subjects=(s.items||[]).filter(x=>x.status==="active");
    sections=(sec.items||[]).filter(x=>x.status==="active");
    renderList();say("Academic structure loaded. Select a record to edit.");
  }catch(error){say(error?.message||"Academic structure could not be loaded.");}
  finally{busy=false;}
}
function payload(){
  const data={kind:currentKind,recordId:selectedId,name:form.elements.name.value.trim()};
  if(currentKind==="academic_years"){
    data.startDate=form.elements.startDate.value||null;data.endDate=form.elements.endDate.value||null;
    if(data.startDate)data.startMonth=Number(data.startDate.slice(5,7));
    if(data.endDate)data.endMonth=Number(data.endDate.slice(5,7));
  }else if(currentKind==="terms"){
    data.yearId=form.elements.yearId.value;data.programId=form.elements.programId.value;
    data.periodType=form.elements.periodType.value;data.sequence=Number(form.elements.sequence.value);
    data.startDate=form.elements.termStartDate.value||null;data.endDate=form.elements.termEndDate.value||null;
  }else if(currentKind==="sections"){
    data.programId=form.elements.sectionProgramId.value;data.gradeLevel=form.elements.gradeLevel.value;
    data.pathway=isShs(data.programId)?form.elements.pathway.value.trim():"";
  }
  return data;
}
form.addEventListener("submit",event=>{
  event.preventDefault();if(busy||!selectedId||!form.reportValidity())return;
  const data=payload(),save=el("as-save"),notice=el("as-save-status");
  if(inPreview()){
    const item=items(currentKind).find(x=>x.id===selectedId);
    Object.assign(item,data);notice.textContent="Temporary preview updated. Reloading or exiting role preview discards this change.";
    notice.hidden=false;renderList();return;
  }
  const original=save.textContent;save.textContent="Saving…";save.disabled=true;busy=true;
  void scoped("update_catalog",data).then(async()=>{
    notice.textContent="Changes saved. System ID "+selectedId+" was preserved.";notice.hidden=false;
    await load();openEditor(selectedId);
  }).catch(error=>{
    notice.textContent=error?.message||"Changes could not be saved.";notice.hidden=false;
  }).finally(()=>{busy=false;save.disabled=false;save.textContent=original;});
});
form.elements.sectionProgramId.addEventListener("change",()=>{
  updateLevelPicker(form.elements.sectionProgramId.value,"");
});
el("as-close").addEventListener("click",()=>{selectedId="";el("as-editor-panel").hidden=true;});
el("as-refresh").addEventListener("click",()=>void load());
for(const button of document.querySelectorAll("[data-kind]")){
  button.addEventListener("click",()=>{
    currentKind=button.dataset.kind;selectedId="";el("as-editor-panel").hidden=true;renderList();
  });
}
picker=createTenantSchoolPicker({
  host:el("as-school-switcher"),status,
  onBeforeChange:async()=>{years=[];programs=[];terms=[];subjects=[];sections=[];selectedId="";},
  onReady:scope=>{
    if(!scope.current?.roles.includes("school_admin")){say("School administrator access is required.");return;}
    void load();
  }
});
void picker.load().catch(error=>say(error?.message||"Verified school access could not be loaded."));
