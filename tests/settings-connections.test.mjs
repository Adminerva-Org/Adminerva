import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {CONNECTION_DEFAULTS,activateConnectionOwner,writeConnectionPreferences,clearConnectionPreferences} from "../js/core/connection-cache.mjs";

async function harness({engine="local",model="saved-custom-model",getDocs=async()=>({empty:true}),fetch=async()=>({ok:true}),authenticate=true,initialStorage=[],profile={}}={}){
  const nodes=new Map(),storage=new Map(initialStorage),writes=[];let authListener,initializing=true;
  for(const id of ["firebaseConfigInput","adminGithubToken","adminGeminiKey","adminAiModel","globalAiEngine","security-save-status","saveSettingsBtn","panel-security"])nodes.set(id,{value:"",textContent:"Save",dataset:{},addEventListener(){},setAttribute(){},removeAttribute(){}});
  nodes.get("globalAiEngine").value=engine;nodes.get("adminAiModel").value=model;nodes.get("adminGeminiKey").value="fixture-key";
  const context={window:{},document:{getElementById:id=>nodes.get(id)},app:{options:{projectId:"actual-project",authDomain:"actual.example.test",storageBucket:"actual-bucket",apiKey:"never-displayed"}},auth:{currentUser:{uid:"teacher",email:"teacher@example.edu"},onAuthStateChanged:listener=>{authListener=listener;return ()=>{};}},db:{},AbortSignal,fetch,
    localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},collection:()=>{},query:()=>{},where:()=>{},doc:(_db,...path)=>path.join("/"),getDocs:(...args)=>initializing?Promise.resolve({empty:false,docs:[{data:()=>profile}]}):getDocs(...args),
    setDoc:async(path,value)=>writes.push({path,value}),updateDoc:async(path,value)=>writes.push({path,value})};
  Object.assign(context,{CONNECTION_DEFAULTS,activateConnectionOwner:uid=>activateConnectionOwner(uid,context.localStorage),writeConnectionPreferences:(uid,values)=>writeConnectionPreferences(uid,values,context.localStorage),clearConnectionPreferences:()=>clearConnectionPreferences(context.localStorage)});
  vm.runInNewContext(readFileSync(new URL("../js/settings/settings-security.js",import.meta.url),"utf8").replace(/^import .*;\r?$/gm,""),context);
  await context.window.loadSecuritySettings();if(authenticate)await authListener(context.auth.currentUser);initializing=false;
  if(authenticate){nodes.get("globalAiEngine").value=engine;nodes.get("adminAiModel").value=model;nodes.get("adminGeminiKey").value="fixture-key";}
  return {...context,nodes,storage,writes,emitAuth:async user=>{context.auth.currentUser=user;await authListener(user);}};
}

test("application details always reflect the initialized app and cannot be edited",async()=>{
  const app=await harness();const connection=app.nodes.get("firebaseConfigInput");
  assert.equal(connection.readOnly,true);assert.equal(JSON.parse(connection.value).projectId,"actual-project");assert.equal(connection.value.includes("never-displayed"),false);
  assert.equal(app.storage.has("Adminerva_firebase_config"),false);
});

test("saving is single-flight and local mode skips Gemini while preserving an existing model ID",async()=>{
  let finish,fetches=0,reads=0;const pending=new Promise(resolve=>finish=resolve);
  const app=await harness({getDocs:()=>{reads++;return pending;},fetch:async()=>{fetches++;return {ok:true};}});
  const first=app.window.saveSecuritySettings();assert.equal(app.nodes.get("saveSettingsBtn").disabled,true);
  await app.window.saveSecuritySettings();assert.equal(reads,1);finish({empty:true});await first;
  assert.equal(fetches,0);assert.equal(app.writes.length,1);assert.equal(app.writes[0].value.aiModel,"saved-custom-model");
  assert.equal(app.storage.get("Adminerva_ai_model"),"saved-custom-model");assert.equal(app.nodes.get("saveSettingsBtn").disabled,false);
});

test("failed cloud checks produce an inline error without writing profile or cached credentials",async()=>{
  const app=await harness({engine:"cloud",fetch:async()=>({ok:false,status:503})});await app.window.saveSecuritySettings();
  assert.equal(app.writes.length,0);assert.equal(app.storage.get("Adminerva_gemini_token"),"");assert.equal(app.nodes.get("security-save-status").dataset.tone,"error");
  assert.equal(app.nodes.get("saveSettingsBtn").disabled,false);
});

test("provider model prefixes are normalized for verification and saved preferences",async()=>{
  let requestUrl;
  const app=await harness({engine:"cloud",model:"models/gemini-3.8-flash",fetch:async url=>{requestUrl=url;return {ok:true};}});
  await app.window.saveSecuritySettings();
  assert.match(requestUrl,/\/models\/gemini-3\.8-flash:generateContent/);
  assert.equal(app.writes[0].value.aiModel,"gemini-3.8-flash");
  assert.equal(app.storage.get("Adminerva_ai_model"),"gemini-3.8-flash");
});

test("account switching during a profile lookup aborts before profile writes or local cache updates",async()=>{
  let finish;const pending=new Promise(resolve=>finish=resolve),app=await harness({getDocs:()=>pending});
  const saving=app.window.saveSecuritySettings();app.auth.currentUser={uid:"other",email:"other@example.edu"};finish({empty:true});await saving;
  assert.equal(app.writes.length,0);assert.equal(app.storage.get("Adminerva_gemini_token"),"");assert.match(app.nodes.get("security-save-status").textContent,/account changed/);
});


test("unowned globals are never shown before authentication and a missing cloud profile cannot inherit them",async()=>{
  const app=await harness({authenticate:false,initialStorage:[["Adminerva_github_token","previous-user"],["Adminerva_gemini_token","previous-key"]]});
  assert.equal(app.nodes.get("adminGithubToken").value,"");assert.equal(app.nodes.get("adminGeminiKey").value,"");
  await app.window.saveSecuritySettings();assert.equal(app.writes.length,0);assert.match(app.nodes.get("security-save-status").textContent,/settings have not loaded/);
  await app.emitAuth(app.auth.currentUser);assert.equal(app.nodes.get("adminGithubToken").value,"");assert.equal(app.nodes.get("adminGeminiKey").value,"");assert.equal(app.storage.get("Adminerva_github_token"),"");
});

test("switching accounts clears the old form and missing profile fields become defaults",async()=>{
  const app=await harness({profile:{githubToken:"A-token",geminiKey:"A-key",aiModel:"old-model",engineMode:"local"}});
  await app.emitAuth({uid:"B",email:"b@example.edu"});
  assert.equal(app.nodes.get("adminGithubToken").value,"");assert.equal(app.nodes.get("adminGeminiKey").value,"");assert.equal(app.nodes.get("adminAiModel").value,"gemini-3.8-flash");assert.equal(app.storage.get("Adminerva_connection_owner"),"B");
});
