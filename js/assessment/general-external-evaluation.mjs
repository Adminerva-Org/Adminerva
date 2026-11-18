/** General assessment external-evaluation package.
 * Keeps learner identity out of the package and only stages rubric suggestions.
 */
export const GENERAL_EXTERNAL_EVALUATION_FORMAT="adminerva-general-external-evaluation-v1";
export const GENERAL_EXTERNAL_RESPONSE_FORMAT="adminerva-general-external-evaluation-response-v1";

function text(value,max=50000){return String(value??"").trim().slice(0,max);}
function compactTask(task={}){
  return {
    title:text(task.title,300),
    description:text(task.description,5000),
    instructions:text(task.instructions,20000),
    rubric:Array.isArray(task.rubric)?task.rubric.map(row=>({
      name:text(row?.name,200),points:Number(row?.points||0)
    })).filter(row=>row.name&&Number.isFinite(row.points)&&row.points>0):[],
    rubricText:text(task.rubricText,12000),
    maxScore:Number(task.rubricMax??task.maxScore??(Array.isArray(task.rubric)?task.rubric.reduce((sum,row)=>sum+Number(row?.points||0),0):0)),
    submissionSource:text(task.submissionSource,40),
    personalized:task.personalizedTask?.enabled===true
  };
}
function compactExecutionEvidence(snapshot={}){
  const sourceDigest=text(
    snapshot.sourceDigest||
    snapshot.executionEvidence?.sourceDigest||
    snapshot.artifacts?.executionEvidence?.sourceDigest||
    snapshot.artifacts?.sourceDigest,128
  );
  const rawRuns=Array.isArray(snapshot.executionEvidence?.runs)?snapshot.executionEvidence.runs:
    Array.isArray(snapshot.artifacts?.executionEvidence?.runs)?snapshot.artifacts.executionEvidence.runs:
    Array.isArray(snapshot.artifacts?.evidence?.runs)?snapshot.artifacts.evidence.runs:[];
  const runs=rawRuns.slice(0,8).map(run=>{
    const runDigest=text(run?.sourceDigest,128);
    return {
      at:text(run?.at,80),
      mode:text(run?.mode,40),
      engine:text(run?.engine,80),
      entry:text(run?.entry,220),
      status:text(run?.status,120),
      statusId:Number.isFinite(Number(run?.statusId))?Number(run.statusId):null,
      compileSucceeded:typeof run?.compileSucceeded==="boolean"?run.compileSucceeded:null,
      runSucceeded:typeof run?.runSucceeded==="boolean"?run.runSucceeded:null,
      exitCode:Number.isFinite(Number(run?.exitCode))?Number(run.exitCode):null,
      time:Number.isFinite(Number(run?.time))?Number(run.time):null,
      memory:Number.isFinite(Number(run?.memory))?Number(run.memory):null,
      stdout:text(run?.stdout,16000),
      stderr:text(run?.stderr,12000),
      compileOutput:text(run?.compileOutput,12000),
      stdin:text(run?.stdin,6000),
      message:text(run?.message,2000),
      sourceDigest:runDigest,
      matchesSubmittedSource:Boolean(sourceDigest&&runDigest&&sourceDigest===runDigest)
    };
  });
  return {
    submittedSourceDigest:sourceDigest,
    runs,
    matchingRunCount:runs.filter(run=>run.matchesSubmittedSource).length,
    interpretation:"Only runs marked matchesSubmittedSource=true may be used as direct compilation/runtime evidence for this frozen submission. Other runs are historical context only."
  };
}
function compactEvidence(source,snapshot={}){
  if(source==="text")return {
    type:"written_response",
    response:text(snapshot.payload?.response,50000),
    version:Number(snapshot.version||0)
  };
  if(source==="link")return {
    type:"submission_link",
    url:text(snapshot.payload?.url,3000),
    studentNote:text(snapshot.payload?.note,10000),
    version:Number(snapshot.version||0),
    limitation:"The URL and note are frozen in Adminerva, but content hosted at the external URL may change after submission."
  };
  if(source==="studio")return {
    type:"adminerva_studio_snapshot",
    version:Number(snapshot.version||0),
    contentDigest:text(snapshot.contentDigest||snapshot.snapshotHash,128),
    sourceDigest:text(snapshot.sourceDigest,128),
    language:text(snapshot.sourceLanguage||snapshot.language,80),
    files:Array.isArray(snapshot.files)?snapshot.files.slice(0,80).map(file=>({
      path:text(file?.path,300),content:String(file?.content||"").slice(0,60000)
    })):[],
    artifacts:snapshot.artifacts&&typeof snapshot.artifacts==="object"?snapshot.artifacts:{},
    executionEvidence:compactExecutionEvidence(snapshot),
    personalizedTask:snapshot.personalizedTask?{
      variantId:text(snapshot.personalizedTask.variantId,120),
      prompt:text(snapshot.personalizedTask.prompt,12000),
      evaluationNotes:text(snapshot.personalizedTask.evaluationNotes,8000)
    }:null
  };
  if(source==="github")return {
    type:"github_frozen_commit_evidence",
    version:Number(snapshot.version||0),
    checkpointSha:text(snapshot.checkpointSha,40),
    selectedCommitShas:Array.isArray(snapshot.selectedCommitShas)?snapshot.selectedCommitShas.slice(0,100).map(value=>text(value,40)):[],
    commits:Array.isArray(snapshot.commits)?snapshot.commits.slice(0,40).map(commit=>({
      sha:text(commit?.sha,40),
      files:Array.isArray(commit?.files)?commit.files.slice(0,120).map(file=>({
        path:text(file?.path,500),
        status:text(file?.status,40),
        additions:Number(file?.additions||0),
        deletions:Number(file?.deletions||0),
        patch:String(file?.patch||"").slice(0,24000)
      })):[]
    })):[],
    limitations:Array.isArray(snapshot.limitations)?snapshot.limitations.slice(0,20).map(value=>text(value,1000)):[]
  };
  throw Error("This evidence type still uses its specialized evaluation workflow.");
}
export function responseShape(task={}){
  const rubric=Array.isArray(task.rubric)?task.rubric:[];
  return {
    format:GENERAL_EXTERNAL_RESPONSE_FORMAT,
    criteria:rubric.map(row=>({
      name:String(row.name||""),
      maximumPoints:Number(row.points||0),
      awardedPoints:"number",
      pendingPoints:"number",
      comment:"Concise criterion feedback",
      rationale:"Short evidence-based justification",
      confidence:"high | moderate | teacher_confirmation"
    })),
    feedback:"Concise overall student feedback",
    limitations:"Only unresolved evidence or verification limitations"
  };
}
export function buildGeneralExternalEvaluationPackage({task={},snapshot={},checkingInstructions=""}={}){
  const assessment=compactTask(task);
  if(!assessment.rubric.length)throw Error("This assessment has no rubric.");
  const rubricTotal=assessment.rubric.reduce((sum,row)=>sum+Number(row.points||0),0);
  if(!Number.isFinite(assessment.maxScore)||assessment.maxScore<=0||Math.abs(rubricTotal-assessment.maxScore)>0.000001)
    throw Error("The published rubric does not reconcile with the assessment maximum. Fix the rubric before running AI evaluation.");
  if(!["text","link","studio","github"].includes(assessment.submissionSource))
    throw Error("This assessment evidence type is not supported by the shared evaluator.");
  const evidence=compactEvidence(assessment.submissionSource,snapshot);
  if(assessment.submissionSource==="studio"&&assessment.personalized===true&&
     (!evidence.personalizedTask||!text(evidence.personalizedTask.prompt,12000)))
    throw Error("This personalized Studio submission is missing its assigned scenario. Reload the submission until the personalized task is available before running or copying AI evaluation.");
  const payload={
    format:GENERAL_EXTERNAL_EVALUATION_FORMAT,
    privacy:"Learner name, email and account identifiers are intentionally omitted.",
    assessment,
    teacherCheckingInstructions:text(checkingInstructions,8000),
    evidence,
    gradingRules:{
      rubricAuthority:"Use the published rubric exactly. Do not add requirements or reweight criteria.",
      evidenceBoundary:"Award points only for evidence present in this frozen submission package. Runtime claims require source-bound execution evidence with matchesSubmittedSource=true. Put uncertainty in pendingPoints or limitations.",
      teacherAuthority:"This response is only a suggestion. Adminerva must keep it private until the teacher reviews and explicitly saves/publishes.",
      checkingInstructions:"Teacher checking instructions refine interpretation but never override the published rubric maximum or student-visible task requirements.",
      linkBoundary:assessment.submissionSource==="link"?
        "Do not claim facts about linked external content unless the evaluator actually accessed it. The frozen URL/note alone may be insufficient for some criteria.":
        "Evaluate only the frozen content supplied in this package.",
      repositoryBoundary:assessment.submissionSource==="github"?
        "Credit only the supplied frozen selected-commit evidence. Do not infer unshown repository state, runtime behavior, or authorship beyond the supplied patches.":
        "Not applicable."
    }
  };
  return [
    "ADMINERVA GENERAL ASSESSMENT EXTERNAL EVALUATION PACKAGE",
    "",
    "TASK",
    "Evaluate this anonymous learner submission against the published assessment instructions and rubric.",
    "",
    "REQUIRED RULES",
    "1. Keep rubric criteria in exactly the published order and preserve each criterion name exactly.",
    "2. awardedPoints + pendingPoints must never exceed the criterion maximum.",
    "3. Use pendingPoints only for genuinely unresolved evidence; confirmed deficiencies are unearned points, not pending credit.",
    "4. Inspect every supplied file relevant to each criterion. Base comments and rationales on concrete file/class/method evidence, not keyword presence alone.",
    "5. For code submissions, distinguish static evidence from runtime evidence. Treat compilation/output as evidence for the submitted version only when executionEvidence contains a run with matchesSubmittedSource=true. A historical or unmatched run does not prove the frozen submission compiles or runs. Obvious compile blockers visible in the frozen files are confirmed deficiencies, not pending uncertainty.",
    "6. Requirements that are not separate rubric criteria may inform whether a published criterion is functional or meaningful, but never create extra point categories or change criterion weights.",
    "7. Do not infer authorship, plagiarism, misconduct, or AI use from coding style or identifiers.",
    "8. Return only one valid JSON object matching REQUIRED RESPONSE JSON. No Markdown fences or surrounding commentary.",
    "9. The result remains a teacher draft until explicitly published in Adminerva.",
    "",
    "REQUIRED RESPONSE JSON",
    JSON.stringify(responseShape(task),null,2),
    "",
    "ASSESSMENT AND FROZEN EVIDENCE",
    JSON.stringify(payload,null,2)
  ].join("\n");
}
function extractJson(raw){
  let value=String(raw||"").replace(/^\uFEFF/,"").trim();
  value=value.replace(/^\s*```(?:json)?\s*/i,"").replace(/\s*```\s*$/,"").trim();
  const first=value.indexOf("{"),last=value.lastIndexOf("}");
  if(first<0||last<=first)throw Error("The pasted response does not contain a JSON object.");
  try{return JSON.parse(value.slice(first,last+1));}
  catch{throw Error("The pasted external evaluation is not valid JSON.");}
}
export function parseGeneralExternalEvaluationResponse(raw,{task={}}={}){
  const parsed=extractJson(raw);
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)||
     parsed.format!==GENERAL_EXTERNAL_RESPONSE_FORMAT)
    throw Error("The response is not an Adminerva general assessment evaluation.");
  const rubric=Array.isArray(task.rubric)?task.rubric:[];
  if(!Array.isArray(parsed.criteria)||parsed.criteria.length!==rubric.length)
    throw Error("The response must include one result for every rubric criterion.");
  const allowedConfidence=new Set(["high","moderate","teacher_confirmation"]);
  const criteria=parsed.criteria.map((item,index)=>{
    const expectedName=String(rubric[index]?.name||"");
    const returnedName=String(item?.name||"");
    const maximum=Number(rubric[index]?.points||0);
    const declaredMaximum=item?.maximumPoints===undefined?maximum:Number(item.maximumPoints);
    const awarded=Number(item?.awardedPoints),pending=Number(item?.pendingPoints||0);
    const comment=text(item?.comment,1000),rationale=text(item?.rationale,1500);
    const confidence=text(item?.confidence,40);
    if(returnedName!==expectedName)
      throw Error("Criterion "+(index+1)+" does not match the published rubric name/order.");
    if(!Number.isFinite(declaredMaximum)||Math.abs(declaredMaximum-maximum)>0.000001)
      throw Error("Criterion "+(index+1)+" does not match the published maximum.");
    if(!Number.isFinite(awarded)||!Number.isFinite(pending)||awarded<0||pending<0||
       awarded+pending>maximum+0.000001)
      throw Error("Criterion "+(index+1)+" has invalid points.");
    if(!comment||!rationale)throw Error("Criterion "+(index+1)+" must include evidence-based comment and rationale.");
    if(!allowedConfidence.has(confidence))throw Error("Criterion "+(index+1)+" has an invalid confidence value.");
    return {awardedPoints:awarded,pendingPoints:pending,comment,rationale,confidence};
  });
  const feedback=text(parsed.feedback,5000),limitations=text(parsed.limitations,3000);
  if(!feedback)throw Error("The external evaluation must include overall feedback.");
  return {criteria,feedback,limitations};
}
