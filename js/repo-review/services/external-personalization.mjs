/** External AI handoff for generating equivalent personalized assessment variants. */
export const EXTERNAL_PERSONALIZATION_PACKAGE_FORMAT="adminerva-external-personalization-package-v1";
export const EXTERNAL_PERSONALIZATION_RESPONSE_FORMAT="adminerva-external-personalization-response-v1";

const encoder=new TextEncoder();
const bytes=value=>encoder.encode(typeof value==="string"?value:JSON.stringify(value)).length;
const text=(value,max)=>String(value==null?"":value).trim().slice(0,max);

function extractObject(raw){
  let value=String(raw||"").trim();
  if(!value)throw Error("Paste the external personalization JSON first.");
  value=value.replace(/^\s*\`\`\`(?:json)?\s*/i,"").replace(/\s*\`\`\`\s*$/,"").trim();
  const first=value.indexOf("{"),last=value.lastIndexOf("}");
  if(first<0||last<=first)throw Error("The pasted response does not contain a JSON object.");
  try{return JSON.parse(value.slice(first,last+1));}
  catch{throw Error("The pasted personalization response is not valid JSON.");}
}
function cleanVariant(item,index){
  if(!item||typeof item!=="object"||Array.isArray(item))
    throw Error("Variant "+(index+1)+" is malformed.");
  const prompt=text(item.prompt,12000),
    evaluationNotes=text(item.evaluationNotes,8000),
    summary=text(item.summary,300);
  if(prompt.length<80)throw Error("Variant "+(index+1)+" needs a complete learner task prompt.");
  if(!evaluationNotes)throw Error("Variant "+(index+1)+" is missing private evaluation notes.");
  if(!summary)throw Error("Variant "+(index+1)+" is missing a short uniqueness summary.");
  return {prompt,evaluationNotes,summary};
}

export function buildExternalPersonalizationPackage({
  assessment={},guidance="",count=20,existingSummaries=[]
}={}){
  const desired=Number(count);
  if(!Number.isInteger(desired)||desired<10||desired>50)
    throw Error("External personalization supports 10 to 50 variants per pool.");
  const title=text(assessment.title,300),
    taskInstructions=text(assessment.taskContext||assessment.instructions||assessment.description,15000),
    rubric=text(assessment.evalCriteria||assessment.rubric,15000);
  if(!title||!taskInstructions||!rubric)
    throw Error("Save the assessment title, student instructions and published rubric before exporting personalization.");
  const responseShape={
    format:EXTERNAL_PERSONALIZATION_RESPONSE_FORMAT,
    variants:Array.from({length:Math.min(desired,2)},(_,index)=>({
      prompt:"Complete learner-visible programming task variant "+(index+1)+".",
      evaluationNotes:"Private exact requirements or expected behavior for this variant. Do not add grading criteria.",
      summary:"Short description of what concretely differs in this variant."
    }))
  };
  const payload={
    format:EXTERNAL_PERSONALIZATION_PACKAGE_FORMAT,
    privacy:"No learner names, student IDs, emails, submissions or grades are included. This package contains only the teacher-authored assessment blueprint.",
    assessment:{
      title,
      type:text(assessment.type,100),
      subject:text(assessment.subject,200),
      maxScore:Number(assessment.maxScore),
      taskInstructions,
      publishedRubric:rubric
    },
    personalization:{
      requestedVariants:desired,
      teacherVariationGuidance:text(guidance,3000),
      existingSummaries:(Array.isArray(existingSummaries)?existingSummaries:[])
        .map(value=>text(value,300)).filter(Boolean).slice(-40)
    }
  };
  return [
    "ADMINERVA EXTERNAL PERSONALIZATION PACKAGE",
    "",
    "TASK",
    "Generate equivalent individualized programming task variants from the teacher-authored blueprint below.",
    "",
    "REQUIRED RULES",
    "1. Treat the published task instructions and rubric as authoritative.",
    "2. Preserve the programming language/platform, required concepts, scope, difficulty, expected effort and rubric applicability.",
    "3. Vary only concrete problem details that can change without changing the competency: scenario, identifiers, literal values, small datasets, example inputs, required output details or equivalent framing.",
    "4. Do not introduce concepts, frameworks, APIs, libraries, databases, file requirements or restrictions that are absent from or contradict the blueprint.",
    "5. Every variant must be self-contained and gradeable with the SAME published rubric.",
    "6. Do not provide a full solution or finished source code unless starter/solution code is explicitly required by the blueprint.",
    "7. Learner prompts must not mention AI, hidden notes, other learners or other variants.",
    "8. evaluationNotes are private teacher/evaluator notes describing only variant-specific requirements or expected behavior. They must not add new rubric criteria.",
    "9. Generate exactly the requested number of distinct variants. Avoid repeating the supplied existing summaries.",
    "10. Return ONE valid JSON object only. No Markdown fences, commentary, XML or download links.",
    "",
    "REQUIRED RESPONSE JSON SHAPE",
    JSON.stringify(responseShape,null,2),
    "",
    "BLUEPRINT PACKAGE",
    JSON.stringify(payload,null,2)
  ].join("\n");
}

export async function parseExternalPersonalizationResponse(raw,{
  expectedCount,hashPrompt
}={}){
  const parsed=extractObject(raw);
  if(!parsed||parsed.format!==EXTERNAL_PERSONALIZATION_RESPONSE_FORMAT)
    throw Error("The response is not an Adminerva external personalization response.");
  if(!Array.isArray(parsed.variants))
    throw Error("The response must contain a variants array.");
  const count=Number(expectedCount);
  if(!Number.isInteger(count)||count<10||count>50)
    throw Error("The expected variant count is invalid.");
  if(parsed.variants.length!==count)
    throw Error("Expected exactly "+count+" variants but received "+parsed.variants.length+".");
  if(typeof hashPrompt!=="function")throw Error("Variant hashing is unavailable.");
  const seen=new Set(),variants=[];
  for(let index=0;index<parsed.variants.length;index++){
    const clean=cleanVariant(parsed.variants[index],index);
    const variantId=String(await hashPrompt(clean.prompt)).slice(0,24);
    if(seen.has(variantId))throw Error("The external response contains duplicate learner prompts.");
    seen.add(variantId);variants.push({variantId,...clean});
  }
  if(bytes(variants)>700000)
    throw Error("The imported variant pool is too large to store safely. Use shorter prompts or a smaller pool.");
  return variants;
}
