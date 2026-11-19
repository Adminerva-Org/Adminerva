/** Independent practice simulations. No authoritative XP or course credit is issued here. */
import {expansionModes,expansionRenderers} from "./practice-arcade-expansion.mjs?v=1.0.0";
import {moveItem,swapItems,enableArcadeDrag} from "./arcade-interactions.mjs?v=1.0.0";
const make=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;};
const btn=(text,action,cls="arcade-button")=>{const e=make("button",text,cls);e.type="button";e.addEventListener("click",action);return e;};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const motion=()=>globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
const modes=[
  {id:"maze",icon:"▦",title:"Robot Maze",desc:"Program a robot, collect chips and reach the portal.",skill:"Algorithms • sequencing"},
  {id:"trace",icon:"⌁",title:"Trace Machine",desc:"Predict each register update and unlock the next instruction.",skill:"Variables • execution"},
  {id:"data",icon:"▤",title:"Array Workshop",desc:"Swap indexed values until the array satisfies its rule.",skill:"Arrays • sorting"},
  {id:"oop",icon:"◇",title:"Object Architect",desc:"Create a connected object-oriented class diagram.",skill:"Classes • relationships"},
  {id:"web",icon:"▣",title:"Layout Rescue",desc:"Repair a live responsive interface using layout controls.",skill:"CSS • responsive design"},
  ...expansionModes
];
const mazes=[
  {n:5,start:[0,4],goal:[4,0],walls:[[1,4],[1,3],[3,2],[3,1]],chips:[[2,2]],budget:10},
  {n:6,start:[0,5],goal:[5,0],walls:[[1,5],[1,4],[1,3],[3,3],[3,2],[4,2],[4,1]],chips:[[2,4],[2,1]],budget:14},
  {n:6,start:[0,5],goal:[5,0],walls:[[0,4],[2,5],[2,4],[2,3],[4,3],[4,2],[4,1]],chips:[[1,2],[3,4]],budget:18}
];
const traces=[
  {initial:{x:3,y:2},code:[["x += y","x",5],["y *= 3","y",6],["x -= 2","x",3],["x += y","x",9]]},
  {initial:{total:0,i:1},code:[["total += i","total",1],["i++","i",2],["total += i","total",3],["i++","i",3],["total *= i","total",9]]},
  {initial:{a:8,b:3,tmp:0},code:[["tmp = a % b","tmp",2],["a = b * 2","a",6],["b += tmp","b",5],["tmp = a - b","tmp",1],["a += tmp","a",7]]}
];
const arrays=[
  {values:[4,1,5,2,3],rule:"Ascending order: smallest → largest",accept:a=>a.every((n,i)=>!i||a[i-1]<=n)},
  {values:[2,8,3,7,1,6],rule:"Descending order: largest → smallest",accept:a=>a.every((n,i)=>!i||a[i-1]>=n)},
  {values:[5,2,7,4,3,6],rule:"Partition: even values before odd values (order within each group is free)",accept:a=>a.every((n,i)=>!i||a[i-1]%2<=n%2)}
];
const graphs=[
  {nodes:["Animal","Dog","Cat"],goal:"Dog and Cat inherit from Animal. Draw each arrow from its child to its parent.",edges:[["Dog","extends","Animal"],["Cat","extends","Animal"]]},
  {nodes:["Printable","Report","Printer"],goal:"Report implements Printable. Printer has a Report as a component.",edges:[["Report","implements","Printable"],["Printer","has-a","Report"]]},
  {nodes:["Vehicle","Car","Engine","ElectricCar"],goal:"Car extends Vehicle, owns an Engine, and ElectricCar extends Car.",edges:[["Car","extends","Vehicle"],["Car","has-a","Engine"],["ElectricCar","extends","Car"]]}
];
const layouts=[
  {goal:"Use a row of cards that wraps on narrow screens with a 12px gap.",start:{direction:"row",wrap:"nowrap",gap:0,align:"start"},target:{direction:"row",wrap:"wrap",gap:12}},
  {goal:"Stack cards vertically, center them, and use a 20px gap.",start:{direction:"row",wrap:"nowrap",gap:4,align:"start"},target:{direction:"column",align:"center",gap:20}},
  {goal:"On a narrow screen, keep a row that wraps, centers its cards and has a 20px gap.",start:{direction:"column",wrap:"nowrap",gap:0,align:"start"},target:{direction:"row",wrap:"wrap",align:"center",gap:20}}
];
const key=(x,y)=>x+","+y;
const vector={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]};
const arrow={up:"↑",down:"↓",left:"←",right:"→"};
function mazeGame(root,level,ctx){
  const l=mazes[level],queue=[],wall=new Set(l.walls.map(p=>key(...p))),chips=new Set(l.chips.map(p=>key(...p)));
  let pos=l.start.slice(),collected=new Set(),running=false;
  const board=make("div",null,"arcade-maze"),commands=make("div",null,"arcade-command-list"),controls=make("div",null,"arcade-controls"),counter=make("strong"),status=make("p",null,"arcade-inline");
  board.style.setProperty("--n",l.n);board.setAttribute("role","img");
  root.append(make("p","Collect every chip, avoid walls and reach the blue portal within "+l.budget+" commands. Drag commands on desktop or use Move earlier/later on touch and keyboard."),board,counter,commands,controls,status);
  enableArcadeDrag(commands,{isLocked:()=>running||!ctx.active(),onDrop:(from,to)=>{
    if(moveItem(queue,from,to)){status.textContent="Command moved to step "+(to+1)+".";render();}
  }});
  const render=()=>{
    board.replaceChildren();
    for(let y=0;y<l.n;y++)for(let x=0;x<l.n;x++){
      const k=key(x,y),isRobot=pos[0]===x&&pos[1]===y,isGoal=x===l.goal[0]&&y===l.goal[1],isChip=chips.has(k)&&!collected.has(k);
      const c=make("span",isRobot?"🤖":wall.has(k)?"":isGoal?"◎":isChip?"◆":"","arcade-cell"+(wall.has(k)?" wall":isGoal?" goal":isChip?" chip":"")+(isRobot?" robot":""));board.append(c);
    }
    board.setAttribute("aria-label","Robot at column "+(pos[0]+1)+", row "+(pos[1]+1)+". "+collected.size+" of "+chips.size+" chips collected.");
    counter.textContent=queue.length+" / "+l.budget+" commands";
    commands.replaceChildren(...queue.map((d,i)=>{
      const tile=make("div",null,"arcade-command-tile");tile.dataset.arcadeItem=String(i);tile.draggable=!running;
      tile.append(make("strong",arrow[d]+" "+(i+1),"arcade-command-symbol"));
      const actions=make("div",null,"arcade-command-actions");
      for(const [caption,to] of [["←",i-1],["→",i+1]]){
        const b=btn(caption,()=>{if(!running&&moveItem(queue,i,to)){render();commands.querySelector('[data-arcade-item="'+to+'"] button')?.focus();}},"arcade-step-control");
        b.disabled=running||to<0||to>=queue.length;b.setAttribute("aria-label","Move "+d+" command "+(i+1)+(to<i?" earlier":" later"));actions.append(b);
      }
      const remove=btn("×",()=>{if(!running){queue.splice(i,1);render();}},"arcade-step-control");
      remove.disabled=running;remove.setAttribute("aria-label","Remove "+d+" command "+(i+1));actions.append(remove);tile.append(actions);return tile;
    }));
    if(!queue.length)commands.append(make("small","Build your command sequence here."));
    for(const b of controls.querySelectorAll("button"))b.disabled=running||(b.dataset.move==="true"&&queue.length>=l.budget);
    run.disabled=running||!queue.length;undo.disabled=running||!queue.length;
  };
  for(const d of ["up","left","down","right"]){const b=btn(arrow[d]+" "+d,()=>{if(!running&&queue.length<l.budget){queue.push(d);render();}});b.dataset.move="true";controls.append(b);}
  const undo=btn("Undo",()=>{queue.pop();render();}),run=btn("▶ Run program",async()=>{
    if(running||!queue.length)return;running=true;pos=l.start.slice();collected=new Set();status.textContent="Running…";render();
    for(const d of queue){
      if(!ctx.active())return;
      const v=vector[d],nx=pos[0]+v[0],ny=pos[1]+v[1];
      if(nx<0||ny<0||nx>=l.n||ny>=l.n||wall.has(key(nx,ny))){status.textContent="Collision — edit your program and run again.";running=false;render();return;}
      pos=[nx,ny];if(chips.has(key(...pos)))collected.add(key(...pos));render();await delay(motion()?40:220);
    }
    if(!ctx.active())return;running=false;render();
    if(key(...pos)===key(...l.goal)&&collected.size===chips.size){status.textContent="Portal reached. All chips collected.";ctx.win("Route complete!");}
    else status.textContent="Program finished. "+collected.size+" / "+chips.size+" chips collected. Adjust the route.";
  },"arcade-button primary");
  controls.append(undo,run);render();
}
function traceGame(root,level,ctx){
  const l=traces[level],state={...l.initial};let step=0,guess=0,misses=0,done=false;
  const regs=make("div",null,"arcade-registers"),program=make("ol",null,"arcade-instructions"),panel=make("div",null,"arcade-controls"),status=make("p",null,"arcade-inline"),prediction=make("strong"),direct=make("input",null,"arcade-number-entry");
  direct.type="number";direct.step="1";direct.inputMode="numeric";direct.setAttribute("aria-label","Predicted register value");
  root.append(make("p","Update the highlighted register to the value it will contain after the next instruction. The machine only advances when your prediction is correct."),regs,program,panel,status);
  const adjust=delta=>{if(done)return;guess+=delta;render();};
  const inputLabel=make("label","Predicted value","arcade-number-label");inputLabel.append(direct);
  const commit=btn("Commit step",()=>{
    if(done)return;
    if(!direct.value.trim()||!Number.isSafeInteger(Number(direct.value))){status.textContent="Enter a whole number.";direct.focus();return;}
    guess=Number(direct.value);const [instruction,name,value]=l.code[step];
    if(guess!==value){misses++;status.textContent="Register mismatch. Recheck "+instruction+" using the current values.";return;}
    state[name]=guess;step++;status.textContent="Instruction committed.";
    if(step===l.code.length){done=true;render();ctx.win("Program executed: "+l.code.length+" instructions, "+misses+" retries.");return;}
    guess=state[l.code[step][1]];render();
  },"arcade-button primary");
  direct.addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();commit.click();}});
  panel.append(btn("−5",()=>adjust(-5)),btn("−1",()=>adjust(-1)),prediction,inputLabel,btn("+1",()=>adjust(1)),btn("+5",()=>adjust(5)),commit);
  function render(){
    const current=l.code[step]?.[1];
    regs.replaceChildren(...Object.entries(state).map(([name,value])=>{const r=make("div",null,"arcade-register"+(current===name?" active":""));r.append(make("small",name),make("strong",String(value)));return r;}));
    program.replaceChildren(...l.code.map(([instruction],i)=>make("li",instruction+(i<step?"  ✓":""),i===step?"active":i<step?"finished":"")));
    prediction.textContent=done?"Complete":current+" = ?";direct.disabled=done;direct.value=String(guess);
    for(const b of panel.querySelectorAll("button"))b.disabled=done;
  }
  guess=state[l.code[0][1]];render();
}
function dataGame(root,level,ctx){
  const l=arrays[level],a=l.values.slice();let selected=null,moves=0,done=false;const history=[];
  const cells=make("div",null,"arcade-array"),status=make("p",null,"arcade-inline"),controls=make("div",null,"arcade-controls");
  root.append(make("p",l.rule+". Drag bars to swap on desktop, or tap two indexed cells on touch. Check the array when ready."),cells,status,controls);
  const swap=(from,to)=>{if(done||!swapItems(a,from,to))return;history.push([from,to]);moves++;selected=null;render();};
  enableArcadeDrag(cells,{allowButtons:true,isLocked:()=>done||!ctx.active(),onDrop:swap});
  function render(){
    cells.replaceChildren(...a.map((value,i)=>{const b=btn(null,()=>{
      if(done)return;if(selected===null){selected=i;render();}else if(selected===i){selected=null;render();}else swap(selected,i);
    },"arcade-array-cell"+(selected===i?" active":""));b.append(make("small","["+i+"]"),make("span",null,"arcade-array-bar"),make("strong",String(value)));b.style.setProperty("--height",(value*11)+"%");b.setAttribute("aria-label","Index "+i+", value "+value+". Select or drag to swap.");b.setAttribute("aria-pressed",String(selected===i));b.disabled=done;b.draggable=!done;b.dataset.arcadeItem=String(i);return b;}));
    status.textContent=moves+" swaps · "+(selected===null?"Select or drag a cell.":"Selected index "+selected+". Choose another cell to swap.");undo.disabled=done||!history.length;
  }
  const undo=btn("Undo last swap",()=>{if(done||!history.length)return;const [from,to]=history.pop();swapItems(a,from,to);moves=Math.max(0,moves-1);selected=null;render();});
  controls.append(undo,btn("Check arrangement",()=>{if(done)return;if(l.accept(a)){done=true;render();ctx.win("Array satisfies the rule in "+moves+" swaps.");}else status.textContent="Not sorted yet. Inspect the order and swap again.";},"arcade-button primary"));render();
}
function oopGame(root,level,ctx){
  const l=graphs[level],edges=[];let from=null,kind="extends",done=false;
  const map=make("div",null,"arcade-graph"),links=make("div",null,"arcade-edge-list"),controls=make("div",null,"arcade-controls"),status=make("p",null,"arcade-inline");
  root.append(make("p",l.goal),controls,map,links,status);
  const types=["extends","implements","has-a"];const typeButtons=types.map(type=>btn(type,()=>{if(!done){kind=type;render();}}));controls.append(...typeButtons,btn("Check diagram",()=>{
    if(done)return;const encode=e=>JSON.stringify(e),expected=new Set(l.edges.map(encode));
    if(edges.length===expected.size&&edges.every(e=>expected.has(encode(e)))){done=true;render();ctx.win("All class relationships connected.");}
    else status.textContent="Diagram mismatch. Inspect the direction and relationship type of each arrow.";
  },"arcade-button primary"));
  const points=l.nodes.length===3?[[50,20],[23,78],[77,78]]:[[23,22],[77,22],[23,78],[77,78]];
  function render(){
    const ns="http://www.w3.org/2000/svg",svg=document.createElementNS(ns,"svg");svg.setAttribute("viewBox","0 0 100 100");svg.setAttribute("preserveAspectRatio","none");svg.setAttribute("aria-hidden","true");svg.classList.add("arcade-graph-lines");
    for(const [a,k,b] of edges){
      const [x1,y1]=points[l.nodes.indexOf(a)],[x2,y2]=points[l.nodes.indexOf(b)],line=document.createElementNS(ns,"line");
      for(const [attr,v] of Object.entries({x1,y1,x2,y2,stroke:k==="extends"?"#7dd3fc":k==="implements"?"#c4b5fd":"#6ee7b7","stroke-width":1.5,"stroke-dasharray":k==="implements"?"3 2":"none"}))line.setAttribute(attr,v);
      svg.append(line);
      const dx=x2-x1,dy=y2-y1,len=Math.hypot(dx,dy),ux=dx/len,uy=dy/len,mx=x1+dx*.70,my=y1+dy*.70,arrow=document.createElementNS(ns,"path");arrow.setAttribute("d","M "+(mx-ux*5-uy*3)+" "+(my-uy*5+ux*3)+" L "+mx+" "+my+" L "+(mx-ux*5+uy*3)+" "+(my-uy*5-ux*3));arrow.setAttribute("fill","none");arrow.setAttribute("stroke",line.getAttribute("stroke"));arrow.setAttribute("stroke-width","1.5");svg.append(arrow);
    }
    map.replaceChildren(svg);
    l.nodes.forEach((name,i)=>{const b=btn(name,()=>{
      if(done)return;if(from===null){from=name;}else if(from===name){from=null;}else{if(!edges.some(e=>e[0]===from&&e[1]===kind&&e[2]===name))edges.push([from,kind,name]);from=null;}render();
    },"arcade-graph-node"+(from===name?" active":""));b.style.left=points[i][0]+"%";b.style.top=points[i][1]+"%";b.setAttribute("aria-pressed",String(from===name));b.disabled=done;map.append(b);});
    links.replaceChildren(...edges.map((edge,i)=>{const row=make("div",null,"arcade-edge");row.append(make("span",edge[0]+" — "+edge[1]+" → "+edge[2]),btn("Remove",()=>{if(!done){edges.splice(i,1);render();}}));return row;}));
    if(!edges.length)links.append(make("small","No relationships yet."));
    typeButtons.forEach((b,i)=>{b.setAttribute("aria-pressed",String(kind===types[i]));b.disabled=done;});
    status.textContent=from?"Selected "+from+". Select the destination class.":"Choose a relationship, then select its source and destination.";
  }
  render();
}
function webGame(root,level,ctx){
  const l=layouts[level],rules={...l.start};let narrow=true,done=false;
  const toolbar=make("div",null,"arcade-controls"),preview=make("div",null,"arcade-web-preview"),viewport=make("div",null,"arcade-web-viewport"),cards=make("div",null,"arcade-web-cards"),code=make("pre",null,"arcade-css"),status=make("p",null,"arcade-inline");
  for(const [i,label] of ["Profile","Tasks","Messages"].entries()){const card=make("article",null,"arcade-web-card");card.append(make("span",["●","▤","✦"][i]),make("strong",label),make("i"),make("i"));cards.append(card);}
  viewport.append(cards);preview.append(viewport);root.append(make("p",l.goal),toolbar,preview,code,status);
  const groups=[["direction",["row","column"]],["wrap",["nowrap","wrap"]],["gap",[0,4,12,20]],["align",["start","center"]]];
  const controls=groups.map(([prop,values])=>{const wrap=make("div",null,"arcade-rule"),label=make("strong",prop),buttons=values.map(v=>btn(String(v)+(prop==="gap"?"px":""),()=>{if(!done){rules[prop]=v;render();}}));wrap.append(label,...buttons);root.append(wrap);return {prop,values,buttons};});
  toolbar.append(btn("Narrow",()=>{narrow=true;render();}),btn("Wide",()=>{narrow=false;render();}),btn("Test layout",()=>{
    if(done)return;if(Object.entries(l.target).every(([p,v])=>rules[p]===v)){done=true;render();ctx.win("Layout requirements satisfied.");}else status.textContent="Layout still fails one or more requirements. Inspect the live preview and CSS.";
  },"arcade-button primary"));
  function render(){
    viewport.style.maxWidth=narrow?"270px":"620px";cards.style.flexDirection=rules.direction;cards.style.flexWrap=rules.wrap;cards.style.gap=rules.gap+"px";cards.style.justifyContent=rules.align==="center"?"center":"flex-start";cards.style.alignItems=rules.align==="center"?"center":"flex-start";
    code.textContent=".cards {\n  display: flex;\n  flex-direction: "+rules.direction+";\n  flex-wrap: "+rules.wrap+";\n  gap: "+rules.gap+"px;\n  justify-content: "+(rules.align==="center"?"center":"flex-start")+";\n  align-items: "+(rules.align==="center"?"center":"flex-start")+";\n}";
    for(const group of controls)group.buttons.forEach((b,i)=>{b.setAttribute("aria-pressed",String(rules[group.prop]===group.values[i]));b.disabled=done;});
    status.textContent=(narrow?"Narrow":"Wide")+" preview · "+(cards.scrollWidth>cards.clientWidth+1?"horizontal overflow":"no horizontal overflow");
  }
  render();
}
const renderers={maze:mazeGame,trace:traceGame,data:dataGame,oop:oopGame,web:webGame,...expansionRenderers};
export function mountPracticeArcade(host,initialOwner=null){
  if(!host||host.dataset.mounted)return;host.dataset.mounted="true";
  let storageOwner=null;
  const cleared=new Map(),catalog=make("div",null,"arcade-catalog"),stage=make("section",null,"arcade-stage");
  stage.hidden=true;let generation=0;
  const heading=make("div",null,"arcade-heading");heading.append(make("h2","Interactive Arcade"),make("span","FREE PLAY · NO SEASON XP","arcade-label"));
  host.append(heading,make("p","Play hands-on simulations. These levels are separate from scored missions and teacher assignments. Clears are saved on this browser for your account."),catalog,stage);
  function saveClears(){if(!storageOwner)return;try{localStorage.setItem("Adminerva_Arcade_Clear_v1_"+storageOwner,JSON.stringify(Object.fromEntries([...cleared].map(([id,levels])=>[id,[...levels]]))));}catch{}}
  function setOwner(uid){const next=typeof uid==="string"&&uid?uid:null;if(next===storageOwner)return;storageOwner=next;generation++;stage.hidden=true;stage.replaceChildren();catalog.hidden=false;cleared.clear();if(next)try{const saved=JSON.parse(localStorage.getItem("Adminerva_Arcade_Clear_v1_"+next)||"{}");for(const mode of modes){const levels=saved?.[mode.id];if(Array.isArray(levels))cleared.set(mode.id,new Set(levels.filter(x=>Number.isInteger(x)&&x>=0&&x<3)));}}catch{}renderCatalog();}
  function renderCatalog(){
    catalog.replaceChildren(...modes.map(mode=>{const card=btn(null,()=>open(mode,[0,1,2].find(i=>!cleared.get(mode.id)?.has(i))??0),"arcade-mode");card.append(make("span",mode.icon,"arcade-mode-icon"),make("strong",mode.title),make("small",mode.desc),make("span",mode.skill+" · "+(cleared.get(mode.id)?.size||0)+"/3 cleared","arcade-mode-progress"));return card;}));
  }
  function open(mode,level){
    const token=++generation;stage.hidden=false;stage.replaceChildren();catalog.hidden=true;
    let won=false;const bar=make("div",null,"arcade-stage-bar"),title=make("h3",mode.title+" · Level "+(level+1)),body=make("div",null,"arcade-body"),result=make("div",null,"arcade-result");result.hidden=true;result.setAttribute("role","status");
    const back=btn("← Arcade",()=>{generation++;stage.hidden=true;stage.replaceChildren();catalog.hidden=false;renderCatalog();catalog.querySelector("button")?.focus();}),reset=btn("Restart level",()=>open(mode,level));
    bar.append(back,title,reset);const levels=make("div",null,"arcade-levels");
    for(let i=0;i<3;i++){const b=btn("Level "+(i+1)+(cleared.get(mode.id)?.has(i)?" ✓":""),()=>open(mode,i));b.setAttribute("aria-pressed",String(level===i));levels.append(b);}
    stage.append(bar,levels,body,result);renderers[mode.id](body,level,{active:()=>generation===token&&stage.isConnected,win:message=>{
      if(generation!==token||won)return;won=true;if(!cleared.has(mode.id))cleared.set(mode.id,new Set());cleared.get(mode.id).add(level);saveClears();
      result.hidden=false;levels.children[level].textContent="Level "+(level+1)+" ✓";result.append(make("strong","LEVEL COMPLETE"),make("p",message),btn(level<2?"Next level →":"Back to arcade",()=>{if(level<2)open(mode,level+1);else back.click();},"arcade-button primary"));
      result.scrollIntoView({block:"nearest",behavior:motion()?"auto":"smooth"});
    }});
    stage.scrollIntoView({block:"start",behavior:motion()?"auto":"smooth"});title.tabIndex=-1;title.focus({preventScroll:true});
  }
  renderCatalog();setOwner(initialOwner);return {setOwner};
}
