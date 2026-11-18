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
    maxScore:Number(task.rubricMax||0),
    submissionSource:text(task.submissionSource,40),
    personalized:task.personalizedTask?.enabled===true
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
    language:text(snapshot.sourceLanguage,80),
    files:Array.isArray(snapshot.files)?snapshot.files.slice(0,80).map(file=>({
      path:text(file?.path,300),content:String(file?.content||"").slice(0,60000)
    })):[],
    artifacts:snapshot.artifacts&&typeof snapshot.artifacts==="object"?snapshot.artifacts:{},
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
  if(!["text","link","studio","github"].includes(assessment.submissionSource))
    throw Error("This assessment evidence type is not supported by the shared evaluator.");
  const payload={
    format:GENERAL_EXTERNAL_EVALUATION_FORMAT,
    privacy:"Learner name, email and account identifiers are intentionally omitted.",
    assessment,
    teacherCheckingInstructions:text(checkingInstructions,8000),
    evidence:compactEvidence(assessment.submissionSource,snapshot),
    gradingRules:{
      rubricAuthority:"Use the published rubric exactly. Do not add requirements or reweight criteria.",
      evidenceBoundary:"Award points only for evidence present in this frozen submission package. Put uncertainty in pendingPoints or limitations.",
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
    "1. Keep rubric criteria in exactly the published order.",
    "2. awardedPoints + pendingPoints must never exceed the criterion maximum.",
    "3. Use pendingPoints only for genuinely unresolved evidence; confirmed deficiencies are unearned points, not pending credit.",
    "4. Return only one valid JSON object matching REQUIRED RESPONSE JSON. No Markdown fences or surrounding commentary.",
    "5. The result remains a teacher draft until explicitly published in Adminerva.",
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
  const criteria=parsed.criteria.map((item,index)=>{
    const maximum=Number(rubric[index]?.points||0);
    const awarded=Number(item?.awardedPoints),pending=Number(item?.pendingPoints||0);
    if(!Number.isFinite(awarded)||!Number.isFinite(pending)||awarded<0||pending<0||
       awarded+pending>maximum+0.000001)
      throw Error("Criterion "+(index+1)+" has invalid points.");
    return {
      awardedPoints:awarded,pendingPoints:pending,
      comment:text(item?.comment||item?.rationale,1000)
    };
  });
  return {
    criteria,
    feedback:text(parsed.feedback,5000),
    limitations:text(parsed.limitations,3000)
  };
}
