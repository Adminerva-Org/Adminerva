import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

function harness(request){
  let now=0,calls=0,hidden=0;const nodes=new Map(),alerts=[],timers=[];
  function node(id){
    if(!nodes.has(id))nodes.set(id,{
      value:"",disabled:false,files:[],innerHTML:"",
      classList:{add(){},remove(){}},insertAdjacentHTML(){},
      addEventListener(type,listener){this[type]=listener;}
    });
    return nodes.get(id);
  }
  class FixtureFileReader{
    readAsDataURL(){
      this.result="data:application/pdf;base64,ZmFrZQ==";
      this.onload?.();
    }
  }
  const context={
    window:{showSubtleLoader(){},hideSubtleLoader(){hidden++;}},
    document:{getElementById:node,addEventListener(){}},
    fetch:async(...args)=>{calls++;return request(...args);},
    FileReader:FixtureFileReader,
    Date:{now:()=>now},
    AbortSignal:{timeout:ms=>{timers.push(ms);return {timeout:ms};}},
    setTimeout:(callback,ms)=>{timers.push(ms);now+=ms;callback();},
    localStorage:{
      getItem:key=>key==="Adminerva_gemini_token"?"fixture-key":"fixture-model",
      setItem(){}
    },
    alert:message=>alerts.push(message),console,TextEncoder
  };
  const source=readFileSync(new URL("../js/lesson-review/library.js",import.meta.url),"utf8")
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];\s*/gm,"");
  vm.runInNewContext(
    source+"\nglobalThis.seedFolder=()=>{libraryData=[{id:'folder',name:'Folder',documents:[]}];activeFolderId='folder';};",
    context
  );
  return {...context,node,alerts,timers,get calls(){return calls;},get hidden(){return hidden;}};
}

const selectedPdf=()=>[{name:"example.pdf",type:"application/pdf",size:1}];
const failed=status=>({ok:false,status,statusText:"fixture",text:async()=>""});

test("PDF extraction stops immediately on a non-retryable provider response",async()=>{
  const app=harness(async()=>failed(403));
  app.seedFolder();
  const input=app.node("pdfFileInput"),selected=selectedPdf();
  input.files=selected;input.value="selected.pdf";
  await app.window.extractPDF();
  assert.equal(app.calls,1);
  assert.equal(input.disabled,false);
  assert.equal(input.files,selected);
  assert.equal(input.value,"selected.pdf");
  assert.equal(app.hidden,1);
  assert.match(app.alerts[0],/HTTP 403/);
});

test("PDF extraction retries only a bounded number of times when the provider is busy",async()=>{
  const app=harness(async()=>failed(503));
  app.seedFolder();
  const input=app.node("pdfFileInput"),selected=selectedPdf();
  input.files=selected;input.value="selected.pdf";
  await app.window.extractPDF();
  assert.equal(app.calls,4);
  assert.equal(input.disabled,false);
  assert.equal(input.files,selected);
  assert.equal(input.value,"selected.pdf");
  assert.equal(app.hidden,1);
  assert.match(app.alerts[0],/remained unavailable/);
  assert.equal(app.timers.length,3);
});

test("an empty successful AI response fails safely without clearing the selected PDF",async()=>{
  const app=harness(async()=>({ok:true,status:200,json:async()=>({candidates:[]})}));
  app.seedFolder();
  const input=app.node("pdfFileInput"),selected=selectedPdf();
  input.files=selected;input.value="selected.pdf";
  await app.window.extractPDF();
  assert.equal(app.calls,1);
  assert.equal(input.disabled,false);
  assert.equal(input.files,selected);
  assert.equal(input.value,"selected.pdf");
  assert.match(app.alerts[0],/no text returned/);
});

test("the same selected PDF can be retried after a failed extraction",async()=>{
  const app=harness(async()=>failed(503));
  app.seedFolder();
  const input=app.node("pdfFileInput"),selected=selectedPdf();
  input.files=selected;input.value="selected.pdf";
  await app.window.extractPDF();
  await app.window.extractPDF();
  assert.equal(app.calls,8);
  assert.equal(app.hidden,2);
  assert.equal(input.disabled,false);
  assert.equal(input.files,selected);
  assert.equal(input.value,"selected.pdf");
});
