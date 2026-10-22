/** One accessible feedback preview; teacher edits remain in the protected review workflow. */
import {auth,db} from "../core/firebase-core.js?v=1.3.0";
import {doc,getDoc} from "../core/teaching-firestore.mjs?v=1.3.0";
import {renderFeedbackMarkdown,reviewNotice} from "./review-ui.mjs?v=1.3.0";
let active=null;
function ensureDrawer() {
  let drawer=document.getElementById("feedbackDrawer");
  if(drawer)return drawer;
  drawer=document.createElement("div");drawer.id="feedbackDrawer";drawer.className="av-feedback-backdrop hidden";
  drawer.innerHTML='<section class="av-feedback-drawer" role="dialog" aria-modal="true" aria-labelledby="feedbackDrawerTitle"><header><h2 id="feedbackDrawerTitle">Score and feedback</h2><button type="button" id="feedbackDrawerClose" aria-label="Close feedback">✕</button></header><div id="feedbackDrawerBody" class="av-feedback-body"></div><footer><button type="button" id="feedbackDrawerReview">Review / edit teacher grade</button></footer></section>';
  document.body.append(drawer);
  const close=()=>{if(active){const previous=active;active=null;drawer.classList.add("hidden");previous.focus?.();}};
  drawer.querySelector("#feedbackDrawerClose").addEventListener("click",close);
  drawer.addEventListener("click",event=>{if(event.target===drawer)close();});
  drawer.addEventListener("keydown",event=>{
    if(event.key==="Escape")close();
    if(event.key==="Tab"){
      const controls=[...drawer.querySelectorAll("button:not(:disabled),a[href],input,textarea")];
      const first=controls[0],last=controls.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
  });
  drawer.querySelector("#feedbackDrawerReview").addEventListener("click",()=>{
    const details=active?.details;close();
    if(!details)return;
    if(window.openManualGradeReview)void window.openManualGradeReview(details);
    else if(window.openGradebookFeedback)window.openGradebookFeedback(details);
  });
  return drawer;
}
export async function openFeedbackDrawer(details,trigger=document.activeElement) {
  const drawer=ensureDrawer(),body=drawer.querySelector("#feedbackDrawerBody"),button=drawer.querySelector("#feedbackDrawerReview");
  const request={details,focus:()=>trigger?.focus?.(),uid:auth.currentUser?.uid};active=request;
  drawer.classList.remove("hidden");body.textContent="Loading saved score and feedback…";button.disabled=true;
  drawer.querySelector("#feedbackDrawerClose").focus();
  try {
    const [gradeSnap,studentSnap]=await Promise.all([getDoc(doc(db,"student_grades",details.studentId+"_"+details.taskId)),getDoc(doc(db,"students",details.studentId))]);
    if(active!==request||auth.currentUser?.uid!==request.uid)return;
    if(!gradeSnap.exists())throw Error("No saved grade. Open Review & Grade to enter one.");
    const grade=gradeSnap.data();body.replaceChildren();
    drawer.querySelector("#feedbackDrawerTitle").textContent=(studentSnap.data()?.name||"Student")+" — "+(grade.published?"Published grade":"Private draft");
    const score=document.createElement("p");score.className="font-bold text-xl";score.textContent=String(grade.score??"—")+" / "+String(grade.maxScore||20);body.append(score);
    const feedback=document.createElement("div");renderFeedbackMarkdown(feedback,grade.feedback);body.append(feedback);
    for(const text of grade.penaltyTags||[]){const flag=document.createElement("p");flag.textContent=String(text);flag.className="text-amber-900";body.append(flag);}
    if(grade.aiAssistance||grade.gradeSource==="automated"||grade.gradeSource==="teacher_ai_reviewed"){
      const disclosure=document.createElement("p");disclosure.className="text-sm text-slate-600";disclosure.textContent="This feedback includes automated assistance. Teacher review and publication are separate actions.";body.append(disclosure);
    }
    button.disabled=false;
  }catch(error){if(active===request){body.textContent=error.message;reviewNotice("Feedback could not load. Existing grade unchanged.",true);}}
}
