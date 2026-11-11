import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {
  buildExternalPersonalizationPackage,
  parseExternalPersonalizationResponse,
  EXTERNAL_PERSONALIZATION_RESPONSE_FORMAT
} from "../js/repo-review/services/external-personalization.mjs";

const assessment={
  title:"Generic personalized programming task",
  type:"Mini PETA",
  assessmentFormat:"studio_code",
  assessmentMode:"personalized",
  subject:"Programming",
  maxScore:10,
  taskContext:"Create a programming solution using the required concepts and constraints in this assessment.",
  evalCriteria:"1. Correct implementation — 5 points\n2. Program behavior — 3 points\n3. Code quality — 2 points"
};

test("external personalization package exports only blueprint context",()=>{
  const value=buildExternalPersonalizationPackage({
    assessment,guidance:"Vary scenario, identifiers and literal values.",count:3
  });
  assert.match(value,/ADMINERVA EXTERNAL PERSONALIZATION PACKAGE/);
  assert.match(value,/requestedVariants/);
  assert.match(value,/Generic personalized programming task/);
  assert.match(value,/"assessmentFormat": "studio_code"/);
  assert.match(value,/"assessmentMode": "personalized"/);
  assert.match(value,/"category": "Mini PETA"/);
  assert.doesNotMatch(value,/"studentId"\s*:|"studentEmail"\s*:|"emailAddress"\s*:/i);
});

test("external personalization response imports distinct generic tasks",async()=>{
  const response={
    format:EXTERNAL_PERSONALIZATION_RESPONSE_FORMAT,
    variants:Array.from({length:3},(_,index)=>({
      prompt:"Implement variant "+(index+1)+" using the common programming concepts while following these individualized identifiers and values in the task statement.",
      evaluationNotes:"Verify the individualized requirements for variant "+(index+1)+" using only the common rubric.",
      summary:"Variant "+(index+1)+" changes the concrete scenario and values."
    }))
  };
  const variants=await parseExternalPersonalizationResponse(JSON.stringify(response),{
    expectedCount:3,
    hashPrompt:async value=>createHash("sha256").update(value).digest("hex")
  });
  assert.equal(variants.length,3);
  assert.equal(new Set(variants.map(item=>item.variantId)).size,3);
});

test("external personalization response rejects duplicate prompts",async()=>{
  const item={
    prompt:"Implement this sufficiently detailed individualized programming task using the common required concepts and exact assigned values.",
    evaluationNotes:"Use the common rubric and check the exact assigned values.",
    summary:"Same duplicate variant."
  };
  await assert.rejects(
    parseExternalPersonalizationResponse(JSON.stringify({
      format:EXTERNAL_PERSONALIZATION_RESPONSE_FORMAT,
      variants:[item,item]
    }),{
      expectedCount:2,
      hashPrompt:async value=>"hash-"+value.slice(0,24)
    }),
    /duplicate learner prompts/
  );
});


test("external personalization supports section-sized batches up to forty-five",()=>{
  const value=buildExternalPersonalizationPackage({
    assessment,guidance:"Keep variants concise and equivalent.",count:45,batchIndex:1,totalBatches:4
  });
  assert.match(value,/"requestedVariants": 45/);
  assert.match(value,/"total": 4/);
  assert.throws(
    ()=>buildExternalPersonalizationPackage({assessment,count:46}),
    /1 to 45 variants/
  );
});
