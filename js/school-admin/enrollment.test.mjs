import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

// Run the actual enrollment controller with a small DOM/callable adapter.
function harness(){
  class Element{
    constructor(){this.value="";this.children=[];this.listeners={};this.style={};this.disabled=false;this.hidden=false;this.open=false;this.textContent="";}
    replaceChildren(...items){this.children=[];this.append(...items);}
    append(...items){this.children.push(...items);for(const item of items)if(item.selected)this.value=item.value;}
    addEventListener(type,callback){(this.listeners[type]??=[]).push(callback);}
    dispatch(type){for(const callback of this.listeners[type]||[])callback({preventDefault(){},currentTarget:this,target:this});}
    setAttribute(){}
    scrollIntoView(){}
    focus(){}
    select(){}
    showModal(){this.open=true;}
    close(){this.open=false;}
    reportValidity(){return true;}
    querySelectorAll(){return this.children.flatMap(item=>item.querySelectorAll?.()||[]);}
  }
  const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
  const form=get("en-register-form"),fields=["applicationId","personId","displayName","birthDate","studentNumber","guardianName","guardianRelationship","guardianEmail","guardianMobile","studentEmail","studentEmailType","yearId","programId","termId","sectionId"];
  form.elements=fields.map(name=>{const node=new Element();node.name=name;return node;});
  for(const field of form.elements)form.elements[field.name]=field;
  form.reset=()=>{for(const field of form.elements)field.value="";};
  const changeForm=get("en-registration-change-form"),changeFields=["reason","sectionId","endReasonType"];
  changeForm.elements=changeFields.map(name=>{const node=new Element();node.name=name;return node;});
  for(const field of changeForm.elements)changeForm.elements[field.name]=field;
  changeForm.reset=()=>{for(const field of changeForm.elements)field.value="";};
  changeForm.reportValidity=()=>true;
  const progressionForm=get("en-progression-form"),
    progressionFields=["progressionType","targetYearId","targetProgramId","targetTermId","targetSectionId","reason"];
  progressionForm.elements=progressionFields.map(name=>{const node=new Element();node.name=name;return node;});
  for(const field of progressionForm.elements)progressionForm.elements[field.name]=field;
  progressionForm.reset=()=>{for(const field of progressionForm.elements)field.value="";};
  progressionForm.reportValidity=()=>true;
  const cohortForm=get("en-cohort-form"),
    cohortFields=["sourceYearId","sourceTermId","sourceSectionId","progressionType","targetYearId","targetProgramId","targetTermId","targetSectionId","reason"];
  cohortForm.elements=cohortFields.map(name=>{const node=new Element();node.name=name;return node;});
  for(const field of cohortForm.elements)cohortForm.elements[field.name]=field;
  cohortForm.reset=()=>{for(const field of cohortForm.elements)field.value="";};
  cohortForm.reportValidity=()=>true;
  const actionButton=new Element(),requests=[];
  let allowDiscard=true,pickerOptions;
  const scope={lease:()=>({schoolId:"manila-cathedral-school",uid:"admin"}),assertLease(){}};
  const context=vm.createContext({
    app:{},auth:{currentUser:{uid:"admin"}},getFunctions:()=>({}),
    httpsCallable:()=>payload=>new Promise((resolve,reject)=>requests.push({payload,resolve:data=>resolve({data}),reject})),
    createTenantSchoolPicker:options=>{pickerOptions=options;return {scope};},
    document:{getElementById:get,createElement:()=>new Element(),querySelectorAll:()=>[actionButton]},
    location:{href:"https://example.test/school-enrollment.html"},URL,
    Option:class extends Element{constructor(label,value){super();this.textContent=label;this.value=value;}},
    sessionStorage:{getItem:()=>null},navigator:{},prompt:()=>"Verified review reason",confirm:()=>allowDiscard,
    FormData:class{constructor(target){this.target=target;}get(name){return this.target.elements?.[name]?.value??"";}}
  });
  let source=readFileSync(new URL("./enrollment.mjs",import.meta.url),"utf8").replace(/^import .*;\r?$/gm,"");
  source=source.slice(0,source.lastIndexOf("\ntry{"));
  vm.runInContext(source+"\nglobalThis.setCatalog=value=>catalog=value;",context);
  const catalog={years:[{id:"new-year"},{id:"old-year"}],programs:[{id:"new-program"},{id:"old-program"}],
    terms:[{id:"new-period",yearId:"new-year",programId:"new-program"},{id:"other-period",yearId:"new-year",programId:"new-program"}],
    sections:[{id:"new-section",programId:"new-program",gradeLevel:"7"},{id:"other-section",programId:"new-program",gradeLevel:"7"}],
    subjects:[{id:"auto-subject",name:"Automatic"},{id:"elective-subject",name:"Elective"}],
    offerings:[
      {offeringId:"auto-offering",yearId:"new-year",programId:"new-program",termId:"new-period",sectionId:"other-section",subjectId:"auto-subject",rosterMode:"section"},
      {offeringId:"elective-offering",yearId:"new-year",programId:"new-program",termId:"new-period",sectionId:"other-section",subjectId:"elective-subject",rosterMode:"selective"}
    ]};
  context.setCatalog(catalog);
  const applicant={applicationId:"app-new",reference:"MCS-NEW",displayName:"New student",birthDate:"2013-03-01",guardianEmail:"new.parent@example.test",incomingLevel:"7",yearId:"new-year",preferredProgramId:"new-program"};
  return {context,form,get,applicant,requests,actionButton,setDiscard:value=>{allowDiscard=value;},get pickerOptions(){return pickerOptions;}};
}

test("reviewing a different applicant clears the previous student's number and placement",()=>{
  const h=harness();
  for(const name of ["studentNumber","yearId","programId","termId","sectionId"])h.form.elements[name].value="previous-"+name;
  h.context.loadApplicationIntoForm(h.applicant);
  assert.equal(h.form.elements.applicationId.value,"app-new");
  assert.equal(h.form.elements.studentNumber.value,"");
  assert.equal(h.form.elements.yearId.value,"new-year");
  assert.equal(h.form.elements.programId.value,"new-program");
  assert.equal(h.form.elements.termId.value,"");
  assert.equal(h.form.elements.sectionId.value,"");
});

test("canceling replacement preserves the unsaved student's identity",()=>{
  const h=harness();
  h.form.elements.displayName.value="Walk-in student";
  h.form.elements.studentNumber.value="ONSITE-001";
  h.form.dispatch("input");h.setDiscard(false);
  h.context.loadApplicationIntoForm(h.applicant);
  assert.equal(h.form.elements.displayName.value,"Walk-in student");
  assert.equal(h.form.elements.studentNumber.value,"ONSITE-001");
  assert.equal(h.form.elements.applicationId.value,"");
});

test("saving locks identity edits and applicant selection until completion",()=>{
  const h=harness();h.form.elements.displayName.value="Saving student";
  h.context.setSaving(true);
  assert.equal(h.form.elements.every(field=>field.disabled),true);
  assert.equal(h.actionButton.disabled,true);
  h.context.loadApplicationIntoForm(h.applicant);
  assert.equal(h.form.elements.displayName.value,"Saving student");
  h.context.setSaving(false);
  assert.equal(h.form.elements.every(field=>!field.disabled),true);
  assert.equal(h.actionButton.disabled,false);
});

test("an older enrollment reload cannot replace newer data or show a stale failure",async()=>{
  const h=harness();
  const old=h.context.latest("applications","list_applications");
  const recent=h.context.latest("applications","list_applications");
  h.requests[1].resolve({items:[{applicationId:"newest"}]});
  assert.equal((await recent).items[0].applicationId,"newest");
  h.requests[0].reject(new Error("Old request failed"));
  assert.equal(await old,null);
});

test("starting an enrollment save invalidates in-flight catalog reloads",async()=>{
  const h=harness(),pending=h.context.latest("catalog","catalog");
  h.context.setSaving(true);
  h.requests[0].resolve({years:[{id:"outdated"}]});
  assert.equal(await pending,null);
});

test("school switching veto preserves the draft, then accepted switching clears private data",async()=>{
  const h=harness();h.context.loadApplicationIntoForm(h.applicant);
  h.form.elements.studentNumber.value="DRAFT-7";h.form.dispatch("input");h.setDiscard(false);
  await assert.rejects(h.pickerOptions.onBeforeChange(),/unsaved enrollment/);
  assert.equal(h.form.elements.applicationId.value,"app-new");
  h.setDiscard(true);await h.pickerOptions.onBeforeChange();
  assert.equal(h.form.elements.applicationId.value,"");
  assert.equal(h.form.elements.studentNumber.value,"");
  assert.equal(h.get("en-workspace").hidden,true);
});


test("section-change preview excludes selective offerings",()=>{
  const h=harness(),item={
    registrationId:"reg-1",personId:"person-1",displayName:"Student One",
    yearId:"new-year",programId:"new-program",termId:"new-period",sectionId:"new-section",
    gradeLevel:"7",revision:4,status:"active",courseCount:1
  };
  assert.equal(h.context.automaticOfferings(item,"other-section").length,1);
  h.context.openRegistrationChange(item,"move");
  const section=h.get("en-registration-change-form").elements.sectionId;
  section.value="other-section";section.dispatch("change");
  assert.match(h.get("en-registration-change-preview").textContent,/1 automatic class/);
  assert.doesNotMatch(h.get("en-registration-change-preview").textContent,/Elective/);
});

test("section change sends the reviewed registration revision",()=>{
  const h=harness(),item={
    registrationId:"reg-1",personId:"person-1",displayName:"Student One",
    yearId:"new-year",programId:"new-program",termId:"new-period",sectionId:"new-section",
    gradeLevel:"7",revision:7,status:"active",courseCount:1
  };
  h.context.openRegistrationChange(item,"move");
  const change=h.get("en-registration-change-form");
  change.elements.sectionId.value="other-section";
  change.elements.sectionId.dispatch("change");
  change.elements.reason.value="Correct section assignment after registrar review";
  change.dispatch("submit");
  assert.equal(h.requests.length,1);
  assert.equal(h.requests[0].payload.action,"change_registration_section");
  assert.equal(h.requests[0].payload.registrationId,"reg-1");
  assert.equal(h.requests[0].payload.sectionId,"other-section");
  assert.equal(h.requests[0].payload.expectedRevision,7);
});


test("reviewed directory student handoff binds Enrollment to the exact person record",async()=>{
  const h=harness(),loading=h.context.loadStudentCandidate("person-7",{scroll:false});
  assert.equal(h.requests.length,1);
  assert.equal(h.requests[0].payload.action,"student_candidate");
  assert.equal(h.requests[0].payload.personId,"person-7");
  h.requests[0].resolve({
    person:{
      personId:"person-7",displayName:"Existing Student",birthDate:"2012-08-10",
      studentNumber:"S-007",guardianName:"Parent Seven",guardianRelationship:"Mother",
      guardianEmail:"parent7@example.test",guardianMobile:"+639001112222",
      studentEmailType:"personal",accountResponsibility:"student",
      accountLinked:false,activationReady:true,revision:3
    },
    activeRegistrations:[]
  });
  assert.equal(await loading,true);
  assert.equal(h.form.elements.personId.value,"person-7");
  assert.equal(h.form.elements.displayName.value,"Existing Student");
  assert.equal(h.form.elements.studentNumber.value,"S-007");
  assert.equal(h.form.elements.guardianEmail.value,"parent7@example.test");
  assert.equal(h.form.elements.applicationId.value,"");
});

test("registering a reviewed directory student sends its exact person ID",async()=>{
  const h=harness(),loading=h.context.loadStudentCandidate("person-7",{scroll:false});
  h.requests[0].resolve({
    person:{
      personId:"person-7",displayName:"Existing Student",birthDate:"2012-08-10",
      studentNumber:"S-007",guardianName:"Parent Seven",guardianRelationship:"Mother",
      guardianEmail:"parent7@example.test",guardianMobile:"",
      studentEmailType:"personal",accountResponsibility:"student",
      accountLinked:false,activationReady:false,revision:3
    },
    activeRegistrations:[]
  });
  await loading;
  h.form.elements.yearId.value="new-year";
  h.form.elements.programId.value="new-program";
  h.form.elements.termId.value="new-period";
  h.form.elements.sectionId.value="other-section";
  h.form.elements.studentEmail.value="student7@example.test";
  h.form.elements.studentEmailType.value="personal";
  h.form.dispatch("submit");
  assert.equal(h.requests.length,2);
  assert.equal(h.requests[1].payload.action,"register_student");
  assert.equal(h.requests[1].payload.personId,"person-7");
  assert.equal(h.requests[1].payload.applicationId,"");
});


test("ending a registration sends an explicit institutional end type",()=>{
  const h=harness(),item={
    registrationId:"reg-end-1",personId:"person-1",displayName:"Student End",
    yearId:"new-year",programId:"new-program",termId:"new-period",sectionId:"new-section",
    gradeLevel:"7",revision:2,status:"active",courseCount:1
  };
  h.context.openRegistrationChange(item,"end");
  const change=h.get("en-registration-change-form");
  change.elements.endReasonType.value="transfer_out";
  change.elements.reason.value="Student transferred to another institution";
  change.dispatch("submit");
  assert.equal(h.requests.length,1);
  assert.equal(h.requests[0].payload.action,"end_registration");
  assert.equal(h.requests[0].payload.registrationId,"reg-end-1");
  assert.equal(h.requests[0].payload.expectedRevision,2);
  assert.equal(h.requests[0].payload.endReasonType,"transfer_out");
});


test("restoring a registration sends the reviewed registration revision",()=>{
  const h=harness(),item={
    registrationId:"reg-restore-1",personId:"person-1",displayName:"Student Restore",
    yearId:"new-year",programId:"new-program",termId:"new-period",sectionId:"new-section",
    gradeLevel:"7",revision:5,status:"ended",courseCount:0
  };
  h.context.openRegistrationChange(item,"restore");
  const change=h.get("en-registration-change-form");
  change.elements.reason.value="Registrar approved restoration after records review";
  change.dispatch("submit");
  assert.equal(h.requests.length,1);
  assert.equal(h.requests[0].payload.action,"restore_registration");
  assert.equal(h.requests[0].payload.registrationId,"reg-restore-1");
  assert.equal(h.requests[0].payload.expectedRevision,5);
});

test("application review sends the exact application revision",()=>{
  const h=harness(),item={
    applicationId:"app-review-1",displayName:"Applicant One",revision:6,status:"submitted"
  };
  h.context.reviewApplication(item,"rejected");
  assert.equal(h.requests.length,1);
  assert.equal(h.requests[0].payload.action,"review_application");
  assert.equal(h.requests[0].payload.applicationId,"app-review-1");
  assert.equal(h.requests[0].payload.expectedRevision,6);
});


test("graduation readiness preview is revision-safe and does not invent a target placement",()=>{
  const h=harness(),item={
    registrationId:"reg-grad-1",personId:"person-12",displayName:"Graduating Student",
    yearId:"old-year",programId:"old-program",termId:"old-period",sectionId:"old-section",
    gradeLevel:"12",revision:9,status:"active",courseCount:8
  };
  h.context.openProgression(item);
  const pform=h.get("en-progression-form");
  pform.elements.progressionType.value="graduation";
  pform.elements.progressionType.dispatch("change");
  assert.equal(h.requests.length,1);
  assert.equal(h.requests[0].payload.action,"preview_progression");
  assert.equal(h.requests[0].payload.registrationId,"reg-grad-1");
  assert.equal(h.requests[0].payload.expectedRevision,9);
  assert.equal(h.requests[0].payload.progressionType,"graduation");
  assert.equal("targetSectionId" in h.requests[0].payload,false);
});
