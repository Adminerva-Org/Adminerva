const levels=["Guided","Apply","Challenge"];
function answerOptions(answer,seed){
  const value=String(answer),opposite={true:"false",false:"true",True:"False",False:"True",PASS:"RETRY",RETRY:"PASS"};
  const alternatives=Number.isFinite(Number(value))?[Number(value)+1,Number(value)-1,Number(value)+3]:[opposite[value]||"A different result","No output","An error"];
  const options=[value,...alternatives.map(String)];
  for(let index=1;index<options.length;index++)while(options.slice(0,index).includes(options[index]))options[index]+=" (other)";
  const rotation=Math.abs(seed)%4,choices=[...options.slice(rotation),...options.slice(0,rotation)];
  return {choices,correct:choices.indexOf(value)};
}
function program(language,statements,answer,seed,explanation){
  const filename=language==="java"?"Main.java":"main.py";
  const content=language==="java"?"public class Main {\n  public static void main(String[] args) {\n"+statements+"\n  }\n}\n":statements+"\n";
  return {prompt:"Trace this example. What is printed?",code:statements,...answerOptions(answer,seed),why:explanation+" The expected output is "+answer+".",workspace:{lang:language,files:{[filename]:content},fileOrder:[filename],activeFilename:filename}};
}
function numericQuestion(kind,language,seed,level){
  const first=3+Math.abs(seed)%8+level,second=2+Math.abs(seed>>>3)%5,limit=3+level;
  const java=language==="java",declare=(name,value)=>java?"int "+name+" = "+value+";":name+" = "+value;
  const output=expression=>java?"System.out.println("+expression+");":"print("+expression+")";
  let code="",answer=0,why="";
  const printExpression=(expression,result,explanation)=>{code=output(expression);answer=result;why=explanation;};
  switch(kind){
    case "addition":printExpression(first+" + "+second,first+second,"Addition combines both values.");break;
    case "precedence":printExpression(first+" + "+second+" * "+limit,first+second*limit,"Multiplication happens before addition.");break;
    case "division":printExpression(first+" "+(java?"/":"//")+" "+second,Math.trunc(first/second),"Integer division discards the fractional remainder for these positive values.");break;
    case "remainder":printExpression(first+" % "+second,first%second,"Modulo gives the remainder after division.");break;
    case "update":code=declare("points",first)+"\npoints += "+second+(java?";":"")+"\n"+output("points");answer=first+second;why="Compound assignment adds to the previous value.";break;
    case "subtract":printExpression(first+" - "+second,first-second,"Subtraction preserves operand order.");break;
    case "parentheses":printExpression("("+first+" + "+second+") * "+limit,(first+second)*limit,"Parentheses are evaluated first.");break;
    case "multiply":printExpression(first+" * "+second,first*second,"Multiplication repeats a quantity.");break;
    case "minimum":printExpression(java?"Math.min("+first+", "+second+")":"min("+first+", "+second+")",Math.min(first,second),"The minimum is the smaller argument.");break;
    case "maximum":printExpression(java?"Math.max("+first+", "+second+")":"max("+first+", "+second+")",Math.max(first,second),"The maximum is the larger argument.");break;
    case "absolute":printExpression(java?"Math.abs(-"+first+")":"abs(-"+first+")",first,"Absolute value measures distance from zero.");break;
    case "comparison":printExpression(first+" >= "+second,java?String(first>=second):first>=second?"True":"False","The inclusive comparison also accepts equality.");break;
    case "equality":printExpression(first+" == "+second,java?String(first===second):first===second?"True":"False","Equality compares the two values.");break;
    case "and":printExpression(first+" > "+second+(java?" && ":" and ")+first+" < "+(first+limit),java?String(first>second):first>second?"True":"False","Both conditions must be true.");break;
    case "or":printExpression(first+" < "+second+(java?" || ":" or ")+first+" == "+first,java?"true":"True","At least one condition must be true.");break;
    case "branch":code=declare("points",first)+"\n"+(java?"if (points >= "+second+") {\n  "+output('"PASS"')+"\n} else {\n  "+output('"RETRY"')+"\n}":"if points >= "+second+":\n    print('PASS')\nelse:\n    print('RETRY')");answer=first>=second?"PASS":"RETRY";why="Exactly one branch runs.";break;
    case "sum-loop":case "count-loop":case "step-loop":case "skip-loop":case "break-loop":{
      const start=kind==="step-loop"?1:0,step=kind==="step-loop"?2:1,end=first;
      const values=[];for(let index=start;index<end;index+=step){if(kind==="break-loop"&&index===second)break;if(kind==="skip-loop"&&index===second)continue;values.push(index);}
      answer=kind==="count-loop"?values.length:values.reduce((sum,value)=>sum+value,0);
      const operation=kind==="count-loop"?"total += 1":"total += index";
      const guards=kind==="skip-loop"?(java?"  if (index == "+second+") continue;\n":"    if index == "+second+":\n        continue\n"):kind==="break-loop"?(java?"  if (index == "+second+") break;\n":"    if index == "+second+":\n        break\n"):"";
      code=declare("total",0)+"\n"+(java?"for (int index = "+start+"; index < "+end+"; index += "+step+") {\n"+guards+"  "+operation+";\n}":"for index in range("+start+", "+end+", "+step+"):\n"+guards+"    "+operation)+"\n"+output("total");
      why="Trace the loop condition and each update; the upper bound is excluded.";break;
    }
    case "array-index":case "array-last":case "array-update":case "array-length":case "array-sum":{
      const values=[first,second,limit];
      code=java?"int[] values = {"+values.join(", ")+"};":"values = ["+values.join(", ")+"]";
      let expression="";
      if(kind==="array-index"){expression="values[1]";answer=second;why="Index one selects the second element.";}
      if(kind==="array-last"){expression=java?"values[values.length - 1]":"values[-1]";answer=limit;why="The last index is one less than the length.";}
      if(kind==="array-update"){code+="\nvalues[1] += "+limit+(java?";":"");expression="values[1]";answer=second+limit;why="Only the selected element is updated.";}
      if(kind==="array-length"){expression=java?"values.length":"len(values)";answer=3;why="Length counts elements, not their numeric values.";}
      if(kind==="array-sum"){expression="values[0] + values[1] + values[2]";answer=first+second+limit;why="Add each element exactly once.";}
      code+="\n"+output(expression);break;
    }
    default:throw Error("Unknown practice recipe "+kind);
  }
  return program(language,code,answer,seed,why);
}
const numericModules=[
  ["values","Values & expressions",[["update","Update a value"],["precedence","Apply operator precedence"],["division","Use integer division"],["remainder","Inspect a remainder"],["parentheses","Group an expression"]]],
  ["branches","Decisions & conditions",[["branch","Follow a decision"],["comparison","Check an inclusive boundary"],["equality","Compare values"],["and","Combine requirements"],["or","Accept an alternative"]]],
  ["loops","Loops & tracing",[["sum-loop","Trace an accumulation"],["count-loop","Count iterations"],["step-loop","Change the loop step"],["skip-loop","Skip an iteration"],["break-loop","Stop a loop"]]],
  ["collections","Collections & indexed data",[["array-index","Read an index"],["array-last","Find the last element"],["array-update","Update one element"],["array-length","Count elements"],["array-sum","Combine array values"]]],
  ["checks","Reusable operations & test checks",[["minimum","Use a minimum operation"],["maximum","Use a maximum operation"],["absolute","Check an absolute value"],["subtract","Trace operand order"],["multiply","Predict a repeated quantity"]]]
];
const webModules=[
 ["html","Semantic HTML",[
 ["Choose a page header","<header>","<div>","<span>","<b>","A header identifies introductory page or section content."],
 ["Choose navigation","<nav>","<aside>","<code>","<label>","Navigation groups major navigation links."],
 ["Choose the main content","<main>","<footer>","<small>","<input>","Main identifies the document's primary content."],
 ["Represent an independent article","<article>","<br>","<strong>","<option>","An article is independently meaningful content."],
 ["Label a list of steps","<ol>","<ul>","<div>","<p>","An ordered list communicates a meaningful sequence."]]],
 ["css","CSS layout & selection",[
 ["Select a class",".card","#card","card","*card","A dot introduces a CSS class selector."],
 ["Select an ID","#notice",".notice","notice","@notice","A hash introduces a CSS ID selector."],
 ["Create a flex container","display: flex","position: flex","float: flex","align: flex","Display establishes the layout context."],
 ["Create space inside a box","padding","margin","outline","z-index","Padding is between the content and its border."],
 ["Keep declared width inclusive","box-sizing: border-box","display: block","position: relative","overflow: auto","Border-box includes padding and border in the declared width."]]],
 ["responsive","Responsive design",[
 ["Supply viewport metadata",'<meta name="viewport" content="width=device-width, initial-scale=1">',"<meta name=\"screen\">","<viewport>","<meta charset=\"mobile\">","Viewport metadata lets mobile layouts use device width."],
 ["Avoid a rigid page width","max-width: 100%","width: 1800px","min-width: 1400px","left: 1200px","A maximum relative width helps fit smaller viewports."],
 ["Wrap a row when space runs out","flex-wrap: wrap","white-space: nowrap","overflow: hidden","position: absolute","Wrapping lets flex items move onto another row."],
 ["Use responsive images","max-width: 100%; height: auto","width: 1800px","height: 2000px","min-width: 1000px","Preserve aspect ratio while limiting width."],
 ["Respect reduced motion","prefers-reduced-motion","prefers-hidden-motion","screen-motion-off","animation-permission","The media feature exposes a user's reduced-motion preference."]]],
 ["events","DOM & events",[
 ["Listen for a click","addEventListener","setAttribute","querySelectorAll","remove","An event listener runs when the event is dispatched."],
 ["Write plain text safely","textContent","innerHTML","outerHTML","document.write","Text content treats the assigned string as text, not markup."],
 ["Find an element by ID","getElementById","getElementsByName","createTextNode","append","The ID lookup selects a matching element."],
 ["Prevent a form's default navigation","preventDefault","stopTimer","cancelDOM","clearEvent","PreventDefault cancels the event's default browser action."],
 ["Build an element","createElement","getElementById","parseInt","setInterval","CreateElement builds an element before it is inserted."]]],
 ["accessibility","Accessible forms & interaction",[
 ["Connect a visible label","Matching label for and input id","Placeholder only","Color only","Title only","A programmatic label identifies its associated control."],
 ["Use an action control","<button type=\"button\">","<div onclick=\"act()\">","<span>","<b>","Native buttons provide keyboard interaction semantics."],
 ["Describe an informative image","Meaningful alt text","Filename only","An empty title","The word image","Alt text conveys the information or purpose of the image."],
 ["Announce background status","role=\"status\"","role=\"presentation\"","aria-hidden=\"true\"","tabindex=\"-1\"","A status live region can announce non-urgent updates."],
 ["Mark a required field","required","readonly","disabled","hidden","Required participates in native form validation."]]]
];
function webExample(title,seed,level){
  const padding=8+Math.abs(seed)%12+level*4;
  const picture='<img alt="Three blue bars of increasing height" src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'600\' height=\'180\'%3E%3Cpath fill=\'royalblue\' d=\'M20 100h140v60H20z M220 60h140v100H220z M420 20h140v140H420z\'/%3E%3C/svg%3E">';
  const examples={
    "Choose a page header":['<header><h1>School news</h1><p>Updates for this week</p></header><main><p>Today’s story</p></main>',"header { background:#e0f2fe; padding:16px; }"],
    "Choose navigation":['<nav aria-label="Practice pages"><a href="#intro">Introduction</a> <a href="#tasks">Tasks</a></nav><main><h1 id="intro">Introduction</h1><h2 id="tasks">Tasks</h2></main>'],
    "Choose the main content":['<header>Practice site</header><main><h1>The main lesson</h1><p>This is the primary content.</p></main><footer>End of page</footer>'],
    "Represent an independent article":['<main><article><h1>Garden project update</h1><p>Our seedlings grew this week.</p></article></main>'],
    "Label a list of steps":['<main><h1>Try the experiment</h1><ol><li>Predict the result</li><li>Run the example</li><li>Compare the result</li></ol></main>'],
    "Select a class":['<div class="card">Selected card</div><div>Unselected item</div>',".card { background:#dbeafe; padding:16px; border:2px solid navy; }"],
    "Select an ID":['<p id="notice">Selected notice</p><p>Ordinary paragraph</p>',"#notice { color:navy; border-left:4px solid royalblue; padding:12px; }"],
    "Create a flex container":['<main><div class="row"><div>One</div><div>Two</div><div>Three</div></div></main>',".row { display:flex; gap:12px; } .row>div { padding:16px; background:#dbeafe; }"],
    "Create space inside a box":['<main><div class="card">Inspect the gap inside this border.</div></main>',".card { padding:"+padding+"px; border:3px solid navy; background:#e0f2fe; }"],
    "Keep declared width inclusive":['<main><div class="card">This box includes its padding in its declared width.</div></main>',".card { width:240px; padding:"+padding+"px; border:4px solid navy; box-sizing:border-box; }"],
    "Supply viewport metadata":['<main><h1>Device-width page</h1><p>Inspect the viewport metadata above, then resize the preview.</p></main>'],
    "Avoid a rigid page width":['<main><div class="card">Resize the preview. This card should not overflow its container.</div></main>',".card { width:600px; max-width:100%; padding:16px; box-sizing:border-box; background:#e0f2fe; }"],
    "Wrap a row when space runs out":['<main><div class="row"><div>First card</div><div>Second card</div><div>Third card</div></div></main>',".row { display:flex; flex-wrap:wrap; gap:12px; } .row>div { width:180px; padding:16px; background:#dbeafe; }"],
    "Use responsive images":['<main><h1>Responsive chart</h1>'+picture+'</main>',"img { max-width:100%; height:auto; }"],
    "Respect reduced motion":['<main><div class="marker">Moving marker</div><p>The marker stops when reduced motion is requested.</p></main>',"@keyframes move { to { transform:translateX(60px); } } .marker { animation:move 2s infinite alternate; } @media (prefers-reduced-motion:reduce) { .marker { animation:none; } }"],
    "Listen for a click":['<main><button type="button" id="action">Count a click</button><p id="result" role="status">0 clicks</p></main>',"",'let count = 0; document.getElementById("action").addEventListener("click", () => { count += 1; document.getElementById("result").textContent = count + " clicks"; });'],
    "Write plain text safely":['<main><p id="result"></p></main>',"",'document.getElementById("result").textContent = "<em>This remains plain text</em>";'],
    "Find an element by ID":['<main><p id="result">Before the update</p><p>Another paragraph</p></main>',"",'document.getElementById("result").textContent = "Only the matching ID changed";'],
    "Prevent a form's default navigation":['<main><form id="practiceForm"><label for="name">Name</label><input id="name"><button>Submit locally</button></form><p id="result" role="status">Ready</p></main>',"",'document.getElementById("practiceForm").addEventListener("submit", event => { event.preventDefault(); document.getElementById("result").textContent = "Handled without navigating"; });'],
    "Build an element":['<main><ul id="items"><li>First item</li></ul></main>',"",'const item = document.createElement("li"); item.textContent = "New item"; document.getElementById("items").append(item);'],
    "Connect a visible label":['<main><label for="learner">Practice name</label><input id="learner"><p>Click the label to focus its matching input.</p></main>'],
    "Use an action control":['<main><button type="button" id="action">Try with Enter or Space</button><p id="result" role="status">Ready</p></main>',"",'document.getElementById("action").addEventListener("click", () => { document.getElementById("result").textContent = "Native button activated"; });'],
    "Describe an informative image":['<main><h1>Bar chart</h1>'+picture+'<p>Inspect the image’s alt description, not just its filename.</p></main>',"img { max-width:100%; height:auto; }"],
    "Announce background status":['<main><button type="button" id="action">Update status</button><p id="result" role="status">Ready</p></main>',"",'document.getElementById("action").addEventListener("click", () => { document.getElementById("result").textContent = "Practice operation finished"; });'],
    "Mark a required field":['<main><form id="practiceForm"><label for="answer">Answer</label><input id="answer" required><button>Check field</button></form><p id="result" role="status">Try an empty field first.</p></main>',"",'document.getElementById("practiceForm").addEventListener("submit", event => { event.preventDefault(); document.getElementById("result").textContent = "Required value supplied"; });']
  };
  const example=examples[title];if(!example)throw Error("Missing web practice example: "+title);
  return example;
}
function webQuestion(entry,seed,level){
  const [title,answer,...rest]=entry,explanation=rest.pop();
  const alternatives=rest,shift=(Math.abs(seed)+level)%4,original=[answer,...alternatives];
  const choices=[...original.slice(shift),...original.slice(0,shift)];
  const [example,css="",script=""]=webExample(title,seed,level);
  const content='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Practice example</title><style>body{font-family:system-ui;margin:16px}'+css+'</style><body>'+example+(script?'<script>'+script+'</script>':'')+'</body></html>';
  return {prompt:title+" for this practice page. Which choice fits?",code:content,...{choices,correct:choices.indexOf(answer)},why:explanation+" Inspect the example, then try changing the relevant element or attribute.",workspace:{lang:"web",files:{"index.html":content},fileOrder:["index.html"],activeFilename:"index.html"}};
}
export function expandPracticeCourses(courses){
  const legacyPlacement={java:{"0:0":"j1","1:0":"j2","2:0":"j3","3:0":"j4"},python:{"0:0":"p1","1:0":"p2","2:0":"p3","3:0":"p4"},web:{"0:0":"w1","1:0":"w2","2:0":"w3","3:0":"w4"},logic:{"0:0":"d1","1:0":"d3","2:0":"d2","4:0":"d4"}};
  for(const course of courses){
    const legacy=new Map(course.missions.map(mission=>[mission.id,mission]));
    const modules=course.id==="web"?webModules:numericModules;
    course.modules=modules.map(([moduleId,title,topics],moduleIndex)=>{
      const missions=topics.flatMap((topic,topicIndex)=>levels.map((levelName,levelIndex)=>{
        const oldId=levelIndex===0?legacyPlacement[course.id][moduleIndex+":"+topicIndex]:null;
        if(oldId)return legacy.get(oldId);
        const id=course.id+"-m"+(moduleIndex+1)+"-"+String(topicIndex*3+levelIndex+1).padStart(2,"0");
        const missionTitle=course.id==="web"?topic[0]:topic[1];
        return {id,title:missionTitle+" · "+levelName,concept:missionTitle+". "+["Identify the rule before running.","Trace the example, then change one input.","Predict a boundary case, test it and explain the result."][levelIndex],build(seed){const question=course.id==="web"?webQuestion(topic,seed,levelIndex):numericQuestion(topic[0],course.id==="java"?"java":"python",seed,levelIndex);question.prompt+=" "+["Explain the rule in your prediction.","After predicting, try changing one input in the sandbox.","After predicting, run a boundary example and compare it with this result."][levelIndex];return question;}};
      }));
      return {id:course.id+"-"+moduleId,title:course.id==="logic"?["Trace state changes","Reason about decisions","Investigate loop behavior","Inspect indexed data","Design result checks"][moduleIndex]:title,missions};
    });
    course.missions=course.modules.flatMap(module=>module.missions);
  }
  return courses;
}
