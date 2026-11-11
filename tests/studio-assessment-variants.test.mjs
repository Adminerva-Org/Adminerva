import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";

const require=createRequire(import.meta.url);
const {buildJavaLogicVariant,GENERATOR_ID}=require("../functions/studio-assessment-variants.js");

test("personalized Java logic variants are deterministic for the same entropy",()=>{
  const seed=Buffer.from(Array.from({length:24},(_,index)=>index+1));
  const first=buildJavaLogicVariant(seed),second=buildJavaLogicVariant(Buffer.from(seed));
  assert.equal(first.generatorId,GENERATOR_ID);
  assert.equal(first.prompt,second.prompt);
  assert.deepEqual(first.publicSpec,second.publicSpec);
  assert.match(first.prompt,/Create a Java console program/);
  for(const name of first.publicSpec.variableNames)assert.match(first.prompt,new RegExp(name));
});

test("different entropy changes the learner task",()=>{
  const first=buildJavaLogicVariant(Buffer.alloc(24,1));
  const second=buildJavaLogicVariant(Buffer.alloc(24,9));
  assert.notEqual(first.prompt,second.prompt);
  assert.notDeepEqual(first.publicSpec,second.publicSpec);
});
