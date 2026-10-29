/** Validate an imported Code Studio workspace before any local project is replaced. */
import {validPlaygroundState} from "./playground-storage.mjs?v=1.3.0";
import {CODE_PROJECT_TEMPLATES} from "./code-projects.mjs?v=2.0.0";

const copy=value=>JSON.parse(JSON.stringify(value));
const plain=value=>value&&typeof value==="object"&&!Array.isArray(value);
export function prepareProjectImport(base,state,bundle,{maxFiles=100,maxProjectBytes=780000,maxDbTables=50,maxDbRowsPerTable=5000}={}){
  if(!validPlaygroundState(state)||!Object.hasOwn(state.files,state.activeFilename))
    throw Error("This ZIP contains an invalid or incomplete code workspace.");
  if(Object.keys(state.files).length>maxFiles)throw Error("The ZIP has more files than this project tier supports.");
  if(bundle!=null){
    if(!plain(bundle)||bundle.format!=="adminerva-project-bundle"||bundle.version!==1)
      throw Error("Unsupported Adminerva project bundle version.");
    if(bundle.lang!==state.lang)throw Error("Bundle language and imported source language do not match.");
    if(bundle.template!=null&&(!Object.hasOwn(CODE_PROJECT_TEMPLATES,bundle.template)||
      (["java","python","web"].includes(state.lang)&&
       CODE_PROJECT_TEMPLATES[bundle.template].lang!==state.lang)))
      throw Error("Bundle template is unavailable or does not match the imported language.");
    for(const key of ["config","database","design"])
      if(bundle[key]!=null&&!plain(bundle[key]))throw Error("Invalid bundle "+key+" metadata.");
  }
  const next=copy({...base,state});
  next.lang=state.lang;
  if(bundle){
    if(typeof bundle.title==="string"&&bundle.title.trim())next.title=bundle.title.trim().slice(0,120);
    if(bundle.template)next.template=bundle.template;
    if(bundle.config)next.config={...(next.config||{}),...copy(bundle.config)};
    if(bundle.database)next.database=copy(bundle.database);
    if(bundle.design)next.design=copy(bundle.design);
  }
  const tables=next.database?.tables||{};
  if(!plain(tables))throw Error("Invalid database tables in imported bundle.");
  if(Object.keys(tables).length>maxDbTables)throw Error("The imported database has too many tables.");
  for(const [name,table] of Object.entries(tables)){
    if(!/^[A-Za-z_]\w*$/.test(name)||["__proto__","prototype","constructor"].includes(name)||
      !plain(table)||!Array.isArray(table.columns)||!Array.isArray(table.rows))
      throw Error("The imported database contains an invalid table.");
    if(table.rows.length>maxDbRowsPerTable)
      throw Error("The imported table exceeds this project's row limit.");
    const names=table.columns.map(column=>column?.name);
    if(names.some(name=>typeof name!=="string"||!/^[A-Za-z_]\w*$/.test(name))||
      new Set(names).size!==names.length||table.columns.filter(column=>column.primaryKey).length>1)
      throw Error("The imported database has an invalid column definition.");
    if(table.rows.some(row=>!plain(row)))
      throw Error("The imported database contains an invalid row.");
  }
  if(new TextEncoder().encode(JSON.stringify(next)).length>maxProjectBytes)
    throw Error("The imported project exceeds the local size limit.");
  return next;
}
