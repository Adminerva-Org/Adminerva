/** Regression coverage: Adminerva module: lesson school format. */
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
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
test("landscape Google Docs dimensions and seven columns remain stable",()=>{
  assert.match(exporter,/magnitude:\s*936,\s*unit:\s*"PT"/);
  assert.match(exporter,/magnitude:\s*612,\s*unit:\s*"PT"/);
  assert.match(exporter,/const mainWidths\s*=\s*\[\s*69,\s*121,\s*121,\s*35,\s*338,\s*90,\s*90\s*\]/);
});
test("editing standards and objectives must reach the save and export state",()=>{
  for(const name of ["topic","content_standard","performance_standard","materials"]){
    assert.ok(editor.includes('data-weekly-field="'+name+'"'));
  }
  assert.match(editor,/window\.syncOutputToData\s*=\s*function/);
  assert.match(editor,/data-key="objectives"/);
  assert.match(exporter,/window\.syncOutputToData\?\.\(\)/);
});
