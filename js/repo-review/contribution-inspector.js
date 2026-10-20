/** Committed-change inspection and contribution-claim context. */
import { auth, db } from '../core/firebase-core.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { resolveContributions,linkGithubProfile } from './services/contribution-resolver.mjs?v=2026.10.20.1';
import {createBackoffClient} from './services/request-backoff.mjs?v=2026.10.20.1';
const identityReads=createBackoffClient({github:true,scope:"github"});
import { createGithubEvidenceClient } from './services/github-evidence-client.mjs?v=2026.10.20.1';
import { normalizeAssessment, validateInspectorInput, summarizeEvidence } from './services/inspector-helpers.mjs?v=2026.10.20.1';

const el=id=>document.getElementById(id);
if(new URLSearchParams(location.search).get('embedded')==='1')el('adminerva-nav')?.remove();
const state={students:[],assessments:[],busy:false};
const github=createGithubEvidenceClient({maxPages:10,maxCommitFilesPages:10,retryCount:1});
function text(node,value){node.textContent=String(value??'');return node}
function child(parent,tag,value){const n=document.createElement(tag);if(value!==undefined)text(n,value);parent.append(n);return n}
function option(select,value,label){const o=document.createElement('option');o.value=value;o.textContent=label;select.append(o)}
function status(message,error=false){el('status').className=error?'error':'muted';text(el('status'),message)}
function selectedStudent(){return state.students.find(s=>s.id===el('student').value)}
function selectedAssessment(){return state.assessments.find(a=>a.id===el('assessment').value)}
function updateSelection(){
 const section=el('section').value;
 for(const [name,list,empty] of [['student',state.students.filter(s=>s.section===section),'Select student'],['assessment',state.assessments.filter(a=>Array.isArray(a.deployments)&&a.deployments.some(d=>d.section===section)),'Select assessment']]){
   const dropdown=el(name);dropdown.replaceChildren();option(dropdown,'',empty);
   for(const item of list)option(dropdown,item.id,item.name||item.title||item.id);
 }
 updateRepo();
}
function updateRepo(){const s=selectedStudent();text(el('repoDisplay'),s?`GitHub: @${s.githubUsername||'(not linked)'} · Repo: ${s.repoUrl||'(not linked)'}`:'');el('inspect').disabled=state.busy||!s||!selectedAssessment()}
function safeGithubLink(sha,repository){const a=document.createElement('a');const [owner,repo]=repository.split('/');a.href=`https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commit/${encodeURIComponent(sha)}`;a.rel='noopener noreferrer';a.target='_blank';text(a,sha.slice(0,12));return a}
function render(evidence){
 el('results').hidden=false;const summary=summarizeEvidence(evidence);
 const windowExcluded = evidence.skipped.filter(c=>c.reason==='outside_configured_window').length;
 const otherAuthor = evidence.skipped.filter(c=>c.reason==='different_github_user_id'||c.reason==='unmatched_identity').length;
 const mergeExcluded = evidence.reviewCommits.filter(c=>c.reason==='merge_commit_requires_parent_aware_review').length;
 text(el('summary'),
   `Status: ${summary.status} | GitHub commits scanned: ${evidence.historyCommitsScanned ?? 'unknown'} (${evidence.historyPagesFetched ?? '?'} page(s), ${evidence.historyComplete ? 'complete' : 'unverified'}) | ` +
   `Attributed non-merge commits: ${summary.attributedCommits} | Assessment-relevant commits: ${summary.relevantCommits} | Relevant files: ${summary.relevantFiles} | ` +
   `Merge commits needing review: ${mergeExcluded} | Excluded by time: ${windowExcluded} | Other GitHub authors: ${otherAuthor} | Missing patches: ${summary.missingPatches}`);
 el('warnings').replaceChildren();for(const w of summary.warnings)child(el('warnings'),'li',w);
 el('files').replaceChildren();for(const file of evidence.relevantFiles){
  const wrap=child(el('files'),'div');wrap.className='file';child(wrap,'strong',file.path);child(wrap,'p',`Type: ${file.kind} · Status: ${file.statuses.join(', ')} · Commits: ${file.commitShas.length}${file.missingPatch?' · Text patch missing':''}`);
  if(file.previousPaths.length)child(wrap,'p',`Previous path(s): ${file.previousPaths.join(', ')}`);
  for(const patch of file.patches.slice(0,3)){const details=child(wrap,'details');child(details,'summary',`Show diff from ${patch.sha.slice(0,12)} (up to 6,000 chars)`);child(details,'pre',patch.patch.slice(0,6000));}
 }
 if(!evidence.relevantFiles.length)child(el('files'),'p','No matching files were found in the attributed commits available. This does not prove that the student submitted nothing.'); 
 const fallbackBox=el('fallback');fallbackBox.replaceChildren();
 const fallback=evidence.fallback || {status:'not_available',suggestions:[],selected:[]};
 if(fallback.status==='not_needed') child(fallbackBox,'p','Expected-path code was found; an alternative search was not needed.');
 else if(fallback.status==='none' || fallback.status==='not_available') child(fallbackBox,'p','No credible alternative work identified from available attributed changes. This does not prove the student submitted nothing.');
 else {
   const selectedPaths=new Set((fallback.selected||[]).map(f=>f.path));
   child(fallbackBox,'p',
      fallback.status==='candidate_found'
        ? 'Potential assessment work exists outside target paths. These files can be provisionally evaluated, but teacher review is mandatory.'
        : 'Possible files were found, but evidence is too weak or ambiguous for automatic selection. Please inspect manually.');
   for(const candidate of (fallback.suggestions||[])){
     const wrap=child(fallbackBox,'div');wrap.className='file';
     const label=child(wrap,'strong',candidate.path);label.className='break-all';
     child(wrap,'p',(selectedPaths.has(candidate.path)?'Selected as tentative evidence':'Manual investigation only')+
       ' · File category: '+candidate.kind+' · Candidate rank: '+candidate.candidateScore);
     child(wrap,'p',(candidate.reasons||[]).join('; ')||'No strong assessment-specific filename evidence.');
     for(const patch of candidate.patches.slice(0,2)){
       const details=child(wrap,'details');
       child(details,'summary','View attributed changes from '+patch.sha.slice(0,12));
       child(details,'pre',patch.patch.slice(0,4500));
     }
   }
 }

 el('commits').replaceChildren();for(const c of evidence.acceptedCommits){const p=child(el('commits'),'p');p.append(safeGithubLink(c.sha,evidence.repository));child(p,'span',` — ${c.matchedPaths.length} matching file(s)`)}
 el('review').replaceChildren();for(const c of evidence.reviewCommits){const p=child(el('review'),'p');p.append(safeGithubLink(c.sha,evidence.repository));child(p,'span',` — ${c.reason}`)}
 if(!evidence.reviewCommits.length)child(el('review'),'p','No individually flagged commits (overall evidence can still require review).');
}
async function inspect(){
 if(state.busy)return;const student=selectedStudent(), raw=selectedAssessment();
 try{
  const assessment=normalizeAssessment(raw,el('section').value,raw?.id);
  validateInspectorInput({student,assessment,acknowledgedNoCutoff:el('acknowledge').checked});
  state.busy=true;el('inspect').disabled=true;el('results').hidden=true;status('Checking public GitHub account identity…');
  const response=await identityReads.fetch(`https://api.github.com/users/${encodeURIComponent(student.githubUsername.trim().replace(/^@/,''))}`,{headers:{Accept:'application/vnd.github+json'}});
  if(!response.ok)throw new Error(`GitHub profile lookup failed (HTTP ${response.status})`);
  const profile=await response.json();
  status(`Retrieving commit history for ${student.name||student.id}… API rate limits may apply.`);
  const result=await github.resolveEvidence({repository:student.repoUrl,student:linkGithubProfile(student,profile),assessment,resolver:resolveContributions});
  // A profile login identifies GitHub commits; it does not prove profile ownership.
  result.warnings.push('Saved GitHub login has not been independently verified as belonging to this student.');
  if (assessment.historicalStartIgnored) {
    result.warnings.push('Historical grading: the blueprint posting date was ignored because strict submission-start enforcement is disabled. Older commits were included.');
  }
  const windowExcluded = result.skipped.filter(c => c.reason === 'outside_configured_window').length;
  if (windowExcluded) {
    result.warnings.push(windowExcluded + ' commit(s) were excluded by an explicitly configured submission window. Change the deployment or deadline policy if you intend to inspect those dates.');
  }
  if (result.historyComplete === false) {
    result.warnings.push('Repository history is incomplete. Do not use missing commits as evidence of non-submission.');
  }
  render(result);status('Inspection finished. No grades or student records were modified.');
 }catch(err){status(err?.message||'Inspection failed',true)}finally{state.busy=false;updateRepo()}
}
async function load(){
 try{
  status('Loading class roster and assessments…');
  const [stuSnap,assSnap]=await Promise.all([getDocs(collection(db,'students')),getDocs(collection(db,'assessments'))]);
  state.students=stuSnap.docs.map(d=>({id:d.id,...d.data()}));state.assessments=assSnap.docs.map(d=>({id:d.id,...d.data()}));
  const sections=[...new Set(state.students.map(s=>s.section).filter(Boolean))].sort();const dropdown=el('section');dropdown.replaceChildren();option(dropdown,'','Select section');for(const section of sections)option(dropdown,section,section);
  const params=new URLSearchParams(location.search);
  const requestedSection=params.get('section')||'';
  if(sections.includes(requestedSection)){
    el('section').value=requestedSection;updateSelection();
    const requestedStudent=params.get('student'),requestedAssessment=params.get('assessment');
    if(state.students.some(x=>x.id===requestedStudent&&x.section===requestedSection))el('student').value=requestedStudent;
    if(state.assessments.some(x=>x.id===requestedAssessment))el('assessment').value=requestedAssessment;
    updateRepo();
  }
  status('Ready. Select a section, assessment, and student.');
 }catch(e){status(`Unable to load roster: ${e.message}. Only teacher accounts with Firestore read permissions can use this inspector.`,true)}
}
el('section').addEventListener('change',updateSelection);el('student').addEventListener('change',updateRepo);el('assessment').addEventListener('change',updateRepo);el('inspect').addEventListener('click',inspect);
onAuthStateChanged(auth,user=>{if(user)load()});
