import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {PUBLIC_PARTITION,schoolUserPartition}=require("../apps/desktop/session-partition.cjs");
test("desktop recovery partitions separate school people but retain a returning learner",()=>{
 const a=schoolUserPartition("learner-A"),b=schoolUserPartition("learner-B");
 assert.notEqual(a,b);
 assert.equal(a,schoolUserPartition("learner-A"));
 assert.match(a,/^persist:adminerva-school-[0-9a-f]{48}$/);
 assert.equal(PUBLIC_PARTITION,"persist:adminerva-public-preview");
 assert.ok(!a.includes("learner-A"));
 for(const uid of ["",null,undefined,"x".repeat(129)])
  assert.throws(()=>schoolUserPartition(uid));
});
