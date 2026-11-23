import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {isJavaSourceModel} from "../js/student/studio-diagnostics.mjs";

test("extensionless Java Monaco models remain visible to Studio diagnostics",()=>{
  const javaModel={getLanguageId:()=>"java"};
  const textModel={getLanguageId:()=>"plaintext"};
  assert.equal(isJavaSourceModel("Main.java",textModel),true);
  assert.equal(isJavaSourceModel("Main",javaModel),true);
  assert.equal(isJavaSourceModel("src/Main",javaModel),true);
  assert.equal(isJavaSourceModel("README",textModel),false);
  assert.equal(isJavaSourceModel("Main.txt",javaModel),false);
});

test("Studio preserves a Java extension when a learner renames a Java source to a bare name",()=>{
  const playground=readFileSync("js/student/playground.js","utf8");
  assert.match(playground,/oldLeaf\.toLowerCase\(\)\.endsWith\("\.java"\)/);
  assert.match(playground,/currentLang==="java"/);
  assert.match(playground,/newName\+="\.java"/);
  assert.match(playground,/studio-runtime-integration\.mjs\?v=20261123-java-diagnostics-1/);
});

test("extensionless Java source produces a corrective diagnostics warning",()=>{
  const diagnostics=readFileSync("js/student/studio-diagnostics.mjs","utf8");
  assert.match(diagnostics,/isJavaSourceModel\(name,model\)/);
  assert.match(diagnostics,/missing the \.java extension/);
  assert.match(diagnostics,/Rename it to/);
});
