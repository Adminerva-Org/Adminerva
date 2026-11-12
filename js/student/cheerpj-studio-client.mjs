/**
 * Adminerva Studio's optional CheerpJ 5 interactive console client.
 *
 * A separate HTTPS ORIGIN is mandatory. Java must never execute on the
 * authenticated Adminerva origin, which stores Firebase app state.
 * This module does not load CheerpJ or execute Java in the parent page.
 */
export const CHEERPJ_STUDIO_RUNNER_URL = '';

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

const CHANNEL = 'adminerva-cheerpj-studio-v1';

export class CheerpjStudioClient {
  constructor({ runnerUrl = CHEERPJ_STUDIO_RUNNER_URL, onEvent = () => {} } = {}) {
    this.url = validateCheerpjRunnerUrl(runnerUrl);
    if (!this.url) throw new Error('Browser Java requires a separately hosted HTTPS runner. The current origin is not safe.');
    this.onEvent = onEvent;
    this.session = null;
    this.frame = null;
    this.state = 'idle';
    this.files = null;
    this.entry = null;
    this.timeout = null;
    this.listener = this.receive.bind(this);
  }

  start({ files, entry }) {
    if (this.frame) throw new Error('A browser Java program is already running. Stop it before starting another.');
    if (!files || typeof files !== 'object' || Array.isArray(files) ||
        !entry || !Object.hasOwn(files, entry)) throw new Error('Select a valid Java entry file.');
    const sourceFiles = Object.entries(files);
    if (sourceFiles.length < 1 || sourceFiles.length > 40) throw new Error('Browser Java supports up to 40 source files.');
    let bytes = 0;
    const encoder = new TextEncoder();
    for (const [path, content] of sourceFiles) {
      if (typeof content !== 'string' || typeof path !== 'string' ||
          !/^[A-Za-z0-9_.\-/]+\.java$/.test(path) ||
          path.split('/').some(part => part === '.' || part === '..' || !part)) {
        throw new Error('The browser Java pilot currently accepts only safe .java source paths.');
      }
      bytes += encoder.encode(content).length;
      if (bytes > 250000) throw new Error('Browser Java source exceeds the 250 KB pilot limit.');
    }
    this.files = Object.fromEntries(sourceFiles);
    this.entry = entry;
    this.session = crypto.randomUUID();
    this.state = 'connecting';
    window.addEventListener('message', this.listener);
    const frame = document.createElement('iframe');
    this.frame = frame;
    frame.title = 'Isolated Java execution';
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    frame.referrerPolicy = 'no-referrer';
    frame.style.cssText = 'position:fixed;left:-4px;top:-4px;width:2px;height:2px;opacity:0;pointer-events:none;border:0';
    const url = new URL(this.url);
    url.searchParams.set('session', this.session);
    frame.src = url.toString();
    frame.addEventListener('load', () => {
      if (this.frame === frame) this.post('hello');
    });
    frame.addEventListener('error', () => this.fail('Could not load the isolated Java runner.'));
    document.body.append(frame);
    this.timeout = window.setTimeout(() => {
      if (this.state === 'connecting') this.fail('Java runner did not respond. Check hosting and browser support.');
    }, 30000);
    this.onEvent({ type: 'status', state: 'connecting', message: 'Connecting to isolated browser Java runtime…' });
    return this.session;
  }

  post(type, extra = {}) {
    if (!this.frame?.contentWindow || !this.session) return;
    this.frame.contentWindow.postMessage({ channel: CHANNEL, session: this.session, type, ...extra }, this.url.origin);
  }

  receive(event) {
    if (!this.frame || event.source !== this.frame.contentWindow ||
        event.origin !== this.url.origin) return;
    const data = event.data;
    if (!data || data.channel !== CHANNEL || data.session !== this.session ||
        typeof data.type !== 'string') return;
    if (data.type === 'ready' && this.state === 'connecting') {
      clearTimeout(this.timeout);
      this.timeout = null;
      this.state = 'loading';
      this.post('run', { files: this.files, entry: this.entry });
      this.files = null;
      this.entry = null;
    } else if (data.type === 'status') {
      if (!['loading', 'compiling', 'running'].includes(data.state)) return;
      this.state = data.state;
      this.onEvent({ type: 'status', state: data.state, message: String(data.message || '') });
    } else if (data.type === 'output') {
      const chunk = String(data.text || '').slice(0, 65536);
      if (chunk) this.onEvent({ type: 'output', text: chunk });
    } else if (data.type === 'finished') {
      this.state = 'finished';
      this.onEvent({ type: 'finished', code: Number.isInteger(data.code) ? data.code : null,
        compileFailed: data.compileFailed === true });
      this.dispose();
    } else if (data.type === 'error') {
      this.fail(String(data.message || 'Java runtime error').slice(0, 500));
    }
  }

  sendLine(line) {
    if (this.state !== 'running') return false;
    if (typeof line !== 'string' || line.length > 2000) return false;
    this.post('input', { text: line });
    return true;
  }

  fail(message) {
    this.onEvent({ type: 'error', message });
    this.dispose();
  }

  stop() {
    if (!this.frame) return false;
    this.onEvent({ type: 'stopped' });
    this.dispose();
    return true;
  }

  dispose() {
    clearTimeout(this.timeout);
    this.timeout = null;
    window.removeEventListener('message', this.listener);
    this.frame?.remove();
    this.frame = null;
    this.session = null;
    this.files = null;
    this.entry = null;
    this.state = 'idle';
  }
}
