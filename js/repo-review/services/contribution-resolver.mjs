/**
 * Adminerva Phase 1: read-only contribution resolver prototype.
 *
 * Inputs are GitHub REST list-commits objects and a caller-provided commit detail loader.
 * No Firebase, browser storage, AI, grade writes, or GitHub credentials are used here.
 *
 * Caveat: author/committer timestamps do NOT prove that code was pushed before a
 * deadline. For official cutoff grading, use a trusted cutoff snapshot/webhook.
 */

import { analyzeFileContributions } from './commit-substance.mjs?v=1.3.0';

const SOURCE_EXTS = new Set(['java', 'kt', 'kts', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'cpp', 'c', 'h', 'cs', 'html', 'css', 'sql', 'xml', 'json', 'gradle', 'md', 'txt', 'dart', 'swift', 'go', 'rs', 'rb', 'php', 'vue', 'svelte']);
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
 * Evidence-based fallback for nonstandard submission locations.
 * Ranking is advisory. Never attribute teammates' commits, use binary assets,
 * accept incomplete patches as valid code, or silently expand a blueprint.
 */
const FALLBACK_EXCLUDED = /(?:^|\/)(?:\.git|\.gradle|\.idea|node_modules|vendor|build|dist|coverage|generated|__pycache__)(?:\/|$)/i;
const FALLBACK_DOCUMENTS = /^(?:readme|license|changelog|contributing|notice|authors|todo)(?:[._-]|$)/i;
const GENERIC_SEGMENTS = new Set([
  'app','src','source','main','test','tests','java','kotlin','xml','res','layout',
  'com','org','example','project','code','student','students','quarter','quarter1',
  'quarter2','quarter3','quarter4','q1','q2','q3','q4','peta','task','assignment',
  'exam','activity','mini','file','files','the','and','for','with','from','new'
]);
function pathSegments(value) {
  return String(value || '').split('/').map(v => v.replace(/[*?]/g,'')
    .replace(/\.[a-z0-9]+$/i,'').replace(/[^a-z0-9]/gi,'').toLowerCase())
    .filter(v => v.length >= 4 && !GENERIC_SEGMENTS.has(v));
}
function assessmentPetaNumber(title) {
  const match = String(title || "").match(/\b(?:mini[\s_-]*)?peta[\s#:_-]*(\d{1,2})\b/i);
  return match ? Number(match[1]) : null;
}
export function scopeAssessmentFiles(files, { title = '', studentName = '' } = {}) {
  const number = assessmentPetaNumber(title);
  if (!number || !Array.isArray(files) || !files.length) {
    return { selected: files || [], excluded: [], warnings: [], scoped: false };
  }
  const exact = new RegExp('(?:^|[/_.-])(?:mini)?peta[_ -]*' + number + '(?:[/_.-]|$)', 'i');
  const any = /(?:^|[/_.-])(?:mini)?peta[_ -]*\d+(?:[/_.-]|$)/i;
  let selected = files.filter(file => exact.test(file.path));
  const wrong = files.some(file => any.test(file.path) && !exact.test(file.path));
  if (!selected.length && !wrong) {
    return { selected: files, excluded: [], warnings: [], scoped: false };
  }
  const excluded = files.filter(file => !selected.includes(file));
  const warnings = excluded.length ? [
    'The broad assessment path includes other assignments. ' +
    excluded.length + ' file(s) outside PETA ' + number +
    ' were excluded; confirm the task path.'
  ] : [];
  const tokens = String(studentName || '').toLowerCase().split(/[^a-z]+/).filter(t => t.length >= 4);
  function personalPrefix(item) {
    const stem = item.path.split('/').pop().replace(/\.[^.]+$/, '');
    const parts = stem.match(new RegExp('^(.*?)[_-]?(?:mini)?peta[_ -]*' + number + '$', 'i'));
    return parts ? parts[1].replace(/[^a-z]/gi, '').toLowerCase() : null;
  }
  const own = selected.filter(file => {
    const prefix = personalPrefix(file);
    return prefix && tokens.some(t => prefix.includes(t));
  });
  if (own.length) {
    const others = selected.filter(file => {
      const prefix = personalPrefix(file);
      return prefix && !tokens.some(t => prefix.includes(t));
    });
    if (others.length) {
      selected = selected.filter(file => !others.includes(file));
      excluded.push(...others);
      warnings.push('Files individually named for other students were excluded from automatic grading; verify authorship.');
    }
  }
  return { selected, excluded, warnings, scoped: true };
}
function taskKeywords(patterns, assessment) {
  const tokens = new Set();
  for (const pattern of patterns) {
    for (const token of pathSegments(pattern)) tokens.add(token);
  }
  const title = String(assessment.title || '').replace(/([a-z])([A-Z])/g, '$1 $2');
  const taskNumber = assessmentPetaNumber(assessment.title);
  if (taskNumber) {
    tokens.add('peta' + taskNumber);
    tokens.add('minipeta' + taskNumber);
  }

  for (const word of title.toLowerCase().split(/[^a-z0-9]+/)) {
    if (word.length >= 5 && !GENERIC_SEGMENTS.has(word)) tokens.add(word);
  }
  return [...tokens].slice(0, 20);
}
function looksLikeCode(patch, path) {
  const additions = String(patch || '').split('\n')
    .filter(line => line.startsWith('+') && !line.startsWith('+++'))
    .slice(0, 180).join('\n');
  if (/(?:^|\n)\+\s*<([A-Za-z][\w.-]*)(?:\s|\/?>)/.test(additions) &&
      /\.(?:xml|txt)$/i.test(path)) return true;
  const hasSyntax = /[{};()]|=>/.test(additions);
  const hasLanguage = /\b(?:class|interface|enum|fun|void|static|public|private|protected|if|else|for|while|switch|return|import|package|def|function|const|let|val|var|println|print|printf|System\.out|extends|implements|override|when|namespace)\b/.test(additions);
  return hasSyntax && hasLanguage;
}
function rankFallbackCandidate(file, patterns, assessment) {
  const path = file.path.toLowerCase();
  const name = path.split('/').pop();
  if (FALLBACK_EXCLUDED.test(path) || FALLBACK_DOCUMENTS.test(name) || file.kind === 'asset') return null;
  if (file.kind === 'other' || !file.patches.length || file.missingPatch) return null;
  if (file.statuses.length && file.statuses.every(status => status === 'removed')) return null;
  const content = file.patches.map(item => item.patch).join('\n');
  if (analyzeFileContributions(file).lowSubstance) return null;
  const codeLike = looksLikeCode(content, file.path);
  if (name.endsWith('.txt') && !codeLike) return null;
  const tokens = taskKeywords(patterns, assessment);
  const compact = path.replace(/[^a-z0-9]/g, '');
  const reasons = [], matched = [];
  let score = codeLike ? 2 : 0;
  for (const token of tokens) {
    if (compact.includes(token)) {
      score += 5;
      matched.push(token);
    }
  }
  if (matched.length) reasons.push('Filename or folder relates to: ' + matched.join(', '));
  const patchWords = content.toLowerCase().replace(/[^a-z0-9]/g, '');
  const contentMatch = tokens.filter(t => !matched.includes(t) && patchWords.includes(t));
  if (contentMatch.length) {
    score += Math.min(4, 2 * contentMatch.length);
    reasons.push('Code changes mention: ' + contentMatch.join(', '));
  }
  for (const raw of patterns) {
    if (/[*?]/.test(raw)) continue;
    const basename = String(raw).split('/').pop().replace(/\.[^.]+$/, '').toLowerCase();
    if (basename.length >= 5 && name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9]/g, '').includes(basename.replace(/[^a-z0-9]/g, ''))) {
      score += 10;
      reasons.push('Filename resembles the blueprint target');
      break;
    }
  }
  const expected = Array.isArray(assessment.expectedExtensions)
    ? assessment.expectedExtensions.map(ext => String(ext).toLowerCase().replace(/^\./, '')) : [];
  const ext = name.includes('.') ? name.split('.').pop() : '';
  const unexpectedExtension = !!expected.length && !expected.includes(ext);
  if (unexpectedExtension) reasons.push('Unexpected file type: .' + ext + ' (expected ' + expected.join(', ') + ')');
  if (!codeLike) reasons.push('Patch has insufficient code syntax for automatic selection');
  // Require a meaningful assignment-specific connection, not just any code.
  const strong = score >= 7 && codeLike && (matched.length > 0 || reasons.includes('Filename resembles the blueprint target'));
  return { ...file, candidateScore: score, reasons,
    unexpectedExtension, codeLike, strong, selectionMode: 'investigation' };
}

export function isGradableSource(file) {
  if (!file || file.kind === 'asset' || file.kind === 'other' ||
      !Array.isArray(file.patches) || !file.patches.length || file.missingPatch) return false;
  if (file.statuses?.length && file.statuses.every(status => status === 'removed')) return false;
  if (analyzeFileContributions(file).lowSubstance) return false;
  if (/\.(?:txt|md)$/i.test(file.path)) {
    return looksLikeCode(file.patches.map(p => p.patch).join('\n'), file.path);
  }
  return true;
}

export function selectFallbackCandidates(unmatchedFiles, patterns, assessment, { maxFiles = 12 } = {}) {
  const ranked = [...unmatchedFiles]
    .map(file => rankFallbackCandidate(file, patterns, assessment))
    .filter(Boolean)
    .sort((a,b) => b.candidateScore - a.candidateScore || a.path.localeCompare(b.path));
  if (!ranked.length) return { status: 'none', selected: [], suggestions: [], overflow: false };
  const top = ranked[0].candidateScore;
  const qualified = ranked.filter(file => file.strong && file.candidateScore >= Math.max(7, top - 4));
  // Many equally plausible files indicate a whole-project change rather than a clear assignment.
  const overflow = qualified.length > maxFiles;
  const selected = overflow ? [] : qualified;
  const status = overflow ? 'ambiguous' : selected.length ? 'candidate_found' : 'weak_candidates';
  return { status, selected, suggestions: ranked.slice(0, maxFiles),
    overflow };
}

/**
 * Attribution requires verified account binding for auto-acceptance.
 * Fallback metadata may suggest a candidate, but never establishes ownership.
 */
export function linkGithubProfile(student,profile) {
  const expected=String(student.githubUsername||"").trim().replace(/^@/,"").toLowerCase();
  if(!expected||String(profile?.login||"").toLowerCase()!==expected||!Number.isSafeInteger(profile?.id)||profile.id<=0)
    throw Error("The linked GitHub login could not be resolved. Review the student's account before evaluating.");
  if(student.githubUserId!=null&&String(student.githubUserId).trim()!==""&&Number(student.githubUserId)!==profile.id)
    throw Error("The saved GitHub account ID differs from this login. Instructor identity review is required.");
  return {...student,githubUsername:profile.login,githubUserId:profile.id};
}
export function attributeCommit(commit, student) {
  const stableId=value=>Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):null;
  const linkedId = stableId(student.githubUserId);
  const actualId = stableId(commit.author?.id);
  const login = String(commit.author?.login || '').toLowerCase();
  const expectedLogin = String(student.githubUsername || '').trim().replace(/^@/,'').toLowerCase();
  const commitEmail = String(commit.commit?.author?.email || '').toLowerCase();
  const verifiedEmails = (student.verifiedGitEmails || []).map(v => String(v).toLowerCase());

  if (linkedId !== null && actualId !== null) {
    if (linkedId === actualId) return { status: 'verified', reason: 'github_user_id' };
    // A matching login with conflicting stable IDs is an account-binding conflict,
    // not evidence that the commit belongs to another learner. Keep it in teacher
    // review instead of silently discarding it as "other".
    if (login && expectedLogin && login === expectedLogin)
      return { status: 'review', reason: 'github_user_id_conflict' };
    return { status: 'other', reason: 'different_github_user_id' };
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
  const acceptedCommits = [], reviewCommits = [], skipped = [], files = new Map(),
    unmatchedFiles = new Map(), warnings = [];
  let unmatchedOverflow = false;
  if (!historyComplete) warnings.push('Commit history pagination has not been confirmed complete.');
  const hasVerifiedCutoff = cutoffSnapshotSha && Array.isArray(verifiedCutoffCommitShas);
  const cutoffSet = hasVerifiedCutoff ? new Set(verifiedCutoffCommitShas) : null;
  if (end !== null && !hasVerifiedCutoff) warnings.push('Commit timestamps do not prove push-before-deadline; verify ancestry against a trusted cutoff snapshot.');

  // Fetch independent, attributable commit details with bounded concurrency.
  // Reuse these results below in original history order. Limit parallel calls
  // to four to reduce waiting time without flooding the GitHub REST API.
  const detailResults = new Map();
  const needed = [];
  const scheduled = new Set();
  for (const commit of commits) {
    if (!commit?.sha || scheduled.has(commit.sha)) continue;
    scheduled.add(commit.sha);
    if (attributeCommit(commit, student).status !== 'verified') continue;
    if (Array.isArray(commit.parents) && commit.parents.length > 1) continue;
    const dateText = commit.commit?.committer?.date || commit.commit?.author?.date;
    const when = dateText ? Date.parse(dateText) : NaN;
    if (!Number.isFinite(when)) continue;
    if (cutoffSet && !cutoffSet.has(commit.sha)) continue;
    if ((start !== null && when < start) || (end !== null && !cutoffSet && when > end)) continue;
    needed.push(commit.sha);
  }
  let nextDetail = 0;
  await Promise.all(Array.from({length: Math.min(4, needed.length)}, async () => {
    for (;;) {
      const index = nextDetail++;
      if (index >= needed.length) return;
      const sha = needed[index];
      try { detailResults.set(sha, {detail: await loadCommit(sha)}); }
      catch (error) { detailResults.set(sha, {error}); }
    }
  }));

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

    // Known merge commits cannot independently establish who introduced code.
    if (Array.isArray(commit.parents) && commit.parents.length > 1) {
      reviewCommits.push({sha:commit.sha,reason:'merge_commit_requires_parent_aware_review'});
      continue;
    }
    const fetched = detailResults.get(commit.sha);
    let detail;
    if (fetched?.error) {
      reviewCommits.push({sha:commit.sha,reason:'commit_detail_fetch_error'});
      continue;
    }
    if (fetched) detail = fetched.detail;
    else {
      try { detail = await loadCommit(commit.sha); }
      catch (error) { reviewCommits.push({ sha: commit.sha, reason: 'commit_detail_fetch_error' }); continue; }
    }
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
      const matchesBlueprint = candidatePaths.some(path =>
        matchPath(path, patterns, {caseSensitive: assessment.caseSensitivePaths !== false}));
      const path = normalizeRepoPath(file.filename);
      if (!matchesBlueprint && assessment.investigationFallback !== false) {
        const kind = classifyFile(path);
        if (kind !== 'asset' && kind !== 'other' && !FALLBACK_EXCLUDED.test(path)) {
          if (!unmatchedFiles.has(path) && unmatchedFiles.size >= 250) unmatchedOverflow = true;
          else {
            const alternative = unmatchedFiles.get(path) || {
              path, kind, statuses: new Set(), commits: new Set(),
              patches: [], previousPaths: new Set(), missingPatch: false
            };
            alternative.commits.add(commit.sha);
            alternative.statuses.add(file.status || 'modified');
            if (file.previous_filename) alternative.previousPaths.add(file.previous_filename);
            if (typeof file.patch === 'string' && file.patch.length) {
              alternative.patches.push({sha: commit.sha, patch: file.patch});
            } else alternative.missingPatch = true;
            unmatchedFiles.set(path, alternative);
          }
        }
        continue;
      }
      if (!matchesBlueprint) continue;
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
  const lowSubstanceFiles = relevantFiles.filter(file => analyzeFileContributions(file).lowSubstance);
  if (lowSubstanceFiles.length) {
    warnings.push('Possible whitespace/comment-only recommits in ' + lowSubstanceFiles.length +
      ' matching file(s). These edits alone are not evidence of new implementation.');
  }
  const gradableStrict = relevantFiles.some(isGradableSource);
  const unmatched = [...unmatchedFiles.values()].map(f => ({
    path: f.path, kind: f.kind, statuses: [...f.statuses], commitShas: [...f.commits],
    patches: f.patches, previousPaths: [...f.previousPaths], missingPatch: f.missingPatch
  }));
  const fallback = assessment.investigationFallback === false || gradableStrict
    ? { status: 'not_needed', selected: [], suggestions: [], overflow: false }
    : selectFallbackCandidates(unmatched, patterns, assessment);
  if (unmatchedOverflow) {
    fallback.selected = [];
    fallback.status = 'ambiguous';
    fallback.overflow = true;
    warnings.push('Too many alternative files to investigate safely; teacher must narrow the search.');
  }
  if (fallback.status === 'candidate_found') {
    warnings.push('Expected paths had no gradable student code; alternative files found. Provisional score requires teacher review.');
  } else if (fallback.status === 'ambiguous' || fallback.status === 'weak_candidates') {
    warnings.push('Possible work outside blueprint paths requires manual file selection; no confident fallback evaluation.');
  }
  let status = relevantFiles.length ? 'resolved' : 'no_relevant_changes';
  if (fallback.status === 'candidate_found' || lowSubstanceFiles.length || reviewCommits.length || !historyComplete ||
      (end !== null && !hasVerifiedCutoff) || relevantFiles.some(f=>f.missingPatch)) {
    status = 'requires_review';
  }
  return { repository, studentId: student.id, assessmentId: assessment.id,
    status, acceptedCommits, reviewCommits, skipped, relevantFiles,
    fallback, lowSubstanceFiles: lowSubstanceFiles.map(file => ({
      path:file.path, commitShas:analyzeFileContributions(file).flaggedShas
    })), cutoffSnapshotSha, warnings };
}
