import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutDimension,layoutColor,compileAndroidLayout} from './xml-layout.mjs';
test('Android dimension and color translation rejects executable CSS',()=>{
  assert.equal(layoutDimension('match_parent'),'100%');assert.equal(layoutDimension('24dp'),'24px');
  assert.equal(layoutDimension('url(https://example.com)'),'auto');assert.equal(layoutDimension('-100dp'),'auto');
  assert.equal(layoutColor('#80FF0000'),'#FF000080');assert.equal(layoutColor('red;position:fixed'),null);
});
test('XML preview rejects external entities and oversized input before parsing',()=>{
  assert.throws(()=>compileAndroidLayout('<!DOCTYPE view SYSTEM "file:///secret"><view/>'),/Document types/);
  assert.throws(()=>compileAndroidLayout('x'.repeat(50001)),/50,000/);
});
