import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

function fixture(){
  const nodes=new Map(),requests=[];
  function element(){
    return {value:"",textContent:"",children:[],listeners:{},open:false,
      append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},
      addEventListener(type,listener){this.listeners[type]=listener;},click(){this.listeners.click();},
      showModal(){this.open=true;},close(){this.open=false;}};
  }
  function field(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);}
  let school="alpha",roles=["school_admin"],pickerOptions;
  const scope={get current(){return {schoolId:school,roles};},lease(){return {schoolId:school};},
    assertLease(lease){if(lease.schoolId!==school)throw Error("School changed");}};
  const source=readFileSync(new URL("./class-record-oversight.mjs",import.meta.url),"utf8").replace(/^import .*;\r?$/gm,"");
  vm.runInNewContext(source,{
    app:{},getFunctions(){},httpsCallable:()=>data=>new Promise((resolve,reject)=>{
      requests.push({data,done:result=>resolve({data:result}),reject});
    }),
    createTenantSchoolPicker(options){
      pickerOptions=options;return {scope,async load(){options.onReady(scope);}};
    },
    document:{getElementById:field,createElement:element}
  });
  field("cro-filter").value="all";
  return {field,requests,async switchSchool(id,newRoles=["school_admin"]){
    await pickerOptions.onBeforeChange();school=id;roles=newRoles;pickerOptions.onReady(scope);
  }};
}

const settle=()=>new Promise(resolve=>setImmediate(resolve));
const record=subjectName=>({subjectName,offeringId:subjectName,sectionName:"Section",teacherNames:[]});
function auditButton(f,index){return f.field("cro-list").children[index].children.at(-1).children[0];}

test("a stale school overview cannot clear newer records or enable access after a role change",async()=>{
  const f=fixture();
  await f.switchSchool("beta");
  f.requests[1].done({records:[record("Language")]});await settle();
  f.requests[0].done({records:[]});await settle();
  assert.equal(f.field("cro-total").textContent,1);
  assert.match(f.field("cro-status").textContent,/1 Class Record loaded/);
  f.field("cro-refresh").click();
  await f.switchSchool("gamma",["teacher"]);
  f.requests[2].reject(Error("Old overview failed"));await settle();
  assert.equal(f.field("cro-total").textContent,"—");
  assert.match(f.field("cro-status").textContent,/administrator access is required/);
  assert.equal(f.field("cro-refresh").disabled,true);
});

test("only a successful empty overview reports zero Class Records",async()=>{
  const f=fixture();
  f.requests[0].reject(Error("Connection lost"));await settle();
  assert.equal(f.field("cro-total").textContent,"—");
  assert.match(f.field("cro-status").textContent,/Connection lost/);
  f.field("cro-refresh").click();
  f.requests[1].done({records:[]});await settle();
  assert.equal(f.field("cro-total").textContent,0);
  assert.match(f.field("cro-list").children[0].textContent,/No Class Records/);
});

test("an older class history cannot replace the currently open history on success or failure",async()=>{
  const f=fixture();
  f.requests[0].done({records:[record("Math"),record("Science")]});await settle();
  for(const rejectOld of [true,false]){
    auditButton(f,0).click();const old=f.requests.at(-1);
    f.field("cro-audit-close").click();
    auditButton(f,1).click();
    f.requests.at(-1).done({offering:{subjectName:"Science"},events:[]});await settle();
    if(rejectOld)old.reject(Error("Old audit failed"));
    else old.done({offering:{subjectName:"Math"},events:[]});
    await settle();
    assert.equal(f.field("cro-audit-context").textContent,"Science");
    assert.match(f.field("cro-audit-list").children[0].textContent,/No Class Record audit events/);
    f.field("cro-audit-close").click();
  }
});
