import {app} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs?v=4.0.0";

const el=id=>document.getElementById(id);
const functions=getFunctions(app,"asia-southeast1");
const classRecordApi=httpsCallable(functions,"schoolClassRecord");
const academicsApi=httpsCallable(functions,"schoolAcademics");

const offeringSelect=el("cr-offering");
const status=el("cr-status");
const panel=el("cr-record-panel");
const tableWrap=el("cr-table-wrap");
const addButton=el("cr-add-column");
const saveScoresButton=el("cr-save-scores");
const refreshButton=el("cr-refresh");
const unsaved=el("cr-unsaved");
const kpis=el("cr-kpis");
const dialog=el("cr-column-dialog");
const columnForm=el("cr-column-form");
const columnKind=el("cr-column-kind");
const assessmentSelect=el("cr-assessment");

let picker=null;
let offerings=[];
let currentOfferingId="";
let roster=[];
let assessments=[];
let columns=[];
let sheetRevision=0;
let manualScores=new Map();
let publishedGrades=new Map();
let dirtyColumns=new Set();
let editingColumnId=null;
let busy=false;

function key(columnId,personId){return columnId+"::"+personId}
function gradeKey(taskId,personId){return taskId+"::"+personId}
function numberText(value){
  const n=Number(value);
  if(!Number.isFinite(n))return "—";
  return Number.isInteger(n)?String(n):String(Math.round(n*100)/100);
}
function say(message){status.textContent=message}
function make(tag,className,text){
  const node=document.createElement(tag);
  if(className)node.className=className;
  if(text!==undefined)node.textContent=String(text);
  return node;
}
function scoped(api,action,details={}){
  if(!picker?.scope.current)return Promise.reject(new Error("Choose a verified school first."));
  const lease=picker.scope.lease();
  return api({schoolId:lease.schoolId,action,...details}).then(response=>{
    picker.scope.assertLease(lease);
    return response.data;
  });
}
function setBusy(value,message=""){
  busy=value;
  offeringSelect.disabled=value||!offerings.length;
  addButton.disabled=value||!currentOfferingId;
  refreshButton.disabled=value||!currentOfferingId;
  saveScoresButton.disabled=value||!dirtyColumns.size;
  if(message)say(message);
  columnForm.querySelectorAll("button,input,select").forEach(control=>{
    if(control.id==="cr-column-close"||control.id==="cr-column-cancel")return;
    if(value){
      control.dataset.busyDisabled=String(control.disabled);
      control.disabled=true;
    }else if(control.dataset.busyDisabled!==undefined){
      control.disabled=control.dataset.busyDisabled==="true";
      delete control.dataset.busyDisabled;
    }
  });
}
function updateKpis(){
  kpis.replaceChildren();
  if(!currentOfferingId)return;
  const linked=columns.filter(column=>column.kind==="assessment").length;
  const items=[
    roster.length+" student"+(roster.length===1?"":"s"),
    columns.length+" column"+(columns.length===1?"":"s"),
    linked+" linked assessment"+(linked===1?"":"s")
  ];
  for(const text of items)kpis.append(make("span","cr-kpi",text));
}
function updateDirtyState(){
  dirtyColumns.clear();
  tableWrap.querySelectorAll("input[data-column-id]").forEach(input=>{
    const original=input.dataset.original||"";
    const current=input.value.trim();
    const changed=current!==original;
    input.dataset.dirty=String(changed);
    if(changed)dirtyColumns.add(input.dataset.columnId);
  });
  saveScoresButton.disabled=busy||!dirtyColumns.size;
  unsaved.textContent=dirtyColumns.size?
    dirtyColumns.size+" manual column"+(dirtyColumns.size===1?"":"s")+" with unsaved changes":"";
}
function columnTask(column){
  return assessments.find(task=>task.taskId===column.taskId)||null;
}
function render(){
  updateKpis();
  tableWrap.replaceChildren();
  if(!currentOfferingId){
    tableWrap.append(make("div","cr-empty","Choose a class to load its record."));
    panel.hidden=true;
    return;
  }
  panel.hidden=false;
  el("cr-record-title").textContent=offeringSelect.selectedOptions[0]?.textContent||"Class record";
  if(!roster.length){
    tableWrap.append(make("div","cr-empty","No active students are enrolled in this class."));
    return;
  }

  const table=make("table","cr-table");
  const thead=document.createElement("thead");
  const headRow=document.createElement("tr");
  const studentHead=make("th","cr-student","Student");
  studentHead.scope="col";
  headRow.append(studentHead);

  for(const column of columns){
    const th=make("th");
    th.scope="col";
    th.dataset.columnId=column.columnId;
    th.append(make("span","cr-category",column.category||"Uncategorized"));
    th.append(make("span","cr-column-label",column.label));
    const source=column.kind==="assessment"?"Adminerva · "+numberText(column.maxPoints)+" pts":"Manual · "+numberText(column.maxPoints)+" pts";
    th.append(make("span","cr-column-meta",source));
    const actions=make("div","mt-2 flex items-center justify-center gap-2");
    const edit=make("button","text-xs font-bold text-blue-700 underline","Edit");
    edit.type="button";
    edit.addEventListener("click",()=>openColumnDialog(column));
    actions.append(edit);
    if(column.kind==="assessment"){
      const task=columnTask(column);
      if(task){
        const link=make("a","text-xs font-bold text-indigo-700 underline","Gradebook");
        link.href="school-gradebook.html?task="+encodeURIComponent(task.taskId);
        actions.append(link);
      }
    }
    th.append(actions);
    headRow.append(th);
  }

  const summaryHead=make("th");
  summaryHead.scope="col";
  summaryHead.append(make("span","cr-category","Summary"));
  summaryHead.append(make("span","cr-column-label","Recorded"));
  summaryHead.append(make("span","cr-column-meta","points · coverage"));
  headRow.append(summaryHead);
  thead.append(headRow);
  table.append(thead);

  const tbody=document.createElement("tbody");
  for(const student of roster){
    const tr=document.createElement("tr");
    const nameCell=make("th","cr-student");
    nameCell.scope="row";
    nameCell.append(make("span","cr-name",student.name));
    tr.append(nameCell);

    let earned=0,max=0,coverage=0;
    for(const column of columns){
      const td=document.createElement("td");
      if(column.kind==="manual"){
        const saved=manualScores.get(key(column.columnId,student.personId));
        const input=make("input","cr-score");
        input.type="number";
        input.min="0";
        input.max=String(column.maxPoints);
        input.step="0.01";
        input.inputMode="decimal";
        input.setAttribute("aria-label",column.label+" score for "+student.name);
        input.dataset.columnId=column.columnId;
        input.dataset.personId=student.personId;
        input.value=saved===null||saved===undefined?"":numberText(saved);
        input.dataset.original=input.value;
        input.dataset.dirty="false";
        input.addEventListener("input",updateDirtyState);
        td.append(input);
        if(saved!==null&&saved!==undefined){
          earned+=Number(saved)||0;max+=Number(column.maxPoints)||0;coverage++;
        }
      }else{
        const grade=publishedGrades.get(gradeKey(column.taskId,student.personId));
        const value=make("span","cr-linked",grade?numberText(grade.awarded):"—");
        if(grade){
          value.title="Published Gradebook result: "+numberText(grade.awarded)+" / "+numberText(grade.total);
          earned+=Number(grade.awarded)||0;max+=Number(column.maxPoints)||0;coverage++;
        }else value.title="No published Gradebook result yet.";
        td.append(value);
      }
      tr.append(td);
    }

    const summary=make("td","cr-summary");
    summary.textContent=coverage?numberText(earned)+" / "+numberText(max)+" · "+coverage+"/"+columns.length:"—";
    summary.title="This is a raw recorded-points summary, not a final or weighted grade.";
    tr.append(summary);
    tbody.append(tr);
  }
  table.append(tbody);
  tableWrap.append(table);
  updateDirtyState();
}
function populateAssessmentOptions(selectedTaskId=""){
  assessmentSelect.replaceChildren();
  const used=new Set(columns.filter(column=>column.kind==="assessment"&&column.columnId!==editingColumnId).map(column=>column.taskId));
  const available=assessments.filter(task=>!used.has(task.taskId)||task.taskId===selectedTaskId);
  assessmentSelect.add(new Option(available.length?"Choose an assessment…":"No unlinked assessments available",""));
  assessmentSelect.options[0].disabled=true;
  for(const task of available){
    const label=task.title+" · "+numberText(task.maxPoints)+" pts · "+task.submissionSource;
    assessmentSelect.add(new Option(label,task.taskId));
  }
  assessmentSelect.value=selectedTaskId||"";
}
function syncColumnFields(){
  const kind=columnKind.value;
  el("cr-manual-fields").hidden=kind!=="manual";
  el("cr-assessment-fields").hidden=kind!=="assessment";
  columnForm.elements.maxPoints.required=kind==="manual";
  assessmentSelect.required=kind==="assessment";
}
function closeColumnDialog(){
  if(dialog.open)dialog.close();
  editingColumnId=null;
  el("cr-column-status").textContent="";
}
function openColumnDialog(column=null){
  editingColumnId=column?.columnId||null;
  columnForm.reset();
  el("cr-column-heading").textContent=column?"Edit column":"Add column";
  el("cr-column-save").textContent=column?"Save column details":"Add column";
  el("cr-column-lock-note").hidden=!column;
  columnForm.elements.label.value=column?.label||"";
  columnForm.elements.category.value=column?.category||"";
  columnKind.value=column?.kind||"manual";
  columnForm.elements.maxPoints.value=column?.kind==="manual"?String(column.maxPoints):"10";
  populateAssessmentOptions(column?.kind==="assessment"?column.taskId:"");
  if(column?.kind==="assessment")assessmentSelect.value=column.taskId;
  columnKind.disabled=Boolean(column);
  columnForm.elements.maxPoints.disabled=Boolean(column);
  assessmentSelect.disabled=Boolean(column);
  syncColumnFields();
  el("cr-column-status").textContent="";
  dialog.showModal();
  columnForm.elements.label.focus();
}
async function saveLayout(nextColumns){
  setBusy(true,"Saving Class Record layout…");
  try{
    const result=await scoped(classRecordApi,"save_layout",{
      offeringId:currentOfferingId,expectedRevision:sheetRevision,columns:nextColumns
    });
    columns=Array.isArray(result.columns)?result.columns:nextColumns;
    sheetRevision=Number(result.revision)||sheetRevision+1;
    render();
    say("Class Record layout saved.");
    return result;
  }finally{
    setBusy(false);
    syncColumnFields();
  }
}
async function saveManualScores(){
  if(!dirtyColumns.size)return;
  setBusy(true,"Saving manual scores…");
  try{
    for(const columnId of [...dirtyColumns]){
      const inputs=[...tableWrap.querySelectorAll('input[data-column-id="'+CSS.escape(columnId)+'"]')];
      const values=inputs.map(input=>({
        personId:input.dataset.personId,
        score:input.value.trim()===""?null:Number(input.value)
      }));
      await scoped(classRecordApi,"save_manual_scores",{offeringId:currentOfferingId,columnId,values});
      for(const input of inputs){
        input.dataset.original=input.value.trim();
        input.dataset.dirty="false";
        const score=input.value.trim()===""?null:Number(input.value);
        manualScores.set(key(columnId,input.dataset.personId),score);
      }
      dirtyColumns.delete(columnId);
    }
    updateDirtyState();
    say("Manual scores saved.");
  }catch(error){
    say(error?.message||"Manual scores were not fully saved. Review the highlighted changes and retry.");
  }finally{
    setBusy(false);
    updateDirtyState();
  }
}
async function loadWorkspace(){
  if(!currentOfferingId)return;
  setBusy(true,"Loading class roster and score sources…");
  try{
    const result=await scoped(classRecordApi,"workspace",{offeringId:currentOfferingId});
    roster=result.roster||[];
    assessments=result.assessments||[];
    columns=result.columns||[];
    sheetRevision=Number(result.sheetRevision)||0;
    manualScores=new Map((result.manualScores||[]).map(item=>[key(item.columnId,item.personId),item.score]));
    publishedGrades=new Map((result.publishedGrades||[]).map(item=>[gradeKey(item.taskId,item.personId),item]));
    dirtyColumns.clear();
    render();
    say("Class Record loaded. Linked assessment cells show published Gradebook results only.");
  }catch(error){
    panel.hidden=true;
    say(error?.message||"Class Record could not be loaded.");
  }finally{
    setBusy(false);
    updateDirtyState();
  }
}
async function loadOfferings(){
  setBusy(true,"Loading your assigned classes…");
  try{
    const result=await scoped(academicsApi,"planning_options");
    offerings=(result.offerings||[]).slice().sort((a,b)=>{
      const left=(a.subjectName||"")+" "+(a.sectionName||"");
      const right=(b.subjectName||"")+" "+(b.sectionName||"");
      return left.localeCompare(right,undefined,{sensitivity:"base"});
    });
    offeringSelect.replaceChildren();
    offeringSelect.add(new Option(offerings.length?"Choose a class…":"No assigned classes available",""));
    offeringSelect.options[0].disabled=true;
    for(const item of offerings){
      const parts=[item.subjectName,item.sectionName,item.termName||item.yearName].filter(Boolean);
      offeringSelect.add(new Option(parts.join(" · "),item.offeringId));
    }
    offeringSelect.disabled=!offerings.length;
    say(offerings.length?"Choose a class to open its record.":"No active course offering is assigned to this teacher.");
    if(offerings.length===1){
      currentOfferingId=offerings[0].offeringId;
      offeringSelect.value=currentOfferingId;
      await loadWorkspace();
    }
  }catch(error){
    say(error?.message||"Assigned classes could not be loaded.");
  }finally{
    setBusy(false);
  }
}

offeringSelect.addEventListener("change",async()=>{
  const next=offeringSelect.value;
  if(dirtyColumns.size&&!confirm("Discard unsaved manual score changes and open another class?")){
    offeringSelect.value=currentOfferingId;
    return;
  }
  currentOfferingId=next;
  roster=[];assessments=[];columns=[];manualScores.clear();publishedGrades.clear();dirtyColumns.clear();
  if(next)await loadWorkspace();
  else render();
});
addButton.addEventListener("click",()=>openColumnDialog());
refreshButton.addEventListener("click",()=>{
  if(dirtyColumns.size&&!confirm("Discard unsaved manual score changes and refresh this class?"))return;
  void loadWorkspace();
});
saveScoresButton.addEventListener("click",()=>void saveManualScores());
columnKind.addEventListener("change",syncColumnFields);
el("cr-column-close").addEventListener("click",closeColumnDialog);
el("cr-column-cancel").addEventListener("click",closeColumnDialog);

columnForm.addEventListener("submit",event=>{
  event.preventDefault();
  if(!columnForm.reportValidity())return;
  const label=columnForm.elements.label.value.trim();
  const category=columnForm.elements.category.value.trim();
  const existing=editingColumnId?columns.find(column=>column.columnId===editingColumnId):null;
  let nextColumn;
  if(existing){
    nextColumn={...existing,label,category};
  }else if(columnKind.value==="manual"){
    nextColumn={
      columnId:"col_"+crypto.randomUUID().replaceAll("-","").slice(0,20),
      label,category,kind:"manual",maxPoints:Number(columnForm.elements.maxPoints.value)
    };
  }else{
    const task=assessments.find(item=>item.taskId===assessmentSelect.value);
    if(!task){
      el("cr-column-status").textContent="Choose a deployed assessment.";
      return;
    }
    nextColumn={
      columnId:"col_"+crypto.randomUUID().replaceAll("-","").slice(0,20),
      label,category,kind:"assessment",taskId:task.taskId,maxPoints:task.maxPoints
    };
  }
  const next=existing?
    columns.map(column=>column.columnId===existing.columnId?nextColumn:column):
    [...columns,nextColumn];
  el("cr-column-status").textContent="Saving column…";
  void saveLayout(next).then(()=>{
    closeColumnDialog();
  }).catch(error=>{
    el("cr-column-status").textContent=error?.message||"The column was not saved.";
  });
});

window.addEventListener("beforeunload",event=>{
  if(!dirtyColumns.size)return;
  event.preventDefault();
  event.returnValue="";
});

picker=createTenantSchoolPicker({
  host:el("cr-school-switcher"),
  status,
  onBeforeChange:async()=>{
    if(dirtyColumns.size)throw new Error("Save or discard manual score changes before switching schools.");
    currentOfferingId="";
    offerings=[];roster=[];assessments=[];columns=[];manualScores.clear();publishedGrades.clear();
    dirtyColumns.clear();offeringSelect.replaceChildren(new Option("Choose a class…",""));
    offeringSelect.disabled=true;panel.hidden=true;kpis.replaceChildren();
  },
  onReady:scope=>{
    if(!scope.current?.roles.includes("teacher")){
      say("Your role in this school does not include Class Record access.");
      return;
    }
    void loadOfferings();
  }
});
