/** Themed views over the shared Computer Programming practice mission pool.
 * A mission may appear in more than one game view; its original mission ID remains
 * the scoring/progress identity so themed views never create duplicate rewards.
 */
export const PROGRAMMING_GAMES=[
  {id:"all",name:"All Missions",icon:"◇",tag:"BROWSE",device:"any",description:"Browse every Java, Python, Web, Logic, and OOP mission."},
  {id:"bug-detective",name:"Bug Hunt",icon:"⌁",tag:"DEBUG",device:"mobile",description:"Find broken code, choose the repair, and learn why the defect happened."},
  {id:"trace-quest",name:"Code Trace",icon:"⌨",tag:"TRACE",device:"mobile",description:"Follow changing values and predict the exact result before revealing it."},
  {id:"algorithm-maze",name:"Code Builder",icon:"⇅",tag:"BUILD",device:"mobile",description:"Arrange statements in the right order to make the program reach its goal."},
  {id:"logic-circuit",name:"Logic Match",icon:"⇄",tag:"LOGIC",device:"mobile",description:"Match expressions, rules, and outcomes to complete the circuit."},
  {id:"oop-builder",name:"OOP Builder",icon:"◇",tag:"OOP",device:"mobile",description:"Build skill with classes, objects, encapsulation, inheritance, polymorphism and abstraction."},
  {id:"code-sprint",name:"Code Sprint",icon:"◉",tag:"QUICK PLAY",device:"mobile",description:"Fast concept challenges across programming syntax, logic, and web development."},
  {id:"interface-repair",name:"Interface Repair",icon:"▤",tag:"WEB",device:"computer",description:"Repair HTML, CSS, responsive layout, DOM, and accessibility problems."},
  {id:"data-detective",name:"Data Detective",icon:"▦",tag:"DATA",device:"mobile",description:"Inspect indexed data, collections, boundaries, validation, and result checks."},
  {id:"xml-layout-rescue",name:"XML Layout Rescue",icon:"<>",tag:"ANDROID XML",device:"coding",description:"Repair Android-style XML layouts in the dedicated visual XML laboratory.",external:true}
];
export const getProgrammingGame=id=>PROGRAMMING_GAMES.find(game=>game.id===id)||PROGRAMMING_GAMES[0];
export const gameDeviceLabel=game=>game?.device==="computer"?"⌨ Computer recommended":game?.device==="coding"?"</> Coding required":game?.device==="mobile"?"☝ Mobile friendly":"◇ Any device";
export function programmingGameMatches(gameId,course,mission,meta,module){
  switch(gameId){
    case "bug-detective": return meta.type==="debugging";
    case "trace-quest": return meta.type==="output";
    case "algorithm-maze": return meta.type==="ordering";
    case "logic-circuit": return meta.type==="matching";
    case "oop-builder": return course.id==="java" && mission.oop===true;
    case "code-sprint": return meta.type==="choice";
    case "interface-repair": return course.id==="web";
    case "data-detective": return course.id==="logic" && ["logic-collections","logic-checks"].includes(module?.id);
    case "xml-layout-rescue": return false;
    default: return true;
  }
}
