/** Project-first Code Studio orchestration, Adminerva DB lab, design and evidence surfaces. */
import {db,auth} from "../core/firebase-core.js?v=1.3.0";
import {
  collection,deleteDoc,doc,getDocFromServer,getDocsFromServer,runTransaction
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  CODE_PROJECT_TEMPLATES,createCodeProject,deleteCodeProject,findCodeProject,
  projectTemplateLabel,readCodeProjects,saveCodeProject,writeCodeProjects,normalizeProject
} from "./code-projects.mjs?v=2.1.0";
import {databaseSummary,executeAdminervaSql} from "./adminerva-db.mjs?v=3.0.0";
import {prepareProjectImport} from "./project-import.mjs?v=3.0.0";
import {analyzeProjectEvidence,evidenceSnippet} from "./project-competency-evidence.mjs?v=2.1.0";
import {
  archiveV4StudioProject,currentV4StudioSchool,listArchivedV4StudioProjects,listV4StudioProjects,listV4StudioAssignments,loadV4StudioProject,
  syncV4StudioProject,rememberV4StudioRevision,restoreV4StudioProject
} from "./v4-studio-service.mjs?v=20261121-exam-data-audit";

const el=id=>document.getElementById(id);
const clone=value=>JSON.parse(JSON.stringify(value));
const enc=value=>new TextEncoder().encode(JSON.stringify(value)).length;
const escapeHtml=value=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch]));
function projectScopeToken(scope){
  return String(scope||"").trim().replace(/[^A-Za-z0-9_-]/g,"_").slice(0,180);
}
function scopedProjectStorage(storage,scope){
  const token=projectScopeToken(scope);
  if(!token)return storage;
  const prefix="Adminerva_Scoped_Studio_"+token+"_";
  return Object.freeze({
    getItem:key=>storage.getItem(prefix+String(key)),
    setItem:(key,value)=>storage.setItem(prefix+String(key),value),
    removeItem:key=>storage.removeItem(prefix+String(key))
  });
}
const prettyDate=value=>{
  try{
    const date=new Date(value),delta=Date.now()-date.getTime();
    if(Number.isFinite(delta)&&delta>=0&&delta<60000)return "Just now";
    if(delta<3600000)return Math.max(1,Math.floor(delta/60000))+" min ago";
    if(delta<86400000)return Math.max(1,Math.floor(delta/3600000))+" hr ago";
    return date.toLocaleDateString(undefined,{month:"short",day:"numeric",year:date.getFullYear()===new Date().getFullYear()?undefined:"numeric"});
  }catch{return "Recently";}
};

function assessmentProfileMeta(project){
  if(project?.assessment?.provisionedBy!=="assessment-launch")return "";
  const profile=String(project.assessment.studioProjectProfile||"auto");
  const labels={
    "java-console":"Java Console",
    "java-desktop":"Java Desktop",
    "java-database":"Java + Database",
    "java-desktop-database":"Java Desktop + Database",
    "web":"Web",
    "python-console":"Python Console",
    "auto":"Auto"
  };
  const current=project.lang==="java"
    ?(project.config?.database
      ?(project.config?.runMode==="desktop"?"Java Desktop + Database":"Java + Database")
      :(project.config?.runMode==="desktop"?"Java Desktop":"Java Console"))
    :project.lang==="web"?"Web":project.lang==="python"?"Python Console":labels[profile]||profile;
  const configured=labels[profile]||profile;
  return profile==="auto"
    ?"Assessment setup: Auto · current run: "+current
    :"Assessment setup: "+configured+(current!==configured?" · current run: "+current:"");
}
function projectTypeMeta(project){
  const template=CODE_PROJECT_TEMPLATES[project.template]||CODE_PROJECT_TEMPLATES["java-blank"];
  const detail=[template.title];
  if(project.config?.database)detail.push("Adminerva DB");
  if(project.lang==="java")detail.push("Java "+(project.config?.javaVersion||"17"));
  return {template,detail:detail.join(" · ")};
}
function sourceStats(state){
  const files=Object.values(state?.files||{}),source=files.join("\n");
  const lines=files.reduce((sum,text)=>sum+String(text).split(/\r?\n/).length,0);
  return {
    files:files.length,lines,
    classes:(source.match(/\bclass\s+[A-Za-z_]\w*/g)||[]).length,
    interfaces:(source.match(/\binterface\s+[A-Za-z_]\w*/g)||[]).length,
    enums:(source.match(/\benum\s+[A-Za-z_]\w*/g)||[]).length,
    hasEncapsulation:/\bprivate\s+[\w<>\[\], ?]+\s+\w+/.test(source),
    hasInheritance:/\bextends\s+\w+|\bimplements\s+\w+/.test(source),
    hasCollections:/\b(ArrayList|List|Map|Set|HashMap|HashSet|Collection)\b/.test(source),
    hasGenerics:/<\s*[A-Z]\w*(?:\s*,\s*[A-Z]\w*)*\s*>/.test(source)||/\bList\s*</.test(source),
    hasExceptions:/\btry\s*\{|\bcatch\s*\(|\bthrows\s+\w+Exception/.test(source),
    hasJdbc:/\bjava\.sql\b|\bDriverManager\b|\bPreparedStatement\b|\bResultSet\b/.test(source),
    hasFileIo:/\b(java\.io|java\.nio\.file|Files\.|Path\.of|FileInputStream|FileOutputStream|BufferedReader|BufferedWriter)\b/.test(source),
    hasThreads:/\b(Thread|Runnable|ExecutorService|CompletableFuture|synchronized)\b/.test(source)
  };
}
function renderGridTable(target,columns,rows){
  if(!target)return;
  if(!columns?.length){target.innerHTML='<p class="studio-empty">No result columns.</p>';return;}
  const head=columns.map(col=>"<th>"+escapeHtml(col)+"</th>").join("");
  const body=(rows||[]).map(row=>"<tr>"+columns.map((_,i)=>"<td>"+escapeHtml(row[i]??"NULL")+"</td>").join("")+"</tr>").join("");
  target.innerHTML='<div class="studio-table-wrap"><table class="studio-table"><thead><tr>'+head+'</tr></thead><tbody>'+body+'</tbody></table></div>';
}
function v4ProjectTemplate(language,artifacts={}){
  if(language==="python")return "python-console";
  if(language==="web")return "web";
  if(language==="java"){
    if(artifacts.config?.database)return "java-information";
    if(artifacts.config?.runMode==="desktop")return "java-desktop";
    return "java-blank";
  }
  return "java-blank";
}
function v4ProjectToLocal(uid,remote){
  const entries=Array.isArray(remote?.files)?remote.files:[];
  if(!remote?.projectId||!entries.length)throw Error("School project is missing its source files.");
  const files={},folders=new Set(),order=[];
  for(const item of entries){
    if(!item||typeof item.path!=="string"||typeof item.content!=="string")continue;
    files[item.path]=item.content;order.push(item.path);
    const parts=item.path.split("/");
    for(let i=1;i<parts.length;i++)folders.add(parts.slice(0,i).join("/"));
  }
  if(!order.length)throw Error("School project has no readable source files.");
  const artifacts=remote.artifacts&&typeof remote.artifacts==="object"?remote.artifacts:{};
  const layout=artifacts.workspace||{},known=new Set(order),ordered=[...new Set([...(Array.isArray(layout.fileOrder)?layout.fileOrder.filter(path=>known.has(path)):[]),...order])];
  for(const folder of Array.isArray(layout.folders)?layout.folders:[])if(typeof folder==="string"&&folder)folders.add(folder);
  const time=value=>{
    const date=new Date(Number(value)||Date.now());
    return Number.isFinite(date.getTime())?date.toISOString():new Date().toISOString();
  };
  return {
    id:remote.projectId,ownerUid:uid,title:remote.title||"School project",
    template:CODE_PROJECT_TEMPLATES[layout.template]?layout.template:v4ProjectTemplate(remote.language,artifacts),lang:remote.language||"text",status:"active",
    config:artifacts.config||{},
    state:{lang:remote.language||"text",files,fileOrder:ordered,activeFilename:known.has(layout.activeFilename)?layout.activeFilename:ordered[0],
      folders:[...folders].sort(),projectOrder:[...new Set([...(Array.isArray(layout.projectOrder)?layout.projectOrder.filter(path=>known.has(path)||folders.has(path)):[]),...folders,...ordered])]},
    database:artifacts.database||{tables:{},history:[]},
    design:artifacts.design||{},evidence:artifacts.evidence||{events:[],runs:[]},
    assessment:artifacts.assessment&&typeof artifacts.assessment==="object"?artifacts.assessment:null,
    createdAt:time(remote.createdAt),updatedAt:time(remote.updatedAt),lastOpenedAt:time(remote.updatedAt)
  };
}

function defaultDiagramName(key){
  return ({useCase:"Use Case",classDiagram:"Class Diagram",sequence:"Sequence Diagram",architecture:"Architecture"})[key]||key;
}
function matchesTemplateStarter(project,template){
  if(!project||!template)return false;
  const state=project.state||{},starter=template.workspace||{};
  const normalizeList=value=>Array.isArray(value)?value:[];
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  return same(state.files||{},starter.files||{}) &&
    same(normalizeList(state.fileOrder),normalizeList(starter.fileOrder)) &&
    same(normalizeList(state.folders),normalizeList(starter.folders)) &&
    same(normalizeList(state.projectOrder),normalizeList(starter.projectOrder)) &&
    same(project.database||{tables:{},history:[]},template.database||{tables:{},history:[]}) &&
    same(project.design||{},template.design||{});
}

export function createProjectStudio({
  uid,openProject,captureState,onConfigChange,onRevealEvidence=null,legacyDraftAvailable=false,importLegacyDraft=null,
  cloudEnabled=true,guest=false,limits={},projectScope=""
}){
  const policy={
    maxProjects:guest?3:Infinity,
    maxFiles:guest?25:100,
    maxProjectBytes:guest?300000:780000,
    maxDbTables:guest?5:50,
    maxDbRowsPerTable:guest?100:5000,
    maxRuns:guest?15:30,
    ...limits
  };
  const scopeToken=projectScopeToken(projectScope);
  const projectStorage=scopedProjectStorage(localStorage,scopeToken);
  const undoKey=projectId=>"Adminerva_Code_Project_Undo_v1_"+uid+"_"+(scopeToken?scopeToken+"_":"")+projectId;
  let activeProject=null,selectedTemplate="java-information",initialized=false,openEpoch=0;
  const cloudTimers=new Map(),cloudWrites=new Map(),deletedProjects=new Set(),cloudPending=new Map(),markerCache=new Map();
  let merging=null,cloudStatus="Checking cloud storage…",designTimer=null,designPending=null,diagramEpoch=0;
  let dbSelectedTable="",dbView="browse";

  function projectSize(project){return enc(project);}
  function validateProject(project,{creating=false}={}){
    if(!project)throw Error("Project is unavailable.");
    const files=Object.keys(project.state?.files||{});
    if(files.length>policy.maxFiles)throw Error("This project exceeds the "+policy.maxFiles+" file limit.");
    if(projectSize(project)>policy.maxProjectBytes)throw Error("This project exceeds the local size limit. Export a ZIP or remove files/data.");
    const tables=Object.values(project.database?.tables||{});
    if(tables.length>policy.maxDbTables)throw Error("This project exceeds the "+policy.maxDbTables+" database table limit.");
    if(tables.some(table=>(table.rows||[]).length>policy.maxDbRowsPerTable))throw Error("A database table exceeds the "+policy.maxDbRowsPerTable+" row limit.");
    if(creating&&readCodeProjects(projectStorage,uid).filter(item=>item.status!=="archived").length>=policy.maxProjects)
      throw Error("Guest Code Studio keeps up to "+policy.maxProjects+" local projects. Export or delete one before creating another.");
    return true;
  }
  function quotaText(){
    const count=readCodeProjects(projectStorage,uid).filter(item=>item.status!=="archived").length;
    return Number.isFinite(policy.maxProjects)?count+" / "+policy.maxProjects+" local projects":count+" projects";
  }

  const controller={
    getActiveProject:()=>activeProject,
    showHome,
    saveState,
    captureClosingState,
    flushCloudSaves,
    hasPendingCloudSaves:()=>cloudEnabled&&cloudPending.size>0,
    recordRun,
    updateConfig,
    refreshEvidence:()=>renderEvidence(),
    refreshMonitor:()=>renderMonitor(),
    openProjectById,
    ensureAssessmentProject,
    activateProject,
    resetToTemplate,
    importBundleMetadata,
    importZipWorkspace,
    importLegacyState,
    getLimits:()=>({...policy}),
    canCreateProject:()=>!Number.isFinite(policy.maxProjects)||readCodeProjects(projectStorage,uid).filter(item=>item.status!=="archived").length<policy.maxProjects,
    canAddFile:()=>!activeProject||Object.keys(captureState()?.files||{}).length<policy.maxFiles,
    isGuest:()=>guest
  };

  function markerKey(id){return "Adminerva_Studio_Cloud_State_"+uid+"_"+id;}
  function readMarker(id){if(!markerCache.has(id)){try{markerCache.set(id,JSON.parse(projectStorage.getItem(markerKey(id))||"null")||{});}catch{markerCache.set(id,{});}}return markerCache.get(id);}
  function writeMarker(id,value){markerCache.set(id,value);try{projectStorage.setItem(markerKey(id),JSON.stringify(value));}catch(error){console.warn("Studio sync recovery marker unavailable",error);}}
  function stable(value){
    if(Array.isArray(value))return value.map(stable);
    if(value&&typeof value==="object")return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
    return value;
  }
  function contentKey(project){
    const state=project?.state||{};
    return JSON.stringify(stable({title:project?.title,lang:project?.lang,template:project?.template,
      files:state.files||{},fileOrder:state.fileOrder||[],folders:[...(state.folders||[])].sort(),
      projectOrder:state.projectOrder||[],activeFilename:state.activeFilename||"",
      config:project?.config||{},database:project?.database||{},design:project?.design||{},
      evidence:project?.evidence||{},assessment:project?.assessment||null}));
  }
  function setCloudStatus(message,tone="info",id=null){
    if(id&&activeProject?.id!==id)return;
    cloudStatus=message;
    const badge=el("activeProjectStorageBadge"),indicator=el("autoSaveIndicator");
    if(badge){badge.textContent=message;badge.dataset.tone=tone;}
    if(indicator&&activeProject){indicator.textContent=message;indicator.title=message;
      indicator.classList.remove("opacity-0","text-rose-400","text-emerald-400","text-slate-400");
      indicator.classList.add(tone==="error"?"text-rose-400":tone==="success"?"text-emerald-400":"text-slate-400");}
    const storage=el("projectStorageMode");if(storage&&!activeProject)storage.textContent=message;
  }
  function cacheProject(project){
    const items=readCodeProjects(projectStorage,uid).filter(item=>item.id!==project.id);
    const normalized=normalizeProject(project);if(!normalized)throw Error("Invalid cloud project.");
    writeCodeProjects(projectStorage,uid,[normalized,...items]);return normalized;
  }
  function store(project,cloud=cloudEnabled){
    validateProject(project);
    const previous=findCodeProject(projectStorage,uid,project.id);
    const changed=!previous||contentKey(previous)!==contentKey(project);
    activeProject=changed?saveCodeProject(projectStorage,uid,project):{...previous,lastOpenedAt:project.lastOpenedAt||previous.lastOpenedAt};
    updateProjectHeading();updateQuotaUI();
    if(cloudEnabled&&cloud&&(changed||readMarker(project.id).pending||!readMarker(project.id).kind))scheduleCloudSave(activeProject);
    window.dispatchEvent(new CustomEvent("adminerva:studio-project-saved",{detail:{
      projectId:activeProject.id,updatedAt:activeProject.updatedAt
    }}));
    return activeProject;
  }
  function saveState(state){
    if(!activeProject)return null;
    return store({...activeProject,state,lastOpenedAt:new Date().toISOString()},true);
  }
  function captureClosingState(state){
    if(!activeProject||!state?.files)return {queued:false,deviceSaved:false};
    const draft=normalizeProject({...activeProject,state,
      lastOpenedAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
    validateProject(draft);
    let deviceSaved=false;
    try{
      activeProject=saveCodeProject(projectStorage,uid,draft);
      deviceSaved=true;
    }catch(error){
      // A full/disabled localStorage must not prevent uploading the in-memory
      // editor snapshot. Do not claim a device backup was made.
      console.warn("Exam closing device draft unavailable; using memory-only cloud checkpoint",error);
      activeProject=draft;
    }
    if(cloudEnabled)scheduleCloudSave(activeProject);
    return {queued:cloudEnabled,deviceSaved};
  }
  function scheduleCloudSave(project){
    if(!cloudEnabled||deletedProjects.has(project.id))return;
    const snapshot=clone(project),id=snapshot.id;
    cloudPending.set(id,snapshot);
    writeMarker(id,{...readMarker(id),pending:true});
    setCloudStatus(navigator.onLine===false?"Offline · saved on device":"Syncing to cloud…","info",id);
    clearTimeout(cloudTimers.get(id));
    cloudTimers.set(id,setTimeout(()=>{void flushOne(id);},900));
  }
  async function flushOne(id,closingSessionEpoch=0){
    clearTimeout(cloudTimers.get(id));cloudTimers.delete(id);
    if(!cloudEnabled||deletedProjects.has(id))return false;
    if(cloudWrites.has(id)){
      await cloudWrites.get(id);
      return closingSessionEpoch?flushOneAfterWrite(id,closingSessionEpoch):
        cloudPending.has(id)?flushOneAfterWrite(id):true;
    }
    return flushOneAfterWrite(id,closingSessionEpoch);
  }
  async function flushOneAfterWrite(id,closingSessionEpoch=0){
    if(cloudWrites.has(id)){
      await cloudWrites.get(id);
      return flushOneAfterWrite(id,closingSessionEpoch);
    }
    const snapshot=cloudPending.get(id);
    // A normal autosave may have consumed the pending write before this
    // call obtained the per-project lock. An empty queue is NOT proof of
    // the teacher-close receipt: only an examFinalized server response is.
    if(!snapshot||deletedProjects.has(id))return closingSessionEpoch?false:true;
    const work=(async()=>{
      try{
        if(auth.currentUser?.uid!==uid)throw Error("Sign in with the original project account.");
        const school=await currentV4StudioSchool();
        if(auth.currentUser?.uid!==uid)throw Error("Account changed before saving.");
        let marker;
        if(school){
          const base=readMarker(id);
          const result=await syncV4StudioProject(snapshot,snapshot.state,{quiet:true,expectedRevision:base.kind==="school"&&base.schoolId===school.schoolId?base.revision:null,
            closingSaveSessionEpoch:closingSessionEpoch});
          if(!result)throw Error("School cloud storage is unavailable.");
          if(closingSessionEpoch&&result.examFinalized!==true)
            throw Error("The final exam checkpoint was not confirmed by the school server.");
          marker={kind:"school",schoolId:school.schoolId,revision:result.revision};
        }else{
          if(closingSessionEpoch)throw Error("Verified school cloud storage is required to finalize this exam.");
          if(scopeToken)throw Error("Reconnect your verified school to save this project.");
          const ref=doc(db,"student_code_projects",uid,"projects",id);
          const base=readMarker(id);
          const confirmedAt=await runTransaction(db,async tx=>{
            const remote=await tx.get(ref);
            if(remote.exists()){
              const prior=remote.data();
              if(prior.ownerUid!==uid||prior.status==="archived")throw Error("This cloud project cannot be overwritten.");
              if(contentKey(prior)===contentKey(snapshot))return prior.updatedAt;
              if(base.kind!=="legacy"||base.updatedAt!==prior.updatedAt)
                throw Error("Project changed on another device. Open the project again to recover both copies.");
            }
            tx.set(ref,{...snapshot,ownerUid:uid});return snapshot.updatedAt;
          });
          marker={kind:"legacy",updatedAt:confirmedAt};
        }
        const same=cloudPending.get(id)===snapshot;
        if(same)cloudPending.delete(id);
        writeMarker(id,{...marker,pending:!same});
        if(same){setCloudStatus("Saved to cloud","success",id);if(!activeProject)setCloudStatus(cloudPending.size?"Cloud sync pending":"Cloud projects up to date",cloudPending.size?"info":"success");}
        return true;
      }catch(error){
        console.warn("Studio cloud save failed:",error);
        setCloudStatus("Device copy saved · cloud not synced","error",id);
        if(!activeProject)setCloudStatus("Device drafts retained · cloud not synced","error");
        const indicator=el("autoSaveIndicator");if(indicator&&activeProject?.id===id)indicator.title=String(error?.message||error)+" · Save again to retry.";
        return false;
      }
    })();
    cloudWrites.set(id,work);
    try{return await work;}finally{if(cloudWrites.get(id)===work)cloudWrites.delete(id);}
  }
  async function flushCloudSaves({closingSessionEpoch=0}={}){
    // Ordinary guest work can be saved locally, but an exam may never
    // report finalization without a school-owned cloud receipt.
    if(!cloudEnabled)return !closingSessionEpoch;
    if(closingSessionEpoch){
      // Finalize only the active assessment project. Do not overwrite a
      // different project or accidentally bless an earlier cloud revision.
      if(!activeProject?.id||activeProject.assessment?.provisionedBy!=="assessment-launch"||
         Number(activeProject.assessment.sessionEpoch||0)!==closingSessionEpoch)
        return false;
      const id=activeProject.id;
      scheduleCloudSave(activeProject);
      const saved=await flushOne(id,closingSessionEpoch);
      return Boolean(saved)&&!cloudPending.has(id);
    }
    const ids=[...cloudPending.keys()];
    if(!ids.length)return true;
    const result=await Promise.all(ids.map(id=>flushOne(id)));
    return result.every(Boolean)&&!cloudPending.size;
  }
  function recoverCopy(project){
    const copy=createCodeProject(projectStorage,uid,{title:(project.title.slice(0,94)+" · Device recovery"),templateId:project.template,config:project.config});
    cacheProject({...project,id:copy.id,title:copy.title,assessment:null,createdAt:copy.createdAt,updatedAt:copy.updatedAt,lastOpenedAt:copy.lastOpenedAt});
    return copy.id;
  }
  async function resolveCloudProject(id,{local=null,shouldApply=()=>true}={}){
    local=local||findCodeProject(projectStorage,uid,id);
    if(!cloudEnabled)return local;
    if(auth.currentUser?.uid!==uid)throw Error("Sign in with your project account.");
    const school=await currentV4StudioSchool();
    let remote=null,base=null;
    if(school){
      try{
        const detail=await loadV4StudioProject(id,{rememberRevision:false});
        if(detail){remote=v4ProjectToLocal(uid,detail);base={kind:"school",schoolId:school.schoolId,revision:detail.revision};}
      }catch(error){
        if(!String(error?.code||"").includes("not-found"))throw error;
      }
    }
    if(!remote&&school?.compatibilityMode!=="v4_only"&&!scopeToken){
      const legacy=await getDocFromServer(doc(db,"student_code_projects",uid,"projects",id));
      if(legacy.exists()){
        const data=legacy.data();
        if(data.ownerUid!==uid||data.status==="archived")throw Error("The cloud project is not active.");
        remote=normalizeProject(data);if(!remote)throw Error("The cloud project cannot be read.");
        base={kind:"legacy",updatedAt:data.updatedAt};
      }
    }
    if(auth.currentUser?.uid!==uid)throw Error("Account changed before loading project.");
    if(!shouldApply()||deletedProjects.has(id))return null;
    if(!remote)return local;
    validateProject(remote);
    const prior=readMarker(id);
    const sameBase=base.kind==="school"&&prior.kind==="school"&&prior.schoolId===base.schoolId&&prior.revision===base.revision||
      base.kind==="legacy"&&prior.kind==="legacy"&&prior.updatedAt===base.updatedAt;
    const differs=local&&contentKey(local)!==contentKey(remote);
    let chosen=remote;
    if(differs&&prior.pending&&sameBase)chosen=local;
    else if(differs&&(prior.pending||(!prior.kind&&String(local.updatedAt||"")>=String(remote.updatedAt||"")))){
      recoverCopy(local);
      alert("The cloud has a different version of this project. Your device changes were preserved as a separate Device recovery project; the main project will open the cloud version.");
    }
    if(base.kind==="school")rememberV4StudioRevision(id,base.revision);
    const needsSync=chosen===local&&differs||Boolean(school&&base.kind==="legacy");
    writeMarker(id,{...base,pending:Boolean(needsSync)});
    cloudPending.delete(id);clearTimeout(cloudTimers.get(id));cloudTimers.delete(id);
    const cached=cacheProject(chosen);
    if(needsSync)scheduleCloudSave(cached);
    return cached;
  }
  async function mergeCloudProjects(){
    if(!cloudEnabled)return;
    if(merging)return merging;
    merging=(async()=>{
      try{
        const school=await currentV4StudioSchool(),ids=new Set(),archivedIds=new Set(),summaries=new Map();
        if(auth.currentUser?.uid!==uid)throw Error("Account changed before loading projects.");
        if(scopeToken&&!school)throw Error("Reconnect your verified school to load projects.");
        let incomplete=false;
        const available=id=>auth.currentUser?.uid===uid&&!deletedProjects.has(id)&&activeProject?.id!==id&&!cloudWrites.has(id)&&!cloudPending.has(id);
        if(school){
          const [remote,archived]=await Promise.all([listV4StudioProjects(),listArchivedV4StudioProjects()]);
          if(!Array.isArray(remote)||!Array.isArray(archived))throw Error("School project listing unavailable.");
          for(const row of remote){ids.add(row.projectId);summaries.set(row.projectId,{kind:"school",schoolId:school.schoolId,revision:row.revision});}
          for(const row of archived||[])archivedIds.add(row.projectId);
          const archiveButton=el("archivedCodeProjectsBtn");if(archiveButton)archiveButton.classList.toggle("hidden",!archived?.length);
        }
        if(school?.compatibilityMode!=="v4_only"&&!scopeToken){
          try{const snap=await getDocsFromServer(collection(db,"student_code_projects",uid,"projects"));
          for(const row of snap.docs){const data=row.data();if(data.ownerUid!==uid||data.status==="archived"||archivedIds.has(row.id)||ids.has(row.id))continue;ids.add(row.id);summaries.set(row.id,{kind:"legacy",updatedAt:data.updatedAt});}}catch(error){if(!school)throw error;incomplete=true;console.warn("Legacy cloud listing unavailable",error);}
        }
        for(const id of ids){
          if(!available(id))continue;
          const local=findCodeProject(projectStorage,uid,id),summary=summaries.get(id),marker=readMarker(id);
          const sameRevision=summary?.kind==="school"?marker.kind==="school"&&marker.schoolId===summary.schoolId&&marker.revision===summary.revision:summary?.kind==="legacy"&&marker.kind==="legacy"&&marker.updatedAt===summary.updatedAt;
          if(local&&!marker.pending&&sameRevision&&!(school&&summary.kind==="legacy"))continue;
          try{await resolveCloudProject(id,{local,shouldApply:()=>available(id)});}catch(error){incomplete=true;console.warn("Cloud project could not be loaded",id,error);}
        }
        for(const project of readCodeProjects(projectStorage,uid)){
          if(!available(project.id)||archivedIds.has(project.id))continue;
          if(readMarker(project.id).pending){scheduleCloudSave(project);}
          else if(!ids.has(project.id)&&!readMarker(project.id).kind){
            // Verify absence before uploading device-only work; never overwrite an existing copy.
            try{const candidate=await resolveCloudProject(project.id,{local:project,shouldApply:()=>available(project.id)});if(candidate&&available(project.id)&&!readMarker(project.id).kind)scheduleCloudSave(candidate);}catch(error){incomplete=true;console.warn("Device draft retained",error);}
          }
        }
        if(!activeProject&&auth.currentUser?.uid===uid){renderProjectHome();setCloudStatus(incomplete?"Some cloud projects could not refresh · device drafts retained":cloudPending.size?"Cloud sync pending":"Cloud projects up to date",incomplete?"error":"info");}
      }catch(error){console.warn("Studio cloud list unavailable:",error);if(!activeProject)setCloudStatus("Cloud unavailable · device drafts retained","error");}
    })();
    try{await merging;}finally{merging=null;}
  }

  async function showArchivedSchoolProjects(){
    const button=el("archivedCodeProjectsBtn");
    if(button)button.disabled=true;
    try{
      const archived=await listArchivedV4StudioProjects();
      if(!archived?.length){alert("There are no archived projects in your active school workspace.");return;}
      let modal=el("archivedSchoolProjectsModal");
      if(!modal){
        modal=document.createElement("div");modal.id="archivedSchoolProjectsModal";
        modal.className="fixed inset-0 z-[280] bg-slate-950/80 p-3 flex items-center justify-center";
        modal.setAttribute("role","dialog");modal.setAttribute("aria-modal","true");
        const panel=document.createElement("div");
        panel.className="bg-white rounded-xl max-w-2xl w-full p-5 max-h-[85dvh] overflow-y-auto";
        const head=document.createElement("div");head.className="flex justify-between items-start gap-4 mb-4";
        const copy=document.createElement("div");
        const title=document.createElement("h2");title.className="font-bold text-slate-900";title.textContent="Archived school projects";
        const hint=document.createElement("p");hint.className="text-xs text-slate-500 mt-1";
        hint.textContent="Restore keeps the project ID and school history. It does not overwrite a different device copy.";
        copy.append(title,hint);
        const close=document.createElement("button");close.type="button";close.textContent="Close";
        close.className="px-3 py-2 bg-slate-100 rounded-lg font-bold";
        close.addEventListener("click",()=>modal.classList.add("hidden"));
        head.append(copy,close);
        const rows=document.createElement("div");rows.id="archivedSchoolProjectRows";rows.className="space-y-2";
        panel.append(head,rows);modal.append(panel);document.body.append(modal);
      }
      modal.classList.remove("hidden");
      const rows=modal.querySelector("#archivedSchoolProjectRows");rows.replaceChildren();
      for(const summary of archived){
        const row=document.createElement("div");row.className="p-3 border rounded-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3";
        const info=document.createElement("div"),name=document.createElement("strong"),meta=document.createElement("p");
        name.textContent=summary.title||"Archived project";meta.className="text-xs text-slate-500 mt-1";
        meta.textContent=(summary.language||"project")+" · archived "+
          (summary.archivedAt?new Date(summary.archivedAt).toLocaleString():"recently");
        info.append(name,meta);
        const restore=document.createElement("button");restore.type="button";restore.textContent="Restore";
        restore.className="px-3 py-2 rounded-lg bg-indigo-700 text-white text-sm font-bold";
        restore.addEventListener("click",async()=>{
          const existing=findCodeProject(projectStorage,uid,summary.projectId);
          if(existing){
            alert("This device already has a project with the same ID. Export or remove that device copy before restoring the archived school version so no work is overwritten.");
            return;
          }
          if(!confirm('Restore "'+(summary.title||"this project")+'" to your school Studio projects?'))return;
          restore.disabled=true;restore.textContent="Restoring…";
          try{
            await restoreV4StudioProject(summary.projectId,summary.revision);
            const detail=await loadV4StudioProject(summary.projectId);
            const project=v4ProjectToLocal(uid,detail);
            validateProject(project);saveCodeProject(projectStorage,uid,project);
            row.remove();renderProjectHome();
            if(!rows.children.length)modal.classList.add("hidden");
          }catch(error){alert("School project could not be restored: "+(error?.message||error));}
          finally{restore.disabled=false;restore.textContent="Restore";}
        });
        row.append(info,restore);rows.append(row);
      }
    }catch(error){alert("Archived school projects are unavailable: "+(error?.message||error));}
    finally{if(button)button.disabled=false;}
  }

  function initialize(){
    if(initialized)return;
    initialized=true;
    el("newCodeProjectBtn")?.addEventListener("click",()=>openWizard());
    el("archivedCodeProjectsBtn")?.addEventListener("click",()=>void showArchivedSchoolProjects());
    el("importCodeProjectBtn")?.addEventListener("click",()=>el("projectZipInput")?.click());
    el("backToProjectsBtn")?.addEventListener("click",()=>{
      showHome();
    });
    el("projectSettingsBtn")?.addEventListener("click",()=>openSettings());
    el("projectWizardClose")?.addEventListener("click",closeWizard);
    el("projectWizardBack")?.addEventListener("click",()=>showWizardStep(1));
    el("projectWizardNext")?.addEventListener("click",()=>showWizardStep(2));
    el("projectWizardCreate")?.addEventListener("click",createFromWizard);
    el("projectSettingsClose")?.addEventListener("click",()=>el("projectSettingsModal")?.classList.add("hidden"));
    el("projectSettingsSave")?.addEventListener("click",saveSettings);
    el("legacyDraftProjectBtn")?.addEventListener("click",()=>{
      if(typeof importLegacyDraft==="function")importLegacyDraft();
    });
    el("guestUpgradeBtn")?.addEventListener("click",()=>{location.href="login.html";});
    el("evidenceFilter")?.addEventListener("change",renderEvidence);
    el("evidenceRefresh")?.addEventListener("click",renderEvidence);
    el("evidenceExpandAll")?.addEventListener("click",()=>{
      const items=[...el("evidenceChecklist")?.querySelectorAll("details.evidence-details")||[]];
      const expand=items.some(item=>!item.open);
      for(const item of items)item.open=expand;
      const button=el("evidenceExpandAll");
      if(button)button.textContent=expand?"Collapse all details":"Expand all details";
    });
    el("evidenceChecklist")?.addEventListener("click",event=>{
      const button=event.target.closest("button[data-evidence-file],button[data-evidence-view]");
      if(!button||!activeProject)return;
      const destination=button.dataset.evidenceView;
      if(destination==="database"&&activeProject.config?.database===true){
        switchStudioView("database");return;
      }
      if(destination==="design"&&activeProject.config?.design!==false){
        const name=button.dataset.evidenceArtifact;
        switchStudioView("design");
        if(name&&[...el("designTypeSelect")?.options||[]].some(option=>option.value===name)){
          el("designTypeSelect").value=name;loadDesignEditor();
          void renderDesignPreview();
        }
        return;
      }
      const file=button.dataset.evidenceFile,number=Number(button.dataset.evidenceLine),column=Number(button.dataset.evidenceColumn),length=Number(button.dataset.evidenceLength);
      const state=captureState();
      if(!file||!Object.hasOwn(state?.files||{},file)||!Number.isInteger(number)||number<1)return;
      if(typeof onRevealEvidence!=="function")return;
      switchStudioView("code");
      try{
        const ok=onRevealEvidence({file,line:number,column,length});
        if(ok===false)throw Error("This file is no longer available in the editor.");
      }catch(error){
        const note=el("evidenceProjectNote");
        if(note)note.textContent="Could not open source: "+(error?.message||"Please open the file manually.");
      }
    });
    el("designTypeSelect")?.addEventListener("change",loadDesignEditor);
    el("saveDesignBtn")?.addEventListener("click",saveDesign);
    el("renderDesignBtn")?.addEventListener("click",()=>void renderDesignPreview());
    el("designEditor")?.addEventListener("input",()=>{
      if(!activeProject)return;
      const type=el("designTypeSelect")?.value||"useCase",value=el("designEditor")?.value||"";
      activeProject.design={...(activeProject.design||{}),[type]:value};
      designPending=activeProject.id;++diagramEpoch;
      clearTimeout(designTimer);designTimer=setTimeout(()=>{try{flushDesignDraft();}catch(error){const status=el("designSaveStatus");if(status)status.textContent=error.message;}},700);
    });
    el("dbRunBtn")?.addEventListener("click",runSql);
    el("dbInsertRowBtn")?.addEventListener("click",()=>openDbRowEditor());
    el("dbExportCsvBtn")?.addEventListener("click",exportDbCsv);
    el("dbNewTableBtn")?.addEventListener("click",()=>{
      switchDbView("sql");
      const input=el("dbSqlInput");
      if(input){input.value="CREATE TABLE new_table (id INTEGER PRIMARY KEY, name TEXT);";input.focus();input.select();}
    });
    document.querySelectorAll("[data-db-view]").forEach(button=>button.addEventListener("click",()=>switchDbView(button.dataset.dbView)));
    el("dbExampleSelect")?.addEventListener("change",event=>{
      const sql=event.target.value;if(sql)el("dbSqlInput").value=sql;
    });
    el("enableProjectDbBtn")?.addEventListener("click",()=>updateConfig({database:true}));
    document.querySelectorAll("[data-studio-view]").forEach(button=>button.addEventListener("click",()=>switchStudioView(button.dataset.studioView)));
    window.addEventListener("online",()=>{void flushCloudSaves();});
    document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden"){if(activeProject)try{flushDesignDraft();saveState(captureState());}catch{}void flushCloudSaves();}});
    document.addEventListener("keydown",event=>{
      if(event.key!=="Escape")return;
      if(!el("projectSettingsModal")?.classList.contains("hidden"))el("projectSettingsModal")?.classList.add("hidden");
      else if(!el("projectWizardModal")?.classList.contains("hidden"))closeWizard();
    });
  }

  function updateQuotaUI(){
    const quota=el("projectQuotaStatus");if(quota)quota.textContent=quotaText();
    const storage=el("projectStorageMode");if(storage)storage.textContent=guest?"Local-only guest storage":cloudStatus;
    const badge=el("activeProjectStorageBadge");if(badge)badge.textContent=guest?"Local only":cloudStatus;
    const create=el("newCodeProjectBtn"),count=readCodeProjects(projectStorage,uid).filter(item=>item.status!=="archived").length;
    if(create&&Number.isFinite(policy.maxProjects)){create.disabled=count>=policy.maxProjects;create.title=create.disabled?"Guest project limit reached. Export or delete a project to create another.":"";}
  }
  function renderProjectHome(){
    const list=el("codeProjectList");if(!list)return;
    const projects=readCodeProjects(projectStorage,uid).filter(project=>project.status!=="archived");
    updateQuotaUI();
    list.replaceChildren();
    if(!projects.length){
      list.innerHTML='<div class="studio-empty-card"><strong>No projects yet</strong><p>Create a Java Console, Desktop, or Information System project to begin.</p></div>';
    }else{
      for(const project of projects){
        const meta=projectTypeMeta(project),card=document.createElement("article");
        card.className="code-project-card";
        const size=Math.max(1,Math.ceil(projectSize(project)/1024));
        card.innerHTML='<div class="code-project-icon">'+escapeHtml(meta.template.icon)+'</div><div class="code-project-card-body"><div class="code-project-card-top"><h3>'+escapeHtml(project.title)+'</h3><span>'+escapeHtml(prettyDate(project.lastOpenedAt))+'</span></div><p>'+escapeHtml(meta.detail)+' · '+Object.keys(project.state?.files||{}).length+' files · '+size+' KB</p><div class="code-project-card-actions"><button type="button" data-open>Open project</button><button type="button" data-copy>Duplicate</button><button type="button" data-delete class="danger-subtle">Delete</button></div></div>';
        if(project.assessment?.provisionedBy==="assessment-launch"&&project.assessment.offeringId){
          // Do not offer destructive local/cloud deletion or an editable
          // duplicate of a teacher-assigned examination project.
          card.querySelector("[data-copy]")?.remove();
          card.querySelector("[data-delete]")?.remove();
        }
        card.querySelector("[data-copy]")?.addEventListener("click",()=>{
          try{
            validateProject(project,{creating:true});
            const copy=createCodeProject(projectStorage,uid,{title:project.title+" Copy",templateId:project.template,config:project.config});
            copy.state=clone(project.state);copy.database=clone(project.database);copy.design=clone(project.design);copy.evidence={events:[],runs:[]};
            const saved=saveCodeProject(projectStorage,uid,copy);if(cloudEnabled)scheduleCloudSave(saved);renderProjectHome();
          }catch(error){alert(error.message);}
        });
        const openButton=card.querySelector("[data-open]");
        if(project.assessment?.provisionedBy==="assessment-launch"&&project.assessment.offeringId){
          openButton.textContent="Open from My Assessments";
          openButton.title="Assessment workspaces must be opened through the current teacher-controlled exam session.";
          openButton.addEventListener("click",()=>{
            location.assign("student-assessments.html#"+encodeURIComponent(project.assessment.taskId||project.assessment.assessmentId));
          });
        }else openButton.addEventListener("click",()=>openProjectById(project.id));
        card.querySelector("[data-delete]")?.addEventListener("click",async()=>{
          const warning=guest?'Delete "'+project.title+'"? Guest projects exist only on this browser. Export a ZIP first if you need a copy.':'Delete "'+project.title+'"? This removes the project from this device and its project cloud record. Export a ZIP first if you need a copy.';
          if(!confirm(warning))return;
          deletedProjects.add(project.id);
          clearTimeout(cloudTimers.get(project.id));cloudTimers.delete(project.id);cloudPending.delete(project.id);
          await (cloudWrites.get(project.id)||Promise.resolve()).catch(()=>{});
          if(cloudEnabled){
            try{await archiveV4StudioProject(project.id);}
            catch(error){
              deletedProjects.delete(project.id);
              const localOnly=confirm("The verified-school copy could not be archived: "+
                (error?.message||"school storage unavailable")+
                "\n\nDelete only this device/legacy copy anyway? The school copy may reappear after synchronization.");
              if(!localOnly)return;
              deletedProjects.add(project.id);
            }
          }
          deleteCodeProject(projectStorage,uid,project.id);
          let activeSchool=null;
          try{activeSchool=await currentV4StudioSchool();}catch{}
          if(cloudEnabled&&activeSchool?.compatibilityMode!=="v4_only")try{
            await (cloudWrites.get(project.id)||Promise.resolve()).catch(()=>{});
            await deleteDoc(doc(db,"student_code_projects",uid,"projects",project.id));
          }catch(error){console.warn("Cloud project deletion unavailable:",error);
            alert("The local project was deleted, but its legacy cloud copy could not be removed. It may reappear while compatibility mode is enabled.");}
          renderProjectHome();
        });
        list.append(card);
      }
    }
    const legacy=el("legacyDraftProjectBtn");
    if(legacy)legacy.classList.toggle("hidden",!legacyDraftAvailable);
  }

  function showHome(){
    ++openEpoch;++diagramEpoch;
    initialize();
    if(activeProject){try{flushDesignDraft();saveState(captureState());}catch(error){alert("Device draft could not be saved: "+error.message);return false;}}
    activeProject=null;void flushCloudSaves();
    window.dispatchEvent(new CustomEvent("adminerva:studio-home"));
    renderProjectHome();
    el("projectHome")?.classList.remove("hidden");
    el("studioShell")?.classList.add("hidden");
    document.title=(guest?"Adminerva Studio · Guest":"Adminerva Studio")+" · Adminerva";
    const guestNotice=el("guestProjectNotice");if(guestNotice)guestNotice.classList.toggle("hidden",!guest);
    if(cloudEnabled)void mergeCloudProjects();
  }

  function assessmentProjectId(assessmentId){
    const raw=String(assessmentId||"").replace(/[^A-Za-z0-9_-]/g,"_")||"task";
    if(raw.length<=68)return "assessment-"+raw;
    let hash=2166136261;
    for(const char of raw){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619)>>>0;}
    return "assessment-"+raw.slice(0,55)+"-"+hash.toString(36);
  }

  async function ensureAssessmentProject(context={}){
    const assessmentId=String(context.assessmentId||"").trim();
    if(!assessmentId)throw Error("Assessment project provisioning requires an assessment ID.");
    const projectId=assessmentProjectId(assessmentId);
    let project=findCodeProject(projectStorage,uid,projectId)||
      readCodeProjects(projectStorage,uid).find(item=>item.assessment?.assessmentId===assessmentId);

    // Personalized task metadata can arrive while the student is editing.
    // Do not replace the active Monaco workspace with an older local/cloud
    // snapshot: first capture the in-memory editor and keep that editor open.
    const sameOpenAssessment=Boolean(activeProject&&project&&
      activeProject.id===project.id&&activeProject.assessment?.assessmentId===assessmentId);
    if(sameOpenAssessment){
      const live=captureState();
      if(!live?.files||!Object.keys(live.files).length)
        throw Error("Cannot refresh assessment details until the open editor is ready.");
      project=store({...activeProject,state:live},true);
    }

    if(cloudEnabled&&!sameOpenAssessment){
      const lookupId=project?.id||projectId;
      try{
        project=await resolveCloudProject(lookupId,{local:project});
      }catch(error){
        const message=String(error?.message||error||"");
        if(/archiv/i.test(message)){
          const archived=await listArchivedV4StudioProjects(),match=archived?.find(item=>item.projectId===lookupId);
          if(match){await restoreV4StudioProject(lookupId,match.revision);project=await resolveCloudProject(lookupId,{local:project});}
          else throw error;
        }else{
          if(!project)throw Error("Could not check for an existing cloud assessment project. Reconnect before creating a new one.");
          setCloudStatus("Cloud unavailable · device draft retained","error");
        }
      }
    }

    const templateId=CODE_PROJECT_TEMPLATES[context.templateId]?context.templateId:"java-console";
    const template=CODE_PROJECT_TEMPLATES[templateId]||CODE_PROJECT_TEMPLATES["java-console"];
    const desiredConfig={...template.config,...(context.config||{})};
    const ownership={
      assessmentId,
      taskId:String(context.taskId||assessmentId),
      sessionEpoch:Number(context.manualSessionEpoch||0),
      title:String(context.title||"Studio assessment").slice(0,180),
      assessmentType:String(context.assessmentType||"Assessment").slice(0,80),
      submissionSource:"studio",
      subject:String(context.subject||"Computer Programming").slice(0,120),
      offeringId:String(context.offeringId||"").slice(0,160),
      personalized:context.personalized===true,
      variantId:String(context.variantId||project?.assessment?.variantId||"").slice(0,160),
      attempt:Number.isInteger(Number(context.attempt))?Number(context.attempt):
        (Number.isInteger(Number(project?.assessment?.attempt))?Number(project.assessment.attempt):null),
      studioProjectProfile:String(context.studioProjectProfile||context.projectProfile||"auto").slice(0,40),
      provisioningVersion:"runtime-profile-v2",
      provisionedBy:"assessment-launch"
    };

    if(project){
      // If an earlier Adminerva version generated the wrong starter and the learner
      // has not changed that starter at all, replace only that untouched scaffold.
      // Any edited source/database/design data is preserved.
      const priorTemplate=CODE_PROJECT_TEMPLATES[project.template];
      const untouchedStarter=project.assessment?.provisionedBy==="assessment-launch" &&
        project.template!==template.id && matchesTemplateStarter(project,priorTemplate);
      const provisioningRefresh=
        project.assessment?.provisioningVersion!==ownership.provisioningVersion||
        project.assessment?.studioProjectProfile!==ownership.studioProjectProfile;
      const nextConfig={...(project.config||{}),...desiredConfig};
      // Correct older incorrectly inferred runtimes once. After the v2 migration,
      // preserve a learner's console/desktop execution choice across reopen/reload.
      if(!provisioningRefresh&&template.lang==="java"&&
        ["console","desktop"].includes(project.config?.runMode)){
        nextConfig.runMode=project.config.runMode;
      }
      const next={
        ...project,
        template:template.id,
        lang:template.lang,
        config:nextConfig,
        assessment:ownership,
        ...(untouchedStarter?{
          state:clone(template.workspace),
          database:clone(template.database||{tables:{},history:[]}),
          design:clone(template.design||{})
        }:{})
      };
      const changed=untouchedStarter||
        JSON.stringify(project.assessment||{})!==JSON.stringify(ownership)||
        project.template!==next.template||project.lang!==next.lang||
        JSON.stringify(project.config||{})!==JSON.stringify(next.config||{});
      if(sameOpenAssessment){
        // Updating the variant or session binding is not a request to
        // reopen/reset source code. Keep the existing editor models intact.
        if(changed)project=store(next,true);
        syncAssessmentCapabilities();updateProjectHeading();
        return {project:activeProject,created:false,projectId:activeProject.id};
      }
      if(changed){project=saveCodeProject(projectStorage,uid,next);if(cloudEnabled)writeMarker(project.id,{...readMarker(project.id),pending:true});}
      activateProject(project);
      return {project:activeProject,created:false,projectId:activeProject.id};
    }

    if(context.allowCreate===false)return {project:null,created:false,projectId};
    validateProject({state:{files:{}},database:{tables:{}},design:{},evidence:{}},{creating:true});
    const projectTitle=String(context.projectTitle||context.title||"Studio Assessment").trim().slice(0,120)||"Studio Assessment";
    project=createCodeProject(projectStorage,uid,{
      id:projectId,title:projectTitle,templateId:template.id,
      config:desiredConfig,assessment:ownership
    });
    try{
      validateProject(project);
      activateProject(project);
      return {project:activeProject,created:true,projectId:activeProject.id};
    }catch(error){
      deleteCodeProject(projectStorage,uid,project.id);
      throw error;
    }
  }

  async function verifyAssessmentProjectOpen(project){
    const binding=project?.assessment;
    if(binding?.provisionedBy!=="assessment-launch"||!binding.offeringId)return;
    const tasks=await listV4StudioAssignments();
    if(!Array.isArray(tasks))
      throw Error("Your school exam access could not be checked. Reconnect and open the assessment from My Assessments.");
    const task=tasks.find(item=>item.taskId===(binding.taskId||binding.assessmentId));
    if(!task||task.submissionSource!=="studio")
      throw Error("This school assessment is unavailable. Open it from My Assessments.");
    if(task.manualOpenRequired===true){
      if(task.manualAccessState!=="open"||task.lifecycle!=="active"||task.windowStatus==="closed")
        throw Error("Your teacher has closed this exam session. The project can be resumed after the next teacher opening.");
      if(Number(binding.sessionEpoch||0)!==Number(task.manualSessionEpoch||0))
        throw Error("This project belongs to an earlier class session. Reenter through My Assessments to resume its current session.");
    }
  }
  async function openProjectById(id){
    const turn=++openEpoch;
    const isCurrent=()=>turn===openEpoch&&!deletedProjects.has(id)&&(!cloudEnabled||auth.currentUser?.uid===uid);
    if(!isCurrent())return;
    let project=findCodeProject(projectStorage,uid,id);
    try{
      if(project)await verifyAssessmentProjectOpen(project);
    }catch(error){return alert(error?.message||"Exam access unavailable.");}
    if(cloudEnabled){
      try{
        if(cloudWrites.has(id))await cloudWrites.get(id);
        if(cloudPending.has(id))await flushOne(id);
        if(!isCurrent())return;
        project=await resolveCloudProject(id,{local:findCodeProject(projectStorage,uid,id)||project,shouldApply:isCurrent});
        if(project)await verifyAssessmentProjectOpen(project);
      }catch(error){
        if(!isCurrent())return;
        if(project?.assessment?.provisionedBy==="assessment-launch"&&project.assessment.offeringId)
          return alert("School exam project could not be opened: "+String(error?.message||error)+
            "\nOpen the assessment through My Assessments.");
        if(!project||/archiv|not active|account changed|sign in with your project account/i.test(String(error?.message||""))||/permission-denied|unauthenticated/.test(String(error?.code||"")))return alert("Cloud project could not be opened: "+String(error?.message||error));
        activateProject(project);setCloudStatus("Cloud unavailable · device draft retained","error",id);return;
      }
    }
    if(!isCurrent())return;
    if(!project)return alert("This project is not available in your device or cloud account.");
    try{await verifyAssessmentProjectOpen(project);}
    catch(error){return alert(error?.message||"Exam access unavailable.");}
    activateProject(project);
  }

  function importLegacyState({title,templateId,config={},state}={}){
    if(!state?.files||!Array.isArray(state.fileOrder)||!state.fileOrder.length)
      throw Error("The older Studio draft is unavailable or invalid.");
    validateProject({...CODE_PROJECT_TEMPLATES[templateId]||CODE_PROJECT_TEMPLATES["java-blank"],
      title:String(title||"Imported project"),state},{creating:true});
    const project=createCodeProject(projectStorage,uid,{title,templateId,config});
    try{
      project.lang=state.lang||project.lang;
      project.state=clone(state);
      validateProject(project);
      activateProject(project);
      return activeProject;
    }catch(error){
      deleteCodeProject(projectStorage,uid,project.id);
      throw error;
    }
  }

  /**
   * Importing from the project home creates a named project; importing inside
   * an open project replaces that project's files after an undo snapshot.
   * Metadata and quota checks run before either case writes imported data.
   */
  function importZipWorkspace(state,bundle=null){
    const templateByLang={java:"java-blank",python:"python-console",web:"web"};
    const templateId=bundle?.template||templateByLang[state?.lang]||"java-blank";
    const template=CODE_PROJECT_TEMPLATES[templateId]||CODE_PROJECT_TEMPLATES["java-blank"];
    const base=activeProject||{
      title:"Imported "+String(state?.lang||"Code").toUpperCase()+" Project",
      template:template.id,lang:state?.lang,config:clone(template.config),
      state, database:clone(template.database||{tables:{},history:[]}),
      design:clone(template.design||{}),evidence:{events:[],runs:[]}
    };
    const next=prepareProjectImport(base,state,bundle,policy);
    validateProject(next,{creating:!activeProject});
    if(activeProject){
      localStorage.setItem(undoKey(activeProject.id),
        JSON.stringify(captureState()));
      store(next,true);
      openProject(activeProject);
      el("undoRestoreBtn")?.classList.remove("hidden");
      dbSelectedTable="";dbView="browse";renderDatabase();renderEvidence();loadDesignEditor();
      return activeProject;
    }
    const created=createCodeProject(projectStorage,uid,{
      title:next.title,templateId:template.id,config:next.config
    });
    try{
      const imported={...next,id:created.id,ownerUid:uid,createdAt:created.createdAt};
      validateProject(imported);
      activateProject(imported);
      return activeProject;
    }catch(error){
      deleteCodeProject(projectStorage,uid,created.id);
      throw error;
    }
  }

  function importBundleMetadata(bundle){
    if(!activeProject||!bundle||bundle.format!=="adminerva-project-bundle")return false;
    const next=clone(activeProject);
    if(typeof bundle.title==="string"&&bundle.title.trim())next.title=bundle.title.trim().slice(0,120);
    if(bundle.template&&CODE_PROJECT_TEMPLATES[bundle.template])next.template=bundle.template;
    if(typeof bundle.lang==="string")next.lang=bundle.lang;
    if(bundle.config&&typeof bundle.config==="object")next.config={...(next.config||{}),...clone(bundle.config)};
    if(bundle.database&&typeof bundle.database==="object")next.database=clone(bundle.database);
    if(bundle.design&&typeof bundle.design==="object")next.design=clone(bundle.design);
    validateProject(next);
    activeProject=next;store(activeProject,true);onConfigChange?.(activeProject.config);
    dbSelectedTable="";dbView="browse";renderDatabase();renderEvidence();loadDesignEditor();
    return true;
  }

  function resetToTemplate(){
    if(!activeProject)return false;
    const template=CODE_PROJECT_TEMPLATES[activeProject.template]||CODE_PROJECT_TEMPLATES["java-blank"];
    activeProject.state=clone(template.workspace);
    activeProject.database=clone(template.database||{tables:{},history:[]});
    activeProject.design=clone(template.design||{});
    activeProject.evidence={events:[],runs:[]};
    store(activeProject,true);
    openProject(activeProject);
    switchStudioView("code");
    return true;
  }

  function syncAssessmentCapabilities(){
    if(!activeProject)return;
    const assessmentProject=activeProject.assessment?.provisionedBy==="assessment-launch";
    const designAllowed=!assessmentProject||activeProject.config?.design!==false;
    const databaseAllowed=!assessmentProject||activeProject.config?.database===true;
    const designButton=document.querySelector('[data-studio-view="design"]');
    const databaseButton=document.querySelector('[data-studio-view="database"]');
    designButton?.classList.toggle("hidden",!designAllowed);
    databaseButton?.classList.toggle("hidden",!databaseAllowed);
    el("studioPanelDesign")?.setAttribute("data-capability-enabled",String(designAllowed));
    el("studioPanelDatabase")?.setAttribute("data-capability-enabled",String(databaseAllowed));
    const reset=el("resetBtn");
    if(reset){
      reset.textContent=assessmentProject?"Reset assessment starter":"Reset files";
      reset.title=assessmentProject
        ?"Replace this assessment project's files with its original assigned starter. Your current files will be discarded after confirmation."
        :"Reset this project to its original template.";
    }
  }

  function activateProject(project){
    ++openEpoch;++diagramEpoch;
    if(activeProject&&activeProject.id!==project.id){flushDesignDraft();saveState(captureState());}
    initialize();
    activeProject={...project,lastOpenedAt:new Date().toISOString()};
    activeProject=cacheProject(activeProject);
    el("projectHome")?.classList.add("hidden");
    el("studioShell")?.classList.remove("hidden");
    updateProjectHeading();
    syncAssessmentCapabilities();
    openProject(activeProject);
    switchStudioView("code");
    window.dispatchEvent(new CustomEvent("adminerva:studio-ready",{detail:{projectId:activeProject.id}}));
    for(const id of ["cloudSaveProjectBtn","cloudLoadProjectBtn","loadProjectBtn","snapshotBtn"]){
      const control=el(id);if(control)control.classList.add("hidden");
    }
    const undo=el("undoRestoreBtn");
    if(undo)undo.classList.toggle("hidden",
      !localStorage.getItem(undoKey(activeProject.id)));
    updateQuotaUI();
    if(cloudEnabled){
      const marker=readMarker(activeProject.id);
      if(marker.pending||!marker.kind)scheduleCloudSave(activeProject);
      else setCloudStatus("Saved to cloud","success",activeProject.id);
    }
  }

  function updateProjectHeading(){
    if(!activeProject)return;
    const title=el("activeProjectTitle"),meta=el("activeProjectMeta");
    if(title)title.textContent=activeProject.title;
    if(meta){
      const kb=Math.max(1,Math.ceil(projectSize(activeProject)/1024));
      const assessmentMeta=assessmentProfileMeta(activeProject);
      meta.textContent=projectTypeMeta(activeProject).detail+" · "+Object.keys(activeProject.state?.files||{}).length+" files · "+kb+" KB"+
        (assessmentMeta?" · "+assessmentMeta:"")+(guest?" · local guest project":"");
    }
    document.title=activeProject.title+" · Adminerva";
  }

  function openWizard(){
    selectedTemplate="java-information";
    el("projectWizardTitle").value="";
    showWizardStep(1);renderTemplateChoices();
    el("projectWizardModal")?.classList.remove("hidden");
  }
  function closeWizard(){el("projectWizardModal")?.classList.add("hidden");}
  function showWizardStep(step){
    el("projectWizardStep1")?.classList.toggle("hidden",step!==1);
    el("projectWizardStep2")?.classList.toggle("hidden",step!==2);
    el("projectWizardBack")?.classList.toggle("hidden",step===1);
    el("projectWizardNext")?.classList.toggle("hidden",step!==1);
    el("projectWizardCreate")?.classList.toggle("hidden",step!==2);
    if(step===2)configureWizardForTemplate();
  }
  function renderTemplateChoices(){
    const container=el("projectTemplateChoices");if(!container)return;
    container.replaceChildren();
    for(const template of Object.values(CODE_PROJECT_TEMPLATES)){
      const card=document.createElement("button");card.type="button";card.className="project-template-card";
      card.dataset.selected=String(template.id===selectedTemplate);
      card.innerHTML='<span class="project-template-icon">'+escapeHtml(template.icon)+'</span><strong>'+escapeHtml(template.title)+'</strong><p>'+escapeHtml(template.description)+'</p>';
      card.addEventListener("click",()=>{selectedTemplate=template.id;renderTemplateChoices();});
      container.append(card);
    }
  }
  function configureWizardForTemplate(){
    const template=CODE_PROJECT_TEMPLATES[selectedTemplate]||CODE_PROJECT_TEMPLATES["java-blank"];
    el("projectWizardTemplateName").textContent=template.title;
    const java=template.lang==="java";
    el("wizardJavaOptions")?.classList.toggle("hidden",!java);
    el("wizardRunMode").value=template.config.runMode||"console";
    el("wizardDatabase").checked=Boolean(template.config.database);
    el("wizardDatabase").disabled=template.lang!=="java";
  }
  function createFromWizard(){
    const title=el("projectWizardTitle").value.trim();
    if(!title)return alert("Enter a project name.");
    try{validateProject({state:{files:{}},database:{tables:{}},design:{},evidence:{}},{creating:true});}
    catch(error){return alert(error.message);}
    const template=CODE_PROJECT_TEMPLATES[selectedTemplate]||CODE_PROJECT_TEMPLATES["java-blank"];
    const config={...template.config};
    if(template.lang==="java"){
      config.javaVersion=el("wizardJavaVersion").value||"17";
      config.runMode=el("wizardRunMode").value==="desktop"?"desktop":"console";
      config.database=Boolean(el("wizardDatabase").checked);
    }
    const project=createCodeProject(projectStorage,uid,{title,templateId:template.id,config});
    try{validateProject(project);}catch(error){deleteCodeProject(projectStorage,uid,project.id);return alert(error.message);}
    closeWizard();activateProject(project);
  }

  function openSettings(){
    if(!activeProject)return;
    el("projectSettingsTitle").value=activeProject.title;
    el("projectSettingsRunMode").value=activeProject.config?.runMode||"console";
    el("projectSettingsDatabase").checked=Boolean(activeProject.config?.database);
    const assessmentLocked=activeProject.assessment?.provisionedBy==="assessment-launch";
    el("projectSettingsRunMode").disabled=false;
    el("projectSettingsDatabase").disabled=assessmentLocked;
    el("projectSettingsRunMode").title=assessmentLocked
      ?"Execution mode can be changed for testing; the assessment requirements remain unchanged."
      :"";
    el("projectSettingsDatabase").title=assessmentLocked?"Database access is set by this assessment.":"";
    el("projectSettingsJavaOptions")?.classList.toggle("hidden",activeProject.lang!=="java");
    el("projectSettingsModal")?.classList.remove("hidden");
  }
  function saveSettings(){
    if(!activeProject)return;
    const title=el("projectSettingsTitle").value.trim();
    if(!title)return alert("Project name cannot be empty.");
    const assessmentLocked=activeProject.assessment?.provisionedBy==="assessment-launch";
    const next={...activeProject,title:title.slice(0,120),config:{...activeProject.config}};
    if(next.lang==="java"){
      next.config.runMode=el("projectSettingsRunMode").value==="desktop"?"desktop":"console";
      if(!assessmentLocked)next.config.database=Boolean(el("projectSettingsDatabase").checked);
    }
    try{
      store(next,true);onConfigChange?.(activeProject.config);
      el("projectSettingsModal")?.classList.add("hidden");
      renderDatabase();renderEvidence();
    }catch(error){alert("Project settings could not be saved: "+error.message);}
  }
  function updateConfig(patch){
    if(!activeProject)return;
    if(activeProject.assessment?.provisionedBy==="assessment-launch"&&
      ["database","design"].some(key=>Object.hasOwn(patch||{},key))){
      onConfigChange?.(activeProject.config||{});
      return;
    }
    const next={...activeProject,config:{...(activeProject.config||{}),...patch}};
    try{store(next,true);onConfigChange?.(activeProject.config);renderDatabase();}
    catch(error){alert("Project settings could not be saved: "+error.message);}
  }

  function switchStudioView(view){
    if(!activeProject)return;
    const valid=["code","design","database","evidence","monitor"];
    if(view==="application"){
      switchStudioView("code");
      document.getElementById("desktopTab")?.click();
      return;
    }
    if(view==="terminal"){
      switchStudioView("code");
      document.getElementById("consoleTab")?.click();
      return;
    }
    let chosen=valid.includes(view)?view:"code";
    if(activeProject.assessment?.provisionedBy==="assessment-launch"){
      if(chosen==="design"&&activeProject.config?.design===false)chosen="code";
      if(chosen==="database"&&activeProject.config?.database!==true)chosen="code";
    }
    for(const name of valid){
      el("studioPanel"+name[0].toUpperCase()+name.slice(1))?.classList.toggle("hidden",name!==chosen);
    }
    document.querySelectorAll("[data-studio-view]").forEach(button=>button.dataset.active=String(button.dataset.studioView===chosen));
    if(chosen==="design"){loadDesignEditor();void renderDesignPreview();}
    if(chosen==="database")renderDatabase();
    if(chosen==="evidence")renderEvidence();
    if(chosen==="monitor")renderMonitor();
  }

  function flushDesignDraft(){
    clearTimeout(designTimer);designTimer=null;
    if(!activeProject||designPending!==activeProject.id)return;
    store(activeProject,true);designPending=null;
    const status=el("designSaveStatus");if(status)status.textContent="Autosaved";
  }
  function loadDesignEditor(){
    ++diagramEpoch;
    if(!activeProject)return;
    try{flushDesignDraft();}catch(error){const status=el("designSaveStatus");if(status)status.textContent=error.message;}
    const type=el("designTypeSelect")?.value||"useCase";
    const editor=el("designEditor");if(editor)editor.value=activeProject.design?.[type]||"";
  }
  function saveDesign(){
    if(!activeProject)return;
    const type=el("designTypeSelect").value||"useCase";
    activeProject.design={...(activeProject.design||{}),[type]:el("designEditor").value};
    clearTimeout(designTimer);designTimer=null;store(activeProject,true);designPending=null;const status=el("designSaveStatus");if(status)status.textContent="Saved";
    void renderDesignPreview();renderEvidence();
  }
  async function renderDesignPreview(){
    const target=el("designPreview");if(!target||!activeProject)return;
    const turn=++diagramEpoch,projectId=activeProject.id;
    const current=()=>turn===diagramEpoch&&activeProject?.id===projectId;
    const source=el("designEditor")?.value.trim();
    if(!source){target.innerHTML='<p class="studio-empty">Add Mermaid diagram syntax to preview this design.</p>';return;}
    if(!globalThis.mermaid){target.textContent=source;return;}
    try{
      globalThis.mermaid.initialize({startOnLoad:false,securityLevel:"strict",theme:"neutral"});
      const id="adminervaDiagram"+Date.now()+"_"+turn;
      const result=await globalThis.mermaid.render(id,source);
      if(current())target.innerHTML=result.svg;
    }catch(error){if(current())target.innerHTML='<p class="studio-error">Diagram error: '+escapeHtml(error.message)+'</p>';}
  }

  function sqlLiteral(value){
    if(value===null||value===undefined)return "NULL";
    if(typeof value==="number"&&Number.isFinite(value))return String(value);
    if(typeof value==="boolean")return value?"TRUE":"FALSE";
    return "'"+String(value).replace(/'/g,"''")+"'";
  }
  function selectedDbTable(){
    return dbSelectedTable&&activeProject?.database?.tables?.[dbSelectedTable]?activeProject.database.tables[dbSelectedTable]:null;
  }
  function exportDbCsv(){
    const table=selectedDbTable();if(!table)return alert("Select a table first.");
    const columns=(table.columns||[]).map(column=>column.name);
    const csvCell=value=>{
      const text=value==null?"":String(value);
      return /[",\n\r]/.test(text)?'"'+text.replace(/"/g,'""')+'"':text;
    };
    const lines=[columns.map(csvCell).join(","),...(table.rows||[]).map(row=>columns.map(column=>csvCell(row[column])).join(","))];
    const blob=new Blob([lines.join("\n")],{type:"text/csv;charset=utf-8"});
    const url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url;a.download=dbSelectedTable+".csv";a.click();URL.revokeObjectURL(url);
  }
  function switchDbView(view){
    dbView=["browse","structure","sql"].includes(view)?view:"browse";
    for(const name of ["browse","structure","sql"]){
      el("db"+name[0].toUpperCase()+name.slice(1)+"Panel")?.classList.toggle("hidden",name!==dbView);
    }
    document.querySelectorAll("[data-db-view]").forEach(button=>button.dataset.active=String(button.dataset.dbView===dbView));
    const insert=el("dbInsertRowBtn");if(insert)insert.classList.toggle("hidden",dbView!=="browse"||!selectedDbTable());
    if(dbView==="browse")renderDbBrowse();
    if(dbView==="structure")renderDbStructure();
  }
  function renderDatabase(){
    if(!activeProject)return;
    const enabled=Boolean(activeProject.config?.database);
    el("dbDisabledState")?.classList.toggle("hidden",enabled);
    el("dbWorkspace")?.classList.toggle("hidden",!enabled);
    if(!enabled)return;
    const summaries=databaseSummary(activeProject.database),schema=el("dbSchemaList");
    if(!activeProject.database)activeProject.database={tables:{},history:[]};
    if(!dbSelectedTable||!activeProject.database.tables?.[dbSelectedTable])dbSelectedTable=summaries[0]?.name||"";
    const count=el("dbTableCount");if(count)count.textContent=summaries.length+" table"+(summaries.length===1?"":"s");
    if(schema){
      schema.innerHTML=summaries.length?summaries.map(table=>'<button type="button" data-table="'+escapeHtml(table.name)+'" data-active="'+(table.name===dbSelectedTable)+'"><strong>'+escapeHtml(table.name)+'</strong><span>'+table.rows+' rows · '+table.columns.length+' columns</span></button>').join(""):'<p class="studio-empty">No tables yet. Open SQL and create your first table.</p>';
      schema.querySelectorAll("[data-table]").forEach(button=>button.addEventListener("click",()=>{
        dbSelectedTable=button.dataset.table||"";renderDatabase();
      }));
    }
    const table=selectedDbTable(),selectedName=el("dbSelectedTableName"),selectedMeta=el("dbSelectedTableMeta");
    if(selectedName)selectedName.textContent=dbSelectedTable||"No table selected";
    if(selectedMeta)selectedMeta.textContent=table?(table.rows?.length||0)+" rows · "+(table.columns?.length||0)+" columns":"";
    const history=el("dbHistory");
    if(history)history.innerHTML=(activeProject.database?.history||[]).slice(0,10).map(item=>'<li><span>'+escapeHtml(item.type)+'</span><code>'+escapeHtml(item.sql)+'</code><small>'+escapeHtml(prettyDate(item.at))+'</small></li>').join("")||'<li class="studio-empty">No SQL activity yet.</li>';
    switchDbView(dbView);
  }
  function renderDbBrowse(){
    const target=el("dbBrowseTable"),table=selectedDbTable();if(!target)return;
    if(!table){target.innerHTML='<div class="studio-empty-card db-empty"><strong>No table selected</strong><p>Create or select a table to browse its data.</p><button type="button" data-open-sql class="primary-small">Open SQL</button></div>';target.querySelector("[data-open-sql]")?.addEventListener("click",()=>switchDbView("sql"));return;}
    const columns=table.columns||[],rows=table.rows||[],primary=columns.find(column=>column.primaryKey);
    const head='<th class="db-row-actions">Actions</th>'+columns.map(column=>'<th>'+escapeHtml(column.name)+'<small>'+escapeHtml(column.type)+(column.primaryKey?' · PRIMARY':'')+'</small></th>').join("");
    const body=rows.map((row,index)=>{
      const actions=primary?'<div class="db-row-action-buttons"><button type="button" data-db-edit="'+index+'">Edit</button><button type="button" data-db-delete="'+index+'" class="danger-subtle">Delete</button></div>':'<span class="studio-muted">No primary key</span>';
      return '<tr><td class="db-row-actions">'+actions+'</td>'+columns.map(column=>'<td>'+escapeHtml(row[column.name]??"NULL")+'</td>').join("")+'</tr>';
    }).join("");
    target.innerHTML='<div class="db-browse-summary"><strong>'+escapeHtml(dbSelectedTable)+'</strong><span>'+rows.length+' row'+(rows.length===1?"":"s")+'</span>'+(primary?'':'<span class="db-warning">Add a primary key to enable visual edit/delete.</span>')+'</div><div class="studio-table-wrap db-data-table"><table class="studio-table"><thead><tr>'+head+'</tr></thead><tbody>'+body+'</tbody></table></div>'+(rows.length?'':'<div class="db-zero-state">This table has no rows yet. Use <strong>Insert row</strong> or SQL to add data.</div>');
    target.querySelectorAll("[data-db-edit]").forEach(button=>button.addEventListener("click",()=>openDbRowEditor(Number(button.dataset.dbEdit))));
    target.querySelectorAll("[data-db-delete]").forEach(button=>button.addEventListener("click",()=>deleteDbRow(Number(button.dataset.dbDelete))));
  }
  function renderDbStructure(){
    const target=el("dbStructureTable"),table=selectedDbTable();if(!target)return;
    if(!table){target.innerHTML='<p class="studio-empty">Select a table to inspect its structure.</p>';return;}
    const rows=(table.columns||[]).map((column,index)=>[index+1,column.name,column.type,column.primaryKey?"PRIMARY KEY":"—"]);
    renderGridTable(target,["#","Column","Type","Key"],rows);
  }
  function openDbRowEditor(rowIndex=null){
    const editor=el("dbRowEditor"),table=selectedDbTable();if(!editor||!table)return;
    const editing=Number.isInteger(rowIndex),row=editing?table.rows[rowIndex]:{};
    const fields=(table.columns||[]).map(column=>{
      const value=row?.[column.name]??"";
      const inputType=/^(INTEGER|REAL|NUMERIC|DECIMAL|FLOAT|DOUBLE)$/i.test(column.type)?"number":"text";
      const step=inputType==="number"&&!/^INTEGER$/i.test(column.type)?' step="any"':"";
      return '<label><span>'+escapeHtml(column.name)+' <small>'+escapeHtml(column.type)+(column.primaryKey?" · PK":"")+'</small></span><input data-db-field="'+escapeHtml(column.name)+'" type="'+inputType+'"'+step+' value="'+escapeHtml(value)+'" placeholder="'+escapeHtml(column.name)+'"></label>';
    }).join("");
    editor.dataset.rowIndex=editing?String(rowIndex):"";
    editor.innerHTML='<div class="db-row-editor-head"><div><strong>'+(editing?"Edit row":"Insert row")+'</strong><span class="studio-muted">'+escapeHtml(dbSelectedTable)+'</span></div><button type="button" data-db-cancel>×</button></div><form id="dbRowForm" class="db-row-form">'+fields+'<div class="db-row-form-actions"><button type="button" data-db-cancel>Cancel</button><button type="submit" class="primary-small">'+(editing?"Save changes":"Insert row")+'</button></div></form>';
    editor.classList.remove("hidden");
    editor.querySelectorAll("[data-db-cancel]").forEach(button=>button.addEventListener("click",()=>editor.classList.add("hidden")));
    editor.querySelector("form")?.addEventListener("submit",event=>{event.preventDefault();saveDbRow(editing?rowIndex:null);});
    editor.querySelector("input")?.focus();
  }
  function formDbValues(){
    const result={};el("dbRowEditor")?.querySelectorAll("[data-db-field]").forEach(input=>{
      const raw=input.value;
      result[input.dataset.dbField]=input.type==="number"?(raw===""?null:Number(raw)):raw;
    });return result;
  }
  function saveDbRow(rowIndex=null){
    const table=selectedDbTable();if(!table)return;
    const values=formDbValues(),columns=table.columns||[],editing=Number.isInteger(rowIndex);
    let sql="";
    if(editing){
      const primary=columns.find(column=>column.primaryKey);if(!primary)return alert("Visual editing requires a primary key.");
      const original=table.rows[rowIndex]?.[primary.name];
      if(original==null||table.rows.filter(row=>row[primary.name]===original).length!==1)
        return alert("This older row has a missing or duplicate primary key. Visual editing is blocked to protect other rows. Repair the key in SQL or export a backup first.");
      const set=columns.map(column=>column.name+" = "+sqlLiteral(values[column.name])).join(", ");
      sql="UPDATE "+dbSelectedTable+" SET "+set+" WHERE "+primary.name+" = "+sqlLiteral(original)+";";
    }else{
      sql="INSERT INTO "+dbSelectedTable+" ("+columns.map(column=>column.name).join(", ")+") VALUES ("+columns.map(column=>sqlLiteral(values[column.name])).join(", ")+");";
    }
    try{
      const result=executeAdminervaSql(activeProject.database,sql),candidate={...activeProject,database:result.db};
      validateProject(candidate);activeProject.database=result.db;store(activeProject,true);
      el("dbRowEditor")?.classList.add("hidden");renderDatabase();renderEvidence();
      const note=el("dbStatus");if(note)note.textContent=result.type+" completed · "+result.affected+" row(s)";
    }catch(error){alert("Database update failed: "+error.message);}
  }
  function deleteDbRow(rowIndex){
    const table=selectedDbTable();if(!table)return;
    const primary=(table.columns||[]).find(column=>column.primaryKey);if(!primary)return alert("Visual deletion requires a primary key.");
    const value=table.rows[rowIndex]?.[primary.name];
    if(value==null||table.rows.filter(row=>row[primary.name]===value).length!==1)
      return alert("This older row has a missing or duplicate primary key. Visual deletion is blocked to prevent removing other records. Repair the key in SQL or export a backup first.");
    if(!confirm("Delete this row from "+dbSelectedTable+"?"))return;
    try{
      const result=executeAdminervaSql(activeProject.database,"DELETE FROM "+dbSelectedTable+" WHERE "+primary.name+" = "+sqlLiteral(value)+";");
      activeProject.database=result.db;store(activeProject,true);renderDatabase();renderEvidence();
    }catch(error){alert("Delete failed: "+error.message);}
  }
  function runSql(){
    if(!activeProject||!activeProject.config?.database)return;
    try{
      const sql=el("dbSqlInput").value,result=executeAdminervaSql(activeProject.database,sql);
      const candidate={...activeProject,database:result.db};
      validateProject(candidate);
      activeProject.database=result.db;store(activeProject,true);
      const from=sql.match(/\b(?:FROM|INTO|UPDATE|TABLE)\s+([A-Za-z_]\w*)/i);if(from&&activeProject.database.tables?.[from[1]])dbSelectedTable=from[1];
      renderGridTable(el("dbResult"),result.columns,result.rows);renderDatabase();renderEvidence();
      const note=el("dbStatus");if(note)note.textContent=result.type+" completed · "+result.affected+" row(s)";
    }catch(error){
      const note=el("dbStatus");if(note)note.textContent="SQL error: "+error.message;
      el("dbResult").innerHTML='<p class="studio-error">'+escapeHtml(error.message)+'</p>';
    }
  }

  function evidenceProof(row,loc,state){
    if(row.kind==="source"){
      const snippet=evidenceSnippet(state,loc);
      const excerpt=snippet.map(item=>
        '<span class="evidence-code-line'+(item.focus?' is-target':'')+'"><span class="evidence-line-number">'+
        item.line+'</span><span class="evidence-line-text">'+escapeHtml(item.code||" ")+'</span></span>'
      ).join("");
      return '<li class="evidence-proof"><div class="evidence-proof-head"><strong>'+
        escapeHtml(loc.file)+':'+loc.line+'</strong><button type="button" data-evidence-file="'+
        escapeHtml(loc.file)+'" data-evidence-line="'+loc.line+'" data-evidence-column="'+loc.column+'" data-evidence-length="'+loc.length+'">Open in editor</button></div>'+
        '<pre class="evidence-code" aria-label="Source excerpt near '+escapeHtml(loc.file)+':'+loc.line+'"><code>'+
        excerpt+'</code></pre></li>';
    }
    if(row.kind==="activity"){
      return '<li class="evidence-proof"><strong>'+escapeHtml(loc.label||"Recorded operation")+'</strong>'+
        (loc.at?'<small class="evidence-proof-time">Recorded '+escapeHtml(loc.at)+'</small>':'')+
        (loc.sql?'<pre class="evidence-code evidence-activity-code"><code>'+escapeHtml(loc.sql)+'</code></pre>':'')+
        (activeProject.config?.database===true?'<button type="button" data-evidence-view="database">Open database lab</button>':'')+
        '</li>';
    }
    if(row.kind==="artifact"){
      return '<li class="evidence-proof"><div class="evidence-proof-head"><strong>'+
        escapeHtml(loc.label||"Design artifact")+'</strong>'+
        (activeProject.config?.design!==false?'<button type="button" data-evidence-view="design" data-evidence-artifact="'+
          escapeHtml(loc.label||"")+'">Open design workspace</button>':'')+
        '</div>'+(loc.preview?'<pre class="evidence-code evidence-activity-code"><code>'+
          escapeHtml(loc.preview)+'</code></pre>':'')+'</li>';
    }
    return "";
  }
  function renderEvidence(){
    if(!activeProject)return;
    activeProject.state=captureState();
    const result=analyzeProjectEvidence(activeProject),target=el("evidenceChecklist");
    if(!target)return;
    const previous=new Set([...target.querySelectorAll("details.evidence-details[open]")].map(node=>node.dataset.evidenceId));
    const filter=el("evidenceFilter")?.value||"all";
    const visible=result.checks.filter(row=>filter==="all"||(filter==="detected"&&row.detected)||(filter==="missing"&&!row.detected));
    const groups=[...new Set(visible.map(row=>row.group))];
    target.innerHTML=groups.map(group=>{
      const rows=visible.filter(row=>row.group===group);
      return '<section class="evidence-group" aria-label="'+escapeHtml(group)+'">'+
        '<h3>'+escapeHtml(group)+'</h3><div class="evidence-grid">'+rows.map(row=>{
          const status=row.detected?"Pattern detected":"Not detected";
          const details=row.locations.map(loc=>evidenceProof(row,loc,activeProject.state)).join("");
          const count=row.matchCount||0;
          const detailsLabel=row.kind==="source"?"View source evidence":row.kind==="activity"?"View SQL activity":"View saved design";
          const detailTitle=row.locations.length?detailsLabel+" ("+count+")":"How to demonstrate this";
          const detailsText=count>row.locations.length?'<p class="evidence-proof-limit">Showing the first '+
            row.locations.length+' of '+count+' matches. These are examples, not a complete code review.</p>':"";
          return '<article class="evidence-check" data-met="'+row.detected+'"><span class="evidence-check-mark" aria-hidden="true">'+
            (row.detected?"✓":"○")+'</span><div class="evidence-check-content"><strong>'+escapeHtml(row.label)+
            '</strong><span class="evidence-check-status">'+escapeHtml(status)+'</span>'+
            '<details class="evidence-details" data-evidence-id="'+escapeHtml(row.id)+'"'+(previous.has(row.id)?' open':'')+'>'+
            '<summary>'+escapeHtml(detailTitle)+'</summary><div class="evidence-detail-body">'+
            '<p class="evidence-detail-heading">What Adminerva checked</p><p>'+escapeHtml(row.explanation)+'</p>'+
            '<p class="evidence-detail-heading">Suggested next check</p><p>'+escapeHtml(row.feedback)+'</p>'+
            (details?'<ol class="evidence-proof-list">'+details+'</ol>':
              '<p class="evidence-no-match">No matching proof was found in the current project. This does not prove the concept is absent or incorrectly implemented.</p>')+
            detailsText+'</div></details></div></article>';
        }).join("")+'</div></section>';
    }).join("")||'<p class="studio-empty">No indicators match this filter. Select All to see the full checklist.</p>';
    const found=result.checks.filter(row=>row.detected).length,summary=el("evidenceSummary");
    if(summary)summary.textContent=found+" of "+result.checks.length+" preliminary indicators detected · "+
      result.javaFiles+" Java source file(s) scanned. This is not a score.";
    const show=el("evidenceExpandAll");if(show)show.textContent="Expand all details";
    const note=el("evidenceProjectNote");
    if(note)note.textContent="Evidence is generated from the current working project. Source examples show file and line references; "+
      "the code can change after editing, so refresh to recheck. A detected pattern is not a verified competency or grade. "+
      "Compile, run, demonstrate correct behavior and ask your teacher to confirm your implementation. "+
      "Not an official TESDA competency assessment.";
  }
  function canonicalSourceJson(value){
    const normalize=node=>{
      if(node===null||typeof node==="string"||typeof node==="boolean")return node;
      if(typeof node==="number")return Number.isFinite(node)?(Object.is(node,-0)?0:node):null;
      if(Array.isArray(node))return node.map(normalize);
      if(node&&typeof node==="object"){
        const result={};
        for(const key of Object.keys(node).sort())result[key]=normalize(node[key]);
        return result;
      }
      return null;
    };
    return JSON.stringify(normalize(value));
  }
  async function sourceDigestForRun(state){
    const files=state?.files&&typeof state.files==="object"?state.files:{};
    const entries=Object.keys(files).sort().map(path=>({path,content:String(files[path]??"")}));
    const payload=canonicalSourceJson({
      language:String(state?.lang||activeProject?.lang||""),
      files:entries
    });
    if(!globalThis.crypto?.subtle)return "";
    const digest=await globalThis.crypto.subtle.digest("SHA-256",new TextEncoder().encode(payload));
    return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
  }
  function evidenceText(value,max){
    return String(value??"").slice(0,max);
  }
  function recordRun(run){
    if(!activeProject)return;
    const projectId=activeProject.id,state=clone(captureState());
    void (async()=>{
      const sourceDigest=await sourceDigestForRun(state);
      if(!activeProject||activeProject.id!==projectId)return;
      const entry={
        at:new Date().toISOString(),
        mode:run?.mode||activeProject.config?.runMode||"console",
        engine:evidenceText(run?.engine||"adminerva",80),
        entry:evidenceText(run?.entry||state?.activeFilename||"",220),
        status:evidenceText(run?.status||"finished",120),
        statusId:Number.isFinite(Number(run?.statusId))?Number(run.statusId):null,
        compileSucceeded:typeof run?.compileSucceeded==="boolean"?run.compileSucceeded:null,
        runSucceeded:typeof run?.runSucceeded==="boolean"?run.runSucceeded:null,
        exitCode:Number.isFinite(Number(run?.exitCode))?Number(run.exitCode):null,
        time:run?.time??null,
        memory:run?.memory??null,
        stdout:evidenceText(run?.stdout,16000),
        stderr:evidenceText(run?.stderr,12000),
        compileOutput:evidenceText(run?.compileOutput,12000),
        stdin:evidenceText(run?.stdin,6000),
        message:evidenceText(run?.message,2000),
        sourceDigest,
        sourceFileCount:Object.keys(state?.files||{}).length
      };
      activeProject.evidence=activeProject.evidence||{events:[],runs:[]};
      activeProject.evidence.runs=[entry,...(activeProject.evidence.runs||[])].slice(0,policy.maxRuns);
      store(activeProject,true);renderMonitor();
    })().catch(error=>console.warn("Execution evidence was not saved:",error));
  }
  function renderMonitor(){
    if(!activeProject)return;
    activeProject.state=captureState();
    const stats=sourceStats(activeProject.state),runs=activeProject.evidence?.runs||[];
    const summary=el("monitorSummary");
    if(summary)summary.innerHTML=[
      ["Files",stats.files],["Lines",stats.lines],["Classes",stats.classes],["Interfaces",stats.interfaces],["Runs recorded",runs.length]
    ].map(([label,value])=>'<div class="monitor-stat"><span>'+escapeHtml(label)+'</span><strong>'+escapeHtml(value)+'</strong></div>').join("");
    const list=el("monitorRuns");
    if(list)list.innerHTML=runs.slice(0,12).map(run=>'<tr><td>'+escapeHtml(prettyDate(run.at))+'</td><td>'+escapeHtml(run.mode)+'</td><td>'+escapeHtml(run.status)+'</td><td>'+(run.time==null?"—":escapeHtml(run.time+" s"))+'</td><td>'+(run.memory==null?"—":escapeHtml(run.memory+" KB"))+'</td></tr>').join("")||'<tr><td colspan="5">No recorded runs yet.</td></tr>';
  }

  initialize();
  return controller;
}
