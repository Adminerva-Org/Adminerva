/** Project-first Code Studio orchestration, Adminerva DB lab, design and evidence surfaces. */
import {db} from "../core/firebase-core.js?v=1.3.0";
import {
  collection,deleteDoc,doc,getDocs,setDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  CODE_PROJECT_TEMPLATES,createCodeProject,deleteCodeProject,findCodeProject,
  projectTemplateLabel,readCodeProjects,saveCodeProject,writeCodeProjects
} from "./code-projects.mjs?v=2.0.0";
import {databaseSummary,executeAdminervaSql} from "./adminerva-db.mjs?v=2.0.0";

const el=id=>document.getElementById(id);\nconst clone=value=>JSON.parse(JSON.stringify(value));
const enc=value=>new TextEncoder().encode(JSON.stringify(value)).length;
const escapeHtml=value=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch]));
const prettyDate=value=>{
  try{
    const date=new Date(value),delta=Date.now()-date.getTime();
    if(Number.isFinite(delta)&&delta>=0&&delta<60000)return "Just now";
    if(delta<3600000)return Math.max(1,Math.floor(delta/60000))+" min ago";
    if(delta<86400000)return Math.max(1,Math.floor(delta/3600000))+" hr ago";
    return date.toLocaleDateString(undefined,{month:"short",day:"numeric",year:date.getFullYear()===new Date().getFullYear()?undefined:"numeric"});
  }catch{return "Recently";}
};

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
function defaultDiagramName(key){
  return ({useCase:"Use Case",classDiagram:"Class Diagram",sequence:"Sequence Diagram",architecture:"Architecture"})[key]||key;
}

export function createProjectStudio({
  uid,openProject,captureState,onConfigChange,legacyDraftAvailable=false,importLegacyDraft=null,
  cloudEnabled=true,guest=false,limits={}
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
  let activeProject=null,selectedTemplate="java-information",cloudTimer=null,initialized=false;

  function projectSize(project){return enc(project);}
  function validateProject(project,{creating=false}={}){
    if(!project)throw Error("Project is unavailable.");
    const files=Object.keys(project.state?.files||{});
    if(files.length>policy.maxFiles)throw Error("This project exceeds the "+policy.maxFiles+" file limit.");
    if(projectSize(project)>policy.maxProjectBytes)throw Error("This project exceeds the local size limit. Export a ZIP or remove files/data.");
    const tables=Object.values(project.database?.tables||{});
    if(tables.length>policy.maxDbTables)throw Error("This project exceeds the "+policy.maxDbTables+" database table limit.");
    if(tables.some(table=>(table.rows||[]).length>policy.maxDbRowsPerTable))throw Error("A database table exceeds the "+policy.maxDbRowsPerTable+" row limit.");
    if(creating&&readCodeProjects(localStorage,uid).filter(item=>item.status!=="archived").length>=policy.maxProjects)
      throw Error("Guest Code Studio keeps up to "+policy.maxProjects+" local projects. Export or delete one before creating another.");
    return true;
  }
  function quotaText(){
    const count=readCodeProjects(localStorage,uid).filter(item=>item.status!=="archived").length;
    return Number.isFinite(policy.maxProjects)?count+" / "+policy.maxProjects+" local projects":count+" projects";
  }

  const controller={
    getActiveProject:()=>activeProject,
    showHome,
    saveState,
    recordRun,
    updateConfig,
    refreshEvidence:()=>renderEvidence(),
    refreshMonitor:()=>renderMonitor(),
    openProjectById,
    activateProject,
    resetToTemplate,
    getLimits:()=>({...policy}),
    canAddFile:()=>!activeProject||Object.keys(captureState()?.files||{}).length<policy.maxFiles,
    isGuest:()=>guest
  };

  function store(project,cloud=cloudEnabled){
    validateProject(project);
    activeProject=saveCodeProject(localStorage,uid,project);
    updateProjectHeading();
    updateQuotaUI();
    if(cloudEnabled&&cloud)scheduleCloudSave(activeProject);
    return activeProject;
  }
  function saveState(state){
    if(!activeProject)return null;
    activeProject.state=state;
    activeProject.lastOpenedAt=new Date().toISOString();
    return store(activeProject,true);
  }
  function scheduleCloudSave(project){
    if(!cloudEnabled)return;
    clearTimeout(cloudTimer);
    cloudTimer=setTimeout(()=>void saveCloud(project),3500);
  }
  async function saveCloud(project){
    if(!cloudEnabled)return;
    try{
      if(!project||enc(project)>policy.maxProjectBytes)return;
      await setDoc(doc(db,"student_code_projects",uid,"projects",project.id),{...project,ownerUid:uid});
      const indicator=el("autoSaveIndicator");
      if(indicator&&!indicator.textContent.includes("Practice"))indicator.title="Local project saved; cloud project synchronized.";
    }catch(error){console.warn("Code project cloud sync unavailable:",error);}
  }
  async function mergeCloudProjects(){
    if(!cloudEnabled)return;
    try{
      const snap=await getDocs(collection(db,"student_code_projects",uid,"projects"));
      if(!snap.size)return;
      const local=readCodeProjects(localStorage,uid),map=new Map(local.map(project=>[project.id,project]));
      for(const record of snap.docs){
        const cloud=record.data(),current=map.get(cloud.id);
        if(!current||String(cloud.updatedAt||"")>String(current.updatedAt||""))map.set(cloud.id,cloud);
      }
      writeCodeProjects(localStorage,uid,[...map.values()]);
      if(!activeProject)renderProjectHome();
    }catch(error){console.warn("Cloud code projects unavailable; using device projects.",error);}
  }

  function initialize(){
    if(initialized)return;
    initialized=true;
    el("newCodeProjectBtn")?.addEventListener("click",()=>openWizard());
    el("importCodeProjectBtn")?.addEventListener("click",()=>el("projectZipInput")?.click());
    el("backToProjectsBtn")?.addEventListener("click",()=>{
      if(activeProject)saveState(captureState());
      activeProject=null;showHome();
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
    el("designTypeSelect")?.addEventListener("change",loadDesignEditor);
    el("saveDesignBtn")?.addEventListener("click",saveDesign);
    el("renderDesignBtn")?.addEventListener("click",()=>void renderDesignPreview());
    let designTimer=null;
    el("designEditor")?.addEventListener("input",()=>{
      clearTimeout(designTimer);
      designTimer=setTimeout(()=>{
        if(!activeProject)return;
        const type=el("designTypeSelect")?.value||"useCase";
        activeProject.design={...(activeProject.design||{}),[type]:el("designEditor")?.value||""};
        try{store(activeProject,true);const status=el("designSaveStatus");if(status)status.textContent="Autosaved";}catch(error){const status=el("designSaveStatus");if(status)status.textContent=error.message;}
      },700);
    });
    el("dbRunBtn")?.addEventListener("click",runSql);
    el("dbExampleSelect")?.addEventListener("change",event=>{
      const sql=event.target.value;if(sql)el("dbSqlInput").value=sql;
    });
    el("enableProjectDbBtn")?.addEventListener("click",()=>updateConfig({database:true}));
    document.querySelectorAll("[data-studio-view]").forEach(button=>button.addEventListener("click",()=>switchStudioView(button.dataset.studioView)));
    window.addEventListener("beforeunload",()=>{if(activeProject)try{saveState(captureState());}catch{}});
    document.addEventListener("keydown",event=>{
      if(event.key!=="Escape")return;
      if(!el("projectSettingsModal")?.classList.contains("hidden"))el("projectSettingsModal")?.classList.add("hidden");
      else if(!el("projectWizardModal")?.classList.contains("hidden"))closeWizard();
    });
  }

  function updateQuotaUI(){
    const quota=el("projectQuotaStatus");if(quota)quota.textContent=quotaText();
    const storage=el("projectStorageMode");if(storage)storage.textContent=guest?"Local-only guest storage":"Private account storage · cloud sync";
    const badge=el("activeProjectStorageBadge");if(badge)badge.textContent=guest?"Local only":"Cloud sync";
    const create=el("newCodeProjectBtn"),count=readCodeProjects(localStorage,uid).filter(item=>item.status!=="archived").length;
    if(create&&Number.isFinite(policy.maxProjects)){create.disabled=count>=policy.maxProjects;create.title=create.disabled?"Guest project limit reached. Export or delete a project to create another.":"";}
  }
  function renderProjectHome(){
    const list=el("codeProjectList");if(!list)return;
    const projects=readCodeProjects(localStorage,uid).filter(project=>project.status!=="archived");
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
        card.querySelector("[data-copy]").addEventListener("click",()=>{
          try{
            validateProject(project,{creating:true});
            const copy=createCodeProject(localStorage,uid,{title:project.title+" Copy",templateId:project.template,config:project.config});
            copy.state=clone(project.state);copy.database=clone(project.database);copy.design=clone(project.design);copy.evidence={events:[],runs:[]};
            saveCodeProject(localStorage,uid,copy);renderProjectHome();
          }catch(error){alert(error.message);}
        });
        card.querySelector("[data-open]").addEventListener("click",()=>openProjectById(project.id));
        card.querySelector("[data-delete]").addEventListener("click",async()=>{
          const warning=guest?'Delete "'+project.title+'"? Guest projects exist only on this browser. Export a ZIP first if you need a copy.':'Delete "'+project.title+'"? This removes the project from this device and its project cloud record. Export a ZIP first if you need a copy.';
          if(!confirm(warning))return;
          deleteCodeProject(localStorage,uid,project.id);
          if(cloudEnabled)try{await deleteDoc(doc(db,"student_code_projects",uid,"projects",project.id));}catch(error){console.warn("Cloud project deletion unavailable:",error);}
          renderProjectHome();
        });
        list.append(card);
      }
    }
    const legacy=el("legacyDraftProjectBtn");
    if(legacy)legacy.classList.toggle("hidden",!legacyDraftAvailable);
  }

  function showHome(){
    initialize();renderProjectHome();
    el("projectHome")?.classList.remove("hidden");
    el("studioShell")?.classList.add("hidden");
    document.title=(guest?"Guest Code Studio":"Code Studio")+" · Adminerva";
    const guestNotice=el("guestProjectNotice");if(guestNotice)guestNotice.classList.toggle("hidden",!guest);
    if(cloudEnabled)void mergeCloudProjects();
  }

  async function openProjectById(id){
    const project=findCodeProject(localStorage,uid,id);
    if(!project)return alert("This project is no longer available on this device.");
    activateProject(project);
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

  function activateProject(project){
    initialize();
    activeProject={...project,lastOpenedAt:new Date().toISOString()};
    activeProject=saveCodeProject(localStorage,uid,activeProject);
    el("projectHome")?.classList.add("hidden");
    el("studioShell")?.classList.remove("hidden");
    updateProjectHeading();
    openProject(activeProject);
    switchStudioView("code");
    for(const id of ["cloudSaveProjectBtn","cloudLoadProjectBtn","loadProjectBtn","undoRestoreBtn","snapshotBtn"]){
      const control=el(id);if(control)control.classList.add("hidden");
    }
    updateQuotaUI();
    if(cloudEnabled)scheduleCloudSave(activeProject);
  }

  function updateProjectHeading(){
    if(!activeProject)return;
    const title=el("activeProjectTitle"),meta=el("activeProjectMeta");
    if(title)title.textContent=activeProject.title;
    if(meta){
      const kb=Math.max(1,Math.ceil(projectSize(activeProject)/1024));
      meta.textContent=projectTypeMeta(activeProject).detail+" · "+Object.keys(activeProject.state?.files||{}).length+" files · "+kb+" KB"+(guest?" · local guest project":"");
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
    const project=createCodeProject(localStorage,uid,{title,templateId:template.id,config});
    try{validateProject(project);}catch(error){deleteCodeProject(localStorage,uid,project.id);return alert(error.message);}
    closeWizard();activateProject(project);
  }

  function openSettings(){
    if(!activeProject)return;
    el("projectSettingsTitle").value=activeProject.title;
    el("projectSettingsRunMode").value=activeProject.config?.runMode||"console";
    el("projectSettingsDatabase").checked=Boolean(activeProject.config?.database);
    el("projectSettingsJavaOptions")?.classList.toggle("hidden",activeProject.lang!=="java");
    el("projectSettingsModal")?.classList.remove("hidden");
  }
  function saveSettings(){
    if(!activeProject)return;
    const title=el("projectSettingsTitle").value.trim();
    if(!title)return alert("Project name cannot be empty.");
    activeProject.title=title.slice(0,120);
    if(activeProject.lang==="java"){
      activeProject.config.runMode=el("projectSettingsRunMode").value==="desktop"?"desktop":"console";
      activeProject.config.database=Boolean(el("projectSettingsDatabase").checked);
    }
    store(activeProject,true);onConfigChange?.(activeProject.config);
    el("projectSettingsModal")?.classList.add("hidden");
    renderDatabase();renderEvidence();
  }
  function updateConfig(patch){
    if(!activeProject)return;
    activeProject.config={...(activeProject.config||{}),...patch};
    store(activeProject,true);onConfigChange?.(activeProject.config);
    renderDatabase();
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
    const chosen=valid.includes(view)?view:"code";
    for(const name of valid){
      el("studioPanel"+name[0].toUpperCase()+name.slice(1))?.classList.toggle("hidden",name!==chosen);
    }
    document.querySelectorAll("[data-studio-view]").forEach(button=>button.dataset.active=String(button.dataset.studioView===chosen));
    if(chosen==="design"){loadDesignEditor();void renderDesignPreview();}
    if(chosen==="database")renderDatabase();
    if(chosen==="evidence")renderEvidence();
    if(chosen==="monitor")renderMonitor();
  }

  function loadDesignEditor(){
    if(!activeProject)return;
    const type=el("designTypeSelect")?.value||"useCase";
    const editor=el("designEditor");if(editor)editor.value=activeProject.design?.[type]||"";
  }
  function saveDesign(){
    if(!activeProject)return;
    const type=el("designTypeSelect").value||"useCase";
    activeProject.design={...(activeProject.design||{}),[type]:el("designEditor").value};
    store(activeProject,true);const status=el("designSaveStatus");if(status)status.textContent="Saved";
    void renderDesignPreview();renderEvidence();
  }
  async function renderDesignPreview(){
    const target=el("designPreview");if(!target||!activeProject)return;
    const source=el("designEditor")?.value.trim();
    if(!source){target.innerHTML='<p class="studio-empty">Add Mermaid diagram syntax to preview this design.</p>';return;}
    if(!globalThis.mermaid){target.textContent=source;return;}
    try{
      globalThis.mermaid.initialize({startOnLoad:false,securityLevel:"strict",theme:"neutral"});
      const id="adminervaDiagram"+Date.now();
      const result=await globalThis.mermaid.render(id,source);
      target.innerHTML=result.svg;
    }catch(error){target.innerHTML='<p class="studio-error">Diagram error: '+escapeHtml(error.message)+'</p>';}
  }

  function renderDatabase(){
    if(!activeProject)return;
    const enabled=Boolean(activeProject.config?.database);
    el("dbDisabledState")?.classList.toggle("hidden",enabled);
    el("dbWorkspace")?.classList.toggle("hidden",!enabled);
    if(!enabled)return;
    const summaries=databaseSummary(activeProject.database),schema=el("dbSchemaList");
    if(schema){
      schema.innerHTML=summaries.length?summaries.map(table=>'<button type="button" data-table="'+escapeHtml(table.name)+'"><strong>'+escapeHtml(table.name)+'</strong><span>'+table.rows+' rows · '+table.columns.length+' columns</span></button>').join(""):'<p class="studio-empty">No tables yet. Use CREATE TABLE in the SQL console.</p>';
      schema.querySelectorAll("[data-table]").forEach(button=>button.addEventListener("click",()=>{
        el("dbSqlInput").value="SELECT * FROM "+button.dataset.table+";";
      }));
    }
    const history=el("dbHistory");
    if(history)history.innerHTML=(activeProject.database?.history||[]).slice(0,8).map(item=>'<li><span>'+escapeHtml(item.type)+'</span><code>'+escapeHtml(item.sql)+'</code><small>'+escapeHtml(prettyDate(item.at))+'</small></li>').join("")||'<li class="studio-empty">No SQL activity yet.</li>';
  }
  function runSql(){
    if(!activeProject||!activeProject.config?.database)return;
    try{
      const result=executeAdminervaSql(activeProject.database,el("dbSqlInput").value);
      const candidate={...activeProject,database:result.db};
      validateProject(candidate);
      activeProject.database=result.db;store(activeProject,true);
      renderGridTable(el("dbResult"),result.columns,result.rows);renderDatabase();renderEvidence();
      const note=el("dbStatus");if(note)note.textContent=result.type+" completed · "+result.affected+" row(s)";
    }catch(error){
      const note=el("dbStatus");if(note)note.textContent="SQL error: "+error.message;
      el("dbResult").innerHTML='<p class="studio-error">'+escapeHtml(error.message)+'</p>';
    }
  }

  function competencyRows(){
    if(!activeProject)return [];
    const stats=sourceStats(activeProject.state),history=activeProject.database?.history||[],types=new Set(history.map(item=>item.type));
    const designCount=Object.values(activeProject.design||{}).filter(value=>String(value||"").trim()).length;
    const checks=[
      ["Object-oriented structure",stats.classes>=2||stats.hasEncapsulation,"Classes / encapsulation"],
      ["Inheritance / interfaces",stats.hasInheritance||stats.interfaces>0,"extends / implements / interface"],
      ["Collections & generics",stats.hasCollections||stats.hasGenerics,"Collections / generics"],
      ["Exception handling",stats.hasExceptions,"try/catch or throws"],
      ["JDBC source usage",stats.hasJdbc,"java.sql / DriverManager / PreparedStatement"],
      ["SQL CRUD lab",["INSERT","SELECT","UPDATE","DELETE"].every(type=>types.has(type)),"Adminerva DB CRUD activity"],
      ["File I/O",stats.hasFileIo,"java.io / NIO.2"],
      ["Multithreading",stats.hasThreads,"Thread / Runnable / executors"],
      ["OO analysis & design",designCount>=3,designCount+" design artifact(s)"]
    ];
    return checks;
  }
  function renderEvidence(){
    if(!activeProject)return;
    activeProject.state=captureState();
    const target=el("evidenceChecklist");if(!target)return;
    target.innerHTML=competencyRows().map(([name,met,evidence])=>'<article class="evidence-check" data-met="'+met+'"><span class="evidence-check-mark">'+(met?"✓":"○")+'</span><div><strong>'+escapeHtml(name)+'</strong><p>'+escapeHtml(evidence)+'</p></div></article>').join("");
    const note=el("evidenceProjectNote");
    if(note)note.textContent="This is learning evidence gathered from the project. It does not by itself constitute an official TESDA competency assessment.";
  }
  function recordRun(run){
    if(!activeProject)return;
    const entry={at:new Date().toISOString(),mode:run?.mode||activeProject.config?.runMode||"console",status:run?.status||"finished",time:run?.time??null,memory:run?.memory??null};
    activeProject.evidence=activeProject.evidence||{events:[],runs:[]};
    activeProject.evidence.runs=[entry,...(activeProject.evidence.runs||[])].slice(0,policy.maxRuns);
    store(activeProject,true);renderMonitor();
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
