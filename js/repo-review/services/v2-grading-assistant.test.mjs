/** Regression coverage: Assessment authoring, repository evidence, individual review and protected grading: v2 grading assistant. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseWeightedRubric,relevantAssessmentFile,parseSuggestedRubric,
  buildRubricPrompt,loadPinnedV2Source,needsAdaptiveEvaluation,
  buildAdaptiveEvidenceChunks,evaluationInputSize
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
    status:'supported',score,pendingPoints:0,rationale:'Source evidence supports this criterion, subject to teacher review.'
  })),feedback:'XML layout evidence demonstrates screens but execution was not verified.',
  limitations:'Confirm on-device layout and contribution attribution.'};
  const result=parseSuggestedRubric(response,criteria,20);
  assert.equal(result.score,17);
  assert.equal(result.criteria.length,4);
  assert.throws(()=>parseSuggestedRubric({...response,criteria:response.criteria.map(({status,...row})=>row)},criteria,20),/evidence status/);
  assert.throws(()=>parseSuggestedRubric({...response,
    criteria:response.criteria.map((c,i)=>i===0?{...c,score:6}:c)},criteria,20),/invalid score/);
  assert.throws(()=>parseSuggestedRubric({...response,criteria:response.criteria.slice(0,3)},criteria,20),/number/);
  assert.throws(()=>parseSuggestedRubric({...response,criteria:response.criteria.map(c=>({...c,score:'5'}))},criteria,20),/invalid score/);
});

test('prompt explicitly restricts sources to approved checkpoint and does not claim runtime verification',()=>{
  const prompt=buildRubricPrompt({assessment:assignment,
    criteria:parseWeightedRubric(assignment.evalCriteria,20),
    checkpointSha:A,files:[{path:XML,text:'<TextView/>',primary:true,studentChanged:true}],
    patches:[{sha:A,path:XML,patch:'@@ +1 @@',primary:true,substantive:true}]});
  assert.match(prompt,new RegExp(A));
  assert.match(prompt,/Never give this student credit merely because shared code exists/);
  assert.match(prompt,/Do not assert that the app compiles, runs, navigates correctly/);
  assert.match(prompt,/UI Completeness/);
});

test('loads assessed XML and verified supporting implementation at the immutable approved SHA',async()=>{
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
  assert.deepEqual(result.files.map(f=>f.path),[XML,'app/src/main/java/MainActivity.java']);
  assert.deepEqual(result.files.filter(f=>f.primary).map(f=>f.path),[XML]);
  assert.ok(result.files.every(f=>f.studentChanged));
  assert.equal(result.patches.length,2);
  assert.equal(result.checkpointSha,A);
  assert.ok(requests.every(u=>!u.includes('/heads/main')&&!u.includes('?ref=main')));
  assert.ok(requests.some(u=>u.includes('?ref='+A)));
});

test('large verified source is collected and routed to adaptive chunks instead of the old 36 KB failure',async()=>{
  const largeXml='<LinearLayout>\n'+Array.from({length:2400},(_,i)=>'<TextView android:id="@+id/item_'+i+'" android:text="Row '+i+'" />').join('\n')+'\n</LinearLayout>';
  assert.ok(largeXml.length>36000);
  const response=data=>({ok:true,json:async()=>data});
  const result=await loadPinnedV2Source({
    repository:'https://github.com/example/android',selectedCommits:[A],verifiedContributionCommits:[A],
    checkpointSha:A,assessment:assignment,fetchImpl:async url=>{
      if(url.includes('/commits/'+A))return response({parents:[{sha:B}],files:[{filename:XML,status:'modified',patch:'+<LinearLayout>\n+<TextView />'}]});
      if(url.includes('/git/trees/'+A))return response({truncated:false,tree:[{path:XML,type:'blob'}]});
      if(url.includes('/contents/'+XML))return response({type:'file',encoding:'base64',content:Buffer.from(largeXml).toString('base64')});
      throw Error('Unexpected request '+url);
    }
  });
  assert.ok(evaluationInputSize(result).source>36000);
  assert.equal(needsAdaptiveEvaluation(result),true);
  const chunks=buildAdaptiveEvidenceChunks(result);
  assert.ok(chunks.length>1);
  assert.ok(chunks.every(chunk=>chunk.text.length<=50000));
  assert.ok(chunks.some(chunk=>chunk.refs.some(ref=>ref.sha===A&&ref.path===XML)));
});

test('many verified commit patches automatically select adaptive evaluation',()=>{
  const evidence={files:[{path:XML,text:'<LinearLayout/>',primary:true,studentChanged:true,binary:false}],
    patches:Array.from({length:10},(_,index)=>({sha:index.toString(16).padStart(40,'0'),path:XML,patch:'+<TextView id="'+index+'"/>',primary:true,substantive:true}))};
  assert.equal(needsAdaptiveEvaluation(evidence),true);
  const chunks=buildAdaptiveEvidenceChunks(evidence);
  assert.ok(chunks.length>=1);
  assert.equal(new Set(chunks.flatMap(chunk=>chunk.refs.map(ref=>ref.sha))).size,10);
});

test('verified primary files with unavailable GitHub patch text remain partial instead of aborting collection',async()=>{
  const response=data=>({ok:true,json:async()=>data});
  const result=await loadPinnedV2Source({
    repository:'https://github.com/example/android',selectedCommits:[A],verifiedContributionCommits:[A],
    checkpointSha:A,assessment:assignment,fetchImpl:async url=>{
      if(url.includes('/commits/'+A))return response({parents:[{sha:B}],files:[{filename:XML,status:'modified'}]});
      if(url.includes('/git/trees/'+A))return response({truncated:false,tree:[{path:XML,type:'blob'}]});
      if(url.includes('/contents/'+XML))return response({type:'file',encoding:'base64',content:Buffer.from('<LinearLayout><TextView/></LinearLayout>').toString('base64')});
      throw Error('Unexpected request '+url);
    }
  });
  assert.equal(result.patches[0].diffIncomplete,true);
  assert.equal(result.patches[0].substantive,false);
  assert.equal(result.truncatedDiffs.length,1);
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
    checkpointSha:A,files:[{path:XML,text:'<TextView/>',primary:true,studentChanged:true}],
    patches:[{sha:A,path:XML,patch:'+<TextView/>',primary:true,substantive:true}],contributionScope:'Student implements the welcome screen; other members implement the remaining screens.'});
  assert.match(prompt,/Do not deduct points from this student because teammate screens or group features are missing/);
  assert.match(prompt,/Student implements the welcome screen/);
  assert.match(prompt,/each student is responsible for at least one individually assigned screen/);
  assert.match(prompt,/Missing evidence is not an automatic zero/);
  assert.match(prompt,/Never silently reweight a rubric criterion/);
});

test('unresolved criteria disclose pending points while supported individual scores are retained',()=>{
  const criteria=parseWeightedRubric(assignment.evalCriteria,20);
  const evidence={patches:[{sha:A,path:XML,substantive:true}]};
  const response={criteria:criteria.map(()=>({status:'supported',score:5,
    evidence:[{sha:A,path:XML}],rationale:'Verified welcome-screen work meets the assigned individual responsibility.'})),
    feedback:'The assigned welcome screen is demonstrated. Teacher must check runtime and visual quality.',
    projectObservations:'Only one of three group screens exists; two teammates have not submitted.'};
  assert.equal(parseSuggestedRubric(response,criteria,20,evidence).score,20);
  const partial={...response,criteria:response.criteria.map((row,index)=>index===2?
    {status:'needs_teacher_review',score:null,pendingPoints:5,rationale:'Visual quality requires direct inspection by the instructor.'}:row)};
  const result=parseSuggestedRubric(partial,criteria,20,evidence);
  assert.equal(result.score,15);
  assert.equal(result.pendingPoints,5);
  assert.equal(result.potentialScore,20);
  assert.equal(result.criteria[2].score,null);
  assert.throws(()=>parseSuggestedRubric({...partial,criteria:partial.criteria.map((row,index)=>index===2?
    {...row,pendingPoints:0}:row)},criteria,20,evidence),/identify points still pending/);
  assert.throws(()=>parseSuggestedRubric({...partial,criteria:partial.criteria.map((row,index)=>index===2?
    {...row,score:0}:row)},criteria,20,evidence),/must not invent supported points/);
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

test('individual evaluation loads verified student targets instead of unrelated teammate layouts',async()=>{
  const other='app/src/main/res/layout/home.xml';
  const requests=[];
  const response=data=>({ok:true,json:async()=>data});
  const result=await loadPinnedV2Source({repository:'https://github.com/example/android',
    selectedCommits:[A,B],verifiedContributionCommits:[A],checkpointSha:B,assessment:assignment,
    fetchImpl:async url=>{
      requests.push(url);
      if(url.includes('/commits/'+A))return response({parents:[{sha:B}],files:[{filename:XML,patch:'+<TextView/>'}]});
      if(url.includes('/git/trees/'+B))return response({tree:[XML,other].map(path=>({path,type:'blob'}))});
      if(url.includes('/contents/'+XML)&&url.endsWith('?ref='+B))return response({type:'file',encoding:'base64',content:Buffer.from('<TextView/>').toString('base64')});
      throw Error('Unexpected request '+url);
    }});
  assert.deepEqual(result.files.map(file=>file.path),[XML]);
  assert.deepEqual(result.patches.map(patch=>patch.path),[XML]);
  assert.equal(requests.some(url=>url.includes('/contents/'+other)),false);
  assert.equal(requests.some(url=>url.includes('/commits/'+B)),false);
});

test('merge and formatting-only commits cannot borrow shared implementation credit',async()=>{
  const options={repository:'https://github.com/example/android',selectedCommits:[A],
    verifiedContributionCommits:[A],checkpointSha:A,assessment:assignment};
  const response=data=>({ok:true,json:async()=>data});
  const merge=await loadPinnedV2Source({...options,fetchImpl:async url=>{
    if(url.includes('/commits/'))return response({parents:[{sha:A},{sha:B}],files:[{filename:XML,status:'modified',patch:'+<TextView/>'}]});
    if(url.includes('/git/trees/'))return response({tree:[{path:XML,type:'blob'}]});
    if(url.includes('/contents/'))return response({type:'file',encoding:'base64',content:Buffer.from('<TextView/>').toString('base64')});
    throw Error('Unexpected request '+url);
  }});
  assert.deepEqual(merge.excludedMergeCommits,[A]);
  assert.equal(merge.patches.length,1);
  assert.equal(merge.patches[0].mergeContext,true);
  assert.equal(merge.patches[0].substantive,false);
  const criteria=parseWeightedRubric(assignment.evalCriteria,20);
  const suggestion={criteria:criteria.map(()=>({status:'supported',score:5,evidence:[{sha:A,path:XML}],rationale:'This shared layout exists at the checkpoint.'})),feedback:'A shared layout was inspected, with individual attribution still pending.'};
  assert.throws(()=>parseSuggestedRubric(suggestion,criteria,20,merge),/verified substantive/);
  await assert.rejects(loadPinnedV2Source({...options,fetchImpl:async()=>({ok:true,json:async()=>({files:[{
    filename:XML,patch:'-<TextView/>\n+  <TextView/>'}]})})}),/No verified substantive primary screen change/);
});
