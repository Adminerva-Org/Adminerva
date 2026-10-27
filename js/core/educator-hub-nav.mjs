/** The shared top navigation now owns educator task navigation. */
const root=document.querySelector("[data-educator-hub-nav]");
if(root){
  const layout=root.closest(".av-educator-layout");
  root.remove();
  layout?.classList.add("av-educator-layout--single");
}
