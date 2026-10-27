/** Adaptive bounded evaluation for large verified student contributions. */
import {generateSchoolContent} from "../../core/school-ai.mjs?v=1.3.0";
import {evaluationJSON} from "./request-backoff.mjs?v=1.3.1";
import {
  buildAdaptiveEvidenceChunks,buildEvidenceChunkPrompt,buildEvidenceChunkResponseSchema,
  buildRubricPrompt,buildRubricResponseSchema,evaluationInputSize,needsAdaptiveEvaluation
} from "./v2-grading-assistant.mjs?v=1.4.25";

async function requestJSON(prompt,schema,{signal,maxOutputTokens=12000}={}){
  const result=await generateSchoolContent({contents:[{parts:[{text:prompt}]}],generationConfig:{
    responseMimeType:"application/json",responseSchema:schema,maxOutputTokens,temperature:0.1
  }},{signal,purpose:"evaluation"});
  return evaluationJSON({ok:true,json:async()=>result});
}

async function summarizeChunk({assessment,criteria,chunk,contributionScope,signal}){
  const parsed=await requestJSON(
    buildEvidenceChunkPrompt({assessment,criteria,chunk,contributionScope}),
    buildEvidenceChunkResponseSchema(),
    {signal,maxOutputTokens:2600}
  );
  const summary=String(parsed?.summary||"").trim().slice(0,5000);
  const signals=Array.isArray(parsed?.rubricSignals)
    ?parsed.rubricSignals.map(value=>String(value||"").trim()).filter(Boolean).slice(0,16)
    :[];
  const limitations=String(parsed?.limitations||"").trim().slice(0,1800);
  const refs=(chunk.refs||[]).map(ref=>
    ref.sha+" "+ref.path+" ["+(ref.substantive?"substantive":ref.diffIncomplete?"partial diff":"context")+"]"
  );
  return [
    "CHUNK "+chunk.index+"/"+chunk.total,
    "VERIFIED REFERENCES:",
    ...(refs.length?refs:["No scoring reference; source/context only."]),
    "SUMMARY: "+(summary||"No additional observation."),
    ...(signals.length?["RUBRIC SIGNALS:",...signals.map(item=>"- "+item)]:[]),
    ...(limitations?["LIMITATIONS: "+limitations]:[])
  ].join("\n");
}

async function summarizeChunks(options,chunks){
  const summaries=new Array(chunks.length);
  const concurrency=2;
  let cursor=0;
  async function worker(){
    while(cursor<chunks.length){
      const index=cursor++;
      options.onProgress?.({stage:"chunk",completed:index,total:chunks.length});
      summaries[index]=await summarizeChunk({...options,chunk:chunks[index]});
      options.onProgress?.({stage:"chunk",completed:index+1,total:chunks.length});
    }
  }
  await Promise.all(Array.from({length:Math.min(concurrency,chunks.length)},()=>worker()));
  return summaries;
}

async function finalRubric({assessment,criteria,evidence,contributionScope,evidenceSummary="",signal,includeImages=false}){
  const prompt=buildRubricPrompt({
    assessment,criteria,checkpointSha:evidence.checkpointSha,
    files:evidence.files,patches:evidence.patches,contributionScope,
    analysis:evidence.analysis,visualAssetsIncluded:includeImages&&Boolean(evidence.assets?.length),
    evidenceSummary
  });
  for(let attempt=0;attempt<2;attempt++){
    const retry=attempt===0?"":"\n\nRETRY FORMAT: Return the same JSON structure, but keep each rationale under 240 characters, each reviewAction under 160 characters, feedback under 800 characters, projectObservations under 500 characters, and limitations under 500 characters. Do not add prose outside JSON.";
    const parts=[{text:prompt+retry}];
    if(includeImages)for(const asset of evidence.assets||[]){
      parts.push({text:"REPOSITORY IMAGE ASSET: "+asset.path+" · student-changed: "+(asset.studentChanged?"yes":"no")});
      parts.push({inlineData:{mimeType:asset.mimeType,data:asset.data}});
    }
    const result=await generateSchoolContent({contents:[{parts}],generationConfig:{
      responseMimeType:"application/json",responseSchema:buildRubricResponseSchema(criteria),
      maxOutputTokens:12000,temperature:0.1
    }},{signal,purpose:"evaluation"});
    try{return await evaluationJSON({ok:true,json:async()=>result});}
    catch(error){
      if(attempt===0&&["invalid-evaluation","evaluation-truncated"].includes(error.code))continue;
      throw error;
    }
  }
  throw Error("Evaluation response could not be parsed.");
}

export async function evaluateVerifiedEvidence({
  assessment,criteria,evidence,contributionScope="",signal,includeImages=false,onProgress=()=>{}
}={}){
  if(!assessment||!Array.isArray(criteria)||!evidence)throw Error("Evaluation inputs are incomplete.");
  const size=evaluationInputSize(evidence);
  if(!needsAdaptiveEvaluation(evidence)){
    onProgress({stage:"final",mode:"single",completed:0,total:1,size});
    const parsed=await finalRubric({assessment,criteria,evidence,contributionScope,signal,includeImages});
    onProgress({stage:"final",mode:"single",completed:1,total:1,size});
    return {parsed,mode:"single",chunkCount:0,size};
  }
  const chunks=buildAdaptiveEvidenceChunks(evidence);
  onProgress({stage:"chunk",mode:"adaptive",completed:0,total:chunks.length,size});
  const summaries=await summarizeChunks({assessment,criteria,contributionScope,signal,onProgress},chunks);
  const evidenceSummary=summaries.join("\n\n=====\n\n").slice(0,90000);
  onProgress({stage:"final",mode:"adaptive",completed:0,total:1,size,chunkCount:chunks.length});
  const parsed=await finalRubric({assessment,criteria,evidence,contributionScope,evidenceSummary,signal,includeImages});
  onProgress({stage:"final",mode:"adaptive",completed:1,total:1,size,chunkCount:chunks.length});
  return {parsed,mode:"adaptive",chunkCount:chunks.length,size};
}
