import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('js/core/adminerva-loader.js', 'utf8');
const start = source.indexOf('function bindReportDialogAccessibility(');
const end = source.indexOf('\nfunction processBugFiles(', start);
const dialogSource = source.slice(start, end);

function fixture() {
  const events = {}, nodes = new Map();
  let observe;
  const document = {
    activeElement: null,
    getElementById: id => nodes.get(id),
    addEventListener: (type, callback) => (events[type] ||= []).push(callback)
  };
  const element = (id, focusable = false) => {
    const classes = new Set();
    const node = {
      id, focusable, dataset: {}, style: {}, hidden: false, isConnected: true, children: [],
      classList: { contains: name => classes.has(name), add: name => classes.add(name), remove: name => classes.delete(name) },
      append(...children) { for (const child of children) { child.parent = node; node.children.push(child); } },
      contains: target => node === target || node.children.some(child => child.contains(target)),
      closest: () => node.hidden || classes.has('hidden') ? node : node.parent?.closest() || null,
      getClientRects: () => node.closest() ? [] : [{}],
      querySelectorAll: () => node.children.flatMap(child => [...(child.focusable ? [child] : []), ...child.querySelectorAll()]),
      focus() { document.activeElement = node; for (const callback of events.focusin || []) callback({ target: node }); }
    };
    nodes.set(id, node); return node;
  };
  const opener = element('av-information-toggle', true), outside = element('outside', true);
  const modal = element('bug-modal'), close = element('close', true), title = element('bug-title', true), submit = element('submit', true);
  const comparison = element('bug-similarity-overlay'), compareLink = element('compare-link', true), continueButton = element('continue', true);
  comparison.append(compareLink, continueButton); comparison.classList.add('hidden');
  modal.append(comparison, close, title, submit); modal.classList.add('hidden');
  title.value = 'An unsent report'; opener.focus();
  const context = vm.createContext({ document, modal, MutationObserver: class { constructor(callback) { observe = callback; } observe() {} } });
  vm.runInContext(dialogSource + '\nbindReportDialogAccessibility(modal);', context);
  const key = (name, shiftKey = false) => {
    let prevented = false;
    for (const callback of events.keydown || []) callback({ key: name, shiftKey, preventDefault() { prevented = true; } });
    return prevented;
  };
  return { document, modal, close, title, submit, comparison, compareLink, continueButton, opener, outside, events, element, observe, key, context };
}

test('report fields and the dialog have explicit accessible names', () => {
  assert.match(source, /id="bug-modal" role="dialog" aria-modal="true" aria-labelledby="bug-dialog-title" tabindex="-1"/);
  assert.match(source, /id="bug-dialog-title"/);
  assert.match(source, /aria-label="Close report dialog"/);
  for (const id of ['bug-category', 'bug-priority', 'bug-title', 'bug-description', 'bug-image-upload']) {
    assert.match(source, new RegExp('<label for="' + id + '"'));
  }
});

test('opening focuses the report, Tab stays contained and Escape preserves the draft and returns focus', () => {
  const view = fixture();
  view.modal.classList.remove('hidden'); view.observe();
  assert.equal(view.document.activeElement, view.title);
  view.submit.focus(); assert.equal(view.key('Tab'), true);
  assert.equal(view.document.activeElement, view.close);
  assert.equal(view.key('Tab', true), true);
  assert.equal(view.document.activeElement, view.submit);
  view.outside.focus(); assert.equal(view.document.activeElement, view.title);
  assert.equal(view.key('Escape'), true);
  assert.equal(view.modal.classList.contains('hidden'), true);
  assert.equal(view.title.value, 'An unsent report');
  assert.equal(view.document.activeElement, view.opener);
  assert.equal(view.key('Tab'), false);
});

test('existing class-based close paths return focus and hidden openers use the help toggle', () => {
  const view = fixture(), hiddenMenuButton = view.element('menu-report', true);
  hiddenMenuButton.focus();
  view.modal.classList.remove('hidden'); view.observe();
  hiddenMenuButton.hidden = true;
  view.modal.classList.add('hidden'); view.observe();
  assert.equal(view.document.activeElement, view.opener);
});

test('the comparison overlay contains focus until it closes, then returns to the report fields', () => {
  const view = fixture();
  view.modal.classList.remove('hidden'); view.observe();
  view.comparison.classList.remove('hidden'); view.observe();
  assert.equal(view.document.activeElement, view.compareLink);
  view.continueButton.focus(); view.key('Tab');
  assert.equal(view.document.activeElement, view.compareLink);
  view.comparison.classList.add('hidden'); view.observe();
  assert.equal(view.document.activeElement, view.title);
});

test('binding the lifecycle twice does not duplicate keyboard and focus listeners', () => {
  const view = fixture();
  vm.runInContext('bindReportDialogAccessibility(modal);', view.context);
  assert.equal(view.events.keydown.length, 1);
  assert.equal(view.events.focusin.length, 1);
});
