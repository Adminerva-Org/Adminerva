import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const filename=new URL("../js/school-admin/people-access.mjs",import.meta.url);
const csv=name=>"displayName,email,kind\n"+name+","+name.toLowerCase()+"@example.edu,student\n";
function deferred(){
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
function preview(name){
  return {digest:"reviewed-"+name,summary:{rows:1,create:1,existing:0,invalid:0},
    rows:[{displayName:name,kind:"student",email:name.toLowerCase()+"@example.edu",personId:name,status:"create",errors:[]}]};
}
function fixture(handle=()=>undefined){
  const fields=new Map(),requests=[];
  function element(tag="div"){
    const formFields=new Map(),queries=new Map(),classes=new Set();
    const node={tagName:tag.toUpperCase(),children:[],listeners:{},dataset:{},style:{},files:[],value:"",textContent:"",hidden:false,disabled:false,
      classList:{add:(...items)=>items.forEach(item=>classes.add(item)),remove:(...items)=>items.forEach(item=>classes.delete(item)),
        contains:item=>classes.has(item),toggle(item,active){if(active)classes.add(item);else classes.delete(item);}},
      append(...children){this.children.push(...children);},replaceChildren(...children){
        this.children=[...children];
        if(this.tagName==="SELECT")this.value=children.find(child=>child.selected)?.value??children[0]?.value??"";
      },
      addEventListener(type,listener){this.listeners[type]=listener;},setAttribute(){},removeAttribute(){},
      add(option){this.children.push(option);},close(){this.open=false;},showModal(){this.open=true;},
      reset(){for(const field of formFields.values())field.value="";},
      querySelector(selector){if(!queries.has(selector))queries.set(selector,element("button"));return queries.get(selector);},
      querySelectorAll(selector){
        if(selector==="button,input")return [...formFields.values(),...queries.values(),field("pa-sheet-preview"),field("pa-sheet-clear")];
        return [];
      }};
    node.elements=new Proxy({}, {get(_target,name){
      if(name==="namedItem")return key=>node.elements[key];
      if(!formFields.has(name))formFields.set(name,element("input"));
      return formFields.get(name);
    }});
    return node;
  }
  function field(id){if(!fields.has(id))fields.set(id,element());return fields.get(id);}
  let current={uid:"admin",schoolId:"school-a",roles:["school_admin"],generation:1},pickerOptions;
  const scope={get current(){return current;},lease(){return {...current};},assertLease(lease){
    if(!current||lease.schoolId!==current.schoolId||lease.generation!==current.generation)throw Error("Your school changed.");
    return true;
  }};
  const context=vm.createContext({
    app:{},auth:{currentUser:{uid:"admin"}},getFunctions:()=>({}),
    httpsCallable:(_functions,name)=>async input=>{
      requests.push({name,...input});
      const response=await handle(name,input);
      if(response!==undefined)return {data:response};
      if(input.action==="preview_import_people")return {data:preview(input.rows[0].displayName)};
      if(input.action==="commit_import_people")return {data:{created:1,skipped:0}};
      if(name==="schoolRosterSource")return {data:{configured:false,url:""}};
      return {data:{items:[],people:[],students:[],teachers:[],members:[],offerings:[],counts:{},summary:{},issues:[]}};
    },
    createTenantSchoolPicker(options){pickerOptions=options;return {scope,load:async()=>null};},
    document:{getElementById:field,querySelectorAll:()=>[],querySelector:()=>null,createElement:element},
    location:{hash:"",href:"https://example.edu/people-access.html"},sessionStorage:{getItem:()=>null,setItem(){}},
    FormData:class{constructor(form){this.form=form;}get(key){return this.form.elements[key].value;}},
    Option:function(text,value){return {textContent:text,value};},
    confirm:()=>true,prompt:()=>null,setTimeout,clearTimeout,console
  });
  const source=readFileSync(filename,"utf8").replace(/\r\n/g,"\n").replace(/^import .*;$/gm,"");
  const initialization=source.lastIndexOf("\ntry{\n  await picker.load();");
  assert.ok(initialization>0,"directory initialization entry point exists");
  vm.runInContext(source.slice(0,initialization),context);
  vm.runInContext("schoolReady=true;",context);
  field("pa-import-commit").disabled=true;
  return {field,context,requests,
    run:code=>vm.runInContext(code,context),
    fire(id,type="click"){
      const target=field(id);assert.equal(typeof target.listeners[type],"function",id+" listener is installed");
      target.listeners[type]({target,currentTarget:target,preventDefault(){}});
    },
    chooseFile(name,text=Promise.resolve(csv(name))){
      field("pa-import-file").files=[{name:name+".csv",size:100,text:()=>text}];
      field("pa-import-file").value=name+".csv";
      this.fire("pa-import-file","change");
    },
    async switchSchool(schoolId){
      await pickerOptions.onBeforeChange();
      current={...current,schoolId,generation:current.generation+1};
      field("pa-import-file").files=[];
      vm.runInContext("schoolReady=true;",context);
    }};
}
async function settle(until=()=>true){
  for(let turn=0;turn<30;turn++){
    await new Promise(setImmediate);
    if(until())return;
  }
  assert.fail("directory action did not settle");
}

test("CSV selected in one school cannot preview against a school selected during file reading",async()=>{
  const read=deferred(),state=fixture();
  state.chooseFile("Alice",read.promise);state.fire("pa-import-preview");
  await state.switchSchool("school-b");
  read.resolve(csv("Alice"));await settle();
  assert.equal(state.requests.filter(request=>request.action==="preview_import_people").length,0);
  assert.equal(state.field("pa-import-commit").disabled,true);
  assert.equal(state.run("importRows.length"),0);
  assert.doesNotMatch(state.field("pa-import-status").textContent,/Preview ready/);
});

for(const oldResult of ["success","failure"]){
  test("an obsolete CSV preview "+oldResult+" cannot replace the newest reviewed rows",async()=>{
    const pending=new Map(),state=fixture((_name,input)=>{
      if(input.action!=="preview_import_people")return;
      const request=deferred();pending.set(input.rows[0].displayName,request);return request.promise;
    });
    state.chooseFile("Alice");state.fire("pa-import-preview");await settle(()=>pending.has("Alice"));
    state.chooseFile("Bob");state.fire("pa-import-preview");await settle(()=>pending.has("Bob"));
    pending.get("Bob").resolve(preview("Bob"));
    await settle(()=>!state.field("pa-import-commit").disabled);
    if(oldResult==="success")pending.get("Alice").resolve(preview("Alice"));
    else pending.get("Alice").reject(Error("Old preview failed"));
    await settle();
    assert.equal(state.run("importRows[0].displayName"),"Bob");
    assert.equal(state.run("importDigest"),"reviewed-Bob");
    assert.equal(state.field("pa-import-commit").disabled,false);
    assert.match(state.field("pa-import-status").textContent,/Preview ready/);
    assert.equal(state.field("pa-import-results").children[0].children[0].children[0].textContent,"Bob");
  });
}

test("a saved import stays committed when a subsequent dashboard refresh fails",async()=>{
  const commit=deferred(),state=fixture((_name,input)=>{
    if(input.action==="commit_import_people")return commit.promise;
    if(input.action==="overview")throw Error("Overview offline");
  });
  state.chooseFile("Alice");state.fire("pa-import-preview");
  await settle(()=>!state.field("pa-import-commit").disabled);
  state.fire("pa-import-commit");
  await settle(()=>state.requests.some(request=>request.action==="commit_import_people"));
  assert.equal(state.field("pa-import-file").disabled,true,"file selection is locked while the reviewed import is saved");
  assert.equal(state.field("pa-sheet-preview").disabled,true);
  commit.resolve({created:1,skipped:0});
  await settle(()=>!state.run("pendingWrite"));
  assert.equal(state.run("importCommitted"),true);
  assert.equal(state.field("pa-import-commit").disabled,true);
  assert.match(state.field("pa-import-status").textContent,/committed|saved/i);
  assert.match(state.field("pa-import-status").textContent,/refresh/i);
  assert.doesNotMatch(state.field("pa-import-status").textContent,/not committed/i);
  state.fire("pa-import-commit");await settle();
  assert.equal(state.requests.filter(request=>request.action==="commit_import_people").length,1);
});

test("a rejected Sheet configuration cannot enable actions for an unconfigured source",async()=>{
  const state=fixture((_name,input)=>{
    if(input.action==="configure")throw Error("Invalid sheet URL");
  });
  await state.run("loadRosterSourceStatus()");
  const form=state.field("pa-sheet-source-form");
  form.elements.url.value="https://docs.google.com/spreadsheets/d/not-saved/edit";
  form.elements.reason.value="Approved roster source for this school.";
  state.fire("pa-sheet-source-form","submit");
  await settle(()=>!state.run("pendingWrite"));
  assert.match(state.field("pa-sheet-status").textContent,/Invalid sheet URL/);
  assert.equal(state.field("pa-sheet-preview").disabled,true);
  assert.equal(state.field("pa-sheet-clear").disabled,true);
});

test("a delayed configured Sheet fetch cannot replace a newer CSV preview",async()=>{
  const fetched=deferred(),state=fixture((name,input)=>{
    if(name!=="schoolRosterSource")return;
    if(input.action==="status")return {configured:true,url:"https://docs.google.com/spreadsheets/d/saved/edit"};
    if(input.action==="fetch_csv")return fetched.promise;
  });
  await state.run("loadRosterSourceStatus()");
  state.fire("pa-sheet-preview");
  state.chooseFile("Bob");state.fire("pa-import-preview");
  await settle(()=>!state.field("pa-import-commit").disabled);
  fetched.resolve({csv:csv("Alice")});await settle();
  const previews=state.requests.filter(request=>request.action==="preview_import_people");
  assert.equal(previews.length,1);
  assert.equal(previews[0].rows[0].displayName,"Bob");
  assert.equal(state.run("importDigest"),"reviewed-Bob");
  assert.equal(state.field("pa-import-commit").disabled,false);
});

test("source status loading cannot replace a URL being edited",async()=>{
  const status=deferred(),state=fixture((name,input)=>{
    if(name==="schoolRosterSource"&&input.action==="status")return status.promise;
  });
  const loading=state.run("loadRosterSourceStatus()");
  const form=state.field("pa-sheet-source-form"),typed="https://docs.google.com/spreadsheets/d/new-source/edit";
  form.elements.url.value=typed;state.fire("pa-sheet-source-form","input");
  status.resolve({configured:true,url:"https://docs.google.com/spreadsheets/d/old-source/edit"});
  await loading;
  assert.equal(form.elements.url.value,typed);
});

test("duplicate supported CSV aliases are rejected before any directory preview",async()=>{
  const state=fixture();
  state.chooseFile("Alice",Promise.resolve("displayName,display_name,email\nAlice,Bob,alice@example.edu\n"));
  state.fire("pa-import-preview");await settle();
  assert.equal(state.requests.filter(request=>request.action==="preview_import_people").length,0);
  assert.equal(state.field("pa-import-commit").disabled,true);
  assert.match(state.field("pa-import-status").textContent,/duplicate columns/i);
});

test("switching schools clears old class selections, staff search and invitation identity",async()=>{
  const state=fixture(),workspace=state.field("pa-workspace");
  const classForm=state.field("pa-assignment-form"),inviteForm=state.field("pa-create-invite");
  const offering=classForm.elements.offeringId,staff=state.field("pa-staff-access-person");
  offering.tagName="SELECT";staff.tagName="SELECT";
  offering.append({value:"same-offering-id",textContent:"School A class",selected:true});
  offering.value="same-offering-id";
  staff.append({value:"same-person-id",textContent:"School A staff",selected:true});
  staff.value="same-person-id";
  state.field("pa-staff-access-query").value="Old school teacher";
  inviteForm.elements.email.value="old-school-person@example.edu";
  workspace.querySelectorAll=selector=>selector==="form"?[classForm,inviteForm]:
    selector.includes("[data-offering]")?[offering]:[];
  await state.switchSchool("school-b");
  assert.equal(offering.value,"");
  assert.equal(offering.children.length,1);
  assert.equal(offering.children[0].value,"");
  assert.equal(staff.value,"");
  assert.equal(staff.children.length,1);
  assert.equal(state.field("pa-staff-access-query").value,"");
  assert.equal(inviteForm.elements.email.value,"");
  assert.equal(state.requests.length,0,"resetting does not submit school changes");
});
