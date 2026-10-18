import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseWeightedRubric,relevantAssessmentFile,parseSuggestedRubric,
  buildRubricPrompt,loadPinnedV2Source
} from './v2-grading-assistant.mjs';

const A='a'.repeat(40),B='b'.repeat(40);
const XML='app/src/main/res/layout/activity_main.xml';
const assignment={
  title:'Q3 Mini PETA 1 — Mobile App UI Prototype',
  maxScore:20,targetPaths:['**/res/layout/*.xml'],expectedExtensions:['xml'],
  taskContext:'Three UI screens, no backend required.',
  evalCriteria:`**1. UI Completeness — 5 Points**
**2. XML & Technical Implementation — 5 Points**
**3. Design & Usability — 5 Points**
**4. Project Compliance — 5 Points**`
};

test('real Mini PETA rubric parses into four equally weighted criteria',()=>{
  assert.deepEqual(parseWeightedRubric(assignment.evalCriteria,20),[
    {name:'UI Completeness',maxScore:5},
    {name:'XML & Technical Implementation',maxScore:5},
    {name:'Design & Usability',maxScore:5},
    {name:'Project Compliance',maxScore:5},
  ]);
});

test('rubric scoring refuses incorrect weights rather than inventing a scale',()=>{
  assert.throws(()=>parseWeightedRubric('1. Design — 5 Points',20),/totaling 20/);
  assert.throws(()=>parseWeightedRubric('General qualitative rubric',20),/numbered rubric/);
});

test('target paths and expected extensions filter shared-repo content',()=>{
  assert.equal(relevantAssessmentFile(XML,assignment),true);
  assert.equal(relevantAssessmentFile('app/src/main/java/MainActivity.java',assignment),false);
  assert.equal(relevantAssessmentFile('another/res/layout/not_my_work.txt',assignment),false);
  assert.equal(relevantAssessmentFile('app/src/main/res/layout/other.xml',
    {expectedExtensions:['xml'],targetPaths:[]}),true);
});

test('AI suggestions validate score bounds and total per criterion',()=>{
  const criteria=parseWeightedRubric(assignment.evalCriteria,20);
  const response={criteria:[4,5,3,5].map(score=>({
    score,rationale:'Source evidence supports this criterion, subject to teacher review.'
  })),feedback:'XML layout evidence demonstrates screens but execution was not verified.',
  limitations:'Confirm on-device layout and contribution attribution.'};
  const result=parseSuggestedRubric(response,criteria,20);
  assert.equal(result.score,17);
  assert.equal(result.criteria.length,4);
  assert.throws(()=>parseSuggestedRubric({...response,
    criteria:response.criteria.map((c,i)=>i===0?{...c,score:6}:c)},criteria,20),/invalid score/);
  assert.throws(()=>parseSuggestedRubric({...response,criteria:response.criteria.slice(0,3)},criteria,20),/number/);
  assert.throws(()=>parseSuggestedRubric({...response,criteria:response.criteria.map(c=>({...c,score:'5'}))},criteria,20),/invalid score/);
});

test('prompt explicitly restricts sources to approved checkpoint and does not claim runtime verification',()=>{
  const prompt=buildRubricPrompt({assessment:assignment,
    criteria:parseWeightedRubric(assignment.evalCriteria,20),
    checkpointSha:A,files:[{path:XML,text:'<TextView/>'}],
    patches:[{sha:A,path:XML,patch:'@@ +1 @@'}]});
  assert.match(prompt,new RegExp(A));
  assert.match(prompt,/DO NOT give a student credit merely because code exists in the shared project/);
  assert.match(prompt,/Do not assert the app runs/);
  assert.match(prompt,/UI Completeness/);
});

test('loads only selected XML at immutable approved SHA, not repository HEAD',async()=>{
  const requests=[];
  const fetchImpl=async url=>{
    requests.push(url);
    const response=data=>({ok:true,json:async()=>data});
    if(url.endsWith('/commits/'+A+'?per_page=100'))
      return response({files:[
        {filename:XML,status:'modified',patch:'@@ -1 +1 @@\n-old\n+<TextView />'},
        {filename:'app/src/main/java/MainActivity.java',status:'modified',patch:'+Java code'}
      ]});
    if(url.includes('/git/trees/'+A+'?recursive=1'))
      return response({truncated:false,tree:[
        {path:XML,type:'blob'}, {path:'app/src/main/java/MainActivity.java',type:'blob'}
      ]});
    if(url.includes('/contents/'+XML+'?ref='+A))
      return response({type:'file',encoding:'base64',
        content:Buffer.from('<TextView android:id="@+id/welcome"/>','utf8').toString('base64')});
    throw Error('Unexpected request: '+url);
  };
  const result=await loadPinnedV2Source({
    repository:'https://github.com/example/android',selectedCommits:[A],
    checkpointSha:A,assessment:assignment,fetchImpl
  });
  assert.deepEqual(result.files.map(f=>f.path),[XML]);
  assert.equal(result.patches.length,1);
  assert.equal(result.checkpointSha,A);
  assert.ok(requests.every(u=>!u.includes('/heads/main')&&!u.includes('?ref=main')));
  assert.ok(requests.some(u=>u.includes('?ref='+A)));
});

test('no matching student XML diffs means AI must abstain',async()=>{
  const fetchImpl=async()=>({ok:true,json:async()=>({files:[
    {filename:'app/src/main/java/MainActivity.java',status:'modified',patch:'+Main'}
  ]})});
  await assert.rejects(loadPinnedV2Source({
    repository:'https://github.com/example/android',selectedCommits:[A],
    checkpointSha:A,assessment:assignment,fetchImpl
  }),/No matching source changes/);
});

test('incomplete GitHub commit file lists stop scoring instead of silently omitting evidence',async()=>{
  const fetchImpl=async()=>({ok:true,json:async()=>({files:Array.from({length:100},()=>({
    filename:XML,status:'modified',patch:'+view'
  }))})});
  await assert.rejects(loadPinnedV2Source({
    repository:'https://github.com/example/android',selectedCommits:[A],
    checkpointSha:A,assessment:assignment,fetchImpl
  }),/incomplete or too large/);
});
