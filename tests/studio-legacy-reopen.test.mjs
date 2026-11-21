import test from "node:test";
import assert from "node:assert/strict";
import {createHash,webcrypto} from "node:crypto";
import {verifyLegacyStudioRecovery} from "../js/student/studio-assessment-model.mjs";

globalThis.crypto ||= webcrypto;
const identity={uid:"verified-student",studentId:"student-record",assessmentId:"q3-mini-peta"};
function sample(){
  const snapshotJson=JSON.stringify({
    schemaVersion:1,lang:"java",
    files:{"Main.java":"public class Main { public static void main(String[] args) { System.out.println(42); } }"},
    fileOrder:["Main.java"],database:{tables:{}},design:{},config:{runMode:"console"}
  });
  const snapshotHash=createHash("sha256").update(snapshotJson).digest("hex");
  const head={...identity,ownerUid:identity.uid,studentId:identity.studentId,
    assessmentId:identity.assessmentId,revision:1,projectId:"original-school-bell-project",
    projectTitle:"School Bell Scheduler",snapshotHash};
  const version={...head,snapshotJson};
  return {head,version};
}
test("recovers exact original project reference and verified source without changing evidence",async()=>{
  const {head,version}=sample();
  const previous=structuredClone(version);
  const result=await verifyLegacyStudioRecovery(head,version,identity);
  assert.equal(result.projectId,head.projectId);
  assert.equal(result.projectTitle,"School Bell Scheduler");
  assert.equal(result.snapshot.files["Main.java"],JSON.parse(version.snapshotJson).files["Main.java"]);
  assert.deepEqual(version,previous);
});
test("rejects a frozen version from another student",async()=>{
  const {head,version}=sample();
  await assert.rejects(verifyLegacyStudioRecovery(head,{...version,ownerUid:"someone-else"},identity),/match/i);
});
test("rejects a submission head from another student",async()=>{
  const {head,version}=sample();
  await assert.rejects(verifyLegacyStudioRecovery({...head,studentId:"another-student"},version,identity),/student/i);
});
test("rejects corrupted or mismatched source code",async()=>{
  const {head,version}=sample();
  await assert.rejects(verifyLegacyStudioRecovery(head,{...version,snapshotJson:version.snapshotJson.replace("42","43")},identity),/integrity/i);
});
test("rejects fabricated project IDs or wrong revision",async()=>{
  const {head,version}=sample();
  await assert.rejects(verifyLegacyStudioRecovery({...head,projectId:"../../other-project"},version,identity),/student/i);
  await assert.rejects(verifyLegacyStudioRecovery(head,{...version,revision:2},identity),/match/i);
});
test("rejects blank-code snapshots",async()=>{
  const {head,version}=sample();
  const snapshot=JSON.parse(version.snapshotJson);snapshot.files["Main.java"]=" ";
  const snapshotJson=JSON.stringify(snapshot);
  const snapshotHash=createHash("sha256").update(snapshotJson).digest("hex");
  await assert.rejects(verifyLegacyStudioRecovery({...head,snapshotHash},
    {...version,snapshotHash,snapshotJson},identity),/no recoverable/i);
});
