/** Assessment authoring, repository evidence, individual review and protected grading: inspector helpers. */
import { parseGithubRepository } from './github-evidence-client.mjs';

export function normalizeAssessment(raw, section, id) {
  if (!raw || !section) throw new Error('Assessment and section are required');
  const deployment = (raw.deployments || []).find(d => d.section === section) ||
    (!raw.deployments?.length && raw.targetSections?.includes(section)
      ? {section, deadline:raw.dueDate || null, postDate:raw.postDate || null} : null);
  if (!deployment) throw new Error('This assessment is not deployed to the selected student section');
  const dateValue = value => {
    if (!value) return null;
    if (typeof value.toDate === 'function') return value.toDate().toISOString();
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw new Error('Invalid assessment date');
    return d.toISOString();
  };
  const configured = raw.targetPaths?.length ? raw.targetPaths
    : (raw.targetPath ? [raw.targetPath] : ['*']);
  const originals = configured.map(rawPath => String(rawPath || '').trim()
    .replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '')).filter(Boolean);
  // Match the Auto-Checker expansion for old blueprint paths relative to Java package root.
  const preferred = originals.filter(path => {
    if (path === '*') return originals.length === 1;
    if (!/[?*]/.test(path)) return !originals.some(other => other !== path &&
      !/[?*]/.test(other) && other.startsWith(path.replace(/\/$/, '') + '/'));
    if (path.endsWith('/*') && originals.includes(path.slice(0, -2))) return false;
    return true;
  });
  const targetPaths = [...new Set(preferred.flatMap(path => {
    if (path === '*') return [path];
    const normalized = !/[?*]/.test(path) && !/\.[a-z0-9]+$/i.test(path)
      ? path.replace(/\/$/, '') + '/**' : path;
    return normalized.startsWith('**/') || normalized.startsWith('app/')
      ? [normalized] : [normalized, '**/' + normalized];
  }))];
  return {
    id, title: raw.title || '', targetPaths,
    expectedExtensions: raw.expectedExtensions || [],
    investigationFallback: raw.investigationFallback !== false,
    // Historical assessment deployments must not hide existing work simply
    // because the teacher deployed the blueprint after students made commits.
    // Match Auto-Checker: enforce a start date only when explicitly enabled.
    postDate: dateValue(raw.enforceSubmissionStart === true &&
      deployment.deadlineEnabled !== false ? (deployment.postDate || raw.postDate) : null),
    deadline: dateValue(deployment.deadlineEnabled === false ? null :
      (deployment.deadline || raw.dueDate)),
    historicalStartIgnored: raw.enforceSubmissionStart !== true &&
      Boolean(deployment.postDate || raw.postDate),
    caseSensitivePaths: raw.caseSensitivePaths === true
  };
}

export function validateInspectorInput({ student, assessment, acknowledgedNoCutoff }) {
  if (!student?.id || !student.repoUrl || !student.githubUsername) throw new Error('Student must have a linked repository and GitHub username');
  parseGithubRepository(student.repoUrl);
  if (!assessment?.id) throw new Error('Select an assessment');
  if (!acknowledgedNoCutoff) throw new Error('Acknowledge that this is not a verified deadline snapshot');
  return true;
}

export function summarizeEvidence(evidence) {
  if (!evidence || !Array.isArray(evidence.acceptedCommits) || !Array.isArray(evidence.relevantFiles)) throw new Error('Invalid evidence object');
  const matched = evidence.acceptedCommits.filter(c => c.matchedPaths.length);
  return {
    status: evidence.status,
    attributedCommits: evidence.acceptedCommits.length,
    relevantCommits: matched.length,
    relevantFiles: evidence.relevantFiles.length,
    reviewCommits: evidence.reviewCommits.length,
    missingPatches: evidence.relevantFiles.filter(f => f.missingPatch).length,
    warnings: [...evidence.warnings, 'Preview only: account linkage is teacher-asserted for this session; no deadline cutoff has been independently verified.']
  };
}
