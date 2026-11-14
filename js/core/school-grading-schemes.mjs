import {app} from "./firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "./tenant-school-picker.mjs?v=4.0.0";

const el=id=>document.getElementById(id);
const functions=getFunctions(app,"asia-southeast1");
const api=httpsCallable(functions,"schoolClassRecord");
const academicsApi=httpsCallable(functions,"schoolAcademics");
const list=el("gs-list"),status=el("gs-status"),dialog=el("gs-dialog"),form=el("gs-form"),
  weights=el("gs-weights"),total=el("gs-total"),showArchived=el("gs-show-archived");
let picker=null,schemes=[],programs=[],subjects=[],sections=[],editing=null,busy=false;

function scoped(action,details={}){
  if(!picker?.scope.current)return Promise.reject(new Error("Choose a verified school first."));
  const lease=picker.scope.lease();
  return api({schoolId:lease.schoolId,action,...details}).then(response=>{
    picker.scope.assertLease(lease);
    return response.data;
  });
}
function academicScoped(action,details={}){
  if(!picker?.scope.current)return Promise.reject(new Error("Choose a verified school first."));
  const lease=picker.scope.lease();
  return academicsApi({schoolId:lease.schoolId,action,...details}).then(response=>{
    picker.scope.assertLease(lease);
    return response.data;
  });
}
function scopeName(items,id,fallback){
  return items.find(item=>item.id===id)?.name||fallback;
}
function applicabilityLabel(scheme){
  const scope=scheme.applicability||{},parts=[];
  if(scope.programId)parts.push(scopeName(programs,scope.programId,"Selected program"));
  if(scope.subjectId)parts.push(scopeName(subjects,scope.subjectId,"Selected subject"));
  if(scope.sectionId)parts.push(scopeName(sections,scope.sectionId,"Selected section"));
  if(scope.periodTypes?.length)parts.push(scope.periodTypes.map(value=>
    value.charAt(0).toUpperCase()+value.slice(1)).join("/"));
  return parts.length?parts.join(" · "):"School-wide";
}
function fillScopeOptions(){
  const program=el("gs-program"),subject=el("gs-subject"),section=el("gs-section");
  const selectedProgram=program.value,selectedSubject=subject.value,selectedSection=section.value;
  program.replaceChildren(new Option("All programs",""));
  subject.replaceChildren(new Option("All subjects",""));
  section.replaceChildren(new Option("All sections",""));
  for(const item of programs)program.add(new Option(item.name,item.id));
  for(const item of subjects)subject.add(new Option(item.name,item.id));
  const programId=programs.some(item=>item.id===selectedProgram)?selectedProgram:"";
  for(const item of sections.filter(item=>!programId||item.programId===programId))
    section.add(new Option(item.name,item.id));
  program.value=programId;
  subject.value=subjects.some(item=>item.id===selectedSubject)?selectedSubject:"";
  section.value=sections.some(item=>item.id===selectedSection&&(!programId||item.programId===programId))?selectedSection:"";
}
function button(text,classes="gs-btn"){
  const node=document.createElement("button");node.type="button";node.className=classes;node.textContent=text;return node;
}
function setBusy(value,message=""){
  busy=value;
  el("gs-new").disabled=value||!picker?.scope.current;
  el("gs-refresh").disabled=value||!picker?.scope.current;
  form.querySelectorAll("button,input,select,textarea").forEach(control=>{
    if(["gs-close","gs-cancel"].includes(control.id))return;
    control.disabled=value;
  });
  if(message)status.textContent=message;
}
function computationLabel(value){
  return value==="deped_60_100"?"DepEd-style 60–100 transmutation":"Weighted grade 0–100";
}
function render(){
  list.replaceChildren();
  const visible=schemes.filter(item=>showArchived.checked||item.status==="active");
  if(!visible.length){
    const empty=document.createElement("p");empty.className="text-sm text-slate-600 py-6 text-center md:col-span-2";
    empty.textContent=showArchived.checked?"No grading policys found.":"No active grading policys yet.";
    list.append(empty);return;
  }
  for(const scheme of visible){
    const card=document.createElement("article");card.className="gs-card";
    const top=document.createElement("div");top.className="flex justify-between gap-3 items-start";
    const info=document.createElement("div");
    const title=document.createElement("h3");title.className="font-extrabold text-slate-900";title.textContent=scheme.name;info.append(title);
    const meta=document.createElement("p");meta.className="text-xs text-slate-500 mt-1";
    meta.textContent="Revision "+scheme.revision+" · "+(scheme.status==="active"?"Active":"Archived")+" · "+computationLabel(scheme.settings?.gradeComputation);
    info.append(meta);
    const scope=document.createElement("p");scope.className="text-xs font-semibold text-blue-700 mt-1";
    scope.textContent=applicabilityLabel(scheme);info.append(scope);
    if(scheme.description){const p=document.createElement("p");p.className="text-sm text-slate-600 mt-2";p.textContent=scheme.description;info.append(p);}
    top.append(info);card.append(top);
    const chips=document.createElement("div");chips.className="flex flex-wrap gap-1.5 mt-3";
    for(const row of scheme.settings?.categoryWeights||[]){
      const chip=document.createElement("span");chip.className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700";
      chip.textContent=row.category+" · "+row.weight+"%";chips.append(chip);
    }
    card.append(chips);
    const actions=document.createElement("div");actions.className="flex flex-wrap gap-2 mt-4";
    if(scheme.status==="active"){
      const edit=button("Edit");edit.addEventListener("click",()=>openEditor(scheme));actions.append(edit);
      const archive=button("Archive");archive.addEventListener("click",()=>void changeStatus(scheme,"archive_scheme"));actions.append(archive);
    }else{
      const restore=button("Restore","gs-btn");restore.addEventListener("click",()=>void changeStatus(scheme,"restore_scheme"));actions.append(restore);
    }
    card.append(actions);list.append(card);
  }
}
function addWeightRow(category="",weight=""){
  const row=document.createElement("div");row.className="gs-row";
  const name=document.createElement("input");name.className="gs-input";name.placeholder="Category";name.maxLength=60;name.required=true;name.value=category;
  const value=document.createElement("input");value.className="gs-input";value.type="number";value.min="0";value.max="100";value.step="0.001";value.placeholder="%";value.required=true;value.value=weight;
  const remove=button("×","gs-btn");remove.title="Remove category";
  const update=()=>updateTotal();
  name.addEventListener("input",update);value.addEventListener("input",update);
  remove.addEventListener("click",()=>{row.remove();updateTotal();});
  row.append(name,value,remove);weights.append(row);updateTotal();
}
function updateTotal(){
  const rows=[...weights.querySelectorAll(".gs-row")];
  const sum=rows.reduce((value,row)=>value+(Number(row.children[1].value)||0),0);
  total.textContent="Current total: "+Math.round(sum*1000)/1000+"%"+(Math.abs(sum-100)<0.001?" · ready":" · must total 100%");
}
function openEditor(scheme=null){
  editing=scheme;
  form.reset();weights.replaceChildren();
  el("gs-dialog-heading").textContent=scheme?"Edit grading policy":"New grading policy";
  form.elements.name.value=scheme?.name||"";
  form.elements.description.value=scheme?.description||"";
  fillScopeOptions();
  form.elements.programId.value=scheme?.applicability?.programId||"";
  form.elements.subjectId.value=scheme?.applicability?.subjectId||"";
  form.elements.sectionId.value=scheme?.applicability?.sectionId||"";
  form.elements.periodType.value=scheme?.applicability?.periodTypes?.[0]||"";
  form.elements.gradeComputation.value=scheme?.settings?.gradeComputation||"raw_weighted";
  const rows=scheme?.settings?.categoryWeights||[];
  if(rows.length)rows.forEach(row=>addWeightRow(row.category,String(row.weight)));
  else addWeightRow();
  el("gs-form-status").textContent="";
  dialog.showModal();form.elements.name.focus();
}
function closeEditor(){if(dialog.open)dialog.close();editing=null;}
async function load(){
  setBusy(true,"Loading school grading policys…");
  try{
    const [schemeResult,programResult,subjectResult,sectionResult]=await Promise.all([
      scoped("list_schemes",{includeArchived:true}),
      academicScoped("list_catalog",{kind:"academic_programs"}),
      academicScoped("list_catalog",{kind:"subjects"}),
      academicScoped("list_catalog",{kind:"sections"})
    ]);
    schemes=schemeResult.schemes||[];
    programs=(programResult.items||[]).filter(item=>item.status==="active")
      .sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:"base"}));
    subjects=(subjectResult.items||[]).filter(item=>item.status==="active")
      .sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:"base"}));
    sections=(sectionResult.items||[]).filter(item=>item.status==="active")
      .sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:"base"}));
    fillScopeOptions();render();
    status.textContent=schemes.length+" grading policy"+(schemes.length===1?"":"s")+" loaded.";
  }catch(error){
    schemes=[];programs=[];subjects=[];render();
    status.textContent=error?.message||"Grading policys could not be loaded.";
  }finally{setBusy(false);}
}
async function changeStatus(scheme,action){
  if(busy)return;
  const verb=action==="archive_scheme"?"archive":"restore";
  if(!confirm((verb==="archive"?"Archive ":"Restore ")+scheme.name+"? Existing class records keep the snapshot they already use."))return;
  setBusy(true,(verb==="archive"?"Archiving ":"Restoring ")+scheme.name+"…");
  try{
    await scoped(action,{schemeId:scheme.schemeId,expectedRevision:scheme.revision});
    await load();
  }catch(error){status.textContent=error?.message||"Grading policy status was not changed.";}
  finally{setBusy(false);}
}

el("gs-new").addEventListener("click",()=>openEditor());
el("gs-refresh").addEventListener("click",()=>void load());
showArchived.addEventListener("change",render);
el("gs-program").addEventListener("change",fillScopeOptions);
el("gs-add-row").addEventListener("click",()=>addWeightRow());
el("gs-close").addEventListener("click",closeEditor);
el("gs-cancel").addEventListener("click",closeEditor);

form.addEventListener("submit",event=>{
  event.preventDefault();
  if(!form.reportValidity()||busy)return;
  const categoryWeights=[...weights.querySelectorAll(".gs-row")].map(row=>({
    category:row.children[0].value.trim(),weight:Number(row.children[1].value)
  }));
  const categoryKeys=categoryWeights.map(row=>row.category.toLocaleLowerCase("en"));
  const sum=categoryWeights.reduce((value,row)=>value+row.weight,0);
  if(!categoryWeights.length||Math.abs(sum-100)>=0.001){
    el("gs-form-status").textContent="Category weights must total exactly 100%.";return;
  }
  if(new Set(categoryKeys).size!==categoryKeys.length){
    el("gs-form-status").textContent="Each category name may appear only once.";return;
  }
  const schemeId=editing?.schemeId||("scheme_"+crypto.randomUUID().replaceAll("-","").slice(0,20));
  const payload={
    schemeId,expectedRevision:editing?.revision||0,
    name:form.elements.name.value.trim(),
    description:form.elements.description.value.trim(),
    applicability:{
      programId:form.elements.programId.value||null,
      subjectId:form.elements.subjectId.value||null,
      sectionId:form.elements.sectionId.value||null,
      periodTypes:form.elements.periodType.value?[form.elements.periodType.value]:[]
    },
    settings:{categoryWeights,gradeComputation:form.elements.gradeComputation.value}
  };
  setBusy(true,"Saving grading policy…");el("gs-form-status").textContent="Saving…";
  void scoped("save_scheme",payload).then(async()=>{
    closeEditor();await load();
  }).catch(error=>{el("gs-form-status").textContent=error?.message||"Grading policy was not saved.";})
    .finally(()=>setBusy(false));
});

picker=createTenantSchoolPicker({
  host:el("gs-school-switcher"),
  status,
  onBeforeChange:async()=>{schemes=[];programs=[];subjects=[];sections=[];editing=null;render();},
  onReady:scope=>{
    if(!scope.current?.roles.includes("school_admin")){
      status.textContent="School administrator access is required to manage grading policys.";return;
    }
    void load();
  }
});
void picker.load().catch(error=>{
  status.textContent=error?.message||"Verified school access could not be loaded.";
});