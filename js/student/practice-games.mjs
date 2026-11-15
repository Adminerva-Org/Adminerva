/** Themed views over the shared Computer Programming practice mission pool.
 * A mission may appear in more than one game view; its original mission ID remains
 * the scoring/progress identity so themed views never create duplicate rewards.
 */
export const PROGRAMMING_GAMES=[
  {id:"all",name:"Mission Map",icon:"◇",tag:"ALL PROGRAMMING",description:"Browse every Java, Python, Web, and Logic mission in one place."},
  {id:"bug-detective",name:"Bug Detective",icon:"⌁",tag:"DEBUG",description:"Find broken code, choose the repair, and learn why the defect happened."},
  {id:"trace-quest",name:"Trace Quest",icon:"⌨",tag:"TRACE",description:"Follow changing values and predict the exact result before revealing it."},
  {id:"algorithm-maze",name:"Algorithm Maze",icon:"⇅",tag:"BUILD",description:"Arrange statements in the right order to make the program reach its goal."},
  {id:"logic-circuit",name:"Logic Circuit",icon:"⇄",tag:"LOGIC",description:"Match expressions, rules, and outcomes to complete the circuit."},
  {id:"code-sprint",name:"Code Sprint",icon:"◉",tag:"QUICK PLAY",description:"Fast concept challenges across programming syntax, logic, and web development."},
  {id:"interface-repair",name:"Interface Repair",icon:"▤",tag:"WEB",description:"Repair HTML, CSS, responsive layout, DOM, and accessibility problems."},
  {id:"data-detective",name:"Data Detective",icon:"▦",tag:"DATA",description:"Inspect indexed data, collections, boundaries, validation, and result checks."},
  {id:"xml-layout-rescue",name:"XML Layout Rescue",icon:"<>",tag:"ANDROID XML",description:"Repair Android-style XML layouts in the dedicated visual XML laboratory.",external:true}
];
export const getProgrammingGame=id=>PROGRAMMING_GAMES.find(game=>game.id===id)||PROGRAMMING_GAMES[0];
export function programmingGameMatches(gameId,course,mission,meta,module){
  switch(gameId){
    case "bug-detective": return meta.type==="debugging";
    case "trace-quest": return meta.type==="output";
    case "algorithm-maze": return meta.type==="ordering";
    case "logic-circuit": return meta.type==="matching";
    case "code-sprint": return meta.type==="choice";
    case "interface-repair": return course.id==="web";
    case "data-detective": return course.id==="logic" && ["logic-collections","logic-checks"].includes(module?.id);
    case "xml-layout-rescue": return false;
    default: return true;
  }
}
