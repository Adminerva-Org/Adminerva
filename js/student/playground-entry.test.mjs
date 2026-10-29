import test from "node:test";
import assert from "node:assert/strict";
import {chooseCompilerEntry} from "./playground-entry.mjs";
const main='package app; public class Main { public static void main(String[] args) {} }';
test("Java information system runs its Main class, not whichever model file is open",()=>{
 const files={"src/app/Main.java":main,"src/model/Record.java":"package model; public class Record {}"};
 const order=Object.keys(files);
 assert.equal(chooseCompilerEntry({language:"java",defaultFile:"Main.java",activeFilename:"src/model/Record.java",fileOrder:order,files}),"src/app/Main.java");
});
test("multiple runnable Java classes prefer the actively selected main entry",()=>{
 const files={"Main.java":main,"Demo.java":"class Demo { public static void main(String... args) {} }","Student.java":"class Student {}"};
 assert.equal(chooseCompilerEntry({language:"java",defaultFile:"Main.java",activeFilename:"Demo.java",fileOrder:Object.keys(files),files}),"Demo.java");
 assert.equal(chooseCompilerEntry({language:"java",defaultFile:"Main.java",activeFilename:"Student.java",fileOrder:Object.keys(files),files}),"Main.java");
});
test("Python and Java no-main fallback retain normal entry selection",()=>{
 const files={"src/helper.py":"print(1)","src/main.py":"print(2)"};
 assert.equal(chooseCompilerEntry({language:"python",defaultFile:"main.py",activeFilename:"src/helper.py",fileOrder:Object.keys(files),files}),"src/helper.py");
 assert.equal(chooseCompilerEntry({language:"java",defaultFile:"Main.java",activeFilename:"Utility.java",fileOrder:["Utility.java"],files:{"Utility.java":"class Utility {}"}}),"Utility.java");
 assert.equal(chooseCompilerEntry({language:"java",defaultFile:"Main.java",activeFilename:"",fileOrder:[],files:{}}),null);
});
