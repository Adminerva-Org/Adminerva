import test from "node:test";
import assert from "node:assert/strict";
import {analyzeProjectEvidence,maskJava,evidenceSnippet} from "../js/student/project-competency-evidence.mjs";
const get=(project,id)=>analyzeProjectEvidence(project).checks.find(x=>x.id===id);
test("Java strings, comments and text blocks do not count as source evidence",()=>{
  const project={state:{files:{"Main.java":'// class Fake extends Base {}\nString note="extends implements @Override";\n/* public void run(int a){} */\nString message="""Thread Runnable""";'}}};
  for(const id of ["classes","inheritance","overriding","threads","overloading"])assert.equal(get(project,id).detected,false,id);
  assert.equal(maskJava('String text="class Fake";\nclass Real {}').includes('class Fake'),false);
});
test("OOP syntax is reported individually, with source locations but not grades",()=>{
 const java=['abstract class Record {}','interface Printable {}',
 'class Student extends Record implements Printable {','private String name;',
 'public String getName(){ return name; }',
 '@Override public String toString(){ return name; }',
 'public void output(int amount){}','public void output(String text){}',
 'void sample(){ Record item = new Student(); }','}'].join("\n");
 const project={state:{files:{"Student.java":java}},database:{history:[]}};
 for(const id of ["classes","encapsulation","inheritance","abstraction","interfaces","overriding","overloading","references"])
   assert.equal(get(project,id).detected,true,id);
 assert.equal(get(project,"inheritance").locations[0].file,"Student.java");
 assert.ok(get(project,"overloading").locations.length>=2);
 assert.equal(get(project,"crud").detected,false);
});
test("different classes or variable names alone do not establish overloading",()=>{
 const java='class A {public void run(int value){} public void run(int other){}}\nclass B {public void run(String value){}}';
 assert.equal(get({state:{files:{"A.java":java}}},"overloading").detected,false);
});
test("Adminerva CRUD evidence comes from recorded operations, not a Java string",()=>{
 const project={state:{files:{"Main.java":'String sql="INSERT SELECT UPDATE DELETE";'}},
   database:{history:["INSERT","SELECT","UPDATE","DELETE"].map(type=>({type}))},
   design:{classDiagram:"classDiagram\nA --> B"}};
 assert.equal(get(project,"crud").detected,true);
 assert.equal(get(project,"design").detected,true);
 assert.equal(get(project,"jdbc").detected,false);
});

test("source evidence includes a direct, bounded excerpt and correct original line",()=>{
  const source=["class Person {}","// class Fake extends Person {}","class Student extends Person {",
    "  private int number;","  @Override public String toString(){ return \"Student\"; }","}"].join("\n");
  const project={state:{files:{"src/Student.java":source}}};
  const item=analyzeProjectEvidence(project).checks.find(row=>row.id==="inheritance");
  assert.equal(item.matchCount,1);
  assert.deepEqual(item.locations.map(loc=>({file:loc.file,line:loc.line})),
    [{file:"src/Student.java",line:3}]);
  assert.match(item.feedback,/Verify/);
  const snippet=evidenceSnippet(project.state,item.locations[0]);
  assert.deepEqual(snippet.map(line=>line.line),[2,3,4]);
  assert.match(snippet.find(line=>line.focus).code,/class Student extends Person/);
});
test("wide source lines stay bounded but include the matched token",()=>{
  const source=" ".repeat(450)+"class Record {}";
  const project={state:{files:{"Wide.java":source}}};
  const match=analyzeProjectEvidence(project).checks.find(row=>row.id==="classes").locations[0];
  const snippet=evidenceSnippet(project.state,match,{context:0,maxChars:120});
  assert.equal(snippet.length,1);
  assert.ok(snippet[0].code.length<=122);
  assert.match(snippet[0].code,/class Record/);
});
test("partial SQL history supplies inspectable activity without a false complete CRUD check",()=>{
  const project={state:{files:{"Main.java":"class Main {}"}},
    database:{history:[{type:"SELECT",sql:"SELECT * FROM grades",at:"2026-11-20T09:00:00Z"},
      {type:"INSERT",sql:"INSERT INTO grades VALUES (1)",at:"2026-11-20T09:01:00Z"}]}};
  const item=analyzeProjectEvidence(project).checks.find(row=>row.id==="crud");
  assert.equal(item.detected,false);
  assert.equal(item.matchCount,2);
  assert.equal(item.locations.find(x=>x.label==="SELECT").sql,"SELECT * FROM grades");
  assert.ok(item.feedback.length>15);
});
