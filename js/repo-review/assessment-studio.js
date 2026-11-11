/** Assessment authoring, repository evidence, individual review and protected grading: assessment studio. */
import { db,auth } from "../core/firebase-core.js?v=1.3.0";
import {validateDeploymentDates} from "./assessment-dates.mjs?v=1.3.0";
import {loadSchoolOptions,fillSchoolDatalist} from "../core/school-options.mjs?v=1.3.0";
import {resolveStaffSubjects} from "../core/staff-session.mjs?v=1.3.10";
import {generateSchoolContent} from "../core/school-ai.mjs?v=4.0.0";
import {
  buildExternalPersonalizationPackage,
  parseExternalPersonalizationResponse
} from "./services/external-personalization.mjs?v=1.0.0";
import {
  collection,
  getDocs,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  limit,
  where,
  serverTimestamp,
  writeBatch,
} from "../core/teaching-firestore.mjs?v=1.3.0";
import {Timestamp} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
let targetPaths = [];
let allSections = [];
let sectionStudentCounts=new Map();
let objectiveRules = [];
let assessments = [];
let currentAssessmentId = null;
let deploySelectedSections = [];
let fpInstance = null;
let savingBlueprint=false,savingDeployment=false,rubricSource="balanced",lastGeneratedRubric="",subjectFocus=[];
let blueprintContentLocked=false;
let personalizedVariantPool=[],personalizedVariantFingerprint="",personalizedVariantGeneratedAt="",generatingVariants=false,personalizationDirty=false;
const PERSONALIZATION_MODE="ai_blueprint_pool_v1";
const MAX_PERSONALIZED_POOL=300;
const MAX_EXTERNAL_VARIANT_BATCH=45;
const rubricTemplates=new Map();
const defaultPersona="Assist the teacher by checking supported evidence against the published task and rubric. Distinguish verified individual contributions from shared project work. Do not infer authorship or misconduct. Leave unsupported, visual and runtime criteria for teacher review. Suggested scores stay unpublished until teacher approval.";
const balancedCriteria=[{name:"Task requirements",weight:40,description:"Requested features and outputs are demonstrated."},{name:"Correctness",weight:30,description:"The submitted work behaves or reasons correctly for the task."},{name:"Clarity and organization",weight:20,description:"The work is understandable, organized and appropriate for the task."},{name:"Explanation and supporting evidence",weight:10,description:"The student explains the approach and links relevant evidence of their own contribution."}];
const blueprintStatus=message=>{const node=document.getElementById("blueprintStatus");if(node)node.textContent=message;};
function preparedTaskContext(){
  const title=document.getElementById("assessTitle").value.trim(),subject=document.getElementById("assessSubject").value.trim();
  return "Complete "+(title||"the assessment task")+(subject?" for "+subject:"")+". Submit the requested work and a brief explanation of your approach. Link relevant evidence of your own contribution. Your teacher will review the published rubric and submitted evidence.";
}
function updateContextPreview(){
  const node=document.getElementById("assessmentContextPreview");
  if(node)node.textContent=document.getElementById("taskContext").value.trim()||preparedTaskContext();
}
function pointsRubric(criteria,maxScore){
  const usable=criteria.filter(criterion=>typeof criterion.name==="string"&&criterion.name.trim()&&Number(criterion.weight)>0&&Number.isFinite(Number(criterion.weight)));
  if(!usable.length)throw Error("This rubric template has no weighted criteria. Choose the balanced rubric or enter your own criteria.");
  const total=usable.reduce((sum,criterion)=>sum+Number(criterion.weight),0);let assigned=0;
  return usable.map((criterion,index)=>{
    const points=index===usable.length-1?Math.round((maxScore-assigned)*100)/100:Math.round(maxScore*Number(criterion.weight)/total*100)/100;
    assigned+=points;
    return (index+1)+". "+criterion.name.trim()+" — "+points+" point"+(points===1?"":"s")+(criterion.description?": "+String(criterion.description).trim():"");
  }).join("\n");
}
function refreshRubricChoices(){
  const select=document.getElementById("assessmentRubricTemplate"),current=select.value;
  select.replaceChildren(new Option("Balanced task rubric","balanced"));
  for(const [id,template] of rubricTemplates)select.add(new Option("Saved template · "+template.name,id));
  for(const assessment of assessments)
    if(typeof assessment.evalCriteria==="string"&&assessment.evalCriteria.trim())
      select.add(new Option("Reuse assessment · "+assessment.title,"assessment:"+assessment.id));
  if([...select.options].some(option=>option.value===current))select.value=current;
}
function personalizationSource(){
  return JSON.stringify({
    title:document.getElementById("assessTitle").value.trim(),
    type:document.getElementById("assessType").value,
    maxScore:Number(document.getElementById("maxScore").value),
    subject:document.getElementById("assessSubject").value.trim(),
    taskContext:document.getElementById("taskContext").value.trim()||preparedTaskContext(),
    evalCriteria:document.getElementById("evalCriteria").value.trim(),
    guidance:document.getElementById("assessVariantGuidance")?.value.trim()||""
  });
}
async function sha256Text(text){
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,"0")).join("");
}
async function currentPersonalizationFingerprint(){return sha256Text(personalizationSource());}
function markPersonalizationPossiblyStale(){
  if(!personalizedVariantPool.length)return;
  const status=document.getElementById("personalizedVariantStatus");
  if(status)status.textContent="Task details changed. The existing variant pool may be stale; regenerate it before deployment.";
}
async function loadPersonalizationVariants(assessmentId,metadata={}){
  const fingerprint=String(metadata.fingerprint||"");
  if(!assessmentId||!fingerprint)return [];
  const snap=await getDocs(collection(db,"assessment_private",assessmentId,"variants"));
  return snap.docs.map(record=>({variantId:record.id,...record.data()}))
    .filter(item=>item.fingerprint===fingerprint)
    .sort((a,b)=>String(a.variantId).localeCompare(String(b.variantId)));
}
function renderPersonalizedVariantPool(){
  const status=document.getElementById("personalizedVariantStatus"),
    wrap=document.getElementById("personalizedVariantPreviewWrap"),
    preview=document.getElementById("personalizedVariantPreview");
  if(!status||!wrap||!preview)return;
  preview.replaceChildren();
  if(!personalizedVariantPool.length){
    status.textContent="No variant pool generated yet.";
    wrap.classList.add("hidden");return;
  }
  status.textContent=personalizedVariantPool.length+" private variant"+
    (personalizedVariantPool.length===1?"":"s")+" ready. Regenerate after changing the task instructions, rubric or variation guidance.";
  for(const [index,variant] of personalizedVariantPool.slice(0,4).entries()){
    const card=document.createElement("article");card.className="rounded-lg border border-indigo-100 bg-slate-50 p-3";
    const heading=document.createElement("strong");heading.className="text-xs text-indigo-950";
    heading.textContent="Sample variant "+(index+1)+" · "+variant.variantId;
    const body=document.createElement("pre");body.className="whitespace-pre-wrap font-sans text-xs leading-5 text-slate-700 mt-2 max-h-48 overflow-auto";
    body.textContent=variant.prompt;card.append(heading,body);preview.append(card);
  }
  wrap.classList.remove("hidden");
}
function providerText(result){
  return (result?.candidates||[]).flatMap(candidate=>candidate.content?.parts||[])
    .map(part=>typeof part.text==="string"?part.text:"").join("").trim();
}
function cleanGeneratedVariant(item){
  if(!item||typeof item.prompt!=="string")return null;
  const prompt=item.prompt.trim(),
    evaluationNotes=typeof item.evaluationNotes==="string"?item.evaluationNotes.trim():"",
    summary=typeof item.summary==="string"?item.summary.trim().slice(0,300):"";
  if(prompt.length<80||prompt.length>12000||evaluationNotes.length<10||evaluationNotes.length>8000||!summary)return null;
  return {prompt,evaluationNotes,summary};
}
async function generateVariantBatch({count,title,taskContext,evalCriteria,guidance,previousSummaries}){
  const requestText=[
    "Generate equivalent individualized variants for ONE programming assessment.",
    "",
    "ASSESSMENT TITLE",title,
    "",
    "AUTHORITATIVE STUDENT INSTRUCTIONS",taskContext,
    "",
    "AUTHORITATIVE PUBLISHED RUBRIC",evalCriteria,
    "",
    "TEACHER VARIATION GUIDANCE",guidance||"Vary concrete details conservatively while preserving the same programming competencies.",
    "",
    "Generate exactly "+count+" distinct student task variants.",
    "Rules:",
    "- Preserve the programming language, platform, learning objectives, required concepts, scope, difficulty, expected effort and rubric applicability of the authoritative blueprint.",
    "- Do NOT introduce programming concepts, libraries, frameworks, databases, APIs, file requirements or restrictions that are absent from or contradict the blueprint.",
    "- Personalize only concrete details that can change without changing the competency being assessed: scenario, identifiers, literal values, small datasets, example inputs, required output details, or equivalent problem framing.",
    "- Every variant must be self-contained and specific enough for a learner to implement without seeing the other variants.",
    "- Every variant must be gradeable with the SAME published rubric. Do not create easier or harder variants.",
    "- Do not provide a complete solution or finished source code unless the authoritative blueprint explicitly requires starter code.",
    "- The student prompt must not mention AI, hidden evaluation notes, other students, or other variants.",
    "- evaluationNotes are private teacher/evaluator notes. State exact variant-specific requirements or expected behavior concisely; do not change the rubric.",
    previousSummaries?.length?"- Avoid repeating these already generated variants: "+previousSummaries.slice(-30).join(" | "):"",
    "- Generation nonce: "+crypto.randomUUID()
  ].filter(Boolean).join("\n");
  const payload={
    contents:[{role:"user",parts:[{text:requestText}]}],
    generationConfig:{
      temperature:0.85,maxOutputTokens:16384,responseMimeType:"application/json",
      responseSchema:{
        type:"OBJECT",
        properties:{
          variants:{
            type:"ARRAY",
            items:{
              type:"OBJECT",
              properties:{
                prompt:{type:"STRING"},
                evaluationNotes:{type:"STRING"},
                summary:{type:"STRING"}
              },
              required:["prompt","evaluationNotes","summary"]
            }
          }
        },
        required:["variants"]
      }
    }
  };
  const result=await generateSchoolContent(payload,{purpose:"personalized-assessment"});
  let parsed;
  try{parsed=JSON.parse(providerText(result));}
  catch{throw Error("AI returned an unreadable variant batch. Retry generation.");}
  return (Array.isArray(parsed?.variants)?parsed.variants:[]).map(cleanGeneratedVariant).filter(Boolean);
}
window.generatePersonalizedVariantPool=async function(){
  if(generatingVariants)return;
  if(!currentAssessmentId)
    return blueprintStatus("Save the personalized blueprint first, then prepare its variant pool.");
  if(document.getElementById("assessSubmissionSource").value!=="studio"||
     !document.getElementById("assessPersonalizedTask").checked)
    return blueprintStatus("This blueprint is not configured as a personalized Studio assessment.");
  const title=document.getElementById("assessTitle").value.trim(),
    taskContext=document.getElementById("taskContext").value.trim()||preparedTaskContext(),
    evalCriteria=document.getElementById("evalCriteria").value.trim(),
    guidance=document.getElementById("assessVariantGuidance").value.trim(),
    target=Number(document.getElementById("assessVariantCount").value);
  if(!title)return blueprintStatus("Enter the assessment title before generating variants.");
  if(!evalCriteria)return blueprintStatus("Prepare the published rubric before generating variants.");
  if(!Number.isInteger(target)||target<10||target>MAX_PERSONALIZED_POOL)return blueprintStatus("Choose a variant pool size from 10 to "+MAX_PERSONALIZED_POOL+".");
  const fingerprint=await currentPersonalizationFingerprint(),
    preserve=personalizedVariantFingerprint===fingerprint?personalizedVariantPool:[],
    need=variantGenerationNeed(preserve.length),
    button=document.getElementById("assessmentGenerateVariants");
  if(!need.missing){
    personalizedVariantPool=preserve;
    personalizedVariantFingerprint=fingerprint;
    renderPersonalizedVariantPool();
    return blueprintStatus("The private pool already meets the "+need.target+"-variant target.");
  }
  generatingVariants=true;button.disabled=true;blueprintStatus("");
  const unique=new Map(preserve.map(item=>[item.variantId,item])),
    summaries=preserve.map(item=>item.summary||item.prompt.slice(0,180));
  document.getElementById("personalizedVariantStatus").textContent=
    "Generating "+need.missing+" additional variant"+(need.missing===1?"":"s")+" with School AI…";
  const loader=window.beginLoading?.("Generating equivalent assessment variants…")||(()=>{});
  try{
    let calls=0,maxCalls=Math.ceil(need.missing/10)+6;
    while(unique.size<need.target&&calls<maxCalls){
      const batchCount=Math.min(10,need.target-unique.size);
      const batch=await generateVariantBatch({count:batchCount,title,taskContext,evalCriteria,guidance,previousSummaries:summaries});
      calls++;
      for(const item of batch){
        const id=(await sha256Text(item.prompt)).slice(0,24);
        if(unique.has(id))continue;
        unique.set(id,{variantId:id,prompt:item.prompt,evaluationNotes:item.evaluationNotes,summary:item.summary});
        summaries.push(item.summary||item.prompt.slice(0,180));
        if(unique.size>=need.target)break;
      }
      document.getElementById("personalizedVariantStatus").textContent=
        "Generating variants… "+unique.size+" of "+need.target+" prepared.";
    }
    if(unique.size<need.target)
      throw Error("Adminerva prepared "+unique.size+" distinct variants, below the "+need.target+" target. Retry or make the variation guidance more specific.");
    if(await currentPersonalizationFingerprint()!==fingerprint)
      throw Error("The blueprint changed while variants were generating. Generate again from the current task and rubric.");
    const generated=[...unique.values()].slice(0,need.target);
    personalizedVariantPool=generated;
    personalizedVariantFingerprint=fingerprint;
    personalizedVariantGeneratedAt=new Date().toISOString();
    personalizationDirty=true;
    renderPersonalizedVariantPool();
    const saved=await persistPersonalizationPool({activate:false,silent:true});
    blueprintStatus(saved
      ?"School AI prepared and autosaved the private pool. Review it, then activate the pool."
      :"School AI prepared the pool in this browser, but private autosave failed. Keep the page open and retry when connectivity returns.");
  }catch(error){
    personalizedVariantPool=preserve;
    personalizedVariantFingerprint=preserve.length?fingerprint:"";
    renderPersonalizedVariantPool();blueprintStatus("Variant generation failed: "+error.message);
  }finally{generatingVariants=false;button.disabled=false;loader();}
};

window.copyExternalPersonalizationPackage=async function(){
  if(!currentAssessmentId)return blueprintStatus("Save the personalized blueprint before exporting a generation package.");
  const fingerprint=await currentPersonalizationFingerprint(),
    preserve=personalizedVariantFingerprint===fingerprint?personalizedVariantPool:[],
    need=variantGenerationNeed(preserve.length);
  if(!need.missing){
    document.getElementById("externalPersonalizationStatus").textContent=
      "The current pool already meets the target. Increase the target if you want additional unused variants.";
    return;
  }
  try{
    const item=assessments.find(value=>value.id===currentAssessmentId)||{},
      plannedBatch=externalPersonalizationBatchSize(item,need.target),
      batchCount=Math.min(plannedBatch,need.missing),
      totalBatches=Math.ceil(need.target/plannedBatch),
      batchIndex=Math.min(totalBatches,Math.floor(preserve.length/plannedBatch)+1);
    const packageText=buildExternalPersonalizationPackage({
      assessment:{
        ...item,
        title:document.getElementById("assessTitle").value.trim(),
        type:document.getElementById("assessType").value,
        subject:document.getElementById("assessSubject").value.trim(),
        maxScore:Number(document.getElementById("maxScore").value),
        taskContext:document.getElementById("taskContext").value.trim()||preparedTaskContext(),
        evalCriteria:document.getElementById("evalCriteria").value.trim()
      },
      guidance:document.getElementById("assessVariantGuidance").value.trim(),
      count:batchCount,batchIndex,totalBatches,
      existingSummaries:preserve.map(value=>value.summary||value.prompt.slice(0,180))
    });
    await navigator.clipboard.writeText(packageText);
    document.getElementById("externalPersonalizationStatus").textContent=
      "Copied external batch "+batchIndex+" of "+totalBatches+" requesting "+batchCount+
      " variant"+(batchCount===1?"":"s")+" ("+need.missing+" remain before this batch). Paste it into the external AI, then import its JSON response below.";
  }catch(error){
    document.getElementById("externalPersonalizationStatus").textContent="Package not copied: "+error.message;
  }
};

window.importExternalPersonalizationResponse=async function(){
  if(!currentAssessmentId)return blueprintStatus("Save the personalized blueprint before importing variants.");
  const raw=document.getElementById("externalPersonalizationResponse").value,
    fingerprint=await currentPersonalizationFingerprint(),
    preserve=personalizedVariantFingerprint===fingerprint?personalizedVariantPool:[],
    need=variantGenerationNeed(preserve.length);
  if(!need.missing){
    document.getElementById("externalPersonalizationStatus").textContent=
      "The private pool already meets the target. Increase the target before importing additional variants.";
    return;
  }
  try{
    const item=assessments.find(value=>value.id===currentAssessmentId)||{},
      expectedBatch=Math.min(externalPersonalizationBatchSize(item,need.target),need.missing);
    const incoming=await parseExternalPersonalizationResponse(raw,{
      expectedCount:expectedBatch,hashPrompt:sha256Text
    });
    const merged=mergeVariantPools(preserve,incoming);
    if(merged.length<preserve.length+incoming.length)
      throw Error("The imported batch repeats a task already in the private pool. Ask the external AI for a replacement distinct variant.");
    if(merged.length>MAX_PERSONALIZED_POOL)throw Error("The combined private pool cannot exceed "+MAX_PERSONALIZED_POOL+" variants.");
    personalizedVariantPool=merged;
    personalizedVariantFingerprint=fingerprint;
    personalizedVariantGeneratedAt=new Date().toISOString();
    personalizationDirty=true;
    renderPersonalizedVariantPool();
    const remaining=Math.max(0,need.target-merged.length);
    document.getElementById("externalPersonalizationStatus").textContent=
      "Imported "+incoming.length+" external variant"+(incoming.length===1?"":"s")+
      (remaining?" · "+remaining+" more needed to reach the target. Copy the next external package when ready.":" · target reached.") ;
    const saved=await persistPersonalizationPool({activate:false,silent:true});
    blueprintStatus(saved
      ?(remaining
        ?"External batch imported and autosaved. Continue with the next package; "+remaining+" variants remain."
        :"Final external batch imported and autosaved. Review the samples, then activate the pool.")
      :"External batch imported in this browser, but autosave failed. Keep this page open and use Activate / update pool after checking connectivity.");
  }catch(error){
    document.getElementById("externalPersonalizationStatus").textContent="Import failed: "+error.message;
  }
};

async function persistPersonalizationPool({activate=false,silent=false}={}){
  if(savingBlueprint||!currentAssessmentId)return false;
  const item=assessments.find(value=>value.id===currentAssessmentId);
  if(!item||item.schemaVersion!==3||item.personalizedTask?.enabled!==true){
    if(!silent)blueprintStatus("This saved blueprint is not an enabled personalized Studio assessment.");
    return false;
  }
  const fingerprint=await currentPersonalizationFingerprint(),
    target=Number(document.getElementById("assessVariantCount").value),
    guidance=document.getElementById("assessVariantGuidance").value.trim(),
    wasReady=Boolean(item.personalizedTask?.poolFingerprint&&Number(item.personalizedTask?.poolSize||0)>0);
  if(personalizedVariantFingerprint!==fingerprint||!personalizedVariantPool.length){
    if(!silent)blueprintStatus("Generate or import a current private variant pool before saving personalization.");
    return false;
  }
  if(!Number.isInteger(target)||target<10||target>MAX_PERSONALIZED_POOL){
    if(!silent)blueprintStatus("Choose a variant target from 10 to "+MAX_PERSONALIZED_POOL+".");
    return false;
  }
  const ready=personalizedVariantPool.length>=target;
  if(activate&&!ready&&!wasReady){
    if(!silent)blueprintStatus("The initial private pool has "+personalizedVariantPool.length+" of "+target+" variants. Finish the remaining batches before activation.");
    return false;
  }
  savingBlueprint=true;
  document.getElementById("savePersonalizationPool").disabled=true;
  const loader=silent?(()=>{}):(window.beginLoading?.(activate?"Activating personalized variant pool…":"Autosaving private variants…")||(()=>{}));
  try{
    const batch=writeBatch(db),now=serverTimestamp();
    for(const variant of personalizedVariantPool){
      batch.set(doc(db,"assessment_private",currentAssessmentId,"variants",variant.variantId),{
        variantId:variant.variantId,fingerprint,
        prompt:variant.prompt,evaluationNotes:variant.evaluationNotes||"",
        summary:variant.summary||"",updatedAt:now
      },{merge:true});
    }
    const activeIds=activate
      ?personalizedVariantPool.map(value=>value.variantId)
      :(Array.isArray(item.personalization?.variantIds)?item.personalization.variantIds:[]);
    batch.set(doc(db,"assessment_private",currentAssessmentId),{
      ownerUid:item.ownerUid,sectionIds:item.sectionIds||[],
      personalization:{
        mode:PERSONALIZATION_MODE,guidance,fingerprint,
        variantIds:activeIds,draftCount:personalizedVariantPool.length,
        generatedAt:personalizedVariantGeneratedAt||new Date().toISOString()
      },updatedAt:now
    },{merge:true});
    if(activate){
      batch.update(doc(db,"assessments",currentAssessmentId),{
        personalizedTask:{
          enabled:true,mode:PERSONALIZATION_MODE,regeneration:"new_attempt",
          uniqueWithinAssessment:true,poolFingerprint:fingerprint,
          poolSize:personalizedVariantPool.length,poolTarget:target
        }
      });
    }
    await batch.commit();
    personalizationDirty=false;
    await loadAssessments();
    const refreshed=assessments.find(value=>value.id===currentAssessmentId);
    if(refreshed){
      personalizedVariantFingerprint=refreshed.personalization?.fingerprint||fingerprint;
      personalizedVariantGeneratedAt=refreshed.personalization?.generatedAt||personalizedVariantGeneratedAt;
      personalizedVariantPool=await loadPersonalizationVariants(currentAssessmentId,refreshed.personalization||{fingerprint});
    }
    renderPersonalizedVariantPool();
    if(!silent){
      if(activate)blueprintStatus(
        "Personalized pool activated with "+personalizedVariantPool.length+" variants. Learners are assigned automatically when they open the task."
      );
      else blueprintStatus(
        "Private variants autosaved as a draft. Activate the pool after the target is ready."
      );
    }
    return true;
  }catch(error){
    if(!silent)blueprintStatus("Personalization pool was not saved: "+error.message);
    return false;
  }finally{
    savingBlueprint=false;
    document.getElementById("savePersonalizationPool").disabled=false;
    loader();
  }
}
window.savePersonalizationPool=async function(){return persistPersonalizationPool({activate:true,silent:false});};

window.applyAssessmentRubric=function(){
  const score=Number(document.getElementById("maxScore").value),selected=document.getElementById("assessmentRubricTemplate").value;
  if(!Number.isFinite(score)||score<1||score>1000){blueprintStatus("Enter a maximum score between 1 and 1,000 before preparing a rubric.");document.getElementById("maxScore").focus();return;}
  try{
    let text;
    if(selected.startsWith("assessment:")){text=assessments.find(item=>item.id===selected.slice(11))?.evalCriteria||"";if(!text)throw Error("This assessment rubric is unavailable. Choose another rubric.");}
    else text=pointsRubric(selected==="balanced"?balancedCriteria:rubricTemplates.get(selected)?.criteria||[],score);
    document.getElementById("evalCriteria").value=text;rubricSource=selected;lastGeneratedRubric=text;
    document.getElementById("assessmentRubricStatus").textContent=selected.startsWith("assessment:")?"Copied the existing assessment rubric. Check its point totals against this task’s maximum score.":"Prepared criteria total "+score+" points. Edit them to match this task before saving.";
    blueprintStatus("");
  }catch(error){blueprintStatus(error.message);}
};
async function loadBlueprintChoices(){
  const results=await Promise.allSettled([getDocs(collection(db,"templates")),loadSchoolOptions()]);
  if(results[0].status==="fulfilled")for(const record of results[0].value.docs){const data=record.data();if(Array.isArray(data.criteria)&&data.criteria.length)rubricTemplates.set("template:"+record.id,{name:data.name||"Saved rubric",criteria:data.criteria});}
  if(results[1].status==="fulfilled"){
    const subjects=subjectFocus.length?results[1].value.subjects.filter(subject=>subjectFocus.includes(subject)):results[1].value.subjects;
    fillSchoolDatalist("assessmentSubjectChoices",subjects);
  }
  refreshRubricChoices();
}
for(const id of ["assessTitle","assessSubject","assessType","taskContext"])document.getElementById(id).addEventListener("input",()=>{
  updateContextPreview();markPersonalizationPossiblyStale();
});
document.getElementById("maxScore").addEventListener("input",()=>{
  if(document.getElementById("evalCriteria").value===lastGeneratedRubric&&!rubricSource.startsWith("assessment:")&&rubricSource!=="manual")window.applyAssessmentRubric();
  else document.getElementById("assessmentRubricStatus").textContent="Maximum score changed. Review the rubric’s point totals; your written criteria were preserved.";
  markPersonalizationPossiblyStale();
});
document.getElementById("evalCriteria").addEventListener("input",()=>{
  document.getElementById("assessmentRubricStatus").textContent="Custom criteria. Check the point totals against the maximum score before saving.";
  markPersonalizationPossiblyStale();
});

window.showBlueprintEditorTab=function(tab){
  const personal=tab==="personalization",
    personalButton=document.getElementById("blueprintPersonalizationTabButton"),
    blueprintButton=document.getElementById("blueprintTabButton");
  if(personal&&personalButton.classList.contains("hidden"))return;
  document.getElementById("blueprintEditorTab").classList.toggle("hidden",personal);
  document.getElementById("blueprintPersonalizationTab").classList.toggle("hidden",!personal);
  blueprintButton.classList.toggle("border-indigo-600",!personal);
  blueprintButton.classList.toggle("text-indigo-700",!personal);
  blueprintButton.classList.toggle("border-transparent",personal);
  blueprintButton.classList.toggle("text-slate-600",personal);
  personalButton.classList.toggle("border-indigo-600",personal);
  personalButton.classList.toggle("text-indigo-700",personal);
  personalButton.classList.toggle("border-transparent",!personal);
  personalButton.classList.toggle("text-slate-600",!personal);
};
function setBlueprintContentLocked(locked,{lockGuidance=Boolean(locked)}={}){
  blueprintContentLocked=Boolean(locked);
  const ids=[
    "assessTitle","maxScore","assessType","assessQuarter","assessSubject","assessSubmissionSource",
    "assessPracticalExam","assessPersonalizedTask","taskContext","assessmentRubricTemplate",
    "assessmentApplyRubric","evalCriteria","assessV2","newTargetPath","assessExpectedExts",
    "assessInvestigationFallback","systemPersona","newRuleType","newRuleValue"
  ];
  for(const id of ids){const node=document.getElementById(id);if(node)node.disabled=blueprintContentLocked;}
  document.getElementById("assessVariantGuidance").disabled=Boolean(lockGuidance);
  if(currentAssessmentId){
    document.getElementById("assessSubmissionSource").disabled=true;
    document.getElementById("assessV2").disabled=true;
  }
  document.getElementById("saveAssessmentBtn").classList.toggle("hidden",blueprintContentLocked);
  if(blueprintContentLocked)
    blueprintStatus(lockGuidance
      ?"Published task details and variation guidance are locked. You may increase the pool target and add unused variants without changing existing learner tasks."
      :"Published task details are locked after deployment. Set the variation guidance and prepare the first private pool; the guidance will lock when that pool is saved.");
}
function updatePersonalizationTabAvailability(){
  const item=currentAssessmentId?assessments.find(value=>value.id===currentAssessmentId):null,
    enabled=document.getElementById("assessPersonalizedTask")?.checked===true,
    studio=document.getElementById("assessSubmissionSource")?.value==="studio",
    visible=Boolean(currentAssessmentId&&item?.schemaVersion===3&&studio&&enabled);
  document.getElementById("blueprintPersonalizationTabButton").classList.toggle("hidden",!visible);
  if(!visible&&document.getElementById("blueprintEditorTab").classList.contains("hidden"))
    window.showBlueprintEditorTab("blueprint");
}
function mergeVariantPools(base,incoming){
  const map=new Map();
  for(const variant of base||[])map.set(variant.variantId,variant);
  for(const variant of incoming||[])map.set(variant.variantId,variant);
  return [...map.values()];
}
function variantGenerationNeed(baseCount=personalizedVariantPool.length){
  const target=Math.max(10,Math.min(MAX_PERSONALIZED_POOL,Number(document.getElementById("assessVariantCount").value)||45));
  return {target,missing:Math.max(0,target-baseCount)};
}
function personalizationSections(item){
  return [...new Set((item?.deployments||[]).map(entry=>entry.section).filter(Boolean))];
}
function recommendedPersonalizationTarget(item){
  const sections=personalizationSections(item),
    learners=sections.reduce((sum,section)=>sum+(sectionStudentCounts.get(section)||0),0),
    recommended=learners?Math.min(MAX_PERSONALIZED_POOL,Math.max(10,learners+(sections.length*5))):45;
  return {sections,learners,recommended};
}
function externalPersonalizationBatchSize(item,target){
  const sectionCount=Math.max(1,personalizationSections(item).length);
  return Math.max(1,Math.min(MAX_EXTERNAL_VARIANT_BATCH,Math.ceil(target/sectionCount)));
}
function renderPersonalizationCoverage(item){
  const node=document.getElementById("personalizationCoverage");
  if(!node)return;
  const {sections,learners,recommended}=recommendedPersonalizationTarget(item),
    input=document.getElementById("assessVariantCount");
  if(sections.length&&!item?.personalizedTask?.poolFingerprint&&Number(input.value)<recommended)
    input.value=String(recommended);
  const target=Math.max(10,Math.min(MAX_PERSONALIZED_POOL,Number(input.value)||recommended)),
    batchSize=externalPersonalizationBatchSize(item,target),
    batches=Math.ceil(target/batchSize);
  node.textContent=sections.length
    ? "Deployed to "+sections.length+" section"+(sections.length===1?"":"s")+" · approximately "+learners+
      " learner"+(learners===1?"":"s")+" · suggested pool target: "+recommended+
      " (5 revision variants per section). External plan at the current target: about "+batches+
      " batch"+(batches===1?"":"es")+" of up to "+batchSize+" variants."
    : "Not deployed yet. External batches default to the current target and are capped at "+MAX_EXTERNAL_VARIANT_BATCH+" variants each.";
}
function escapeHTML(str) {
  if (!str) return "";
  return String(str).replace(
    /[&<>"']/g,
    (match) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[match],
  );
}

function formatPrettyDate(isoString) {
  if (!isoString) return "Not set";
  const date = new Date(isoString);
  if (isNaN(date)) return "Invalid Date";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  if (!db) return;

  fpInstance = flatpickr("#deployDateRange", {
    mode: "range",
    // Historical issue dates are valid when assessments were assigned in class earlier.
    dateFormat: "M j, Y",
    onChange: function (selectedDates) {
      if (selectedDates.length === 2) {
        const post = new Date(selectedDates[0]);
        post.setHours(0, 0, 0, 0);
        document.getElementById("deployPostDate").value = post.toISOString();

        const deadline = new Date(selectedDates[1]);
        deadline.setHours(23, 59, 59, 999);
        document.getElementById("deployDeadline").value =
          deadline.toISOString();
      } else if (selectedDates.length === 1) {
        const post = new Date(selectedDates[0]);
        post.setHours(0, 0, 0, 0);
        document.getElementById("deployPostDate").value = post.toISOString();
        document.getElementById("deployDeadline").value = "";
      } else {
        document.getElementById("deployPostDate").value = "";
        document.getElementById("deployDeadline").value = "";
      }
    },
  });

  window.showSubtleLoader("Loading Assessment Studio...");
  subjectFocus=await resolveStaffSubjects(auth.currentUser);
  await fetchSectionsFromStudents();
  await loadAssessments();
  void loadBlueprintChoices();
  window.hideSubtleLoader();
});

async function fetchSectionsFromStudents() {
  try {
    const snap = await getDocs(collection(db, "students"));
    const uniqueSections=new Set(),counts=new Map();
    snap.forEach((record) => {
      const section=record.data().section;
      if(section){
        uniqueSections.add(section);
        counts.set(section,(counts.get(section)||0)+1);
      }
    });
    allSections=[...uniqueSections].sort();
    sectionStudentCounts=counts;
  } catch (e) {
    console.error("Error fetching sections: ", e);
  }
}

async function loadAssessments() {
  try {
    const q = query(
      collection(db, "assessments"),
      orderBy("createdAt", "desc"),
    );
    const [snap,privateSnap] = await Promise.all([
      getDocs(q),getDocs(collection(db,"assessment_private"))
    ]);
    const privateById=new Map(privateSnap.docs.map(item=>[item.id,item.data()]));
    assessments = [];
    snap.forEach(item => {
      const assessment={
        id:item.id,...item.data(),
        ...([2,3].includes(item.data().schemaVersion) ? (privateById.get(item.id)||{}) : {})
      };
      if(!subjectFocus.length||!assessment.subject||subjectFocus.includes(assessment.subject))assessments.push(assessment);
    });
    renderAssessmentGrid();
    refreshRubricChoices();
  } catch (e) {
    console.error("Error loading assessments: ", e);
  }
}

function getTypeStyle(type) {
  if (type === "Mini PETA")
    return "bg-purple-500/20 text-purple-600 border-purple-500/30";
  if (type === "Practical Exam")
    return "bg-red-500/20 text-red-600 border-red-500/30";
  if (type === "Formative")
    return "bg-green-500/20 text-green-600 border-green-500/30";
  return "bg-blue-500/20 text-blue-600 border-blue-500/30";
}

function renderAssessmentGrid() {
  const grid = document.getElementById("assessmentGrid");
  grid.innerHTML = "";

  if (assessments.length === 0) {
    grid.innerHTML = `<div class="col-span-full py-12 text-center text-gray-400 italic border-2 border-dashed border-gray-300 rounded-lg">No assessments created yet. Click "+ New Blueprint" to start.</div>`;
    return;
  }

  assessments.forEach((item) => {
    const deployments = item.deployments || [];
    const uniqueSections = [...new Set(deployments.map((d) => d.section))];

    const sectionsHtml = uniqueSections
      .map(
        (sec) =>
          `<span class="bg-gray-100 text-gray-600 text-[10px] px-2 py-1 rounded-full font-bold shadow-sm">${escapeHTML(sec)}</span>`,
      )
      .join("");

    const card = `
            <div class="bg-white border rounded-xl shadow-sm hover:shadow-md transition cursor-pointer flex flex-col overflow-hidden" onclick="window.openViewModal('${item.id}')">
                <div class="bg-slate-800 p-4 border-b border-slate-700">
                    <div class="flex justify-between items-start mb-2">
                        <span class="${getTypeStyle(item.type)} text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider">${escapeHTML(item.type)}</span>
                        <span class="text-slate-400 hover:text-white transition">⋮</span>
                    </div>
                    <h3 class="font-bold text-white text-lg truncate" title="${escapeHTML(item.title)}">${escapeHTML(item.title)}</h3>\n                    ${item.subject ? `<p class="text-xs text-cyan-200 mt-1 truncate">${escapeHTML(item.subject)}</p>` : ""}
                </div>
                <div class="p-4 flex-1 flex flex-col">
                    <p class="text-sm text-gray-600 line-clamp-2 mb-4">${escapeHTML(item.taskContext || "No context provided.")}</p>
                    <div class="mt-auto">
                        <div class="text-[10px] font-bold text-gray-400 uppercase mb-1 flex justify-between">
                            <span>Deployed To</span>
                            <span class="text-blue-500">${deployments.length} Active Deployments</span>
                        </div>
                        <div class="flex flex-wrap gap-1">
                            ${sectionsHtml || `<span class="text-xs text-gray-400 italic">Template Only - Not Deployed</span>`}
                        </div>
                    </div>
                </div>
            </div>
        `;
    grid.insertAdjacentHTML("beforeend", card);
  });
}

function updatePersonalizedTaskOption(){
  const studio=document.getElementById("assessSubmissionSource").value==="studio";
  const enabled=studio&&document.getElementById("assessPersonalizedTask").checked;
  document.getElementById("assessPersonalizedTask").disabled=!studio;
  document.getElementById("personalizedTaskOption").classList.toggle("opacity-60",!studio);
  document.getElementById("personalizedTaskSettings").classList.toggle("hidden",!enabled);
  updatePersonalizationTabAvailability();
  if(enabled)renderPersonalizedVariantPool();
}
function updatePracticalExamOption(){
  const studio=document.getElementById("assessSubmissionSource").value==="studio";
  document.getElementById("assessPracticalExam").disabled=!studio;
  document.getElementById("practicalExamOption").classList.toggle("opacity-60",!studio);
  updatePersonalizedTaskOption();
}
document.getElementById("assessPersonalizedTask").addEventListener("change",updatePersonalizedTaskOption);
document.getElementById("assessVariantGuidance").addEventListener("input",markPersonalizationPossiblyStale);
document.getElementById("assessVariantCount").addEventListener("input",()=>{
  if(!personalizedVariantPool.length)return renderPersonalizedVariantPool();
  const need=variantGenerationNeed();
  document.getElementById("personalizedVariantStatus").textContent=need.missing
    ?"Current private pool: "+personalizedVariantPool.length+". Add "+need.missing+" more to reach the "+need.target+" target."
    :"Current private pool meets the "+need.target+" target with "+personalizedVariantPool.length+" variants.";
});
async function autosavePersonalizationSafety(){
  if(!personalizationDirty||savingBlueprint||!currentAssessmentId)return;
  await persistPersonalizationPool({activate:false,silent:true});
}
window.addEventListener("blur",()=>{void autosavePersonalizationSafety();});
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="hidden")void autosavePersonalizationSafety();
});
document.getElementById("assessSubmissionSource").addEventListener("change",()=>{
  updatePracticalExamOption();
  if(!currentAssessmentId&&document.getElementById("assessSubmissionSource").value==="studio"&&
    document.getElementById("assessType").value==="Practical Exam")
    document.getElementById("assessPracticalExam").checked=true;
});
document.getElementById("assessType").addEventListener("change",event=>{
  if(event.target.value==="Practical Exam"&&document.getElementById("assessSubmissionSource").value==="studio")
    document.getElementById("assessPracticalExam").checked=true;
});
window.openCreateModal = function () {
  currentAssessmentId = null;
  setBlueprintContentLocked(false);
  document.getElementById("blueprintPersonalizationTabButton").classList.add("hidden");
  window.showBlueprintEditorTab("blueprint");
  document.getElementById("externalPersonalizationResponse").value="";
  document.getElementById("externalPersonalizationStatus").textContent="";
  document.getElementById("createModalTitle").textContent =
    "Create Assessment Blueprint";
  document.getElementById("saveAssessmentBtn").textContent = "Save Blueprint";

  document.getElementById("assessTitle").value = "";
  document.getElementById("maxScore").value = "20";
  document.getElementById("assessType").value = "Mini PETA";
  document.getElementById("assessQuarter").value=assessments.find(item=>["Q1","Q2","Q3","Q4"].includes(item.quarter))?.quarter||"Q1";
  document.getElementById("assessSubject").value=subjectFocus.length===1?subjectFocus[0]:"";
  document.getElementById("assessSubmissionSource").value="repository";
  document.getElementById("assessSubmissionSource").disabled=false;
  document.getElementById("assessPracticalExam").checked=false;
  document.getElementById("assessPersonalizedTask").checked=false;
  document.getElementById("assessVariantGuidance").value="";
  document.getElementById("assessVariantCount").value="45";
  personalizedVariantPool=[];personalizedVariantFingerprint="";personalizedVariantGeneratedAt="";
  updatePracticalExamOption();renderPersonalizedVariantPool();
  document.getElementById("assessV2").checked = true;
  document.getElementById("assessV2").disabled = false;
  document.getElementById("assessExpectedExts").value = "";
  document.getElementById("assessInvestigationFallback").checked = true;
  document.getElementById("systemPersona").value =
    defaultPersona;
  document.getElementById("taskContext").value = "";
  document.getElementById("evalCriteria").value = "";
  refreshRubricChoices();
  const equipped="template:"+(localStorage.getItem("Adminerva_active_template_id")||"");
  document.getElementById("assessmentRubricTemplate").value=rubricTemplates.has(equipped)?equipped:"balanced";
  window.applyAssessmentRubric();updateContextPreview();blueprintStatus("");
  document.getElementById("blueprintAdvanced").open=false;document.getElementById("blueprintInstructions").open=false;

  objectiveRules = [];
  targetPaths = []; // Clear array
  renderRules();
  renderTargets(); // Render UI

  document.getElementById("createModal").classList.remove("hidden");
  document.getElementById("assessTitle").focus();
};
window.openEditModal = async function () {
  const item = assessments.find((a) => a.id === currentAssessmentId);
  if (!item) return;
  const deployedStudio=item.schemaVersion===3&&(item.deployments||[]).length>0;
  if(deployedStudio&&item.personalizedTask?.enabled!==true){
    alert("This deployed Studio blueprint is protected. Edit its deployment schedule separately or create a new blueprint for changed requirements.");
    return;
  }

  document.getElementById("createModalTitle").textContent =
    deployedStudio?"Personalized Assessment":"Edit Blueprint";
  document.getElementById("saveAssessmentBtn").textContent = "Update Blueprint";

  document.getElementById("assessTitle").value = item.title || "";
  document.getElementById("maxScore").value = item.maxScore || 20;
  document.getElementById("assessType").value = item.type || "Mini PETA";
  document.getElementById("assessQuarter").value = item.quarter || "";
  document.getElementById("assessSubmissionSource").value=item.schemaVersion===3?"studio":"repository";
  document.getElementById("assessSubmissionSource").disabled=true;
  document.getElementById("assessPracticalExam").checked=item.practicalExam===true;
  document.getElementById("assessPersonalizedTask").checked=item.personalizedTask?.enabled===true;
  document.getElementById("assessVariantGuidance").value=item.personalization?.guidance||"";
  document.getElementById("assessVariantCount").value=String(item.personalizedTask?.poolTarget||item.personalization?.variantIds?.length||45);
  personalizedVariantFingerprint=typeof item.personalization?.fingerprint==="string"?item.personalization.fingerprint:"";
  personalizedVariantGeneratedAt=typeof item.personalization?.generatedAt==="string"?item.personalization.generatedAt:"";
  personalizedVariantPool=await loadPersonalizationVariants(item.id,item.personalization||{});
  personalizationDirty=false;
  updatePracticalExamOption();renderPersonalizedVariantPool();
  document.getElementById("assessV2").checked = item.schemaVersion === 2;
  document.getElementById("assessV2").disabled = true; // Never silently convert a legacy record.
  document.getElementById("assessExpectedExts").value =
    Array.isArray(item.expectedExtensions) ? item.expectedExtensions.join(", ") : "";
  document.getElementById("assessInvestigationFallback").checked =
    item.investigationFallback !== false;
  document.getElementById("systemPersona").value = item.systemPersona || "";
  document.getElementById("taskContext").value = item.taskContext || "";
  document.getElementById("evalCriteria").value = item.evalCriteria || "";
  document.getElementById("assessSubject").value=item.subject||"";rubricSource="manual";lastGeneratedRubric="";
  refreshRubricChoices();document.getElementById("assessmentRubricTemplate").value="balanced";
  if(!document.getElementById("evalCriteria").value.trim())window.applyAssessmentRubric();
  if(!document.getElementById("systemPersona").value.trim())document.getElementById("systemPersona").value=defaultPersona;
  updateContextPreview();blueprintStatus("");document.getElementById("assessmentRubricStatus").textContent="Your saved rubric is preserved. Use a template only if you want to replace it.";
  document.getElementById("blueprintAdvanced").open=false;document.getElementById("blueprintInstructions").open=false;

  objectiveRules = [...(item.rules || [])];
  // Load array, or fallback to the old single string if it exists
  targetPaths = [
    ...(item.targetPaths || (item.targetPath ? [item.targetPath] : [])),
  ];

  renderRules();
  renderTargets(); // Render UI

  document.getElementById("externalPersonalizationResponse").value="";
  document.getElementById("externalPersonalizationStatus").textContent="";
  updatePersonalizationTabAvailability();
  renderPersonalizationCoverage(item);
  setBlueprintContentLocked(deployedStudio,{
    lockGuidance:deployedStudio&&Boolean(item.personalizedTask?.poolFingerprint)
  });
  window.showBlueprintEditorTab(deployedStudio&&item.personalizedTask?.enabled===true?"personalization":"blueprint");
  document.getElementById("viewModal").classList.add("hidden");
  document.getElementById("createModal").classList.remove("hidden");
};

// 5. UPDATE saveAssessment to save the array instead of a string
window.saveAssessment = async function () {
  if(savingBlueprint)return;
  if(blueprintContentLocked)return blueprintStatus("Published task details are locked. Use Save private variant pool on the Personalization tab.");
  const title = document.getElementById("assessTitle").value.trim();
  if (!title){blueprintStatus("Enter an assessment title.");document.getElementById("assessTitle").focus();return;}
  const score=Number(document.getElementById("maxScore").value),criteria=document.getElementById("evalCriteria").value.trim(),actor=auth.currentUser;
  const subject=document.getElementById("assessSubject").value.trim();
  if(!actor?.uid){blueprintStatus("Sign in to your staff account before saving.");return;}
  if(subjectFocus.length&&(!subject||!subjectFocus.includes(subject))){blueprintStatus("Choose one of your assigned subjects before saving this assessment.");document.getElementById("assessSubject").focus();return;}
  if(!Number.isFinite(score)||score<1||score>1000){blueprintStatus("Maximum score must be between 1 and 1,000.");document.getElementById("maxScore").focus();return;}
  if(!criteria){blueprintStatus("Use a prepared rubric or enter your evaluation criteria before saving.");document.getElementById("evalCriteria").focus();return;}

  const prior = currentAssessmentId ? assessments.find(a=>a.id===currentAssessmentId) : null;
  const studio=prior ? prior.schemaVersion===3 : document.getElementById("assessSubmissionSource").value==="studio";
  const v2=prior ? prior.schemaVersion===2 : (!studio&&document.getElementById("assessV2").checked);
  const practicalExam=studio&&document.getElementById("assessPracticalExam").checked;
  const personalizedEnabled=studio&&document.getElementById("assessPersonalizedTask").checked;
  const variationGuidance=personalizedEnabled?document.getElementById("assessVariantGuidance").value.trim():"";
  const poolTarget=personalizedEnabled?Number(document.getElementById("assessVariantCount").value):0;
  if(personalizedEnabled&&(!Number.isInteger(poolTarget)||poolTarget<10||poolTarget>MAX_PERSONALIZED_POOL)){
    blueprintStatus("Choose a personalized variant pool size from 10 to "+MAX_PERSONALIZED_POOL+".");return;
  }
  const currentFingerprint=personalizedEnabled?await currentPersonalizationFingerprint():"";
  const poolFresh=personalizedEnabled&&personalizedVariantPool.length>0&&
    personalizedVariantFingerprint===currentFingerprint;
  const poolReady=poolFresh&&personalizedVariantPool.length>=poolTarget;
  const personalizedTask=personalizedEnabled
    ? {enabled:true,mode:PERSONALIZATION_MODE,regeneration:"new_attempt",uniqueWithinAssessment:true,
       poolFingerprint:poolReady?currentFingerprint:"",poolSize:poolReady?personalizedVariantPool.length:0,poolTarget}
    : {enabled:false};
  const payload = {
    ownerUid:prior?.ownerUid||actor.uid,
    sectionIds:prior?.sectionIds||[...new Set((prior?.deployments||[]).map(deployment=>deployment.section))],
    ...(v2?{schemaVersion:2,evidenceMode:"commit_selection",checkpointMode:"individual"}:{}),
    ...(studio?{schemaVersion:3,submissionSource:"studio",evidenceMode:"studio_snapshot",practicalExam,personalizedTask}:{}),
    title: title,
    type: document.getElementById("assessType").value,
    maxScore: score,
    quarter: document.getElementById("assessQuarter").value,
    subject,
    targetPaths: targetPaths, // Legacy path arrays are preserved.
    expectedExtensions: [...new Set(document.getElementById("assessExpectedExts").value
      .split(",").map(e => e.trim().toLowerCase().replace(/^\./, "")).filter(e => /^[a-z0-9]{1,12}$/.test(e)))],
    investigationFallback: document.getElementById("assessInvestigationFallback").checked,
    gradingMode: currentAssessmentId
      ? (assessments.find(a => a.id === currentAssessmentId)?.gradingMode || "individual")
      : "individual",
    taskContext: document.getElementById("taskContext").value.trim()||preparedTaskContext(),
    evalCriteria: criteria,
  };

  savingBlueprint=true;document.getElementById("saveAssessmentBtn").disabled=true;blueprintStatus("Saving the assessment and rubric…");
  window.showSubtleLoader("Saving Blueprint...");

  try {
    const teacherOnly={
      ownerUid:payload.ownerUid,sectionIds:payload.sectionIds,subject:payload.subject,
      systemPersona:document.getElementById("systemPersona").value.trim()||defaultPersona,
      rules:objectiveRules,
      personalization:personalizedEnabled?{
        mode:PERSONALIZATION_MODE,guidance:variationGuidance,
        fingerprint:poolFresh?currentFingerprint:"",
        variantIds:poolFresh?personalizedVariantPool.map(item=>item.variantId):[],
        generatedAt:poolFresh?personalizedVariantGeneratedAt:""
      }:{mode:PERSONALIZATION_MODE,guidance:"",fingerprint:"",variantIds:[],generatedAt:""},
      updatedAt:serverTimestamp()
    };
    if(auth.currentUser?.uid!==actor.uid)throw Error("Account changed. Reload before saving this assessment.");
    if(v2||studio){
      const ref=currentAssessmentId
        ? doc(db,"assessments",currentAssessmentId)
        : doc(collection(db,"assessments"));
      const batch=writeBatch(db);
      if(!currentAssessmentId){
        payload.deployments=[];
        payload.createdAt=serverTimestamp();
      }
      batch.set(ref,payload,{merge:Boolean(currentAssessmentId)});
      batch.set(doc(db,"assessment_private",ref.id),teacherOnly);
      await batch.commit();
    }else if(currentAssessmentId){
      await updateDoc(doc(db,"assessments",currentAssessmentId),{
        ...payload,systemPersona:teacherOnly.systemPersona,rules:objectiveRules
      });
    }else{
      payload.deployments=[];
      payload.createdAt=serverTimestamp();
      await addDoc(collection(db,"assessments"),{
        ...payload,systemPersona:teacherOnly.systemPersona,rules:objectiveRules
      });
    }
    if(personalizedEnabled&&!poolFresh)
      blueprintStatus("Blueprint saved, but personalized variants must be generated before deployment.");
    window.closeModals();
    await loadAssessments();
  } catch (e) {
    blueprintStatus("Could not save: "+e.message+". Your entered task and rubric are preserved.");
  } finally {
    savingBlueprint=false;document.getElementById("saveAssessmentBtn").disabled=false;
    window.hideSubtleLoader();
  }
};

window.deleteAssessment = async function () {
  if (!currentAssessmentId) return;
  if([2,3].includes(assessments.find(item=>item.id===currentAssessmentId)?.schemaVersion))
    return alert("V2 blueprints are retained to protect evidence and grade history. Remove their deployments to stop new submissions; do not delete the assessment.");
  if (
    confirm(
      "Are you sure you want to permanently delete this Assessment Blueprint? It will be immediately revoked from all deployed sections.",
    )
  ) {
    window.showSubtleLoader("Deleting Blueprint...");
    try {
      const item=assessments.find(a=>a.id===currentAssessmentId);
      if([2,3].includes(item?.schemaVersion)){
        if((item.deployments||[]).length)throw Error(
          "Withdraw all deployments before deleting a V2 blueprint.");
        const [evidence,grades]=await Promise.all([
          getDocs(query(collection(db,"assessment_evidence"),
            where("assessmentId","==",currentAssessmentId),limit(1))),
          getDocs(query(collection(db,"student_grades"),
            where("taskId","==",currentAssessmentId),limit(1)))
        ]);
        if(!evidence.empty||!grades.empty)throw Error(
          "This assessment has evidence or grades and cannot be deleted. Archive it instead.");
        const batch=writeBatch(db);
        batch.delete(doc(db,"assessment_private",currentAssessmentId));
        batch.delete(doc(db,"assessments",currentAssessmentId));
        await batch.commit();
      }else{
        await deleteDoc(doc(db,"assessments",currentAssessmentId));
      }
      window.closeModals();
      await loadAssessments();
    } catch (e) {
      alert("Error deleting: " + e.message);
    } finally {
      window.hideSubtleLoader();
    }
  }
};

window.openViewModal = function (id) {
  const item = assessments.find((a) => a.id === id);
  if (!item) return;

  currentAssessmentId = id;
  document.getElementById("viewTitle").textContent = item.title || "Untitled";

  // Format array for viewing
  const paths = item.targetPaths || (item.targetPath ? [item.targetPath] : []);
  document.getElementById("viewTargetPath").textContent =
    item.schemaVersion===3
      ? (item.personalizedTask?.enabled
        ? "Work area: Adminerva Studio · Personalized task variant per attempt · "+Number(item.personalizedTask?.poolSize||0)+" ready"
        : "Work area: Adminerva Studio project snapshot")
      : paths.length > 0
        ? `Targets: ${paths.join(" OR ")}`
        : "Target: Entire Repository";
  document.getElementById("viewTaskContext").textContent =
    item.taskContext || "No context provided.";
  document.getElementById("viewEvalCriteria").textContent =
    item.evalCriteria || "No rubric provided.";
  document.getElementById("viewSystemPersona").textContent =
    item.systemPersona || "No persona set.";

  const badge = document.getElementById("viewTypeBadge");
  badge.textContent = item.type || "Unknown";
  badge.className = `text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider inline-block ${getTypeStyle(item.type)}`;

  const rulesList = document.getElementById("viewObjectiveRules");
  rulesList.innerHTML = "";
  if (item.rules && item.rules.length > 0) {
    item.rules.forEach((rule) => {
      const color =
        rule.type === "Banned"
          ? "text-red-500 bg-red-50"
          : "text-green-600 bg-green-50";
      rulesList.insertAdjacentHTML(
        "beforeend",
        `<li><span class="font-mono ${color} px-1 rounded">${escapeHTML(rule.type)}: ${escapeHTML(rule.value)}</span></li>`,
      );
    });
  } else {
    rulesList.innerHTML = `<li class="text-gray-400 italic text-xs">No objective filters set.</li>`;
  }

  renderDeploymentsTable(item.deployments || []);
  document.getElementById("viewModal").classList.remove("hidden");
};

window.closeModals = function () {
  document.getElementById("createModal").classList.add("hidden");
  document.getElementById("viewModal").classList.add("hidden");
  document.getElementById("deployModal").classList.add("hidden");
};

// ==========================================
// DEPLOYMENT LOGIC (DATES & DEADLINES)
// ==========================================
function renderDeploymentsTable(deployments) {
  const tbody = document.getElementById("deploymentsTableBody");
  tbody.innerHTML = "";

  if (deployments.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="px-4 py-6 text-center text-gray-400 italic">No active deployments. Click "Deploy Task" above to assign to sections.</td></tr>`;
    return;
  }

  const sorted = [...deployments].sort(
    (a, b) => (Date.parse(a.deadline) || 0) - (Date.parse(b.deadline) || 0),
  );

  sorted.forEach((deploy) => {
    tbody.insertAdjacentHTML(
      "beforeend",
      `
            <tr class="border-b last:border-0 hover:bg-gray-50 transition">
                <td class="px-4 py-3 font-bold text-gray-800">${escapeHTML(deploy.section)}</td>
                <td class="px-4 py-3">${formatPrettyDate(deploy.postDate)}</td>
                <td class="px-4 py-3 font-bold text-blue-600">${deploy.deadlineEnabled === false ? "No deadline" : formatPrettyDate(deploy.deadline)}</td>
                <td class="px-4 py-3 text-right">
                    <button onclick="window.openDeployModal('${deploy.id}')" class="text-xs font-bold text-slate-500 hover:text-slate-800 mr-2">Edit</button>
                    <button onclick="window.deleteDeployment('${deploy.id}')" class="text-xs font-bold text-red-400 hover:text-red-600">Remove</button>
                </td>
            </tr>
        `,
    );
  });
}

function updatePresetUI(activeBtn) {
  document.querySelectorAll(".range-preset-btn").forEach((btn) => {
    btn.classList.remove("bg-blue-50", "border-blue-300", "text-blue-600");
    btn.classList.add("bg-white", "border-gray-300", "text-gray-600");
  });
  if (activeBtn) {
    activeBtn.classList.remove("bg-white", "border-gray-300", "text-gray-600");
    activeBtn.classList.add("bg-blue-50", "border-blue-300", "text-blue-600");
  }
}

window.setDeployRange = function (days, btnElement) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const endDate = new Date(today);
  endDate.setDate(today.getDate() + days);

  fpInstance.setDate([today, endDate], true);
  updatePresetUI(btnElement);
};

window.openCustomRange = function (btnElement) {
  updatePresetUI(btnElement);
  fpInstance.open();
};

window.toggleDeployDeadline = function () {
  const checkbox = document.getElementById("deployUseDeadline");
  const fields = document.getElementById("deployScheduleFields");
  if (checkbox && fields) fields.classList.toggle("hidden", !checkbox.checked);
};

window.openDeployModal = function (deployId = null) {
  const item = assessments.find((a) => a.id === currentAssessmentId);
  if (!item) return;

  updatePresetUI(null);

  if (deployId) {
    const deploy = (item.deployments || []).find((d) => d.id === deployId);
    document.getElementById("deployModalTitle").textContent = "Edit Deployment";
    document.getElementById("deploySaveBtn").textContent = "Update";
    document.getElementById("deployId").value = deploy.id;

    deploySelectedSections = [deploy.section];
    document.getElementById("deployUseDeadline").checked = deploy.deadlineEnabled !== false;
    if (deploy.postDate && deploy.deadline) {
      fpInstance.setDate([new Date(deploy.postDate), new Date(deploy.deadline)], true);
    } else fpInstance.clear();

    document.getElementById("deploySectionSelector").classList.add("hidden");
    document.getElementById("deployEditNotice").classList.remove("hidden");
  } else {
    document.getElementById("deployModalTitle").textContent = "Deploy Task";
    document.getElementById("deploySaveBtn").textContent = "Deploy";
    document.getElementById("deployId").value = "";

    deploySelectedSections = [];
    document.getElementById("deployUseDeadline").checked = false;
    fpInstance.clear();

    document.getElementById("deploySectionSelector").classList.remove("hidden");
    document.getElementById("deployEditNotice").classList.add("hidden");
  }

  renderDeployChips();
  updateDeployDropdown();
  window.toggleDeployDeadline();
  document.getElementById("deployModal").classList.remove("hidden");
};

function updateDeployDropdown() {
  const selector = document.getElementById("deploySectionSelector");
  selector.innerHTML = `<option value="" disabled selected>+ Select sections to deploy to...</option>`;

  const item = assessments.find((a) => a.id === currentAssessmentId);
  const existingDeployments = item
    ? (item.deployments || []).map((d) => d.section)
    : [];

  const available = allSections.filter(sec=>
    !deploySelectedSections.includes(sec) &&
    (Boolean(document.getElementById("deployId").value)||!existingDeployments.includes(sec))
  );

  available.forEach((sec) => {
    const label = existingDeployments.includes(sec)
      ? `${escapeHTML(sec)} (Already Deployed)`
      : escapeHTML(sec);
    selector.insertAdjacentHTML(
      "beforeend",
      `<option value="${escapeHTML(sec)}">${label}</option>`,
    );
  });
}

function renderDeployChips() {
  const container = document.getElementById("deployChipsContainer");
  container.innerHTML = "";

  if (deploySelectedSections.length === 0) {
    container.innerHTML = `<span class="text-xs text-gray-400 italic py-1">No sections selected.</span>`;
    return;
  }

  const isEditing = !!document.getElementById("deployId").value;

  deploySelectedSections.forEach((sec) => {
    const removeBtn = isEditing
      ? ""
      : `<button onclick="window.removeDeployChip('${escapeHTML(sec)}')" class="hover:text-red-500 ml-1 focus:outline-none">&times;</button>`;
    container.insertAdjacentHTML(
      "beforeend",
      `
            <span class="bg-blue-100 text-blue-800 text-xs px-2.5 py-1 rounded-full font-bold flex items-center gap-1 border border-blue-200 shadow-sm">
                ${escapeHTML(sec)} ${removeBtn}
            </span>
        `,
    );
  });
}

window.addDeployChip = function (section) {
  if (!section || deploySelectedSections.includes(section)) return;
  deploySelectedSections.push(section);
  document.getElementById("deploySectionSelector").value = "";
  renderDeployChips();
  updateDeployDropdown();
};

window.removeDeployChip = function (section) {
  deploySelectedSections = deploySelectedSections.filter((s) => s !== section);
  renderDeployChips();
  updateDeployDropdown();
};

window.saveDeployment = async function () {
  if (!currentAssessmentId||savingDeployment) return;

  const deployId = document.getElementById("deployId").value;
  const deadlineEnabled = document.getElementById("deployUseDeadline").checked;
  const postDate = deadlineEnabled ? document.getElementById("deployPostDate").value : null;
  const deadline = deadlineEnabled ? document.getElementById("deployDeadline").value : null;

  if (deploySelectedSections.length === 0) {
    return alert("Choose at least one class section.");
  }
  const dateError=validateDeploymentDates({postDate,deadline,deadlineEnabled});
  if(dateError)return alert(dateError);

  const item = assessments.find((a) => a.id === currentAssessmentId);
  if(!item)return alert("Assessment unavailable. Refresh the page and try again.");
  if(item.personalizedTask?.enabled===true&&Number(item.personalizedTask?.poolSize||0)<1){
    const proceed=confirm(
      "This personalized assessment has no saved variant pool yet. You may deploy it now and prepare variants from the Personalization tab, but students cannot open the Studio task until a pool is saved. Continue deployment?"
    );
    if(!proceed)return;
  }
  let deployments = [...(item.deployments || [])];
  if(!deployId){
    const duplicates=deploySelectedSections.filter(section=>deployments.some(entry=>entry.section===section));
    if(duplicates.length)return alert("Already deployed to "+duplicates.join(", ")+". Use Edit beside that class to change the schedule.");
  }
  if (deployId) {
    const index = deployments.findIndex((d) => d.id === deployId);
    if (index > -1) {
      deployments[index] = {
        id: deployId,
        section: deploySelectedSections[0],
        postDate,
        deadline,
        deadlineEnabled,
      };
    }
  } else {
    deploySelectedSections.forEach((section) => {
      deployments.push({
        id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
        section: section,
        postDate: postDate,
        deadline: deadline,
        deadlineEnabled,
      });
    });
  }

  savingDeployment=true;
  document.getElementById("deploySaveBtn").disabled=true;
  window.showSubtleLoader("Applying deployment schedule...");
  try {
    await saveDeploymentScope(item,deployments);
    document.getElementById("deployModal").classList.add("hidden");
    await loadAssessments();
    window.openViewModal(currentAssessmentId);
  } catch (e) {
    alert("Failed to deploy: " + e.message);
  } finally {
    savingDeployment=false;
    document.getElementById("deploySaveBtn").disabled=false;
    window.hideSubtleLoader();
  }
};

window.deleteDeployment = async function (deployId) {
  if (!currentAssessmentId||savingDeployment) return;
  if (
    confirm(
      "Remove this deployment? The assignment will be withdrawn from the section.",
    )
  ) {
    const item = assessments.find((a) => a.id === currentAssessmentId);
    const deployments = (item.deployments || []).filter(
      (d) => d.id !== deployId,
    );

    savingDeployment=true;
    document.getElementById("deploySaveBtn").disabled=true;
    window.showSubtleLoader("Removing deployment...");
    try {
      await saveDeploymentScope(item,deployments);
      await loadAssessments();
      window.openViewModal(currentAssessmentId);
    } catch (e) {
      alert("Error: " + e.message);
    } finally {
      savingDeployment=false;
      document.getElementById("deploySaveBtn").disabled=false;
      window.hideSubtleLoader();
    }
  }
};

async function saveDeploymentScope(item,deployments){
  if(new Set(deployments.map(entry=>entry.section)).size!==deployments.length)
    throw Error("A class can have only one deployment of the same assessment. Edit its existing schedule instead.");
  if(deployments.length>20)throw Error("An assessment supports at most 20 deployments. Create another blueprint for additional sections.");
  const sectionIds=[...new Set(deployments.map(deployment=>deployment.section))];
  const batch=writeBatch(db);
  const windows={};
  if(item.schemaVersion===3){
    for(const deployment of deployments){
      const opens=deployment.postDate?new Date(deployment.postDate):new Date(0);
      const closes=deployment.deadlineEnabled!==false&&deployment.deadline
        ?new Date(deployment.deadline):new Date("2100-01-01T00:00:00.000Z");
      if(!Number.isFinite(opens.getTime())||!Number.isFinite(closes.getTime())||opens>closes)
        throw Error("A Studio submission schedule is invalid.");
      windows[deployment.section]={opensAt:Timestamp.fromDate(opens),closesAt:Timestamp.fromDate(closes)};
    }
  }
  batch.update(doc(db,"assessments",item.id),{
    deployments,sectionIds,...(item.schemaVersion===3?{studioWindows:windows}:{})
  });
  if([2,3].includes(item.schemaVersion))batch.set(doc(db,"assessment_private",item.id),{ownerUid:item.ownerUid,sectionIds},{merge:true});
  await batch.commit();
}

// ==========================================
// DYNAMIC RULES BUILDER
// ==========================================
window.addObjectiveRule = function () {
  const type = document.getElementById("newRuleType").value;
  const value = document.getElementById("newRuleValue").value.trim();
  if (!value) return;
  objectiveRules.push({ type, value });
  document.getElementById("newRuleValue").value = "";
  renderRules();
};

window.removeObjectiveRule = function (index) {
  objectiveRules.splice(index, 1);
  renderRules();
};

function renderRules() {
  const container = document.getElementById("rulesContainer");
  container.innerHTML = "";
  if (objectiveRules.length === 0) {
    container.innerHTML = `<div class="text-xs text-gray-400 italic">No objective rules added.</div>`;
    return;
  }
  objectiveRules.forEach((rule, index) => {
    const colorClass =
      rule.type === "Banned"
        ? "text-red-600 bg-red-50 border-red-200"
        : "text-green-600 bg-green-50 border-green-200";
    container.insertAdjacentHTML(
      "beforeend",
      `
            <div class="flex justify-between items-center p-2 rounded border ${colorClass} text-sm font-mono shadow-sm">
                <div><span class="font-bold text-[10px] uppercase tracking-wider">${rule.type}:</span> ${escapeHTML(rule.value)}</div>
                <button onclick="window.removeObjectiveRule(${index})" class="text-gray-400 hover:text-red-600 font-bold">&times;</button>
            </div>
        `,
    );
  });
}
window.addTarget = function () {
  const val = document.getElementById("newTargetPath").value.trim();
  if (!val) return;
  targetPaths.push(val);
  document.getElementById("newTargetPath").value = "";
  renderTargets();
};

window.removeTarget = function (index) {
  targetPaths.splice(index, 1);
  renderTargets();
};

function renderTargets() {
  const container = document.getElementById("targetsContainer");
  container.innerHTML = "";
  if (targetPaths.length === 0) {
    container.innerHTML = `<div class="text-xs text-gray-400 italic">No specific paths set. (Will scan entire repository)</div>`;
    return;
  }
  targetPaths.forEach((path, index) => {
    container.insertAdjacentHTML(
      "beforeend",
      `
      <div class="flex justify-between items-center p-2 rounded border border-blue-200 bg-blue-50 text-blue-700 text-sm font-mono shadow-sm">
          <div>${escapeHTML(path)}</div>
          <button type="button" onclick="window.removeTarget(${index})" class="text-blue-400 hover:text-red-600 font-bold text-lg leading-none">&times;</button>
      </div>
      `,
    );
  });
}
