/** Shared mission presentation; the server owns answers, deductions and awards. */
export const PRACTICE_SEASON="practice-2026-10";
export const DIFFICULTIES=[{name:"Starter",maximum:20,deduction:2,floor:10},{name:"Standard",maximum:30,deduction:3,floor:15},{name:"Challenge",maximum:40,deduction:4,floor:20}];
export const ACTIVITY_TYPES=["choice","output","ordering","matching","debugging"];
export function missionMeta(course,mission){const index=course.missions.findIndex(item=>item.id===mission.id);return {...DIFFICULTIES[Math.max(0,index)%3],type:ACTIVITY_TYPES[Math.max(0,index)%5]};}
function rotate(items,seed){const shift=Math.abs(seed)%items.length;return [...items.slice(shift),...items.slice(0,shift)];}
function workspace(language,code){const java=language==="java",filename=java?"Main.java":language==="web"?"index.html":"main.py",content=java?"public class Main { public static void main(String[] args) {\n"+code+"\n}}":code;return {lang:language,files:{[filename]:content},fileOrder:[filename],activeFilename:filename};}
function javaFile(content){return {lang:"java",files:{"Main.java":content},fileOrder:["Main.java"],activeFilename:"Main.java"};}
function traceGuide(language,isOop){
  if(isOop)return ["Identify which object each reference points to.","Apply constructor and method calls in order.","Track field changes and overridden method dispatch.","Predict only the final value or text printed."];
  if(language==="web")return ["Read the relevant element and style or event rule.","Follow the browser condition or event in order.","Track the resulting page state.","Predict the requested final result."];
  return ["Read the starting declarations.","Follow each statement, branch, or loop in order.","Track every value that changes.","Predict only the final output."];
}
function oopOrderingActivity(mission,seed){
  let ordered,prompt,why,full;
  if(mission.oopModule==="oop-encapsulation"){ordered=["Player p = new Player();","p.setScore(8);","System.out.println(p.getScore());"];prompt="Arrange the statements so the object is created, updated through its setter, then read through its getter.";why="Create the object before calling its methods; update state before reading it.";full='public class Main { static class Player { private int score; void setScore(int score){this.score=score;} int getScore(){return score;} } public static void main(String[] args){ Player p=new Player(); p.setScore(8); System.out.println(p.getScore()); } }';}
  else if(mission.oopModule==="oop-inheritance"){ordered=["Animal a = new Dog();","a.speak();","System.out.println(\"done\");"];prompt="Arrange the statements so a superclass reference points to a Dog, calls the overridden method, then prints the final marker.";why="Create the polymorphic reference before using it; the Dog override runs before the final print.";full='public class Main { static class Animal { void speak(){System.out.print("sound ");} } static class Dog extends Animal { @Override void speak(){System.out.print("woof ");} } public static void main(String[] args){ Animal a=new Dog(); a.speak(); System.out.println("done"); } }';}
  else if(mission.oopModule==="oop-polymorphism"){ordered=["Printable p = new Report();","p.print();","System.out.println(\" complete\");"];prompt="Arrange the interface-reference workflow from object creation through method dispatch to the final marker.";why="Assign the concrete object to the interface reference before invoking its implementation.";full='public class Main { interface Printable { void print(); } static class Report implements Printable { public void print(){System.out.print("report");} } public static void main(String[] args){ Printable p=new Report(); p.print(); System.out.println(" complete"); } }';}
  else if(mission.oopModule==="oop-real"){ordered=["ArrayList<Student> list = new ArrayList<>();","list.add(new Student(\"Ari\"));","System.out.println(list.get(0).name);"];prompt="Arrange the statements so the collection is created, receives an object, then reads that object.";why="The list must exist before add, and an element must be added before get(0).";full='import java.util.*; public class Main { static class Student { String name; Student(String name){this.name=name;} } public static void main(String[] args){ ArrayList<Student> list=new ArrayList<>(); list.add(new Student("Ari")); System.out.println(list.get(0).name); } }';}
  else {ordered=["Student s = new Student();","s.name = \"Mia\";","System.out.println(s.name);"];prompt="Arrange the statements so the object is created, its field is assigned, then the value is printed.";why="A reference must point to an object before its field can be changed or read.";full='public class Main { static class Student { String name; } public static void main(String[] args){ Student s=new Student(); s.name="Mia"; System.out.println(s.name); } }';}
  const items=rotate(ordered.map((text,id)=>({id,text})),seed+1).reverse();
  return {code:"",prompt,items:items.map(item=>item.text),solution:ordered.map((text,id)=>items.findIndex(item=>item.id===id)),why,workspace:javaFile(full)};
}
function oopMatchingActivity(mission,seed){
  const banks={
    "oop-classes":[["Class","Blueprint that defines fields and methods"],["Object","Instance created from a class"],["Reference","Variable value that points to an object"]],
    "oop-encapsulation":[["constructor","Initializes a new object"],["this","Refers to the current object"],["private","Restricts direct member access"]],
    "oop-inheritance":[["extends","Creates a subclass relationship"],["super","Refers to superclass construction or members"],["@Override","Marks replacement of inherited behavior"]],
    "oop-polymorphism":[["abstract class","May define incomplete behavior for subclasses"],["interface","Defines a behavior contract"],["dynamic dispatch","Chooses an overridden method from the runtime object"]],
    "oop-real":[["composition","Models a has-a object relationship"],["static","Belongs to the class rather than one instance"],["overloading","Uses the same method name with different parameter lists"]]
  };
  const pairs=banks[mission.oopModule]||banks["oop-classes"],right=rotate(pairs.map((pair,id)=>({id,text:pair[1]})),seed+1).reverse();
  return {code:"",prompt:"Match each OOP term with the rule it represents.",left:pairs.map(pair=>pair[0]),right:right.map(item=>item.text),solution:pairs.map((pair,id)=>right.findIndex(item=>item.id===id)),why:"Object-oriented design uses each term for a distinct structural or runtime role."};
}
function oopDebuggingActivity(mission,seed){
  let code,prompt,options,correct,why,fixed,focusLine,caseHint;
  if(mission.oopModule==="oop-encapsulation"){code="class Player {\n  private int score;\n  void setScore(int score) { score = score; }\n}";prompt="The setter leaves the field unchanged. Which replacement fixes the highlighted line?";options=["this.score = score;","score = this.score;","private score = score;","static score = score;"];correct=options[0];why="this.score selects the object's field while score selects the method parameter.";fixed='public class Main { static class Player { private int score; void setScore(int score){this.score=score;} int getScore(){return score;} } public static void main(String[] args){Player p=new Player();p.setScore(8);System.out.println(p.getScore());} }';focusLine=3;caseHint="The parameter and field have the same name. Check which side must refer to the current object.";}
  else if(mission.oopModule==="oop-inheritance"){code="class Dog extends Animal {\n  @Override\n  void speak(int volume) { System.out.println(\"woof\"); }\n}";prompt="Java reports that this method does not override Animal.speak(). Which replacement fixes the method signature?";options=["void speak() { System.out.println(\"woof\"); }","void speak(String volume) { }","static void speak(int volume) { }","void animalSpeak(int volume) { }"];correct=options[0];why="An override must match the inherited method signature.";fixed='public class Main { static class Animal { void speak(){System.out.println("sound");} } static class Dog extends Animal { @Override void speak(){System.out.println("woof");} } public static void main(String[] args){new Dog().speak();} }';focusLine=3;caseHint="Compare the subclass method's parameter list with the inherited method it is supposed to replace.";}
  else if(mission.oopModule==="oop-polymorphism"){code="Animal a = new Dog();\na.fetch();";prompt="fetch() exists only on Dog, not Animal. Which replacement for the first line makes this call valid without a cast?";options=["Dog a = new Dog();","Animal a = new Animal();","Object a = new Dog();","Dog a = new Animal();"];correct=options[0];why="The reference type controls which members are available at compile time.";fixed='public class Main { static class Animal {} static class Dog extends Animal { void fetch(){System.out.println("fetch");} } public static void main(String[] args){Dog a=new Dog();a.fetch();} }';focusLine=1;caseHint="Runtime type affects dispatch, but the declared reference type still controls accessible members.";}
  else if(mission.oopModule==="oop-real"){code="ArrayList<Student> list = new ArrayList<>();\nSystem.out.println(list.get(0).name);";prompt="The list is empty when get(0) runs. Which statement must be inserted before the highlighted line?";options=['list.add(new Student("Ari"));',"list.clear();","list.remove(0);","list = null;"];correct=options[0];why="An element must exist before index zero can be read.";fixed='import java.util.*; public class Main { static class Student {String name;Student(String name){this.name=name;}} public static void main(String[] args){ArrayList<Student> list=new ArrayList<>();list.add(new Student("Ari"));System.out.println(list.get(0).name);} }';focusLine=2;caseHint="Check the collection state immediately before index zero is accessed.";}
  else {code="Student s = null;\ns.name = \"Mia\";\nSystem.out.println(s.name);";prompt="The program should print Mia without a NullPointerException. Which replacement fixes the highlighted line?";options=["Student s = new Student();","Student s;","Student s = null;","new Student();"];correct=options[0];why="The reference must point to a Student object before its fields can be used.";fixed='public class Main { static class Student {String name;} public static void main(String[] args){Student s=new Student();s.name="Mia";System.out.println(s.name);} }';focusLine=1;caseHint="The highlighted reference does not point to an object yet.";}
  const shuffled=rotate(options,seed),solution=shuffled.indexOf(correct);
  return {code,prompt,choices:shuffled,solution,why,workspace:javaFile(fixed),focusLine,caseHint};
}
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
  if(meta.type==="output"){
    const prompt=String(original.prompt||"").replace(/\s+(Explain the rule in your prediction[.]|After predicting, try changing one input in the sandbox[.]|After predicting, run a boundary example and compare it with this result[.])\s*$/,"").trim();
    activity={...activity,prompt:prompt+" Enter only the exact output or requested value.",solution:String(original.choices[original.correct]),traceGuide:traceGuide(language,mission.oop===true)};
  }
  if(meta.type==="ordering"){
    if(mission.oop===true)activity={...activity,...oopOrderingActivity(mission,seed)};
    else{
      const ordered=language==="web"?["<main>","  <h1>Practice makes progress</h1>","  <p>My first lesson</p>","</main>"]:language==="java"?["int score = "+a+";","score += "+b+";","System.out.println(score);"]:["score = "+a,"score += "+b,"print(score)"];
      const items=rotate(ordered.map((text,id)=>({id,text})),seed+1).reverse();
      activity={...activity,code:"",prompt:language==="web"?"Arrange the opening element, heading, paragraph, and closing element to build the requested page.":"Arrange the statements so the program starts at "+a+", adds "+b+", and prints "+(a+b)+".",items:items.map(item=>item.text),solution:ordered.map((text,id)=>items.findIndex(item=>item.id===id)),why:language==="web"?"Open the main element first, place its heading before its paragraph, then close main.":"Create the variable before updating it, then print the updated value.",workspace:workspace(language,ordered.join("\n"))};
    }
  }
  if(meta.type==="matching"){
    if(mission.oop===true)activity={...activity,...oopMatchingActivity(mission,seed)};
    else{
      const pairs=language==="web"?[["<header>","Introductory page or section content"],["<nav>","Major navigation links"],["<main>","The primary page content"]]:[[a+" + "+b,String(a+b)],[a+" × "+b,String(a*b)],[a+" − "+b,String(a-b)]];
      const right=rotate(pairs.map((pair,id)=>({id,text:pair[1]})),seed+1).reverse();
      activity={...activity,code:"",prompt:language==="web"?"Match each semantic element with its purpose.":"Match each expression with its result.",left:pairs.map(pair=>pair[0]),right:right.map(item=>item.text),solution:pairs.map((pair,id)=>right.findIndex(item=>item.id===id)),why:language==="web"?"Semantic elements describe the purpose of their content.":"Apply each operator to the two operands. Addition, multiplication, and subtraction produce different results."};
    }
  }
  if(meta.type==="debugging"){
    if(mission.oop===true)activity={...activity,...oopDebuggingActivity(mission,seed)};
    else if(language==="web")activity={...activity,code:'<label for="student-name">Name</label>\n<input id="learner-name">',prompt:"The label does not focus the input. Choose the replacement input that fixes the link.",choices:['<input id="student-name">','<input name="student-name">','<input title="student-name">','<input placeholder="student-name">'],solution:0,why:"The label's for value must match the input's id.",workspace:workspace("web",'<label for="student-name">Name</label><input id="student-name">'),focusLine:2,caseHint:"The label and input identifiers do not match."};
    else{
      const lines=language==="java"?["int total = "+a+" - "+b+";","System.out.println(total);"]:["total = "+a+" - "+b,"print(total)"],fixes=rotate(["+","−","×","÷"],seed);
      activity={...activity,code:lines.join("\n"),prompt:"The program should print the sum "+(a+b)+". Which operator should replace the subtraction on the first line?",choices:fixes,solution:fixes.indexOf("+"),why:"Use addition to calculate the requested sum. Subtraction produces the difference.",workspace:workspace(language,lines.join("\n").replace(a+" - "+b,a+" + "+b)),focusLine:1,caseHint:"The highlighted operator does not match the requested calculation."};
    }
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
