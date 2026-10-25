/** Regression coverage: Assessment authoring, repository evidence, individual review and protected grading: v2 grading assistant. */
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
    status:'supported',score,pendingPoints:0,confidence:'moderate',evidence:[],
    rationale:'Source evidence supports this criterion, subject to teacher review.'
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
  assert.match(prompt,/Never give this student credit merely because shared code exists/);
  assert.match(prompt,/Do not assert that the app compiles, runs/);
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
    if(url.includes('/contents/app/src/main/java/MainActivity.java?ref='+A))
      return response({type:'file',encoding:'base64',content:Buffer.from('class MainActivity {}').toString('base64')});
    throw Error('Unexpected request: '+url);
  };
  const result=await loadPinnedV2Source({
    repository:'https://github.com/example/android',selectedCommits:[A],verifiedContributionCommits:[A],
    checkpointSha:A,assessment:assignment,fetchImpl
  });
  assert.ok(result.files.some(f=>f.path===XML&&f.primary));
  assert.ok(result.files.some(f=>f.path==='app/src/main/java/MainActivity.java'&&!f.primary));
  assert.equal(result.patches.length,2); // XML primary and related Java support remain distinct verified patches.
  assert.equal(result.checkpointSha,A);
  assert.ok(requests.every(u=>!u.includes('/heads/main')&&!u.includes('?ref=main')));
  assert.ok(requests.some(u=>u.includes('?ref='+A)));
});

test('no matching student XML diffs means AI must abstain',async()=>{
  const fetchImpl=async()=>({ok:true,json:async()=>({files:[
    {filename:'app/src/main/java/MainActivity.java',status:'modified',patch:'+Main'}
  ]})});
  await assert.rejects(loadPinnedV2Source({
    repository:'https://github.com/example/android',selectedCommits:[A],verifiedContributionCommits:[A],
    checkpointSha:A,assessment:assignment,fetchImpl
  }),/No verified substantive primary screen change/);
});

test('incomplete GitHub commit file lists stop scoring instead of silently omitting evidence',async()=>{
  const fetchImpl=async()=>({ok:true,json:async()=>({files:Array.from({length:100},()=>({
    filename:XML,status:'modified',patch:'+view'
  }))})});
  await assert.rejects(loadPinnedV2Source({
    repository:'https://github.com/example/android',selectedCommits:[A],verifiedContributionCommits:[A],
    checkpointSha:A,assessment:assignment,fetchImpl
  }),/incomplete or too large/);
});

test('contributing student is evaluated on verified responsibilities, not all group screens',()=>{
  const prompt=buildRubricPrompt({assessment:assignment,criteria:parseWeightedRubric(assignment.evalCriteria,20),
    checkpointSha:A,files:[{path:XML,text:'<TextView/>'}],
    patches:[{sha:A,path:XML,patch:'+<TextView/>'}],contributionScope:'Student implements the welcome screen; other members implement the remaining screens.'});
  assert.match(prompt,/Do not deduct points from this student because teammate screens or group features are missing/);
  assert.match(prompt,/Student implements the welcome screen/);
  assert.match(prompt,/responsible for at least one individually assigned screen/);
  assert.match(prompt,/Missing evidence is not an automatic zero/);
  assert.match(prompt,/Score only this student's verified substantive changes/);
});

test('unresolved criteria stay unscored; project completeness does not alter individual scores',()=>{
  const criteria=parseWeightedRubric(assignment.evalCriteria,20);
  const evidence={patches:[{sha:A,path:XML,substantive:true}]};
  const response={criteria:criteria.map(()=>({status:'supported',score:5,pendingPoints:0,
    evidence:[{sha:A,path:XML}],rationale:'Verified welcome-screen work meets the assigned individual responsibility.'})),
    feedback:'The assigned welcome screen is demonstrated. Teacher must check runtime and visual quality.',
    projectObservations:'Only one of three group screens exists; two teammates have not submitted.'};
  assert.equal(parseSuggestedRubric(response,criteria,20,evidence).score,20);
  const partial={...response,criteria:response.criteria.map((row,index)=>index===2?
    {status:'needs_teacher_review',score:null,pendingPoints:5,rationale:'Visual quality requires direct inspection by the instructor.'}:row)};
  const proposal=parseSuggestedRubric(partial,criteria,20,evidence);
  assert.equal(proposal.score,15);
  assert.equal(proposal.pendingPoints,5);
  assert.equal(proposal.pendingCriteria,1);
  assert.throws(()=>parseSuggestedRubric({...partial,criteria:partial.criteria.map((row,index)=>index===2?
    {...row,score:0}:row)},criteria,20,evidence),/fully unresolved criterion/);
  assert.throws(()=>parseSuggestedRubric(response,criteria,20,{patches:[]}),/verified substantive/);
  assert.throws(()=>parseSuggestedRubric(response,criteria,20,{patches:[{sha:B,path:XML,substantive:true}]}),/verified substantive/);
  assert.throws(()=>parseSuggestedRubric(response,criteria,20,{patches:[{sha:A,path:XML,substantive:false}]}),/verified substantive/);
});

test('noncontributors cannot use the checkpoint or teammates source as scoring evidence',async()=>{
  let fetched=false;
  await assert.rejects(loadPinnedV2Source({repository:'https://github.com/example/android',
    selectedCommits:[A],checkpointSha:A,assessment:assignment,verifiedContributionCommits:[],
    fetchImpl:async()=>{fetched=true;}}),/Verify this student's contributing commits/);
  assert.equal(fetched,false);
});

test('matching teammate files are loaded at pinned checkpoint as context without attribution',async()=>{
  const other='app/src/main/res/layout/home.xml';
  const requests=[];
  const response=data=>({ok:true,json:async()=>data});
  const result=await loadPinnedV2Source({repository:'https://github.com/example/android',
    selectedCommits:[A,B],verifiedContributionCommits:[A],checkpointSha:B,assessment:assignment,
    fetchImpl:async url=>{
      requests.push(url);
      if(url.includes('/commits/'+A))return response({parents:[{sha:B}],files:[{filename:XML,patch:'+<TextView/>'}]});
      if(url.includes('/git/trees/'+B))return response({tree:[XML,other].map(path=>({path,type:'blob'}))});
      if(url.includes('/contents/')&&url.endsWith('?ref='+B))return response({type:'file',encoding:'base64',content:Buffer.from('<TextView/>').toString('base64')});
      throw Error('Unexpected request '+url);
    }});
  assert.deepEqual(result.files.map(file=>file.path),[XML,other]);
  assert.deepEqual(result.patches.map(patch=>patch.path),[XML]);
  assert.equal(requests.some(url=>url.includes('/commits/'+B)),false);
});

test('merge and formatting-only commits cannot borrow shared implementation credit',async()=>{
  const options={repository:'https://github.com/example/android',selectedCommits:[A],
    verifiedContributionCommits:[A],checkpointSha:A,assessment:assignment};
  const response=data=>({ok:true,json:async()=>data});
  // Merge-only evidence may produce provisional context, but cannot be credited
  // as verified individual substantive work without teacher confirmation.
  const merged=await loadPinnedV2Source({...options,fetchImpl:async url=>{
    if(url.includes('/commits/'))return response({parents:[{},{}],files:[{filename:XML,status:'modified',patch:'+<TextView/>'}]});
    if(url.includes('/git/trees/'))return response({tree:[{path:XML,type:'blob'}]});
    if(url.includes('/contents/'))return response({type:'file',encoding:'base64',content:Buffer.from('<TextView/>').toString('base64')});
    throw Error('Unexpected request '+url);
  }});
  assert.deepEqual(merged.excludedMergeCommits,[A]);
  assert.ok(merged.patches.every(patch=>patch.mergeContext&&patch.substantive===false));
  await assert.rejects(loadPinnedV2Source({...options,fetchImpl:async()=>({ok:true,json:async()=>({files:[{
    filename:XML,patch:'-<TextView/>\n+  <TextView/>'}]})})}),/No verified substantive primary screen change/);
});
