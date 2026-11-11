import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";

const require=createRequire(import.meta.url);
const {
  buildJavaLogicVariant,
  buildJavaOopVariant,
  buildVariant,
  JAVA_LOGIC_GENERATOR_ID,
  JAVA_OOP_GENERATOR_ID
}=require("../functions/studio-assessment-variants.js");

test("personalized Java logic variants are deterministic for the same entropy",()=>{
  const seed=Buffer.from(Array.from({length:24},(_,index)=>index+1));
  const first=buildJavaLogicVariant(seed),second=buildJavaLogicVariant(Buffer.from(seed));
  assert.equal(first.generatorId,JAVA_LOGIC_GENERATOR_ID);
  assert.equal(first.prompt,second.prompt);
  assert.deepEqual(first.publicSpec,second.publicSpec);
  assert.match(first.prompt,/Create a Java console program/);
  for(const name of first.publicSpec.variableNames)assert.match(first.prompt,new RegExp(name));
});

test("personalized Java OOP variants preserve the same competency structure",()=>{
  const seed=Buffer.from(Array.from({length:24},(_,index)=>index*7+3));
  const variant=buildJavaOopVariant(seed),spec=variant.publicSpec;
  assert.equal(variant.generatorId,JAVA_OOP_GENERATOR_ID);
  assert.equal(spec.language,"java");
  assert.deepEqual(spec.competencies,[
    "class","encapsulation","constructor","instance_method","objects","state","output"
  ]);
  assert.equal(spec.requiredFiles.length,2);
  assert.ok(spec.requiredFiles.includes("Main.java"));
  assert.ok(spec.requiredFiles.includes(spec.className+".java"));
  assert.equal(spec.fields.length,2);
  assert.ok(spec.fields.every(field=>field.visibility==="private"));
  assert.equal(spec.objects.length,2);
  assert.equal(spec.expectedOutput.length,2);
  for(const object of spec.objects)assert.equal(object.finalValue,object.startValue+object.change);
  assert.match(variant.prompt,/constructor/i);
  assert.match(variant.prompt,/private/);
  assert.match(variant.prompt,/two objects/i);
  assert.match(variant.prompt,/Inheritance, interfaces, databases, GUI code and advanced frameworks are NOT required/);
});

test("different entropy changes both Java logic and OOP learner tasks",()=>{
  const firstLogic=buildJavaLogicVariant(Buffer.alloc(24,1));
  const secondLogic=buildJavaLogicVariant(Buffer.alloc(24,9));
  assert.notEqual(firstLogic.prompt,secondLogic.prompt);

  const firstOop=buildJavaOopVariant(Buffer.alloc(24,2));
  const secondOop=buildJavaOopVariant(Buffer.alloc(24,11));
  assert.notEqual(firstOop.prompt,secondOop.prompt);
  assert.notDeepEqual(firstOop.publicSpec,secondOop.publicSpec);
});

test("generator dispatch selects the requested recipe",()=>{
  const seed=Buffer.from(Array.from({length:24},(_,index)=>index+10));
  assert.equal(buildVariant(JAVA_LOGIC_GENERATOR_ID,seed).generatorId,JAVA_LOGIC_GENERATOR_ID);
  assert.equal(buildVariant(JAVA_OOP_GENERATOR_ID,seed).generatorId,JAVA_OOP_GENERATOR_ID);
  assert.throws(()=>buildVariant("unknown_recipe",seed),/Unsupported personalized task generator/);
});
