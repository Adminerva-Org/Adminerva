import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const source=readFileSync(new URL("../functions/assessment-personalization-planning.js",import.meta.url),"utf8");

function createPlanner(){
  class TenantAccessError extends Error{constructor(code,message){super(message);this.code=code;}}
  const module={exports:{}};
  const requireMock=name=>{
    if(name==="firebase-admin/firestore")return {FieldPath:{documentId:()=> "__name__"}};
    if(name==="./school-academics.js")return {
      checkId:(id)=>{if(typeof id!=="string"||!id)throw new TenantAccessError("invalid-argument","Invalid ID");return id;},
      rowKey:(uid,offeringId)=>uid+"_"+offeringId
    };
    if(name==="./tenant-access.js")return {TenantAccessError};
    throw Error("Unexpected module "+name);
  };
  vm.runInNewContext(source,{module,require:requireMock,console},{filename:"assessment-personalization-planning.js"});
  return module.exports.planPersonalizationForOfferings;
}
function makeDb(rosters={},assigned=["a","b"]){
  const docs=new Map();
  for(const id of ["a","b","c"]){
    docs.set("schools/s1/course_offerings/"+id,{schoolId:"s1",status:"active"});
    if(assigned.includes(id))
      docs.set("schools/s1/staff_assignments/teacher_"+id,{
        schoolId:"s1",status:"active",teacherUid:"teacher",offeringId:id
      });
  }
  const enrollments={};
  for(const [id,people] of Object.entries(rosters)){
    enrollments[id]=people.map((person,i)=>({
      id:"enrol-"+String(i).padStart(4,"0"),
      data:()=>({schoolId:"s1",offeringId:id,status:person.active===false?"ended":"active",personId:person.id})
    }));
    for(const person of people)
      docs.set("schools/s1/people/"+person.id,{
        schoolId:"s1",kind:person.kind||"student",status:person.status||"active"
      });
  }
  const db={
    doc(path){return {async get(){
      const value=docs.get(path);return {exists:!!value,data:()=>value};
    }};},
    collection(path){
      assert.equal(path,"schools/s1/enrollments");
      return {
        where(field,operator,id){
          assert.equal(field,"offeringId");assert.equal(operator,"==");
          const rows=enrollments[id]||[];
          return {orderBy(){
            let cursor=null;
            const paged={limit(size){
              const slice=cursor===null?rows:rows.slice(rows.findIndex(row=>row.id===cursor.id)+1);
              return {startAfter(previous){cursor=previous;return paged.limit(size);},
                async get(){const docs=slice.slice(0,size);return {docs,size:docs.length};}};
            }};
            return paged;
          }};
        }
      };
    },
    async getAll(...refs){
      return Promise.all(refs.map(r=>r.get()));
    }
  };
  return db;
}
const plan=createPlanner();
const context={schoolId:"s1",teacherUid:"teacher",platformOverride:false};

test("target follows largest class, not sum of separately deployed classes",async()=>{
  const rows=(count,prefix)=>Array.from({length:count},(_,i)=>({id:prefix+i}));
  const result=await plan({...context,db:makeDb({a:rows(12,"a"),b:rows(24,"b")}),offeringIds:["a","b"]});
  assert.equal(result.largestClass,24);
  assert.equal(result.totalStudents,36);
  assert.equal(result.requiredVariants,24);
  assert.equal(result.uniqueness,"within_deployment");
});
test("active official student roster is deduplicated and minimum pool is ten",async()=>{
  const result=await plan({...context,db:makeDb({a:[
    {id:"x"},{id:"x"},{id:"y",active:false},{id:"z",kind:"staff"},{id:"w",status:"inactive"}]}),
    offeringIds:["a"]});
  assert.equal(result.largestClass,1);
  assert.equal(result.requiredVariants,10);
});
test("unassigned class is rejected before roster is disclosed",async()=>{
  await assert.rejects(
    plan({...context,db:makeDb({c:[{id:"c"}]}),offeringIds:["c"]}),
    error=>error.code==="permission-denied"
  );
});
test("duplicated class ID is not double counted",async()=>{
  await assert.rejects(
    plan({...context,db:makeDb({a:[{id:"a"}]}),offeringIds:["a","a"]}),
    error=>error.code==="invalid-argument"
  );
});
test("class beyond 600 active enrolled people is rejected",async()=>{
  const rows=Array.from({length:601},(_,i)=>({id:"student"+i}));
  await assert.rejects(
    plan({...context,db:makeDb({a:rows}),offeringIds:["a"]}),
    error=>error.code==="resource-exhausted"
  );
});
