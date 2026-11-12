import {app} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs?v=4.0.0";

const el=id=>document.getElementById(id);
const functions=getFunctions(app,"asia-southeast1");
const classRecordApi=httpsCallable(functions,"schoolClassRecord");
const academicsApi=httpsCallable(functions,"schoolAcademics");

const SCHOOL_SOURCE="school";
const PERSONALIZED_SOURCE="legacy_personalized";
const offeringSelect=el("cr-offering");
const status=el("cr-status");
const panel=el("cr-record-panel");
const tableWrap=el("cr-table-wrap");
const addButton=el("cr-add-column");
const setupButton=el("cr-grade-setup");
const saveScoresButton=el("cr-save-scores");
const importButton=el("cr-import-scores");
const archivedButton=el("cr-archived-columns");
const archivedCount=el("cr-archived-count");
const finalizeButton=el("cr-finalize");
const exportButton=el("cr-export");
const exportXlsxButton=el("cr-export-xlsx");
const refreshButton=el("cr-refresh");
const unsaved=el("cr-unsaved");
const kpis=el("cr-kpis");
const dialog=el("cr-column-dialog");
const columnForm=el("cr-column-form");
const columnKind=el("cr-column-kind");
const assessmentSelect=el("cr-assessment");
const setupDialog=el("cr-setup-dialog");
const setupForm=el("cr-setup-form");
const schemeSelect=el("cr-scheme-select");
const applySchemeButton=el("cr-apply-scheme");
const schemeNote=el("cr-scheme-note");
const importDialog=el("cr-import-dialog");
const importForm=el("cr-import-form");
const importColumn=el("cr-import-column");
const importText=el("cr-import-text");
const archivedDialog=el("cr-archived-dialog");
const finalizeDialog=el("cr-finalize-dialog");
const finalizeState=el("cr-finalize-state");
const finalizeBlockers=el("cr-finalize-blockers");
const finalizePreview=el("cr-finalize-preview");
const finalizeHistory=el("cr-finalize-history");
const finalizeConfirm=el("cr-finalize-confirm");
const finalizationBanner=el("cr-finalization-banner");
const collaboratorsNode=el("cr-collaborators");

let picker=null;
let offerings=[];
let periodRecords=[];
let currentOfferingId="";
let currentOffering=null;
let roster=[];
let assessments=[];
let collaborators=[];
let columns=[];
let gradingSchemes=[];
let pendingSchemeSnapshot=null;
let settings={categoryWeights:[],gradeComputation:"raw_weighted",appliedSchemeId:null,appliedSchemeRevision:null,appliedSchemeName:""};
let sheetRevision=0;
let finalization=null;
let periodReadiness={ready:false,blockerCount:0,activeColumnCount:0};
let finalizationPreview=null;
let manualScores=new Map();
let publishedGrades=new Map();
let dirtyColumns=new Set();
let editingColumnId=null;
let busy=false;

function key(columnId,personId){return columnId+"::"+personId}
function gradeKey(sourceType,taskId,personId){return (sourceType||SCHOOL_SOURCE)+"::"+taskId+"::"+personId}
function assessmentKey(sourceType,taskId){return (sourceType||SCHOOL_SOURCE)+"::"+taskId}
function numberText(value){
  const n=Number(value);
  if(!Number.isFinite(n))return "—";
  return Number.isInteger(n)?String(n):String(Math.round(n*100)/100);
}
function percentText(value){
  const n=Number(value);
  return Number.isFinite(n)?numberText(n)+"%":"—";
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
function selectedOffering(){
  return offerings.find(item=>item.offeringId===currentOfferingId)||currentOffering||null;
}
function selectedPeriodType(){
  const offering=selectedOffering();
  const period=periodRecords.find(item=>item.termId===offering?.termId);
  return String(period?.periodType||"term").toLowerCase();
}
function schemeMatchesCurrentOffering(scheme){
  const offering=selectedOffering(),scope=scheme?.applicability||{};
  if(!offering)return false;
  if(scope.programId&&scope.programId!==offering.programId)return false;
  if(scope.subjectId&&scope.subjectId!==offering.subjectId)return false;
  if(Array.isArray(scope.periodTypes)&&scope.periodTypes.length&&
     !scope.periodTypes.includes(selectedPeriodType()))return false;
  return true;
}
function schemeScopeSummary(scheme){
  const scope=scheme?.applicability||{},parts=[];
  if(scope.programId)parts.push("program-scoped");
  if(scope.subjectId)parts.push("subject-scoped");
  if(scope.periodTypes?.length)parts.push(scope.periodTypes.join("/"));
  return parts.length?parts.join(" · "):"school-wide";
}
function sourceName(source){
  return source===PERSONALIZED_SOURCE?"Personalized Studio":"School assessment";
}
function activeColumns(){return columns.filter(column=>column.archived!==true)}
function archivedColumns(){return columns.filter(column=>column.archived===true)}
function activeManualColumns(){return activeColumns().filter(column=>column.kind==="manual")}
function usedCategories(){
  const result=[],seen=new Set();
  for(const column of activeColumns()){
    const category=String(column.category||"").trim();
    const normalized=category.toLocaleLowerCase("en");
    if(category&&!seen.has(normalized)){seen.add(normalized);result.push(category);}
  }
  return result;
}
function weightMap(){
  return new Map((settings.categoryWeights||[]).map(row=>[
    String(row.category||"").toLocaleLowerCase("en"),Number(row.weight)||0
  ]));
}
function gradeSetupState(){
  const categories=usedCategories(),weights=weightMap();
  const active=activeColumns();
  const uncategorized=active.some(column=>!String(column.category||"").trim());
  const missing=categories.filter(category=>!weights.has(category.toLocaleLowerCase("en")));
  const total=categories.reduce((sum,category)=>sum+(weights.get(category.toLocaleLowerCase("en"))||0),0);
  return {
    categories,uncategorized,missing,total,
    complete:active.length>0&&!uncategorized&&!missing.length&&Math.abs(total-100)<0.001
  };
}
function columnTask(column){
  const source=column.assessmentSource||SCHOOL_SOURCE;
  return assessments.find(task=>task.taskId===column.taskId&&task.sourceType===source)||null;
}
function linkedGrade(column,personId){
  return publishedGrades.get(gradeKey(column.assessmentSource||SCHOOL_SOURCE,column.taskId,personId))||null;
}
function manualValue(column,personId,{fromInput=true}={}){
  if(fromInput){
    const input=tableWrap.querySelector('input[data-column-id="'+CSS.escape(column.columnId)+'"][data-person-id="'+CSS.escape(personId)+'"]');
    if(input)return input.value.trim()===""?null:Number(input.value);
  }
  const value=manualScores.get(key(column.columnId,personId));
  return value===undefined?null:value;
}
function scoreFor(column,personId,{fromInput=true}={}){
  if(column.kind==="manual")return manualValue(column,personId,{fromInput});
  const grade=linkedGrade(column,personId);
  return grade?Number(grade.awarded):null;
}
function metricsFor(personId,{fromInput=true}={}){
  const categories=usedCategories(),weights=weightMap();
  const byCategory=new Map();
  let allScores=true,allCategorized=true;
  for(const category of categories)byCategory.set(category,{earned:0,max:0,complete:true});
  for(const column of activeColumns()){
    const category=String(column.category||"").trim();
    if(!category){allCategorized=false;continue;}
    const bucket=byCategory.get(category)||{earned:0,max:0,complete:true};
    const value=scoreFor(column,personId,{fromInput});
    bucket.max+=Number(column.maxPoints)||0;
    if(value===null||!Number.isFinite(value)){bucket.complete=false;allScores=false;}
    else bucket.earned+=value;
    byCategory.set(category,bucket);
  }
  let initial=null;
  const setup=gradeSetupState();
  if(setup.complete&&allScores&&allCategorized){
    initial=0;
    for(const category of categories){
      const bucket=byCategory.get(category);
      if(!bucket?.complete||bucket.max<=0){initial=null;break;}
      const percentage=bucket.earned/bucket.max*100;
      initial+=percentage*(weights.get(category.toLocaleLowerCase("en"))||0)/100;
    }
  }
  let period=initial;
  if(initial!==null&&settings.gradeComputation==="deped_60_100")period=60+(initial*0.4);
  return {byCategory,initial,period,complete:initial!==null};
}
function syncCollaborators(){
  if(!collaboratorsNode)return;
  if(!currentOfferingId||!collaborators.length){
    collaboratorsNode.hidden=true;collaboratorsNode.textContent="";return;
  }
  collaboratorsNode.hidden=false;
  collaboratorsNode.className="text-xs text-slate-500 mt-1";
  if(collaborators.length===1){
    collaboratorsNode.textContent="Offering-level record · you are the only active assigned teacher.";
    return;
  }
  const names=collaborators.map(item=>item.current?item.name+" (you)":item.name);
  collaboratorsNode.textContent="Shared offering-level record · "+collaborators.length+
    " active assigned teachers: "+names.join(", ")+
    ". Concurrent layout edits use revision protection.";
}
function syncFinalizationBanner(){
  if(!finalization){
    finalizationBanner.hidden=true;finalizationBanner.textContent="";return;
  }
  finalizationBanner.hidden=false;
  if(finalization.stale){
    finalizationBanner.className="text-xs font-semibold text-rose-700 mt-1";
    finalizationBanner.textContent="Live working record · finalized revision "+finalization.revision+
      " is now stale because a source score or Class Record setting changed.";
  }else{
    finalizationBanner.className="text-xs font-semibold text-emerald-700 mt-1";
    finalizationBanner.textContent="Live working record · frozen period revision "+finalization.revision+
      " remains current. Finalized "+formatFinalizedAt(finalization.finalizedAt)+".";
  }
}
function updateKpis(){
  kpis.replaceChildren();
  if(!currentOfferingId)return;
  const active=activeColumns(),archived=archivedColumns();
  const linked=active.filter(column=>column.kind==="assessment").length;
  const personalized=active.filter(column=>column.kind==="assessment"&&
    (column.assessmentSource||SCHOOL_SOURCE)===PERSONALIZED_SOURCE).length;
  const setup=gradeSetupState();
  archivedCount.textContent=String(archived.length);
  const items=[
    roster.length+" student"+(roster.length===1?"":"s"),
    active.length+" active column"+(active.length===1?"":"s"),
    archived.length+" archived",
    linked+" linked assessment"+(linked===1?"":"s"),
    personalized+" personalized",
    setup.complete?"Weights ready":"Weights incomplete",
    finalization
      ?("Finalized rev "+finalization.revision+(finalization.stale?" · changed":""))
      :"Not finalized"
  ];
  for(const text of items)kpis.append(make("span","cr-kpi",text));
  syncFinalizationBanner();
  syncCollaborators();
}
function setBusy(value,message=""){
  busy=value;
  offeringSelect.disabled=value||!offerings.length;
  addButton.disabled=value||!currentOfferingId;
  setupButton.disabled=value||!currentOfferingId;
  refreshButton.disabled=value||!currentOfferingId;
  saveScoresButton.disabled=value||!dirtyColumns.size;
  importButton.disabled=value||!currentOfferingId||!activeManualColumns().length;
  archivedButton.disabled=value||!currentOfferingId;
  finalizeButton.disabled=value||!currentOfferingId||dirtyColumns.size>0;
  exportButton.disabled=value||!currentOfferingId||dirtyColumns.size>0;
  exportXlsxButton.disabled=value||!currentOfferingId||dirtyColumns.size>0;
  if(message)say(message);
  for(const form of [columnForm,setupForm,importForm]){
    form.querySelectorAll("button,input,select").forEach(control=>{
      if(["cr-column-close","cr-column-cancel","cr-setup-close","cr-setup-cancel","cr-import-close","cr-import-cancel"].includes(control.id))return;
      if(value){
        control.dataset.busyDisabled=String(control.disabled);
        control.disabled=true;
      }else if(control.dataset.busyDisabled!==undefined){
        control.disabled=control.dataset.busyDisabled==="true";
        delete control.dataset.busyDisabled;
      }
    });
  }
}
function refreshSummaries(){
  for(const student of roster){
    const metrics=metricsFor(student.personId);
    for(const category of usedCategories()){
      const cell=tableWrap.querySelector('[data-summary-person="'+CSS.escape(student.personId)+'"][data-category="'+CSS.escape(category)+'"]');
      if(!cell)continue;
      const bucket=metrics.byCategory.get(category);
      if(!bucket||bucket.max<=0){cell.textContent="—";continue;}
      const text=numberText(bucket.earned)+" / "+numberText(bucket.max);
      cell.textContent=bucket.complete?text+" · "+percentText(bucket.earned/bucket.max*100):text+" · incomplete";
      cell.classList.toggle("text-amber-700",!bucket.complete);
    }
    const initial=tableWrap.querySelector('[data-summary-person="'+CSS.escape(student.personId)+'"][data-summary-kind="initial"]');
    const period=tableWrap.querySelector('[data-summary-person="'+CSS.escape(student.personId)+'"][data-summary-kind="period"]');
    if(initial)initial.textContent=metrics.complete?numberText(metrics.initial):"—";
    if(period){
      period.replaceChildren();
      if(metrics.complete){
        period.append(make("span","cr-final",numberText(metrics.period)));
      }else{
        period.append(make("span","cr-incomplete","Incomplete"));
      }
    }
  }
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
  importButton.disabled=busy||!currentOfferingId||!activeManualColumns().length;
  archivedButton.disabled=busy||!currentOfferingId;
  finalizeButton.disabled=busy||!currentOfferingId||dirtyColumns.size>0;
  exportButton.disabled=busy||!currentOfferingId||dirtyColumns.size>0;
  exportXlsxButton.disabled=busy||!currentOfferingId||dirtyColumns.size>0;
  unsaved.textContent=dirtyColumns.size?
    dirtyColumns.size+" manual column"+(dirtyColumns.size===1?"":"s")+" with unsaved changes":"";
  refreshSummaries();
}
function moveColumn(columnId,direction){
  if(dirtyColumns.size){say("Save manual score changes before reordering columns.");return;}
  const active=activeColumns(),index=active.findIndex(column=>column.columnId===columnId),target=index+direction;
  if(index<0||target<0||target>=active.length)return;
  const left=columns.findIndex(column=>column.columnId===active[index].columnId);
  const right=columns.findIndex(column=>column.columnId===active[target].columnId);
  if(left<0||right<0)return;
  const next=[...columns];
  [next[left],next[right]]=[next[right],next[left]];
  void saveLayout(next,settings,"Column order saved.").catch(error=>say(error.message));
}
function archiveColumn(column){
  if(dirtyColumns.size){say("Save manual score changes before archiving a column.");return;}
  if(!confirm("Archive "+column.label+"? Its saved scores and assessment link will be retained, but it will leave current calculations and exports."))return;
  const next=columns.map(item=>item.columnId===column.columnId?{...item,archived:true}:item);
  void saveLayout(next,settings,column.label+" archived.").then(renderArchivedList).catch(error=>say(error.message));
}
function restoreColumn(column){
  if(dirtyColumns.size){el("cr-archived-status").textContent="Save manual score changes before restoring a column.";return;}
  const next=columns.map(item=>item.columnId===column.columnId?{...item,archived:false}:item);
  el("cr-archived-status").textContent="Restoring "+column.label+"…";
  void saveLayout(next,settings,column.label+" restored.").then(()=>{
    renderArchivedList();
    el("cr-archived-status").textContent=column.label+" restored to the active record.";
  }).catch(error=>{el("cr-archived-status").textContent=error?.message||"Column was not restored.";});
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
  const setup=gradeSetupState();
  el("cr-record-help").textContent=setup.complete
    ?"Linked assessment cells are read-only. Initial and period grades calculate only after every included score is available."
    :"Linked assessment cells are read-only. Configure categories and weights totaling 100% before period grades can calculate.";
  if(!roster.length){
    tableWrap.append(make("div","cr-empty","No active students are enrolled in this class."));
    return;
  }
  const visibleColumns=activeColumns();
  if(!visibleColumns.length){
    tableWrap.append(make("div","cr-empty","No active Class Record columns yet. Add a column or restore one from Archived."));
    updateDirtyState();
    return;
  }

  const categories=usedCategories();
  const weights=weightMap();
  const table=make("table","cr-table");
  const thead=document.createElement("thead");
  const headRow=document.createElement("tr");
  const studentHead=make("th","cr-student","Student");
  studentHead.scope="col";
  headRow.append(studentHead);

  visibleColumns.forEach((column,index)=>{
    const th=make("th");
    th.scope="col";
    th.dataset.columnId=column.columnId;
    th.append(make("span","cr-category",column.category||"Uncategorized"));
    th.append(make("span","cr-column-label",column.label));
    const source=column.kind==="assessment"
      ?sourceName(column.assessmentSource||SCHOOL_SOURCE)+" · "+numberText(column.maxPoints)+" pts"
      :"Manual · "+numberText(column.maxPoints)+" pts";
    th.append(make("span","cr-column-meta",source));
    const actions=make("div","mt-2 flex items-center justify-center gap-2 flex-wrap");
    if(index>0){
      const left=make("button","text-xs font-bold text-slate-600 underline","←");
      left.type="button";left.title="Move column left";
      left.addEventListener("click",()=>moveColumn(column.columnId,-1));actions.append(left);
    }
    if(index<visibleColumns.length-1){
      const right=make("button","text-xs font-bold text-slate-600 underline","→");
      right.type="button";right.title="Move column right";
      right.addEventListener("click",()=>moveColumn(column.columnId,1));actions.append(right);
    }
    const edit=make("button","text-xs font-bold text-blue-700 underline","Edit");
    edit.type="button";edit.addEventListener("click",()=>openColumnDialog(column));actions.append(edit);
    const archive=make("button","text-xs font-bold text-amber-700 underline","Archive");
    archive.type="button";archive.addEventListener("click",()=>archiveColumn(column));actions.append(archive);
    if(column.kind==="assessment"){
      const task=columnTask(column);
      if(task?.gradeRoute||task?.reviewRoute){
        const link=make("a","text-xs font-bold text-indigo-700 underline",
          task.sourceType===PERSONALIZED_SOURCE?"Studio grading":"Gradebook");
        link.href=task.sourceType===PERSONALIZED_SOURCE?(task.reviewRoute||task.gradeRoute):task.gradeRoute;
        actions.append(link);
      }
    }
    if(column.kind==="assessment"){
      const task=columnTask(column);
      th.title=task?.historical
        ?"Historical assessment link retained for this Class Record column."
        :String(task?.title||column.sourceTitle||"");
    }
    th.append(actions);
    headRow.append(th);
  });

  for(const category of categories){
    const th=make("th");
    th.scope="col";
    th.append(make("span","cr-category","Category"));
    th.append(make("span","cr-column-label",category));
    const weight=weights.get(category.toLocaleLowerCase("en"));
    th.append(make("span","cr-column-meta",weight===undefined?"Weight not set":numberText(weight)+"% weight"));
    headRow.append(th);
  }
  const initialHead=make("th");
  initialHead.scope="col";
  initialHead.append(make("span","cr-category","Computed"));
  initialHead.append(make("span","cr-column-label","Initial Grade"));
  initialHead.append(make("span","cr-column-meta","weighted 0–100"));
  headRow.append(initialHead);

  const periodHead=make("th");
  periodHead.scope="col";
  periodHead.append(make("span","cr-category","Computed"));
  periodHead.append(make("span","cr-column-label","Period Grade"));
  periodHead.append(make("span","cr-column-meta",
    settings.gradeComputation==="deped_60_100"?"60–100 transmutation":"weighted grade"));
  headRow.append(periodHead);

  thead.append(headRow);table.append(thead);
  const tbody=document.createElement("tbody");

  for(const student of roster){
    const tr=document.createElement("tr");
    const nameCell=make("th","cr-student");
    nameCell.scope="row";nameCell.append(make("span","cr-name",student.name));tr.append(nameCell);

    for(const column of visibleColumns){
      const td=document.createElement("td");
      if(column.kind==="manual"){
        const saved=manualScores.get(key(column.columnId,student.personId));
        const input=make("input","cr-score");
        input.type="number";input.min="0";input.max=String(column.maxPoints);input.step="0.01";input.inputMode="decimal";
        input.setAttribute("aria-label",column.label+" score for "+student.name);
        input.dataset.columnId=column.columnId;input.dataset.personId=student.personId;
        input.value=saved===null||saved===undefined?"":numberText(saved);
        input.dataset.original=input.value;input.dataset.dirty="false";
        input.addEventListener("input",updateDirtyState);td.append(input);
      }else{
        const grade=linkedGrade(column,student.personId);
        const personalized=(column.assessmentSource||SCHOOL_SOURCE)===PERSONALIZED_SOURCE;
        const value=make("span","cr-linked"+(personalized?" personalized":""),grade?numberText(grade.awarded):"—");
        if(grade){
          value.title="Published "+sourceName(column.assessmentSource||SCHOOL_SOURCE)+" result: "+
            numberText(grade.awarded)+" / "+numberText(grade.total);
        }else{
          value.title=personalized
            ?"No published Personalized Studio grade yet. Review the Studio submission, save the grade draft, and publish it from Studio grading."
            :"No published school Gradebook result yet.";
        }
        td.append(value);
      }
      tr.append(td);
    }

    for(const category of categories){
      const td=make("td","cr-summary");
      td.dataset.summaryPerson=student.personId;td.dataset.category=category;tr.append(td);
    }
    const initial=make("td","cr-summary");
    initial.dataset.summaryPerson=student.personId;initial.dataset.summaryKind="initial";tr.append(initial);
    const period=make("td","cr-summary");
    period.dataset.summaryPerson=student.personId;period.dataset.summaryKind="period";tr.append(period);
    tbody.append(tr);
  }
  table.append(tbody);tableWrap.append(table);
  updateDirtyState();
}
function populateAssessmentOptions(selectedSource="",selectedTaskId=""){
  assessmentSelect.replaceChildren();
  const used=new Set(columns.filter(column=>column.kind==="assessment"&&column.columnId!==editingColumnId)
    .map(column=>assessmentKey(column.assessmentSource||SCHOOL_SOURCE,column.taskId)));
  const selectedKey=selectedTaskId?assessmentKey(selectedSource,selectedTaskId):"";
  const available=assessments.filter(task=>{
    const key=assessmentKey(task.sourceType,task.taskId);
    return (task.linkable!==false&&!used.has(key))||key===selectedKey;
  });
  assessmentSelect.add(new Option(available.length?"Choose an assessment…":"No unlinked assessments available",""));
  assessmentSelect.options[0].disabled=true;
  for(const task of available){
    const label=(task.sourceType===PERSONALIZED_SOURCE?"Personalized Studio · ":"School · ")+
      task.title+" · "+numberText(task.maxPoints)+" pts"+
      (task.historical?" · historical":task.published===false?" · unpublished":"");
    assessmentSelect.add(new Option(label,assessmentKey(task.sourceType,task.taskId)));
  }
  assessmentSelect.value=selectedTaskId?assessmentKey(selectedSource,selectedTaskId):"";
  syncAssessmentSourceNote();
}
function selectedAssessment(){
  const value=assessmentSelect.value;
  return assessments.find(task=>assessmentKey(task.sourceType,task.taskId)===value)||null;
}
function syncAssessmentSourceNote(){
  const note=el("cr-assessment-source-note"),task=selectedAssessment();
  if(!task){note.hidden=true;note.textContent="";return;}
  note.hidden=false;
  if(task.sourceType===PERSONALIZED_SOURCE){
    note.textContent="Personalized Studio is graded from the exact learner-specific Studio submission. Class Record imports the score only after Studio grading publishes it; Repository Management is not involved.";
  }else{
    note.textContent="This school assessment uses the school Gradebook. Class Record shows only its published score.";
  }
  if(!columnForm.elements.category.value.trim()&&task.categorySuggestion)
    columnForm.elements.category.value=task.categorySuggestion;
}
function syncColumnFields(){
  const kind=columnKind.value;
  el("cr-manual-fields").hidden=kind!=="manual";
  el("cr-assessment-fields").hidden=kind!=="assessment";
  columnForm.elements.maxPoints.required=kind==="manual";
  assessmentSelect.required=kind==="assessment";
  if(kind==="assessment")syncAssessmentSourceNote();
}
function closeColumnDialog(){
  if(dialog.open)dialog.close();
  editingColumnId=null;
  el("cr-column-status").textContent="";
}
function openColumnDialog(column=null){
  if(column?.archived===true)return;
  editingColumnId=column?.columnId||null;
  columnForm.reset();
  el("cr-column-heading").textContent=column?"Edit column":"Add column";
  el("cr-column-save").textContent=column?"Save column details":"Add column";
  el("cr-column-lock-note").hidden=!column;
  columnForm.elements.label.value=column?.label||"";
  columnForm.elements.category.value=column?.category||"";
  columnKind.value=column?.kind||"manual";
  columnForm.elements.maxPoints.value=column?.kind==="manual"?String(column.maxPoints):"10";
  populateAssessmentOptions(column?.assessmentSource||SCHOOL_SOURCE,column?.kind==="assessment"?column.taskId:"");
  columnKind.disabled=Boolean(column);
  columnForm.elements.maxPoints.disabled=Boolean(column);
  assessmentSelect.disabled=Boolean(column);
  syncColumnFields();
  el("cr-column-status").textContent="";
  dialog.showModal();columnForm.elements.label.focus();
}
async function saveLayout(nextColumns,nextSettings=settings,success="Class Record layout saved."){
  setBusy(true,"Saving Class Record…");
  try{
    const result=await scoped(classRecordApi,"save_layout",{
      offeringId:currentOfferingId,expectedRevision:sheetRevision,
      columns:nextColumns,settings:nextSettings
    });
    columns=Array.isArray(result.columns)?result.columns:nextColumns;
    settings=result.settings||nextSettings;
    sheetRevision=Number(result.revision)||sheetRevision+1;
    render();say(success);return result;
  }finally{
    setBusy(false);syncColumnFields();
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
        input.dataset.original=input.value.trim();input.dataset.dirty="false";
        const score=input.value.trim()===""?null:Number(input.value);
        manualScores.set(key(columnId,input.dataset.personId),score);
      }
      dirtyColumns.delete(columnId);
    }
    updateDirtyState();say("Manual scores saved.");
  }catch(error){
    say(error?.message||"Manual scores were not fully saved. Review the changed cells and retry.");
  }finally{
    setBusy(false);updateDirtyState();
  }
}
function renderWeightSetup(){
  const host=el("cr-weight-list");host.replaceChildren();
  const categories=usedCategories(),saved=weightMap();
  schemeSelect.replaceChildren(new Option("Custom class setup",""));
  const visibleSchemes=gradingSchemes.filter(item=>item.status==="active"&&
    (schemeMatchesCurrentOffering(item)||item.schemeId===settings.appliedSchemeId));
  for(const scheme of visibleSchemes){
    const matches=schemeMatchesCurrentOffering(scheme);
    schemeSelect.add(new Option(
      scheme.name+" · rev "+scheme.revision+" · "+(matches?schemeScopeSummary(scheme):"snapshot only"),
      scheme.schemeId
    ));
  }
  pendingSchemeSnapshot=settings.appliedSchemeId?{
    schemeId:settings.appliedSchemeId,
    revision:Number(settings.appliedSchemeRevision)||0,
    name:settings.appliedSchemeName||"School grading scheme"
  }:null;
  schemeSelect.value=visibleSchemes.some(item=>item.schemeId===settings.appliedSchemeId)?
    settings.appliedSchemeId:"";
  const currentPreset=settings.appliedSchemeId?gradingSchemes.find(item=>item.schemeId===settings.appliedSchemeId):null;
  if(settings.appliedSchemeId){
    schemeNote.textContent=currentPreset&&currentPreset.revision!==Number(settings.appliedSchemeRevision)
      ?"This class uses "+(settings.appliedSchemeName||"a school preset")+" revision "+settings.appliedSchemeRevision+
        ". The school preset is now revision "+currentPreset.revision+"; reapply it explicitly to update this class."
      :"This class is using a snapshot of "+(settings.appliedSchemeName||"the selected school preset")+
        " revision "+settings.appliedSchemeRevision+".";
  }else schemeNote.textContent="Custom class setup. Applying a school preset copies its current weights and formula into this class record.";
  if(!categories.length){
    host.append(make("p","cr-muted py-3","Add and categorize at least one Class Record column before setting category weights."));
  }else{
    for(const category of categories){
      const row=make("label","cr-weight-row");
      row.append(make("span","font-semibold text-sm text-slate-800",category));
      const input=make("input","cr-input");
      input.type="number";input.min="0";input.max="100";input.step="0.001";
      input.dataset.weightCategory=category;
      input.value=saved.has(category.toLocaleLowerCase("en"))?String(saved.get(category.toLocaleLowerCase("en"))):"";
      input.addEventListener("input",()=>{pendingSchemeSnapshot=null;schemeSelect.value="";schemeNote.textContent="Custom class setup — this class no longer exactly follows a school preset.";updateWeightTotal();});
      row.append(input);host.append(row);
    }
  }
  setupForm.elements.gradeComputation.value=settings.gradeComputation||"raw_weighted";
  updateWeightTotal();
}
function applySelectedScheme(){
  const scheme=gradingSchemes.find(item=>item.schemeId===schemeSelect.value&&item.status==="active");
  if(!scheme){schemeNote.textContent="Choose an active school grading scheme first.";return;}
  if(!schemeMatchesCurrentOffering(scheme)){
    schemeNote.textContent="This preset no longer applies to this offering. The existing class snapshot remains valid, but this revision cannot be reapplied here.";
    return;
  }
  const schemeRows=scheme.settings?.categoryWeights||[];
  const weights=new Map(schemeRows.map(row=>[
    String(row.category||"").toLocaleLowerCase("en"),Number(row.weight)||0
  ]));
  const inputs=[...el("cr-weight-list").querySelectorAll("[data-weight-category]")];
  let missing=0;
  for(const input of inputs){
    const value=weights.get(String(input.dataset.weightCategory||"").toLocaleLowerCase("en"));
    input.value=value===undefined?"":String(value);
    if(value===undefined)missing++;
  }
  const activeKeys=new Set(inputs.map(input=>String(input.dataset.weightCategory||"").toLocaleLowerCase("en")));
  const exactCategorySet=missing===0&&schemeRows.length===activeKeys.size&&
    schemeRows.every(row=>activeKeys.has(String(row.category||"").toLocaleLowerCase("en")));
  setupForm.elements.gradeComputation.value=scheme.settings?.gradeComputation||"raw_weighted";
  pendingSchemeSnapshot=exactCategorySet
    ?{schemeId:scheme.schemeId,revision:scheme.revision,name:scheme.name}:null;
  schemeNote.textContent=exactCategorySet
    ?scheme.name+" revision "+scheme.revision+" is ready to apply to this class. Saving will snapshot these values."
    :scheme.name+" has different category names from this Class Record. Matching weights were staged as a custom setup; align the column categories before applying the preset as a versioned scheme.";
  updateWeightTotal();
}
function updateWeightTotal(){
  const inputs=[...el("cr-weight-list").querySelectorAll("[data-weight-category]")];
  const total=inputs.reduce((sum,input)=>sum+(Number(input.value)||0),0);
  el("cr-weight-total").textContent="Current total: "+numberText(total)+"%"+
    (Math.abs(total-100)<0.001?" · ready":" · period grade stays incomplete until this totals 100%");
}
function openSetup(){
  renderWeightSetup();el("cr-setup-status").textContent="";setupDialog.showModal();
}
function closeSetup(){if(setupDialog.open)setupDialog.close();el("cr-setup-status").textContent="";}
function equalWeights(){
  const inputs=[...el("cr-weight-list").querySelectorAll("[data-weight-category]")];
  if(!inputs.length)return;
  let assigned=0;
  inputs.forEach((input,index)=>{
    const value=index===inputs.length-1?100-assigned:Math.round((100/inputs.length)*1000)/1000;
    input.value=String(Math.round(value*1000)/1000);assigned+=value;
  });
  updateWeightTotal();
}
function renderArchivedList(){
  const host=el("cr-archived-list");host.replaceChildren();
  const archived=archivedColumns();
  archivedCount.textContent=String(archived.length);
  if(!archived.length){
    host.append(make("p","cr-muted py-3","No archived columns in this class record."));
    return;
  }
  for(const column of archived){
    const card=make("article","cr-list-card flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3");
    const info=make("div");
    info.append(make("strong","text-sm text-slate-900",column.label));
    info.append(make("p","cr-muted mt-1",(column.category||"Uncategorized")+" · "+
      (column.kind==="manual"?"Manual":sourceName(column.assessmentSource||SCHOOL_SOURCE))+
      " · "+numberText(column.maxPoints)+" pts"));
    if(column.kind==="assessment"&&column.sourceTitle)
      info.append(make("p","text-xs text-slate-500 mt-1",column.sourceTitle));
    const restore=make("button","cr-button","Restore");
    restore.type="button";restore.addEventListener("click",()=>restoreColumn(column));
    card.append(info,restore);host.append(card);
  }
}
function openArchived(){
  renderArchivedList();el("cr-archived-status").textContent="";archivedDialog.showModal();
}
function closeArchived(){if(archivedDialog.open)archivedDialog.close();}
function parseDelimited(raw){
  const text=String(raw||"").replace(/^\uFEFF/,"");
  const firstLine=text.split(/\r?\n/,1)[0]||"";
  const delimiter=firstLine.includes("\t")?"\t":",";
  const rows=[];let row=[],field="",quoted=false;
  for(let i=0;i<text.length;i++){
    const char=text[i];
    if(quoted){
      if(char==='"'&&text[i+1]==='"'){field+='"';i++;}
      else if(char==='"')quoted=false;
      else field+=char;
      continue;
    }
    if(char==='"'){quoted=true;continue;}
    if(char===delimiter){row.push(field);field="";continue;}
    if(char==="\n"){
      row.push(field.replace(/\r$/,""));rows.push(row);row=[];field="";continue;
    }
    field+=char;
  }
  row.push(field.replace(/\r$/,""));
  if(row.some(value=>value!==""))rows.push(row);
  return rows;
}
function normalizedStudentName(value){
  return String(value||"").trim().replace(/\s+/g," ").toLocaleLowerCase("en");
}
function openImport(){
  importColumn.replaceChildren();
  for(const column of activeManualColumns())importColumn.add(new Option(
    column.label+" · "+numberText(column.maxPoints)+" pts",column.columnId
  ));
  importText.value="";el("cr-import-file").value="";el("cr-import-status").textContent="";
  if(!importColumn.options.length){say("Add or restore a manual column before importing scores.");return;}
  importDialog.showModal();
}
function closeImport(){if(importDialog.open)importDialog.close();}
function downloadImportTemplate(){
  const column=activeManualColumns().find(item=>item.columnId===importColumn.value);
  if(!column)return;
  const csv="\uFEFF"+[["Student","Score"],...roster.map(student=>[student.name,""])]
    .map(row=>row.map(csvEscape).join(",")).join("\r\n");
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=(column.label||"scores").replace(/[^A-Za-z0-9_-]+/g,"-")+"-import.csv";
  a.hidden=true;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),0);
}
function stageImportedScores(){
  const column=activeManualColumns().find(item=>item.columnId===importColumn.value);
  if(!column){el("cr-import-status").textContent="Choose an active manual column.";return;}
  const rows=parseDelimited(importText.value);
  if(!rows.length){el("cr-import-status").textContent="Paste or choose a CSV/TSV file first.";return;}
  const nameBuckets=new Map();
  for(const student of roster){
    const key=normalizedStudentName(student.name),bucket=nameBuckets.get(key)||[];
    bucket.push(student);nameBuckets.set(key,bucket);
  }
  const byPerson=new Map(roster.map(student=>[student.personId,student]));
  let staged=0,skipped=0,ambiguous=0,invalid=0;
  const seen=new Set();
  for(let index=0;index<rows.length;index++){
    const cells=rows[index];
    if(cells.length<2)continue;
    const identity=String(cells[0]||"").trim(),rawScore=String(cells[1]||"").trim();
    if(!identity)continue;
    if(index===0&&["student","name","personid","person id"].includes(normalizedStudentName(identity)))continue;
    if(rawScore===""){skipped++;continue;}
    let student=byPerson.get(identity)||null;
    if(!student){
      const matches=nameBuckets.get(normalizedStudentName(identity))||[];
      if(matches.length===1)student=matches[0];
      else if(matches.length>1){ambiguous++;continue;}
    }
    if(!student){skipped++;continue;}
    if(seen.has(student.personId)){ambiguous++;continue;}
    const score=Number(rawScore);
    if(!Number.isFinite(score)||score<0||score>Number(column.maxPoints)){invalid++;continue;}
    const input=tableWrap.querySelector('input[data-column-id="'+CSS.escape(column.columnId)+'"][data-person-id="'+CSS.escape(student.personId)+'"]');
    if(!input){skipped++;continue;}
    input.value=numberText(score);seen.add(student.personId);staged++;
  }
  updateDirtyState();
  el("cr-import-status").textContent="Staged "+staged+" score"+(staged===1?"":"s")+
    (skipped?" · "+skipped+" unmatched/blank":"")+
    (ambiguous?" · "+ambiguous+" duplicate/ambiguous":"")+
    (invalid?" · "+invalid+" invalid/out of range":"")+
    ". Review the highlighted cells, then save manual scores.";
}
function formatFinalizedAt(value){
  const millis=Number(value);
  if(!Number.isFinite(millis)||millis<=0)return "time unavailable";
  try{return new Date(millis).toLocaleString();}catch{return "time unavailable";}
}
function finalizationExportRows(revision){
  const categories=(revision.grades?.[0]?.categoryScores||revision.categoryWeights||[])
    .map(row=>String(row.category||"")).filter(Boolean);
  const metadata=[
    ["Adminerva Class Record finalization",""],
    ["Revision",revision.revision],
    ["Finalized at",formatFinalizedAt(revision.finalizedAt)],
    ["Grading formula",revision.gradeComputation==="deped_60_100"?"DepEd-style 60–100 transmutation":"Weighted grade 0–100"],
    ["Grading scheme",revision.appliedSchemeName?
      revision.appliedSchemeName+" · rev "+revision.appliedSchemeRevision:"Custom class setup"],
    []
  ];
  const header=["Student"];
  for(const category of categories)header.push(category+" Raw",category+" %",category+" Weighted");
  header.push("Initial Grade","Period Grade");
  const rows=[...metadata,header];
  for(const grade of revision.grades||[]){
    const byCategory=new Map((grade.categoryScores||[]).map(row=>[String(row.category||"").toLocaleLowerCase("en"),row]));
    const row=[grade.name];
    for(const category of categories){
      const score=byCategory.get(category.toLocaleLowerCase("en"));
      row.push(score?numberText(score.earned)+" / "+numberText(score.max):"",
        score?Number(score.percentage):"",
        score?Number(score.weightedContribution):"");
    }
    row.push(Number(grade.initialGrade),Number(grade.periodGrade));
    rows.push(row);
  }
  return rows;
}
function downloadBlob(blob,filename){
  const url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=filename;a.hidden=true;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),0);
}
function exportBaseName(max=70){
  return (offeringSelect.selectedOptions[0]?.textContent||"class-record")
    .replace(/[^A-Za-z0-9_-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,max)||"class-record";
}
function downloadFinalizationRevisionCsv(revision){
  const rows=finalizationExportRows(revision);
  const csv="\uFEFF"+rows.map(row=>row.map(csvEscape).join(",")).join("\r\n");
  downloadBlob(new Blob([csv],{type:"text/csv;charset=utf-8"}),
    exportBaseName()+"-finalized-rev-"+revision.revision+".csv");
}
async function downloadFinalizationRevisionXlsx(revision){
  const {classRecordWorkbook}=await import("./xlsx-export.mjs?v=1.0.0");
  const rows=finalizationExportRows(revision);
  const blob=classRecordWorkbook(rows,{
    sheetName:"Finalized rev "+revision.revision,
    headerRowIndex:6
  });
  downloadBlob(blob,exportBaseName()+"-finalized-rev-"+revision.revision+".xlsx");
}
async function loadFinalizationRevision(revisionNumber){
  return scoped(classRecordApi,"finalization_revision",{
    offeringId:currentOfferingId,revision:revisionNumber
  });
}
async function exportFinalizationRevision(revisionNumber,format,button){
  if(button)button.disabled=true;
  try{
    const revision=await loadFinalizationRevision(revisionNumber);
    if(format==="xlsx")await downloadFinalizationRevisionXlsx(revision);
    else downloadFinalizationRevisionCsv(revision);
    el("cr-finalize-status").textContent="Finalized revision "+revisionNumber+
      " exported as "+(format==="xlsx"?"Excel":"CSV")+".";
  }catch(error){
    el("cr-finalize-status").textContent=error?.message||"Finalized revision could not be exported.";
  }finally{if(button)button.disabled=false;}
}
function renderFinalizationHistory(revisions){
  finalizeHistory.replaceChildren();
  if(!revisions?.length){
    finalizeHistory.append(make("p","cr-muted","No frozen period revisions yet."));
    return;
  }
  for(const revision of revisions){
    const card=make("article","cr-list-card flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3");
    const info=make("div");
    info.append(make("strong","text-sm text-slate-900","Revision "+revision.revision));
    info.append(make("p","cr-muted mt-1",
      formatFinalizedAt(revision.finalizedAt)+" · "+revision.studentCount+" student"+
      (revision.studentCount===1?"":"s")+" · sheet rev "+revision.sheetRevision));
    if(revision.appliedSchemeName)
      info.append(make("p","text-xs text-slate-500 mt-1",
        revision.appliedSchemeName+" · scheme rev "+revision.appliedSchemeRevision));
    const actions=make("div","flex flex-wrap gap-2");
    const exportRevision=make("button","cr-button","CSV");
    exportRevision.type="button";
    exportRevision.addEventListener("click",()=>void exportFinalizationRevision(revision.revision,"csv",exportRevision));
    const exportExcel=make("button","cr-button","Excel");
    exportExcel.type="button";
    exportExcel.addEventListener("click",()=>void exportFinalizationRevision(revision.revision,"xlsx",exportExcel));
    actions.append(exportRevision,exportExcel);
    card.append(info,actions);finalizeHistory.append(card);
  }
}
function closeFinalize(){
  if(finalizeDialog.open)finalizeDialog.close();
  finalizationPreview=null;
  el("cr-finalize-status").textContent="";
}
function renderFinalizationPreview(preview){
  finalizationPreview=preview;
  finalizeState.className="cr-readiness mt-4";
  finalizeBlockers.replaceChildren();
  finalizePreview.replaceChildren();
  const existing=preview.finalization;
  const current=existing&&!existing.stale&&existing.sourceDigest===preview.sourceDigest;
  if(preview.ready){
    if(current){
      finalizeState.classList.add("ready");
      finalizeState.textContent="Current period snapshot is finalized · revision "+existing.revision+
        " · "+formatFinalizedAt(existing.finalizedAt)+". No source changes detected.";
    }else if(existing){
      finalizeState.classList.add("stale");
      finalizeState.textContent="The live Class Record changed after finalized revision "+existing.revision+
        ". Review the new grades below and create a new finalization revision.";
    }else{
      finalizeState.classList.add("ready");
      finalizeState.textContent="Ready to finalize · "+preview.grades.length+" student"+
        (preview.grades.length===1?"":"s")+" · "+preview.activeColumnCount+" active column"+
        (preview.activeColumnCount===1?"":"s")+".";
    }
    const table=make("table","cr-finalize-table");
    const thead=document.createElement("thead"),head=document.createElement("tr");
    for(const label of ["Student","Initial Grade","Period Grade"]){
      const th=make("th","text-xs uppercase tracking-wide text-slate-500",label);
      th.scope="col";head.append(th);
    }
    thead.append(head);table.append(thead);
    const body=document.createElement("tbody");
    for(const grade of preview.grades||[]){
      const tr=document.createElement("tr");
      tr.append(make("td","font-semibold text-slate-900",grade.name));
      tr.append(make("td","",numberText(grade.initialGrade)));
      tr.append(make("td","font-extrabold text-slate-900",numberText(grade.periodGrade)));
      body.append(tr);
    }
    table.append(body);finalizePreview.append(table);
    finalizeConfirm.disabled=current;
    finalizeConfirm.textContent=current?"Already finalized":existing?"Finalize new revision":"Finalize period";
  }else{
    finalizeState.classList.add("blocked");
    finalizeState.textContent="Not ready to finalize · "+preview.blockerCount+" issue"+
      (preview.blockerCount===1?"":"s")+" must be resolved.";
    for(const item of preview.blockers||[]){
      const row=make("div","rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900",item.message);
      finalizeBlockers.append(row);
    }
    if(preview.blockerCount>(preview.blockers||[]).length){
      finalizeBlockers.append(make("p","cr-muted","Showing the first "+(preview.blockers||[]).length+
        " issues. Resolve them and review finalization again."));
    }
    finalizeConfirm.disabled=true;
    finalizeConfirm.textContent="Resolve blockers first";
  }
}
async function openFinalize(){
  if(dirtyColumns.size){
    say("Save manual score changes before reviewing period finalization.");
    return;
  }
  finalizationPreview=null;
  finalizeState.className="cr-readiness mt-4";
  finalizeState.textContent="Recalculating period grades from saved and published sources…";
  finalizeBlockers.replaceChildren();finalizePreview.replaceChildren();finalizeHistory.replaceChildren();
  finalizeConfirm.disabled=true;finalizeConfirm.textContent="Finalize period";
  el("cr-finalize-status").textContent="";
  finalizeDialog.showModal();
  try{
    const [preview,history]=await Promise.all([
      scoped(classRecordApi,"finalization_preview",{offeringId:currentOfferingId}),
      scoped(classRecordApi,"finalization_history",{offeringId:currentOfferingId})
    ]);
    renderFinalizationPreview(preview);
    renderFinalizationHistory(history.revisions||[]);
  }catch(error){
    finalizeState.classList.add("blocked");
    finalizeState.textContent=error?.message||"Period finalization preview could not be loaded.";
  }
}
async function finalizePeriod(){
  const preview=finalizationPreview;
  if(!preview?.ready||finalizeConfirm.disabled)return;
  const existing=preview.finalization;
  if(!confirm(existing
    ?"Create a new frozen period-grade revision from the current saved and published scores?"
    :"Finalize this period-grade snapshot for the class?"))return;
  finalizeConfirm.disabled=true;
  el("cr-finalize-status").textContent="Finalizing the server-verified period snapshot…";
  try{
    const result=await scoped(classRecordApi,"finalize_period",{
      offeringId:currentOfferingId,
      expectedSheetRevision:sheetRevision,
      expectedFinalizationRevision:existing?.revision||0
    });
    el("cr-finalize-status").textContent="Finalized revision "+result.revision+
      " for "+result.studentCount+" student"+(result.studentCount===1?"":"s")+".";
    await loadWorkspace();
    closeFinalize();
    say("Period grade finalized as revision "+result.revision+".");
  }catch(error){
    el("cr-finalize-status").textContent=error?.message||"Period finalization was not saved.";
    finalizeConfirm.disabled=false;
  }
}
function csvEscape(value){
  const text=String(value??"");
  return /[",\r\n]/.test(text)?'"'+text.replaceAll('"','""')+'"':text;
}
function liveExportRows(){
  const categories=usedCategories(),visibleColumns=activeColumns();
  const rows=[[
    "Student",
    ...visibleColumns.map(column=>column.label+" ("+numberText(column.maxPoints)+")"),
    ...categories.map(category=>category+" %"),
    "Initial Grade","Period Grade"
  ]];
  for(const student of roster){
    const metrics=metricsFor(student.personId,{fromInput:false});
    rows.push([
      student.name,
      ...visibleColumns.map(column=>{
        const value=scoreFor(column,student.personId,{fromInput:false});
        return value===null?"":Number(value);
      }),
      ...categories.map(category=>{
        const bucket=metrics.byCategory.get(category);
        return bucket?.complete&&bucket.max>0?
          Math.round((bucket.earned/bucket.max*100+Number.EPSILON)*10000)/10000:"";
      }),
      metrics.complete?Number(metrics.initial):"",
      metrics.complete?Number(metrics.period):""
    ]);
  }
  return rows;
}
function exportCsv(){
  if(!currentOfferingId||dirtyColumns.size)return;
  const rows=liveExportRows();
  const csv="\uFEFF"+rows.map(row=>row.map(csvEscape).join(",")).join("\r\n");
  downloadBlob(new Blob([csv],{type:"text/csv;charset=utf-8"}),exportBaseName(80)+".csv");
  say("Class Record CSV exported.");
}
async function exportXlsx(){
  if(!currentOfferingId||dirtyColumns.size)return;
  exportXlsxButton.disabled=true;
  const finish=window.beginLoading?.("Preparing Excel Class Record…")||(()=>{});
  try{
    const {classRecordWorkbook}=await import("./xlsx-export.mjs?v=1.0.0");
    const blob=classRecordWorkbook(liveExportRows(),{sheetName:"Class Record"});
    downloadBlob(blob,exportBaseName(80)+".xlsx");
    say("Class Record Excel workbook exported.");
  }catch(error){
    say(error?.message||"Excel export could not be created.");
  }finally{
    exportXlsxButton.disabled=busy||!currentOfferingId||dirtyColumns.size>0;
    finish();
  }
}
async function loadSchemes(){
  try{
    const result=await scoped(classRecordApi,"list_schemes");
    gradingSchemes=result.schemes||[];
  }catch(error){
    gradingSchemes=[];
    console.warn("Grading schemes unavailable:",error);
  }
}
async function loadWorkspace(){
  if(!currentOfferingId)return;
  setBusy(true,"Loading class roster and score sources…");
  try{
    const result=await scoped(classRecordApi,"workspace",{offeringId:currentOfferingId});
    currentOffering=result.offering||null;
    roster=result.roster||[];
    assessments=result.assessments||[];
    collaborators=result.collaborators||[];
    columns=(result.columns||[]).map(column=>{
      const normalized=column.kind==="assessment"&&!column.assessmentSource
        ?{...column,assessmentSource:SCHOOL_SOURCE}:column;
      return {...normalized,archived:normalized.archived===true};
    });
    settings=result.settings||{categoryWeights:[],gradeComputation:"raw_weighted",appliedSchemeId:null,appliedSchemeRevision:null,appliedSchemeName:""};
    sheetRevision=Number(result.sheetRevision)||0;
    finalization=result.finalization||null;
    periodReadiness=result.periodReadiness||{ready:false,blockerCount:0,activeColumnCount:0};
    syncFinalizationBanner();
    manualScores=new Map((result.manualScores||[]).map(item=>[key(item.columnId,item.personId),item.score]));
    publishedGrades=new Map((result.publishedGrades||[]).map(item=>[
      gradeKey(item.sourceType||SCHOOL_SOURCE,item.taskId,item.personId),item
    ]));
    dirtyColumns.clear();render();
    renderArchivedList();
    const personalizedAvailable=assessments.filter(task=>task.sourceType===PERSONALIZED_SOURCE&&task.linkable!==false).length;
    say("Class Record loaded. Linked scores are published-only"+
      (personalizedAvailable?" · "+personalizedAvailable+" Personalized Studio assessment"+(personalizedAvailable===1?"":"s")+" available for linking.":".")+
      (finalization?.stale?" · Finalized period record is stale and needs a new revision.":""));
  }catch(error){
    panel.hidden=true;say(error?.message||"Class Record could not be loaded.");
  }finally{
    setBusy(false);updateDirtyState();
  }
}
async function loadOfferings(){
  setBusy(true,"Loading your assigned classes…");
  try{
    const result=await scoped(academicsApi,"planning_options");
    periodRecords=result.periodRecords||[];
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
      currentOfferingId=offerings[0].offeringId;offeringSelect.value=currentOfferingId;
      await loadWorkspace();
    }
  }catch(error){
    say(error?.message||"Assigned classes could not be loaded.");
  }finally{setBusy(false);}
}

offeringSelect.addEventListener("change",async()=>{
  const next=offeringSelect.value;
  if(dirtyColumns.size&&!confirm("Discard unsaved manual score changes and open another class?")){
    offeringSelect.value=currentOfferingId;return;
  }
  currentOfferingId=next;currentOffering=null;roster=[];assessments=[];collaborators=[];columns=[];
  finalization=null;periodReadiness={ready:false,blockerCount:0,activeColumnCount:0};finalizationPreview=null;
  settings={categoryWeights:[],gradeComputation:"raw_weighted",appliedSchemeId:null,appliedSchemeRevision:null,appliedSchemeName:""};
  pendingSchemeSnapshot=null;
  manualScores.clear();publishedGrades.clear();dirtyColumns.clear();
  if(next)await loadWorkspace();else render();
});
addButton.addEventListener("click",()=>openColumnDialog());
setupButton.addEventListener("click",openSetup);
applySchemeButton.addEventListener("click",applySelectedScheme);
setupForm.elements.gradeComputation.addEventListener("change",()=>{
  pendingSchemeSnapshot=null;schemeSelect.value="";
  schemeNote.textContent="Custom class setup — the period-grade formula was changed for this class.";
});
schemeSelect.addEventListener("change",()=>{
  const scheme=gradingSchemes.find(item=>item.schemeId===schemeSelect.value);
  schemeNote.textContent=scheme
    ?scheme.name+" revision "+scheme.revision+" selected. Use Apply scheme to copy its current values."
    :"Custom class setup.";
});
importButton.addEventListener("click",openImport);
archivedButton.addEventListener("click",openArchived);
finalizeButton.addEventListener("click",()=>void openFinalize());
refreshButton.addEventListener("click",()=>{
  if(dirtyColumns.size&&!confirm("Discard unsaved manual score changes and refresh this class?"))return;
  void loadWorkspace();
});
saveScoresButton.addEventListener("click",()=>void saveManualScores());
exportButton.addEventListener("click",exportCsv);
exportXlsxButton.addEventListener("click",()=>void exportXlsx());
columnKind.addEventListener("change",syncColumnFields);
el("cr-import-file").addEventListener("change",async event=>{
  const file=event.target.files?.[0];if(!file)return;
  if(file.size>500000){el("cr-import-status").textContent="Import files must be 500 KB or smaller.";return;}
  importText.value=await file.text();
  el("cr-import-status").textContent="File loaded. Stage the scores to preview changes in the record.";
});
el("cr-import-template").addEventListener("click",downloadImportTemplate);
assessmentSelect.addEventListener("change",syncAssessmentSourceNote);
el("cr-column-close").addEventListener("click",closeColumnDialog);
el("cr-column-cancel").addEventListener("click",closeColumnDialog);
el("cr-setup-close").addEventListener("click",closeSetup);
el("cr-setup-cancel").addEventListener("click",closeSetup);
el("cr-equal-weights").addEventListener("click",equalWeights);
el("cr-import-close").addEventListener("click",closeImport);
el("cr-import-cancel").addEventListener("click",closeImport);
el("cr-archived-close").addEventListener("click",closeArchived);
el("cr-finalize-close").addEventListener("click",closeFinalize);
el("cr-finalize-cancel").addEventListener("click",closeFinalize);
finalizeConfirm.addEventListener("click",()=>void finalizePeriod());
importForm.addEventListener("submit",event=>{event.preventDefault();stageImportedScores();});

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
      label,category,kind:"manual",maxPoints:Number(columnForm.elements.maxPoints.value),archived:false
    };
  }else{
    const task=selectedAssessment();
    if(!task){el("cr-column-status").textContent="Choose a deployed assessment.";return;}
    nextColumn={
      columnId:"col_"+crypto.randomUUID().replaceAll("-","").slice(0,20),
      label,category,kind:"assessment",taskId:task.taskId,
      assessmentSource:task.sourceType,maxPoints:task.maxPoints,
      sourceTitle:task.title,archived:false
    };
  }
  const next=existing?
    columns.map(column=>column.columnId===existing.columnId?nextColumn:column):
    [...columns,nextColumn];
  el("cr-column-status").textContent="Saving column…";
  void saveLayout(next,settings).then(closeColumnDialog).catch(error=>{
    el("cr-column-status").textContent=error?.message||"The column was not saved.";
  });
});

setupForm.addEventListener("submit",event=>{
  event.preventDefault();
  const weightInputs=[...el("cr-weight-list").querySelectorAll("[data-weight-category]")];
  const categoryWeights=weightInputs.map(input=>({
    category:input.dataset.weightCategory,weight:Number(input.value||0)
  }));
  const nextSettings={
    categoryWeights,
    gradeComputation:setupForm.elements.gradeComputation.value,
    ...(pendingSchemeSnapshot?{
      appliedSchemeId:pendingSchemeSnapshot.schemeId,
      appliedSchemeRevision:pendingSchemeSnapshot.revision,
      appliedSchemeName:pendingSchemeSnapshot.name
    }:{})
  };
  const total=categoryWeights.reduce((sum,row)=>sum+row.weight,0);
  if(total>100.0001){
    el("cr-setup-status").textContent="Category weights cannot exceed 100%.";return;
  }
  el("cr-setup-status").textContent="Saving grading setup…";
  void saveLayout(columns,nextSettings,"Grading setup saved.").then(closeSetup).catch(error=>{
    el("cr-setup-status").textContent=error?.message||"Grading setup was not saved.";
  });
});

window.addEventListener("beforeunload",event=>{
  if(!dirtyColumns.size)return;
  event.preventDefault();event.returnValue="";
});

picker=createTenantSchoolPicker({
  host:el("cr-school-switcher"),
  status,
  onBeforeChange:async()=>{
    if(dirtyColumns.size)throw new Error("Save or discard manual score changes before switching schools.");
    currentOfferingId="";currentOffering=null;offerings=[];periodRecords=[];roster=[];assessments=[];collaborators=[];columns=[];gradingSchemes=[];
    finalization=null;periodReadiness={ready:false,blockerCount:0,activeColumnCount:0};finalizationPreview=null;
    pendingSchemeSnapshot=null;
    settings={categoryWeights:[],gradeComputation:"raw_weighted",appliedSchemeId:null,appliedSchemeRevision:null,appliedSchemeName:""};
    manualScores.clear();publishedGrades.clear();dirtyColumns.clear();
    offeringSelect.replaceChildren(new Option("Choose a class…",""));
    offeringSelect.disabled=true;panel.hidden=true;kpis.replaceChildren();
  },
  onReady:scope=>{
    if(!scope.current?.roles.includes("teacher")){
      say("Your role in this school does not include Class Record access.");return;
    }
    void loadSchemes().finally(()=>loadOfferings());
  }
});