import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {
  PLAYGROUND_LANGUAGES,playgroundWorkspaceKey,playgroundLanguageKey,
  playgroundUndoKey,validPlaygroundState,readPlaygroundDraft
} from "./playground-storage.mjs";
const source=fs.readFileSync("js/student/playground.js","utf8");

const sample=(lang="java",file="Main.java",code="class Main{}")=>({
  lang,files:{[file]:code},fileOrder:[file],activeFilename:file
});
function storage(initial={}) {
  const map=new Map(Object.entries(initial));
  return {
    getItem:key=>map.has(key)?map.get(key):null,
    setItem:(key,v)=>map.set(key,String(v)),
    removeItem:key=>map.delete(key),
    map
  };
}
test("local drafts are separated by Firebase uid and programming language",()=>{
  const a=playgroundWorkspaceKey("alice","java");
  const b=playgroundWorkspaceKey("bob","java");
  const python=playgroundWorkspaceKey("alice","python");
  assert.notEqual(a,b);
  assert.notEqual(a,python);
  assert.notEqual(playgroundLanguageKey("alice"),playgroundLanguageKey("bob"));
  assert.notEqual(playgroundUndoKey("alice","java"),a);
  assert.throws(()=>playgroundWorkspaceKey("","java"));
  assert.throws(()=>playgroundWorkspaceKey("alice","unsafe"));
  assert.equal(PLAYGROUND_LANGUAGES.length,6);
});
test("saved files and tab order are verified before loading",()=>{
  const draft=sample();
  assert.equal(validPlaygroundState(draft),true);
  for(const bad of [
    null,{}, {lang:"java",files:[],fileOrder:[]},
    {...draft,fileOrder:["other.java"]},
    {...draft,fileOrder:["Main.java","Main.java"]},
    {...draft,files:{"Main.java":123}},
    {...draft,lang:"ruby"}
  ]) assert.equal(validPlaygroundState(bad),false);
  const store=storage({[playgroundWorkspaceKey("alice","java")]:JSON.stringify(draft)});
  assert.deepEqual(readPlaygroundDraft(store,"alice","java"),draft);
  assert.equal(readPlaygroundDraft(store,"bob","java"),null);
  assert.equal(readPlaygroundDraft(store,"alice","python"),null);
  store.setItem(playgroundWorkspaceKey("alice","java"),"{broken");
  assert.equal(readPlaygroundDraft(store,"alice","java"),null);
});
test("local autosave writes only to the active student's scoped key",()=>{
  const a=source.indexOf("let autoSaveTimeout;");
  const b=source.indexOf("async function exportZIP()",a);
  assert.ok(a>0 && b>a);
  const store=storage({"Adminerva_Playground_Workspace":JSON.stringify(sample("java","old.java","OLD"))});
  const created=[];
  const context={
    auth:{currentUser:{uid:"alice"}},
    localStorage:store,
    window:{addEventListener(){},},
    document:{getElementById:()=>null},
    workspaceFiles:{"Main.java":{model:{getValue:()=>"new code"}}},
    currentLang:"java",fileOrder:["Main.java"],activeFilename:"Main.java",
    playgroundWorkspaceKey,playgroundLanguageKey,playgroundUndoKey,
    readPlaygroundDraft,validPlaygroundState,PLAYGROUND_LANGUAGES,
    createWorkspace:(...args)=>created.push(args),
    Date,JSON,console,clearTimeout(){},setTimeout(){return 10},
    alert(){},confirm:()=>true
  };
  vm.runInNewContext(source.slice(a,b),context);
  assert.equal(vm.runInNewContext("persistWorkspace()",context),true);
  const scoped=JSON.parse(store.getItem(playgroundWorkspaceKey("alice","java")));
  assert.equal(scoped.files["Main.java"],"new code");
  assert.equal(JSON.parse(store.getItem("Adminerva_Playground_Workspace")).files["old.java"],"OLD");
  assert.equal(store.getItem(playgroundWorkspaceKey("bob","java")),null);
  vm.runInNewContext('loadLocalWorkspace("python")',context);
  assert.equal(created[0][0],"python");
  assert.equal(created[0][1],undefined);
  vm.runInNewContext('loadLocalWorkspace("java")',context);
  assert.equal(created[1][1]["Main.java"],"new code");
});
test("restores retain a local undo copy before replacing a saved draft",()=>{
  const a=source.indexOf("window.adminervaPlaygroundState=function()");
  const b=source.indexOf("async function shareSnapshot()",a);
  const store=storage({[playgroundWorkspaceKey("alice","java")]:JSON.stringify(sample("java","Main.java","old"))});
  const created=[];
  const context={
    window:{},auth:{currentUser:{uid:"alice"}},localStorage:store,
    workspaceFiles:{"Main.java":{model:{getValue:()=>"old"}}},
    currentLang:"java",fileOrder:["Main.java"],activeFilename:"Main.java",
    playgroundWorkspaceKey,playgroundLanguageKey,playgroundUndoKey,validPlaygroundState,
    persistWorkspace:()=>true,ownerUid:()=> "alice",
    createWorkspace:(...args)=>created.push(args),
    showSaveStatus(){},alert(){},confirm:()=>true,Date,JSON,console
  };
  vm.runInNewContext(source.slice(a,b),context);
  assert.equal(context.window.adminervaRestorePlayground(sample("java","Main.java","new")),true);
  assert.equal(JSON.parse(store.getItem(playgroundUndoKey("alice","java"))).files["Main.java"],"old");
  assert.equal(JSON.parse(store.getItem(playgroundWorkspaceKey("alice","java"))).files["Main.java"],"new");
  assert.equal(created.length,1);
});
test("language switching preserves the outgoing draft and loads the incoming language",()=>{
  assert.match(source,/if\(!persistWorkspace\(\)\)/);
  assert.match(source,/loadLocalWorkspace\(nextLang\)/);
  assert.match(source,/auth\.authStateReady\(\)/);
  assert.doesNotMatch(source,/createWorkspace\(e\.target\.value\)/);
  const html=fs.readFileSync("student-playground.html","utf8");
  assert.match(html,/id="undoRestoreBtn"/);
  assert.match(html,/id="legacyImportBtn"/);
});
