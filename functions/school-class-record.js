      const schemeRef=db.doc(prefix+"grading_schemes/"+schemeId);
      const expectedRevision=Number(input.expectedRevision);
      if(!Number.isInteger(expectedRevision)||expectedRevision<0)
        deny("invalid-argument","Grading scheme revision is invalid.");
      const auditRef=db.collection(prefix+"grading_scheme_audit").doc();
      let result;
      await db.runTransaction(async tx=>{
        await verifySchoolAdmin(tx);
        const current=await tx.get(schemeRef),prior=current.exists?current.data():null;
        const priorRevision=prior?Number(prior.revision)||0:0;
        if(prior&&prior.schoolId!==ctx.schoolId)deny("permission-denied","Grading scheme belongs to another school.");
        if(priorRevision!==expectedRevision)
          deny("failed-precondition","This grading scheme changed. Reload it before saving.");
        const now=FieldValue.serverTimestamp();
        if(input.action==="save_scheme"){
          const name=text(input.name,"Grading scheme name",120);
          const description=String(input.description||"").trim();
          if(description.length>300)deny("invalid-argument","Grading scheme description cannot exceed 300 characters.");
          const schemeSettings=cleanSettings(input.settings||{});
          const total=schemeSettings.categoryWeights.reduce((sum,row)=>sum+row.weight,0);
          if(!schemeSettings.categoryWeights.length||Math.abs(total-100)>0.001)
            deny("invalid-argument","A school grading scheme must contain category weights totaling exactly 100 percent.");
          const storedSettings={
            categoryWeights:schemeSettings.categoryWeights,
            gradeComputation:schemeSettings.gradeComputation
          };
          const revision=priorRevision+1;
          const values={schoolId:ctx.schoolId,name,description,status:"active",
            settings:storedSettings,revision,updatedByUid:ctx.uid,updatedAt:now};
          if(prior)tx.update(schemeRef,values);
          else tx.create(schemeRef,{...values,createdByUid:ctx.uid,createdAt:now});
          tx.create(auditRef,{schoolId:ctx.schoolId,schemeId,actorUid:ctx.uid,
            action:prior?"grading_scheme_updated":"grading_scheme_created",
            revision,createdAt:now});
          result={schemeId,name,description,status:"active",settings:storedSettings,revision};
        }else{
          if(!prior)deny("not-found","Grading scheme does not exist.");
          const status=input.action==="archive_scheme"?"archived":"active";
          if(prior.status===status){result={schemeId,status,revision:priorRevision};return;}
          const revision=priorRevision+1;
          tx.update(schemeRef,{status,revision,updatedByUid:ctx.uid,updatedAt:now});
          tx.create(auditRef,{schoolId:ctx.schoolId,schemeId,actorUid:ctx.uid,
            action:status==="archived"?"grading_scheme_archived":"grading_scheme_restored",
            revision,createdAt:now});
          result={schemeId,status,revision};
        }
      });
      return result;
    }

    if(!teacher)
      deny("permission-denied","An active teacher assignment is required to open a Class Record.");
    const offeringId=checkId(String(input.offeringId||""),"Course offering ID",330);
    const offeringRef=db.doc(prefix+"course_offerings/"+offeringId);
    const grantRef=db.doc(prefix+"staff_assignments/"+rowKey(ctx.uid,offeringId));
    const sheetRef=db.doc(prefix+"class_records/"+offeringId);

    async function verifyOffering(){
      const [offering,grant]=await Promise.all([offeringRef.get(),grantRef.get()]);
      if(!offering.exists||offering.data().schoolId!==ctx.schoolId)
        deny("not-found","This course offering is unavailable.");
      if(!grant.exists||grant.data().schoolId!==ctx.schoolId||
         grant.data().teacherUid!==ctx.uid||grant.data().offeringId!==offeringId||
         grant.data().status!=="active")
        deny("permission-denied","Only an actively assigned teacher can use this class record.");
      return offering.data();
    }
    async function activeOfferingTeachers(){
      const snap=await db.collection(prefix+"staff_assignments")
        .where("offeringId","==",offeringId).limit(21).get();
      if(snap.size===21)
        deny("resource-exhausted","This offering has more than 20 teacher assignments. Paginated collaborator review is required.");
      const active=snap.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&
        doc.data().offeringId===offeringId&&doc.data().status==="active");
      const memberships=await Promise.all(active.map(doc=>
        db.doc(prefix+"memberships/"+doc.data().teacherUid).get()));
      return active.map((doc,index)=>({
        name:memberships[index].exists&&memberships[index].data().schoolId===ctx.schoolId?
          String(memberships[index].data().displayName||"Teacher"):"Teacher",
        current:doc.data().teacherUid===ctx.uid
      })).sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:"base"}));
    }
    async function offeringLabels(offering){
      const [section,subject]=await Promise.all([
        db.doc(prefix+"sections/"+checkId(offering.sectionId,"Section ID",80)).get(),
        db.doc(prefix+"subjects/"+checkId(offering.subjectId,"Subject ID",80)).get()
      ]);
      return {
        sectionName:section.exists&&section.data().schoolId===ctx.schoolId?String(section.data().name||"").trim():"",
        subjectName:subject.exists&&subject.data().schoolId===ctx.schoolId?String(subject.data().name||"").trim():""
      };
    }
    async function legacyBridgeAllowed(){
      if(ctx.schoolId!==LEGACY_BRIDGE_SCHOOL||typeof resolveUsers!=="function")return false;
      const school=await db.doc("platform_schools/"+ctx.schoolId).get();
      return !school.exists||school.data().compatibilityMode!=="v4_only";
    }
    async function ownedSchoolAssessments(){
      const snap=await db.collection(prefix+"assessments")
        .where("offeringId","==",offeringId).limit(101).get();
      if(snap.size===101)
        deny("resource-exhausted","This class has too many school assessment deployments for the current Class Record view.");
      return snap.docs.filter(doc=>{
        const data=doc.data();
        return data.schoolId===ctx.schoolId&&
          (data.reviewerUid||data.ownerUid)===ctx.uid;
      }).map(doc=>({
        sourceType:SCHOOL_SOURCE,
        taskId:doc.id,
        title:String(doc.data().title||"Untitled assessment"),
        submissionSource:doc.data().submissionSource||"studio",
        lifecycle:doc.data().lifecycle||"active",
        dueAt:millis(doc.data().dueAt),
        maxPoints:rubricTotal(doc.data()),
        categorySuggestion:"",
        published:true,
        linkable:doc.data().status==="deployed"&&doc.data().lifecycle!=="cancelled",
        historical:doc.data().status!=="deployed"||doc.data().lifecycle==="cancelled",
        gradeRoute:"school-gradebook.html?task="+encodeURIComponent(doc.id)
      })).filter(task=>task.maxPoints>0);
    }
    async function ownedLegacyPersonalizedAssessments(sectionName){
      if(!sectionName||!(await legacyBridgeAllowed()))return [];
      const snap=await db.collection("assessments").where("ownerUid","==",ctx.uid).limit(201).get();
      if(snap.size===201)
        deny("resource-exhausted","Your legacy assessment library requires pagination before all Personalized assessments can be shown.");
      return snap.docs.map(doc=>({id:doc.id,...doc.data()})).filter(task=>{
        const assigned=new Set([
          ...(Array.isArray(task.sectionIds)?task.sectionIds:[]),
          ...(Array.isArray(task.deployments)?task.deployments.map(item=>item?.section):[])
        ].filter(value=>typeof value==="string"&&value.trim()));
        return task.schemaVersion===3&&task.submissionSource==="studio"&&
          task.assessmentFormat==="studio_code"&&
          (task.assessmentMode==="personalized"||task.personalizedTask?.enabled===true)&&
          assigned.has(sectionName);
      }).map(task=>({
        sourceType:LEGACY_PERSONALIZED_SOURCE,
        taskId:task.id,
        title:String(task.title||"Untitled Personalized Studio assessment"),
        submissionSource:"studio",
        lifecycle:task.published===false?"unpublished":"active",
        dueAt:null,
        maxPoints:Number(task.maxScore),
        categorySuggestion:String(task.type||"").trim().slice(0,60),
        published:task.published!==false,
        linkable:true,
        historical:false,
        gradeRoute:"gradebook.html?"+new URLSearchParams({section:sectionName,assessment:task.id}).toString(),
        reviewRoute:"studio-submissions.html?"+new URLSearchParams({assessment:task.id,section:sectionName}).toString()
      })).filter(task=>Number.isFinite(task.maxPoints)&&task.maxPoints>0);
    }
    async function availableAssessments(offering,labels){
      const [school,legacy]=await Promise.all([
        ownedSchoolAssessments(),
        ownedLegacyPersonalizedAssessments(labels.sectionName)
      ]);
      return [...school,...legacy].sort((a,b)=>
        a.title.localeCompare(b.title,undefined,{sensitivity:"base"})||
        a.sourceType.localeCompare(b.sourceType));
    }
    async function classRoster(){
      const enrollments=await db.collection(prefix+"enrollments")
        .where("offeringId","==",offeringId).limit(MAX_CLASS_SIZE+1).get();
      if(enrollments.size>MAX_CLASS_SIZE)
        deny("resource-exhausted","This class has more than "+MAX_CLASS_SIZE+" enrollment records. Pagination is required before Class Record can load it.");
      const active=enrollments.docs.filter(doc=>doc.data().schoolId===ctx.schoolId&&doc.data().status==="active");
      const people=await Promise.all(active.map(row=>db.doc(prefix+"people/"+row.data().personId).get()));
      const internal=active.map((row,index)=>{
        const person=people[index],data=person.exists&&person.data().schoolId===ctx.schoolId?person.data():null;
        return {
          enrollmentId:row.id,personId:row.data().personId,
          name:data?String(data.displayName||"Student"):"Unlinked student record",
          authUid:data&&typeof data.authUid==="string"?data.authUid:""
        };
      }).sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:"base"}));
      return internal;
    }
    async function legacyStudentPersonMap(roster,sectionName){
      const mapping=new Map();
      if(!sectionName||!(await legacyBridgeAllowed()))return mapping;
      const uids=[...new Set(roster.map(row=>row.authUid).filter(Boolean))];
      if(!uids.length)return mapping;
      let users=[];
      try{users=await resolveUsers(uids);}
      catch{return mapping;}
      const emailToPerson=new Map();
      for(const user of users||[]){
        const email=normalizeEmail(user?.email);
        const row=roster.find(item=>item.authUid===user?.uid);
        if(email&&row)emailToPerson.set(email,row.personId);
      }
      if(!emailToPerson.size)return mapping;
      const legacy=await db.collection("students").where("section","==",sectionName).limit(201).get();
      if(legacy.size===201)
        deny("resource-exhausted","Legacy class identity mapping requires pagination before Personalized grades can be consolidated.");
      for(const doc of legacy.docs){
        const personId=emailToPerson.get(normalizeEmail(doc.data().email));
        if(personId)mapping.set(doc.id,personId);
      }
      return mapping;
    }
    async function legacyPublishedGrades(columns,roster,sectionName,available){
      const linked=columns.filter(column=>column.kind==="assessment"&&
        (column.assessmentSource||SCHOOL_SOURCE)===LEGACY_PERSONALIZED_SOURCE);
      if(!linked.length)return [];
      const studentToPerson=await legacyStudentPersonMap(roster,sectionName);
      if(!studentToPerson.size)return [];
      const taskIds=[...new Set(linked.map(column=>column.taskId))];
      const pages=await Promise.all(taskIds.map(taskId=>
        db.collection("student_grades").where("taskId","==",taskId).limit(201).get()));
      if(pages.some(page=>page.size===201))
        deny("resource-exhausted","A Personalized assessment grade set requires pagination before Class Record can consolidate it.");
      const latest=new Map();
      for(const page of pages)for(const doc of page.docs){
        const data=doc.data();
        if(data.published!==true)continue;
        const personId=studentToPerson.get(data.studentId);
        if(!personId)continue;
        const score=Number(data.score),total=Number(data.maxScore);
        if(!Number.isFinite(score)||!Number.isFinite(total)||total<=0)continue;
        const key=data.taskId+"::"+personId;
        const candidate={
          sourceType:LEGACY_PERSONALIZED_SOURCE,taskId:data.taskId,personId,
          awarded:score,total,revision:Number(data.gradeVersion)||1,
          publishedAt:millis(data.publishedAt)||millis(data.updatedAt)||millis(data.gradedAt)||0
        };
        const prior=latest.get(key);
        if(!prior||candidate.revision>prior.revision||
           (candidate.revision===prior.revision&&candidate.publishedAt>prior.publishedAt))
          latest.set(key,candidate);
      }
      return [...latest.values()];
    }

    async function buildWorkspaceData(){
      const offering=await verifyOffering();
      const labels=await offeringLabels(offering);
      const finalizationRef=db.doc(prefix+"class_record_finalizations/"+offeringId);
      const [roster,assessments,sheet,gradeSnap,manualSnap,finalizationDoc,collaborators]=await Promise.all([
        classRoster(),
        availableAssessments(offering,labels),
        sheetRef.get(),
        db.collection(prefix+"student_grades").where("offeringId","==",offeringId).limit(MAX_SCORE_CELLS+1).get(),
        db.collection(prefix+"class_record_scores").where("offeringId","==",offeringId).limit(MAX_SCORE_CELLS+1).get(),
        finalizationRef.get(),
        activeOfferingTeachers()
      ]);
      if(gradeSnap.size>MAX_SCORE_CELLS)
        deny("resource-exhausted","Published school grade cells exceed the bounded Class Record capacity.");
      if(manualSnap.size>MAX_SCORE_CELLS)
        deny("resource-exhausted","Manual score cells exceed the bounded Class Record capacity.");

      const columns=sheet.exists&&sheet.data().schoolId===ctx.schoolId&&Array.isArray(sheet.data().columns)
        ?sheet.data().columns.map(column=>{
          const normalized=column.kind==="assessment"&&!column.assessmentSource
            ?{...column,assessmentSource:SCHOOL_SOURCE}:column;
          return {...normalized,archived:normalized.archived===true};
        }):[];
      const knownAssessmentKeys=new Set(assessments.map(task=>assessmentKey(task.sourceType,task.taskId)));
      for(const column of columns.filter(item=>item.kind==="assessment")){
        const source=column.assessmentSource||SCHOOL_SOURCE,key=assessmentKey(source,column.taskId);
        if(knownAssessmentKeys.has(key))continue;
        assessments.push({
          sourceType:source,taskId:column.taskId,
          title:String(column.sourceTitle||column.label||"Historical assessment"),
          submissionSource:source===LEGACY_PERSONALIZED_SOURCE?"studio":"unknown",
          lifecycle:"historical",dueAt:null,maxPoints:Number(column.maxPoints)||0,
          categorySuggestion:column.category||"",published:true,linkable:false,historical:true,
          gradeRoute:null,reviewRoute:null
        });
        knownAssessmentKeys.add(key);
      }
      const settings=cleanSettings(sheet.exists&&sheet.data().schoolId===ctx.schoolId?sheet.data().settings:{});
      const schoolTaskIds=new Set(columns.filter(column=>column.kind==="assessment"&&
        (column.assessmentSource||SCHOOL_SOURCE)===SCHOOL_SOURCE).map(column=>column.taskId));
      const personIds=new Set(roster.map(row=>row.personId));
      const schoolGrades=gradeSnap.docs.map(doc=>doc.data()).filter(data=>
        data.schoolId===ctx.schoolId&&data.status==="published"&&
        schoolTaskIds.has(data.taskId)&&personIds.has(data.personId)
      ).map(data=>({
        sourceType:SCHOOL_SOURCE,taskId:data.taskId,personId:data.personId,
        awarded:Number(data.awarded)||0,total:Number(data.total)||0,
        revision:Number(data.revision)||1,publishedAt:millis(data.publishedAt)
      }));
      const legacyGrades=await legacyPublishedGrades(columns,roster,labels.sectionName,assessments);
      const manualIds=new Set(columns.filter(column=>column.kind==="manual").map(column=>column.columnId));
      const manualScores=manualSnap.docs.map(doc=>doc.data()).filter(data=>
        data.schoolId===ctx.schoolId&&manualIds.has(data.columnId)&&personIds.has(data.personId)
      ).map(data=>({
        columnId:data.columnId,personId:data.personId,
        score:data.score===null?null:Number(data.score),revision:Number(data.revision)||1
      }));
      const publishedGrades=[...schoolGrades,...legacyGrades];
      const snapshot=computePeriodSnapshot({columns,settings,roster,manualScores,publishedGrades});
      const finalization=finalizationDoc.exists&&finalizationDoc.data().schoolId===ctx.schoolId?{
        status:finalizationDoc.data().status||"finalized",
        revision:Number(finalizationDoc.data().revision)||1,
        sheetRevision:Number(finalizationDoc.data().sheetRevision)||0,
        sourceDigest:String(finalizationDoc.data().sourceDigest||""),
        finalizedAt:millis(finalizationDoc.data().finalizedAt),
        finalizedByUid:finalizationDoc.data().finalizedByUid||null,
        stale:String(finalizationDoc.data().sourceDigest||"")!==snapshot.sourceDigest
      }:null;
      return {
        offering,labels,roster,assessments,columns,settings,manualScores,publishedGrades,collaborators,
        sheetRevision:sheet.exists&&sheet.data().schoolId===ctx.schoolId?Number(sheet.data().revision)||0:0,
        finalization,snapshot
      };
    }

    if(input.action==="workspace"){
      const data=await buildWorkspaceData();
      return {
        offering:{offeringId,programId:data.offering.programId,yearId:data.offering.yearId,
          termId:data.offering.termId,subjectId:data.offering.subjectId,sectionId:data.offering.sectionId,
          sectionName:data.labels.sectionName,subjectName:data.labels.subjectName},
        roster:data.roster.map(({authUid,...row})=>row),
        assessments:data.assessments,columns:data.columns,settings:data.settings,
        manualScores:data.manualScores,publishedGrades:data.publishedGrades,
        collaborators:data.collaborators,
        sheetRevision:data.sheetRevision,finalization:data.finalization,
        periodReadiness:{
          ready:data.snapshot.ready,blockerCount:data.snapshot.blockerCount,
          activeColumnCount:data.snapshot.activeColumnCount
        }
      };
    }

    if(input.action==="finalization_preview"){
      const data=await buildWorkspaceData();
      return {
        offeringId,sheetRevision:data.sheetRevision,
        finalization:data.finalization,
        ready:data.snapshot.ready,blockerCount:data.snapshot.blockerCount,
        blockers:data.snapshot.blockers,sourceDigest:data.snapshot.sourceDigest,
        activeColumnCount:data.snapshot.activeColumnCount,
        grades:data.snapshot.ready?data.snapshot.grades:[]
      };
    }

    if(input.action==="finalization_history"){
      await verifyOffering();
      const finalizationRef=db.doc(prefix+"class_record_finalizations/"+offeringId);
      const current=await finalizationRef.get();
      if(!current.exists||current.data().schoolId!==ctx.schoolId)
        return {offeringId,revisions:[]};
      const snap=await finalizationRef.collection("revisions").limit(31).get();
      if(snap.size===31)
        deny("resource-exhausted","This period has more than 30 finalization revisions. Paginated history is required.");
      const revisions=snap.docs.map(doc=>doc.data()).filter(data=>
        data.schoolId===ctx.schoolId&&data.offeringId===offeringId
      ).map(data=>({
        revision:Number(data.revision)||0,sheetRevision:Number(data.sheetRevision)||0,
        sourceDigest:String(data.sourceDigest||""),studentCount:Number(data.studentCount)||0,
        gradeComputation:data.gradeComputation||"raw_weighted",
        categoryWeights:Array.isArray(data.categoryWeights)?data.categoryWeights:[],
        appliedSchemeId:data.appliedSchemeId||null,
        appliedSchemeRevision:Number(data.appliedSchemeRevision)||null,
        appliedSchemeName:String(data.appliedSchemeName||""),
        finalizedAt:millis(data.finalizedAt),finalizedByUid:data.finalizedByUid||null
      })).sort((a,b)=>b.revision-a.revision);
      return {offeringId,revisions};
    }

    if(input.action==="finalization_revision"){
      await verifyOffering();
      const revision=Number(input.revision);
      if(!Number.isInteger(revision)||revision<1||revision>100)
        deny("invalid-argument","Finalization revision is invalid.");
      const finalizationRef=db.doc(prefix+"class_record_finalizations/"+offeringId);
      const headerDoc=await finalizationRef.collection("revisions").doc(String(revision)).get();
      if(!headerDoc.exists||headerDoc.data().schoolId!==ctx.schoolId||
         headerDoc.data().offeringId!==offeringId)
        deny("not-found","This finalized period revision is unavailable.");
      const header=headerDoc.data();
      let personIds=Array.isArray(header.personIds)?
        header.personIds.filter(value=>typeof value==="string"&&value).slice(0,MAX_CLASS_SIZE):[];
      let gradeDocs=[];
      if(personIds.length){
        gradeDocs=await Promise.all(personIds.map(personId=>
          db.doc(prefix+"class_record_period_grades/"+hash(offeringId,personId)+
            "/revisions/"+revision).get()));
      }else{
        const currentGrades=await db.collection(prefix+"class_record_period_grades")
          .where("offeringId","==",offeringId).limit(MAX_CLASS_SIZE+1).get();
        if(currentGrades.size>MAX_CLASS_SIZE)
          deny("resource-exhausted","Finalized period history exceeds the bounded class size.");
        gradeDocs=await Promise.all(currentGrades.docs.map(doc=>
          doc.ref.collection("revisions").doc(String(revision)).get()));
      }
      const grades=gradeDocs.filter(doc=>doc.exists&&doc.data().schoolId===ctx.schoolId&&
        doc.data().offeringId===offeringId&&Number(doc.data().finalizationRevision)===revision)
        .map(doc=>({
          personId:doc.data().personId,name:String(doc.data().studentNameSnapshot||"Student"),
          initialGrade:Number(doc.data().initialGrade),
          periodGrade:Number(doc.data().periodGrade),
          categoryScores:Array.isArray(doc.data().categoryScores)?doc.data().categoryScores:[]
        })).sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:"base"}));
      if(grades.length!==Number(header.studentCount||0))
        deny("failed-precondition","The finalized revision grade set is incomplete. Preserve it for audit and contact an administrator before exporting.");
      return {
        offeringId,revision,
        finalizedAt:millis(header.finalizedAt),finalizedByUid:header.finalizedByUid||null,
        sheetRevision:Number(header.sheetRevision)||0,sourceDigest:String(header.sourceDigest||""),
        gradeComputation:header.gradeComputation||"raw_weighted",
        categoryWeights:Array.isArray(header.categoryWeights)?header.categoryWeights:[],
        appliedSchemeId:header.appliedSchemeId||null,
        appliedSchemeRevision:Number(header.appliedSchemeRevision)||null,
        appliedSchemeName:String(header.appliedSchemeName||""),
        columns:Array.isArray(header.columns)?header.columns:[],
        grades
      };
    }

    if(input.action==="finalize_period"){
      const expectedSheetRevision=Number(input.expectedSheetRevision);
      const expectedFinalizationRevision=Number(input.expectedFinalizationRevision||0);
      if(!Number.isInteger(expectedSheetRevision)||expectedSheetRevision<0||
         !Number.isInteger(expectedFinalizationRevision)||expectedFinalizationRevision<0)
        deny("invalid-argument","Finalization revision information is invalid.");
      const data=await buildWorkspaceData();
      if(data.sheetRevision!==expectedSheetRevision)
        deny("failed-precondition","The Class Record changed. Reload it before finalizing the period.");
      if(!data.snapshot.ready)
        deny("failed-precondition","Period grades are incomplete. Resolve every missing score and grading-setup blocker first.");
      const finalizationRef=db.doc(prefix+"class_record_finalizations/"+offeringId);
      const auditRef=db.collection(prefix+"class_record_audit").doc();
      const revision=expectedFinalizationRevision+1;
      const activeColumns=data.columns.filter(column=>column.archived!==true);
      await db.runTransaction(async tx=>{
        const [grant,currentSheet,currentFinalization]=await Promise.all([
          tx.get(grantRef),tx.get(sheetRef),tx.get(finalizationRef)
        ]);
        if(!grant.exists||grant.data().schoolId!==ctx.schoolId||
           grant.data().teacherUid!==ctx.uid||grant.data().status!=="active")
          deny("permission-denied","Your class assignment changed. Reload before finalizing.");
        if(!currentSheet.exists||currentSheet.data().schoolId!==ctx.schoolId||
           Number(currentSheet.data().revision||0)!==expectedSheetRevision)
          deny("failed-precondition","The Class Record layout changed while finalizing. Reload and review again.");
        const currentRevision=currentFinalization.exists?Number(currentFinalization.data().revision)||0:0;
        if(currentRevision!==expectedFinalizationRevision)
          deny("failed-precondition","Another period finalization was recorded. Reload before creating a new revision.");
        const now=FieldValue.serverTimestamp();
        const header={
          schoolId:ctx.schoolId,offeringId,
          yearId:data.offering.yearId,termId:data.offering.termId,
          subjectId:data.offering.subjectId,sectionId:data.offering.sectionId,
          status:"finalized",revision,sheetRevision:expectedSheetRevision,
          sourceDigest:data.snapshot.sourceDigest,
          gradeComputation:data.settings.gradeComputation,
          categoryWeights:data.settings.categoryWeights,
          appliedSchemeId:data.settings.appliedSchemeId||null,
          appliedSchemeRevision:data.settings.appliedSchemeRevision||null,
          appliedSchemeName:data.settings.appliedSchemeName||"",
          columns:activeColumns,studentCount:data.snapshot.grades.length,
          personIds:data.snapshot.grades.map(grade=>grade.personId),
          finalizedByUid:ctx.uid,finalizedAt:now,updatedAt:now
        };
        tx.set(finalizationRef,header,{merge:false});
        tx.create(finalizationRef.collection("revisions").doc(String(revision)),header);
        for(const grade of data.snapshot.grades){
          const gradeRef=db.doc(prefix+"class_record_period_grades/"+hash(offeringId,grade.personId));
          const gradeData={
            schoolId:ctx.schoolId,offeringId,personId:grade.personId,
            yearId:data.offering.yearId,termId:data.offering.termId,
            subjectId:data.offering.subjectId,sectionId:data.offering.sectionId,
            status:"finalized",finalizationRevision:revision,
            sheetRevision:expectedSheetRevision,sourceDigest:data.snapshot.sourceDigest,
            initialGrade:grade.initialGrade,periodGrade:grade.periodGrade,
            categoryScores:grade.categoryScores,studentNameSnapshot:grade.name,
            finalizedByUid:ctx.uid,finalizedAt:now,updatedAt:now
          };
          tx.set(gradeRef,gradeData,{merge:false});
          tx.create(gradeRef.collection("revisions").doc(String(revision)),gradeData);
        }
        tx.create(auditRef,{schoolId:ctx.schoolId,offeringId,actorUid:ctx.uid,
          action:"class_record_period_finalized",revision,sheetRevision:expectedSheetRevision,
          sourceDigest:data.snapshot.sourceDigest,studentCount:data.snapshot.grades.length,
          createdAt:now});
      });
      return {
        offeringId,status:"finalized",revision,sheetRevision:expectedSheetRevision,
        sourceDigest:data.snapshot.sourceDigest,studentCount:data.snapshot.grades.length
      };
    }

    if(input.action==="save_layout"){
      const offering=await verifyOffering(),labels=await offeringLabels(offering);
      const assessmentRows=await availableAssessments(offering,labels);
      const assessmentMap=new Map(assessmentRows.map(task=>[
        assessmentKey(task.sourceType,task.taskId),task
      ]));
      const beforeSheet=await sheetRef.get();
      const previousColumns=beforeSheet.exists&&beforeSheet.data().schoolId===ctx.schoolId&&
        Array.isArray(beforeSheet.data().columns)?beforeSheet.data().columns:[];
      const previousSettings=cleanSettings(beforeSheet.exists&&beforeSheet.data().schoolId===ctx.schoolId?
        beforeSheet.data().settings:{});
      const columns=cleanColumns(input.columns,assessmentMap,previousColumns);
      const settings=cleanSettings(input.settings);
      const schemeChanged=settings.appliedSchemeId&&(
        settings.appliedSchemeId!==previousSettings.appliedSchemeId||
        settings.appliedSchemeRevision!==previousSettings.appliedSchemeRevision||
        settingsCoreKey(settings)!==settingsCoreKey(previousSettings)
      );
      if(schemeChanged){
        const scheme=await db.doc(prefix+"grading_schemes/"+settings.appliedSchemeId).get();
        if(!scheme.exists||scheme.data().schoolId!==ctx.schoolId||scheme.data().status!=="active"||
           Number(scheme.data().revision)!==settings.appliedSchemeRevision)
          deny("failed-precondition","The selected school grading scheme changed. Reload grading setup and apply the current revision.");
        const schemeSettings=cleanSettings(scheme.data().settings||{});
        if(settingsCoreKey(schemeSettings)!==settingsCoreKey(settings))
          deny("failed-precondition","The applied grading scheme snapshot does not match the current school preset.");
      }
      const expectedRevision=Number(input.expectedRevision);
      if(!Number.isInteger(expectedRevision)||expectedRevision<0)
        deny("invalid-argument","The Class Record layout revision is invalid.");
      const auditRef=db.collection(prefix+"class_record_audit").doc();
      let revision;