/**
 * Presentation-only console input echo.
 *
 * Judge0 stdin is supplied as a batch and therefore is not echoed by its
 * stdout stream. For step-by-step replays, the *previous* stdout snapshot
 * marks the exact point where Scanner/input blocked. If students paste a
 * full batch before running, use recognizable prompt text as a best-effort
 * display hint; never modify the source, stdin payload, grading or runtime.
 */
const PROMPT_RE=/\b(?:enter|type|input|choose|select|guess|name|age|number|option|choice|password|username|first|second|your|what|how|please)\b[^\r\n:?!]{0,85}[:?][ \t]*/gi;
const SENSITIVE_RE=/(?:password|passcode|pin|secret|api[\s-]?key|access[\s-]?token)\s*[:?]?\s*$/i;
const MAX_VISIBLE_INPUT=2000;

export function terminalHistoryLines(history) {
  const text=String(history??'').replace(/\r\n?/g,'\n');
  if (!text) return [];
  const values=text.split('\n');
  if(text.endsWith('\n'))values.pop();
  return values;
}

function visibleInput(value, prompt) {
  if(SENSITIVE_RE.test(String(prompt).slice(-90)))return '[hidden]';
  const text=String(value??'').replace(/[\r\n]/g,' ');
  return text.length>MAX_VISIBLE_INPUT?text.slice(0,MAX_VISIBLE_INPUT)+'…':text;
}

function inputPlacement(stdout, offset, value) {
  let at=Math.max(0,Math.min(offset,stdout.length));
  // println prompts already end with a newline: place echo *before* it.
  let newlineAlready=false;
  if(at>0&&stdout[at-1]==='\n'){
    at--;
    if(at>0&&stdout[at-1]==='\r')at--;
    newlineAlready=true;
  }
  const left=stdout.slice(0,at);
  const lastLine=left.slice(left.lastIndexOf('\n')+1);
  const trimmed=lastLine.trimEnd();
  const input=visibleInput(value,lastLine);
  const separator=/[ \t]$/.test(lastLine)?'':/[:?>]$/.test(trimmed)?' ':'› ';
  // Preserve Java's original output exactly, inserting a visible input line
  // only into the terminal *display*. The actual program receives raw stdin.
  const suffix=stdout.slice(at);
  const alreadyEchoed=input&&suffix.trimStart().startsWith(input)&&
    (!suffix.trimStart()[input.length]||/\s/.test(suffix.trimStart()[input.length]));
  if(alreadyEchoed)return null;
  const needsNewline=!newlineAlready&&!suffix.startsWith('\n')&&!suffix.startsWith('\r\n');
  return {at,text:separator+input+(needsNewline?'\n':'')};
}

function promptsIn(stdout) {
  return [...stdout.matchAll(PROMPT_RE)].map(match=>match.index+match[0].length);
}

/** Re-render a Judge0 batch result with inputs where possible. */
export function echoBatchInputs(stdout, inputs, anchors=[]) {
  const raw=String(stdout??'');
  const values=Array.isArray(inputs)?inputs.map(value=>String(value??'')):[];
  if(!values.length)return raw;
  const positions=new Array(values.length).fill(null);
  const explicit=[];
  for(const anchor of anchors){
    if(!anchor||!Number.isInteger(anchor.index)||anchor.index<0||
       anchor.index>=values.length||typeof anchor.before!=='string'||
       !anchor.before||!raw.startsWith(anchor.before))continue;
    const position=anchor.before.length;
    positions[anchor.index]=position;
    explicit.push(position);
  }
  // A manually filled batch has no blocking snapshots. Use ordinary
  // human-readable console prompts, without changing command semantics.
  const hints=promptsIn(raw);
  let last=-1;
  for(let i=0;i<values.length;i++){
    if(positions[i]!==null){last=positions[i];continue;}
    const later=positions.slice(i+1).find(p=>p!==null);
    const match=hints.find(p=>p>last && (later===undefined||p<later) &&
      !explicit.some(e=>Math.abs(e-p)<=3));
    if(match!==undefined){positions[i]=match;last=match;}
  }
  const edits=[];
  const trailing=[];
  for(let i=0;i<values.length;i++){
    const pos=positions[i];
    if(pos===null){trailing.push(values[i]);continue;}
    const insertion=inputPlacement(raw,pos,values[i]);
    if(insertion)edits.push({...insertion,index:i});
  }
  // Apply backwards so byte offsets remain tied to raw Judge0 stdout.
  let displayed=raw;
  for(const edit of edits.sort((a,b)=>b.at-a.at||b.index-a.index)){
    displayed=displayed.slice(0,edit.at)+edit.text+displayed.slice(edit.at);
  }
  if(trailing.length){
    displayed+=(displayed.endsWith('\n')?'':'\n')+
      '\n[Other supplied inputs]\n'+trailing.map(value=>'› '+visibleInput(value,'')).join('\n');
  }
  return displayed;
}

/** Display a single line immediately next to a live CheerpJ prompt. */
export function echoLiveInput(stdout, value) {
  const raw=String(stdout??'');
  const lastLine=raw.trimEnd().split(/\r?\n/).at(-1)||'';
  // Non-prompting applications get a conventional terminal input line.
  const hasPrompt=/[:?>]\s*$/.test(lastLine);
  if(!hasPrompt)return raw+(raw.endsWith('\n')?'':'\n')+
    '› '+visibleInput(value,'')+'\n';
  const trailingNewline=/\r?\n$/.test(raw);
  const pos=trailingNewline?raw.replace(/\r?\n$/,'').length:raw.length;
  const edit=inputPlacement(raw,pos,value);
  if(!edit)return raw;
  return raw.slice(0,edit.at)+edit.text+raw.slice(edit.at);
}
