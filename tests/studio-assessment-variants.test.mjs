import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";

const require=createRequire(import.meta.url);
const {
  validPool,
  validVariant,
  PERSONALIZATION_MODE,
  MAX_POOL_SIZE
}=require("../functions/studio-assessment-variants.js");

const ids=[
  "0123456789abcdef01234567",
  "89abcdef0123456701234567"
];
function assessment(fingerprint="abc123",poolSize=ids.length){
  return {
    personalizedTask:{
      enabled:true,
      mode:PERSONALIZATION_MODE,
      poolFingerprint:fingerprint,
      poolSize
    }
  };
}
function privatePool(fingerprint="abc123",variantIds=ids){
  return {
    personalization:{
      mode:PERSONALIZATION_MODE,
      fingerprint,
      variantIds
    }
  };
}
function variant(variantId=ids[0],fingerprint="abc123"){
  return {
    variantId,
    fingerprint,
    prompt:"Create a programming solution using the exact individualized requirements supplied in this variant.",
    evaluationNotes:"Check the exact variant-specific requirements against the common published rubric."
  };
}

test("generic personalized pool accepts scalable topic-agnostic variant ids",()=>{
  const pool=validPool(privatePool(),assessment());
  assert.deepEqual(pool.variantIds,ids);
  assert.equal(pool.fingerprint,"abc123");
  assert.equal(PERSONALIZATION_MODE,"ai_blueprint_pool_v1");
  assert.equal(MAX_POOL_SIZE,600);
});

test("generic personalized pool rejects a stale blueprint fingerprint",()=>{
  assert.throws(
    ()=>validPool(privatePool("old-fingerprint"),assessment("new-fingerprint")),
    /stale/
  );
});

test("generic personalized pool rejects duplicate variant identities",()=>{
  assert.throws(
    ()=>validPool(privatePool("abc123",[ids[0],ids[0]]),assessment("abc123",2)),
    /duplicate variant IDs/
  );
});

test("generic personalized pool metadata must match the public active pool size",()=>{
  assert.throws(
    ()=>validPool(privatePool(),assessment("abc123",1)),
    /metadata is incomplete/
  );
});

test("private variant document validates prompt and fingerprint independently",()=>{
  assert.equal(validVariant(variant(),{variantId:ids[0],fingerprint:"abc123"}).variantId,ids[0]);
  assert.throws(
    ()=>validVariant({...variant(),prompt:"short"},{variantId:ids[0],fingerprint:"abc123"}),
    /record is invalid/
  );
  assert.throws(
    ()=>validVariant(variant(ids[0],"old"),{variantId:ids[0],fingerprint:"abc123"}),
    /record is invalid/
  );
});
