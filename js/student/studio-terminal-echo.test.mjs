import assert from 'node:assert/strict';
import {test} from 'node:test';
import {terminalHistoryLines,echoBatchInputs,echoLiveInput} from './studio-terminal-echo.mjs';

test('count blank and nonblank lines in a Judge0 input history',()=>{
  assert.deepEqual(terminalHistoryLines('jusep\n12\n'),['jusep','12']);
  assert.deepEqual(terminalHistoryLines('jusep\r\n\r\n12\r\n'),['jusep','','12']);
  assert.deepEqual(terminalHistoryLines(''),[]);
});

test('echo a pasted batch beside recognizable consecutive prompts',()=>{
  assert.equal(
    echoBatchInputs('Enter your name: Enter your age: Hello, jusep!\n',['jusep','12']),
    'Enter your name: jusep\nEnter your age: 12\nHello, jusep!\n'
  );
});

test('echo batch inputs beside println prompts without an extra blank line',()=>{
  assert.equal(
    echoBatchInputs('Enter your name:\nEnter your age:\nFinished\n',['jusep','12']),
    'Enter your name: jusep\nEnter your age: 12\nFinished\n'
  );
});

test('preserve exact prompt offsets from prior waiting runs',()=>{
  const stdout='What is your name? How old are you? Welcome!';
  const first='What is your name? ';
  const second='What is your name? How old are you? ';
  assert.equal(echoBatchInputs(stdout,['Jusep','12'],[
    {index:0,before:first},{index:1,before:second}
  ]),'What is your name? Jusep\nHow old are you? 12\nWelcome!');
});

test('do not rewrite already echoed input',()=>{
  const raw='Enter name: Jusep\n';
  assert.equal(echoBatchInputs(raw,['Jusep']),raw);
});

test('fallback input transcript remains visible when a program has no prompt',()=>{
  assert.equal(echoBatchInputs('Done.\n',['3']),'Done.\n\n[Other supplied inputs]\n› 3');
});

test('never display sensitive password or token contents in an echoed prompt',()=>{
  assert.equal(echoBatchInputs('Enter password: Accepted\n',['secret']),'Enter password: [hidden]\nAccepted\n');
});

test('place CheerpJ live input on the waiting prompt line',()=>{
  assert.equal(echoLiveInput('Enter your name: ','Jusep'),'Enter your name: Jusep\n');
  assert.equal(echoLiveInput('Enter your age:\n','12'),'Enter your age: 12\n');
});

test('fallback to a conventional transcript entry if live Java has no prompt',()=>{
  assert.equal(echoLiveInput('Working...\n','next'),'Working...\n› next\n');
});

test('show an intentionally blank response without deleting the prompt',()=>{
  assert.equal(echoBatchInputs('Enter name: Next\n',['']),'Enter name: \nNext\n');
});
