import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

function harness(request){
  let now=0,calls=0,hidden=0;const nodes=new Map(),alerts=[],timers=[];
  function node(id){if(!nodes.has(id))nodes.set(id,{value:"",disabled:false,files:[],innerHTML:"",classList:{add(){},remove(){}},insertAdjacentHTML(){},addEventListener(type,listener){this[type]=listener;}});return nodes.get(id);}
  const context={window:{showSubtleLoader(){},hideSubtleLoader(){hidden++;}},document:{getElementById:node,addEventListener(){}},
    fetch:async(...args)=>{calls++;return request(...args);},Date:{now:()=>now},AbortSignal:{timeout:ms=>{timers.push(ms);return {timeout:ms};}},setTimeout:(callback,ms)=>{now+=ms;callback();},
    localStorage:{getItem:key=>key==="Adminerva_gemini_token"?"fixture-key":"fixture-model",setItem(){}},alert:message=>alerts.push(message),console};
  const source=readFileSync(new URL("../js/lesson-review/library.js",import.meta.url),"utf8").replace(/^import[\s\S]*?from\s+['"][^'"]+['"];\s*/gm,"");
  vm.runInNewContext(source+"\nglobalThis.seedFolder=()=>{libraryData=[{id:'folder',name:'Folder',documents:[]}];activeFolderId='folder';};",context);
  return {...context,node,alerts,timers,get calls(){return calls;},get hidden(){return hidden;}};
}
const file={name:"files/example",uri:"https://fixture.test/pdf"};

test("PDF processing stops immediately on failed HTTP status instead of polling indefinitely",async()=>{
  for(const status of [403,429,503]){
    const app=harness(async()=>({ok:false,status}));
    await assert.rejects(app.waitForProcessedPDF(file,"example.pdf","key"),new RegExp("status "+status));
    assert.equal(app.calls,1);
  }
});

test("PDF processing is finite when the provider never finishes and each request has a timeout",async()=>{
  const app=harness(async()=>({ok:true,json:async()=>({state:"PROCESSING"})}));
  await assert.rejects(app.waitForProcessedPDF(file,"example.pdf","key"),/two minutes/);
  assert.equal(app.calls,40);assert.ok(app.timers.every(ms=>ms>0&&ms<=15000));
});

test("PDF processing returns the uploaded URI only after ACTIVE and rejects invalid provider states",async()=>{
  let state="PROCESSING";const app=harness(async()=>({ok:true,json:async()=>({state:state==="PROCESSING"?(state="ACTIVE","PROCESSING"):state})}));
  assert.equal(await app.waitForProcessedPDF(file,"example.pdf","key"),file.uri);assert.equal(app.calls,2);
  for(const state of ["FAILED","UNKNOWN",undefined]){
    const invalid=harness(async()=>({ok:true,json:async()=>({state})}));
    await assert.rejects(invalid.waitForProcessedPDF(file,"example.pdf","key"));assert.equal(invalid.calls,1);
  }
});

test("a failed processing check restores the import action and preserves selected files for retry",async()=>{
  const app=harness(async url=>url.includes("/upload/")?{ok:true,json:async()=>({file})}:{ok:false,status:503});
  app.seedFolder();const input=app.node("pdfFileInput"),selected=[{name:"example.pdf",type:"application/pdf",size:1}];input.files=selected;input.value="selected.pdf";
  await app.window.extractPDF();
  assert.equal(input.disabled,false);assert.equal(input.files,selected);assert.equal(input.value,"selected.pdf");assert.equal(app.hidden,1);assert.match(app.alerts[0],/retry/);
  await app.window.extractPDF();assert.equal(app.calls,4);assert.equal(app.hidden,2);
  input.click({currentTarget:input});assert.equal(input.value,"");
});
