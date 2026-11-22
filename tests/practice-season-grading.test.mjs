import test from "node:test";
import assert from "node:assert/strict";
import {gradeSeasonAnswer} from "../functions/practice-season.mjs";

test("matching accepts equivalent duplicate terminal cards",()=>{
  const question={
    type:"matching",
    right:["10","25","0","0"],
    solution:[0,1,3,2]
  };
  assert.equal(gradeSeasonAnswer(question,[0,1,2,3]),true);
  assert.equal(gradeSeasonAnswer(question,[0,1,3,2]),true);
  assert.equal(gradeSeasonAnswer(question,[1,0,2,3]),false);
});

test("ordering accepts visibly identical duplicate blocks without weakening other positions",()=>{
  const question={
    type:"ordering",
    items:["A","B","B"],
    solution:[0,2,1]
  };
  assert.equal(gradeSeasonAnswer(question,[0,1,2]),true);
  assert.equal(gradeSeasonAnswer(question,[1,0,2]),false);
});
