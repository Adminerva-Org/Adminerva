import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

function fixture(filename,extra={}){
  const fields=new Map();
  function element(tag="div"){
    const classes=new Set();return {tagName:tag,children:[],listeners:{},dataset:{},value:"",textContent:"",disabled:false,
      classList:{add:(...values)=>values.forEach(value=>classes.add(value)),remove:(...values)=>values.forEach(value=>classes.delete(value)),contains:value=>classes.has(value)},
      append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},addEventListener(type,callback){this.listeners[type]=callback;},scrollIntoView(){}};
  }
  const field=id=>{if(!fields.has(id))fields.set(id,element());return fields.get(id);};
  const context=vm.createContext({document:{getElementById:field,createElement:element},window:{addEventListener(){}},auth:{currentUser:{uid:"teacher"}},db:{},
    staffRole:()=>"teacher",onAuthStateChanged(){},COURSES:[],collection:(db,...parts)=>({path:parts.join("/")}),query:reference=>reference,where(){},limit(){},...extra});
  vm.runInContext(readFileSync(filename,"utf8").replace(/^import .*;\r?$/gm,""),context);
  return {field,context};
}

test("a learner with saved XP can open practice review without optional leaderboard profile initialization",async()=>{
  const state=fixture("js/student/practice-analytics.mjs",{getDocs:async reference=>reference.path==="practice_rankings"?{size:1,docs:[{id:"alice",data:()=>({points:10,completedCount:1})}]}:{size:0,docs:[]}});
  state.field("practiceAnalyticsSection").value="A";
  vm.runInContext('roster=[{id:"alice",name:"Alice",section:"A"}];',state.context);
  await vm.runInContext("load()",state.context);
  const card=state.field("practiceAnalyticsList").children[0];
  assert.equal(card.children.filter(child=>child.tagName==="button").length,1);
  assert.match(card.children[1].textContent,/10 automatic practice XP/);
});

test("a slower learner review cannot replace a newer selection or its saved teacher note",async()=>{
  const releases=new Map();
  const state=fixture("js/student/practice-analytics.mjs",{getDocs:reference=>new Promise(resolve=>releases.set(reference.path,resolve))});
  vm.runInContext('scores=[{studentId:"bob",reviewNote:"Previously reviewed Bob independently."}];',state.context);
  const first=vm.runInContext('review({id:"alice",name:"Alice"})',state.context);
  const second=vm.runInContext('review({id:"bob",name:"Bob"})',state.context);
  assert.equal(state.field("practiceReview").classList.contains("hidden"),true);
  assert.equal(state.field("practiceAcceptPoints").disabled,true);
  releases.get("practice_class_progress/bob/courses")({docs:[]});await second;
  assert.equal(state.field("practiceReviewName").textContent,"Bob");
  assert.equal(state.field("practicePointsNote").value,"Previously reviewed Bob independently.");
  assert.equal(state.field("practiceAcceptPoints").disabled,false);
  releases.get("practice_class_progress/alice/courses")({docs:[]});await first;
  assert.equal(state.field("practiceReviewName").textContent,"Bob");assert.equal(vm.runInContext("active.student.id",state.context),"bob");
});

test("leaderboard retry reloads memberships when a partial failure cleared the selected class",()=>{
  let reloads=0;
  const state=fixture("js/student/practice-standings.mjs",{location:{reload(){reloads++;}}});
  vm.runInContext('profiles=[{id:"alice-A",section:"A"}];',state.context);
  state.field("practiceClass").value="";state.field("practiceClassRetryBtn").listeners.click();
  assert.equal(reloads,1);
});
