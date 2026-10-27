/** Regression coverage for navigation destinations, page state and disclosure behavior. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { roleHome } from './session-destination.mjs';

const source = readFileSync('js/core/adminerva-nav.js', 'utf8');
class Element {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = []; this.dataset = {}; this.attributes = {}; this.events = {};
    this.className = ''; this.textContent = ''; this.open = false;
  }
  append(...items) { for (const item of items) { item.parentNode = this; this.children.push(item); } }
  replaceChildren(...items) { this.children = []; this.append(...items); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(type, callback) { (this.events[type] ||= []).push(callback); }
  dispatch(type, event = {}) { return (this.events[type] || []).map(callback => callback({ target: this, ...event })); }
  contains(target) { return this === target || this.children.some(child => child.contains(target)); }
  querySelectorAll(query) {
    const matches = item => query === 'details' ? item.tagName === 'details'
      : query === 'details[open]' ? item.tagName === 'details' && item.open
      : query === 'a' ? item.tagName === 'a' : false;
    return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(query)]);
  }
  querySelector(query) { return query === 'summary' ? this.children.find(child => child.tagName === 'summary') : this.querySelectorAll(query)[0]; }
  closest(query) {
    if (query === '#signOutBtn' && this.id === 'signOutBtn') return this;
    if (query === 'details[open]' && this.tagName === 'details' && this.open) return this;
    return this.parentNode?.closest(query) || null;
  }
  focus() { this.focused = true; }
}
function mount(module = 'educator', page = 'dashboard', role = 'teacher', storageThrows = false, integrations = {}) {
  const desktop = new Element(), mobile = new Element(), moduleSwitch = new Element('details');
  moduleSwitch.append(new Element('summary'), new Element());
  const root = new Element(); root.append(moduleSwitch, desktop, mobile);
  const attrs = { 'data-module': module, 'data-page': page };
  root.getAttribute = key => attrs[key];
  const originalQuery = root.querySelector.bind(root);
  root.querySelector = query => query === '#av-desktop-nav' ? desktop : query === '#av-mobile-nav' ? mobile : originalQuery(query);
  const documentEvents = {};
  const document = {
    head: new Element('head'), documentElement: new Element('html'),
    createElement: tag => new Element(tag),
    querySelectorAll: () => [],
    querySelector: query => document.head.children.find(child => query === 'link[rel="' + child.rel + '"]') || null,
    getElementById: id => id === 'adminerva-nav' ? root : document.head.children.find(child => child.id === id) || null,
    addEventListener: (type, callback) => (documentEvents[type] ||= []).push(callback)
  };
  const window = { location: { href: '' } };
  const localStorage = { getItem: () => { if (storageThrows) throw new Error('Unavailable'); return role; } };
  vm.runInNewContext(integrations.source || source, { document, window, localStorage, console: { warn() {} }, ...integrations });
  documentEvents.DOMContentLoaded[0]();
  const clickOutside = () => { for (const callback of documentEvents.click) callback({ target: new Element(), preventDefault() {} }); };
  const roleReady = role => { for (const callback of documentEvents['adminerva:role-ready'] || []) callback({ detail: { role } }); };
  return { desktop, mobile, root, moduleSwitch, clickOutside, roleReady, documentEvents, document, window };
}
const links = element => element.querySelectorAll('a');
const groupNames = element => element.children.map(group => group.children[0].textContent);

test('navigation installs analytics, the manifest and brand icons once before rendering', () => {
  const view = mount();
  assert.equal(view.document.head.children.length, 4);
  const analytics = view.document.getElementById('adminerva-analytics-script');
  assert.equal(analytics.tagName, 'script');
  assert.match(analytics.src, /^js\/core\/adminerva-analytics\.js\?v=/);
  assert.equal(analytics.defer, true);
  assert.equal(view.document.querySelector('link[rel="manifest"]').href, 'manifest.webmanifest');
  assert.equal(view.document.querySelector('link[rel="apple-touch-icon"]').href, 'assets/adminerva-touch-icon-180.png');
  assert.equal(view.document.querySelector('link[rel="apple-touch-icon"]').sizes, '180x180');
  assert.equal(view.document.querySelector('link[rel="icon"]').href, 'assets/adminerva-favicon-32.png');
  assert.equal(view.document.querySelector('link[rel="icon"]').sizes, '32x32');
  view.roleReady('superadmin');
  assert.equal(view.document.head.children.length, 4);
});

test('home is a direct link and switching workspaces is an explicit disclosure', () => {
  for (const [module, role, route] of [['lesson', 'teacher', 'teacher-home.html'], ['student', 'student', 'student-home.html']]) {
    const { root } = mount(module, 'dashboard', role);
    assert.match(root.innerHTML, new RegExp('href="' + route + '" class="av-nav-home'));
    assert.match(root.innerHTML, /<details class="av-module-switcher relative group">/);
    assert.match(root.innerHTML, /aria-label="Switch workspace"/);
    assert.match(root.innerHTML, /<span>Workspaces<\/span>/);
    assert.doesNotMatch(root.innerHTML, /group-hover:block|onclick="window.history/);
  }
});

test('educator groups expose the integrated assessment, review and insights destinations', () => {
  const { desktop } = mount('repo', 'gradebook');
  assert.deepEqual(groupNames(desktop), ['Assessment ▾', 'Review & grade ▾', 'Insights ▾']);
  assert.deepEqual(links(desktop.children[0]).map(link => link.href), ['assessment-studio.html', 'submissions.html']);
  assert.deepEqual(links(desktop.children[1]).map(link => link.href), ['repofetch.html', 'gradebook.html', 'repobank.html']);
  assert.deepEqual(links(desktop.children[2]).map(link => link.href), ['teacher-analytics.html', 'learning-follow-up.html']);
  assert.ok(!links(desktop).some(link => ['activity-grader.html', 'grading.html', 'lesson-planner.html', 'users.html'].includes(link.href)));
});

test('selected task is announced once per desktop/mobile surface and page labels match routes', () => {
  for (const [module, page, route, label] of [
    ['repo', 'submissions', 'submissions.html', 'Submission inbox'],
    ['repo', 'repofetch', 'repofetch.html', 'Review &amp; grade'],
    ['repo', 'gradebook', 'gradebook.html', 'Gradebook'],
    ['student-practice', 'xml', 'student-xml-lab.html', 'XML Lab']
  ]) {
    const { desktop, mobile, root } = mount(module, page, module.startsWith('student') ? 'student' : 'teacher');
    for (const surface of [desktop, mobile]) assert.deepEqual(links(surface).filter(link => link.attributes['aria-current'] === 'page').map(link => link.href), [route]);
    assert.ok(root.innerHTML.includes('>' + label + '</span>'));
    assert.equal(mobile.children[0].children[0].textContent, 'Pages · ' + label.replace('&amp;', '&') + ' ▾');
  }
});

test('the current mobile group starts expanded without expanding the complete menu', () => {
  const { mobile } = mount('repo', 'submissions');
  assert.equal(mobile.children[0].open, false);
  const groups = mobile.children[0].children[1].children;
  assert.deepEqual(groups.map(group => group.open), [true, false, false]);
});

test('planning has its own destinations and no unrelated analytics shortcut', () => {
  const { desktop } = mount('lesson', 'planner');
  assert.deepEqual(groupNames(desktop), ['Planning ▾']);
  assert.deepEqual(links(desktop).map(link => link.href), ['lesson-planner.html', 'presentation.html', 'schedule.html', 'library.html']);
});

test('only administrators receive school management destinations', () => {
  const admin = mount('admin', 'directory', 'superadmin');
  assert.deepEqual(groupNames(admin.desktop), ['School setup ▾', 'Account ▾']);
  assert.ok(links(admin.desktop).some(link => link.href === 'manage-sections.html'));
  assert.ok(links(admin.desktop).some(link => link.href === 'teacher-accounts.html'));
  for (const role of ['teacher', 'student']) {
    for (const module of ['repo', 'admin', 'lesson']) {
      const { desktop, mobile, root } = mount(module, 'dashboard', role);
      const routes = [...links(desktop), ...links(mobile)].map(link => link.href);
      assert.ok(!routes.some(route => ['users.html', 'teacher-accounts.html', 'manage-sections.html', 'admin-analytics.html'].includes(route)));
      assert.doesNotMatch(root.innerHTML, /href="users.html"/);
    }
  }
});

test('student project, practice and playground tabs stay in their own workspace', () => {
  const project = mount('student', 'assessments', 'student');
  assert.deepEqual(links(project.desktop).map(link => link.href), ['student-dashboard.html', 'student-assessments.html', 'student-settings.html']);
  assert.match(project.root.innerHTML, /Practice Lab/);
  const practice = mount('student-practice', 'practice', 'student');
  assert.deepEqual(links(practice.desktop).map(link => link.href), ['student-practice.html', 'student-xml-lab.html']);
  const playground = mount('student-playground', 'ide', 'student');
  assert.deepEqual(links(playground.desktop).map(link => link.href), ['student-playground.html']);
  for (const item of [project, practice, playground]) assert.doesNotMatch(item.root.innerHTML, /href="settings.html"/);
});

test('signed-in home pages and direct support links retain predictable home access', () => {
  for (const [module, page, role, route] of [
    ['student-home', 'home', 'student', 'student-home.html'],
    ['staff-home', 'home', 'teacher', 'teacher-home.html'],
    ['global', 'issues', 'student', 'student-home.html'],
    ['global', 'issues', 'teacher', 'teacher-home.html']
  ]) {
    const { root, desktop, mobile } = mount(module, page, role);
    assert.match(root.innerHTML, new RegExp('href="' + route + '"'));
    assert.equal(desktop.children.length, 0);
    assert.equal(mobile.hidden, true);
  }
});

test('all rendered links, including legacy grading and XML, resolve to existing pages', () => {
  for (const [module, page, role] of [
    ['student', 'dashboard', 'student'], ['student-playground', 'ide', 'student'],
    ['student-practice', 'xml', 'student'], ['educator', 'dashboard', 'teacher'],
    ['admin', 'directory', 'superadmin'], ['lesson', 'planner', 'teacher'],
    ['settings', 'settings', 'teacher'], ['global', 'issues', 'student']
  ]) {
    const { root, desktop, mobile } = mount(module, page, role);
    const routes = [...root.innerHTML.matchAll(/href="([^"]+\.html)"/g)].map(match => match[1]);
    routes.push(...links(desktop).map(link => link.href), ...links(mobile).map(link => link.href));
    for (const route of routes) assert.ok(existsSync(route), module + ' links to missing route ' + route);
  }
});

test('opening a peer closes the previous disclosure and outside clicks close menus', () => {
  const { desktop, moduleSwitch, clickOutside } = mount();
  const [teaching, evidence] = desktop.children;
  teaching.open = true; teaching.dispatch('toggle');
  evidence.open = true; evidence.dispatch('toggle');
  assert.equal(teaching.open, false);
  moduleSwitch.open = true; moduleSwitch.dispatch('toggle');
  assert.equal(evidence.open, false);
  clickOutside(); assert.equal(moduleSwitch.open, false);
});

test('nested mobile disclosure keeps its parent open; Escape restores summary focus', () => {
  const { root, mobile, documentEvents } = mount('repo', 'gradebook');
  const outer = mobile.children[0], group = outer.children[1].children[1];
  const keydown = event => documentEvents.keydown[0]({defaultPrevented:false,...event});
  outer.open = true; outer.dispatch('toggle');
  group.open = true; group.dispatch('toggle');
  assert.equal(outer.open, true);
  let prevented = false;
  keydown({ key: 'Escape', target: group.children[1], preventDefault() { prevented = true; } });
  assert.equal(group.open, false); assert.equal(outer.open, true);
  assert.equal(group.children[0].focused, true); assert.equal(prevented, true);
  keydown({ key: 'Escape', target: outer.children[0], preventDefault() {} });
  assert.equal(outer.open, false); assert.equal(outer.children[0].focused, true);
});

test('storage failures preserve student navigation without exposing staff routes', () => {
  const { desktop, root } = mount('student-practice', 'practice', null, true);
  assert.equal(links(desktop)[0].href, 'student-practice.html');
  assert.match(root.innerHTML, /href="student-home.html"/);
  assert.doesNotMatch(root.innerHTML, /href="teacher-home.html"|href="users.html"/);
});

test('verified role refresh replaces stale navigation without multiplying global listeners', () => {
  const view = mount('admin', 'directory', 'student');
  assert.equal(view.desktop.children.length, 0);
  const listenerCounts = () => Object.fromEntries(Object.entries(view.documentEvents).map(([type, callbacks]) => [type, callbacks.length]));
  const before = listenerCounts();
  view.roleReady('superadmin');
  assert.deepEqual(groupNames(view.desktop), ['School setup ▾', 'Account ▾']);
  assert.ok(links(view.desktop).some(link => link.href === 'users.html'));
  assert.match(view.root.innerHTML, /href="school-admin.html"/);
  view.roleReady('superadmin');
  view.roleReady('teacher');
  assert.ok(!links(view.desktop).some(link => link.href === 'users.html'));
  assert.doesNotMatch(view.root.innerHTML, /href="school-admin.html"/);
  assert.deepEqual(listenerCounts(), before);
  assert.equal(view.documentEvents.keydown.length, 1);
});

test('student tabs recover when an older staff role remains in browser storage', () => {
  const view = mount('student-practice', 'xml', 'teacher');
  assert.equal(view.desktop.children.length, 0);
  view.roleReady('student');
  assert.deepEqual(links(view.desktop).map(link => link.href), ['student-practice.html', 'student-xml-lab.html']);
  assert.match(view.root.innerHTML, /href="student-settings.html"/);
  assert.doesNotMatch(view.root.innerHTML, /href="settings.html"/);
  assert.equal(links(view.desktop).find(link => link.attributes['aria-current'] === 'page').href, 'student-xml-lab.html');
});

async function checkGuard({ role = 'admin', path = '/users.html', students = [], verified = true, mockRole = null, signedIn = true, teacherPreferences = null, switchDuringLookup = false } = {}) {
  const guard = readFileSync('js/core/auth-guard.js', 'utf8').replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*/gm, '');
  let authCallback;
  const events = [], cacheCalls = [], connectionWrites = [], documentEvents = {}, nav = { dataset: {} }, storage = new Map(mockRole ? [['Adminerva_Mock_Role', mockRole]] : []);
  const user = signedIn ? { uid: 'test-user', email: 'staff@example.test', emailVerified: verified } : null;
  const auth = { currentUser: user };
  const window = { location: { pathname: path, search: '', hash: '', href: 'https://adminerva.example' + path, replace(value) { this.href = value; } }, beginLoading: () => () => {}, addEventListener() {} };
  const document = {
    body: { inert: false },
    getElementById: id => id === 'adminerva-nav' ? nav : null,
    querySelectorAll: () => [], addEventListener: (type, callback) => (documentEvents[type] ||= []).push(callback), dispatchEvent: event => events.push(event)
  };
  const context = vm.createContext({
    auth, onAuthStateChanged: (_auth, callback) => { authCallback = callback; }, signOut: async () => { cacheCalls.push('signout'); },
    activateConnectionOwner: uid => cacheCalls.push('activate:' + uid), clearConnectionPreferences: () => cacheCalls.push('clear'),
    writeConnectionPreferences: (uid, preferences) => { cacheCalls.push('hydrate:' + uid); connectionWrites.push({ uid, preferences }); },
    resolveAccountAccess: async () => {
      cacheCalls.push('resolve'); if (switchDuringLookup) auth.currentUser = { uid: 'another-account' };
      return { role, students, teachers: teacherPreferences ? [{ data: () => teacherPreferences }] : [], needsTeacherApproval: false };
    },
    window, location: window.location, URL, document, console, roleHome, rememberWorkspace() {}, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }
  });
  vm.runInContext(guard, context);
  // Firebase's listener starts an asynchronous access check without returning it.
  // Wait for that check, including sign-out cleanup, before inspecting the UI.
  const emitAuth = async value => {
    authCallback(value);
    for (let attempt = 0; attempt < 20 && vm.runInContext('checkingAccess', context); attempt++) await new Promise(setImmediate);
    assert.equal(vm.runInContext('checkingAccess', context), false, 'access check should settle');
  };
  await emitAuth(user);
  return { events, nav, window, storage, cacheCalls, connectionWrites, authCallback: emitAuth, documentEvents };
}

test('guard publishes verified presentation after successful admission and page authorization', async () => {
  const view = await checkGuard();
  assert.equal(view.events.length, 1);
  assert.equal(view.events[0].type, 'adminerva:role-ready');
  assert.equal(view.events[0].detail.role, 'superadmin');
  assert.equal(view.nav.dataset.verifiedRole, 'superadmin');
  assert.equal(view.nav.dataset.accountEmail, 'staff@example.test');
  assert.equal(view.storage.get('Adminerva_Role'), 'superadmin');
});

test('unauthorized, unverified and guest routes never publish successful role presentation', async () => {
  for (const options of [{ role: 'teacher' }, { verified: false }, { role: null }]) {
    const view = await checkGuard(options);
    assert.equal(view.events.length, 0);
    assert.equal(view.nav.dataset.verifiedRole, undefined);
    assert.notEqual(view.window.location.href, 'https://adminerva.example/users.html');
  }
});

test('verified staff simulation preserves the restricted student presentation', async () => {
  const view = await checkGuard({ role: 'teacher', path: '/student-practice.html', mockRole: 'student' });
  assert.equal(view.events[0].detail.role, 'student');
  assert.equal(view.storage.get('Adminerva_Role'), 'student');
  assert.match(view.nav.dataset.accountEmail, /Simulating: student/);
});

test('guard activates credential ownership before any asynchronous admission lookup', async () => {
  const view = await checkGuard();
  assert.deepEqual(view.cacheCalls.slice(0, 2), ['activate:test-user', 'resolve']);
  await view.authCallback({ uid: 'next-account', email: 'next@example.test', emailVerified: true });
  assert.equal(view.cacheCalls.at(-1), 'activate:next-account');
  assert.match(view.window.location.href, /account-changed/);
});

test('staff connections hydrate from the already-fetched own teacher profile after owner activation', async () => {
  const preferences = { githubToken: 'synthetic-own-key', geminiKey: 'synthetic-own-gemini-key', aiModel: 'saved-model', engineMode: 'cloud' };
  const view = await checkGuard({ teacherPreferences: preferences });
  assert.deepEqual(view.cacheCalls.slice(0, 3), ['activate:test-user', 'resolve', 'hydrate:test-user']);
  assert.equal(view.connectionWrites.length, 1);
  assert.equal(view.connectionWrites[0].uid, 'test-user');
  assert.equal(view.connectionWrites[0].preferences, preferences);
});

test('student accounts and account changes during lookup never hydrate staff connections', async () => {
  for (const options of [{ role: null, students: [{}] }, { switchDuringLookup: true }]) {
    const view = await checkGuard({ ...options, teacherPreferences: { geminiKey: 'must-not-hydrate' } });
    assert.equal(view.connectionWrites.length, 0);
  }
});

test('guard clears cached credentials for signed-out accounts and before forced sign-out', async () => {
  const signedOut = await checkGuard({ signedIn: false });
  assert.deepEqual(signedOut.cacheCalls, ['clear']);
  const unverified = await checkGuard({ verified: false });
  assert.deepEqual(unverified.cacheCalls, ['activate:test-user', 'clear', 'signout']);
});

test('guard fallback sign-out clears credentials before calling Firebase and respects handled clicks', async () => {
  const view = await checkGuard();
  const click = view.documentEvents.click[0], before = view.cacheCalls.length;
  click({ defaultPrevented: true, target: { id: 'signOutBtn' } });
  assert.equal(view.cacheCalls.length, before);
  click({ defaultPrevented: false, target: { id: 'signOutBtn' }, preventDefault() {} });
  await new Promise(setImmediate);
  assert.deepEqual(view.cacheCalls.slice(-2), ['clear', 'signout']);
});

test('navigation sign-out clears cached connection credentials before Firebase signs out', async () => {
  const calls = [];
  const injected = source
    .replace('import("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js")', 'Promise.resolve(firebaseModule)')
    .replace(/import\("\.\/connection-cache\.mjs\?v=[^"]+"\)/, 'Promise.resolve(connectionModule)');
  const view = mount('repo', 'gradebook', 'teacher', false, {
    source: injected,
    firebaseModule: { getAuth: () => ({}), signOut: async () => calls.push('signout') },
    connectionModule: { clearConnectionPreferences: () => calls.push('clear') }
  });
  const button = new Element('button'); button.id = 'signOutBtn'; view.root.append(button);
  await Promise.all(view.root.dispatch('click', { target: button, preventDefault() {} }));
  assert.deepEqual(calls, ['clear', 'signout']);
  assert.equal(view.window.location.href, 'login.html');
});
