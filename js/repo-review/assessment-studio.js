/** Assessment authoring, repository evidence, individual review and protected grading: assessment studio. */
import { app,db,auth } from "../core/firebase-core.js?v=1.3.0";
import {validateDeploymentDates} from "./assessment-dates.mjs?v=1.3.0";
import {resolveStaffSubjects} from "../core/staff-session.mjs?v=1.3.10";
import {ownedDoc,requireStaffWorkspace,lessonStorage} from "../lesson-review/workspace-session.mjs?v=1.3.0";
import {scheduleScope,parseScheduleRows} from "../lesson-review/schedule-scope.mjs?v=1.3.0";
import {generateSchoolContent} from "../core/school-ai.mjs?v=4.0.0";
import {
  buildExternalPersonalizationPackage,
  parseExternalPersonalizationResponse
} from "./services/external-personalization.mjs?v=1.0.1";
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
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
let targetPaths = [];
let allSections = [];
let sectionStudentCounts=new Map();
let objectiveRules = [];
let assessments = [];
let currentAssessmentId = null;
let deploySelectedSections = [];
let fpInstance = null;
let savingBlueprint=false,savingDeployment=false,rubricSource="balanced",lastGeneratedRubric="",subjectFocus=[],assessmentSubjectChoices=[];
let blueprintContentLocked=false;
let personalizedVariantPool=[],personalizedVariantFingerprint="",personalizedVariantGeneratedAt="",generatingVariants=false,personalizationDirty=false;
let personalizedPersistedIds=new Set();
const PERSONALIZATION_MODE="ai_blueprint_pool_v1";
const MAX_PERSONALIZED_POOL=600;
const MAX_EXTERNAL_VARIANT_BATCH=45;
const studioVariantService=httpsCallable(getFunctions(app,"asia-southeast1"),"studioAssessmentVariant");
const rubricTemplates=new Map();
const defaultPersona="Assist the teacher by checking supported evidence against the published task and rubric. Distinguish verified individual contributions from shared project work. Do not infer authorship or misconduct. Leave unsupported, visual and runtime criteria for teacher review. Suggested scores stay unpublished until teacher approval.";
const balancedCriteria=[{name:"Task requirements",weight:40,description:"Requested features and outputs are demonstrated."},{name:"Correctness",weight:30,description:"The submitted work behaves or reasons correctly for the task."},{name:"Clarity and organization",weight:20,description:"The work is understandable, organized and appropriate for the task."},{name:"Explanation and supporting evidence",weight:10,description:"The student explains the approach and links relevant evidence of their own contribution."}];
const blueprintStatus=message=>{const node=document.getElementById("blueprintStatus");if(node)node.textContent=message;};
let assessmentToastTimer=0;
function showAssessmentToast(message,{tone="info",duration=3200}={}){
  const region=document.getElementById("assessmentToastRegion");
  if(!region)return;
  clearTimeout(assessmentToastTimer);
  region.replaceChildren();
  const palette={
    success:"border-emerald-200 bg-emerald-50 text-emerald-950",
    warning:"border-amber-200 bg-amber-50 text-amber-950",
    error:"border-rose-200 bg-rose-50 text-rose-950",
    info:"border-sky-200 bg-sky-50 text-sky-950"
  };
  const toast=document.createElement("div");
  toast.className="pointer-events-auto rounded-xl border px-4 py-3 text-sm font-semibold shadow-lg transition duration-200 opacity-0 translate-y-[-4px] "+(palette[tone]||palette.info);
  toast.textContent=message;
  region.append(toast);
  requestAnimationFrame(()=>toast.classList.remove("opacity-0","translate-y-[-4px]"));
  assessmentToastTimer=setTimeout(()=>{
    toast.classList.add("opacity-0","translate-y-[-4px]");
    setTimeout(()=>toast.remove(),220);
  },duration);
}
async function externalPackageReadiness(){
  if(!currentAssessmentId)return {ready:false,badge:"Not ready",tone:"warning",message:"Save the personalized blueprint first."};
  const item=assessments.find(value=>value.id===currentAssessmentId);
  if(!item||item.schemaVersion!==3||item.personalizedTask?.enabled!==true)
    return {ready:false,badge:"Not ready",tone:"warning",message:"External packages are available for saved Personalized Studio assessments."};
  const target=Number(document.getElementById("assessVariantCount")?.value);
  if(!Number.isInteger(target)||target<10||target>MAX_PERSONALIZED_POOL)
    return {ready:false,badge:"Check target",tone:"warning",message:"Choose a valid private pool target before copying a package."};
  if(!String(document.getElementById("evalCriteria")?.value||"").trim())
    return {ready:false,badge:"Not ready",tone:"warning",message:"Prepare the published rubric before copying an external package."};
  const fingerprint=await currentPersonalizationFingerprint(),
    preserve=personalizedVariantFingerprint===fingerprint?personalizedVariantPool:[],
    need=variantGenerationNeed(preserve.length);
  if(!need.missing)
    return {ready:false,badge:"Target met",tone:"success",message:"The current private pool already meets the target. Increase the target to prepare more variants."};
  const plannedBatch=externalPersonalizationBatchSize(item,need.target),
    batchCount=Math.min(plannedBatch,need.missing),
    totalBatches=Math.ceil(need.target/plannedBatch),
    batchIndex=Math.min(totalBatches,Math.floor(preserve.length/plannedBatch)+1);
  return {
    ready:true,badge:"Ready",tone:"success",
    message:"Ready to copy · Batch "+batchIndex+" of "+totalBatches+" · "+batchCount+" variant"+(batchCount===1?"":"s")+".",
    fingerprint,preserve,need,item,plannedBatch,batchCount,totalBatches,batchIndex
  };
}
async function renderExternalPackageReadiness(){
  const node=document.getElementById("externalPackageReadiness"),
    badge=document.getElementById("externalPackageReadinessBadge");
  if(!node||!badge)return;
  const state=await externalPackageReadiness();
  node.textContent=state.message;
  badge.textContent=state.badge;
  const styles={
    success:"border-emerald-200 bg-emerald-50 text-emerald-700",
    warning:"border-amber-200 bg-amber-50 text-amber-700",
    error:"border-rose-200 bg-rose-50 text-rose-700",
    info:"border-sky-200 bg-sky-50 text-sky-700"
  };
  badge.className="shrink-0 rounded-full border px-2 py-1 text-[10px] font-bold uppercase "+(styles[state.tone]||styles.info);
}
function assessmentPublished(item){
  if(!item)return false;
  if(typeof item.published==="boolean")return item.published;
  // Backward compatibility: existing deployed assessments predate publication state
  // and remain visible until the teacher explicitly unpublishes them.
  return Boolean((item.deployments||[]).length);
}
function assessmentPublishReadiness(item){
  const problems=[];
  if(!(item?.deployments||[]).length)problems.push("Deploy the assessment to at least one section first.");
  if(!String(item?.taskContext||"").trim())problems.push("Student instructions are missing.");
  if(!String(item?.evalCriteria||"").trim())problems.push("The published rubric is missing.");
  if(item?.personalizedTask?.enabled===true){
    const size=Number(item.personalizedTask?.poolSize||0),
      target=Number(item.personalizedTask?.poolTarget||0),
      fingerprint=String(item.personalizedTask?.poolFingerprint||"");
    if(!fingerprint||size<1)problems.push("Activate the personalized variant pool first.");
    else{
      if(target>0&&size<target)problems.push("Complete the personalized pool target before publishing ("+size+" of "+target+" ready).");
      const coverage=recommendedPersonalizationTarget(item);
      if(coverage.learners>0&&size<coverage.learners)
        problems.push("The active pool has "+size+" variants for approximately "+coverage.learners+" enrolled learners in the deployed sections. Add at least one unique variant per learner before publishing.");
    }
  }
  return problems;
}
const CUSTOM_SUBJECT_VALUE="__custom__";
function selectedAssessmentSubject(){
  const select=document.getElementById("assessSubject"),
    custom=document.getElementById("assessSubjectCustom");
  return select?.value===CUSTOM_SUBJECT_VALUE?String(custom?.value||"").trim():String(select?.value||"").trim();
}
function syncAssessmentSubjectCustom(){
  const custom=document.getElementById("assessSubjectCustom"),
    wrap=document.getElementById("assessSubjectCustomWrap"),
    enabled=document.getElementById("assessSubject")?.value===CUSTOM_SUBJECT_VALUE;
  if(wrap)wrap.classList.toggle("hidden",!enabled);
  if(custom)custom.disabled=!enabled||blueprintContentLocked;
}
function setAssessmentSubjectValue(value=""){
  const subject=String(value||"").trim(),
    select=document.getElementById("assessSubject"),
    custom=document.getElementById("assessSubjectCustom");
  if(!select||!custom)return;
  if(!subject){select.value="";custom.value="";}
  else if([...select.options].some(option=>option.value===subject)){select.value=subject;custom.value="";}
  else {select.value=CUSTOM_SUBJECT_VALUE;custom.value=subject;}
  syncAssessmentSubjectCustom();
}
function scheduleSubjectsFromRows(rows){
  const values=new Set(),days=["mon","tue","wed","thu","fri"];
  for(const row of rows||[]){
    if(row?.type!=="class")continue;
    for(const day of days){
      const subject=String(row?.[day]?.sub||"").trim();
      if(subject)values.add(subject);
    }
  }
  return [...values];
}
async function resolveAssessmentSubjectChoices(user){
  const assigned=await resolveStaffSubjects(user),scheduled=new Set();
  try{
    await requireStaffWorkspace();
    const year=lessonStorage.getItem("Adminerva_schedule_selected_year")||"2026-2027",
      semester=lessonStorage.getItem("Adminerva_schedule_selected_semester")||"S1",
      scope=scheduleScope(year,semester);
    let rows=parseScheduleRows(lessonStorage.getItem(scope.jsonKey));
    if(!rows.length){
      const snapshot=await getDoc(ownedDoc(db,"schedules",scope.id));
      if(snapshot.exists())rows=parseScheduleRows(snapshot.data().json_data);
    }
    if(!rows.length&&scope.allowLegacy){
      for(const legacyId of [scope.id,"master_schedule"]){
        try{
          const snapshot=await getDoc(doc(db,"app_config",legacyId));
          if(snapshot.exists()){rows=parseScheduleRows(snapshot.data().json_data);if(rows.length)break;}
        }catch{/* Assigned-subject fallback remains available. */}
      }
    }
    scheduleSubjectsFromRows(rows).forEach(subject=>scheduled.add(subject));
  }catch{/* Timetable may be unavailable; assigned subjects remain the fallback. */}
  const choices=[...scheduled,...assigned.filter(subject=>!scheduled.has(subject))];
  return {assigned,scheduled:[...scheduled],choices:[...new Set(choices)]};
}
function renderAssessmentSubjectChoices({choices=[],scheduled=[]}={}){
  assessmentSubjectChoices=[...choices];
  const select=document.getElementById("assessSubject"),current=selectedAssessmentSubject();
  if(!select)return;
  select.replaceChildren(new Option("No specific subject / General",""));
  for(const subject of choices)select.add(new Option(subject,subject));
  select.add(new Option("Custom / Other subject…",CUSTOM_SUBJECT_VALUE));
  const hint=document.getElementById("assessmentSubjectHint");
  if(hint)hint.textContent=scheduled.length
    ?"Subjects currently used in your timetable are listed first. Choose Custom / Other for cross-subject, formative, or unscheduled work."
    :"No saved timetable subjects were found. Your assigned teaching subjects are listed; Custom / Other is also available.";
  setAssessmentSubjectValue(current);
}
function preparedTaskContext(){
  const title=document.getElementById("assessTitle").value.trim(),
    subject=selectedAssessmentSubject(),
    format=document.getElementById("assessSubmissionSource")?.value||"repository",
    label=(title||"the assessment task")+(subject?" for "+subject:"");
  if(format==="studio")
    return "Complete "+label+" in Adminerva Studio. Follow the published requirements and submit your finished Studio project through the assessment before the deadline.";
  return "Complete "+label+" using the assigned GitHub repository. Follow the published requirements and submit the requested repository evidence before the deadline.";
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
    category:document.getElementById("assessType").value,
    assessmentFormat:document.getElementById("assessSubmissionSource").value,
    assessmentMode:document.getElementById("assessMode").value,
    maxScore:Number(document.getElementById("maxScore").value),
    subject:selectedAssessmentSubject(),
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
    wrap.classList.add("hidden");void renderExternalPackageReadiness();return;
  }
  const item=currentAssessmentId?assessments.find(value=>value.id===currentAssessmentId):null,
    active=Array.isArray(item?.personalization?.variantIds)?item.personalization.variantIds.length:0,
    target=Number(document.getElementById("assessVariantCount")?.value||0);
  status.textContent=personalizedVariantPool.length+" private variant"+
    (personalizedVariantPool.length===1?"":"s")+" saved · "+active+" currently active for learner assignment"+
    (target?" · target "+target:"")+". Draft imports autosave; use Activate / update pool to publish the prepared capacity.";
  for(const [index,variant] of personalizedVariantPool.slice(0,4).entries()){
    const card=document.createElement("article");card.className="rounded-lg border border-indigo-100 bg-slate-50 p-3";
    const heading=document.createElement("strong");heading.className="text-xs text-indigo-950";
    heading.textContent="Sample variant "+(index+1)+" · "+variant.variantId;
    const body=document.createElement("pre");body.className="whitespace-pre-wrap font-sans text-xs leading-5 text-slate-700 mt-2 max-h-48 overflow-auto";
    body.textContent=variant.prompt;card.append(heading,body);preview.append(card);
  }
  wrap.classList.remove("hidden");
  void renderExternalPackageReadiness();
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
     document.getElementById("assessMode").value!=="personalized")
    return blueprintStatus("This blueprint is not configured as a personalized Adminerva Studio assessment.");
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
  const state=await externalPackageReadiness();
  if(!state.ready){
    document.getElementById("externalPersonalizationStatus").textContent=state.message;
    showAssessmentToast(state.message,{tone:state.tone||"warning"});
    void renderExternalPackageReadiness();
    return;
  }
  const button=document.getElementById("copyExternalPersonalizationPackageBtn");
  if(button)button.disabled=true;
  try{
    const packageText=buildExternalPersonalizationPackage({
      assessment:{
        ...state.item,
        title:document.getElementById("assessTitle").value.trim(),
        type:document.getElementById("assessType").value,
        assessmentFormat:document.getElementById("assessSubmissionSource").value==="studio"?"studio_code":"github_repository",
        assessmentMode:document.getElementById("assessMode").value,
        subject:selectedAssessmentSubject(),
        maxScore:Number(document.getElementById("maxScore").value),
        taskContext:document.getElementById("taskContext").value.trim()||preparedTaskContext(),
        evalCriteria:document.getElementById("evalCriteria").value.trim()
      },
      guidance:document.getElementById("assessVariantGuidance").value.trim(),
      count:state.batchCount,batchIndex:state.batchIndex,totalBatches:state.totalBatches,
      existingSummaries:state.preserve.map(value=>value.summary||value.prompt.slice(0,180))
    });
    await navigator.clipboard.writeText(packageText);
    const message="External AI package copied · Batch "+state.batchIndex+" of "+state.totalBatches+
      " · "+state.batchCount+" variant"+(state.batchCount===1?"":"s")+".";
    document.getElementById("externalPersonalizationStatus").textContent=
      message+" Paste it into the external AI, then import its JSON response below.";
    showAssessmentToast(message,{tone:"success"});
  }catch(error){
    const message="Package not copied: "+error.message;
    document.getElementById("externalPersonalizationStatus").textContent=message;
    showAssessmentToast(message,{tone:"error",duration:4200});
  }finally{
    if(button)button.disabled=false;
    void renderExternalPackageReadiness();
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
    if(saved)document.getElementById("externalPersonalizationResponse").value="";
    const importMessage=saved
      ?(remaining
        ?"External batch imported and autosaved · "+remaining+" variants remain."
        :"Final external batch imported and autosaved · target reached.")
      :"External batch imported, but autosave failed.";
    blueprintStatus(saved
      ?(remaining
        ?"External batch imported and autosaved. Continue with the next package; "+remaining+" variants remain."
        :"Final external batch imported and autosaved. Review the samples, then activate the pool.")
      :"External batch imported in this browser, but autosave failed. Keep this page open and use Activate / update pool after checking connectivity.");
    showAssessmentToast(importMessage,{tone:saved?"success":"warning",duration:3800});
    void renderExternalPackageReadiness();
  }catch(error){
    const message="Import failed: "+error.message;
    document.getElementById("externalPersonalizationStatus").textContent=message;
    showAssessmentToast(message,{tone:"error",duration:4200});
    void renderExternalPackageReadiness();
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
    const activeIds=Array.isArray(item.personalization?.variantIds)?item.personalization.variantIds:[],
      parentRef=doc(db,"assessment_private",currentAssessmentId),
      generatedAt=personalizedVariantGeneratedAt||new Date().toISOString();

    // Prime the private parent first so child variant rules can validate the
    // current blueprint fingerprint. Keep the existing active IDs until the
    // explicit activation step publishes the prepared capacity.
    {
      const prime=writeBatch(db);
      prime.set(parentRef,{
        ownerUid:item.ownerUid,sectionIds:item.sectionIds||[],
        personalization:{
          mode:PERSONALIZATION_MODE,guidance,fingerprint,
          variantIds:activeIds,draftCount:personalizedVariantPool.length,generatedAt
        },updatedAt:serverTimestamp()
      },{merge:true});
      await prime.commit();
    }

    const variantsToWrite=personalizedVariantPool.filter(variant=>
      !personalizedPersistedIds.has(variant.variantId)||variant.fingerprint!==fingerprint
    );
    const chunkSize=400;
    for(let offset=0;offset<variantsToWrite.length;offset+=chunkSize){
      const batch=writeBatch(db);
      for(const variant of variantsToWrite.slice(offset,offset+chunkSize)){
        batch.set(doc(db,"assessment_private",currentAssessmentId,"variants",variant.variantId),{
          variantId:variant.variantId,fingerprint,
          prompt:variant.prompt,evaluationNotes:variant.evaluationNotes||"",
          summary:variant.summary||"",updatedAt:serverTimestamp()
        },{merge:true});
      }
      await batch.commit();
    }

    const finalBatch=writeBatch(db),
      publishIds=activate?personalizedVariantPool.map(value=>value.variantId):activeIds;
    finalBatch.set(parentRef,{
      ownerUid:item.ownerUid,sectionIds:item.sectionIds||[],
      personalization:{
        mode:PERSONALIZATION_MODE,guidance,fingerprint,
        variantIds:publishIds,draftCount:personalizedVariantPool.length,generatedAt
      },updatedAt:serverTimestamp()
    },{merge:true});
    if(activate){
      finalBatch.update(doc(db,"assessments",currentAssessmentId),{
        personalizedTask:{
          enabled:true,mode:PERSONALIZATION_MODE,regeneration:"new_attempt",
          uniqueWithinAssessment:true,poolFingerprint:fingerprint,
          poolSize:personalizedVariantPool.length,poolTarget:target
        }
      });
    }
    await finalBatch.commit();

    personalizedPersistedIds=new Set(personalizedVariantPool.map(value=>value.variantId));
    personalizationDirty=false;
    await loadAssessments();
    const refreshed=assessments.find(value=>value.id===currentAssessmentId);
    if(refreshed){
      personalizedVariantFingerprint=refreshed.personalization?.fingerprint||fingerprint;
      personalizedVariantGeneratedAt=refreshed.personalization?.generatedAt||personalizedVariantGeneratedAt;
      personalizedVariantPool=await loadPersonalizationVariants(currentAssessmentId,refreshed.personalization||{fingerprint});
      personalizedPersistedIds=new Set(personalizedVariantPool.map(value=>value.variantId));
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
  try{
    const snapshot=await getDocs(collection(db,"templates"));
    for(const record of snapshot.docs){const data=record.data();if(Array.isArray(data.criteria)&&data.criteria.length)rubricTemplates.set("template:"+record.id,{name:data.name||"Saved rubric",criteria:data.criteria});}
  }catch{/* The built-in rubric remains available when saved templates cannot load. */}
  refreshRubricChoices();
}
for(const id of ["assessTitle","assessType","taskContext"])document.getElementById(id).addEventListener("input",()=>{
  updateContextPreview();markPersonalizationPossiblyStale();
});
document.getElementById("assessSubject").addEventListener("change",()=>{
  syncAssessmentSubjectCustom();updateContextPreview();markPersonalizationPossiblyStale();
});
document.getElementById("assessSubjectCustom").addEventListener("input",()=>{
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
    "assessTitle","maxScore","assessType","assessQuarter","assessSubject","assessSubjectCustom","assessSubmissionSource",
    "assessPracticalExam","assessMode","taskContext","assessmentRubricTemplate",
    "assessmentApplyRubric","evalCriteria","assessV2","newTargetPath","assessExpectedExts",
    "assessInvestigationFallback","systemPersona","newRuleType","newRuleValue"
  ];
  for(const id of ids){const node=document.getElementById(id);if(node)node.disabled=blueprintContentLocked;}
  document.getElementById("assessVariantGuidance").disabled=Boolean(lockGuidance);
  if(currentAssessmentId){
    document.getElementById("assessSubmissionSource").disabled=true;
    document.getElementById("assessV2").disabled=true;
  }
  syncAssessmentSubjectCustom();
  document.getElementById("saveAssessmentBtn").classList.toggle("hidden",blueprintContentLocked);
  if(blueprintContentLocked)
    blueprintStatus(lockGuidance
      ?"Published task details and variation guidance are locked. You may increase the pool target and add unused variants without changing existing learner tasks."
      :"Published task details are locked after deployment. Set the variation guidance and prepare the first private pool; the guidance will lock when that pool is saved.");
}
function updatePersonalizationTabAvailability(){
  const item=currentAssessmentId?assessments.find(value=>value.id===currentAssessmentId):null,
    enabled=document.getElementById("assessMode")?.value==="personalized",
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
async function renderPersonalizationUsage(item){
  const node=document.getElementById("personalizationUsageStatus");
  if(!node)return;
  if(!item?.personalizedTask?.poolFingerprint||Number(item.personalizedTask?.poolSize||0)<1){
    node.textContent="No active personalized pool yet.";
    return;
  }
  node.textContent="Loading active pool usage…";
  try{
    const response=await studioVariantService({action:"stats",assessmentId:item.id}),
      data=response.data||{};
    node.textContent="Active pool: "+Number(data.poolSize||0)+
      " · Assigned: "+Number(data.assigned||0)+
      " · Available: "+Number(data.available||0)+
      " · Unique learners: "+Number(data.uniqueLearners||0)+".";
  }catch(error){
    node.textContent="Pool usage is temporarily unavailable.";
  }
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
  const subjectContext=await resolveAssessmentSubjectChoices(auth.currentUser);
  subjectFocus=subjectContext.assigned;
  renderAssessmentSubjectChoices(subjectContext);
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
      if(!subjectFocus.length||assessment.ownerUid===auth.currentUser?.uid||!assessment.subject||subjectFocus.includes(assessment.subject))assessments.push(assessment);
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
                    <div class="flex justify-between items-start mb-2 gap-2">
                        <div class="flex flex-wrap gap-1">
                          <span class="${getTypeStyle(item.type)} text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider">${escapeHTML(item.type)}</span>
                          <span class="${assessmentPublished(item)?"bg-emerald-500/20 text-emerald-200 border-emerald-400/30":"bg-amber-500/20 text-amber-200 border-amber-400/30"} text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider">${assessmentPublished(item)?"Published":"Unpublished"}</span>
                        </div>
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

function updateAssessmentFormatMode(){
  const format=document.getElementById("assessSubmissionSource").value,
    studio=format==="studio",
    repository=format==="repository",
    mode=document.getElementById("assessMode"),
    personalizedOption=[...mode.options].find(option=>option.value==="personalized");
  if(personalizedOption)personalizedOption.disabled=!studio;
  if(!studio&&mode.value==="personalized")mode.value="default";
  const personalized=studio&&mode.value==="personalized";

  document.getElementById("personalizedTaskSettings").classList.toggle("hidden",!personalized);
  document.getElementById("repositoryEvidenceOptions").classList.toggle("hidden",!repository);
  if(!repository)document.getElementById("repositoryEvidenceOptions").open=false;

  document.getElementById("assessPracticalExam").disabled=!studio;
  document.getElementById("practicalExamOption").classList.toggle("opacity-60",!studio);
  document.getElementById("assessV2").disabled=!repository||Boolean(currentAssessmentId);

  const help=document.getElementById("assessmentFormatModeHelp");
  if(help){
    help.textContent=personalized
      ?"Adminerva Studio Code · Personalized: each learner receives one frozen task variant for the current attempt; teacher-requested revisions receive another unused variant."
      :studio
        ?"Adminerva Studio Code · Default: learners work in their own Studio project and submit an immutable project snapshot. GitHub evidence settings are not used."
        :repository
          ?"GitHub Repository · Default: learner contribution is verified through repository evidence, commits and checkpoint data. Personalized GitHub tasks are reserved for a later expansion."
          :"This assessment format is reserved for a future release.";
  }
  updatePersonalizationTabAvailability();
  updateContextPreview();
  if(personalized)renderPersonalizedVariantPool();
}
document.getElementById("assessMode").addEventListener("change",updateAssessmentFormatMode);
document.getElementById("assessVariantGuidance").addEventListener("input",()=>{markPersonalizationPossiblyStale();void renderExternalPackageReadiness();});
document.getElementById("assessVariantCount").addEventListener("input",()=>{
  if(!personalizedVariantPool.length){renderPersonalizedVariantPool();void renderExternalPackageReadiness();return;}
  const need=variantGenerationNeed();
  document.getElementById("personalizedVariantStatus").textContent=need.missing
    ?"Current private pool: "+personalizedVariantPool.length+". Add "+need.missing+" more to reach the "+need.target+" target."
    :"Current private pool meets the "+need.target+" target with "+personalizedVariantPool.length+" variants.";
  void renderExternalPackageReadiness();
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
  updateAssessmentFormatMode();
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
  setAssessmentSubjectValue(assessmentSubjectChoices.length===1?assessmentSubjectChoices[0]:"");
  document.getElementById("assessSubmissionSource").value="repository";
  document.getElementById("assessSubmissionSource").disabled=false;
  document.getElementById("assessMode").value="default";
  document.getElementById("assessMode").disabled=false;
  document.getElementById("assessPracticalExam").checked=false;
  document.getElementById("assessVariantGuidance").value="";
  document.getElementById("assessVariantCount").value="45";
  document.getElementById("assessVariantCount").min="10";
  personalizedVariantPool=[];personalizedVariantFingerprint="";personalizedVariantGeneratedAt="";personalizedPersistedIds=new Set();
  updateAssessmentFormatMode();renderPersonalizedVariantPool();void renderExternalPackageReadiness();
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
  document.getElementById("blueprintAdvanced").open=false;
  document.getElementById("repositoryEvidenceOptions").open=false;
  document.getElementById("blueprintInstructions").open=false;

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
  document.getElementById("assessSubmissionSource").value=item.assessmentFormat==="studio_code"||item.schemaVersion===3?"studio":"repository";
  document.getElementById("assessSubmissionSource").disabled=true;
  document.getElementById("assessMode").value=item.assessmentMode||(item.personalizedTask?.enabled===true?"personalized":"default");
  document.getElementById("assessMode").disabled=deployedStudio;
  document.getElementById("assessPracticalExam").checked=item.practicalExam===true;
  document.getElementById("assessVariantGuidance").value=item.personalization?.guidance||"";
  const variantCountInput=document.getElementById("assessVariantCount");
  variantCountInput.value=String(item.personalizedTask?.poolTarget||item.personalization?.variantIds?.length||45);
  variantCountInput.min=String(item.personalizedTask?.poolFingerprint?Math.max(10,Number(item.personalizedTask?.poolTarget||10)):10);
  personalizedVariantFingerprint=typeof item.personalization?.fingerprint==="string"?item.personalization.fingerprint:"";
  personalizedVariantGeneratedAt=typeof item.personalization?.generatedAt==="string"?item.personalization.generatedAt:"";
  personalizedVariantPool=await loadPersonalizationVariants(item.id,item.personalization||{});
  personalizedPersistedIds=new Set(personalizedVariantPool.map(value=>value.variantId));
  personalizationDirty=false;
  updateAssessmentFormatMode();renderPersonalizedVariantPool();
  document.getElementById("assessV2").checked = item.schemaVersion === 2;
  document.getElementById("assessV2").disabled = true; // Never silently convert a legacy record.
  document.getElementById("assessExpectedExts").value =
    Array.isArray(item.expectedExtensions) ? item.expectedExtensions.join(", ") : "";
  document.getElementById("assessInvestigationFallback").checked =
    item.investigationFallback !== false;
  document.getElementById("systemPersona").value = item.systemPersona || "";
  document.getElementById("taskContext").value = item.taskContext || "";
  document.getElementById("evalCriteria").value = item.evalCriteria || "";
  setAssessmentSubjectValue(item.subject||"");rubricSource="manual";lastGeneratedRubric="";
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
  void renderPersonalizationUsage(item);
  void renderExternalPackageReadiness();
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
  const subject=selectedAssessmentSubject();
  if(!actor?.uid){blueprintStatus("Sign in to your staff account before saving.");return;}
  if(subject.length>120){blueprintStatus("Subject or custom context must be 120 characters or fewer.");document.getElementById("assessSubjectCustom").focus();return;}
  if(!Number.isFinite(score)||score<1||score>1000){blueprintStatus("Maximum score must be between 1 and 1,000.");document.getElementById("maxScore").focus();return;}
  if(!criteria){blueprintStatus("Use a prepared rubric or enter your evaluation criteria before saving.");document.getElementById("evalCriteria").focus();return;}

  const prior = currentAssessmentId ? assessments.find(a=>a.id===currentAssessmentId) : null;
  const studio=prior ? prior.schemaVersion===3 : document.getElementById("assessSubmissionSource").value==="studio";
  const v2=prior ? prior.schemaVersion===2 : (!studio&&document.getElementById("assessV2").checked);
  const practicalExam=studio&&document.getElementById("assessPracticalExam").checked;
  const priorDeployed=Boolean((prior?.deployments||[]).length);
  const assessmentMode=priorDeployed
    ? (prior?.assessmentMode||(prior?.personalizedTask?.enabled===true?"personalized":"default"))
    : (document.getElementById("assessMode").value||"default");
  const personalizedEnabled=studio&&assessmentMode==="personalized";
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
    assessmentFormat:studio?"studio_code":"github_repository",
    assessmentMode:personalizedEnabled?"personalized":"default",
    published: prior
      ? (typeof prior.published==="boolean"?prior.published:Boolean((prior.deployments||[]).length))
      : false,
    maxScore: score,
    quarter: document.getElementById("assessQuarter").value,
    subject,
    targetPaths: studio?[]:targetPaths,
    expectedExtensions: studio?[]:[...new Set(document.getElementById("assessExpectedExts").value
      .split(",").map(e => e.trim().toLowerCase().replace(/^\./, "")).filter(e => /^[a-z0-9]{1,12}$/.test(e)))],
    investigationFallback: studio?false:document.getElementById("assessInvestigationFallback").checked,
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

  const isPublished=assessmentPublished(item),
    publication=document.getElementById("viewPublicationStatus"),
    publishBtn=document.getElementById("viewPublishBtn"),
    readiness=assessmentPublishReadiness(item);
  if(publication){
    publication.className="mb-5 rounded-xl border p-4 text-sm "+
      (isPublished?"border-emerald-200 bg-emerald-50 text-emerald-900":"border-amber-200 bg-amber-50 text-amber-900");
    publication.innerHTML=isPublished
      ?"<strong>Published to students.</strong> Learners in deployed sections can see this assessment. Opening and submission still follow the configured schedule."
      :"<strong>Unpublished.</strong> Deployment and personalization can be prepared privately. Students will not see this assessment until you publish it."+
        (readiness.length?"<span class=\"block mt-1 text-xs\">Before publishing: "+escapeHTML(readiness[0])+"</span>":"");
  }
  if(publishBtn){
    publishBtn.innerHTML=isPublished?"<span>🙈</span> Unpublish":"<span>📣</span> Publish";
    publishBtn.className=isPublished
      ?"bg-amber-600 text-white px-5 py-2 rounded text-sm font-bold hover:bg-amber-700 transition shadow flex items-center gap-2"
      :"bg-emerald-600 text-white px-5 py-2 rounded text-sm font-bold hover:bg-emerald-700 transition shadow flex items-center gap-2";
  }

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

window.toggleAssessmentPublication=async function(){
  if(!currentAssessmentId)return;
  const item=assessments.find(value=>value.id===currentAssessmentId);
  if(!item)return;
  const published=assessmentPublished(item);
  if(!published){
    const problems=assessmentPublishReadiness(item);
    if(problems.length)return alert("This assessment is not ready to publish:\n\n• "+problems.join("\n• "));
    if(!confirm("Publish this assessment now? Students in the deployed sections will be able to see it. Studio access and submission will still follow the configured schedule."))return;
  }else{
    if(!confirm("Unpublish this assessment? It will disappear from students' My Assessments and new Studio task access/submissions will be blocked. Existing personalized variants, submissions, grades, deployments and schedules will be preserved."))return;
  }
  const button=document.getElementById("viewPublishBtn");
  if(button)button.disabled=true;
  window.showSubtleLoader(published?"Unpublishing assessment...":"Publishing assessment...");
  try{
    await updateDoc(doc(db,"assessments",currentAssessmentId),{published:!published});
    await loadAssessments();
    window.openViewModal(currentAssessmentId);
  }catch(error){
    alert((published?"Unpublish":"Publish")+" failed: "+error.message);
  }finally{
    if(button)button.disabled=false;
    window.hideSubtleLoader();
  }
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
    const refreshed=assessments.find(value=>value.id===currentAssessmentId);
    if(refreshed&&!assessmentPublished(refreshed))
      alert("Deployment saved privately. Students will not see this assessment until you publish it.");
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
