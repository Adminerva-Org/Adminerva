import {auth,db} from "../core/firebase-core.js?v=1.3.0";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {collection,doc,getDoc,getDocs,query,where,runTransaction,serverTimestamp} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {snapshotStudioProject,studioDigest,studioEvidenceId,studioSubmissionAllowed} from "./studio-assessment-model.mjs?v=1.0.1";

const button=document.getElementById("studioSubmitAssessment");
if(button){
  const dialog=document.getElementById("studioSubmitDialog");
  const choose=document.getElementById("studioSubmitChoice");
  const state=document.getElementById("studioSubmitStatus");
  const details=document.getElementById("studioSubmitDetails");
  const confirmButton=document.getElementById("studioConfirmSubmit");
  const close=()=>dialog.close();
  let choices=new Map(),busy=false,openedUser=null;
  const notice=text=>{state.textContent=text;};
  const load=async()=>{
    const user=auth.currentUser;
    if(!user?.email_verified||!user.email)throw Error("Sign in with a verified school email.");
    openedUser=user.uid;
    choices=new Map();choose.replaceChildren();
    notice("Loading available Studio assessments…");
    const students=await getDocs(query(collection(db,"students"),where("email","==",user.email.toLowerCase())));
    if(auth.currentUser?.uid!==openedUser)throw Error("Account changed while loading.");
    if(students.empty)throw Error("Your verified school email has no linked student record.");
    for(const record of students.docs){
      const student={id:record.id,...record.data()};
      const tasks=await getDocs(query(collection(db,"assessments"),where("sectionIds","array-contains",student.section)));
      if(auth.currentUser?.uid!==openedUser)throw Error("Account changed while loading.");
      for(const taskDoc of tasks.docs){
        const assessment={id:taskDoc.id,...taskDoc.data()};
        const window=studioSubmissionAllowed(assessment,student.section);
        // The server, not the browser clock, decides whether a submission
        // is currently accepted. Still show scheduled tasks to explain them.
        if(assessment.schemaVersion!==3||assessment.submissionSource!=="studio")continue;
        const key=studioEvidenceId(student.id,assessment.id);
        choices.set(key,{student,assessment});
      }
    }
    if(!choices.size)throw Error("No Studio assessments are assigned to your classes. Check My Assessments or ask your teacher.");
    const start=new Option("Choose an assessment…","");start.disabled=true;start.selected=true;choose.add(start);
    for(const [key,{student,assessment}] of choices)
      choose.add(new Option(assessment.title+" · "+student.section+
        (studioSubmissionAllowed(assessment,student.section).allowed?"":" · Schedule not currently open"),key));
    if(assessmentParam){
      for(const [key,{assessment}] of choices)if(assessment.id===assessmentParam){choose.value=key;break;}
    }
    notice("Choose an assessment. This submission freezes your saved files, diagrams and project database.");
    syncExamChoice();
  };
  const assessmentParam=new URL(location.href).searchParams.get("assessment");
  function syncExamChoice(){
    const chosen=choices.get(choose.value),task=chosen?.assessment;
    if(!task){
      confirmButton.disabled=true;
      if(details)details.textContent="Choose an assigned assessment to review its type and submission window.";
      if(choices.size)notice("Choose the assessment to which you want to submit your saved project.");
      return;
    }
    const deployment=(task.deployments||[]).find(item=>item.section===chosen.student.section);
    const due=deployment?.deadlineEnabled===false||!deployment?.deadline
      ?"No deadline configured":new Date(deployment.deadline).toLocaleString();
    const kind=task.practicalExam===true?"Practical exam":
      task.personalizedTask?.enabled===true?"Personalized task":"Studio project";
    if(details)details.textContent=task.title+" · "+chosen.student.section+
      " · "+kind+" · Deadline: "+due;
    if(task.practicalExam&&assessmentParam!==task.id){
      confirmButton.disabled=true;
      notice("Open this practical exam from My Assessments so the required exam restrictions apply.");
      return;
    }
    if(task.personalizedTask?.enabled===true&&assessmentParam!==task.id){
      confirmButton.disabled=true;
      notice("Open this personalized task from My Assessments to receive your assigned version before submitting.");
      return;
    }
    window.adminervaSetStudioExamPolicy?.({assessmentId:task.id,practicalExam:task.practicalExam===true});
    const eligibility=studioSubmissionAllowed(task,chosen.student.section);
    confirmButton.disabled=!eligibility.allowed;
    notice(eligibility.allowed
      ?"Ready to submit. The saved project files, diagrams and project database will be frozen as a revision. Future edits will not change it."
      :eligibility.reason);
  }
  choose.addEventListener("change",syncExamChoice);
  button.addEventListener("click",async()=>{
    if(busy)return;
    if(!window.adminervaStudioSubmissionState)return alert("The project editor is still initializing.");
    button.disabled=true;dialog.showModal();
    confirmButton.disabled=true;
    try{window.adminervaStudioSubmissionState();await load();}
    catch(error){notice(error.message);}
    finally{button.disabled=false;syncExamChoice();}
  });
  dialog.querySelector("[data-close-studio]")?.addEventListener("click",close);
  dialog.addEventListener("cancel",event=>{if(busy)event.preventDefault();});
  // Opening an assignment should show the task in Studio, not unexpectedly
  // present a submission confirmation before the learner has started work.
  // The learner can submit from Menus or the mobile Task sheet when ready.
  confirmButton.addEventListener("click",async()=>{
    if(busy)return;
    const chosen=choices.get(choose.value),uid=auth.currentUser?.uid;
    if(!chosen||!uid)return notice("Choose an available assessment first.");
    if(chosen.assessment.practicalExam&&assessmentParam!==chosen.assessment.id)
      return notice("Open this practical exam from My Assessments before working on it.");
    if(chosen.assessment.personalizedTask?.enabled===true&&assessmentParam!==chosen.assessment.id)
      return notice("Open this personalized task from My Assessments before submitting.");
    if(chosen.assessment.personalizedTask?.enabled===true&&
      window.adminervaStudioAssessmentVariant?.assessmentId!==chosen.assessment.id)
      return notice("Your personalized task is still loading. Wait for the task panel before submitting.");
    const eligibility=studioSubmissionAllowed(chosen.assessment,chosen.student.section);
    if(!eligibility.allowed)return notice(eligibility.reason);
    let captured,snapshot,hash;
    try{
      captured=window.adminervaStudioSubmissionState();
      snapshot=snapshotStudioProject(captured.project,captured.state);
      hash=await studioDigest(snapshot.json);
      if(!confirm("Submit \""+captured.project.title+"\" as a frozen "+snapshot.fileCount+"-file project for \""+
          chosen.assessment.title+"\"? Future edits will not change this submitted revision."))return;
    }catch(error){return notice(error.message);}
    busy=true;confirmButton.disabled=true;choose.disabled=true;notice("Submitting the saved project snapshot…");
    const loading=window.beginLoading?.("Submitting assessment project…")||(()=>{});
    try{
      const {student,assessment}=chosen;
      const evidenceId=studioEvidenceId(student.id,assessment.id);
      const headRef=doc(db,"studio_submissions",evidenceId);
      const pending=await runTransaction(db,async tx=>{
        const [head,task]=await Promise.all([
          tx.get(headRef),tx.get(doc(db,"assessments",assessment.id))
        ]);
        if(auth.currentUser?.uid!==uid)throw Error("Account changed. No new submission was committed.");
        if(!task.exists())throw Error("The assessment was removed.");
        const current=task.data();
        const gate=studioSubmissionAllowed(current,student.section);
        if(!gate.allowed)throw Error(gate.reason);
        if(current.schemaVersion!==3||current.submissionSource!=="studio")
          throw Error("This assessment no longer accepts Studio submissions.");
        const personalized=current.personalizedTask?.enabled===true;
        // Personalized attempts are immutable after submission. A second
        // personalized snapshot requires an explicit teacher revision request,
        // which also advances the learner to a new frozen variant.
        if(head.exists()&&personalized&&head.data().status!=="revision_requested")
          throw Error("Your personalized attempt is already submitted. Your instructor must request a revision before you can submit a new attempt.");
        if(head.exists()&&!personalized&&!["submitted","revision_requested"].includes(head.data().status))
          throw Error("Your previous submission is under review. Ask your instructor to request a revision first.");
        if(head.exists()&&head.data().snapshotHash===hash)
          throw Error("This exact project revision was already submitted. Make changes before submitting again.");
        const revision=head.exists()?head.data().revision+1:1;
        if(revision>30)throw Error("The revision limit was reached. Ask your instructor for assistance.");
        const assigned=window.adminervaStudioAssessmentVariant;
        if(personalized&&(!assigned||assigned.assessmentId!==assessment.id||
          assigned.studentId!==student.id||assigned.attempt!==revision||!assigned.variantId))
          throw Error("Your personalized task does not match this submission attempt. Reopen the assessment before submitting.");
        const variantId=personalized?String(assigned.variantId):"";
        const versionRef=doc(db,"studio_submissions",evidenceId,"versions",String(revision));
        const submittedAt=serverTimestamp();
        tx.set(versionRef,{
          source:"studio",studentId:student.id,assessmentId:assessment.id,
          ownerUid:uid,section:student.section,revision,projectId:captured.project.id,
          variantId,snapshotHash:hash,snapshotJson:snapshot.json,submittedAt
        });
        tx.set(headRef,{
          source:"studio",studentId:student.id,assessmentId:assessment.id,
          ownerUid:uid,section:student.section,revision,projectId:captured.project.id,
          projectTitle:captured.project.title.slice(0,120),variantId,snapshotHash:hash,
          status:"submitted",reviewNote:"",reviewedBy:"",submittedAt
        });
        return revision;
      });
      notice("Revision "+pending+" was submitted successfully. Your current project remains editable.");
      window.dispatchEvent(new CustomEvent("adminerva:studio-submitted",{detail:{
        assessmentId:chosen.assessment.id,studentId:chosen.student.id,revision:pending
      }}));
      setTimeout(()=>{if(dialog.open&&!busy)dialog.close();},1200);
    }catch(error){
      notice("Submission not confirmed: "+error.message+
        ". Your project remains saved. Reload the assessment status before retrying; interrupted requests can sometimes complete.");
    }finally{busy=false;confirmButton.disabled=false;choose.disabled=false;loading();}
  });
  onAuthStateChanged(auth,user=>{
    if(dialog.open&&openedUser&&openedUser!==user?.uid){
      choices.clear();choose.replaceChildren();confirmButton.disabled=true;
      notice("Account changed. Close and reopen the submission form.");
    }
  });
}
