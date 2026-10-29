import test from "node:test";
import assert from "node:assert/strict";
import {prepareProjectImport} from "./project-import.mjs";

const state={lang:"java",files:{"src/Main.java":"public class Main {}"},
  fileOrder:["src/Main.java"],activeFilename:"src/Main.java",folders:["src"],projectOrder:["src","src/Main.java"]};
const base={title:"Current Project",template:"java-blank",lang:"java",config:{database:false,runMode:"console"},
  database:{tables:{},history:[]},design:{},state,evidence:{runs:[]}};
const bundle={
  format:"adminerva-project-bundle",version:1,title:"Imported Example",lang:"java",template:"java-information",
  config:{database:true,runMode:"desktop"},database:{tables:{records:{
    columns:[{name:"id",type:"INTEGER",primaryKey:true},{name:"name",type:"TEXT"}],
    rows:[{id:1,name:"Ada"}]}},history:[]},design:{architecture:"flowchart LR\nA-->B"}
};
test("valid Code Studio bundle retains exact workspace, database rows and settings",()=>{
  const candidate=prepareProjectImport(base,state,bundle);
  assert.equal(candidate.lang,"java");
  assert.equal(candidate.title,"Imported Example");
  assert.equal(candidate.template,"java-information");
  assert.equal(candidate.database.tables.records.rows[0].name,"Ada");
  assert.equal(candidate.state.activeFilename,"src/Main.java");
  assert.equal(base.config.database,false,"base project must not be modified");
});
test("plain ZIP files import without overwriting existing project metadata",()=>{
  const candidate=prepareProjectImport(base,state,null);
  assert.equal(candidate.title,"Current Project");
  assert.deepEqual(candidate.database,{tables:{},history:[]});
});
test("reject invalid source or bundle language before any save",()=>{
  assert.throws(()=>prepareProjectImport(base,{...state,fileOrder:["other.java"]},bundle),/invalid or incomplete/i);
  assert.throws(()=>prepareProjectImport(base,state,{...bundle,lang:"python"}),/language/i);
  assert.throws(()=>prepareProjectImport(base,state,{...bundle,template:"web"}),/template/i);
  assert.throws(()=>prepareProjectImport(base,state,{...bundle,version:2}),/version/i);
  assert.throws(()=>prepareProjectImport(base,state,{...bundle,config:[]}),/metadata/i);
});
test("respect guest limits for files, project size, and database tables/rows",()=>{
  assert.throws(()=>prepareProjectImport(base,state,bundle,{maxFiles:0}),/more files/i);
  assert.throws(()=>prepareProjectImport(base,state,bundle,{maxProjectBytes:32}),/size limit/i);
  assert.throws(()=>prepareProjectImport(base,state,bundle,{maxDbTables:0}),/too many tables/i);
  assert.throws(()=>prepareProjectImport(base,state,bundle,{maxDbRowsPerTable:0}),/row limit/i);
});
test("reject malformed database structures and duplicate column definitions",()=>{
  const bad={...bundle,database:{tables:{records:{
    columns:[{name:"id",type:"INTEGER"},{name:"id",type:"TEXT"}],rows:[]}},history:[]}};
  assert.throws(()=>prepareProjectImport(base,state,bad),/column definition/i);
  const broken={...bundle,database:{tables:{records:{columns:[],rows:["not a row"]}}}};
  assert.throws(()=>prepareProjectImport(base,state,broken),/invalid row/i);
});
