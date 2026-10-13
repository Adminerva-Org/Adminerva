import { parseGithubRepository } from './github-evidence-client.mjs';

export function normalizeAssessment(raw, section, id) {
  if (!raw || !section) throw new Error('Assessment and section are required');
  const deployment = (raw.deployments || []).find(d => d.section === section);
  if (!deployment) throw new Error('This assessment is not deployed to the selected student section');
  const dateValue = value => {
    if (!value) return null;
    if (typeof value.toDate === 'function') return value.toDate().toISOString();
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw new Error('Invalid assessment date');
    return d.toISOString();
  };
  const targetPaths = raw.targetPaths?.length ? raw.targetPaths : (raw.targetPath ? [raw.targetPath] : ['*']);
  return { id, targetPaths, postDate: dateValue(deployment.postDate || raw.postDate), deadline: dateValue(deployment.deadline || raw.dueDate), caseSensitivePaths: true };
}

export function validateInspectorInput({ student, assessment, confirmedLogin, acknowledgedNoCutoff }) {
  if (!student?.id || !student.repoUrl || !student.githubUsername) throw new Error('Student must have a linked repository and GitHub username');
  parseGithubRepository(student.repoUrl);
  if (!assessment?.id) throw new Error('Select an assessment');
  if (!confirmedLogin || confirmedLogin.trim().toLowerCase() !== student.githubUsername.trim().toLowerCase()) {
    throw new Error('Confirm the exact GitHub login to inspect this identity');
  }
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
