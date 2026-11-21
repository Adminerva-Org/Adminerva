/** Small, accessible interaction primitives. Free-play only; not scoring authority. */
export function moveItem(a,from,to){
  if(!Array.isArray(a)||![from,to].every(Number.isInteger)||from<0||to<0||from>=a.length||to>=a.length||from===to)return false;
  const [value]=a.splice(from,1);a.splice(to,0,value);return true;
}
export function swapItems(a,from,to){
  if(!Array.isArray(a)||![from,to].every(Number.isInteger)||from<0||to<0||from>=a.length||to>=a.length||from===to)return false;
  [a[from],a[to]]=[a[to],a[from]];return true;
}
export function enableArcadeDrag(host,{onDrop,isLocked=()=>false,allowButtons=false}={}){
  let from=null;
  const item=target=>target?.closest?.("[data-arcade-item]");
  const clear=()=>{from=null;for(const n of host.querySelectorAll("[data-arcade-item]"))n.classList.remove("arcade-dragging","arcade-drop-target");};
  host.addEventListener("dragstart",event=>{
    const n=item(event.target);
    if(!n||!host.contains(n)||isLocked()||(!allowButtons&&event.target.closest("button"))){event.preventDefault();return;}
    from=Number(n.dataset.arcadeItem);
    if(!Number.isInteger(from)){event.preventDefault();clear();return;}
    event.dataTransfer?.setData("text/plain",String(from));
    if(event.dataTransfer)event.dataTransfer.effectAllowed="move";
    n.classList.add("arcade-dragging");
  });
  host.addEventListener("dragover",event=>{
    const n=item(event.target);
    if(from===null||!n||!host.contains(n)||isLocked())return;
    event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect="move";
    for(const node of host.querySelectorAll(".arcade-drop-target"))node.classList.remove("arcade-drop-target");
    n.classList.add("arcade-drop-target");
  });
  host.addEventListener("drop",event=>{
    const n=item(event.target),to=Number(n?.dataset.arcadeItem),previous=from;
    if(previous===null||!n||!host.contains(n)||isLocked()||!Number.isInteger(to)){clear();return;}
    event.preventDefault();clear();onDrop?.(previous,to);
  });
  host.addEventListener("dragend",clear);
  return clear;
}
