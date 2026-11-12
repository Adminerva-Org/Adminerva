import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {
  buildExternalPersonalizationPackage,
  parseExternalPersonalizationResponse,
  EXTERNAL_PERSONALIZATION_RESPONSE_FORMAT
} from "../js/repo-review/services/external-personalization.mjs";
import {parseExternalEvaluationResponse} from "../js/repo-review/services/external-evaluation.mjs";

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
const hashPrompt=async value=>createHash("sha256").update(value).digest("hex");
const variant=(key,title,index,prompt)=>({
  scenarioKey:key,
  scenarioTitle:title,
  prompt:prompt||"Implement "+title+" variant "+index+" using the common programming concepts while following the individualized entities, operations, identifiers and values in this task statement.",
  evaluationNotes:"Verify the individualized requirements for "+title+" using only the common rubric.",
  summary:title+" uses distinct domain entities and operations for variant "+index+"."
});

test("external personalization package exports blueprint context without learner identity",()=>{
  const value=buildExternalPersonalizationPackage({
    assessment,guidance:"Vary scenario, identifiers and literal values.",count:3
  });
  assert.match(value,/ADMINERVA EXTERNAL PERSONALIZATION PACKAGE/);
  assert.match(value,/requestedVariants/);
  assert.match(value,/Generic personalized programming task/);
  assert.match(value,/"assessmentFormat": "studio_code"/);
  assert.match(value,/"assessmentMode": "personalized"/);
  assert.match(value,/"category": "Mini PETA"/);
  assert.match(value,/"scenarioKey"/);
  assert.doesNotMatch(value,/"studentId"\s*:|"studentEmail"\s*:|"emailAddress"\s*:/i);
});

test("external package carries the full prior scenario registry into later batches",()=>{
  const existingScenarios=[
    {scenarioKey:"library_borrowing",scenarioTitle:"Library Borrowing",summary:"Books and members borrow and return items."},
    {scenarioKey:"vehicle_rental",scenarioTitle:"Vehicle Rental",summary:"Customers rent and return vehicles."},
    {scenarioKey:"clinic_booking",scenarioTitle:"Clinic Booking",summary:"Patients schedule and cancel appointments."}
  ];
  const value=buildExternalPersonalizationPackage({
    assessment,count:2,batchIndex:2,totalBatches:4,existingScenarios
  });
  for(const item of existingScenarios){
    assert.match(value,new RegExp(item.scenarioKey));
    assert.match(value,new RegExp(item.scenarioTitle));
  }
  assert.match(value,/DO-NOT-REUSE registry/);
  assert.match(value,/obvious synonym/);
});

test("external personalization response imports distinct scenario identities",async()=>{
  const response={
    format:EXTERNAL_PERSONALIZATION_RESPONSE_FORMAT,
    variants:[
      variant("library_borrowing","Library Borrowing",1),
      variant("vehicle_service","Vehicle Service",2),
      variant("event_ticketing","Event Ticketing",3)
    ]
  };
  const variants=await parseExternalPersonalizationResponse(JSON.stringify(response),{
    expectedCount:3,hashPrompt
  });
  assert.equal(variants.length,3);
  assert.equal(new Set(variants.map(item=>item.variantId)).size,3);
  assert.equal(new Set(variants.map(item=>item.scenarioKey)).size,3);
});

test("external personalization rejects a scenario key already used in a prior batch",async()=>{
  const response={
    format:EXTERNAL_PERSONALIZATION_RESPONSE_FORMAT,
    variants:[variant("library_borrowing","New Library Workflow",1)]
  };
  await assert.rejects(
    parseExternalPersonalizationResponse(JSON.stringify(response),{
      expectedCount:1,hashPrompt,
      existingScenarios:[{
        scenarioKey:"library_borrowing",
        scenarioTitle:"Library Borrowing",
        summary:"Books and members borrow and return items."
      }]
    }),
    /reuses an existing scenarioKey/
  );
});

test("external personalization rejects an existing scenario title even with a changed key",async()=>{
  const response={
    format:EXTERNAL_PERSONALIZATION_RESPONSE_FORMAT,
    variants:[variant("library_checkout_system","Library Borrowing",1)]
  };
  await assert.rejects(
    parseExternalPersonalizationResponse(JSON.stringify(response),{
      expectedCount:1,hashPrompt,
      existingScenarios:[{
        scenarioKey:"library_borrowing",
        scenarioTitle:"Library Borrowing",
        summary:"Books and members borrow and return items."
      }]
    }),
    /reuses an existing scenario title/
  );
});

test("external personalization response rejects duplicate scenario keys inside one batch",async()=>{
  const response={
    format:EXTERNAL_PERSONALIZATION_RESPONSE_FORMAT,
    variants:[
      variant("vehicle_rental","Vehicle Rental",1),
      variant("vehicle_rental","Transport Hire",2)
    ]
  };
  await assert.rejects(
    parseExternalPersonalizationResponse(JSON.stringify(response),{
      expectedCount:2,hashPrompt
    }),
    /duplicate scenario keys/
  );
});

test("external personalization response rejects duplicate prompts even with different scenario metadata",async()=>{
  const prompt="Implement this sufficiently detailed individualized programming task using the common required concepts and exact assigned values while completing two meaningful scenario operations.";
  const response={
    format:EXTERNAL_PERSONALIZATION_RESPONSE_FORMAT,
    variants:[
      variant("library_borrowing","Library Borrowing",1,prompt),
      variant("vehicle_rental","Vehicle Rental",2,prompt)
    ]
  };
  await assert.rejects(
    parseExternalPersonalizationResponse(JSON.stringify(response),{
      expectedCount:2,hashPrompt
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


test("personalization importer normalizes escaped paste transport artifacts",async()=>{
  const response={
    format:EXTERNAL_PERSONALIZATION_RESPONSE_FORMAT,
    variants:[variant("network_cable_certification","Network Cable Certification",1)]
  };
  const escaped=JSON.stringify(response,null,1)
    .split("\n")
    .map((line,index)=>(index? "&#x20;"+line : line)+"\\")
    .join("\n")
    .replace(/\\$/,"");
  const variants=await parseExternalPersonalizationResponse(escaped,{
    expectedCount:1,hashPrompt
  });
  assert.equal(variants.length,1);
  assert.equal(variants[0].scenarioKey,"network_cable_certification");
});

test("evaluation importer gives a specific message for personalization responses",()=>{
  const response={
    format:EXTERNAL_PERSONALIZATION_RESPONSE_FORMAT,
    variants:[variant("network_cable_certification","Network Cable Certification",1)]
  };
  assert.throws(
    ()=>parseExternalEvaluationResponse(JSON.stringify(response)),
    /personalization response, not an evaluation response/
  );
});
