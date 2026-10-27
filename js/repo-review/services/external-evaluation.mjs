import {responsibilityBasis,isAndroidUiAssessment} from "./android-evidence.mjs?v=1.3.0";
/** Build and parse teacher-controlled external evaluation handoff packages. */
function text(value,max=12000){return String(value??"").trim().slice(0,max);}
function cleanSha(value){return /^[a-f0-9]{7,64}$/i.test(String(value||""))?String(value):"";}
function compactFile(file={}){
  return {
    path:text(file.path,300),
    primary:Boolean(file.primary),
    studentChanged:Boolean(file.studentChanged),
    binary:Boolean(file.binary),
    historical:Boolean(file.historical),
    sourceSha:cleanSha(file.sourceSha),
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
export function buildExternalEvaluationPackage({assessment={},criteria=[],evidence={},contributionScope="",maxScore,privateAssessment={}}={}){
  if(!Array.isArray(criteria)||!criteria.length)throw Error("Assessment rubric is unavailable.");
  const substantive=(evidence.patches||[])
    .filter(item=>item?.substantive===true&&!item?.mergeContext&&cleanSha(item.sha)&&text(item.path,300))
    .map(item=>({sha:item.sha,path:item.path}));
  const instructions=text(assessment.taskContext||assessment.instructions||assessment.description||assessment.taskDescription||"",12000);
  const assessmentRubric=text(assessment.evalCriteria||"",15000);
  const individualScope=responsibilityBasis({assessment,contributionScope,patches:evidence.patches||[]});
  const teacherRules=Array.isArray(privateAssessment.rules)
    ?privateAssessment.rules.slice(0,40).filter(item=>item&&typeof item==="object")
      .map(item=>({type:text(item.type,80),value:text(item.value,1600)}))
    :[];
  const androidUi=isAndroidUiAssessment(assessment);
  const payload={
    format:"adminerva-external-evaluation-v1",
    privacy:"Learner name and account identifiers intentionally omitted. Review teacher-only instructions and source evidence before sharing externally.",
    assessment:{
      title:text(assessment.title||assessment.name||"Assessment",300),
      subject:text(assessment.subject,200),
      type:text(assessment.type,100),
      description:instructions,
      taskInstructions:instructions,
      rubric:assessmentRubric,
      maxScore:Number(maxScore),
      expectedExtensions:Array.isArray(assessment.expectedExtensions)?assessment.expectedExtensions.map(value=>text(value,20)).filter(Boolean):[],
      targetPaths:Array.isArray(assessment.targetPaths)?assessment.targetPaths.map(value=>text(value,300)).filter(Boolean):assessment.targetPath?[text(assessment.targetPath,300)]:[],
      gradingMode:text(assessment.gradingMode||"individual",80)
    },
    teacherGradingInstructions:{
      assessmentSpecificCheckerInstructions:text(privateAssessment.systemPersona||assessment.systemPersona||"",4000),
      assessmentSpecificRules:teacherRules,
      individualResponsibilityBasis:text(individualScope,4000),
      interpretation:"Teacher-authored instructions refine the published task and rubric; they do not override score limits, verified authorship requirements, or the teacher approval process."
    },
    evaluationGuidance:{
      rubricAlignment:"Evaluate each criterion against the published rubric and task instructions, including stated exclusions. Do not silently reweight criteria or add backend requirements when this is a UI-only prototype.",
      individualVsGroup:androidUi
        ?"For this Android XML UI assessment, each learner is responsible for at least one individually assigned screen. A verified substantive XML layout represents their assigned screen contribution when no more specific responsibility note exists. Do not deduct individual points solely because teammate screens or whole-project features are missing. Discuss shared completeness separately."
        :"Only verified individual work earns individual points. Evaluate team deliverables separately; use teacher-confirmed individual responsibilities to interpret the rubric.",
      evidenceStandard:"Award supported points only for actual verified substantive SHA/path pairs exported below. Merge context, missing diffs and shared checkpoint files alone cannot prove individual authorship. A selected historical commit SHA need not equal the approved checkpoint SHA. Source marked historical was recovered from a verified commit because the file is absent from the later checkpoint; it is context only, not an individually attributable extra change. If no source survives, use the verified substantive diff without inferring absent work.",
      partialScoring:"Award defensible points now. Use partial only for genuinely unresolved criteria and put only plausible unverified points in pendingPoints. A confirmed rubric deficiency is a deduction, not pending credit. Use needs_teacher_review and a null score only when no points can be supported in that criterion. Never treat missing evidence automatically as zero.",
      technicalClaims:"Distinguish directly identifiable code defects from suspected runtime or visual problems. Do not assert compilation, navigation, runtime behavior, or exact native Android rendering without execution evidence. Binary images may contain useful labels or artwork not visible in the text export.",
      recommendationsVsDeductions:"Only deduct for actual rubric requirements. Present general best practices (for example strings.xml extraction, naming style or additional accessibility refinements) as recommendations unless the assessment rubric explicitly requires them. Placeholder content and nonfunctional buttons are allowed when the task says backend behavior is out of scope.",
      feedbackStyle:"Keep student-facing feedback concise and technical, in this order: Verified accomplishments: ... Score-affecting issues: ... Recommended improvements: ... Cite the relevant filenames and specific components or attributes when supported. Do not put uncertainty or missing proof in score-affecting issues; use reviewAction and limitations.",
      teacherReview:"Keep reviewAction focused on one or two concrete missing checks. Grades and student feedback remain drafts until the teacher explicitly reviews and saves them."
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
      historicalSourceUnavailable:Array.isArray(evidence.historicalSourceUnavailable)?evidence.historicalSourceUnavailable.slice(0,100):[],
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
      rationale:"Briefly justify supported points and confirmed rubric deficiencies for "+item.name+".",
      reviewAction:"Only the smallest teacher check needed for unresolved points; otherwise empty string."
    })),
    feedback:"Verified accomplishments: ... Score-affecting issues: ... Recommended improvements: ...",
    projectObservations:"Optional shared-project context only, without awarding individual credit.",
    limitations:"Only remaining evidence, visual or runtime checks; do not repeat feedback."
  };
  return [
    "ADMINERVA EXTERNAL EVALUATION PACKAGE",
    "",
    "TASK",
    "Evaluate the learner's instructor-verified individual contributions against the PUBLISHED assessment instructions and rubric. Teacher-authored checking instructions and the shared checkpoint are provided for context, not as permission to award unverified individual credit.",
    "",
    "REQUIRED GRADING ORDER",
    "1. Read EVIDENCE PACKAGE.assessment.taskInstructions, rubric and rubricCriteria, including exclusions such as backend work not required.",
    "2. Read teacherGradingInstructions and evaluationGuidance. Interpret the learner's assigned screen or component scope separately from the group's overall deliverables.",
    "3. Grade only the matching verified substantive sha/path references; treat merge-context files, omitted changes and group files as teacher-review context.",
    "4. For each criterion, distinguish earned points, confirmed rubric deficiencies and genuinely unresolved points. Do not turn every unearned point into pending credit.",
    "5. Write concise student feedback with the exact labels Verified accomplishments:, Score-affecting issues:, and Recommended improvements:. Identify concrete code defects only where evidenced and relevant to the rubric.",
    "6. Put verification gaps in reviewAction/limitations instead of alleging runtime or visual defects. Keep shared-project observations separate.",
    "7. Keep rubric criteria in exactly the exported order. Return a SINGLE valid JSON object with no code fences, XML tags, surrounding commentary, Markdown or download links.",
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
