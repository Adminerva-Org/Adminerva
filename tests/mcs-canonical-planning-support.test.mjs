import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);

const {
  safeId,parseYearTerm,referenceText,convertReferenceFolder,
  scheduleVersion,convertSchedule,sharedLegacyObservations
}=require("../functions/mcs-canonical-planning-support-plan.js");
const {scheduleId}=require("../functions/school-schedules.js");
const {validateFolder}=require("../functions/mcs-canonical-planning-support-apply.js");

test("safe legacy reference folder IDs are preserved to keep lesson references valid",()=>{
 assert.equal(safeId("folder_ABC-123"),true);
 const result=convertReferenceFolder({
  id:"folder_ABC-123",path:"legacy/folder",
  data:{name:"Programming references",documents:[
   {title:"Guide",text:"Reference text"}
  ]},nestedDocuments:[]
 },"teacher_1");
 assert.equal(result.folder.folderId,"folder_ABC-123");
 assert.equal(result.folder.documents.length,1);
 assert.equal(result.reviewItems.length,0);
});
test("unsafe folder IDs are remapped and explicitly reviewed",()=>{
 const result=convertReferenceFolder({
  id:"unsafe/folder",path:"legacy/folder",data:{name:"Refs",documents:[]},nestedDocuments:[]
 },"teacher_1");
 assert.notEqual(result.folder.folderId,"unsafe/folder");
 assert.equal(result.reviewItems[0].type,"reference_folder_id_remapped");
});
test("inline and nested duplicate reference text becomes one canonical document",()=>{
 const result=convertReferenceFolder({
  id:"folder1",path:"legacy/folder",
  data:{name:"Refs",documents:[{title:"Same",text:"Identical extracted text"}]},
  nestedDocuments:[{id:"doc1",path:"legacy/folder/documents/doc1",
    data:{title:"Same",text:"Identical extracted text"}}]
 },"teacher_1");
 assert.equal(result.folder.documents.length,1);
 assert.equal(result.reviewItems.some(item=>item.type==="reference_document_duplicate_content"),true);
});
test("raw PDF payloads are blocked while extracted text remains eligible",()=>{
 assert.equal(referenceText({title:"PDF",text:"Extracted",sourceType:"pdf"}).ok,true);
 assert.equal(referenceText({title:"PDF",text:"Extracted",pdfBase64:"AAAA"}).reason,
  "reference_raw_pdf_requires_review");
});
test("legacy schedule scope resolves fields or canonical document ID",()=>{
 assert.deepEqual(parseYearTerm({school_year:"2026-2027",semester:"S2"},"x"),
  {year:"2026-2027",semester:"S2"});
 assert.deepEqual(parseYearTerm({},"master_schedule_SY20262027_S1"),
  {year:"2026-2027",semester:"S1"});
});
test("schedule conversion enforces approved teacher section/subject pairs",()=>{
 const allowed=new Set(["ict a\0programming"]);
 const row={id:"master_schedule_SY20262027_S1",path:"legacy/schedule",
  data:{version:1,school_year:"2026-2027",semester:"S1",
   json_data:JSON.stringify([{type:"class",startTime:"08:00",endTime:"09:00",
    mon:{sec:"ICT A",sub:"Programming"},tue:{sec:"",sub:""},wed:{sec:"",sub:""},
    thu:{sec:"",sub:""},fri:{sec:"",sub:""}}])},revisions:[]};
 const converted=convertSchedule(row,"teacher_1",allowed);
 assert.equal(converted.ok,true);
 assert.equal(converted.schedule.scheduleId,scheduleId("teacher_1","2026-2027","S1"));
 const denied=convertSchedule(row,"teacher_1",new Set());
 assert.equal(denied.ok,false);
 assert.equal(denied.reason,"schedule_assignment_validation_failed");
});
test("planning-support ledger reports old shared sources without assigning them to teachers",()=>{
 const result=sharedLegacyObservations({
  schema:"adminerva-v4-mcs-dryrun-v1",schoolId:"mcs-manila",
  entries:[
   {sourcePath:"reference_folders/shared1"},
   {sourcePath:"app_config/master_schedule"},
   {sourcePath:"app_config/master_schedule_SY20262027_S2"},
   {sourcePath:"students/S1"}
  ]
 });
 assert.equal(result.sharedReferenceDocuments,1);
 assert.equal(result.sharedScheduleDocuments,2);
});
test("reference apply validation refuses oversized or shared-state folders",()=>{
 const folder={folderId:"folder1",ownerUid:"teacher_1",name:"Refs",status:"active",
  revision:1,documentCount:1,documents:[{
   documentId:"doc1",folderId:"folder1",ownerUid:"teacher_1",title:"Guide",
   text:"Reference",sourceType:"text",status:"active",revision:1
  }]};
 assert.doesNotThrow(()=>validateFolder(folder));
 assert.throws(()=>validateFolder({...folder,documentCount:2}));
});
