/** Free-play programming simulations with bounded interpreters and explicit win conditions. */
import {moveItem,enableArcadeDrag} from "./arcade-interactions.mjs?v=1.0.0";
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;};
const button=(text,action,cls="arcade-button")=>{const b=el("button",text,cls);b.type="button";b.addEventListener("click",action);return b;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const slow=()=>globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches?25:190;
export const expansionModes=[
  {id:"control",icon:"↻",title:"Robot Control Lab",desc:"Build compact robot programs with loops and conditional blocks.",skill:"Loops • conditions"},
  {id:"circuit",icon:"⎍",title:"Logic Lab",desc:"Wire gates and test your circuit against every input combination.",skill:"Boolean logic • truth tables"},
  {id:"objects",icon:"⬡",title:"Object Workshop",desc:"Create objects, share references and protect private state with methods.",skill:"Objects • encapsulation"}
];
const controlLevels=[
  {n:5,start:[0,4],goal:[4,0],walls:[[1,4],[1,3],[3,2],[3,1]],chips:[[2,2]],budget:4,needs:"repeat",goalText:"Collect the chip and reach the portal in at most four blocks. Use a repeat block."},
  {n:6,start:[0,5],goal:[5,0],walls:[[1,5],[1,4],[1,3],[1,2],[1,1]],chips:[[0,1],[3,0]],budget:3,needs:"while",goalText:"Reach the portal with both chips in at most three blocks. Use while clear to cross the corridor."},
  {n:5,start:[0,4],goal:[4,2],walls:[[1,4],[1,3],[2,4],[2,3]],chips:[[1,2],[3,2]],budget:4,needs:"if",goalText:"Reach the portal with both chips in at most four blocks. Demonstrate an if-clear instruction that skips and one that moves."}
];
const dirs={up:[0,-1],right:[1,0],down:[0,1],left:[-1,0]},arrows={up:"↑",right:"→",down:"↓",left:"←"};
const coord=(x,y)=>x+","+y;
function controlGame(root,i,ctx){
  const l=controlLevels[i],walls=new Set(l.walls.map(p=>coord(...p))),chips=new Set(l.chips.map(p=>coord(...p))),program=[];
  let position=l.start.slice(),collected=new Set(),running=false,done=false;
  const board=el("div",null,"arcade-maze"),list=el("ol",null,"arcade-block-list"),palette=el("div",null,"arcade-controls"),params=el("div",null,"arcade-controls"),status=el("p",null,"arcade-inline"),meter=el("strong");
  board.style.setProperty("--n",l.n);board.setAttribute("role","img");status.setAttribute("role","status");
  let kind="repeat",count=2;
  const kinds=["move","repeat","while","if"],kindLabels={move:"Move",repeat:"Repeat × N",while:"While clear",if:"If clear"};
  const selectors=kinds.map(k=>button(kindLabels[k],()=>{kind=k;render();}));
  const minus=button("−",()=>{count=Math.max(2,count-1);render();}),quantity=el("strong"),plus=button("+",()=>{count=Math.min(5,count+1);render();});
  params.append(...selectors,minus,quantity,plus);
  const moves=Object.keys(dirs).map(d=>button(arrows[d]+" "+d,()=>{if(!running&&!done&&program.length<l.budget){program.push({kind,dir:d,count});render();}}));
  palette.append(...moves);
  const controls=el("div",null,"arcade-controls");
  const run=button("▶ Run blocks",execute,"arcade-button primary"),clear=button("Clear program",()=>{program.length=0;position=l.start.slice();collected.clear();render();});
  controls.append(run,clear);root.append(el("p",l.goalText),board,el("small","Gold diamonds = chips · blue circle = portal · striped cells = walls. Drag blocks to reorder on desktop, or use ↑/↓ on touch or keyboard."),params,palette,meter,list,controls,status);
  enableArcadeDrag(list,{isLocked:()=>running||done||!ctx.active(),onDrop:(from,to)=>{
    if(moveItem(program,from,to)){status.textContent="Block moved to position "+(to+1)+".";render();}
  }});
  function render(){
    board.replaceChildren();for(let y=0;y<l.n;y++)for(let x=0;x<l.n;x++){
      const k=coord(x,y),robot=coord(...position)===k,goal=coord(...l.goal)===k,chip=chips.has(k)&&!collected.has(k),wall=walls.has(k);
      board.append(el("span",robot?"🤖":wall?"":goal?"◎":chip?"◆":"","arcade-cell"+(wall?" wall":goal?" goal":chip?" chip":"")+(robot?" robot":"")));
    }
    board.setAttribute("aria-label","Robot column "+(position[0]+1)+", row "+(position[1]+1)+". "+collected.size+" of "+chips.size+" chips.");
    meter.textContent=program.length+" / "+l.budget+" program blocks";
    quantity.textContent="× "+count;minus.disabled=running||done||kind!=="repeat"||count<=2;plus.disabled=running||done||kind!=="repeat"||count>=5;
    selectors.forEach((b,j)=>{b.setAttribute("aria-pressed",String(kinds[j]===kind));b.disabled=running||done;});
    moves.forEach(b=>b.disabled=running||done||program.length>=l.budget);
    list.replaceChildren(...program.map((block,j)=>{
      const li=el("li",null,"arcade-program-block "+block.kind);li.dataset.arcadeItem=String(j);li.draggable=!running&&!done;
      const label=block.kind==="move"?"move "+block.dir:block.kind==="repeat"?"repeat "+block.count+" { move "+block.dir+" }":(block.kind==="while"?"while":"if")+" (clear "+block.dir+") { move "+block.dir+" }";
      const actions=el("div",null,"arcade-block-actions");
      for(const [caption,to] of [["↑",j-1],["↓",j+1]]){
        const b=button(caption,()=>{if(!running&&!done&&moveItem(program,j,to)){render();list.querySelector('[data-arcade-item="'+to+'"] button')?.focus();}},"arcade-step-control");
        b.disabled=running||done||to<0||to>=program.length;b.setAttribute("aria-label","Move block "+(j+1)+(to<j?" earlier":" later"));actions.append(b);
      }
      const remove=button("Remove",()=>{if(!running&&!done){program.splice(j,1);render();}},"arcade-step-control");remove.disabled=running||done;actions.append(remove);li.append(el("code",label),actions);return li;
    }));
    if(!program.length)list.append(el("li","Choose a block type and direction to write your program."));
    run.disabled=running||done||!program.length;clear.disabled=running||done;
  }
  const can=d=>{const [dx,dy]=dirs[d],x=position[0]+dx,y=position[1]+dy;return x>=0&&y>=0&&x<l.n&&y<l.n&&!walls.has(coord(x,y));};
  async function move(d){if(!ctx.active()||!can(d))return false;const [dx,dy]=dirs[d];position=[position[0]+dx,position[1]+dy];if(chips.has(coord(...position)))collected.add(coord(...position));render();await sleep(slow());return ctx.active();}
  async function execute(){
    if(running||done)return;running=true;position=l.start.slice();collected.clear();render();let ifTrue=0,ifFalse=0,repeatUsed=false,whileUsed=false,failed=false;
    for(const block of program){
      if(!ctx.active())return;status.textContent="Executing "+block.kind+" "+block.dir+"…";
      if(block.kind==="if"){if(can(block.dir)){ifTrue++;await move(block.dir);}else{ifFalse++;status.textContent="Condition false: block skipped.";await sleep(slow());}}
      else if(block.kind==="while"){let steps=0;while(can(block.dir)&&steps<l.n&&ctx.active()){steps++;await move(block.dir);}if(steps)whileUsed=true;}
      else{const times=block.kind==="repeat"?block.count:1;if(block.kind==="repeat")repeatUsed=true;for(let step=0;step<times;step++){if(!ctx.active())return;if(!await move(block.dir)){failed=true;break;}}}
      if(failed)break;
    }
    if(!ctx.active())return;running=false;const requirement=l.needs==="repeat"?repeatUsed:l.needs==="while"?whileUsed:ifTrue>0&&ifFalse>0;
    if(!failed&&coord(...position)===coord(...l.goal)&&collected.size===chips.size&&requirement){done=true;status.textContent="Program complete.";render();ctx.win("All objectives met using "+program.length+" blocks.");}
    else{status.textContent=failed?"Collision: revise your program.":!requirement?"Required control-flow behavior not demonstrated.": "Portal or chips still missing. Revise and run again.";render();}
  }
  render();
}
const boolOps={AND:(a,b)=>a&&b,OR:(a,b)=>a||b,XOR:(a,b)=>a!==b,NOT:a=>!a};
const circuitLevels=[
  {goal:"Light the output only when A and B are both ON.",names:["G1"],expected:(a,b)=>a&&b},
  {goal:"Light the output when A and B differ.",names:["G1"],expected:(a,b)=>a!==b},
  {goal:"Light the output when A and B are not both ON. Use both gates in your circuit.",names:["G1","G2"],expected:(a,b)=>!(a&&b)}
];
function logicGame(root,i,ctx){
  const l=circuitLevels[i],gates=l.names.map((name,index)=>({name,type:index?"NOT":"AND",inputs:[null,null]}));
  let output=null,selected=null,a=false,b=false,done=false;
  const sources=el("div",null,"arcade-circuit-inputs"),board=el("div",null,"arcade-gates"),led=el("div",null,"arcade-led"),status=el("p",null,"arcade-inline"),table=el("div",null,"arcade-truth"),controls=el("div",null,"arcade-controls");status.setAttribute("role","status");
  const inputA=button("A: OFF",()=>{a=!a;render();}),inputB=button("B: OFF",()=>{b=!b;render();});
  sources.append(inputA,inputB);const sockets=el("div",null,"arcade-wire-tray");
  root.append(el("p",l.goal+" Select a signal, then a gate input socket or the output socket. Toggle A and B to experiment."),sources,sockets,board,led,controls,status,table);
  const signalName=s=>s===null?"—":s;
  function evaluate(aa,bb){
    const memo={A:aa,B:bb};
    for(const gate of gates){
      const needed=gate.type==="NOT"?1:2,ins=gate.inputs.slice(0,needed).map(s=>s==null?undefined:memo[s]);
      memo[gate.name]=ins.some(v=>v===undefined)?undefined:boolOps[gate.type](...ins);
    }
    return {value:output==null?undefined:memo[output],values:memo};
  }
  const allowed=(source,index)=>source==="A"||source==="B"||gates.slice(0,index).some(g=>g.name===source);
  function connect(index,socket){if(done||selected===null||!allowed(selected,index))return;gates[index].inputs[socket]=selected;selected=null;render();}
  function select(s){if(done)return;selected=selected===s?null:s;render();}
  function usedGates(){const used=new Set();let todo=[output];while(todo.length){const name=todo.pop(),g=gates.find(g=>g.name===name);if(g&&!used.has(name)){used.add(name);todo.push(...g.inputs.slice(0,g.type==="NOT"?1:2));}}return used;}
  controls.append(button("Test all inputs",()=>{
    if(done)return;const rows=[[false,false],[false,true],[true,false],[true,true]].map(([aa,bb])=>({aa,bb,actual:evaluate(aa,bb).value,expected:l.expected(aa,bb)}));
    table.replaceChildren(el("strong","Truth table"),...rows.map(row=>el("div","A "+Number(row.aa)+" · B "+Number(row.bb)+" → "+(row.actual===undefined?"?":Number(row.actual))+" (target "+Number(row.expected)+") "+(row.actual===row.expected?"✓":"×"),row.actual===row.expected?"pass":"fail")));
    if(rows.every(row=>row.actual===row.expected)&&usedGates().size===gates.length){done=true;status.textContent="All test cases passed.";render();ctx.win("Circuit verified across all four input combinations.");}else status.textContent="Circuit not complete. Check connections and use every gate.";
  },"arcade-button primary"));
  function render(){
    const actual=evaluate(a,b);inputA.textContent="A: "+(a?"ON":"OFF");inputB.textContent="B: "+(b?"ON":"OFF");inputA.setAttribute("aria-pressed",String(a));inputB.setAttribute("aria-pressed",String(b));
    sockets.replaceChildren(...["A","B",...l.names].map(name=>{const v=actual.values[name],b=button(name+" · "+(v===undefined?"?":Number(v)),()=>select(name),"arcade-button signal");b.setAttribute("aria-pressed",String(selected===name));b.disabled=done;return b;}));
    board.replaceChildren(...gates.map((gate,index)=>{const card=el("section",null,"arcade-gate"),title=el("strong",gate.name+" · "+gate.type),types=el("div",null,"arcade-controls"),inputs=el("div",null,"arcade-gate-sockets");
      for(const op of Object.keys(boolOps)){const b=button(op,()=>{gate.type=op;if(op==="NOT")gate.inputs[1]=null;render();});b.disabled=done;b.setAttribute("aria-pressed",String(gate.type===op));types.append(b);}
      for(let j=0;j<(gate.type==="NOT"?1:2);j++){const b=button("IN "+(j+1)+" ← "+signalName(gate.inputs[j]),()=>connect(index,j),"arcade-button socket");b.disabled=done||!selected||!allowed(selected,index);const clear=button("×",()=>{gate.inputs[j]=null;render();});clear.disabled=done||gate.inputs[j]===null;clear.setAttribute("aria-label","Disconnect "+gate.name+" input "+(j+1));inputs.append(b,clear);}
      card.append(title,types,inputs,el("span","OUT → "+(actual.values[gate.name]===undefined?"?":Number(actual.values[gate.name])),"arcade-gate-out"));return card;}));
    led.replaceChildren(el("span",actual.value===undefined?"?":actual.value?"●":"○","arcade-light"+(actual.value?" on":"")),button("OUTPUT ← "+signalName(output),()=>{if(selected&&!done){output=selected;selected=null;render();}}));
    led.lastChild.disabled=done||selected===null;
  }
  render();
}
const objectLevels=[
  {goal:"Create two independent Counter objects. A must have value 2 and B value 1.",check:(r,h)=>!!r.A&&!!r.B&&r.A!==r.B&&h[r.A]===2&&h[r.B]===1},
  {goal:"Create a Counter through A, alias B to A, and increment twice through B. Both references must show 2 and share one object.",check:(r,h,stats)=>!!r.A&&r.A===r.B&&h[r.A]===2&&stats.bAdds===2&&stats.created===1},
  {goal:"Create A, alias B to A, set A to 5, attempt to set B to −3 (which must be rejected), then decrement through B. Both must show 4.",check:(r,h,stats)=>!!r.A&&r.A===r.B&&h[r.A]===4&&stats.validSet&&stats.rejected&&stats.bDecAfterReject}
];
function objectsGame(root,i,ctx){
  const l=objectLevels[i],refs={A:null,B:null},heap={},stats={bAdds:0,created:0,validSet:false,rejected:false,bDecAfterReject:false};let done=false;
  const diagram=el("div",null,"arcade-heap"),controls=el("div",null,"arcade-object-actions"),log=el("ol",null,"arcade-object-log"),status=el("p",null,"arcade-inline");status.setAttribute("role","status");
  root.append(el("p",l.goal),diagram,controls,status,el("strong","Operation log"),log);
  function record(text){log.prepend(el("li",text));while(log.children.length>12)log.lastChild.remove();}
  function create(r){if(stats.created>=6){record("Object limit reached. Restart to try another approach.");return;}const id="Counter#"+(++stats.created);heap[id]=0;refs[r]=id;record(r+" = new Counter() → "+id);render();}
  function alias(to,from){if(!refs[from]){record("Reference "+from+" is null.");return;}refs[to]=refs[from];record(to+" = "+from);render();}
  function update(r,op,value){const id=refs[r];if(!id){record("Cannot invoke method through null "+r+".");return;}
    if(op==="set"&&value<0){if(i===2&&r==="B"&&stats.validSet&&refs.A===refs.B&&heap[id]===5)stats.rejected=true;record(r+".setValue("+value+"): rejected; state unchanged.");}
    else if(op==="set"){heap[id]=value;if(r==="A"&&value===5){stats.validSet=true;stats.rejected=false;stats.bDecAfterReject=false;}record(r+".setValue("+value+")");}
    else if(op==="add"){heap[id]++;if(r==="B")stats.bAdds++;record(r+".increment()");}
    else if(op==="dec"){if(heap[id]>0){heap[id]--;if(r==="B"&&stats.rejected)stats.bDecAfterReject=true;record(r+".decrement()");}else record("Decrement rejected at zero.");}
    render();
  }
  for(const r of ["A","B"]){const row=el("div",null,"arcade-rule");row.append(el("strong",r),button("new Counter",()=>create(r)),button("alias "+(r==="A"?"B":"A"),()=>alias(r,r==="A"?"B":"A")),button("+1",()=>update(r,"add")),button("−1",()=>update(r,"dec")));if(i===2)row.append(button("set 5",()=>update(r,"set",5)),button("set −3",()=>update(r,"set",-3)));controls.append(row);}
  controls.append(button("Check object state",()=>{if(l.check(refs,heap,stats)){done=true;render();ctx.win("Reference and state requirements satisfied.");}else status.textContent="Objective not met. Inspect reference arrows, object values and operation history.";},"arcade-button primary"));
  function render(){
    const refsPanel=el("div",null,"arcade-reference-list"),heapPanel=el("div",null,"arcade-memory-list");
    for(const r of ["A","B"]){const ref=el("div",null,"arcade-ref");ref.append(el("strong",r),el("span"," → "+(refs[r]||"null")));refsPanel.append(ref);}
    for(const [id,value] of Object.entries(heap)){const card=el("div",null,"arcade-object"+(Object.values(refs).includes(id)?"":" orphan"));card.append(el("strong",id),el("small","private int value"),el("span",String(value)));heapPanel.append(card);}
    if(!Object.keys(heap).length)heapPanel.append(el("small","Heap is empty. Create an object."));
    diagram.replaceChildren(refsPanel,heapPanel);status.textContent="References: "+Object.values(refs).filter(Boolean).length+" · Objects allocated: "+stats.created;
    if(done)for(const b of controls.querySelectorAll("button"))b.disabled=true;
  }
  render();
}
export const expansionRenderers={control:controlGame,circuit:logicGame,objects:objectsGame};
