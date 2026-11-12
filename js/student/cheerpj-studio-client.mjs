/**
 * Optional CheerpJ Java runner on an independent HTTPS origin.
 *
 * IMPORTANT: CheerpJ must never run on the signed-in Adminerva origin.
 * Studio only creates a sandboxed cross-origin iframe and sends the Java
 * source snapshot over a narrowly scoped postMessage protocol.
 */
export const CHEERPJ_STUDIO_RUNNER_URL = '';
export const CHEERPJ_RUNNER_CHANNEL = 'adminerva-cheerpj-studio-v1';

const CONNECT_TIMEOUT_MS = 45000;
const IDLE_TIMEOUT_MS = 45000;
const MAX_SESSION_MS = 8 * 60 * 1000;
const HEARTBEAT_CHECK_MS = 10000;

export function validateCheerpjRunnerUrl(input, parentOrigin = location.origin) {
  if (typeof input !== 'string' || !input.trim()) return null;
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.origin === parentOrigin ||
        url.username || url.password || url.search || url.hash ||
        !url.pathname.endsWith('/embedded-runner.html')) return null;
    return url;
  } catch { return null; }
}

export function validateBrowserJavaFiles(files, entry) {
  if (!files || typeof files !== 'object' || Array.isArray(files) ||
      typeof entry !== 'string' || !Object.hasOwn(files, entry)) {
    throw new Error('Choose a valid Java entry file.');
  }
  const paths = Object.entries(files);
  if (paths.length < 1 || paths.length > 40) {
    throw new Error('Browser Java supports 1–40 Java source files.');
  }
  let size = 0;
  const encoder = new TextEncoder();
  for (const [path, code] of paths) {
    if (typeof code !== 'string' ||
        !/^[A-Za-z0-9_.\-/]+\.java$/.test(path) ||
        path.split('/').some(part => !part || part === '.' || part === '..')) {
      throw new Error('Browser Java currently supports only safe .java source paths.');
    }
    size += encoder.encode(code).length;
    if (size > 250000) throw new Error('Browser Java source exceeds 250 KB.');
  }
  return Object.fromEntries(paths);
}

/**
 * The host never runs Java code itself. A fresh isolated frame is created
 * for each run and destroyed to stop loops, clear stdin and release workers.
 * Failed/abandoned Java executions cannot be resumed after a refresh.
 */
export class CheerpjStudioClient {
  constructor({ runnerUrl = CHEERPJ_STUDIO_RUNNER_URL, onEvent = () => {} } = {}) {
    this.url = validateCheerpjRunnerUrl(runnerUrl);
    if (!this.url) throw new Error('Browser Java needs a separate HTTPS execution host. The authenticated Adminerva origin is not safe.');
    this.onEvent = onEvent;
    this.frame = null;
    this.session = null;
    this.state = 'idle';
    this.files = null;
    this.entry = null;
    this.connectTimer = null;
    this.sessionTimer = null;
    this.watchdog = null;
    this.lastActivity = 0;
    this.listener = this.receive.bind(this);
  }

  start({ files, entry }) {
    if (this.frame) throw new Error('A Java program is already running. Stop it before starting another.');
    const frozenFiles = validateBrowserJavaFiles(files, entry);
    this.files = frozenFiles;
    this.entry = entry;
    this.session = crypto.randomUUID();
    this.state = 'connecting';
    this.lastActivity = Date.now();
    window.addEventListener('message', this.listener);
    const frame = document.createElement('iframe');
    this.frame = frame;
    frame.title = 'Isolated Java execution';
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    frame.referrerPolicy = 'no-referrer';
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;left:-4px;top:-4px;width:2px;height:2px;opacity:0;pointer-events:none;border:0';
    const url = new URL(this.url);
    url.searchParams.set('session', this.session);
    frame.src = url.toString();
    frame.addEventListener('load', () => {
      if (this.frame !== frame) return;
      if (this.state === 'connecting') this.post('hello');
      else this.fail('Browser Java runner navigated unexpectedly. Execution stopped.');
    });
    frame.addEventListener('error', () => {
      if (this.frame === frame) this.fail('Browser Java runner could not load.');
    });
    this.connectTimer = setTimeout(() => {
      if (this.state === 'connecting') {
        this.fail('Browser Java runner did not connect within 45 seconds. Switch to Standard (batch) or retry.');
      }
    }, CONNECT_TIMEOUT_MS);
    this.sessionTimer = setTimeout(() => {
      if (this.frame) this.fail('Browser Java reached the 8-minute session limit. Your project is unchanged; run it again.');
    }, MAX_SESSION_MS);
    this.watchdog = setInterval(() => {
      if (this.frame && this.state !== 'connecting' &&
          Date.now() - this.lastActivity > IDLE_TIMEOUT_MS) {
        this.fail('Browser Java stopped responding. The isolated process has been reset; your project is unchanged.');
      }
    }, HEARTBEAT_CHECK_MS);
    try {
      document.body.append(frame);
    } catch (error) {
      this.dispose();
      throw error;
    }
    this.onEvent({ type: 'status', state: 'connecting', message: 'Connecting to the isolated Java runtime…' });
    return this.session;
  }

  post(type, extra = {}) {
    if (!this.frame?.contentWindow || !this.session) return;
    this.frame.contentWindow.postMessage(
      { channel: CHEERPJ_RUNNER_CHANNEL, session: this.session, type, ...extra },
      this.url.origin
    );
  }

  receive(event) {
    if (!this.frame || event.source !== this.frame.contentWindow ||
        event.origin !== this.url.origin) return;
    const data = event.data;
    if (!data || data.channel !== CHEERPJ_RUNNER_CHANNEL ||
        data.session !== this.session || typeof data.type !== 'string') return;
    if (data.type === 'ready' && this.state === 'connecting') {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
      this.lastActivity = Date.now();
      this.state = 'loading';
      this.post('run', { files: this.files, entry: this.entry });
      this.files = null;
      this.entry = null;
      return;
    }
    if (data.type === 'heartbeat' && ['loading', 'compiling', 'running'].includes(this.state)) {
      this.lastActivity = Date.now();
      return;
    }
    if (data.type === 'status' && ['loading', 'compiling', 'running'].includes(data.state) &&
        ['loading', 'compiling', 'running'].includes(this.state)) {
      this.lastActivity = Date.now();
      this.state = data.state;
      this.onEvent({ type: 'status', state: data.state, message: String(data.message || '').slice(0, 160) });
      return;
    }
    if (data.type === 'output' && ['loading', 'compiling', 'running'].includes(this.state)) {
      this.lastActivity = Date.now();
      const chunk = typeof data.text === 'string' ? data.text.slice(0, 65536) : '';
      if (chunk) this.onEvent({ type: 'output', text: chunk });
      return;
    }
    if (data.type === 'finished' && ['loading', 'compiling', 'running'].includes(this.state)) {
      this.state = 'finished';
      try {
        this.onEvent({
          type: 'finished',
          code: Number.isInteger(data.code) ? data.code : null,
          compileFailed: data.compileFailed === true
        });
      } finally { this.dispose(); }
      return;
    }
    if (data.type === 'error') {
      this.fail(String(data.message || 'Java runtime error').slice(0, 500));
    }
  }

  sendLine(line) {
    if (this.state !== 'running' || typeof line !== 'string' ||
        line.length > 2000 || /[\r\n]/.test(line)) return false;
    this.post('input', { text: line });
    return true;
  }

  fail(message) {
    try { this.onEvent({ type: 'error', message }); }
    finally { this.dispose(); }
  }

  stop() {
    if (!this.frame) return false;
    try { this.onEvent({ type: 'stopped' }); }
    finally { this.dispose(); }
    return true;
  }

  dispose() {
    clearTimeout(this.connectTimer);
    clearTimeout(this.sessionTimer);
    clearInterval(this.watchdog);
    this.connectTimer = null;
    this.sessionTimer = null;
    this.watchdog = null;
    window.removeEventListener('message', this.listener);
    this.frame?.remove();
    this.frame = null;
    this.session = null;
    this.files = null;
    this.entry = null;
    this.state = 'idle';
  }
}
