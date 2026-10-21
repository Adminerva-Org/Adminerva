/** Student submissions, practice progress and isolated code workspaces: practice courses. */
// Adminerva Practice Lab — four original introductory tracks.
// Practice is formative; correct choices do not constitute graded evidence.
import {expandPracticeCourses} from "./practice-curriculum.mjs";
const n=(seed,max,min=1)=>min+(Math.abs(seed)%max);
function choices(answer,alternatives,seed){
  const items=[answer,...alternatives].map(String);
  // Numeric distractors are generated from the learner's values. Nudge an
  // accidental duplicate instead of presenting two identical choices.
  for(let i=1;i<items.length;i++){
    while(items.slice(0,i).includes(items[i])){
      items[i]=Number.isFinite(Number(items[i]))?
        String(Number(items[i])+i+1):items[i]+" (alternative)";
    }
  }
  const shift=Math.abs(seed)%items.length;
  const shuffled=[...items.slice(shift),...items.slice(0,shift)];
  if(seed%2!==0)shuffled.reverse();
  return {choices:shuffled,correct:shuffled.indexOf(String(answer))};
}
export const COURSES=[
  {id:"java",name:"Java Foundations",subtitle:"Variables, branches, loops and arrays",
   icon:"☕",missions:[
    {id:"j1",title:"Follow a changing variable",concept:"Assignment changes the stored value. Read each statement in order.",
      build(seed){const a=n(seed,8,3),b=n(seed>>2,5,2),result=a+b;
        return {prompt:"What does this Java snippet print?",code:"int points = "+a+";\npoints += "+b+";\nSystem.out.println(points);",
        ...choices(result,[a,b,result+2],seed),why:"The += statement adds "+b+" to the original "+a+"; it does not replace the value with "+b+"."}}},
    {id:"j2",title:"Read a branch",concept:"A comparison controls which message executes; only one branch runs.",
      build(seed){const score=n(seed,35,55),cutoff=n(seed>>3,12,65),passed=score>=cutoff;
        return {prompt:"Which word is printed?",code:"int score = "+score+";\nif (score >= "+cutoff+") {\n  System.out.println(\"PASS\");\n} else {\n  System.out.println(\"RETRY\");\n}",
          ...choices(passed?"PASS":"RETRY",[passed?"RETRY":"PASS","BOTH","NO OUTPUT"],seed),
          why:score+" is "+(passed?"at least ":"less than ")+cutoff+", so the "+(passed?"if":"else")+" branch executes."}}},
    {id:"j3",title:"Trace a for loop",concept:"Track the loop condition and the changing sum after each iteration.",
      build(seed){const k=n(seed,5,3),answer=k*(k+1)/2;
        return {prompt:"What is the final total?",code:"int total = 0;\nfor (int i = 1; i <= "+k+"; i++) {\n  total += i;\n}\nSystem.out.println(total);",
          ...choices(answer,[answer+k,answer-k,k],seed),why:"The loop adds every whole number from 1 through "+k+", which totals "+answer+"."}}},
    {id:"j4",title:"Inspect an array index",concept:"Java arrays start at index zero. Index 1 means the second element.",
      build(seed){const a=n(seed,10,4),b=n(seed>>4,10,15),c=n(seed>>8,10,27);
        return {prompt:"What value is printed?",code:"int[] samples = {"+a+", "+b+", "+c+"};\nSystem.out.println(samples[1]);",
        ...choices(b,[a,c,1],seed),why:"Index 1 selects the second number, "+b+"."}}}
   ]},
  {id:"python",name:"Python Problem Solving",subtitle:"Values, conditions, ranges and lists",
   icon:"🐍",missions:[
    {id:"p1",title:"Update a Python variable",concept:"A variable can be updated using its own earlier value.",
      build(seed){const a=n(seed,8,2),b=n(seed>>3,5,2),answer=a*b;
        return {prompt:"What is displayed?",code:"steps = "+a+"\nsteps *= "+b+"\nprint(steps)",
          ...choices(answer,[a+b,a,b],seed),why:"*= multiplies "+a+" by "+b+" to produce "+answer+"."}}},
    {id:"p2",title:"Choose a branch",concept:"The modulo operator % returns a remainder.",
      build(seed){const value=n(seed,32,9),answer=value%2===0?"EVEN":"ODD";
        return {prompt:"What does the program print?",code:"n = "+value+"\nif n % 2 == 0:\n    print('EVEN')\nelse:\n    print('ODD')",
        ...choices(answer,[answer==="EVEN"?"ODD":"EVEN","NONE","BOTH"],seed),
        why:value+" has remainder "+(value%2)+" when divided by 2."}}},
    {id:"p3",title:"Understand range",concept:"range(1, n) stops before n.",
      build(seed){const end=n(seed,5,4),answer=(end-1)*end/2;
        return {prompt:"What is total after the loop?",code:"total = 0\nfor i in range(1, "+end+"):\n    total += i\nprint(total)",
          ...choices(answer,[answer+end,end,answer+1],seed),
          why:"The loop uses 1 through "+(end-1)+"; "+end+" itself is excluded."}}},
    {id:"p4",title:"Choose a list position",concept:"Negative list indices count from the end.",
      build(seed){const a=n(seed,10,11),b=n(seed>>2,10,25),c=n(seed>>5,10,39);
        return {prompt:"What does -1 select?",code:"results = ["+a+", "+b+", "+c+"]\nprint(results[-1])",
          ...choices(c,[a,b,-1],seed),why:"The final item is "+c+"; -1 refers to that last position."}}}
   ]},
  {id:"web",name:"Web Interface Essentials",subtitle:"HTML, CSS, responsive design and events",
   icon:"🌐",missions:[
    {id:"w1",title:"Select semantic HTML",concept:"Semantic elements describe the purpose of content, not just its appearance.",
      build(seed){const cases=[
        ["a collection of site navigation links","<nav>","<footer>","<em>","<small>"],
        ["a stand-alone article on a school news page","<article>","<span>","<input>","<style>"],
        ["the principal heading of a page","<h1>","<p>","<br>","<label>"]
      ];const pick=cases[n(seed,cases.length,0)];
        return {prompt:"Which HTML element best represents "+pick[0]+"?",code:"<!-- Choose a meaningful element before styling your school page. -->",
          ...choices(pick[1],pick.slice(2),seed),why:pick[1]+" communicates the purpose of this content to browsers and assistive technology."}}},
    {id:"w2",title:"Match a CSS selector",concept:"A dot in CSS selects a class; a hash selects an ID.",
      build(seed){const cases=[
        ["<div class=\"panel\">Hello</div>",".panel", "#panel","panel","*panel"],
        ["<p id=\"notice\">Heads up</p>","#notice",".notice","notice","/notice"]
      ];const pick=cases[n(seed,cases.length,0)];
        return {prompt:"Which selector targets the shown element?",code:pick[0]+"\n/* Write a selector to style only that element. */",
          ...choices(pick[1],pick.slice(2),seed),why:"Class selectors start with a dot; ID selectors start with a hash."}}},
    {id:"w3",title:"Reason about responsive layouts",concept:"A media query applies its rules only when the condition is satisfied.",
      build(seed){const width=n(seed,400,450),breakpoint=n(seed>>5,120,620),match=width<=breakpoint;
        return {prompt:"At viewport width "+width+"px, which color is applied?",code:".card { background: blue; }\n@media (max-width: "+breakpoint+"px) {\n  .card { background: orange; }\n}",
          ...choices(match?"orange":"blue",[match?"blue":"orange","green","transparent"],seed),
          why:width+"px "+(match?"meets":"does not meet")+" the max-width "+breakpoint+"px condition."}}},
    {id:"w4",title:"Trace a click handler",concept:"An event handler runs once for each event received.",
      build(seed){const start=n(seed,6,1),clicks=n(seed>>4,4,2),answer=start+clicks;
        return {prompt:"Starting at "+start+", what does the counter show after "+clicks+" clicks?",code:"let count = "+start+";\nbutton.addEventListener('click', () => {\n  count += 1;\n});",
          ...choices(answer,[start,clicks,answer+clicks],seed),
          why:"Each of the "+clicks+" clicks adds one to "+start+", ending at "+answer+"."}}}
   ]},
  {id:"logic",name:"Debugging & Logic Missions",subtitle:"Tracing, boundaries, data checks and test design",
   icon:"🧩",missions:[
    {id:"d1",title:"Trace an algorithm",concept:"A trace table records how the state changes at each step.",
      build(seed){const a=n(seed,6,2),b=n(seed>>4,6,3),answer=a+2*b;
        return {prompt:"What is the final value of x?",code:"x ← "+a+"\nREPEAT "+b+" TIMES:\n    x ← x + 2\nOUTPUT x",
          ...choices(answer,[a+b,a*2*b,2*b],seed),why:"Starting at "+a+", three-step style tracing adds 2 exactly "+b+" times."}}},
    {id:"d2",title:"Catch an off-by-one bug",concept:"A boundary condition controls whether the last value is included.",
      build(seed){const limit=n(seed,6,4);
        return {prompt:"The code must count from 1 through "+limit+". Which change fixes the bug?",code:"FOR i ← 1 TO "+limit+" (exclusive):\n    PRINT i",
          ...choices("Change the condition to include "+limit,["Start i at 2","Stop at "+(limit-1),"Remove the loop"],seed),
          why:"Including the upper bound avoids skipping "+limit+"."}}},
    {id:"d3",title:"Validate user input",concept:"Input checks reject values outside the allowed range before processing.",
      build(seed){const min=n(seed,5,1),max=min+n(seed>>4,9,5),bad=max+n(seed>>8,5,1);
        return {prompt:"Valid values are "+min+"–"+max+". Which input should be rejected?",code:"IF value < "+min+" OR value > "+max+":\n    REJECT",
          ...choices(bad,[min,max,Math.floor((min+max)/2)],seed),
          why:bad+" is above the allowed maximum "+max+"."}}},
    {id:"d4",title:"Design a boundary test",concept:"Good tests inspect the edge of the allowed range, not only ordinary values.",
      build(seed){const limit=n(seed,10,10);
        return {prompt:"A discount applies when amount >= "+limit+". Which input tests the exact boundary?",code:"IF amount >= "+limit+":\n    APPLY DISCOUNT",
          ...choices(limit,[limit-3,limit+4,1],seed),
          why:"Testing exactly "+limit+" checks the comparison boundary itself."}}}
   ]}
];
expandPracticeCourses(COURSES);
export const getCourse=id=>COURSES.find(course=>course.id===id)||null;
export function hashSeed(text){
  let h=2166136261;
  for(const ch of String(text)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}
  return h|0;
}
export function practiceQuestion(uid,mission,attempt=0){
  if(!mission || typeof mission.build!=="function")throw Error("Unknown mission");
  const seed=hashSeed(uid+"|"+mission.id+"|"+attempt);
  const generated=mission.build(seed);
  if(generated.choices.length!==4 || generated.correct<0 ||
     generated.correct>3 || new Set(generated.choices).size!==4)
    throw Error("Practice question choices must be unique");
  return generated;
}
