import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import vm from "node:vm";

const require=createRequire(import.meta.url);
const source=readFileSync(new URL("../functions/platform-schools.js",import.meta.url),"utf8");
const sandbox={module:{exports:{}},require(spec){
  if(spec==="firebase-admin/auth")return {getAuth:()=>({})};
  if(spec==="firebase-admin/firestore")return {FieldValue:{serverTimestamp:()=>"server-time"}};
  if(spec==="./tenant-access.js")return require("../functions/tenant-access.js");
  if(spec==="./school-cutover-policy.js")return require("../functions/school-cutover-policy.js");
  if(spec==="./school-cutover-readiness.js")return {};
  return require(spec);
}};
vm.runInNewContext(source,sandbox);
const {createPlatformSchoolService}=sandbox.module.exports;

function recoveryFixture({school={},admin={},platformAdmin=true,verified=true}={}){
  const records=new Map([
    ["platform_schools/example-school",{state:"suspended",revision:7,productionAuthorized:true,
      compatibilityMode:"v4_only",aiEnabled:false,retentionMode:"retain_all",...school}],
    ["schools/example-school/memberships/admin-user",{schoolId:"example-school",status:"active",roles:["school_admin","teacher"],...admin}]
  ]);
  if(platformAdmin)records.set("platform_admins/owner-user",{role:"platform_admin",status:"active"});
  const writes=[];
  const snapshot=path=>({id:path.split("/").at(-1),exists:records.has(path),data:()=>records.get(path)});
  const db={doc:path=>({path,get:async()=>snapshot(path)}),collection:path=>({
    path,doc:()=>({path:path+"/audit-id"}),
    where(field,operator,value){return {path,field,operator,value};}
  }),async runTransaction(callback){
    const pending=[];
    await callback({
      async get(ref){
        if(!ref.field)return snapshot(ref.path);
        const docs=[...records.keys()].filter(path=>path.startsWith(ref.path+"/")&&
          records.get(path)[ref.field]?.includes(ref.value)).map(snapshot);
        return {docs};
      },
      update:(ref,data)=>pending.push({path:ref.path,data,kind:"update"}),
      create:(ref,data)=>pending.push({path:ref.path,data,kind:"create"})
    });
    for(const write of pending){
      records.set(write.path,write.kind==="update"?{...records.get(write.path),...write.data}:write.data);
      writes.push(write);
    }
  }};
  const service=createPlatformSchoolService({db,auth:{}});
  return {records,writes,request:(data={})=>service({auth:{uid:"owner-user",token:{email_verified:verified}},
    data:{action:"resume",schoolId:"example-school",expectedRevision:7,reason:"Suspension reviewed and resolved.",...data}})};
}

test("owner restores a suspended school with audited reason and preserves school and membership settings",async()=>{
  const f=recoveryFixture(),membership=f.records.get("schools/example-school/memberships/admin-user");
  const result=await f.request();
  assert.equal(result.state,"active");
  const saved=f.records.get("platform_schools/example-school");
  assert.equal(saved.revision,8);
  assert.equal(saved.compatibilityMode,"v4_only");
  assert.equal(saved.aiEnabled,false);
  assert.equal(saved.retentionMode,"retain_all");
  assert.equal(saved.resumedByUid,"owner-user");
  assert.equal(f.records.get("schools/example-school/memberships/admin-user"),membership);
  assert.equal(f.writes.length,2);
  assert.equal(f.writes[1].data.action,"school_resumed");
  assert.equal(f.writes[1].data.reason,"Suspension reviewed and resolved.");
  await assert.rejects(()=>f.request(),{code:"failed-precondition"});
  assert.equal(f.writes.length,2);
});

test("school recovery rejects stale views, unapproved institutions, missing active admins and wrong lifecycle states atomically",async()=>{
  for(const options of [
    {school:{revision:8}}, {school:{state:"draft"}}, {school:{state:"active"}},
    {school:{productionAuthorized:false}}, {admin:{status:"suspended"}},
    {admin:{schoolId:"other-school"}}, {admin:{roles:["teacher"]}}
  ]){
    const f=recoveryFixture(options);
    await assert.rejects(()=>f.request(),{code:"failed-precondition"});
    assert.equal(f.writes.length,0);
  }
});

test("school recovery requires verified platform authority and a reviewed revision and reason",async()=>{
  for(const [options,data,code] of [
    [{platformAdmin:false},{},"permission-denied"],
    [{verified:false},{},"unauthenticated"],
    [{},{expectedRevision:undefined},"invalid-argument"],
    [{},{reason:"short"},"invalid-argument"]
  ]){
    const f=recoveryFixture(options);
    await assert.rejects(()=>f.request(data),{code});
    assert.equal(f.writes.length,0);
  }
});

function uiFixture(){
  const html=readFileSync(new URL("../owner-schools.html",import.meta.url),"utf8");
  const nodes=new Map(),requests=[],pending=[];
  const makeNode=(id="")=>({id,dataset:{},disabled:false,hidden:false,value:"",checked:false,textContent:"",style:{},
    addEventListener(){},setAttribute(){},append(){},replaceChildren(){},scrollIntoView(){},focus(){},
    querySelector(){return makeNode();},querySelectorAll(){return []}});
  for(const [,id] of html.matchAll(/\bid="([^"]+)"/g))nodes.set(id,makeNode(id));
  const forms=[];
  for(const [,id,body] of html.matchAll(/<form\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/form>/g)){
    const form=nodes.get(id),elements=[];
    for(const [,attributes,name] of body.matchAll(/<(?:input|select|textarea)\b([^>]*\bname="([^"]+)"[^>]*)>/g)){
      const fieldId=attributes.match(/\bid="([^"]+)"/)?.[1];
      const field=(fieldId&&nodes.get(fieldId))||makeNode();
      field.value=attributes.match(/\bvalue="([^"]*)"/)?.[1]||"";
      field.defaultValue=field.value;elements.push(field);elements[name]=field;
    }
    elements.namedItem=name=>elements[name]||null;
    form.elements=elements;
    form.reset=()=>{for(const field of elements){field.value=field.defaultValue;field.checked=false;}};
    form.reportValidity=()=>true;
    forms.push(form);
  }
  const scoped=forms.filter(form=>!form.id.startsWith("owner-onboarding")&&form.id!=="owner-create");
  nodes.get("owner-actions").querySelectorAll=selector=>selector==="form"?scoped:[];
  nodes.get("owner-actions").contains=form=>scoped.includes(form);
  const call=async data=>{
    requests.push(data);
    if(data.action==="get_cutover_decisions"||data.action==="grant_school_admin")
      return await new Promise((resolve,reject)=>pending.push({data,resolve,reject}));
    return {data:{roles:[],schools:[]}};
  };
  const context=vm.createContext({document:{getElementById:id=>nodes.get(id),querySelectorAll:()=>[],createElement:()=>makeNode()},
    app:{},auth:{},getFunctions:()=>({}),httpsCallable:(_functions,name)=>name==="platformSchools"?call:
      async()=>({data:{ready:false,blockers:[],checks:[]}}),setTimeout(){}});
  const uiSource=readFileSync(new URL("../js/core/owner-school-registry.mjs",import.meta.url),"utf8")
    .replace(/^import .*;\r?$/gm,"").split("try {\n  await auth.authStateReady();")[0]
    .split("try {\r\n  await auth.authStateReady();")[0];
  vm.runInContext(uiSource+"\nglobalThis.ui={choose,submit,setSchools:value=>{schools=value},selected:()=>selected};",context);
  context.ui.setSchools(["alpha-school","beta-school"].map(schoolId=>({schoolId,displayName:schoolId,state:"draft",revision:1,compatibilityMode:"legacy_allowed"})));
  return {ui:context.ui,nodes,requests,pending};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test("switching owner schools clears policy approvals, blocks pending/failed policy saves and ignores stale same-school responses",async()=>{
  const f=uiFixture(),form=f.nodes.get("owner-cutover-decisions");
  f.ui.choose("alpha-school");
  form.elements.privacyPolicyReference.value="School A policy";
  form.elements.firstAdminAcknowledged.checked=true;
  f.ui.choose("beta-school");
  assert.equal(form.elements.privacyPolicyReference.value,"");
  assert.equal(form.elements.firstAdminAcknowledged.checked,false);
  assert.equal(form.elements.privacyPolicyReference.disabled,true);
  await f.ui.submit(form,"save_cutover_decisions",{schoolId:"beta-school"});
  assert.equal(f.requests.some(request=>request.action==="save_cutover_decisions"),false);
  f.pending.find(request=>request.data.schoolId==="beta-school").reject(Error("Connection failed"));
  await settle();
  assert.equal(form.elements.privacyPolicyReference.disabled,true);
  f.ui.choose("alpha-school");
  const alpha=f.pending.filter(request=>request.data.schoolId==="alpha-school");
  alpha[0].resolve({data:{decisions:{privacyPolicyReference:"Outdated School A policy"}}});
  await settle();
  assert.equal(form.elements.privacyPolicyReference.value,"");
  assert.equal(form.elements.privacyPolicyReference.disabled,true);
  alpha[1].resolve({data:{decisions:{privacyPolicyReference:"Current School A policy"}}});
  await settle();
  assert.equal(form.elements.privacyPolicyReference.value,"Current School A policy");
  assert.equal(form.elements.privacyPolicyReference.disabled,false);
});

test("owner mutations reject mismatched form scope and veto school switches until the mutation finishes",async()=>{
  const f=uiFixture(),form=f.nodes.get("owner-grant");
  f.ui.choose("alpha-school");
  await f.ui.submit(form,"grant_school_admin",{schoolId:"beta-school"});
  assert.equal(f.requests.some(request=>request.action==="grant_school_admin"),false);
  const saving=f.ui.submit(form,"grant_school_admin",{schoolId:"alpha-school"});
  f.ui.choose("beta-school");
  assert.equal(f.ui.selected().schoolId,"alpha-school");
  f.pending.find(request=>request.data.action==="grant_school_admin").reject(Error("Access denied"));
  await saving;
  f.ui.choose("beta-school");
  assert.equal(f.ui.selected().schoolId,"beta-school");
});

test("global governance role creation remains independent of school-scoped form bindings",async()=>{
  const f=uiFixture();
  f.ui.choose("alpha-school");
  await f.ui.submit(f.nodes.get("owner-governance-create"),"create_governance_role",{roleId:"data-steward"});
  assert.equal(f.requests.some(request=>request.action==="create_governance_role"),true);
});
