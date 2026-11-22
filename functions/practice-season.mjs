/** Shared mission presentation; the server owns answers, deductions and awards. */
export const PRACTICE_SEASON="practice-2026-10";
export const DIFFICULTIES=[{name:"Starter",maximum:20,deduction:2,floor:10},{name:"Standard",maximum:30,deduction:3,floor:15},{name:"Challenge",maximum:40,deduction:4,floor:20}];
export const ACTIVITY_TYPES=["choice","output","ordering","matching","debugging"];
export function missionMeta(course,mission){const index=course.missions.findIndex(item=>item.id===mission.id);return {...DIFFICULTIES[Math.max(0,index)%3],type:mission.arcadeType||ACTIVITY_TYPES[Math.max(0,index)%5]};}
function rotate(items,seed){const shift=Math.abs(seed)%items.length;return [...items.slice(shift),...items.slice(0,shift)];}
function workspace(language,code){const java=language==="java",filename=java?"Main.java":language==="web"?"index.html":"main.py",content=java?"public class Main { public static void main(String[] args) {\n"+code+"\n}}":code;return {lang:language,files:{[filename]:content},fileOrder:[filename],activeFilename:filename};}
function javaFile(content){return {lang:"java",files:{"Main.java":content},fileOrder:["Main.java"],activeFilename:"Main.java"};}
function traceGuide(course,mission,language,isOop){
  const moduleId=missionModule(course,mission)?.id||"";
  if(isOop){
    if(mission.oopModule==="oop-classes")return [
      "Identify each reference and when its object is created.",
      "Apply constructor assignments before later field or method access.",
      "Track the object state that changes.",
      "Read the final field value, identity check, or printed text."
    ];
    if(mission.oopModule==="oop-encapsulation")return [
      "Mark which state is private and which method is allowed to change it.",
      "Apply constructor, setter, or instance-method calls in order.",
      "Track the private field only through those controlled operations.",
      "Read the value exposed by the getter or final print."
    ];
    if(mission.oopModule==="oop-inheritance")return [
      "Identify the parent type and the concrete child object.",
      "Apply superclass construction or inherited behavior before child-specific work.",
      "Track whether an override or super call changes the executed method.",
      "Record only the final value or text produced."
    ];
    if(mission.oopModule==="oop-polymorphism")return [
      "Separate the declared reference type from the runtime object type.",
      "Follow any interface or superclass assignment.",
      "Resolve each method call using the runtime object's override.",
      "Combine the dispatched results into the final output."
    ];
    return [
      "Identify the objects or collection elements involved.",
      "Follow composition, collection, static, overload, or exception behavior in order.",
      "Track the state or runtime method selected at each step.",
      "Record only the final requested output."
    ];
  }
  if(language==="web"){
    if(/html/.test(moduleId))return [
      "Identify the semantic element being evaluated.",
      "Check what content that element is intended to represent.",
      "Follow the requested structure from outer container to inner content.",
      "Select or enter the semantic result requested by the mission."
    ];
    if(/css/.test(moduleId))return [
      "Identify the selector or property that applies.",
      "Read the declaration value before considering the rendered effect.",
      "Track how that rule changes sizing, spacing, or layout.",
      "Give only the requested selector, property, or result."
    ];
    if(/responsive/.test(moduleId))return [
      "Identify the viewport or responsive condition.",
      "Check which rule changes when available width or motion preference changes.",
      "Track the resulting layout or media behavior.",
      "Give only the requested responsive result."
    ];
    if(/events/.test(moduleId))return [
      "Identify the element selected by the DOM lookup.",
      "Follow the event listener into its callback.",
      "Track the state or text changed inside that callback.",
      "Give only the final requested browser state."
    ];
    return [
      "Identify the control, label, role, or accessibility relationship.",
      "Check the relevant native or ARIA rule.",
      "Trace how the browser exposes that relationship to interaction.",
      "Give only the requested accessible result."
    ];
  }
  if(/values/.test(moduleId))return [
    "Write down each starting value before any update.",
    "Apply operators in precedence order and process compound assignments in place.",
    "Update the scratch value immediately after each changing statement.",
    "Read the exact value used by the final print."
  ];
  if(/branches/.test(moduleId))return [
    "Write the values used by the condition.",
    "Evaluate the comparison or boolean expression exactly once.",
    "Follow only the branch selected by that true/false result.",
    "Record the value or text printed by that branch."
  ];
  if(/loops/.test(moduleId))return [
    "Write the loop start, stopping condition, and step.",
    "List each index value that actually enters the loop body.",
    "Update the accumulator after every iteration, including continue/break effects.",
    "Read the accumulator only after the loop finishes."
  ];
  if(/collections/.test(moduleId))return [
    "Write the collection values and valid index range.",
    "Resolve the index or length expression before reading an element.",
    "Apply any update only to the selected element.",
    "Read the requested element, length, or combined result."
  ];
  if(/checks/.test(moduleId))return [
    "Write the arguments passed to the reusable operation.",
    "Apply min, max, absolute value, subtraction, or multiplication exactly as written.",
    "Store the operation result before later checks.",
    "Read only the final value printed."
  ];
  return ["Read the starting declarations.","Follow each statement in execution order.","Track every value that changes.","Predict only the final output."];
}
function oopOrderingActivity(mission,seed){
  const cases={
    "instance-field":{ordered:["Student s = new Student();","s.name = \"Mia\";","System.out.println(s.name);"],prompt:"Arrange the statements so the Student exists before its field is written and read.",why:"Create the object first, assign the field second, then read it.",full:'public class Main { static class Student {String name;} public static void main(String[] args){Student s=new Student();s.name="Mia";System.out.println(s.name);} }'},
    "new-keyword":{ordered:["Student s;","s = new Student();","System.out.println(s != null);"],prompt:"Arrange the statements from reference declaration to object construction to verification.",why:"Declare the reference, create the object with new, then use the initialized reference.",full:'public class Main { static class Student {} public static void main(String[] args){Student s;s=new Student();System.out.println(s!=null);} }'},
    "object-identity":{ordered:["Student a = new Student();","Student b = new Student();","System.out.println(a == b);"],prompt:"Arrange the identity check from creating the first object through comparing the two references.",why:"Create both objects before comparing their references.",full:'public class Main { static class Student {} public static void main(String[] args){Student a=new Student();Student b=new Student();System.out.println(a==b);} }'},
    "constructor-output":{ordered:["Book b = new Book(\"OOP\");","String title = b.title;","System.out.println(title);"],prompt:"Arrange the constructor workflow so the created object's title is read and printed.",why:"Construct the object before reading its initialized field.",full:'public class Main { static class Book {String title;Book(String title){this.title=title;}} public static void main(String[] args){Book b=new Book("OOP");String title=b.title;System.out.println(title);} }'},
    "private-field":{ordered:["Player p = new Player();","p.addPoint();","System.out.println(p.getScore());"],prompt:"Arrange the encapsulated workflow so private state changes only through methods.",why:"Create the object, change its private state through behavior, then read it through a getter.",full:'public class Main { static class Player {private int score;void addPoint(){score++;}int getScore(){return score;}} public static void main(String[] args){Player p=new Player();p.addPoint();System.out.println(p.getScore());} }'},
    "validated-setter":{ordered:["Player p = new Player();","p.setScore(8);","System.out.println(p.getScore());"],prompt:"Arrange the validated setter workflow from object creation to controlled update to reading the result.",why:"Create the object first, use the setter to validate the new state, then read it through the getter.",full:'public class Main { static class Player {private int score;void setScore(int score){if(score>=0)this.score=score;}int getScore(){return score;}} public static void main(String[] args){Player p=new Player();p.setScore(8);System.out.println(p.getScore());} }'},
    "inherited-method":{ordered:["Dog d = new Dog();","d.move();","System.out.println(\"done\");"],prompt:"Arrange the inherited-method workflow from object creation through the inherited call.",why:"The Dog object must exist before it can use Animal's inherited move method.",full:'public class Main { static class Animal {void move(){System.out.print("move ");}} static class Dog extends Animal {} public static void main(String[] args){Dog d=new Dog();d.move();System.out.println("done");} }'},
    "override":{ordered:["Animal a = new Dog();","a.speak();","System.out.println(\"done\");"],prompt:"Arrange the polymorphic call so the Dog override runs before the final marker.",why:"Create the Dog through the Animal reference before invoking the overridden method.",full:'public class Main { static class Animal {void speak(){System.out.print("sound ");}} static class Dog extends Animal {@Override void speak(){System.out.print("woof ");}} public static void main(String[] args){Animal a=new Dog();a.speak();System.out.println("done");} }'},
    "super-method":{ordered:["Dog d = new Dog();","d.speak();","System.out.println(\" done\");"],prompt:"Arrange the call so the Dog override can invoke superclass behavior before the final marker.",why:"Create the Dog before calling the override; super.speak() executes inside that override.",full:'public class Main { static class Animal {void speak(){System.out.print("sound");}} static class Dog extends Animal {@Override void speak(){super.speak();System.out.print(" woof");}} public static void main(String[] args){Dog d=new Dog();d.speak();System.out.println(" done");} }'},
    "dynamic-dispatch":{ordered:["Shape s = new Circle();","s.draw();","System.out.println(\"done\");"],prompt:"Arrange the statements so runtime dispatch reaches Circle.draw().",why:"The superclass reference can point to a Circle; the override is selected when draw runs.",full:'public class Main { static class Shape {void draw(){System.out.print("shape ");}} static class Circle extends Shape {@Override void draw(){System.out.print("circle ");}} public static void main(String[] args){Shape s=new Circle();s.draw();System.out.println("done");} }'},
    "interface":{ordered:["Printable p = new Report();","p.print();","System.out.println(\" done\");"],prompt:"Arrange the interface workflow from implementation object to behavior call.",why:"Assign the implementing object to the interface reference before invoking its contract method.",full:'public class Main { interface Printable {void print();} static class Report implements Printable {public void print(){System.out.print("report");}} public static void main(String[] args){Printable p=new Report();p.print();System.out.println(" done");} }'},
    "interface-list":{ordered:["Printable[] items = { new Report(), new Ticket() };","for (Printable item : items) item.print();","System.out.println();"],prompt:"Arrange the interface collection workflow so multiple implementations are stored before polymorphic dispatch.",why:"Create the interface-typed array first, iterate through it second, then finish the output.",full:'public class Main { interface Printable {void print();} static class Report implements Printable {public void print(){System.out.print("R");}} static class Ticket implements Printable {public void print(){System.out.print("T");}} public static void main(String[] args){Printable[] items={new Report(),new Ticket()};for(Printable item:items)item.print();System.out.println();} }'},
    "arraylist-objects":{ordered:["ArrayList<Student> list = new ArrayList<>();","list.add(new Student(\"Ari\"));","System.out.println(list.get(0).name);"],prompt:"Arrange the collection workflow so an object exists before index zero is read.",why:"Create the list, add the object, then retrieve it.",full:'import java.util.*; public class Main { static class Student {String name;Student(String name){this.name=name;}} public static void main(String[] args){ArrayList<Student> list=new ArrayList<>();list.add(new Student("Ari"));System.out.println(list.get(0).name);} }'},
    "overloading":{ordered:["Calc calc = new Calc();","int result = calc.add(2, 3);","System.out.println(result);"],prompt:"Arrange the overloaded-method workflow so Java resolves the int overload before printing.",why:"Create the receiver first, call the overload with int arguments, then use its result.",full:'public class Main { static class Calc {int add(int a,int b){return a+b;}double add(double a,double b){return a+b;}} public static void main(String[] args){Calc calc=new Calc();int result=calc.add(2,3);System.out.println(result);} }'},
    "collection-polymorphism":{ordered:["List<Animal> animals = List.of(new Dog(), new Cat());","for (Animal animal : animals) animal.speak();","System.out.println();"],prompt:"Arrange the polymorphic collection workflow from storing subclasses to dispatching their overrides.",why:"Build the superclass-typed collection before iterating and invoking each runtime object's behavior.",full:'import java.util.*; public class Main { static class Animal {void speak(){System.out.print("A");}} static class Dog extends Animal {@Override void speak(){System.out.print("D");}} static class Cat extends Animal {@Override void speak(){System.out.print("C");}} public static void main(String[] args){List<Animal> animals=List.of(new Dog(),new Cat());for(Animal animal:animals)animal.speak();System.out.println();} }'}
  };
  const pick=cases[mission.oopTopic]||cases["instance-field"],items=rotate(pick.ordered.map((text,id)=>({id,text})),seed+1).reverse();
  return {code:"",prompt:pick.prompt,items:items.map(item=>item.text),solution:pick.ordered.map((text,id)=>items.findIndex(item=>item.id===id)),why:pick.why,workspace:javaFile(pick.full)};
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
  const cases={
    "class-object":{code:"Student learner;\nlearner.name = \"Mia\";",prompt:"The reference is used before it points to an object. Which replacement for line 1 fixes the case?",options:["Student learner = new Student();","Student learner = null;","new Student();","class learner = Student;"],why:"The local reference must be initialized with a Student object before a field can be used.",full:'public class Main { static class Student {String name;} public static void main(String[] args){Student learner=new Student();learner.name="Mia";System.out.println(learner.name);} }',focusLine:1,hint:"A declaration alone does not create the Student object."},
    "instance-method":{code:"class Counter {\n  int value = 2;\n  void addOne() { value--; }\n}",prompt:"addOne() should increase value. Which replacement fixes the highlighted line?",options:["void addOne() { value++; }","void addOne() { value = 0; }","void addOne() { value--; }","static void addOne() { }"],why:"Incrementing with ++ matches the method's intended behavior.",full:'public class Main { static class Counter {int value=2;void addOne(){value++;}} public static void main(String[] args){Counter c=new Counter();c.addOne();System.out.println(c.value);} }',focusLine:3,hint:"Compare the method name with the arithmetic update."},
    "shared-reference":{code:"Student a = new Student();\na.name = \"Ana\";\nStudent b = new Student();\nb.name = \"Kai\";",prompt:"The goal is for a and b to refer to the same object. Which replacement fixes line 3?",options:["Student b = a;","Student b = new Student();","Student b = null;","a = new Student();"],why:"Assigning b = a copies the reference so both variables point to the same Student.",full:'public class Main { static class Student {String name;} public static void main(String[] args){Student a=new Student();a.name="Ana";Student b=a;b.name="Kai";System.out.println(a.name);} }',focusLine:3,hint:"Creating another object breaks the intended shared-reference relationship."},
    "constructor-purpose":{code:"class Book {\n  String title;\n  Book(String title) { }\n}",prompt:"The constructor receives title but never initializes the field. Which replacement fixes line 3?",options:["Book(String title) { this.title = title; }","Book() { title = null; }","void Book(String title) { }","Book(String title) { title = title; }"],why:"A constructor should store the incoming value in the new object's field.",full:'public class Main { static class Book {String title;Book(String title){this.title=title;}} public static void main(String[] args){System.out.println(new Book("OOP").title);} }',focusLine:3,hint:"The constructor parameter must be copied into object state."},
    "this-keyword":{code:"Student(String name) {\n  this.name = this.name;\n}",prompt:"The field remains null. Which replacement fixes line 2?",options:["this.name = name;","name = this.name;","this = name;","Student.name = name;"],why:"this.name is the field and name is the parameter.",full:'public class Main { static class Student {String name;Student(String name){this.name=name;}} public static void main(String[] args){System.out.println(new Student("Lia").name);} }',focusLine:2,hint:"Both sides currently read from the object instead of using the parameter."},
    "getter-setter":{code:"class Player {\n  private int score;\n  int getScore() { return 0; }\n}",prompt:"getScore() should expose the current private score. Which replacement fixes line 3?",options:["int getScore() { return score; }","int getScore() { return 0; }","void getScore() { }","static int getScore() { return 0; }"],why:"The getter should return the object's stored field.",full:'public class Main { static class Player {private int score=8;int getScore(){return score;}} public static void main(String[] args){System.out.println(new Player().getScore());} }',focusLine:3,hint:"A getter should read the field instead of returning a constant."},
    "extends":{code:"class Dog {\n  void bark() { }\n}",prompt:"Dog should inherit move() from Animal. Which replacement fixes line 1?",options:["class Dog extends Animal {","class Dog implements Animal {","class Animal extends Dog {","class Dog super Animal {"],why:"A class inherits from another class with extends.",full:'public class Main { static class Animal {void move(){System.out.println("move");}} static class Dog extends Animal {void bark(){}} public static void main(String[] args){new Dog().move();} }',focusLine:1,hint:"The subclass declaration is missing its inheritance relationship."},
    "super-constructor":{code:"class Child extends Parent {\n  Child() { }\n}",prompt:"Parent has only Parent(int level). Which replacement fixes line 2?",options:["Child() { super(4); }","Child() { this(); }","Child() { new Parent(); }","Child() { super(); }"],why:"The subclass constructor must explicitly call an available superclass constructor.",full:'public class Main { static class Parent {int level;Parent(int level){this.level=level;}} static class Child extends Parent {Child(){super(4);}} public static void main(String[] args){System.out.println(new Child().level);} }',focusLine:2,hint:"Java cannot insert super() when the superclass has no zero-argument constructor."},
    "protected":{code:"class Parent {\n  private int level = 4;\n}\nclass Child extends Parent {\n  int read() { return level; }\n}",prompt:"Child should read level directly. Which replacement fixes line 2 while preserving subclass-only access?",options:["protected int level = 4;","public static int level = 4;","private int level = 4;","final int level = 4;"],why:"protected allows direct access from subclasses while remaining more restricted than public.",full:'public class Main { static class Parent {protected int level=4;} static class Child extends Parent {int read(){return level;}} public static void main(String[] args){System.out.println(new Child().read());} }',focusLine:2,hint:"private blocks direct subclass access."},
    "upcasting":{code:"Dog d = new Animal();",prompt:"The goal is valid upcasting through a superclass reference. Which replacement fixes the line?",options:["Animal d = new Dog();","Dog d = new Animal();","Dog d = (Dog) new Animal();","Object d = new Animal();"],why:"Upcasting stores a subclass object in a compatible superclass reference.",full:'public class Main { static class Animal {} static class Dog extends Animal {} public static void main(String[] args){Animal d=new Dog();System.out.println(d instanceof Dog);} }',focusLine:1,hint:"The object must be at least as specific as the reference expects."},
    "abstract-class":{code:"Shape s = new Shape();",prompt:"Shape is abstract. Which replacement creates a usable concrete object?",options:["Shape s = new Square();","Shape s = new Shape();","abstract Shape s = new Shape();","Square s = new Shape();"],why:"Abstract classes cannot be instantiated directly; use a concrete subclass.",full:'public class Main { static abstract class Shape {abstract double area();} static class Square extends Shape {double area(){return 4;}} public static void main(String[] args){Shape s=new Square();System.out.println(s.area());} }',focusLine:1,hint:"The reference type may be abstract, but the created object cannot be."},
    "interface-reference":{code:"Printable p = new Object();\np.print();",prompt:"Printable should reference an implementation that provides print(). Which replacement fixes line 1?",options:["Printable p = new Report();","Printable p = new Object();","Object p = new Report();","Report p = new Object();"],why:"An interface reference must point to an object whose class implements that interface.",full:'public class Main { interface Printable {void print();} static class Report implements Printable {public void print(){System.out.println("report");}} public static void main(String[] args){Printable p=new Report();p.print();} }',focusLine:1,hint:"Object does not implement the Printable contract."},
    "composition":{code:"class Car {\n  Engine engine = null;\n  void start() { engine.run(); }\n}",prompt:"Car should contain a ready Engine object. Which replacement fixes line 2?",options:["Engine engine = new Engine();","Engine engine = null;","Car engine = new Car();","static Engine = new Engine();"],why:"Composition requires the containing object to hold a valid component reference before using it.",full:'public class Main { static class Engine {void run(){System.out.println("run");}} static class Car {Engine engine=new Engine();void start(){engine.run();}} public static void main(String[] args){new Car().start();} }',focusLine:2,hint:"The composed component is currently missing."},
    "static-member":{code:"class Student {\n  int count = 0;\n}\nSystem.out.println(Student.count);",prompt:"count should belong to the class and be read through Student.count. Which replacement fixes line 2?",options:["static int count = 0;","private int count = 0;","final int count = 0;","int count() { return 0; }"],why:"A class-qualified field access requires a static field.",full:'public class Main { static class Student {static int count=0;Student(){count++;}} public static void main(String[] args){new Student();System.out.println(Student.count);} }',focusLine:2,hint:"The code accesses count through the class name, not an instance."},
    "exception-handling":{code:"try {\n  int x = 10 / 0;\n} catch (NullPointerException e) {\n  System.out.println(\"caught\");\n}",prompt:"The catch block does not handle integer division by zero. Which replacement fixes line 3?",options:["} catch (ArithmeticException e) {","} catch (NullPointerException e) {","} catch (ClassCastException e) {","} finally (ArithmeticException e) {"],why:"Integer division by zero throws ArithmeticException.",full:'public class Main { public static void main(String[] args){try{int x=10/0;}catch(ArithmeticException e){System.out.println("caught");}} }',focusLine:3,hint:"Choose the exception type actually thrown by integer division by zero."}
  };
  const pick=cases[mission.oopTopic]||cases["class-object"],shuffled=rotate(pick.options,seed);
  return {code:pick.code,prompt:pick.prompt,choices:shuffled,solution:shuffled.indexOf(pick.options[0]),why:pick.why,workspace:javaFile(pick.full),focusLine:pick.focusLine,caseHint:pick.hint};
}
function missionModule(course,mission){return course.modules?.find(module=>module.missions?.some(item=>item.id===mission.id))||null;}
function genericOrderingActivity(course,mission,language,seed,a,b){
  const moduleId=missionModule(course,mission)?.id||"";
  let ordered=[],prompt="",why="",full="";
  if(course.id==="web"){
    if(/html/.test(moduleId)){ordered=["<main>","  <article>","    <h1>Practice update</h1>","    <p>Mission complete.</p>","  </article>","</main>"];prompt="Arrange the semantic page blocks from the outer main region to the article content and closing tags.";why="Open containers before their children, then close inner and outer elements in reverse order.";full=ordered.join("\n");}
    else if(/css/.test(moduleId)){ordered=[".card {","  box-sizing: border-box;","  padding: 16px;","  border: 2px solid #2563eb;","}"];prompt="Arrange the CSS rule from selector to sizing, spacing, border, and closing brace.";why="Open the rule first, place declarations inside it, then close the block.";full="<style>"+ordered.join("\n")+"</style><div class=\"card\">Practice card</div>";}
    else if(/responsive/.test(moduleId)){ordered=[".row {","  display: flex;","  flex-wrap: wrap;","  gap: 12px;","}"];prompt="Arrange the responsive flex rule so layout, wrapping, and spacing are applied inside the rule.";why="Establish the flex container before wrapping and spacing declarations.";full="<style>"+ordered.join("\n")+"</style><div class=\"row\"><div>A</div><div>B</div><div>C</div></div>";}
    else if(/events/.test(moduleId)){ordered=['const button = document.getElementById("action");','const status = document.getElementById("status");','button.addEventListener("click", () => {','  status.textContent = "Ready";','});'];prompt="Arrange the DOM event workflow from element lookup to event registration and status update.";why="References must exist before the listener uses them, and the update belongs inside the callback.";full='<button id="action">Run</button><p id="status">Waiting</p><script>'+ordered.join("\n")+"</script>";}
    else {ordered=['<label for="email">Email</label>','<input id="email" required>','<button type="submit">Save</button>','<p role="status" id="status"></p>'];prompt="Arrange the accessible form controls from label and input to action and status feedback.";why="Keep the visible label with its control, then place the action and status feedback after the field.";full="<form>"+ordered.join("\n")+"</form>";}
  }else if(/values/.test(moduleId)){
    ordered=[language==="java"?"int score = "+a+";":"score = "+a,language==="java"?"int bonus = "+b+";":"bonus = "+b,language==="java"?"score += bonus;":"score += bonus",language==="java"?"score *= 2;":"score *= 2",language==="java"?"System.out.println(score);":"print(score)"];prompt="Arrange the statements so both starting values exist before the updates and final output.";why="Declare both values, apply updates in order, then print the final state.";full=ordered.join("\n");
  }else if(/branches/.test(moduleId)){
    ordered=language==="java"?["int score = "+a+";","if (score >= "+b+") {",'  System.out.println("PASS");',"} else {",'  System.out.println("RETRY");',"}"]:["score = "+a,"if score >= "+b+":",'    print("PASS")',"else:",'    print("RETRY")'];prompt="Arrange the decision so the value exists before the condition and branch outcomes.";why="Initialize first, evaluate the condition second, then run exactly one branch.";full=ordered.join("\n");
  }else if(/loops/.test(moduleId)){
    ordered=language==="java"?["int total = 0;","for (int i = 0; i < "+b+"; i++) {","  total += i;","}","System.out.println(total);"]:["total = 0","for i in range("+b+"):","    total += i","print(total)"];prompt="Arrange the accumulation from initialization through loop update and final output.";why="Initialize before iterating, update inside the loop, then print after iteration.";full=ordered.join("\n");
  }else if(/collections/.test(moduleId)){
    ordered=language==="java"?["int[] values = {"+a+", "+b+", "+(a+b)+"};","int total = 0;","for (int value : values) {","  total += value;","}","System.out.println(total);"]:["values = ["+a+", "+b+", "+(a+b)+"]","total = 0","for value in values:","    total += value","print(total)"];prompt="Arrange the collection workflow from creating data to accumulating and printing its total.";why="Create the collection and accumulator before iterating, then print after the loop.";full=ordered.join("\n");
  }else{
    ordered=[language==="java"?"int result = Math.max("+a+", "+b+");":"result = max("+a+", "+b+")",language==="java"?"boolean valid = result >= "+a+";":"valid = result >= "+a,language==="java"?'String status = valid ? "PASS" : "RETRY";':'status = "PASS" if valid else "RETRY"',language==="java"?"System.out.println(status);":"print(status)"];prompt="Arrange the result-check workflow from calculation to validation, status, and output.";why="Calculate first, validate the result, derive the status, then print it.";full=ordered.join("\n");
  }
  const items=rotate(ordered.map((text,id)=>({id,text})),seed+1).reverse();
  return {code:"",prompt,items:items.map(item=>item.text),solution:ordered.map((text,id)=>items.findIndex(item=>item.id===id)),why,workspace:workspace(language,full)};
}
function numericDebuggingActivity(course,mission,language,seed,a,b){
  const moduleId=missionModule(course,mission)?.id||"",java=language==="java",semi=java?";":"",
   out=value=>java?"System.out.println("+value+");":"print("+value+")";
  let code=[],choices=[],prompt="",why="",fixed=[],focusLine=2,caseHint="";
  if(/values/.test(moduleId)){
    code=[java?"int points = "+a+";":"points = "+a,"points -= "+b+semi,out("points")];
    choices=["points += "+b+semi,"points -= "+b+semi,"points *= "+b+semi,"points = "+b+semi];
    prompt="points should increase by "+b+". Which replacement fixes line 2?";
    why="Compound addition updates the existing value by adding the bonus.";
    fixed=[code[0],choices[0],code[2]];caseHint="The update currently moves points in the opposite direction.";
  }else if(/branches/.test(moduleId)){
    code=java?["int score = "+b+";","if (score > "+b+") {",'  System.out.println("PASS");',"} else {",'  System.out.println("RETRY");',"}"]:
      ["score = "+b,"if score > "+b+":",'    print("PASS")',"else:",'    print("RETRY")'];
    choices=java?["if (score >= "+b+") {","if (score > "+b+") {","if (score < "+b+") {","if (score != "+b+") {"]:
      ["if score >= "+b+":","if score > "+b+":","if score < "+b+":","if score != "+b+":"];
    prompt="A score equal to the minimum "+b+" should PASS. Which replacement fixes line 2?";
    why="An inclusive minimum uses >= so the exact boundary is accepted.";
    fixed=[code[0],choices[0],...code.slice(2)];caseHint="Test the condition exactly at the required boundary.";
  }else if(/loops/.test(moduleId)){
    code=java?["int total = 0;","for (int i = 0; i <= "+b+"; i++) {","  total += i;","}",out("total")]:
      ["total = 0","for i in range(0, "+(b+1)+"):", "    total += i",out("total")];
    choices=java?["for (int i = 0; i < "+b+"; i++) {","for (int i = 0; i <= "+b+"; i++) {","for (int i = 1; i < "+b+"; i++) {","for (int i = 0; i > "+b+"; i++) {"]:
      ["for i in range(0, "+b+"):","for i in range(0, "+(b+1)+"):","for i in range(1, "+b+"):","for i in range("+b+", 0):"];
    prompt="The loop should process indexes 0 through "+(b-1)+" exactly once. Which replacement fixes line 2?";
    why="The upper bound must be excluded so iteration stops before "+b+".";
    fixed=[code[0],choices[0],...code.slice(2)];caseHint="The current loop includes one value beyond the intended final index.";
  }else if(/collections/.test(moduleId)){
    const values=a+", "+b+", "+(a+b);
    code=java?["int[] values = {"+values+"};","System.out.println(values[values.length]);"]:
      ["values = ["+values+"]","print(values[len(values)])"];
    choices=java?[
      "System.out.println(values[values.length - 1]);",
      "System.out.println(values[values.length]);",
      "System.out.println(values[0]);",
      "System.out.println(values[1]);"
    ]:[
      "print(values[len(values) - 1])",
      "print(values[len(values)])",
      "print(values[0])",
      "print(values[1])"
    ];
    prompt="The program should print the last element without going out of bounds. Which replacement fixes line 2?";
    why="The last valid index is one less than the collection length.";
    fixed=[code[0],choices[0]];caseHint="A collection with length 3 has valid indexes 0, 1, and 2.";
  }else{
    code=java?["int first = "+a+";","int second = "+b+";","int result = Math.min(first, second);",out("result")]:
      ["first = "+a,"second = "+b,"result = min(first, second)",out("result")];
    choices=java?[
      "int result = Math.max(first, second);",
      "int result = Math.min(first, second);",
      "int result = first + second;",
      "int result = Math.abs(first - second);"
    ]:[
      "result = max(first, second)",
      "result = min(first, second)",
      "result = first + second",
      "result = abs(first - second)"
    ];
    prompt="The reusable operation should keep the larger value. Which replacement fixes line 3?";
    why="max returns the larger of the two arguments.";
    fixed=[code[0],code[1],choices[0],code[3]];focusLine=3;caseHint="The selected helper currently returns the smaller value.";
  }
  const shuffled=rotate(choices,seed);
  return {code:code.join("\n"),prompt,choices:shuffled,solution:shuffled.indexOf(choices[0]),why,
    workspace:workspace(language,fixed.join("\n")),focusLine,caseHint};
}
function webDebuggingActivity(course,mission,seed){
  const moduleId=missionModule(course,mission)?.id||"",cases={
    html:{code:'<main>\n  <div><h1>School update</h1><p>Independent story</p></div>\n</main>',prompt:"The story should be independently meaningful content. Which replacement fixes line 2?",choices:['  <article><h1>School update</h1><p>Independent story</p></article>','  <span><h1>School update</h1><p>Independent story</p></span>','  <br><h1>School update</h1><p>Independent story</p>','  <label><h1>School update</h1><p>Independent story</p></label>'],why:"article represents self-contained content.",fixed:'<main><article><h1>School update</h1><p>Independent story</p></article></main>',focusLine:2,caseHint:"The content is a complete story, not a generic grouping.",scenario:"Semantic structure"},
    css:{code:'<style>\n.card { width: 320px; padding: 24px; border: 4px solid #2563eb; box-sizing: content-box; }\n</style>\n<div class="card">Repair this card</div>',prompt:"The card should keep its declared width inclusive of padding and border. Which replacement fixes line 2?",choices:['.card { width: 320px; padding: 24px; border: 4px solid #2563eb; box-sizing: border-box; }','.card { width: 320px; padding: 24px; border: 4px solid #2563eb; display: inline; }','.card { width: 320px; padding: 24px; border: 4px solid #2563eb; overflow: visible; }','.card { width: auto; padding: 24px; border: 4px solid #2563eb; position: fixed; }'],why:"border-box includes padding and border in the declared width.",fixed:'<style>.card{width:320px;padding:24px;border:4px solid #2563eb;box-sizing:border-box}</style><div class="card">Repaired card</div>',focusLine:2,caseHint:"The width currently excludes padding and border.",scenario:"Box model"},
    responsive:{code:'<style>\n.row { display:flex; flex-wrap: nowrap; gap:12px; }\n.card { min-width:220px; padding:16px; }\n</style>\n<div class="row"><div class="card">One</div><div class="card">Two</div><div class="card">Three</div></div>',prompt:"The cards should wrap instead of overflowing narrow screens. Which replacement fixes line 2?",choices:['.row { display:flex; flex-wrap: wrap; gap:12px; }','.row { display:block; flex-wrap: nowrap; gap:12px; }','.row { display:flex; white-space: nowrap; gap:12px; }','.row { display:flex; position: fixed; gap:12px; }'],why:"flex-wrap: wrap allows flex items onto another row.",fixed:'<style>.row{display:flex;flex-wrap:wrap;gap:12px}.card{width:220px;max-width:100%;padding:16px;background:#dbeafe}</style><div class="row"><div class="card">One</div><div class="card">Two</div><div class="card">Three</div></div>',focusLine:2,caseHint:"The flex row is explicitly forbidden from wrapping.",scenario:"Responsive overflow"},
    events:{code:'<button id="action">Count</button>\n<p id="result">0 clicks</p>\n<script>\nlet count = 0;\ndocument.getElementById("wrong").addEventListener("click", () => { count++; document.getElementById("result").textContent = count + " clicks"; });\n</script>',prompt:"The button never updates because the listener targets the wrong element. Which replacement fixes line 5?",choices:['document.getElementById("action").addEventListener("click", () => { count++; document.getElementById("result").textContent = count + " clicks"; });','document.getElementById("result").addEventListener("click", () => { count++; });','document.createElement("action").addEventListener("click", () => { count++; });','document.getElementsByName("action").textContent = count;'],why:"The listener must attach to the existing element whose id is action.",fixed:'<button id="action">Count</button><p id="result">0 clicks</p><script>let count=0;document.getElementById("action").addEventListener("click",()=>{count++;document.getElementById("result").textContent=count+" clicks";});</script>',focusLine:5,caseHint:"Compare the button id with getElementById.",scenario:"DOM event wiring"},
    accessibility:{code:'<label for="student-name">Name</label>\n<input id="learner-name" required>\n<button>Save</button>',prompt:"The visible label does not focus its input. Which replacement fixes line 2?",choices:['<input id="student-name" required>','<input name="student-name" required>','<input title="student-name" required>','<input placeholder="student-name" required>'],why:"The label for value must match the input id.",fixed:'<label for="student-name">Name</label><input id="student-name" required><button>Save</button>',focusLine:2,caseHint:"The label and input identifiers do not match.",scenario:"Accessible form"}
  };
  const key=/html/.test(moduleId)?"html":/css/.test(moduleId)?"css":/responsive/.test(moduleId)?"responsive":/events/.test(moduleId)?"events":"accessibility",pick=cases[key],shuffled=rotate(pick.choices,seed);
  return {code:pick.code,prompt:pick.prompt,choices:shuffled,solution:shuffled.indexOf(pick.choices[0]),why:pick.why,workspace:workspace("web",pick.fixed),focusLine:pick.focusLine,caseHint:pick.caseHint,interfaceScenario:pick.scenario};
}
function logicMatchingActivity(course,mission,seed,a,b){
  const moduleId=missionModule(course,mission)?.id||"";let pairs=[],prompt="",why="";
  if(/values/.test(moduleId)){pairs=[["start = "+a,"Initial state"],["start += "+b,"Increase state by "+b],["start *= 2","Double the current state"],["print(start)","Observe the final state"]];prompt="Match each state-change statement with its role in the trace.";why="Each statement either initializes, changes, or observes program state.";}
  else if(/branches/.test(moduleId)){pairs=[[a+" >= "+b,a>=b?"true":"false"],[a+" == "+b,a===b?"true":"false"],[a+" < "+(a+1),"true"],[a+" > "+(a+2),"false"]];prompt="Match each condition with the boolean result.";why="Evaluate each comparison independently.";}
  else if(/loops/.test(moduleId)){pairs=[["range(0, "+b+")",String(b)+" iterations"],["range(1, "+(b+1)+")",String(b)+" iterations"],["range(0, "+(b*2)+", 2)",String(b)+" iterations"],["break at first match","Stops the loop early"]];prompt="Match each loop pattern with its execution behavior.";why="Bounds and step sizes determine iterations, while break ends iteration early.";}
  else if(/collections/.test(moduleId)){pairs=[["values[0]","First element"],["values[1]","Second element"],["values[values.length - 1]","Last element"],["values.length","Number of elements"]];prompt="Match each indexed-data expression with what it selects.";why="Indexes select positions while length describes collection size.";}
  else{pairs=[["minimum boundary","Test exactly at the minimum"],["maximum boundary","Test exactly at the maximum"],["below minimum","Expected rejection"],["above maximum","Expected rejection"]];prompt="Match each validation case with the test behavior it represents.";why="Good checks include boundaries and values immediately outside the accepted range.";}
  const right=rotate(pairs.map((pair,id)=>({id,text:pair[1]})),seed+1).reverse();
  return {code:"",prompt,left:pairs.map(pair=>pair[0]),right:right.map(item=>item.text),solution:pairs.map((pair,id)=>right.findIndex(item=>item.id===id)),why};
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
    activity={...activity,prompt:prompt+" Enter only the exact output or requested value.",solution:String(original.choices[original.correct]),traceGuide:traceGuide(course,mission,language,mission.oop===true)};
  }
  if(meta.type==="ordering"){
    if(mission.oop===true)activity={...activity,...oopOrderingActivity(mission,seed)};
    else activity={...activity,...genericOrderingActivity(course,mission,language,seed,a,b)};
  }
  if(meta.type==="matching"){
    if(mission.oop===true)activity={...activity,...oopMatchingActivity(mission,seed)};
    else if(course.id==="logic")activity={...activity,...logicMatchingActivity(course,mission,seed,a,b)};
    else{
      const pairs=language==="web"?[["<header>","Introductory page or section content"],["<nav>","Major navigation links"],["<main>","The primary page content"],["<article>","Independent self-contained content"]]:[[a+" + "+b,String(a+b)],[a+" × "+b,String(a*b)],[a+" − "+b,String(a-b)],[a+" % "+b,String(a%b)]];
      const right=rotate(pairs.map((pair,id)=>({id,text:pair[1]})),seed+1).reverse();
      activity={...activity,code:"",prompt:language==="web"?"Match each semantic element with its purpose.":"Match each expression with its result.",left:pairs.map(pair=>pair[0]),right:right.map(item=>item.text),solution:pairs.map((pair,id)=>right.findIndex(item=>item.id===id)),why:language==="web"?"Semantic elements describe the purpose of their content.":"Apply each operator to the two operands."};
    }
  }
  if(meta.type==="debugging"){
    if(mission.oop===true)activity={...activity,...oopDebuggingActivity(mission,seed)};
    else if(language==="web")activity={...activity,...webDebuggingActivity(course,mission,seed)};
    else activity={...activity,...numericDebuggingActivity(course,mission,language,seed,a,b)};
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
function indexedVisibleAnswerMatches(question,answer){
  if(!Array.isArray(question.solution)||!Array.isArray(answer)||answer.length!==question.solution.length)return false;
  const values=question.type==="matching"?question.right:question.type==="ordering"?question.items:null;
  if(!Array.isArray(values))return JSON.stringify(answer)===JSON.stringify(question.solution);
  return answer.every((valueIndex,position)=>{
    const expectedIndex=question.solution[position];
    return Number.isInteger(valueIndex)&&Number.isInteger(expectedIndex)&&
      values[valueIndex]===values[expectedIndex];
  });
}
export function gradeSeasonAnswer(question,answer){
  if(question.type==="output")return String(answer).trim().replace(/\r\n/g,"\n")===question.solution;
  if(Array.isArray(question.solution))return indexedVisibleAnswerMatches(question,answer);
  return answer===question.solution;
}
