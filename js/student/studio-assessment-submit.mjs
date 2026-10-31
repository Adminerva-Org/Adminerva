import {auth,db} from "../core/firebase-core.js?v=1.3.0";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {collection,doc,getDocs,query,where,runTransaction,serverTimestamp} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {snapshotStudioProject,studioDigest,studioEvidenceId,studioSubmissionAllowed} from "./studio-assessment-model.mjs?v=1.0.0";
import {
  currentV4StudioSchool,getV4StudioSubmissionStatus,listV4StudioAssignments,submitV4StudioProject
} from "./v4-studio-service.mjs?v=4.0.0";

const button=document.getElementById("studioSubmitAssessment");
if(button){
  const dialog=document.getElementById("studioSubmitDialog");
  const choose=document.getElementById("studioSubmitChoice");
  const state=document.getElementById("studioSubmitStatus");
  const confirmButton=document.getElementById("studioConfirmSubmit");
  const close=()=>dialog.close();
  let choices=new Map(),busy=false,openedUser=null,usingV4=false;
  const notice=text=>{state.textContent=text;};
  const assessmentParam=new URL(location.href).searchParams.get("assessment");

  function v4Allowed(choice){
    if(!choice?.task)return false;
    if(choice.task.windowStatus==="open")return true;
    const due=Number(choice.status?.revisionDueAt||0);
    return choice.status?.status==="reopened"&&due>Date.now();
  }
  async function loadV4(){
    const school=await currentV4StudioSchool();
    if(!school)return false;
    const tasks=await listV4StudioAssignments();
    if(!Array.isArray(tasks))return false;
    usingV4=true;
    for(const task of tasks.filter(item=>item.submissionSource==="studio")){
      let submissionStatus=null;
      try{submissionStatus=await getV4StudioSubmissionStatus(task.taskId);}
      catch(error){console.warn("V4 Studio submission status unavailable:",error?.message||error);}
      const key="v4:"+task.taskId;
      choices.set(key,{mode:"v4",task,status:submissionStatus,school});
    }
    return true;
  }
  async function loadLegacy(user){
    const students=await getDocs(query(collection(db,"students"),where("email","==",user.email.toLowerCase())));
    if(auth.currentUser?.uid!==openedUser)throw Error("Account changed while loading.");
    if(students.empty)return 0;
    let count=0;
    for(const record of students.docs){
      const student={id:record.id,...record.data()};
      const tasks=await getDocs(query(collection(db,"assessments"),where("sectionIds","array-contains",student.section)));
      if(auth.currentUser?.uid!==openedUser)throw Error("Account changed while loading.");
      for(const taskDoc of tasks.docs){
        const assessment={id:taskDoc.id,...taskDoc.data()};
        if(assessment.schemaVersion!==3||assessment.submissionSource!=="studio")continue;
        const key="legacy:"+studioEvidenceId(student.id,assessment.id);
        choices.set(key,{mode:"legacy",student,assessment});
        count++;
      }
    }
    return count;
  }
  const load=async()=>{
    const user=auth.currentUser;
    if(!user?.emailVerified||!user.email)throw Error("Sign in with a verified school email.");
    openedUser=user.uid;usingV4=false;
    choices=new Map();choose.replaceChildren();
    notice("Loading available Studio assessments…");
    let v4Known=false,v4Error=null;
    try{v4Known=await loadV4();}
    catch(error){v4Error=error;console.warn("V4 assignment discovery unavailable:",error?.message||error);}
    // Keep legacy assignments visible until MCS data cutover is completed. This
    // avoids hiding active 3.0 tasks while V4 memberships are being provisioned.
    let legacyCount=0;
    try{legacyCount=await loadLegacy(user);}
    catch(error){
      if(!v4Known)throw error;
      console.warn("Legacy Studio assignment discovery unavailable:",error?.message||error);
    }
    if(auth.currentUser?.uid!==openedUser)throw Error("Account changed while loading.");
    if(!choices.size){
      if(v4Known)throw Error("No Studio assessments are assigned to your verified school classes.");
      if(v4Error)throw Error("School assignments could not be checked. Your project remains saved; retry when connected.");
      throw Error("No Studio assessments are assigned to your classes. Check My Assessments or ask your teacher.");
    }
    const start=new Option("Choose an assessment…","");start.disabled=true;start.selected=true;choose.add(start);
    for(const [key,choice] of choices){
      if(choice.mode==="v4"){
        const task=choice.task,extra=v4Allowed(choice)?"":task.windowStatus==="upcoming"?" · Not open yet":
          choice.status?.status==="reopened"?" · Revision extension expired":" · Deadline passed";
        choose.add(new Option("[School] "+task.title+extra,key));
      }else{
        const {student,assessment}=choice;
        choose.add(new Option((v4Known?"[Legacy] ":"")+assessment.title+" · "+student.section+
          (studioSubmissionAllowed(assessment,student.section).allowed?"":" · Schedule not currently open"),key));
      }
    }
    if(assessmentParam){
      for(const [key,choice] of choices){
        const id=choice.mode==="v4"?choice.task.taskId:choice.assessment.id;
        if(id===assessmentParam){choose.value=key;break;}
      }
    }
    notice(v4Known?
      "School-scoped submissions are available. Legacy pilot tasks remain listed only during migration.":
      "Choose an assessment. This submission freezes your saved files, diagrams and project database.");
    syncExamChoice();
  };
  function syncExamChoice(){
    const chosen=choices.get(choose.value);
    if(!chosen){confirmButton.disabled=true;return;}
    if(chosen.mode==="v4"){
      confirmButton.disabled=!v4Allowed(chosen);
      if(chosen.status?.status==="reopened"&&Number(chosen.status.revisionDueAt)>Date.now())
        notice("Revision requested by your teacher. This submission will create a new immutable project version before the extension deadline.");
      return;
    }
    const task=chosen.assessment;
    if(task?.practicalExam&&assessmentParam!==task.id){
      confirmButton.disabled=true;
      notice("To start a practical exam, open the assignment in My Assessments, then choose Open Adminerva Studio. Exam restrictions must begin before you work.");
      return;
    }
    if(task)window.adminervaSetStudioExamPolicy?.({assessmentId:task.id,practicalExam:task.practicalExam===true});
    confirmButton.disabled=!task||!studioSubmissionAllowed(task,chosen.student.section).allowed;
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
  if(assessmentParam)window.addEventListener("adminerva:studio-ready",()=>button.click(),{once:true});

  async function submitV4(chosen,captured){
    const task=chosen.task;
    if(!v4Allowed(chosen))throw Error("This school submission window is not open.");
    const fileCount=Object.keys(captured.state?.files||{}).length;
    if(!confirm("Submit \""+captured.project.title+"\" as a frozen "+fileCount+
      "-file school project for \""+task.title+"\"? Future edits will not change this submitted version."))return null;
    notice("Saving the school project revision and freezing it for assessment…");
    const receipt=await submitV4StudioProject({taskId:task.taskId,
      project:captured.project,state:captured.state});
    document.dispatchEvent(new CustomEvent("adminerva:studio-submitted",{detail:{
      assessmentId:task.taskId,taskId:task.taskId,version:receipt.version,schoolId:chosen.school.schoolId
    }}));
    return receipt;
  }
  async function submitLegacy(chosen,captured,uid){
    const {student,assessment}=chosen;
    if(assessment.practicalExam&&assessmentParam!==assessment.id)
      throw Error("Open this practical exam from My Assessments before working on it.");
    const eligibility=studioSubmissionAllowed(assessment,student.section);
    if(!eligibility.allowed)throw Error(eligibility.reason);
    const snapshot=snapshotStudioProject(captured.project,captured.state);
    const hash=await studioDigest(snapshot.json);
    if(!confirm("Submit \""+captured.project.title+"\" as a frozen "+snapshot.fileCount+"-file project for \""+
      assessment.title+"\"? Future edits will not change this submitted revision."))return null;
    const evidenceId=studioEvidenceId(student.id,assessment.id);
    const headRef=doc(db,"studio_submissions",evidenceId);
    const revision=await runTransaction(db,async tx=>{
      const [head,task]=await Promise.all([tx.get(headRef),tx.get(doc(db,"assessments",assessment.id))]);
      if(auth.currentUser?.uid!==uid)throw Error("Account changed. No new submission was committed.");
      if(!task.exists())throw Error("The assessment was removed.");
      const current=task.data(),gate=studioSubmissionAllowed(current,student.section);
      if(!gate.allowed)throw Error(gate.reason);
      if(current.schemaVersion!==3||current.submissionSource!=="studio")
        throw Error("This assessment no longer accepts Studio submissions.");
      if(head.exists()&&!["submitted","revision_requested"].includes(head.data().status))
        throw Error("Your previous submission is under review. Ask your instructor to request a revision first.");
      if(head.exists()&&head.data().snapshotHash===hash)
        throw Error("This exact project revision was already submitted. Make changes before submitting again.");
      const next=head.exists()?head.data().revision+1:1;
      if(next>30)throw Error("The revision limit was reached. Ask your instructor for assistance.");
      const versionRef=doc(db,"studio_submissions",evidenceId,"versions",String(next));
      const submittedAt=serverTimestamp();
      tx.set(versionRef,{source:"studio",studentId:student.id,assessmentId:assessment.id,
        ownerUid:uid,section:student.section,revision:next,projectId:captured.project.id,
        snapshotHash:hash,snapshotJson:snapshot.json,submittedAt});
      tx.set(headRef,{source:"studio",studentId:student.id,assessmentId:assessment.id,
        ownerUid:uid,section:student.section,revision:next,projectId:captured.project.id,
        projectTitle:captured.project.title.slice(0,120),snapshotHash:hash,
        status:"submitted",reviewNote:"",reviewedBy:"",submittedAt});
      return next;
    });
    document.dispatchEvent(new CustomEvent("adminerva:studio-submitted",{detail:{
      assessmentId:assessment.id,studentId:student.id,revision
    }}));
    return {version:revision,status:"submitted",legacy:true};
  }
  confirmButton.addEventListener("click",async()=>{
    if(busy)return;
    const chosen=choices.get(choose.value),uid=auth.currentUser?.uid;
    if(!chosen||!uid)return notice("Choose an available assessment first.");
    let captured;
    try{captured=window.adminervaStudioSubmissionState();}
    catch(error){return notice(error.message);}
    busy=true;confirmButton.disabled=true;choose.disabled=true;
    const loading=window.beginLoading?.("Submitting assessment project…")||(()=>{});
    try{
      const receipt=chosen.mode==="v4"?await submitV4(chosen,captured):await submitLegacy(chosen,captured,uid);
      if(!receipt)return;
      notice(chosen.mode==="v4"?
        (receipt.alreadyExisted?"This school project revision was already submitted. No duplicate was created.":
          "School submission version "+receipt.version+" confirmed. Your working project remains editable."):
        "Revision "+receipt.version+" was submitted successfully. Your current project remains editable.");
      setTimeout(()=>{if(dialog.open&&!busy)dialog.close();},1200);
    }catch(error){
      notice("Submission not confirmed: "+String(error?.message||"Submission failed")+
        ". Your project remains saved. Reload the assessment status before retrying.");
    }finally{busy=false;confirmButton.disabled=false;choose.disabled=false;loading();syncExamChoice();}
  });
  onAuthStateChanged(auth,user=>{
    if(dialog.open&&openedUser&&openedUser!==user?.uid){
      choices.clear();choose.replaceChildren();confirmButton.disabled=true;
      notice("Account changed. Close and reopen the submission form.");
    }
  });
}
