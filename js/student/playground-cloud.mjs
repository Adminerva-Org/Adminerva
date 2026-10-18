/** Student submissions, practice progress and isolated code workspaces: playground cloud. */
import {auth,db} from "../core/firebase-core.js";
import {addDoc,collection,getDocs,query,orderBy,limit,serverTimestamp}
  from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// Explicit private backups, never a network write per keystroke.
const el=id=>document.getElementById(id);
async function save(){
  const button=el("cloudSaveProjectBtn"),user=auth.currentUser;
  if(!user)return alert("Sign in to save your workspace.");
  button.disabled=true;button.textContent="Saving…";
  try{
    const state=window.adminervaPlaygroundState?.();
    if(!state)throw Error("Editor is still loading.");
    if(new TextEncoder().encode(JSON.stringify(state)).length>700000)
      throw Error("This workspace is too large for a Firestore version. Export a ZIP.");
    await addDoc(collection(db,"student_playground_workspaces",user.uid,"versions"),
      {...state,ownerUid:user.uid,savedAt:serverTimestamp()});
    button.textContent="Cloud saved";
    setTimeout(()=>{button.textContent="Save Cloud"},1800);
  }catch(error){button.textContent="Save Cloud";alert("Cloud backup failed: "+error.message)}
  finally{button.disabled=false}
}
async function versions(){
  const user=auth.currentUser,button=el("cloudLoadProjectBtn");
  if(!user)return alert("Sign in to view cloud versions.");
  button.disabled=true;button.textContent="Loading…";
  try{
    const snap=await getDocs(query(
      collection(db,"student_playground_workspaces",user.uid,"versions"),
      orderBy("savedAt","desc"),limit(15)
    ));
    let modal=el("playgroundVersionsModal");
    if(!modal){
      modal=document.createElement("div");
      modal.id="playgroundVersionsModal";
      modal.className="fixed inset-0 z-[260] bg-slate-950/80 p-3 flex items-center justify-center";
      modal.setAttribute("role","dialog");modal.setAttribute("aria-modal","true");
      const panel=document.createElement("div");
      panel.className="bg-white rounded-xl max-w-lg w-full p-5 max-h-[85dvh] overflow-y-auto";
      const header=document.createElement("div");
      header.className="flex items-center justify-between mb-4";
      const title=document.createElement("h2");
      title.className="font-bold text-slate-900";title.textContent="Private cloud versions";
      const close=document.createElement("button");
      close.textContent="Close";close.className="px-3 py-2 bg-slate-100 rounded-lg text-slate-800 font-bold";
      close.addEventListener("click",()=>modal.classList.add("hidden"));
      header.append(title,close);
      const list=document.createElement("div");list.id="cloudVersionList";list.className="space-y-2";
      panel.append(header,list);modal.append(panel);document.body.append(modal);
    }
    modal.classList.remove("hidden");
    const list=modal.querySelector("#cloudVersionList");list.replaceChildren();
    if(snap.empty)list.textContent="No cloud versions yet. Select Save Cloud to create one.";
    snap.forEach(record=>{
      const state=record.data();
      const row=document.createElement("div");
      row.className="p-3 border rounded-lg flex justify-between gap-3 items-center";
      const label=document.createElement("p");
      label.className="text-sm text-slate-700";
      label.textContent=(state.savedAt?.toDate?.()?.toLocaleString()||"Saved recently")+
        " · "+Object.keys(state.files||{}).length+" files";
      const open=document.createElement("button");
      open.className="shrink-0 bg-blue-600 text-white font-bold text-sm px-3 py-2 rounded-lg";
      open.textContent="Restore";
      open.addEventListener("click",()=>{
        if(!confirm("Restore this version? Your current editor files will be replaced."))return;
        if(!window.adminervaRestorePlayground?.(state))
          return alert("Could not back up current files. Export ZIP first.");
        modal.classList.add("hidden");
      });
      row.append(label,open);list.append(row);
    });
  }catch(error){alert("Cloud versions unavailable: "+error.message)}
  finally{button.disabled=false;button.textContent="Cloud Versions"}
}
el("cloudSaveProjectBtn")?.addEventListener("click",()=>void save());
el("cloudLoadProjectBtn")?.addEventListener("click",()=>void versions());
