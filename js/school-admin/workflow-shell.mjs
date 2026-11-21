const items=[
  {key:"overview",label:"Overview",href:"school-admin.html",group:"setup"},
  {key:"profile",label:"Profile",href:"school-profile.html",group:"setup"},
  {key:"academics",label:"Academics",href:"school-academic-configuration.html",group:"setup"},
  {key:"people",label:"People",href:"people-access.html",group:"setup"},
  {key:"classes",label:"Classes",href:"school-classes.html",group:"operate"},
  {key:"enrollment",label:"Enrollment",href:"school-enrollment.html",group:"operate"},
  {key:"student-records",label:"Student Records",href:"school-student-records.html",group:"operate"},
  {key:"grading",label:"Grading",href:"school-grading-schemes.html",group:"operate"},
  {key:"attendance",label:"Attendance",href:"school-attendance.html",group:"monitor"},
  {key:"records",label:"Records",href:"school-class-records.html",group:"monitor"}
];
const aliases={
  "school-admin.html":"overview",
  "school-profile.html":"profile",
  "school-academic-configuration.html":"academics",
  "school-academic-structure.html":"academics",
  "people-access.html":"people",
  "school-classes.html":"classes",
  "school-enrollment.html":"enrollment",
  "school-student-records.html":"student-records",
  "school-grading-schemes.html":"grading",
  "school-attendance.html":"attendance",
  "school-class-records.html":"records"
};
function contextualHref(href){
  const current=new URL(location.href),target=new URL(href,location.href),schoolId=current.searchParams.get("schoolId");
  if(schoolId&&!target.searchParams.has("schoolId"))target.searchParams.set("schoolId",schoolId);
  return target.pathname.split("/").pop()+target.search+target.hash;
}
function render(){
  if(document.querySelector("[data-school-admin-workflow]"))return;
  const anchor=document.getElementById("adminerva-nav");if(!anchor)return;
  const file=location.pathname.split("/").pop()||"school-admin.html",active=aliases[file]||"overview";
  const shell=document.createElement("div");shell.className="saw-shell";shell.dataset.schoolAdminWorkflow="";
  const nav=document.createElement("nav");nav.className="saw-nav";nav.setAttribute("aria-label","School administration workflow");
  const head=document.createElement("div");head.className="saw-head";
  const title=document.createElement("strong");title.textContent="School administration workflow";
  const hint=document.createElement("span");hint.textContent="Set up → operate → monitor";
  head.append(title,hint);
  const list=document.createElement("div");list.className="saw-list";
  let lastGroup="";
  items.forEach((item,index)=>{
    if(lastGroup&&lastGroup!==item.group){const divider=document.createElement("span");divider.className="saw-divider";divider.setAttribute("aria-hidden","true");list.append(divider);}
    lastGroup=item.group;
    const link=document.createElement("a");link.className="saw-step";link.href=contextualHref(item.href);
    if(item.key===active)link.setAttribute("aria-current","page");
    const num=document.createElement("span");num.className="saw-number";num.textContent=String(index+1);
    const label=document.createElement("span");label.textContent=item.label;
    link.append(num,label);list.append(link);
  });
  nav.append(head,list);shell.append(nav);anchor.insertAdjacentElement("afterend",shell);
  list.querySelector('[aria-current="page"]')?.scrollIntoView({block:"nearest",inline:"center"});
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",render,{once:true});else render();