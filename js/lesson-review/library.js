/** Lesson reference folders and document management. */
import { db } from "../core/firebase-core.js?v=1.3.0";
import {resolveReferenceLibrary,assertReferenceOwner,referenceFolders,referenceFolder,normalizeReferenceFolder,cacheReferenceFolders} from "./reference-library.mjs?v=1.3.4";
import {
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  increment,
  writeBatch,
} from "../core/teaching-firestore.mjs?v=1.3.0";

let libraryData = [];
let activeFolderId = null;
let extractingPdf=false;
let libraryScope=null,libraryLoadSerial=0;
function currentLibraryScope(){if(!libraryScope)throw Error("Wait for your reference library to load, then try again.");assertReferenceOwner(libraryScope);return libraryScope;}
function cacheLibrary(){cacheReferenceFolders(currentLibraryScope(),libraryData);}
function libraryStatus(message,tone=""){const status=document.getElementById("libraryStatus");if(status){status.textContent=message;status.dataset.tone=tone;}}
// Clear only when reopening the chooser, so the same PDF can be selected to retry.
document.getElementById("pdfFileInput")?.addEventListener("click",event=>{
  if(extractingPdf){event.preventDefault();return;}
  event.currentTarget.value="";
});

async function waitForProcessedPDF(fileInfo,fileName,key){
  if(typeof fileInfo?.name!=="string"||typeof fileInfo?.uri!=="string")throw Error("Google returned incomplete upload details for "+fileName+". Select the PDF again to retry.");
  const deadline=Date.now()+120000;
  for(let attempt=0;attempt<40;attempt++){
    const remaining=deadline-Date.now();
    if(remaining<=0)break;
    window.showSubtleLoader?.("Analyzing visual diagrams and OCR for "+fileName+"…");
    const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileInfo.name}?key=${encodeURIComponent(key)}`,{signal:AbortSignal.timeout(Math.min(15000,remaining))});
    if(!response.ok)throw Error("Google could not check PDF processing (status "+response.status+"). Select the remaining PDF files again to retry after checking your connection or provider limits.");
    const result=await response.json();
    if(result.state==="ACTIVE")return fileInfo.uri;
    if(result.state==="FAILED")throw Error("Google could not process "+fileName+". Select the PDF again to retry.");
    if(result.state!=="PROCESSING")throw Error("Google returned an unknown PDF processing status. Select the PDF again to retry.");
    if(attempt<39&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,Math.min(3000,deadline-Date.now())));
  }
  throw Error("PDF processing did not finish within two minutes. Your saved references are preserved. Select the remaining PDF files again to retry.");
}

function escapeHTML(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>void loadLibrary(),{once:true});
else void loadLibrary();
window.refreshReferenceLibrary=()=>loadLibrary();

async function loadLibrary() {
  if(extractingPdf){libraryStatus("Finish the current PDF import before refreshing your references.");return;}
  const serial=++libraryLoadSerial;
  const end = window.beginLoading?.("Loading reference library…") || (() => {});
  const refresh=document.getElementById("refreshLibraryBtn");if(refresh)refresh.disabled=true;
  libraryStatus("Loading reference folders for your signed-in staff account…");
  try {
    const scope=await resolveReferenceLibrary();
    const snap = await getDocs(referenceFolders(scope));
    assertReferenceOwner(scope);if(serial!==libraryLoadSerial)return;
    libraryScope=scope;
    libraryData = [];

    snap.forEach((docSnap) => {
      libraryData.push(normalizeReferenceFolder(docSnap.id,docSnap.data()));
    });

    libraryData.sort((a, b) => a.name.localeCompare(b.name));
    cacheLibrary();
    const scopeLabel=document.getElementById("libraryScope");if(scopeLabel)scopeLabel.textContent=scope.label+" · "+scope.email;
    const inlineCount=libraryData.reduce((sum,folder)=>sum+folder.documents.length,0),nestedCount=libraryData.reduce((sum,folder)=>sum+(Number(folder.documentCount)||0),0);
    libraryStatus(libraryData.length+" reference folder"+(libraryData.length===1?"":"s")+" · "+(inlineCount+nestedCount)+" document"+(inlineCount+nestedCount===1?"":"s")+". Select a folder to view its references.");

    renderFolders();
    if (activeFolderId && libraryData.find((f) => f.id === activeFolderId)) {
      await window.selectFolder(activeFolderId);
    }
  } catch (e) {
    if(serial!==libraryLoadSerial)return;
    libraryStatus("Reference folders could not load: "+e.message+". Your saved cloud references were preserved. Choose Refresh references to retry.","error");
    if(!libraryData.length)document.getElementById("folderList").innerHTML='<p class="text-sm text-red-700 p-2">References could not load. Use Refresh references to try again.</p>';
  } finally { if(serial===libraryLoadSerial&&refresh)refresh.disabled=false;end(); }
}

function formatDate(isoString) {
  if (!isoString) return "Unknown date";
  const date = new Date(isoString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

window.createFolder = async function () {
  if (!db) return alert("Firebase is not connected.");
  const input = document.getElementById("newFolderInput");
  const folderName = input.value.trim();
  if (!folderName) return;

  try {
    const docRef = await addDoc(referenceFolders(currentLibraryScope()), {
      name: folderName,
      updatedAt: new Date().toISOString(),
      documents: [],
    });

    libraryData.push({
      id: docRef.id,
      name: folderName,
      updatedAt: new Date().toISOString(),
      documents: [],
    });
    libraryData.sort((a, b) => a.name.localeCompare(b.name));
    cacheLibrary();

    input.value = "";
    renderFolders();
    selectFolder(docRef.id);
  } catch (e) {
    alert("Failed to create folder: " + e.message);
  }
};

window.renameFolder = async function (e, folderId) {
  e.stopPropagation();
  const folder = libraryData.find((f) => f.id === folderId);
  if(!folder)return;
  const newName = prompt("Enter new folder name:", folder.name);
  if (!newName || newName.trim() === folder.name) return;

  try {
    await updateDoc(referenceFolder(currentLibraryScope(), folderId), {
      name: newName.trim(),
      updatedAt: new Date().toISOString(),
    });
    folder.name = newName.trim();
    libraryData.sort((a, b) => a.name.localeCompare(b.name));
    cacheLibrary();
    renderFolders();
    if (activeFolderId === folderId) selectFolder(folderId);
  } catch (error) {
    alert("Error renaming folder: " + error.message);
  }
};

window.deleteFolder = async function (e, folderId) {
  e.stopPropagation();
  if (
    !confirm("Delete this folder and ALL its documents? This cannot be undone.")
  )
    return;

  try {
    // Firestore does not cascade-delete subcollections.
    // Remove owned child documents before removing the parent folder.
    const children=await getDocs(referenceFolders(currentLibraryScope(),folderId,"documents"));
    for(let index=0;index<children.docs.length;index+=400){
      const batch=writeBatch(db);
      for(const child of children.docs.slice(index,index+400))batch.delete(child.ref);
      await batch.commit();
    }
    await deleteDoc(referenceFolder(currentLibraryScope(),folderId));
    libraryData = libraryData.filter((f) => f.id !== folderId);
    cacheLibrary();

    if (activeFolderId === folderId) {
      activeFolderId = null;
      document.getElementById("documentWorkspace").classList.add("hidden");
      document.getElementById("driveToolbar").classList.add("hidden");
      document.getElementById("blankWorkspace").classList.remove("hidden");
      document.getElementById("activeFolderTitle").innerHTML =
        `<span>📂</span> Select a Folder`;
    }
    renderFolders();
  } catch (error) {
    alert("Error deleting folder: " + error.message);
  }
};

function renderFolders() {
  const folderList = document.getElementById("folderList");
  folderList.innerHTML = "";
  if(!libraryData.length){folderList.innerHTML='<p class="text-sm text-slate-600 p-2">No reference folders in this library yet. Create a folder, or refresh after your older references are restored.</p>';return;}

  libraryData.forEach((folder) => {
    const isActive = folder.id === activeFolderId;
    const bgClass = isActive
      ? "bg-blue-100 text-blue-900 font-bold"
      : "bg-white text-gray-700 hover:bg-gray-100";

    const safeId = escapeHTML(folder.id);
    const safeName = escapeHTML(folder.name);

    folderList.insertAdjacentHTML(
      "beforeend",
      `
            <div onclick="selectFolder('${safeId}')" class="group flex justify-between items-center w-full p-3 rounded text-sm cursor-pointer border border-transparent ${bgClass}">
                <div class="flex items-center gap-2 truncate">
                    <span>📁</span>
                    <span class="truncate">${safeName}</span>
                </div>
                <div class="group-hover-show flex gap-2">
                    <button onclick="renameFolder(event, '${safeId}')" class="text-gray-400 hover:text-blue-600" title="Rename">✏️</button>
                    <button onclick="deleteFolder(event, '${safeId}')" class="text-gray-400 hover:text-red-600" title="Delete">🗑️</button>
                </div>
            </div>
        `,
    );
  });
}

window.selectFolder = async function (folderId) {
  activeFolderId = folderId;
  renderFolders();

  const folder = libraryData.find((f) => f.id === folderId);
  if (folder) {
    document.getElementById("activeFolderTitle").innerHTML =
      `<span>📂</span> ${escapeHTML(folder.name)}`;

    document.getElementById("documentWorkspace").classList.remove("hidden");
    document.getElementById("documentWorkspace").classList.add("flex");
    document.getElementById("driveToolbar").classList.remove("hidden");
    document.getElementById("blankWorkspace").classList.add("hidden");
    document.getElementById("searchInput").value = "";
    renderDocuments(folder.documents);
    try{
      const snapshot=await getDocs(referenceFolders(currentLibraryScope(),folderId,"documents"));
      const legacy=folder.documents.filter(item=>!item._documentId);
      folder.documents=[...legacy,...snapshot.docs.map(item=>({
        ...item.data(),_documentId:item.id
      }))];
      if(activeFolderId===folderId)renderDocuments(folder.documents);
    }catch(error){
      console.warn("Additional folder documents unavailable:",error);
      if(activeFolderId===folderId)alert("Some reference documents could not be loaded: "+error.message);
    }
  }
};

window.filterDocuments = function () {
  const query = document.getElementById("searchInput").value.toLowerCase();
  const folder = libraryData.find((f) => f.id === activeFolderId);
  if (!folder) return;

  const filteredDocs = folder.documents.filter(
    (doc) =>
      String(doc.title||"").toLowerCase().includes(query) ||
      String(doc.text||"").toLowerCase().includes(query),
  );
  renderDocuments(filteredDocs);
};

window.renameDocument = async function (docIndex) {
  const folder = libraryData.find((f) => f.id === activeFolderId);
  if (!folder) return;

  const oldTitle = folder.documents[docIndex].title;
  const newTitle = prompt("Enter new document name:", oldTitle);
  if (!newTitle || newTitle.trim() === oldTitle) return;

  const original=folder.documents[docIndex];
  const updated={...original,title:newTitle.trim(),updatedAt:new Date().toISOString()};
  try{
    if(original._documentId){
      await updateDoc(referenceFolder(currentLibraryScope(),activeFolderId,"documents",original._documentId),{
        title:updated.title,updatedAt:updated.updatedAt
      });
    }else{
      const legacy=folder.documents.filter(item=>!item._documentId);
      const index=legacy.indexOf(original);
      if(index<0)throw Error("Reference document no longer exists.");
      legacy[index]=updated;
      await updateDoc(referenceFolder(currentLibraryScope(),activeFolderId),{documents:legacy});
    }
    folder.documents[docIndex]=updated;
    renderDocuments(folder.documents);
  }catch(error){alert("Error renaming document: "+error.message);}

};

window.deleteDocument = async function (docIndex) {
  if (!confirm("Are you sure you want to delete this document?")) return;
  const folder = libraryData.find((f) => f.id === activeFolderId);

  const original=folder.documents[docIndex];
  if(!original)return;
  try{
    if(original._documentId){
      const batch=writeBatch(db);
      batch.delete(referenceFolder(currentLibraryScope(),activeFolderId,"documents",original._documentId));
      batch.update(referenceFolder(currentLibraryScope(),activeFolderId),{documentCount:increment(-1)});
      await batch.commit();
    }else{
      const legacy=folder.documents.filter(item=>!item._documentId&&item!==original);
      await updateDoc(referenceFolder(currentLibraryScope(),activeFolderId),{documents:legacy});
    }
    folder.documents.splice(docIndex,1);
    renderDocuments(folder.documents);
  }catch(error){alert("Error deleting document: "+error.message);}

};

window.previewDocumentText = function (folderId, docIndex) {
  const folder = libraryData.find((f) => f.id === folderId);
  if (folder && folder.documents[docIndex]) {
    alert(
      "PREVIEW:\n\n" +
        String(folder.documents[docIndex].text||"").substring(0, 500) +
        "...",
    );
  }
};

function renderDocuments(documentsArray) {
  const docList = document.getElementById("documentList");
  docList.innerHTML = "";

  if (!documentsArray || documentsArray.length === 0) {
    docList.innerHTML =
      '<div class="p-8 text-center text-gray-400 italic">No documents found.</div>';
    return;
  }

  documentsArray.forEach((doc, index) => {
    const safeTitle = escapeHTML(doc.title);
    const safeDate = escapeHTML(formatDate(doc.updatedAt));
    const safeFolderId = escapeHTML(activeFolderId);
    const actualIndex=libraryData.find(item=>item.id===activeFolderId)?.documents.indexOf(doc) ?? -1;
    if(actualIndex<0)return;

    docList.insertAdjacentHTML(
      "beforeend",
      `
            <div class="group grid grid-cols-12 gap-4 px-6 py-4 border-b hover:bg-gray-50 items-center transition">
                <div class="col-span-6 flex items-center gap-3 truncate">
                    <span class="text-xl">📄</span>
                    <div class="truncate">
                        <p class="font-semibold text-gray-800 text-sm truncate cursor-pointer hover:text-blue-600" onclick="window.previewDocumentText('${safeFolderId}', ${actualIndex})">${safeTitle}</p>
                    </div>
                </div>
                <div class="col-span-4 text-sm text-gray-500">
                    ${safeDate}
                </div>
                <div class="col-span-2 text-right flex justify-end gap-3 group-hover-show">
                    <button onclick="renameDocument(${actualIndex})" class="text-gray-400 hover:text-blue-600" title="Rename">✏️</button>
                    <button onclick="deleteDocument(${actualIndex})" class="text-gray-400 hover:text-red-600" title="Delete">🗑️</button>
                </div>
            </div>
        `,
    );
  });
}

window.extractPDF = async function () {
  if(extractingPdf)return;
  const fileInput = document.getElementById("pdfFileInput");
  if (!fileInput.files.length) return;

  if (fileInput.files.length > 5) {
    alert(
      "To prevent API rate limits, please select a maximum of 5 PDFs at once.",
    );
    fileInput.value = "";
    return;
  }

  const gemKey = (localStorage.getItem("Adminerva_gemini_token") || "").trim();
  const modelName = (
    localStorage.getItem("Adminerva_ai_model") || "gemini-2.5-flash"
  ).trim();

  if (!gemKey)
    return alert("Missing Gemini API Key. Please check your Global Settings.");

  const targetFolderId = activeFolderId;
  const folder = libraryData.find((f) => f.id === targetFolderId);
  if(!folder)return alert("Select a reference folder before importing PDFs.");
  let uploadedCount=0;
  let completed=false;
  extractingPdf=true;fileInput.disabled=true;

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  try {
    for (let i = 0; i < fileInput.files.length; i++) {
      const file = fileInput.files[i];

      // 🚀 FREE TIER FIX: 15-second mandatory cooldown between files to respect the 15 RPM limit
      if (i > 0) {
        if (typeof window.showSubtleLoader === "function") {
          window.showSubtleLoader(
            `Free Tier Cooldown (${i + 1}/${fileInput.files.length}). Waiting 15s...`,
          );
        }
        await delay(15000);
      }

      // 1. FAST RAW UPLOAD TO GEMINI SERVERS
      if (typeof window.showSubtleLoader === "function") {
        window.showSubtleLoader(
          `Uploading PDF to Cloud (${i + 1}/${fileInput.files.length}): ${file.name}`,
        );
      }

      const uploadUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${encodeURIComponent(gemKey)}`;
      const uploadRes = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          "X-Goog-Upload-Command": "start, upload, finalize",
          "X-Goog-Upload-Header-Content-Length": file.size.toString(),
          "X-Goog-Upload-Header-Content-Type": file.type,
          "Content-Type": file.type,
        },
        body: file,
      });

      if (!uploadRes.ok)
        throw new Error(
          `Upload failed for ${file.name}: ${uploadRes.statusText}`,
        );
      const uploadData = await uploadRes.json();
      const fileInfo = uploadData.file;

      // Processing checks are bounded and HTTP/provider failures stop immediately.
      const activeFileUri=await waitForProcessedPDF(fileInfo,file.name,gemKey);

      // 3. EXTRACT ALL DATA USING THE PROCESSED FILE URI (FREE TIER RETRY LOGIC)
      if (typeof window.showSubtleLoader === "function") {
        window.showSubtleLoader(
          `Extracting text structure from ${file.name}...`,
        );
      }

      const generateUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(gemKey)}`;

      // 🚀 FREE TIER FIX: Increased max retries from 3 to 5
      let retries = 5;
      let generateRes;
      let result;
      let extractionSuccess = false;

      while (retries >= 0 && !extractionSuccess) {
        generateRes = await fetch(generateUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: "You are a data ingestion engine. Extract ALL educational text from the attached PDF. You MUST process this document regardless of its format. Extract all standard digital text, AND use your vision capabilities to perform OCR on any scanned images, graphics, or diagrams to extract their text as well. Output ONLY the pure, raw extracted educational text. Do not output any conversational filler.",
                  },
                  {
                    file_data: {
                      mime_type: file.type,
                      file_uri: activeFileUri,
                    },
                  },
                ],
              },
            ],
          }),
        });

        // Intercept API Overloads (503) and Rate Limits (429)
        if (generateRes.status === 503 || generateRes.status === 429) {
          // 🚀 FREE TIER FIX: Exponential Backoff + Jitter
          // Base wait doubles each time: 10s, 20s, 40s...
          const attemptNumber = 6 - retries; // 1, 2, 3, 4, 5
          const baseWait = Math.pow(2, attemptNumber) * 5000;

          // Add 1 to 3 seconds of random "Jitter" to stagger requests
          const jitter = Math.floor(Math.random() * 3000) + 1000;
          const waitTime = baseWait + jitter;

          console.warn(
            `[Free Tier Overload] Retrying ${file.name} in ${(waitTime / 1000).toFixed(1)}s... (${retries} attempts left)`,
          );

          if (typeof window.showSubtleLoader === "function") {
            window.showSubtleLoader(
              `API Busy. Retrying in ${(waitTime / 1000).toFixed(1)}s...`,
            );
          }

          await delay(waitTime);
          retries--;
          continue;
        }

        if (!generateRes.ok)
          throw new Error(
            `Extraction failed for ${file.name}: Status ${generateRes.status}`,
          );

        result = await generateRes.json();

        if (!result.candidates || result.candidates.length === 0) {
          throw new Error(
            `The AI refused to read "${file.name}". It may have triggered safety filters.`,
          );
        }

        extractionSuccess = true;
      }

      if (!extractionSuccess) {
        throw new Error(
          `Failed to extract ${file.name} after multiple API overloads.`,
        );
      }

      const extractedText = result.candidates[0].content.parts[0].text;

      const record={title:file.name,text:extractedText,updatedAt:new Date().toISOString()};
      if(new TextEncoder().encode(JSON.stringify(record)).length>850000)
        throw Error("Extracted text from "+file.name+" exceeds Firestore's safe document size. Split this PDF into smaller references.");
      const newRef=doc(referenceFolders(currentLibraryScope(),targetFolderId,"documents"));
      const batch=writeBatch(db);
      batch.set(newRef,record);
      batch.update(referenceFolder(currentLibraryScope(),targetFolderId),{
        documentCount:increment(1),updatedAt:new Date().toISOString()
      });
      await batch.commit();
      folder.documents.push({...record,_documentId:newRef.id});
      uploadedCount++;

      // 4. INSTANT CLEANUP
      fetch(
        `https://generativelanguage.googleapis.com/v1beta/${fileInfo.name}?key=${encodeURIComponent(gemKey)}`,
        { method: "DELETE" },
      ).catch(() => {});
    }

    if(uploadedCount)console.info("Stored "+uploadedCount+" PDFs as independent records.");
    completed=true;
  } catch (error) {
    alert("PDF import stopped. "+(error.name==="TimeoutError"?"The processing check timed out. Select the remaining PDFs again to retry.":error.message)+(uploadedCount?" "+uploadedCount+" completed reference(s) are already saved; retry only the remaining files.":" Your saved references are unchanged."));
  } finally {
    extractingPdf=false;fileInput.disabled=false;
    if(completed)fileInput.value = "";
    renderFolders();

    if (activeFolderId === targetFolderId) {
      renderDocuments(folder.documents);
    }

    if (typeof window.hideSubtleLoader === "function") {
      window.hideSubtleLoader();
    }
  }
};
