import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {parseRepository,normalizeSelection,validSha} from "../js/repo-review/services/assessment-evidence.mjs";
import {sameEvidence} from "../js/repo-review/services/evidence-lifecycle.mjs";

function fixture({snapshotLoad=async()=>({paths:[],files:[]})}={}){
  const elements=new Map(),changes=[];
  const element=()=>({value:"",disabled:false,checked:false,textContent:"",dataset:{},children:[],classList:{add(){},remove(){},toggle(){}},append(...nodes){this.children.push(...nodes);},replaceChildren(){this.children=[];},addEventListener(type,listener){this[type]=listener;},querySelector:()=>null,focus(){}});
  const root={querySelector:selector=>{if(!elements.has(selector))elements.set(selector,element());return elements.get(selector);},querySelectorAll:()=>[],addEventListener(type,listener){this[type]=listener;}};
  const window={};window.parent=window;
  let snapshot;
  const context={window,location:{search:"",origin:"https://fixture.test"},URLSearchParams,setTimeout,clearTimeout,
    document:{getElementById:()=>null,createElement:element},db:{},auth:{currentUser:{uid:"teacher"}},parseRepository,normalizeSelection,validSha,sameEvidence,
    localStorage:{getItem:()=>null},doc:(_db,...parts)=>({path:parts.join("/")}),collection:()=>({}),query:()=>({}),where:()=>({}),getDocs:async()=>({docs:[]}),
    onSnapshot:(_ref,listener)=>{snapshot=listener;return ()=>{};},loadReviewSnapshot:snapshotLoad};
  const source=readFileSync("js/repo-review/assessment-evidence-review.mjs","utf8").replace(/^import[\s\S]*?from\s+['"][^'"]+['"];\s*/gm,"").replace(/\bexport\s+/g,"");
  runInNewContext(source+"\nglobalThis.create=createEvidenceReview;",context);
  const repo="https://github.com/example/project",sha="a".repeat(40);
  const evidence={studentId:"alice",assessmentId:"task",repository:repo,selectedCommits:[sha],checkpointSha:sha,status:"submitted",revision:7};
  const review=context.create({root,inlineContext:{student:{id:"alice",name:"Alice",section:"11-A",repoUrl:repo},assessment:{id:"task",title:"Task"}},requests:{json:async()=>({files:[]})},onChange:record=>changes.push(record)});
  return {root,elements,changes,review,evidence,emit:(record,fromCache=false)=>snapshot({metadata:{hasPendingWrites:false,fromCache},exists:()=>Boolean(record),data:()=>record})};
}
test("approval waits for a live server snapshot; stale initial data cannot clear an editable review",async()=>{
  const page=fixture();const loading=page.review.load({...page.evidence,status:"reopened",revision:6});
  assert.equal(page.elements.get("#evidenceApprove").disabled,true);assert.equal(page.elements.get("#evidenceReviewNote").disabled,true);
  page.emit({...page.evidence,revision:6},true);await Promise.resolve();assert.equal(page.elements.get("#evidenceApprove").disabled,true);
  page.emit(page.evidence);await loading;
  assert.equal(page.elements.get("#evidenceApprove").disabled,false);assert.equal(page.changes.at(-1).revision,7);
  const note=page.elements.get("#evidenceReviewNote");note.value="Teacher notes in progress";page.root.input({target:{closest:()=>true}});
  page.emit({...page.evidence});assert.equal(note.value,"Teacher notes in progress");
  page.emit({...page.evidence,revision:8});assert.equal(note.value,"Teacher notes in progress");assert.equal(page.elements.get("#evidenceApprove").disabled,true);
  page.review.destroy();
});
test("a superseding load and close settle the first subscription without enabling stale controls",async()=>{
  const page=fixture();const first=page.review.load({...page.evidence,revision:6});const second=page.review.load(page.evidence);
  assert.equal(page.elements.get("#evidenceApprove").disabled,true);
  page.emit(page.evidence);await Promise.all([first,second]);assert.equal(page.elements.get("#evidenceApprove").disabled,false);assert.equal(page.changes.length,1);
  page.review.destroy();
  const closing=fixture();const waiting=closing.review.load(closing.evidence);closing.review.destroy();await waiting;assert.equal(closing.elements.get("#evidenceApprove").disabled,true);
});
test("slow checkpoint previews cannot hold approval status and workspace handoff hostage",async()=>{
  let finish;
  const page=fixture({snapshotLoad:()=>new Promise(resolve=>{finish=resolve;})});
  const loading=page.review.load(page.evidence);page.emit({...page.evidence,status:"approved"});
  const result=await Promise.race([loading.then(()=>"ready"),new Promise(resolve=>setTimeout(()=>resolve("blocked"),150))]);
  assert.equal(result,"ready");assert.equal(page.elements.get("#evidenceApprove").textContent,"Checkpoint approved");
  assert.equal(page.changes.at(-1).status,"approved");
  finish({paths:[],files:[]});page.review.destroy();
});
