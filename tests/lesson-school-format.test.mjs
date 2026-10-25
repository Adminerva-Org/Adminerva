/** Regression coverage: Adminerva module: lesson school format. */
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {__googleDocsExportTest as docsExport} from "../js/lesson-review/google-docs-export.mjs";
const template=readFileSync("lesson-planner.html","utf8");
const exporter=readFileSync("js/lesson-review/document-exporter.js","utf8");
const editor=readFileSync("js/lesson-review/app-ui.js","utf8");
test("school-required curriculum headings and four signatures remain intact",()=>{
  for(const heading of ["Content","Learning Standards","Learning Competencies","Time Frame",
      "Learning Experiences & Activities","Remarks and Interventions"]){
    assert.ok(template.includes(heading),"Missing school heading "+heading);
  }
  for(let i=1;i<=4;i++){
    assert.ok(template.includes('id="printSig'+i+'Name"'));
    assert.ok(template.includes('id="printSig'+i+'Title"'));
  }
  assert.match(template,/id="printTableBody"/);
});
test("landscape Google Docs dimensions and seven columns remain stable",async()=>{
  const activeExporter=readFileSync("js/lesson-review/google-docs-export.mjs","utf8");
  const widths=[69,121,121,35,338,90,90];
  assert.match(exporter,/exportLessonToGoogleDocs/);
  assert.match(activeExporter,/cells\.length===7\?\[69,121,121,35,338,90,90\]/);
  const previousFetch=globalThis.fetch;
  let formatted;
  globalThis.fetch=async(_url,options)=>({ok:true,status:200,text:async()=>{
    if(options.method==="POST"){formatted=JSON.parse(options.body);return "{}";}
    return JSON.stringify({body:{content:[{startIndex:1,table:{columns:7}}]}});
  }});
  try{
    await docsExport.formatDocument("lesson-format",{tables:[{columns:7,widths}]},"fixture-token",()=>{});
    assert.deepEqual(formatted.requests[0].updateDocumentStyle.documentStyle.pageSize,{
      width:{magnitude:936,unit:"PT"},height:{magnitude:612,unit:"PT"}
    });
    assert.deepEqual(formatted.requests.slice(1).map(request=>request.updateTableColumnProperties.tableColumnProperties.width.magnitude),widths);
    assert.deepEqual(formatted.requests.slice(1).map(request=>request.updateTableColumnProperties.columnIndices),widths.map((_,index)=>[index]));
  }finally{globalThis.fetch=previousFetch;}
});
test("editing standards and objectives must reach the save and export state",()=>{
  for(const name of ["topic","content_standard","performance_standard","materials"]){
    assert.ok(editor.includes('data-weekly-field="'+name+'"'));
  }
  assert.match(editor,/window\.syncOutputToData\s*=\s*function/);
  assert.match(editor,/data-key="objectives"/);
  assert.match(exporter,/window\.syncOutputToData\?\.\(\)/);
});
