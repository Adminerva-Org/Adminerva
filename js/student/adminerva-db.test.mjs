import test from "node:test";
import assert from "node:assert/strict";
import {executeAdminervaSql} from "./adminerva-db.mjs";

const sql=(database,statement)=>executeAdminervaSql(database,statement);
function fixture(){
  let result=sql(null,"CREATE TABLE records (id INTEGER PRIMARY KEY, name TEXT)");
  result=sql(result.db,"INSERT INTO records (id, name) VALUES (1, 'Alpha')");
  return sql(result.db,"INSERT INTO records (id, name) VALUES (2, 'Beta')").db;
}
test("visual row editor round-trips SQL-standard doubled apostrophes",()=>{
  let database=fixture();
  database=sql(database,"UPDATE records SET name = 'O''Brien' WHERE id = 1").db;
  const row=sql(database,"SELECT name FROM records WHERE id = 1");
  assert.deepEqual(row.rows,[["O'Brien"]]);
  database=sql(database,"INSERT INTO records (id, name) VALUES (3, 'Sam''s, School')").db;
  assert.deepEqual(sql(database,"SELECT name FROM records WHERE id = 3").rows,[["Sam's, School"]]);
});
test("primary keys are unique and non-null on INSERT and UPDATE",()=>{
  const database=fixture();
  for(const command of [
    "INSERT INTO records (name) VALUES ('Missing key')",
    "INSERT INTO records (id, name) VALUES (NULL, 'Null key')",
    "INSERT INTO records (id, name) VALUES (1, 'Duplicate')",
    "UPDATE records SET id = 2 WHERE id = 1",
    "UPDATE records SET id = NULL WHERE id = 1",
    "UPDATE records SET id = 4"
  ])assert.throws(()=>sql(database,command),/Primary key|primary key/);
  assert.deepEqual(database.tables.records.rows.map(row=>row.id),[1,2]);
  const updated=sql(database,"UPDATE records SET id = 3 WHERE id = 1").db;
  assert.deepEqual(updated.tables.records.rows.map(row=>row.id),[3,2]);
  assert.deepEqual(database.tables.records.rows.map(row=>row.id),[1,2],"original state must not mutate");
});
test("unknown WHERE columns fail visibly instead of silently returning no rows",()=>{
  const database=fixture();
  for(const command of [
    "SELECT * FROM records WHERE missing = 1",
    "UPDATE records SET name = 'Changed' WHERE missing = 1",
    "DELETE FROM records WHERE missing = 1"
  ])assert.throws(()=>sql(database,command),/Unknown WHERE column/);
  assert.equal(database.tables.records.rows.length,2);
});
test("invalid schema definitions and conflicting column lists are rejected",()=>{
  for(const command of [
    "CREATE TABLE records (id INTEGER PRIMARY KEY, id TEXT)",
    "CREATE TABLE records (id INTEGER PRIMARY KEY, other INTEGER PRIMARY KEY)",
    "CREATE TABLE __proto__ (id INTEGER)"
  ])assert.throws(()=>sql(null,command),/Duplicate|primary-key|reserved/);
  assert.throws(()=>sql(fixture(),"INSERT INTO records (id, id) VALUES (3, 4)"),/Duplicate INSERT/);
  assert.throws(()=>sql(fixture(),"SELECT * FROM constructor"),/does not exist/);
});

test("SQL empty string is distinct from SQL NULL",()=>{
  let database=fixture();
  database=sql(database,"INSERT INTO records (id, name) VALUES (3, '')").db;
  assert.deepEqual(sql(database,"SELECT name FROM records WHERE id = 3").rows,[[""]]);
  database=sql(database,"UPDATE records SET name = NULL WHERE id = 3").db;
  assert.deepEqual(sql(database,"SELECT name FROM records WHERE id = 3").rows,[[null]]);
});
