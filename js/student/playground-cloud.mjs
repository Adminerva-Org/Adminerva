/** Student submissions, practice progress and isolated code workspaces: playground cloud. */
import {auth,db} from "../core/firebase-core.js?v=1.3.0";
import {addDoc,collection,getDocs,query,orderBy,limit,serverTimestamp,updateDoc,deleteDoc}
  from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

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
      modal=document.createElement("div");modal.id="playgroundVersionsModal";
      modal.className="fixed inset-0 z-[260] bg-slate-950/80 p-3 flex items-center justify-center";
      modal.setAttribute("role","dialog");modal.setAttribute("aria-modal","true");
      const panel=document.createElement("div");panel.className="bg-white rounded-xl max-w-lg w-full p-5 max-h-[85dvh] overflow-y-auto";
      const header=document.createElement("div");header.className="flex items-center justify-between mb-4";
      const title=document.createElement("h2");title.className="font-bold text-slate-900";title.textContent="Private cloud versions";
      const close=document.createElement("button");close.textContent="Close";close.className="px-3 py-2 bg-slate-100 rounded-lg text-slate-800 font-bold";
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
      const row=document.createElement("div");row.className="p-3 border rounded-lg flex flex-col sm:flex-row justify-between gap-3 sm:items-center";
      const info=document.createElement("div");info.className="min-w-0";
      const name=document.createElement("p");name.className="text-sm font-bold text-slate-800 truncate";name.textContent=String(state.label||"Cloud version");
      const detail=document.createElement("p");detail.className="text-xs text-slate-500 mt-1";
      detail.textContent=(state.savedAt?.toDate?.()?.toLocaleString()||"Saved recently")+" · "+Object.keys(state.files||{}).length+" files";
      info.append(name,detail);
      const actions=document.createElement("div");actions.className="flex flex-wrap gap-2 shrink-0";
      const open=document.createElement("button");open.className="bg-blue-600 text-white font-bold text-xs px-3 py-2 rounded-lg";open.textContent="Restore";
      open.addEventListener("click",()=>{
        if(!confirm("Restore this version? Your current editor files will be replaced."))return;
        if(!window.adminervaRestorePlayground?.(state))return alert("Could not back up current files. Export ZIP first.");
        modal.classList.add("hidden");
      });
      const rename=document.createElement("button");rename.className="bg-slate-100 text-slate-800 font-bold text-xs px-3 py-2 rounded-lg";rename.textContent="Rename";
      rename.addEventListener("click",async()=>{
        const next=prompt("Version name (up to 80 characters):",String(state.label||""));if(next===null)return;
        const label=next.trim();if(!label||label.length>80)return alert("Enter a version name from 1 to 80 characters.");
        rename.disabled=true;
        try{await updateDoc(record.ref,{label,renamedAt:serverTimestamp()});state.label=label;name.textContent=label;}
        catch(error){alert("Rename failed: "+error.message)}finally{rename.disabled=false}
      });
      const remove=document.createElement("button");remove.className="bg-rose-50 text-rose-800 border border-rose-200 font-bold text-xs px-3 py-2 rounded-lg";remove.textContent="Delete";
      remove.addEventListener("click",async()=>{
        if(!confirm("Delete this cloud version permanently? This does not delete your current device draft."))return;
        remove.disabled=true;
        try{await deleteDoc(record.ref);row.remove();if(!list.children.length)list.textContent="No cloud versions yet. Select Save Cloud to create one.";}
        catch(error){remove.disabled=false;alert("Delete failed: "+error.message)}
      });
      actions.append(open,rename,remove);row.append(info,actions);list.append(row);
    });
  }catch(error){alert("Cloud versions unavailable: "+error.message)}
  finally{button.disabled=false;button.textContent="Cloud Versions"}
}
el("cloudSaveProjectBtn")?.addEventListener("click",()=>void save());
el("cloudLoadProjectBtn")?.addEventListener("click",()=>void versions());
