import {
  buildGeneralExternalEvaluationData,
  GENERAL_EXTERNAL_EVALUATION_REQUIRED_RULES,
  responseShape
} from "../assessment/general-external-evaluation.mjs?v=20261121-compact-bulk1";

/**
 * Bulk assessment review on top of the authoritative V4/historical
 * submission and grade services. Source-specific adapters load frozen evidence,
 * while one shared grading contract stages private suggestions.
 *
 * One run is bounded to 20 records. Invalid/zero/pending responses are surfaced
 * as exceptions and never auto-published.
 */
// The request package is now V2; evaluated replies intentionally remain V1.
export const BULK_PACKAGE_FORMAT="adminerva-v4-bulk-evaluation-package-v2";
export const BULK_RESPONSE_FORMAT="adminerva-v4-bulk-evaluation-response-v1";
export const BULK_MAX_BATCH=20;
export const BULK_COMPACT_PACKAGE_FORMAT=BULK_PACKAGE_FORMAT;
export const BULK_SOURCE_TYPES=Object.freeze(["studio","github","text","link"]);
// 20 long code projects can exceed an external model's context budget.
// Refuse oversized packages explicitly rather than silently discard evidence.
export const BULK_MAX_PACKAGE_CHARACTERS=650000;

export function assertBulkEvidence(source,evidence,{personalized=false}={}){
  if(!BULK_SOURCE_TYPES.includes(source))throw Error("No V4 evidence adapter exists for "+source+".");
  if(!evidence||!Number.isInteger(evidence.version)||evidence.version<1)
    throw Error("A learner has no complete frozen submission version.");
  if(source==="studio"){
    if(evidence.type!=="adminerva_studio_snapshot"||!evidence.contentDigest||
       !Array.isArray(evidence.files)||!evidence.files.length)
      throw Error("A student has no complete frozen Studio source to evaluate.");
    if(personalized&&(!evidence.personalizedTask||
       !String(evidence.personalizedTask.prompt||"").trim()))
      throw Error("One personalized learner is missing the exact assigned task.");
  }else if(source==="github"){
    if(evidence.type!=="github_frozen_commit_evidence"||
       !/^[a-f0-9]{40}$/i.test(String(evidence.checkpointSha||""))||
       !Array.isArray(evidence.commits)||!evidence.commits.length||
       !Array.isArray(evidence.selectedCommitShas)||!evidence.selectedCommitShas.length||
       evidence.commits.some(commit=>!/^[a-f0-9]{40}$/i.test(String(commit.sha||""))))
      throw Error("An approved GitHub checkpoint and inspected individual commits are required.");
    if(!evidence.commits.some(commit=>commit.files?.some(file=>file.patch&&!file.mergeContext))&&
       !evidence.pinnedSource?.length)
      throw Error("The approved repository has no accessible individual source evidence. Review manually.");
  }else if(source==="text"){
    if(evidence.type!=="written_response"||!String(evidence.response||"").trim())
      throw Error("The frozen essay or written response is unavailable.");
  }else if(source==="link"){
    if(evidence.type!=="submission_link"||
       !/^https:\/\//i.test(String(evidence.url||"")))
      throw Error("The learner's frozen submission link is unavailable.");
  }
  return true;
}


/**
 * V2 transport keeps each immutable submission distinct but hoists published
 * assessment, rubric, checking guidance and evaluator rules out of each item.
 * The existing V1 response format and ref-to-student binding do not change.
 */
export function buildCompactBulkExternalEvaluationPackage({batchId,entries,task}={}){
  if(typeof batchId!=="string"||!batchId.trim()||!Array.isArray(entries)||
     !entries.length||entries.length>BULK_MAX_BATCH)
    throw Error("Expected a valid batch ID and 1–"+BULK_MAX_BATCH+" verified submissions.");
  const first=entries[0]?.evaluationData;
  if(!first||first.format!=="adminerva-general-external-evaluation-v1"||
     !BULK_SOURCE_TYPES.includes(first.assessment?.submissionSource)||
     !Array.isArray(first.assessment?.rubric)||!first.assessment.rubric.length)
    throw Error("The canonical shared assessment and rubric are unavailable.");
  const originalAssessment=JSON.stringify(first.assessment);
  const originalRules=JSON.stringify(first.gradingRules);
  const checking=entries.every(entry=>
    entry.evaluationData?.teacherCheckingInstructions===first.teacherCheckingInstructions)
      ?first.teacherCheckingInstructions:null;
  const seen=new Set();
  const items=entries.map(entry=>{
    const ref=entry?.ref,data=entry?.evaluationData;
    if(typeof ref!=="string"||!ref||seen.has(ref))
      throw Error("The bulk package contains a missing or duplicate anonymous reference.");
    seen.add(ref);
    if(!data||data.format!==first.format||
       JSON.stringify(data.assessment)!==originalAssessment||
       JSON.stringify(data.gradingRules)!==originalRules)
      throw Error("The batch mixes different assessment instructions or grading rules. Export separately.");
    const evidence=data.evidence;
    assertBulkEvidence(first.assessment.submissionSource,evidence,{
      personalized:first.assessment.personalized
    });
    const {personalizedTask,...frozenEvidence}=evidence;
    // This interpretation is a fixed instruction, not student evidence;
    // it is already present in shared requiredRules/evidenceBoundary.
    if(frozenEvidence.executionEvidence?.interpretation){
      const {interpretation,...studentRunEvidence}=frozenEvidence.executionEvidence;
      frozenEvidence.executionEvidence=studentRunEvidence;
    }
    return {
      ref,
      personalizedTask:personalizedTask||null,
      frozenEvidence,
      ...(checking===null?{
        teacherCheckingInstructions:data.teacherCheckingInstructions||""
      }:{})
    };
  });
  const packageData={
    format:BULK_COMPACT_PACKAGE_FORMAT,
    batchId,
    purpose:"Evaluate each frozen submission independently against the shared assessment. Return only the specified batch JSON.",
    privacy:"Anonymous references contain no student names or account IDs. Source files may still contain identifying text; inspect before sharing externally.",
    shared:{
      assessment:first.assessment,
      teacherCheckingInstructions:checking||"",
      gradingRules:first.gradingRules,
      requiredRules:GENERAL_EXTERNAL_EVALUATION_REQUIRED_RULES,
      evaluationInstructions:[
        "Apply the shared published rubric, instructions and evaluator rules to every item.",
        "For each item, apply only its own personalizedTask and frozenEvidence. Never mix source files, scenarios, runtime proof or feedback across references.",
        "For Studio projects, treat matching platform automaticVerification as authoritative for the submitted source; unmatched runs are not proof of compilation or execution.",
        "For GitHub, only cite the approved checkpoint and inspected individual changes. Preserve missing-diff, incomplete-coverage and attribution uncertainty; Git author fields never prove who wrote code.",
        "For essays, cite the submitted response. For external links, do not invent linked content or claim to have opened it; use pending points or teacher confirmation if the actual artifact is unavailable.",
        "For objectively scorable questions, honor the official answer key and deterministic scoring when a verified objective-response adapter is available; never guess missing answers or invent a rubric.",
        "Keep each assessment independent; return one result per ref in exactly the expected batch JSON format. No Markdown.",
        "All scores are teacher-private suggestions, never automatically published."
      ]
    },
    expectedResponse:{
      format:BULK_RESPONSE_FORMAT,
      batchId,
      results:[{
        ref:"One exact anonymous ref from items",
        response:responseShape(task)
      }]
    },
    items
  };
  const characters=JSON.stringify(packageData).length;
  if(characters>BULK_MAX_PACKAGE_CHARACTERS)
    throw Error("This "+items.length+"-learner package contains "+characters.toLocaleString()+
      " characters, above the safe external AI context budget ("+
      BULK_MAX_PACKAGE_CHARACTERS.toLocaleString()+
      "). Select fewer learners or inspect smaller source sets; no frozen evidence was dropped.");
  return packageData;
}


export function bulkSuggestionState(suggestion,task){
  const rubric=Array.isArray(task?.rubric)?task.rubric:[];
  if(!rubric.length||!Array.isArray(suggestion?.criteria)||suggestion.criteria.length!==rubric.length)
    throw Error("The evaluation does not match this assessment's rubric.");
  let awarded=0,pending=0,teacherConfirmation=false;
  const criteria=suggestion.criteria.map((row,i)=>{
    const max=Number(rubric[i]?.points);
    const score=Number(row?.awardedPoints),hold=Number(row?.pendingPoints||0);
    if(!Number.isFinite(max)||max<=0||!Number.isFinite(score)||!Number.isFinite(hold)||
      score<0||hold<0||score+hold>max+0.000001)
      throw Error("Invalid evaluation score for rubric criterion "+(i+1)+".");
    awarded+=score;pending+=hold;
    if(row.confidence==="teacher_confirmation")teacherConfirmation=true;
    const comment=String(row.comment||"").trim();
    const rationale=String(row.rationale||"").trim();
    return {awardedPoints:score,pendingPoints:hold,
      comment:(comment+(rationale?"\nEvidence: "+rationale:"")).slice(0,1000)};
  });
  const feedback=String(suggestion.feedback||"").trim().slice(0,5000);
  if(feedback.length<20)throw Error("Evaluation feedback must contain at least 20 characters.");
  return {criteria,feedback,awarded,pending,teacherConfirmation,
    saveEligible:awarded>0&&pending===0&&!teacherConfirmation,
    reason:awarded<=0?"Zero-score result; needs individual attention":
      pending>0?"Unresolved points; individual review required":
      teacherConfirmation?"Evaluator requires teacher confirmation":""};
}

export function readBulkExternalResponse(raw,{batchId,allowedRefs,task,parseResponse}){
  let parsed;
  try{parsed=typeof raw==="string"?JSON.parse(raw):raw;}
  catch{throw Error("External batch response is not valid JSON.");}
  if(!parsed||parsed.format!==BULK_RESPONSE_FORMAT||parsed.batchId!==batchId||
     !Array.isArray(parsed.results)||!parsed.results.length)
    throw Error("External batch format or request ID does not match the current batch.");
  if(parsed.results.length>allowedRefs.size)
    throw Error("External batch contains more results than requested.");
  const found=new Set(),validated=[];
  for(const row of parsed.results){
    const key=String(row?.ref||"");
    if(!allowedRefs.has(key)||found.has(key))
      throw Error("External response contains an unknown or duplicated anonymous reference.");
    found.add(key);
    const suggestion=parseResponse(
      typeof row.response==="string"?row.response:JSON.stringify(row.response),{task}
    );
    validated.push({ref:key,suggestion,review:bulkSuggestionState(suggestion,task)});
  }
  return validated;
}

export function bulkSaveableStages({staged,saveSelection,rows}){
  // Evaluation selection and private-draft selection are independent.
  // A valid imported result stays saveable even after the teacher clears the
  // original selection used to prepare the external package.
  const byId=new Map((rows||[]).map(row=>
    [String(row.submissionId||row.evidenceId||row.recordId||""),row]));
  return [...staged.values()].filter(item=>{
    const row=byId.get(item.key);
    return saveSelection.has(item.key)&&item.review?.saveEligible===true&&
      row&&!row.gradeStatus&&row.bulkReady!==false&&
      !["reopened","revision_requested"].includes(row.status)&&
      Number(row.version)===Number(item.version);
  });
}

export function nextBulkSelection(rows,{excluded=new Set(),limit=BULK_MAX_BATCH}={}){
  const ids=[],maximum=Math.min(BULK_MAX_BATCH,Math.max(0,Math.floor(limit)));
  if(!maximum)return ids;
  for(const row of rows||[]){
    const id=String(row?.submissionId||row?.evidenceId||row?.recordId||"");
    if(!id||ids.includes(id)||excluded.has(id)||row.gradeStatus||row.bulkReady===false||
      ["reopened","revision_requested"].includes(row.status))continue;
    ids.push(id);
    if(ids.length>=maximum)break;
  }
  return ids;
}

export function canClearCompletedBulkExchange({referenceMap,staged,rows,savedIds}){
  if(staged.size)return false;
  return ![...referenceMap.values()].some(original=>{
    const current=(rows||[]).find(row=>
      String(row?.submissionId||row?.evidenceId||row?.recordId||"")===original.key);
    return !current||(!current.gradeStatus&&!savedIds.has(original.key));
  });
}

export function createV4BulkEvaluationController({
  root,scoped,migrationApi,assessmentApi,submissionApi,generalSubmissionApi,
  githubEvidenceApi,gradeApi,verificationApi,prepareGithubEvidence,
  buildPackage,parseResponse,generateContent,evaluationJSON,
  setBusy,isBusy,onSaved
}){
  if(!root)return {onInbox(){},reset(){}};
  const el=id=>root.querySelector("#"+id);
  const checkboxList=el("gbV4BulkRoster"),status=el("gbV4BulkStatus"),
    errors=el("gbV4BulkExceptions"),stagedList=el("gbV4BulkStaged"),
    payload=el("gbV4BulkPayload");
  const btn=id=>el(id);
  let task=null,rows=[],selection=new Set(),saveSelection=new Set(),staged=new Map(),
    exceptions=new Map(),batchId="",referenceMap=new Map(),stopped=false,
    running=false,schoolSignature="",scopeGeneration=0,autoSelectNext=true,
    verifiedEvidence=new Set(),evidenceNotes=new Map();
  const supported=t=>BULK_SOURCE_TYPES.includes(t?.submissionSource);
  const historicalGithub=()=>Boolean(task?.legacyCompatibility&&task.submissionSource==="github");
  const requiresArtifactReview=()=>historicalGithub()||task?.submissionSource==="link";
  const key=row=>String(row.submissionId||row.evidenceId||row.recordId||"");
  const selectedEligible=()=>rows.filter(row=>selection.has(key(row))&&
    !row.gradeStatus&&row.bulkReady!==false&&
    !["reopened","revision_requested"].includes(row.status));
  const candidates=()=>selectedEligible().filter(row=>
    !staged.has(key(row))&&!exceptions.has(key(row)));
  const saveable=()=>bulkSaveableStages({staged,saveSelection,rows}).filter(item=>
    !requiresArtifactReview()||(verifiedEvidence.has(item.key)&&
      String(evidenceNotes.get(item.key)||"").trim().length>=15));
  const appendStatus=(message)=>{status.textContent=message;};
  const taskKey=t=>t?(t.legacyCompatibility?"legacy:":"native:")+
    String(t.legacyAssessmentId||t.taskId):"";
  function render(){
    const ready=selectedEligible(),remaining=candidates(),saveReady=saveable();
    root.hidden=!supported(task);
    if(root.hidden)return;
    el("gbV4BulkCounts").textContent=selection.size+"/"+BULK_MAX_BATCH+
      " selected for this batch · "+ready.length+" ungraded · "+
      staged.size+" suggestions staged · "+saveReady.length+
      " ready to save · "+exceptions.size+" exceptions";
    for(const id of ["gbV4BulkRun","gbV4BulkExport"])
      btn(id).disabled=running||isBusy()||remaining.length===0;
    btn("gbV4BulkImport").disabled=running||isBusy()||!batchId;
    btn("gbV4BulkSave").disabled=running||isBusy()||saveReady.length===0;
    btn("gbV4BulkSave").textContent="Save "+saveReady.length+" eligible private draft"+
      (saveReady.length===1?"":"s");
    btn("gbV4BulkSelect").disabled=running||isBusy();
    btn("gbV4BulkClear").disabled=running||isBusy();
    btn("gbV4BulkRetry").disabled=running||isBusy()||exceptions.size===0;
    btn("gbV4BulkStop").hidden=!running;
    checkboxList.replaceChildren();
    for(const row of rows){
      const id=key(row);
      const line=document.createElement("label");
      line.className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm";
      const input=document.createElement("input");input.type="checkbox";
      input.className="mt-1";input.checked=selection.has(id);
      input.disabled=running||isBusy()||Boolean(row.gradeStatus)||row.bulkReady===false||
        ["reopened","revision_requested"].includes(row.status)||
        (!selection.has(id)&&selection.size>=BULK_MAX_BATCH);
      input.addEventListener("change",()=>{
        if(input.checked){
          if(selection.size>=BULK_MAX_BATCH){
            appendStatus("A batch can contain at most "+BULK_MAX_BATCH+
              " learners. Deselect one before adding another.");
            input.checked=false;
            return;
          }
          selection.add(id);
        }else selection.delete(id);
        autoSelectNext=false;
        render();
      });
      const text=document.createElement("span");text.className="min-w-0";
      text.textContent=String(row.studentName||"Learner")+" · version "+row.version+
        (row.gradeStatus?" · "+row.gradeStatus+" grade (protected)":
          row.status==="reopened"?" · revision requested":
          row.bulkReady===false?" · evidence approval required":
          staged.has(id)?" · suggestion staged":" · needs evaluation");
      line.append(input,text);checkboxList.append(line);
    }
    stagedList.replaceChildren();
    for(const data of staged.values()){
      const line=document.createElement("details");
      line.className="rounded-lg border border-slate-200 bg-white p-2 text-xs";
      const summary=document.createElement("summary");
      summary.className="cursor-pointer font-bold text-slate-800";
      const student=rows.find(row=>key(row)===data.key);
      summary.textContent=(student?.studentName||"Learner")+
        " · "+data.source+" · "+data.review.awarded+" pts"+
        (data.review.pending?" · "+data.review.pending+" pending":"")+
        (data.review.reason?" · "+data.review.reason:" · eligible private draft");
      line.append(summary);
      const submitted=rows.find(row=>key(row)===data.key);
      const stillGradeable=Boolean(submitted&&!submitted.gradeStatus&&
        !["reopened","revision_requested"].includes(submitted.status)&&
        Number(submitted.version)===Number(data.version));
      if(requiresArtifactReview()&&data.review.saveEligible){
        const label=document.createElement("label");
        label.className="mt-2 flex items-start gap-2 text-xs font-semibold text-amber-950";
        const check=document.createElement("input");check.type="checkbox";
        check.className="mt-0.5";check.checked=verifiedEvidence.has(data.key);
        check.disabled=running||isBusy();
        check.addEventListener("change",()=>{
          if(check.checked)verifiedEvidence.add(data.key);
          else verifiedEvidence.delete(data.key);
          render();
        });
        label.append(check,document.createTextNode(
          historicalGithub()?
            "I inspected the approved checkpoint, individual contribution evidence and attribution limits.":
            "I opened this student's external submission and verified its actual contents against the rubric."));
        const noteLabel=document.createElement("label");
        noteLabel.className="mt-2 block text-xs font-bold text-amber-950";
        noteLabel.textContent="Individual teacher review note (at least 15 characters)";
        const note=document.createElement("textarea");
        note.rows=2;note.maxLength=3000;note.className="mt-1 w-full border border-amber-300 rounded-lg p-2";
        note.value=evidenceNotes.get(data.key)||"";
        note.placeholder=historicalGithub()?
          "Describe inspected commits and attribution limitations.":
          "Describe the inspected linked artifact and evidence used for grading.";
        note.disabled=running||isBusy();
        note.addEventListener("input",()=>{
          evidenceNotes.set(data.key,note.value);
          const ready=saveable();
          btn("gbV4BulkSave").disabled=running||isBusy()||!ready.length;
          btn("gbV4BulkSave").textContent="Save "+ready.length+" eligible private draft"+
            (ready.length===1?"":"s");
        });
        noteLabel.append(note);
        line.append(label,noteLabel);
      }
      if(data.review.saveEligible){
        const include=document.createElement("label");
        include.className="mt-2 flex items-center gap-2 text-xs font-semibold text-indigo-900";
        const input=document.createElement("input");input.type="checkbox";
        input.checked=saveSelection.has(data.key)&&stillGradeable;
        input.disabled=!stillGradeable||running||isBusy();
        input.addEventListener("change",()=>{
          if(input.checked)saveSelection.add(data.key);
          else saveSelection.delete(data.key);
          render();
        });
        include.append(input,document.createTextNode(stillGradeable?
          "Include this result when saving private drafts":
          "Already graded, reopened, or changed version — cannot save from this batch"));
        line.append(include);
      }
      const feedback=document.createElement("p");
      feedback.className="mt-2 whitespace-pre-wrap text-slate-700";
      feedback.textContent=data.review.feedback;
      line.append(feedback);
      (data.review.criteria||[]).forEach((row,index)=>{
        const rubric=task?.rubric?.[index]||{};
        const entry=document.createElement("p");
        entry.className="mt-2 whitespace-pre-wrap border-t border-slate-100 pt-2 text-slate-700";
        entry.textContent=String(rubric.name||"Criterion "+(index+1))+
          " · "+row.awardedPoints+" / "+Number(rubric.points||0)+
          (row.pendingPoints?" · "+row.pendingPoints+" pending":"")+
          "\n"+row.comment;
        line.append(entry);
      });
      stagedList.append(line);
    }
    errors.replaceChildren();
    for(const [id,message] of exceptions){
      const row=rows.find(item=>key(item)===id);
      const line=document.createElement("p");line.className="text-xs text-rose-800";
      line.textContent=(row?.studentName||"Submission")+" · "+String(message).slice(0,300);
      errors.append(line);
    }
  }
  function reset(){
    scopeGeneration++;stopped=true;
    task=null;rows=[];selection.clear();saveSelection.clear();staged.clear();exceptions.clear();
    verifiedEvidence.clear();evidenceNotes.clear();
    referenceMap.clear();batchId="";payload.value="";
    el("gbV4BulkResponse").value="";
    stopped=false;running=false;autoSelectNext=true;
    schoolSignature="";status.textContent="";render();
  }
  function onInbox({task:next,rows:nextRows,gradeMap,schoolId}){
    const signature=String(schoolId||"")+":"+taskKey(next);
    if(signature!==schoolSignature){
      scopeGeneration++;stopped=true;
      selection.clear();saveSelection.clear();staged.clear();exceptions.clear();referenceMap.clear();
      verifiedEvidence.clear();evidenceNotes.clear();
      batchId="";payload.value="";el("gbV4BulkResponse").value="";
      autoSelectNext=true;schoolSignature=signature;
    }
    task=next;rows=(nextRows||[]).map(row=>{
      const gradeStatus=gradeMap?.get(row.studentUid)?.status||row.gradeStatus||null;
      const github=next?.submissionSource==="github";
      const gradeable=github?["approved","reviewed"].includes(row.status):
        ["submitted","reviewed"].includes(row.status);
      return {...row,gradeStatus,bulkReady:gradeable&&
        (!next?.legacyCompatibility||!github||row.approved===true)};
    });
    const available=new Set(rows.map(key));
    for(const id of selection)if(!available.has(id)||
      rows.find(row=>key(row)===id)?.gradeStatus)selection.delete(id);
    for(const id of staged)if(!available.has(id)){
      staged.delete(id);saveSelection.delete(id);
    }
    if(autoSelectNext){
      selection=new Set(nextBulkSelection(rows,{
        excluded:new Set([...staged.keys(),...exceptions.keys()])
      }));
      autoSelectNext=false;
    }
    if(selection.size>BULK_MAX_BATCH)
      selection=new Set([...selection].slice(0,BULK_MAX_BATCH));
    render();
  }
  /**
   * One grading pipeline, different evidence transports. Every inspect call
   * re-reads the canonical source and current grade; save_draft does it again
   * transactionally. Historical sources remain in their original collections.
   */
  async function inspect(row,{forExternal=false}={}){
    if(!task||!supported(task))throw Error("Choose a supported deployed assessment.");
    const id=key(row),source=task.submissionSource;
    if(!id)throw Error("No submitted version was selected.");
    let result;
    if(task.legacyCompatibility){
      result=await scoped(migrationApi,source==="github"?
        "legacy_github_inspect":"legacy_review_inspect",{
        legacyAssessmentId:task.legacyAssessmentId,
        ...(source==="github"?{legacyEvidenceId:id}:{legacySubmissionId:id})
      });
    }else{
      const api=source==="studio"?submissionApi:
        source==="github"?githubEvidenceApi:generalSubmissionApi;
      if(!api)throw Error("This source does not yet have a V4 evidence adapter.");
      const [snapshot,grade,privateConfig]=await Promise.all([
        scoped(api,"inspect",{taskId:task.taskId,
          ...(source==="github"?{evidenceId:id}:{submissionId:id})}),
        scoped(gradeApi,"get_draft",{taskId:task.taskId,studentUid:row.studentUid}),
        scoped(assessmentApi,"get_private",{taskId:task.taskId})
      ]);
      result={snapshot,grade:grade.grade,
        checkingInstructions:privateConfig?.checkingInstructions||""};
    }
    if(result.grade||row.gradeStatus)
      throw Error("An existing private or published grade is protected from bulk replacement.");
    let snapshot=result.snapshot;
    if(!snapshot||Number(snapshot.version)!==Number(row.version))
      throw Error("The frozen submission version changed; refresh submissions.");
    const gradeable=source==="github"?["approved","reviewed"].includes(snapshot.status):
      ["submitted","reviewed"].includes(snapshot.status);
    if(!gradeable)
      throw Error("This learner has no approved or gradeable frozen evidence.");
    if(source==="studio"){
      if(!snapshot.contentDigest||!Array.isArray(snapshot.files)||!snapshot.files.length)
        throw Error("Frozen Studio source or checksum changed; refresh submissions.");
      if(!snapshot.automaticVerification&&verificationApi){
        try{
          const verified=task.legacyCompatibility?
            await scoped(verificationApi,"verify_legacy",{
              submissionId:id,revision:Number(snapshot.version)
            }):
            await scoped(verificationApi,"verify_school",{
              taskId:task.taskId,submissionId:id,version:Number(snapshot.version)
            });
          snapshot={...snapshot,automaticVerification:verified?.verification||null};
        }catch(error){
          snapshot={...snapshot,automaticVerification:{
            status:"verification_unavailable",matchesSubmittedSource:false,
            limitations:[String(error?.message||"Runtime verification could not be established.")]
          }};
        }
      }
    }else if(source==="github"){
      if(typeof prepareGithubEvidence!=="function")
        throw Error("The approved GitHub source inspector is unavailable.");
      snapshot=await prepareGithubEvidence({task,snapshot});
    }else if(source==="text"){
      if(!snapshot.submissionDigest||!String(snapshot.payload?.response||"").trim())
        throw Error("The frozen essay or written response is incomplete.");
    }else if(source==="link"){
      if(!snapshot.submissionDigest||!String(snapshot.payload?.url||"").startsWith("https://"))
        throw Error("The frozen submission link is unavailable.");
    }
    const digest=snapshot.contentDigest||snapshot.submissionDigest||
      snapshot.evidenceDigest||(
        source==="github"?snapshot.checkpointSha+":"+
          String(snapshot.evidenceRevision??snapshot.version):"");
    const context={
      task,snapshot,checkingInstructions:result.checkingInstructions||""
    };
    return {key:id,row,version:snapshot.version,digest,
      evidenceRevision:Number(snapshot.evidenceRevision??snapshot.version),
      checkpointSha:snapshot.checkpointSha||"",
      sourceLanguage:snapshot.sourceLanguage||"",
      ...(forExternal?{evaluationData:buildGeneralExternalEvaluationData(context)}:
        {packageText:buildPackage(context)})
    };
  }
  async function execute(title,work){
    if(running||isBusy()||!task)return;
    running=true;stopped=false;setBusy(true);render();
    try{await work();}
    catch(error){appendStatus(title+" stopped: "+(error?.message||error));}
    finally{running=false;setBusy(false);render();}
  }
  async function processBatch(){
    const session=scopeGeneration;
    const work=candidates().slice(0,BULK_MAX_BATCH);
    if(!work.length){appendStatus("No selected ungraded submissions remain.");return;}
    await execute("Bulk evaluation",async()=>{
      let done=0;
      for(const row of work){
        if(stopped)break;
        const id=key(row);
        appendStatus("Evaluating "+(done+1)+" of "+work.length+
          " in this batch · "+(row.studentName||"Learner")+".");
        try{
          const frozen=await inspect(row);
          if(session!==scopeGeneration)break;
          const result=await generateContent({
            contents:[{parts:[{text:frozen.packageText}]}],
            generationConfig:{
              responseMimeType:"application/json",temperature:0.2,maxOutputTokens:8192
            }
          },{purpose:"evaluation",signal:AbortSignal.timeout(100000)});
          if(session!==scopeGeneration)break;
          const parsed=await evaluationJSON({ok:true,json:async()=>result});
          const suggestion=parseResponse(JSON.stringify(parsed),{task});
          const review=bulkSuggestionState(suggestion,task);
          staged.set(id,{...frozen,source:"internal_ai",suggestion,review});
          if(review.saveEligible)saveSelection.add(id);
          else saveSelection.delete(id);
          exceptions.delete(id);
        }catch(error){
          if(session!==scopeGeneration)break;
          exceptions.set(id,error?.message||"Evaluation failed");
        }
        if(session!==scopeGeneration)break;
        done++;render();
      }
      appendStatus(done+" evaluation(s) processed · "+
        staged.size+" staged · "+exceptions.size+
        " exceptions. No grades saved or published. Run again for the next batch.");
    });
  }
  async function exportBatch(){
    const session=scopeGeneration;
    const work=candidates().slice(0,BULK_MAX_BATCH);
    if(!work.length){appendStatus("No ungraded submissions selected.");return;}
    await execute("External package",async()=>{
      const refs=new Map(),items=[];
      for(const row of work){
        if(stopped)break;
        const id=key(row);
        try{
          const frozen=await inspect(row,{forExternal:true});
          if(session!==scopeGeneration)break;
          const ref=crypto.randomUUID();
          refs.set(ref,frozen);
          items.push({ref,evaluationData:frozen.evaluationData});
          exceptions.delete(id);
        }catch(error){
          if(session!==scopeGeneration)break;
          exceptions.set(id,error?.message||"Could not export frozen source");
        }
        if(session!==scopeGeneration)break;
        appendStatus(items.length+" verified anonymous package item(s) prepared.");
      }
      if(session!==scopeGeneration)return;
      if(!items.length)throw Error("No frozen submissions passed the package checks.");
      const nextBatchId=crypto.randomUUID();
      const nextPayload=JSON.stringify(
        buildCompactBulkExternalEvaluationPackage({
          batchId:nextBatchId,entries:items,task
        }),null,2
      );
      // Commit the anonymous ref binding only after all items validate.
      // Failed exports must not leave an invalid importable batch behind.
      batchId=nextBatchId;referenceMap=refs;payload.value=nextPayload;
      const exchange=payload.closest("details");
      if(exchange)exchange.open=true;
      payload.scrollIntoView({block:"nearest"});
      appendStatus(items.length+" anonymous external evaluation package(s) ready. "+
        "Copy the JSON and paste the evaluator's response in Import. No grades saved.");
    });
  }
  async function importBatch(){
    if(!batchId||!referenceMap.size){appendStatus("Prepare a batch package before importing.");return;}
    let incoming;
    try{
      incoming=readBulkExternalResponse(el("gbV4BulkResponse").value,{
        batchId,allowedRefs:referenceMap,task,parseResponse
      });
    }catch(error){appendStatus(error?.message||"External batch invalid.");return;}
    for(const row of incoming){
      const frozen=referenceMap.get(row.ref);
      if(!frozen)continue;
      staged.set(frozen.key,{...frozen,source:"external_ai",
        suggestion:row.suggestion,review:row.review});
      // The teacher explicitly exported this submission for assessment.
      // Its result is selected for saving independently of the bulk roster.
      if(row.review.saveEligible)saveSelection.add(frozen.key);
      else saveSelection.delete(frozen.key);
      exceptions.delete(frozen.key);
    }
    appendStatus(incoming.length+" external suggestion(s) staged. "+
      "Zero/pending scores remain flagged. Review the summary, then Save eligible drafts.");
    render();
  }
  async function saveDrafts(){
    const session=scopeGeneration;
    const eligible=saveable();
    if(!eligible.length){appendStatus("No eligible positive, fully resolved evaluations selected.");return;}
    if(!confirm("Save "+eligible.length+" verified non-zero evaluation(s) as PRIVATE grade drafts? "+
      "Published grades and existing drafts are protected; zero/pending grades are excluded. "+
      "You may review results individually before publishing."))return;
    await execute("Bulk save",async()=>{
      let saved=0,skipped=0;
      const savedIds=new Set();
      for(const item of eligible){
        if(stopped||session!==scopeGeneration)break;
        appendStatus("Saving verified draft "+(saved+skipped+1)+"/"+eligible.length+"…");
        try{
          const details={
            criteria:item.review.criteria,feedback:item.review.feedback,
            draftSource:item.source,onlyIfUngraded:true,
            ...(task.submissionSource==="link"?{
              externalArtifactVerified:verifiedEvidence.has(item.key),
              artifactReviewNote:String(evidenceNotes.get(item.key)||"").trim()
            }:{})
          };
          if(task.legacyCompatibility&&task.submissionSource==="github"){
            await scoped(migrationApi,"legacy_github_save_draft",{
              legacyAssessmentId:task.legacyAssessmentId,
              legacyEvidenceId:item.key,
              expectedEvidenceRevision:item.evidenceRevision,
              expectedCheckpointSha:item.checkpointSha,
              expectedGradeRevision:0,
              reviewNote:String(evidenceNotes.get(item.key)||"").trim(),
              ...details
            });
          }else if(task.legacyCompatibility){
            await scoped(migrationApi,"legacy_review_save_draft",{
              legacyAssessmentId:task.legacyAssessmentId,
              legacySubmissionId:item.key,
              expectedSubmissionVersion:item.version,
              expectedSnapshotHash:item.digest,
              ...details
            });
          }else{
            await scoped(gradeApi,"save_draft",{
              taskId:task.taskId,studentUid:item.row.studentUid,
              submissionVersion:item.version,...details
            });
          }
          if(session!==scopeGeneration)break;
          staged.delete(item.key);saveSelection.delete(item.key);
          verifiedEvidence.delete(item.key);evidenceNotes.delete(item.key);
          exceptions.delete(item.key);selection.delete(item.key);
          savedIds.add(item.key);
          saved++;
        }catch(error){
          if(session!==scopeGeneration)break;
          exceptions.set(item.key,error?.message||"Could not save grade draft");skipped++;
        }
        if(session!==scopeGeneration)break;
        render();
      }
      if(saved&&session===scopeGeneration){
        // Do not throw away a partial external response or an unsaved staged
        // evaluation. Only retire the package after every export reference has
        // been saved (or already appears graded in the current inbox).
        const clearedExchange=canClearCompletedBulkExchange({
          referenceMap,staged,rows,savedIds
        });
        if(clearedExchange){
          batchId="";referenceMap.clear();payload.value="";
          el("gbV4BulkResponse").value="";
          const exchange=payload.closest("details");
          if(exchange)exchange.open=false;
        }
        // The actual saved records are reloaded from the server; only then
        // select the next 20 still-ungraded learners. This avoids retrying
        // already-saved students and leaves failed evaluations visible.
        selection.clear();autoSelectNext=true;
        await onSaved();
        if(session===scopeGeneration){
          appendStatus(saved+" private draft(s) saved; "+skipped+
            " failed or changed. Nothing was published. "+
            selection.size+" next ungraded learner(s) selected."+
            (clearedExchange?" The completed JSON exchange was cleared.":
              " Unfinished evaluation data was retained for recovery."));
          render();
        }
      }else{
        appendStatus(saved+" private draft(s) saved; "+skipped+
          " failed or changed. Nothing was published.");
      }
    });
  }
  btn("gbV4BulkRun").addEventListener("click",()=>void processBatch());
  btn("gbV4BulkExport").addEventListener("click",()=>void exportBatch());
  btn("gbV4BulkImport").addEventListener("click",()=>void importBatch());
  btn("gbV4BulkSave").addEventListener("click",()=>void saveDrafts());
  btn("gbV4BulkStop").addEventListener("click",()=>{
    stopped=true;appendStatus("Stop requested. Finishing the current evaluation before stopping.");
  });
  btn("gbV4BulkSelect").addEventListener("click",()=>{
    selection=new Set(nextBulkSelection(rows,{
      excluded:new Set([...staged.keys(),...exceptions.keys()])
    }));
    autoSelectNext=false;
    appendStatus(selection.size?selection.size+" ungraded learners selected (maximum "+
      BULK_MAX_BATCH+").":"No additional ungraded learners are available.");
    render();
  });
  btn("gbV4BulkClear").addEventListener("click",()=>{
    selection.clear();autoSelectNext=false;render();
  });
  btn("gbV4BulkRetry").addEventListener("click",()=>{
    exceptions.clear();
    appendStatus("Exceptions cleared. Failed submissions may now be retried.");
    render();
  });
  btn("gbV4BulkCopy").addEventListener("click",async()=>{
    if(!payload.value)return;
    try{
      await navigator.clipboard.writeText(payload.value);
      appendStatus("External batch package copied. Keep its anonymous references intact.");
    }catch{
      payload.focus();payload.select();
      appendStatus("Clipboard permission unavailable. The package is selected: copy it manually.");
    }
  });
  render();
  return {onInbox,reset};
}
