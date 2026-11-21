/**
 * Bulk assessment review on top of the authoritative Studio submission/grade
 * services. No separate grade store: results remain staged only in this page
 * until the teacher chooses Save eligible drafts.
 *
 * One run is bounded to 10 records. Invalid/zero/pending responses are surfaced
 * as exceptions and never auto-published.
 */
export const BULK_PACKAGE_FORMAT="adminerva-v4-bulk-evaluation-package-v1";
export const BULK_RESPONSE_FORMAT="adminerva-v4-bulk-evaluation-response-v1";
export const BULK_MAX_BATCH=10;

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

export function createV4BulkEvaluationController({
  root,scoped,migrationApi,assessmentApi,submissionApi,gradeApi,verificationApi,
  buildPackage,parseResponse,generateContent,evaluationJSON,
  setBusy,isBusy,onSaved
}){
  if(!root)return {onInbox(){},reset(){}};
  const el=id=>root.querySelector("#"+id);
  const checkboxList=el("gbV4BulkRoster"),status=el("gbV4BulkStatus"),
    errors=el("gbV4BulkExceptions"),stagedList=el("gbV4BulkStaged"),
    payload=el("gbV4BulkPayload");
  const btn=id=>el(id);
  let task=null,rows=[],selection=new Set(),staged=new Map(),
    exceptions=new Map(),batchId="",referenceMap=new Map(),stopped=false,
    running=false,schoolSignature="",scopeGeneration=0;
  const isStudio=t=>t?.submissionSource==="studio";
  const key=row=>String(row.submissionId||row.recordId||"");
  const selectedEligible=()=>rows.filter(row=>selection.has(key(row))&&
    !row.gradeStatus&&!["reopened","revision_requested"].includes(row.status));
  const candidates=()=>selectedEligible().filter(row=>
    !staged.has(key(row))&&!exceptions.has(key(row)));
  const appendStatus=(message)=>{status.textContent=message;};
  const taskKey=t=>t?(t.legacyCompatibility?"legacy:":"native:")+
    String(t.legacyAssessmentId||t.taskId):"";
  function render(){
    const ready=selectedEligible(),remaining=candidates();
    root.hidden=!isStudio(task);
    if(root.hidden)return;
    el("gbV4BulkCounts").textContent=selection.size+" selected · "+
      ready.length+" not graded · "+staged.size+" suggestions staged · "+
      exceptions.size+" exceptions";
    for(const id of ["gbV4BulkRun","gbV4BulkExport"])
      btn(id).disabled=running||isBusy()||remaining.length===0;
    btn("gbV4BulkImport").disabled=running||isBusy()||!batchId;
    btn("gbV4BulkSave").disabled=running||isBusy()||
      ![...staged.values()].some(v=>v.review.saveEligible&&ready.some(r=>key(r)===v.key));
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
      input.disabled=running||isBusy()||Boolean(row.gradeStatus)||
        ["reopened","revision_requested"].includes(row.status);
      input.addEventListener("change",()=>{
        if(input.checked)selection.add(id);else selection.delete(id);
        render();
      });
      const text=document.createElement("span");text.className="min-w-0";
      text.textContent=String(row.studentName||"Learner")+" · version "+row.version+
        (row.gradeStatus?" · "+row.gradeStatus+" grade (protected)":
          row.status==="reopened"?" · revision requested":
          staged.has(id)?" · suggestion staged":" · needs evaluation");
      line.append(input,text);checkboxList.append(line);
    }
    stagedList.replaceChildren();
    for(const data of staged.values()){
      const line=document.createElement("div");
      line.className="rounded-lg border border-slate-200 bg-white p-2 text-xs";
      const student=rows.find(row=>key(row)===data.key);
      line.textContent=(student?.studentName||"Learner")+
        " · "+data.source+" · "+data.review.awarded+" pts"+
        (data.review.pending?" · "+data.review.pending+" pending":"")+
        (data.review.reason?" · "+data.review.reason:" · eligible private draft");
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
    task=null;rows=[];selection.clear();staged.clear();exceptions.clear();
    referenceMap.clear();batchId="";payload.value="";stopped=false;running=false;
    schoolSignature="";status.textContent="";render();
  }
  function onInbox({task:next,rows:nextRows,gradeMap,schoolId}){
    const signature=String(schoolId||"")+":"+taskKey(next);
    if(signature!==schoolSignature){
      scopeGeneration++;stopped=true;
      selection.clear();staged.clear();exceptions.clear();referenceMap.clear();
      batchId="";payload.value="";schoolSignature=signature;
    }
    task=next;rows=(nextRows||[]).map(row=>({
      ...row,gradeStatus:gradeMap?.get(row.studentUid)?.status||row.gradeStatus||null
    }));
    const available=new Set(rows.map(key));
    for(const id of selection)if(!available.has(id))selection.delete(id);
    for(const id of staged)if(!available.has(id))staged.delete(id);
    if(!selection.size&&!staged.size)
      for(const row of rows)
        if(!row.gradeStatus&&!["reopened","revision_requested"].includes(row.status))
          selection.add(key(row));
    render();
  }
  async function inspect(row){
    if(!task||!isStudio(task))throw Error("Choose a Studio assessment.");
    const id=key(row);
    if(!id)throw Error("No submitted version was selected.");
    let result;
    if(task.legacyCompatibility){
      result=await scoped(migrationApi,"legacy_review_inspect",{
        legacyAssessmentId:task.legacyAssessmentId,legacySubmissionId:id
      });
    }else{
      const [snapshot,grade,privateConfig]=await Promise.all([
        scoped(submissionApi,"inspect",{taskId:task.taskId,submissionId:id}),
        scoped(gradeApi,"get_draft",{taskId:task.taskId,studentUid:row.studentUid}),
        scoped(assessmentApi,"get_private",{taskId:task.taskId})
      ]);
      result={snapshot,grade:grade.grade,checkingInstructions:privateConfig?.checkingInstructions||""};
    }
    if(result.grade||row.gradeStatus)
      throw Error("An existing private or published grade is protected from bulk replacement.");
    let snapshot=result.snapshot;
    if(!snapshot||Number(snapshot.version)!==Number(row.version)||
      !snapshot.contentDigest||!Array.isArray(snapshot.files)||!snapshot.files.length)
      throw Error("Frozen source version or checksum changed; refresh submissions.");
    if(!["submitted","reviewed"].includes(snapshot.status))
      throw Error("This learner is not in a gradeable submitted state.");
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
    const text=buildPackage({
      task,snapshot,checkingInstructions:result.checkingInstructions||""
    });
    return {key:id,row,version:snapshot.version,digest:snapshot.contentDigest,
      sourceLanguage:snapshot.sourceLanguage||"",packageText:text};
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
          const frozen=await inspect(row);
          if(session!==scopeGeneration)break;
          const ref=crypto.randomUUID();
          refs.set(ref,frozen);
          items.push({ref,evaluationInstructions:frozen.packageText});
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
      batchId=crypto.randomUUID();referenceMap=refs;
      payload.value=JSON.stringify({
        format:BULK_PACKAGE_FORMAT,batchId,
        purpose:"Evaluate each independent frozen submission. Return JSON only.",
        privacy:"No student name, user ID or email is included in reference metadata. Source code may itself contain identifying text; inspect before using an external evaluator.",
        constraints:[
          "Use the rubric and evidence rules embedded in each evaluationInstructions exactly.",
          "Never combine student evidence or assume another student's scenario.",
          "Do not assign zero merely because runtime proof is missing; distinguish confirmed defects from uncertainty.",
          "Results remain teacher-private suggestions until explicitly saved."
        ],
        expectedResponse:{format:BULK_RESPONSE_FORMAT,batchId,
          results:[{ref:"One exact anonymous ref from items",
            response:{format:"adminerva-general-external-evaluation-response-v1",
              criteria:(task.rubric||[]).map(part=>({
                name:part.name,maximumPoints:Number(part.points||0),
                awardedPoints:"number",pendingPoints:"number",
                comment:"Evidence-based feedback",
                rationale:"Concrete source or runtime evidence",
                confidence:"high | moderate | teacher_confirmation"
              })),
              feedback:"At least 20 characters",limitations:"Evidence limitations"}}]},
        items
      },null,2);
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
      exceptions.delete(frozen.key);
    }
    appendStatus(incoming.length+" external suggestion(s) staged. "+
      "Zero/pending scores remain flagged. Review the summary, then Save eligible drafts.");
    render();
  }
  async function saveDrafts(){
    const session=scopeGeneration;
    const eligible=[...staged.values()].filter(value=>
      value.review.saveEligible&&selectedEligible().some(row=>key(row)===value.key)
    );
    if(!eligible.length){appendStatus("No eligible positive, fully resolved evaluations selected.");return;}
    if(!confirm("Save "+eligible.length+" verified non-zero evaluation(s) as PRIVATE grade drafts? "+
      "Published grades and existing drafts are protected; zero/pending grades are excluded. "+
      "You may review results individually before publishing."))return;
    await execute("Bulk save",async()=>{
      let saved=0,skipped=0;
      for(const item of eligible){
        if(stopped||session!==scopeGeneration)break;
        appendStatus("Saving verified draft "+(saved+skipped+1)+"/"+eligible.length+"…");
        try{
          const details={
            criteria:item.review.criteria,feedback:item.review.feedback,
            draftSource:item.source,onlyIfUngraded:true
          };
          if(task.legacyCompatibility){
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
          staged.delete(item.key);exceptions.delete(item.key);selection.delete(item.key);
          saved++;
        }catch(error){
          if(session!==scopeGeneration)break;
          exceptions.set(item.key,error?.message||"Could not save grade draft");skipped++;
        }
        if(session!==scopeGeneration)break;
        render();
      }
      appendStatus(saved+" private draft(s) saved; "+skipped+" failed or changed. "+
        "Nothing was published. Review results before Publish all drafts.");
      if(saved&&session===scopeGeneration)await onSaved();
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
    for(const row of rows)
      if(!row.gradeStatus&&!["reopened","revision_requested"].includes(row.status))
        selection.add(key(row));
    render();
  });
  btn("gbV4BulkClear").addEventListener("click",()=>{selection.clear();render();});
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
