import test from "node:test";
import assert from "node:assert/strict";
import {moveItem,swapItems} from "../js/student/arcade-interactions.mjs";
test("reorder and swap arcade steps without losing identities",()=>{
  const x=[{id:"a"},{id:"b"},{id:"c"}],first=x[0];
  assert.equal(moveItem(x,0,2),true);assert.deepEqual(x.map(v=>v.id),["b","c","a"]);assert.strictEqual(x[2],first);
  assert.equal(swapItems(x,0,1),true);assert.deepEqual(x.map(v=>v.id),["c","b","a"]);
});
test("ignore invalid or unchanged arcade interactions",()=>{
  const a=[1,2,3];
  for(const [x,y] of [[0,0],[-1,1],[0,3],[0,1.1],[NaN,0]]){assert.equal(moveItem(a,x,y),false);assert.equal(swapItems(a,x,y),false);}
  assert.deepEqual(a,[1,2,3]);
});
