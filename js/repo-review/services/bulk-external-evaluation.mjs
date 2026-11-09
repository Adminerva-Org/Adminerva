/** Privacy-preserving batch handoff for externally evaluated V2 evidence. */
export const BULK_EXTERNAL_RESPONSE_FORMAT="adminerva-bulk-external-evaluation-v1";
export const BULK_EXTERNAL_PACKAGE_FORMAT="adminerva-bulk-external-evaluation-package-v1";
const encoder=new TextEncoder();
const bytes=value=>encoder.encode(typeof value==="string"?value:JSON.stringify(value)).length;

function cleanId(value,max=120){
  const id=String(value||"").trim();
  if(!id||id.length>max||!/^[A-Za-z0-9._:-]+$/.test(id))throw Error("Invalid bulk external evaluation identifier.");
  return id;
}
function extractObject(raw){
  let value=String(raw||"").trim();
  if(!value)throw Error("Paste the bulk external evaluation JSON first.");
  value=value.replace(/^\s*```(?:json)?\s*/i,"").replace(/\s*```\s*$/,"").trim();
  const first=value.indexOf("{"),last=value.lastIndexOf("}");
  if(first<0||last<=first)throw Error("The pasted bulk response does not contain a JSON object.");
  try{return JSON.parse(value.slice(first,last+1));}
  catch{throw Error("The pasted bulk evaluation is not valid JSON. Ask the evaluator to return only the required JSON object.");}
}
export function partitionBulkExternalEntries(entries,{sessionId,targetBytes=240000,maxEntries=8}={}){
  if(!Array.isArray(entries)||!entries.length)return [];
  const session=cleanId(sessionId||("bulk-"+Date.now()));
  const limit=Math.max(60000,Math.min(Number(targetBytes)||240000,700000));
  const countLimit=Math.max(1,Math.min(Number(maxEntries)||8,20));
  const batches=[];let current=[],size=0,batchIndex=1;
  const flush=()=>{
    if(!current.length)return;
    batches.push({batchId:session+"-b"+batchIndex,entries:current,estimatedBytes:size});
    batchIndex++;current=[];size=0;
  };
  entries.forEach((entry,index)=>{
    if(!entry||typeof entry.payload!=="object")throw Error("Bulk external entry is missing its evidence payload.");
    const normalized={...entry,entryId:cleanId(entry.entryId||("candidate-"+String(index+1).padStart(3,"0")))};
    const entryBytes=bytes({entryId:normalized.entryId,evidencePackage:normalized.payload})+512;
    if(current.length&&(current.length>=countLimit||size+entryBytes>limit))flush();
    current.push(normalized);size+=entryBytes;
    if(entryBytes>limit)flush();
  });
  flush();return batches;
}
export function buildBulkExternalEvaluationPackage({batchId,entries,responseShape}={}){
  const id=cleanId(batchId);
  if(!Array.isArray(entries)||!entries.length)throw Error("This external evaluation batch is empty.");
  if(!responseShape||typeof responseShape!=="object")throw Error("The external evaluation response schema is unavailable.");
  const resultExample={entryId:entries[0].entryId,...responseShape};
  const envelope={
    format:BULK_EXTERNAL_PACKAGE_FORMAT,
    batchId:id,
    privacy:"Entries use anonymous batch identifiers. Learner names, emails, student IDs and GitHub usernames are intentionally omitted.",
    entries:entries.map(entry=>({entryId:cleanId(entry.entryId),evidencePackage:entry.payload}))
  };
  return [
    "ADMINERVA BULK EXTERNAL EVALUATION PACKAGE",
    "",
    "TASK",
    "Evaluate every entry independently. Each evidencePackage contains the published assessment, rubric, teacher grading instructions, and instructor-verified individual evidence for one anonymous learner.",
    "",
    "BULK RULES",
    "1. Never transfer evidence, accomplishments, deductions, or observations between entries.",
    "2. For every entry, follow its evaluationGuidance and rubricCriteria exactly.",
    "3. Award individual points only from that entry's verified substantive SHA/path evidence.",
    "4. Preserve criterion order and maximum points exactly.",
    "5. Return one result for every entryId. Do not rename, omit, merge, or duplicate entry IDs.",
    "6. Return a SINGLE valid JSON object only. No Markdown fences, commentary, XML, or download links.",
    "",
    "REQUIRED RESPONSE JSON SHAPE",
    JSON.stringify({
      format:BULK_EXTERNAL_RESPONSE_FORMAT,
      batchId:id,
      results:[resultExample]
    },null,2),
    "",
    "BATCH EVIDENCE",
    JSON.stringify(envelope,null,2)
  ].join("\n");
}
export function parseBulkExternalEvaluationResponse(raw,{batchId,entryIds=[]}={}){
  const parsed=extractObject(raw);
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw Error("The bulk evaluation response must be one JSON object.");
  if(parsed.format!==BULK_EXTERNAL_RESPONSE_FORMAT)throw Error("The response format is not an Adminerva bulk external evaluation.");
  const expectedBatch=cleanId(batchId);
  if(parsed.batchId!==expectedBatch)throw Error("The response belongs to a different external evaluation batch.");
  if(!Array.isArray(parsed.results))throw Error("The bulk response must contain a results array.");
  const expected=new Set(entryIds.map(cleanId)),results=new Map(),issues=[];
  for(const item of parsed.results){
    if(!item||typeof item!=="object"||Array.isArray(item)){issues.push("Ignored a malformed result entry.");continue;}
    let id;
    try{id=cleanId(item.entryId);}catch{issues.push("Ignored a result with an invalid entryId.");continue;}
    if(!expected.has(id)){issues.push("Ignored unknown entry "+id+".");continue;}
    if(results.has(id)){issues.push("Duplicate result for "+id+" was ignored.");continue;}
    const evaluation={...item};delete evaluation.entryId;results.set(id,evaluation);
  }
  for(const id of expected)if(!results.has(id))issues.push("No result returned for "+id+".");
  return {results,issues};
}
