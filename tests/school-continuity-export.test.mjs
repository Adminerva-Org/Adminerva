import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);

const {
  EXPORT_SCHEMA,CATEGORY_NAMES,categoryDigest
}=require("../functions/school-data-export.js");
const {verifyBundle}=require("../functions/school-continuity-restore-plan.js");

const sha=value=>createHash("sha256").update(value).digest("hex");

function bundleWith(categories){
  const counts={},categoryIntegrity={};
  for(const category of CATEGORY_NAMES){
    const rows=categories[category]||[];
    counts[category]=rows.length;
    categoryIntegrity[category]={count:rows.length,sha256:categoryDigest(rows)};
  }
  const payload={
    schema:EXPORT_SCHEMA,
    schoolId:"mcs-manila",
    schoolDisplayName:"Manila Cathedral School",
    generatedAt:"2026-10-31T09:00:00.000Z",
    sourceManifest:{
      generatedAt:"2026-10-31T08:59:00.000Z",
      counts,initialCounts:counts,categoryIntegrity,
      includes:[],excludes:[],privacyNotice:"protected"
    },
    categories:Object.fromEntries(CATEGORY_NAMES.map(category=>[category,categories[category]||[]]))
  };
  return {...payload,sha256:sha(JSON.stringify(payload))};
}

test("continuity export v2 verifies top-level and per-category integrity",()=>{
  const bundle=bundleWith({
    people:[{id:"person_1",displayName:"Student One",kind:"student",status:"active"}],
    sections:[{id:"sec_1",name:"11-A",status:"active"}]
  });
  assert.equal(bundle.schema,"adminerva-school-continuity-export-v2");
  assert.doesNotThrow(()=>verifyBundle(bundle));
});

test("continuity restore rejects category tampering even with recomputed top-level SHA",()=>{
  const bundle=bundleWith({
    people:[{id:"person_1",displayName:"Student One",kind:"student",status:"active"}]
  });
  bundle.categories.people[0].displayName="Changed after export";
  const {sha256:_,...payload}=bundle;
  bundle.sha256=sha(JSON.stringify(payload));
  assert.throws(()=>verifyBundle(bundle),/category integrity check failed: people/);
});

test("continuity restore rejects missing category-integrity metadata",()=>{
  const bundle=bundleWith({});
  delete bundle.sourceManifest.categoryIntegrity;
  const {sha256:_,...payload}=bundle;
  bundle.sha256=sha(JSON.stringify(payload));
  assert.throws(()=>verifyBundle(bundle),/category-integrity manifest is missing/);
});
