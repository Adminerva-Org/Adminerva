/**
 * Read-only GitHub REST evidence client for Adminerva.
 * No Firebase, credential persistence, AI calls or grade writes.
 * Caller MUST provide trusted cutoff evidence separately before final grading.
 */
import {createBackoffClient} from './request-backoff.mjs?v=1.3.0';
const API = 'https://api.github.com';

export function parseGithubRepository(value) {
  const input = String(value || '').trim();
  let owner, repo;
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input)) {
    [owner, repo] = input.split('/');
  } else {
    let url;
    try { url = new URL(input); } catch { throw new Error('Invalid GitHub repository URL'); }
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') {
      throw new Error('Only https://github.com repository URLs are supported');
    }
    const parts = url.pathname.replace(/\/$/, '').split('/').filter(Boolean);
    if (parts.length !== 2) throw new Error('Expected a GitHub repository URL, not a file or subdirectory URL');
    [owner, repo] = parts;
  }
  repo = repo.replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo) || ['.','..'].includes(owner) || ['.','..'].includes(repo)) {
    throw new Error('Invalid GitHub owner or repository name');
  }
  return { owner, repo, fullName: `${owner}/${repo}` };
}

export function createGithubEvidenceClient({ token = null, fetchImpl = globalThis.fetch, maxPages = 30,
  maxCommitFilesPages = 30, retryCount = 2, signal, wait, maxWaitMs = 10000 } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || !Number.isSafeInteger(maxCommitFilesPages) || maxCommitFilesPages < 1) {
    throw new RangeError('Page limits must be positive integers');
  }
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const client=createBackoffClient({fetchImpl,github:true,scope:"github",attempts:retryCount+1,signal,wait,maxWaitMs});
  // Cache only Git objects addressed by immutable commit SHA, not mutable
  // branch references or repo metadata. Cache stays in this client instance.
  const immutableResponses = new Map();
  const MAX_IMMUTABLE_RESPONSES = 180;
  function stableRequest(url) {
    const base = /^\/repos\/[^/]+\/[^/]+\/commits(?:\/(.+))?$/.exec(url.pathname);
    if (!base) return false;
    if (base[1]) return /^[a-f0-9]{40}$/i.test(base[1]);
    return /^[a-f0-9]{40}$/i.test(url.searchParams.get("sha") || "");
  }
  function rememberImmutable(url, data) {
    if (!stableRequest(url)) return;
    immutableResponses.set(url.href, data);
    if (immutableResponses.size > MAX_IMMUTABLE_RESPONSES) {
      immutableResponses.delete(immutableResponses.keys().next().value);
    }
  }

  async function request(path, { allow404 = false } = {}) {
    const url = new URL(path, API);
    if (url.origin !== API) throw new Error('Unexpected GitHub API origin');
    if (stableRequest(url) && immutableResponses.has(url.href)) {
      return immutableResponses.get(url.href);
    }
      let response;
      try { response = await client.fetch(url.toString(), { headers }); }
      catch (error) {
        if(error.code==="cooldown"||error.name==="AbortError")throw error;
        throw new Error(`GitHub request failed: ${error.message}`, { cause: error });
      }
      if (response.status === 404 && allow404) return null;
      if (!response.ok) {
        throw new Error(`GitHub API HTTP ${response.status} for ${url.pathname}`);
      }
      try {
        const data = await response.json();
        rememberImmutable(url, data);
        return data;
      } catch { throw new Error(`GitHub API returned invalid JSON for ${url.pathname}`); }
  }

  function base(repo) {
    const { owner, repo: name } = parseGithubRepository(repo);
    return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  }

  async function repositoryInfo(repository) {
    return request(base(repository));
  }

  async function listCommits({ repository, ref = null, since = null, until = null } = {}) {
    const route = base(repository);
    if (since != null && !Number.isFinite(Date.parse(since))) throw new Error('Invalid since timestamp');
    if (until != null && !Number.isFinite(Date.parse(until))) throw new Error('Invalid until timestamp');
    // Pinned SHA prevents branch movement between pages (caller can supply a snapshot SHA).
    const items = [];
    const seen = new Set();
    for (let page = 1; page <= maxPages; page++) {
      const q = new URLSearchParams({ per_page: '100', page: String(page) });
      if (ref) q.set('sha', ref);
      if (since) q.set('since', since);
      if (until) q.set('until', until);
      const data = await request(`${route}/commits?${q}`);
      if (!Array.isArray(data)) throw new Error('Invalid GitHub commit-list response');
      for (const item of data) if (item?.sha && !seen.has(item.sha)) { seen.add(item.sha); items.push(item); }
      if (data.length < 100) return { commits: items, historyComplete: true, pagesFetched: page };
    }
    return { commits: items, historyComplete: false, pagesFetched: maxPages,
      warning: 'Reached pagination limit. Do not treat absent commits as proof of no contribution.' };
  }

  async function loadCommit(repository, sha) {
    if (!/^[a-f0-9]{40}$/i.test(sha)) throw new Error('Commit SHA must be a full 40-character hash');
    const route = `${base(repository)}/commits/${sha}`;
    const files = [];
    let root;
    let filesTruncated = false;
    for (let page = 1; page <= maxCommitFilesPages; page++) {
      const q = new URLSearchParams({ per_page: '100', page: String(page) });
      const detail = await request(`${route}?${q}`);
      if (!root) root = detail;
      if (!Array.isArray(detail.files)) throw new Error('Commit response missing files array');
      files.push(...detail.files);
      if (detail.files.length < 100) break;
      if (page === maxCommitFilesPages) filesTruncated = true;
    }
    // GitHub's REST commit-file API has a 3000-file ceiling; do not claim complete at the cap.
    if (files.length >= 3000) filesTruncated = true;
    return { sha: root.sha, parents: root.parents || [], files, filesTruncated,
      author: root.author, commit: root.commit };
  }

  async function getBranchHead(repository, ref = null) {
    const info = await repositoryInfo(repository);
    const branch = ref || info.default_branch;
    if(typeof branch!=="string"||!branch.trim())throw Error("The repository has no confirmed default branch. Select a real branch or inspect the repository manually.");
    // Query the commit endpoint for the branch's full current SHA.
    const data = await request(`${base(repository)}/commits/${encodeURIComponent(branch)}`);
    if (!/^[a-f0-9]{40}$/i.test(data?.sha || '')) throw new Error('Invalid branch head response');
    return { sha: data.sha, branch };
  }

  async function resolveEvidence({ repository, student, assessment, resolver, ref = null,
    verifiedCutoffCommitShas = null, cutoffSnapshotSha = null } = {}) {
    if (typeof resolver !== 'function') throw new TypeError('A contribution resolver function is required');
    const head = /^[a-f0-9]{40}$/i.test(ref||"") ? { sha: ref, branch: null } : await getBranchHead(repository,ref);
    const history = await listCommits({ repository, ref: head.sha });
    const result = await resolver({ repository: parseGithubRepository(repository).fullName,
      student, assessment, commits: history.commits, historyComplete: history.historyComplete,
      cutoffSnapshotSha, verifiedCutoffCommitShas,
      loadCommit: sha => loadCommit(repository, sha) });
    return { ...result, scannedRef: head.sha,
      historyCommitsScanned: history.commits.length,
      historyComplete: history.historyComplete,
      historyPagesFetched: history.pagesFetched,
      historyWarning: history.warning || null };
  }

  return { repositoryInfo, listCommits, loadCommit, getBranchHead, resolveEvidence };
}
