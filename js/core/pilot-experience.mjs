import {perform,loadOverview,switchTab} from "./pilot-sandbox.mjs?v=4.0.0";

const get=id=>document.getElementById(id);
const make=(tag,cls,value)=>{
  const el=document.createElement(tag);
  if(cls)el.className=cls;
  if(value!==undefined)el.textContent=String(value);
  return el;
};
let records=[],schoolId=null,selectedId="",grading=null,working=false;
const status=message=>{get("pilotSimulationStatus").textContent=message;};
const actionLabel={assigned:"Assigned",submitted:"Submitted",draft:"Private draft",published:"Published (demo)",reopened:"Reopened"};
function human(value){return actionLabel[value]||"Assigned"}
function uniqueRecord(id){return records.find(record=>record.id===id)||null}
function getAssessments(){return records.filter(row=>row.kind==="assessment"&&Array.isArray(row.payload?.learners));}
function refreshSelections(){
  const select=get("pilotDemoAssessment"),previous=selectedId||select.value;
  select.replaceChildren(new Option("Choose a practice assessment…",""));
  for(const assessment of getAssessments())select.add(new Option(assessment.title,assessment.id));
  selectedId=getAssessments().some(row=>row.id===previous)?previous:getAssessments()[0]?.id||"";
  select.value=selectedId;
  renderAssessment();
  renderModules();
}
function cell(text,cls="p-3 align-top"){return make("td",cls,text)}
function button(label,kind,disabled=false){
  const control=make("button","rounded-lg border px-3 py-2 text-xs font-bold "+(kind==="primary"
    ?"bg-indigo-800 border-indigo-800 text-white":"bg-white border-slate-300 text-slate-800"),label);
  control.type="button";control.disabled=disabled;return control;
}
function renderAssessment(){
  const record=uniqueRecord(selectedId),tbody=get("pilotDemoLearners"),summary=get("pilotDemoSummary");
  tbody.replaceChildren();summary.replaceChildren();
  if(!record||!record.payload){tbody.append(emptyRow("Choose a practice assessment or set up the demo classroom."));return;}
  const data=record.payload,maximum=(data.rubric||[]).reduce((sum,r)=>sum+Number(r.points||0),0);
  const title=make("h4","font-extrabold text-slate-900",record.title);
  const sub=make("p","text-sm text-slate-600 mt-1",data.section+" · "+maximum+" points · "+data.learners.length+" fictional learners");
  const desc=make("p","text-sm text-slate-700 mt-3",data.instructions);
  const rubric=make("div","flex flex-wrap gap-2 mt-3");
  for(const criterion of data.rubric||[])rubric.append(make("span","rounded-lg bg-white border border-slate-300 px-2 py-1 text-xs font-bold",criterion.name+" · "+criterion.points));
  summary.append(title,sub,desc,rubric);
  for(const student of data.learners||[]){
    const tr=make("tr","border-b border-slate-200 last:border-b-0");
    const name=cell(student.name);name.classList.add("font-semibold");
    const submission=cell(human(student.status));
    const score=cell(student.published?.score!==undefined
      ?student.published.score+" / "+maximum+" · Published":
      student.draft?.score!==undefined?student.draft.score+" / "+maximum+" · Private":"Not graded");
    const control=make("td","p-3");
    const actions=make("div","flex flex-wrap gap-2");
    if(["assigned","reopened"].includes(student.status)){
      const submit=button(student.status==="reopened"?"Resubmit demo work":"Submit demo work","primary");
      submit.addEventListener("click",()=>void simulation("sim_submit",record,student,{evidence:"Demo source code submitted through the private simulation."}));
      actions.append(submit);
    }
    if(["submitted","draft"].includes(student.status)){
      const grade=button(student.status==="draft"?"Edit draft":"Grade submission","primary");
      grade.addEventListener("click",()=>openGrade(record,student,maximum));
      actions.append(grade);
    }
    if(student.status==="draft"){
      const publish=button("Publish simulation","primary");
      publish.addEventListener("click",()=>void simulation("sim_grade_publish",record,student));
      actions.append(publish);
    }
    if(["submitted","draft","published"].includes(student.status)){
      const reopen=button("Reopen","secondary");
      reopen.addEventListener("click",()=>void simulation("sim_reopen",record,student));
      actions.append(reopen);
    }
    control.append(actions);tr.append(name,submission,score,control);tbody.append(tr);
  }
}
function emptyRow(message){
  const tr=make("tr"),td=cell(message,"p-6 text-center text-slate-500");
  td.colSpan=4;tr.append(td);return tr;
}
function renderModules(){
  const root=get("pilotDemoModules");root.replaceChildren();
  const modules=records.filter(x=>["schedule","lesson","admin_demo"].includes(x.kind)&&x.payload);
  if(!modules.length){root.append(make("p","text-sm text-slate-500","Set up the example classroom to populate these modules."));return;}
  for(const record of modules){
    const card=make("article","rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-2");
    card.append(make("h4","font-bold text-slate-900",record.title));
    if(record.kind==="schedule"){
      card.append(make("p","text-xs text-slate-500","Private schedule · "+(record.payload?.schoolYear||"Example school year")));
      const table=make("div","space-y-1 max-h-52 overflow-y-auto");
      for(const row of record.payload?.rows||[]){
        const days=["mon","tue","wed","thu","fri"];
        const slot=days.map(day=>{
          const c=row[day];
          return c?.sec&&c?.sub?day.toUpperCase()+" "+c.sub+" · "+c.sec:"";
        }).filter(Boolean).join("; ");
        table.append(make("p","text-xs text-slate-700 py-1 border-t border-slate-200",row.startTime+"–"+row.endTime+" · "+(slot||row.eventName||"Open period")));
      }
      card.append(table);
    }else if(record.kind==="lesson"){
      card.append(make("p","text-sm text-slate-600",record.payload.objective||"Practice lesson"));
      const list=make("ol","list-decimal pl-5 text-xs text-slate-700");
      for(const activity of record.payload.activities||[])list.append(make("li","mt-1",activity));
      card.append(list);
    }else{
      card.append(make("p","text-xs text-slate-600",record.payload.school+" · "+record.payload.term));
      const list=make("ul","text-xs text-slate-700 space-y-1");
      for(const section of record.payload.sections||[])list.append(make("li","",section.name+" · "+section.learners+" fictional learners"));
      card.append(list);
    }
    root.append(card);
  }
}
async function lock(operation){
  if(working)return;
  working=true;
  for(const el of get("pilot-simulation").querySelectorAll("button"))el.disabled=true;
  try{await operation();}finally{
    working=false;
    for(const el of get("pilot-simulation").querySelectorAll("button"))el.disabled=false;
    renderAssessment();
  }
}
async function simulation(action,record,student,details={}){
  if(!record||!student||working)return;
  await lock(async()=>{
    status("Updating the private "+human(student.status).toLowerCase()+" workflow…");
    try{
      const response=await perform(action,{recordId:record.id,learnerKey:student.key,
        expectedVersion:record.version,...details});
      await loadOverview();
      status("Demo "+student.name+": "+human(response.status)+". No official records or student notifications changed.");
    }catch(error){
      status("Simulation not saved: "+(error.message||"Reload this private assessment and try again."));
      await loadOverview();
    }
  });
}
function openGrade(record,student,max){
  grading={recordId:record.id,learnerKey:student.key};
  get("pilotGradeTitle").textContent="Grade "+student.name;
  get("pilotGradeInstructions").textContent=record.title+" · Rubric maximum: "+max+" points. Drafts are private; publishing here is simulated.";
  const form=get("pilotGradeForm");
  form.elements.score.max=String(max);
  form.elements.score.value=String(student.draft?.score??"");
  form.elements.feedback.value=student.draft?.feedback||"";
  get("pilotGradeStatus").textContent="";
  get("pilotGradeDialog").showModal();
}
const closeGrade=()=>{get("pilotGradeDialog").close();grading=null;};
get("pilotGradeClose").addEventListener("click",closeGrade);
get("pilotGradeCancel").addEventListener("click",closeGrade);
get("pilotGradeForm").addEventListener("submit",async event=>{
  event.preventDefault();
  const assessment=uniqueRecord(grading?.recordId),student=assessment?.payload?.learners?.find(l=>l.key===grading?.learnerKey);
  if(!assessment||!student){get("pilotGradeStatus").textContent="Refresh the assessment and select the learner again.";return;}
  const form=event.currentTarget,score=Number(form.elements.score.value),feedback=form.elements.feedback.value;
  get("pilotGradeStatus").textContent="Saving private rubric draft…";
  try{
    await simulation("sim_grade_draft",assessment,student,{score,feedback});
    closeGrade();
  }catch(error){get("pilotGradeStatus").textContent=error.message||"Could not save private draft.";}
});
get("pilotSeedDemo").addEventListener("click",async()=>lock(async()=>{
  status("Creating fictional learners, course schedule, practice lessons and an administration preview…");
  try{
    const response=await perform("seed_demo");
    await loadOverview();
    status(response.created.length+" example record(s) prepared. Existing private examples were preserved.");
  }catch(error){status("Cannot prepare example classroom: "+(error.message||"Retry."));}
}));
get("pilotDemoAssessment").addEventListener("change",event=>{selectedId=event.target.value;renderAssessment();});
function parseRubric(value){
  const entries=String(value||"").split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if(!entries.length||entries.length>12)throw Error("Enter 1–12 rubric criteria.");
  return entries.map((row,index)=>{
    const match=/^(.+?)\s*:\s*(\d+(?:\.\d{1,2})?)$/.exec(row);
    if(!match)throw Error("Use 'Criterion: points' on rubric line "+(index+1)+".");
    return {name:match[1].trim(),points:Number(match[2])};
  });
}
get("pilotDemoCreateForm").addEventListener("submit",async event=>{
  event.preventDefault();if(working)return;
  const form=event.currentTarget;
  let rubric;
  try{rubric=parseRubric(form.elements.rubric.value);}
  catch(error){status(error.message);return;}
  await lock(async()=>{
    status("Creating a private practice assessment with five fictional learners…");
    try{
      const r=await perform("create_demo_assessment",{
        title:form.elements.title.value,section:form.elements.section.value,
        instructions:form.elements.instructions.value,rubric
      });
      selectedId=r.recordId;form.reset();
      await loadOverview();switchTab("simulation");
      status("Private practice assessment created. It will not be deployed to real students.");
    }catch(error){status("Could not create practice assessment: "+(error.message||"Try again."));}
  });
});
document.addEventListener("adminerva:pilot-overview",event=>{
  if(event.detail?.schoolId!==schoolId){schoolId=event.detail?.schoolId||null;selectedId="";}
  records=event.detail?.records||[];refreshSelections();
});
const previewPanel=make("section","mt-4 space-y-3");
previewPanel.id="pilotPreviewExperience";
get("pilotPreviewResults").after(previewPanel);
function scheduledCells(schedule){
  const wrapper=make("div","mt-3 overflow-x-auto rounded-lg border border-slate-200");
  const table=make("table","min-w-[650px] w-full text-xs text-left");
  const header=make("thead","bg-slate-100");
  const tr=make("tr");
  for(const name of ["Time","Monday","Tuesday","Wednesday","Thursday","Friday"])tr.append(make("th","p-2",name));
  header.append(tr);table.append(header);
  const tbody=make("tbody");
  for(const row of schedule.rows?.slice(0,35)||[]){
    const tr=make("tr","border-t border-slate-200");
    tr.append(make("td","p-2 font-semibold whitespace-nowrap",row.startTime+" – "+row.endTime));
    for(const day of ["mon","tue","wed","thu","fri"]){
      const cell=row[day]||{};
      tr.append(make("td","p-2 text-slate-700",row.type==="constant"?row.eventName:(cell.sub?(cell.sub+" · "+cell.sec):(cell.evt||"—"))));
    }
    tbody.append(tr);
  }
  table.append(tbody);wrapper.append(table);return wrapper;
}
function renderPreview(detail){
  previewPanel.replaceChildren();
  const data=detail.preview||{},head=make("div","rounded-2xl bg-indigo-50 border border-indigo-200 p-4");
  head.append(make("h3","font-extrabold text-indigo-950","Teacher workspace preview · read only"));
  head.append(make("p","text-sm text-indigo-900 mt-1",
    "Source: "+(detail.legacyIncluded?"MCS legacy and verified V4 records":"Verified V4 resources")+
    " · Scores are shown only as counts. Student identities, private feedback and evidence are not transferred."));
  previewPanel.append(head);
  if((data.sectionNames||[]).length){
    const card=make("article","rounded-xl bg-white border border-slate-200 p-4");
    card.append(make("h4","font-bold","Teacher section assignments"));
    const row=make("div","flex flex-wrap gap-2 mt-2");
    for(const name of data.sectionNames)row.append(make("span","text-xs rounded-lg border border-slate-300 px-2 py-1",name));
    card.append(row);previewPanel.append(card);
  }
  if((data.schedules||[]).length){
    const card=make("article","rounded-xl bg-white border border-slate-200 p-4");
    card.append(make("h4","font-extrabold text-lg","Existing timetables"));
    for(const schedule of data.schedules.slice(0,8)){
      const item=make("details","mt-3 rounded-lg border border-slate-200 p-3");
      const heading=make("summary","font-bold text-sm cursor-pointer",schedule.label+" · "+(schedule.rows||[]).length+" timetable rows");
      item.append(heading);
      if(schedule.rows?.length)item.append(scheduledCells(schedule));
      else item.append(make("p","mt-2 text-sm text-slate-500","No timetable grid available in this source."));
      card.append(item);
    }
    previewPanel.append(card);
  }
  if((data.gradebook||[]).length){
    const card=make("article","rounded-xl bg-white border border-slate-200 p-4 space-y-3");
    card.append(make("h4","font-extrabold text-lg","Legacy gradebook activity (aggregated)"));
    for(const g of data.gradebook.slice(0,15)){
      const line=make("div","border-t border-slate-200 pt-2");
      line.append(make("strong","block text-sm",g.assessmentTitle));
      line.append(make("p","text-xs text-slate-600 mt-1",
        g.total+" evaluated · "+g.published+" published · "+g.unpublished+" unpublished · "+g.reviewed+" reviewed"));
      card.append(line);
    }
    previewPanel.append(card);
  }
  const kinds=["assessments","assessmentBlueprints"];
  for(const kind of kinds){
    const entries=data[kind]||[];
    if(!entries.length)continue;
    const card=make("article","rounded-xl bg-white border border-slate-200 p-4");
    card.append(make("h4","font-extrabold text-lg",kind==="assessments"?"Teacher-owned assessments":"Assessment blueprints"));
    for(const item of entries){
      const row=make("div","flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-t border-slate-200 py-3");
      const info=make("div");
      info.append(make("strong","block text-sm",item.label));
      info.append(make("p","text-xs text-slate-500 mt-1",(item.section||item.schoolYear||"Teacher resource")+" · "+(item.status||"Preview")+" · "+(item.rubricMax||"—")+" rubric pts"));
      const copy=button("Try as private practice","primary");
      copy.addEventListener("click",async()=>{
        if(working)return;
        await lock(async()=>{
          status("Creating an independent fictional assessment from the teacher's rubric…");
          try{
            const source=item.source==="legacy"?"legacy":
              kind==="assessments"?"v4_assessment":"v4";
            const result=await perform("clone_preview",{ownerUid:detail.ownerUid,source,sourceId:item.sourceId});
            selectedId=result.recordId;await loadOverview();switchTab("simulation");
            status("Independent practice copy created. The original assessment is unchanged.");
          }catch(error){status("Cannot copy to sandbox: "+(error.message||"Try again."));switchTab("simulation");}
        });
      });
      row.append(info,copy);card.append(row);
    }
    previewPanel.append(card);
  }
  if(!previewPanel.querySelector("article")){
    previewPanel.append(make("p","rounded-lg bg-white p-4 border border-slate-200 text-sm text-slate-600",
      "No teacher-owned records were available in this preview. The private example classroom is still available under Practice workflows."));
  }
}
document.addEventListener("adminerva:pilot-preview",event=>renderPreview(event.detail||{}));
