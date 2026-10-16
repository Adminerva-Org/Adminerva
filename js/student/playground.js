import { db, auth } from "../core/firebase-core.js";
import {playgroundWorkspaceKey,playgroundLanguageKey,playgroundUndoKey,validPlaygroundState,readPlaygroundDraft,PLAYGROUND_LANGUAGES} from "./playground-storage.mjs";
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

// ==========================================
// 2. INITIALIZATION
// ==========================================
document.addEventListener("DOMContentLoaded", async () => {
  // Auth guard controls visibility. Do not expose a workspace while access is pending.

  require.config({
    paths: {
      vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs",
    },
  });
  require(["vs/editor/editor.main"], async function () {
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

    const urlParams = new URLSearchParams(window.location.search);
    const snapshotId = urlParams.get("id");

    try {
      await auth.authStateReady();
    } catch (error) {
      console.warn("Unable to confirm sign-in:", error);
    }
    if (!auth.currentUser) {
      alert("Sign in to open your private Playground workspace.");
      return;
    }
    if (snapshotId) await loadSnapshot(snapshotId);
    else loadLocalWorkspace();
  });
});

// ==========================================
// 3. WORKSPACE & FILE MANAGEMENT
// ==========================================
function createWorkspace(lang, initialFiles, initialOrder) {
  currentLang = lang;
  const langSelect = document.getElementById("languageSelect");
  if (langSelect) langSelect.value = lang;

  Object.values(workspaceFiles).forEach((f) => f.model.dispose());
  workspaceFiles = {};
  fileOrder = [];

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

  if (fileOrder.length > 0) switchTab(fileOrder[0]);
  updateOutputView();
}

function addFile(filename, content = "", autoSwitch = true) {
  if (workspaceFiles[filename]) return alert("File already exists!");

  let syntax = languageConfig[currentLang].monaco;
  if (filename.endsWith(".css")) syntax = "css";
  if (filename.endsWith(".js")) syntax = "javascript";
  if (filename.endsWith(".html")) syntax = "html";

  const model = monaco.editor.createModel(content, syntax);
  workspaceFiles[filename] = { model };
  fileOrder.push(filename);

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
  editorInstance.setModel(workspaceFiles[filename].model);
  renderTabs();
}

// ------------------------------------------
// 3B. RENAME & DELETE LOGIC
// ------------------------------------------
window.renameFile = function (oldName) {
  const newName = prompt(`Rename ${oldName} to:`, oldName);
  if (!newName || newName.trim() === "" || newName === oldName) return;
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

  model.onDidChangeContent(() => {
    triggerAutoSave();
    monaco.editor.setModelMarkers(model, "judge0", []);
  });

  if (activeFilename === oldName) activeFilename = newName;
  switchTab(activeFilename);
  triggerAutoSave();
};

window.deleteFile = function (filename) {
  if (confirm(`Are you sure you want to delete ${filename}?`)) {
    workspaceFiles[filename].model.dispose();
    delete workspaceFiles[filename];

    const idx = fileOrder.indexOf(filename);
    fileOrder.splice(idx, 1);

    if (activeFilename === filename && fileOrder.length > 0)
      switchTab(fileOrder[0]);
    else renderTabs();

    triggerAutoSave();
  }
};

window.promptNewFile = function () {
  const name = prompt("Enter file name (e.g., Student.java, style.css):");
  if (name && name.trim()) addFile(name.trim());
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

    // Replaced dropdown with VS Code style hover-delete and double-click rename
    const tabHTML = `
      <div class="px-4 py-2 cursor-pointer flex items-center gap-2 text-xs font-bold transition relative group tab-element ${tabClass}" 
           draggable="true" data-index="${index}" data-filename="${escapeHTML(filename)}"
           ondblclick="window.renameFile('${escapeHTML(filename)}')">
        <span class="pointer-events-none tracking-wide" title="Double-click to rename">${escapeHTML(filename)}</span>
        
        ${fileOrder.length > 1 ? `<button class="opacity-0 group-hover:opacity-100 hover:text-rose-400 transition-opacity ml-1" onclick="event.stopPropagation(); window.deleteFile('${escapeHTML(filename)}')">✕</button>` : ""}
      </div>
    `;
    container.insertAdjacentHTML("beforeend", tabHTML);
  });

  container.insertAdjacentHTML(
    "beforeend",
    `
    <button onclick="window.promptNewFile()" class="text-slate-400 hover:text-white px-4 h-full flex items-center justify-center font-bold text-lg hover:bg-slate-800 transition shrink-0" title="Add new file">+</button>
  `,
  );

  attachTabEvents();
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
  return auth.currentUser?.uid || null;
}
function currentState() {
  const files = {};
  for (const [name,file] of Object.entries(workspaceFiles))
    files[name] = file.model.getValue();
  return { lang:currentLang, files, fileOrder:[...fileOrder],
    activeFilename, savedAt:new Date().toISOString() };
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
    localStorage.setItem(playgroundWorkspaceKey(uid,currentLang),JSON.stringify(state));
    localStorage.setItem(playgroundLanguageKey(uid),currentLang);
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
  const preferred=lang || localStorage.getItem(playgroundLanguageKey(uid)) || "java";
  const chosen=PLAYGROUND_LANGUAGES.includes(preferred)?preferred:"java";
  const saved=readPlaygroundDraft(localStorage,uid,chosen);
  createWorkspace(chosen,saved?.files,saved?.fileOrder,saved?.activeFilename);
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
    for (const [name, file] of Object.entries(workspaceFiles)) {
      zip.file(name, file.model.getValue());
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Adminerva_Project_${currentLang}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert("Failed to export ZIP.");
  }
  btn.innerHTML = `📥 Export ZIP`;
}

// Expose only an in-memory snapshot to the authenticated cloud backup module.
window.adminervaPlaygroundState=function(){
  const files={};
  for(const [name,file] of Object.entries(workspaceFiles))files[name]=file.model.getValue();
  return {lang:currentLang,files,fileOrder:[...fileOrder]};
};
window.adminervaRestorePlayground=function(state){
  if(!state?.lang||!state.files||typeof state.files!=="object")return false;
  if(!persistWorkspace())return false;
  createWorkspace(state.lang,state.files,state.fileOrder);
  return persistWorkspace();
};

async function shareSnapshot() {
  const btn = document.getElementById("snapshotBtn");
  if (!btn) return;
  btn.innerHTML = `<span class="animate-spin">↻</span> Generating...`;
  const state = {
    lang: currentLang,
    files: {},
    fileOrder: fileOrder,
    timestamp: new Date().toISOString(),
    ownerUid: auth.currentUser?.uid || "",
    visibility: "link",
  };
  for (const [name, file] of Object.entries(workspaceFiles))
    state.files[name] = file.model.getValue();

  try {
    const docRef = await addDoc(collection(db, "playground_snapshots"), state);
    const link = `${window.location.origin}${window.location.pathname}?id=${docRef.id}`;
    navigator.clipboard.writeText(link);
    btn.innerHTML = `✅ Link Copied!`;
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
      createWorkspace(data.lang, data.files, data.fileOrder);
      window.history.replaceState({}, document.title, window.location.pathname);
    } else {
      alert("Snapshot not found.");
      loadLocalWorkspace();
    }
  } catch (error) {
    alert("Error loading snapshot.");
    loadLocalWorkspace();
  }
}

// ==========================================
// 5. EXECUTION ENGINE & DIAGNOSTICS
// ==========================================
async function executeCode() {
  const runBtn = document.getElementById("runBtn");
  const overlay = document.getElementById("executionOverlay");
  const consoleOut = document.getElementById("consoleOutput");

  if (runBtn) {
    runBtn.disabled = true;
    runBtn.classList.add("opacity-50");
  }
  if (overlay) overlay.classList.remove("hidden");

  Object.values(workspaceFiles).forEach((f) =>
    monaco.editor.setModelMarkers(f.model, "judge0", []),
  );

  if (currentLang === "web") {
    if (consoleOut)
      consoleOut.textContent =
        "Web Preview Running...\n\n--- Console Logs ---\n";
    executeWebPreview();
    if (runBtn) {
      runBtn.disabled = false;
      runBtn.classList.remove("opacity-50");
    }
    if (overlay) overlay.classList.add("hidden");
    return;
  }

  if (consoleOut) consoleOut.textContent = "";
  try {
    const config = languageConfig[currentLang];
    let mainContent =
      workspaceFiles[config.defaultFile]?.model.getValue() || "";
    let base64Zip = null;
    const fileKeys = Object.keys(workspaceFiles);

    if (fileKeys.length > 1) {
      const zip = new JSZip();
      fileKeys.forEach((name) => {
        if (name !== config.defaultFile)
          zip.file(name, workspaceFiles[name].model.getValue());
      });
      base64Zip = await zip.generateAsync({ type: "base64" });
    }

    const payload = {
      source_code: mainContent,
      language_id: config.judge0Id,
      stdin: document.getElementById("stdinInput")?.value || "",
    };
    if (base64Zip) payload.additional_files = base64Zip;

    const res = await fetch(
      "https://ce.judge0.com/submissions?base64_encoded=false&wait=true",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const result = await res.json();

    if (consoleOut) {
      if (result.stderr || result.compile_output) {
        const errText = result.stderr || result.compile_output;
        consoleOut.innerHTML = `<span class="text-rose-400">${escapeHTML(errText)}</span>\n${escapeHTML(result.stdout || "")}`;
        applyVisualDiagnostics(errText, config.defaultFile);
      } else {
        consoleOut.textContent =
          result.stdout || "Program exited with no output.";
      }
    }
  } catch (error) {
    if (consoleOut)
      consoleOut.innerHTML = `<span class="text-rose-400">Execution Error: ${error.message}</span>`;
  } finally {
    if (overlay) overlay.classList.add("hidden");
    if (runBtn) {
      runBtn.disabled = false;
      runBtn.classList.remove("opacity-50");
    }
  }
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
  let html = workspaceFiles["index.html"]?.model.getValue() || "";
  let css = "",
    js = "";

  for (const [name, file] of Object.entries(workspaceFiles)) {
    if (name.endsWith(".css")) css += `<style>${file.model.getValue()}</style>`;
    if (name.endsWith(".js")) {
      let guardedJS =
        `window.__adminerva_loop_start = Date.now();\n` +
        file.model
          .getValue()
          .replace(
            /(for\s*\(.*?\)\s*\{|while\s*\(.*?\)\s*\{|do\s*\{)/g,
            (match) => {
              return (
                match +
                ` if (Date.now() - window.__adminerva_loop_start > 2000) { console.error('Adminerva Timeout Guard: Infinite loop broken.'); break; } `
              );
            },
          );
      js += `<script>${guardedJS}</script>`;
    }
  }

  const consoleHook = `
    <script>
      const _log = console.log, _warn = console.warn, _err = console.error;
      console.log = function(...args) { _log(...args); window.parent.postMessage({type: 'console', method: 'log', data: args.join(' ')}, '*'); };
      console.warn = function(...args) { _warn(...args); window.parent.postMessage({type: 'console', method: 'warn', data: args.join(' ')}, '*'); };
      console.error = function(...args) { _err(...args); window.parent.postMessage({type: 'console', method: 'error', data: args.join(' ')}, '*'); };
      window.onerror = function(msg, url, line) { console.error(msg + ' (Line ' + line + ')'); return false; };
    </script>
  `;

  if (html.includes("</head>"))
    html = html.replace("</head>", consoleHook + css + "</head>");
  else html = consoleHook + css + html;

  if (html.includes("</body>")) html = html.replace("</body>", js + "</body>");
  else html += js;

  const iframe = document.getElementById("webPreviewFrame");
  if (iframe) iframe.srcdoc = html;
}

function setupWebConsoleHook() {
  window.addEventListener("message", function (e) {
    if (e.data && e.data.type === "console") {
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
  let apiKey = localStorage.getItem("Adminerva_Gemini_Key");
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
  if (btn) btn.innerHTML = `<span class="animate-spin">✨</span> Thinking...`;

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
    if (btn) btn.innerHTML = `✨ Ask Minerva`;
  }
}

// ==========================================
// 7. UI BINDINGS & RESIZER LOGIC
// ==========================================
function bindUIEvents() {
  // Using optional chaining (?.) so missing buttons don't crash the script
  document
    .getElementById("languageSelect")
    ?.addEventListener("change", (e) => createWorkspace(e.target.value));
  document.getElementById("runBtn")?.addEventListener("click", executeCode);
  document.getElementById("exportZipBtn")?.addEventListener("click", exportZIP);
  document.getElementById("saveProjectBtn")?.addEventListener("click", () => {
    if(persistWorkspace())alert("Workspace saved on this device.");
    else alert("Save failed. Please export a ZIP before leaving this page.");
  });
  document
    .getElementById("loadProjectBtn")
    ?.addEventListener("click", loadLocalWorkspace);
  document
    .getElementById("snapshotBtn")
    ?.addEventListener("click", shareSnapshot);
  document.getElementById("aiTutorBtn")?.addEventListener("click", askMinerva);

  document.getElementById("formatBtn")?.addEventListener("click", () => {
    editorInstance.getAction("editor.action.formatDocument").run();
  });

  // Re-added reset logic for safety if you decide to put the button back later
  document.getElementById("resetBtn")?.addEventListener("click", () => {
    if (confirm("Wipe all files and reset workspace?"))
      createWorkspace(currentLang);
  });

  document.getElementById("clearConsoleBtn")?.addEventListener("click", () => {
    const cout = document.getElementById("consoleOutput");
    if (cout) cout.textContent = "";
  });

  document.getElementById("consoleTab")?.addEventListener("click", () => {
    document.getElementById("consoleOutput")?.classList.remove("hidden");
    document.getElementById("webPreviewContainer")?.classList.add("hidden");
    document
      .getElementById("consoleTab")
      ?.classList.add("text-cyan-400", "border-cyan-400");
    document
      .getElementById("consoleTab")
      ?.classList.remove("text-slate-500", "border-transparent");
    document
      .getElementById("previewTab")
      ?.classList.add("text-slate-500", "border-transparent");
    document
      .getElementById("previewTab")
      ?.classList.remove("text-cyan-400", "border-cyan-400");
  });

  document.getElementById("previewTab")?.addEventListener("click", () => {
    document.getElementById("consoleOutput")?.classList.add("hidden");
    document.getElementById("webPreviewContainer")?.classList.remove("hidden");
    document
      .getElementById("previewTab")
      ?.classList.add("text-cyan-400", "border-cyan-400");
    document
      .getElementById("previewTab")
      ?.classList.remove("text-slate-500", "border-transparent");
    document
      .getElementById("consoleTab")
      ?.classList.add("text-slate-500", "border-transparent");
    document
      .getElementById("consoleTab")
      ?.classList.remove("text-cyan-400", "border-cyan-400");
  });
}

function updateOutputView() {
  if (currentLang === "web") {
    document.getElementById("consoleTab")?.classList.remove("hidden");
    document.getElementById("previewTab")?.classList.remove("hidden");
    document.getElementById("previewTab")?.click();
    document.getElementById("stdinContainer")?.classList.add("hidden");
  } else {
    document.getElementById("consoleTab")?.classList.remove("hidden");
    document.getElementById("previewTab")?.classList.add("hidden");
    document.getElementById("consoleTab")?.click();
    document.getElementById("stdinContainer")?.classList.remove("hidden");
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
