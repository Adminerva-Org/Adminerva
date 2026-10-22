import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {assessmentStatus,assessmentTargetDetails,asDate} from "../js/student/assessment-state.mjs";

test("Playground installs the global ZIP constructor before the editor's AMD loader",()=>{
  const html=readFileSync(new URL("../student-playground.html",import.meta.url),"utf8");
  const zip=html.indexOf("/jszip/3.10.1/jszip.min.js"),loader=html.indexOf("/monaco-editor/0.44.0/min/vs/loader.min.js");
  assert.ok(zip>=0&&loader>zip,"JSZip must load before define.amd can capture its constructor");
});

function fixture(filename){
  const fields=new Map(),reads=[],writes=[];let response={empty:true,forEach(){}};
  const field=id=>{if(!fields.has(id)){
    const classes=new Set();fields.set(id,{value:"",textContent:"",innerHTML:"",inserted:"",disabled:false,dataset:{},listeners:{},
      classList:{add:(...values)=>values.forEach(value=>classes.add(value)),remove:(...values)=>values.forEach(value=>classes.delete(value)),contains:value=>classes.has(value),toggle(value,enabled){if(enabled)classes.add(value);else classes.delete(value);}},
      setAttribute(){},replaceChildren(){this.innerHTML="";},insertAdjacentHTML(position,html){this.inserted+=html;},addEventListener(type,callback){this.listeners[type]=callback;}});
  }return fields.get(id);};
  const context=vm.createContext({document:{getElementById:field,addEventListener(){}},window:{addEventListener(){},beginLoading:()=>()=>{}},
    auth:{currentUser:{uid:"alice",email:"alice@example.edu"}},db:{},onAuthStateChanged(){},
    collection:(db,name)=>name,where:(...values)=>values,query:(...values)=>values,doc:(db,...values)=>values,
    getDocs:async query=>{reads.push(query);if(response instanceof Error)throw response;return response;},setDoc:async(...values)=>writes.push(values),
    localStorage:{getItem:()=>null},assessmentStatus,assessmentTargetDetails,asDate,console,URL,cleanGradeFeedback:value=>value});
  const source=readFileSync(filename,"utf8").replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\r?$/gm,"");
  vm.runInContext(source,context);
  return {field,context,reads,writes,respond(value){response=value;}};
}

test("Pending includes overdue and revision work, excluding submitted, reviewed and published tasks",()=>{
  const state=fixture("js/student/assessments.js");state.field("filterStatus").value="pending";state.field("sortDate").value="newest";
  vm.runInContext(`
    currentSection="A";submissionLookupSucceeded=true;
    allAssessments=["unstarted","overdue","published","submitted","approved","discovered","reopened","withdrawn"].map(id=>({id,title:id,postedDate:new Date(),dueDate:id==="overdue"?new Date("2020-01-01"):new Date("2030-01-01"),isUrgent:id==="overdue"}));
    myGrades={published:{published:true,score:10}};mySubmitted={submitted:{}};
    myEvidence={approved:{status:"approved"},discovered:{status:"needs_review"},reopened:{status:"reopened"},withdrawn:{status:"withdrawn"}};
    renderAssessments();`,state.context);
  const html=state.field("assignmentsFeed").inserted;
  for(const id of ["unstarted","overdue","reopened","withdrawn"])assert.match(html,new RegExp('viewAssessmentDetails\\(\''+id+'\''));
  for(const id of ["published","submitted","approved","discovered"])assert.doesNotMatch(html,new RegExp('viewAssessmentDetails\\(\''+id+'\''));
  vm.runInContext('submissionLookupSucceeded=false;allAssessments=[{id:"unknown",title:"unknown",postedDate:new Date()}];',state.context);
  state.field("assignmentsFeed").inserted="";vm.runInContext("renderAssessments()",state.context);
  assert.equal(state.field("assignmentsFeed").inserted,"");assert.match(state.field("assignmentsFeed").innerHTML,/No assignments match/);
});

test("assignment class failures and missing membership end loading and expose a retry",async()=>{
  const state=fixture("js/student/assessments.js");state.respond(new Error("offline"));await vm.runInContext("loadStudentAssignments()",state.context);
  assert.match(state.field("assignmentsNoticeText").textContent,/connection and retry/);
  assert.match(state.field("assignmentsFeed").innerHTML,/Unable to load your class/);
  assert.equal(state.field("assignmentsRetry").disabled,false);assert.equal(state.field("assignmentsRetry").classList.contains("hidden"),false);
  state.respond({empty:true,forEach(){}});await vm.runInContext("loadStudentAssignments()",state.context);
  assert.match(state.field("assignmentsFeed").innerHTML,/No student class linked/);
  assert.deepEqual(state.reads[0],["students",["email","==","alice@example.edu"]]);
});

test("student settings cannot save a missing profile and recover from a failed roster load",async()=>{
  const state=fixture("js/student/settings.js");state.respond(new Error("offline"));await vm.runInContext("loadStudentProfiles()",state.context);
  assert.match(state.field("studentSettingsNotice").textContent,/connection and retry/);
  assert.equal(state.field("saveRepoBtn").disabled,true);assert.equal(state.field("saveStudentProfile").disabled,true);
  await state.field("repoForm").listeners.submit({preventDefault(){}});assert.equal(state.writes.length,0);
  state.respond({empty:false,forEach(callback){callback({id:"alice-A",data:()=>({name:"Alice",email:"alice@example.edu",section:"A"})});}});
  await vm.runInContext("loadStudentProfiles()",state.context);
  assert.equal(state.field("saveRepoBtn").disabled,false);assert.equal(state.field("saveStudentProfile").disabled,false);
  assert.match(state.field("studentIdentitySummary").textContent,/Alice.*A/);
  state.context.auth.currentUser={uid:"bob",email:"bob@example.edu"};
  assert.equal(vm.runInContext("readyProfile(userProfiles[0])",state.context),false);assert.equal(state.writes.length,0);
});
