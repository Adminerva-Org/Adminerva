import test from "node:test";
import assert from "node:assert/strict";
import {CONNECTION_DEFAULTS,activateConnectionOwner,writeConnectionPreferences,clearConnectionPreferences} from "../js/core/connection-cache.mjs";
const fixture=()=>{const records=new Map();return {records,getItem:key=>records.get(key)??null,setItem:(key,value)=>records.set(key,value),removeItem:key=>records.delete(key)};};

test("unowned legacy keys and another account's keys are cleared before owner activation",()=>{
  const storage=fixture();storage.setItem("Adminerva_github_token","legacy");storage.setItem("Adminerva_gemini_token","legacy-key");
  assert.deepEqual(activateConnectionOwner("A",storage),CONNECTION_DEFAULTS);assert.equal(storage.getItem("Adminerva_github_token"),null);
  writeConnectionPreferences("A",{githubToken:"A-token",geminiKey:"A-key",aiModel:"custom-A",engineMode:"local"},storage);
  assert.deepEqual(activateConnectionOwner("B",storage),CONNECTION_DEFAULTS);assert.equal(storage.getItem("Adminerva_gemini_token"),null);assert.equal(storage.getItem("Adminerva_connection_owner"),"B");
  assert.throws(()=>writeConnectionPreferences("A",{githubToken:"stale"},storage),/account changed/);
});

test("the same owner retains values; missing cloud fields replace all mirrors with explicit defaults",()=>{
  const storage=fixture();activateConnectionOwner("A",storage);const values={githubToken:"A-token",geminiKey:"A-key",aiModel:"custom-model",engineMode:"local"};
  writeConnectionPreferences("A",values,storage);assert.deepEqual(activateConnectionOwner("A",storage),values);
  assert.deepEqual(writeConnectionPreferences("A",{},storage),CONNECTION_DEFAULTS);assert.equal(storage.getItem("Adminerva_github_token"),"");assert.equal(storage.getItem("Adminerva_ai_model"),"gemini-3.8-flash");
  clearConnectionPreferences(storage);assert.equal(storage.records.size,0);
  activateConnectionOwner("A",storage);activateConnectionOwner(null,storage);assert.equal(storage.records.size,0);
});
