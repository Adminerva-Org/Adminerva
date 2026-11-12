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
const MAX_PDF_FILES=5;
const MAX_PDF_BYTES=50*1024*1024;
const MAX_REFERENCE_RECORD_BYTES=850000;
const PDF_EXTRACTION_INSTRUCTIONS="You are a data ingestion engine. Extract ALL educational text from the attached PDF. Process native text and use vision/OCR for scanned pages, images, graphics, diagrams, tables and labels. Preserve useful reading order, headings, lists, code, formulas and table text when possible. Do not summarize, explain, grade or add conversational filler. Return only the extracted educational text.";
const externalPdfImport={files:[],folderId:null,busy:false};

function currentLibraryScope(){if(!libraryScope)throw Error("Wait for your reference library to load, then try again.");assertReferenceOwner(libraryScope);return libraryScope;}
function cacheLibrary(){cacheReferenceFolders(currentLibraryScope(),libraryData);}
function libraryStatus(message,tone=""){const status=document.getElementById("libraryStatus");if(status){status.textContent=message;if(status.dataset)status.dataset.tone=tone;}}
function externalPdfStatus(message,tone=""){const status=document.getElementById("externalPdfStatus");if(status){status.textContent=message;if(status.dataset)status.dataset.tone=tone;}}

function validatePdfFiles(files){
  const list=Array.from(files||[]);
  if(!list.length)throw Error("Select at least one PDF.");
  if(list.length>MAX_PDF_FILES)throw Error("Select a maximum of "+MAX_PDF_FILES+" PDFs at once.");
  for(const file of list){
    const pdfType=file.type==="application/pdf"||/\.pdf$/i.test(file.name||"");
    if(!pdfType)throw Error(file.name+" is not a PDF.");
    if(!Number.isFinite(file.size)||file.size<=0)throw Error(file.name+" is empty or unreadable.");
    if(file.size>MAX_PDF_BYTES)throw Error(file.name+" exceeds the 50 MB PDF processing limit. Split it into smaller references.");
  }
  return list;
}

function referenceRecord(title,text){
  const cleanTitle=String(title||"").trim(),cleanText=String(text||"").trim();
  if(!cleanTitle)throw Error("A reference title is missing.");
  if(!cleanText)throw Error("No educational text was extracted from "+cleanTitle+".");
  const record={title:cleanTitle,text:cleanText,updatedAt:new Date().toISOString()};
  if(new TextEncoder().encode(JSON.stringify(record)).length>MAX_REFERENCE_RECORD_BYTES)
    throw Error("Extracted text from "+cleanTitle+" exceeds Firestore's safe document size. Split this PDF into smaller references.");
  return record;
}

async function saveReferenceRecord(folderId,folder,title,text){
  const record=referenceRecord(title,text);
  const newRef=doc(referenceFolders(currentLibraryScope(),folderId,"documents"));
  const batch=writeBatch(db);
  batch.set(newRef,record);
  batch.update(referenceFolder(currentLibraryScope(),folderId),{
    documentCount:increment(1),updatedAt:record.updatedAt
  });
  await batch.commit();
  folder.documents.push({...record,_documentId:newRef.id});
  return record;
}

async function fileToBase64(file){
  return await new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onerror=()=>reject(Error("Could not read "+file.name+" from this device."));
    reader.onload=()=>{
      const value=String(reader.result||""),comma=value.indexOf(",");
      if(comma<0)return reject(Error("Could not encode "+file.name+" for AI processing."));
      resolve(value.slice(comma+1));
    };
    reader.readAsDataURL(file);
  });
}

async function providerError(response,prefix){
  let detail="";
  try{
    const raw=await response.text();
    if(raw){
      try{
        const parsed=JSON.parse(raw);
        detail=parsed?.error?.message||parsed?.message||raw;
      }catch{detail=raw;}
    }
  }catch{}
  detail=String(detail||response.statusText||"").replace(/\s+/g," ").trim();
  if(detail.length>420)detail=detail.slice(0,417)+"…";
  return Error(prefix+" (HTTP "+response.status+")"+(detail?": "+detail:"."));
}

function candidateText(result){
  return (result?.candidates?.[0]?.content?.parts||[]).map(part=>typeof part?.text==="string"?part.text:"").join("").trim();
}

function buildExternalPdfPackage(files){
  const names=files.map(file=>file.name);
  return [
    "ADMINERVA REFERENCE LIBRARY PDF EXTRACTION PACKAGE",
    "",
    "TASK",
    "Extract the educational content from the PDF files attached to this external-AI conversation. Adminerva will import your result into the same Reference Library records used by its built-in PDF importer.",
    "",
    "REQUIRED PROCESS",
    "1. Read every attached PDF listed under EXPECTED FILES.",
    "2. Extract ALL educational text. Use OCR/vision for scanned pages, images, graphics, diagrams, tables and labels.",
    "3. Preserve useful reading order, headings, lists, code, formulas and table text when possible.",
    "4. Do not summarize, grade, explain, add commentary, or omit content merely because it appears visually.",
    "5. Keep each title EXACTLY equal to its original filename.",
    "",
    "EXPECTED FILES",
    ...names.map(name=>"- "+name),
    "",
    "RETURN ONLY VALID JSON. NO MARKDOWN FENCES. NO INTRODUCTION.",
    '{"schemaVersion":1,"documents":[{"title":"EXACT ORIGINAL FILENAME.pdf","text":"FULL EXTRACTED EDUCATIONAL TEXT"}]}',
    "",
    "The documents array must contain exactly one entry for every EXPECTED FILE and no extra entries."
  ].join("\n");
}

function parseExternalPdfResult(raw,expectedFiles){
  let text=String(raw||"").trim();
  if(!text)throw Error("Paste the external AI JSON response first.");
  if(text.startsWith("```")){
    text=text.replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"").trim();
  }
  let parsed;
  try{parsed=JSON.parse(text);}catch{throw Error("The pasted response is not valid JSON. Ask the external AI to return only the required JSON object.");}
  if(Number(parsed?.schemaVersion)!==1||!Array.isArray(parsed?.documents))
    throw Error('The response must use {"schemaVersion":1,"documents":[...]}');
  const expected=expectedFiles.map(file=>file.name),expectedSet=new Set(expected);
  if(parsed.documents.length!==expected.length)
    throw Error("Expected "+expected.length+" document result"+(expected.length===1?"":"s")+" but received "+parsed.documents.length+".");
  const seen=new Set(),byTitle=new Map();
  for(const item of parsed.documents){
    const title=String(item?.title||"").trim(),body=String(item?.text||"").trim();
    if(!expectedSet.has(title))throw Error('Unexpected filename "'+title+'". Keep titles exactly equal to the selected PDF filenames.');
    if(seen.has(title))throw Error('Duplicate document result for "'+title+'".');
    if(!body)throw Error('No extracted text was returned for "'+title+'".');
    seen.add(title);byTitle.set(title,body);
  }
  for(const name of expected)if(!seen.has(name))throw Error('Missing extracted text for "'+name+'".');
  const normalized=expected.map(title=>({title,text:byTitle.get(title)}));
  for(const item of normalized)referenceRecord(item.title,item.text);
  return normalized;
}

// Clear only when reopening a chooser, so the same PDF can be selected to retry.
for(const id of ["pdfFileInput","externalPdfFileInput"]){
  document.getElementById(id)?.addEventListener("click",event=>{
    if(extractingPdf||externalPdfImport.busy){event.preventDefault();return;}
    event.currentTarget.value="";
  });
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
  const fileInput=document.getElementById("pdfFileInput");
  let files;
  try{files=validatePdfFiles(fileInput.files);}catch(error){alert(error.message);fileInput.value="";return;}

  const gemKey=(localStorage.getItem("Adminerva_gemini_token")||"").trim();
  const modelName=(localStorage.getItem("Adminerva_ai_model")||"gemini-2.5-flash").trim();
  if(!gemKey)return alert("Missing Gemini API Key. Please check your Global Settings.");

  const targetFolderId=activeFolderId;
  const folder=libraryData.find(item=>item.id===targetFolderId);
  if(!folder)return alert("Select a reference folder before importing PDFs.");

  let savedCount=0,completed=false;
  extractingPdf=true;fileInput.disabled=true;
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

  try{
    for(let index=0;index<files.length;index++){
      const file=files[index];
      if(index>0){
        window.showSubtleLoader?.("Preparing next PDF ("+(index+1)+"/"+files.length+")…");
        await delay(1500);
      }

      window.showSubtleLoader?.("Reading PDF ("+(index+1)+"/"+files.length+"): "+file.name);
      const pdfBase64=await fileToBase64(file);
      const generateUrl=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(gemKey)}`;

      let result=null,lastResponse=null;
      for(let attempt=0;attempt<4;attempt++){
        window.showSubtleLoader?.((attempt?"Retrying AI extraction":"Extracting educational content")+" ("+(index+1)+"/"+files.length+"): "+file.name);
        const response=await fetch(generateUrl,{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({
            contents:[{parts:[
              {text:PDF_EXTRACTION_INSTRUCTIONS},
              {inline_data:{mime_type:"application/pdf",data:pdfBase64}}
            ]}],
            generationConfig:{temperature:0}
          })
        });
        lastResponse=response;
        if(response.ok){result=await response.json();break;}
        if(response.status!==429&&response.status!==503)throw await providerError(response,"Adminerva AI could not extract "+file.name);
        if(attempt<3){
          const waitMs=Math.min(30000,4000*Math.pow(2,attempt))+Math.floor(Math.random()*1500);
          window.showSubtleLoader?.("AI provider is busy. Retrying "+file.name+"…");
          await delay(waitMs);
        }
      }
      if(!result)throw await providerError(lastResponse,"Adminerva AI remained unavailable for "+file.name);

      const extractedText=candidateText(result);
      if(!extractedText){
        const reason=result?.promptFeedback?.blockReason||result?.candidates?.[0]?.finishReason||"no text returned";
        throw Error("Adminerva AI could not extract "+file.name+" ("+reason+"). Use External AI to import the same PDF without changing the resulting reference.");
      }

      await saveReferenceRecord(targetFolderId,folder,file.name,extractedText);
      savedCount++;
      renderDocuments(folder.documents);
    }
    completed=true;
    libraryStatus("Imported "+savedCount+" PDF reference"+(savedCount===1?"":"s")+" with Adminerva AI.");
  }catch(error){
    const suffix=savedCount
      ?" "+savedCount+" completed reference"+(savedCount===1?" is":"s are")+" already saved; retry only the remaining PDFs."
      :" Your saved references are unchanged. You can use External AI with the same PDFs.";
    alert("PDF import stopped. "+error.message+suffix);
    libraryStatus("PDF import stopped: "+error.message,"error");
  }finally{
    extractingPdf=false;fileInput.disabled=false;
    if(completed)fileInput.value="";
    renderFolders();
    if(activeFolderId===targetFolderId)renderDocuments(folder.documents);
    window.hideSubtleLoader?.();
  }
};

window.prepareExternalPDFImport=function(){
  if(extractingPdf||externalPdfImport.busy)return;
  const input=document.getElementById("externalPdfFileInput");
  let files;
  try{files=validatePdfFiles(input.files);}catch(error){alert(error.message);input.value="";return;}
  const folder=libraryData.find(item=>item.id===activeFolderId);
  if(!folder)return alert("Select a reference folder before importing PDFs.");

  externalPdfImport.files=files;
  externalPdfImport.folderId=activeFolderId;
  document.getElementById("externalPdfSelection").textContent=
    files.length+" PDF"+(files.length===1?"":"s")+" selected · "+files.map(file=>file.name).join(" · ");
  document.getElementById("externalPdfPackage").value=buildExternalPdfPackage(files);
  document.getElementById("externalPdfResult").value="";
  externalPdfStatus("Attach these same PDFs to the external AI, paste the copied package, then return its JSON here.");
  document.getElementById("externalPdfModal").classList.remove("hidden");
};

window.closeExternalPDFImport=function(){
  if(externalPdfImport.busy)return;
  document.getElementById("externalPdfModal")?.classList.add("hidden");
};

window.copyExternalPDFPackage=async function(){
  const area=document.getElementById("externalPdfPackage"),value=area?.value||"";
  if(!value)return externalPdfStatus("Choose PDFs first.", "error");
  try{
    await navigator.clipboard.writeText(value);
    externalPdfStatus("Package copied. Attach the selected PDFs to ChatGPT or another AI, paste the package there, then paste its JSON response below.");
  }catch{
    area.focus();area.select();
    externalPdfStatus("Clipboard access was blocked. The package text is selected so you can copy it manually.","error");
  }
};

window.importExternalPDFResult=async function(){
  if(externalPdfImport.busy||extractingPdf)return;
  const files=externalPdfImport.files,folderId=externalPdfImport.folderId;
  if(!files.length||!folderId)return externalPdfStatus("Choose the PDFs again before importing.","error");
  if(activeFolderId!==folderId)return externalPdfStatus("The selected Reference Library folder changed. Close this dialog, return to the intended folder, and choose the PDFs again.","error");
  const folder=libraryData.find(item=>item.id===folderId);
  if(!folder)return externalPdfStatus("The target reference folder is no longer available.","error");

  let documents;
  try{documents=parseExternalPdfResult(document.getElementById("externalPdfResult").value,files);}
  catch(error){return externalPdfStatus("Import rejected: "+error.message,"error");}

  let savedCount=0;
  externalPdfImport.busy=true;extractingPdf=true;
  const importButton=document.getElementById("externalPdfImport"),copyButton=document.getElementById("externalPdfCopy");
  if(importButton)importButton.disabled=true;if(copyButton)copyButton.disabled=true;
  try{
    for(let index=0;index<documents.length;index++){
      const item=documents[index];
      externalPdfStatus("Saving reference "+(index+1)+" of "+documents.length+": "+item.title);
      await saveReferenceRecord(folderId,folder,item.title,item.text);
      savedCount++;
      renderDocuments(folder.documents);
    }
    libraryStatus("Imported "+savedCount+" PDF reference"+(savedCount===1?"":"s")+" with External AI.");
    externalPdfStatus("Imported successfully. These references are stored in the same format and location as Adminerva AI imports.");
    document.getElementById("externalPdfFileInput").value="";
    externalPdfImport.files=[];externalPdfImport.folderId=null;
    document.getElementById("externalPdfResult").value="";
    document.getElementById("externalPdfModal").classList.add("hidden");
  }catch(error){
    externalPdfStatus("Import stopped: "+error.message+(savedCount?" "+savedCount+" reference"+(savedCount===1?" was":"s were")+" already saved.":""),"error");
  }finally{
    externalPdfImport.busy=false;extractingPdf=false;
    if(importButton)importButton.disabled=false;if(copyButton)copyButton.disabled=false;
    renderFolders();
    if(activeFolderId===folderId)renderDocuments(folder.documents);
  }
};

document.getElementById("externalPdfModal")?.addEventListener("click",event=>{
  if(event.target?.id==="externalPdfModal"&&!externalPdfImport.busy)window.closeExternalPDFImport();
});
document.addEventListener("keydown",event=>{
  if(event.key==="Escape"&&!document.getElementById("externalPdfModal")?.classList.contains("hidden"))window.closeExternalPDFImport();
});
