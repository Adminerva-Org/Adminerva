/** Build and parse teacher-controlled external evaluation handoff packages. */
function text(value,max=12000){return String(value??"").trim().slice(0,max);}
function cleanSha(value){return /^[a-f0-9]{7,64}$/i.test(String(value||""))?String(value):"";}
function compactFile(file={}){
  return {
    path:text(file.path,300),
    primary:Boolean(file.primary),
    studentChanged:Boolean(file.studentChanged),
    binary:Boolean(file.binary),
    text:file.binary?"":String(file.text||"")
  };
}
function compactPatch(patch={}){
  return {
    sha:cleanSha(patch.sha),
    path:text(patch.path,300),
    primary:Boolean(patch.primary),
    substantive:patch.substantive===true,
    diffIncomplete:Boolean(patch.diffIncomplete),
    mergeContext:Boolean(patch.mergeContext),
    kind:text(patch.kind,80),
    patch:String(patch.patch||"")
  };
}
export function buildExternalEvaluationPackage({assessment={},criteria=[],evidence={},contributionScope="",maxScore}={}){
  if(!Array.isArray(criteria)||!criteria.length)throw Error("Assessment rubric is unavailable.");
  const substantive=(evidence.patches||[]).filter(item=>item?.substantive===true).map(item=>({sha:item.sha,path:item.path}));
  const payload={
    format:"adminerva-external-evaluation-v1",
    privacy:"Learner name and account identifiers intentionally omitted.",
    assessment:{
      title:text(assessment.title||assessment.name||"Assessment",300),
      description:text(assessment.description||assessment.instructions||assessment.taskDescription||"",8000),
      rubric:text(assessment.evalCriteria||"",12000),
      maxScore:Number(maxScore)
    },
    rubricCriteria:criteria.map(item=>({name:item.name,maxScore:item.maxScore})),
    verifiedContribution:{
      checkpointSha:cleanSha(evidence.checkpointSha),
      selectedCommits:Array.isArray(evidence.selectedCommits)?evidence.selectedCommits.filter(cleanSha):[],
      contributionScope:text(contributionScope,3000),
      substantiveReferences:substantive,
      patches:Array.isArray(evidence.patches)?evidence.patches.map(compactPatch):[],
      checkpointFiles:Array.isArray(evidence.files)?evidence.files.map(compactFile):[],
      missingPrimaryPaths:Array.isArray(evidence.missingPrimaryPaths)?evidence.missingPrimaryPaths.slice(0,100):[],
      truncatedDiffs:Array.isArray(evidence.truncatedDiffs)?evidence.truncatedDiffs.slice(0,100):[],
      excludedMergeCommits:Array.isArray(evidence.excludedMergeCommits)?evidence.excludedMergeCommits.slice(0,100):[]
    }
  };
  const responseShape={
    criteria:criteria.map(item=>({
      status:"supported | partial | needs_teacher_review",
      score:"number or null",
      pendingPoints:"number",
      confidence:"high | moderate | teacher_confirmation",
      evidence:[{sha:"EXACT_EXPORTED_SHA",path:"EXACT_EXPORTED_PATH"}],
      rationale:"Explain what the verified evidence demonstrates for "+item.name+".",
      reviewAction:"State the teacher check still needed, or an empty string."
    })),
    feedback:"Student-facing feedback grounded only in verified individual evidence.",
    projectObservations:"Optional shared-project context; do not award individual credit from this alone.",
    limitations:"State missing, incomplete, runtime, visual, or other evidence limits."
  };
  return [
    "ADMINERVA EXTERNAL EVALUATION PACKAGE",
    "",
    "TASK",
    "Evaluate this learner's verified individual contribution against the rubric below. Treat the approved checkpoint as project context and the verified commit evidence as the basis for individual credit.",
    "",
    "RULES",
    "1. Do not infer authorship from filenames, commit count, or shared project completeness.",
    "2. Award supported points only when the response cites an exact sha/path pair listed in verifiedContribution.substantiveReferences.",
    "3. If evidence is incomplete, use partial or needs_teacher_review and place unsupported points in pendingPoints.",
    "4. Do not claim compilation, runtime behavior, or exact visual rendering unless the exported evidence demonstrates it.",
    "5. Keep group/project completeness separate from the learner's individual score.",
    "6. Return ONLY valid JSON. Do not wrap it in Markdown or add commentary before or after it.",
    "7. Keep criteria in exactly the same order as rubricCriteria.",
    "",
    "REQUIRED RESPONSE JSON SHAPE",
    JSON.stringify(responseShape,null,2),
    "",
    "EVIDENCE PACKAGE",
    JSON.stringify(payload,null,2)
  ].join("\n");
}
export function parseExternalEvaluationResponse(raw=""){
  let value=String(raw||"").trim();
  if(!value)throw Error("Paste the external evaluation JSON first.");
  value=value.replace(/^\s*```(?:json)?\s*/i,"").replace(/\s*```\s*$/,"").trim();
  const first=value.indexOf("{"),last=value.lastIndexOf("}");
  if(first<0||last<=first)throw Error("The pasted response does not contain a JSON object.");
  let parsed;
  try{parsed=JSON.parse(value.slice(first,last+1));}
  catch{throw Error("The pasted evaluation is not valid JSON. Ask the evaluator to return only the required JSON structure.");}
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw Error("The pasted evaluation must be one JSON object.");
  return parsed;
}
