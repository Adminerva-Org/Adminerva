import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildReferenceContext,extractReferenceText,REFERENCE_CONTEXT_BUDGET} from './reference-context.mjs';

test('legacy 98k references are preserved and selected across the entire resource',()=>{
  const original=('Unrelated introductory material about keyboards and fonts.\n\n').repeat(1550)
    +'\n\nWeek 4 laboratory: Java arrays and debugging loops. Learning competencies and assessment checklist.';
  const other='Java arrays. Grade 11 competency: test collection indices in the laboratory.';
  const first={title:'Legacy guide',text:original};
  const selected=buildReferenceContext([first,{title:'Lab notes',text:other}],{
    scope:'Grade 11 Week 4 Java arrays laboratory',budget:25000
  });
  assert.equal(first.text,original,'stored legacy references must never be altered');
  assert.equal(selected.totalCharacters,original.length+other.length);
  assert.ok(selected.text.length<=REFERENCE_CONTEXT_BUDGET);
  assert.equal(selected.includedDocuments,2);
  assert.match(selected.text,/laboratory: Java arrays and debugging loops/);
  assert.match(selected.text,/Lab notes/);
  assert.equal(selected.partial,true);
});
test('different teachers may upload records with pages, paragraphs and extractedText',()=>{
  assert.match(extractReferenceText({sections:[{heading:'Topic',body:'Fractions on number lines'}]}),/Fractions/);
  assert.equal(extractReferenceText({extractedText:'Unit plan'}),'Unit plan');
  assert.equal(extractReferenceText({pages:[{content:'Page One'},{text:'Page Two'}]}),'Page One\nPage Two');
  const result=buildReferenceContext([
    {title:'Workbook',pages:[{text:'Fractions number lines'},{text:'Addition'}]},
    {name:'Alternative lesson',content:'Learning outcomes for fractions'}
  ],{scope:'fractions',budget:1500});
  assert.equal(result.documentCount,2);
  assert.equal(result.includedDocuments,2);
  assert.equal(result.partial,false);
});
test('unreadable legacy records are counted, not silently treated as included',()=>{
  const summary=buildReferenceContext([
    {title:'Old scan',text:''},
    {title:'Lesson',body:'Topic review and formative assessment'}
  ],{budget:1500});
  assert.equal(summary.readableDocuments,1);
  assert.deepEqual(summary.missingTextDocuments,['Old scan']);
  assert.equal(summary.includedDocuments,1);
});
test('reference context respects budget including source headings',()=>{
  const data=Array.from({length:35},(_,i)=>({title:'Reference '+i,text:'Topic '+i+' '+('abcd '.repeat(150))}));
  const result=buildReferenceContext(data,{budget:1400});
  assert.ok(result.text.length<=1400);
  assert.ok(result.includedDocuments<35);
  assert.ok(result.omittedDocumentTitles.length>0);
});
test('settings use separate forms for GitHub and optional coding help',()=>{
  const html=readFileSync('student-settings.html','utf8');
  assert.match(html,/id="repoPickerHeading"/);
  assert.match(html,/id="discoverStudentRepos"/);
  assert.match(html,/id="geminiKeyForm"/);
  const inner=html.slice(html.indexOf('<form id="repoForm"'),html.indexOf('</form>',html.indexOf('<form id="repoForm"')));
  assert.doesNotMatch(inner,/id="geminiKeyForm"/);
  assert.match(html,/<details class="group p-5 sm:p-6">/);
  assert.doesNotMatch(html,/up to 15 requests per/);
});
test('lesson planner reports the reference coverage and no longer hard truncates first 25000',()=>{
  const page=readFileSync('lesson-planner.html','utf8');
  const engine=readFileSync('js/lesson-review/ai-engine.js','utf8');
  assert.match(page,/id="referenceContextStatus"/);
  assert.match(engine,/buildReferenceContext\(records/);
  assert.doesNotMatch(engine,/cachedCompiledText[.]substring\(0,\s*25000\)/);
  assert.doesNotMatch(engine,/Only the first 25,000 characters/);
});
