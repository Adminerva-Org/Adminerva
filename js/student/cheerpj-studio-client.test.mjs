import assert from 'node:assert/strict';
import {test} from 'node:test';
import {CheerpjStudioClient,validateCheerpjRunnerUrl,validateBrowserJavaFiles} from './cheerpj-studio-client.mjs';

const site='https://adminerva-org.github.io';
const runner='https://adminerva-java-runner.example.com/embedded-runner.html';

test('accepts a dedicated HTTPS runner on a different origin',()=>{
  assert.equal(validateCheerpjRunnerUrl(runner,site)?.origin,'https://adminerva-java-runner.example.com');
});

test('rejects same-origin, HTTP, credentials, query, fragment and an incorrect entry page',()=>{
  for(const target of [
    'https://adminerva-org.github.io/Adminerva/experiments/cheerpj-console/embedded-runner.html',
    'http://runner.example.com/embedded-runner.html',
    'https://user:pass@runner.example.com/embedded-runner.html',
    'https://runner.example.com/embedded-runner.html?token=abc',
    'https://runner.example.com/embedded-runner.html#fragment',
    'https://runner.example.com/',
    'javascript:alert(1)'
  ])assert.equal(validateCheerpjRunnerUrl(target,site),null,target);
});

test('ignores messages from other windows, origins and sessions',()=>{
  globalThis.location={origin:site};
  globalThis.window={addEventListener(){},removeEventListener(){}};
  const messages=[];
  const client=new CheerpjStudioClient({runnerUrl:runner,onEvent:m=>messages.push(m)});
  const child={postMessage(){}};
  client.frame={contentWindow:child,remove(){}};
  client.session='abc';
  client.state='running';
  const response={channel:'adminerva-cheerpj-studio-v1',session:'abc',type:'output',text:'hello'};
  client.receive({source:{},origin:'https://adminerva-java-runner.example.com',data:response});
  client.receive({source:child,origin:'https://attacker.example.com',data:response});
  client.receive({source:child,origin:'https://adminerva-java-runner.example.com',data:{...response,session:'wrong'}});
  assert.equal(messages.length,0);
  client.receive({source:child,origin:'https://adminerva-java-runner.example.com',data:response});
  assert.deepEqual(messages,[{type:'output',text:'hello'}]);
  client.dispose();
});

test('sends a separate live input line only while Java is running',()=>{
  globalThis.location={origin:site};
  globalThis.window={addEventListener(){},removeEventListener(){}};
  const sent=[];
  const client=new CheerpjStudioClient({runnerUrl:runner});
  client.frame={contentWindow:{postMessage(message,target){sent.push({message,target})}},remove(){}};
  client.session='test-session';
  client.state='loading';
  assert.equal(client.sendLine('Ada'),false);
  client.state='running';
  assert.equal(client.sendLine('Ada'),true);
  assert.equal(sent.length,1);
  assert.deepEqual(sent[0],{message:{
    channel:'adminerva-cheerpj-studio-v1',session:'test-session',type:'input',text:'Ada'
  },target:'https://adminerva-java-runner.example.com'});
  client.dispose();
});


test('rejects traversal, oversized Java source and missing entry without starting a session',()=>{
  assert.deepEqual(validateBrowserJavaFiles({'Main.java':'class Main {}'},'Main.java'),{'Main.java':'class Main {}'});
  assert.throws(()=>validateBrowserJavaFiles({'../Main.java':'class Main {}'},'../Main.java'),/safe \.java/);
  assert.throws(()=>validateBrowserJavaFiles({'Main.java':'x'.repeat(250001)},'Main.java'),/250 KB/);
  assert.throws(()=>validateBrowserJavaFiles({'Hello.java':'class Hello {}'},'Main.java'),/valid Java entry/);
});

test('heartbeats keep a waiting Java process alive; finish disposes the frame',()=>{
  globalThis.location={origin:site};
  globalThis.window={addEventListener(){},removeEventListener(){}};
  const events=[];
  let removed=false;
  const client=new CheerpjStudioClient({runnerUrl:runner,onEvent:m=>events.push(m)});
  const child={postMessage(){}};
  client.frame={contentWindow:child,remove(){removed=true;}};
  client.session='abc';
  client.state='running';
  const env=(type,extra={})=>({source:child,origin:'https://adminerva-java-runner.example.com',
    data:{channel:'adminerva-cheerpj-studio-v1',session:'abc',type,...extra}});
  client.receive(env('heartbeat'));
  assert.ok(client.lastActivity>0);
  assert.equal(events.length,0);
  client.receive(env('finished',{code:0,compileFailed:false}));
  assert.equal(removed,true);
  assert.equal(client.session,null);
  assert.deepEqual(events,[{type:'finished',code:0,compileFailed:false}]);
});
