import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";

const require=createRequire(import.meta.url);
const {
  validPool,
  PERSONALIZATION_MODE
}=require("../functions/studio-assessment-variants.js");

function assessment(fingerprint="abc123"){
  return {
    personalizedTask:{
      enabled:true,
      mode:PERSONALIZATION_MODE,
      poolFingerprint:fingerprint
    }
  };
}
function privatePool(fingerprint="abc123"){
  return {
    personalization:{
      mode:PERSONALIZATION_MODE,
      fingerprint,
      variants:[
        {
          variantId:"0123456789abcdef01234567",
          prompt:"Create a programming solution using the exact individualized requirements supplied in this variant.",
          evaluationNotes:"Check the exact variant-specific requirements against the common published rubric."
        },
        {
          variantId:"89abcdef0123456701234567",
          prompt:"Implement the same assessed programming competencies using this different individualized problem statement.",
          evaluationNotes:"Use the same rubric and verify the variant-specific details before awarding credit."
        }
      ]
    }
  };
}

test("generic personalized pool accepts topic-agnostic variants",()=>{
  const pool=validPool(privatePool(),assessment());
  assert.equal(pool.length,2);
  assert.match(pool[0].prompt,/programming solution/);
  assert.equal(PERSONALIZATION_MODE,"ai_blueprint_pool_v1");
});

test("generic personalized pool rejects a stale blueprint fingerprint",()=>{
  assert.throws(
    ()=>validPool(privatePool("old-fingerprint"),assessment("new-fingerprint")),
    /stale/
  );
});

test("generic personalized pool rejects duplicate variant identities",()=>{
  const value=privatePool();
  value.personalization.variants[1].variantId=value.personalization.variants[0].variantId;
  assert.throws(()=>validPool(value,assessment()),/duplicate variant IDs/);
});

test("generic personalized pool validates prompts without assuming a programming topic",()=>{
  const value=privatePool();
  value.personalization.variants[0].prompt="short";
  assert.throws(()=>validPool(value,assessment()),/incomplete/);

  const sql=privatePool();
  sql.personalization.variants[0].prompt=
    "Using the supplied table requirements, write the requested SQL queries with the individualized table and column names for this variant.";
  assert.equal(validPool(sql,assessment()).length,2);
});
