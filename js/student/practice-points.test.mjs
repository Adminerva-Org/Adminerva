/** Regression coverage: Student submissions, practice progress and isolated code workspaces: practice points. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {practicePoints,classStandings,MISSION_IDS} from './practice-points.mjs';
test('points count each known mission once and ignore arbitrary client scores',()=>{
  assert.equal(practicePoints(['j1','j1','unknown','p2']).points,20);
  assert.equal(practicePoints(MISSION_IDS).maximum,3000);
  assert.equal(practicePoints(null).points,0);
});
test('class standings require consent, section match and reviewed missions without exposing identities',()=>{
  const profiles=[{studentId:'alice',section:'A',alias:'Learner One',leaderboardOptIn:true,email:'secret@example.edu'},
    {studentId:'bob',section:'A',alias:'Learner Two',leaderboardOptIn:false},{studentId:'carol',section:'B',alias:'Other Class',leaderboardOptIn:true}];
  const scores=[{studentId:'alice',section:'A',verifiedMissionIds:['j1'],points:10,reviewedBy:'teacher'},
    {studentId:'bob',section:'A',verifiedMissionIds:['j1','j2'],points:20,reviewedBy:'teacher'}];
  assert.deepEqual(classStandings(profiles,scores,'A'),[{alias:'Learner One',points:10,rank:1}]);
  assert.deepEqual(classStandings(profiles,[{...scores[0],points:999}],'A'),[]);
  assert.deepEqual(classStandings(profiles,[{...scores[0],reviewedBy:null}],'A'),[]);
});
test('tied class points have the same rank',()=>{
  const profiles=['a','b','c'].map(id=>({studentId:id,section:'A',alias:'Learner '+id,leaderboardOptIn:true}));
  const scores=profiles.map(profile=>({...profile,verifiedMissionIds:profile.studentId==='c'?[]:['j1'],points:profile.studentId==='c'?0:10,reviewedBy:'teacher'}));
  assert.deepEqual(classStandings(profiles,scores,'A').map(row=>row.rank),[1,1,3]);
});
