import { db } from "../core/firebase-core.js";
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

let libraryData = [];
let activeFolderId = null;

function escapeHTML(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

document.addEventListener("DOMContentLoaded", () => {
  initFirebase();
});

function initFirebase() {
  loadLibrary();
}

async function loadLibrary() {
  try {
    const snap = await getDocs(collection(db, "reference_folders"));
    libraryData = [];

    snap.forEach((docSnap) => {
      libraryData.push({ id: docSnap.id, ...docSnap.data() });
    });

    libraryData.sort((a, b) => a.name.localeCompare(b.name));
    localStorage.setItem("Adminerva_library", JSON.stringify(libraryData));

    renderFolders();
    if (activeFolderId && libraryData.find((f) => f.id === activeFolderId)) {
      selectFolder(activeFolderId);
    }
  } catch (e) {
    console.error("Error loading library:", e);
  }
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
    const docRef = await addDoc(collection(db, "reference_folders"), {
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
    localStorage.setItem("Adminerva_library", JSON.stringify(libraryData));

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
  const newName = prompt("Enter new folder name:", folder.name);
  if (!newName || newName.trim() === folder.name) return;

  try {
    await updateDoc(doc(db, "reference_folders", folderId), {
      name: newName.trim(),
      updatedAt: new Date().toISOString(),
    });
    folder.name = newName.trim();
    libraryData.sort((a, b) => a.name.localeCompare(b.name));
    localStorage.setItem("Adminerva_library", JSON.stringify(libraryData));
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
    await deleteDoc(doc(db, "reference_folders", folderId));
    libraryData = libraryData.filter((f) => f.id !== folderId);
    localStorage.setItem("Adminerva_library", JSON.stringify(libraryData));

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

window.selectFolder = function (folderId) {
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
  }
};

window.filterDocuments = function () {
  const query = document.getElementById("searchInput").value.toLowerCase();
  const folder = libraryData.find((f) => f.id === activeFolderId);
  if (!folder) return;

  const filteredDocs = folder.documents.filter(
    (doc) =>
      doc.title.toLowerCase().includes(query) ||
      doc.text.toLowerCase().includes(query),
  );
  renderDocuments(filteredDocs);
};

window.renameDocument = async function (docIndex) {
  const folder = libraryData.find((f) => f.id === activeFolderId);
  if (!folder) return;

  const oldTitle = folder.documents[docIndex].title;
  const newTitle = prompt("Enter new document name:", oldTitle);
  if (!newTitle || newTitle.trim() === oldTitle) return;

  const updatedDocs = [...folder.documents];
  updatedDocs[docIndex].title = newTitle.trim();
  updatedDocs[docIndex].updatedAt = new Date().toISOString();

  try {
    await updateDoc(doc(db, "reference_folders", activeFolderId), {
      documents: updatedDocs,
    });
    folder.documents = updatedDocs;
    localStorage.setItem("Adminerva_library", JSON.stringify(libraryData));
    renderDocuments(folder.documents);
  } catch (e) {
    alert("Error renaming document: " + e.message);
  }
};

window.deleteDocument = async function (docIndex) {
  if (!confirm("Are you sure you want to delete this document?")) return;
  const folder = libraryData.find((f) => f.id === activeFolderId);

  const updatedDocs = [...folder.documents];
  updatedDocs.splice(docIndex, 1);

  try {
    await updateDoc(doc(db, "reference_folders", activeFolderId), {
      documents: updatedDocs,
    });
    folder.documents = updatedDocs;
    localStorage.setItem("Adminerva_library", JSON.stringify(libraryData));
    renderDocuments(folder.documents);
  } catch (e) {
    alert("Error deleting document: " + e.message);
  }
};

window.previewDocumentText = function (folderId, docIndex) {
  const folder = libraryData.find((f) => f.id === folderId);
  if (folder && folder.documents[docIndex]) {
    alert(
      "PREVIEW:\n\n" +
        folder.documents[docIndex].text.substring(0, 500) +
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

    docList.insertAdjacentHTML(
      "beforeend",
      `
            <div class="group grid grid-cols-12 gap-4 px-6 py-4 border-b hover:bg-gray-50 items-center transition">
                <div class="col-span-6 flex items-center gap-3 truncate">
                    <span class="text-xl">📄</span>
                    <div class="truncate">
                        <p class="font-semibold text-gray-800 text-sm truncate cursor-pointer hover:text-blue-600" onclick="window.previewDocumentText('${safeFolderId}', ${index})">${safeTitle}</p>
                    </div>
                </div>
                <div class="col-span-4 text-sm text-gray-500">
                    ${safeDate}
                </div>
                <div class="col-span-2 text-right flex justify-end gap-3 group-hover-show">
                    <button onclick="renameDocument(${index})" class="text-gray-400 hover:text-blue-600" title="Rename">✏️</button>
                    <button onclick="deleteDocument(${index})" class="text-gray-400 hover:text-red-600" title="Delete">🗑️</button>
                </div>
            </div>
        `,
    );
  });
}

window.extractPDF = async function () {
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
  let updatedDocs = [...(folder.documents || [])];

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

      // 2. POLL SERVER UNTIL OCR IS COMPLETE
      let isProcessing = true;
      let activeFileUri = fileInfo.uri;

      while (isProcessing) {
        if (typeof window.showSubtleLoader === "function") {
          window.showSubtleLoader(
            `Analyzing visual diagrams and OCR for ${file.name}...`,
          );
        }

        const checkUrl = `https://generativelanguage.googleapis.com/v1beta/${fileInfo.name}?key=${encodeURIComponent(gemKey)}`;
        const checkRes = await fetch(checkUrl);
        const checkData = await checkRes.json();

        if (checkData.state === "ACTIVE") {
          isProcessing = false;
        } else if (checkData.state === "FAILED") {
          throw new Error(
            `Google failed to process the visuals inside ${file.name}.`,
          );
        } else {
          await delay(3000);
        }
      }

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

      updatedDocs.push({
        title: file.name,
        text: extractedText,
        updatedAt: new Date().toISOString(),
      });

      // 4. INSTANT CLEANUP
      fetch(
        `https://generativelanguage.googleapis.com/v1beta/${fileInfo.name}?key=${encodeURIComponent(gemKey)}`,
        { method: "DELETE" },
      ).catch(() => {});
    }

    await updateDoc(doc(db, "reference_folders", targetFolderId), {
      documents: updatedDocs,
      updatedAt: new Date().toISOString(),
    });

    folder.documents = updatedDocs;
    localStorage.setItem("Adminerva_library", JSON.stringify(libraryData));
  } catch (error) {
    alert("Bulk extraction stopped. Error: " + error.message);
  } finally {
    fileInput.value = "";
    renderFolders();

    if (activeFolderId === targetFolderId) {
      renderDocuments(folder.documents);
    }

    if (typeof window.hideSubtleLoader === "function") {
      window.hideSubtleLoader();
    }
  }
};
