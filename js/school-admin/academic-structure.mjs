import {app} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs?v=4.0.0";

const el=id=>document.getElementById(id);
const api=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolAcademics");
const status=el("as-status"),form=el("as-edit-form");
let picker=null,currentKind="academic_years",selectedId="",busy=false,loading=false,loadSequence=0,calendarIncomplete=false;
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
    picker.scope.assertLease(lease);return response.data;
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
function calendarOption(select,records,label){
  const prior=select.value;select.replaceChildren(new Option(label,""));
  for(const row of records.slice().sort((a,b)=>String(a.name).localeCompare(String(b.name))))select.add(new Option(row.name||row.id,row.id));
  if(records.some(row=>row.id===prior))select.value=prior;
}
function calendarDate(value){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||"")))return null;
  const date=new Date(value+"T00:00:00Z");return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value?date.getTime():null;
}
function renderCalendar(){
  const host=el("as-calendar-list");host.replaceChildren();
  const yearFilter=el("as-calendar-year").value,programFilter=el("as-calendar-program").value;
  const visible=terms.filter(t=>(!yearFilter||t.yearId===yearFilter)&&(!programFilter||t.programId===programFilter))
    .sort((a,b)=>String(a.startDate||"9999").localeCompare(String(b.startDate||"9999"))||Number(a.sequence||0)-Number(b.sequence||0));
  const dates=new Map(visible.map(t=>[t.id,[calendarDate(t.startDate),calendarDate(t.endDate)]]));
  const missing=visible.filter(t=>dates.get(t.id).some(value=>value===null)).length;
  let flagged=0;
  for(const t of visible){
    const y=years.find(row=>row.id===t.yearId),p=programs.find(row=>row.id===t.programId),[start,end]=dates.get(t.id),notes=[];
    const yearStart=calendarDate(y?.startDate),yearEnd=calendarDate(y?.endDate);
    if(start===null||end===null)notes.push("Dates incomplete");
    else if(start>end)notes.push("End precedes start");
    else{
      if(yearStart!==null&&start<yearStart||yearEnd!==null&&end>yearEnd)notes.push("Outside school-year dates");
      const overlap=visible.some(other=>{
        if(other.id===t.id||other.yearId!==t.yearId||other.programId!==t.programId||(other.periodType||"term")!==(t.periodType||"term"))return false;
        const [a,b]=dates.get(other.id);return a!==null&&b!==null&&a<=b&&start<=b&&end>=a;
      });
      if(overlap)notes.push("Overlaps another period of the same type");
    }
    if(!y||!p)notes.push("Year or program reference unavailable");
    if(notes.length)flagged++;
    const row=document.createElement("article");row.className="as-row";
    const info=document.createElement("div");info.className="min-w-0";
    const heading=document.createElement("strong");heading.textContent=t.name||t.id;
    const meta=document.createElement("p");meta.className="as-muted mt-1";meta.textContent=[y?.name||t.yearId,p?.name||t.programId,t.periodType].filter(Boolean).join(" · ");
    const date=document.createElement("p");date.className="text-sm mt-1";date.textContent=(t.startDate||"Start not set")+" → "+(t.endDate||"End not set");
    info.append(heading,meta,date);
    if(notes.length){const warning=document.createElement("p");warning.className="text-xs font-semibold text-amber-800 mt-2";warning.textContent=notes.join(" · ");info.append(warning);}
    const edit=document.createElement("button");edit.type="button";edit.className="as-btn";edit.textContent="Edit dates";edit.disabled=busy||loading;
    edit.addEventListener("click",()=>{if(busy||loading)return;currentKind="terms";renderList();openEditor(t.id);});
    row.append(info,edit);host.append(row);
  }
  if(!visible.length){const p=document.createElement("p");p.className="as-muted";p.textContent="No active academic periods match the selected filters.";host.append(p);}
  el("as-calendar-count").textContent=visible.length+" periods · "+missing+" incomplete dates · "+flagged+" need review"+(calendarIncomplete?" · Catalog may be incomplete.":"");
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
  if(loading)return;loading=true;const run=++loadSequence;say("Loading academic structure…");
  try{
    const [y,p,t,s,sec]=await Promise.all([
      scoped("list_catalog",{kind:"academic_years"}),
      scoped("list_catalog",{kind:"academic_programs"}),
      scoped("list_catalog",{kind:"terms"}),
      scoped("list_catalog",{kind:"subjects"}),
      scoped("list_catalog",{kind:"sections"})
    ]);
    if(run!==loadSequence)return;
    calendarIncomplete=[y,p,t,s,sec].some(result=>result.truncated);
    years=(y.items||[]).filter(x=>x.status==="active");
    programs=(p.items||[]).filter(x=>x.status==="active");
    terms=(t.items||[]).filter(x=>x.status==="active");
    subjects=(s.items||[]).filter(x=>x.status==="active");
    sections=(sec.items||[]).filter(x=>x.status==="active");
    calendarOption(el("as-calendar-year"),years,"All school years");calendarOption(el("as-calendar-program"),programs,"All programs");
    renderList();renderCalendar();say("Academic structure loaded. Select a record to edit."+(calendarIncomplete?" Some catalog results reached their display limit.":""));
  }catch(error){if(run===loadSequence)say(error?.message||"Academic structure could not be loaded.");}
  finally{if(run===loadSequence){loading=false;renderCalendar();}}
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
  event.preventDefault();if(busy||loading||!selectedId||!form.reportValidity())return;
  const data=payload(),save=el("as-save"),notice=el("as-save-status");
  if(inPreview()){
    const item=items(currentKind).find(x=>x.id===selectedId);
    Object.assign(item,data);notice.textContent="Temporary preview updated. Reloading or exiting role preview discards this change.";
    notice.hidden=false;renderList();renderCalendar();return;
  }
  const original=save.textContent;save.textContent="Saving…";save.disabled=true;busy=true;
  void scoped("update_catalog",data).then(async()=>{
    notice.textContent="Changes saved. System ID "+selectedId+" was preserved.";notice.hidden=false;
    await load();if(selectedId)openEditor(selectedId);
    notice.textContent="Changes saved. System ID "+data.recordId+" was preserved.";notice.hidden=false;
  }).catch(error=>{
    notice.textContent=error?.message||"Changes could not be saved.";notice.hidden=false;
  }).finally(()=>{busy=false;save.disabled=false;save.textContent=original;renderCalendar();});
});
form.elements.sectionProgramId.addEventListener("change",()=>{
  updateLevelPicker(form.elements.sectionProgramId.value,"");
});
el("as-close").addEventListener("click",()=>{if(busy)return;selectedId="";el("as-editor-panel").hidden=true;});
el("as-refresh").addEventListener("click",()=>{if(!busy)void load();});
for(const id of ["as-calendar-year","as-calendar-program"])el(id).addEventListener("change",renderCalendar);
for(const button of document.querySelectorAll("[data-kind]")){
  button.addEventListener("click",()=>{
    if(busy||loading)return;currentKind=button.dataset.kind;selectedId="";el("as-editor-panel").hidden=true;renderList();
  });
}
picker=createTenantSchoolPicker({
  host:el("as-school-switcher"),status,
  onBeforeChange:async()=>{if(busy)throw Error("Finish saving before switching schools.");++loadSequence;loading=false;calendarIncomplete=false;years=[];programs=[];terms=[];subjects=[];sections=[];selectedId="";el("as-editor-panel").hidden=true;el("as-list").replaceChildren();el("as-calendar-list").replaceChildren();el("as-calendar-count").textContent="Waiting for verified school access…";calendarOption(el("as-calendar-year"),[],"All school years");calendarOption(el("as-calendar-program"),[],"All programs");},
  onReady:scope=>{
    if(!scope.current?.roles.includes("school_admin")){say("School administrator access is required.");return;}
    void load();
  }
});
void picker.load().catch(error=>say(error?.message||"Verified school access could not be loaded."));
