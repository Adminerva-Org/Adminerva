/** Student submissions, practice progress and isolated code workspaces: playground cloud. */
import {auth,db} from "../core/firebase-core.js?v=1.3.0";
import {addDoc,collection,getDocs,query,where,orderBy,limit,serverTimestamp,updateDoc,deleteDoc}
  from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const el=id=>document.getElementById(id);
const displayTime=state=>state.savedAt?.toDate?.()?.toLocaleString()||"Saved recently";
async function save(){
  const button=el("cloudSaveProjectBtn"),user=auth.currentUser;
  if(!user)return alert("Sign in to save your workspace.");
  const normal=button.textContent;
  const entered=prompt("Name this cloud version (optional, up to 80 characters):","");
  if(entered===null)return;
  const label=entered.trim();
  if(label.length>80)return alert("Use up to 80 characters for the version name.");
  button.disabled=true;button.textContent="Saving…";
  try{
    const state=window.adminervaPlaygroundState?.();
    if(!state)throw Error("Editor is still loading.");
    if(new TextEncoder().encode(JSON.stringify(state)).length>700000)
      throw Error("This workspace is too large for a Firestore version. Export a ZIP.");
    const payload={...state,ownerUid:user.uid,savedAt:serverTimestamp(),pinned:false};
    if(label)payload.label=label;
    await addDoc(collection(db,"student_playground_workspaces",user.uid,"versions"),payload);
    button.textContent="Cloud saved";
    setTimeout(()=>{button.textContent=normal},1800);
  }catch(error){button.textContent=normal;alert("Cloud backup failed: "+error.message)}
  finally{button.disabled=false}
}
async function versions(){
  const user=auth.currentUser,button=el("cloudLoadProjectBtn");
  if(!user)return alert("Sign in to view cloud versions.");
  const normal=button.textContent;
  button.disabled=true;button.textContent="Loading…";
  try{
    const versionsRef=collection(db,"student_playground_workspaces",user.uid,"versions");
    const [recentSnap,pinnedSnap]=await Promise.all([
      getDocs(query(versionsRef,orderBy("savedAt","desc"),limit(30))),
      getDocs(query(versionsRef,where("pinned","==",true),limit(30)))
    ]);
    const recordsById=new Map();
    for(const record of [...recentSnap.docs,...pinnedSnap.docs])recordsById.set(record.id,record);
    let modal=el("playgroundVersionsModal");
    if(!modal){
      modal=document.createElement("div");modal.id="playgroundVersionsModal";
      modal.className="fixed inset-0 z-[260] bg-slate-950/80 p-3 flex items-center justify-center";
      modal.setAttribute("role","dialog");modal.setAttribute("aria-modal","true");
      const panel=document.createElement("div");panel.className="bg-white rounded-xl max-w-2xl w-full p-5 max-h-[85dvh] overflow-y-auto";
      const header=document.createElement("div");header.className="flex items-start justify-between gap-4 mb-4";
      const heading=document.createElement("div");
      const title=document.createElement("h2");title.className="font-bold text-slate-900";title.textContent="Private cloud versions";
      const hint=document.createElement("p");hint.className="text-xs text-slate-500 mt-1";
      hint.textContent="Pinned versions stay at the top. Restore does not delete the saved cloud copy.";
      heading.append(title,hint);
      const close=document.createElement("button");close.textContent="Close";close.className="px-3 py-2 bg-slate-100 rounded-lg text-slate-800 font-bold";
      close.addEventListener("click",()=>modal.classList.add("hidden"));
      header.append(heading,close);
      const list=document.createElement("div");list.id="cloudVersionList";list.className="space-y-2";
      panel.append(header,list);modal.append(panel);document.body.append(modal);
    }
    modal.classList.remove("hidden");
    const list=modal.querySelector("#cloudVersionList");list.replaceChildren();
    if(!recordsById.size)list.textContent="No cloud versions yet. Select Save cloud version to create one.";
    const records=[...recordsById.values()].sort((a,b)=>{
      const pin=Number(Boolean(b.data().pinned))-Number(Boolean(a.data().pinned));
      if(pin)return pin;
      return (b.data().savedAt?.toMillis?.()||0)-(a.data().savedAt?.toMillis?.()||0);
    });
    records.forEach(record=>{
      const state=record.data(),saved=displayTime(state);
      const row=document.createElement("div");
      row.className="p-3 border rounded-lg flex flex-col sm:flex-row justify-between gap-3 sm:items-center"+(state.pinned?" border-amber-300 bg-amber-50/50":"");
      const info=document.createElement("div");info.className="min-w-0";
      const name=document.createElement("p");name.className="text-sm font-bold text-slate-800 truncate";
      name.textContent=String(state.label||saved);
      const detail=document.createElement("p");detail.className="text-xs text-slate-500 mt-1";
      detail.textContent=(state.label?saved+" · ":"")+Object.keys(state.files||{}).length+" files · "+String(state.lang||"workspace");
      info.append(name,detail);
      const actions=document.createElement("div");actions.className="flex flex-wrap gap-2 shrink-0";
      const open=document.createElement("button");open.className="bg-blue-600 text-white font-bold text-xs px-3 py-2 rounded-lg";open.textContent="Restore";
      open.addEventListener("click",()=>{
        if(!confirm("Restore this version? Your current editor files will be replaced."))return;
        if(!window.adminervaRestorePlayground?.(state))return alert("Could not back up current files. Export ZIP first.");
        modal.classList.add("hidden");
      });
      const pin=document.createElement("button");
      pin.className="bg-amber-50 text-amber-900 border border-amber-200 font-bold text-xs px-3 py-2 rounded-lg";
      pin.textContent=state.pinned?"Unpin":"Pin";
      pin.addEventListener("click",async()=>{
        pin.disabled=true;
        try{
          await updateDoc(record.ref,{pinned:!Boolean(state.pinned),pinChangedAt:serverTimestamp()});
          await versions();
        }catch(error){alert("Pin update failed: "+error.message)}
        finally{pin.disabled=false}
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
        try{await deleteDoc(record.ref);row.remove();if(!list.children.length)list.textContent="No cloud versions yet. Select Save cloud version to create one.";}
        catch(error){remove.disabled=false;alert("Delete failed: "+error.message)}
      });
      actions.append(open,pin,rename,remove);row.append(info,actions);list.append(row);
    });
  }catch(error){alert("Cloud versions unavailable: "+error.message)}
  finally{button.disabled=false;button.textContent=normal}
}
el("cloudSaveProjectBtn")?.addEventListener("click",()=>void save());
el("cloudLoadProjectBtn")?.addEventListener("click",()=>void versions());
