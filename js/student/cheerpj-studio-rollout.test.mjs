import assert from 'node:assert/strict';
import { test } from 'node:test';
import {evaluateBrowserJavaAccess,CHEERPJ_STUDIO_ROLLOUT} from './cheerpj-studio-rollout.mjs';

const pilot={ mode:'licensed_pilot', institutionalUseApproved:true,
  pilotUids:['instructor-test'], allowGeneralAssessments:true,
  allowPersonalizedAssessments:true, allowPracticalExams:false, allowGuests:false };
const context={status:'ready',assessmentId:'personalized-1',personalized:true,
  variantId:'issued-variant',attempt:1,readOnly:false};

test('production default is disabled and developer access requires an independent host',()=>{
  assert.equal(CHEERPJ_STUDIO_ROLLOUT.mode,'off');
  assert.equal(evaluateBrowserJavaAccess({runnerReady:true,uid:'instructor-test'}).enabled,false);
  assert.equal(evaluateBrowserJavaAccess({policy:{mode:'developer_evaluation',pilotUids:['a']},
    uid:'a',runnerReady:false}).enabled,false);
});

test('developer evaluations are allowlisted and cannot run graded assessments',()=>{
  const p={mode:'developer_evaluation',pilotUids:['instructor-test']};
  assert.equal(evaluateBrowserJavaAccess({policy:p,uid:'instructor-test',runnerReady:true}).enabled,true);
  assert.equal(evaluateBrowserJavaAccess({policy:p,uid:'student',runnerReady:true}).enabled,false);
  assert.equal(evaluateBrowserJavaAccess({policy:p,uid:'instructor-test',runnerReady:true,
    assessmentId:'personalized-1'}).enabled,false);
});

test('institutional license approval and student allowlist are required for piloting',()=>{
  assert.equal(evaluateBrowserJavaAccess({policy:{...pilot,institutionalUseApproved:false},
    runnerReady:true,uid:'instructor-test'}).enabled,false);
  assert.equal(evaluateBrowserJavaAccess({policy:pilot,runnerReady:true,uid:'student'}).enabled,false);
  assert.equal(evaluateBrowserJavaAccess({policy:pilot,runnerReady:true,uid:'instructor-test'}).enabled,true);
});

test('personalized variants must be issued and current before browser execution',()=>{
  const opts={policy:pilot,runnerReady:true,uid:'instructor-test',
    assessmentId:'personalized-1',examPolicyPending:false};
  assert.equal(evaluateBrowserJavaAccess({...opts,assessmentContext:null}).enabled,false);
  assert.equal(evaluateBrowserJavaAccess({...opts,assessmentContext:{...context,status:'unavailable'}}).enabled,false);
  assert.equal(evaluateBrowserJavaAccess({...opts,assessmentContext:{...context,variantId:''}}).enabled,false);
  assert.equal(evaluateBrowserJavaAccess({...opts,assessmentContext:{...context,readOnly:true}}).enabled,false);
  assert.equal(evaluateBrowserJavaAccess({...opts,assessmentContext:context,examPolicyPending:true}).enabled,false);
  assert.equal(evaluateBrowserJavaAccess({...opts,assessmentContext:context}).enabled,true);
});

test('practical exam and guest access remain disabled unless explicitly permitted',()=>{
  const opts={policy:pilot,runnerReady:true,uid:'instructor-test',
    assessmentId:'personalized-1',assessmentContext:context};
  assert.equal(evaluateBrowserJavaAccess({...opts,practicalExam:true}).enabled,false);
  assert.equal(evaluateBrowserJavaAccess({...opts,uid:null,guest:true}).enabled,false);
  assert.equal(evaluateBrowserJavaAccess({...opts,policy:{...pilot,allowPersonalizedAssessments:false}}).enabled,false);
});
