/** Switch the combined teacher analytics workspace without creating separate pages. */
const buttons=[...document.querySelectorAll("[data-analytics-tab]")];
const panels=[...document.querySelectorAll("[data-analytics-panel]")];
function select(name,{updateHash=true}={}){
  const target=panels.some(panel=>panel.dataset.analyticsPanel===name)?name:"academic";
  for(const button of buttons){
    const active=button.dataset.analyticsTab===target;
    button.setAttribute("aria-selected",String(active));
    button.tabIndex=active?0:-1;
  }
  for(const panel of panels)panel.hidden=panel.dataset.analyticsPanel!==target;
  if(updateHash){
    const next=target==="academic"?"#class":"#practice";
    if(location.hash!==next)history.replaceState(null,"",next);
  }
}
for(const button of buttons)button.addEventListener("click",()=>select(button.dataset.analyticsTab));
window.addEventListener("hashchange",()=>select(location.hash==="#practice"?"practice":"academic",{updateHash:false}));
select(location.hash==="#practice"?"practice":"academic",{updateHash:false});