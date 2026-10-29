/** Isolated code editing, execution, persistence and practice handoffs. */
import { db, auth } from "../core/firebase-core.js?v=1.3.0";
import {playgroundWorkspaceKey,playgroundLanguageKey,playgroundUndoKey,validPlaygroundState,readPlaygroundDraft,PLAYGROUND_LANGUAGES} from "./playground-storage.mjs?v=1.3.10";
import {readPracticeTransfer,practiceBridgeKey,recordPracticeRun,practiceReturnUrl} from "./practice-playground-bridge.mjs?v=1.3.0";
import {projectPath,parentFolders,bundleWebProject} from "./playground-project.mjs?v=1.3.0";
import {createProjectStudio} from "./project-studio.mjs?v=2.1.3";
import {chooseCompilerEntry} from "./playground-entry.mjs?v=2.1.3";
import {createCodeProject,saveCodeProject} from "./code-projects.mjs?v=2.0.0";
import {
  collection,
  addDoc,
  getDoc,
  doc,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// ==========================================
// 1. CONFIGURATION & STATE
// ==========================================
const languageConfig = {
  java: {
    monaco: "java",
    judge0Id: 62,
    defaultFile: "Main.java",
    defaultCode:
      'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, Adminerva!");\n    }\n}',
  },
  python: {
    monaco: "python",
    judge0Id: 71,
    defaultFile: "main.py",
    defaultCode: 'print("Hello, Adminerva!")',
  },
  web: {
    monaco: "html",
    judge0Id: null,
    defaultFile: "index.html",
    defaultCode:
      '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <style>\n    body { background-color: #0f172a; color: #22d3ee; font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }\n  </style>\n</head>\n<body>\n  <h1>Hello, Adminerva Web!</h1>\n</body>\n</html>',
  },
  csharp: {
    monaco: "csharp",
    judge0Id: 51,
    defaultFile: "Program.cs",
    defaultCode:
      'using System;\n\nclass Program {\n    static void Main() {\n        Console.WriteLine("Hello, Adminerva!");\n    }\n}',
  },
  cpp: {
    monaco: "cpp",
    judge0Id: 54,
    defaultFile: "main.cpp",
    defaultCode:
      '#include <iostream>\n\nint main() {\n    std::cout << "Hello, Adminerva!" << std::endl;\n    return 0;\n}',
  },
  dart: {
    monaco: "dart",
    judge0Id: 64,
    defaultFile: "main.dart",
    defaultCode: "void main() {\n  print('Hello, Adminerva!');\n}",
  },
};

let editorInstance = null;
let currentLang = "java";
let workspaceFiles = {};
let fileOrder = [];
let activeFilename = "";
let draggedTabIndex = -1;
let practiceMode = false;
let practiceTransfer = null;
const guestMode=document.body.dataset.playgroundAccess==="guest";
let workspaceFolders=[],projectOrder=[],selectedProjectPath="",selectedProjectFolder=false,explorerDrag=null;
let executionController=null,executionSequence=0;
let loadedOwnerUid=null;
let projectStudio=null;
const JAVA_RUN_MODE_KEY="Adminerva_Java_Run_Mode_v1";
let javaRunMode=(()=>{try{return localStorage.getItem(JAVA_RUN_MODE_KEY)==="desktop"?"desktop":"console";}catch{return "console";}})();
let desktopRunSequence=0;

// ==========================================
// 2. INITIALIZATION
// ==========================================
async function initializePlayground() {
  const end = window.beginLoading?.("Preparing code editor…", document.getElementById("editorContainer")) || (() => {});
  try {
  // Auth guard controls visibility. Do not expose a workspace while access is pending.

  require.config({
    paths: {
      vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs",
    },
  });
  require(["vs/editor/editor.main"], async function () {
    try {
    monaco.editor.defineTheme("adminervaDark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "64748b", fontStyle: "italic" },
        { token: "keyword", foreground: "22d3ee", fontStyle: "bold" },
        { token: "string", foreground: "a5f3fc" },
        { token: "number", foreground: "38bdf8" },
      ],
      colors: {
        "editor.background": "#0f172a",
        "editor.foreground": "#f8fafc",
        "editorCursor.foreground": "#22d3ee",
        "editor.lineHighlightBackground": "#1e293b",
        "editorLineNumber.foreground": "#475569",
        "editorIndentGuide.background": "#1e293b",
      },
    });

    editorInstance = monaco.editor.create(
      document.getElementById("editorContainer"),
      {
        theme: "adminervaDark",
        automaticLayout: true,
        fontSize: 14,
        fontFamily: "Fira Code, monospace",
        minimap: { enabled: false },
        padding: { top: 16 },
      },
    );

    document.getElementById("editorLoading")?.classList.add("hidden");

    bindUIEvents();
    initResizer();
    setupWebConsoleHook();
    setupJavaDesktopHook();

    const urlParams = new URLSearchParams(window.location.search);
    const snapshotId = urlParams.get("id");

    try {
      await auth.authStateReady();
    } catch (error) {
      console.warn("Unable to confirm sign-in:", error);
    }
    if (!auth.currentUser && !guestMode) {
      alert("Sign in to open your private Playground workspace.");
      return;
    }
    loadedOwnerUid=auth.currentUser?.uid||(guestMode?"public-visitor-v1":null);
    auth.onAuthStateChanged(user=>{
      const nextOwner=user?.uid||(guestMode?"public-visitor-v1":null);
      if(nextOwner===loadedOwnerUid)return;
      // Save only to the account that loaded this editor, then reopen cleanly.
      persistWorkspace();
      executionSequence++;
      executionController?.abort();
      clearTimeout(autoSaveTimeout);
      document.getElementById("workspaceContainer")?.setAttribute("inert","");
      window.location.reload();
    });
    document.getElementById("legacyImportBtn")?.classList.toggle("hidden",
      !localStorage.getItem("Adminerva_Playground_Workspace"));
    const requestedPractice=urlParams.get("practice")==="1";
    if(requestedPractice){
      document.getElementById("studioShell")?.classList.remove("hidden");
      document.querySelector(".studio-project-bar")?.classList.add("hidden");
      document.querySelector(".studio-tabs")?.classList.add("hidden");
      const transfer=readPracticeTransfer(sessionStorage,ownerUid());
      if(transfer){
        practiceMode=true;
        practiceTransfer=transfer;
        const savedScratch=transfer.scratch;
        const scratch=validPlaygroundState(savedScratch)&&savedScratch.lang===transfer.workspace.lang
          ?savedScratch:transfer.workspace;
        createWorkspace(scratch.lang,scratch.files,scratch.fileOrder,scratch.activeFilename,scratch.folders,scratch.projectOrder);
        enablePracticeSandbox();
        showSaveStatus("Practice sandbox — separate from personal projects");
      }else{
        alert("This practice session expired or belongs to another account. Your personal workspace is unchanged.");
        loadLocalWorkspace();
      }
    }else if (snapshotId) {
      document.getElementById("studioShell")?.classList.remove("hidden");
      document.querySelector(".studio-project-bar")?.classList.add("hidden");
      document.querySelector(".studio-tabs")?.classList.add("hidden");
      await loadSnapshot(snapshotId);
    } else {
      const uid=ownerUid();
      const legacyAvailable=PLAYGROUND_LANGUAGES.some(lang=>Boolean(readPlaygroundDraft(localStorage,uid,lang)));
      projectStudio=createProjectStudio({
        uid,
        openProject:openNamedProject,
        captureState:currentState,
        onConfigChange:applyNamedProjectConfig,
        legacyDraftAvailable:legacyAvailable,
        importLegacyDraft:importLegacyDraftAsProject,
        cloudEnabled:!guestMode,
        guest:guestMode
      });
      const requestedProject=urlParams.get("codeProject");
      if(requestedProject)projectStudio.openProjectById(requestedProject);
      else projectStudio.showHome();
    }
    } finally { end(); }
  }, () => { end(); document.getElementById("editorLoading").textContent = "Editor could not load. Check your connection and reload; saved drafts are unchanged."; });
  } catch (error) { end(); document.getElementById("editorLoading").textContent = "Editor unavailable. Saved drafts are unchanged. Reload to retry."; }
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",initializePlayground,{once:true});
else void initializePlayground();

// ==========================================
// 3. WORKSPACE & FILE MANAGEMENT
// ==========================================
function applyNamedProjectConfig(config={}){
  if(currentLang==="java"){
    javaRunMode=config.runMode==="desktop"?"desktop":"console";
    try{localStorage.setItem(JAVA_RUN_MODE_KEY,javaRunMode);}catch{}
  }
  updateOutputView();
}

function openNamedProject(project){
  if(!project)return;
  createWorkspace(project.lang,project.state?.files,project.state?.fileOrder,project.state?.activeFilename,project.state?.folders,project.state?.projectOrder);
  applyNamedProjectConfig(project.config||{});
  const langSelect=document.getElementById("languageSelect");
  if(langSelect){langSelect.value=project.lang;langSelect.disabled=true;langSelect.title="Language is set by this project. Create another project to use a different language.";}
  workspaceDirty=false;localSaveFailed=false;
  showSaveStatus("Project loaded · autosave on");
}

function importLegacyDraftAsProject(){
  const uid=ownerUid();if(!uid)return;
  let chosen=null;
  try{chosen=localStorage.getItem(playgroundLanguageKey(uid))||"java";}catch{chosen="java";}
  let state=readPlaygroundDraft(localStorage,uid,chosen);
  if(!state){
    for(const lang of PLAYGROUND_LANGUAGES){state=readPlaygroundDraft(localStorage,uid,lang);if(state){chosen=lang;break;}}
  }
  if(!state)return alert("No older local playground draft was found.");
  if(projectStudio&&!projectStudio.canCreateProject())return alert("Guest project limit reached. Export or delete a project before importing this older draft.");
  const limits=projectStudio?.getLimits?.()||{maxFiles:100,maxProjectBytes:780000};
  if((state.fileOrder||[]).length>limits.maxFiles)return alert("This older draft has more files than this project tier allows.");
  if(new TextEncoder().encode(JSON.stringify(state)).length>limits.maxProjectBytes)return alert("This older draft is larger than this project tier allows. Export it as a ZIP from the legacy workspace first.");
  const templateByLang={java:"java-blank",python:"python-console",web:"web"};
  const project=createCodeProject(localStorage,uid,{title:"Imported "+chosen.toUpperCase()+" Project",templateId:templateByLang[chosen]||"java-blank",
    config:{runMode:chosen==="web"?"web":"console",database:false}});
  project.lang=chosen;project.state={lang:chosen,files:state.files,fileOrder:state.fileOrder,activeFilename:state.activeFilename,
    folders:state.folders||[],projectOrder:state.projectOrder||state.fileOrder};
  saveCodeProject(localStorage,uid,project);
  projectStudio?.activateProject(project);
}

function createWorkspace(lang, initialFiles, initialOrder, initialActive,initialFolders=[],initialProjectOrder=[]) {
  if(executionController){executionSequence++;executionController.abort();}
  stopJavaDesktop(true);
  currentLang = lang;
  const langSelect = document.getElementById("languageSelect");
  if (langSelect) langSelect.value = lang;

  Object.values(workspaceFiles).forEach((f) => f.model.dispose());
  workspaceFiles = {};
  fileOrder = [];
  workspaceFolders=Array.isArray(initialFolders)?initialFolders.filter(p=>{try{return projectPath(p)===p;}catch{return false;}}).slice(0,100):[];
  projectOrder=Array.isArray(initialProjectOrder)?initialProjectOrder.filter(p=>{try{return projectPath(p)===p;}catch{return false;}}).slice(0,200):[...workspaceFolders];
  selectedProjectPath="";selectedProjectFolder=false;

  const safeLang = PLAYGROUND_LANGUAGES.includes(lang) ? lang : "java";
  currentLang = safeLang;
  if (langSelect) langSelect.value = safeLang;
  const filesToCreate = initialFiles || {
    [languageConfig[safeLang].defaultFile]: languageConfig[safeLang].defaultCode,
  };

  const orderToUse = initialOrder || Object.keys(filesToCreate);

  orderToUse.forEach((filename) => {
    if (filesToCreate[filename] !== undefined) {
      addFile(filename, filesToCreate[filename], false);
    }
  });

  projectOrder=normalizedProjectOrder(projectOrder);
  if (fileOrder.length > 0) switchTab(fileOrder.includes(initialActive) ? initialActive : fileOrder[0]);
  updateOutputView();
}

function addFile(filename, content = "", autoSwitch = true) {
  try{filename=projectPath(filename);}catch(error){alert(error.message);return;}
  if(fileOrder.length>=100)return alert("A workspace supports up to 100 files. Export this project before starting another.");
  if(workspaceFolders.includes(filename))return alert("A folder already uses that path.");
  if (workspaceFiles[filename]) return alert("File already exists!");

  let syntax = languageConfig[currentLang].monaco;
  if (filename.endsWith(".css")) syntax = "css";
  if (filename.endsWith(".js")) syntax = "javascript";
  if (filename.endsWith(".html")) syntax = "html";

  const model = monaco.editor.createModel(content, syntax);
  workspaceFiles[filename] = { model };
  fileOrder.push(filename);
  if(!projectOrder.includes(filename))projectOrder.push(filename);

  model.onDidChangeContent(() => {
    triggerAutoSave();
    monaco.editor.setModelMarkers(model, "judge0", []);
  });

  if (autoSwitch) switchTab(filename);
  else renderTabs();
}

function switchTab(filename) {
  if (!workspaceFiles[filename]) return;
  activeFilename = filename;
  selectedProjectPath=filename;selectedProjectFolder=false;
  editorInstance.setModel(workspaceFiles[filename].model);
  const path=document.getElementById("activeFilePath");if(path)path.textContent=filename;
  renderTabs();
}

// ------------------------------------------
// 3B. RENAME & DELETE LOGIC
// ------------------------------------------
window.renameFile = function (oldName) {
  let newName = prompt(`New file path for ${oldName}:`, oldName);
  if (!newName || newName.trim() === "" || newName === oldName) return;
  try{newName=projectPath(newName);}catch(error){return alert(error.message);}
  if(workspaceFolders.includes(newName))return alert("A folder already uses that path.");
  if (workspaceFiles[newName])
    return alert("A file with that name already exists!");

  const content = workspaceFiles[oldName].model.getValue();
  workspaceFiles[oldName].model.dispose();
  delete workspaceFiles[oldName];

  const idx = fileOrder.indexOf(oldName);
  fileOrder.splice(idx, 1);

  let syntax = languageConfig[currentLang].monaco;
  if (newName.endsWith(".css")) syntax = "css";
  if (newName.endsWith(".js")) syntax = "javascript";
  if (newName.endsWith(".html")) syntax = "html";

  const model = monaco.editor.createModel(content, syntax);
  workspaceFiles[newName] = { model };
  fileOrder.splice(idx, 0, newName);
  projectOrder=normalizedProjectOrder(projectOrder.map(path=>path===oldName?newName:path));

  model.onDidChangeContent(() => {
    triggerAutoSave();
    monaco.editor.setModelMarkers(model, "judge0", []);
  });

  if (activeFilename === oldName) activeFilename = newName;
  switchTab(activeFilename);
  triggerAutoSave();
};

window.deleteFile = function (filename) {
  if (fileOrder.length === 1) return alert("Keep at least one file in the workspace. Use Reset for a new project.");
  if (confirm(`Are you sure you want to delete ${filename}?`)) {
    workspaceFiles[filename].model.dispose();
    delete workspaceFiles[filename];

    const idx = fileOrder.indexOf(filename);
    fileOrder.splice(idx, 1);
    projectOrder=normalizedProjectOrder(projectOrder.filter(path=>path!==filename));

    if (activeFilename === filename && fileOrder.length > 0)
      switchTab(fileOrder[0]);
    else renderTabs();

    triggerAutoSave();
  }
};

window.promptNewFile = function () {
  if(projectStudio?.getActiveProject()&&!projectStudio.canAddFile())return alert("This project reached its file limit. Delete a file or export the project before adding another.");
  const selectedParent=selectedProjectPath&&!selectedProjectFolder?projectParent(selectedProjectPath):"";
  const folder=selectedProjectFolder?selectedProjectPath:(selectedParent||activeFilename.split("/").slice(0,-1).join("/"));
  const name = prompt("New file path (for example src/Student.java or styles/main.css):",folder?folder+"/":"");
  if (name && name.trim()) {
    addFile(name.trim());
    triggerAutoSave();
  }
};

// ------------------------------------------
// 3C. TAB RENDERING & DRAG/DROP
// ------------------------------------------
function renderTabs() {
  const container = document.getElementById("fileTabsContainer");
  if (!container) return;
  container.innerHTML = "";

  fileOrder.forEach((filename, index) => {
    const isActive = filename === activeFilename;
    const tabClass = isActive
      ? "bg-[#0f172a] text-cyan-400 border-t-2 border-cyan-400"
      : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200 border-t-2 border-transparent";

    const tab=document.createElement("div");tab.className="px-4 py-2 cursor-pointer flex items-center gap-2 text-xs font-bold transition relative group tab-element "+tabClass;
    tab.draggable=true;tab.dataset.index=index;tab.dataset.filename=filename;tab.setAttribute("role","tab");tab.setAttribute("aria-selected",String(isActive));tab.tabIndex=isActive?0:-1;
    const label=document.createElement("span");label.textContent=filename.split("/").at(-1);label.title=filename;tab.append(label);
    tab.addEventListener("dblclick",()=>window.renameFile(filename));
    tab.addEventListener("keydown",event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();switchTab(filename);}});
    if(fileOrder.length>1){const close=document.createElement("button");close.textContent="×";close.setAttribute("aria-label","Delete "+filename);close.onclick=event=>{event.stopPropagation();window.deleteFile(filename);};tab.append(close);}
    container.append(tab);
  });

  container.insertAdjacentHTML(
    "beforeend",
    `
    <button onclick="window.promptNewFile()" class="text-slate-400 hover:text-white px-4 h-full flex items-center justify-center font-bold text-lg hover:bg-slate-800 transition shrink-0" title="Add new file">+</button>
  `,
  );

  attachTabEvents();
  renderFileTree();
}

function currentFolderPaths(){
  return new Set([...workspaceFolders,...parentFolders([...fileOrder,...workspaceFolders.map(path=>path+"/.keep")])]);
}
function projectParent(path){return path.split("/").slice(0,-1).join("/");}
function normalizedProjectOrder(order=projectOrder){
  const visible=new Set([...currentFolderPaths(),...fileOrder]),next=[];
  for(const path of Array.isArray(order)?order:[])if(visible.has(path)&&!next.includes(path))next.push(path);
  for(const path of [...visible].sort())if(!next.includes(path))next.push(path);
  return next;
}
function orderedFolders(){
  const folders=currentFolderPaths();
  return normalizedProjectOrder(projectOrder).filter(path=>folders.has(path));
}
function orderedExplorerChildren(parent=""){
  projectOrder=normalizedProjectOrder(projectOrder);
  return projectOrder.filter(path=>projectParent(path)===parent);
}
function explorerTargetPath(source,targetFolder=""){
  return projectPath((targetFolder?targetFolder+"/":"")+source.split("/").at(-1));
}
function canMoveProjectItem(source,isFolder,targetFolder){
  try{
    const target=explorerTargetPath(source,targetFolder),allFolders=currentFolderPaths();
    if(target===source||workspaceFiles[target]||allFolders.has(target))return false;
    if(isFolder&&(targetFolder===source||targetFolder.startsWith(source+"/")))return false;
    if(!isFolder)return Boolean(workspaceFiles[source]);
    const movingFiles=fileOrder.filter(path=>path.startsWith(source+"/"));
    const movingFolders=[...allFolders].filter(path=>path===source||path.startsWith(source+"/"));
    const outsideFiles=new Set(fileOrder.filter(path=>!path.startsWith(source+"/")));
    const outsideFolders=new Set([...allFolders].filter(path=>path!==source&&!path.startsWith(source+"/")));
    const mapping=path=>target+path.slice(source.length);
    return !movingFiles.some(path=>outsideFiles.has(mapping(path)))&&!movingFolders.some(path=>outsideFolders.has(mapping(path)));
  }catch{return false;}
}
function moveProjectItem(source,isFolder,targetFolder){
  if(!canMoveProjectItem(source,isFolder,targetFolder))return false;
  const target=explorerTargetPath(source,targetFolder);
  if(!isFolder){
    const file=workspaceFiles[source];delete workspaceFiles[source];workspaceFiles[target]=file;
    fileOrder=fileOrder.map(path=>path===source?target:path);
    projectOrder=normalizedProjectOrder(projectOrder.map(path=>path===source?target:path));
    projectOrder=[...projectOrder.filter(path=>path!==target),target];
    if(activeFilename===source)activeFilename=target;
    selectedProjectPath=target;selectedProjectFolder=false;
  }else{
    const mapping=path=>path===source?target:path.startsWith(source+"/")?target+path.slice(source.length):path;
    workspaceFiles=Object.fromEntries(Object.entries(workspaceFiles).map(([path,file])=>[mapping(path),file]));
    fileOrder=fileOrder.map(mapping);workspaceFolders=workspaceFolders.map(mapping);
    projectOrder=normalizedProjectOrder(projectOrder.map(mapping));
    projectOrder=[...projectOrder.filter(path=>path!==target),target];
    activeFilename=mapping(activeFilename);selectedProjectPath=target;selectedProjectFolder=true;
  }
  const activePath=document.getElementById("activeFilePath");if(activePath)activePath.textContent=activeFilename;
  renderTabs();triggerAutoSave();showSaveStatus("Moved to "+(targetFolder||"project root"));
  return true;
}
function reorderProjectSibling(source,target,placement){
  if(source===target||projectParent(source)!==projectParent(target)||!["before","after"].includes(placement))return false;
  projectOrder=normalizedProjectOrder(projectOrder);
  const siblings=projectOrder.filter(path=>projectParent(path)===projectParent(source));
  if(!siblings.includes(source)||!siblings.includes(target))return false;
  const next=siblings.filter(path=>path!==source),targetIndex=next.indexOf(target);
  next.splice(targetIndex+(placement==="after"?1:0),0,source);
  let index=0;
  projectOrder=projectOrder.map(path=>projectParent(path)===projectParent(source)?next[index++]:path);
  selectedProjectPath=source;selectedProjectFolder=currentFolderPaths().has(source);
  renderTabs();triggerAutoSave();showSaveStatus("Explorer order updated");
  return true;
}
function clearExplorerDropState(){
  const tree=document.getElementById("projectTree");if(!tree)return;
  tree.classList.remove("pg-dragging");
  tree.querySelectorAll("[data-drop-active]").forEach(node=>delete node.dataset.dropActive);
  tree.querySelectorAll("[data-insert]").forEach(node=>delete node.dataset.insert);
  tree.querySelectorAll(".pg-drag-source").forEach(node=>node.classList.remove("pg-drag-source"));
}
function bindExplorerDrag(node,path,isFolder){
  node.draggable=true;
  node.addEventListener("dragstart",event=>{
    explorerDrag={path,isFolder};event.dataTransfer.effectAllowed="move";event.dataTransfer.setData("text/plain",path);
    node.classList.add("pg-drag-source");document.getElementById("projectTree")?.classList.add("pg-dragging");
  });
  node.addEventListener("dragend",()=>{explorerDrag=null;clearExplorerDropState();});
}
function bindExplorerDrop(node,targetFolder){
  node.addEventListener("dragover",event=>{
    if(!explorerDrag||!canMoveProjectItem(explorerDrag.path,explorerDrag.isFolder,targetFolder))return;
    event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect="move";node.dataset.dropActive="true";
  });
  node.addEventListener("dragleave",event=>{if(!node.contains(event.relatedTarget))delete node.dataset.dropActive;});
  node.addEventListener("drop",event=>{
    if(!explorerDrag)return;
    event.preventDefault();event.stopPropagation();
    const moving=explorerDrag;explorerDrag=null;clearExplorerDropState();moveProjectItem(moving.path,moving.isFolder,targetFolder);
  });
}
function bindExplorerItemDrop(node,path,isFolder){
  node.addEventListener("dragover",event=>{
    if(!explorerDrag)return;
    delete node.dataset.dropActive;delete node.dataset.insert;
    const sameParent=projectParent(explorerDrag.path)===projectParent(path);
    const rect=node.getBoundingClientRect(),ratio=rect.height?((event.clientY-rect.top)/rect.height):.5;
    const reorderZone=sameParent&&explorerDrag.path!==path&&(!isFolder||ratio<.28||ratio>.72);
    if(reorderZone){
      event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect="move";
      node.dataset.insert=ratio<.5?"before":"after";return;
    }
    if(isFolder&&canMoveProjectItem(explorerDrag.path,explorerDrag.isFolder,path)){
      event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect="move";node.dataset.dropActive="true";
    }
  });
  node.addEventListener("dragleave",event=>{
    if(!node.contains(event.relatedTarget)){delete node.dataset.dropActive;delete node.dataset.insert;}
  });
  node.addEventListener("drop",event=>{
    if(!explorerDrag)return;
    const placement=node.dataset.insert,moving=explorerDrag;
    if(placement){
      event.preventDefault();event.stopPropagation();explorerDrag=null;clearExplorerDropState();
      reorderProjectSibling(moving.path,path,placement);return;
    }
    if(isFolder&&canMoveProjectItem(moving.path,moving.isFolder,path)){
      event.preventDefault();event.stopPropagation();explorerDrag=null;clearExplorerDropState();
      moveProjectItem(moving.path,moving.isFolder,path);
    }
  });
}
function renderFileTree(){
  const tree=document.getElementById("projectTree");if(!tree)return;
  const open=new Set([...tree.querySelectorAll("details[open]")].map(n=>n.dataset.path));
  tree.replaceChildren();
  const rootDrop=document.createElement("div");rootDrop.className="pg-drop-root";rootDrop.textContent="Move to project root";rootDrop.setAttribute("aria-hidden","true");
  bindExplorerDrop(rootDrop,"");tree.append(rootDrop);
  tree.oncontextmenu=event=>{
    if(event.target.closest("button.pg-file,summary"))return;
    event.preventDefault();selectedProjectPath="";selectedProjectFolder=true;showExplorerContextMenu(event,{root:true});
  };
  const folders=orderedFolders(),folderSet=new Set(folders);
  function children(box,parent=""){
    for(const path of orderedExplorerChildren(parent)){
      if(folderSet.has(path)){
        const details=document.createElement("details");details.dataset.path=path;details.open=open.has(path)||activeFilename.startsWith(path+"/");
        const summary=document.createElement("summary");summary.textContent="▱ "+path.split("/").at(-1);summary.title="Drop on the folder to move inside; use the edge line to reorder";
        summary.addEventListener("click",()=>{selectedProjectPath=path;selectedProjectFolder=true;});
        summary.addEventListener("contextmenu",event=>{event.preventDefault();event.stopPropagation();selectedProjectPath=path;selectedProjectFolder=true;showExplorerContextMenu(event,{path,isFolder:true});});
        summary.addEventListener("keydown",event=>{
          if(event.key==="ContextMenu"||(event.shiftKey&&event.key==="F10")){
            event.preventDefault();const rect=summary.getBoundingClientRect();selectedProjectPath=path;selectedProjectFolder=true;
            showExplorerContextMenu({clientX:rect.left+18,clientY:rect.top+18},{path,isFolder:true});
          }
        });
        bindExplorerDrag(summary,path,true);bindExplorerItemDrop(summary,path,true);
        const nested=document.createElement("div");details.append(summary,nested);children(nested,path);box.append(details);
      }else if(workspaceFiles[path]){
        const button=document.createElement("button");button.type="button";button.className="pg-file";button.setAttribute("aria-current",String(path===activeFilename));button.title=path;
        const icon=document.createElement("span");icon.textContent=path.endsWith(".java")?"J":path.endsWith(".py")?"Py":path.endsWith(".html")?"◇":"·";
        const label=document.createElement("span");label.textContent=path.split("/").at(-1);button.append(icon,label);button.onclick=()=>switchTab(path);
        button.addEventListener("contextmenu",event=>{event.preventDefault();event.stopPropagation();selectedProjectPath=path;selectedProjectFolder=false;showExplorerContextMenu(event,{path,isFolder:false});});
        button.addEventListener("keydown",event=>{
          if(event.key==="ContextMenu"||(event.shiftKey&&event.key==="F10")){
            event.preventDefault();const rect=button.getBoundingClientRect();selectedProjectPath=path;selectedProjectFolder=false;
            showExplorerContextMenu({clientX:rect.left+18,clientY:rect.top+18},{path,isFolder:false});
          }
        });
        bindExplorerDrag(button,path,false);bindExplorerItemDrop(button,path,false);box.append(button);
      }
    }
  }
  children(tree);
  const count=document.getElementById("projectFileCount");if(count)count.textContent=fileOrder.length+" files · "+folders.length+" folders";
}
function newFolder(){
  const selectedParent=selectedProjectPath&&!selectedProjectFolder?projectParent(selectedProjectPath):"";
  const base=selectedProjectFolder?selectedProjectPath:selectedParent;
  const raw=prompt("New folder path:",base?base+"/":"src");if(!raw)return;
  try{const path=projectPath(raw);if(workspaceFiles[path])throw Error("A file already uses that path.");if(workspaceFolders.length>=100)throw Error("Use up to 100 folders per workspace.");workspaceFolders=[...new Set([...workspaceFolders,path])];projectOrder=normalizedProjectOrder([...projectOrder,path]);selectedProjectPath=path;selectedProjectFolder=true;renderFileTree();triggerAutoSave();}catch(error){alert(error.message);}
}
function renameSelection(){
  if(!selectedProjectPath)return showSaveStatus("Select a file or folder first.");
  if(!selectedProjectFolder)return window.renameFile(selectedProjectPath);
  const old=selectedProjectPath,raw=prompt("New folder path:",old);if(!raw||raw===old)return;
  try{
    const target=projectPath(raw);if(target.startsWith(old+"/"))throw Error("Move a folder outside itself.");
    const state=currentState(),mapping=p=>p===old?target:p.startsWith(old+"/")?target+p.slice(old.length):p;
    const names=state.fileOrder.map(mapping);if(new Set(names).size!==names.length||workspaceFiles[target]||workspaceFolders.includes(target))throw Error("That destination already exists.");
    const files=Object.fromEntries(Object.entries(state.files).map(([p,v])=>[mapping(p),v]));
    createWorkspace(currentLang,files,names,mapping(activeFilename),workspaceFolders.map(mapping),projectOrder.map(mapping));triggerAutoSave();
  }catch(error){alert(error.message);}
}
function deleteSelection(){
  if(!selectedProjectPath)return;
  if(!selectedProjectFolder)return window.deleteFile(selectedProjectPath);
  const path=selectedProjectPath,names=fileOrder.filter(p=>!p.startsWith(path+"/"));
  if(!names.length)return alert("Keep at least one file in this project.");
  if(!confirm("Delete folder "+path+" and its files?"))return;
  const state=currentState(),files=Object.fromEntries(names.map(p=>[p,state.files[p]]));
  createWorkspace(currentLang,files,names,names.includes(activeFilename)?activeFilename:names[0],workspaceFolders.filter(p=>p!==path&&!p.startsWith(path+"/")),projectOrder.filter(p=>p!==path&&!p.startsWith(path+"/")));triggerAutoSave();
}

function hideExplorerContextMenu(){
  const menu=document.getElementById("explorerContextMenu");if(menu)menu.classList.add("hidden");
}
function showExplorerContextMenu(event,{path="",isFolder=false,root=false}={}){
  const menu=document.getElementById("explorerContextMenu");if(!menu)return;
  menu.dataset.path=path;menu.dataset.folder=String(isFolder);menu.dataset.root=String(root);
  const open=menu.querySelector('[data-explorer-action="open"]');
  const rename=menu.querySelector('[data-explorer-action="rename"]');
  const del=menu.querySelector('[data-explorer-action="delete"]');
  open?.classList.toggle("hidden",root||isFolder);
  rename?.classList.toggle("hidden",root);
  del?.classList.toggle("hidden",root);
  menu.classList.remove("hidden");
  const pad=8,rect=menu.getBoundingClientRect();
  let left=event.clientX,top=event.clientY;
  if(left+rect.width>innerWidth-pad)left=Math.max(pad,innerWidth-rect.width-pad);
  if(top+rect.height>innerHeight-pad)top=Math.max(pad,innerHeight-rect.height-pad);
  menu.style.left=left+"px";menu.style.top=top+"px";
  menu.querySelector("button:not(.hidden)")?.focus();
}
function handleExplorerContextAction(action){
  const menu=document.getElementById("explorerContextMenu");if(!menu)return;
  const root=menu.dataset.root==="true",path=menu.dataset.path||"",isFolder=menu.dataset.folder==="true";
  selectedProjectPath=path;selectedProjectFolder=root||isFolder;
  hideExplorerContextMenu();
  if(action==="open"&&path&&!isFolder)return switchTab(path);
  if(action==="new-file")return window.promptNewFile();
  if(action==="new-folder")return newFolder();
  if(action==="rename")return renameSelection();
  if(action==="delete")return deleteSelection();
}

function attachTabEvents() {
  const container = document.getElementById("fileTabsContainer");
  if (!container) return;

  container.querySelectorAll(".tab-element").forEach((tab) => {
    const filename = tab.getAttribute("data-filename");
    const index = parseInt(tab.getAttribute("data-index"));

    tab.addEventListener("click", () => switchTab(filename));

    // Drag & Drop
    tab.addEventListener("dragstart", (e) => {
      draggedTabIndex = index;
      e.dataTransfer.effectAllowed = "move";
      setTimeout(() => tab.classList.add("opacity-50"), 0);
    });

    tab.addEventListener("dragover", (e) => {
      e.preventDefault();
      tab.classList.add("bg-slate-600");
    });

    tab.addEventListener("dragleave", () =>
      tab.classList.remove("bg-slate-600"),
    );

    tab.addEventListener("drop", (e) => {
      e.preventDefault();
      tab.classList.remove("bg-slate-600");
      const targetIndex = index;

      if (draggedTabIndex !== -1 && draggedTabIndex !== targetIndex) {
        const movedItem = fileOrder.splice(draggedTabIndex, 1)[0];
        fileOrder.splice(targetIndex, 0, movedItem);
        renderTabs();
        triggerAutoSave();
      }
    });

    tab.addEventListener("dragend", () => {
      tab.classList.remove("opacity-50");
      draggedTabIndex = -1;
    });
  });
}

// ==========================================
// 4. STORAGE, ZIP, & SNAPSHOTS
// ==========================================
let autoSaveTimeout;
let workspaceDirty = false;
let localSaveFailed = false;
function ownerUid() {
  return loadedOwnerUid;
}
function currentState() {
  const files = {};
  for (const [name,file] of Object.entries(workspaceFiles))
    files[name] = file.model.getValue();
  return { lang:currentLang, files, fileOrder:[...fileOrder],
    activeFilename, folders:[...workspaceFolders], projectOrder:[...normalizedProjectOrder(projectOrder)], savedAt:new Date().toISOString() };
}
function showSaveStatus(text,failed=false) {
  const indicator=document.getElementById("autoSaveIndicator");
  if(!indicator)return;
  indicator.textContent=text;
  indicator.classList.remove("opacity-0","text-rose-400","text-emerald-400");
  indicator.classList.add(failed?"text-rose-400":"text-emerald-400");
}
function persistWorkspace(){
  clearTimeout(autoSaveTimeout);
  autoSaveTimeout=null;
  const uid=ownerUid();
  if(!uid || !Object.keys(workspaceFiles).length) return false;
  try{
    const state=currentState();
    if(practiceMode){
      if(!practiceTransfer)return false;
      practiceTransfer.scratch={lang:state.lang,files:state.files,fileOrder:state.fileOrder,
        activeFilename:state.activeFilename,folders:state.folders,projectOrder:state.projectOrder};
      sessionStorage.setItem(practiceBridgeKey(uid),JSON.stringify(practiceTransfer));
      workspaceDirty=false;
      localSaveFailed=false;
      showSaveStatus("Practice scratch saved in this tab");
      return true;
    }
    if(typeof projectStudio!=="undefined"&&projectStudio?.getActiveProject()){
      projectStudio.saveState(state);
      localStorage.setItem(playgroundLanguageKey(uid),currentLang);
    }else{
      localStorage.setItem(playgroundWorkspaceKey(uid,currentLang),JSON.stringify(state));
      localStorage.setItem(playgroundLanguageKey(uid),currentLang);
    }
    workspaceDirty=false;
    localSaveFailed=false;
    showSaveStatus("Saved on this device");
    return true;
  }catch(error){
    console.error("Workspace save failed:",error);
    localSaveFailed=true;
    showSaveStatus("Not saved — storage unavailable or full",true);
    return false;
  }
}
function triggerAutoSave(){
  clearTimeout(autoSaveTimeout);
  workspaceDirty=true;
  const indicator=document.getElementById("autoSaveIndicator");
  if(indicator){
    indicator.textContent="Saving locally…";
    indicator.classList.remove("opacity-0","text-emerald-400");
    indicator.classList.add("text-rose-400");
  }
  autoSaveTimeout=setTimeout(persistWorkspace,1000);
}
window.addEventListener("pagehide",()=>{
  if (workspaceDirty || autoSaveTimeout) persistWorkspace();
});
window.addEventListener("beforeunload",event=>{
  if (!localSaveFailed) return;
  event.preventDefault();
  event.returnValue="";
});

function loadLocalWorkspace(lang) {
  const uid=ownerUid();
  if(!uid) return false;
  let preferred=lang||(guestMode?"web":"java");try{preferred=lang||localStorage.getItem(playgroundLanguageKey(uid))||preferred;}catch{}
  const chosen=PLAYGROUND_LANGUAGES.includes(preferred)?preferred:"java";
  const saved=readPlaygroundDraft(localStorage,uid,chosen);
  createWorkspace(chosen,saved?.files,saved?.fileOrder,saved?.activeFilename,saved?.folders,saved?.projectOrder);
  workspaceDirty=false;
  localSaveFailed=false;
  showSaveStatus(saved?"Local draft loaded":"New workspace (not saved yet)");
  return true;
}

window.adminervaImportLegacyPlayground = function () {
  const uid=ownerUid();
  if(!uid) return alert("Sign in before importing code.");
  let state;
  try { state=JSON.parse(localStorage.getItem("Adminerva_Playground_Workspace")||"null"); }
  catch { return alert("Older browser draft is damaged and cannot be imported."); }
  if(!validPlaygroundState(state)) return alert("No valid older browser draft is available.");
  if(!confirm("This older browser draft is NOT linked to a student account. On a shared device it might belong to someone else. Import it only if it is yours. Continue?"))return;
  if(!persistWorkspace())return alert("Current draft cannot be saved. Export ZIP before importing.");
  if(!window.adminervaRestorePlayground(state))return alert("Import failed. Export ZIP before trying again.");
  showSaveStatus("Older draft imported into your private local workspace");
};


async function exportZIP() {
  const btn = document.getElementById("exportZipBtn");
  if (!btn) return;
  btn.innerHTML = `<span class="animate-spin">↻</span> Packing...`;
  try {
    const zip = new JSZip();
    workspaceFolders.forEach(folder=>zip.folder(folder));
    for (const [name, file] of Object.entries(workspaceFiles)) {
      zip.file(name, file.model.getValue());
    }
    const activeProject=projectStudio?.getActiveProject?.();
    if(activeProject){
      zip.file("adminerva-project.json",JSON.stringify({
        format:"adminerva-project-bundle",
        version:1,
        title:activeProject.title,
        template:activeProject.template,
        lang:activeProject.lang,
        config:activeProject.config,
        database:activeProject.database,
        design:activeProject.design,
        entry:activeFilename
      },null,2));
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const projectName=projectStudio?.getActiveProject()?.title||"Adminerva Project";
    const safeName=String(projectName).replace(/[^a-z0-9._-]+/gi,"_").replace(/^_+|_+$/g,"").slice(0,80)||"Adminerva_Project";
    a.download = safeName+".zip";
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert("Failed to export ZIP.");
  }
  btn.innerHTML = `📥 Export ZIP`;
}

// Expose only an in-memory snapshot to the authenticated cloud backup module.
window.adminervaPlaygroundState=function(){
  if(practiceMode||!ownerUid()||(auth.currentUser?.uid||(guestMode?"public-visitor-v1":null))!==ownerUid())return null;
  const state=currentState();
  return {lang:state.lang,files:state.files,fileOrder:state.fileOrder,
    activeFilename:state.activeFilename,folders:state.folders,projectOrder:state.projectOrder};
};
window.adminervaRestorePlayground=function(state){
  if(practiceMode)return false;
  if((auth.currentUser?.uid||(guestMode?"public-visitor-v1":null))!==ownerUid())return false;
  if(!validPlaygroundState(state))return false;
  const uid=ownerUid();
  if(!uid || !persistWorkspace())return false;
  try{
    const activeProject=typeof projectStudio!=="undefined"?projectStudio?.getActiveProject():null;
    if(activeProject){
      const limits=projectStudio.getLimits?.()||{};
      if(Object.keys(state.files||{}).length>(limits.maxFiles||100))throw Error("Imported project exceeds the file limit.");
      const undoKey="Adminerva_Code_Project_Undo_v1_"+uid+"_"+activeProject.id;
      localStorage.setItem(undoKey,JSON.stringify(currentState()));
      createWorkspace(state.lang,state.files,state.fileOrder,state.activeFilename,state.folders,state.projectOrder);
      projectStudio.saveState(currentState());
      workspaceDirty=false;localSaveFailed=false;
      showSaveStatus(guestMode?"Imported into local guest project":"Imported into project · autosave on");
      return true;
    }
    const target=playgroundWorkspaceKey(uid,state.lang);
    const previous=localStorage.getItem(target);
    if(previous) localStorage.setItem(playgroundUndoKey(uid,state.lang),previous);
    const next={...state,savedAt:new Date().toISOString()};
    localStorage.setItem(target,JSON.stringify(next));
    localStorage.setItem(playgroundLanguageKey(uid),state.lang);
    createWorkspace(state.lang,state.files,state.fileOrder,state.activeFilename,state.folders,state.projectOrder);
    workspaceDirty=false;
    localSaveFailed=false;
    showSaveStatus("Restored and saved on this device");
    return true;
  }catch(error){
    console.error("Could not restore workspace:",error);
    showSaveStatus("Restore failed — storage unavailable or full",true);
    return false;
  }
};
window.adminervaUndoPlaygroundRestore=function(){
  const uid=ownerUid();
  if(!uid)return;
  const activeProject=typeof projectStudio!=="undefined"?projectStudio?.getActiveProject():null;
  const raw=activeProject?localStorage.getItem("Adminerva_Code_Project_Undo_v1_"+uid+"_"+activeProject.id):localStorage.getItem(playgroundUndoKey(uid,currentLang));
  let previous=null;
  try{previous=JSON.parse(raw||"null")}catch{}
  if(!validPlaygroundState(previous)){
    alert("No previous local draft for this language.");
    return;
  }
  if(!confirm("Replace the current editor with the draft saved before the last restore?"))return;
  if(!window.adminervaRestorePlayground(previous))
    alert("Recovery failed. Try exporting your workspace as ZIP first.");
};

async function shareSnapshot() {
  const btn = document.getElementById("snapshotBtn");
  if (!btn) return;
  btn.innerHTML = `<span class="animate-spin">↻</span> Generating...`;
  const state = {
    lang: currentLang,
    files: {},
    fileOrder: fileOrder,
    folders: [...workspaceFolders],
    projectOrder: [...normalizedProjectOrder(projectOrder)],
    timestamp: new Date().toISOString(),
    ownerUid: ownerUid() || "",
    visibility: "link",
  };
  for (const [name, file] of Object.entries(workspaceFiles))
    state.files[name] = file.model.getValue();

  try {
    if (!auth.currentUser || auth.currentUser.uid!==ownerUid()) throw Error("Sign in before sharing.");
    if (!validPlaygroundState(state)) throw Error("Add at least one valid file before sharing.");
    const docRef = await addDoc(collection(db, "playground_snapshots"), state);
    const link = `${window.location.origin}${window.location.pathname}?id=${docRef.id}`;
    try {
      await navigator.clipboard.writeText(link);
      btn.innerHTML = "Link copied";
    } catch (error) {
      prompt("Copy this snapshot link:", link);
      btn.innerHTML = "Snapshot created";
    }
  } catch (error) {
    btn.innerHTML = `❌ Error`;
  }
  setTimeout(() => (btn.innerHTML = `🔗 Share Snapshot`), 3000);
}

async function loadSnapshot(id) {
  try {
    const docSnap = await getDoc(doc(db, "playground_snapshots", id));
    if (docSnap.exists()) {
      const data = docSnap.data();
      if (!validPlaygroundState(data)) throw Error("Shared snapshot is incomplete.");
      if (confirm("Import this shared snapshot into your workspace? Your previous local draft will be kept as a recoverable copy.")) {
        // Load the student's existing local draft first so a shared link
        // never silently overwrites their current account's work.
        loadLocalWorkspace();
        if (!window.adminervaRestorePlayground(data))
          alert("Snapshot import failed. Your existing workspace was kept.");
      } else {
        loadLocalWorkspace();
      }
      window.history.replaceState({}, document.title, window.location.pathname);
    } else {
      alert("Snapshot not found.");
      loadLocalWorkspace();
    }
  } catch (error) {
    alert("Error loading snapshot: " + error.message);
    loadLocalWorkspace();
  }
}

// ==========================================
// 5. EXECUTION ENGINE & DIAGNOSTICS
// ==========================================
function compilerEntry(){
  return chooseCompilerEntry({
    language:currentLang,defaultFile:languageConfig[currentLang].defaultFile,
    activeFilename,fileOrder,files:currentState().files
  });
}
async function executionPayload(options={}){
  const entry=compilerEntry();if(!entry)throw Error('Add a '+languageConfig[currentLang].defaultFile+' entry file before running.');
  const desktopBundle=currentLang==='java'&&options.desktopBundle===true;
  const stdin=document.getElementById('stdinInput')?.value||'';
  if(!desktopBundle&&fileOrder.length===1&&!entry.includes('/'))return {language_id:languageConfig[currentLang].judge0Id,source_code:workspaceFiles[entry].model.getValue(),stdin,cpu_time_limit:5,wall_time_limit:10};
  if(workspaceFiles.compile||workspaceFiles.run)throw Error('The compiler reserves root files named compile and run. Rename those files before running this project.');
  const quote=text=>"'"+text.replace(/'/g,"'\"'\"'")+"'";
  const files=currentState().files,zip=new JSZip();
  for(const [path,content] of Object.entries(files))zip.file(path,content);
  let compile='',run='';
  if(currentLang==='java'){
    const javaFiles=fileOrder.filter(path=>path.endsWith('.java'));
    const source=files[entry],pkg=source.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1];
    const main=(pkg?pkg+'.':'')+entry.split('/').at(-1).replace(/\.java$/,'');
    if(desktopBundle){
      compile='rm -rf .adminerva-classes adminerva-app.jar\nmkdir -p .adminerva-classes\njavac -d .adminerva-classes '+javaFiles.map(quote).join(' ')+'\njar cfe adminerva-app.jar '+quote(main)+' -C .adminerva-classes .';
      run="base64 adminerva-app.jar | tr -d '\\n'";
    }else{
      compile='javac -d . '+javaFiles.map(quote).join(' ');
      run='java '+quote(main);
    }
  }else if(currentLang==='python')run='export PYTHONPATH=".:\$'+'{PYTHONPATH:-}"\npython3 '+quote(entry);
  else if(currentLang==='cpp')compile='g++ -std=c++17 -O0 -I . -I '+quote(entry.split('/').slice(0,-1).join('/')||'.')+' '+fileOrder.filter(path=>/\.(cpp|cc|cxx)$/.test(path)).map(quote).join(' ')+' -o adminerva-program',run='./adminerva-program';
  else if(currentLang==='csharp')compile='mcs -out:adminerva-program.exe '+fileOrder.filter(path=>path.endsWith('.cs')).map(quote).join(' '),run='mono adminerva-program.exe';
  else if(currentLang==='dart')run='dart '+quote(entry);
  zip.file('compile','#!/bin/bash\nset -e\n'+(compile||'true')+'\n');zip.file('run','#!/bin/bash\nset -e\n'+run+'\n');
  return {language_id:89,additional_files:await zip.generateAsync({type:'base64'}),stdin:desktopBundle?'':stdin,cpu_time_limit:desktopBundle?10:5,wall_time_limit:desktopBundle?20:10};
}

function isJavaDesktopMode(){return currentLang==='java'&&javaRunMode==='desktop';}

function javaDesktopRunnerDocument(){
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<style>html,body,#display{width:100%;height:100%;margin:0;overflow:hidden;background:#0f172a}body{font-family:Inter,system-ui,sans-serif}#boot{height:100%;display:grid;place-items:center;color:#a5f3fc;font-size:14px;padding:24px;text-align:center;box-sizing:border-box}</style></head>'+
    '<body><div id="display"><div id="boot">Loading the Java desktop runtime…</div></div>'+
    '<script src="https://cjrtnc.leaningtech.com/4.3/loader.js"><\/script>'+
    '<script>(function(){let runId="";const send=function(type,message){parent.postMessage({channel:"adminerva-java-desktop",runId:runId,type:type,message:String(message||"")},"*");};window.addEventListener("message",async function(event){const data=event.data||{};if(data.type!=="adminerva-java-run"||!data.jarBase64)return;runId=String(data.runId||"");try{send("status","Starting Java 17 desktop runtime…");await cheerpjInit({version:17,status:"none",clipboardMode:"java"});const boot=document.getElementById("boot");if(boot)boot.remove();cheerpjCreateDisplay(-1,-1,document.getElementById("display"));const raw=atob(data.jarBase64);const bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);cheerpOSAddStringFile("/str/adminerva-app.jar",bytes);send("started","Desktop application is starting…");const code=await cheerpjRunJar("/str/adminerva-app.jar");send("finished","Application exited"+(typeof code==="number"?" with code "+code:"."));}catch(error){send("error",error&&error.message?error.message:String(error));}},{once:true});})();<\/script></body></html>';
}

function launchJavaDesktop(jarBase64){
  const frame=document.getElementById('javaDesktopFrame');
  if(!frame)throw Error('Desktop preview is unavailable on this page.');
  const status=document.getElementById('javaDesktopStatus');
  const runId=String(++desktopRunSequence);
  frame.dataset.runId=runId;
  if(status)status.textContent='Loading Java desktop runtime…';
  document.getElementById('stopDesktopBtn')?.classList.remove('hidden');
  frame.onload=()=>{
    if(frame.dataset.runId!==runId)return;
    frame.contentWindow?.postMessage({type:'adminerva-java-run',runId,jarBase64},'*');
  };
  frame.removeAttribute('src');
  frame.srcdoc=javaDesktopRunnerDocument();
}

function stopJavaDesktop(quiet=false){
  desktopRunSequence++;
  const frame=document.getElementById('javaDesktopFrame');
  if(frame){
    frame.onload=null;
    frame.dataset.runId='';
    frame.removeAttribute('srcdoc');
    frame.src='about:blank';
  }
  document.getElementById('stopDesktopBtn')?.classList.add('hidden');
  const status=document.getElementById('javaDesktopStatus');
  if(status)status.textContent='Desktop preview stopped. Run the project to launch it again.';
  if(!quiet){
    const consoleOut=document.getElementById('consoleOutput');
    if(consoleOut)consoleOut.textContent+='\\nDesktop application stopped.';
  }
}

function setupJavaDesktopHook(){
  window.addEventListener('message',event=>{
    const frame=document.getElementById('javaDesktopFrame'),data=event.data||{};
    if(!frame||event.source!==frame.contentWindow||data.channel!=='adminerva-java-desktop'||String(data.runId||'')!==String(frame.dataset.runId||''))return;
    const status=document.getElementById('javaDesktopStatus'),consoleOut=document.getElementById('consoleOutput');
    if(data.type==='status'||data.type==='started'){
      if(status)status.textContent=data.message||'Starting desktop application…';
    }else if(data.type==='finished'){
      if(status)status.textContent=data.message||'Desktop application finished.';
      document.getElementById('stopDesktopBtn')?.classList.add('hidden');
      if(consoleOut)consoleOut.textContent+='\\n'+(data.message||'Desktop application finished.');
    }else if(data.type==='error'){
      const message='Desktop runtime error: '+(data.message||'Unknown error');
      if(status)status.textContent=message;
      if(consoleOut)consoleOut.textContent+='\\n'+message+'\\nTry Console mode if this program does not create a Swing/AWT window.';
      document.getElementById('stopDesktopBtn')?.classList.add('hidden');
    }
  });
}

function activateOutputTab(name){
  const items=[
    {name:'console',tab:'consoleTab',panel:'consoleOutput'},
    {name:'web',tab:'previewTab',panel:'webPreviewContainer'},
    {name:'desktop',tab:'desktopTab',panel:'javaDesktopPreviewContainer'}
  ];
  for(const item of items){
    const tab=document.getElementById(item.tab),panel=document.getElementById(item.panel),active=item.name===name;
    panel?.classList.toggle('hidden',!active);
    if(item.name==='desktop')panel?.classList.toggle('flex',active);
    tab?.classList.toggle('text-cyan-400',active);
    tab?.classList.toggle('border-cyan-400',active);
    tab?.classList.toggle('text-slate-500',!active);
    tab?.classList.toggle('border-transparent',!active);
  }
}

async function executeCode() {
  if(executionController)return;
  const runBtn=document.getElementById('runBtn'),overlay=document.getElementById('executionOverlay'),consoleOut=document.getElementById('consoleOutput'),label=document.getElementById('executionStage');
  const sequence=++executionSequence,controller=new AbortController(),entry=compilerEntry(),runLanguage=currentLang,desktopMode=isJavaDesktopMode();executionController=controller;
  const end=window.beginLoading?.(desktopMode?'Compiling Java desktop app…':'Running your code…')||(()=>{});
  const start=Date.now();let stage=desktopMode?'Preparing desktop package':'Preparing project';
  const update=()=>{if(label)label.textContent=stage+' · '+Math.floor((Date.now()-start)/1000)+'s';};
  const clock=setInterval(update,500),timeout=setTimeout(()=>{stage='Compiler timed out';controller.abort();},45000);
  runBtn.disabled=true;overlay?.classList.remove('hidden');update();
  try{
    persistWorkspace();Object.values(workspaceFiles).forEach(file=>monaco.editor.setModelMarkers(file.model,'judge0',[]));
    if(currentLang==='web'){
      consoleOut.textContent='Local preview · no compiler queue\n\n';executeWebPreview();notePracticeExecution();return;
    }
    consoleOut.textContent='';const payload=await executionPayload({desktopBundle:desktopMode});
    const request=async(url,options={})=>{
      const response=await fetch(url,{...options,signal:controller.signal});
      if(!response.ok)throw Error(response.status===429?'Compiler is busy. Please retry shortly.':response.status===401||response.status===403?'The compiler service is not accepting public requests. Export your project or try again later.':'Compiler service returned status '+response.status+'.');
      return response.json();
    };
    stage=desktopMode?'Sending desktop build to compiler':'Sending to compiler';update();
    let result=await request('https://ce.judge0.com/submissions?base64_encoded=false&wait=false',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    if(!result.token)throw Error('The compiler did not return a run token. Retry shortly.');
    const token=result.token;
    while(!result.status||result.status.id<=2){
      stage=result.status?.id===2?(desktopMode?'Compiling desktop application':'Compiling and running'):'Waiting in compiler queue';update();
      await new Promise((resolve,reject)=>{const onAbort=()=>{clearTimeout(timer);reject(new DOMException('Cancelled','AbortError'));};const timer=setTimeout(()=>{controller.signal.removeEventListener('abort',onAbort);resolve();},900);if(controller.signal.aborted)onAbort();else controller.signal.addEventListener('abort',onAbort,{once:true});});
      result=await request('https://ce.judge0.com/submissions/'+encodeURIComponent(token)+'?base64_encoded=false&fields=stdout,stderr,compile_output,message,status,time,memory');
    }
    if(sequence!==executionSequence)return;
    if(controller.signal.aborted)throw new DOMException('Cancelled','AbortError');
    const error=result.compile_output||result.stderr;
    if(desktopMode){
      if(error||result.status.id>3){
        consoleOut.textContent=(error||String(result.message||result.status.description||'Desktop build failed.'))+'\n\n'+(result.status.description||'Build failed');
        if(error&&currentLang===runLanguage)applyVisualDiagnostics(error,entry);
        return;
      }
      const jarBase64=String(result.stdout||'').replace(/\s+/g,'');
      if(!jarBase64.startsWith('UEsDB'))throw Error('The compiler did not return a valid Java desktop package. Retry the run or use Console mode.');
      consoleOut.textContent='Desktop build succeeded. The Swing/AWT application is launching in the Desktop app tab.\nIf your program only prints text and does not open a window, use Console mode instead.';
      document.getElementById('desktopTab')?.click();
      stage='Launching desktop runtime';update();
      launchJavaDesktop(jarBase64);
      try{projectStudio?.recordRun({mode:"desktop",status:"launched"});}catch(e){console.warn("Run history not saved:",e);}
      notePracticeExecution();
      return;
    }
    consoleOut.textContent=(error?error+'\n':'')+(result.stdout||(!error?'Program exited with no output.':''))+'\n\n'+(result.status.description||'Finished')+(result.time?' · execution '+result.time+'s':'');
    if(error&&currentLang===runLanguage)applyVisualDiagnostics(error,entry);
    if(error&&currentLang==='java'&&/HeadlessException|No X11 DISPLAY|headless/i.test(error))consoleOut.textContent+='\n\nThis program appears to open a desktop window. Change Run as to “Desktop GUI (Swing) · Beta” and run it again.';
    if(result.status.id>3&&!error)consoleOut.textContent+='\n'+String(result.message||'Review the execution status above.');
    try{projectStudio?.recordRun({mode:"console",status:result.status?.description||"finished",time:result.time||null,memory:result.memory||null});}catch(e){console.warn("Run history not saved:",e);}
    notePracticeExecution();
  }catch(error){
    if(sequence!==executionSequence)return;
    try{projectStudio?.recordRun({mode:desktopMode?"desktop":"console",status:controller.signal.aborted?"cancelled":"error"});}catch(e){console.warn("Run history not saved:",e);}
    consoleOut.textContent=controller.signal.aborted?(stage==='Compiler timed out'?'The compiler did not finish within 45 seconds. Your code is saved. Retry, or export the project to run locally.':'Run cancelled. Your code is unchanged. The remote service may finish the already submitted job.'):'Execution unavailable: '+error.message+'\nYour code is saved on this device when browser storage is available.';
  }finally{clearTimeout(timeout);clearInterval(clock);executionController=null;runBtn.disabled=false;overlay?.classList.add('hidden');end();}
}

function applyVisualDiagnostics(errorText, defaultFile) {
  const markers = [];
  const lines = errorText.split("\n");
  const lineRegex = new RegExp(`${defaultFile.replace(".", "\\.")}:(\\d+):`);

  lines.forEach((line) => {
    const match = line.match(lineRegex);
    if (match) {
      const lineNum = parseInt(match[1], 10);
      markers.push({
        startLineNumber: lineNum,
        startColumn: 1,
        endLineNumber: lineNum,
        endColumn: 100,
        message: line.trim(),
        severity: monaco.MarkerSeverity.Error,
      });
    }
  });

  if (markers.length > 0 && workspaceFiles[defaultFile]) {
    monaco.editor.setModelMarkers(
      workspaceFiles[defaultFile].model,
      "judge0",
      markers,
    );
  }
}

function executeWebPreview() {
  const files=currentState().files,entry=activeFilename.endsWith('.html')?activeFilename:'index.html';
  let html=bundleWebProject(files,entry);
  const hook='<script>for(const method of ["log","warn","error"]){const original=console[method];console[method]=(...args)=>{original.apply(console,args);parent.postMessage({type:"console",method,data:args.map(x=>typeof x==="object"?JSON.stringify(x):String(x)).join(" ")},"*");};}window.onerror=(message)=>console.error(message);<\/script>';
  html=html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/i,match=>match+hook);
  const iframe=document.getElementById('webPreviewFrame');if(iframe)iframe.srcdoc=html;
}

function setupWebConsoleHook() {
  window.addEventListener("message", function (e) {
    if (e.source===document.getElementById("webPreviewFrame")?.contentWindow && e.data && e.data.type === "console") {
      const consoleOut = document.getElementById("consoleOutput");
      if (!consoleOut) return;
      let colorClass = "text-slate-300";
      if (e.data.method === "warn") colorClass = "text-amber-400";
      if (e.data.method === "error") colorClass = "text-rose-400";
      consoleOut.innerHTML += `<div class="${colorClass}">> ${escapeHTML(e.data.data)}</div>`;
      consoleOut.scrollTop = consoleOut.scrollHeight;
    }
  });
}

// ==========================================
// 6. BYOK SOCRATIC AI TUTOR
// ==========================================
async function askMinerva() {
  await auth.authStateReady();
  const ownerUid=auth.currentUser?.uid;
  let apiKey = ownerUid?localStorage.getItem("Adminerva_Gemini_Key_"+ownerUid):null;
  if (!apiKey) {
    if (
      confirm(
        "No Gemini API Key found!\n\nTo use Minerva AI Tutor, please add your free Gemini key in Account Settings.\n\nWould you like to go to Settings now?",
      )
    ) {
      window.location.href = "student-settings.html";
    }
    return;
  }

  const btn = document.getElementById("aiTutorBtn");
  const consoleOut = document.getElementById("consoleOutput");

  document.getElementById("consoleTab")?.click();
  if (btn){btn.disabled=true;btn.innerHTML = `<span class="animate-spin">✨</span> Thinking...`;}
  const end=window.beginLoading?.("Minerva is preparing coding guidance…")||(()=>{});

  let context = `I am a student learning to program in ${currentLang}.\nHere are my files:\n`;
  for (const [name, file] of Object.entries(workspaceFiles)) {
    context += `\n--- ${name} ---\n${file.model.getValue()}\n`;
  }
  const errorText = consoleOut ? consoleOut.textContent : "";
  if (errorText.includes("error") || errorText.includes("Exception")) {
    context += `\n\nI just got this error output:\n${errorText}`;
  }

  context += `\n\nPlease act as a Socratic tutor. Do NOT give me the direct code answer. Instead, point out where the issue likely is, explain the concept I might be misunderstanding, and guide me to the solution with a hint. Keep it brief and formatting clean.`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: context }] }] }),
      },
    );

    if (!res.ok) throw new Error("API Key invalid or rate limit reached.");
    const data = await res.json();
    const reply = data.candidates[0].content.parts[0].text;

    if (consoleOut) {
      consoleOut.innerHTML += `\n\n<span class="text-purple-400 font-bold">--- ✨ Minerva Tutor ---</span>\n<span class="text-purple-300">${escapeHTML(reply)}</span>\n\n`;
      consoleOut.scrollTop = consoleOut.scrollHeight;
    }
  } catch (error) {
    alert("Minerva Error: " + error.message);
  } finally {
    if (btn){btn.disabled=false;btn.innerHTML = `✨ Ask Minerva`;}
    end();
  }
}

// ==========================================
// 7. UI BINDINGS & RESIZER LOGIC
// ==========================================
function enablePracticeSandbox(){
  const label=document.getElementById("practiceSandboxBanner");
  const link=document.getElementById("practiceReturnLink");
  if(label)label.classList.remove("hidden");
  if(link)link.href=practiceTransfer.returnPage==="guest-practice.html"?practiceReturnUrl(practiceTransfer).replace("student-practice.html","guest-practice.html"):practiceReturnUrl(practiceTransfer);
  // This workspace is temporary. Never allow saving it over personal projects
  // or uploading it to the student's regular cloud version history.
  for(const id of ["languageSelect","cloudSaveProjectBtn","cloudLoadProjectBtn",
    "loadProjectBtn","snapshotBtn","legacyImportBtn","undoRestoreBtn","importZipBtn","importCodeProjectBtn"]){
    const control=document.getElementById(id);
    if(control){control.disabled=true;control.classList.add("hidden")}
  }
}
function notePracticeExecution(){
  if(!practiceMode || !practiceTransfer)return;
  try{
    persistWorkspace();
    const output=document.getElementById("consoleOutput")?.textContent||"";
    if(recordPracticeRun(sessionStorage,ownerUid(),output)){
      practiceTransfer=readPracticeTransfer(sessionStorage,ownerUid());
      const status=document.getElementById("practiceRunStatus");
      if(status)status.textContent="Run attempted ("+practiceTransfer.runCount+"). Return to Practice Lab and describe what you observed.";
    }
  }catch(error){console.warn("Could not record practice run:",error)}
}
function bindUIEvents() {
  document.getElementById("explorerContextMenu")?.addEventListener("click",event=>{
    const button=event.target.closest("[data-explorer-action]");if(button)handleExplorerContextAction(button.dataset.explorerAction);
  });
  document.addEventListener("click",event=>{if(!event.target.closest("#explorerContextMenu"))hideExplorerContextMenu();});
  document.addEventListener("contextmenu",event=>{if(!event.target.closest("#projectTree"))hideExplorerContextMenu();});
  window.addEventListener("blur",hideExplorerContextMenu);
  window.addEventListener("resize",hideExplorerContextMenu);
  document.addEventListener("scroll",hideExplorerContextMenu,true);
  document.getElementById('cancelRunBtn')?.addEventListener('click',()=>executionController?.abort());
  document.getElementById('stopDesktopBtn')?.addEventListener('click',()=>stopJavaDesktop());
  document.getElementById('javaRunMode')?.addEventListener('change',event=>{
    javaRunMode=event.target.value==='desktop'?'desktop':'console';
    try{localStorage.setItem(JAVA_RUN_MODE_KEY,javaRunMode);}catch{}
    if(javaRunMode!=='desktop')stopJavaDesktop(true);
    projectStudio?.updateConfig({runMode:javaRunMode});
    updateOutputView();
  });
  document.getElementById('importZipBtn')?.addEventListener('click',()=>document.getElementById('projectZipInput')?.click());
  document.getElementById('projectZipInput')?.addEventListener('change',async event=>{
    const upload=event.target.files[0];event.target.value='';if(!upload)return;
    try{
      if(upload.size>3000000)throw Error('Import a ZIP smaller than 3 MB.');
      const zip=await JSZip.loadAsync(upload),files={},folders=[];let size=0,bundle=null;
      const limits=projectStudio?.getLimits?.()||{maxFiles:100,maxProjectBytes:700000};
      const manifestEntry=zip.file("adminerva-project.json");
      if(manifestEntry){
        try{bundle=JSON.parse(await manifestEntry.async("string"));}catch{throw Error("adminerva-project.json is invalid.");}
        if(bundle?.format!=="adminerva-project-bundle")throw Error("Unsupported Adminerva project bundle.");
      }
      for(const entry of Object.values(zip.files)){
        const raw=entry.unsafeOriginalName||entry.name;
        if(raw==="adminerva-project.json")continue;
        const path=projectPath(raw.replace(/\/$/,''));
        if(entry.dir){folders.push(path);if(folders.length>100)throw Error("The ZIP has more than 100 folders.");continue;}
        if(Object.hasOwn(files,path))throw Error("The ZIP contains duplicate paths: "+path);
        if(Object.keys(files).length>=limits.maxFiles)throw Error('Import up to '+limits.maxFiles+' files in this project.');
        // Reject oversized extracted entries before allocating their contents.
        const entryBytes=entry._data?.uncompressedSize;
        if(Number.isFinite(entryBytes)&&size+entryBytes>limits.maxProjectBytes)
          throw Error("The ZIP contains a file larger than this project tier allows.");
        const text=await entry.async('string');size+=new TextEncoder().encode(text).length;
        if(size>limits.maxProjectBytes)throw Error('This ZIP exceeds the project size limit.');
        files[path]=text;
      }
      if(!Object.keys(files).length)throw Error('No source files found in this ZIP.');
      const bundleLabel=bundle?" with its Adminerva DB/design data":"";
      const hasProject=Boolean(projectStudio?.getActiveProject?.());
      const message=projectStudio&&!hasProject
        ?'Create a new project from '+Object.keys(files).length+' imported files'+bundleLabel+'?'
        :'Replace this project\'s editor with '+Object.keys(files).length+' imported files'+bundleLabel+'? The current code will be kept in Undo Restore.';
      if(!confirm(message))return;
      const inferredLang=Object.keys(files).some(path=>path.endsWith(".java"))?"java":
        Object.keys(files).some(path=>path.endsWith(".py"))?"python":
        Object.keys(files).some(path=>/\.html?$/i.test(path))?"web":
        Object.keys(files).some(path=>path.endsWith(".cs"))?"csharp":
        Object.keys(files).some(path=>/\.(cpp|cc|cxx)$/i.test(path))?"cpp":
        Object.keys(files).some(path=>path.endsWith(".dart"))?"dart":currentLang;
      const nextLang=bundle?.lang||(projectStudio&&!hasProject?inferredLang:currentLang);
      const order=Object.keys(files);
      const preferred=bundle?.entry&&Object.hasOwn(files,bundle.entry)?bundle.entry:(Object.hasOwn(files,"Main.java")?"Main.java":order[0]);
      const imported={lang:nextLang,files,folders,fileOrder:order,activeFilename:preferred,projectOrder:[...folders,...order]};
      if(projectStudio){
        if(hasProject&&!persistWorkspace())throw Error("Could not save current project. Export a ZIP before importing.");
        projectStudio.importZipWorkspace(imported,bundle);
        showSaveStatus("ZIP imported and saved as a Code Studio project");
      }else if(!window.adminervaRestorePlayground({...currentState(),...imported}))
        throw Error("The current draft could not be backed up. Export it first.");
    }catch(error){alert('Import failed: '+error.message);}
  });
  document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();persistWorkspace();}if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();void executeCode();}});
  // Optional controls can be omitted in the guest interface.
  document
    .getElementById("languageSelect")
    ?.addEventListener("change", (e) => {
      const nextLang=e.target.value;
      if(projectStudio?.getActiveProject()){e.target.value=currentLang;return;}
      if(nextLang===currentLang)return;
      if(!persistWorkspace()) {
        e.target.value=currentLang;
        return alert("Current code was not saved. Export ZIP before changing languages.");
      }
      loadLocalWorkspace(nextLang);
    });
  document.getElementById("runBtn")?.addEventListener("click", executeCode);
  document.getElementById("exportZipBtn")?.addEventListener("click",()=>{
    const task=()=>exportZIP();
    if(typeof window.withLoading==="function")void window.withLoading("Preparing project ZIP…",task,{button:document.getElementById("exportZipBtn")});
    else void task();
  });
  document.getElementById("saveProjectBtn")?.addEventListener("click", () => {
    if(persistWorkspace())showSaveStatus("Saved on this device");
    else alert("Save failed. Please export a ZIP before leaving this page.");
  });
  document
    .getElementById("loadProjectBtn")
    ?.addEventListener("click", () => {
      if(workspaceDirty && !confirm("Discard unsaved editor changes and reload the last saved local draft?"))return;
      loadLocalWorkspace(currentLang);
    });
  document.getElementById("legacyImportBtn")?.addEventListener("click", window.adminervaImportLegacyPlayground);
  document.getElementById("undoRestoreBtn")?.addEventListener("click", window.adminervaUndoPlaygroundRestore);
  document
    .getElementById("snapshotBtn")
    ?.addEventListener("click",()=>{
      const task=()=>shareSnapshot();
      if(typeof window.withLoading==="function")void window.withLoading("Sharing project snapshot…",task);
      else void task();
    });
  document.getElementById("aiTutorBtn")?.addEventListener("click", askMinerva);

  document.getElementById("formatBtn")?.addEventListener("click", () => {
    editorInstance.getAction("editor.action.formatDocument").run();
  });

  document.getElementById("resetBtn")?.addEventListener("click", () => {
    const named=projectStudio?.getActiveProject();
    const message=named?"Reset this project to its original template? Export a ZIP first if you need the current files, database, or design artifacts.":"Reset this language's files?";
    if (confirm(message)) {
      if(!persistWorkspace())return alert("Current draft could not be saved. Export ZIP first.");
      if(named&&projectStudio?.resetToTemplate?.()){workspaceDirty=false;showSaveStatus("Project template restored");return;}
      createWorkspace(currentLang);
      triggerAutoSave();
    }
  });

  document.getElementById("clearConsoleBtn")?.addEventListener("click", () => {
    const cout = document.getElementById("consoleOutput");
    if (cout) cout.textContent = "";
  });

  document.getElementById("consoleTab")?.addEventListener("click",()=>activateOutputTab('console'));
  document.getElementById("previewTab")?.addEventListener("click",()=>activateOutputTab('web'));
  document.getElementById("desktopTab")?.addEventListener("click",()=>activateOutputTab('desktop'));
}

function updateOutputView() {
  const modeSelect=document.getElementById('javaRunMode'),modeLabel=document.getElementById('javaRunModeLabel'),runBtn=document.getElementById('runBtn');
  const isJava=currentLang==='java',desktop=isJavaDesktopMode();
  modeSelect?.classList.toggle('hidden',!isJava);
  modeLabel?.classList.toggle('hidden',!isJava);
  if(modeSelect)modeSelect.value=javaRunMode;
  if(runBtn){
    runBtn.textContent=desktop?'▶ Launch':'▶ Run';
    runBtn.title=desktop?'Compile and launch desktop app · Ctrl+Enter':'Run · Ctrl+Enter';
  }

  document.getElementById('consoleTab')?.classList.remove('hidden');
  if(currentLang==='web'){
    stopJavaDesktop(true);
    document.getElementById('previewTab')?.classList.remove('hidden');
    document.getElementById('desktopTab')?.classList.add('hidden');
    document.getElementById('stdinContainer')?.classList.add('hidden');
    activateOutputTab('web');
  }else if(desktop){
    document.getElementById('previewTab')?.classList.add('hidden');
    document.getElementById('desktopTab')?.classList.remove('hidden');
    document.getElementById('stdinContainer')?.classList.add('hidden');
    activateOutputTab('desktop');
  }else{
    stopJavaDesktop(true);
    document.getElementById('previewTab')?.classList.add('hidden');
    document.getElementById('desktopTab')?.classList.add('hidden');
    document.getElementById('stdinContainer')?.classList.remove('hidden');
    activateOutputTab('console');
  }
}

function initResizer() {
  const resizer = document.getElementById("dragResizer");
  const leftPane = document.getElementById("editorPane");
  const rightPane = document.getElementById("outputPane");
  const container = document.getElementById("workspaceContainer");
  let isDragging = false;

  if (!resizer) return;

  resizer.addEventListener("mousedown", () => {
    isDragging = true;
    document.body.style.cursor = "col-resize";
    if (currentLang === "web")
      document.getElementById("executionOverlay")?.classList.remove("hidden");
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    const containerRect = container.getBoundingClientRect();
    let newLeftWidth =
      ((e.clientX - containerRect.left) / containerRect.width) * 100;

    if (newLeftWidth < 20) newLeftWidth = 20;
    if (newLeftWidth > 80) newLeftWidth = 80;

    leftPane.style.width = `${newLeftWidth}%`;
    rightPane.style.width = `calc(${100 - newLeftWidth}% - 8px)`;
    if (editorInstance) editorInstance.layout();
  });

  document.addEventListener("mouseup", () => {
    if (isDragging) {
      isDragging = false;
      document.body.style.cursor = "default";
      if (currentLang === "web")
        document.getElementById("executionOverlay")?.classList.add("hidden");
    }
  });
}

function escapeHTML(str) {
  if (!str) return "";
  return String(str).replace(
    /[&<>"']/g,
    (m) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[m],
  );
}
