/** Shared mission presentation; the server owns answers, deductions and awards. */
export const PRACTICE_SEASON="practice-2026-10";
export const DIFFICULTIES=[{name:"Starter",maximum:20,deduction:2,floor:10},{name:"Standard",maximum:30,deduction:3,floor:15},{name:"Challenge",maximum:40,deduction:4,floor:20}];
export const ACTIVITY_TYPES=["choice","output","ordering","matching","debugging"];
export function missionMeta(course,mission){const index=course.missions.findIndex(item=>item.id===mission.id);return {...DIFFICULTIES[Math.max(0,index)%3],type:ACTIVITY_TYPES[Math.max(0,index)%5]};}
function rotate(items,seed){const shift=Math.abs(seed)%items.length;return [...items.slice(shift),...items.slice(0,shift)];}
function workspace(language,code){const java=language==="java",filename=java?"Main.java":language==="web"?"index.html":"main.py",content=java?"public class Main { public static void main(String[] args) {\n"+code+"\n}}":code;return {lang:language,files:{[filename]:content},fileOrder:[filename],activeFilename:filename};}
function originalWorkspace(course,mission,question){
  if(question.workspace)return question.workspace;
  if(course.id==="java"||course.id==="python")return workspace(course.id,question.code);
  if(course.id==="logic"){
    const values=[...question.code.matchAll(/[0-9]+/g)].map(item=>Number(item[0]));
    if(mission.id==="d1")return workspace("python","x = "+values[0]+"\nfor _ in range("+values[1]+"):\n    x += 2\nprint(x)");
    if(mission.id==="d2")return workspace("python","for i in range(1, "+values[1]+"):\n    print(i)\n# Adjust the upper bound to include the final value.");
    if(mission.id==="d3")return workspace("python","minimum, maximum = "+values[0]+", "+values[1]+"\nfor value in [minimum, maximum, maximum + 1]:\n    print(value, 'REJECT' if value < minimum or value > maximum else 'ACCEPT')");
    return workspace("python","threshold = "+values[0]+"\nfor amount in [threshold - 1, threshold, threshold + 1]:\n    print(amount, 'DISCOUNT' if amount >= threshold else 'NONE')");
  }
  let content=question.code;
  if(mission.id==="w1"){const tag=question.choices[question.correct];content=tag+"Practice page content"+tag.replace("<","</");}
  else if(mission.id==="w2")content="<style>"+question.choices[question.correct]+" {padding:16px;background:lightblue}</style>"+question.code.split("\n")[0];
  else if(mission.id==="w3")content="<style>"+question.code+"</style><div class=\"card\">Resize the preview to explore this media query.</div>";
  else if(mission.id==="w4")content='<button id="counter">Click</button><output id="result"></output><script>const button=document.getElementById("counter");'+question.code+'button.addEventListener("click",()=>document.getElementById("result").textContent=count);</script>';
  return workspace("web",'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Practice experiment</title><body>'+content+'</body></html>');
}
export function seasonActivity(course,mission,seed){
  const meta=missionMeta(course,mission),original=mission.build(seed),language=course.id==="java"?"java":course.id==="web"?"web":"python",a=3+Math.abs(seed)%7,b=2+Math.abs(seed>>>3)%4;
  let activity={type:meta.type,code:original.code,prompt:original.prompt,why:original.why,workspace:originalWorkspace(course,mission,original),choices:original.choices,solution:original.correct};
  if(meta.type==="output"){const prompt=String(original.prompt||"").replace(/\\s+(Explain the rule in your prediction[.]|After predicting, try changing one input in the sandbox[.]|After predicting, run a boundary example and compare it with this result[.])\\s*$/,"").trim();activity={...activity,prompt:prompt+" Enter only the exact output or requested value.",solution:String(original.choices[original.correct])};}
  if(meta.type==="ordering"){
    const ordered=language==="web"?["<main>","  <h1>Practice makes progress</h1>","  <p>My first lesson</p>","</main>"]:language==="java"?["int score = "+a+";","score += "+b+";","System.out.println(score);"]:["score = "+a,"score += "+b,"print(score)"];
    const items=rotate(ordered.map((text,id)=>({id,text})),seed+1).reverse();
    activity={...activity,code:"",prompt:language==="web"?"Arrange the opening element, heading, paragraph, and closing element to build the requested page.":"Arrange the statements so the program starts at "+a+", adds "+b+", and prints "+(a+b)+".",items:items.map(item=>item.text),solution:ordered.map((text,id)=>items.findIndex(item=>item.id===id)),why:language==="web"?"Open the main element first, place its heading before its paragraph, then close main.":"Create the variable before updating it, then print the updated value.",workspace:workspace(language,ordered.join("\n"))};
  }
  if(meta.type==="matching"){
    const pairs=language==="web"?[["<header>","Introductory page or section content"],["<nav>","Major navigation links"],["<main>","The primary page content"]]:[[a+" + "+b,String(a+b)],[a+" × "+b,String(a*b)],[a+" − "+b,String(a-b)]];
    const right=rotate(pairs.map((pair,id)=>({id,text:pair[1]})),seed+1).reverse();
    activity={...activity,code:"",prompt:language==="web"?"Match each semantic element with its purpose.":"Match each expression with its result.",left:pairs.map(pair=>pair[0]),right:right.map(item=>item.text),solution:pairs.map((pair,id)=>right.findIndex(item=>item.id===id)),why:language==="web"?"Semantic elements describe the purpose of their content.":"Apply each operator to the two operands. Addition, multiplication, and subtraction produce different results."};
  }
  if(meta.type==="debugging"){
    if(language==="web")activity={...activity,code:'<label for="student-name">Name</label>\n<input id="learner-name">',prompt:"The label does not focus the input. Choose the replacement input that fixes the link.",choices:['<input id="student-name">','<input name="student-name">','<input title="student-name">','<input placeholder="student-name">'],solution:0,why:"The label's for value must match the input's id.",workspace:workspace("web",'<label for="student-name">Name</label><input id="student-name">')};
    else{const lines=language==="java"?["int total = "+a+" - "+b+";","System.out.println(total);"]:["total = "+a+" - "+b,"print(total)"];const fixes=rotate(["+","−","×","÷"],seed);activity={...activity,code:lines.join("\n"),prompt:"The program should print the sum "+(a+b)+". Which operator should replace the subtraction on the first line?",choices:fixes,solution:fixes.indexOf("+"),why:"Use addition to calculate the requested sum. Subtraction produces the difference.",workspace:workspace(language,lines.join("\n").replace(a+" - "+b,a+" + "+b))};}
  }
  return {...activity,difficulty:meta};
}
export function publicActivity(activity){const {solution,why,workspace,...question}=activity;return question;}
export function validSeasonAnswer(question,answer){
  if(["choice","debugging"].includes(question.type))return Number.isInteger(answer)&&answer>=0&&answer<question.choices.length;
  if(question.type==="output")return typeof answer==="string"&&answer.trim().length>0&&answer.length<=500;
  if(!Array.isArray(answer)||answer.length!==question.solution.length||answer.some(value=>!Number.isInteger(value)||value<0||value>=question.solution.length))return false;
  return new Set(answer).size===answer.length;
}
export function gradeSeasonAnswer(question,answer){return question.type==="output"?String(answer).trim().replace(/\r\n/g,"\n")===question.solution:Array.isArray(question.solution)?JSON.stringify(answer)===JSON.stringify(question.solution):answer===question.solution;}
