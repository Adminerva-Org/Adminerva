"use strict";
/**
 * Owner-only tenant control plane. The first platform_admins/{uid} grant MUST
 * be installed out of band by a trusted operator; never bootstrap by email.
 */
const {getAuth}=require("firebase-admin/auth");
const {createHash}=require("node:crypto");
const {FieldValue}=require("firebase-admin/firestore");
const {TenantAccessError,checkedSchoolId,verifiedUid,platformAuthority}=require("./tenant-access.js");
const {evaluateSchoolCutoverReadiness}=require("./school-cutover-readiness.js");
const {SCHEMA:CUTOVER_DECISION_SCHEMA,normalizeCutoverDecisions}=
 require("./school-cutover-policy.js");
function fail(code,message){throw new TenantAccessError(code,message)}
function phrase(value,min,max,label){
  if(typeof value!=="string"||value.trim().length<min||value.trim().length>max)
    fail("invalid-argument",label+" is missing or outside permitted length.");
  return value.trim();
}
function addSchoolAdminRole(roles){
  return [...new Set([...(Array.isArray(roles)?roles:[]),"school_admin"])];
}
function governanceRoleId(value){
  const role=String(value||"").trim().toLowerCase();
  if(!/^[a-z][a-z0-9-]{1,63}$/.test(role))
    fail("invalid-argument","Governance role ID must use 2–64 lowercase letters, digits or hyphens.");
  return role;
}
async function standardSetupStatus({db,schoolId,schoolData}){
  const prefix="schools/"+schoolId+"/";
  const firstAdminUid=schoolData.firstAdminUid||null;
  const [admin,program,year,term,subject,section,offering]=await Promise.all([
    firstAdminUid?db.doc(prefix+"memberships/"+firstAdminUid).get():Promise.resolve(null),
    db.collection(prefix+"academic_programs").where("status","==","active").limit(1).get(),
    db.collection(prefix+"academic_years").where("status","==","active").limit(1).get(),
    db.collection(prefix+"terms").where("status","==","active").limit(1).get(),
    db.collection(prefix+"subjects").where("status","==","active").limit(1).get(),
    db.collection(prefix+"sections").where("status","==","active").limit(1).get(),
    db.collection(prefix+"course_offerings").where("status","==","active").limit(1).get()
  ]);
  const firstAdminActive=Boolean(admin?.exists&&admin.data().schoolId===schoolId&&
    admin.data().status==="active"&&Array.isArray(admin.data().roles)&&
    admin.data().roles.includes("school_admin"));
  const checks=[
    {id:"school_registered",ok:true,label:"School registered",detail:"The institution tenant exists."},
    {id:"school_admin",ok:firstAdminActive,label:"School Administrator assigned",
      detail:firstAdminActive?"The first School Administrator is active.":"Assign a verified School Administrator."},
    {id:"academic_year",ok:!year.empty,label:"School year configured",detail:year.empty?"Create the school year.":"School year is configured."},
    {id:"program",ok:!program.empty,label:"Division / program configured",detail:program.empty?"Create at least one division or program.":"Division / program is configured."},
    {id:"period",ok:!term.empty,label:"Academic period configured",detail:term.empty?"Create the current quarter, term or semester.":"Academic period is configured."},
    {id:"subject",ok:!subject.empty,label:"Subject configured",detail:subject.empty?"Create at least one subject.":"Subject catalog is configured."},
    {id:"section",ok:!section.empty,label:"Section configured",detail:section.empty?"Create at least one section.":"Section catalog is configured."},
    {id:"offering",ok:!offering.empty,label:"Course offering configured",detail:offering.empty?"Connect a subject, section and academic period in a course offering.":"At least one course offering is configured."}
  ];
  return {schoolId,ready:checks.every(check=>check.ok),checks,firstAdminUid,firstAdminActive,
    state:schoolData.state,compatibilityMode:schoolData.compatibilityMode||"legacy_allowed",
    provisioningMode:schoolData.provisioningMode||
      ((schoolData.compatibilityMode||"legacy_allowed")==="v4_only"?"standard":"legacy_migration")};
}
async function ownerContext({db,request}) {
  const uid=verifiedUid(request),authority=await platformAuthority({db,request});
  if(!authority.platformAdmin)
    fail("permission-denied","Only a verified platform administrator may manage institutions.");
  return uid;
}
const requiredAttestations=[
  "institutionalDataAuthority","provenanceVerified","calendarConfigured","privacyPolicyApproved"
];
const MCS_CUTOVER_PACKAGE_SCHEMA="adminerva-v4-mcs-cutover-package-v1";
const MCS_CUTOVER_PACKAGE_MAX_AGE_MS=24*60*60*1000;
const MCS_ARTIFACT_SCHEMAS={
  mirrorReceipt:"adminerva-v4-mcs-mirror-receipt-v1",
  mirrorReconciliation:"adminerva-v4-mcs-mirror-reconciliation-v1",
  foundationReceipt:"adminerva-v4-mcs-canonical-foundation-receipt-v1",
  academicAccessReceipt:"adminerva-v4-mcs-canonical-academic-access-receipt-v1",
  assessmentReceipt:"adminerva-v4-mcs-canonical-assessment-receipt-v1",
  evidenceGradeReceipt:"adminerva-v4-mcs-canonical-evidence-grade-receipt-v1",
  planningReceipt:"adminerva-v4-mcs-canonical-planning-receipt-v1",
  planningSupportReceipt:"adminerva-v4-mcs-canonical-planning-support-receipt-v1",
  practiceReceipt:"adminerva-v4-mcs-canonical-practice-receipt-v1"
};
function validateMcsCutoverPackage(value){
  if(!value||typeof value!=="object"||Array.isArray(value)||
     value.schema!==MCS_CUTOVER_PACKAGE_SCHEMA||value.schoolId!=="mcs-manila"||
     value.readOnly!==true||value.readyForCompatibilitySwitch!==true||
     !Array.isArray(value.blockers)||value.blockers.length)
    fail("invalid-argument","Use a successful MCS cutover package generated by the 4.0 operator validator.");
  if(!/^[a-f0-9]{64}$/.test(String(value.artifactSetSha256||"")))
    fail("invalid-argument","The cutover package artifact-set digest is invalid.");
  const generated=Date.parse(value.generatedAt);
  if(!Number.isFinite(generated)||generated>Date.now()+5*60*1000||
     Date.now()-generated>MCS_CUTOVER_PACKAGE_MAX_AGE_MS)
    fail("failed-precondition","Generate a fresh MCS cutover package within 24 hours of recording it.");
  const safety=value.safety||{};
  if(safety.writesPerformed!==false||safety.rolesGranted!==false||
     safety.compatibilityChanged!==false||safety.deploymentPerformed!==false||
     safety.releasePublished!==false)
    fail("invalid-argument","Cutover package safety markers are invalid.");
  for(const [name,schema] of Object.entries(MCS_ARTIFACT_SCHEMAS)){
    const artifact=value.artifacts?.[name];
    if(!artifact||artifact.schema!==schema||artifact.complete!==true||
       !/^[a-f0-9]{64}$/.test(String(artifact.sha256||""))||
       !Array.isArray(artifact.blockers)||artifact.blockers.length)
      fail("failed-precondition","Cutover package artifact is incomplete or invalid: "+name);
  }
  if(value.liveReadiness?.ready!==true||value.liveReadiness?.compatibilityMode!=="legacy_allowed")
    fail("failed-precondition","The cutover package was not generated from a ready legacy-compatible MCS state.");
  return {
    packageSha256:createHash("sha256").update(JSON.stringify(value)).digest("hex"),
    artifactSetSha256:value.artifactSetSha256,
    generatedAt:value.generatedAt,
    artifactSchemas:Object.fromEntries(Object.entries(MCS_ARTIFACT_SCHEMAS)),
    artifactSha256:Object.fromEntries(Object.keys(MCS_ARTIFACT_SCHEMAS)
      .map(name=>[name,value.artifacts[name].sha256]))
  };
}
function createPlatformSchoolService({db,auth=getAuth()}) {
  return async request=>{
    const uid=await ownerContext({db,request}),input=request.data||{};
    const action=input.action;
    if(action==="list") {
      const snap=await db.collection("platform_schools").orderBy("displayName").limit(100).get();
      return {schools:snap.docs.map(doc=>({
        schoolId:doc.id,displayName:doc.data().displayName,state:doc.data().state,
        dataLocation:doc.data().dataLocation,revision:doc.data().revision,
        compatibilityMode:doc.data().compatibilityMode||"legacy_allowed",
        provisioningMode:doc.data().provisioningMode||
          ((doc.data().compatibilityMode||"legacy_allowed")==="v4_only"?"standard":"legacy_migration"),
        productionAuthorized:doc.data().productionAuthorized===true,
        pilot:doc.data().pilot?{
          status:doc.data().pilot.status||null,
          scopeReference:doc.data().pilot.scopeReference||null
        }:null
      }))};
    }
    if(action==="list_governance_roles"){
      const snap=await db.collection("platform_governance_roles").orderBy("displayName").limit(100).get();
      return {roles:snap.docs.map(doc=>({
        roleId:doc.id,displayName:doc.data().displayName,description:doc.data().description||"",
        status:doc.data().status||"active"
      }))};
    }
    if(action==="create_governance_role"){
      const roleId=governanceRoleId(input.roleId),
        displayName=phrase(input.displayName,3,120,"Governance role name"),
        description=typeof input.description==="string"?input.description.trim().slice(0,500):"",
        ref=db.doc("platform_governance_roles/"+roleId),auditRef=db.collection("platform_audit").doc();
      await db.runTransaction(async tx=>{
        if((await tx.get(ref)).exists)fail("already-exists","That governance role already exists.");
        const now=FieldValue.serverTimestamp();
        tx.create(ref,{displayName,description,status:"active",revision:1,
          createdByUid:uid,createdAt:now,updatedAt:now});
        tx.create(auditRef,{actorUid:uid,action:"platform_governance_role_created",
          roleId,displayName,createdAt:now});
      });
      return {roleId,displayName,status:"active"};
    }
    const schoolId=checkedSchoolId(input.schoolId),schoolRef=db.doc("platform_schools/"+schoolId);
    const auditRef=db.collection("platform_audit").doc();
    const cutoverDecisionRef=db.doc("platform_schools/"+schoolId+"/private_config/cutover_decisions");
    if(action==="list_school_audit"){
      const snap=await db.collection("platform_audit").where("schoolId","==",schoolId).limit(101).get();
      if(snap.size===101)fail("resource-exhausted","School platform audit history requires pagination.");
      const events=snap.docs.map(doc=>{
        const row=doc.data(),detail={};
        for(const key of ["reason","roleId","mode","scopeReference","targetUid"]){
          if(typeof row[key]==="string"&&row[key])detail[key]=row[key].slice(0,key==="reason"?500:160);
        }
        return {
          auditId:doc.id,action:String(row.action||"platform_change").slice(0,120),
          actorUid:String(row.actorUid||"").slice(0,128),
          createdAt:row.createdAt?.toMillis?.()||0,detail
        };
      }).sort((a,b)=>b.createdAt-a.createdAt).slice(0,50);
      return {schoolId,events,truncated:snap.size>50};
    }
    if(action==="list_school_governance_roles"){
      const snap=await db.collection("platform_schools/"+schoolId+"/governance_roles").limit(100).get();
      return {schoolId,roles:snap.docs.map(doc=>({
        roleId:doc.id,status:doc.data().status||"active",assignedAt:doc.data().assignedAt?.toMillis?.()||null
      }))};
    }
    if(action==="assign_governance_role"){
      const roleId=governanceRoleId(input.roleId),reason=phrase(input.reason,12,500,"Assignment reason"),
        roleRef=db.doc("platform_governance_roles/"+roleId),
        assignmentRef=db.doc("platform_schools/"+schoolId+"/governance_roles/"+roleId);
      await db.runTransaction(async tx=>{
        const [school,role]=await Promise.all([tx.get(schoolRef),tx.get(roleRef)]);
        if(!school.exists||!["draft","pilot","active","suspended"].includes(school.data().state))
          fail("failed-precondition","The school must exist and must not be archived.");
        if(!role.exists||role.data().status!=="active")
          fail("failed-precondition","Choose an active platform governance role.");
        const now=FieldValue.serverTimestamp();
        tx.set(assignmentRef,{schoolId,roleId,status:"active",assignedByUid:uid,assignedAt:now},{merge:false});
        tx.create(auditRef,{schoolId,actorUid:uid,action:"school_governance_role_assigned",
          roleId,reason,createdAt:now});
      });
      return {schoolId,roleId,status:"active"};
    }
    if(action==="get_setup_status"){
      const school=await schoolRef.get();
      if(!school.exists)fail("not-found","The school does not exist.");
      return await standardSetupStatus({db,schoolId,schoolData:school.data()});
    }
    if(action==="activate_standard"){
      const reason=phrase(input.reason,12,500,"Activation reason"),
        expectedRevision=Number(input.expectedRevision);
      if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)
        fail("invalid-argument","Refresh the school before activating it.");
      const school=await schoolRef.get();
      if(!school.exists)fail("not-found","The school does not exist.");
      const data=school.data();
      if(data.revision!==expectedRevision)
        fail("failed-precondition","The school changed after you reviewed setup. Refresh before activating.");
      const mode=data.provisioningMode||
        ((data.compatibilityMode||"legacy_allowed")==="v4_only"?"standard":"legacy_migration");
      if(mode!=="standard"||(data.compatibilityMode||"legacy_allowed")!=="v4_only")
        fail("failed-precondition","Use the legacy pilot/cutover workflow for this institution.");
      if(data.state!=="draft")
        fail("failed-precondition","Only a draft standard school can be activated from setup.");
      const setup=await standardSetupStatus({db,schoolId,schoolData:data});
      if(!setup.ready)
        fail("failed-precondition","Complete the standard school setup checklist before activation.");
      await db.runTransaction(async tx=>{
        const current=await tx.get(schoolRef);
        if(!current.exists||current.data().state!=="draft")
          fail("failed-precondition","The school state changed. Refresh before activating.");
        if(current.data().revision!==expectedRevision)
          fail("failed-precondition","The school changed after setup review. Refresh before activating.");
        const now=FieldValue.serverTimestamp();
        tx.update(schoolRef,{state:"active",productionAuthorized:true,
          revision:(current.data().revision||0)+1,activatedByUid:uid,activatedAt:now,updatedAt:now});
        tx.create(auditRef,{schoolId,actorUid:uid,action:"standard_school_activated",
          reason,createdAt:now});
      });
      return {schoolId,state:"active",productionAuthorized:true};
    }
    if(action==="get_cutover_decisions"){
      const [school,decision]=await Promise.all([schoolRef.get(),cutoverDecisionRef.get()]);
      if(!school.exists)fail("not-found","The school does not exist.");
      const firstAdminUid=school.data().firstAdminUid||null;
      let firstAdminActive=false;
      if(firstAdminUid){
        const member=await db.doc("schools/"+schoolId+"/memberships/"+firstAdminUid).get();
        firstAdminActive=member.exists&&member.data().schoolId===schoolId&&
          member.data().status==="active"&&Array.isArray(member.data().roles)&&
          member.data().roles.includes("school_admin");
      }
      return {schoolId,firstAdminUid,firstAdminActive,
        decisions:decision.exists?decision.data():null};
    }
    if(action==="get_mcs_cutover_package"){
      if(schoolId!=="mcs-manila")return {schoolId,required:false,recorded:false};
      const record=await db.doc("platform_schools/"+schoolId+"/private_config/mcs_cutover_package").get();
      const data=record.exists?record.data():null,recordedAt=data?.recordedAt?.toMillis?.()||0;
      return {schoolId,required:true,recorded:record.exists,
        ready:Boolean(data?.readyForCompatibilitySwitch),
        packageSha256:data?.packageSha256||null,artifactSetSha256:data?.artifactSetSha256||null,
        packageGeneratedAt:data?.packageGeneratedAt||null,recordedAt:recordedAt||null,
        fresh:Boolean(recordedAt&&Date.now()-recordedAt>=0&&Date.now()-recordedAt<=MCS_CUTOVER_PACKAGE_MAX_AGE_MS)};
    }
    if(action==="record_mcs_cutover_package"){
      if(schoolId!=="mcs-manila")
        fail("invalid-argument","The protected cutover-package gate currently applies only to the confirmed MCS pilot.");
      const checked=validateMcsCutoverPackage(input.package),reason=phrase(input.reason,12,500,"Package review reason"),
        readiness=await evaluateSchoolCutoverReadiness({db,schoolId}),
        packageRef=db.doc("platform_schools/"+schoolId+"/private_config/mcs_cutover_package");
      if(!readiness.ready||readiness.compatibilityMode!=="legacy_allowed")
        fail("failed-precondition","Live MCS readiness changed. Regenerate the cutover package before recording it.");
      await db.runTransaction(async tx=>{
        const school=await tx.get(schoolRef);
        if(!school.exists||school.data().state!=="active"||
           (school.data().compatibilityMode||"legacy_allowed")!=="legacy_allowed")
          fail("failed-precondition","MCS must be active and legacy-compatible while the cutover package is recorded.");
        const now=FieldValue.serverTimestamp();
        tx.set(packageRef,{
          schema:MCS_CUTOVER_PACKAGE_SCHEMA,schoolId,readyForCompatibilitySwitch:true,
          packageSha256:checked.packageSha256,artifactSetSha256:checked.artifactSetSha256,
          packageGeneratedAt:checked.generatedAt,artifactSchemas:checked.artifactSchemas,
          artifactSha256:checked.artifactSha256,recordedByUid:uid,recordedAt:now
        },{merge:false});
        tx.create(auditRef,{schoolId,actorUid:uid,action:"mcs_cutover_package_recorded",
          packageSha256:checked.packageSha256,artifactSetSha256:checked.artifactSetSha256,
          reason,createdAt:now});
      });
      return {schoolId,recorded:true,packageSha256:checked.packageSha256,
        artifactSetSha256:checked.artifactSetSha256};
    }
    if(action==="save_cutover_decisions"){
      let decisions;
      try{decisions=normalizeCutoverDecisions(input.decisions||{});}
      catch(error){fail("invalid-argument",error.message);}
      const reason=phrase(input.reason,12,500,"Decision review reason");
      await db.runTransaction(async tx=>{
        const school=await tx.get(schoolRef);
        if(!school.exists||!["draft","pilot","active","suspended"].includes(school.data().state))
          fail("failed-precondition","The school must exist and must not be archived.");
        const firstAdminUid=school.data().firstAdminUid;
        if(!firstAdminUid)fail("failed-precondition","Designate the first verified school administrator first.");
        const admin=await tx.get(db.doc("schools/"+schoolId+"/memberships/"+firstAdminUid));
        if(!admin.exists||admin.data().schoolId!==schoolId||admin.data().status!=="active"||
           !Array.isArray(admin.data().roles)||!admin.data().roles.includes("school_admin"))
          fail("failed-precondition","The first school administrator grant is not active.");
        if(decisions.dataStewardRole!=="school_admin"){
          const stewardRole=governanceRoleId(decisions.dataStewardRole),
            assignment=await tx.get(db.doc("platform_schools/"+schoolId+"/governance_roles/"+stewardRole));
          if(!assignment.exists||assignment.data().status!=="active")
            fail("failed-precondition","Assign the selected data-steward governance role to this school first.");
          decisions.dataStewardRole=stewardRole;
        }
        const current=await tx.get(cutoverDecisionRef),now=FieldValue.serverTimestamp(),
          revision=(current.data()?.revision||0)+1;
        tx.set(cutoverDecisionRef,{schema:CUTOVER_DECISION_SCHEMA,schoolId,firstAdminUid,
          ...decisions,revision,reviewedByUid:uid,reviewedAt:now,updatedAt:now});
        tx.create(auditRef,{schoolId,actorUid:uid,action:"school_cutover_decisions_saved",
          firstAdminUid,retentionMode:decisions.retentionMode,dataStewardRole:decisions.dataStewardRole,
          aiPermission:decisions.aiPermission,repositoryPermission:decisions.repositoryPermission,
          revision,reason,createdAt:now});
      });
      return {schoolId,saved:true};
    }
    if(action==="create_draft") {
      const displayName=phrase(input.displayName,3,120,"Institution name");
      await db.runTransaction(async tx=>{
        if((await tx.get(schoolRef)).exists)fail("already-exists","The school already exists.");
        tx.create(schoolRef,{
          displayName,state:"draft",revision:1,compatibilityMode:"v4_only",provisioningMode:"standard",productionAuthorized:false,
          dataLocation:{type:"shared_firestore_namespace",database:"(default)",path:"schools/"+schoolId},
          firstAdminUid:null,aiEnabled:false,storageEnabled:false,
          readiness:{},createdByUid:uid,createdAt:FieldValue.serverTimestamp(),
          updatedAt:FieldValue.serverTimestamp()
        });
        tx.create(auditRef,{actorUid:uid,action:"school_draft_created",schoolId,createdAt:FieldValue.serverTimestamp()});
      });
      return {schoolId,state:"draft"};
    }
    if(action==="grant_school_admin") {
      const targetUid=phrase(input.targetUid,8,128,"Verified administrator UID");
      const reason=phrase(input.reason,12,500,"Reason");
      const target=await auth.getUser(targetUid);
      if(!target.emailVerified || target.disabled)
        fail("failed-precondition","The target account is not a verified active identity.");
      const memberRef=db.doc("schools/"+schoolId+"/memberships/"+targetUid);
      const indexRef=db.doc("platform_users/"+targetUid+"/memberships/"+schoolId);
      await db.runTransaction(async tx=>{
        const school=await tx.get(schoolRef),member=await tx.get(memberRef);
        if(!school.exists||!["draft","pilot","active","suspended"].includes(school.data().state))
          fail("failed-precondition","The school must exist and must not be archived.");
        if(member.exists && member.data().status==="suspended")
          fail("failed-precondition","Use reviewed membership recovery for a suspended account.");
        const previous=member.exists?member.data():null;
        const roles=addSchoolAdminRole(previous?.roles);
        const revision=(previous?.revision||0)+1;
        const grant={schoolId,status:"active",roles,revision,
          updatedAt:FieldValue.serverTimestamp(),updatedByUid:uid};
        tx.set(memberRef,grant,{merge:true});
        tx.set(indexRef,{schoolId,status:"active",roles,revision,
          updatedAt:FieldValue.serverTimestamp()});
        if(!school.data().firstAdminUid)tx.update(schoolRef,{firstAdminUid:targetUid});
        tx.create(auditRef,{schoolId,actorUid:uid,targetUid,action:"school_admin_granted",
          reason,createdAt:FieldValue.serverTimestamp()});
      });
      return {schoolId,adminUid:targetUid,status:"active"};
    }
    if(action==="suspend_school_admin"||action==="restore_school_admin") {
      const targetUid=phrase(input.targetUid,8,128,"School administrator UID");
      const reason=phrase(input.reason,12,500,action==="restore_school_admin"?"Recovery reason":"Suspension reason");
      const target=await auth.getUser(targetUid);
      if(!target.emailVerified||target.disabled)
        fail("failed-precondition","The target account is not a verified active identity.");
      const memberRef=db.doc("schools/"+schoolId+"/memberships/"+targetUid);
      const indexRef=db.doc("platform_users/"+targetUid+"/memberships/"+schoolId);
      const restoring=action==="restore_school_admin";
      await db.runTransaction(async tx=>{
        const school=await tx.get(schoolRef),member=await tx.get(memberRef);
        if(!school.exists||!["draft","pilot","active","suspended"].includes(school.data().state))
          fail("failed-precondition","The school must exist and must not be archived.");
        if(!member.exists||member.data().schoolId!==schoolId||
           !Array.isArray(member.data().roles)||!member.data().roles.includes("school_admin"))
          fail("failed-precondition","The target is not a school administrator for this institution.");
        if(restoring){
          if(member.data().status!=="suspended")
            fail("failed-precondition","Only a suspended school administrator can be recovered.");
        }else{
          if(member.data().status!=="active")
            fail("failed-precondition","Only an active school administrator can be suspended.");
          const admins=await tx.get(db.collection("schools/"+schoolId+"/memberships")
            .where("roles","array-contains","school_admin").limit(50));
          const otherActive=admins.docs.some(doc=>doc.id!==targetUid&&doc.data().schoolId===schoolId&&
            doc.data().status==="active");
          if(!otherActive)
            fail("failed-precondition","Designate another active school administrator before suspending the last administrator.");
        }
        const now=FieldValue.serverTimestamp(),roles=member.data().roles,
          revision=(member.data().revision||0)+1,status=restoring?"active":"suspended";
        tx.update(memberRef,{status,revision,updatedAt:now,updatedByUid:uid,
          ...(restoring?{restoredAt:now,restoredByUid:uid,restoreReason:reason}:
            {suspendedAt:now,suspendedByUid:uid,suspensionReason:reason})});
        tx.set(indexRef,{schoolId,status,roles,revision,updatedAt:now});
        tx.create(auditRef,{schoolId,actorUid:uid,targetUid,
          action:restoring?"school_admin_recovered":"school_admin_suspended",
          reason,createdAt:now});
      });
      return {schoolId,adminUid:targetUid,status:restoring?"active":"suspended"};
    }
    if(action==="start_pilot") {
      const scopeReference=phrase(input.scopeReference,8,240,"Pilot scope reference"),
        reason=phrase(input.reason,12,500,"Pilot reason"),ack=input.acknowledgements||{},
        expectedRevision=Number(input.expectedRevision);
      if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)
        fail("invalid-argument","Refresh the school before starting a pilot.");
      for(const key of ["limitedScopeReviewed","legacyCompatibilityRequired","productionNotAuthorized"])
        if(ack[key]!==true)fail("failed-precondition","Confirm the limited scope, legacy compatibility and non-production pilot status.");
      await db.runTransaction(async tx=>{
        const school=await tx.get(schoolRef);
        if(!school.exists||school.data().state!=="draft")
          fail("failed-precondition","Only a draft school can enter controlled pilot mode.");
        if(school.data().revision!==expectedRevision)
          fail("failed-precondition","The school changed after you reviewed it. Refresh before starting the pilot.");
        const adminUid=school.data().firstAdminUid;
        if(!adminUid)fail("failed-precondition","Designate the first verified school administrator before pilot access.");
        const member=await tx.get(db.doc("schools/"+schoolId+"/memberships/"+adminUid));
        if(!member.exists||member.data().schoolId!==schoolId||member.data().status!=="active"||
           !Array.isArray(member.data().roles)||!member.data().roles.includes("school_admin"))
          fail("failed-precondition","The designated pilot administrator is not active.");
        const now=FieldValue.serverTimestamp();
        tx.update(schoolRef,{state:"pilot",compatibilityMode:"legacy_allowed",productionAuthorized:false,
          pilot:{status:"active",scopeReference,productionAuthorized:false,
            institutionalApprovalStatus:"pending",startedByUid:uid,startedAt:now},
          revision:(school.data().revision||0)+1,updatedAt:now});
        tx.create(auditRef,{schoolId,actorUid:uid,action:"school_controlled_pilot_started",
          scopeReference,reason,createdAt:now});
      });
      return {schoolId,state:"pilot",compatibilityMode:"legacy_allowed",productionAuthorized:false};
    }
    if(action==="end_pilot") {
      const reason=phrase(input.reason,12,500,"Pilot close reason"),
        expectedRevision=Number(input.expectedRevision);
      if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)
        fail("invalid-argument","Refresh the school before ending the pilot.");
      await db.runTransaction(async tx=>{
        const school=await tx.get(schoolRef);
        if(!school.exists||school.data().state!=="pilot")
          fail("failed-precondition","Only a controlled pilot can be returned to draft.");
        if(school.data().revision!==expectedRevision)
          fail("failed-precondition","The school changed after you reviewed it. Refresh before ending the pilot.");
        const now=FieldValue.serverTimestamp(),pilot=school.data().pilot||{};
        tx.update(schoolRef,{state:"draft",compatibilityMode:"legacy_allowed",productionAuthorized:false,
          pilot:{...pilot,status:"ended",productionAuthorized:false,endedByUid:uid,endedAt:now},
          revision:(school.data().revision||0)+1,updatedAt:now});
        tx.create(auditRef,{schoolId,actorUid:uid,action:"school_controlled_pilot_ended",
          reason,createdAt:now});
      });
      return {schoolId,state:"draft",compatibilityMode:"legacy_allowed",productionAuthorized:false};
    }

    if(action==="activate") {
      const attestation=input.attestation||{};
      if(requiredAttestations.some(key=>attestation[key]!==true))
        fail("failed-precondition","Institutional authority, provenance, calendar and privacy approval must be confirmed.");
      const reason=phrase(input.reason,12,500,"Activation reason"),
        expectedRevision=Number(input.expectedRevision);
      if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)
        fail("invalid-argument","Refresh the school before activation.");
      await db.runTransaction(async tx=>{
        const school=await tx.get(schoolRef);
        if(!school.exists||!["draft","pilot"].includes(school.data().state))
          fail("failed-precondition","Only a draft or controlled-pilot institution can be activated.");
        if(school.data().revision!==expectedRevision)
          fail("failed-precondition","The school changed after you reviewed it. Refresh before activation.");
        const adminUid=school.data().firstAdminUid;
        if(!adminUid)fail("failed-precondition","Designate the first verified school administrator.");
        const member=await tx.get(db.doc("schools/"+schoolId+"/memberships/"+adminUid));
        if(!member.exists||member.data().status!=="active"||
           !Array.isArray(member.data().roles)||!member.data().roles.includes("school_admin"))
          fail("failed-precondition","The first administrator's grant is not active.");
        const now=FieldValue.serverTimestamp(),pilot=school.data().pilot||null;
        tx.update(schoolRef,{state:"active",readiness:attestation,productionAuthorized:true,
          ...(pilot?{pilot:{...pilot,status:"promoted",productionAuthorized:true,
            promotedByUid:uid,promotedAt:now}}:{}),
          revision:(school.data().revision||0)+1,updatedAt:now});
        tx.create(auditRef,{schoolId,actorUid:uid,action:"school_activated",reason,
          attestationKeys:requiredAttestations,createdAt:FieldValue.serverTimestamp()});
      });
      return {schoolId,state:"active"};
    }

    if(action==="set_compatibility_mode"){
      const mode=input.mode;
      if(!["legacy_allowed","v4_only"].includes(mode))
        fail("invalid-argument","Choose a supported school compatibility mode.");
      const reason=phrase(input.reason,12,500,"Compatibility-mode reason"),
        expectedRevision=Number(input.expectedRevision);
      if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)
        fail("invalid-argument","Refresh the school before changing compatibility mode.");
      let requiredMcsPackage=null;
      if(mode==="v4_only"){
        const readiness=await evaluateSchoolCutoverReadiness({db,schoolId});
        if(!readiness.ready)
          fail("failed-precondition","Resolve the school cutover readiness blockers before retiring legacy compatibility.");
        if(schoolId==="mcs-manila"){
          const packageRef=db.doc("platform_schools/"+schoolId+"/private_config/mcs_cutover_package"),
            packageDoc=await packageRef.get(),data=packageDoc.exists?packageDoc.data():null,
            recordedAt=data?.recordedAt?.toMillis?.()||0;
          if(!data||data.schema!==MCS_CUTOVER_PACKAGE_SCHEMA||data.readyForCompatibilitySwitch!==true||
             !/^[a-f0-9]{64}$/.test(String(data.packageSha256||""))||
             !recordedAt||Date.now()-recordedAt<0||Date.now()-recordedAt>MCS_CUTOVER_PACKAGE_MAX_AGE_MS)
            fail("failed-precondition","Generate, review and record a fresh successful MCS cutover package before V4-only activation.");
          requiredMcsPackage={ref:packageRef,packageSha256:data.packageSha256,
            artifactSetSha256:data.artifactSetSha256,recordedAt};
        }
        const attestation=input.attestation||{};
        for(const key of ["continuityBackupCaptured","migrationReconciled","rollbackReviewed","v4RoutesValidated"])
          if(attestation[key]!==true)
            fail("failed-precondition","Continuity backup, migration reconciliation, rollback and V4 route validation must all be confirmed.");
      }
      await db.runTransaction(async tx=>{
        const school=await tx.get(schoolRef);
        if(!school.exists||!["active","suspended"].includes(school.data().state))
          fail("failed-precondition","Compatibility mode can be changed only for an active or suspended school.");
        if(school.data().revision!==expectedRevision)
          fail("failed-precondition","The school changed after you reviewed it. Refresh before changing compatibility mode.");
        if(mode==="v4_only"&&requiredMcsPackage){
          const packageDoc=await tx.get(requiredMcsPackage.ref),data=packageDoc.exists?packageDoc.data():null,
            recordedAt=data?.recordedAt?.toMillis?.()||0;
          if(!data||data.packageSha256!==requiredMcsPackage.packageSha256||
             data.artifactSetSha256!==requiredMcsPackage.artifactSetSha256||
             data.readyForCompatibilitySwitch!==true||Date.now()-recordedAt<0||
             Date.now()-recordedAt>MCS_CUTOVER_PACKAGE_MAX_AGE_MS)
            fail("failed-precondition","The recorded MCS cutover package changed or expired. Regenerate it before cutover.");
        }
        const before=school.data().compatibilityMode||"legacy_allowed";
        if(before===mode)return;
        const now=FieldValue.serverTimestamp();
        tx.update(schoolRef,{
          compatibilityMode:mode,revision:(school.data().revision||0)+1,updatedAt:now,
          ...(mode==="v4_only"?{
            cutoverAt:now,cutoverByUid:uid,cutoverReason:reason,
            ...(requiredMcsPackage?{
              cutoverPackageSha256:requiredMcsPackage.packageSha256,
              cutoverArtifactSetSha256:requiredMcsPackage.artifactSetSha256
            }:{}),
            cutoverAttestations:{
              continuityBackupCaptured:true,migrationReconciled:true,
              rollbackReviewed:true,v4RoutesValidated:true
            }
          }:{
            compatibilityRollbackAt:now,compatibilityRollbackByUid:uid,
            compatibilityRollbackReason:reason
          })
        });
        tx.create(auditRef,{schoolId,actorUid:uid,
          action:mode==="v4_only"?"school_v4_cutover_enabled":"school_legacy_compatibility_restored",
          beforeCompatibilityMode:before,afterCompatibilityMode:mode,reason,
          ...(mode==="v4_only"&&requiredMcsPackage?{
            cutoverPackageSha256:requiredMcsPackage.packageSha256,
            cutoverArtifactSetSha256:requiredMcsPackage.artifactSetSha256
          }:{}),createdAt:now});
      });
      return {schoolId,compatibilityMode:mode};
    }

    if(action==="get_recovery_status"){
      const school=await schoolRef.get();
      if(!school.exists)fail("not-found","The school does not exist.");
      const admins=await db.collection("schools/"+schoolId+"/memberships")
        .where("roles","array-contains","school_admin").limit(101).get();
      if(admins.size===101)
        fail("resource-exhausted","School administrator recovery review requires pagination.");
      const activeAdmins=admins.docs.filter(doc=>{
        const row=doc.data();
        return row.schoolId===schoolId&&row.status==="active"&&
          Array.isArray(row.roles)&&row.roles.includes("school_admin");
      });
      const suspendedAdmins=admins.docs.filter(doc=>{
        const row=doc.data();
        return row.schoolId===schoolId&&row.status==="suspended"&&
          Array.isArray(row.roles)&&row.roles.includes("school_admin");
      });
      const data=school.data(),blockers=[];
      if(data.state!=="suspended")blockers.push("The institution is not currently suspended.");
      if(data.productionAuthorized!==true)blockers.push("The institution has no prior production authorization to restore.");
      if(!activeAdmins.length)blockers.push("Restore or designate an active School Administrator before restoring the institution.");
      return {
        schoolId,state:data.state,revision:Number(data.revision)||1,
        productionAuthorized:data.productionAuthorized===true,
        activeAdminCount:activeAdmins.length,suspendedAdminCount:suspendedAdmins.length,
        canResume:blockers.length===0,blockers
      };
    }

    if(action==="resume") {
      const reason=phrase(input.reason,12,500,"School recovery reason");
      if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1)
        fail("invalid-argument","Refresh the school before restoring access.");
      await db.runTransaction(async tx=>{
        const school=await tx.get(schoolRef);
        if(!school.exists||school.data().state!=="suspended")
          fail("failed-precondition","Only a suspended school can be restored.");
        if(school.data().revision!==input.expectedRevision)
          fail("failed-precondition","The school changed. Refresh before restoring access.");
        if(school.data().productionAuthorized!==true)
          fail("failed-precondition","Restore access only for a previously authorized institution.");
        const admins=await tx.get(db.collection("schools/"+schoolId+"/memberships")
          .where("roles","array-contains","school_admin"));
        if(!admins.docs.some(doc=>doc.data().schoolId===schoolId&&doc.data().status==="active"))
          fail("failed-precondition","Restore or designate an active school administrator before restoring the school.");
        const now=FieldValue.serverTimestamp();
        tx.update(schoolRef,{state:"active",revision:school.data().revision+1,
          resumedByUid:uid,resumedAt:now,updatedAt:now});
        tx.create(auditRef,{schoolId,actorUid:uid,action:"school_resumed",reason,
          beforeState:"suspended",afterState:"active",createdAt:now});
      });
      return {schoolId,state:"active"};
    }
    if(action==="suspend") {
      const reason=phrase(input.reason,12,500,"Suspension reason"),
        expectedRevision=Number(input.expectedRevision);
      if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)
        fail("invalid-argument","Refresh the school before suspension.");
      await db.runTransaction(async tx=>{
        const school=await tx.get(schoolRef);
        if(!school.exists||school.data().state!=="active")
          fail("failed-precondition","Only an active school may be suspended.");
        if(school.data().revision!==expectedRevision)
          fail("failed-precondition","The school changed after you reviewed it. Refresh before suspension.");
        tx.update(schoolRef,{state:"suspended",revision:(school.data().revision||0)+1,
          updatedAt:FieldValue.serverTimestamp()});
        tx.create(auditRef,{schoolId,actorUid:uid,action:"school_suspended",reason,
          createdAt:FieldValue.serverTimestamp()});
      });
      return {schoolId,state:"suspended"};
    }
    fail("invalid-argument","Unknown platform school operation.");
  };
}
module.exports={addSchoolAdminRole,createPlatformSchoolService,ownerContext};
