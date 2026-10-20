/** Non-blocking task status, compact feedback and safe Markdown previews. */
import {cleanGradeFeedback} from "../core/feedback-format.mjs";
let noticeTimer;
export function feedbackSummary(value) {
  return cleanGradeFeedback(value).replace(/[#*_`>]/g,"").replace(/\s+/g," ").split(/(?<=[.!?])\s/)[0].slice(0,160)||"Open feedback and review details";
}
export function reviewNotice(text,error=false) {
  let node=document.getElementById("reviewBackgroundStatus");
  if(!node){node=document.createElement("p");node.id="reviewBackgroundStatus";node.setAttribute("role","status");node.className="av-task-notice";document.body.append(node);}
  node.textContent=text;node.dataset.error=String(error);
  node.hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{node.hidden=true;},error?12000:6000);
}
export function inlineTask(id,message) {
  const node=document.getElementById(id);
  if(node){node.setAttribute("aria-busy","true");node.dataset.loading="true";}
  reviewNotice(message);
  return text=>{if(node){node.setAttribute("aria-busy","false");delete node.dataset.loading;}reviewNotice(text||"Ready.");};
}
export function renderFeedbackMarkdown(container,value) {
  container.replaceChildren();
  let fenced=false;
  for(const line of cleanGradeFeedback(value).split("\n")) {
    if(/^\s*```/.test(line)){fenced=!fenced;continue;}
    const node=document.createElement(fenced?"pre":/^#{1,4} /.test(line)?"h4":/^\s*[-*] /.test(line)?"p":"p");
    const text=line.replace(/^#{1,4} /,"").replace(/^\s*[-*] /,"• ");
    if(fenced)node.textContent=text;
    else {
      for(const part of text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)) {
        const span=document.createElement(part.startsWith("**")&&part.endsWith("**")?"strong":part.startsWith("`")&&part.endsWith("`")?"code":"span");
        span.textContent=span.tagName==="STRONG"?part.slice(2,-2):span.tagName==="CODE"?part.slice(1,-1):part;node.append(span);
      }
    }
    node.className=fenced?"av-feedback-code":"av-feedback-line";container.append(node);
  }
}
export function feedbackChip(grade,onOpen) {
  const button=document.createElement("button");button.type="button";button.className="av-feedback-chip";
  const total=document.createElement("strong");total.textContent=String(grade.score??"—")+" / "+String(grade.maxScore||20);
  const summary=document.createElement("span");summary.textContent=feedbackSummary(grade.feedback);
  button.append(total,summary);button.addEventListener("click",onOpen);return button;
}
