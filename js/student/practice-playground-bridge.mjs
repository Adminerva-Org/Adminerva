/** Student submissions, practice progress and isolated code workspaces: practice playground bridge. */
// Private, tab-scoped handoff between Practice Lab and the Code Playground.
// No assessed-work submission or proof-of-authorship is implied by a run attempt.
import {validPlaygroundState} from "./playground-storage.mjs";
import {getCourse,practiceQuestion} from "./practice-courses.mjs?v=2026.10.21.2-dev.1";

export const practiceBridgeKey=uid=>"Adminerva_Practice_Experiment_"+String(uid);
const supported=new Set(["java","python","web","logic"]);
const escapeHtml=text=>String(text).replace(/[&<>"']/g,c=>
  ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

export function sandboxForQuestion(courseId,missionId,question){
  if(!supported.has(courseId)||typeof question?.code!=="string")return null;
  if(question.workspace)return validPlaygroundState(question.workspace)?structuredClone(question.workspace):null;
  const code=question.code;
  let lang=courseId,filename,content;
  if(courseId==="java"){
    filename="Main.java";
    content="public class Main {\n  public static void main(String[] args) {\n"+
      code.split("\n").map(line=>"    "+line).join("\n")+
      "\n  }\n}\n";
  }else if(courseId==="python"){
    filename="main.py";content=code+"\n";
  }else if(courseId==="web"){
    lang="web";filename="index.html";
    if(missionId==="w1"){
      const semantic=question.choices[question.correct];
      content='<!doctype html>\n<html lang="en"><meta charset="utf-8"><title>Semantic example</title>'+
        '<body><h1>Inspect this semantic element</h1>'+semantic+
        'Example content'+semantic.replace("<","</")+'</body></html>';
    }else if(missionId==="w2"){
      content='<!doctype html>\n<html lang="en"><meta charset="utf-8"><title>CSS selectors</title>'+
        '<style>.panel {background: lightblue} #notice {color: darkred}</style><body>'+
        question.code.split("\n")[0]+'</body></html>';
    }else if(missionId==="w3"){
      content='<!doctype html>\n<html lang="en"><meta charset="utf-8"><title>Responsive card</title>'+
        '<style>'+code+'</style><body><div class="card" style="padding:24px">'+
        'Resize the preview to explore the breakpoint.</div></body></html>';
    }else{
      const match=code.match(/let count = ([0-9]+);/);
      const start=match?Number(match[1]):0;
      const clicks=Number((question.prompt.match(/after ([0-9]+) clicks/)||[])[1]||2);
      content='<!doctype html>\n<html lang="en"><meta charset="utf-8"><title>Click counter</title>'+
        '<body><button id="counter">Click</button><output id="result"></output>'+
        '<script>let count = '+start+';const button=document.getElementById("counter");'+
        "button.addEventListener('click',()=>{ count += 1; document.getElementById('result').textContent=count; });"+
        'for(let i=0;i<'+clicks+';i++)button.click();<\/script></body></html>';
    }
  }else{
    lang="python";filename="main.py";
    const digits=[...code.matchAll(/[0-9]+/g)].map(item=>Number(item[0]));
    if(missionId==="d1"){
      content="x = "+digits[0]+"\nfor _ in range("+digits[1]+"):\n    x += 2\nprint(x)\n";
    }else if(missionId==="d2"){
      content="for i in range(1, "+digits[1]+"):\n    print(i)\n# Change range's upper bound to fix the last value.\n";
    }else if(missionId==="d3"){
      content="minimum, maximum = "+digits[0]+", "+digits[1]+"\n"+
        "for value in [minimum, maximum, maximum + 1]:\n"+
        "    print(value, 'REJECT' if value < minimum or value > maximum else 'ACCEPT')\n";
    }else{
      content="threshold = "+digits[0]+"\nfor amount in [threshold - 1, threshold, threshold + 1]:\n"+
        "    print(amount, 'DISCOUNT' if amount >= threshold else 'NONE')\n";
    }
  }
  const state={lang,files:{[filename]:content},fileOrder:[filename],activeFilename:filename};
  return validPlaygroundState(state)?state:null;
}
export function makePracticeTransfer(uid,courseId,missionId,attempt=0){
  const course=getCourse(courseId),mission=course?.missions.find(m=>m.id===missionId);
  if(!uid||!mission||!Number.isInteger(attempt)||attempt<0||attempt>500)return null;
  const question=practiceQuestion(uid,mission,attempt);
  const workspace=sandboxForQuestion(courseId,missionId,question);
  if(!workspace)return null;
  return {uid,courseId,missionId,attempt,workspace,startedAt:Date.now(),runCount:0,observed:""};
}
export function makeCheckedPracticeTransfer(uid,checked){
  if(!uid||!checked||checked.state!=="predicted"||!Number.isInteger(checked.correctChoice)||!/^[a-f0-9]{48}$/.test(checked.attemptId))return null;
  const workspace=sandboxForQuestion(checked.courseId,checked.missionId,{...checked.question,correct:checked.correctChoice,workspace:checked.workspace});
  if(!workspace)return null;
  return {uid,courseId:checked.courseId,missionId:checked.missionId,attempt:0,serverAttemptId:checked.attemptId,workspace,startedAt:Date.now(),runCount:0,observed:"",predictionCorrect:true};
}
export function readPracticeTransfer(storage,uid,now=Date.now()){
  try{
    const transfer=JSON.parse(storage.getItem(practiceBridgeKey(uid))||"null");
    if(!transfer||transfer.uid!==uid||
      !Number.isInteger(transfer.attempt)||transfer.attempt<0||transfer.attempt>500||
      !Number.isFinite(transfer.startedAt)||transfer.startedAt>now||
      now-transfer.startedAt>24*60*60*1000||
      !getCourse(transfer.courseId)?.missions.some(m=>m.id===transfer.missionId)||
      !validPlaygroundState(transfer.workspace)||
      !Number.isInteger(transfer.runCount)||transfer.runCount<0)return null;
    return transfer;
  }catch{return null}
}
export function recordPracticeRun(storage,uid,observed=""){
  const transfer=readPracticeTransfer(storage,uid);
  if(!transfer)return false;
  transfer.runCount++;
  transfer.observed=String(observed||"").slice(0,500);
  storage.setItem(practiceBridgeKey(uid),JSON.stringify(transfer));
  return true;
}
export const practiceReturnUrl=transfer=>
  "student-practice.html?course="+encodeURIComponent(transfer.courseId)+
  "&mission="+encodeURIComponent(transfer.missionId);
