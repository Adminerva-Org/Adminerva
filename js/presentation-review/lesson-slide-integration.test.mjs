/** Regression coverage: Editable slides, lesson provenance and safe slide export: lesson slide integration. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {lessonStarterDeck,lessonSourceChanged} from './lesson-to-slides.mjs';
function fixture(){
  const nodes=new Map();
  const element=()=>({value:'',innerHTML:'',textContent:'',disabled:false,children:[],appendChild(node){this.children.push(node);},classList:{add(){},remove(){},replace(){}}});
  for(const id of ['presentationPlanSelect','presentationSessionSelect','btnGenerateSlides','btnDeletePresentation','presentationSourceStatus'])nodes.set(id,element());
  const window={renderSlideBlocks(){},selectSlide(){},sanitizePresentationHtml:value=>String(value||'')};
  const context={window,db:{},document:{addEventListener(){},getElementById:id=>nodes.get(id),createElement:element},URLSearchParams,location:{search:''},confirm:()=>true,alert(){},console:{error(){},warn(){}},lessonStarterDeck,lessonSourceChanged,doc:(_db,...parts)=>({path:parts.join('/')}),getDoc:async()=>({exists:()=>false}),getDocs:async()=>({forEach(){}})};
  const source=readFileSync('js/presentation-review/presentation-firebase.js','utf8').replace(/^import[\s\S]*?from\s+"[^"]+";\s*/gm,'');
  context.workspaceOnReady=()=>{};
  context.workspaceUid=()=>"teacher-fixture";
  context.ownedDoc=(_db,...parts)=>({path:["staff_workspaces","teacher-fixture",...parts].join("/")});
  vm.runInNewContext(source,context);
  return {window,context,nodes};
}
test('changing the selected lesson cannot silently discard unsaved slides',()=>{
  const page=fixture();page.window.selectedPlanData={id:'original'};page.window.adminervaPresentationDirty=true;
  page.window.currentPresentationDeck=[{content:'Unsaved teacher edits'}];page.nodes.get('presentationPlanSelect').value='other';page.context.confirm=()=>false;
  page.window.handlePlanSelection();
  assert.equal(page.nodes.get('presentationPlanSelect').value,'original');assert.equal(page.window.selectedPlanData.id,'original');assert.equal(page.window.currentPresentationDeck[0].content,'Unsaved teacher edits');
});
test('a late saved-session response cannot replace the newly selected session deck',async()=>{
  const page=fixture(),pending=new Map();
  page.context.getDoc=ref=>new Promise(resolve=>pending.set(ref.path,resolve));
  page.window.selectedPlanData={id:'saved',version:3,sessions:[{session_name:'One'},{session_name:'Two'}]};
  page.window.adminervaPresentationDirty=false;page.nodes.get('presentationPlanSelect').value='saved';
  page.nodes.get('presentationSessionSelect').value='0';const first=page.window.handleSessionSelection();
  page.nodes.get('presentationSessionSelect').value='1';const second=page.window.handleSessionSelection();
  const snapshot=content=>({exists:()=>true,data:()=>({deck:[{content}],source_lesson_version:2})});
  pending.get('staff_workspaces/teacher-fixture/presentations/saved_session1')(snapshot('Second session'));await second;
  pending.get('staff_workspaces/teacher-fixture/presentations/saved_session0')(snapshot('Stale first session'));await first;
  assert.equal(page.window.currentPresentationDeck[0].content,'Second session');assert.equal(page.window.selectedSessionIndex,'1');assert.equal(page.window.presentationSourceLessonVersion,2);
});
test('a late system-generated deck does not overwrite edits made while waiting',async()=>{
  const page=fixture();let resolveResponse;
  page.context.localStorage={getItem:key=>key==='Adminerva_ai_model'?'fixture-model':'fixture-provider-key'};
  page.context.fetch=()=>new Promise(resolve=>{resolveResponse=resolve;});
  page.window.selectedPlanData={version:3,subject_title:'Programming',weekly_overview:{topic:'XML'}};
  page.window.selectedSessionData={session_name:'One'};page.window.currentPresentationDeck=[{content:'Before request'}];
  const aiSource=readFileSync('js/presentation-review/presentation-ai.js','utf8').replace(/^import .*;\r?$/gm,'');
  vm.runInNewContext(aiSource,page.context);
  const request=page.window.generateAI_SlideDeck();
  page.window.currentPresentationDeck=[{content:'New teacher edits'}];page.window.adminervaPresentationDirty=true;
  const slides=Array.from({length:5},()=>({layout:'standard',label:'Draft',content:'Generated'}));
  resolveResponse({ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify(slides)}]}}]})});await request;
  assert.equal(page.window.currentPresentationDeck[0].content,'New teacher edits');assert.equal(page.window.adminervaPresentationDirty,true);
});
