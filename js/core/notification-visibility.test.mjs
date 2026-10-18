/** Regression coverage: Shared navigation, account access, reporting and release infrastructure: notification visibility. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {notificationVisible,unreadNotificationCount} from './notification-visibility.mjs';

const bug={type:'issue',reportCategory:'Bug',reportAudience:'admin'};
const adminReport={type:'issue',reportCategory:'Feature',reportAudience:'admin'};
const teacherReport={type:'issue',reportCategory:'Other',reportAudience:'teacher'};
test('bug notifications are strictly administrator-only',()=>{
  assert.equal(notificationVisible(bug,'admin'),true);
  assert.equal(notificationVisible(bug,'teacher'),false);
  assert.equal(notificationVisible(bug,'student'),false);
});
test('teacher notifications do not appear in student inboxes',()=>{
  assert.equal(notificationVisible({type:'grading'},'student'),false);
  assert.equal(notificationVisible({type:'submission'},'student'),false);
  assert.equal(notificationVisible(teacherReport,'teacher'),true);
  assert.equal(notificationVisible(teacherReport,'student'),false);
  assert.equal(notificationVisible(adminReport,'teacher'),false);
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
