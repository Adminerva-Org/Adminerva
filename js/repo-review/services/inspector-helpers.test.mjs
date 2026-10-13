import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAssessment, validateInspectorInput, summarizeEvidence } from './inspector-helpers.mjs';
const deployment = { section: '11-A', postDate: '2026-09-01T00:00:00Z', deadline: '2026-10-01T00:00:00Z' };
test('selects section-specific deployment dates', () => {
 const a=normalizeAssessment({targetPaths:['**/quarter2/**'],deployments:[deployment]},'11-A','A');
 assert.equal(a.deadline,'2026-10-01T00:00:00.000Z'); assert.equal(a.targetPaths[0],'**/quarter2/**');
});
test('rejects assessments not assigned to selected section',()=>assert.throws(()=>normalizeAssessment({deployments:[deployment]},'11-B','A'),/not deployed/));
test('legacy targetPath remains supported',()=>assert.deepEqual(normalizeAssessment({targetPath:'src/**',deployments:[deployment]},'11-A','A').targetPaths,['src/**']));
test('missing paths default to entire repository',()=>assert.deepEqual(normalizeAssessment({deployments:[deployment]},'11-A','A').targetPaths,['*']));
const student={id:'1',repoUrl:'https://github.com/pransin-ca/Group-08.git',githubUsername:'pransin-ca'};
test('uses saved student GitHub username without manual typing', () =>
 assert.equal(validateInspectorInput({student,assessment:{id:'a'},acknowledgedNoCutoff:true}), true));
test('requires cutoff disclaimer',()=>
 assert.throws(()=>validateInspectorInput({student,assessment:{id:'a'},acknowledgedNoCutoff:false}),/not a verified/));
test('requires a linked account',()=>
 assert.throws(()=>validateInspectorInput({student:{...student,githubUsername:''},assessment:{id:'a'},acknowledgedNoCutoff:true}),/linked repository/));
test('summarizes evidence without grading',()=>{const x=summarizeEvidence({status:'requires_review',acceptedCommits:[{matchedPaths:['x']},{matchedPaths:[]}],relevantFiles:[{missingPatch:true}],reviewCommits:[{}],warnings:[]});assert.equal(x.relevantCommits,1);assert.equal(x.missingPatches,1);assert.match(x.warnings[0],/Preview only/)});
