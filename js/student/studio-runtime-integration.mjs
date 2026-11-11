import {ADMINERVA_RUNTIME_ORIGIN} from './runtime-config.mjs?v=1';
import {AdminervaRuntimeClient} from './studio-runtime-client.mjs?v=2';
import {analyzeJavaWorkspace,clearJavaDiagnostics} from './studio-diagnostics.mjs?v=1';

/** Adds local Java problems and, once deployed, the optional server-backed queue. */
export function installStudioRuntime({monaco,editor,auth,guest,getLanguage,getFiles,getEntry,save,switchFile}){
  const enabled=Boolean(ADMINERVA_RUNTIME_ORIGIN)&&!guest;
  let session=null,locked=false,diagnostics=null,timer=null,generation=0;
  const el=id=>document.getElementById(id);
  const display=el('studioProblemsList');
  const banner=el('studioQueueBanner');
  const status=el('studioQueueStatus');
  const position=el('studioQueuePosition');
  const output=el('consoleOutput');
  const input=el('stdinLineInput');
  const sendButton=el('sendStdinBtn');
  const btn=el('studioProblemsToggle');
  const panel=el('studioProblemsPanel');

  function lock(value){
    locked=Boolean(value);
    editor.updateOptions({readOnly:locked,readOnlyMessage:{value:'Project is queued or running. Cancel or stop to edit.'}});
    const restricted=['formatBtn','importZipBtn','resetBtn','loadProjectBtn','cloudLoadProjectBtn',
      'undoRestoreBtn','legacyImportBtn','projectSettingsBtn','languageSelect','runBtn'];
    for(const id of restricted){const control=el(id);if(control)control.disabled=locked;}
    for(const control of document.querySelectorAll('#explorerContextMenu [data-explorer-action]'))
      control.disabled=locked&&control.dataset.explorerAction!=='open';
    for(const control of document.querySelectorAll('[data-studio-editor-key="undo"],[data-studio-editor-key="redo"],[data-studio-editor-key="tab"]'))
      control.disabled=locked;
    el('editorPane')?.setAttribute('data-review-locked',String(locked));
  }

  // Keep file opens, Find, scrolling, selection, and zoom. Block mutations even
  // when a shortcut or context-menu handler bypasses a disabled toolbar button.
  for(const name of ['renameFile','promptNewFile','deleteFile','newFolder','renameSelection','deleteSelection']){
    const original=window[name];
    if(typeof original==='function')window[name]=function(...args){
      if(locked)return;
      return original.apply(this,args);
    };
  }
  for(const type of ['dragstart','drop']){
    for(const id of ['projectTree','fileTabsContainer'])el(id)?.addEventListener(type,event=>{
      if(locked){event.preventDefault();event.stopImmediatePropagation();}
    },true);
  }
  el('explorerContextMenu')?.addEventListener('click',event=>{
    if(!locked)return;
    if(event.target.closest('[data-explorer-action]:not([data-explorer-action="open"])')){
      event.preventDefault();event.stopImmediatePropagation();
    }
  },true);
  el('fileTabsContainer')?.addEventListener('click',event=>{
    if(!locked)return;
    if(event.target.closest('.tab-element > button')||event.target.closest('#fileTabsContainer > button')){
      event.preventDefault();event.stopImmediatePropagation();
    }
  },true);

  function renderProblems(result){
    diagnostics=result;
    if(!display||!btn)return;
    btn.textContent=result.available?result.errors+' errors · '+result.warnings+' warnings':'Problems';
    btn.dataset.hasErrors=String(result.errors>0);
    const summary=el('studioProblemsSummary');
    if(summary)summary.textContent=result.available?
      'Java problems · '+result.errors+' errors, '+result.warnings+' warnings':'Java syntax checker unavailable';
    display.replaceChildren();
    if(result.message||!result.issues.length){
      const paragraph=document.createElement('p');
      paragraph.textContent=result.message||(result.available?
        'No preliminary syntax problems detected. Compilation is still required.':'No problems reported.');
      display.append(paragraph);
    }
    for(const issue of result.issues){
      const button=document.createElement('button');button.type='button';
      const icon=document.createElement('span');
      icon.textContent=issue.severity==='error'?'●':'▲';
      icon.className=issue.severity==='error'?'studio-problem-error':'studio-problem-warning';
      const message=document.createElement('span');
      message.textContent=(issue.filename||'Project')+(issue.line?':'+issue.line:'')+' — '+issue.message;
      button.append(icon,message);
      button.addEventListener('click',()=>{
        if(!issue.filename)return;
        switchFile(issue.filename);
        const p={lineNumber:Math.max(1,issue.line),column:Math.max(1,issue.column)};
        editor.setPosition(p);editor.revealPositionInCenter(p);editor.focus();
      });
      display.append(button);
    }
  }
  function scheduleDiagnostics(){
    clearTimeout(timer);
    const thisRun=++generation;
    timer=setTimeout(async()=>{
      if(thisRun!==generation)return;
      const files=getFiles(true);
      if(getLanguage()!=='java'){
        clearJavaDiagnostics(files,monaco);
        renderProblems({available:false,errors:0,warnings:0,issues:[],message:'Java syntax checks appear in Java projects.'});
        return;
      }
      try{
        const result=await analyzeJavaWorkspace({files,entry:getEntry(),monaco});
        if(thisRun===generation)renderProblems(result);
      }catch(error){
        if(thisRun===generation)renderProblems({available:false,errors:0,warnings:0,issues:[],message:'Syntax check unavailable: '+error.message});
      }
    },450);
  }
  btn?.addEventListener('click',()=>{
    const open=panel?.classList.contains('hidden');
    panel?.classList.toggle('hidden',!open);
    btn.setAttribute('aria-expanded',String(Boolean(open)));
    requestAnimationFrame(()=>editor.layout());
  });
  el('studioProblemsClose')?.addEventListener('click',()=>{
    panel?.classList.add('hidden');btn?.setAttribute('aria-expanded','false');
    requestAnimationFrame(()=>editor.layout());
  });
  editor.onDidChangeModelContent(scheduleDiagnostics);
  scheduleDiagnostics();

  function finish(state){
    session?.dispose();session=null;lock(false);
    if(el('studioCancelQueueBtn'))el('studioCancelQueueBtn').disabled=false;
    banner?.classList.add('hidden');
    el('stdinHistoryDisclosure')?.classList.remove('hidden');
    if(input)input.disabled=false;
    if(sendButton)sendButton.disabled=false;
    const badge=el('studioTerminalStatus');
    if(badge){badge.textContent=state==='finished'?'Finished':state==='cancelled'?'Cancelled':'Error';badge.dataset.state=state;}
    scheduleDiagnostics();
  }
  function runtimeEvent(message){
    if(message.type==='status'){
      if(['finished','failed','expired','cancelled'].includes(message.state)){
        finish(message.state);return;
      }
      banner?.classList.remove('hidden');
      if(banner)banner.dataset.state=message.state;
      if(status)status.textContent=message.state==='queued'?'Queued — review mode':'Java running — editor locked';
      if(position)position.textContent=message.state==='queued'?
        'Position '+(message.position||'?')+' · '+(message.activeCount??'?')+'/'+(message.activeLimit??8)+' active slots':
        'Interactive terminal ready. Type a response and press Enter.';
      const running=message.state==='running';
      if(input)input.disabled=!running;
      if(sendButton)sendButton.disabled=!running;
      const badge=el('studioTerminalStatus');
      if(badge){badge.textContent=running?'Java live':'Queue #'+(message.position||'?');badge.dataset.state=running?'running':'waiting';}
      return;
    }
    if(message.type==='stdout'||message.type==='stderr'){
      if(output){
        output.textContent=(output.textContent+(message.data||'')).slice(-150000);
        output.scrollTop=output.scrollHeight;
      }
      return;
    }
    if(message.type==='exit'){
      if(output)output.textContent+='\n[Java exited'+(message.code===null?'':' with status '+message.code)+']\n';
      finish(message.state);
    }
    if(message.type==='connection'&&position)
      position.textContent='Connection interrupted. Reconnecting to your existing queue/session…';
  }
  async function join(){
    if(session||locked)return;
    try{
      const files=getFiles(false),entry=getEntry();
      if(!entry||!files[entry])throw Error('Choose a valid Java entry file.');
      save();
      if(output)output.textContent='Submitting a frozen Java project snapshot…\n';
      lock(true);
      banner?.classList.remove('hidden');
      if(status)status.textContent='Submitting project…';
      if(position)position.textContent='Connecting to the runtime queue.';
      if(input)input.disabled=true;
      if(sendButton)sendButton.disabled=true;
      const cancelButton=el('studioCancelQueueBtn');
      if(cancelButton)cancelButton.disabled=true;
      el('stdinHistoryDisclosure')?.classList.add('hidden');
      const client=new AdminervaRuntimeClient({
        origin:ADMINERVA_RUNTIME_ORIGIN,
        getToken:async()=>auth.currentUser?.getIdToken(),onEvent:runtimeEvent
      });
      session=client;
      await client.enqueue({files,entry});
      if(el('studioCancelQueueBtn'))el('studioCancelQueueBtn').disabled=false;
    }catch(error){
      if(output)output.textContent+='\nCannot join queue: '+error.message;
      finish('failed');
    }
  }
  function readiness(){
    const dialog=el('studioRunReadinessDialog');
    if(!dialog){void join();return;}
    const text=el('studioReadinessStatus'),list=el('studioReadinessProblems');
    const files=getFiles(false);
    if(text)text.textContent='Java files: '+Object.keys(files).filter(k=>k.endsWith('.java')).length+
      '. The submitted snapshot cannot change while queued.';
    if(list){
      list.replaceChildren();
      const summary=document.createElement('p');
      summary.textContent=!diagnostics?.available?
        'Browser syntax checks are unavailable. javac has not checked this project.':
        (diagnostics.errors+' potential syntax errors · '+diagnostics.warnings+
        ' warnings. Full compilation may reveal additional issues.');
      list.append(summary);
      for(const issue of (diagnostics?.issues||[]).slice(0,8)){
        const p=document.createElement('p');p.textContent=(issue.filename||'Project')+' — '+issue.message;list.append(p);
      }
    }
    dialog.showModal();
  }
  function dismiss(){const dialog=el('studioRunReadinessDialog');if(dialog?.open)dialog.close();}
  if(enabled){
    el('studioReadinessJoin')?.addEventListener('click',()=>{dismiss();void join();});
    el('studioReadinessClose')?.addEventListener('click',dismiss);
    el('studioReadinessCancel')?.addEventListener('click',dismiss);
    el('studioCancelQueueBtn')?.addEventListener('click',async()=>{
      if(!session)return;
      const cancel=el('studioCancelQueueBtn');if(cancel)cancel.disabled=true;
      try{await session.cancel();finish('cancelled');}
      catch(error){if(position)position.textContent='Cancellation not confirmed: '+error.message;}
      finally{if(cancel)cancel.disabled=false;}
    });
    window.addEventListener('beforeunload',event=>{
      if(!session?.id)return;event.preventDefault();event.returnValue='';
    });
  }
  return {
    enabled,
    hasSession:()=>Boolean(session),
    locked:()=>locked,
    scheduleDiagnostics,
    requestRun:()=>{if(!session)readiness();},
    sendLine:()=>{
      if(!session||!input)return false;
      const text=input.value;
      if(!session.sendInput(text+'\n'))return false;
      if(output){output.textContent=(output.textContent+text+'\n').slice(-150000);output.scrollTop=output.scrollHeight;}
      input.value='';
      return true;
    }
  };
}
