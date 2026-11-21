import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";

const require=createRequire(import.meta.url);
const {activeRoles}=require("../functions/tenant-access.js");
const {roleHome,workspaceHome}=await import("../js/core/session-destination-v4-pilot.mjs");
const {buildNavigationIA}=await import("../js/core/navigation-ia.mjs");

const tenant=readFileSync(new URL("../functions/tenant-access.js",import.meta.url),"utf8");
const people=readFileSync(new URL("../functions/people-directory.js",import.meta.url),"utf8");
const enrollment=readFileSync(new URL("../functions/school-enrollment.js",import.meta.url),"utf8");
const records=readFileSync(new URL("../functions/school-student-records.js",import.meta.url),"utf8");
const guard=readFileSync(new URL("../js/core/auth-guard-v4-pilot.js",import.meta.url),"utf8");
const peopleUi=readFileSync(new URL("../js/school-admin/people-access.mjs",import.meta.url),"utf8");
const workflow=readFileSync(new URL("../js/school-admin/workflow-shell.mjs",import.meta.url),"utf8");

test("Registrar is a verified school membership role",()=>{
  assert.deepEqual(activeRoles({status:"active",roles:["registrar","teacher","unknown"]}).sort(),["registrar","teacher"]);
  assert.match(tenant,/VALID_ROLES=new Set\(\["student","teacher","registrar","school_admin"\]\)/);
});

test("Registrar is granted only through canonical staff-bound access workflows",()=>{
  assert.match(people,/\["student","teacher","registrar"\]\.includes\(role\)/);
  assert.match(people,/\["teacher","registrar"\]\.includes\(role\)/);
  assert.match(people,/registrar_role_person_kind_mismatch/);
  assert.match(people,/role=String\(input\.role\|\|"teacher"\)/);
  assert.match(people,/requestedRole\)\)/);
});

test("Enrollment and Student Records accept School Admin or Registrar with live membership recheck",()=>{
  assert.match(enrollment,/roles:\["school_admin","registrar"\]/);
  assert.match(enrollment,/roles\.some\(role=>\["school_admin","registrar"\]\.includes\(role\)\)/);
  assert.match(records,/roles:\["school_admin","registrar"\]/);
  assert.match(records,/roles\.some\(role=>\["school_admin","registrar"\]\.includes\(role\)\)/);
});

test("People & Access remains School Admin-only",()=>{
  assert.match(peopleUi,/if\(!scope\.current\?\.roles\.includes\("school_admin"\)\)/);
  assert.doesNotMatch(peopleUi,/roles\.some\(role=>\["school_admin","registrar"\]/);
});

test("Registrar session home is Enrollment and cached routing stays within SIS",()=>{
  assert.equal(roleHome("registrar"),"school-enrollment.html");
  assert.equal(workspaceHome({
    platformAdmin:false,role:null,schoolAdmin:false,schoolRegistrar:true,
    schoolTeacher:false,schoolStudent:false,students:[]
  }),"school-enrollment.html");
});

test("auth guard admits Registrar but blocks wider School Admin pages",()=>{
  assert.match(guard,/hasVerifiedV4Role=Boolean\(access\.platformAdmin\|\|access\.schoolAdmin\|\|access\.schoolRegistrar/);
  assert.match(guard,/else if\(access\.schoolRegistrar\)actualRole="registrar"/);
  assert.match(guard,/\(school-enrollment\|school-student-records\)/);
  assert.match(guard,/access\.schoolAdmin\|\|access\.schoolRegistrar\|\|admittedRole==="admin"/);
  assert.match(guard,/actualRole==="registrar"[\s\S]*school-enrollment\|school-student-records\|settings\|issues\|join-school\|wiki/);
  const registrarBlock=guard.slice(guard.indexOf('if(actualRole==="registrar"'),
    guard.indexOf('if(actualRole==="platformowner"'));
  assert.doesNotMatch(registrarBlock,/people-access|school-grading-schemes|school-class-records|school-academic-configuration/);
});

test("Registrar global navigation contains only the Registrar SIS workspace when not also a teacher/admin",()=>{
  const previousLocation=globalThis.location,previousStorage=globalThis.sessionStorage;
  globalThis.location={pathname:"/school-enrollment.html",search:""};
  globalThis.sessionStorage={getItem:()=>""};
  try{
    const ia=buildNavigationIA({
      isStudent:false,isSuperAdmin:false,isSchoolAdmin:false,isRegistrar:true,isPlatformOwner:false,
      hasSchoolTeacher:false,hasSchoolStudent:false,v4OnlyTeacher:false,v4OnlyStudent:false,platformTestMode:false
    });
    assert.equal(ia.registrarView,true);
    assert.equal(ia.roleLabel,"Registrar");
    assert.equal(ia.homeRoute,"school-enrollment.html");
    assert.deepEqual(ia.workspaces.map(item=>item.id),["registrar"]);
    const routes=ia.workspaces[0].groups.flatMap(group=>group.items.map(item=>item[2]).filter(Boolean));
    assert.ok(routes.includes("school-enrollment.html"));
    assert.ok(routes.includes("school-student-records.html"));
    assert.ok(!routes.includes("people-access.html"));
    assert.ok(!routes.includes("school-grading-schemes.html"));
  }finally{
    globalThis.location=previousLocation;globalThis.sessionStorage=previousStorage;
  }
});

test("shared workflow shell collapses Registrar navigation to Enrollment and Student Records",()=>{
  assert.match(workflow,/registrarOnly=roles\.includes\("registrar"\)&&!roles\.includes\("school_admin"\)/);
  assert.match(workflow,/items\.filter\(item=>\["enrollment","student-records"\]\.includes\(item\.key\)\)/);
  assert.match(workflow,/Registrar workflow/);
});
