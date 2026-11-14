import {app} from "./firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "./tenant-school-picker.mjs?v=4.0.0";

const el=id=>document.getElementById(id);
const api=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolAcademics");
const status=el("ac-status");
let picker=null,busy=false;
let years=[],programs=[],terms=[],subjects=[],sections=[],offerings=[];

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
function optionLabel(item){return item?.name||item?.id||"";}
function fillSelect(select,items,{placeholder="Choose…",filter=()=>true}={}){
  const previous=select.value;
  select.replaceChildren(new Option(placeholder,""));
  for(const item of items.filter(filter))select.add(new Option(optionLabel(item),item.id));
  select.value=items.some(item=>item.id===previous&&filter(item))?previous:"";
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
function renderCatalog(){
  renderList(el("ac-years"),years,item=>"ID: "+item.id+" · "+item.startMonth+"–"+item.endMonth);
  renderList(el("ac-programs"),programs,item=>"ID: "+item.id);
  renderList(el("ac-terms"),terms,item=>{
    const year=years.find(x=>x.id===item.yearId)?.name||item.yearId||"";
    const program=programs.find(x=>x.id===item.programId)?.name||item.programId||"";
    return [program,year,item.periodType,item.sequence?"#"+item.sequence:null].filter(Boolean).join(" · ");
  });
  renderList(el("ac-subjects"),subjects,item=>"ID: "+item.id);
  renderList(el("ac-sections"),sections,item=>{
    const program=programs.find(x=>x.id===item.programId)?.name||item.programId||"Unassigned program";
    return program+" · ID: "+item.id;
  });

  for(const form of [el("ac-term-form"),el("ac-section-form"),el("ac-offering-form")]){
    if(!form)continue;
    const program=form.elements.programId;if(program)fillSelect(program,programs,{placeholder:"Choose program / division"});
    const year=form.elements.yearId;if(year)fillSelect(year,years,{placeholder:"Choose academic year"});
    const subject=form.elements.subjectId;if(subject)fillSelect(subject,subjects,{placeholder:"Choose subject"});
    const section=form.elements.sectionId;if(section){
      const programId=form.elements.programId?.value||"";
      fillSelect(section,sections,{placeholder:"Choose section",filter:item=>!programId||item.programId===programId});
    }
    const term=form.elements.termId;if(term){
      const programId=form.elements.programId?.value||"",yearId=form.elements.yearId?.value||"";
      fillSelect(term,terms,{placeholder:"Choose academic period",filter:item=>
        (!programId||item.programId===programId)&&(!yearId||item.yearId===yearId)});
    }
  }
  renderOfferings();
}
function renderOfferings(){
  const host=el("ac-offering-list");host.replaceChildren();
  const active=offerings.filter(item=>item.status==="active");
  el("ac-offering-count").textContent=active.length+" active";
  if(!active.length){
    const p=document.createElement("p");p.className="ac-muted py-3";p.textContent="No course offerings yet.";host.append(p);return;
  }
  const by=id=>({
    program:programs.find(x=>x.id===id),
    year:years.find(x=>x.id===id),
    term:terms.find(x=>x.id===id),
    subject:subjects.find(x=>x.id===id),
    section:sections.find(x=>x.id===id)
  });
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
    say("Academic configuration loaded.");
  }catch(error){
    say(error?.message||"Academic configuration could not be loaded.");
  }finally{setBusy(false);}
}
function payload(form){
  const data=new FormData(form),out={};
  for(const [key,value] of data.entries())out[key]=typeof value==="string"?value.trim():value;
  return out;
}
async function createCatalog(form,kind,extra=()=>({})){
  if(busy||!form.reportValidity())return;
  setBusy(true,"Saving academic record…");
  try{
    const data=payload(form);
    await scoped("create_catalog",{kind,...data,...extra(data)});
    form.reset();
    if(kind==="academic_years"){form.elements.startMonth.value="7";form.elements.endMonth.value="5";}
    if(kind==="terms"){form.elements.periodType.value="semester";form.elements.sequence.value="1";}
    await load();
  }catch(error){say(error?.message||"Academic record was not saved.");}
  finally{setBusy(false);}
}
el("ac-year-form").addEventListener("submit",event=>{
  event.preventDefault();void createCatalog(event.currentTarget,"academic_years",data=>({
    startMonth:Number(data.startMonth),endMonth:Number(data.endMonth)
  }));
});
el("ac-program-form").addEventListener("submit",event=>{
  event.preventDefault();void createCatalog(event.currentTarget,"academic_programs");
});
el("ac-term-form").addEventListener("submit",event=>{
  event.preventDefault();void createCatalog(event.currentTarget,"terms",data=>({
    sequence:Number(data.sequence)
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
    form.reset();await load();
  }).catch(error=>say(error?.message||"Course offering was not created."))
    .finally(()=>setBusy(false));
});
for(const form of [el("ac-section-form"),el("ac-offering-form")]){
  form.elements.programId?.addEventListener("change",renderCatalog);
}
el("ac-offering-form").elements.yearId?.addEventListener("change",renderCatalog);
el("ac-refresh").addEventListener("click",()=>void load());

for(const button of document.querySelectorAll("[data-tab]")){
  button.addEventListener("click",()=>{
    const tab=button.dataset.tab;
    document.querySelectorAll("[data-tab]").forEach(item=>item.setAttribute("aria-selected",String(item===button)));
    el("ac-catalog").hidden=tab!=="catalog";
    el("ac-offerings").hidden=tab!=="offerings";
  });
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
