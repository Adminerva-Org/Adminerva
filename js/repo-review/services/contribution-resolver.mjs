/**
 * Adminerva Phase 1: read-only contribution resolver prototype.
 *
 * Inputs are GitHub REST list-commits objects and a caller-provided commit detail loader.
 * No Firebase, browser storage, AI, grade writes, or GitHub credentials are used here.
 *
 * Caveat: author/committer timestamps do NOT prove that code was pushed before a
 * deadline. For official cutoff grading, use a trusted cutoff snapshot/webhook.
 */

const SOURCE_EXTS = new Set(['java', 'kt', 'kts', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'cpp', 'c', 'h', 'cs', 'html', 'css', 'sql', 'xml', 'json', 'gradle', 'md']);
const ASSET_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif', 'ico', 'mp3', 'mp4', 'wav', 'pdf']);

export function classifyFile(path) {
  const name = String(path || '').split('/').pop().toLowerCase();
  const ext = name.includes('.') ? name.split('.').pop() : '';
  if (ASSET_EXTS.has(ext)) return 'asset';
  if (SOURCE_EXTS.has(ext) || name === 'gradlew' || name === 'gradle.properties') {
    if (ext === 'xml' && /\/res\/(layout|drawable|menu|values|xml)\//i.test(path)) return 'android_resource';
    if (ext === 'gradle' || ext === 'kts' || name === 'gradlew') return 'build_configuration';
    return 'text';
  }
  return 'other';
}

export function normalizeRepoPath(value) {
  const path = String(value || '').replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '');
  if (!path || path.split('/').includes('..')) throw new Error(`Unsafe or empty repository path: ${value}`);
  return path;
}

function globRegex(pattern) {
  let regex = '^';
  for (let i = 0; i < pattern.length;) {
    const char = pattern[i];
    if (char === '*' && pattern[i + 1] === '*' && pattern[i + 2] === '/') {
      regex += '(?:.*/)?'; i += 3;
    } else if (char === '*' && pattern[i + 1] === '*') {
      regex += '.*'; i += 2;
    } else if (char === '*') {
      regex += '[^/]*'; i++;
    } else if (char === '?') {
      regex += '[^/]'; i++;
    } else {
      regex += /[.\\+^${}()|[\]]/.test(char) ? `\\${char}` : char;
      i++;
    }
  }
  return new RegExp(regex + '$');
}

export function matchPath(path, patterns, { caseSensitive = true } = {}) {
  const filePath = normalizeRepoPath(path);
  if (!Array.isArray(patterns) || !patterns.length || patterns.includes('*')) return true;
  return patterns.some(rawPattern => {
    let pattern;
    try { pattern = normalizeRepoPath(rawPattern); } catch { return false; }
    const file = caseSensitive ? filePath : filePath.toLowerCase();
    const target = caseSensitive ? pattern : pattern.toLowerCase();
    // A path without glob characters can denote a directory.
    // Match its descendants without accepting similarly named sibling paths.
    if (!/[?*]/.test(target)) {
      const folder = target.endsWith('/') ? target : target + '/';
      return file === target || file.startsWith(folder);
    }
    return globRegex(target).test(file);
  });
}

/**
 * Attribution requires verified account binding for auto-acceptance.
 * Fallback metadata may suggest a candidate, but never establishes ownership.
 */
export function attributeCommit(commit, student) {
  const linkedId = student.githubUserId == null ? null : Number(student.githubUserId);
  const actualId = commit.author?.id == null ? null : Number(commit.author.id);
  const login = String(commit.author?.login || '').toLowerCase();
  const expectedLogin = String(student.githubUsername || '').toLowerCase();
  const commitEmail = String(commit.commit?.author?.email || '').toLowerCase();
  const verifiedEmails = (student.verifiedGitEmails || []).map(v => String(v).toLowerCase());

  if (linkedId !== null && actualId !== null) {
    return linkedId === actualId
      ? { status: 'verified', reason: 'github_user_id' }
      : { status: 'other', reason: 'different_github_user_id' };
  }
  if (login && expectedLogin && login === expectedLogin) {
    return student.githubAccountVerified === true
      ? { status: 'verified', reason: 'verified_github_login' }
      : { status: 'review', reason: 'github_login_not_verified' };
  }
  if (commitEmail && verifiedEmails.includes(commitEmail)) {
    return { status: 'review', reason: 'git_author_email_can_be_spoofed' };
  }
  return { status: 'other', reason: 'unmatched_identity' };
}

export async function resolveContributions({
  repository, student, assessment, commits, loadCommit,
  historyComplete = false, cutoffSnapshotSha = null, verifiedCutoffCommitShas = null
}) {
  if (!repository || !student || !assessment || !Array.isArray(commits) || typeof loadCommit !== 'function') {
    throw new TypeError('repository, student, assessment, commits[], and loadCommit() are required');
  }
  const patterns = assessment.targetPaths || (assessment.targetPath ? [assessment.targetPath] : []);
  const start = assessment.postDate ? Date.parse(assessment.postDate) : null;
  const end = assessment.deadline ? Date.parse(assessment.deadline) : null;
  if ((start !== null && Number.isNaN(start)) || (end !== null && Number.isNaN(end))) {
    throw new Error('Invalid assessment timestamps');
  }
  const seen = new Set();
  const acceptedCommits = [], reviewCommits = [], skipped = [], files = new Map(), warnings = [];
  if (!historyComplete) warnings.push('Commit history pagination has not been confirmed complete.');
  const hasVerifiedCutoff = cutoffSnapshotSha && Array.isArray(verifiedCutoffCommitShas);
  const cutoffSet = hasVerifiedCutoff ? new Set(verifiedCutoffCommitShas) : null;
  if (end !== null && !hasVerifiedCutoff) warnings.push('Commit timestamps do not prove push-before-deadline; verify ancestry against a trusted cutoff snapshot.');

  for (const commit of commits) {
    if (!commit?.sha || seen.has(commit.sha)) continue;
    seen.add(commit.sha);
    const attribution = attributeCommit(commit, student);
    if (attribution.status === 'other') { skipped.push({ sha: commit.sha, reason: attribution.reason }); continue; }
    if (attribution.status === 'review') { reviewCommits.push({ sha: commit.sha, reason: attribution.reason }); continue; }

    const dateStr = commit.commit?.committer?.date || commit.commit?.author?.date;
    const stamp = dateStr ? Date.parse(dateStr) : NaN;
    if (!Number.isFinite(stamp)) { reviewCommits.push({ sha: commit.sha, reason: 'unverifiable_commit_time' }); continue; }
    if (cutoffSet && !cutoffSet.has(commit.sha)) {
      skipped.push({sha:commit.sha,reason:'not_in_verified_cutoff_snapshot'}); continue;
    }
    if ((start !== null && stamp < start) || (end !== null && !cutoffSet && stamp > end)) {
      skipped.push({ sha: commit.sha, reason: 'outside_configured_window' }); continue;
    }

    let detail;
    try { detail = await loadCommit(commit.sha); }
    catch (error) { reviewCommits.push({ sha: commit.sha, reason: 'commit_detail_fetch_error' }); continue; }
    if (!detail || !Array.isArray(detail.files)) {
      reviewCommits.push({ sha: commit.sha, reason: 'missing_commit_files' }); continue;
    }
    if (!Array.isArray(detail.parents)) {
      reviewCommits.push({ sha: commit.sha, reason: 'unverified_commit_parentage' }); continue;
    }
    if (detail.filesTruncated === true) {
      reviewCommits.push({ sha: commit.sha, reason: 'truncated_commit_files' }); continue;
    }
    if (Array.isArray(detail.parents) && detail.parents.length > 1) {
      reviewCommits.push({ sha: commit.sha, reason: 'merge_commit_requires_parent_aware_review' });
      continue;
    }
    const matched = [];
    for (const file of detail.files) {
      if (!file?.filename) continue;
      const candidatePaths = [file.filename, file.previous_filename].filter(Boolean);
      if (!candidatePaths.some(path => matchPath(path, patterns, {caseSensitive: assessment.caseSensitivePaths !== false}))) continue;
      const path = normalizeRepoPath(file.filename);
      const entry = files.get(path) || {
        path, kind: classifyFile(path), statuses: new Set(),
        commits: new Set(), patches: [], previousPaths: new Set(), missingPatch: false
      };
      entry.commits.add(commit.sha);
      entry.statuses.add(file.status || 'modified');
      if (file.previous_filename) entry.previousPaths.add(file.previous_filename);
      if (typeof file.patch === 'string' && file.patch.length) entry.patches.push({sha: commit.sha, patch: file.patch});
      else if (entry.kind !== 'asset') entry.missingPatch = true;
      files.set(path, entry);
      matched.push(path);
    }
    acceptedCommits.push({ sha: commit.sha, matchedPaths: matched });
  }

  const relevantFiles = [...files.values()].map(f => ({
    path: f.path, kind: f.kind, statuses: [...f.statuses],
    commitShas: [...f.commits], patches: f.patches,
    previousPaths: [...f.previousPaths], missingPatch: f.missingPatch
  })).sort((a,b) => a.path.localeCompare(b.path));
  if (relevantFiles.some(f=>f.missingPatch)) warnings.push('One or more textual patches are unavailable; fetch a trusted file snapshot for context.');
  let status = relevantFiles.length ? 'resolved' : 'no_relevant_changes';
  if (reviewCommits.length || !historyComplete || (end !== null && !hasVerifiedCutoff) || relevantFiles.some(f=>f.missingPatch)) {
    status = 'requires_review';
  }
  return { repository, studentId: student.id, assessmentId: assessment.id,
    status, acceptedCommits, reviewCommits, skipped, relevantFiles,
    cutoffSnapshotSha, warnings };
}
