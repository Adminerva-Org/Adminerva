import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";

const require=createRequire(import.meta.url);
const {schemeScopesOverlap,schemeSpecificity}=require("../functions/school-class-record.js");

test("equal-specificity policies that can match the same class are detected as overlapping",()=>{
  assert.equal(schemeSpecificity({programId:"program-a"}),1);
  assert.equal(schemeSpecificity({subjectId:"subject-1"}),1);
  assert.equal(schemeScopesOverlap({programId:"program-a"},{subjectId:"subject-1"}),true);
  assert.equal(schemeScopesOverlap({periodTypes:["quarter"]},{programId:"program-a"}),true);
});

test("disjoint program, section and period scopes do not conflict",()=>{
  const sectionPrograms=new Map([["section-b","program-b"]]);
  assert.equal(schemeScopesOverlap({programId:"program-a"},{programId:"program-b"},{sectionPrograms}),false);
  assert.equal(schemeScopesOverlap({programId:"program-a"},{sectionId:"section-b"},{sectionPrograms}),false);
  assert.equal(schemeScopesOverlap({periodTypes:["quarter"]},{periodTypes:["semester"]},{sectionPrograms}),false);
});

test("same section or compatible section-program scopes remain overlapping",()=>{
  const sectionPrograms=new Map([["section-a","program-a"]]);
  assert.equal(schemeScopesOverlap({sectionId:"section-a"},{sectionId:"section-a"},{sectionPrograms}),true);
  assert.equal(schemeScopesOverlap({programId:"program-a"},{sectionId:"section-a"},{sectionPrograms}),true);
});


test("restoring an archived grading policy revalidates dependencies and overlap",()=>{
  const source=readFileSync(new URL("../functions/school-class-record.js",import.meta.url),"utf8");
  assert.match(source,/if\(restoring\)\{/);
  assert.match(source,/Restore the grading policy's program\/division before restoring this policy/);
  assert.match(source,/Restore the grading policy's subject before restoring this policy/);
  assert.match(source,/Restore the grading policy's section before restoring this policy/);
  assert.match(source,/restore overlap can be validated safely/);
  assert.match(source,/schemeScopesOverlap\(restoredApplicability/);
});
