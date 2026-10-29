/** Interactive public demo. All evidence/practice records are illustrative, never saved. */
const home = document.querySelector('main[data-home-experience="public"]');
if(home){
  const insertion = home.querySelector('section[aria-labelledby="try-tools-title"]');
  if(insertion){
    const showcase = document.createElement('section');
    showcase.className = 'av-home-showcase';
    showcase.setAttribute('aria-labelledby','av-showcase-title');
    showcase.innerHTML = `
      <div class="av-showcase-header">
        <div><span class="av-experience-eyebrow">Try Adminerva in action</span>
          <h2 id="av-showcase-title">Explore. Experiment. See the result.</h2>
          <p>Try three small interactive examples before you sign in. This is a safe demonstration, not a school assignment.</p></div>
        <span class="av-showcase-sample">INTERACTIVE DEMO · NO ACCOUNT</span>
      </div>
      <div class="av-showcase-tabs" role="tablist" aria-label="Interactive product demonstrations">
        <button type="button" id="av-demo-tab-code" role="tab" aria-controls="av-demo-code" aria-selected="true" tabindex="0">01 / Code</button>
        <button type="button" id="av-demo-tab-practice" role="tab" aria-controls="av-demo-practice" aria-selected="false" tabindex="-1">02 / Practice</button>
        <button type="button" id="av-demo-tab-evidence" role="tab" aria-controls="av-demo-evidence" aria-selected="false" tabindex="-1">03 / Feedback</button>
      </div>
      <section class="av-showcase-panel" id="av-demo-code" role="tabpanel" aria-labelledby="av-demo-tab-code">
        <h3>Make a change. Preview it instantly.</h3>
        <p>Edit the sample HTML and CSS, then select Run preview. Scripts and network requests are disabled inside this demonstration.</p>
        <div class="av-showcase-code">
          <label for="av-demo-editor">Editable HTML / CSS
            <textarea spellcheck="false" id="av-demo-editor" aria-describedby="av-demo-code-hint"></textarea>
          </label>
          <div><p class="font-bold text-sm mb-2">Preview</p><iframe title="Sandboxed HTML preview" id="av-demo-preview" sandbox="" referrerpolicy="no-referrer"></iframe></div>
        </div>
        <div class="av-showcase-actions"><button type="button" id="av-demo-run">Run preview</button><button type="button" class="av-showcase-secondary" id="av-demo-reset">Reset sample</button><span id="av-demo-code-hint" role="status">Tip: Ctrl + Enter also runs the preview.</span></div>
      </section>
      <section class="av-showcase-panel av-showcase-practice" id="av-demo-practice" role="tabpanel" aria-labelledby="av-demo-tab-practice" hidden>
        <h3>Predict what the code will output.</h3>
        <p>Choose the correct result. Practice missions in your workspace save verified progress after sign-in.</p>
        <pre aria-label="Java practice example">int points = 4;
points += 3;
System.out.println(points);</pre>
        <div class="av-showcase-choices" role="group" aria-label="Choose the output">
          <button type="button" data-guess="6" aria-pressed="false">6</button>
          <button type="button" data-guess="7" aria-pressed="false">7</button>
          <button type="button" data-guess="8" aria-pressed="false">8</button>
        </div>
        <p class="av-showcase-response" id="av-demo-practice-result" role="status" aria-live="polite">Choose an output to see why it is correct or incorrect.</p>
      </section>
      <section class="av-showcase-panel av-showcase-review" id="av-demo-evidence" role="tabpanel" aria-labelledby="av-demo-tab-evidence" hidden>
        <h3>Follow feedback through its stages.</h3>
        <p>This sample illustrates how a teacher can review evidence. No student submission or grade is affected.</p>
        <div class="av-showcase-sample-card">
          <span>Illustrative workflow · Example submission</span>
          <strong>Project contribution: Borrow form interface</strong>
          <p>Evidence: layout changes and field validation notes. Rubric decisions are made by your teacher in the real assessment workspace.</p>
          <span data-demo-status>Submitted</span>
        </div>
        <div class="av-showcase-actions">
          <button type="button" data-demo-review="inspect">Inspect evidence</button>
          <button type="button" class="av-showcase-secondary" data-demo-review="revision">Request revision</button>
          <button type="button" class="av-showcase-secondary" data-demo-review="feedback">Ready for feedback</button>
          <button type="button" class="av-showcase-secondary" data-demo-review="reset">Reset</button>
        </div>
        <p class="av-showcase-response" role="status" id="av-demo-evidence-status" aria-live="polite">Select an action to see how feedback changes the next step.</p>
      </section>`;
    insertion.before(showcase);
    const tabs=[...showcase.querySelectorAll('[role="tab"]')];
    const activate=index=>{
      tabs.forEach((tab,i)=>{
        const selected=i===index;
        tab.setAttribute('aria-selected',String(selected));
        tab.tabIndex=selected?0:-1;
        showcase.querySelector('#'+tab.getAttribute('aria-controls')).hidden=!selected;
      });
    };
    tabs.forEach((tab,i)=>{
      tab.addEventListener('click',()=>activate(i));
      tab.addEventListener('keydown',event=>{
        if(!['ArrowRight','ArrowLeft','Home','End'].includes(event.key))return;
        event.preventDefault();
        const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:
          (i+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
        activate(next);tabs[next].focus();
      });
    });
    const sample=`<style>
body{font-family:system-ui;margin:0;padding:22px;background:#eafafb;color:#14354f}
.card{background:white;border-radius:20px;padding:22px;box-shadow:0 12px 28px #1a62752a}
.tag{color:#058e89;font-size:11px;letter-spacing:2px;font-weight:800}
h1{font-size:26px;line-height:1.15}
button{background:#126d82;color:white;border:0;padding:12px 16px;border-radius:9px}
</style>
<div class="card"><p class="tag">HELLO, ADMINERVA</p><h1>Build something new.</h1><p>Your ideas start here.</p><button>Explore ideas</button></div>`;
    const editor=showcase.querySelector('#av-demo-editor');
    const frame=showcase.querySelector('#av-demo-preview');
    const status=showcase.querySelector('#av-demo-code-hint');
    const run=()=>{
      const csp=`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">`;
      frame.srcdoc='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+csp+'</head><body>'+editor.value+'</body></html>';
      status.textContent='Preview updated. Changes remain in this browser tab only.';
    };
    editor.value=sample;run();
    showcase.querySelector('#av-demo-run').addEventListener('click',run);
    showcase.querySelector('#av-demo-reset').addEventListener('click',()=>{editor.value=sample;run();});
    editor.addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();run();}});
    for(const button of showcase.querySelectorAll('[data-guess]')){
      button.addEventListener('click',()=>{
        showcase.querySelectorAll('[data-guess]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
        showcase.querySelector('#av-demo-practice-result').textContent=
          button.dataset.guess==='7'?'Correct. The variable starts at 4, then increases by 3 to become 7.':
            'Not quite. The += operator adds 3 to the original value of 4. Try again.';
      });
    }
    const feedback={
      inspect:['Under review','A reviewer examines the selected changes against the criteria before making a decision.'],
      revision:['Revision requested','The learner can improve the work and resubmit evidence for another review.'],
      feedback:['Ready for feedback','The teacher can proceed to grading and publication in the actual assessment tools.'],
      reset:['Submitted','The sample is back to its initial state.']
    };
    showcase.querySelectorAll('[data-demo-review]').forEach(button=>button.addEventListener('click',()=>{
      const [label,description]=feedback[button.dataset.demoReview];
      showcase.querySelector('[data-demo-status]').textContent=label;
      showcase.querySelector('#av-demo-evidence-status').textContent=description;
    }));
  }
}
