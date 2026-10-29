import test from "node:test";
import assert from "node:assert/strict";
import {executeAdminervaSql,validateAdminervaDb} from "./adminerva-db.mjs";

const initial=()=>({tables:{},history:[]});
const run=(db,sql)=>executeAdminervaSql(db,sql);
const created=()=>run(initial(),"CREATE TABLE students (id INTEGER PRIMARY KEY, name TEXT, grade INTEGER)").db;

test("Adminerva DB keeps escaped apostrophes, commas and quotes in row values",()=>{
  let db=created();
  db=run(db,"INSERT INTO students (id, name, grade) VALUES (1, 'O''Reilly, Ana', 12)").db;
  const selected=run(db,"SELECT name, grade FROM students WHERE id = 1");
  assert.deepEqual(selected.rows,[["O'Reilly, Ana",12]]);
  assert.equal(db.tables.students.rows[0].name,"O'Reilly, Ana");
});

test("primary keys are unique and cannot be changed to duplicates or NULL",()=>{
  let db=created();
  db=run(db,"INSERT INTO students (id, name, grade) VALUES (1, 'Ana', 11)").db;
  db=run(db,"INSERT INTO students (id, name, grade) VALUES (2, 'Ben', 12)").db;
  assert.throws(()=>run(db,"INSERT INTO students (id, name, grade) VALUES (1, 'Copy', 13)"),/Primary key/);
  assert.throws(()=>run(db,"INSERT INTO students (name, grade) VALUES ('No ID', 13)"),/cannot be NULL/);
  assert.throws(()=>run(db,"UPDATE students SET id = 1 WHERE id = 2"),/Primary key/);
  assert.throws(()=>run(db,"UPDATE students SET id = NULL WHERE id = 2"),/cannot be NULL/);
  assert.deepEqual(db.tables.students.rows.map(row=>row.id),[1,2]);
  assert.equal(db.history.filter(row=>row.type==="UPDATE").length,0);
});

test("invalid SQL columns and duplicate assignments fail without altering the table",()=>{
  let db=created();
  db=run(db,"INSERT INTO students (id, name, grade) VALUES (1, 'Ana', 11)").db;
  const snapshot=JSON.stringify(db);
  const bad=[
    "SELECT * FROM students WHERE missing = 1",
    "UPDATE students SET grade = 12 WHERE missing = 1",
    "DELETE FROM students WHERE missing = 1",
    "INSERT INTO students (id, id) VALUES (2, 3)",
    "UPDATE students SET grade = 14, grade = 15 WHERE id = 1"
  ];
  for(const sql of bad)assert.throws(()=>run(db,sql));
  assert.equal(JSON.stringify(db),snapshot);
});

test("schema definitions reject repeated column names and multiple primary keys",()=>{
  assert.throws(()=>run(initial(),"CREATE TABLE invalid (id INTEGER, id TEXT)"),/unique/);
  assert.throws(()=>run(initial(),"CREATE TABLE invalid (id INTEGER PRIMARY KEY, other INTEGER PRIMARY KEY)"),/one primary-key/);
});

test("UPDATE and DELETE preserve ordinary row operations and history",()=>{
  let db=created();
  db=run(db,"INSERT INTO students (id, name, grade) VALUES (1, 'Ana', 11)").db;
  db=run(db,"INSERT INTO students (id, name, grade) VALUES (2, 'Ben', 12)").db;
  const updated=run(db,"UPDATE students SET grade = 13 WHERE id = 2");
  assert.equal(updated.affected,1);
  assert.equal(updated.db.tables.students.rows[1].grade,13);
  const removed=run(updated.db,"DELETE FROM students WHERE id = 1");
  assert.equal(removed.affected,1);
  assert.deepEqual(run(removed.db,"SELECT id FROM students").rows,[[2]]);
});

test("import preflight rejects malformed database metadata before editors render it",()=>{
  const valid=created();
  valid.tables.students.rows.push({id:1,name:"Ana",grade:11});
  assert.equal(validateAdminervaDb(valid),true);
  for(const table of [
    {...valid.tables.students,columns:[{name:"id",type:"INTEGER",primaryKey:true},{name:"id",type:"TEXT"}]},
    {...valid.tables.students,rows:[{id:1,name:"Ana",grade:11},{id:1,name:"Copy",grade:12}]},
    {...valid.tables.students,rows:[{id:1,name:{nested:"value"},grade:11}]},
    {...valid.tables.students,rows:[{id:1,name:"Ana",extra:"hidden"}]}
  ])assert.throws(()=>validateAdminervaDb({tables:{students:table},history:[]},{strictPrimaryKeys:true}));
  // Legacy projects with old duplicate IDs must remain editable so the
  // learner can repair them; newly imported metadata uses strict validation.
  const legacy={tables:{students:{...valid.tables.students,rows:[
    {id:1,name:"Ana",grade:11},{id:1,name:"Duplicate old record",grade:12}
  ]}},history:[]};
  assert.equal(validateAdminervaDb(legacy),true);
  assert.throws(()=>validateAdminervaDb(legacy,{strictPrimaryKeys:true}),/Duplicate primary key/);
  assert.throws(()=>validateAdminervaDb({tables:{},history:"bad"}));
  assert.throws(()=>validateAdminervaDb({tables:{students:valid.tables.students},history:[]},{maxTables:0}));
});
