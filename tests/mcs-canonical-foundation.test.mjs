import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {stablePersonId,stableCatalogId,buildFoundationPlan,SCHEMA,SCHOOL_ID}=
  require("../functions/mcs-canonical-foundation-plan.js");
const {createTemplate}=require("../functions/mcs-canonical-foundation-approval-template.js");
const {validateApproval}=require("../functions/mcs-canonical-foundation-apply.js");

const sha=value=>createHash("sha256").update(value).digest("hex");

function identity(){
  return {schema:"adminerva-v4-mcs-identity-candidates-v1",schoolId:SCHOOL_ID,readOnly:true,
    grantsCreated:false,candidates:[{
      uid:"uid_student_1",legacyStudentIds:[{studentId:"S-1"}],
      legacyStaffRecordIds:[],rolesToReview:["student"],requiresManualSchoolApproval:true
    }]};
}
function rows(){
  return {students:[{id:"S-1",path:"schools/mcs-manila/legacy_roots/students/documents/S-1",
    digest:"a".repeat(64),data:{firstName:"Ana",lastName:"Santos",section:"ICT A",schoolYear:"2026-2027",status:"active"}}],
    teachers:[],assessments:[{id:"A-1",path:"schools/mcs-manila/legacy_roots/assessments/documents/A-1",
      digest:"b".repeat(64),data:{subject:"Programming",sectionIds:["ICT A"]}}]};
}
test("canonical IDs are deterministic and namespace-safe",()=>{
  assert.equal(stablePersonId("uid_student_1"),stablePersonId("uid_student_1"));
  assert.match(stablePersonId("uid_student_1"),/^mcs_[a-f0-9]{36}$/);
  assert.match(stableCatalogId("section","Grade 11 ICT A"),/^sec_[a-z0-9-]+_[a-f0-9]{8}$/);
});
test("foundation plan proposes people and roles but never authorizes them",()=>{
  const plan=buildFoundationPlan({identity:identity(),rows:rows(),
    reconciliationSha256:"r".repeat(64),identitySha256:"i".repeat(64)});
  assert.equal(plan.schema,SCHEMA);
  assert.equal(plan.people.length,1);
  assert.deepEqual(plan.memberships[0].roles,["student"]);
  assert.equal(plan.memberships[0].grantAutomatically,false);
  assert.equal(plan.readyForCanonicalApply,false);
  assert.equal(plan.blockers.length,0);
  assert.equal(plan.academicObservations.sections[0].legacyLabel,"ICT A");
});
test("unmatched legacy students remain hard blockers",()=>{
  const unmatched=rows();unmatched.students[0]={...unmatched.students[0],id:"S-UNKNOWN"};
  const plan=buildFoundationPlan({identity:identity(),rows:unmatched,
    reconciliationSha256:"r".repeat(64),identitySha256:"i".repeat(64)});
  assert.equal(plan.people.length,0);
  assert.equal(plan.blockers[0].type,"student_identity_unresolved");
});
test("approval cannot elevate a proposed student into school admin",()=>{
  const plan=buildFoundationPlan({identity:identity(),rows:rows(),
    reconciliationSha256:"r".repeat(64),identitySha256:"i".repeat(64)});
  const raw=Buffer.from(JSON.stringify(plan));
  const approval=createTemplate(plan,raw);
  approval.approvedBy="Migration reviewer";approval.approvedAt="2026-10-31T07:00:00.000Z";
  for(const key of Object.keys(approval.acknowledgements))approval.acknowledgements[key]=true;
  approval.people[0].approveIdentityLink=true;
  approval.memberships[0].approveMembership=true;
  approval.memberships[0].approvedRoles=["school_admin"];
  assert.throws(()=>validateApproval(plan,raw,approval),/student\/teacher roles only/);
});
test("approval is cryptographically bound to the exact foundation plan bytes",()=>{
  const plan=buildFoundationPlan({identity:identity(),rows:rows(),
    reconciliationSha256:"r".repeat(64),identitySha256:"i".repeat(64)});
  const raw=Buffer.from(JSON.stringify(plan));
  const approval=createTemplate(plan,raw);
  assert.equal(approval.planSha256,sha(raw));
});
