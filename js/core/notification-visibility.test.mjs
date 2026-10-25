/** Regression coverage: Shared navigation, account access, reporting and release infrastructure: notification visibility. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {notificationVisible,unreadNotificationCount} from './notification-visibility.mjs';

const bug={type:'issue',reportCategory:'Bug',reportAudience:'admin'};
const adminReport={type:'issue',reportCategory:'Feature',reportAudience:'admin'};
const teacherReport={type:'issue',reportCategory:'Other',reportAudience:'teacher'};
test('recipient-scoped report notifications remain visible to the recipient role',()=>{
  assert.equal(notificationVisible(bug,'admin'),true);
  assert.equal(notificationVisible(bug,'teacher'),true);
  assert.equal(notificationVisible(bug,'student'),true);
});
test('student inbox includes its submission/report alerts but excludes staff grading alerts',()=>{
  assert.equal(notificationVisible({type:'grading'},'student'),false);
  assert.equal(notificationVisible({type:'submission'},'student'),true);
  assert.equal(notificationVisible(teacherReport,'teacher'),true);
  assert.equal(notificationVisible(teacherReport,'student'),true);
  assert.equal(notificationVisible(adminReport,'teacher'),true);
  assert.equal(notificationVisible({type:'grade'},'student'),true);
  assert.equal(notificationVisible({type:'assessment'},'student'),true);
});
test('unclassified legacy report alerts are hidden from non-admin roles',()=>{
  const old={type:'issue',title:'Report changed'};
  assert.equal(notificationVisible(old,'student'),false);
  assert.equal(notificationVisible(old,'teacher'),false);
  assert.equal(notificationVisible(old,'admin'),true);
});
test('badge count tracks only visible, unread items and never source errors',()=>{
  const visible=[{key:'a',type:'grade'},{key:'b',type:'assessment',readAt:123},
    {key:'c',type:'grade',history:true},{key:'d',type:'assessment'}];
  assert.equal(unreadNotificationCount(visible,new Set(),new Set(['d'])),1);
  assert.equal(unreadNotificationCount([],new Set(),new Set()),0);
});


test('release alerts respect their intended audience',()=>{
  assert.equal(notificationVisible({type:'release',audience:['admin','teacher']},'teacher'),true);
  assert.equal(notificationVisible({type:'release',audience:['admin','teacher']},'student'),false);
  assert.equal(notificationVisible({type:'release',audience:['admin','student']},'student'),true);
  assert.equal(notificationVisible({type:'release',audience:['all']},'teacher'),true);
  assert.equal(notificationVisible({type:'release',audience:['all']},'student'),true);
  assert.equal(notificationVisible({type:'release',audience:['admin']},'admin'),true);
});
