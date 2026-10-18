import test from 'node:test';
import assert from 'node:assert/strict';
import {lessonStarterDeck,lessonSourceChanged} from './lesson-to-slides.mjs';
const plan={id:'saved',version:3,subject_title:'Programming',weekly_overview:{topic:'XML'},sessions:[{session_name:'Session 1',objectives:'Understand layouts',learning_activities:'<script>unsafe()</script>',evaluation:'Explain one constraint',remarks:'Private teacher note'}]};
test('lesson starter uses the chosen saved session and excludes private remarks',()=>{
  const result=lessonStarterDeck(plan,0);assert.equal(result.source.lessonVersion,3);assert.equal(result.deck.length,4);
  const text=JSON.stringify(result.deck);assert.match(text,/&lt;script&gt;/);assert.doesNotMatch(text,/<script>|Private teacher note/);
  assert.throws(()=>lessonStarterDeck(plan,4),/Choose a saved/);
});
test('long lesson text is preserved across starter slides rather than silently dropped',()=>{
  const result=lessonStarterDeck({...plan,sessions:[{learning_activities:'a'.repeat(1801)}]},0);
  assert.equal(result.deck.length,4);assert.equal(result.deck.slice(1).map(slide=>slide.content.replace(/<[^>]+>/g,'').replace('Learning activities','')).join('').length,1801);
  assert.throws(()=>lessonStarterDeck({...plan,sessions:[{learning_activities:'a'.repeat(10801)}]},0),/exceeds/);
});
test('lesson updates are identified without changing the saved deck',()=>{
  assert.equal(lessonSourceChanged({source_lesson_version:2},plan),true);assert.equal(lessonSourceChanged({source_lesson_version:3},plan),false);
});
