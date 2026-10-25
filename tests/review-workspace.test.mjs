/** Regression coverage: Adminerva module: review workspace. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parseRepository,validSha} from '../js/repo-review/services/assessment-evidence.mjs';
import {evidenceRevision,gradeMatchesEvidence,sameEvidence} from '../js/repo-review/services/evidence-lifecycle.mjs';
import {assertGradeVersion,nextGradeVersion} from '../js/repo-review/services/grade-version.mjs';

const checkpoint='a'.repeat(40);
function workspace(evidence){
  const elements=new Map();
  function element(){
    const classes=new Set();
    return {value:'',textContent:'',checked:false,children:[],disabled:false,
      classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name),
        toggle:(name,force)=>force?classes.add(name):classes.delete(name)},
      append(...children){this.children.push(...children);},replaceChildren(){this.children=[];},
      scrollIntoView(){},focus(){},
      setAttribute(name,value){this[name]=value;},getAttribute(name){return this[name]||null;},removeAttribute(name){delete this[name];},
      addEventListener(name,handler){this[name]=handler;},reset(){for(const node of elements.values()){node.value='';node.checked=false;}}};
  }
  const html=readFileSync('repofetch.html','utf8');
  for(const match of html.matchAll(/id="([^"]+)"/g))elements.set(match[1],element());
  const records=new Map([
    ['students/alice',{name:'Alice',section:'11-A',repoUrl:'https://github.com/example/project',githubUsername:'alice'}],
    ['assessments/v2',{schemaVersion:2,title:'Three group screens',maxScore:20}],
  ]);
  if(evidence)records.set('assessment_evidence/alice_v2',evidence);
  const writes=[],listeners={};
  const document={readyState:'complete',getElementById:id=>elements.get(id),createElement:()=>element(),addEventListener:()=>{}};
  const window={addEventListener:(type,handler)=>{listeners[type]=handler;},dispatchEvent:()=>{}};
  const snapshot=ref=>({ref,exists:()=>records.has(ref.path),data:()=>records.get(ref.path)});
  let panelOptions;
  const context={document,window,location:{origin:'https://example.test'},URLSearchParams,AbortController,setTimeout,clearTimeout,
    auth:{currentUser:{uid:'teacher'}},db:{},parseRepository,validSha,evidenceRevision,gradeMatchesEvidence,sameEvidence,assertGradeVersion,nextGradeVersion,
    createReviewRequests:()=>({}),mountReviewPanels:options=>{panelOptions=options;return {destroy(){},updateEvidence(){}};},
    cleanGradeFeedback:value=>String(value||''),pickDefinedGradeFields:(value,keys)=>Object.fromEntries(keys.filter(key=>value[key]!==undefined).map(key=>[key,value[key]])),
    collection:(_db,name)=>({path:name}),doc:(_db,...parts)=>({path:parts.join('/'),id:parts.at(-1)}),
    getDoc:async ref=>snapshot(ref),getDocs:async()=>({docs:[]}),query:()=>{},where:()=>{},
    serverTimestamp:()=>1234,runTransaction:async(_db,callback)=>callback({get:async ref=>snapshot(ref),set:(ref,data)=>writes.push({ref,data})}),
    CustomEvent:class {constructor(type){this.type=type;}},localStorage:{getItem:()=>null},alert:()=>{},confirm:()=>true};
  const source=readFileSync('js/repo-review/manual-review.mjs','utf8').replace(/^import[\s\S]*?from\s+"[^"]+";\s*/gm,'');
  context.renderFeedbackMarkdown=(container,value)=>{container.textContent=value;};
  vm.runInNewContext(source+';window.fixtureState=state;',context);
  return {elements,records,writes,listeners,window,context,change:record=>panelOptions.onEvidenceChange(record),open:()=>window.openManualGradeReview({studentId:'alice',taskId:'v2',owner:'example',repo:'project'})};
}
const approved={studentId:'alice',assessmentId:'v2',status:'approved',checkpointSha:checkpoint,approvedCheckpointSha:checkpoint,
  selectedCommits:[checkpoint],verifiedContributionCommits:[checkpoint],
  contributionScope:'Alice is assigned the welcome screen; instructor observed her implementation.',
  repository:'https://github.com/example/project',revision:1};
test('unchanged evidence snapshots do not strand a running evaluation; manual cancellation ignores late output',async()=>{
  for(const cancel of [false,true,"timeout"]){
    const page=workspace(approved);await page.open();let finish;
    page.context.localStorage={getItem:key=>key==='Adminerva_gemini_token'?'synthetic-evaluation-key':null};
    page.context.schoolAIStatus=async()=>({configured:false,model:'gemini-3.8-flash',capabilities:{}});
    page.context.generateSchoolContent=async()=>({});
    page.context.parseWeightedRubric=()=>[];
    page.context.loadPinnedV2Source=()=>new Promise(resolve=>{finish=resolve;});
    page.context.buildRubricPrompt=()=>'';page.context.createBackoffClient=()=>({fetch:async()=>({})});page.context.evaluationJSON=async()=>({});
    page.context.parseSuggestedRubric=()=>({criteria:[],score:15,feedback:'Draft feedback'});
    let expire;
    if(cancel==="timeout"){page.context.setTimeout=callback=>{expire=callback;return 1;};page.context.clearTimeout=()=>{};}
    const operation=page.context.generateAIDraft();
    await Promise.resolve();
    page.change({...approved,selectedCommits:[checkpoint]});
    if(cancel==="timeout")expire();else if(cancel)page.elements.get('manualReviewManual').click();
    finish({files:[{path:'screen.xml'}],patches:[]});await operation;
    assert.equal(page.window.fixtureState.aiBusy,false);
    assert.equal(Boolean(page.window.fixtureState.active.aiDraft),!cancel);
    assert.equal(page.elements.get('manualReviewFeedback').value,'');assert.equal(page.writes.length,0);
  }
});
test('suggestions never replace teacher fields without a separate explicit copy',async()=>{
  const page=workspace(approved);await page.open();
  page.elements.get('manualReviewScore').value='12';page.elements.get('manualReviewFeedback').value='Teacher feedback';
  page.window.fixtureState.active.aiDraft={score:17,feedback:'Suggested feedback',criteria:[]};
  assert.equal(page.elements.get('manualReviewScore').value,'12');
  page.elements.get('manualReviewUseScore').click();
  assert.equal(page.elements.get('manualReviewScore').value,'17');assert.equal(page.elements.get('manualReviewFeedback').value,'Teacher feedback');
  page.context.confirm=()=>false;page.elements.get('manualReviewUseFeedback').click();
  assert.equal(page.elements.get('manualReviewFeedback').value,'Teacher feedback');assert.equal(page.writes.length,0);
});
test('missing checker setup explains the blocker without preventing manual grading',async()=>{
  const page=workspace(approved);await page.open();page.context.schoolAIStatus=async()=>{throw Error('Evaluation service is not configured; grade manually.');};await page.context.generateAIDraft();
  assert.match(page.elements.get('manualReviewAIStatus').textContent,/grade manually/);
  assert.equal(page.elements.get('manualReviewSave').disabled,false);
  assert.equal(page.elements.get('integratedEvidenceDetails').open,true);
});

test('unapproved and missing evidence open inline review without enabling grade save',async()=>{
  for(const evidence of [null,{...approved,status:'submitted'}]){
    const page=workspace(evidence);await page.open();
    assert.equal(page.elements.get('integratedEvidenceDetails').open,true);
    assert.equal(page.elements.has('integratedEvidenceFrame'),false);
    assert.equal(page.elements.get('manualReviewSave').disabled,true);
    assert.equal(page.elements.get('manualReviewAIGenerate').disabled,true,page.elements.get('manualReviewStatus').textContent);
    assert.equal(page.writes.length,0);
  }
});
test('approved work enables evaluation; old approvals and noncontributors require verification',async()=>{
  const page=workspace(approved);await page.open();
  assert.equal(page.elements.get('manualReviewAIGenerate').disabled,false);
  assert.equal(page.elements.get('manualReviewSave').disabled,false);
  assert.equal(page.writes.length,0);
  const other=workspace({...approved,verifiedContributionCommits:[]});await other.open();
  assert.equal(other.elements.get('manualReviewAIGenerate').disabled,true);
});
test('explicit save records an unpublished reviewed grade and revision; changed evidence blocks save',async()=>{
  const page=workspace(approved);await page.open();
  page.elements.get('manualReviewScore').value='15';page.elements.get('manualReviewFeedback').value='Welcome screen implementation reviewed.';
  page.elements.get('manualReviewReason').value='Verified student work and inspected the checkpoint.';
  page.elements.get('manualReviewConfirm').checked=true;
  await page.elements.get('manualReviewForm').submit({preventDefault(){}});
  const grade=page.writes.find(write=>write.ref.path==='student_grades/alice_v2').data;
  assert.equal(grade.published,false);assert.equal(grade.evidenceRevision,1);assert.equal(grade.gradedSha,checkpoint);
  assert.equal(page.writes.length,2);
  const changed=workspace(approved);await changed.open();
  changed.elements.get('manualReviewScore').value='15';changed.elements.get('manualReviewFeedback').value='Inspected.';
  changed.elements.get('manualReviewReason').value='Rechecked.';changed.elements.get('manualReviewConfirm').checked=true;
  changed.records.set('assessment_evidence/alice_v2',{...approved,revision:4});
  await changed.elements.get('manualReviewForm').submit({preventDefault(){}});
  assert.equal(changed.writes.length,0);assert.match(changed.elements.get('manualReviewStatus').textContent,/approval changed/);
});
test('published grades are protected and live evidence changes keep teacher edits but invalidate eligibility',async()=>{
  const page=workspace(approved);
  page.records.set('student_grades/alice_v2',{score:12,feedback:'Protected feedback',published:true});
  await page.open();assert.equal(page.elements.get('manualReviewSave').disabled,true);
  assert.equal(page.elements.get('manualReviewAIGenerate').disabled,true);
  assert.equal(page.listeners.message,undefined);
  assert.equal(page.elements.get('manualReviewFeedback').value,'Protected feedback');
  const draft=workspace(approved);await draft.open();draft.elements.get('manualReviewFeedback').value='Teacher edits in progress';
  draft.change({...approved,status:'reopened',revision:2});
  assert.equal(draft.elements.get('manualReviewFeedback').value,'Teacher edits in progress');
  assert.equal(draft.elements.get('manualReviewSave').disabled,true);
  assert.match(draft.elements.get('manualReviewStatus').textContent,/kept/);
  assert.equal(draft.elements.get('manualReviewAIGenerate').disabled,true);
});

test('closing or refreshing an edited draft requires explicit discard confirmation',async()=>{
  const page=workspace(approved);await page.open();
  page.elements.get('manualReviewFeedback').value='Unsaved teacher edits';
  page.elements.get('manualReviewForm').input();
  page.context.confirm=()=>false;
  page.elements.get('manualReviewClose').click();
  assert.equal(page.elements.get('manualReviewModal').classList.contains('hidden'),false);
  page.elements.get('manualReviewRefresh').click();
  assert.equal(page.elements.get('manualReviewFeedback').value,'Unsaved teacher edits');
  page.context.confirm=()=>true;page.elements.get('manualReviewClose').click();
  assert.equal(page.elements.get('manualReviewModal').classList.contains('hidden'),true);
});

test('later teacher edits retain the origin of automated feedback',async()=>{
  const page=workspace(approved);
  const assistance={model:'test-model',checkpointSha:checkpoint,suggestedScore:15};
  page.records.set('student_grades/alice_v2',{score:15,feedback:'Generated then reviewed feedback',published:false,aiAssistance:assistance});
  await page.open();
  assert.match(page.elements.get('manualReviewAIStatus').textContent,/includes automated assistance/);
  page.elements.get('manualReviewReason').value='Teacher rechecked the assignment and edited feedback';
  page.elements.get('manualReviewConfirm').checked=true;
  await page.elements.get('manualReviewForm').submit({preventDefault(){}});
  const grade=page.writes.find(write=>write.ref.path==='student_grades/alice_v2').data;
  assert.equal(grade.gradeSource,'teacher_ai_reviewed');
  assert.deepEqual(grade.aiAssistance,assistance);
});
