/** External AI handoff for generating equivalent personalized assessment variants. */
export const EXTERNAL_PERSONALIZATION_PACKAGE_FORMAT="adminerva-external-personalization-package-v2";
export const EXTERNAL_PERSONALIZATION_RESPONSE_FORMAT="adminerva-external-personalization-response-v2";
const LEGACY_EXTERNAL_PERSONALIZATION_RESPONSE_FORMAT="adminerva-external-personalization-response-v1";

const encoder=new TextEncoder();
const bytes=value=>encoder.encode(typeof value==="string"?value:JSON.stringify(value)).length;
const text=(value,max)=>String(value==null?"":value).trim().slice(0,max);

function normalizeScenarioKey(value){
  return String(value||"")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase().replace(/[^a-z0-9]+/g,"_")
    .replace(/^_+|_+$/g,"").replace(/_+/g,"_").slice(0,80);
}
function normalizeScenarioTitle(value){
  return String(value||"")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase().replace(/[^a-z0-9]+/g," ")
    .trim().replace(/\s+/g," ").slice(0,140);
}
function cleanRegistryEntry(item,index){
  if(typeof item==="string"){
    const summary=text(item,220);
    if(!summary)return null;
    return {scenarioKey:"legacy_"+normalizeScenarioKey(summary).slice(0,70),scenarioTitle:text(summary,120),summary};
  }
  if(!item||typeof item!=="object"||Array.isArray(item))return null;
  const scenarioTitle=text(item.scenarioTitle||item.title||item.summary,120),
    summary=text(item.summary||item.scenarioSummary,220),
    scenarioKey=normalizeScenarioKey(item.scenarioKey||scenarioTitle||summary);
  if(!scenarioKey||!scenarioTitle||!summary)return null;
  return {scenarioKey,scenarioTitle,summary};
}
function cleanExistingRegistry(values=[]){
  const entries=[],seenKeys=new Set(),seenTitles=new Set();
  for(const [index,value] of (Array.isArray(values)?values:[]).entries()){
    const item=cleanRegistryEntry(value,index);
    if(!item)continue;
    const titleKey=normalizeScenarioTitle(item.scenarioTitle);
    if(seenKeys.has(item.scenarioKey)||seenTitles.has(titleKey))continue;
    seenKeys.add(item.scenarioKey);seenTitles.add(titleKey);entries.push(item);
    if(entries.length>=600)break;
  }
  return entries;
}
function normalizePastedJsonTransport(raw){
  return String(raw||"")
    .replace(/^\uFEFF/,"")
    .replace(/\\\r?\n/g,"\n")
    .replace(/^(?:(?:&#x20;|&#32;|&nbsp;))+/gmi,match=>{
      const count=(match.match(/&#x20;|&#32;|&nbsp;/gi)||[]).length;
      return " ".repeat(Math.max(1,count));
    });
}
function extractObject(raw){
  let value=normalizePastedJsonTransport(raw).trim();
  if(!value)throw Error("Paste the external personalization JSON first.");
  value=value.replace(/^\s*\`\`\`(?:json)?\s*/i,"").replace(/\s*\`\`\`\s*$/,"").trim();
  const first=value.indexOf("{"),last=value.lastIndexOf("}");
  if(first<0||last<=first)throw Error("The pasted response does not contain a JSON object.");
  try{return JSON.parse(value.slice(first,last+1));}
  catch{throw Error("The pasted personalization response is not valid JSON. Paste the response into Assessment Studio → Personalization → External response JSON, then click Import external variants.");}
}
function cleanVariant(item,index,{legacy=false}={}){
  if(!item||typeof item!=="object"||Array.isArray(item))
    throw Error("Variant "+(index+1)+" is malformed.");
  const prompt=text(item.prompt,12000),
    evaluationNotes=text(item.evaluationNotes,8000),
    summary=text(item.summary,300),
    scenarioTitle=text(item.scenarioTitle||item.title||(legacy?summary:""),120),
    scenarioKey=normalizeScenarioKey(item.scenarioKey||(legacy?scenarioTitle:""));
  if(prompt.length<80)throw Error("Variant "+(index+1)+" needs a complete learner task prompt.");
  if(!evaluationNotes)throw Error("Variant "+(index+1)+" is missing private evaluation notes.");
  if(!summary)throw Error("Variant "+(index+1)+" is missing a short uniqueness summary.");
  if(!scenarioTitle)throw Error("Variant "+(index+1)+" is missing scenarioTitle.");
  if(!scenarioKey||scenarioKey.length<3)throw Error("Variant "+(index+1)+" is missing a valid scenarioKey.");
  return {scenarioKey,scenarioTitle,prompt,evaluationNotes,summary};
}

export function buildExternalPersonalizationPackage({
  assessment={},guidance="",count=20,existingScenarios=[],existingSummaries=[],batchIndex=1,totalBatches=1
}={}){
  const desired=Number(count);
  if(!Number.isInteger(desired)||desired<1||desired>45)
    throw Error("External personalization supports batches of 1 to 45 variants.");
  const title=text(assessment.title,300),
    taskInstructions=text(assessment.taskContext||assessment.instructions||assessment.description,15000),
    rubric=text(assessment.evalCriteria||assessment.rubric,15000);
  if(!title||!taskInstructions||!rubric)
    throw Error("Save the assessment title, student instructions and published rubric before exporting personalization.");
  const registry=cleanExistingRegistry(
    Array.isArray(existingScenarios)&&existingScenarios.length?existingScenarios:existingSummaries
  );
  const responseShape={
    format:EXTERNAL_PERSONALIZATION_RESPONSE_FORMAT,
    variants:Array.from({length:Math.min(desired,2)},(_,index)=>({
      scenarioKey:index===0?"library_borrowing_management":"vehicle_service_management",
      scenarioTitle:index===0?"Library Borrowing Management":"Vehicle Service Management",
      prompt:"Complete learner-visible assessment task variant "+(index+1)+".",
      evaluationNotes:"Private exact requirements or expected behavior for this variant. Do not add grading criteria.",
      summary:"One-line description of the scenario domain, main entities and required operations."
    }))
  };
  const payload={
    format:EXTERNAL_PERSONALIZATION_PACKAGE_FORMAT,
    privacy:"No learner names, student IDs, emails, submissions or grades are included. This package contains only the teacher-authored assessment blueprint and a private registry of already-generated scenario summaries.",
    assessment:{
      title,
      category:text(assessment.type||assessment.category,100),
      assessmentFormat:text(assessment.assessmentFormat,100),
      assessmentMode:text(assessment.assessmentMode||"personalized",100),
      subject:text(assessment.subject,200),
      maxScore:Number(assessment.maxScore),
      taskInstructions,
      publishedRubric:rubric
    },
    personalization:{
      requestedVariants:desired,
      batch:{index:Number(batchIndex)||1,total:Number(totalBatches)||1},
      teacherVariationGuidance:text(guidance,3000),
      existingScenarioRegistry:registry
    }
  };
  return [
    "ADMINERVA EXTERNAL PERSONALIZATION PACKAGE",
    "",
    "TASK",
    "Generate equivalent individualized assessment task variants from the teacher-authored blueprint below.",
    "",
    "REQUIRED RULES",
    "1. Treat the published task instructions and rubric as authoritative.",
    "2. Preserve the assessment format, required concepts/skills, platform where applicable, scope, difficulty, expected effort and rubric applicability.",
    "3. Vary only concrete details that can change without changing the competency. For coding tasks this may include scenario/domain, identifiers, literal values, small datasets, example inputs, required output details or equivalent framing.",
    "4. Do not introduce concepts, frameworks, tools, libraries, source requirements or restrictions that are absent from or contradict the blueprint.",
    "5. Every variant must be self-contained and gradeable with the SAME published rubric.",
    "6. Do not provide a full solution or finished source code unless starter/solution code is explicitly required by the blueprint.",
    "7. Learner prompts must not mention AI, hidden notes, other learners or other variants.",
    "8. evaluationNotes are private teacher/evaluator notes describing only variant-specific requirements or expected behavior. They must not add new rubric criteria.",
    "9. Generate exactly the requested number of distinct variants for this batch.",
    "10. Every variant MUST include scenarioKey, scenarioTitle and summary. scenarioKey must be a stable lowercase snake_case description of the core domain and task, not a random ID.",
    "11. Treat existingScenarioRegistry as a DO-NOT-REUSE registry. Do not reuse the same core domain/task, an obvious synonym, a lightly renamed version, or a scenario with substantially overlapping main entities and operations.",
    "12. Within this batch, scenarioKey and scenarioTitle must also be unique. Technical competencies may remain identical because the rubric is shared; the concrete scenario/domain and operations should differ.",
    "13. Keep each learner prompt concise enough for batch generation while preserving all required task details. Prefer about 1,600 characters or less per prompt and about 600 characters or less for evaluationNotes when the blueprint allows it.",
    "14. Return ONE valid JSON object only. No Markdown fences, commentary, XML or download links.",
    "",
    "REQUIRED RESPONSE JSON SHAPE",
    JSON.stringify(responseShape,null,2),
    "",
    "BLUEPRINT PACKAGE",
    JSON.stringify(payload,null,2)
  ].join("\n");
}

export async function parseExternalPersonalizationResponse(raw,{
  expectedCount,hashPrompt,existingScenarios=[]
}={}){
  const parsed=extractObject(raw);
  const legacy=parsed?.format===LEGACY_EXTERNAL_PERSONALIZATION_RESPONSE_FORMAT;
  if(typeof parsed?.format==="string"&&parsed.format.includes("external-evaluation"))
    throw Error("This is an external evaluation response, not a personalization response. Use the evaluation import workflow for grading.");
  if(!parsed||(!legacy&&parsed.format!==EXTERNAL_PERSONALIZATION_RESPONSE_FORMAT))
    throw Error("The response is not an Adminerva external personalization response.");
  if(!Array.isArray(parsed.variants))
    throw Error("The response must contain a variants array.");
  const count=Number(expectedCount);
  if(!Number.isInteger(count)||count<1||count>45)
    throw Error("The expected external variant count is invalid.");
  if(parsed.variants.length!==count)
    throw Error("Expected exactly "+count+" variants but received "+parsed.variants.length+".");
  if(typeof hashPrompt!=="function")throw Error("Variant hashing is unavailable.");

  const registry=cleanExistingRegistry(existingScenarios),
    existingKeys=new Set(registry.map(item=>item.scenarioKey)),
    existingTitles=new Set(registry.map(item=>normalizeScenarioTitle(item.scenarioTitle))),
    seenPromptIds=new Set(),seenScenarioKeys=new Set(),seenScenarioTitles=new Set(),variants=[];

  for(let index=0;index<parsed.variants.length;index++){
    const clean=cleanVariant(parsed.variants[index],index,{legacy});
    const normalizedTitle=normalizeScenarioTitle(clean.scenarioTitle);
    if(existingKeys.has(clean.scenarioKey))
      throw Error("Variant "+(index+1)+" reuses an existing scenarioKey: "+clean.scenarioKey+".");
    if(existingTitles.has(normalizedTitle))
      throw Error("Variant "+(index+1)+" reuses an existing scenario title: "+clean.scenarioTitle+".");
    if(seenScenarioKeys.has(clean.scenarioKey))
      throw Error("The external response contains duplicate scenario keys.");
    if(seenScenarioTitles.has(normalizedTitle))
      throw Error("The external response contains duplicate scenario titles.");
    seenScenarioKeys.add(clean.scenarioKey);seenScenarioTitles.add(normalizedTitle);

    const variantId=String(await hashPrompt(clean.prompt)).slice(0,24);
    if(seenPromptIds.has(variantId))throw Error("The external response contains duplicate learner prompts.");
    seenPromptIds.add(variantId);variants.push({variantId,...clean});
  }
  if(bytes(variants)>700000)
    throw Error("The imported variant pool is too large to store safely. Use shorter prompts or a smaller pool.");
  return variants;
}
