"use strict";
/**
 * Canonical Student Records / 201-file aggregation.
 *
 * The 201 file is a view over authoritative school records. This service owns
 * guardian relationship/contact records and registrar document-request
 * workflow only; it does not duplicate student identity, registration, class
 * enrollment or Class Record grades.
 */
const {FieldValue,FieldPath}=require("firebase-admin/firestore");
const {createHash}=require("node:crypto");
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");
const {ACTIONS:ADMISSION_DOCUMENT_ACTIONS,admissionDocumentAction}=require("./school-admission-documents.js");
const {ACTIONS:CREDENTIAL_ACTIONS,registrarCredentialAction}=require("./school-record-credentials.js");
const {
  normalizeGuardianEmail,guardianContactIdForEmail,guardianRelationshipId
}=require("./school-guardian-identity.js");

const REQUEST_TYPES=new Set([
  "certificate_of_enrollment","report_card","transcript_of_records",
  "student_record_copy","graduation_certificate","other"
]);
const REQUEST_TRANSITIONS={
  requested:new Set(["in_review","cancelled"]),
  in_review:new Set(["ready","cancelled"]),
  ready:new Set(["released","in_review","cancelled"]),
  released:new Set(),
  cancelled:new Set(["in_review"])
};
function deny(code,message){throw new TenantAccessError(code,message)}
function id(value,label="Identifier",max=128){
  const clean=String(value||"").trim();
  if(!new RegExp("^[A-Za-z0-9][A-Za-z0-9_-]{0,"+(max-1)+"}$").test(clean))
    deny("invalid-argument",label+" is invalid.");
  return clean;
}
function required(value,label,max=160){
  const clean=String(value||"").trim();
  if(!clean||clean.length>max)deny("invalid-argument",label+" is required.");
  return clean;
}
function optional(value,max=500){
  const clean=String(value||"").trim();
  if(clean.length>max)deny("invalid-argument","One of the optional values is too long.");
  return clean||null;
}
function millis(value){
  if(!value)return null;
  if(typeof value.toMillis==="function")return value.toMillis();
  const numeric=Number(value);return Number.isFinite(numeric)?numeric:null;
}
function key(...parts){return createHash("sha256").update(JSON.stringify(parts)).digest("hex");}
function normalizeLrn(value){
  if(value===null||value===undefined||value==="")return null;
  if(typeof value!=="string"||!/^\d{12}$/.test(value.trim()))deny("invalid-argument","Enter the 12-digit LRN exactly as issued by the education authority.");
  return value.trim();
}
function normalizeRegistrarProfile(input){
  const lrn=normalizeLrn(input.lrn),lrnState=String(input.lrnState||"unrecorded");
  if(!["unrecorded","recorded","verified"].includes(lrnState)||Boolean(lrn)!==(lrnState!=="unrecorded"))
    deny("invalid-argument","Choose a valid LRN verification status.");
  const sex=String(input.sex||"");
  if(!["","male","female"].includes(sex))deny("invalid-argument","Choose the sex recorded on the official identity document, or leave blank.");
  return {lrn,lrnState,sex:sex||null,birthPlace:optional(input.birthPlace,160),
    nationality:optional(input.nationality,80),addressLine:optional(input.addressLine,200),
    barangay:optional(input.barangay,100),cityMunicipality:optional(input.cityMunicipality,100),
    province:optional(input.province,100),postalCode:optional(input.postalCode,20),
    country:optional(input.country,80),previousSchool:optional(input.previousSchool,180)};
}
function requestTypeLabel(type){
  return ({
    certificate_of_enrollment:"Certificate of Enrollment",
    report_card:"Report Card",
    transcript_of_records:"Transcript of Records",
    student_record_copy:"Student Record Copy",
    graduation_certificate:"Graduation Certificate",
    other:"Other school record"
  })[type]||"School record";
}
function createSchoolStudentRecordsService({db}){
  return async request=>{
    const input=request.data||{};
    const ctx=await getSchoolContext({
      db,request,schoolId:input.schoolId,roles:["school_admin","registrar"],allowDraftAdmin:true
    });
    const root="schools/"+ctx.schoolId+"/",
      schoolRef=db.doc("platform_schools/"+ctx.schoolId),
      adminRef=db.doc(root+"memberships/"+ctx.uid);

    async function requireCurrentAdmin(tx){
      if(ctx.platformOverride)return;
      const [school,member]=await Promise.all([tx.get(schoolRef),tx.get(adminRef)]);
      if(!school.exists||!["draft","pilot","active"].includes(school.data().state)||
         !member.exists||member.data().schoolId!==ctx.schoolId||member.data().status!=="active"||
         !Array.isArray(member.data().roles)||
         !member.data().roles.some(role=>["school_admin","registrar"].includes(role)))
        deny("permission-denied","School records authority changed. Refresh before saving.");
    }
    async function student(personId,read=ref=>ref.get()){
      const ref=db.doc(root+"people/"+id(personId,"Person ID")),doc=await read(ref);
      if(!doc.exists||doc.data().schoolId!==ctx.schoolId||doc.data().kind!=="student")
        deny("not-found","The student record was not found in this school.");
      return {ref,doc,data:doc.data()};
    }
    if(ADMISSION_DOCUMENT_ACTIONS.has(input.action))return admissionDocumentAction({db,ctx,input,studentView:true});
    // Registrar-only supplementary profile fields are intentionally not in the general people directory.
    async function requireRegistrarMembership(read){
      const [school,member]=await Promise.all([read(schoolRef),read(adminRef)]);
      if(!school.exists||!["active","pilot","draft"].includes(school.data().state)||!member.exists||
         member.data().schoolId!==ctx.schoolId||member.data().status!=="active"||
         !Array.isArray(member.data().roles)||!member.data().roles.some(role=>role==="school_admin"||role==="registrar")||
         (school.data().state==="draft"&&!member.data().roles.includes("school_admin")))
        deny("permission-denied","An active school Registrar or School Administrator membership is required.");
    }
    if(CREDENTIAL_ACTIONS.has(input.action))return registrarCredentialAction({db,ctx,input,requireMembership:requireRegistrarMembership,student});
    if(input.action==="get_registrar_profile"||input.action==="save_registrar_profile"){
      await requireRegistrarMembership(ref=>ref.get());
      const personId=id(input.personId,"Person ID"),a=await student(personId),profileRef=db.doc(root+"student_registrar_profiles/"+personId);
      if(input.action==="get_registrar_profile"){
        const doc=await profileRef.get();
        if(doc.exists&&(doc.data().schoolId!==ctx.schoolId||doc.data().personId!==personId))deny("data-loss","Student profile ownership mismatch.");
        const row=doc.exists?doc.data():{};
        return {personId,revision:Number(row.revision)||0,profile:{lrn:row.lrn||"",lrnState:row.lrnState||"unrecorded",sex:row.sex||"",
          birthPlace:row.birthPlace||"",nationality:row.nationality||"",addressLine:row.addressLine||"",barangay:row.barangay||"",
          cityMunicipality:row.cityMunicipality||"",province:row.province||"",postalCode:row.postalCode||"",country:row.country||"",previousSchool:row.previousSchool||""}};
      }
      const details=normalizeRegistrarProfile(input.profile||{}),expectedRevision=input.expectedRevision,reason=required(input.reason,"Profile review reason",500);
      if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||reason.length<8)deny("invalid-argument","Refresh the profile and record a review reason.");
      await db.runTransaction(async tx=>{
        await requireRegistrarMembership(ref=>tx.get(ref));
        const [person,profile]=await Promise.all([tx.get(a.ref),tx.get(profileRef)]);
        if(!person.exists||person.data().schoolId!==ctx.schoolId||person.data().kind!=="student"||!["active","archived"].includes(person.data().status))deny("failed-precondition","The student record changed.");
        const prior=profile.exists?profile.data():{};
        if(profile.exists&&(prior.schoolId!==ctx.schoolId||prior.personId!==personId))deny("data-loss","Student profile ownership mismatch.");
        if((Number(prior.revision)||0)!==expectedRevision)deny("failed-precondition","The profile changed. Refresh before saving.");
        const claimRef=details.lrn?db.doc(root+"student_lrn_claims/"+key("lrn",details.lrn)):null;
        const claim=claimRef?await tx.get(claimRef):null;
        const oldRef=prior.lrn&&prior.lrn!==details.lrn?db.doc(root+"student_lrn_claims/"+key("lrn",prior.lrn)):null;
        const oldClaim=oldRef?await tx.get(oldRef):null;
        if(claim?.exists&&(claim.data().schoolId!==ctx.schoolId||claim.data().personId!==personId))
          deny("already-exists","This LRN is already associated with another school student record. Resolve the identity conflict with the Registrar.");
        if(oldClaim?.exists&&(oldClaim.data().schoolId!==ctx.schoolId||oldClaim.data().personId!==personId))
          deny("data-loss","The previous LRN claim has inconsistent ownership.");
        const revision=expectedRevision+1,now=FieldValue.serverTimestamp();
        if(claimRef){const value={schoolId:ctx.schoolId,personId,status:"active",updatedAt:now,updatedByUid:ctx.uid};
          if(claim.exists)tx.update(claimRef,value);else tx.create(claimRef,{...value,createdAt:now});}
        if(oldRef){const value={schoolId:ctx.schoolId,personId,status:"superseded",updatedAt:now,updatedByUid:ctx.uid};
          if(oldClaim.exists)tx.update(oldRef,value);else tx.create(oldRef,{...value,createdAt:now});}
        const payload={schoolId:ctx.schoolId,personId,...details,revision,updatedAt:now,updatedByUid:ctx.uid,
          lrnVerifiedByUid:details.lrnState==="verified"?ctx.uid:null,lrnVerifiedAt:details.lrnState==="verified"?now:null};
        if(profile.exists)tx.update(profileRef,payload);else tx.create(profileRef,{...payload,createdAt:now,createdByUid:ctx.uid});
        tx.create(db.collection(root+"student_records_audit").doc(),{schoolId:ctx.schoolId,personId,actorUid:ctx.uid,
          action:"registrar_profile_reviewed",fields:Object.keys(details).filter(field=>(prior[field]??null)!==details[field]),reason,revision,createdAt:now});
      });
      return {personId,revision:expectedRevision+1};
    }
    if(input.action==="list_document_requests"){
      const filter=String(input.status||"open"),cursor=input.cursor?id(input.cursor,"Document request cursor",330):null,pageSize=40;
      if(!["open","all",...Object.keys(REQUEST_TRANSITIONS)].includes(filter))deny("invalid-argument","Choose a document request status.");
      let query=db.collection(root+"student_document_requests").where("schoolId","==",ctx.schoolId);
      if(filter==="open")query=query.where("status","in",["requested","in_review","ready"]);
      else if(filter!=="all")query=query.where("status","==",filter);
      query=query.orderBy(FieldPath.documentId()).limit(pageSize+1);if(cursor)query=query.startAfter(cursor);
      const snap=await query.get(),page=snap.docs.slice(0,pageSize),
        scoped=page.filter(doc=>doc.data().schoolId===ctx.schoolId),
        personIds=[...new Set(scoped.map(doc=>id(doc.data().personId,"Person ID")))],
        people=await Promise.all(personIds.map(personId=>db.doc(root+"people/"+personId).get())),
        lookup=new Map(people.filter(doc=>doc.exists&&doc.data().schoolId===ctx.schoolId&&doc.data().kind==="student").map(doc=>[doc.id,doc.data()]));
      return {items:scoped.filter(doc=>lookup.has(doc.data().personId)).map(doc=>{
        const row=doc.data(),person=lookup.get(row.personId);
        return {requestId:doc.id,personId:row.personId,displayName:person.displayName||"Student",studentNumber:person.studentNumber||"",
          type:row.type,label:requestTypeLabel(row.type),status:row.status||"requested",purpose:row.purpose||"",
          generationMode:row.generationMode||"external",hasCertificateDraft:Boolean(row.certificateDraft),credentialState:row.credentialState||"",
          releaseReference:row.releaseReference||"",revision:Number(row.revision)||1,requestedAt:millis(row.requestedAt),
          updatedAt:millis(row.updatedAt),releasedAt:millis(row.releasedAt)};
      }),nextCursor:snap.size>pageSize?page.at(-1).id:null,skippedCount:scoped.filter(doc=>!lookup.has(doc.data().personId)).length};
    }
    if(input.action==="search_students"){
      const query=(optional(input.query,160)||"").toLocaleLowerCase("en");
      const cursor=input.cursor?id(input.cursor,"Student directory cursor"):"";
      // Stable school-local document-ID ordering includes older records without searchKey.
      // Search scans a bounded page; a cursor explicitly indicates unsearched records.
      const pageSize=80;
      let scan=db.collection(root+"people").where("kind","==","student")
        .orderBy(FieldPath.documentId()).limit(pageSize+1);
      if(cursor)scan=scan.startAfter(cursor);
      const snap=await scan.get(),page=snap.docs.slice(0,pageSize);
      const rows=page.filter(doc=>{
        const row=doc.data();
        if(row.schoolId!==ctx.schoolId)return false;
        if(!query)return true;
        return [row.displayName,row.studentNumber].some(value=>
          String(value||"").toLocaleLowerCase("en").includes(query));
      }).map(doc=>({
        personId:doc.id,displayName:doc.data().displayName||"Student",
        studentNumber:doc.data().studentNumber||"",status:doc.data().status||"active",
        revision:Number(doc.data().revision)||1
      }));
      const nextCursor=snap.docs.length>pageSize?page.at(-1).id:null;
      return {items:rows,nextCursor,truncated:Boolean(nextCursor)};
    }

    if(input.action==="student_file"){
      const personId=id(input.personId,"Person ID"),a=await student(personId);
      const section=input.historySection||null,cursor=input.cursor?id(input.cursor,"History cursor",330):null,
        sections=["registrations","guardians","documentRequests","releasedGrades","audit"];
      if((section&&!sections.includes(section))||(cursor&&!section))deny("invalid-argument","Choose a valid history section.");
      const nextCursors={};
      async function historyPage(name,collection,field,pageSize){
        if(section&&section!==name)return {docs:[]};
        let query=db.collection(root+collection).where(field,"==",personId).orderBy(FieldPath.documentId()).limit(pageSize+1);
        if(cursor)query=query.startAfter(cursor);
        const snap=await query.get(),docs=snap.docs.slice(0,pageSize);
        nextCursors[name]=snap.docs.length>pageSize?docs.at(-1).id:null;
        return {docs};
      }
      const [registrationSnap,relationshipSnap,requestSnap,gradeSnap,auditSnap]=await Promise.all([
        historyPage("registrations","student_registrations","personId",50),
        historyPage("guardians","guardian_relationships","studentPersonId",40),
        historyPage("documentRequests","student_document_requests","personId",50),
        historyPage("releasedGrades","class_record_period_grades","personId",60),
        historyPage("audit","student_records_audit","personId",50)
      ]);

      const registrations=registrationSnap.docs.filter(doc=>doc.data().schoolId===ctx.schoolId)
        .map(doc=>({registrationId:doc.id,...doc.data()}));
      const relationships=relationshipSnap.docs.filter(doc=>doc.data().schoolId===ctx.schoolId);
      const contactIds=[...new Set(relationships.map(doc=>doc.data().guardianContactId).filter(Boolean))];
      const contacts=await Promise.all(contactIds.map(contactId=>
        db.doc(root+"guardian_contacts/"+id(contactId,"Guardian contact ID")).get()));
      const contactMap=new Map(contacts.filter(doc=>doc.exists&&doc.data().schoolId===ctx.schoolId)
        .map(doc=>[doc.id,doc.data()]));

      const gradeRows=gradeSnap.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&
        doc.data().status==="finalized");
      const offeringIds=[...new Set(gradeRows.map(doc=>doc.data().offeringId).filter(Boolean))];
      const finalizations=await Promise.all(offeringIds.map(offeringId=>
        db.doc(root+"class_record_finalizations/"+id(offeringId,"Course offering ID",330)).get()));
      const released=new Map(finalizations.filter(doc=>doc.exists&&doc.data().schoolId===ctx.schoolId)
        .map(doc=>[doc.id,Number(doc.data().releasedRevision)||0]));
      const releasedGradeDocs=await Promise.all(gradeRows.map(async doc=>{
        const releasedRevision=released.get(doc.data().offeringId)||0;
        if(releasedRevision<1)return null;
        if(Number(doc.data().finalizationRevision)===releasedRevision)return doc;
        const historical=await doc.ref.collection("revisions").doc(String(releasedRevision)).get();
        if(!historical.exists||historical.data().schoolId!==ctx.schoolId||
           historical.data().personId!==personId||historical.data().offeringId!==doc.data().offeringId||
           Number(historical.data().finalizationRevision)!==releasedRevision)return null;
        return historical;
      }));
      const releasedGrades=releasedGradeDocs.filter(Boolean).map(doc=>({
        offeringId:doc.data().offeringId,yearId:doc.data().yearId,termId:doc.data().termId,
        subjectId:doc.data().subjectId,sectionId:doc.data().sectionId,
        initialGrade:Number(doc.data().initialGrade),periodGrade:Number(doc.data().periodGrade),
        finalGrade:Number(doc.data().finalGrade),revision:Number(doc.data().finalizationRevision)||1,
        releasedRevision:released.get(doc.data().offeringId),finalizedAt:millis(doc.data().finalizedAt)
      }));

      const labelRefs=new Set();
      for(const row of registrations){
        [["academic_years",row.yearId],["academic_programs",row.programId],
         ["terms",row.termId],["sections",row.sectionId]].forEach(([kind,value])=>{
          if(value)labelRefs.add(kind+"/"+value);
        });
      }
      for(const row of releasedGrades){
        [["academic_years",row.yearId],["terms",row.termId],["subjects",row.subjectId],
         ["sections",row.sectionId]].forEach(([kind,value])=>{if(value)labelRefs.add(kind+"/"+value);});
      }
      const labelPaths=[...labelRefs],labelDocs=await Promise.all(labelPaths.map(path=>db.doc(root+path).get()));
      const labels=Object.fromEntries(labelPaths.map((path,index)=>[
        path,labelDocs[index].exists&&labelDocs[index].data().schoolId===ctx.schoolId
          ?String(labelDocs[index].data().name||path.split("/").at(-1)).slice(0,160)
          :path.split("/").at(-1)
      ]));

      const guardians=relationships.map(doc=>{
        const row=doc.data(),contact=contactMap.get(row.guardianContactId)||{};
        return {
          relationshipId:doc.id,guardianContactId:row.guardianContactId,
          relationship:row.relationship||"Guardian",status:row.status||"active",
          isPrimary:row.isPrimary===true,revision:Number(row.revision)||1,
          displayName:contact.displayName||"Guardian",email:contact.email||"",
          mobile:contact.mobile||"",contactStatus:contact.status||"active",
          contactRevision:Number(contact.revision)||1,linkedUid:contact.linkedUid||null,
          createdAt:millis(row.createdAt),endedAt:millis(row.endedAt),restoredAt:millis(row.restoredAt)
        };
      }).sort((x,y)=>(y.isPrimary?1:0)-(x.isPrimary?1:0)||x.displayName.localeCompare(y.displayName));
      const requests=requestSnap.docs.filter(doc=>doc.data().schoolId===ctx.schoolId)
        .map(doc=>({
          requestId:doc.id,type:doc.data().type,status:doc.data().status||"requested",
          label:requestTypeLabel(doc.data().type),purpose:doc.data().purpose||"",
          generationMode:doc.data().generationMode||"external",hasCertificateDraft:Boolean(doc.data().certificateDraft),credentialState:doc.data().credentialState||"",
          notes:doc.data().notes||"",releaseReference:doc.data().releaseReference||"",
          revision:Number(doc.data().revision)||1,requestedAt:millis(doc.data().requestedAt),
          updatedAt:millis(doc.data().updatedAt),releasedAt:millis(doc.data().releasedAt)
        })).sort((x,y)=>(y.updatedAt||y.requestedAt||0)-(x.updatedAt||x.requestedAt||0));
      const audit=auditSnap.docs.filter(doc=>doc.data().schoolId===ctx.schoolId)
        .map(doc=>({auditId:doc.id,action:doc.data().action||"record_change",
          reason:doc.data().reason||"",createdAt:millis(doc.data().createdAt)}))
        .sort((x,y)=>(y.createdAt||0)-(x.createdAt||0));
      const p=a.data,primaryEmail=normalizeGuardianEmail(p.primaryGuardianEmail);
      const legacyGuardianAvailable=!section&&!nextCursors.guardians&&Boolean(primaryEmail&&p.primaryGuardianName)&&
        !guardians.some(row=>row.email===primaryEmail&&row.status==="active");
      return {
        person:{personId,displayName:p.displayName||"Student",studentNumber:p.studentNumber||"",
          birthDate:p.birthDate||"",status:p.status||"active",revision:Number(p.revision)||1,
          accountLinked:Boolean(p.authUid),accountResponsibility:p.accountResponsibility||"student",
          primaryGuardianName:p.primaryGuardianName||"",primaryGuardianEmail:p.primaryGuardianEmail||"",
          primaryGuardianMobile:p.primaryGuardianMobile||"",primaryGuardianRelationship:p.primaryGuardianRelationship||""},
        registrations:registrations.map(row=>({
          registrationId:row.registrationId,status:row.status||"active",gradeLevel:row.gradeLevel||null,
          yearId:row.yearId,programId:row.programId,termId:row.termId,sectionId:row.sectionId,
          yearName:labels["academic_years/"+row.yearId]||row.yearId,
          programName:labels["academic_programs/"+row.programId]||row.programId,
          termName:labels["terms/"+row.termId]||row.termId,
          sectionName:labels["sections/"+row.sectionId]||row.sectionId,
          progressionType:row.progressionType||null,endReasonType:row.endReasonType||null,
          previousRegistrationId:row.previousRegistrationId||null,
          progressedToRegistrationId:row.progressedToRegistrationId||null,
          revision:Number(row.revision)||1,createdAt:millis(row.createdAt),endedAt:millis(row.endedAt)
        })).sort((x,y)=>(y.createdAt||0)-(x.createdAt||0)),
        guardians,documentRequests:requests,
        releasedGrades:releasedGrades.map(row=>({
          ...row,yearName:labels["academic_years/"+row.yearId]||row.yearId,
          termName:labels["terms/"+row.termId]||row.termId,
          subjectName:labels["subjects/"+row.subjectId]||row.subjectId,
          sectionName:labels["sections/"+row.sectionId]||row.sectionId
        })).sort((x,y)=>(y.finalizedAt||0)-(x.finalizedAt||0)),
        legacyGuardianAvailable,audit,nextCursors,historySection:section
      };
    }

    if(input.action==="adopt_primary_guardian"){
      const personId=id(input.personId,"Person ID"),expectedPersonRevision=Number(input.expectedPersonRevision);
      if(!Number.isSafeInteger(expectedPersonRevision)||expectedPersonRevision<1)
        deny("invalid-argument","Refresh the student record before adopting guardian data.");
      const initial=await student(personId),p=initial.data,
        email=normalizeGuardianEmail(p.primaryGuardianEmail);
      if(!email||!p.primaryGuardianName)
        deny("failed-precondition","This student has no complete primary-guardian snapshot to adopt.");
      const contactId=guardianContactIdForEmail(email),
        relationshipId=guardianRelationshipId(personId,contactId),
        contactRef=db.doc(root+"guardian_contacts/"+contactId),
        relationshipRef=db.doc(root+"guardian_relationships/"+relationshipId);
      await db.runTransaction(async tx=>{
        await requireCurrentAdmin(tx);
        const [person,contact,relationship,relationships]=await Promise.all([
          tx.get(initial.ref),tx.get(contactRef),tx.get(relationshipRef),
          tx.get(db.collection(root+"guardian_relationships").where("studentPersonId","==",personId).limit(51))
        ]);
        if(relationships.size===51)
          deny("resource-exhausted","Guardian relationship history requires pagination.");
        const others=relationships.docs.filter(doc=>doc.data().schoolId===ctx.schoolId);
        if(!person.exists||person.data().schoolId!==ctx.schoolId||
           Number(person.data().revision||1)!==expectedPersonRevision)
          deny("failed-precondition","The student identity or guardian snapshot changed. Refresh before adoption.");
        if(contact.exists&&contact.data().schoolId!==ctx.schoolId)
          deny("failed-precondition","Guardian contact identity collision requires review.");
        if(contact.exists&&contact.data().status!=="active")
          deny("failed-precondition","The matching guardian contact is inactive. Review it before adoption.");
        if(relationship.exists&&relationship.data().schoolId!==ctx.schoolId)
          deny("failed-precondition","Guardian relationship identity collision requires review.");
        const now=FieldValue.serverTimestamp();
        if(contact.exists){
          const update={revision:(Number(contact.data().revision)||1)+1,updatedAt:now,updatedByUid:ctx.uid};
          if(!contact.data().displayName)update.displayName=String(p.primaryGuardianName).slice(0,140);
          if(!contact.data().mobile&&p.primaryGuardianMobile)update.mobile=String(p.primaryGuardianMobile).slice(0,40);
          tx.update(contactRef,update);
        }else tx.create(contactRef,{
          schoolId:ctx.schoolId,displayName:String(p.primaryGuardianName).slice(0,140),email,
          mobile:String(p.primaryGuardianMobile||"").slice(0,40),status:"active",linkedUid:null,
          revision:1,createdByUid:ctx.uid,createdAt:now,updatedAt:now
        });
        for(const row of others){
          if(!row.exists||row.id===relationshipId||row.data().schoolId!==ctx.schoolId||
             row.data().status!=="active"||row.data().isPrimary!==true)continue;
          tx.update(row.ref,{isPrimary:false,revision:(Number(row.data().revision)||1)+1,updatedAt:now,updatedByUid:ctx.uid});
        }
        const relation={
          schoolId:ctx.schoolId,studentPersonId:personId,guardianContactId:contactId,
          relationship:String(p.primaryGuardianRelationship||"Guardian").slice(0,60)||"Guardian",
          isPrimary:true,status:"active",revision:relationship.exists?(Number(relationship.data().revision)||1)+1:1,
          updatedByUid:ctx.uid,updatedAt:now
        };
        if(relationship.exists)tx.set(relationshipRef,{
          ...relation,restoredAt:relationship.data().status==="ended"?now:(relationship.data().restoredAt||null),
          restoredByUid:relationship.data().status==="ended"?ctx.uid:(relationship.data().restoredByUid||null)
        },{merge:true});
        else tx.create(relationshipRef,{...relation,createdByUid:ctx.uid,createdAt:now});
        tx.create(db.collection(root+"student_records_audit").doc(),{
          schoolId:ctx.schoolId,personId,actorUid:ctx.uid,relationshipId,guardianContactId:contactId,
          action:"guardian_primary_snapshot_adopted",createdAt:now
        });
      });
      return {personId,relationshipId,guardianContactId:contactId,status:"active"};
    }

    if(input.action==="save_guardian"){
      const personId=id(input.personId,"Person ID"),
        relationshipLabel=required(input.relationship,"Guardian relationship",60),
        isPrimary=input.isPrimary===true,
        relationshipIdInput=input.relationshipId? id(input.relationshipId,"Guardian relationship ID"):null;
      let relationshipRef,contactRef,contactId,expectedRelationshipRevision=Number(input.expectedRelationshipRevision||0),
        expectedContactRevision=Number(input.expectedContactRevision||0);
      if(relationshipIdInput){
        relationshipRef=db.doc(root+"guardian_relationships/"+relationshipIdInput);
        const current=await relationshipRef.get();
        if(!current.exists||current.data().schoolId!==ctx.schoolId||current.data().studentPersonId!==personId)
          deny("not-found","Guardian relationship was not found.");
        contactId=id(current.data().guardianContactId,"Guardian contact ID");
        contactRef=db.doc(root+"guardian_contacts/"+contactId);
        if(!Number.isSafeInteger(expectedRelationshipRevision)||expectedRelationshipRevision<1||
           !Number.isSafeInteger(expectedContactRevision)||expectedContactRevision<1)
          deny("invalid-argument","Refresh the guardian record before editing it.");
      }else{
        const email=normalizeGuardianEmail(input.email);
        if(!email)deny("invalid-argument","Enter a valid guardian email.");
        contactId=guardianContactIdForEmail(email);
        relationshipRef=db.doc(root+"guardian_relationships/"+guardianRelationshipId(personId,contactId));
        contactRef=db.doc(root+"guardian_contacts/"+contactId);
        expectedRelationshipRevision=0;
        expectedContactRevision=0;
      }
      const guardianName=required(input.displayName,"Guardian name",140),
        mobile=optional(input.mobile,40)||"",
        email=normalizeGuardianEmail(input.email);
      if(!email)deny("invalid-argument","Enter a valid guardian email.");
      let result;
      await db.runTransaction(async tx=>{
        await requireCurrentAdmin(tx);
        const a=await student(personId,ref=>tx.get(ref));
        if(a.data.status!=="active")deny("failed-precondition","Guardian relationships can be changed only for an active student record.");
        const [contact,relationship,relationships]=await Promise.all([
          tx.get(contactRef),tx.get(relationshipRef),
          tx.get(db.collection(root+"guardian_relationships").where("studentPersonId","==",personId).limit(51))
        ]);
        if(relationships.size===51)
          deny("resource-exhausted","Guardian relationship history requires pagination.");
        const others=relationships.docs.filter(doc=>doc.data().schoolId===ctx.schoolId);
        if(contact.exists&&contact.data().schoolId!==ctx.schoolId)
          deny("failed-precondition","Guardian contact identity collision requires review.");
        if(relationship.exists&&relationship.data().schoolId!==ctx.schoolId)
          deny("failed-precondition","Guardian relationship identity collision requires review.");
        if(relationshipIdInput){
          if(!relationship.exists||relationship.data().status!=="active")
            deny("failed-precondition","Restore this guardian relationship before editing it.");
          if((Number(relationship.data().revision)||1)!==expectedRelationshipRevision)
            deny("failed-precondition","This guardian relationship changed after you opened it. Refresh before saving.");
          if(!contact.exists||(Number(contact.data().revision)||1)!==expectedContactRevision)
            deny("failed-precondition","This guardian contact changed after you opened it. Refresh before saving.");
          if(normalizeGuardianEmail(contact.data().email)!==email)
            deny("failed-precondition","Guardian email is the contact identity and cannot be changed in-place. Add the new contact as a separate guardian relationship.");
        }else if(relationship.exists)
          deny("already-exists","This guardian is already linked to the student. Edit or restore the existing relationship.");
        const now=FieldValue.serverTimestamp();
        let nextContactRevision;
        if(contact.exists){
          if(contact.data().status!=="active")
            deny("failed-precondition","The guardian contact is inactive and must be reviewed before it can be linked.");
          if(relationshipIdInput){
            nextContactRevision=(Number(contact.data().revision)||1)+1;
            tx.update(contactRef,{displayName:guardianName,email,mobile,
              revision:nextContactRevision,updatedByUid:ctx.uid,updatedAt:now});
          }else nextContactRevision=Number(contact.data().revision)||1;
        }else{
          nextContactRevision=1;
          tx.create(contactRef,{schoolId:ctx.schoolId,displayName:guardianName,email,mobile,
            status:"active",linkedUid:null,revision:1,createdByUid:ctx.uid,createdAt:now,updatedAt:now});
        }
        if(isPrimary)for(const row of others){
          if(!row.exists||row.id===relationshipRef.id||row.data().schoolId!==ctx.schoolId||
             row.data().status!=="active"||row.data().isPrimary!==true)continue;
          tx.update(row.ref,{isPrimary:false,revision:(Number(row.data().revision)||1)+1,updatedByUid:ctx.uid,updatedAt:now});
        }
        const revision=relationship.exists?(Number(relationship.data().revision)||1)+1:1,
          values={schoolId:ctx.schoolId,studentPersonId:personId,guardianContactId:contactId,
            relationship:relationshipLabel,isPrimary,status:"active",revision,updatedByUid:ctx.uid,updatedAt:now};
        if(relationship.exists)tx.update(relationshipRef,values);
        else tx.create(relationshipRef,{...values,createdByUid:ctx.uid,createdAt:now});
        tx.create(db.collection(root+"student_records_audit").doc(),{
          schoolId:ctx.schoolId,personId,actorUid:ctx.uid,relationshipId:relationshipRef.id,
          guardianContactId:contactId,action:relationship.exists?"guardian_relationship_updated":"guardian_relationship_created",
          revision,createdAt:now
        });
        result={relationshipId:relationshipRef.id,guardianContactId:contactId,revision,
          contactRevision:nextContactRevision,status:"active",contactReused:contact.exists&&!relationshipIdInput};
      });
      return result;
    }

    if(["end_guardian","restore_guardian"].includes(input.action)){
      const personId=id(input.personId,"Person ID"),
        relationshipId=id(input.relationshipId,"Guardian relationship ID"),
        expectedRevision=Number(input.expectedRevision),
        reason=required(input.reason,"Guardian lifecycle reason",500),
        restoring=input.action==="restore_guardian";
      if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)
        deny("invalid-argument","Refresh the guardian relationship before changing it.");
      if(reason.length<12)deny("invalid-argument","Explain the guardian relationship change in at least 12 characters.");
      const relationshipRef=db.doc(root+"guardian_relationships/"+relationshipId);
      let revision;
      await db.runTransaction(async tx=>{
        await requireCurrentAdmin(tx);
        const a=await student(personId,ref=>tx.get(ref)),current=await tx.get(relationshipRef);
        if(!current.exists||current.data().schoolId!==ctx.schoolId||
           current.data().studentPersonId!==personId)
          deny("not-found","Guardian relationship was not found.");
        if((Number(current.data().revision)||1)!==expectedRevision)
          deny("failed-precondition","This guardian relationship changed after you opened it. Refresh before changing it.");
        if(restoring&&current.data().status!=="ended")
          deny("failed-precondition","Only an ended guardian relationship can be restored.");
        if(!restoring&&current.data().status!=="active")
          deny("failed-precondition","Only an active guardian relationship can be ended.");
        const contact=await tx.get(db.doc(root+"guardian_contacts/"+id(current.data().guardianContactId,"Guardian contact ID")));
        if(restoring&&(!contact.exists||contact.data().schoolId!==ctx.schoolId||contact.data().status!=="active"||
          a.data.status!=="active"))
          deny("failed-precondition","Both the student and guardian contact must be active before restoring the relationship.");
        const now=FieldValue.serverTimestamp();revision=expectedRevision+1;
        tx.update(relationshipRef,{status:restoring?"active":"ended",
          ...(restoring?{restoredAt:now,restoredByUid:ctx.uid,restoreReason:reason}:
            {endedAt:now,endedByUid:ctx.uid,endReason:reason,isPrimary:false}),
          revision,updatedByUid:ctx.uid,updatedAt:now});
        tx.create(db.collection(root+"student_records_audit").doc(),{
          schoolId:ctx.schoolId,personId,actorUid:ctx.uid,relationshipId,
          guardianContactId:current.data().guardianContactId,
          action:restoring?"guardian_relationship_restored":"guardian_relationship_ended",
          reason,revision,createdAt:now
        });
      });
      return {relationshipId,status:restoring?"active":"ended",revision};
    }

    if(input.action==="create_document_request"){
      const personId=id(input.personId,"Person ID"),a=await student(personId);
      if(!["active","archived"].includes(a.data.status))
        deny("failed-precondition","Document requests require a retained active or archived student record.");
      const type=String(input.type||"").trim();
      if(!REQUEST_TYPES.has(type))deny("invalid-argument","Choose a supported student record request type.");
      const purpose=required(input.purpose,"Request purpose",300),notes=optional(input.notes,500)||"",
        requestRef=db.collection(root+"student_document_requests").doc(),requestId=requestRef.id;
      await db.runTransaction(async tx=>{
        await requireCurrentAdmin(tx);
        const currentStudent=await tx.get(a.ref);
        if(!currentStudent.exists||currentStudent.data().schoolId!==ctx.schoolId||
           !["active","archived"].includes(currentStudent.data().status))
          deny("failed-precondition","The student record changed. Refresh before creating the request.");
        const now=FieldValue.serverTimestamp();
        tx.create(requestRef,{schoolId:ctx.schoolId,personId,type,status:"requested",purpose,notes,
          generationMode:type==="certificate_of_enrollment"?"institutional":"external",
          requestedByUid:ctx.uid,requestedAt:now,revision:1,updatedAt:now});
        tx.create(db.collection(root+"student_records_audit").doc(),{
          schoolId:ctx.schoolId,personId,actorUid:ctx.uid,requestId,type,
          action:"student_document_request_created",reason:purpose,revision:1,createdAt:now
        });
      });
      return {requestId,type,label:requestTypeLabel(type),status:"requested",revision:1};
    }

    if(input.action==="change_document_request"){
      const requestId=id(input.requestId,"Document request ID"),expectedRevision=Number(input.expectedRevision),
        nextStatus=String(input.status||"").trim().toLowerCase(),
        reason=required(input.reason,"Document request lifecycle reason",500),
        releaseReference=optional(input.releaseReference,120)||"";
      if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)
        deny("invalid-argument","Refresh the document request before changing it.");
      if(reason.length<12)deny("invalid-argument","Explain the document-request change in at least 12 characters.");
      const requestRef=db.doc(root+"student_document_requests/"+requestId);
      let personId,revision;
      await db.runTransaction(async tx=>{
        await requireCurrentAdmin(tx);
        const current=await tx.get(requestRef);
        if(!current.exists||current.data().schoolId!==ctx.schoolId)
          deny("not-found","Student document request was not found.");
        personId=id(current.data().personId,"Person ID");
        const priorStatus=current.data().status||"requested";
        if((Number(current.data().revision)||1)!==expectedRevision)
          deny("failed-precondition","This document request changed after you opened it. Refresh before saving.");
        if(!REQUEST_TRANSITIONS[priorStatus]?.has(nextStatus))
          deny("failed-precondition","The document request cannot move from "+priorStatus+" to "+nextStatus+".");
        if(current.data().generationMode==="institutional"){
          await requireRegistrarMembership(ref=>tx.get(ref));
          if(nextStatus==="ready"&&!current.data().certificateDraft)deny("failed-precondition","Prepare the institutional certificate before marking it ready.");
          if(nextStatus==="released")deny("failed-precondition","Use the certificate issuance action for this request.");
        }
        if(nextStatus==="released"&&!releaseReference)
          deny("invalid-argument","Record the release/reference number before marking this request released.");
        const now=FieldValue.serverTimestamp();revision=expectedRevision+1;
        tx.update(requestRef,{status:nextStatus,revision,updatedByUid:ctx.uid,updatedAt:now,
          lastStatusReason:reason,
          ...(nextStatus==="in_review"?{reviewedAt:now,reviewedByUid:ctx.uid}:{}),
          ...(nextStatus==="ready"?{readyAt:now,readyByUid:ctx.uid}:{}),
          ...(nextStatus==="released"?{releasedAt:now,releasedByUid:ctx.uid,releaseReference}:{}),
          ...(nextStatus==="cancelled"?{cancelledAt:now,cancelledByUid:ctx.uid}:{}),
        });
        tx.create(db.collection(root+"student_records_audit").doc(),{
          schoolId:ctx.schoolId,personId,actorUid:ctx.uid,requestId,
          action:"student_document_request_status_changed",fromStatus:priorStatus,toStatus:nextStatus,
          reason,revision,createdAt:now
        });
      });
      return {requestId,personId,status:nextStatus,revision,releaseReference:nextStatus==="released"?releaseReference:""};
    }

    deny("invalid-argument","Unknown Student Records operation.");
  };
}
module.exports={
  createSchoolStudentRecordsService,REQUEST_TYPES,REQUEST_TRANSITIONS,requestTypeLabel,normalizeLrn,normalizeRegistrarProfile
};
